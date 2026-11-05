# DISPATCH: Milestone 7 (M7) Packaging & Release Explorer (Squad 7)

## Mission
Investigate and design the packaging automation script `package_portable.ps1` at `tauri/project/tools/package_portable.ps1` and verify the end-to-end release pipeline for Toad Tauri v2 (`Toad-2.5.2-x64-portable.exe`, `Toad-2.5.2-x64-portable.zip`, `SHA256SUMS.txt`).

## Working Directory
`.agents/teamwork/explorer_m7_packaging/`

## Context Files to Inspect
- Request: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`
- Architecture & Milestones: `d:\Shared_UserData\Downloads\tad\PROJECT.md`
- Release Standard: `d:\Shared_UserData\Downloads\tad\.agents\skills\releases\SKILL.md`
- Tauri Config: `d:\Shared_UserData\Downloads\tad\tauri\project\src-tauri\tauri.conf.json`
- Cargo Config: `d:\Shared_UserData\Downloads\tad\tauri\project\src-tauri\Cargo.toml`
- Root Guidelines: `d:\Shared_UserData\Downloads\tad\AGENTS.md` (Jujutsu VCS, Zero-Duplicate Binary Policy, HelloKittyXamKinLung identity standard)

## Tasks to Investigate
1. **Compilation Pipeline**:
   - Investigate how `cargo build --release` in `tauri/project/src-tauri` compiles `Toad.exe`.
   - Check DLL placement in `target/release/` (`duckdb.dll`, etc.) from `build.rs`.
   - Verify PE headers (`ProductName: Toad`, `CompanyName: HelloKittyXamKinLung`, `FileVersion: 2.5.2`, Subsystem 2 GUI).
2. **Packaging Automation Script (`tauri/project/tools/package_portable.ps1`)**:
   - Design PowerShell script that compiles the release binary, creates `tauri/project/releases/`, packages `Toad-2.5.2-x64-portable.exe` and `Toad-2.5.2-x64-portable.zip`, computes `SHA256SUMS.txt`, and copies canonical `Toad.exe` to project root.
   - Strictly adhere to Zero-Duplicate Binary storage policy (no historical version copies like `Toad 2.0.x.exe`, etc.).
3. **Execution & Startup Verification**:
   - Verify binary execution opens and creates `toadAppData_[5chars]` adjacent to the executable.
   - Verify size limit (< 50MB).
4. **Final E2E Suite Verification**:
   - Map execution of `cargo test` in `src-tauri`, `run_all_tests.js`, `test_tauri_arrow_ipc.js`, and `test_grid_scroll_stress.js`.

## Deliverable
Deliver a structured handoff report to `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m7_packaging\handoff.md` and notify caller via `send_message`.

## 2026-11-05T02:25:31Z
[Message] sender=07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d priority=MESSAGE_PRIORITY_HIGH
You are explorer_m7_packaging, the Packaging & Release Explorer for Milestone 7 (Squad 7).

Working Directory: d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m7_packaging\

Read:
- User Request: d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
- Scope: d:\Shared_UserData\Downloads\tad\PROJECT.md
- Release Skill: d:\Shared_UserData\Downloads\tad\.agents\skills\releases\SKILL.md
- Guidelines: d:\Shared_UserData\Downloads\tad\AGENTS.md
- Your Dispatch Assignment: d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m7_packaging\DISPATCH.md

Investigate:
1. Compilation pipeline for `cargo build --release` in `tauri/project/src-tauri` and `npm run build` in `tauri/project`.
2. Architecture of `tauri/project/tools/package_portable.ps1` for dual packaging (`Toad-2.5.2-x64-portable.exe` < 50MB and `Toad-2.5.2-x64-portable.zip`), root `Toad.exe`, `SHA256SUMS.txt`, PE headers, and Zero-Duplicate Binary policy.
3. Portable environment directory creation (`toadAppData_[5chars]`) adjacent to the executable.
4. E2E test suite execution map (135 Rust tests, 55 Node E2E tests, 100K scroll stress, Arrow IPC).

Deliver a comprehensive handoff report to `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m7_packaging\handoff.md` and send completion message.
