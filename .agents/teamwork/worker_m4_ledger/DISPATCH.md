# Dispatch — Worker M4 Ledger & Workspace Engine (2026-11-05T05:17:00Z)

## Objective
Implement Milestone 4 (Squad 4: Parquet State Ledger WAL & Workspace Engine) covering features F13–F17.

## References & Inputs
1. `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md` (MANDATORY TO READ FIRST)
2. `d:\Shared_UserData\Downloads\tad\PROJECT.md`
3. Explorer Reports:
   - `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m4_ledger\handoff.md`
   - `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m4_reconcile\handoff.md`
   - `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m4_workspace\handoff.md`
4. C:\Users\huydq\.gemini\antigravity\brain\4cd78c02-c356-4448-bdfe-f2930e55fb29\ke_hoach_trien_khai_50_subagents_tauri_v2.md (Squad 4)

## Write Ownership
You exclusively own:
- `tauri/project/src-tauri/src/ledger/mod.rs`
- `tauri/project/src-tauri/src/ledger/parquet_ledger.rs`
- `tauri/project/src-tauri/src/ledger/tombstone.rs`
- `tauri/project/src-tauri/src/ledger/reconciliation.rs`
- `tauri/project/src-tauri/src/ledger/cache_cleaner.rs`
- `tauri/project/src-tauri/src/commands/workspace.rs`
- Modifications to:
  - `tauri/project/src-tauri/src/lib.rs` (expose `pub mod ledger;`)
  - `tauri/project/src-tauri/src/state.rs` (replace `ParquetLedgerPlaceholder` with genuine `ParquetLedger`)
  - `tauri/project/src-tauri/src/commands/mod.rs` (replace hardcoded stubs with real calls to `workspace::*`)
- Tests in `tauri/project/src-tauri/tests/`:
  - `tests/ledger_wal_tests.rs`
  - `tests/reconciliation_tests.rs`
  - `tests/workspace_commands_tests.rs`

## Key Requirements & Architecture
1. **F13: Parquet State Ledger WAL (`src/ledger/parquet_ledger.rs`)**:
   - Manages `toad_ledger.parquet` in `app_data_dir` via Copy-on-Append with atomic rename (`.tmp_<timestamp>_<uuid>`).
   - 16-field strongly typed schema with backward compatibility aliases for legacy ledgers (`source_path`, `source_size`, `extra_json`).
   - Thread-safe `Arc<RwLock<LedgerState>>` in-memory projection for <1ms queries.
2. **F14: Tombstones & Zombie Isolation (`src/ledger/tombstone.rs`)**:
   - `PROJECT_DELETED` and `FILE_DELETED` events recorded with typed NULLs.
   - When building in-memory state, tombstones unconditionally purge active project/file entries so they never reappear.
   - Zero-cost project rename (updates project name in metadata without moving `temp/<project_id>/`).
3. **F15: Startup Reconciliation Engine (`src/ledger/reconciliation.rs`)**:
   - Handles the 6 crash/startup recovery scenarios in <5ms:
     1. Clean startup (<2.5ms)
     2. Missing source file (mark `MISSING` / offline cache preserved, no crash)
     3. Orphan Parquet cache purge
     4. Write crash / interrupted ledger (Dual-valid backup `.bak` recovery + salvage)
     5. Missing ledger on initial run (create schema + `Untitled-1` in <2ms)
     6. All projects deleted (debounce 500ms auto-recovery creating `Untitled-1`)
4. **F16: Cascade Cache Cleaner (`src/ledger/cache_cleaner.rs`)**:
   - Drops DuckDB views for project.
   - Atomically renames `temp/<project_id>/` to `temp/.trash_<project_id>_<timestamp>/` (avoids Windows `EBUSY` file locking).
   - Asynchronously unlinks trash directory with retry backoff.
5. **F17: Workspace CRUD Commands (`src/commands/workspace.rs` & `commands/mod.rs`)**:
   - Implements all 14 `project:*` commands (`get_workspace`, `get_files`, `add_files`, `add_folder`, `delete`, `delete_all`, `rename`, `create`, `set_active`, `reconcile`, `get_cache_size`, `purge_cache`, `remove_file`, `move_orphan_files`).
   - Full DTO compatibility with Frontend `ProjectWorkspaceManager.ts` and `PROJECT.md`.

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Jujutsu VCS & Verification
- Test all implementations:
  `cargo check --manifest-path tauri/project/src-tauri/Cargo.toml`
  `cargo test --manifest-path tauri/project/src-tauri/Cargo.toml`
  `node tauri/project/tests/run_all_tests.js`
- Record clean Jujutsu commit:
  `jj describe -m "feat(ledger): implement Parquet WAL, startup reconciliation, and workspace CRUD"`
  Under identity `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`.
- Deliver `handoff.md` in `.agents/teamwork/worker_m4_ledger/handoff.md` with full test evidence and jj commit id.


## 2026-11-04T22:17:40Z
You are Worker for Milestone 4 (Squad 4: Parquet State Ledger WAL & Workspace Engine).
Read `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md` (MANDATORY TO READ FIRST).
Read `d:\Shared_UserData\Downloads\tad\PROJECT.md`.
Read your detailed dispatch instructions at `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m4_ledger\DISPATCH.md`.
Read the explorer reports:
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m4_ledger\handoff.md`
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m4_reconcile\handoff.md`
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m4_workspace\handoff.md`
Your working directory is `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m4_ledger/`.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Implement:
1. `src-tauri/src/ledger/mod.rs`
2. `src-tauri/src/ledger/parquet_ledger.rs` (Parquet WAL, copy-on-append, 16-field schema, in-memory projection)
3. `src-tauri/src/ledger/tombstone.rs` (Typed NULL tombstones, zero-cost rename)
4. `src-tauri/src/ledger/reconciliation.rs` (6 startup recovery scenarios in <5ms, SSOT ledger)
5. `src-tauri/src/ledger/cache_cleaner.rs` (atomic directory rename to .trash_*, async purge with retry backoff)
6. `src-tauri/src/commands/workspace.rs` (implementing all 14 project:* commands)
7. Update `src-tauri/src/commands/mod.rs`, `src-tauri/src/state.rs`, `src-tauri/src/lib.rs`
8. Comprehensive automated test suites in `src-tauri/tests/`: `ledger_wal_tests.rs`, `reconciliation_tests.rs`, `workspace_commands_tests.rs`

Verify:
- `cargo check --manifest-path tauri/project/src-tauri/Cargo.toml`
- `cargo test --manifest-path tauri/project/src-tauri/Cargo.toml --verbose`
- `node tauri/project/tests/run_all_tests.js`
Record Jujutsu commit under identity `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>` with professional English message.
Write detailed handoff report to `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m4_ledger\handoff.md` and report completion back via send_message.
