# BRIEFING — 2026-11-05T07:10:00Z

## Mission
Explore and design the architecture for Shortest-Job-First (SJF) Ingestion Queue, VIP Jump Queue Preemption, and Multi-Stage Progress Dispatcher for Toad Tauri v2 backend.

## 🔒 My Identity
- Archetype: explorer
- Roles: Ingestion Scheduler & Progress Dispatcher Explorer
- Working directory: d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m5_scheduler
- Original parent: 07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d
- Milestone: Squad 5 (Ingestion Scheduler & Progress Dispatcher, Agents 5.5, 5.6, 5.7)

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Zero production code edits
- Output report in handoff.md with 5 components (Observation, Logic Chain, Caveats, Conclusion, Verification Method)
- English-only reporting

## Current Parent
- Conversation ID: 07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d
- Updated: 2026-11-05T07:10:00Z

## Investigation State
- **Explored paths**:
  - `tauri/project/src-tauri/src/state.rs` (Placeholder for IngestionQueue)
  - `tauri/project/src-tauri/src/commands/mod.rs` (Command dispatcher & IPC routing)
  - `tauri/project/src-tauri/src/commands/workspace.rs` (Workspace file addition & ledger connection)
  - `tauri/project/src-tauri/src/ledger/parquet_ledger.rs` (LedgerEvent WAL and Parquet cache naming)
  - `tauri/project/src-tauri/src/engine/duckdb_pool.rs` (Worker connections and semaphore throttling)
  - `tauri/project/src-tauri/src/portable.rs` (ToadGeneralConfig `max_concurrent_files` & `max_concurrent_gb`)
  - `tad-master/packages/toadviewer/src/MultipleLoadingManager.ts` (Legacy frontend SJF, VIP prioritization, and 1s polling loop)
  - `tad-master/packages/host-bridge/src/commandAliases.ts` & `TauriHostAdapter.ts` (IPC alias maps and event listener)
- **Key findings**:
  - Legacy frontend managed queue client-side; Tauri v2 architecture moves queuing, SJF scheduling, and worker throttling natively into Rust Tokio runtime.
  - Concurrency throttling requires dual bounds: max files (default 4) and in-flight bytes (default 1GB) with Exclusive Big File Mode.
  - VIP preemption is best implemented via Burst Lane (+1 slot) and head-of-queue priority swap.
  - Progress dispatcher must emit 4 stages (5% Sniffing, 45% Parsing, 90% Writing, 100% Ready) debounced at <= 100ms over `toad:ingest-progress` event.
  - 4 IPC commands required: `toad:ingest_file`, `toad:ingest_cancel`, `toad:ingest_vip`, `toad:get_ingest_queue`.
- **Unexplored areas**: None. All tasks explored in depth.

## Key Decisions Made
- Formulate comprehensive 5-component handoff report detailing exact Rust structs, algorithms, cancellation mechanics, and code wiring recommendations for implementation agents (5.5, 5.6, 5.7).

## Artifact Index
- handoff.md — Final investigation report
- progress.md — Heartbeat log
- BRIEFING.md — Situational awareness
