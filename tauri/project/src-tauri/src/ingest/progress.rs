//! progress.rs
//!
//! Multi-Stage Progress Dispatcher for Ingestion Pipelines (Milestone M5 / F22)
//! - Dispatches structured events over `toad:ingest-progress` (5% -> 45% -> 90% -> 100%).
//! - Debounces Stage 2 (mid-parsing row ingestion) to at most once per 100ms to avoid saturating WebView IPC.
//! - Immediately flushes stage boundary transitions (sniffing, writing, ready, failed, cancelled).

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IngestProgressPayload {
    pub file_id: String,
    pub file_path: String,
    pub stage: String,        // "sniffing" | "parsing" | "writing" | "ready" | "failed" | "cancelled"
    pub percentage: u8,       // 0..=100
    pub rows_ingested: u64,
    pub elapsed_ms: u64,
    pub status: String,       // "PENDING" | "RUNNING" | "READY" | "FAILED" | "CANCELLED"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

pub type ProgressCallback = Arc<dyn Fn(&IngestProgressPayload) + Send + Sync>;

/// Multi-stage progress dispatcher emitting events to Tauri windows and registered subscribers.
pub struct ProgressDispatcher {
    app_handle: Option<tauri::AppHandle>,
    last_emit: Mutex<Instant>,
    listeners: Mutex<Vec<ProgressCallback>>,
}

impl Default for ProgressDispatcher {
    fn default() -> Self {
        Self::new(None)
    }
}

impl ProgressDispatcher {
    /// Create a new progress dispatcher with optional Tauri AppHandle
    pub fn new(app_handle: Option<tauri::AppHandle>) -> Self {
        let initial_time = Instant::now()
            .checked_sub(std::time::Duration::from_secs(1))
            .unwrap_or_else(Instant::now);
        Self {
            app_handle,
            last_emit: Mutex::new(initial_time),
            listeners: Mutex::new(Vec::new()),
        }
    }

    /// Attach a listener callback (useful for testing and internal telemetry)
    pub fn add_listener(&self, callback: ProgressCallback) {
        if let Ok(mut list) = self.listeners.lock() {
            list.push(callback);
        }
    }

    /// Emit an event unconditionally to all targets
    pub fn emit(&self, payload: &IngestProgressPayload) {
        if let Some(ref handle) = self.app_handle {
            use tauri::Emitter;
            let _ = handle.emit("toad:ingest-progress", payload);
        }

        if let Ok(listeners) = self.listeners.lock() {
            for cb in listeners.iter() {
                cb(payload);
            }
        }
    }

    /// Throttled emission for Stage 2 (row parsing) to avoid saturating WebView IPC (min 100ms interval).
    /// Always emits immediately if percentage >= 100 or status is not "RUNNING".
    pub fn emit_throttled(&self, payload: &IngestProgressPayload) {
        let is_terminal = payload.percentage >= 100 || payload.status != "RUNNING" || payload.stage != "parsing";
        let should_emit = if is_terminal {
            true
        } else if let Ok(mut last) = self.last_emit.lock() {
            if last.elapsed().as_millis() >= 100 {
                *last = Instant::now();
                true
            } else {
                false
            }
        } else {
            true
        };

        if should_emit {
            self.emit(payload);
        }
    }

    /// Helper to construct and emit Stage 1: Sniffing (5%)
    pub fn emit_stage_sniffing(&self, file_id: &str, file_path: &str, elapsed_ms: u64) {
        self.emit(&IngestProgressPayload {
            file_id: file_id.to_string(),
            file_path: file_path.to_string(),
            stage: "sniffing".to_string(),
            percentage: 5,
            rows_ingested: 0,
            elapsed_ms,
            status: "RUNNING".to_string(),
            error_message: None,
        });
    }

    /// Helper to construct and emit Stage 2: Parsing (mid-stage, debounced)
    pub fn emit_stage_parsing(&self, file_id: &str, file_path: &str, rows: u64, percentage: u8, elapsed_ms: u64) {
        self.emit_throttled(&IngestProgressPayload {
            file_id: file_id.to_string(),
            file_path: file_path.to_string(),
            stage: "parsing".to_string(),
            percentage: percentage.clamp(10, 85),
            rows_ingested: rows,
            elapsed_ms,
            status: "RUNNING".to_string(),
            error_message: None,
        });
    }

    /// Helper to construct and emit Stage 3: Writing Parquet (90%)
    pub fn emit_stage_writing(&self, file_id: &str, file_path: &str, total_rows: u64, elapsed_ms: u64) {
        self.emit(&IngestProgressPayload {
            file_id: file_id.to_string(),
            file_path: file_path.to_string(),
            stage: "writing".to_string(),
            percentage: 90,
            rows_ingested: total_rows,
            elapsed_ms,
            status: "RUNNING".to_string(),
            error_message: None,
        });
    }

    /// Helper to construct and emit Stage 4: Ready (100%)
    pub fn emit_stage_ready(&self, file_id: &str, file_path: &str, total_rows: u64, elapsed_ms: u64) {
        self.emit(&IngestProgressPayload {
            file_id: file_id.to_string(),
            file_path: file_path.to_string(),
            stage: "ready".to_string(),
            percentage: 100,
            rows_ingested: total_rows,
            elapsed_ms,
            status: "READY".to_string(),
            error_message: None,
        });
    }

    /// Helper to construct and emit Failed
    pub fn emit_failed(&self, file_id: &str, file_path: &str, error_msg: &str, elapsed_ms: u64) {
        self.emit(&IngestProgressPayload {
            file_id: file_id.to_string(),
            file_path: file_path.to_string(),
            stage: "failed".to_string(),
            percentage: 0,
            rows_ingested: 0,
            elapsed_ms,
            status: "FAILED".to_string(),
            error_message: Some(error_msg.to_string()),
        });
    }

    /// Helper to construct and emit Cancelled
    pub fn emit_cancelled(&self, file_id: &str, file_path: &str, elapsed_ms: u64) {
        self.emit(&IngestProgressPayload {
            file_id: file_id.to_string(),
            file_path: file_path.to_string(),
            stage: "cancelled".to_string(),
            percentage: 0,
            rows_ingested: 0,
            elapsed_ms,
            status: "CANCELLED".to_string(),
            error_message: None,
        });
    }
}
