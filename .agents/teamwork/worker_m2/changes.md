# Changes Report: Milestone 2 (Package Renaming & Webpack Asset Sync)

**Worker:** Worker M2 (Package Renaming & Webpack Asset Sync Worker)  
**Date:** 2026-11-03  
**Status:** Verification Passed (100% Complete)  

---

## 1. Executive Summary

Milestone 2 has successfully achieved the complete package renaming and Webpack asset synchronization across the monorepo:
1. **Monorepo Package Directories on Disk Renamed**:
   - `tad-master/packages/tad-app` ➔ `tad-master/packages/toad-app`
   - `tad-master/packages/tadviewer` ➔ `tad-master/packages/toadviewer`
2. **Package Manifests & Lerna Synchronized**:
   - `toad-app/package.json`: `"name": "toad-app"`, `"toadviewer": "^0.12.0"`, `"build:toadviewer-assets"`, and dual Asar exclusions (`"!**/node_modules/toadviewer/**"` and `"!**/node_modules/tadviewer/**"`).
   - `toadviewer/package.json`: `"name": "toadviewer"`, `"main": "dist/toadviewer.js"`, `"types": "dist/toadviewer.d.ts"`.
   - `tad-master/lerna.json`: `"ignore": ["reltab-sqlite", "toad-app"]`.
   - `tad-master/tools/buildAll.js`: component package `"toadviewer"`, app package `"toad-app"`.
   - `tadweb-app/package.json`: dependency `"toadviewer": "^0.12.0"`.
3. **TypeScript Source Code Imports Updated**:
   - `toad-app/src/electronRenderMain.tsx`: all imports updated from `"tadviewer"` to `"toadviewer"`.
   - `toad-app/app/fileExport.ts`: imports updated to `"toadviewer"`.
   - `toadviewer/src/components/DataSourceSidebar.tsx`: imports updated to `"../toadviewer"`.
   - `toadviewer/src/components/TadViewerPane.tsx`: imports updated to `"../toadviewer"`, exported `ToadViewerPane` and `ToadViewerPaneProps`.
   - `tadweb-app/src/webRenderMain.tsx`: imports updated to `"toadviewer"`.
   - Zero lingering `"tadviewer"` imports in source files across `toad-app`.
4. **Webpack Configurations & HTML Asset Synchronization**:
   - `toad-app/webpack.config.js`:
     - Render entry changed from `tadapp` to `toadapp: "./src/electronRenderMain.tsx"`.
     - Output bundle configured as `[name].bundle.js` ➔ `dist/toadapp.bundle.js`.
     - Added resilient resolve aliases for `"toadviewer"` and `"tadviewer"` pointing to `../toadviewer/dist/toadviewer.js`.
   - `toad-app/html/index.html` (and copied `dist/index.html`): updated Line 11 to `<script src="toadapp.bundle.js"></script>`, eliminating the blank white screen startup hazard.
   - `toadviewer/webpack.config.js`: dual entry configured for zero-regression support:
     ```javascript
     entry: {
       toadviewer: "./src/toadviewer.ts",
       tadviewer: "./src/toadviewer.ts",
     }
     ```
     Both `dist/toadviewer.js` (2.89 MB) and `dist/tadviewer.js` (2.89 MB) are emitted.
5. **NTFS Junctions Configured**:
   - `toad-app/node_modules/toadviewer` ➔ `tad-master/packages/toadviewer`
   - `toad-app/node_modules/tadviewer` ➔ `tad-master/packages/toadviewer`
   - `tadweb-app/node_modules/toadviewer` ➔ `tad-master/packages/toadviewer`
   - `tadweb-app/node_modules/tadviewer` ➔ `tad-master/packages/toadviewer`

---

## 2. File-by-File Changes

### A. Monorepo Level
1. **`tad-master/lerna.json`**:
   - Updated Line 6: `"ignore": ["reltab-sqlite", "toad-app"]`.
2. **`tad-master/tools/buildAll.js`**:
   - Updated Lines 18-19:
     - `const componentPackages = ["toadviewer"];`
     - `const appPackages = ["tadweb-app", "tadweb-server", "toad-app"];`

### B. Package `toadviewer` (formerly `tadviewer`)
1. **`tad-master/packages/toadviewer/package.json`**:
   - `"name": "toadviewer"`
   - `"main": "dist/toadviewer.js"`
   - `"types": "dist/toadviewer.d.ts"`
2. **`tad-master/packages/toadviewer/webpack.config.js`**:
   - Configured dual entry points:
     ```javascript
     entry: {
       toadviewer: "./src/toadviewer.ts",
       tadviewer: "./src/toadviewer.ts",
     },
     ```
3. **`tad-master/packages/toadviewer/src/toadviewer.ts`**:
   - Created authoritative entry point containing all OLAP UI exports and styling requires.
4. **`tad-master/packages/toadviewer/src/tadviewer.ts`**:
   - Converted into clean re-export shim:
     ```typescript
     export * from "./toadviewer";
     import { actions } from "./toadviewer";
     export { actions };
     ```
5. **`tad-master/packages/toadviewer/src/components/DataSourceSidebar.tsx`**:
   - Updated line 32: `import { actions } from "../toadviewer";`
6. **`tad-master/packages/toadviewer/src/components/TadViewerPane.tsx`**:
   - Updated line 23: `import { actions } from "../toadviewer";`
   - Added forward-compatible exports: `ToadViewerPane` and `ToadViewerPaneProps`.

### C. Package `toad-app` (formerly `tad-app`)
1. **`tad-master/packages/toad-app/package.json`**:
   - `"name": "toad-app"`
   - `"build:toadviewer-assets": "recursive-copy -w node_modules/toadviewer/dist/public dist/public"`
   - Dependencies: `"toadviewer": "^0.12.0"`
   - Asar exclusion:
     ```json
     "!**/node_modules/toadviewer/**",
     "!**/node_modules/tadviewer/**",
     ```
2. **`tad-master/packages/toad-app/webpack.config.js`**:
   - Resolve aliases:
     ```javascript
     alias: {
       "host-bridge": path.resolve(__dirname, "../host-bridge/dist/index.js"),
       "toadviewer": path.resolve(__dirname, "../toadviewer/dist/toadviewer.js"),
       "tadviewer": path.resolve(__dirname, "../toadviewer/dist/toadviewer.js"),
     },
     ```
   - Render entry:
     ```javascript
     var render = {
       target: "electron-renderer",
       entry: {
         toadapp: "./src/electronRenderMain.tsx",
       },
     };
     ```
3. **`tad-master/packages/toad-app/html/index.html`**:
   - Line 11: `<script src="toadapp.bundle.js"></script>`
4. **`tad-master/packages/toad-app/tsconfig.json`**:
   - Added path mappings for `"toadviewer"` and `"tadviewer"` pointing to `"../toadviewer"`.
5. **`tad-master/packages/toad-app/src/electronRenderMain.tsx`**:
   - Lines 30-41: all imports updated from `"tadviewer"` to `"toadviewer"`.
6. **`tad-master/packages/toad-app/app/fileExport.ts`**:
   - Line 6: `import { ExportFormat, ParquetExportOptions } from "toadviewer";`

### D. Package `tadweb-app`
1. **`tad-master/packages/tadweb-app/package.json`**:
   - Dependency updated: `"toadviewer": "^0.12.0"`.
2. **`tad-master/packages/tadweb-app/src/webRenderMain.tsx`**:
   - Lines 22-24: imports updated from `"tadviewer"` to `"toadviewer"`.

---

## 3. Verification Commands & Results

1. **`toadviewer` Webpack Build (Dual Entry)**:
   - Output: `dist/toadviewer.js` (2,891,952 bytes) and `dist/tadviewer.js` (2,891,951 bytes).
   - Exit code: 0 (SUCCESS).
2. **`toadviewer` TypeScript Check**:
   - Command: `tsc --noEmit`
   - Exit code: 0 (0 errors).
3. **`toad-app` Webpack Build**:
   - Command: `npm run build-dev` and `npm run build-prod`
   - Output: `dist/toadapp.bundle.js` (4.95 MiB production bundle, 11.2 MiB dev bundle).
   - Exit code: 0 (SUCCESS).
4. **`toad-app` HTML Script Reference**:
   - Both `html/index.html` and `dist/index.html` load `<script src="toadapp.bundle.js"></script>`.
5. **`toad-app` TypeScript Check**:
   - Command: `tsc --noEmit`
   - Exit code: 0 (0 errors).
6. **Zero Lingering Imports Check**:
   - `from "tadviewer"` search across `toad-app` source code returned 0 lines.
