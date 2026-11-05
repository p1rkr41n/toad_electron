//! commands/ingest.rs
//!
//! Forensics & Ingestion IPC Command Handlers (Milestone M5 / F18-F22)
//!
//! Implements:
//! - `toad:ingest_file` / `ingestFile`: Enqueue file into SJF scheduler
//! - `toad:ingest_cancel` / `cancelIngest`: Cancel pending or active ingestion
//! - `toad:ingest_vip` / `prioritizeIngest`: Promote file to VIP Burst Lane
//! - `toad:get_ingest_queue` / `getIngestQueue`: Snapshot of active/pending ingestion jobs

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::ingest::scheduler::{IngestPriority, IngestQueueSnapshot, IngestStatus};
use crate::logger::ErrorResponse;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestFileResponse {
    pub job_id: String,
    pub file_id: String,
    pub status: String,
    pub queue_position: usize,
    pub target_parquet_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestCancelResponse {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestVipResponse {
    pub success: bool,
    pub new_queue_position: usize,
    pub status: String,
}

fn get_str_param<'a>(payload: &'a Value, primary: &str, alias: &str) -> Option<&'a str> {
    payload
        .get(primary)
        .and_then(|v| v.as_str())
        .or_else(|| payload.get(alias).and_then(|v| v.as_str()))
}

/// INGEST FILE: Enqueue file for background forensic ingestion
pub async fn handle_ingest_file(
    state: &AppState,
    payload: Value,
) -> Result<IngestFileResponse, ErrorResponse> {
    let file_path = get_str_param(&payload, "filePath", "file_path")
        .ok_or_else(|| ErrorResponse::invalid_argument("Missing filePath parameter"))?;

    let ledger = state.parquet_ledger.read().await;
    let project_id = get_str_param(&payload, "projectId", "project_id")
        .map(|s| s.to_string())
        .or_else(|| ledger.active_project_id.clone())
        .unwrap_or_else(|| "default".to_string());
    drop(ledger);

    let is_vip = payload
        .get("priority")
        .and_then(|v| v.as_str())
        .map(|s| s.eq_ignore_ascii_case("vip") || s.eq_ignore_ascii_case("high"))
        .or_else(|| payload.get("isVip").and_then(|v| v.as_bool()))
        .unwrap_or(false);

    let priority = if is_vip {
        IngestPriority::Vip
    } else {
        IngestPriority::Normal
    };

    let scheduler = state.get_ingest_scheduler().await;
    let job = scheduler
        .enqueue_file(&project_id, file_path, priority)
        .await
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to enqueue file: {}", e)))?;

    let snap = scheduler.get_queue_snapshot().await;
    let queue_position = if job.status == IngestStatus::Ready {
        0
    } else {
        snap.pending_jobs
            .iter()
            .position(|j| j.job_id == job.job_id)
            .unwrap_or(0)
    };

    let status_str = match job.status {
        IngestStatus::Pending => "QUEUED",
        IngestStatus::Running => "RUNNING",
        IngestStatus::Ready => "READY",
        IngestStatus::Failed => "FAILED",
        IngestStatus::Cancelled => "CANCELLED",
    };

    Ok(IngestFileResponse {
        job_id: job.job_id,
        file_id: job.file_id,
        status: status_str.to_string(),
        queue_position,
        target_parquet_path: job.target_parquet_path,
        row_count: job.row_count,
    })
}

/// CANCEL INGEST: Cancel pending or active ingestion job
pub async fn handle_ingest_cancel(
    state: &AppState,
    payload: Value,
) -> Result<IngestCancelResponse, ErrorResponse> {
    let target_id = get_str_param(&payload, "jobId", "job_id")
        .or_else(|| get_str_param(&payload, "fileId", "file_id"))
        .or_else(|| get_str_param(&payload, "id", "targetId"))
        .ok_or_else(|| ErrorResponse::invalid_argument("Missing jobId or fileId parameter"))?;

    let scheduler = state.get_ingest_scheduler().await;
    let success = scheduler
        .cancel_job(target_id)
        .await
        .map_err(|e| ErrorResponse::new("ERR_NOT_FOUND", e))?;

    Ok(IngestCancelResponse {
        success,
        message: format!("Job '{}' cancelled successfully", target_id),
    })
}

/// VIP PREEMPTION: Prioritize job to the front of the queue
pub async fn handle_ingest_vip(
    state: &AppState,
    payload: Value,
) -> Result<IngestVipResponse, ErrorResponse> {
    let target_id = get_str_param(&payload, "fileId", "file_id")
        .or_else(|| get_str_param(&payload, "filePath", "file_path"))
        .or_else(|| get_str_param(&payload, "jobId", "job_id"))
        .ok_or_else(|| ErrorResponse::invalid_argument("Missing fileId or filePath parameter"))?;

    let scheduler = state.get_ingest_scheduler().await;
    let job = scheduler
        .promote_to_vip(target_id)
        .await
        .map_err(|e| ErrorResponse::new("ERR_NOT_FOUND", e))?;

    let snap = scheduler.get_queue_snapshot().await;
    let new_pos = snap
        .pending_jobs
        .iter()
        .position(|j| j.job_id == job.job_id)
        .unwrap_or(0);

    let status_str = match job.status {
        IngestStatus::Pending => "PENDING",
        IngestStatus::Running => "RUNNING",
        IngestStatus::Ready => "READY",
        IngestStatus::Failed => "FAILED",
        IngestStatus::Cancelled => "CANCELLED",
    };

    Ok(IngestVipResponse {
        success: true,
        new_queue_position: new_pos,
        status: status_str.to_string(),
    })
}

/// GET INGEST QUEUE: Snapshot of active and pending queues
pub async fn handle_get_ingest_queue(
    state: &AppState,
    _payload: Value,
) -> Result<IngestQueueSnapshot, ErrorResponse> {
    let scheduler = state.get_ingest_scheduler().await;
    Ok(scheduler.get_queue_snapshot().await)
}
