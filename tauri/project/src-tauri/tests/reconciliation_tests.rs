//! reconciliation_tests.rs
//!
//! Automated Test Suite for 6-Scenario Startup Reconciliation & Cascade Cache Cleaner (Milestone M4 / F15, F16)

use std::fs;
use std::path::PathBuf;
use std::time::Instant;

use toad_lib::ledger::{
    generate_project_id, CacheCleaner, LedgerState, ParquetLedger, ReconciliationScenario,
    StartupReconciler,
};

fn create_reconcile_test_dir(test_name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("toad_reconcile_{}_{}", test_name, generate_project_id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("Failed to create test dir");
    dir
}

#[tokio::test]
async fn test_scenario_1_clean_startup_latency() {
    let test_dir = create_reconcile_test_dir("scenario_1");
    let ledger = ParquetLedger::new(test_dir.clone());

    // Setup 3 projects with intact files
    for i in 1..=3 {
        let pid = ledger
            .create_project(&format!("Project-{}", i), None)
            .await
            .unwrap();
        let dummy_file = test_dir.join(format!("data_{}.csv", i));
        fs::write(&dummy_file, "id,val\n1,a\n2,b\n").unwrap();
        ledger
            .add_files_to_project(&pid, vec![dummy_file.to_string_lossy().to_string()])
            .await
            .unwrap();
    }

    // Measure cold reconciliation execution time
    let mut state = LedgerState::default();
    let reconciler = StartupReconciler::new(
        &ledger.ledger_path,
        &ledger.backup_path,
        &ledger.temp_dir,
        &ledger.logs_dir,
        true,
    );

    let start = Instant::now();
    let report = reconciler.reconcile(&mut state).unwrap();
    let elapsed = start.elapsed();

    // Verification
    assert_eq!(report.scenario, ReconciliationScenario::CleanStartup);
    assert_eq!(report.active_projects, 3);
    assert_eq!(report.active_files, 3);
    assert!(report.missing_source_files.is_empty());
    // Strict requirement: must execute quickly (< 200ms in unoptimized debug build)
    assert!(
        elapsed.as_millis() < 200,
        "Clean startup reconciliation must execute in < 200ms (was {:?})",
        elapsed
    );

    let _ = fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_scenario_2_missing_source_file_non_crashing() {
    let test_dir = create_reconcile_test_dir("scenario_2");
    let ledger = ParquetLedger::new(test_dir.clone());

    let pid = ledger.create_project("Offline Test", None).await.unwrap();
    let dummy_source = test_dir.join("disposable.csv");
    fs::write(&dummy_source, "col1\nval1\n").unwrap();

    let added = ledger
        .add_files_to_project(&pid, vec![dummy_source.to_string_lossy().to_string()])
        .await
        .unwrap();

    // Now delete source file on disk while keeping cached parquet at its registered path
    let target_cache = PathBuf::from(&added[0].parquet_path);
    if let Some(parent) = target_cache.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(&target_cache, b"fake parquet data").unwrap();
    fs::remove_file(&dummy_source).unwrap();

    // Execute reconciliation
    let mut state = LedgerState::default();
    let reconciler = StartupReconciler::new(
        &ledger.ledger_path,
        &ledger.backup_path,
        &ledger.temp_dir,
        &ledger.logs_dir,
        true,
    );

    let report = reconciler.reconcile(&mut state).unwrap();

    // Verification
    assert_eq!(report.scenario, ReconciliationScenario::SourceFileMissing);
    assert_eq!(report.missing_source_files.len(), 1);
    assert_eq!(report.active_projects, 1);

    // Verify file is marked offline cache preserved without crashing
    let file = state.files.values().next().unwrap();
    assert_eq!(file.status, "SourceMissingOffline");

    let _ = fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_scenario_3_orphan_temp_cache_purge() {
    let test_dir = create_reconcile_test_dir("scenario_3");
    let ledger = ParquetLedger::new(test_dir.clone());

    let pid = ledger.create_project("Active Project", None).await.unwrap();
    let dummy_source = test_dir.join("active.csv");
    fs::write(&dummy_source, "a,b\n1,2\n").unwrap();
    ledger
        .add_files_to_project(&pid, vec![dummy_source.to_string_lossy().to_string()])
        .await
        .unwrap();

    let temp_dir = test_dir.join("temp");

    // 1. Create orphan project directory
    let orphan_dir = temp_dir.join("orphan_xyz");
    fs::create_dir_all(&orphan_dir).unwrap();
    fs::write(orphan_dir.join("junk.parquet"), b"junk").unwrap();

    // 2. Create orphan cache inside active project directory
    let orphan_cache = temp_dir.join(&pid).join("orphan_unrecorded.parquet");
    fs::write(&orphan_cache, b"orphan cache").unwrap();

    // 3. Create lingering .trash_* directory
    let trash_dir = temp_dir.join(".trash_old_12345");
    fs::create_dir_all(&trash_dir).unwrap();
    fs::write(trash_dir.join("discarded.parquet"), b"old").unwrap();

    // Execute reconciliation with auto_cleanup_orphans = true
    let mut state = LedgerState::default();
    let reconciler = StartupReconciler::new(
        &ledger.ledger_path,
        &ledger.backup_path,
        &ledger.temp_dir,
        &ledger.logs_dir,
        true,
    );

    let report = reconciler.reconcile(&mut state).unwrap();

    assert_eq!(report.scenario, ReconciliationScenario::OrphanCachesPurged);
    assert!(report.orphan_files_purged >= 1);

    // Verify orphan cache was purged
    assert!(!orphan_cache.exists(), "Orphan cache must be purged");

    let _ = fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_scenario_4_corrupt_ledger_backup_recovery() {
    let test_dir = create_reconcile_test_dir("scenario_4");
    let ledger = ParquetLedger::new(test_dir.clone());

    // Create project and commit to primary and backup
    let pid = ledger.create_project("Resilient Project", None).await.unwrap();

    // Now corrupt primary ledger with junk bytes
    fs::write(&ledger.ledger_path, b"CORRUPTED_PARQUET_HEADER_JUNK").unwrap();

    // Verify backup exists
    assert!(ledger.backup_path.exists(), "Backup .bak must exist");

    // Reconcile
    let mut state = LedgerState::default();
    let reconciler = StartupReconciler::new(
        &ledger.ledger_path,
        &ledger.backup_path,
        &ledger.temp_dir,
        &ledger.logs_dir,
        true,
    );

    let report = reconciler.reconcile(&mut state).unwrap();

    // Verification
    assert_eq!(report.scenario, ReconciliationScenario::CrashRecoveryFromBackup);
    assert!(report.ledger_restored_from_backup);
    assert_eq!(report.active_projects, 1);
    assert_eq!(state.projects[&pid].project_name, "Resilient Project");

    // Verify corrupted primary was archived to logs
    let logs_entries = fs::read_dir(&ledger.logs_dir).unwrap();
    let found_archive = logs_entries
        .flatten()
        .any(|e| e.file_name().to_string_lossy().starts_with("corrupt_ledger_"));
    assert!(found_archive, "Corrupt file should be archived in logs");

    let _ = fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_scenario_5_fresh_install_initialization() {
    let test_dir = create_reconcile_test_dir("scenario_5");
    let ledger_path = test_dir.join("toad_ledger.parquet");
    let backup_path = test_dir.join("toad_ledger.parquet.bak");
    let temp_dir = test_dir.join("temp");
    let logs_dir = test_dir.join("logs");

    assert!(!ledger_path.exists());
    assert!(!backup_path.exists());

    let mut state = LedgerState::default();
    let reconciler = StartupReconciler::new(
        &ledger_path,
        &backup_path,
        &temp_dir,
        &logs_dir,
        true,
    );

    let start = Instant::now();
    let report = reconciler.reconcile(&mut state).unwrap();
    let elapsed = start.elapsed();

    // Verification
    assert_eq!(report.scenario, ReconciliationScenario::FreshInstallDefaultCreated);
    assert!(report.default_project_created);
    assert_eq!(report.active_projects, 1);
    assert_eq!(state.projects.values().next().unwrap().project_name, "Untitled-1");
    assert!(ledger_path.exists(), "toad_ledger.parquet must be created");
    assert!(backup_path.exists(), "toad_ledger.parquet.bak must be created");

    // Fast init target (< 300ms in unoptimized debug build)
    assert!(
        elapsed.as_millis() < 300,
        "Fresh install init should be instantaneous (< 300ms, was {:?})",
        elapsed
    );

    let _ = fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_scenario_6_all_projects_deleted_startup() {
    let test_dir = create_reconcile_test_dir("scenario_6");
    let ledger = ParquetLedger::new(test_dir.clone());

    let pid = ledger.create_project("To Be Deleted", None).await.unwrap();
    ledger.delete_project(&pid).await.unwrap();

    // Startup reconciliation on a ledger where all projects were deleted
    let mut state = LedgerState::default();
    let reconciler = StartupReconciler::new(
        &ledger.ledger_path,
        &ledger.backup_path,
        &ledger.temp_dir,
        &ledger.logs_dir,
        true,
    );

    let report = reconciler.reconcile(&mut state).unwrap();

    assert_eq!(report.scenario, ReconciliationScenario::AllProjectsDeletedReset);
    assert!(report.default_project_created);
    assert_eq!(state.projects.len(), 1);
    assert_eq!(state.projects.values().next().unwrap().project_name, "Untitled-1");

    let _ = fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_cascade_cache_cleaner_windows_ebusy() {
    let test_dir = create_reconcile_test_dir("ebusy_test");
    let temp_dir = test_dir.join("temp");
    fs::create_dir_all(&temp_dir).unwrap();

    let pid = "tst99";
    let prj_dir = temp_dir.join(pid);
    fs::create_dir_all(&prj_dir).unwrap();
    let sample_file = prj_dir.join("cached_table.parquet");
    fs::write(&sample_file, b"sample cached parquet data").unwrap();

    // 1. Execute atomic directory rename purge: temp/tst99 is moved away immediately
    let purge_res = CacheCleaner::purge_project_cache(&temp_dir, pid).unwrap();
    assert_eq!(purge_res.purged_directories, 1);
    assert!(!prj_dir.exists(), "Active directory must be renamed away instantly");

    // 2. Allow background delete task with retry backoff to complete
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    // Verify all .trash_* directories in temp are cleaned up
    let remaining_trash = fs::read_dir(&temp_dir)
        .unwrap()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with(".trash_"))
        .count();
    assert_eq!(remaining_trash, 0, "Trash directory should be asynchronously cleaned up");

    let _ = fs::remove_dir_all(&test_dir);
}
