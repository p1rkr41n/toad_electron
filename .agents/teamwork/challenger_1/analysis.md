# EMPIRICAL QA & COMPATIBILITY VERIFICATION REPORT (CHALLENGER 1)

**Date**: 2026-11-03  
**Target Milestone**: TOAD v2.4.8 Rebrand & Packaging Regression Verification  
**Verifier**: Challenger 1 (Automated Test Suite Challenger)  
**Execution Environment**: Windows 11 (x64), Node.js v18.20.4 (`D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe`)  
**Verdict**: **REQUEST_CHANGES**  

---

## 1. Executive Summary

As Challenger 1, an empirical code-executing verifier operating under strict review-only constraints, live test executions were performed across all test suites, backward compatibility harnesses, and codebase import references.

While the runtime application build, smoke test, and `.tad` / `.toad` workspace serialization logic exhibit high integrity, **the automated test suite does NOT pass cleanly**:
1. `node run_tests.js --all` exits with code `1` (FAIL).
2. `tests/deep_integration_qa.js` passes 221 of 222 tests, but fails test `E.2` with `MODULE_NOT_FOUND`.
3. `tests/legacy_use_cases.js` fails immediately on startup with `MODULE_NOT_FOUND` (exit code 1).
4. Additional test harnesses (`empirical_challenge_harness_1.js`, `empirical_challenge_harness_2.js`, `test_milestone2_ui_error.js`) fail due to hardcoded unredirected paths to `tad-app` and `tadviewer`.
5. Backward compatibility parsing between legacy `.tad` (v1) and modern `.toad` (v2) formats was verified empirically with 7/7 assertions passing in custom verifier `verify_backward_compat.js`.

---

## 2. Live Test Suite Execution Results

### 2.1 Unified Runner: `node run_tests.js --all`
- **Command**: `& "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" run_tests.js --all`
- **Result**: **FAILED (Exit Code 1)**
- **Breakdown**:
  - `Smoke Test (v2.1.6)`: **PASS** (100% healthy, runtime bootstrap verified)
  - `Deep Integration QA (133 Tests)`: **FAIL** (221 passed, 1 failed, duration 16.45s)
  - `Legacy Use Cases (19 Tests)`: **FAIL** (Crashed with `MODULE_NOT_FOUND`)

---

### 2.2 Deep Integration QA: `tests/deep_integration_qa.js`
- **Command**: `& "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tests/deep_integration_qa.js`
- **Total Test Cases**: 222
- **Passed**: 221
- **Failed**: 1
- **Duration**: 16.40s

#### Line-by-Line Breakdown of Suites:
| Suite | Scope | Status | Notes |
|-------|-------|:------:|-------|
| Suite A | Dual Engine Driver & Connection Pool | PASS (2/2) | Singletons isolated; Connection pool reuses connections without leaking |
| Suite B | FSDriver E2E Ingestion & Instant UI Mount | PASS (4/4) | Directory scan, background ingestion, instant cache hit (< 15ms), JSONL schema |
| Suite C | High Concurrency Stress Test (4 workers vs 20 UI queries) | PASS (1/1) | p50: 38.72ms, p95: 44.80ms, p99: 44.80ms (< 50ms budget) |
| Suite D | Memory Limits, Thread Budgeting & Fast Row Count | PASS (2/2) | O(1) row count from Parquet metadata; Thread isolation respected |
| Suite E | Toad Dual Engine IPC & RAM First-Page Micro-Cache | **FAIL (2/3)** | **E.2 FAILED**: `MODULE_NOT_FOUND` |
| Suite F | Multi-Format Column Extractor & Custom Naming | PASS (9/9) | JSON, array index, KV pairs, delimiter trim, regex extraction |
| Suite G | Header Prefix CTE, Quote Pairs & Inline Cast | PASS (7/7) | CTE `WITH split_log AS (...)`, vector view creation < 15ms |
| Suite H-JJ | Forensic, Project Reconcile, Search, Multi-Project | PASS (180+) | All sub-suites pass cleanly |
| Suite KK | English UI Standardization & Path Tooltips | PASS (7/7) | Zero Vietnamese characters, full absolute path resolution |
| Suite LL | Safe Profile & Out-of-Process Worker Sandbox | PASS (6/6) | Safe ingest profile 100% VARCHAR, purge `escape='"'` |
| Suite MM | Consistent Multi-Stage CSV Ingestion | PASS (5/5) | MFTECmd forensic CSV, 1-col corrupted cache auto-eviction |
| Suite NN | CSV Parsing Stability & Non-blocking Error Handling | PASS (4/4) | 40GB mini-sample, synthetic cache eviction, recursive purge |

#### Detailed Failure Analysis for Test E.2:
```
======================================================================
  SUITE E: Toad v2.0.1 Dual Engine IPC & RAM First-Page Micro-Cache
======================================================================
  ✓ [PASS] E.1 RemoteConnection correctly serializes isBackground flag across IPC (1.63 ms)
  ✗ [FAIL] E.2 RAM First-Page Micro-Cache returns 1000 rows in < 2ms with 0 Disk I/O
    Error: Cannot find module 'D:\Shared_UserData\Downloads\tad\tad-master\packages\tadviewer\dist\MultipleLoadingManager'
Require stack:
- D:\Shared_UserData\Downloads\tad\tests\deep_integration_qa.js
    at Module._resolveFilename (node:internal/modules/cjs/loader:1140:15)
```
- **Root Cause**:
  In `tests/deep_integration_qa.js:393`:
  ```javascript
  const { MultipleLoadingManager } = require(path.resolve(ROOT_DIR, "tad-master/packages/tadviewer/dist/MultipleLoadingManager"));
  ```
  `tests/deep_integration_qa.js` implements a path redirection hook in `mapLegacyPath(targetPath)` (lines 26-40):
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
  Notice that `MultipleLoadingManager` is passed to `require()` **without the `.js` extension**.  
  `origExistsSync(".../toadviewer/dist/MultipleLoadingManager")` returns `false` because the actual file is `MultipleLoadingManager.js`.  
  Because `origExistsSync` returns `false`, `mapLegacyPath` fails to return `redirected` and instead returns `targetPath` unchanged. `Module._resolveFilename` then throws `MODULE_NOT_FOUND`.

---

### 2.3 Legacy Use Cases: `tests/legacy_use_cases.js`
- **Command**: `& "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tests/legacy_use_cases.js`
- **Result**: **FAILED (Exit Code 1)**
- **Verbatim Error**:
  ```
  Error: Cannot find module 'D:\Shared_UserData\Downloads\tad\tad-master\packages\tad-app\app_dist\portableAppData'
  Require stack:
  - D:\Shared_UserData\Downloads\tad\tests\legacy_use_cases.js
      at Module._resolveFilename (node:internal/modules/cjs/loader:1140:15)
      at Module._load (node:internal/modules/cjs/loader:981:27)
      at Module.require (node:internal/modules/cjs/loader:1231:19)
      at require (node:internal/modules/helpers:177:18)
      at Object.<anonymous> (D:\Shared_UserData\Downloads\tad\tests\legacy_use_cases.js:96:5)
  ```
- **Root Cause**:
  `tests/legacy_use_cases.js` directly requires legacy package directories without any shim or alias:
  - Line 96: `require(path.resolve(ROOT_DIR, "tad-master/packages/tad-app/app_dist/portableAppData"))`
  - Line 101: `require(path.resolve(ROOT_DIR, "tad-master/packages/tadviewer/dist/MultipleLoadingManager"))`
  Because `packages/tad-app` and `packages/tadviewer` were renamed on disk to `toad-app` and `toadviewer`, and **no backward-compatibility NTFS directory junctions exist at `packages/tad-app` and `packages/tadviewer`**, these imports fail immediately.

---

### 2.4 Smoke Test: `tests/smoke_test.js`
- **Command**: `& "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tests/smoke_test.js`
- **Result**: **PASS (100% HEALTHY)**
- **Verified Metrics**:
  - `Toad.exe` binary size: 72.10 MB (within budget < 75 MB)
  - PE Header: Valid 'MZ' magic bytes
  - `app.asar`: Contains 6,027 packaged entries
  - BigQuery remnants: 0 (completely absent)
  - Lodash runtime backend: Present
  - Sourcemap (`.map`) files: 0 (Webpack prod `devtool=false`)
  - Live process bootstrap: Spawned and initialized cleanly without uncaught exceptions

---

### 2.5 Database Layer & CSV Test Suites
- `tests/db_layer_qa.js`: **PASS (4/4)**
  - Schema initialization, typed NULL tombstones, window functions, and safe ledger reset verified.
- `tests/test_csv_empirical_challenger.js`: **PASS (12/12)**
  - 40GB sample parsing (11 proper columns, 0 synthetic), gateway cache eviction, RFC-4180 quotes, and Vietnamese Unicode characters verified.

---

### 2.6 Ancillary Test Suites (Renaming Regressions)
- `tests/test_milestone2_ui_error.js`: **FAIL** (`ENOENT: open '.../tad-master/packages/tad-app/app/main.ts'`)
- `tests/empirical_challenge_harness_1.js`: **FAIL** (`Cannot find module '.../tad-master/packages/tadviewer/dist/components/ProjectFilesTable'`)
- `tests/empirical_challenge_harness_2.js`: **FAIL (8/12 failed)** due to `ENOENT` / `MODULE_NOT_FOUND` against `packages/tad-app` and `packages/tadviewer`.

---

## 3. Backward Compatibility Empirical Verification

To verify R3 (transparent backward compatibility for `.tad` v1 and `.toad` v2 files), a dedicated empirical test harness was constructed and executed:  
`d:\Shared_UserData\Downloads\tad\.agents\teamwork\challenger_1\verify_backward_compat.js`.

### Test Execution Results: 7/7 PASSED
```
======================================================================
  EMPIRICAL CHALLENGER: WORKSPACE BACKWARD COMPATIBILITY TEST HARNESS
======================================================================
  ✓ [PASS] TC-1: Load and parse real repository legacy .tad workspace (tadFileFormatVersion: 1)
  ✓ [PASS] TC-2: Load and parse second legacy .tad workspace with filters
  ✓ [PASS] TC-3: Serialize modern workspace produces dual version headers (toadFileFormatVersion: 2, tadFileFormatVersion: 2)
  ✓ [PASS] TC-4: Deserialize modern .toad workspace with openType='toad'
  ✓ [PASS] TC-5: Deserialize modern workspace opened via .tad extension (backward compatibility)
  ✓ [PASS] TC-6: Resilient migration fallback when file has targetPath without dsPath
  ✓ [PASS] TC-7: Adversarial check - malformed JSON throws SyntaxError
======================================================================
  COMPATIBILITY VERIFICATION RESULT: 7/7 PASSED
======================================================================
```

### Verification Observations:
1. **Real Legacy Workspaces (`.tad`, v1)**:
   - `tad-master/packages/toad-app/examples/movie-grossByCountryDirector.tad` contains `"tadFileFormatVersion": 1` and `"targetPath": "/Users/antony/data/movie_metadata.csv"`.
   - `openParamsDSPath` in `electronRenderMain.tsx:93-105` successfully detects `tadFileFormatVersion === 1` and automatically constructs `targetDSPath`:
     ```json
     {
       "sourceId": { "providerName": "localfs", "resourceId": "/Users/antony/data/movie_metadata.csv" },
       "path": ["."]
     }
     ```
2. **Modern Workspaces (`.toad`, v2)**:
   - `serialize` in `appWindow.ts:373-380` emits:
     ```json
     {
       "toadFileFormatVersion": 2,
       "tadFileFormatVersion": 2,
       "contents": { ... }
     }
     ```
   - Both `toadFileFormatVersion: 2` and `tadFileFormatVersion: 2` are present, enabling forward and backward compatibility.
3. **Dialog Filters**:
   - Save dialog in `appWindow.ts:388-403` prioritizes `TOAD Workspace Files (*.toad)` as the default filter while offering `Legacy TAD Workspace Files (*.tad)`.
   - Open dialog in `appWindow.ts:254-266` prioritizes `.toad` and includes `.tad`.

---

## 4. Package Renaming & Dependency Reference Audit

### 4.1 Monorepo Structure & Package Manifests
- `tad-master/packages/toad-app/package.json`:
  - `name`: `"toad-app"`
  - `dependencies`: `"toadviewer": "^0.12.0"`
  - `version`: Currently `"2.4.7"` (Needs bump to `"2.4.8"` per R5)
  - `asar` exclusions: Line 140-141 excludes `!**/node_modules/toadviewer/**` and `!**/node_modules/tadviewer/**`.
- `tad-master/packages/toadviewer/package.json`:
  - `name`: `"toadviewer"`
  - `version`: Currently `"2.4.7"` (Needs bump to `"2.4.8"`)
  - `main`: `"dist/toadviewer.js"`

### 4.2 Webpack & HTML Asset Synchronization
- `tad-master/packages/toad-app/webpack.config.js`:
  - Entry: `toadapp: "./src/electronRenderMain.tsx"` (Line 119)
  - Output: `toadapp.bundle.js` (Verified 5.18 MB on disk)
  - Module aliases (Lines 18-19): Both `"toadviewer"` and `"tadviewer"` resolve to `../toadviewer/dist/toadviewer.js`.
- `tad-master/packages/toad-app/html/index.html`:
  - Line 11: `<script src="toadapp.bundle.js"></script>` correctly references the bundle.
- `tad-master/packages/toadviewer/webpack.config.js`:
  - Builds dual bundles: `dist/toadviewer.js` and `dist/tadviewer.js` (with source maps).

### 4.3 Missing Directory Junctions (The Primary Defect)
In `tad-master/packages/toad-app/node_modules/`, NTFS junctions were created:
- `toadviewer` -> `packages/toadviewer`
- `tadviewer` -> `packages/toadviewer`

**HOWEVER**, in `tad-master/packages/`:
- `packages/toad-app` exists
- `packages/toadviewer` exists
- **`packages/tad-app` DOES NOT EXIST** (no junction / symlink)
- **`packages/tadviewer` DOES NOT EXIST** (no junction / symlink)

Because `tad-master/packages/tad-app` and `tad-master/packages/tadviewer` do not exist as NTFS junctions, any test, script, or external consumer requiring paths from `packages/tad-app` or `packages/tadviewer` fails.

---

## 5. Required Remediations (For Workers / Orchestrator)

To achieve **100% test pass rate (222+ tests, smoke tests, and legacy suites)** and earn an **APPROVE** verdict, the following actions must be taken:

1. **Create Package-Level Backward-Compatibility NTFS Junctions**:
   In `tad-master/packages/`:
   ```powershell
   cmd /c mklink /J "D:\Shared_UserData\Downloads\tad\tad-master\packages\tad-app" "D:\Shared_UserData\Downloads\tad\tad-master\packages\toad-app"
   cmd /c mklink /J "D:\Shared_UserData\Downloads\tad\tad-master\packages\tadviewer" "D:\Shared_UserData\Downloads\tad\tad-master\packages\toadviewer"
   ```
   *Impact*: Resolves `tests/legacy_use_cases.js`, `test_milestone2_ui_error.js`, `empirical_challenge_harness_1.js`, and `empirical_challenge_harness_2.js` immediately.

2. **Fix Extensionless Path Handling in `mapLegacyPath` (`tests/deep_integration_qa.js`)**:
   In `tests/deep_integration_qa.js:26-40`:
   Update `mapLegacyPath` so that if `origExistsSync(redirected)` is false, it also checks `origExistsSync(redirected + ".js")` or `origExistsSync(redirected + ".ts")`:
   ```javascript
   function fileOrModuleExists(p) {
     return origExistsSync(p) || origExistsSync(p + ".js") || origExistsSync(p + ".ts") || origExistsSync(path.join(p, "index.js"));
   }
   ```
   Or alternatively, update line 393 in `tests/deep_integration_qa.js` to require `toadviewer` or include `.js`.
   *Impact*: Resolves the single failure in test `E.2`, bringing `deep_integration_qa.js` to 222/222 (100% pass).

3. **Complete Version Bump to `v2.4.8`**:
   Execute `node tools/bump_version.js 2.4.8` so that package manifests and UI dialogs match the target release.
