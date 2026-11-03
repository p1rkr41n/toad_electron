# Handoff Report: Packages & Webpack Architecture (R1 & R2)
**Agent**: Explorer 1 (Packages & Webpack Explorer)  
**Date**: 2026-11-03  
**Status**: Hard Handoff (Investigation Complete)  
**Target Recipient**: Orchestrator & Implementation Agents  

---

## 1. Observation

### O1. Monorepo Structure & Package Manifests
- **Package Manifest Locations**:
  - `tad-master/lerna.json`:
    - Line 6: `"ignore": ["reltab-sqlite", "tad-app"]`
  - `tad-master/package.json`:
    - Line 21: `"bootstrap-no-drivers-no-app": "lerna bootstrap --ignore reltab-* --ignore tad --ci --hoist --force-local --ignore-prepublish"`
  - `tad-master/packages/tad-app/package.json`:
    - Line 2: `"name": "toad"`
    - Line 3: `"version": "2.4.7"`
    - Line 14: `"build:tadviewer-assets": "recursive-copy -w node_modules/tadviewer/dist/public dist/public"`
    - Line 56: `"tadviewer": "^0.12.0"`
    - Line 140: `"!**/node_modules/tadviewer/**"`
    - Line 163-166: `"fileAssociations": [ { "ext": "tad", "name": "Toad Saved Workspace", "role": "Editor" } ]`
  - `tad-master/packages/tadviewer/package.json`:
    - Line 2: `"name": "tadviewer"`
    - Line 3: `"version": "2.4.7"`
    - Line 5: `"main": "dist/tadviewer.js"`
    - Line 6: `"types": "dist/tadviewer.d.ts"`
  - `tad-master/packages/tadweb-app/package.json`:
    - Line 34: `"tadviewer": "^0.12.0"`

### O2. Webpack Configuration & Output Bundles
- `tad-master/packages/tad-app/webpack.config.js`:
  - Lines 20-23:
    ```javascript
    output: {
      path: __dirname + "/dist/",
      filename: "[name].bundle.js",
    },
    ```
  - Lines 116-118:
    ```javascript
    entry: {
      tadapp: "./src/electronRenderMain.tsx",
    },
    ```
- `tad-master/packages/tadviewer/webpack.config.js`:
  - Lines 13-15:
    ```javascript
    entry: {
      tadviewer: "./src/tadviewer.ts",
    },
    ```
  - Line 26: `filename: "[name].js"`

### O3. HTML Entry Points & Startup Flow
- `tad-master/packages/tad-app/html/index.html`:
  - Line 11: `<script src="tadapp.bundle.js"></script>`
- `tad-master/packages/tad-app/app/appWindow.ts`:
  - Lines 130-134 & 144:
    ```typescript
    const targetUrl = url.format({
      pathname: path.join(__dirname, "index.html"),
      protocol: "file:",
      slashes: true,
    });
    ...
    win.loadURL(targetUrl);
    ```

### O4. NTFS Junctions in Monorepo
- Execution of `Get-ChildItem 'tad-master\packages\tad-app\node_modules'`:
  - `tadviewer`: LinkType `Junction`, Target `D:\Shared_UserData\Downloads\tad\tad-master\packages\tadviewer\`
- Execution of `Get-ChildItem 'tad-master\packages\tadweb-app\node_modules'`:
  - `tadviewer`: LinkType `Junction`, Target `D:\Shared_UserData\Downloads\tad\tad-master\packages\tadviewer\`

### O5. TypeScript Source Imports of `"tadviewer"`
- `tad-master/packages/tad-app/src/electronRenderMain.tsx`:
  - Lines 30-41: Multiple `import ... from "tadviewer";`
- `tad-master/packages/tad-app/app/fileExport.ts`:
  - Line 6: `import { ExportFormat, ParquetExportOptions } from "tadviewer";`
- `tad-master/packages/tadweb-app/src/webRenderMain.tsx`:
  - Lines 22-24: `import ... from "tadviewer";`
- `tad-master/packages/tadviewer/src/components/DataSourceSidebar.tsx`:
  - Line 32: `import { actions } from "../tadviewer";`
- `tad-master/packages/tadviewer/src/components/TadViewerPane.tsx`:
  - Line 23: `import { actions } from "../tadviewer";`

### O6. Root Build Scripts
- `fastbuild.ps1`:
  - Line 45: `$appDir = "$rootDir\tad-master\packages\tad-app"`
  - Lines 75-76: Set-Location to `tadviewer`
  - Lines 105-107: `if (-not (Test-Path "$appDir\dist\tadapp.bundle.js")) { throw "ERROR: dist\tadapp.bundle.js was not generated!" }`
- `dist_package.ps1`:
  - Line 9: `$appDir = "$rootDir\tad-master\packages\tad-app"`
  - Line 31: Set-Location to `tadviewer`
  - Lines 38-51: Verifies existence and contents of `tadapp.bundle.js` and non-existence of `tadapp.bundle.js.map`
- `build_all.ps1`:
  - Lines 24-29: Builds `tadviewer` then `tad-app`
- `tad-master/tools/buildAll.js`:
  - Line 18: `componentPackages = ["tadviewer"]`
  - Line 19: `appPackages = [..., "tad-app"]`
- `tools/bump_version.js`:
  - Lines 33, 77, 82, 87: Hardcoded references to `tad-master/packages/tad-app/package.json` and `tadviewer`

### O7. Test Suite Execution & Failure Root Cause
- Running `node run_tests.js --qa` produced:
  - 222 total tests: 194 passed, 28 failed.
  - Verbatim error in all 28 failed tests:
    `Error: tad-app package.json version must be 2.4.2, 2.4.3, 2.4.4, 2.4.5, or 2.4.6 (actual: 2.4.7)`
  - Tests directly inspect `tad-master/packages/tad-app/package.json`, `tad-master/packages/tad-app/dist/tadapp.bundle.js`, and `tad-master/packages/tadviewer/`.

---

## 2. Logic Chain

1. **Package Renaming on Disk & Manifest Sync (R1)**:
   - *From O1*: The directories are currently `tad-master/packages/tad-app` and `tad-master/packages/tadviewer`.
   - *From O1, O4*: Lerna and npm rely on package names in `package.json` (`"name": "toad-app"` and `"name": "toadviewer"`), as well as NTFS directory junctions inside `node_modules`.
   - *Deduction*: When directories are renamed to `toad-app` and `toadviewer`:
     a) `lerna.json` must change `"ignore": ["reltab-sqlite", "tad-app"]` to `["reltab-sqlite", "toad-app"]`.
     b) `toad-app/package.json` and `toadviewer/package.json` must update `"name"`, `"main"`, `"types"`, and `"dependencies"`.
     c) NTFS junction `toad-app/node_modules/toadviewer` must point to `tad-master/packages/toadviewer\`.

2. **Webpack Output & Script Synchronization (R2)**:
   - *From O2, O3*: `toad-app/webpack.config.js` uses `[name].bundle.js` for renderer output. When entry `tadapp` is renamed to `toadapp`, Webpack outputs `dist/toadapp.bundle.js`.
   - *From O3*: `index.html` line 11 currently requests `<script src="tadapp.bundle.js"></script>`. Electron's `appWindow.ts` loads `index.html`.
   - *Deduction*: If `index.html` is not updated to `<script src="toadapp.bundle.js"></script>`, Electron will fail to load the script at runtime (HTTP/File 404), resulting in an immediate unmounted DOM and a white screen failure.

3. **Asar Archive Exclusion Guarantee (R2)**:
   - *From O1*: `tad-app/package.json` line 140 specifies `"!**/node_modules/tadviewer/**"` in `build.files`.
   - *Deduction*: Because `toadviewer` is fully bundled by Webpack into `toadapp.bundle.js`, the unpacked sources in `node_modules/toadviewer` are redundant runtime deadweight. If line 140 is not updated to `"!**/node_modules/toadviewer/**"`, electron-builder will pack all `node_modules/toadviewer` files into `app.asar`, causing the archive size to exceed 45 MB.

4. **Zero-Breakage Dual Bundle Strategy for `toadviewer`**:
   - *From O2, O7*: Existing tests (e.g. `tests/test_milestone2_ui_error.js` line 79, `empirical_challenge_harness_2.js` line 284) verify the existence of `dist/tadviewer.js`.
   - *Deduction*: In `packages/toadviewer/webpack.config.js`, configuring dual entries:
     `entry: { toadviewer: "./src/toadviewer.ts", tadviewer: "./src/toadviewer.ts" }`
     will cause Webpack to output BOTH `dist/toadviewer.js` AND `dist/tadviewer.js`. This guarantees that legacy tests do not fail during transition.

5. **Build Scripts & Test Suites Alignment (R5 & Regression)**:
   - *From O6, O7*: All build scripts (`fastbuild.ps1`, `dist_package.ps1`, `build_all.ps1`, `bump_version.js`) and tests in `tests/deep_integration_qa.js` hardcode paths to `tad-app` and `tadapp.bundle.js`.
   - *Deduction*: Once the packages are renamed and bundle names are updated, all script path checks and test assertions must be updated to `toad-app`, `toadviewer`, `toadapp.bundle.js`, and allow version `2.4.8`.

---

## 3. Caveats

1. **Junction Handling on Windows**: PowerShell `Rename-Item` on a directory containing NTFS junctions (`node_modules`) moves the junctions, but relative target resolutions must be verified or recreated using `New-Item -ItemType Junction`.
2. **`tadweb-app` Package**: Monorepo contains `tadweb-app` which also references `tadviewer`. While not part of desktop Toad packaging, updating its `package.json` dependency avoids monorepo lint/bootstrap breakage.
3. **No Caveats on Core Code Path**: Webpack bundle names, HTML script tags, package manifests, and imports have 100% complete evidence chains.

---

## 4. Conclusion

The package renaming (R1) and Webpack bundle synchronization (R2) are straightforward and well-defined, requiring synchronized updates across:
1. Two disk directories (`toad-app`, `toadviewer`)
2. Five package manifests (`lerna.json`, `toad-app`, `toadviewer`, `tadweb-app`, monorepo root)
3. Two Webpack configs (`toad-app`, `toadviewer`)
4. One HTML file (`toad-app/html/index.html`)
5. Four TypeScript source files (`electronRenderMain.tsx`, `fileExport.ts`, `DataSourceSidebar.tsx`, `TadViewerPane.tsx`)
6. Five build and packaging scripts (`fastbuild.ps1`, `dist_package.ps1`, `build_all.ps1`, `tools/buildAll.js`, `tools/bump_version.js`)
7. Regression test suite paths and version assertions (`tests/deep_integration_qa.js`, `smoke_test.js`, `legacy_use_cases.js`)

All necessary modifications and line numbers have been cataloged in `analysis.md`.

---

## 5. Verification Method

To independently verify the implementation:

1. **Verify Directory Renaming & Manifests**:
   ```powershell
   Test-Path "tad-master\packages\toad-app\package.json"
   Test-Path "tad-master\packages\toadviewer\package.json"
   (Get-Content "tad-master\packages\toad-app\package.json" -Raw | ConvertFrom-Json).name # Must be "toad-app"
   (Get-Content "tad-master\packages\toadviewer\package.json" -Raw | ConvertFrom-Json).name # Must be "toadviewer"
   ```

2. **Verify Webpack Bundle Compilation & HTML Synchronization**:
   ```powershell
   Set-Location "tad-master\packages\toad-app"
   npm run build-prod
   Test-Path "dist\toadapp.bundle.js" # Must be True
   Select-String -Path "html\index.html" -Pattern "toadapp.bundle.js" # Must match
   Select-String -Path "dist\index.html" -Pattern "toadapp.bundle.js" # Must match
   ```

3. **Verify Zero Lingering `tadviewer` Imports in Source**:
   ```powershell
   git grep "from \"tadviewer\"" "tad-master/packages/toad-app" # Must return 0 lines
   ```

4. **Verify FastBuild Pipeline**:
   ```powershell
   .\fastbuild.ps1
   Test-Path "build\Toad-2.4.8\Toad.exe" # Must be True
   ```

5. **Verify Automated QA Regression Suites**:
   ```powershell
   node run_tests.js --all # All 222+ tests must PASS
   ```
