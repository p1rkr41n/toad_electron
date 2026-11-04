//! ledger/mod.rs
//!
//! Parquet State Ledger WAL, Cascade Cache Cleaner & Workspace Engine (Milestone M4)
//! - F13: Double-Valid Parquet State Ledger WAL
//! - F14: Tombstones & Zombie Isolation
//! - F15: Startup Reconciliation Engine
//! - F16: Cascade Cache Cleaner & Windows EBUSY Handler
//! - F17: Workspace CRUD & In-Place Rename

pub mod cache_cleaner;
pub mod parquet_ledger;
pub mod reconciliation;
pub mod tombstone;

pub use cache_cleaner::{CacheCleaner, PurgeResult};
pub use parquet_ledger::{
    generate_project_id, generate_uuid_v4, normalize_path, FileInfo, LedgerEvent, LedgerState,
    ParquetLedger, ProjectInfo, ProjectWorkspaceFileDto, ProjectWorkspaceProjectDto,
};
pub use reconciliation::{ReconciliationReport, ReconciliationScenario, StartupReconciler};
pub use tombstone::{
    create_file_deleted_event, create_project_deleted_event, create_project_renamed_event,
    current_time_ms,
};
