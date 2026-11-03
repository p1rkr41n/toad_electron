# Deep Empirical Analysis: Build Scripts & Packaging Stress Verification

**Identity**: Challenger 2 (Build Scripts & Packaging Stress Challenger)  
**Date**: 2026-11-03  
**Target Milestone**: TOAD v2.4.8 Rebrand — Milestone 2 & Release Pre-flight  
**Working Directory**: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\challenger_2`  

---

## 1. Executive Summary & Verdict

### Verdict: **REQUEST_CHANGES**

While all core build and packaging scripts (`fastbuild.ps1`, `dist_package.ps1`, `package_release.ps1`), Webpack bundles (`toadapp.bundle.js`, `toadviewer.js`), Asar exclusion rules, and Zero-Duplicate binary policies pass the isolated empirical challenge (46/46 passed in `tests/test_pipeline_challenge.js`), **the unified regression test suite (`node run_tests.js --all`) FAILS with exit code 1**.

Specifically:
1. `tests/deep_integration_qa.js` **FAILS** at test `E.2`:
   `Error: Cannot find module 'D:\Shared_UserData\Downloads\tad\tad-master\packages\tadviewer\dist\MultipleLoadingManager'`.
2. `tests/legacy_use_cases.js` **FAILS** at startup with exit code 1:
   `Error: Cannot find module 'D:\Shared_UserData\Downloads\tad\tad-master\packages\tad-app\app_dist\portableAppData'`.
3. `toad-app/package.json` line 164 lists `fileAssociations` for `"ext": "tad"`, but **omits** `"ext": "toad"`.

Until the test suite hooks and package legacy mappings are corrected, the project does not satisfy Acceptance Criterion R5.4 ("All 222+ test suite cases pass cleanly (`node run_tests.js --all` or `node tests/deep_integration_qa.js`)").

---

## 2. Scope 1: PowerShell Build & Release Scripts & Version Bumping

### 2.1 PowerShell Script Syntax Validation
Empirical test executed:
```powershell
[scriptblock]::Create((Get-Content 'fastbuild.ps1' -Raw))
[scriptblock]::Create((Get-Content 'dist_package.ps1' -Raw))
[scriptblock]::Create((Get-Content 'package_release.ps1' -Raw))
[scriptblock]::Create((Get-Content '.agents/skills/releases/scripts/package_release.ps1' -Raw))
```
- **Result**: All 4 scripts compiled into AST ScriptBlocks with **zero syntax errors**.

### 2.2 Dynamic Path Resolution to `toad-app`, `toadviewer`, and `toadapp.bundle.js`
- **`fastbuild.ps1`**:
  - Lines 45–48: Checks `$rootDir\tad-master\packages\toad-app` first, falls back to `tad-app`.
  - Lines 79–82: Checks `$rootDir\tad-master\packages\toadviewer` first, falls back to `tadviewer`.
  - Lines 115–118: Checks for `$appDir\dist\toadapp.bundle.js` first, falls back to `tadapp.bundle.js`.
- **`dist_package.ps1`**:
  - Lines 9–12: Dynamically prioritizes `toad-app` over `tad-app`.
  - Lines 34–37: Dynamically prioritizes `toadviewer` over `tadviewer`.
  - Lines 48–53: Dynamically checks for `toadapp.bundle.js` with fallback to `tadapp.bundle.js`.
  - Line 55: Version assertion whitelist includes `v2.4.8`, `v2.4.7`, `v2.4.6.1`, ..., `v2.1.0`.
- **`package_release.ps1`**:
  - Synchronized default parameter `$Version = "2.4.8"`. Successfully invokes `.agents/skills/releases/scripts/package_release.ps1`.

### 2.3 `tools/bump_version.js` Execution & Target Resolution
Empirical execution:
- Executed without arguments: exits cleanly with code 1 and prints:
  `Usage: node tools/bump_version.js <new_version|patch>`.
- Inspected all 9 target files:
  1. `tad-master/packages/toad-app/package.json` — EXISTS, version `2.4.7`
  2. `tad-master/packages/host-bridge/package.json` — EXISTS, version `2.4.7`
  3. `tad-master/packages/reltab-duckdb/package.json` — EXISTS, version `2.4.7`
  4. `tad-master/packages/toadviewer/package.json` — EXISTS, version `2.4.7`
  5. `tad-master/packages/toadviewer/src/components/RegexDialog.tsx` — EXISTS, regex `/v\d+\.\d+\.\d+(?:\.\d+)?/` matches
  6. `dist_package.ps1` — EXISTS, regex `/Toad-\d+\.\d+\.\d+(?:\.\d+)?-x64-portable\.exe/` matches
  7. `package_release.ps1` — EXISTS, regex `/\[string\]\$Version = "[^"]+"/` matches
  8. `README.md` — EXISTS, regexes match version title and badge
  9. `releases/HelloKittyXamKinLung.Toad.yaml` — EXISTS, regex `/PackageVersion: [\d\.]+/` matches

---

## 3. Scope 2: Webpack Bundles and HTML Assets

### 3.1 Webpack Bundle `toadapp.bundle.js`
- **Location**: `tad-master/packages/toad-app/dist/toadapp.bundle.js`
- **Size**: 5,186,273 bytes (~4.95 MiB)
- **Syntax**: Evaluated via `new vm.Script(code)` in Node.js v18.20.4 — **VALID JAVASCRIPT**.
- **Content Verification**:
  - Contains recognized versions (`v2.4.7`, `v2.4.8`).
  - Contains `padStart(3` for `str001`.

### 3.2 HTML Asset Synchronization
- **`tad-master/packages/toad-app/html/index.html`**:
  - Line 11: `<script src="toadapp.bundle.js"></script>`
- **`tad-master/packages/toad-app/dist/index.html`**:
  - Line 11: `<script src="toadapp.bundle.js"></script>`
- **Result**: Guarantees that Electron's `appWindow.ts` loads the newly renamed bundle without white-screen crash.

### 3.3 Viewer Bundles `toadviewer.js` and `tadviewer.js`
- **`tad-master/packages/toadviewer/dist/toadviewer.js`**:
  - Size: 2,891,952 bytes. Valid JavaScript.
- **`tad-master/packages/toadviewer/dist/tadviewer.js`**:
  - Size: 2,891,951 bytes. Valid JavaScript.
- **Result**: Dual Webpack entry configuration in `toadviewer/webpack.config.js` successfully emits both bundles to preserve full backward compatibility.

---

## 4. Scope 3: Asar Packaging Footprint Rules

### 4.1 Exclusion Rules in `toad-app/package.json`
Inspected `tad-master/packages/toad-app/package.json` lines 120–151:
```json
      "!**/node_modules/toadviewer/**",
      "!**/node_modules/tadviewer/**",
```
Both `toadviewer` and `tadviewer` are explicitly excluded from `app.asar`.

### 4.2 Packed Asar Size Measurement
- Checked existing unpacked asar at `tad-master/packages/toad-app/release/win-unpacked/resources/app.asar`:
  - Measured size: **25.45 MB** (26,686,173 bytes).
  - Footprint Assertion Gate: `<= 45.0 MB`.
  - **Headroom**: 19.55 MB (43.4% under budget).

---

## 5. Scope 4: Jujutsu VCS Cleanliness & Zero-Duplicate Binary Policy

### 5.1 Jujutsu VCS Status
- Executed `tools/jj/jj.exe status`:
  - Working copy commit `@` (`klqlvyzy`).
  - Monorepo folder renames (`tad-master/packages/tad-app` -> `toad-app`, `tadviewer` -> `toadviewer`) are tracked cleanly as `R` (renames).

### 5.2 Zero-Duplicate Binary Storage Policy
- **Root Directory**:
  - Only `Toad.exe` (75,589,877 bytes) exists. Zero duplicate versioned binaries (no `Toad 2.0.x.exe`, no `Toad 2.4.x.exe`).
- **`releases/` Directory**:
  - Audited all files in `releases/`.
  - Exactly 9 canonical portable binaries exist:
    `Toad-2.3.5-x64-portable.exe` through `Toad-2.4.7-x64-portable.exe`.
  - **Zero duplicate alias binaries** found (no `Toad 2.0.x.exe`, no `toad_v2.x.x_portable.exe`).

---

## 6. Adversarial Stress Challenges & Failures Discovered

### ⚠️ Challenge Finding 1: Test Suite Regression in `tests/deep_integration_qa.js` (Test E.2)
- **Command Executed**:
  `& "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tests\deep_integration_qa.js`
- **Output**:
  `Total Test Cases : 222 | Passed : 221 | Failed : 1 (16.53s)`
- **Verbatim Error**:
  ```
  ✗ [FAIL] E.2 RAM First-Page Micro-Cache returns 1000 rows in < 2ms with 0 Disk I/O
    Error: Cannot find module 'D:\Shared_UserData\Downloads\tad\tad-master\packages\tadviewer\dist\MultipleLoadingManager'
  Require stack:
  - D:\Shared_UserData\Downloads\tad\tests\deep_integration_qa.js
  ```
- **Root Cause Analysis**:
  In `tests/deep_integration_qa.js`, `mapLegacyPath(targetPath)` (line 26) hooks `fs.existsSync` and `Module._resolveFilename`.
  However, line 33 performs:
  ```javascript
  if (origExistsSync(redirected)) return redirected;
  ```
  When test E.2 calls `require(path.resolve(ROOT_DIR, "tad-master/packages/tadviewer/dist/MultipleLoadingManager"))`, `targetPath` does **not** contain a `.js` extension.
  `origExistsSync` on `.../toadviewer/dist/MultipleLoadingManager` returns `false` because the file on disk is `MultipleLoadingManager.js`.
  As a consequence, `mapLegacyPath` fails to redirect the path and returns the original non-existent `tadviewer` path, causing `Module._resolveFilename` to throw.
- **Blast Radius**: Test E.2 fails deterministically on every run.

---

### ⚠️ Challenge Finding 2: `tests/legacy_use_cases.js` Fails on Execution
- **Command Executed**:
  `& "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tests\legacy_use_cases.js`
- **Output**:
  ```
  node:internal/modules/cjs/loader:1143
    throw err;
    ^
  Error: Cannot find module 'D:\Shared_UserData\Downloads\tad\tad-master\packages\tad-app\app_dist\portableAppData'
  Require stack:
  - D:\Shared_UserData\Downloads\tad\tests\legacy_use_cases.js
  ```
- **Root Cause Analysis**:
  Lines 96 and 101 of `tests/legacy_use_cases.js` hardcode:
  ```javascript
  require(path.resolve(ROOT_DIR, "tad-master/packages/tad-app/app_dist/portableAppData"));
  require(path.resolve(ROOT_DIR, "tad-master/packages/tadviewer/dist/MultipleLoadingManager"));
  ```
  Because `tad-master/packages/tad-app` and `tad-master/packages/tadviewer` were renamed on disk to `toad-app` and `toadviewer`, and no NTFS junction exists at `tad-master/packages/tad-*`, this entire test suite crashes immediately.

---

### ⚠️ Challenge Finding 3: Missing `.toad` File Association in `toad-app/package.json`
- **Location**: `tad-master/packages/toad-app/package.json` lines 152–213
- **Observation**:
  `fileAssociations` contains:
  ```json
  {
    "ext": "tad",
    "name": "Toad Saved Workspace",
    "role": "Editor"
  }
  ```
  However, `"ext": "toad"` is completely absent from `fileAssociations`.
- **Impact**: Operating system file association for the newly branded `.toad` extension is not registered by electron-builder upon installation.

---

## 7. Concrete Action Plan for Orchestrator & Workers

To resolve the failing gates and reach full approval:

1. **Fix `mapLegacyPath` in `tests/deep_integration_qa.js`**:
   Update `mapLegacyPath` to resolve extensions (`.js`, `.json`, etc.) or simply return `redirected` whenever a substitution occurs:
   ```javascript
   function mapLegacyPath(targetPath) {
     if (typeof targetPath !== "string") return targetPath;
     if (origExistsSync(targetPath)) return targetPath;
     let redirected = targetPath
       .replace(/tad-master[/\\]packages[/\\]tad-app\b/, "tad-master/packages/toad-app")
       .replace(/tad-master[/\\]packages[/\\]tadviewer\b/, "tad-master/packages/toadviewer")
       .replace(/tadapp\.bundle\.js\b/, "toadapp.bundle.js");
     if (origExistsSync(redirected) || origExistsSync(redirected + ".js") || origExistsSync(redirected + "/index.js")) {
       return redirected;
     }
     return targetPath;
   }
   ```
2. **Add Backward Compatibility Junctions or Update `tests/legacy_use_cases.js`**:
   - Create directory junctions in `tad-master/packages/`:
     `tad-master/packages/tad-app` -> `tad-master/packages/toad-app`
     `tad-master/packages/tadviewer` -> `tad-master/packages/toadviewer`
   - OR update `tests/legacy_use_cases.js` lines 96 and 101 to check `toad-app` / `toadviewer`.
3. **Add `.toad` to `fileAssociations` in `toad-app/package.json`**:
   ```json
   {
     "ext": "toad",
     "name": "Toad Saved Workspace",
     "role": "Editor"
   },
   ```
4. **Re-run Full Suite**:
   Execute `node run_tests.js --all` and verify all 242 tests pass cleanly with exit code 0.
