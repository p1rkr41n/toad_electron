# Handoff Report — Challenger 2 (Build Scripts & Packaging Stress Challenger)

**Recipient**: Orchestrator (`afba7d24-e2ed-4eb2-89cc-f35d592f6de8`)  
**Role**: Empirical Challenger (critic, specialist)  
**Date**: 2026-11-03  
**Verdict**: **REQUEST_CHANGES**  
**Detailed Analysis**: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\challenger_2\analysis.md`  

---

## 1. Observation

Direct empirical observations from test executions, file audits, and script evaluations:

1. **PowerShell Script Syntax & Path Resolution**:
   - `fastbuild.ps1`, `dist_package.ps1`, `package_release.ps1`, and `.agents/skills/releases/scripts/package_release.ps1` all compile cleanly with `[scriptblock]::Create` with 0 syntax errors.
   - `fastbuild.ps1` lines 45–48 and `dist_package.ps1` lines 9–12 prioritize `toad-app` over `tad-app`.
   - `fastbuild.ps1` lines 79–82 and `dist_package.ps1` lines 34–37 prioritize `toadviewer` over `tadviewer`.
   - `fastbuild.ps1` lines 115–118 and `dist_package.ps1` lines 48–53 prioritize `toadapp.bundle.js` over `tadapp.bundle.js`.
   - `dist_package.ps1` line 55 whitelist checks for `v2.4.8`, `v2.4.7`, ..., `v2.1.0`.
   - `package_release.ps1` sets default parameter `$Version = "2.4.8"`.

2. **`tools/bump_version.js` Execution & Target Resolution**:
   - Running `tools/bump_version.js` without arguments safely exits with code 1 and usage help.
   - All 9 target files resolve and exist on disk:
     - `tad-master/packages/toad-app/package.json` (version: `2.4.7`)
     - `tad-master/packages/host-bridge/package.json` (version: `2.4.7`)
     - `tad-master/packages/reltab-duckdb/package.json` (version: `2.4.7`)
     - `tad-master/packages/toadviewer/package.json` (version: `2.4.7`)
     - `tad-master/packages/toadviewer/src/components/RegexDialog.tsx` (matches `/v\d+\.\d+\.\d+(?:\.\d+)?/`)
     - `dist_package.ps1` (matches `/Toad-\d+\.\d+\.\d+(?:\.\d+)?-x64-portable\.exe/`)
     - `package_release.ps1` (matches `/\[string\]\$Version = "[^"]+"/`)
     - `README.md` (matches title and badge regexes)
     - `releases/HelloKittyXamKinLung.Toad.yaml` (matches `/PackageVersion: [\d\.]+/`)

3. **Webpack Bundles & HTML Assets**:
   - `tad-master/packages/toad-app/dist/toadapp.bundle.js` exists (5,186,273 bytes, ~4.95 MiB), contains valid JavaScript (`new vm.Script(code)` passed), and contains `padStart(3` for `str001`.
   - `tad-master/packages/toad-app/html/index.html` line 11 and `dist/index.html` line 11 load `<script src="toadapp.bundle.js"></script>`.
   - `tad-master/packages/toadviewer/dist/toadviewer.js` (2,891,952 bytes) and `dist/tadviewer.js` (2,891,951 bytes) both exist and contain valid JavaScript.

4. **Asar Footprint & Zero-Duplicate Binary Policies**:
   - `toad-app/package.json` lines 140–141 specify `"!**/node_modules/toadviewer/**"` and `"!**/node_modules/tadviewer/**"`.
   - Current unpacked asar at `tad-master/packages/toad-app/release/win-unpacked/resources/app.asar` is **25.45 MB**, well below the 45.0 MB ceiling.
   - Root contains only single executable `Toad.exe`.
   - `releases/` contains exactly 9 canonical portable executables (`Toad-2.3.5-x64-portable.exe` to `Toad-2.4.7-x64-portable.exe`); zero duplicate aliases exist.
   - Dedicated challenge harness `tests/test_pipeline_challenge.js` passed **46/46 tests** (exit code 0).

5. **Empirical Regression Failure in `node run_tests.js --all`**:
   - Executing `& "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" run_tests.js --all` exited with code 1:
     - `tests/deep_integration_qa.js`: 221 passed, 1 failed:
       `✗ [FAIL] E.2 RAM First-Page Micro-Cache returns 1000 rows in < 2ms with 0 Disk I/O`
       `Error: Cannot find module 'D:\Shared_UserData\Downloads\tad\tad-master\packages\tadviewer\dist\MultipleLoadingManager'`
     - `tests/legacy_use_cases.js`: Crashed on startup:
       `Error: Cannot find module 'D:\Shared_UserData\Downloads\tad\tad-master\packages\tad-app\app_dist\portableAppData'`
   - In `tests/deep_integration_qa.js:33`, `origExistsSync(redirected)` returns `false` when `targetPath` lacks an explicit extension (like `.js`), failing to redirect `require(".../tadviewer/dist/MultipleLoadingManager")`.
   - In `toad-app/package.json:164`, `fileAssociations` lists `"ext": "tad"`, but is missing `"ext": "toad"`.

---

## 2. Logic Chain

1. **Validation of Build & Packaging Scripts (Observation 1, 2, 3, 4)**:
   The core build pipeline (`fastbuild.ps1`), release packaging script (`dist_package.ps1`), version bumper (`bump_version.js`), and asset references (`toadapp.bundle.js`, `toadviewer.js`, `index.html`) are structurally synchronized to the renamed `toad-app` and `toadviewer` packages, honoring all footprint and zero-duplicate policies.

2. **Test Suite Resolution Regression (Observation 5)**:
   - When packages were renamed from `tad-*` to `toad-*`, Worker M3 added `mapLegacyPath` in `deep_integration_qa.js` to redirect legacy path references.
   - However, because `mapLegacyPath` tests `origExistsSync(redirected)` against paths without file extensions, Node requires to modules without explicit `.js` extensions fail to redirect.
   - Furthermore, `tests/legacy_use_cases.js` does not have this hook and directly requires `tad-app/app_dist/portableAppData`.
   - Because no NTFS junctions were placed at `tad-master/packages/tad-app` and `tad-master/packages/tadviewer`, both suites fail under `run_tests.js --all`.
   - Acceptance Criterion R5.4 ("All 222+ test suite cases pass cleanly") is therefore violated.

---

## 3. Caveats

- **No Caveats**: All findings are empirically verified with executable tests. Zero speculative claims.

---

## 4. Conclusion

**Verdict: REQUEST_CHANGES**

The build scripts, packaging configurations, Webpack bundles, and binary de-duplication rules are verified and robust. However, release gates cannot be cleared until the two test resolution regressions and the missing file association are addressed:

1. **Fix `tests/deep_integration_qa.js` line 33**: Allow extension resolution in `mapLegacyPath` (`origExistsSync(redirected + ".js")`) so test E.2 resolves `MultipleLoadingManager.js`.
2. **Fix `tests/legacy_use_cases.js`**: Update require statements or add NTFS directory junctions at `tad-master/packages/tad-app` and `tadviewer`.
3. **Fix `toad-app/package.json`**: Add `"ext": "toad"` to `fileAssociations`.

---

## 5. Verification Method

To independently reproduce and verify these findings:

1. **Verify Challenger Harness (Build & Packaging Pipeline)**:
   ```powershell
   & "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tests\test_pipeline_challenge.js
   ```
   *Result*: 46/46 PASSED (100% of packaging rules satisfied).

2. **Reproduce Deep Integration QA Failure (Test E.2)**:
   ```powershell
   & "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tests\deep_integration_qa.js
   ```
   *Expected Failure*: `✗ [FAIL] E.2 ... Cannot find module '...tadviewer/dist/MultipleLoadingManager'` (221 passed, 1 failed).

3. **Reproduce Legacy Use Cases Failure**:
   ```powershell
   & "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tests\legacy_use_cases.js
   ```
   *Expected Failure*: `Cannot find module '...tad-app/app_dist/portableAppData'`.

4. **Reproduce Overall Test Runner Failure**:
   ```powershell
   & "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" run_tests.js --all
   ```
   *Expected Failure*: Exits with code 1, `RESULT: ONE OR MORE TEST SUITES FAILED!`.
