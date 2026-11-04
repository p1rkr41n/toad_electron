# Adversarial Verification Report — Milestone 4 (Parquet State Ledger WAL & Workspace Engine)

## Verdict: REQUEST_CHANGES

---

## 1. Observation

### Test Execution Results

1. **Workspace Commands Test Suite**:
   ```powershell
   cargo test --manifest-path tauri/project/src-tauri/Cargo.toml --test workspace_commands_tests --verbose
   ```
   **Output**:
   ```text
   running 8 tests
   test test_workspace_get_workspace_and_create ... ok
   test test_workspace_cache_size_and_purge ... ok
   test test_workspace_add_folder_recursive ... ok
   test test_workspace_add_and_get_files ... ok
   test test_workspace_remove_file ... ok
   test test_workspace_rename_project ... ok
   test test_workspace_move_orphan_files ... ok
   test test_workspace_delete_project_and_all ... ok

   test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.01s
   ```

2. **Master JavaScript / Arrow IPC Test Suite**:
   ```powershell
   & "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tauri/project/tests/run_all_tests.js
   ```
   **Output**:
   ```text
    • [PASS] Arrow IPC Binary Protocol Suite                   329.8 ms
    • [PASS] 100K Rows Grid Virtual Scroll & Stress Suite      718.7 ms
    • [PASS] End-to-End Features Suite (Tiers 1, 2, 3)         895.9 ms
   Total Suites Run:      3
   Suites Passed:         3
   Suites Failed:         0
   Total Execution Time:  1946.62 ms
   OVERALL STATUS: SUCCESS - 100% of test suites passed cleanly.
   ```

3. **Empirical Adversarial Stress Test Suite (`tests/adversarial_m4_stress_tests.rs`)**:
   ```powershell
   cargo test --manifest-path tauri/project/src-tauri/Cargo.toml --test adversarial_m4_stress_tests -- --nocapture
   ```
   **Results**:
   - `test_high_concurrency_workspace_crud` — **PASS** (24 concurrent workers, 200 operations, 100% Parquet WAL replay consistency).
   - `test_debounce_strict_timing_and_cancellation` — **PASS** (strictly 0 projects at 50ms and 250ms; Untitled-1 synthesized at 650ms; sub-500ms project creation cancels debounce without duplicate projects).
   - `test_fuzzing_and_sql_injection_safety` — **PASS** (SQL injection strings, emojis, null bytes, 1KB strings properly escaped and stored).
   - `test_double_valid_bak_synchronization` — **PASS** (corrupted primary WAL quarantined to logs/ and cleanly recovered from `.bak`).
   - `test_ebusy_purge_with_active_open_file_handle` — **FAILED**:
     ```text
     >>> CacheCleaner::purge_project_cache result while open handle exists: Err(Os { code: 5, kind: PermissionDenied, message: "Access is denied." })

     thread 'test_ebusy_purge_with_active_open_file_handle' panicked at tests\adversarial_m4_stress_tests.rs:78:5:
     purge_project_cache should succeed even if child file is open: Err(Os { code: 5, kind: PermissionDenied, message: "Access is denied." })
     ```

4. **Empirical Windows Handle Diagnostic**:
   ```text
   >>> moving open file to trash_dir: Ok(())
   >>> removing empty parent directory: Ok(())
   ```
   Directly moving the child file held open by a simulated reader succeeds on NTFS, but whole-directory rename `fs::rename(&prj_dir, &trash_dir)` fails with `Access is denied (os error 5)`.

---

## 2. Logic Chain

1. **Observed Worker Implementation in `src/ledger/cache_cleaner.rs`**:
   Lines 52–58 of `CacheCleaner::purge_project_cache`:
   ```rust
   let trash_dir = temp_dir.join(format!(".trash_{}_{}", project_id, now_ms));

   // Atomic directory rename on the same volume (instantaneous and unlocks caller)
   fs::rename(&prj_dir, &trash_dir)?;

   // Fire-and-forget async delete with retry backoff
   Self::async_delete_trash(trash_dir);
   ```

2. **Windows NTFS Invariant**:
   On Windows NT, directory renaming (`MoveFileExW`) changes the namespace path of all descendants. If any descendant file within `temp/<project_id>/` is currently open (e.g. by DuckDB during an ongoing query, by an antivirus engine, or by an OS indexer), Windows returns `ERROR_ACCESS_DENIED` (code 5) when attempting to rename the ancestor folder `temp/<project_id>/`.

3. **Blast Radius & Impact**:
   - Because `fs::rename(&prj_dir, &trash_dir)?;` uses `?`, any open handle causes `purge_project_cache` to immediately abort with an `std::io::Error (PermissionDenied)`.
   - `project:purge_cache` command crashes with `internal_error("Failed to purge cache: Access is denied. (os error 5)")`.
   - When calling `delete_project`, the background task executes:
     `tokio::task::spawn_blocking(move || { let _ = CacheCleaner::purge_project_cache(&temp_dir, &pid); });`
     The error is ignored, leaving `temp/<project_id>/` on disk permanently uncleaned.

4. **Worker's Test Defect in `tests/reconciliation_tests.rs`**:
   `test_cascade_cache_cleaner_windows_ebusy` (lines 284–292) wrote a dummy file and immediately closed it before calling `purge_project_cache`. No active file handle was held open, creating a false positive test result that masked this bug.

5. **Empirical Diagnostic Proof of Solution**:
   Our empirical test verified that Windows NT **DOES** permit moving an individual file to another directory on the same volume even while an active handle exists (via `FILE_SHARE_DELETE`). Once the files are moved to `trash_dir`, the original directory `temp/<project_id>/` is empty and can be removed with `fs::remove_dir(&prj_dir)`.

---

## 3. Caveats

- In strict compliance with the Challenger Review-Only role, no production files in `src/` were altered.
- The test harness `tests/adversarial_m4_stress_tests.rs` was added to standard Cargo integration tests in `tauri/project/src-tauri/tests/`.
- Tested exclusively under Windows 11 x64 (NTFS filesystem).

---

## 4. Conclusion & Required Action

### Required Action for Worker (`worker_m4_ledger`):
Update `CacheCleaner::purge_project_cache` in `tauri/project/src-tauri/src/ledger/cache_cleaner.rs` with the verified Windows fallback:

```rust
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let trash_dir = temp_dir.join(format!(".trash_{}_{}", project_id, now_ms));

        // Atomic directory rename on the same volume
        if let Err(e) = fs::rename(&prj_dir, &trash_dir) {
            // Windows EBUSY Fallback: when open child handles block directory rename,
            // move child files individually into trash_dir (permitted by FILE_SHARE_DELETE),
            // then remove the emptied project directory.
            fs::create_dir_all(&trash_dir)?;
            if let Ok(entries) = fs::read_dir(&prj_dir) {
                for entry in entries.flatten() {
                    let child_path = entry.path();
                    if let Some(name) = child_path.file_name() {
                        let _ = fs::rename(&child_path, trash_dir.join(name));
                    }
                }
            }
            let _ = fs::remove_dir(&prj_dir);
            if prj_dir.exists() {
                return Err(e);
            }
        }

        // Fire-and-forget async delete with retry backoff
        Self::async_delete_trash(trash_dir);
```

Check and apply the same fallback pattern in `CacheCleaner::purge_all_caches` and `CacheCleaner::purge_orphan_caches`.

---

## 5. Verification Method

1. **Reproduce the Failure**:
   ```powershell
   cargo test --manifest-path tauri/project/src-tauri/Cargo.toml --test adversarial_m4_stress_tests -- test_ebusy_purge_with_active_open_file_handle --nocapture
   ```
   *Expected Current Output*: Panics with `Access is denied (os error 5)`.

2. **Verify After Fix**:
   ```powershell
   cargo test --manifest-path tauri/project/src-tauri/Cargo.toml --test adversarial_m4_stress_tests --verbose
   ```
   *Expected Output*: All 5 adversarial stress tests pass with 100% success.
