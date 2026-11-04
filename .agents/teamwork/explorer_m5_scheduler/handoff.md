# Exploration Report: Ingestion Scheduler, VIP Jump Queue & Progress Dispatcher (Squad 5)

## 1. Observation

### 1.1 Existing Backend State and Stubs
- **`tauri/project/src-tauri/src/state.rs` (lines 26-41):**
  A placeholder struct is declared for Milestone M5:
  ```rust
  /// Placeholder for Ingestion Queue & Forensics Scheduler (Milestone M5)
  #[derive(Debug, Default, Clone)]
  pub struct IngestionQueuePlaceholder {
      pub active_jobs: usize,
      pub pending_jobs: usize,
  }

  pub struct AppState {
      ...
      pub ingest_queue: Arc<RwLock<IngestionQueuePlaceholder>>,
  }
  ```
- **`tauri/project/src-tauri/src/portable.rs` (lines 18-40):**
  `ToadGeneralConfig` already contains the concurrency parameters needed by the scheduler:
  ```rust
  pub struct ToadGeneralConfig {
      pub viewer: String,
      pub language: String,
      pub page_size: u64,
      pub max_concurrent_files: u32,  // Default: 4
      pub max_concurrent_gb: f64,     // Default: 1.0
      ...
  }
  ```
- **`tauri/project/src-tauri/src/engine/duckdb_pool.rs` (lines 171-200):**
  `DuckDbEnginePool` already implements worker connection provisioning and worker concurrency gating:
  ```rust
  pub fn create_worker_connection(&self) -> DuckResult<Connection>;
  pub async fn run_ingest_task<F, T>(&self, task: F) -> Result<T, String>
  where
      F: FnOnce(Connection) -> Result<T, String> + Send + 'static,
      T: Send + 'static;
  ```
- **`tauri/project/src-tauri/src/ledger/parquet_ledger.rs` (lines 534-580):**
  When files are added in `add_files_to_project`, Parquet files have their row count inspected via `FastCounter::count_parquet_rows` and marked `READY`, whereas non-parquet files are assigned `parquet_path = temp_dir.join(project_id).join(&cache_name)` and currently default to status `READY` with `row_count: 0`. For genuine forensics and text log ingestion (CSV, TSV, EVTX, JSONL), these must be transitioned through `PENDING -> PROCESSING -> READY`.
- **`tauri/project/src-tauri/src/commands/mod.rs` (lines 20-60, 65-160):**
  `CommandAction` enum and `route_command` function classify `toad:*` and `project:*` commands. Currently, no ingestion commands (`toad:ingest_*`) are routed or handled.
- **`tauri/project/src-tauri/src/commands/workspace.rs` (lines 200-254):**
  `handle_add_files` and `handle_add_folder` directly call `ledger.add_files_to_project` and `ledger.add_folder_to_project`, returning immediately without queuing background ingestion tasks.

### 1.2 Frontend Precedent in Electron
- **`tad-master/packages/toadviewer/src/MultipleLoadingManager.ts` (lines 80-170, 755-795):**
  In the legacy Electron client, background ingestion was orchestrated client-side in TypeScript:
  - 1-second polling loop (`startPollingLoop`).
  - Priority sort: `User Priority > Shortest Job First (fileSizeBytes) > FIFO (addedTime)`.
  - Max concurrent files: `maxConcurrentFiles = 4`.
  - Max in-flight bytes: `maxConcurrentGB = 1.0 GB`.
  - Exclusive Big File Mode: if queue is idle (`activeItems.size === 0`), files > 1 GB are permitted to run alone.
  - VIP preemption: `prioritize(key)` pushed the job priority to `Date.now() + 1000000` to jump ahead of all other files.
- **`tad-master/packages/host-bridge/src/TauriHostAdapter.ts` (lines 74-99):**
  Frontend already provides an event listener bridge:
  ```typescript
  listen<T = any>(event: string, handler: (payload: T) => void): UnlistenFn
  ```
  listening on Tauri events (e.g., `toad:ingest-progress`).

---

## 2. Logic Chain

1. **Backend Ownership of Queuing & Scheduling**:
   - In Electron, the frontend had to query file metadata via IPC and loop through jobs client-side because Node.js worker threads had overhead.
   - In Tauri v2, the backend is 100% native Rust running on Tokio. Moving the queue and worker execution into `src-tauri/src/ingest/scheduler.rs` eliminates round-trip IPC overhead, guarantees thread safety, prevents UI freeze during heavy CPU/disk tasks, and ensures ingestion continues even if the UI window is minimized or navigated.
2. **SJF (Shortest Job First) Optimization**:
   - Small files (e.g., 50 KB configuration logs) convert in < 10ms, while massive files (e.g., a 2 GB EVTX archive) can take several seconds.
   - Ingesting smallest files first yields immediate UI responsiveness (files turn green/ready in the sidebar in milliseconds), improving perceived system throughput.
   - Strict ordering: `VIP (true > false) -> File Size (ascending) -> Added Time (ascending FIFO)`.
3. **Dual-Bound Concurrency Throttling**:
   - Unbounded parallel reads cause severe disk I/O head contention (on HDDs) and NVMe bus saturation, and can exhaust RAM if multiple large files are unpacked simultaneously.
   - Throttling using `tokio::sync::Semaphore` set to `max_concurrent_files` (default 4) and tracking `current_in_flight_bytes <= max_concurrent_bytes` (default 1 GB) prevents system thrashing.
   - "Exclusive Big File Mode": If the queue is completely idle, a 2.5 GB file must not be blocked indefinitely simply because it exceeds 1.0 GB; it runs exclusively with concurrency = 1.
4. **VIP Jump Queue Preemption Mechanics**:
   - When a user clicks a file in the sidebar, they want to view that specific file immediately.
   - If the file is `Pending`, its priority is set to `IngestPriority::Vip`.
   - To avoid wasting work by aborting an in-flight 90% completed file, the scheduler should use a **Burst VIP Lane** (allowing `max_concurrent_files + 1` worker temporarily for the VIP job) or **Head-of-Queue Next-Slot Promotion** with cooperative cancellation tokens (`tokio_util::sync::CancellationToken`).
5. **Multi-Stage Progress Dispatcher**:
   - Emits structured events matching the contract:
     - Stage 1: `5%` - Sniffing format & delimiter.
     - Stage 2: `45%` - Vector parsing & conversion.
     - Stage 3: `90%` - Writing compressed Parquet cache.
     - Stage 4: `100%` - Ready (WAL updated, RAM cache pre-warmed).
   - Event rate-limiting: Ingestion loops process millions of rows. Emitting IPC events on every row crushes the WebView message loop. Progress events in Stage 2 must be throttled to at most once per 100ms or 25,000 rows.

---

## 3. Caveats

1. **No Application Code Modifications**: This is a read-only exploration per Teamwork Explorer rules. No source files under `tauri/project/` were modified.
2. **Parser Dependencies (Agents 5.1-5.4)**: The scheduler delegates the actual byte conversion to the format streamers (`csv_streamer.rs`, `evtx_parser.rs`, `jsonl_streamer.rs`). The scheduler must define a clean trait `FileIngestor` or unified runner function that these parsers plug into.
3. **Platform File Sharing on Windows**: When opening files for sniffing/reading, files must be opened with standard Windows read-sharing (`FILE_SHARE_READ | FILE_SHARE_WRITE`) to avoid `EBUSY` sharing violations if the file is currently being appended to by external logging systems.

---

## 4. Conclusion & Recommended Architecture

### 4.1 Module Layout for `src-tauri/src/ingest/`
```
src-tauri/src/ingest/
├── mod.rs             # Public exports: IngestionScheduler, IngestProgressPayload, etc.
├── scheduler.rs       # SJF Priority Queue, VIP Preemption, Concurrency Throttling, Worker Pool
├── progress.rs        # Multi-Stage Progress Dispatcher (5% -> 45% -> 90% -> 100%)
├── csv_streamer.rs    # RFC-4180 CSV/TSV Sniffer & Streaming Ingest (Agent 5.1 & 5.2)
├── evtx_parser.rs     # EVTX Rust SIMD Binary Decoder (Agent 5.3)
└── jsonl_streamer.rs  # JSONL/NDJSON Streaming Ingestion (Agent 5.4)
```

### 4.2 Data Structures & Rust Types

#### A. Ingest Priority and Job Descriptor (`scheduler.rs`)
```rust
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

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
}

impl IngestJob {
    /// Strict comparator for Shortest-Job-First (SJF) with VIP promotion and FIFO tie-breaker:
    /// 1. Higher priority first (VIP > Normal)
    /// 2. Smaller file size first (SJF)
    /// 3. Earlier added_time first (FIFO)
    pub fn cmp_sjf(&self, other: &Self) -> Ordering {
        // VIP before Normal
        if self.priority != other.priority {
            return other.priority.cmp(&self.priority);
        }
        // Smallest file first
        if self.file_size != other.file_size {
            return self.file_size.cmp(&other.file_size);
        }
        // Earlier added time first
        if self.added_time_ms != other.added_time_ms {
            return self.added_time_ms.cmp(&other.added_time_ms);
        }
        self.job_id.cmp(&other.job_id)
    }
}
```

#### B. Active Job Handle & Cancellation
```rust
pub struct ActiveJobHandle {
    pub job: IngestJob,
    pub cancellation_token: CancellationToken,
    pub start_time: std::time::Instant,
}
```

#### C. Multi-Stage Progress Payload (`progress.rs`)
```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
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

pub struct ProgressDispatcher {
    app_handle: tauri::AppHandle,
    last_emit: std::sync::Mutex<std::time::Instant>,
}

impl ProgressDispatcher {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self {
            app_handle,
            last_emit: std::sync::Mutex::new(std::time::Instant::now()),
        }
    }

    /// Emit progress event to all windows via Tauri v2 Emitter
    pub fn emit(&self, payload: &IngestProgressPayload) {
        use tauri::Emitter;
        let _ = self.app_handle.emit("toad:ingest-progress", payload);
    }

    /// Throttled emit for Stage 2 (row parsing) to avoid saturating WebView IPC (min 100ms interval)
    pub fn emit_throttled(&self, payload: &IngestProgressPayload) {
        let mut last = self.last_emit.lock().unwrap();
        if last.elapsed().as_millis() >= 100 || payload.percentage >= 100 {
            *last = std::time::Instant::now();
            self.emit(payload);
        }
    }
}
```

#### D. Core Scheduler Engine (`scheduler.rs`)
```rust
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, Notify, RwLock, Semaphore};

pub struct IngestionSchedulerState {
    pub pending: Vec<IngestJob>,
    pub active: HashMap<String, ActiveJobHandle>, // Key: job_id
    pub completed: HashMap<String, IngestJob>,
    pub max_concurrent_files: usize,
    pub max_concurrent_bytes: u64,
}

pub struct IngestionScheduler {
    pub state: Arc<RwLock<IngestionSchedulerState>>,
    pub notify: Arc<Notify>,
    pub worker_semaphore: Arc<Semaphore>,
    pub progress_dispatcher: Arc<ProgressDispatcher>,
    pub ledger: Arc<RwLock<crate::ledger::ParquetLedger>>,
    pub duckdb_pool: Arc<crate::engine::DuckDbEnginePool>,
}
```

### 4.3 Scheduling & Preemption Algorithm

1. **Job Enqueue (`enqueue_file`)**:
   - Compute source file size and modification time.
   - Check if cached Parquet file already exists and is valid (Double-Valid Parquet cache hit). If hit, mark `Ready` instantly (< 2ms) and emit Stage 4 (100%).
   - If cache miss: Create `IngestJob` with `priority = Normal` (or `Vip` if requested).
   - Insert into `pending` and re-sort via `pending.sort_by(|a, b| a.cmp_sjf(b))`.
   - Signal `notify.notify_one()` to wake up the dispatch loop.

2. **Dispatcher Worker Loop (`run_dispatch_loop`)**:
   - Loop on `notify.notified().await`.
   - Calculate current in-flight bytes: `sum(job.file_size for job in active.values())`.
   - Find candidate from `pending`:
     - If `active.is_empty()`: Pick `pending[0]` regardless of size (Exclusive Big File Mode).
     - If `active.len() < max_concurrent_files`: Pick the first candidate where `current_in_flight_bytes + candidate.file_size <= max_concurrent_bytes`.
     - If candidate found: remove from `pending`, insert into `active`, spawn `tokio::spawn` task.

3. **VIP Jump Queue Preemption (`promote_to_vip`)**:
   - Find job in `pending` by `file_id` or `file_path`.
   - Set `job.priority = IngestPriority::Vip`.
   - Re-sort `pending` via `cmp_sjf`. The job immediately moves to index `0` of `pending`.
   - Preemption execution:
     - If an active worker slot is free: dispatch immediately.
     - If all slots are full: Scheduler activates a **Burst Lane** (+1 temporary permit for VIP) to start the file without waiting, ensuring < 30ms latency for the user click!

4. **Cancellation (`cancel_job`)**:
   - If in `pending`: remove from `pending`, mark `Cancelled`, emit `cancelled` progress payload.
   - If in `active`: call `active_handle.cancellation_token.cancel()`. The worker checks token in its loop, aborts, cleans up `.parquet.tmp`, and removes itself from `active`.

### 4.4 4-Stage Ingestion Pipeline Mapping

| Stage | Name | Target % | Backend Activity | Progress Payload |
|---|---|---|---|---|
| **Stage 1** | `sniffing` | `5%` | Sniff file format, encoding, CSV delimiter, EVTX chunk headers | `stage: "sniffing", percentage: 5, rowsIngested: 0, status: "RUNNING"` |
| **Stage 2** | `parsing` | `10% - 80%` (mid: `45%`) | Streaming decode into Arrow RecordBatches, enforce `all_varchar = true` | `stage: "parsing", percentage: 45, rowsIngested: N, status: "RUNNING"` (debounced <= 100ms) |
| **Stage 3** | `writing` | `90%` | Vectorized ZSTD Parquet compression and disk flush | `stage: "writing", percentage: 90, rowsIngested: Total, status: "RUNNING"` |
| **Stage 4** | `ready` | `100%` | Commit Parquet cache, append `FILE_ADDED` to `toad_ledger.parquet` WAL | `stage: "ready", percentage: 100, rowsIngested: Total, status: "READY"` |

### 4.5 IPC Commands Wiring

Add the following commands to `src-tauri/src/commands/mod.rs`:

1. **`toad:ingest_file`** (aliases: `ingestFile`, `ingest_file`):
   - Invokes `state.ingest_scheduler.enqueue_job(project_id, file_path, priority)`.
   - Returns: `{ "jobId": "...", "fileId": "...", "status": "QUEUED", "queuePosition": 0 }`.
2. **`toad:ingest_cancel`** (aliases: `cancelIngest`, `ingest_cancel`):
   - Invokes `state.ingest_scheduler.cancel_job(job_id_or_file_id)`.
   - Returns: `{ "success": true, "message": "Job cancelled" }`.
3. **`toad:ingest_vip`** (aliases: `prioritizeIngest`, `ingest_vip`):
   - Invokes `state.ingest_scheduler.promote_to_vip(file_id_or_path)`.
   - Returns: `{ "success": true, "newQueuePosition": 0, "status": "RUNNING" }`.
4. **`toad:get_ingest_queue`** (aliases: `getIngestQueue`, `get_ingest_queue`):
   - Returns snapshot of active and pending queues:
     `{ "activeJobs": [...], "pendingJobs": [...], "activeCount": 2, "pendingCount": 4, "inFlightBytes": 128000000 }`.

---

## 5. Verification Method

To independently verify the implementation when built by implementation agents:

1. **Unit Test Compilation & Execution (`cargo test` in `src-tauri`)**:
   - `test_sjf_queue_ordering`: Verify that a list of jobs with sizes `[500MB, 10KB, 5MB, 1GB]` orders strictly as `[10KB, 5MB, 500MB, 1GB]`.
   - `test_vip_preemption`: Verify that marking `1GB` as `VIP` jumps it to position `0`, ahead of `10KB`.
   - `test_concurrency_throttling`: Enqueue 10 jobs on a 4-worker limit; verify exactly 4 run concurrently, and subsequent jobs start as earlier ones complete.
   - `test_job_cancellation`: Verify that cancelling an active job triggers the `CancellationToken` and removes `.parquet.tmp`.
   - `test_progress_payload_stages`: Verify that a test ingestion pipeline emits 5% -> 45% -> 90% -> 100% events with correct keys and values.
2. **IPC Integration Test**:
   - Using `window.__TAURI__.core.invoke("toad:get_ingest_queue")` returns valid JSON with `activeJobs` and `pendingJobs`.
   - Listening to `window.__TAURI__.event.listen("toad:ingest-progress")` captures four sequential events per ingested file.
