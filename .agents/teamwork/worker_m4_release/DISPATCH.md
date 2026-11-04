# DISPATCH — Worker Milestone 4: Release Packaging & Jujutsu VCS Conformance

Read `ORIGINAL_REQUEST.md` at:
`d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`
Read the architecture and contracts in:
`d:\Shared_UserData\Downloads\tad\.agents\teamwork\PROJECT.md`
`d:\Shared_UserData\Downloads\tad\.agents\teamwork\TEST_INFRA.md`
`d:\Shared_UserData\Downloads\tad\TEST_READY.md`

## MANDATORY INTEGRITY WARNING
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Scope of Work
1. **Build Verification**:
   - Verify TypeScript compilation in `tad-master/packages/toadviewer`.
   - Run Webpack production build for `toad-app`.
2. **Packaging Execution**:
   - Run `powershell -ExecutionPolicy Bypass -File dist_package.ps1`.
   - Run `powershell -ExecutionPolicy Bypass -File package_release.ps1`.
3. **Workspace & Binary Standards Audit**:
   - Zero-Duplicate Binary Policy: strictly enforce no historical version duplicate binaries in root or `releases/` (only canonical `Toad.exe` in root and `Toad-<version>-x64-portable.exe` / `.zip` in `releases/`).
   - Portable binary size: must be < 75.0 MB (78,643,200 bytes).
   - Verify `smoke_test.js` passes now that `app.asar` is generated: `node tests/smoke_test.js`.
   - Verify all test suites via `node run_tests.js --all` pass with 100% exit code 0.
4. **Jujutsu VCS Conformance**:
   - Author strictly: `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`
   - Commit message: professional English, e.g. `feat(viewer): implement column resizing and active row auto-wrap in file table and datagrid`
   - Record Jujutsu commit ID and status.

## Verification
Write complete handoff report to: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m4_release\handoff.md`.


## 2026-11-04T15:54:42Z
You are the teamwork_worker for Milestone 4 (Release Packaging & Jujutsu VCS Conformance).
Your working directory is: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m4_release
Read your task dispatch file at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m4_release\DISPATCH.md
Read the authoritative user request at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
Read the master plan at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\PROJECT.md
Read the test ready index at: d:\Shared_UserData\Downloads\tad\TEST_READY.md

Execute the release pipeline:
1. Compile TypeScript and run Webpack production build.
2. Execute dist_package.ps1 and package_release.ps1.
3. Audit executable footprint (< 75 MB) and enforce zero duplicate binary policy.
4. Verify smoke_test.js passes and run node run_tests.js --all to verify 100% pass across all registered suites.
5. Create Jujutsu commit under HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com> with professional English message.

Write your complete handoff report to: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m4_release\handoff.md
When finished, notify me using send_message.
