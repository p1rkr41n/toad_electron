## 2026-11-03T11:56:14Z
You are Worker M3 (Build Scripts, Version Bump & Test Whitelist Worker).
Your working directory is: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m3

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

MANDATORY INSTRUCTIONS:
1. You MUST read the original user request at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
2. You MUST read the master project plan at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\PROJECT.md
3. You MUST read Explorer 3's detailed handoff and analysis at:
   - `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_3\handoff.md`
   - `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_3\analysis.md`

EXCLUSIVE FILE OWNERSHIP (You own ONLY these files, DO NOT touch files in tad-master/packages/):
- `fastbuild.ps1`
- `dist_package.ps1`
- `package_release.ps1`
- `tools/bump_version.js`
- `tests/deep_integration_qa.js`
- `tests/smoke_test.js`

TASK REQUIREMENTS (R5 & Version Synchronization):
1. `fastbuild.ps1`:
   - Update `$appDir` path check to accept either `toad-app` or fallback to `tad-app` (so it works seamlessly both during and after package rename).
   - Update `tadviewer` build steps to check `toadviewer` with fallback to `tadviewer`.
   - Update bundle check: verify `toadapp.bundle.js` (or fallback `tadapp.bundle.js`).
2. `dist_package.ps1`:
   - Synchronize `$appDir` to `toad-app` (with fallback).
   - Synchronize viewer path to `toadviewer` (with fallback).
   - Update bundle verification: check `$bundlePath = "$appDir\dist\toadapp.bundle.js"` (fallback to `tadapp.bundle.js`).
   - Add `"v2.4.8"` to `$bundleContent.Contains("v2.4.8")` in line 44.
   - Maintain strict Zero-Duplicate Binary Storage policy: canonical binaries are solely `releases/Toad-2.4.8-x64-portable.exe` and `Toad.exe`.
3. `package_release.ps1`:
   - Update default `$Version` to `"2.4.8"`.
4. `tools/bump_version.js`:
   - Update `pkgAppPath` to check `toad-app/package.json` with fallback to `tad-app/package.json`.
   - Update viewer path to check `toadviewer/package.json` with fallback to `tadviewer/package.json`.
   - Update `RegexDialog.tsx` path check to support `toadviewer` or `tadviewer`.
5. `tests/deep_integration_qa.js`:
   - Update version whitelists (e.g. lines 5173, 1234, 1477, and wherever versions 2.4.2..2.4.6 were asserted) to accept `"2.4.7"` and `"2.4.8"`.
   - Update package path references where appropriate (or add dynamic resolution so tests look for `toad-app` or `tad-app`, and `toadviewer` or `tadviewer`).
   - Ensure bundle assertions check for `toadapp.bundle.js` or `tadapp.bundle.js`.

VERIFICATION:
- Verify PowerShell script syntax: run `Get-Command` or syntax check on modified `.ps1` scripts.
- Run `node tools/bump_version.js --help` or verify syntax.
- Verify `deep_integration_qa.js` runs without syntax errors.

DELIVERABLES:
Write a detailed report in `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m3\changes.md`
and self-contained handoff in `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m3\handoff.md`.
Update `progress.md` before finishing.
When done, send a message back to the orchestrator with your results.


## 2026-11-03T12:07:11Z
**Context**: Milestone 3 implementation check.
**Content**: Checking in on progress for build scripts, version bump, and test whitelist synchronization.
**Action**: Please report your current progress and status.
