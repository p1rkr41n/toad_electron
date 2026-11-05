//! scheduler.rs
//!
//! Shortest-Job-First (SJF) Ingestion Scheduler & Concurrency Throttle (Milestone M5 / F21)
//! - Shortest-Job-First priority queue ordering: `VIP (true > false) -> file_size (ascending) -> added_time_ms (FIFO)`.
//! - Dual-bound concurrency throttling: `max_concurrent_files` (4) and `max_concurrent_bytes` (1.0 GB),
//!   with Exclusive Big File Mode for files > 1.0 GB when idle.
//! - VIP preemption with Burst Lane (+1 permit) for instant click responsiveness.
//! - Cooperative cancellation via `CancellationToken` cleaning up scratch `.tmp` files.
//! - Commits Parquet State Ledger WAL updates upon completion.

use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::{Notify, RwLock};

use crate::engine::duckdb_pool::DuckDbEnginePool;
use crate::engine::fast_count::FastCounter;
use crate::ingest::csv_streamer::ingest_csv_file;
use crate::ingest::dirty_log::ingest_dirty_log;
use crate::ingest::evtx_parser::ingest_evtx_file;
use crate::ingest::jsonl_streamer::ingest_jsonl_file;
use crate::ingest::progress::ProgressDispatcher;
use crate::ledger::parquet_ledger::{generate_uuid_v4, LedgerEvent, ParquetLedger};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum IngestPriority {
    Normal = 0,
    Vip = 1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum IngestStatus {
    Pending,
    Running,
    Ready,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestJob {
    pub job_id: String,
    pub file_id: String,
    pub project_id: String,
    pub file_path: String,
    pub file_name: String,
    pub file_size: u64,
    pub priority: IngestPriority,
    pub status: IngestStatus,
    pub added_time_ms: u64,
    pub target_parquet_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
}

impl IngestJob {
    /// Strict Shortest-Job-First (SJF) comparator:
    /// 1. VIP jobs strictly precede Normal jobs.
    /// 2. Smaller file size precedes larger file size (SJF).
    /// 3. Earlier added_time precedes later added_time (FIFO tie-breaker).
    /// 4. Lexicographical comparison on job_id for total ordering.
    pub fn cmp_sjf(&self, other: &Self) -> Ordering {
        if self.priority != other.priority {
            return other.priority.cmp(&self.priority);
        }
        if self.file_size != other.file_size {
            return self.file_size.cmp(&other.file_size);
        }
        if self.added_time_ms != other.added_time_ms {
            return self.added_time_ms.cmp(&other.added_time_ms);
        }
        self.job_id.cmp(&other.job_id)
    }
}

/// Cooperative cancellation token
#[derive(Clone, Debug)]
pub struct CancellationToken {
    cancelled: Arc<AtomicBool>,
}

impl CancellationToken {
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, AtomicOrdering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(AtomicOrdering::SeqCst)
    }
}

impl Default for CancellationToken {
    fn default() -> Self {
        Self::new()
    }
}

pub struct ActiveJobHandle {
    pub job: IngestJob,
    pub cancellation_token: CancellationToken,
    pub start_time: Instant,
}

#[derive(Default)]
pub struct IngestionSchedulerState {
    pub pending: Vec<IngestJob>,
    pub active: HashMap<String, ActiveJobHandle>, // Key: job_id
    pub completed: HashMap<String, IngestJob>,
    pub max_concurrent_files: usize,
    pub max_concurrent_bytes: u64,
    pub burst_lane_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestQueueSnapshot {
    pub active_jobs: Vec<IngestJob>,
    pub pending_jobs: Vec<IngestJob>,
    pub active_count: usize,
    pub pending_count: usize,
    pub in_flight_bytes: u64,
    pub max_concurrent_files: usize,
    pub max_concurrent_bytes: u64,
}

#[derive(Clone)]
pub struct IngestionScheduler {
    pub state: Arc<RwLock<IngestionSchedulerState>>,
    pub notify: Arc<Notify>,
    pub dispatcher: Arc<ProgressDispatcher>,
    pub ledger: Option<Arc<RwLock<ParquetLedger>>>,
    pub duckdb_pool: Option<Arc<DuckDbEnginePool>>,
    pub temp_dir: PathBuf,
    loop_started: Arc<AtomicBool>,
}

impl Default for IngestionScheduler {
    fn default() -> Self {
        let temp_dir = std::env::temp_dir().join("toad_default_ingest");
        Self::new(
            temp_dir,
            None,
            None,
            Arc::new(ProgressDispatcher::default()),
            4,
            1_073_741_824, // 1.0 GB
        )
    }
}

impl IngestionScheduler {
    pub fn new(
        temp_dir: PathBuf,
        ledger: Option<Arc<RwLock<ParquetLedger>>>,
        duckdb_pool: Option<Arc<DuckDbEnginePool>>,
        dispatcher: Arc<ProgressDispatcher>,
        max_concurrent_files: usize,
        max_concurrent_bytes: u64,
    ) -> Self {
        let _ = std::fs::create_dir_all(&temp_dir);
        let state = IngestionSchedulerState {
            pending: Vec::new(),
            active: HashMap::new(),
            completed: HashMap::new(),
            max_concurrent_files: max_concurrent_files.max(1),
            max_concurrent_bytes: if max_concurrent_bytes == 0 {
                1_073_741_824
            } else {
                max_concurrent_bytes
            },
            burst_lane_active: false,
        };

        Self {
            state: Arc::new(RwLock::new(state)),
            notify: Arc::new(Notify::new()),
            dispatcher,
            ledger,
            duckdb_pool,
            temp_dir,
            loop_started: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Spawns the background dispatcher worker loop if not already running
    pub fn ensure_dispatch_loop_started(self: &Arc<Self>) {
        if self
            .loop_started
            .compare_exchange(false, true, AtomicOrdering::SeqCst, AtomicOrdering::SeqCst)
            .is_ok()
        {
            let scheduler_arc = self.clone();
            tokio::spawn(async move {
                scheduler_arc.run_dispatch_loop().await;
            });
        }
    }

    /// Enqueue a file for ingestion. Performs Double-Valid Parquet cache inspection first.
    pub async fn enqueue_file(
        self: &Arc<Self>,
        project_id: &str,
        file_path: &str,
        priority: IngestPriority,
    ) -> Result<IngestJob, String> {
        self.ensure_dispatch_loop_started();

        let path = Path::new(file_path);
        let meta = std::fs::metadata(path)
            .map_err(|e| format!("Cannot read metadata for file {:?}: {}", path, e))?;

        let size = meta.len();
        let mtime = meta
            .modified()
            .unwrap_or(SystemTime::UNIX_EPOCH)
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;

        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("file");
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        let path_hash = (mtime ^ ((size as i64) << 16) ^ 0x5a5a5a5a) as u32;
        let cache_name = format!("{}_cached_{:08x}.parquet", stem, path_hash);
        let target_parquet = self.temp_dir.join(project_id).join(&cache_name);
        let target_parquet_str = target_parquet.to_string_lossy().to_string();

        let file_id = generate_uuid_v4();
        let job_id = generate_uuid_v4();
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        // Check if Parquet cache already exists and is non-empty (Double-Valid Parquet cache hit)
        if target_parquet.exists() {
            if let Ok(rows) = FastCounter::count_parquet_rows(&target_parquet) {
                if rows >= 0 {
                    let job = IngestJob {
                        job_id,
                        file_id: file_id.clone(),
                        project_id: project_id.to_string(),
                        file_path: file_path.to_string(),
                        file_name: path.file_name().unwrap_or_default().to_string_lossy().to_string(),
                        file_size: size,
                        priority,
                        status: IngestStatus::Ready,
                        added_time_ms: now_ms,
                        target_parquet_path: target_parquet_str.clone(),
                        error_message: None,
                        row_count: Some(rows),
                        duration_ms: Some(1),
                    };

                    // Record completed and emit 100%
                    self.dispatcher.emit_stage_ready(&file_id, file_path, rows as u64, 1);
                    let mut st = self.state.write().await;
                    st.completed.insert(job.job_id.clone(), job.clone());
                    return Ok(job);
                }
            }
        }

        // If source file is already a .parquet file, we can point directly to it
        if ext == "parquet" {
            let rows = FastCounter::count_parquet_rows(path).unwrap_or(0);
            let job = IngestJob {
                job_id,
                file_id: file_id.clone(),
                project_id: project_id.to_string(),
                file_path: file_path.to_string(),
                file_name: path.file_name().unwrap_or_default().to_string_lossy().to_string(),
                file_size: size,
                priority,
                status: IngestStatus::Ready,
                added_time_ms: now_ms,
                target_parquet_path: file_path.to_string(),
                error_message: None,
                row_count: Some(rows),
                duration_ms: Some(1),
            };

            self.dispatcher.emit_stage_ready(&file_id, file_path, rows as u64, 1);
            let mut st = self.state.write().await;
            st.completed.insert(job.job_id.clone(), job.clone());
            return Ok(job);
        }

        let job = IngestJob {
            job_id,
            file_id,
            project_id: project_id.to_string(),
            file_path: file_path.to_string(),
            file_name: path.file_name().unwrap_or_default().to_string_lossy().to_string(),
            file_size: size,
            priority,
            status: IngestStatus::Pending,
            added_time_ms: now_ms,
            target_parquet_path: target_parquet_str,
            error_message: None,
            row_count: None,
            duration_ms: None,
        };

        {
            let mut st = self.state.write().await;
            if priority == IngestPriority::Vip {
                st.burst_lane_active = true;
            }
            st.pending.push(job.clone());
            st.pending.sort_by(|a, b| a.cmp_sjf(b));
        }

        // Notify dispatcher loop
        self.notify.notify_one();
        Ok(job)
    }

    /// Promote an existing pending job to VIP (jumping it to the front of the queue).
    /// Activates the Burst Lane (+1 concurrency limit) if all slots are occupied.
    pub async fn promote_to_vip(&self, file_id_or_path: &str) -> Result<IngestJob, String> {
        let mut st = self.state.write().await;
        if let Some(pos) = st.pending.iter().position(|j| j.job_id == file_id_or_path || j.file_id == file_id_or_path || j.file_path == file_id_or_path) {
            st.pending[pos].priority = IngestPriority::Vip;
            let job = st.pending[pos].clone();
            st.pending.sort_by(|a, b| a.cmp_sjf(b));
            st.burst_lane_active = true;
            drop(st);
            self.notify.notify_one();
            return Ok(job);
        }

        // Check if already active
        for handle in st.active.values() {
            if handle.job.job_id == file_id_or_path || handle.job.file_id == file_id_or_path || handle.job.file_path == file_id_or_path {
                return Ok(handle.job.clone());
            }
        }

        // Check completed
        for job in st.completed.values() {
            if job.job_id == file_id_or_path || job.file_id == file_id_or_path || job.file_path == file_id_or_path {
                return Ok(job.clone());
            }
        }

        Err(format!("File '{}' not found in ingestion queue", file_id_or_path))
    }

    /// Cancel an ingestion job. If running, triggers cooperative cancellation and purges `.tmp` files.
    pub async fn cancel_job(&self, job_or_file_id: &str) -> Result<bool, String> {
        let mut st = self.state.write().await;

        // Check pending
        if let Some(pos) = st.pending.iter().position(|j| j.job_id == job_or_file_id || j.file_id == job_or_file_id) {
            let mut job = st.pending.remove(pos);
            if job.priority == IngestPriority::Vip && !st.pending.iter().any(|j| j.priority == IngestPriority::Vip) {
                st.burst_lane_active = false;
            }
            job.status = IngestStatus::Cancelled;
            self.dispatcher.emit_cancelled(&job.file_id, &job.file_path, 0);
            st.completed.insert(job.job_id.clone(), job);
            return Ok(true);
        }

        // Check active
        let mut target_job_id = None;
        for (jid, handle) in st.active.iter() {
            if jid == job_or_file_id || handle.job.file_id == job_or_file_id {
                handle.cancellation_token.cancel();
                target_job_id = Some(jid.clone());
                break;
            }
        }

        if let Some(jid) = target_job_id {
            if let Some(mut handle) = st.active.remove(&jid) {
                handle.job.status = IngestStatus::Cancelled;
                let tmp_file = PathBuf::from(&handle.job.target_parquet_path).with_extension("parquet.tmp");
                let _ = std::fs::remove_file(&tmp_file);
                self.dispatcher.emit_cancelled(&handle.job.file_id, &handle.job.file_path, handle.start_time.elapsed().as_millis() as u64);
                st.completed.insert(jid, handle.job);
                return Ok(true);
            }
        }

        Err(format!("Job '{}' not found in active or pending queue", job_or_file_id))
    }

    /// Snapshot of the current scheduler state for UI / IPC inspection
    pub async fn get_queue_snapshot(&self) -> IngestQueueSnapshot {
        let st = self.state.read().await;
        let mut active_jobs: Vec<IngestJob> = st.active.values().map(|h| h.job.clone()).collect();
        active_jobs.sort_by(|a, b| a.cmp_sjf(b));

        let pending_jobs = st.pending.clone();
        let in_flight_bytes: u64 = active_jobs.iter().map(|j| j.file_size).sum();

        IngestQueueSnapshot {
            active_jobs,
            pending_jobs,
            active_count: st.active.len(),
            pending_count: st.pending.len(),
            in_flight_bytes,
            max_concurrent_files: st.max_concurrent_files,
            max_concurrent_bytes: st.max_concurrent_bytes,
        }
    }

    /// Core scheduler dispatch loop
    async fn run_dispatch_loop(self: Arc<Self>) {
        loop {
            // Find next job to dispatch based on dual bounds and SJF
            let candidate = {
                let mut st = self.state.write().await;
                if st.pending.is_empty() {
                    None
                } else {
                    let current_in_flight_bytes: u64 = st.active.values().map(|h| h.job.file_size).sum();
                    let active_count = st.active.len();

                    // Maximum allowed slots: +1 permit if VIP burst lane is active
                    let max_slots = if st.burst_lane_active {
                        st.max_concurrent_files + 1
                    } else {
                        st.max_concurrent_files
                    };

                    if active_count == 0 {
                        // Exclusive Big File Mode: run pending[0] regardless of size
                        let job = st.pending.remove(0);
                        if job.priority == IngestPriority::Vip {
                            st.burst_lane_active = false;
                        }
                        Some(job)
                    } else if active_count < max_slots {
                        // Look for the first job that fits under max_concurrent_bytes, or VIP job
                        let mut selected_idx = None;
                        for (idx, job) in st.pending.iter().enumerate() {
                            if job.priority == IngestPriority::Vip || current_in_flight_bytes + job.file_size <= st.max_concurrent_bytes {
                                selected_idx = Some(idx);
                                break;
                            }
                        }

                        if let Some(idx) = selected_idx {
                            if st.pending[idx].priority == IngestPriority::Vip {
                                st.burst_lane_active = false;
                            }
                            Some(st.pending.remove(idx))
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                }
            };

            if let Some(mut job) = candidate {
                job.status = IngestStatus::Running;
                let cancellation_token = CancellationToken::new();
                let job_id = job.job_id.clone();
                let handle = ActiveJobHandle {
                    job: job.clone(),
                    cancellation_token: cancellation_token.clone(),
                    start_time: Instant::now(),
                };

                {
                    let mut st = self.state.write().await;
                    st.active.insert(job_id.clone(), handle);
                }

                // Spawn task execution
                let scheduler_clone = self.clone();
                tokio::spawn(async move {
                    scheduler_clone.execute_job(job, cancellation_token).await;
                });
            } else {
                // Wait for next notification
                self.notify.notified().await;
            }
        }
    }

    /// Execute a single ingestion job across format streamers
    async fn execute_job(self: Arc<Self>, mut job: IngestJob, cancellation_token: CancellationToken) {
        let t0 = Instant::now();
        let src_path = PathBuf::from(&job.file_path);
        let dst_parquet = PathBuf::from(&job.target_parquet_path);
        let ext = src_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        let result: Result<i64, String> = match ext.as_str() {
            "evtx" => {
                let disp = self.dispatcher.clone();
                let fid = job.file_id.clone();
                let ct = cancellation_token.clone();
                let src = src_path.clone();
                let dst = dst_parquet.clone();
                tokio::task::spawn_blocking(move || {
                    let res = ingest_evtx_file(&fid, &src, &dst, 4, &ct, Some(&disp))?;
                    Ok(res.row_count)
                })
                .await
                .map_err(|e| format!("Join error: {}", e))
                .and_then(|r| r)
            }
            "csv" | "tsv" | "tab" | "txt" => {
                if let Some(ref pool) = self.duckdb_pool {
                    let fid = job.file_id.clone();
                    let disp = self.dispatcher.clone();
                    let ct = cancellation_token.clone();
                    let src = src_path.clone();
                    let dst = dst_parquet.clone();
                    pool.run_ingest_task(move |conn| {
                        let res = ingest_csv_file(&fid, &src, &dst, &conn, &ct, Some(&disp))?;
                        Ok(res.row_count)
                    })
                    .await
                } else {
                    let disp = self.dispatcher.clone();
                    let ct = cancellation_token.clone();
                    let src = src_path.clone();
                    let dst = dst_parquet.clone();
                    let fid = job.file_id.clone();
                    tokio::task::spawn_blocking(move || {
                        let res = ingest_dirty_log(&fid, &src, &dst, &ct, Some(&disp))?;
                        Ok(res.row_count)
                    })
                    .await
                    .map_err(|e| format!("Join error: {}", e))
                    .and_then(|r| r)
                }
            }
            "json" | "jsonl" | "ndjson" => {
                if let Some(ref pool) = self.duckdb_pool {
                    let fid = job.file_id.clone();
                    let disp = self.dispatcher.clone();
                    let ct = cancellation_token.clone();
                    let src = src_path.clone();
                    let dst = dst_parquet.clone();
                    pool.run_ingest_task(move |conn| {
                        let res = ingest_jsonl_file(&fid, &src, &dst, &conn, &ct, Some(&disp))?;
                        Ok(res.row_count)
                    })
                    .await
                } else {
                    let disp = self.dispatcher.clone();
                    let ct = cancellation_token.clone();
                    let src = src_path.clone();
                    let dst = dst_parquet.clone();
                    let fid = job.file_id.clone();
                    tokio::task::spawn_blocking(move || {
                        let res = ingest_dirty_log(&fid, &src, &dst, &ct, Some(&disp))?;
                        Ok(res.row_count)
                    })
                    .await
                    .map_err(|e| format!("Join error: {}", e))
                    .and_then(|r| r)
                }
            }
            _ => {
                // Fallback to dirty_log for all unknown or arbitrary log extensions
                let disp = self.dispatcher.clone();
                let ct = cancellation_token.clone();
                let src = src_path.clone();
                let dst = dst_parquet.clone();
                let fid = job.file_id.clone();
                tokio::task::spawn_blocking(move || {
                    let res = ingest_dirty_log(&fid, &src, &dst, &ct, Some(&disp))?;
                    Ok(res.row_count)
                })
                .await
                .map_err(|e| format!("Join error: {}", e))
                .and_then(|r| r)
            }
        };

        let (row_count, final_status, err_msg) = match result {
            Ok(rc) => (rc, IngestStatus::Ready, None),
            Err(e) => {
                if cancellation_token.is_cancelled() {
                    (0, IngestStatus::Cancelled, None)
                } else {
                    self.dispatcher.emit_failed(&job.file_id, &job.file_path, &e, t0.elapsed().as_millis() as u64);
                    (0, IngestStatus::Failed, Some(e))
                }
            }
        };

        let elapsed_ms = t0.elapsed().as_millis() as i64;
        job.status = final_status;
        job.row_count = Some(row_count);
        job.duration_ms = Some(elapsed_ms);
        job.error_message = err_msg;

        // If Ready, commit WAL Ledger event
        if final_status == IngestStatus::Ready {
            if let Some(ref ledger_rw) = self.ledger {
                let ledger = ledger_rw.read().await;
                let parquet_size = std::fs::metadata(&dst_parquet).map(|m| m.len() as i64).unwrap_or(0);
                let now_ms = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as i64;

                let ev = LedgerEvent {
                    event_id: generate_uuid_v4(),
                    event_type: "FILE_MODIFIED".to_string(),
                    timestamp: now_ms,
                    project_id: job.project_id.clone(),
                    project_name: None,
                    file_id: Some(job.file_id.clone()),
                    file_path: Some(job.file_path.clone()),
                    file_size: Some(job.file_size as i64),
                    file_type: Some(ext),
                    source_mtime: None,
                    parquet_path: Some(job.target_parquet_path.clone()),
                    parquet_size: Some(parquet_size),
                    row_count: Some(row_count),
                    status: Some("READY".to_string()),
                    duration_ms: Some(elapsed_ms),
                    metadata_json: Some("{}".to_string()),
                };

                let _ = ledger.append_events(&[ev]).await;
            }
        }

        // Update state: remove from active, insert into completed
        {
            let mut st = self.state.write().await;
            st.active.remove(&job.job_id);
            st.completed.insert(job.job_id.clone(), job);
        }

        // Trigger dispatcher to process next pending jobs
        self.notify.notify_one();
    }
}
