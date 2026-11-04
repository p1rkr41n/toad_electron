# Dispatch — Worker M4 Remediation (2026-11-05T06:24:00Z)

## Objective
Implement remediation fixes for Milestone 4 (Squad 4: Parquet State Ledger WAL & Workspace Engine) resolving the 3 Challenger findings:
1. Windows NTFS EBUSY open file handle failure in `CacheCleaner::purge_project_cache`.
2. Startup reconciliation latency optimization (< 5ms) in `parquet_ledger.rs` (`read_all_events_from_parquet`).
3. Automated `duckdb.dll` placement for release builds in `build.rs`.

## References & Inputs (MANDATORY TO READ FIRST)
1. `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`
2. `d:\Shared_UserData\Downloads\tad\PROJECT.md`
3. Challenger Reports:
   - `d:\Shared_UserData\Downloads\tad\.agents\teamwork\challenger_m4_1\handoff.md`
   - `d:\Shared_UserData\Downloads\tad\.agents\teamwork\challenger_m4_2\handoff.md`
4. Explorer Remediation Reports & Artifacts:
   - `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m4_fix_1\handoff.md` (and `proposed_cache_cleaner.rs` / `proposed_cache_cleaner.patch`)
   - `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m4_fix_2\handoff.md` (and `proposed_read_all_events_from_parquet.rs` / `parquet_reader_optimization.patch`)
   - `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m4_fix_3\handoff.md`

## Write Ownership
You exclusively own:
- `tauri/project/src-tauri/src/ledger/cache_cleaner.rs`
- `tauri/project/src-tauri/src/ledger/parquet_ledger.rs`
- `tauri/project/src-tauri/Cargo.toml` (enable `features = ["arrow"]` on `parquet = "54"`)
- `tauri/project/src-tauri/build.rs` (automated `duckdb.dll` copy to `target/` profile dirs and deps)
- Test files in `tauri/project/src-tauri/tests/`:
  - `tests/adversarial_m4_stress_tests.rs`
  - `tests/adversarial_challenger_m4_tests.rs`
  - `tests/ledger_wal_tests.rs`
  - `tests/reconciliation_tests.rs`
  - `tests/workspace_commands_tests.rs`

## Detailed Implementation Tasks
1. **Fix 1: Windows NTFS EBUSY Purge in `cache_cleaner.rs`**:
   - In `purge_project_cache`, match on `fs::rename(&prj_dir, &trash_dir)`.
   - On `Err(e)` (`PermissionDenied` / `SharingViolation` / `AccessDenied`):
     * Create `trash_dir`.
     * Iterate child files in `prj_dir`, moving each file into `trash_dir` via `fs::rename(&child, trash_dir.join(name))`.
     * Attempt `fs::remove_dir(&prj_dir)`.
     * If some files still cannot be moved immediately, do not abort; queue `trash_dir` and `prj_dir` for the background async retry loop (`async_delete_trash`).
     * Return `Ok(PurgeResult { ... })` so caller is never blocked or panicked.
   - Apply same robust fallback to `purge_all_caches` and `purge_orphan_caches`.
   - Verify `test_ebusy_purge_with_active_open_file_handle` passes!

2. **Fix 2: Pure Rust Parquet WAL Deserialization in `parquet_ledger.rs`**:
   - In `Cargo.toml`, update `parquet = { version = "54", default-features = false, features = ["arrow"] }`.
   - In `src/ledger/parquet_ledger.rs`:
     * Replace in-memory DuckDB query in `read_all_events_from_parquet` with pure Rust `parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder`.
     * Extract row groups directly into `Vec<LedgerEvent>` in pure Rust.
     * Handle column index lookups dynamically, supporting both 16 modern columns and legacy aliases (`source_path`, `source_size`, `extra_json`).
     * Verify `test_clean_startup_latency_benchmark` and `test_startup_reconciliation_latency_clean_and_missing_source` run in < 1ms (well within < 5ms specification).

3. **Fix 3: Automated `duckdb.dll` Placement in `build.rs`**:
   - Update `build.rs` to locate `duckdb.dll` and copy it to:
     * `target/debug/` and `target/debug/deps/`
     * `target/release/` and `target/release/deps/`
   - Verify `cargo test --release --test adversarial_challenger_m4_tests` runs cleanly without `STATUS_DLL_NOT_FOUND (0xc0000135)`.

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Jujutsu VCS & Verification
- Run:
  `cargo check --manifest-path tauri/project/src-tauri/Cargo.toml`
  `cargo test --manifest-path tauri/project/src-tauri/Cargo.toml --verbose`
  `cargo test --manifest-path tauri/project/src-tauri/Cargo.toml --release --verbose`
  `node tauri/project/tests/run_all_tests.js`
- Record clean Jujutsu commit:
  `jj describe -m "fix(ledger): resolve Windows NTFS EBUSY purge, optimize WAL latency <1ms, and automate release DLL placement"`
  Under identity `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`.
- Deliver `handoff.md` in `.agents/teamwork/worker_m4_remediation/handoff.md` with full test evidence and jj commit id.


## 2026-11-04T23:24:57Z
You are Worker for Milestone 4 Remediation (Squad 4).
Read `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md` (MANDATORY TO READ FIRST).
Read `d:\Shared_UserData\Downloads\tad\PROJECT.md`.
Read your detailed dispatch instructions at `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m4_remediation\DISPATCH.md`.
Read the explorer reports and use the prepared patch/proposed files:
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m4_fix_1\handoff.md` (and `proposed_cache_cleaner.rs` / `proposed_cache_cleaner.patch`)
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m4_fix_2\handoff.md` (and `proposed_read_all_events_from_parquet.rs` / `parquet_reader_optimization.patch`)
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m4_fix_3\handoff.md` (and `proposed_build.rs` / `duckdb_dll_copy.patch`)
Your working directory is `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m4_remediation/`.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Apply:
1. Fix Windows NTFS EBUSY directory rename in `src-tauri/src/ledger/cache_cleaner.rs`.
2. In `src-tauri/Cargo.toml`, enable `features = ["arrow"]` on `parquet = "54"`.
3. Replace DuckDB in-memory queries in `src-tauri/src/ledger/parquet_ledger.rs` with native Rust `ParquetRecordBatchReaderBuilder`.
4. Update `src-tauri/build.rs` to automatically copy `duckdb.dll` to target profile directories and deps.

Run tests and verify:
- `cargo check --manifest-path tauri/project/src-tauri/Cargo.toml`
- `cargo test --manifest-path tauri/project/src-tauri/Cargo.toml --verbose`
- `cargo test --manifest-path tauri/project/src-tauri/Cargo.toml --release --test adversarial_challenger_m4_tests --verbose`
- `cargo test --manifest-path tauri/project/src-tauri/Cargo.toml --test adversarial_m4_stress_tests --verbose`
- `& "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tauri/project/tests/run_all_tests.js`

Record clean Jujutsu commit:
`jj describe -m "fix(ledger): resolve Windows NTFS EBUSY purge, optimize WAL latency <1ms, and automate release DLL placement"`
under identity `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`.

Write detailed handoff report to `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m4_remediation\handoff.md` and report completion back via send_message.
