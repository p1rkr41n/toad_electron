# Technical Investigation & QA Analysis Report: Toad Rebranding v2.4.8 (R5 & QA)

**Explorer:** Explorer 3 (Build & Test Explorer)  
**Investigation Date:** 2026-11-03  
**Integrity Mode:** Development (Read-Only Investigation)  
**Target Version:** `v2.4.8` (SemVer 3-digit increment from `v2.4.7`)  
**Scope:** Build scripts, packaging pipelines, automated test suites, Jujutsu VCS, and release conventions.

---

## 1. Executive Summary

This report delivers the technical investigation of the build, test, and release packaging systems for the comprehensive rebranding of TAD to TOAD at version **v2.4.8**.

### Key Findings at a Glance:
1. **Build Scripts (`fastbuild.ps1`, `dist_package.ps1`)**: Currently hardcode paths to `tad-master\packages\tad-app` and `tadviewer`, and explicitly verify `tadapp.bundle.js`. They must be updated to reference `toad-app`, `toadviewer`, and `toadapp.bundle.js`, and include version `v2.4.8` in production bundle assertions.
2. **Test Suites & Regression Gate**: Running `node run_tests.js` executed 223 tests. The smoke test passed cleanly (100%), but 28 tests in `deep_integration_qa.js` failed exclusively due to outdated version synchronization whitelist assertions that terminate at `2.4.6` (not including `2.4.7` or `2.4.8`). Furthermore, `deep_integration_qa.js` contains over 100 hardcoded paths to `tad-app` and `tadviewer` that will break with `ENOENT` upon disk rename unless synchronized.
3. **Internal SQL Views & Assertions**: The DuckDB temporary view prefix in `reltab-duckdb.ts:35` is currently `tad_tmpView_${viewCounter++}`. No test cases assert on the string prefix directly; queries are verified dynamically via driver abstractions.
4. **VCS & Packaging Compliance**: Jujutsu (`jj`) is functioning properly in colocated mode with Git (`main* master*`). Workspace adheres strictly to the Zero-Duplicate Binary Storage policy in `AGENTS.md`.

---

## 2. Build & Packaging Scripts Inspection

### 2.1 `fastbuild.ps1`
* **File Location:** `d:\Shared_UserData\Downloads\tad\fastbuild.ps1` (195 lines)
* **Purpose:** Unpacked fast development build bypassing 7-Zip compression (~150s faster).
* **Observed References & Necessary Updates:**
  - **Line 45:** `$appDir = "$rootDir\tad-master\packages\tad-app"`  
    ➔ Change to: `$appDir = "$rootDir\tad-master\packages\toad-app"`
  - **Line 75-76:**  
    `Write-Output ">>> [STEP 1.3] Building tadviewer..."`  
    `Set-Location "$rootDir\tad-master\packages\tadviewer"`  
    ➔ Change to: `toadviewer` and `$rootDir\tad-master\packages\toadviewer`
  - **Lines 89, 91:** Messages referencing `tad-app Webpack Bundles`  
    ➔ Change to: `toad-app Webpack Bundles`
  - **Line 101, 105-107:** Bundle integrity checks:
    ```powershell
    if (-not (Test-Path "$appDir\dist\main.bundle.js")) {
        throw "ERROR: dist\main.bundle.js was not generated!"
    }
    if (-not (Test-Path "$appDir\dist\tadapp.bundle.js")) {
        throw "ERROR: dist\tadapp.bundle.js was not generated!"
    }
    ```
    ➔ Change line 105 to verify: `"$appDir\dist\toadapp.bundle.js"`.
  - **Binary Output:** Outputs to `build/Toad-$version/Toad.exe` and sets junction `build/latest`. Executable is already named `Toad.exe` (lines 126, 179).

### 2.2 `dist_package.ps1`
* **File Location:** `d:\Shared_UserData\Downloads\tad\dist_package.ps1` (110 lines)
* **Purpose:** Production release build with electron-builder maximum compression, asar integrity verification, and single-binary packaging.
* **Observed References & Necessary Updates:**
  - **Line 9:** `$appDir = "$rootDir\tad-master\packages\tad-app"`  
    ➔ Change to: `$rootDir\tad-master\packages\toad-app`
  - **Lines 30-32:** Building `tadviewer`  
    ➔ Change to: `toadviewer` at `tad-master\packages\toadviewer`
  - **Lines 34-36:** Building Webpack Production for `tad-app`  
    ➔ Change to: `toad-app`
  - **Lines 38-42:** Verification of bundle:
    ```powershell
    $bundlePath = "$appDir\dist\tadapp.bundle.js"
    if (-not (Test-Path $bundlePath)) {
        throw "ERROR: Cannot find tadapp.bundle.js!"
    }
    ```
    ➔ Change to: `$bundlePath = "$appDir\dist\toadapp.bundle.js"`
  - **Line 44:** Version assertion in bundle:
    ```powershell
    if (-not ($bundleContent.Contains("v2.4.7") -or $bundleContent.Contains("v2.4.6.1") -or ...))
    ```
    ➔ Must add `-or $bundleContent.Contains("v2.4.8")`.
  - **Line 50:** Sourcemap assertion:
    ```powershell
    if (Test-Path "$appDir\dist\tadapp.bundle.js.map")
    ```
    ➔ Change to check: `"$appDir\dist\toadapp.bundle.js.map"`.
  - **Line 59:** `$asarPath = "$appDir\release\win-unpacked\resources\app.asar"` (Threshold: 45.0 MB).
  - **Line 103-106:** Single Canonical Output:
    `$canonicalReleaseExe = "$releaseDir\Toad-$version-x64-portable.exe"`  
    Strictly copies to `$canonicalReleaseExe` and `$rootDir\Toad.exe`. Zero duplicate aliases on disk.

### 2.3 `package_release.ps1`
* **File Location:** `d:\Shared_UserData\Downloads\tad\package_release.ps1` (11 lines)
* **Observed References & Updates:**
  - **Line 3:** `[string]$Version = "2.4.7"`  
    ➔ Change to: `[string]$Version = "2.4.8"`
  - Calls `.agents\skills\releases\scripts\package_release.ps1` to produce:
    - `releases/Toad-2.4.8-x64-portable.zip`
    - `releases/SHA256SUMS.txt`
    - `releases/HelloKittyXamKinLung.Toad.yaml`

### 2.4 `tools/bump_version.js`
* **File Location:** `d:\Shared_UserData\Downloads\tad\tools\bump_version.js` (124 lines)
* **Observed References & Updates:**
  - **Line 33:** `const pkgAppPath = path.join(ROOT_DIR, "tad-master/packages/tad-app/package.json");`  
    ➔ Change to support `tad-master/packages/toad-app/package.json` (with fallback to `tad-app`).
  - **Line 77:** `updatePackageJson("tad-master/packages/tad-app/package.json", targetVersion);`  
    ➔ Change to `toad-app`.
  - **Line 82-84:** `updatePackageJson("tad-master/packages/tadviewer/package.json", targetVersion);`  
    ➔ Change to `toadviewer`.
  - **Line 87:** `updateFile("tad-master/packages/tadviewer/src/components/RegexDialog.tsx", ...)`  
    ➔ Change to `toadviewer`.
  - **Lines 91-101:** Automatically synchronizes `dist_package.ps1` bundle checks and executable names.

### 2.5 `tad-master/lerna.json`
* **File Location:** `d:\Shared_UserData\Downloads\tad\tad-master\lerna.json` (10 lines)
* **Observed Reference:**
  - **Line 6:** `"ignore": ["reltab-sqlite", "tad-app"]`  
    ➔ Change to: `"ignore": ["reltab-sqlite", "toad-app"]`

---

## 3. Test Suites & Test Runner Deep Dive

### 3.1 Test Execution Environment
- Embedded Node path: `d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe`
- Mingit path: `d:\Shared_UserData\Downloads\tad\mingit\cmd`
- Cargo bin: `C:\Users\huydq\.cargo\bin`
- Invocation command in PowerShell:
  ```powershell
  $env:PATH = "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64;D:\Shared_UserData\Downloads\tad\mingit\cmd;$env:USERPROFILE\.cargo\bin;$env:PATH"
  node run_tests.js [--all | --smoke | --qa | --legacy]
  ```

### 3.2 Inventory of Test Suites

| Test File | Test Count | Current Status | Description |
| :--- | :--- | :--- | :--- |
| `tests/smoke_test.js` | 1 suite (6 checks) | **PASS** | Live process bootstrap, PE MZ header, asar contents & BigQuery absence |
| `tests/legacy_use_cases.js` | 19 tests | **PASS** (5.54s) | Config auto-healing, SJF queue, priority click, CPU thread isolation |
| `tests/deep_integration_qa.js` | 222 tests | **194 PASS / 28 FAIL** | Dual DuckDB, FSDriver, multi-format extraction, state ledger, cache eviction |
| `tests/empirical_challenge_harness_1.js` | 20 tests | **PASS** (0.12s) | `getRelativeParentDir` edge cases, 20k file search, table sorting |
| `tests/empirical_challenge_harness_2.js` | 12 tests | **PASS** (0.42s) | Ingestion error suppression, badging, recursive temp purge |
| `tests/test_csv_empirical_challenger.js` | 12 tests | **PASS** (3.6s) | sample_40gb CSV parsing, gateway cache eviction, RFC-4180 |
| `tests/test_milestone2_ui_error.js` | 9 checks | **PASS** (0.1s) | Non-blocking error handling and status badging |
| `tests/db_layer_qa.js` | 4 tests | **PASS** (0.15s) | Parquet ledger schema, typed NULL tombstones, window functions |

### 3.3 Root Cause Analysis of the 28 Test Failures in `deep_integration_qa.js`
When running `node run_tests.js`, 28 test cases failed. Every single failure was investigated:
- **26 failures** were in version synchronization gate tests:
  `K.3`, `L.4`, `M.6`, `O.4`, `P.6`, `Q.5`, `R.6`, `S.3`, `T.6`, `V.6`, `Y.6`, `Z.5`, `AA.5`, `BB.2`, `BB.5`, `CC.3`, `DD.4`, `EE.2`, `FF.5`, `GG.7`, `HH.6`, `II.12`, `JJ.8`, `KK.7`, `LL.6`, `MM.5`.
  - **Direct Cause:** In the previous release commit (`9b2dca3c`), version was bumped to `2.4.7`. However, these test assertions checked `pkgApp.version` against hardcoded whitelists ending at `"2.4.6"`:
    ```javascript
    assert(pkgApp.version === "2.4.2" || ... || pkgApp.version === "2.4.6", ...);
    ```
    Since actual was `"2.4.7"`, the assertion threw.
- **2 failures** (`K.2`, `M.1`):
  - **Direct Cause:** Asserted that `RegexDialog.tsx` contains a version badge matching a whitelist ending at `v2.4.6`. Because `RegexDialog.tsx` contained `v2.4.7`, the assertion threw.
- **ZERO failures were due to functional bugs or regressions!**

### 3.4 Impact of Monorepo Package Renaming on Test Suites
When `tad-app` and `tadviewer` are renamed to `toad-app` and `toadviewer`:
1. `tests/deep_integration_qa.js`:
   - Contains ~110 path references like: `path.resolve(ROOT_DIR, "tad-master/packages/tad-app/...")` and `tad-master/packages/tadviewer/...`.
   - Line 2190 asserts on `dist/tadapp.bundle.js`.
2. `tests/smoke_test.js`:
   - Line 39: `asarPath` references `packages/tad-app/...`.
   - Line 58: `unpackedExe` references `packages/tad-app/...`.
3. `tests/legacy_use_cases.js`:
   - Line 79, 101: `packages/tadviewer/...`
   - Line 96: `packages/tad-app/...`
4. `tests/test_milestone2_ui_error.js`:
   - Lines 11, 25, 39, 56, 67, 79 reference `tad-app` and `tadviewer`.

**Recommended Test Path Modernization Strategy:**
- In `deep_integration_qa.js` and other test scripts, implement a robust path resolver helper:
  ```javascript
  const getPackagePath = (pkg, subPath) => {
    const modern = path.resolve(ROOT_DIR, `tad-master/packages/${pkg}/${subPath}`);
    if (fs.existsSync(modern)) return modern;
    const legacyPkg = pkg.replace(/^toad/, "tad");
    const legacy = path.resolve(ROOT_DIR, `tad-master/packages/${legacyPkg}/${subPath}`);
    if (fs.existsSync(legacy)) return legacy;
    return modern;
  };
  ```
- Or update the paths directly to `toad-app` and `toadviewer` while updating the version whitelists to include `2.4.7` and `2.4.8`.
- This ensures 100% of the 222+ tests pass cleanly (222/222 PASS).

### 3.5 View Prefixes & Bundle Assertions
- In `tad-master/packages/reltab-duckdb/src/reltab-duckdb.ts`:
  - Line 35: `const genViewName = (): string => \`tad_tmpView_\${viewCounter++}\`;`
  - Needs to become: `const genViewName = (): string => \`toad_tmpView_\${viewCounter++}\`;`
  - Verified: No test cases assert on the literal string `"tad_tmpView_"`. All tests use `reltabFS` / `reltabDuckDB` driver methods, so changing to `toad_tmpView_` will NOT cause test failures.

---

## 4. Webpack, Asar & File Format Analysis

### 4.1 Webpack Configuration (`toad-app/webpack.config.js`)
- Line 117 currently defines entry:
  ```javascript
  var render = {
    target: "electron-renderer",
    entry: {
      tadapp: "./src/electronRenderMain.tsx",
    },
  };
  ```
- Changing entry to `toadapp: "./src/electronRenderMain.tsx"` will output `toadapp.bundle.js` to `dist/`.
- `toad-app/html/index.html` (line 11) currently contains:
  `<script src="tadapp.bundle.js"></script>`
  MUST be updated to `<script src="toadapp.bundle.js"></script>`. If omitted, the app loads with a blank white screen.

### 4.2 Asar Exclusion & Footprint Gate
- In `toad-app/package.json` line 140:
  Currently: `"!**/node_modules/tadviewer/**"`
  Must be updated to: `"!**/node_modules/toadviewer/**"`
- Footprint gate in `dist_package.ps1` lines 65-67 enforces `app.asar` size $\le 45.0\text{ MB}$.
- Current baseline: ~21 MB (well below 45 MB).

### 4.3 Workspace File Formats (`.toad` vs `.tad`)
- In `appWindow.ts`:
  - Line 344: `const TAD_FILE_FORMAT_VERSION = 2;` (format version 2).
  - Lines 360-368: `saveAsDialog` already prioritizes `.toad` with fallback to `.tad`:
    ```typescript
    filters: [{ name: "Toad Workspace files", extensions: ["toad", "tad"] }]
    ```
  - Lines 237-240: `openDialog` currently uses `dataFileExtensions.concat(["tad", "sqlite", "duckdb"])`.  
    Must be updated to include `"toad"`: `["toad", "tad", "sqlite", "duckdb"]`.
  - In `toad-app/package.json` `fileAssociations`:
    Must add `.toad` entry with role `Editor`, and retain `.tad` entry for backward compatibility.
  - In `toad-app/src/electronRenderMain.tsx:93`:
    Inspects `parsedFileState.tadFileFormatVersion === 1` and `toadFileFormatVersion === 2`. Backward compatibility is preserved.

---

## 5. Jujutsu (`jj`) Status & Zero-Duplicate Binary Policy

### 5.1 Jujutsu Local VCS Status
- Executable: `tools/jj/jj.exe` (or `C:\Users\huydq\.cargo\bin\jj.exe`).
- Colocated repository with Git:
  - Working copy: `@  klqlvyzy ba719881 (no description set)`
  - Parent: `○  mqorlvtq 9b2dca3c main* master* | release: Toad v2.4.7 portable packaging, release notes, checksums and manifests`
- Commits are tracked cleanly using `jj describe -m "..."`.

### 5.2 Zero-Duplicate Binary Storage Policy
- Rule in `AGENTS.md`: Scripts must never copy the binary under historical version names (e.g., `Toad 2.0.8.exe`, `Toad 2.4.0.exe`).
- Canonical outputs are strictly:
  1. `releases/Toad-<version>-x64-portable.exe`
  2. `releases/Toad-<version>-x64-portable.zip`
  3. Root `Toad.exe` (development/test binary)
- Verified: Root contains only `Toad.exe` (72.1 MB). `releases/` contains exactly one portable `.exe` and `.zip` per released version.

---

## 6. Actionable Implementation Checklist for Subsequent Phases

```markdown
- [ ] 1. Monorepo Package Rename (Giai đoạn 1 & 2):
  - Rename `tad-master/packages/tad-app` -> `tad-master/packages/toad-app`
  - Rename `tad-master/packages/tadviewer` -> `tad-master/packages/toadviewer`
  - Update `tad-master/packages/toad-app/node_modules/toadviewer` junction
  - Update imports `from "tadviewer"` to `from "toadviewer"`
  - Update `lerna.json` ignore to `toad-app`
- [ ] 2. Webpack & Assets (Giai đoạn 2):
  - Change entry to `toadapp` in `toad-app/webpack.config.js`
  - Update `<script src="toadapp.bundle.js"></script>` in `toad-app/html/index.html`
  - Update `!**/node_modules/toadviewer/**` in `toad-app/package.json`
- [ ] 3. Layer Compatibility & View Prefix (Giai đoạn 1):
  - `reltab-duckdb.ts`: `const genViewName = (): string => \`toad_tmpView_\${viewCounter++}\`;`
  - `openParams.ts`: add `toad` to `OpenType` and `OpenToad` interface
  - `appWindow.ts`: add `.toad` to `openDialog` file filters
- [ ] 4. Build Scripts & Versioning (Giai đoạn 3):
  - `fastbuild.ps1`: update `$appDir` to `toad-app`, `toadviewer`, verify `toadapp.bundle.js`
  - `dist_package.ps1`: update `$appDir` to `toad-app`, `toadviewer`, verify `toadapp.bundle.js`, add `v2.4.8`
  - `package_release.ps1`: bump `$Version = "2.4.8"`
  - `tools/bump_version.js`: update package paths to `toad-app` and `toadviewer`
  - Bump project versions to `2.4.8`
- [ ] 5. Test Suite Modernization (Giai đoạn 4):
  - In `deep_integration_qa.js`: update `tad-app`/`tadviewer` paths and add `2.4.7` & `2.4.8` to version whitelists
  - In `smoke_test.js`: update `tad-app` path to `toad-app`
  - In `legacy_use_cases.js`: update paths to `toad-app` and `toadviewer`
  - In `test_milestone2_ui_error.js`: update paths to `toad-app` and `toadviewer`
  - Execute test runner: verify 222/222 PASS
- [ ] 6. Packaging & Release Verification (Giai đoạn 5):
  - Execute `fastbuild.ps1` -> verify `build/Toad-2.4.8/Toad.exe` runs
  - Execute `dist_package.ps1` -> verify `releases/Toad-2.4.8-x64-portable.exe` and `Toad.exe`
  - Execute `package_release.ps1` -> generate `.zip`, `SHA256SUMS.txt`, `HelloKittyXamKinLung.Toad.yaml`
  - Create `releases/v2.4.8_NOTES.md`
  - Commit cleanly via Jujutsu (`jj`)
```
