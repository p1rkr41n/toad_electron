# Dispatch Task: Milestone 3 Implementation (Squad 3: DuckDB Engine & Arrow IPC Protocol)

## Identity & Role
- **Archetype**: `teamwork_worker`
- **Role**: Rust Core Engine & Arrow IPC Worker
- **Working Directory**: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m3_engine\`
- **Parent Conversation ID**: `07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d`

## Authoritative Context & Scope
Read these documents completely before beginning:
1. `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`
2. `d:\Shared_UserData\Downloads\tad\PROJECT.md`
3. Milestone 3 Architecture & Specification Handsoffs:
   - `d:\Shared_UserData\Downloads\tad\.agents\teamwork\specminer_m3\handoff.md`
   - `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m3_compiler\handoff.md`
   - `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m3_duckdb\handoff.md`
4. Test Suites to satisfy:
   - `tauri/project/tests/test_tauri_arrow_ipc.js`
   - `tauri/project/tests/test_e2e_features.js`
   - `tauri/project/src-tauri/tests/`

## Exclusive Write Ownership
You exclusively own and may edit ONLY the following files:
- `tauri/project/src-tauri/Cargo.toml`
- `tauri/project/src-tauri/src/engine/` (`mod.rs`, `duckdb_pool.rs`, `query_compiler.rs`, `arrow_encoder.rs`, `fast_count.rs`, `schema_mapper.rs`, `stats_cache.rs`)
- `tauri/project/src-tauri/src/commands/query.rs`
- `tauri/project/src-tauri/src/commands/mod.rs`
- `tauri/project/src-tauri/src/state.rs`
- `tauri/project/src-tauri/src/lib.rs` (or `main.rs` if needed for state initialization)
- `tauri/project/src-tauri/tests/engine_tests.rs`
- `tauri/project/src-tauri/tests/mod.rs` (if registering new test files)

Do NOT modify any files outside this list.

## Core Implementation Requirements
1. **Dependency Alignment (`Cargo.toml`)**:
   - Align `arrow` and `parquet` with DuckDB's native version:
     `duckdb = { version = "1.2.2" }` (or `version = "1.0"` if using system/bundled duckdb library)
     `arrow = { version = "54", default-features = false, features = ["ipc"] }`
     `parquet = { version = "54", default-features = false }`
   - Ensure `cargo check` and `cargo test` compile cleanly on Windows without duplicate/ambiguous `arrow` versions.

2. **In-Process Tokio Async DuckDB Connection Pool (`src/engine/duckdb_pool.rs`)**:
   - Dual-engine separation:
     - Dedicated `ui_conn` for low-latency interactive UI queries (`toad:eval_query`, `toad:row_count`, `toad:schema`).
     - Worker pool (`ingest_pool`) for background ingestion pipelines (CSV, EVTX, JSONL).
   - Use `tokio::task::spawn_blocking` to execute DuckDB statements without blocking the Tokio reactor.
   - Configure PRAGMAs: `PRAGMA threads`, `PRAGMA max_memory`, `PRAGMA preserve_insertion_order = true`.

3. **QueryExp AST Compiler (`src/engine/query_compiler.rs`)**:
   - Implement Rust AST structs deserializing both canonical reltab AST (`{ "operator": "...", ... }`) and test shorthand (`{ "expType": "...", ... }`).
   - Implement recursive SQL compiler supporting: `table`, `sql`, `project`, `filter`, `groupBy`, `sort`, `extend`, `join`, `concat`.
   - Implement forensic path normalization: slashes in terms trigger `REGEXP_REPLACE(col::VARCHAR, '[\\/]+', '/', 'g')`.
   - Implement pattern escaping: escape `%`, `_`, `\` with `ESCAPE '\\'`.
   - Implement DuckDB aggregate emulation: `uniq` -> `CASE WHEN MIN(col) = MAX(col) THEN MIN(col) ELSE NULL END`.
   - Support `OmniSearchRelExp` across non-hidden columns.
   - Support `compile_count()` wrapping query in `SELECT COUNT(*) AS "rowCount" FROM (...)`.

4. **Streaming Arrow IPC Protocol Encoder (`src/engine/arrow_encoder.rs`)**:
   - Serialize `duckdb::arrow::record_batch::RecordBatch` into binary Arrow IPC stream.
   - Every binary response MUST begin with the 4-byte continuation indicator: `0xFF, 0xFF, 0xFF, 0xFF`.
   - Embed custom metadata `"toadSchema"` -> `JSON.stringify(reltab_schema)` into the Arrow schema.
   - Support 0-row empty tables cleanly.
   - Deliver binary output via `tauri::ipc::Response::new(buffer)`.

5. **Fast O(1) Parquet Row Counter (`src/engine/fast_count.rs`)**:
   - Read Parquet metadata footer (`num_rows`) directly in < 1ms using `parquet` crate reader or `parquet_metadata` SQL function.
   - Fall back gracefully to `SELECT COUNT(*)` on DuckDB connection for virtual/filtered tables.

6. **Schema & Stats Mappers (`src/engine/schema_mapper.rs`, `src/engine/stats_cache.rs`)**:
   - Map DuckDB data types to Reltab kinds (`integer`, `real`, `text`, `boolean`, `timestamp`, `blob`).
   - Implement in-memory `StatsCache` with TTL (10 min) and LRU eviction (cap 256).

7. **Router Integration (`src/commands/query.rs` & `src/commands/mod.rs`)**:
   - Wire `toad:eval_query`, `toad:row_count`, `toad:schema`, `toad:run_sql_arrow`, `toad:get_table_name` to genuine DuckDB engine operations.
   - Respect the anti-hijacking architecture: never intercept native plugin commands.

## Mandatory Anti-Cheating Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Jujutsu Version Control Standards
- Default VCS is Jujutsu (`jj`). System Cargo Bin: `C:\Users\huydq\.cargo\bin\jj.exe`, Workspace Tool: `tools/jj/jj.exe`.
- Commit under author identity:
  `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`
- Clear, professional English commit message.
- Strictly local builds and commits; NEVER run `git push` or call GitHub Release APIs.

## Verification Requirements
Before writing `handoff.md`, run:
1. `cargo test --manifest-path tauri/project/src-tauri/Cargo.toml` (100% pass).
2. `node tauri/project/tests/test_tauri_arrow_ipc.js` (100% pass).
3. `node tauri/project/tests/test_e2e_features.js` (100% pass).
4. `jj status` and `jj log -n 3` documenting commit ID.


## 2026-11-04T21:04:09Z
You are worker_m3_engine, assigned to Milestone 3 (Squad 3: DuckDB Engine & Arrow IPC Protocol).
Working directory: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m3_engine\
Parent conversation ID: 07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d

## 2026-11-04T21:19:04Z
**Context**: Milestone 3 Implementation (DuckDB Engine & Arrow IPC Protocol)
**Content**: Checking in on your implementation progress. We see the engine modules and command handlers in `src/engine/` and `src/commands/`. Are you currently running `cargo test` and node verification suites? Please update your `progress.md` with current activity.
**Action**: Report status and update `progress.md`.
