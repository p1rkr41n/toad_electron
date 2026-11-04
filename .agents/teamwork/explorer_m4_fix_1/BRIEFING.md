# BRIEFING — 2026-11-04T23:22:00Z

## Mission
Design robust, non-failing fallback for CacheCleaner::purge_project_cache on Windows NTFS when child files are held open by readers (PermissionDenied / SharingViolation).

## 🔒 My Identity
- Archetype: explorer
- Roles: investigation, synthesis
- Working directory: d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m4_fix_1
- Original parent: 07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d
- Milestone: Milestone 4 Remediation (Squad 4)

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Do not edit production code in src/
- Provide complete technical recommendation and code snippets/patches for worker

## Current Parent
- Conversation ID: 07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d
- Updated: 2026-11-04T23:14:08Z

## Investigation State
- **Explored paths**:
  - `ORIGINAL_REQUEST.md`
  - `challenger_m4_1/handoff.md`
  - `challenger_m4_2/handoff.md`
  - `tauri/project/src-tauri/src/ledger/cache_cleaner.rs`
  - `tauri/project/src-tauri/src/ledger/parquet_ledger.rs`
  - `tauri/project/src-tauri/src/commands/workspace.rs`
  - `tauri/project/src-tauri/src/commands/mod.rs`
  - `tauri/project/src-tauri/tests/adversarial_m4_stress_tests.rs`
  - `tauri/project/src-tauri/tests/reconciliation_tests.rs`
  - `tauri/project/src-tauri/tests/workspace_commands_tests.rs`
- **Key findings**:
  - Empirically reproduced `test_ebusy_purge_with_active_open_file_handle` panic: `Access is denied (os error 5)`.
  - Windows NTFS directory rename (`MoveFileExW`) strictly prohibits renaming parent directories if any child file inside has an open handle, even if opened with `FILE_SHARE_DELETE`.
  - Conversely, Windows NTFS kernel permits moving individual open child files to another directory on the same volume when `FILE_SHARE_DELETE` was granted (Rust standard library default).
  - Emptying the directory allows `fs::remove_dir` on the project directory to succeed immediately, freeing `temp/<project_id>/` for subsequent query cache writes.
  - If a file has an exclusive lock (no `FILE_SHARE_DELETE`), attempting to rename the file fails; it must be queued for background retry deletion rather than bubbling an error to the caller.
  - Windows read-only attribute also prevents deletion unless cleared beforehand.
  - Solution encapsulated in `purge_directory_atomic_or_fallback` and leveraged across `purge_project_cache`, `purge_all_caches`, and `purge_orphan_caches`.
- **Unexplored areas**: None. All edge cases analyzed and verified empirically.

## Key Decisions Made
- Designed `purge_directory_atomic_or_fallback`, `async_delete_lingering_files`, and read-only recursive attribute clearing.
- Produced `proposed_cache_cleaner.rs` and `proposed_cache_cleaner.patch` in agent workspace.

## Artifact Index
- `DISPATCH.md` — Inbound instructions from orchestrator
- `handoff.md` — 5-component handoff report and technical recommendation
- `progress.md` — Liveness heartbeat
- `proposed_cache_cleaner.rs` — Complete replacement file ready for worker implementation
- `proposed_cache_cleaner.patch` — Unified diff patch against `cache_cleaner.rs`
