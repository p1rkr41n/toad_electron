## 2026-11-05T02:39:23Z

# DISPATCH: Milestone 7 (M7) Implementation Worker (Squad 7)

## Mission
Implement Milestone 7: Final Verification, Packaging & Release Audit for Toad Tauri v2.
1. Update `tauri/project/src-tauri/tauri.conf.json` with `"publisher": "HelloKittyXamKinLung"` and `"copyright": "Copyright © 2026 HelloKittyXamKinLung"`.
2. Implement `tauri/project/tools/package_portable.ps1` implementing the full HelloKittyXamKinLung Indie Release Pipeline.
3. Execute `package_portable.ps1` to produce:
   - `tauri/project/releases/Toad-2.5.2-x64-portable.exe` (< 50MB) with companion DLLs (`duckdb.dll`, `WebView2Loader.dll`)
   - `tauri/project/releases/Toad-2.5.2-x64-portable.zip`
   - `tauri/project/releases/SHA256SUMS.txt`
   - `tauri/project/releases/HelloKittyXamKinLung.Toad.yaml` (Winget manifest)
   - Canonical root `Toad.exe` (+ companion DLLs)
   - Pruning of duplicate historical binaries per Zero-Duplicate Binary storage policy.
4. Verify execution of `Toad.exe` (creates `toadAppData_[5chars]` adjacent to binary).
5. Run all test suites:
   - `cargo test` in `tauri/project/src-tauri` (all 139 tests pass 100%)
   - `node tauri/project/tests/run_all_tests.js` (all 55 E2E tests pass 100%)
   - `node tests/test_tauri_arrow_ipc.js` (all 17 tests pass 100%)
   - `node tests/test_grid_scroll_stress.js` (all 16 tests pass 100%)
   - `node tests/unit/test_cell_line_calculator.js` (all 25 tests pass 100%)
   - `node tests/qa/test_modal_cell_glow_suppression.js` (all 10 tests pass 100%)
6. Record clean Jujutsu (`jj`) commit:
   `jj describe -m "feat(release): implement portable release pipeline, packaging Toad v2.5.2 with SHA256 checksums"`
   under author `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`.

## Working Directory
`.agents/teamwork/worker_m7_packaging/`

## Context Files to Read
- User Request: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`
- Scope & Milestones: `d:\Shared_UserData\Downloads\tad\PROJECT.md`
- Release Standard Skill: `d:\Shared_UserData\Downloads\tad\.agents\skills\releases\SKILL.md`
- Packaging Blueprint: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m7_packaging\handoff.md`
- Guidelines: `d:\Shared_UserData\Downloads\tad\AGENTS.md`

## File Ownership
You exclusively own:
- `tauri/project/tools/package_portable.ps1`
- `tauri/project/src-tauri/tauri.conf.json`
- `tauri/project/releases/**`
- Root `Toad.exe`
- `PROJECT.md`

## MANDATORY INTEGRITY WARNING
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Deliverable
Write a comprehensive handoff report to `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m7_packaging\handoff.md` and notify caller with `send_message`.


## 2026-11-05T02:45:22Z

**Context**: User Feedback / Bug Report for Milestone 7 Packaging
**Content**: The user encountered error "WebView2Loader.dll was not found" when executing Toad.exe.
Root cause: The host Rust toolchain is x86_64-pc-windows-gnu (MinGW). In webview2-com-sys under GNU targets, it dynamically links WebView2Loader.dll rather than embedding it statically.
Therefore, on Windows GNU targets, WebView2Loader.dll MUST ALWAYS be present alongside Toad.exe and duckdb.dll in ANY directory where Toad.exe is executed (specifically: project root D:\Shared_UserData\Downloads\tad\, tauri/project/releases/, and inside the portable ZIP archive).
**Action**: Ensure package_portable.ps1 reliably deploys WebView2Loader.dll alongside Toad.exe everywhere (root D:\Shared_UserData\Downloads\tad\, releases folder, and portable ZIP archive). Verify that executing Toad.exe from the root directory launches without this error.
