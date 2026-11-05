# Dispatch: Worker M5 Forensics & Ingestion Pipelines (Squad 5)

## 2026-11-05T07:04:00Z

**Mission**: Implement the complete Forensics & Ingestion subsystem for Toad Tauri v2 in `tauri/project/src-tauri/src/ingest/` based on the architectural findings of Explorers 5.1, 5.3, 5.5, and the approved plan.

**Reference Documents**:
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md` (MANDATORY: read first)
- `d:\Shared_UserData\Downloads\tad\PROJECT.md`
- `C:\Users\huydq\.gemini\antigravity\brain\4cd78c02-c356-4448-bdfe-f2930e55fb29\ke_hoach_trien_khai_50_subagents_tauri_v2.md` (§ Squad 5, Agents 5.1–5.8)
- Explorer reports:
  - `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m5_csv\handoff.md`
  - `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m5_evtx\handoff.md`
  - `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m5_scheduler\handoff.md`

**Exclusive Write Ownership**:
- `tauri/project/src-tauri/src/ingest/` (all files: `mod.rs`, `csv_streamer.rs`, `evtx_parser.rs`, `jsonl_streamer.rs`, `dirty_log.rs`, `scheduler.rs`, `progress.rs`)
- `tauri/project/src-tauri/src/commands/ingest.rs` and router registration in `commands/mod.rs`
- `tauri/project/src-tauri/src/state.rs` (replace `IngestionQueuePlaceholder` with `Arc<IngestionScheduler>`)
- `tauri/project/src-tauri/tests/ingest_tests.rs`
- `tauri/project/src-tauri/Cargo.toml` (if needed)

**Implementation Scope (Features F18–F22)**:
1. **RFC-4180 CSV/TSV Streaming Ingest (`csv_streamer.rs`)**:
   - Delimiter sniffer across `[',', '\t', ';', '|']` using line consistency scoring.
   - DuckDB 3-tier fallback matrix with `all_varchar = true`, `null_padding = true`, `sample_size = 100000`, and `parallel = false`.
   - Streaming into compressed Parquet (`_cached_<hash>.parquet`) in `temp/<project_id>/`.
2. **EVTX Forensics Parser (`evtx_parser.rs`)**:
   - High-speed SIMD `evtx = "0.8.5"` binary parser running in `tokio::task::spawn_blocking`.
   - Direct streaming to Arrow `RecordBatch`es (32K batch size) into `parquet::arrow::ArrowWriter` with Snappy compression (<30MB flat RAM, zero temp disk churn).
   - 9-column typed schema (`record_id`, `time_created`, `event_id`, `provider_name`, `level`, `channel`, `computer`, `user_id`, `payload_json`).
   - Resilient value extractors handling polymorphic `EventID` (int vs object with `#text`) and corrupted chunk recovery.
3. **JSONL / NDJSON Stream Ingest (`jsonl_streamer.rs`)**:
   - Streaming line reader and dynamic DuckDB `read_json_auto` introspection.
   - Dynamic schema unnesting into dot-notated columns streaming to Parquet cache.
4. **Dirty Log Fallback (`dirty_log.rs`)**:
   - Fallback engine for unparseable / unstructured logs producing `raw_event VARCHAR`, `line_number BIGINT`, `timestamp TIMESTAMP`.
5. **SJF Ingestion Scheduler (`scheduler.rs`)**:
   - Shortest-Job-First priority queue ordering: `VIP (true > false) -> file_size (ascending) -> added_time_ms (FIFO)`.
   - Dual-bound concurrency throttling: `max_concurrent_files` (4) and `max_concurrent_bytes` (1.0 GB), with Exclusive Big File Mode for files > 1.0 GB when idle.
   - VIP preemption with Burst Lane (+1 permit) for instant click responsiveness.
   - Cooperative cancellation via `tokio_util::sync::CancellationToken` cleaning up scratch `.tmp` files.
6. **Multi-Stage Progress Dispatcher (`progress.rs`)**:
   - Emits structured events over `toad:ingest-progress`:
     - Stage 1: `5%` (sniffing format)
     - Stage 2: `45%` (parsing rows, debounced <= 100ms)
     - Stage 3: `90%` (writing Parquet)
     - Stage 4: `100%` (ready, WAL updated)
   - Payload: `{ fileId, filePath, stage, percentage, rowsIngested, elapsedMs, status }`.
7. **IPC Commands Wiring (`commands/ingest.rs` & `commands/mod.rs`)**:
   - `toad:ingest_file`, `toad:ingest_cancel`, `toad:ingest_vip`, `toad:get_ingest_queue`.
8. **Parquet State Ledger WAL Integration**:
   - Updates `toad_ledger.parquet` with `FILE_INGESTED` / `FILE_MODIFIED` events (`status: "READY"`, row count, parquet path, size).

**Version Control & Identity**:
- Local Jujutsu commits: `tools/jj/jj.exe describe` / `commit`
- Author: strictly `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`
- Professional English commit message (e.g. `feat(ingest): implement CSV/TSV sniffer, EVTX SIMD parser, and SJF scheduler (Milestone 5)`).
- Strictly local builds — NO remote git push.

**Verification Commands Required**:
- `cargo check --manifest-path tauri/project/src-tauri/Cargo.toml`
- `cargo test --manifest-path tauri/project/src-tauri/Cargo.toml --test ingest_tests`
- Full `cargo test --manifest-path tauri/project/src-tauri/Cargo.toml` (all existing 100 tests must still pass)
- Node test runner: `& "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tauri/project/tests/run_all_tests.js`

**MANDATORY INTEGRITY WARNING**:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Deliver complete report to:
`d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m5_ingest\handoff.md`
Report completion via `send_message` to parent (`07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d`).
