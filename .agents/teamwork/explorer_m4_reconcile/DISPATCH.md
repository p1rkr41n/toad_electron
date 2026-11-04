# Dispatch — Explorer M4 Reconcile (2026-11-05T05:08:00Z)

## Objective
Investigate startup reconciliation engine (<5ms) handling 6 crash/startup recovery scenarios and cascade cache cleanup in `toadAppData/temp/`.

## Scope & Instructions
1. Read `d:\Shared_UserData\Downloads\tad\PROJECT.md` and `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`.
2. Inspect `C:\Users\huydq\.gemini\antigravity\brain\4cd78c02-c356-4448-bdfe-f2930e55fb29\ke_hoach_trien_khai_50_subagents_tauri_v2.md` (Squad 4).
3. Investigate the 6 crash/startup recovery scenarios:
   - Scenario 1: Clean startup with valid ledger and existing project files.
   - Scenario 2: Source file missing/moved on disk (mark file as `MISSING` or emit warning, don't crash).
   - Scenario 3: Orphan Parquet cache files in `toadAppData/temp/` that have no matching active file in ledger (auto-purge).
   - Scenario 4: Crash during write / interrupted ledger (safe Parquet recovery or fallback to last valid row group or backup).
   - Scenario 5: Missing ledger on initial run (auto-create empty `toad_ledger.parquet` and default `Untitled-1` project).
   - Scenario 6: All projects deleted (debounced auto-recovery creating clean `Untitled-1`).
4. Design the cascade cache cleaner (`cache_cleaner.rs`):
   - When `project:delete` or `project:delete_all` occurs, purge matching `*_cached_*.parquet` files.
   - Temporary file purge on startup and graceful shutdown.
5. Benchmark / ensure startup reconciliation executes in < 5ms.
6. Output detailed report to `.agents/teamwork/explorer_m4_reconcile/handoff.md`.
