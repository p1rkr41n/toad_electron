# Dispatch: Explorer M5 Ingestion Scheduler & Progress Dispatcher (Squad 5)

## 2026-11-05T06:53:00Z
**Mission**: Explore and map the implementation architecture for the Shortest-Job-First (SJF) Ingestion Queue, VIP Jump Queue Preemption, and Multi-Stage Progress Dispatcher (`src-tauri/src/ingest/scheduler.rs` and `progress.rs`).

**Reference Documents**:
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md` (MANDATORY: read first)
- `d:\Shared_UserData\Downloads\tad\PROJECT.md`
- `C:\Users\huydq\.gemini\antigravity\brain\4cd78c02-c356-4448-bdfe-f2930e55fb29\ke_hoach_trien_khai_50_subagents_tauri_v2.md` (§ Squad 5, Agents 5.5, 5.6, 5.7)
- `tauri/project/src-tauri/src/commands/` and `src-tauri/src/state.rs`

**Specific Investigation Tasks**:
1. **Shortest-Job-First (SJF) Queue Architecture**:
   - Priority queue ordering by file size (smallest files first for fast UI feedback).
   - Concurrency throttling (e.g. 4 worker threads or Tokio tasks) avoiding disk I/O thrashing.
2. **VIP Jump Queue Preemption**:
   - When user clicks a pending file, preemption promotes it to priority #1 ahead of other queued files.
   - Cancellation handling for in-flight or queued jobs.
3. **Multi-Stage Progress Dispatcher**:
   - Tauri event emission (`toad:ingest-progress` or `Channel<IngestProgressPayload>`):
     - Stage 1: `5%` - Reading source file & sniffing format.
     - Stage 2: `45%` - Converting / parsing rows.
     - Stage 3: `90%` - Writing compressed Parquet cache.
     - Stage 4: `100%` - Ready (WAL updated, UI notified).
   - Struct definition for `IngestProgressPayload`:
     `{ fileId: String, filePath: String, stage: String, percentage: u8, rowsIngested: u64, elapsedMs: u64, status: String }`.
4. **IPC Commands Wiring**:
   - `toad:ingest_file`, `toad:ingest_cancel`, `toad:ingest_vip`, `toad:get_ingest_queue`.
   - Thread-safe coordination with `AppState` and Tokio runtime.

**Output Deliverables**:
Write a comprehensive investigation report to:
`d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m5_scheduler\handoff.md`
Report must contain: Observation, Logic Chain, Caveats, Conclusion, and Recommended Implementation Strategy.
Do NOT modify or write any production source code — read-only exploration only.
