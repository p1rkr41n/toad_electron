# Dispatch: Milestone 4 — Version Bump v2.5.1, Packaging & VCS Conformance

## Objective
Bump TOAD version to `2.5.1` (SemVer 3-digit) across all project metadata files using `tools/bump_version.js 2.5.1`, verify build and packaging scripts (`fastbuild.ps1`), verify packaging artifact constraints (ASAR < 45 MB, executable < 75 MB), confirm zero duplicate binaries in `releases/`, and ensure Jujutsu (`jj`) repository compliance with author `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`.

## Context & Inputs
- Original Request: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`
- Master Plan: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\PROJECT.md`
- Node runtime: `node-v18.20.4-win-x64\node.exe`
- Jujutsu executable: `C:\Users\huydq\.cargo\bin\jj.exe` or `tools/jj/jj.exe`

## Detailed Tasks
1. **Execute Version Bump**:
   Run `node-v18.20.4-win-x64\node.exe tools/bump_version.js 2.5.1`.
   Check that all relevant files are updated to `2.5.1`:
   - `package.json`
   - `tad-master/package.json`
   - `tad-master/packages/toadviewer/package.json`
   - `tad-master/packages/reltab-duckdb/package.json`
   - `tad-master/packages/toad-app/package.json`
   - `tad-master/packages/toadviewer/src/components/RegexDialog.tsx`
   - `README.md`
   - `dist_package.ps1`
   - `package_release.ps1`

2. **Verify Fastbuild & Packaging**:
   Run `powershell -ExecutionPolicy Bypass -File fastbuild.ps1`.
   Verify:
   - Build completes cleanly.
   - `app.asar` size < 45 MB.
   - `Toad.exe` / portable binary size < 75 MB.

3. **Verify Binary De-duplication Policy**:
   Check `releases/` directory.
   Ensure ZERO duplicate historical binaries. Canonical outputs are strictly:
   - Root: `Toad.exe` (single local development/test executable)
   - Releases: `releases/Toad-2.5.1-x64-portable.exe` and `releases/Toad-2.5.1-x64-portable.zip` (if packaged).

4. **VCS & Identity Verification**:
   Run `tools/jj/jj.exe status` and check configured author identity.
   Ensure Author Name is `HelloKittyXamKinLung` and Email is `p1rkr41n@users.noreply.github.com`.
   Verify zero enterprise/org leaks.
   Ensure English-only public commit messages and release notes.

5. **Run Existing Test Suite Quick Check**:
   Run `node-v18.20.4-win-x64\node.exe run_tests.js --quick` (or `test_nested_json.js`) to ensure build artifacts and version bump didn't break tests.

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Output Requirements
Write your final report to `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m4\handoff.md` following the standard 5-part format (Observation, Logic Chain, Caveats, Conclusion, Verification Method). Include all verbatim command outputs and file sizes. Notify the parent orchestrator via `send_message`.


## 2026-11-04T08:16:56Z
Received dispatch message:
You are worker_m4, the Packaging & VCS Worker for TOAD v2.5.1.
Your working directory is d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m4.
Read your dispatch instructions in:
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m4\DISPATCH.md
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\PROJECT.md

Your tasks:
1. Run `node-v18.20.4-win-x64\node.exe tools/bump_version.js 2.5.1`.
2. Verify all metadata files (package.json files across packages, RegexDialog.tsx, README.md, dist_package.ps1, package_release.ps1) are updated to 2.5.1.
3. Test build via `powershell -ExecutionPolicy Bypass -File fastbuild.ps1`. Verify app.asar < 45 MB and Toad.exe < 75 MB.
4. Verify packaging binary de-duplication policy: zero duplicate historical binaries in releases/.
5. Check Jujutsu (jj) VCS: run `tools/jj/jj.exe status`, ensure author identity is `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`, zero corporate/org leaks, English-only.
6. Verify quick tests pass with node-v18.20.4-win-x64\node.exe run_tests.js --quick or test_nested_json.js.
