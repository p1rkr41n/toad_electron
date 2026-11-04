//! tombstone.rs
//!
//! Typed NULL Tombstone Records & Zero-Cost Rename for Toad Parquet State Ledger WAL (Milestone M4)
//! - Permanent isolation of deleted projects (`PROJECT_DELETED`) and deleted files (`FILE_DELETED`).
//! - Strictly emits typed NULLs (CAST(NULL AS VARCHAR), CAST(NULL AS BIGINT)) to preserve Parquet schema integrity.
//! - Zero-cost project rename modifies metadata without moving physical directories.

use crate::ledger::parquet_ledger::{generate_uuid_v4, LedgerEvent};
use std::time::{SystemTime, UNIX_EPOCH};

/// Helper to get current epoch milliseconds
#[inline]
pub fn current_time_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// Create a typed NULL `PROJECT_DELETED` tombstone event record.
///
/// Unused fields are set to `None` (which serialize to typed NULLs in DuckDB / Parquet),
/// preventing schema decay or untyped NULL corruption.
pub fn create_project_deleted_event(project_id: &str, project_name: Option<&str>) -> LedgerEvent {
    LedgerEvent {
        event_id: generate_uuid_v4(),
        event_type: "PROJECT_DELETED".to_string(),
        timestamp: current_time_ms(),
        project_id: project_id.to_string(),
        project_name: project_name.map(|s| s.to_string()),
        file_id: None,
        file_path: None,
        file_size: None,
        file_type: None,
        source_mtime: None,
        parquet_path: None,
        parquet_size: None,
        row_count: None,
        status: Some("DELETED".to_string()),
        duration_ms: None,
        metadata_json: None,
    }
}

/// Create a typed NULL `FILE_DELETED` tombstone event record.
pub fn create_file_deleted_event(project_id: &str, file_id: &str, file_path: &str) -> LedgerEvent {
    LedgerEvent {
        event_id: generate_uuid_v4(),
        event_type: "FILE_DELETED".to_string(),
        timestamp: current_time_ms(),
        project_id: project_id.to_string(),
        project_name: None,
        file_id: Some(file_id.to_string()),
        file_path: Some(file_path.to_string()),
        file_size: None,
        file_type: None,
        source_mtime: None,
        parquet_path: None,
        parquet_size: None,
        row_count: None,
        status: Some("DELETED".to_string()),
        duration_ms: None,
        metadata_json: None,
    }
}

/// Create a `PROJECT_RENAMED` event record for zero-cost metadata renaming.
pub fn create_project_renamed_event(project_id: &str, new_name: &str) -> LedgerEvent {
    LedgerEvent {
        event_id: generate_uuid_v4(),
        event_type: "PROJECT_RENAMED".to_string(),
        timestamp: current_time_ms(),
        project_id: project_id.to_string(),
        project_name: Some(new_name.to_string()),
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
        metadata_json: None,
    }
}
