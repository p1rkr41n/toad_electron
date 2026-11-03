# Detailed Report of Changes: Logic, File Formats & Branding (R3 & R4)

**Worker**: Worker M1 (Logic, File Formats & Branding Worker)  
**Date**: 2026-11-03  
**Status**: Implemented & Verified  

---

## 1. Summary of Changes

All 10 required tasks under Requirement 3 and Requirement 4 have been implemented cleanly with zero regressions and strict backwards compatibility:

1. **`tad-master/packages/tad-app/src/openParams.ts`**:
   - Added `OpenToad` interface with `openType: "toad"`.
   - Extended `OpenType` union type to `"fspath" | "toad" | "tad" | "dspath" | "empty"`.
   - Extended `OpenParams` union to include `OpenToad`.

2. **`tad-master/packages/tad-app/app/appWindow.ts`**:
   - Imported `OpenToad` from `../src/openParams`.
   - Updated `encodeFileOpenParams` to inspect file extension: `.toad` -> `openType: "toad"`, `.tad` -> `openType: "tad"`.
   - Updated initial window title to `"TOAD"`.
   - Emitted both `--toadOpenParams=` and `--tadOpenParams=` in `webPreferences.additionalArguments`.
   - Updated `openDialog` file filters to include `"toad"` in "All Supported Data Files" and added a dedicated filter `"TOAD Workspace Files (*.toad, *.tad)"`.
   - Added `TOAD_FILE_FORMAT_VERSION = 2` constant, updated `serialize()` to write `toadFileFormatVersion: 2` (while keeping `tadFileFormatVersion: 2` for universal tool compatibility).
   - Updated `saveAsDialog()` to set title `"Save TOAD Workspace"` and default to `.toad` with fallback to `.tad`.

3. **`tad-master/packages/tad-app/app/preload.js`**:
   - Updated command-line argument parser to inspect `--toadOpenParams=` first and gracefully fallback to `--tadOpenParams=`.

4. **`tad-master/packages/tad-app/src/electronRenderMain.tsx`**:
   - Updated `openParamsDSPath` to handle both `case "toad":` and `case "tad":`.
   - Added transparent auto-migration for legacy `.tad` workspaces (`tadFileFormatVersion === 1` or when `targetPath` exists without `dsPath`), converting `targetPath` to a `localfs` `DataSourcePath`.
   - Updated the renderer initialization fatal error dialog title from `"Error initializing Tad"` to `"Error initializing TOAD"`.

5. **`tad-master/packages/reltab-duckdb/src/reltab-duckdb.ts`**:
   - Updated `genViewName` prefix from `tad_tmpView_` to `toad_tmpView_${viewCounter++}`.

6. **`tad-master/packages/reltab-sqlite/src/reltab-sqlite.ts`**:
   - Updated `genViewName` prefix from `tad_tmpView_` to `toad_tmpView_${viewCounter++}` for relational engine dialect consistency.

7. **`tad-master/packages/reltab-duckdb/src/csvimport.ts`**:
   - Added candidate discovery path `path.join(__dirname, "../../../toad-app/bin/toad-core.exe")` in `findToadCoreBinary()` alongside the legacy `tad-app` fallback.

8. **`tad-master/packages/tadviewer/src/components/AppPane.tsx`**:
   - Added `.toad-app-pane` alongside `.tad-app-pane` in main container class.
   - Formatted window document title as `${node.displayName} - TOAD`.
   - Exported `toadReact = ReactDefault` and maintained `tadReact = toadReact` alias.

9. **`tad-master/packages/tadviewer/less/tadviewer.less`**:
   - Added `.toad-app-pane` selector alongside `.tad-app-pane` with fallback CSS variables (`var(--toad-font-family, var(--tad-font-family, ...))`).
   - Added `.toad-app-pane` to smooth background transition selector.

10. **`tad-master/packages/tadviewer/src/PivotRequester.ts` & `FilterEditor.tsx`**:
    - Modernized error handling to dual-dispatch `toad-query-error` and `tad-query-error` in `PivotRequester.ts` (lines 500 & 652).
    - Updated `FilterEditor.tsx` (line 760) to listen for both `toad-query-error` and `tad-query-error`.

11. **`tad-master/packages/tad-app/app/appMenu.ts` & `main.ts`**:
    - Created explicit `showAboutDialog` in `appMenu.ts` displaying:
      `TOAD - Tabular OLAP Analytics Desktop (v2.4.8)`
      with detailed runtime diagnostics (Electron, Chrome, Node.js, V8).
    - Added "About TOAD" entry to `helpSubmenu` for Windows/Linux.
    - Updated `aboutToadMenuItem()` on macOS to use `role: "about"`, `label: "About TOAD"` and explicit click handler.
    - Added `app.setAboutPanelOptions` call in `main.ts:appInit()` with TOAD metadata.
    - Added `"toad"` to `dialog:showOpenDialog` filter list in `main.ts`.
    - Modernized CLI options (`srcfile` typeLabel and description) and `usageInfo` synopsis to reference `.toad` files.
    - Updated `reportFatalError` string in `main.ts` to `"Error starting TOAD"`.

---

## 2. File Ownership Compliance

Only the 13 specified files were touched:
- `tad-master/packages/tad-app/src/openParams.ts`
- `tad-master/packages/tad-app/app/appWindow.ts`
- `tad-master/packages/tad-app/app/preload.js`
- `tad-master/packages/tad-app/src/electronRenderMain.tsx`
- `tad-master/packages/reltab-duckdb/src/reltab-duckdb.ts`
- `tad-master/packages/reltab-sqlite/src/reltab-sqlite.ts`
- `tad-master/packages/reltab-duckdb/src/csvimport.ts`
- `tad-master/packages/tadviewer/src/components/AppPane.tsx`
- `tad-master/packages/tadviewer/less/tadviewer.less`
- `tad-master/packages/tadviewer/src/PivotRequester.ts`
- `tad-master/packages/tadviewer/src/components/FilterEditor.tsx`
- `tad-master/packages/tad-app/app/appMenu.ts`
- `tad-master/packages/tad-app/app/main.ts`
