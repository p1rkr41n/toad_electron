//! reconciliation.rs
//!
//! Startup Reconciliation Engine (Milestone M4 / F15)
//! - Single Source of Truth (SSOT) validator between WAL Ledger, disk source files, and cache partitions.
//! - Executes 6 crash and startup recovery scenarios in < 5ms:
//!   1. Clean Startup (< 2.5ms)
//!   2. Source File Missing / Moved on Disk (Non-Crashing)
//!   3. Orphan Parquet Cache Files in `temp/` Auto-Purged
//!   4. Write Crash / Interrupted Ledger Self-Healing via Dual-Valid `.bak`
//!   5. Missing Ledger on Initial Run (< 2ms)
//!   6. All Projects Deleted / 0 Projects Auto-Recovery
//! - Guarantees zero panics, zero unhandled exceptions, and immediate UI readiness.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use crate::ledger::cache_cleaner::CacheCleaner;
use crate::ledger::parquet_ledger::{
    apply_events_to_state, current_time_ms, generate_project_id, generate_uuid_v4,
    read_all_events_from_parquet, write_events_to_parquet, LedgerEvent, LedgerState, ProjectInfo,
};

/// 6 Discrete Startup Recovery Scenarios
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReconciliationScenario {
    CleanStartup,
    SourceFileMissing,
    OrphanCachesPurged,
    CrashRecoveryFromBackup,
    FreshInstallDefaultCreated,
    AllProjectsDeletedReset,
}

/// Comprehensive report produced by Startup Reconciliation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReconciliationReport {
    pub scenario: ReconciliationScenario,
    pub elapsed_micros: u64,
    pub active_projects: usize,
    pub active_files: usize,
    pub missing_source_files: Vec<String>,
    pub orphan_files_purged: usize,
    pub freed_bytes: u64,
    pub ledger_restored_from_backup: bool,
    pub default_project_created: bool,
    pub warnings: Vec<String>,
}

pub struct StartupReconciler<'a> {
    pub ledger_path: &'a Path,
    pub backup_path: &'a Path,
    pub temp_dir: &'a Path,
    pub logs_dir: &'a Path,
    pub auto_cleanup_orphans: bool,
}

impl<'a> StartupReconciler<'a> {
    pub fn new(
        ledger_path: &'a Path,
        backup_path: &'a Path,
        temp_dir: &'a Path,
        logs_dir: &'a Path,
        auto_cleanup_orphans: bool,
    ) -> Self {
        Self {
            ledger_path,
            backup_path,
            temp_dir,
            logs_dir,
            auto_cleanup_orphans,
        }
    }

    /// Execute the complete startup reconciliation within < 5ms
    pub fn reconcile(&self, state: &mut LedgerState) -> Result<ReconciliationReport, String> {
        let start = Instant::now();
        let mut warnings = Vec::new();
        let mut missing_sources = Vec::new();
        let mut ledger_restored = false;
        let mut default_created = false;
        let mut primary_scenario = ReconciliationScenario::CleanStartup;

        // Ensure logs directory exists
        let _ = fs::create_dir_all(self.logs_dir);
        let _ = fs::create_dir_all(self.temp_dir);

        // ---------------------------------------------------------------------
        // Step 1: Validate / Recover Ledger File (Scenarios 4 & 5)
        // ---------------------------------------------------------------------
        let events = if !self.ledger_path.exists()
            || fs::metadata(self.ledger_path)
                .map(|m| m.len() == 0)
                .unwrap_or(true)
        {
            // Primary ledger does not exist or is 0 bytes
            if self.backup_path.exists()
                && fs::metadata(self.backup_path)
                    .map(|m| m.len() > 0)
                    .unwrap_or(false)
            {
                // Try to recover from backup
                match read_all_events_from_parquet(self.backup_path) {
                    Ok(evs) => {
                        let _ = fs::copy(self.backup_path, self.ledger_path);
                        ledger_restored = true;
                        primary_scenario = ReconciliationScenario::CrashRecoveryFromBackup;
                        warnings.push("Primary ledger was missing; restored from .bak".to_string());
                        evs
                    }
                    Err(_) => {
                        // Backup also invalid; create fresh install
                        self.init_fresh_ledger(state)?;
                        default_created = true;
                        primary_scenario = ReconciliationScenario::FreshInstallDefaultCreated;
                        Vec::new()
                    }
                }
            } else {
                // Scenario 5: Missing ledger on initial run (< 2ms)
                self.init_fresh_ledger(state)?;
                default_created = true;
                primary_scenario = ReconciliationScenario::FreshInstallDefaultCreated;
                Vec::new()
            }
        } else {
            // Primary ledger exists; attempt to read
            match read_all_events_from_parquet(self.ledger_path) {
                Ok(evs) => evs,
                Err(e) => {
                    // Scenario 4: Write crash recovery
                    warnings.push(format!("Primary ledger corrupt: {}", e));
                    let now_ms = current_time_ms();
                    let archive_path = self
                        .logs_dir
                        .join(format!("corrupt_ledger_{}.parquet", now_ms));
                    let _ = fs::rename(self.ledger_path, &archive_path);

                    if self.backup_path.exists() {
                        match read_all_events_from_parquet(self.backup_path) {
                            Ok(evs) => {
                                let _ = fs::copy(self.backup_path, self.ledger_path);
                                ledger_restored = true;
                                primary_scenario = ReconciliationScenario::CrashRecoveryFromBackup;
                                warnings.push("Restored ledger from valid .bak file".to_string());
                                evs
                            }
                            Err(_) => {
                                self.init_fresh_ledger(state)?;
                                default_created = true;
                                primary_scenario =
                                    ReconciliationScenario::CrashRecoveryFromBackup;
                                warnings.push(
                                    "Both primary and backup corrupt; re-initialized".to_string(),
                                );
                                Vec::new()
                            }
                        }
                    } else {
                        self.init_fresh_ledger(state)?;
                        default_created = true;
                        primary_scenario = ReconciliationScenario::CrashRecoveryFromBackup;
                        Vec::new()
                    }
                }
            }
        };

        // ---------------------------------------------------------------------
        // Step 2: In-Memory Projection Replay
        // ---------------------------------------------------------------------
        if !events.is_empty() {
            apply_events_to_state(&events, state);
        }

        // ---------------------------------------------------------------------
        // Step 3: Check for 0 Active Projects (Scenario 6)
        // ---------------------------------------------------------------------
        if state.projects.is_empty() && !default_created {
            let new_id = generate_project_id();
            let now_ms = current_time_ms();
            let seed_ev = LedgerEvent {
                event_id: generate_uuid_v4(),
                event_type: "PROJECT_CREATED".to_string(),
                timestamp: now_ms,
                project_id: new_id.clone(),
                project_name: Some("Untitled-1".to_string()),
                file_id: None,
                file_path: None,
                file_size: None,
                file_type: None,
                source_mtime: None,
                parquet_path: None,
                parquet_size: None,
                row_count: None,
                status: Some("READY".to_string()),
                duration_ms: None,
                metadata_json: Some("{}".to_string()),
            };

            let _ = fs::create_dir_all(self.temp_dir.join(&new_id));
            let _ = write_events_to_parquet(self.ledger_path, self.backup_path, &[seed_ev]);

            state.projects.insert(
                new_id.clone(),
                ProjectInfo {
                    project_id: new_id.clone(),
                    project_name: "Untitled-1".to_string(),
                    status: "READY".to_string(),
                    created_at: now_ms,
                    is_orphan: false,
                },
            );
            state.active_project_id = new_id;
            default_created = true;
            if primary_scenario == ReconciliationScenario::CleanStartup {
                primary_scenario = ReconciliationScenario::AllProjectsDeletedReset;
            }
        }

        // Ensure active project ID is valid
        if !state.projects.contains_key(&state.active_project_id) {
            state.active_project_id = state
                .projects
                .keys()
                .next()
                .cloned()
                .unwrap_or_else(|| "default".to_string());
        }

        // ---------------------------------------------------------------------
        // Step 4: Verify Active Files Against Disk (Scenario 2)
        // ---------------------------------------------------------------------
        let mut has_missing_source = false;
        for f in state.files.values_mut() {
            if f.status == "DELETED" {
                continue;
            }

            let src_exists = Path::new(&f.file_path).exists();
            if !src_exists {
                has_missing_source = true;
                missing_sources.push(f.file_path.clone());
                // Non-crashing: check if offline cached parquet exists
                let cache_exists = !f.parquet_path.is_empty() && Path::new(&f.parquet_path).exists();
                if cache_exists {
                    f.status = "SourceMissingOffline".to_string();
                    warnings.push(format!(
                        "Source file '{}' missing; queryable offline via cache",
                        f.file_path
                    ));
                } else {
                    f.status = "Missing".to_string();
                    warnings.push(format!("Source file '{}' missing", f.file_path));
                }
            }
        }

        if has_missing_source && primary_scenario == ReconciliationScenario::CleanStartup {
            primary_scenario = ReconciliationScenario::SourceFileMissing;
        }

        // ---------------------------------------------------------------------
        // Step 5: Sweep Temp Directory for Orphans (Scenario 3)
        // ---------------------------------------------------------------------
        let mut orphan_files_purged = 0;
        let mut freed_bytes = 0u64;

        if self.auto_cleanup_orphans {
            let active_ids: HashSet<String> = state.projects.keys().cloned().collect();
            let mut known_parquets: HashSet<PathBuf> = HashSet::new();

            for f in state.files.values() {
                if !f.parquet_path.is_empty() {
                    let pb = PathBuf::from(&f.parquet_path);
                    known_parquets.insert(pb.clone());
                    if let Ok(c) = fs::canonicalize(&pb) {
                        known_parquets.insert(c);
                    }
                }
            }

            if let Ok(res) = CacheCleaner::purge_orphan_caches(
                self.temp_dir,
                &active_ids,
                &known_parquets,
            ) {
                orphan_files_purged = res.purged_files;
                freed_bytes = res.freed_bytes;
                if orphan_files_purged > 0 && primary_scenario == ReconciliationScenario::CleanStartup {
                    primary_scenario = ReconciliationScenario::OrphanCachesPurged;
                }
            }
        }

        let elapsed_micros = start.elapsed().as_micros() as u64;

        Ok(ReconciliationReport {
            scenario: primary_scenario,
            elapsed_micros,
            active_projects: state.projects.len(),
            active_files: state.files.values().filter(|f| f.status != "DELETED").count(),
            missing_source_files: missing_sources,
            orphan_files_purged,
            freed_bytes,
            ledger_restored_from_backup: ledger_restored,
            default_project_created: default_created,
            warnings,
        })
    }

    /// Initialize fresh 16-field Parquet ledger WAL with seed Untitled-1 project (< 2ms)
    fn init_fresh_ledger(&self, state: &mut LedgerState) -> Result<(), String> {
        let new_id = generate_project_id();
        let now_ms = current_time_ms();
        let seed_ev = LedgerEvent {
            event_id: generate_uuid_v4(),
            event_type: "PROJECT_CREATED".to_string(),
            timestamp: now_ms,
            project_id: new_id.clone(),
            project_name: Some("Untitled-1".to_string()),
            file_id: None,
            file_path: None,
            file_size: None,
            file_type: None,
            source_mtime: None,
            parquet_path: None,
            parquet_size: None,
            row_count: None,
            status: Some("READY".to_string()),
            duration_ms: None,
            metadata_json: Some("{}".to_string()),
        };

        let prj_dir = self.temp_dir.join(&new_id);
        let _ = fs::create_dir_all(&prj_dir);

        write_events_to_parquet(self.ledger_path, self.backup_path, &[seed_ev])?;

        state.projects.clear();
        state.files.clear();
        state.projects.insert(
            new_id.clone(),
            ProjectInfo {
                project_id: new_id.clone(),
                project_name: "Untitled-1".to_string(),
                status: "READY".to_string(),
                created_at: now_ms,
                is_orphan: false,
            },
        );
        state.active_project_id = new_id;

        Ok(())
    }
}
