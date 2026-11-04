# Dispatch — Challenger M4-2 (2026-11-05T05:49:00Z)

## Objective
Empirical adversarial verification of Milestone 4: Workspace CRUD IPC concurrency, Windows EBUSY atomic renaming, and 500ms debounce auto-recovery.

## Scope & Instructions
1. Read `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md` (MANDATORY TO READ FIRST).
2. Read `d:\Shared_UserData\Downloads\tad\PROJECT.md`.
3. Read `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m4_ledger\handoff.md`.
4. Adversarially stress-test:
   - High concurrency: Multiple simultaneous `project:*` mutations and reads.
   - Windows EBUSY avoidance: Test `purge_project_cache` while simulated open file handles exist in `temp/<project_id>/`.
   - Debounce auto-recovery: Delete all projects, verify that `Untitled-1` is created after 500ms debounce (and cancelled if new project is created in <500ms).
5. Execute full test suites:
   - `cargo test --manifest-path tauri/project/src-tauri/Cargo.toml --test workspace_commands_tests --verbose`
   - `& "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tauri/project/tests/run_all_tests.js`
6. Issue a clear verdict: `APPROVE` or `REQUEST_CHANGES` in `handoff.md`.
