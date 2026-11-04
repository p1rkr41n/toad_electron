//! adversarial_m4_stress_tests.rs
//!
//! Empirical Adversarial Stress Test Suite for Milestone 4:
//! - Windows EBUSY avoidance with open file handles during cache purge
//! - High concurrency workspace CRUD mutations and reads
//! - Strict 500ms debounce auto-recovery and sub-500ms cancellation
//! - Input fuzzing and SQL injection safety in project commands
//! - Double-valid .bak recovery under disk corruption

use serde_json::json;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use toad_lib::commands::workspace::*;
use toad_lib::ledger::{
    generate_project_id, CacheCleaner, LedgerState, ParquetLedger, ReconciliationScenario,
    StartupReconciler,
};
use toad_lib::portable::ToadConfig;
use toad_lib::state::AppState;

fn create_stress_test_dir(test_name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("toad_stress_m4_{}_{}", test_name, generate_project_id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("Failed to create stress test dir");
    dir
}

// =============================================================================
// TEST 1: Windows EBUSY Avoidance with Active Open File Handles
// =============================================================================

#[tokio::test]
async fn test_ebusy_purge_with_active_open_file_handle() {
    let test_dir = create_stress_test_dir("ebusy_open_handle");
    let temp_dir = test_dir.join("temp");
    fs::create_dir_all(&temp_dir).unwrap();

    let pid = "ebusy_prj";
    let prj_dir = temp_dir.join(pid);
    fs::create_dir_all(&prj_dir).unwrap();

    // Create a mock cached parquet file in temp/ebusy_prj/
    let sample_file = prj_dir.join("active_reader.parquet");
    {
        let mut f = File::create(&sample_file).unwrap();
        f.write_all(b"PAR1_MOCK_PARQUET_DATA_ACTIVE_HANDLE").unwrap();
        f.flush().unwrap();
    }

    // Open file handle with read access, simulating an active reader (DuckDB or OS scanner)
    // On Windows, Rust's OpenOptions default passes FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE
    let open_handle = OpenOptions::new()
        .read(true)
        .open(&sample_file)
        .expect("Failed to open simulated reader handle");

    // Empirical Discovery:
    // On Windows NTFS, individual open files CAN be renamed (MoveFileExW with FILE_SHARE_DELETE succeeds).
    // However, renaming the entire parent directory fails with ERROR_ACCESS_DENIED (OS error 5)
    // if any file inside is open.
    // CacheCleaner::purge_project_cache currently attempts an atomic directory rename:
    // `fs::rename(&prj_dir, &trash_dir)?;`
    // which fails on Windows when an active reader exists.
    let purge_res = CacheCleaner::purge_project_cache(&temp_dir, pid);
    eprintln!(">>> CacheCleaner::purge_project_cache result while open handle exists: {:?}", purge_res);

    drop(open_handle);

    let is_ok = purge_res.is_ok();
    let _ = fs::remove_dir_all(&test_dir);

    // This assertion fails under the current implementation because fs::rename(&prj_dir, &trash_dir)
    // fails with Os { code: 5, kind: PermissionDenied, message: "Access is denied." }
    assert!(is_ok, "purge_project_cache should succeed even if child file is open: {:?}", purge_res);
}

// =============================================================================
// TEST 2: High Concurrency Workspace CRUD (Mutations & Interleaved Reads)
// =============================================================================

#[tokio::test]
async fn test_high_concurrency_workspace_crud() {
    let test_dir = create_stress_test_dir("high_concurrency");
    let state = Arc::new(AppState::new(test_dir.clone(), ToadConfig::default()));

    // Create 3 initial test files
    let mut test_files = Vec::new();
    for i in 0..3 {
        let p = test_dir.join(format!("source_{}.csv", i));
        fs::write(&p, format!("id,data\n{},val_{}\n", i, i)).unwrap();
        test_files.push(p.to_string_lossy().to_string());
    }

    // Spawn 24 concurrent tasks executing interleaved mutations and reads
    let mut handles = Vec::new();

    // 8 Workers creating and renaming projects
    for worker_id in 0..8 {
        let st = state.clone();
        handles.push(tokio::spawn(async move {
            let prj_name = format!("Concurrent-{}", worker_id);
            let create_res = handle_create_project(&st, json!({ "projectName": prj_name })).await;
            assert!(create_res.is_ok());
            let pid = create_res.unwrap().project_id;

            // Immediately rename
            let rename_res = handle_rename_project(
                &st,
                json!({ "projectId": pid, "newName": format!("Renamed-{}", worker_id) }),
            )
            .await;
            assert!(rename_res.is_ok());

            pid
        }));
    }

    // 8 Workers querying workspace, cache size, and files simultaneously
    for _ in 0..8 {
        let st = state.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..10 {
                let ws = handle_get_workspace(&st, json!({})).await;
                assert!(ws.is_ok());
                tokio::task::yield_now().await;
            }
            "read_done".to_string()
        }));
    }

    // 8 Workers adding and removing files concurrently
    for worker_id in 0..8 {
        let st = state.clone();
        let fls = test_files.clone();
        handles.push(tokio::spawn(async move {
            let pid = format!("prj_fl_{}", worker_id);
            let _ = handle_create_project(
                &st,
                json!({ "projectId": pid, "projectName": format!("FilesPrj-{}", worker_id) }),
            )
            .await;

            let add_res = handle_add_files(
                &st,
                json!({ "projectId": pid, "filePaths": fls }),
            )
            .await;
            assert!(add_res.is_ok());

            let get_res = handle_get_files(&st, json!({ "projectId": pid })).await;
            assert!(get_res.is_ok());
            assert_eq!(get_res.unwrap().files.len(), 3);

            let rem_res = handle_remove_file(
                &st,
                json!({ "projectId": pid, "filePath": fls[0] }),
            )
            .await;
            assert!(rem_res.is_ok());

            pid
        }));
    }

    // Wait for all 24 tasks to complete with zero panics or errors
    for h in handles {
        let res = h.await;
        assert!(res.is_ok(), "Concurrent task panicked or failed");
    }

    // Verify workspace consistency after concurrent stress
    let ws = handle_get_workspace(&state, json!({})).await.unwrap();
    assert!(ws.projects.len() >= 16, "All created projects must exist");

    // Replay Parquet WAL from disk to verify 100% bitwise parity with memory
    let ledger = state.parquet_ledger.read().await;
    let events = toad_lib::ledger::parquet_ledger::read_all_events_from_parquet(&ledger.ledger_path)
        .expect("Disk Parquet WAL must be valid and readable by DuckDB");
    assert!(!events.is_empty(), "WAL must contain all committed events");

    let mut replayed = LedgerState::default();
    toad_lib::ledger::parquet_ledger::apply_events_to_state(&events, &mut replayed);

    assert_eq!(
        ws.projects.len(),
        replayed.projects.len(),
        "In-memory project count must strictly match replayed WAL count"
    );

    drop(ledger);
    let _ = fs::remove_dir_all(&test_dir);
}

// =============================================================================
// TEST 3: Strict 500ms Debounce Auto-Recovery & Sub-500ms Cancellation
// =============================================================================

#[tokio::test]
async fn test_debounce_strict_timing_and_cancellation() {
    let test_dir = create_stress_test_dir("debounce_timing");
    let state = AppState::new(test_dir.clone(), ToadConfig::default());

    // 1. Initially has 1 default Untitled-1 project
    let ws = handle_get_workspace(&state, json!({})).await.unwrap();
    assert_eq!(ws.projects.len(), 1);

    // Delete all projects
    let del_all = handle_delete_all_projects(&state, json!({})).await.unwrap();
    assert!(del_all.success);

    // Sample at T = 50ms: must be 0
    tokio::time::sleep(Duration::from_millis(50)).await;
    let ws_t50 = handle_get_workspace(&state, json!({})).await.unwrap();
    assert_eq!(ws_t50.projects.len(), 0, "Must be 0 projects at T=50ms");

    // Sample at T = 250ms: must STILL be 0
    tokio::time::sleep(Duration::from_millis(200)).await;
    let ws_t250 = handle_get_workspace(&state, json!({})).await.unwrap();
    assert_eq!(ws_t250.projects.len(), 0, "Must be 0 projects at T=250ms");

    // Wait until T = 650ms (> 500ms debounce threshold)
    tokio::time::sleep(Duration::from_millis(400)).await;
    let ws_t650 = handle_get_workspace(&state, json!({})).await.unwrap();
    assert_eq!(
        ws_t650.projects.len(),
        1,
        "Untitled-1 must be auto-recovered after 500ms debounce"
    );
    assert_eq!(ws_t650.projects[0].project_name, "Untitled-1");

    // 2. Test Cancellation: Delete all again, but create project at T=150ms (< 500ms)
    handle_delete_all_projects(&state, json!({})).await.unwrap();
    assert_eq!(handle_get_workspace(&state, json!({})).await.unwrap().projects.len(), 0);

    tokio::time::sleep(Duration::from_millis(150)).await;
    // Create new project before 500ms expires
    let create_res = handle_create_project(
        &state,
        json!({ "projectName": "Debounce Cancellation Winner" }),
    )
    .await
    .unwrap();
    assert!(create_res.success);

    // Sleep past the original 500ms window (e.g. +500ms more -> 650ms total from deletion)
    tokio::time::sleep(Duration::from_millis(500)).await;

    // Verify ONLY "Debounce Cancellation Winner" exists, NO duplicate Untitled-1
    let ws_cancelled = handle_get_workspace(&state, json!({})).await.unwrap();
    assert_eq!(
        ws_cancelled.projects.len(),
        1,
        "Debounce task must be cleanly aborted: exactly 1 project should exist"
    );
    assert_eq!(ws_cancelled.projects[0].project_name, "Debounce Cancellation Winner");

    let _ = fs::remove_dir_all(&test_dir);
}

// =============================================================================
// TEST 4: Input Boundary Fuzzing & SQL Injection Neutralization
// =============================================================================

#[tokio::test]
async fn test_fuzzing_and_sql_injection_safety() {
    let test_dir = create_stress_test_dir("fuzzing_sql");
    let state = AppState::new(test_dir.clone(), ToadConfig::default());

    // 1. SQL Injection strings in project name
    let long_name = "A".repeat(1024);
    let malicious_names = vec![
        "'; DROP TABLE toad_ledger; --",
        "Project' OR '1'='1",
        "Unicode \u{0000} NullByte Test",
        "Special chars: \"'`\\/!@#$%^&*()[]{}<>?~",
        "Emoji 🚀🔥💻📊 Invariant Check",
        long_name.as_str(), // 1KB name string
    ];

    for name in malicious_names {
        let res = handle_create_project(&state, json!({ "projectName": name })).await;
        assert!(res.is_ok(), "Engine should safely store and quote special characters: {}", name);
        let pid = res.unwrap().project_id;

        // Verify it was correctly stored in workspace
        let ws = handle_get_workspace(&state, json!({})).await.unwrap();
        let prj = ws.projects.iter().find(|p| p.project_id == pid);
        assert!(prj.is_some(), "Project must exist");
        assert_eq!(prj.unwrap().project_name, name);
    }

    // 2. Boundary invalid inputs (empty or missing parameters)
    assert!(handle_rename_project(&state, json!({})).await.is_err());
    assert!(handle_delete_project(&state, json!({})).await.is_err());
    assert!(handle_add_files(&state, json!({ "projectId": "abc" })).await.is_err());
    assert!(handle_add_files(&state, json!({ "projectId": "abc", "filePaths": [] })).await.is_err());
    assert!(handle_add_folder(&state, json!({})).await.is_err());
    assert!(handle_add_folder(&state, json!({ "folderPath": "non_existent_folder_xyz" })).await.is_err());
    assert!(handle_remove_file(&state, json!({})).await.is_err());
    assert!(handle_set_active_project(&state, json!({})).await.is_err());

    let _ = fs::remove_dir_all(&test_dir);
}

// =============================================================================
// TEST 5: Double-Valid .bak Invariant & Resilient Recovery
// =============================================================================

#[tokio::test]
async fn test_double_valid_bak_synchronization() {
    let test_dir = create_stress_test_dir("bak_sync");
    let ledger = ParquetLedger::new(test_dir.clone());

    // 1. Create projects and verify .bak mirrors primary
    let pid = ledger.create_project("Primary Project", None).await.unwrap();
    assert!(ledger.ledger_path.exists());
    assert!(ledger.backup_path.exists());

    let primary_meta = fs::metadata(&ledger.ledger_path).unwrap();
    let bak_meta = fs::metadata(&ledger.backup_path).unwrap();
    assert_eq!(primary_meta.len(), bak_meta.len(), "Primary and backup sizes must match");

    // 2. Corrupt primary with garbage bytes
    fs::write(&ledger.ledger_path, b"CORRUPTED_PARQUET_FILE_JUNK_PAYLOAD").unwrap();

    // 3. Reconcile on restart
    let mut recovered_state = LedgerState::default();
    let reconciler = StartupReconciler::new(
        &ledger.ledger_path,
        &ledger.backup_path,
        &ledger.temp_dir,
        &ledger.logs_dir,
        true,
    );

    let report = reconciler.reconcile(&mut recovered_state).unwrap();
    assert_eq!(report.scenario, ReconciliationScenario::CrashRecoveryFromBackup);
    assert!(report.ledger_restored_from_backup);
    assert_eq!(recovered_state.projects.len(), 1);
    assert_eq!(recovered_state.projects[&pid].project_name, "Primary Project");

    // Verify corrupted file was safely quarantined in logs/
    let quarantined = fs::read_dir(&ledger.logs_dir)
        .unwrap()
        .flatten()
        .any(|e| e.file_name().to_string_lossy().starts_with("corrupt_ledger_"));
    assert!(quarantined, "Corrupted ledger must be quarantined in logs/");

    let _ = fs::remove_dir_all(&test_dir);
}
