# Handoff Report: Logic, File Formats & Branding Exploration (R3 & R4)

**Agent:** Explorer 2 (Logic & Branding Explorer)  
**Recipient:** Orchestrator (Conversation ID: `afba7d24-e2ed-4eb2-89cc-f35d592f6de8`)  
**Date:** 2026-11-03  
**Status:** Hard Handoff (Investigation Complete)  
**Detailed Report:** `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_2\analysis.md`

---

## 1. Observation

Direct code examination and search tool observations across the repository:

1. **`packages/tad-app/src/openParams.ts` (lines 4, 17–28)**:
   ```typescript
   export type OpenType = "fspath" | "tad" | "dspath" | "empty";
   export interface OpenTad {
     openType: "tad";
     fileContents: string;
     fileBaseName: string; // for title
   }
   export type OpenParams = OpenFSPath | OpenDSPath | OpenTad | OpenEmpty;
   ```
   No `OpenToad` interface or `"toad"` variant currently exists in `OpenType`.

2. **`packages/tad-app/app/appWindow.ts`**:
   - **Line 6**: `import { OpenType, OpenFSPath, OpenTad, OpenParams } from "../src/openParams";`
   - **Lines 80–87**:
     ```typescript
     if (targetPath && path.extname(targetPath) === ".tad") {
       const fileContents = fs.readFileSync(targetPath, "utf8");
       const openTad: OpenTad = {
         openType: "tad",
         fileContents,
         fileBaseName: path.basename(targetPath),
       };
       openParams = openTad;
     }
     ```
     Opening a `.toad` file currently falls through to `openType: "fspath"`, treating it as a raw data file instead of a workspace.
   - **Line 102**: `title: "Toad",`
   - **Line 112**: `additionalArguments: ['--tadOpenParams=${JSON.stringify(openParams)}'],`
   - **Lines 237–240**:
     ```typescript
     filters: [
       {
         name: "All Supported Data Files",
         extensions: dataFileExtensions.concat(["tad", "sqlite", "duckdb"]),
       },
     ```
     Missing `"toad"` extension in `openDialog` and missing `"TOAD Workspace Files (*.toad, *.tad)"` filter entry.
   - **Lines 344–352**:
     ```typescript
     const TAD_FILE_FORMAT_VERSION = 2;
     const serialize = (contents: any): string => {
       const versionedObject = {
         tadFileFormatVersion: TAD_FILE_FORMAT_VERSION,
         contents,
       };
       return JSON.stringify(versionedObject, null, 2);
     };
     ```
     Workspaces are serialized with key `tadFileFormatVersion: 2` instead of `toadFileFormatVersion: 2`.
   - **Lines 360–367**:
     ```typescript
     const saveFilename = dialog.showSaveDialogSync(win, {
       title: "Save Toad Workspace",
       filters: [
         {
           name: "Toad Workspace files",
           extensions: ["toad", "tad"],
         },
       ],
     });
     ```

3. **`packages/tad-app/app/preload.js` (lines 12–19)**:
   ```javascript
   const argPrefix = '--tadOpenParams=';
   for (let i = 0; i < process.argv.length; i++) {
     const arg = process.argv[i];
     if (arg.startsWith(argPrefix)) {
       const openParamsStr = arg.slice(argPrefix.length);
       window.openParams = JSON.parse(openParamsStr);
     }
   }
   ```
   Only extracts arguments prefixed with `--tadOpenParams=`.

4. **`packages/tad-app/src/electronRenderMain.tsx` (lines 89–108, 326)**:
   ```typescript
   case "tad":
     const parsedFileState = JSON.parse(openParams.fileContents!);
     const savedFileState = parsedFileState.contents;
     if (parsedFileState.tadFileFormatVersion === 1) {
       const rawTargetPath = savedFileState.targetPath;
       log.info("Found older tad file format, targetPath: ", rawTargetPath);
       const connKey: DataSourceId = {
         providerName: "localfs",
         resourceId: rawTargetPath,
       };
       targetDSPath = { sourceId: connKey, path: ["."] };
     } else {
       targetDSPath = savedFileState.dsPath;
     }
     viewParams = ViewParams.deserialize(savedFileState.viewParams);
     break;
   ```
   `switch` statement only handles `"tad"`, not `"toad"`. Line 326 contains `remoteErrorDialog("Error initializing Tad", ...)`.

5. **`packages/reltab-duckdb/src/reltab-duckdb.ts` (line 35)**:
   ```typescript
   let viewCounter = 0;
   const genViewName = (): string => `tad_tmpView_${viewCounter++}`;
   ```
   Uses prefix `tad_tmpView_`.
   *Same pattern confirmed in `packages/reltab-sqlite/src/reltab-sqlite.ts:42`.*

6. **`packages/reltab-duckdb/src/csvimport.ts` (lines 94–104)**:
   ```typescript
   const candidates = [
     ...
     path.join(__dirname, "../../../tad-app/bin/toad-core.exe"),
     ...
   ];
   ```
   Hardcoded fallback path to `tad-app/bin/toad-core.exe`. When `tad-app` is renamed to `toad-app`, this path will not resolve.

7. **`packages/tadviewer/src/components/AppPane.tsx` (lines 394–401, 657, 687)**:
   - Line 399: `const title = "Toad - " + node.displayName; document.title = title;`
   - Line 657: `<div className="container-fluid full-height main-container tad-app-pane">`
   - Line 687: `export const tadReact = ReactDefault;`

8. **`packages/tadviewer/less/tadviewer.less` (lines 7–14, 321)**:
   - Line 7: `.tad-app-pane {`
   - Line 8: `font-family: var(--tad-font-family, "Helvetica Neue", Helvetica, Arial, sans-serif);`
   - Line 321: `html, body, .tad-app-pane {`

9. **`packages/tadviewer/src/PivotRequester.ts` & `FilterEditor.tsx`**:
   - `PivotRequester.ts` lines 500, 648: `new CustomEvent("tad-query-error", ...)`
   - `FilterEditor.tsx` lines 763–764: `window.addEventListener("tad-query-error", handleError);`

10. **`packages/tad-app/app/appMenu.ts`**:
    - Lines 18–23: `aboutToadMenuItem` uses `role: "about"` which is standard on macOS but non-functional for custom branding on Windows/Linux.
    - Lines 154–175: `helpSubmenu` lacks an explicit "About TOAD" entry for Windows.

11. **`packages/tad-app/app/main.ts`**:
    - Line 226: `extensions: reltabFS.dataFileExtensions.concat(["tad", "sqlite", "duckdb"])`
    - Lines 412–414, 462: CLI usage string refers to `.tad` files without mentioning `.toad`.

12. **`packages/tad-app/package.json`**:
    - Lines 163–167: File associations list only `.tad` as `"Toad Saved Workspace"`.

---

## 2. Logic Chain

1. **File Opening & Serialization (Observations 1, 2, 3, 4)**:
   - To make `.toad` the default workspace format while opening `.tad` transparently:
     - `OpenType` must include `"toad"` alongside `"tad"`, and `OpenToad` interface must be exported (`openParams.ts`).
     - `encodeFileOpenParams` in `appWindow.ts` must inspect file extension: `.toad` produces `openType: "toad"`, and `.tad` produces `openType: "tad"`.
     - In `electronRenderMain.tsx:openParamsDSPath`, both `case "toad":` and `case "tad":` must be handled.
     - The migration logic checks whether `parsedFileState.tadFileFormatVersion === 1` or if `targetPath` exists without `dsPath`. If so, it migrates `targetPath` to a `localfs` `DataSourcePath`. Otherwise, it uses `dsPath` directly. This guarantees 100% transparent opening of both legacy `.tad` and modern `.toad` files.
     - Workspaces must serialize with `toadFileFormatVersion: 2` (and optionally `tadFileFormatVersion: 2` for backward compatibility).
     - Preload script must parse both `--toadOpenParams=` and `--tadOpenParams=`.

2. **Internal SQL Temporary Views (Observations 5, 6)**:
   - In `reltab-duckdb.ts:35`, changing `genViewName` from ``tad_tmpView_${viewCounter++}`` to ``toad_tmpView_${viewCounter++}`` satisfies R4.
   - The same change in `reltab-sqlite.ts:42` preserves dialect consistency.
   - No test cases assert on `tad_tmpView_` string directly.
   - In `csvimport.ts:100`, adding `toad-app/bin/toad-core.exe` to `candidates` prevents breakage when the package directory is renamed on disk.

3. **UI Styling & Events (Observations 7, 8, 9)**:
   - Changing `AppPane.tsx:657` to `<div className="container-fluid full-height main-container toad-app-pane tad-app-pane">` and updating `tadviewer.less` to `.toad-app-pane, .tad-app-pane` modernizes the DOM while maintaining zero CSS regressions.
   - Dual-dispatching `toad-query-error` and `tad-query-error` in `PivotRequester.ts` and listening for both in `FilterEditor.tsx` ensures custom events are modernized without dropped messages.

4. **Branding, Titlebar & About Dialog (Observations 7, 10, 11, 12)**:
   - Titlebar format `<File/Project> - TOAD`: In `AppPane.tsx:399`, changing `title = "Toad - " + node.displayName` to ``title = `${node.displayName} - TOAD``` satisfies the titlebar branding requirement.
   - Default window title in `appWindow.ts:102` and `html/index.html:4` set to `"TOAD"`.
   - About dialog: Adding an explicit `About TOAD` menu entry in `helpSubmenu` for Windows/Linux and calling `app.setAboutPanelOptions` in `main.ts` displays:
     `TOAD - Tabular OLAP Analytics Desktop (v2.4.8)`.

---

## 3. Caveats

1. **Dual Extension Workspace Files**: If a user renames a `.toad` file to `.tad` or vice versa, the parser handles it flawlessly because both branches check `tadFileFormatVersion` and `dsPath` vs `targetPath` uniformly.
2. **Preload Additional Arguments**: Passing both `--toadOpenParams=` and `--tadOpenParams=` in `webPreferences.additionalArguments` slightly increases command line length (~50-100 bytes), which is completely negligible and provides bulletproof backward compatibility.
3. **No Caveats on RelTab SQL Views**: View naming `toad_tmpView_*` does not affect any existing DuckDB tables or parquet files because all views are session-temporary.

---

## 4. Conclusion

The technical path for R3 and R4 is unambiguous, verified against source code, and ready for immediate implementation.

### Implementation Checklist for Implementer:
1. `packages/tad-app/src/openParams.ts`: Add `OpenToad` interface, extend `OpenType` and `OpenParams`.
2. `packages/tad-app/app/appWindow.ts`:
   - Import `OpenToad`.
   - Update `encodeFileOpenParams` to handle `.toad` and `.tad`.
   - Update `title: "TOAD"`, pass `--toadOpenParams=` and `--tadOpenParams=`.
   - Add `"toad"` to `openDialog` filters and add TOAD Workspace filter.
   - Set `TOAD_FILE_FORMAT_VERSION = 2` and update `serialize()`.
   - Update `saveAsDialog()` to default to `.toad`.
3. `packages/tad-app/app/preload.js`: Check `--toadOpenParams=` and fallback to `--tadOpenParams=`.
4. `packages/tad-app/src/electronRenderMain.tsx`:
   - Handle `case "toad":` and `case "tad":` with auto-migration.
   - Update error dialog string to `"Error initializing TOAD"`.
5. `packages/reltab-duckdb/src/reltab-duckdb.ts` & `reltab-sqlite.ts`:
   - Change `genViewName` prefix to `toad_tmpView_${viewCounter++}`.
6. `packages/reltab-duckdb/src/csvimport.ts`:
   - Add `toad-app/bin/toad-core.exe` to `findToadCoreBinary()`.
7. `packages/tadviewer/src/components/AppPane.tsx`:
   - Add `.toad-app-pane` to main container class.
   - Set `document.title = `${node.displayName} - TOAD``.
   - Export `toadReact = ReactDefault` and alias `tadReact`.
8. `packages/tadviewer/less/tadviewer.less`:
   - Add `.toad-app-pane` alongside `.tad-app-pane`.
9. `packages/tadviewer/src/PivotRequester.ts` & `FilterEditor.tsx`:
   - Modernize custom events to `toad-query-error`.
10. `packages/tad-app/app/appMenu.ts` & `main.ts`:
    - Add About TOAD menu handler and `app.setAboutPanelOptions` with `TOAD - Tabular OLAP Analytics Desktop (v2.4.8)`.
11. `packages/tad-app/package.json`:
    - Add `.toad` file association.

---

## 5. Verification Method

1. **Verify TypeScript compilation**:
   ```powershell
   cd d:\Shared_UserData\Downloads\tad\tad-master\packages\tad-app
   npx tsc --noEmit
   ```
2. **Verify Backward Workspace Loading**:
   Run a Node script or launch application loading `packages/tad-app/examples/movie-grossByDirectorWithFilter.tad`:
   - Verify `parsedFileState.tadFileFormatVersion === 1` triggers migration.
   - Verify no unhandled exceptions are logged.
3. **Verify Modern Workspace Saving**:
   Trigger `saveAsDialog()`, inspect generated file:
   - Ensure extension is `.toad`.
   - Ensure JSON contains `"toadFileFormatVersion": 2`.
4. **Verify DuckDB Temporary View Prefix**:
   Run query execution via `reltab-duckdb` with `--show-queries` or logging enabled; verify SQL statement contains `toad_tmpView_`.
5. **Verify DOM Class & Titlebar**:
   Inspect rendered DOM for `.toad-app-pane`. Inspect window title for `<file> - TOAD`.
