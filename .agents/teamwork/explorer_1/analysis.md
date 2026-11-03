# Comprehensive Investigation Report: Packages & Webpack Architecture (R1 & R2)
**Agent**: Explorer 1 (Packages & Webpack Explorer)  
**Date**: 2026-11-03  
**Status**: Investigation Complete  
**Integrity Mode**: Read-Only Analysis  

---

## Executive Summary

This report delivers the complete architectural investigation and precise migration blueprints for **Requirement 1 (Monorepo Package Renaming & Dependency Updates)** and **Requirement 2 (Webpack Bundle & Asset Synchronization)** to execute the full rebranding from **TAD** to **TOAD v2.4.8**.

All references across package manifests, TypeScript source code, Webpack configs, HTML entry files, Electron-builder configurations, build scripts, and test suites have been verified with exact line numbers and code snippets.

---

## 1. Monorepo Package Renaming Blueprint (R1)

### 1.1 Disk Directories to Rename
On disk under `tad-master/packages/`:
- `tad-master/packages/tad-app` ➔ `tad-master/packages/toad-app`
- `tad-master/packages/tadviewer` ➔ `tad-master/packages/toadviewer`

### 1.2 Package Manifests (`package.json`) & Lerna Manifest

#### A. `tad-master/lerna.json`
- **Location**: `tad-master/lerna.json`, Line 6
- **Current Content**:
  ```json
  {
    "packages": ["packages/*"],
    "version": "0.14.0",
    "command": {
      "run": {
        "ignore": ["reltab-sqlite", "tad-app"]
      }
    }
  }
  ```
- **Required Change**:
  ```diff
  - "ignore": ["reltab-sqlite", "tad-app"]
  + "ignore": ["reltab-sqlite", "toad-app"]
  ```

#### B. `tad-master/package.json` (Root of monorepo)
- **Location**: `tad-master/package.json`, Line 21
- **Current Content**:
  ```json
  "bootstrap-no-drivers-no-app": "lerna bootstrap --ignore reltab-* --ignore tad --ci --hoist --force-local --ignore-prepublish"
  ```
- **Note**: Ensure scripts referencing `--ignore tad` or `tad-app` are aligned if needed.

#### C. `packages/toad-app/package.json` (formerly `tad-app/package.json`)
- **Key Fields to Update**:
  - **Line 2 (`name`)**:
    ```diff
    - "name": "toad",
    + "name": "toad-app",
    ```
    *(Note: `"productName": "Toad"` on Line 244 continues to govern the desktop application binary name `Toad.exe`)*
  - **Line 3 (`version`)**:
    ```diff
    - "version": "2.4.7",
    + "version": "2.4.8",
    ```
  - **Line 14 (`scripts.build:toadviewer-assets`)**:
    ```diff
    - "build:tadviewer-assets": "recursive-copy -w node_modules/tadviewer/dist/public dist/public",
    + "build:toadviewer-assets": "recursive-copy -w node_modules/toadviewer/dist/public dist/public",
    ```
  - **Line 56 (`dependencies.toadviewer`)**:
    ```diff
    - "tadviewer": "^0.12.0"
    + "toadviewer": "^0.12.0"
    ```
  - **Line 140 (`build.files` - Asar Exclusion)**:
    ```diff
    - "!**/node_modules/tadviewer/**",
    + "!**/node_modules/toadviewer/**",
    + "!**/node_modules/tadviewer/**",
    ```
  - **Line 163-166 (`fileAssociations`)**:
    Add `.toad` format association as primary, keeping `.tad` as secondary:
    ```json
    {
      "ext": "toad",
      "name": "Toad Saved Workspace",
      "role": "Editor"
    },
    {
      "ext": "tad",
      "name": "Toad Legacy Saved Workspace",
      "role": "Editor"
    },
    ```

#### D. `packages/toadviewer/package.json` (formerly `tadviewer/package.json`)
- **Key Fields to Update**:
  - **Line 2 (`name`)**:
    ```diff
    - "name": "tadviewer",
    + "name": "toadviewer",
    ```
  - **Line 3 (`version`)**:
    ```diff
    - "version": "2.4.7",
    + "version": "2.4.8",
    ```
  - **Line 5 (`main`)**:
    ```diff
    - "main": "dist/tadviewer.js",
    + "main": "dist/toadviewer.js",
    ```
  - **Line 6 (`types`)**:
    ```diff
    - "types": "dist/tadviewer.d.ts",
    + "types": "dist/toadviewer.d.ts",
    ```

#### E. `packages/tadweb-app/package.json`
- **Location**: `tad-master/packages/tadweb-app/package.json`, Line 34
  ```diff
  - "tadviewer": "^0.12.0"
  + "toadviewer": "^0.12.0"
  ```

---

## 2. Webpack Bundle & Asset Synchronization Blueprint (R2)

### 2.1 `packages/toad-app/webpack.config.js`
- **File Path**: `tad-master/packages/toad-app/webpack.config.js`
- **Lines 20-23**:
  ```javascript
  output: {
    path: __dirname + "/dist/",
    filename: "[name].bundle.js",
  },
  ```
- **Lines 114-119**:
  ```javascript
  var render = {
    target: "electron-renderer",
    entry: {
      tadapp: "./src/electronRenderMain.tsx",
    },
  };
  ```
- **Required Change**:
  ```diff
  var render = {
    target: "electron-renderer",
    entry: {
  -   tadapp: "./src/electronRenderMain.tsx",
  +   toadapp: "./src/electronRenderMain.tsx",
    },
  };
  ```
- **Recommended Alias Enhancement (Lines 16-19)**:
  To provide 100% resilient resolution whether linked via node_modules junction or direct path:
  ```diff
    resolve: {
      extensions: [".webpack.js", ".web.js", ".js", ".ts", ".tsx"],
      alias: {
        "host-bridge": path.resolve(__dirname, "../host-bridge/dist/index.js"),
  +     "toadviewer": path.resolve(__dirname, "../toadviewer/dist/toadviewer.js"),
  +     "tadviewer": path.resolve(__dirname, "../toadviewer/dist/toadviewer.js"),
      },
    },
  ```

### 2.2 `packages/toadviewer/webpack.config.js`
- **File Path**: `tad-master/packages/toadviewer/webpack.config.js`
- **Lines 13-15**:
  ```javascript
  entry: {
    tadviewer: "./src/tadviewer.ts",
  },
  ```
- **Required Change (Dual Entry for Zero Regressions)**:
  Webpack outputs `[name].js`. By defining both `toadviewer` and `tadviewer` entries pointing to `./src/toadviewer.ts` (or keeping `src/tadviewer.ts` re-exporting `src/toadviewer.ts`), Webpack will output **BOTH** `dist/toadviewer.js` and `dist/tadviewer.js`:
  ```javascript
  entry: {
    toadviewer: "./src/toadviewer.ts",
    tadviewer: "./src/toadviewer.ts",
  },
  ```
  *Benefit*: Guarantees that any legacy integration test or script checking `dist/tadviewer.js` passes without error, while all new code imports `toadviewer.js`.

### 2.3 `packages/toad-app/html/index.html` (White Screen Prevention)
- **File Path**: `tad-master/packages/toad-app/html/index.html`
- **Line 11**:
  ```html
  <!DOCTYPE html>
  <html>
    <head>
      <title>Toad</title>
      <meta charset="UTF-8" />
      <link rel="icon" type="image/png" href="icon.png" />
    </head>
    <body>
      <div id="app" class="full-height"></div>
    </body>
    <script src="tadapp.bundle.js"></script>
  </html>
  ```
- **Required Change**:
  ```diff
  - <script src="tadapp.bundle.js"></script>
  + <script src="toadapp.bundle.js"></script>
  ```
- **Root Cause & Impact**: Electron's `appWindow.ts` loads `index.html` (`win.loadURL(targetUrl)`). If `index.html` requests `tadapp.bundle.js` but Webpack produced `toadapp.bundle.js`, the script fails with 404/ERR_FILE_NOT_FOUND, leaving `<div id="app"></div>` empty, causing an immediate blank white screen on startup.

---

## 3. TypeScript Source Code Imports Audit

### 3.1 `packages/toad-app/src/electronRenderMain.tsx`
- **Lines 30-41**:
  ```diff
  import {
    AppPane,
    AppPaneBaseProps,
    ExportFormat,
    ParquetExportOptions,
    MultipleLoadingManager,
    ProjectWorkspaceManager,
  -} from "tadviewer";
  -import { PivotRequester } from "tadviewer";
  -import { AppState } from "tadviewer";
  -import { ViewParams, actions } from "tadviewer";
  -import { initAppState } from "tadviewer";
  +} from "toadviewer";
  +import { PivotRequester } from "toadviewer";
  +import { AppState } from "toadviewer";
  +import { ViewParams, actions } from "toadviewer";
  +import { initAppState } from "toadviewer";
  ```

### 3.2 `packages/toad-app/app/fileExport.ts`
- **Line 6**:
  ```diff
  -import { ExportFormat, ParquetExportOptions } from "tadviewer";
  +import { ExportFormat, ParquetExportOptions } from "toadviewer";
  ```

### 3.3 `packages/toadviewer/src/`
- Rename `src/tadviewer.ts` ➔ `src/toadviewer.ts`
- Create a backward-compatible shim `src/tadviewer.ts`:
  ```typescript
  export * from "./toadviewer";
  ```
- **Lines in `components/DataSourceSidebar.tsx` (Line 32)**:
  ```diff
  -import { actions } from "../tadviewer";
  +import { actions } from "../toadviewer";
  ```
- **Lines in `components/TadViewerPane.tsx` (Line 23)**:
  ```diff
  -import { actions } from "../tadviewer";
  +import { actions } from "../toadviewer";
  ```

### 3.4 `packages/tadweb-app/src/webRenderMain.tsx`
- **Lines 22-24**:
  ```diff
  -} from "tadviewer";
  -import { ViewParams } from "tadviewer";
  -import { initAppState } from "tadviewer";
  +} from "toadviewer";
  +import { ViewParams } from "toadviewer";
  +import { initAppState } from "toadviewer";
  ```

---

## 4. NTFS Junctions & Node Modules Dependencies Nuance

Direct inspection of `packages/tad-app/node_modules/` revealed:
```
Name            LinkType Target                                                                 
----            -------- ------                                                                 
aggtree         Junction {D:\Shared_UserData\Downloads\tad\tad-master\packages\aggtree\}        
reltab          Junction {D:\Shared_UserData\Downloads\tad\tad-master\packages\reltab\}         
reltab-bigquery Junction {D:\Shared_UserData\Downloads\tad\tad-master\packages\reltab-bigquery\}
reltab-duckdb   Junction {D:\Shared_UserData\Downloads\tad\tad-master\packages\reltab-duckdb\}  
reltab-fs       Junction {D:\Shared_UserData\Downloads\tad\tad-master\packages\reltab-fs\}      
tadviewer       Junction {D:\Shared_UserData\Downloads\tad\tad-master\packages\tadviewer\}      
```

### Critical Operational Insight:
1. When `packages/tad-app` is renamed to `packages/toad-app`, and `packages/tadviewer` to `packages/toadviewer`, the junction `tadviewer` inside `node_modules` points to the stale old path.
2. During the rename step, PowerShell / Node script must:
   - Remove stale junction `toad-app/node_modules/tadviewer` (or redirect it)
   - Create NTFS junction:
     `toad-app/node_modules/toadviewer` ➔ `tad-master/packages/toadviewer`
   - Keep a secondary junction:
     `toad-app/node_modules/tadviewer` ➔ `tad-master/packages/toadviewer`
   - Similarly update `tadweb-app/node_modules/tadviewer` if present.
3. In `toad-app/tsconfig.json`, add path mapping:
   ```json
   "paths": {
     "host-bridge": ["../host-bridge"],
     "toadviewer": ["../toadviewer"],
     "tadviewer": ["../toadviewer"]
   }
   ```
   This ensures `tsc` compilation resolves the package flawlessly even before or independent of node_modules junctions.

---

## 5. Build Scripts & Automation Synchronization

### 5.1 `fastbuild.ps1`
- **Line 45**:
  ```diff
  -$appDir = "$rootDir\tad-master\packages\tad-app"
  +$appDir = "$rootDir\tad-master\packages\toad-app"
  ```
- **Lines 75-76**:
  ```diff
  -Write-Output ">>> [STEP 1.3] Building tadviewer..."
  -Set-Location "$rootDir\tad-master\packages\tadviewer"
  +Write-Output ">>> [STEP 1.3] Building toadviewer..."
  +Set-Location "$rootDir\tad-master\packages\toadviewer"
  ```
- **Line 83**:
  ```diff
  -$stageTimes["TypeScript & Tadviewer"] = [math]::Round($sw.Elapsed.TotalSeconds, 1)
  +$stageTimes["TypeScript & Toadviewer"] = [math]::Round($sw.Elapsed.TotalSeconds, 1)
  ```
- **Lines 89-91, 99**:
  ```diff
  -# --- STEP 2: Build tad-app Webpack Bundles ---
  -Write-Output "`n>>> [STEP 2] Building Webpack bundles for tad-app..."
  +$stageTimes["Webpack toad-app"] = [math]::Round($sw.Elapsed.TotalSeconds, 1)
  ```
- **Lines 105-107**:
  ```diff
  -if (-not (Test-Path "$appDir\dist\tadapp.bundle.js")) {
  -    throw "ERROR: dist\tadapp.bundle.js was not generated!"
  -}
  +if (-not (Test-Path "$appDir\dist\toadapp.bundle.js")) {
  +    throw "ERROR: dist\toadapp.bundle.js was not generated!"
  +}
  ```

### 5.2 `dist_package.ps1`
- **Line 9**:
  ```diff
  -$appDir = "$rootDir\tad-master\packages\tad-app"
  +$appDir = "$rootDir\tad-master\packages\toad-app"
  ```
- **Line 31**:
  ```diff
  -Set-Location "D:\Shared_UserData\Downloads\tad\tad-master\packages\tadviewer"
  +Set-Location "D:\Shared_UserData\Downloads\tad\tad-master\packages\toadviewer"
  ```
- **Lines 38-42**:
  ```diff
  -Write-Output "=== STEP 3: Verifying integrity of tadapp.bundle.js ==="
  -$bundlePath = "$appDir\dist\tadapp.bundle.js"
  -if (-not (Test-Path $bundlePath)) {
  -    throw "ERROR: Cannot find tadapp.bundle.js!"
  -}
  +Write-Output "=== STEP 3: Verifying integrity of toadapp.bundle.js ==="
  +$bundlePath = "$appDir\dist\toadapp.bundle.js"
  +if (-not (Test-Path $bundlePath)) {
  +    throw "ERROR: Cannot find toadapp.bundle.js!"
  +}
  ```
- **Lines 44-52**:
  Add `"v2.4.8"` to version verification string:
  ```powershell
  if (-not ($bundleContent.Contains("v2.4.8") -or $bundleContent.Contains("v2.4.7") -or ...))
  ```
  And update map assertion:
  ```powershell
  if (Test-Path "$appDir\dist\toadapp.bundle.js.map") {
      throw "ASSERTION ERROR: toadapp.bundle.js.map exists in production dist! Expected devtool=false."
  }
  ```

### 5.3 `build_all.ps1`
- **Lines 24-29**:
  ```diff
  -Write-Output "--- Building tadviewer ---"
  -Set-Location "D:\Shared_UserData\Downloads\tad\tad-master\packages\tadviewer"
  -& npm.cmd run build-prod
  -
  -Write-Output "--- Building tad-app ---"
  -Set-Location "D:\Shared_UserData\Downloads\tad\tad-master\packages\tad-app"
  -& npm.cmd run build-prod
  +Write-Output "--- Building toadviewer ---"
  +Set-Location "D:\Shared_UserData\Downloads\tad\tad-master\packages\toadviewer"
  +& npm.cmd run build-prod
  +
  +Write-Output "--- Building toad-app ---"
  +Set-Location "D:\Shared_UserData\Downloads\tad\tad-master\packages\toad-app"
  +& npm.cmd run build-prod
  ```

### 5.4 `tad-master/tools/buildAll.js`
- **Lines 18-19**:
  ```diff
  -const componentPackages = ["tadviewer"];
  -const appPackages = ["tadweb-app", "tadweb-server", "tad-app"];
  +const componentPackages = ["toadviewer"];
  +const appPackages = ["tadweb-app", "tadweb-server", "toad-app"];
  ```

### 5.5 `tools/bump_version.js`
- **Lines 33, 77, 82, 87**:
  Update to support `toad-app` and `toadviewer` paths dynamically (checking existence of `toad-app` before falling back to `tad-app`).

---

## 6. Test Suites Impact Analysis

Running the test suite runner (`node run_tests.js --qa`) confirmed:
- **Total Tests**: 222
- **Passed**: 194
- **Failed**: 28
- **Root Cause of ALL 28 Failures**:
  All 28 failures were strict version synchronization assertions checking `pkgApp.version === "2.4.6"` (actual in package.json is `2.4.7` and advancing to `2.4.8`).
- **Path Dependencies in `tests/deep_integration_qa.js`**:
  - Line 2190: `path.resolve(ROOT_DIR, "tad-master/packages/tad-app/dist/tadapp.bundle.js")`
    ➔ Must be updated to `toad-app/dist/toadapp.bundle.js`
  - Multiple occurrences of `tad-master/packages/tad-app/package.json`
    ➔ Must be updated to `toad-app/package.json` (and `assert(...)` updated to accept `"2.4.8"`)
  - Occurrences of `tad-master/packages/tadviewer/`
    ➔ Must be updated to `toadviewer/`

---

## 7. Implementation Checklist for Executor

| Step | Action | Files Affected |
| :--- | :--- | :--- |
| **1** | Rename directories on disk | `tad-master/packages/tad-app` ➔ `toad-app`<br>`tad-master/packages/tadviewer` ➔ `toadviewer` |
| **2** | Create/Update NTFS Junctions | `toad-app/node_modules/toadviewer` ➔ `toadviewer`<br>`toad-app/node_modules/tadviewer` ➔ `toadviewer` |
| **3** | Update manifests | `lerna.json`, `toad-app/package.json`, `toadviewer/package.json`, `tadweb-app/package.json` |
| **4** | Update Webpack & HTML | `toad-app/webpack.config.js` (`toadapp`), `toad-app/html/index.html` (`toadapp.bundle.js`) |
| **5** | Dual-export in `toadviewer` Webpack | `toadviewer/webpack.config.js` (`toadviewer` + `tadviewer`), `src/toadviewer.ts` + `src/tadviewer.ts` |
| **6** | Update TypeScript imports | `electronRenderMain.tsx`, `fileExport.ts`, `webRenderMain.tsx` |
| **7** | Update Build scripts | `fastbuild.ps1`, `dist_package.ps1`, `build_all.ps1`, `tools/buildAll.js`, `tools/bump_version.js` |
| **8** | Synchronize test paths & version gates | `tests/deep_integration_qa.js`, `tests/smoke_test.js`, `tests/legacy_use_cases.js` |
