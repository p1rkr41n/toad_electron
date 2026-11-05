# Project: Toad Tauri v2 Migration (TOAD-TAURI-V2)

## Architecture
Toad v2.5.2 is an enterprise-grade forensic data analysis and log exploration tool, re-engineered from Electron into a high-performance Windows desktop application using **Tauri v2**.

- **Frontend (`tauri/project/dist/`):** React 18, Vite 5, virtualized SlickGrid, pivot table, ArcSight ESM filter, Slate Dark Theme, and pure Web Canvas UI.
- **IPC Protocol (`packages/host-bridge`):** `TauriHostAdapter` connecting to `window.__TAURI__.core.invoke` and `invokeBinary`, transmitting tabular query results as streaming binary **Apache Arrow IPC Stream** (`0xFFFFFFFF` continuation indicator) via `tauri::ipc::Response`.
- **Backend Core (`tauri/project/src-tauri/`):** 100% Native Rust built on in-process Tokio async.
  - **DuckDB 1.0 Engine:** Bundled C++ static link with dual-engine connection isolation (`ui_conn` for UI queries, `ingest_pool` for background ingestion).
  - **Forensics Ingestion:** RFC-4180 CSV/TSV streaming sniffer (`all_varchar = true` assertion protection), Rust SIMD `evtx` binary decoder, and dynamic JSONL/NDJSON parser.
  - **Parquet State Ledger WAL:** Append-only `toad_ledger.parquet` state ledger with 6 startup reconciliation scenarios, tombstone isolation, cascade cache cleanup, and 500ms debounce `Untitled-1` recovery.
  - **Portable Isolation:** Detects adjacent directory, self-contained in `toadAppData_[5chars]` (`temp/`, `logs/`, `config.ini`, `toad_ledger.parquet`).
  - **Packaging:** Standalone executable `Toad-2.5.2-x64-portable.exe` (< 50MB) and compressed archive in `releases/` under author `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F01 | Toolchain & .gitignore Un-ignore | Reconfigure root `.gitignore` to un-ignore `!tauri/project` while strictly ignoring `target/`, `node_modules/`, `dist/`. Track with Jujutsu `jj`. | M1 | survey |
| F02 | Tauri v2 Scaffolding & Manifests | Setup `package.json`, `vite.config.ts`, `src-tauri/Cargo.toml`, `tauri.conf.json`, `capabilities/default.json`. | M1 | survey |
| F03 | Portable Directory & Config Manager | Create `toadAppData_[5chars]` adjacent to `.exe`, manage `config.ini`, clean `temp/`. | M2 | survey |
| F04 | Concurrency AppState & Panic Guard | Thread-safe `AppState` with `Arc<RwLock<...>>`, `tracing-subscriber` logging, panic-to-JSON error guard. | M2 | survey |
| F05 | Native Tauri Plugins Integration | Single-instance (registered first, CLI args forwarding), window-state, dialog, opener, clipboard-manager. | M2 | survey |
| F06 | IPC Command Router & Aliases | Support namespaced (`toad:*`, `project:*`) and direct aliases (`evalQuery`, `rowCount`, etc.) in Rust router. | M2 | survey |
| F07 | DuckDB 1.0 In-Process Connection Pool | Bundled DuckDB 1.0 with dual-engine driver: dedicated UI query connection and ingestion worker pool. | M3 | survey |
| F08 | QueryExp AST to SQL Compiler | Translate JSON `QueryExp` (filters, sorts, aggregations) to optimized DuckDB SQL. | M3 | survey |
| F09 | Binary Arrow IPC Streaming Encoder | Serialize DuckDB `RecordBatch` to binary Arrow IPC Stream (`0xFFFFFFFF` marker) via `tauri::ipc::Response`. | M3 | survey |
| F10 | O(1) Parquet Metadata Row Counter | Read Parquet footer metadata `SUM(row_group_num_rows)` in ~25ms without table scan. | M3 | survey |
| F11 | Schema & Logical Type Mapper | Map DuckDB types to `reltab.Schema` DTO with embedded `toadSchema` in Arrow schema metadata. | M3 | survey |
| F12 | Stats Cache & Dynamic Resources | ArcSight column distinct/min/max stats cache, thread and RAM budget allocation. | M3 | survey |
| F13 | Double-Valid Parquet State Ledger WAL | Append-only `toad_ledger.parquet` WAL storing workspace project and file state. | M4 | survey |
| F14 | Tombstone Rows & Purge Engine | Permanent isolation of deleted files (`FILE_DELETED`) and projects (`PROJECT_DELETED`). | M4 | survey |
| F15 | Startup Reconciliation & Recovery | 6-scenario reconciliation on boot (<5ms) and 500ms debounce auto-creation of `Untitled-1`. | M4 | survey |
| F16 | Cascade Cache Purge Engine | Auto-delete `*_cached_*.parquet` files in `temp/` upon project deletion to reclaim disk space. | M4 | survey |
| F17 | Multi-Project CRUD & In-Place Rename | Implement `project:get_workspace`, `get_files`, `add_files`, `delete`, and zero-copy rename. | M4 | survey |
| F18 | RFC-4180 CSV/TSV Streaming Ingest | Delimiter auto-detection (comma, tab, semicolon), `csv.gz` support, `all_varchar = true` guard. | M5 | survey |
| F19 | EVTX Rust SIMD Binary Decoder | High-speed binary Windows Event Log decoding via `evtx` crate into structured JSONL/Parquet. | M5 | survey |
| F20 | JSONL/NDJSON Stream Ingestion | Dynamic schema parsing, unnesting, and compressed Parquet output. | M5 | survey |
| F21 | SJF Ingestion Queue & VIP Preemption | Shortest-job-first scheduling, concurrency throttling, and VIP jump-to-front preemption. | M5 | survey |
| F22 | Multi-Stage Progress Dispatcher | Emit structured progress events (5% -> 45% -> 90% -> 100%) via `tauri::ipc::Channel`. | M5 | survey |
| F23 | Frontend Porting & Vite 5 Bundling | Port `toadviewer` into `tauri/project/src/`, configure Vite 5 bundle with `~` alias resolver. | M6 | survey |
| F24 | Host Bridge Activation (`dataPort = true`) | Configure `TauriHostAdapter` to bind `window.__TAURI__.core.invoke` and activate `invokeBinary`. | M6 | survey |
| F25 | Zero-Copy Arrow IPC Decoder | Direct decoding of binary Arrow IPC bytes into SlickGrid data models via `@apache-arrow/es2015-cjs`. | M6 | survey |
| F26 | UI Ergonomics & Dynamic Auto-Wrap | Dynamic N-line cell wrap ($N \le 1$: flat 24px, $2 \le N \le 5$: $N \times 17\text{px}+8\text{px}$, $N > 5$: capped 93px). | M6 | survey |
| F27 | Active Cell Glow Suppression | `GridOverlayBus` and `body.bp4-overlay-open` suppression of cell glow behind modal overlays. | M6 | survey |
| F28 | ArcSight ESM Filter & Pivot UI | Integrated condition tree query editor, pill inputs, and master-detail drawer. | M6 | survey |
| F29 | Rust Core Unit & Command Tests | 100% passing `cargo test` in `src-tauri` for engine, AST compiler, ledger, and parsers. | M7 | survey |
| F30 | Arrow IPC Stream QA Suite | `node tests/test_tauri_arrow_ipc.js` roundtrip verification with 100% bit accuracy. | M7 | survey |
| F31 | 100K Rows Concurrency & Stress Tests | `node tests/test_grid_scroll_stress.js` validating FPS > 55, memory leak < 25MB. | M7 | survey |
| F32 | Production Portable Packaging Script | `tools/package_portable.ps1` compiling standalone `Toad-2.5.2-x64-portable.exe` (< 50MB) and `.zip`. | M7 | survey |
| F33 | Release Verification & SHA256SUMS | Zero-duplicate binary check, PE branding `HelloKittyXamKinLung`, and `SHA256SUMS.txt`. | M7 | survey |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Scaffolding, Toolchain & Jujutsu Setup | F01, F02 | none | DONE |
| M2 | Rust Core Engine & OS Plugins | F03, F04, F05, F06 | M1 | DONE |
| M3 | DuckDB Engine & Arrow IPC Protocol | F07, F08, F09, F10, F11, F12 | M2 | DONE |
| M4 | Parquet State Ledger WAL & Workspace | F13, F14, F15, F16, F17 | M2, M3 | DONE |
| M5 | Forensics & Ingestion Pipelines | F18, F19, F20, F21, F22 | M3, M4 | DONE |
| M6 | Frontend Porting & Host Bridge Integration | F23, F24, F25, F26, F27, F28 | M1, M3, M4 | DONE |
| M7 | E2E Verification, Packaging & Release Audit | F29, F30, F31, F32, F33 | M1-M6 | BLOCKED: Auditor INTEGRITY VIOLATION (missing PE .rsrc section, test flakiness) |


## Interface Contracts

### 1. Frontend (`TauriHostAdapter.ts`) ↔ Rust Command Router (`src-tauri/src/commands/mod.rs`)
- **Query Evaluation (`toad:eval_query` / `evalQuery`):**
  - Input: `{ queryExp: QueryExpJson, offset?: number, limit?: number }`
  - Output: `tauri::ipc::Response` containing binary Apache Arrow IPC Stream starting with `0xFFFFFFFF`, schema metadata with JSON stringified `toadSchema`.
- **Row Count (`toad:row_count` / `rowCount`):**
  - Input: `{ queryExp: QueryExpJson }`
  - Output: `{ rowCount: number }`
- **Schema (`toad:schema` / `getTableSchema`):**
  - Input: `{ tableName: string }`
  - Output: `reltab.Schema` DTO (`{ columns: string[], columnTypes: Record<string, string>, ... }`)
- **Arbitrary SQL (`toad:run_sql_arrow`):**
  - Input: `{ sql: string }`
  - Output: `tauri::ipc::Response` with binary Arrow IPC Stream.
- **Workspace CRUD (`project:*`):**
  - `project:get_workspace` -> `{ activeProjectId: string, projects: ProjectItem[] }`
  - `project:get_files` -> `{ projectId: string }` -> `{ files: FileItem[] }`
  - `project:add_files` -> `{ projectId: string, filePaths: string[] }` -> `{ addedFiles: FileItem[] }`
  - `project:delete` -> `{ projectId: string }` -> `{ success: boolean }`
  - `project:rename` -> `{ projectId: string, newName: string }` -> `{ success: boolean }`

### 2. Ingestion Engine ↔ Frontend Streaming Events
- **Event Name:** `toad:ingest-progress` (or `tauri::ipc::Channel<IngestProgressPayload>`)
- **Payload:**
  ```json
  {
    "fileId": "uuid-v4",
    "filePath": "C:\\path\\to\\file.evtx",
    "stage": "parsing",
    "percentage": 45,
    "rowsIngested": 150000,
    "elapsedMs": 320,
    "status": "RUNNING"
  }
  ```

### 3. Parquet State Ledger WAL (`toad_ledger.parquet`)
- Schema:
  `event_id: STRING`, `event_type: STRING`, `timestamp: TIMESTAMP`, `project_id: STRING`, `project_name: STRING`, `source_path: STRING`, `source_size: INT64`, `source_mtime: INT64`, `parquet_path: STRING`, `parquet_size: INT64`, `row_count: INT64`, `status: STRING`, `duration_ms: INT64`, `extra_json: STRING`.

## Code Layout
```
tauri/project/
├── package.json
├── vite.config.ts
├── index.html
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/       # Virtualized SlickGrid, Pivot, ArcSight ESM
│   └── styles/           # Less and Sass stylesheets
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   │   └── default.json
│   └── src/
│       ├── main.rs
│       ├── lib.rs
│       ├── state.rs
│       ├── portable.rs
│       ├── logger.rs
│       ├── commands/
│       │   ├── mod.rs
│       │   ├── query.rs
│       │   └── project.rs
│       ├── engine/
│       │   ├── duckdb_pool.rs
│       │   ├── query_compiler.rs
│       │   ├── arrow_encoder.rs
│       │   ├── fast_count.rs
│       │   └── schema_mapper.rs
│       ├── ledger/
│       │   ├── parquet_ledger.rs
│       │   ├── tombstone.rs
│       │   └── reconciliation.rs
│       └── ingest/
│           ├── csv_streamer.rs
│           ├── evtx_parser.rs
│           ├── jsonl_streamer.rs
│           └── scheduler.rs
├── tests/
│   ├── test_tauri_arrow_ipc.js
│   └── test_grid_scroll_stress.js
├── tools/
│   └── package_portable.ps1
└── releases/
    ├── Toad-2.5.2-x64-portable.exe
    ├── Toad-2.5.1-x64-portable.zip
    └── SHA256SUMS.txt
```
