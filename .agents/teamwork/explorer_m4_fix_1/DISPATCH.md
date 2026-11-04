# Dispatch — Explorer M4-Fix-1 (2026-11-05T06:13:00Z)

## Objective
Design fix strategy for Windows NTFS EBUSY open file handle failure in `CacheCleaner::purge_project_cache`.

## Inputs & Context
1. Read `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`.
2. Read `d:\Shared_UserData\Downloads\tad\.agents\teamwork\challenger_m4_2\handoff.md` and `d:\Shared_UserData\Downloads\tad\.agents\teamwork\challenger_m4_1\handoff.md`.
3. Inspect `tauri/project/src-tauri/src/ledger/cache_cleaner.rs` and `tauri/project/src-tauri/tests/adversarial_m4_stress_tests.rs` (specifically `test_ebusy_purge_with_active_open_file_handle`).
4. Problem:
   `fs::rename(&prj_dir, &trash_dir)?;` fails with `Access is denied (os error 5)` on Windows NTFS when child files inside `temp/<project_id>/` are held open by active readers.
5. Task:
   Design robust, non-failing fallback:
   - Match on `fs::rename(&prj_dir, &trash_dir)`.
   - On error (PermissionDenied / SharingViolation), create `trash_dir`, move individual unheld child files into `trash_dir`, and remove the emptied `prj_dir`.
   - Ensure the async background retry task cleans lingering files without bubbling an unhandled error to the caller.
6. Deliver detailed recommendation to `.agents/teamwork/explorer_m4_fix_1/handoff.md`.


## 2026-11-04T23:14:08Z
[Message] sender=07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d priority=MESSAGE_PRIORITY_HIGH
You are Explorer 1 for Milestone 4 Remediation (Squad 4).
Read `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md` (MANDATORY TO READ FIRST).
Read `d:\Shared_UserData\Downloads\tad\.agents\teamwork\challenger_m4_2\handoff.md`.
Read your dispatch instructions at `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m4_fix_1\DISPATCH.md`.
Your working directory is `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m4_fix_1/`.

Design the fix for `CacheCleaner::purge_project_cache` on Windows NTFS when child files are held open by readers (`PermissionDenied` / `SharingViolation`).
Inspect `tauri/project/src-tauri/src/ledger/cache_cleaner.rs` and `tauri/project/src-tauri/tests/adversarial_m4_stress_tests.rs`.
Deliver your technical recommendation to `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m4_fix_1\handoff.md` and report completion back via send_message.
