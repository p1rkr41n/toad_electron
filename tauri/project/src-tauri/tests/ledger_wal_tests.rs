//! ledger_wal_tests.rs
//!
//! Comprehensive Unit & Integration Tests for Parquet State Ledger WAL (Milestone M4 / F13, F14)
//! - Test WAL append and state recovery
//! - Test typed NULL tombstones and schema preservation
//! - Test zero-cost project rename
//! - Test 500ms debounce auto-recovery creating Untitled-1
//! - Test concurrent WAL appends without race conditions or data loss

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use toad_lib::ledger::{generate_project_id, LedgerState, ParquetLedger};

fn create_test_dir(test_name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("toad_wal_test_{}_{}", test_name, generate_project_id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("Failed to create test dir");
    dir
}

#[tokio::test]
async fn test_wal_append_and_recovery() {
    let test_dir = create_test_dir("append_recovery");
    let ledger = ParquetLedger::new(test_dir.clone());

    // 1. Create a project
    let pid = ledger.create_project("Project Alpha", None).await.unwrap();
    assert_eq!(pid.len(), 5);

    // 2. Add files
    let dummy_file1 = test_dir.join("access.log");
    fs::write(&dummy_file1, "dummy log content for testing").unwrap();

    let dummy_file2 = test_dir.join("system.evtx");
    fs::write(&dummy_file2, "dummy evtx content").unwrap();

    let added = ledger
        .add_files_to_project(
            &pid,
            vec![
                dummy_file1.to_string_lossy().to_string(),
                dummy_file2.to_string_lossy().to_string(),
            ],
        )
        .await
        .unwrap();

    assert_eq!(added.len(), 2);

    // 3. Verify in-memory state
    let (active_id, projects) = ledger.get_workspace().await;
    assert_eq!(active_id, pid);
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].project_name, "Project Alpha");
    assert_eq!(projects[0].file_count, 2);

    // 4. Simulate application restart: instantiate a new manager on the same directory
    let restarted_ledger = ParquetLedger::new(test_dir.clone());
    let mut state = LedgerState::default();
    let reconciler = toad_lib::ledger::StartupReconciler::new(
        &restarted_ledger.ledger_path,
        &restarted_ledger.backup_path,
        &restarted_ledger.temp_dir,
        &restarted_ledger.logs_dir,
        true,
    );
    let report = reconciler.reconcile(&mut state).unwrap();
    assert_eq!(report.active_projects, 1);
    assert_eq!(report.active_files, 2);

    let prj = state.projects.get(&pid).unwrap();
    assert_eq!(prj.project_name, "Project Alpha");
    assert_eq!(state.files.len(), 2);

    let _ = fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_tombstone_typed_null_schema_invariance() {
    let test_dir = create_test_dir("tombstone_schema");
    let ledger = ParquetLedger::new(test_dir.clone());

    let pid = ledger.create_project("Tombstone Project", None).await.unwrap();
    let dummy_file = test_dir.join("data.csv");
    fs::write(&dummy_file, "col1,col2\n1,2\n").unwrap();

    let _ = ledger
        .add_files_to_project(&pid, vec![dummy_file.to_string_lossy().to_string()])
        .await
        .unwrap();

    // Delete file (writes FILE_DELETED tombstone with typed NULLs)
    let freed = ledger
        .remove_file_from_project(&pid, &dummy_file.to_string_lossy().to_string())
        .await
        .unwrap();
    assert!(freed > 0);

    // Delete project (writes PROJECT_DELETED tombstone with typed NULLs)
    let (deleted_files, _) = ledger.delete_project(&pid).await.unwrap();
    assert_eq!(deleted_files, 0); // File was already deleted

    // Verify Parquet schema remains fully typed and intact by appending a new project
    let pid2 = ledger.create_project("Project Beta", None).await.unwrap();
    assert_eq!(pid2.len(), 5);

    // Replay all events from disk to verify schema did not decay or corrupt
    let events = toad_lib::ledger::parquet_ledger::read_all_events_from_parquet(
        &ledger.ledger_path,
    )
    .unwrap();
    assert!(events.len() >= 4);

    let mut replayed_state = LedgerState::default();
    toad_lib::ledger::parquet_ledger::apply_events_to_state(&events, &mut replayed_state);

    // Project 1 should be completely isolated (tombstoned)
    assert!(!replayed_state.projects.contains_key(&pid));
    // Project 2 should be active
    assert!(replayed_state.projects.contains_key(&pid2));
    assert_eq!(replayed_state.projects[&pid2].project_name, "Project Beta");

    let _ = fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_zero_cost_project_rename() {
    let test_dir = create_test_dir("zero_cost_rename");
    let ledger = ParquetLedger::new(test_dir.clone());

    let pid = ledger.create_project("Original Name", None).await.unwrap();
    let prj_dir = test_dir.join("temp").join(&pid);
    assert!(prj_dir.exists(), "temp partition should exist");

    // Rename project
    let success = ledger.rename_project(&pid, "Renamed Name").await.unwrap();
    assert!(success);

    // Verify metadata updated in memory
    let (_, projects) = ledger.get_workspace().await;
    assert_eq!(projects[0].project_name, "Renamed Name");

    // Verify physical directory path did NOT move or change
    assert!(prj_dir.exists(), "Physical temp partition must remain in place");

    // Verify restart retains new name
    let events = toad_lib::ledger::parquet_ledger::read_all_events_from_parquet(
        &ledger.ledger_path,
    )
    .unwrap();
    let mut state = LedgerState::default();
    toad_lib::ledger::parquet_ledger::apply_events_to_state(&events, &mut state);
    assert_eq!(state.projects[&pid].project_name, "Renamed Name");

    let _ = fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_500ms_debounce_untitled_recovery() {
    let test_dir = create_test_dir("debounce_recovery");
    let ledger = ParquetLedger::new(test_dir.clone());

    let pid = ledger.create_project("Temporary", None).await.unwrap();
    assert_eq!(ledger.get_workspace().await.1.len(), 1);

    // Delete the project, reducing active projects to 0
    let _ = ledger.delete_project(&pid).await.unwrap();
    assert_eq!(ledger.get_workspace().await.1.len(), 0);

    // Wait 550ms for the debounce timer to trigger
    tokio::time::sleep(Duration::from_millis(600)).await;

    // Verify Untitled-1 was automatically created
    let (_, projects) = ledger.get_workspace().await;
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].project_name, "Untitled-1");

    let _ = fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_debounce_cancelled_when_project_created() {
    let test_dir = create_test_dir("debounce_cancelled");
    let ledger = ParquetLedger::new(test_dir.clone());

    let pid = ledger.create_project("Temporary", None).await.unwrap();
    let _ = ledger.delete_project(&pid).await.unwrap();
    assert_eq!(ledger.get_workspace().await.1.len(), 0);

    // User creates a project before the 500ms timer expires (at 100ms)
    tokio::time::sleep(Duration::from_millis(100)).await;
    let new_pid = ledger
        .create_project("User Created", None)
        .await
        .unwrap();

    // Wait beyond the original 500ms window
    tokio::time::sleep(Duration::from_millis(500)).await;

    // Verify ONLY the user created project exists, no duplicate Untitled-1
    let (_, projects) = ledger.get_workspace().await;
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].project_id, new_pid);
    assert_eq!(projects[0].project_name, "User Created");

    let _ = fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_concurrent_wal_writes() {
    let test_dir = create_test_dir("concurrent_wal");
    let ledger = Arc::new(ParquetLedger::new(test_dir.clone()));

    // Spawn 10 concurrent tasks creating projects
    let mut handles = Vec::new();
    for i in 0..10 {
        let l = ledger.clone();
        handles.push(tokio::spawn(async move {
            l.create_project(&format!("Project-{}", i), None)
                .await
                .unwrap()
        }));
    }

    let mut project_ids = Vec::new();
    for h in handles {
        let pid = h.await.unwrap();
        project_ids.push(pid);
    }

    assert_eq!(project_ids.len(), 10);
    let (_, projects) = ledger.get_workspace().await;
    assert_eq!(projects.len(), 10);

    // Replay from disk WAL to verify all 10 were committed without corruption
    let events = toad_lib::ledger::parquet_ledger::read_all_events_from_parquet(
        &ledger.ledger_path,
    )
    .unwrap();
    assert_eq!(events.len(), 10);

    let _ = fs::remove_dir_all(&test_dir);
}
