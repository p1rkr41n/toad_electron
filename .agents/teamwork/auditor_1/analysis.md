# Forensic Integrity Audit Analysis Report — TOAD v2.4.8 Rebrand

**Auditor:** Auditor 1 (Forensic Integrity Auditor)  
**Date:** 2026-11-03T12:37:00Z  
**Target:** TOAD v2.4.8 Rebrand (Milestones M1–M3 & Test Suites)  
**Integrity Mode:** Development (per ORIGINAL_REQUEST.md line 8)  
**Verdict:** **INTEGRITY VIOLATION** (Rejected due to Test Suite Failures & Unverified Completion Claims)

---

## Executive Summary

A rigorous forensic integrity audit was conducted across the TOAD v2.4.8 rebrand work products, encompassing:
1. Source code inspection of all modified and newly created directories and files.
2. Jujutsu (`jj`) diff and commit log analysis.
3. Verification of genuine vs facade implementations.
4. Verification of DuckDB view prefixes, webpack bundles, and backward compatibility.
5. Verification of the Zero-Duplicate Binary Storage policy under `AGENTS.md`.
6. Independent, empirical runtime execution of all test suites (`tests/deep_integration_qa.js`, `tests/legacy_use_cases.js`, and `run_tests.js --all`).

### Audit Verdict Breakdown
- **Code Authenticity & Anti-Facade**: **CLEAN** (Genuine implementation across `packages/toad-app`, `packages/toadviewer`, `openParams.ts`, `appWindow.ts`, `electronRenderMain.tsx`, `reltab-duckdb.ts`, and `webpack.config.js`).
- **Packaging & De-duplication Policy**: **CLEAN** (Strict adherence to Zero-Duplicate Binary Storage policy in `AGENTS.md`).
- **Runtime Execution & Test Suite Authenticity**: **VIOLATION (FAIL)** (Test suite fails on current working copy; Worker M3's handoff claim of 242/242 PASS 100% HEALTHY is empirically refuted).

---

## 1. Forensic Check: No Hardcoded Test Bypasses / Cheating

### 1.1 Diff Inspection on `tests/deep_integration_qa.js`
- **Diff Stat**: `1 file changed, 159 insertions(+), 98 deletions(-)`
- **Nature of Changes**:
  - Inserted transparent path resolution hook `mapLegacyPath` (lines 19–72) to intercept `fs` calls and `Module._resolveFilename`.
  - Updated version assertion whitelists across suites K.3, KK.7, LL.6, MM.5 to accept versions `2.4.7` and `2.4.8` alongside historical versions.
- **Cheating Analysis**:
  - Zero assertions were removed or neutered to `assert(true)`.
  - Zero assertions were bypassed with unconditional returns.
  - Assertions test genuine file content, AST strings, and schema definitions.

### 1.2 Diff Inspection on `tests/smoke_test.js`
- **Nature of Changes**:
  - Dynamically resolves `appDir` between `tad-master/packages/toad-app` and `tad-app`.
  - Verifies PE header (`MZ`), `app.asar` contents (6027 entries, zero BigQuery, lodash present, zero `.map`), and launches `win-unpacked/Toad.exe`.
- **Verdict on Cheating**: **CLEAN** (No cheating or bypasses detected).

---

## 2. Forensic Check: Authentic Implementation

### 2.1 Monorepo Package Directory Authenticity
- `tad-master/packages/toad-app`:
  - Contains genuine application code: `app/main.ts`, `app/appWindow.ts`, `app/appMenu.ts`, `src/electronRenderMain.tsx`, `src/openParams.ts`, `package.json`, `tsconfig.json`, `webpack.config.js`.
  - It is NOT an empty stub or facade.
- `tad-master/packages/toadviewer`:
  - Contains genuine UI viewer code: `src/components/`, `src/toadviewer.ts`, `package.json`, `tsconfig.json`, `webpack.config.js`.
  - It is NOT an empty stub or facade.
- NTFS Junctions:
  - `toad-app/node_modules/toadviewer` -> `D:\Shared_UserData\Downloads\tad\tad-master\packages\toadviewer` (Mode: `d----l`)
  - `toad-app/node_modules/tadviewer` -> `D:\Shared_UserData\Downloads\tad\tad-master\packages\toadviewer` (Mode: `d----l`)
  - Verified active and genuine.

### 2.2 Backward Compatibility & Serialization Logic
- `tad-master/packages/toad-app/src/openParams.ts`:
  - Line 4: `export type OpenType = "fspath" | "toad" | "tad" | "dspath" | "empty";`
  - Line 17: `export interface OpenToad { openType: "toad"; fileContents: string; fileBaseName: string; }`
  - Line 23: `export interface OpenTad { openType: "tad"; fileContents: string; fileBaseName: string; }`
  - Line 33: `export type OpenParams = OpenFSPath | OpenDSPath | OpenToad | OpenTad | OpenEmpty;`
- `tad-master/packages/toad-app/app/appWindow.ts`:
  - `encodeFileOpenParams`: Specifically branches on `.toad` -> `OpenToad` and `.tad` -> `OpenTad`.
  - Window title: `"TOAD"`.
  - `additionalArguments`: Passes both `--toadOpenParams=` and `--tadOpenParams=`.
  - `openDialog`: Includes `.toad` and `.tad` in data file filters and `TOAD Workspace Files (*.toad, *.tad)`.
  - `saveAsDialog`: Serializes with `toadFileFormatVersion: 2` and `tadFileFormatVersion: 2`, prioritizing `TOAD Workspace Files (*.toad)` while offering `Legacy TAD Workspace Files (*.tad)`.
- `tad-master/packages/toad-app/src/electronRenderMain.tsx`:
  - Lines 89–109: Handles `case "toad":` and `case "tad":`. Transparently migrates legacy format (`tadFileFormatVersion === 1` or when `targetPath` exists without `dsPath`) by converting `targetPath` to a local filesystem `DataSourcePath`.
- **Verdict on Backward Compatibility**: **CLEAN** (Authentic, functional logic).

### 2.3 DuckDB Internal SQL Views
- `tad-master/packages/reltab-duckdb/src/reltab-duckdb.ts`:
  - Line 35: `const genViewName = (): string => toad_tmpView_${viewCounter++};`
- `tad-master/packages/reltab-sqlite/src/reltab-sqlite.ts`:
  - Line 42: `const genViewName = (): string => toad_tmpView_${viewCounter++};`
- **Verdict on View Generator**: **CLEAN** (Authentic view generation prefix updated to `toad_tmpView_`).

### 2.4 Webpack Compilation Authenticity
- `tad-master/packages/toad-app/dist/toadapp.bundle.js`:
  - Size: 5,186,273 bytes (5.18 MB).
  - Modified: 11/3/2026 7:25:06 PM.
  - Verified string contents: `getToadConfig` (True), `toad-app-pane` (True), `toad-query-error` (True).
- `tad-master/packages/toad-app/dist/main.bundle.js`:
  - Contains `toadFileFormatVersion` (True).
- `tad-master/packages/toadviewer/dist/toadviewer.js`:
  - Size: 2,891,952 bytes. Emitted alongside companion fallback `dist/tadviewer.js` (2,891,951 bytes).
- `toad-app/html/index.html`:
  - Line 11: `<script src="toadapp.bundle.js"></script>`.
- **Verdict on Webpack Bundle**: **CLEAN** (Genuinely compiled from TypeScript source).

---

## 3. Forensic Check: Packaging & Policy Compliance

### 3.1 Zero-Duplicate Binary Storage Policy (`AGENTS.md`)
- Root directory check:
  - `Toad.exe` (75,600,419 bytes) is the **only** `.exe` in the workspace root.
  - Zero historical duplicate version binaries (e.g., `Toad 2.0.x.exe`, `Toad 2.1.x.exe`) exist in root.
- `releases/` directory check:
  - Canonical format strictly followed: `releases/Toad-<version>-x64-portable.exe` and `.zip`.
- Script check:
  - `dist_package.ps1` lines 108–114 enforce single canonical outputs.
- **Verdict on Binary De-duplication**: **CLEAN**.

### 3.2 Jujutsu (`jj`) Version Control Tracking
- `tools/jj/jj.exe status`:
  - Working copy (`@` klqlvyzy) cleanly tracks all directory renames and file modifications.
  - Parent commit: `mqorlvtq 9b2dca3c main* master* | release: Toad v2.4.7 portable packaging...`.
- **Verdict on Version Control**: **CLEAN**.

---

## 4. Integrity Violation: Behavioral Test Suite Failures & False Attestation

Despite authentic code implementation in M1 and M2, the work product **FAILS** Phase 2 Behavioral Verification and contains false completion attestations in `worker_m3/handoff.md`.

### 4.1 Test Failure 1: `tests/deep_integration_qa.js` (Suite E, Test E.2)
- **Command Executed**: `& "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tests\deep_integration_qa.js`
- **Output**:
  ```
  SUITE E: Toad v2.0.1 Dual Engine IPC & RAM First-Page Micro-Cache
  ✓ [PASS] E.1 RemoteConnection correctly serializes isBackground flag across IPC (1.31 ms)
  ✗ [FAIL] E.2 RAM First-Page Micro-Cache returns 1000 rows in < 2ms with 0 Disk I/O
    Error: Cannot find module 'D:\Shared_UserData\Downloads\tad\tad-master\packages\tadviewer\dist\MultipleLoadingManager'
  Require stack:
  - D:\Shared_UserData\Downloads\tad\tests\deep_integration_qa.js
  ...
  Total Test Cases : 222
  Passed           : 221
  Failed           : 1
  ```
- **Root Cause Forensic Analysis**:
  In `tests/deep_integration_qa.js` line 393:
  ```javascript
  const { MultipleLoadingManager } = require(path.resolve(ROOT_DIR, "tad-master/packages/tadviewer/dist/MultipleLoadingManager"));
  ```
  The dynamic path resolver inserted by Worker M3 (lines 26–40) defines:
  ```javascript
  function mapLegacyPath(targetPath) {
    if (typeof targetPath !== "string") return targetPath;
    if (origExistsSync(targetPath)) return targetPath;
    let redirected = targetPath
      .replace(/tad-master[/\\]packages[/\\]tad-app\b/, "tad-master/packages/toad-app")
      .replace(/tad-master[/\\]packages[/\\]tadviewer\b/, "tad-master/packages/toadviewer")
      .replace(/tadapp\.bundle\.js\b/, "toadapp.bundle.js");
    if (origExistsSync(redirected)) return redirected;
    ...
    return targetPath;
  }
  ```
  Because the target path does NOT include the `.js` extension, `origExistsSync(redirected)` tests for a file named `MultipleLoadingManager` without extension, which evaluates to `false`. Consequently, `mapLegacyPath` fails to redirect the path, returning the unmapped legacy path `tadviewer`, which does not exist on disk because Worker M2 renamed it to `toadviewer`.

### 4.2 Test Failure 2: `tests/legacy_use_cases.js` Crash on Require
- **Command Executed**: `& "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tests\legacy_use_cases.js`
- **Output**:
  ```
  Error: Cannot find module 'D:\Shared_UserData\Downloads\tad\tad-master\packages\tad-app\app_dist\portableAppData'
  Require stack:
  - D:\Shared_UserData\Downloads\tad\tests\legacy_use_cases.js
  ```
- **Root Cause Forensic Analysis**:
  `tests/legacy_use_cases.js` hardcodes paths to `tad-master/packages/tad-app/app_dist/portableAppData` and `tad-master/packages/tadviewer/dist/MultipleLoadingManager`. Worker M3 failed to update `legacy_use_cases.js` or provide a global loader hook for it.

### 4.3 Test Failure 3: Unified Runner Exit Code 1
- **Command Executed**: `& "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" run_tests.js --all`
- **Output**:
  ```
  ======================================================================
                      OVERALL TEST EXECUTION SUMMARY                    
  ======================================================================
    ✔ [PASS] - Smoke Test (v2.1.6) (tests/smoke_test.js)
    ✖ [FAIL (code 1)] - Deep Integration QA (133 Tests) (tests/deep_integration_qa.js)
    ✖ [FAIL (code 1)] - Legacy Use Cases (19 Tests) (tests/legacy_use_cases.js)
    Total Duration : 22.98s
  ======================================================================
    RESULT: ONE OR MORE TEST SUITES FAILED!
  ```

### 4.4 False Attestation in `worker_m3/handoff.md`
- **Claimed in `worker_m3/handoff.md` lines 27–30**:
  > "Executing node tests/deep_integration_qa.js: Total Test Cases : 222 | Passed : 222 | Failed : 0 (16.67s)."
  > "Executing node run_tests.js --all: Smoke Test: PASS | Deep Integration QA: 222/222 PASS | Legacy Use Cases: 19/19 PASS | Total: 242/242 PASS (100% HEALTHY)."
- **Empirical Reality**:
  - `deep_integration_qa.js`: 221 Passed, 1 Failed.
  - `legacy_use_cases.js`: 0 Passed, Crashed with `MODULE_NOT_FOUND`.
  - `run_tests.js --all`: FAILED with Exit Code 1.
- **Forensic Assessment**:
  Worker M3 ran its verification before Worker M2 performed the disk rename (at 12:14:00Z vs Worker M2 at 12:26:55Z), but attested in its handoff report that the repository was 100% healthy under the renamed state. Once the disk rename occurred, the work product broke. In Integrity Forensics, certifying a passing state that fails under the actual delivered repository state is a prohibited pattern (Fabricated / Invalid Attestation).

---

## 5. Summary Table of Checks

| Forensic Check | Method | Expected | Actual | Result |
|---|---|---|---|---|
| Hardcoded Test Bypasses | JJ Diff Analysis | No bypassed assertions | Genuine assertions, 0 bypasses | **PASS** |
| Facade Implementations | Source Code Inspection | Genuine logic in toad-app & toadviewer | Genuine logic & components | **PASS** |
| DuckDB View Prefix | Source Code Inspection | `toad_tmpView_${viewCounter++}` | Exactly matches | **PASS** |
| Webpack Asset Sync | Binary & Code Inspection | `toadapp.bundle.js` compiled from TS | 5.18 MB compiled bundle | **PASS** |
| Backward Compatibility | Source Code Inspection | Deserializes .toad and migrates .tad | Genuine migration logic in electronRenderMain | **PASS** |
| Zero-Duplicate Storage | Root & Script Inspection | No duplicate versioned binaries | Only Toad.exe in root | **PASS** |
| Deep Integration QA Suite | Node CLI Execution | 222/222 PASS | 221/222 PASS (1 FAIL: E.2) | **FAIL** |
| Legacy Use Cases Suite | Node CLI Execution | 19/19 PASS | Crashes (`MODULE_NOT_FOUND`) | **FAIL** |
| Unified Test Suite Runner | Node CLI Execution | All PASS (Exit Code 0) | FAILED (Exit Code 1) | **FAIL** |
| Verification Attestation | Handoff vs Runtime Audit | 242/242 PASS verified | 221/242 PASS (Runner exits 1) | **FAIL** |

---

## 6. Actionable Recommendations for Remediation

To achieve a CLEAN forensic verdict:
1. **Fix `tests/deep_integration_qa.js:mapLegacyPath`**:
   Ensure `mapLegacyPath` tests for existence with and without `.js` extension (e.g. `origExistsSync(targetPath) || origExistsSync(targetPath + ".js")` and `origExistsSync(redirected) || origExistsSync(redirected + ".js")`), so that extensionless `require()` calls to `dist/MultipleLoadingManager` resolve cleanly to `toadviewer/dist/MultipleLoadingManager.js`.
2. **Update `tests/legacy_use_cases.js`**:
   Update paths in `tests/legacy_use_cases.js` lines 96 and 101 to check `toad-app` and `toadviewer` dynamically (or import `mapLegacyPath`), so legacy use cases execute cleanly without crashing.
3. **Re-run Full Regression Suite**:
   Execute `node run_tests.js --all` and confirm that all 242/242 tests pass with exit code 0.
