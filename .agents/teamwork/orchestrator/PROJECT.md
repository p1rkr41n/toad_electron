# Project: TOAD v2.4.8 Rebrand

## Architecture
- Monorepo structure with Lerna under `tad-master/packages/`:
  - `toad-app` (renamed from `tad-app`): Electron main and renderer application.
  - `toadviewer` (renamed from `tadviewer`): Core tabular grid and OLAP viewer UI components.
  - `reltab-duckdb`: RelTab relational database interface for DuckDB.
  - `reltab-sqlite`: RelTab relational database interface for SQLite.
- Entry Points:
  - Electron main process: `toad-app/app/main.ts`
  - Electron renderer process: `toad-app/src/electronRenderMain.tsx` -> bundled to `toadapp.bundle.js` loaded by `toad-app/html/index.html`
  - Webpack bundles: `toad-app/dist/toadapp.bundle.js` and `toadviewer/dist/toadviewer.js` (with legacy fallback `tadviewer.js`)

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | R1.1 Disk Package Renaming | Rename `packages/tad-app` -> `packages/toad-app`, `packages/tadviewer` -> `packages/toadviewer` | M2 | ORIGINAL_REQUEST.md |
| 2 | R1.2 Monorepo Manifests | Update `package.json` names and dependencies (`toadviewer`), update `lerna.json` ignore list | M2 | ORIGINAL_REQUEST.md |
| 3 | R1.3 TypeScript Imports | Update all internal imports from `"tadviewer"` to `"toadviewer"` | M2 | ORIGINAL_REQUEST.md |
| 4 | R1.4 NTFS Junctions | Create/update `node_modules/toadviewer` NTFS junction pointing to `packages/toadviewer` with backward compat junction | M2 | Explorer 1 |
| 5 | R2.1 Webpack Bundle Name | Change entry output bundle to `toadapp.bundle.js` in `toad-app/webpack.config.js` | M2 | ORIGINAL_REQUEST.md |
| 6 | R2.2 HTML Script Reference | Update `toad-app/html/index.html` line 11 to load `<script src="toadapp.bundle.js"></script>` | M2 | ORIGINAL_REQUEST.md |
| 7 | R2.3 Asar Footprint Exclusion | Update `toad-app/package.json` electron-builder config to `!**/node_modules/toadviewer/**` maintaining < 45 MB | M2 | ORIGINAL_REQUEST.md |
| 8 | R3.1 OpenParams & Types | Add `OpenToad` interface, extend `OpenType` and `OpenParams` in `openParams.ts` | M1 | ORIGINAL_REQUEST.md |
| 9 | R3.2 AppWindow Open & Save | Support `.toad` and `.tad` in openDialog/saveAsDialog, set default save extension to `.toad` with `toadFileFormatVersion: 2` | M1 | ORIGINAL_REQUEST.md |
| 10 | R3.3 Backward Compatibility | Transparently open legacy `.tad` (`tadFileFormatVersion: 1`), migrate `targetPath` to `DataSourcePath` | M1 | ORIGINAL_REQUEST.md |
| 11 | R4.1 DuckDB Internal SQL Views | Change view generator to `toad_tmpView_${viewCounter++}` in `reltab-duckdb.ts` | M1 | ORIGINAL_REQUEST.md |
| 12 | R4.2 UI Classes & Events | Update container CSS class to `.toad-app-pane` and custom events to `toad-query-error` | M1 | ORIGINAL_REQUEST.md |
| 13 | R4.3 Titlebar & About Dialog | Set window title to `<File/Project> - TOAD` and About dialog to `TOAD - Tabular OLAP Analytics Desktop (v2.4.8)` | M1 | ORIGINAL_REQUEST.md |
| 14 | R5.1 Build Scripts Sync | Update `fastbuild.ps1`, `dist_package.ps1`, `package_release.ps1` for `toad-app`, `toadviewer`, `toadapp.bundle.js` | M3 | ORIGINAL_REQUEST.md |
| 15 | R5.2 Version Bump to v2.4.8 | Update `tools/bump_version.js` and bump package manifests and `RegexDialog.tsx` to `2.4.8` | M3 | ORIGINAL_REQUEST.md |
| 16 | R5.3 Test Whitelist Updates | Update version whitelists in `tests/deep_integration_qa.js` to accept `2.4.7` and `2.4.8` | M3 | Explorer 3 |
| 17 | R5.4 QA Test Suite Pass | Run full automated regression tests (222+ tests) ensuring 100% pass | M4 | ORIGINAL_REQUEST.md |
| 18 | R5.5 FastBuild & Packaging | Run `fastbuild.ps1`, `dist_package.ps1`, `package_release.ps1` to produce `releases/Toad-2.4.8-x64-portable.exe` + `.zip` | M5 | ORIGINAL_REQUEST.md |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Logic, Backward Compatibility & Branding | R3.1-3.3, R4.1-4.3 in `packages/tad-app`, `reltab-duckdb`, `tadviewer` | Survey | DONE |
| M2 | Package Renaming & Webpack Asset Sync | R1.1-1.4, R2.1-2.3 (disk renames, manifests, junctions, webpack, HTML) | M1 | DONE |
| M3 | Build Scripts & Test Synchronization | R5.1-5.3 (`fastbuild.ps1`, `dist_package.ps1`, `bump_version.js`, test whitelists) | Survey | DONE |
| M4 | Comprehensive QA Regression Testing | R5.4 (222+ tests pass cleanly) | M2, M3 | DONE |
| M5 | FastBuild & Release Packaging Verification | R5.5 (Portable exe, zip, SHA256SUMS, notes, jj clean) | M4 | DONE |

## Code Layout
- `tad-master/packages/toad-app/`: Desktop application (renderer, main, packaging)
- `tad-master/packages/toadviewer/`: Viewer UI grid components
- `tad-master/packages/reltab-duckdb/`: DuckDB engine adapter
- `tad-master/packages/reltab-sqlite/`: SQLite engine adapter
- `tests/`: Automated test suites (`deep_integration_qa.js`, `smoke_test.js`, etc.)
- `tools/`: Build and bump utilities (`bump_version.js`, `jj`)
- Root: `fastbuild.ps1`, `dist_package.ps1`, `package_release.ps1`, `Toad.exe`
- `releases/`: Portable release artifacts (`Toad-2.4.8-x64-portable.exe`, `.zip`, `SHA256SUMS.txt`, notes)

## Interface Contracts
- `openParams.ts`:
  ```typescript
  export type OpenType = "fspath" | "toad" | "tad" | "dspath" | "empty";
  export interface OpenToad { openType: "toad"; fileContents: string; fileBaseName: string; }
  ```
- Workspace Serialization:
  ```json
  {
    "toadFileFormatVersion": 2,
    "tadFileFormatVersion": 2,
    "contents": { ... }
  }
  ```
- DuckDB View Generation:
  `toad_tmpView_${viewCounter++}`
- Webpack Output:
  `dist/toadapp.bundle.js` loaded via `<script src="toadapp.bundle.js"></script>` in `index.html`
