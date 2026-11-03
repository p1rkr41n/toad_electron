# Handoff Report — Ingestion Error Handling, UI Status Badging & Build Tooling

**Agent**: `explorer_error_ui` (Ingestion Error & UI Explorer)  
**Parent**: `463c7962-7642-4e36-b3b9-9f66c7c8f52c`  
**Handoff Type**: Hard (Investigation Complete)  
**Date**: 2026-11-03  

---

## 1. Observation

### 1.1 Error Dialog Triggers
1. **`tad-master/packages/tad-app/src/electronRenderMain.tsx:14-33`**:
   ```typescript
   window.addEventListener("error", (e) => {
     console.error("[UNCAUGHT-WINDOW-ERROR]", e.message, e.error?.stack);
     try {
       getHostBridge().showErrorDialog(
         "Renderer Error: " + (e.error?.message || e.message),
         e.error?.stack || e.message || String(e),
         false
       );
     } catch { }
   });
   window.addEventListener("unhandledrejection", (e) => {
     console.error("[UNCAUGHT-PROMISE-REJECTION]", e.reason?.message, e.reason?.stack);
     try {
       getHostBridge().showErrorDialog(
         "Promise Rejection: " + (e.reason?.message || String(e.reason)),
         e.reason?.stack || String(e.reason),
         false
       );
     } catch { }
   });
   ```
2. **`tad-master/packages/host-bridge/src/V8HostAdapter.ts:86-92`**:
   ```typescript
   async showErrorDialog(title: string, message: string, fatal = false): Promise<void> {
     try {
       await this.invoke("errorDialog", { title, message, fatal });
     } catch {
       console.error(`[ErrorDialog] ${title}: ${message}`);
     }
   }
   ```
3. **`tad-master/packages/tad-app/app/main.ts:193-195, 488-499`**:
   ```typescript
   ipcMain.handle("errorDialog", (event, title, msg, fatal) =>
     errorDialog(title, msg, fatal)
   );

   const errorDialog = async (
     title: string,
     msg: string,
     fatal = false
   ): Promise<void> => {
     log.log("*** errorDialog: ", title, msg, fatal);
     dialog.showErrorBox(title, msg);

     if (fatal) {
       app.quit();
     }
   };
   ```
   Direct observation: `dialog.showErrorBox(title, msg)` displays a native OS modal message box on Windows, halting the event loop and forcing manual user dismissal. Furthermore, because `V8HostAdapter` passes an object `{ title, message, fatal }`, `title` is evaluated as `[object Object]` and `msg` is `undefined`.

### 1.2 Missing Error Catch in User Opening Flow
1. **`tad-master/packages/tadviewer/src/components/DataSourceSidebar.tsx:676-682`**:
   ```typescript
   try {
     await actions.openDataSourcePath(dsPath, stateRef);
   } finally {
     if (clickSeq === clickSeqRef.current) {
       actions.setActiveLoadingFile(null, stateRef);
     }
   }
   ```
   Direct observation: No `catch` block exists around `openDataSourcePath`.
2. **`tad-master/packages/tadviewer/src/actions.ts:350-384`**:
   ```typescript
   try {
     manager.pause();
     await startAppLoadingTimer(stateRef);
     await replaceCurrentView(path, stateRef, viewParams);
     const dv = await waitForDataView(stateRef, 8000);
     ...
   } finally {
     stopAppLoadingTimer(stateRef);
     setActiveLoadingFile(null, stateRef);
     manager.resume();
   }
   ```
   Direct observation: `openDataSourcePath` has a `try ... finally` block but no `catch` block. Any ingestion failure rethrows directly to React synthetic event handlers, triggering `window.unhandledrejection` and the modal popup.

### 1.3 Pre-existing Non-Blocking Error Card
1. **`tad-master/packages/tadviewer/src/components/AppPane.tsx:542-554`**:
   ```tsx
   } else if (activeLoading && activeLoading.error) {
     pivotSidebar = null;
     centerPane = (
       <div className="center-app-pane center-error-pane">
         <div className="main-error-card">
           <Icon icon="error" iconSize={40} intent="danger" />
           <h3 className="main-error-title">
             Error loading {activeLoading.fileName}
           </h3>
           <p className="main-error-desc">{activeLoading.error}</p>
         </div>
       </div>
     );
   ```
   Direct observation: Tad already contains an in-app non-blocking center error card with `<Icon icon="error" />` that allows the user to continue using the sidebar.

### 1.4 Logging Pipeline & `toad.log`
1. **`tad-master/packages/tad-app/app/main.ts:786-788`**:
   ```typescript
   log.transports.file.resolvePath = () =>
     path.join(portableEnv.logsDir, "toad.log");
   log.transports.file.level = "info";
   ```
2. **`tad-master/packages/tad-app/app/appWindow.ts:135-137`**:
   ```typescript
   win.webContents.on("console-message", (event, level, message, line, sourceId) => {
     log.warn(`[RENDERER-CONSOLE] [lvl=${level}] ${message} (${sourceId}:${line})`);
   });
   ```
   Direct observation: Any `console.error` or `console.warn` from the renderer is automatically forwarded by Electron into `toad.log` at `toadAppData_<suffix>/logs/toad.log`.

### 1.5 File Status Tracking & Badging
1. **`tad-master/packages/tadviewer/src/components/ProjectFilesTable.tsx:311-316`**:
   ```tsx
   if (s === "ERROR") {
     return (
       <span className="status-indicator status-error" title="ERROR">
         !
       </span>
     );
   }
   ```
2. **`tad-master/packages/tadviewer/less/sidebar.less:1191-1194`**:
   ```less
   &.status-error {
     color: #ef4444;
     font-weight: 700;
   }
   ```
   Direct observation: `ProjectFilesTable.tsx` already tracks and identifies `"ERROR"`, but renders a plain text character `!`. `@blueprintjs/core` is imported on line 3 and contains `<Icon icon="error" />` which renders an exclamation mark circle icon.

### 1.6 Stale Temporary & Cache Files
Direct filesystem query via PowerShell:
- `build/Toad-2.4.6/toadAppData_p486h/temp/ekm8j/sample_40gb_cached_3535af61fe.parquet`: **4,659.22 MB** (Corrupted parquet cache with `column01..column10`).
- `releases/toadAppData_uthyw/temp/okgrg/sample_40gb_cached_3535af61fe.tmp_1793688800513.parquet`: **4,654.57 MB** (Stale `.tmp_` partial file).
- In `tad-master/packages/tad-app/app/portableAppData.ts:774-805`: `purgeOrphanTempFiles` does not recurse into `temp/` subdirectories (`okgrg`, `ekm8j`), leaving `.tmp_` files uncleaned across sessions.

---

## 2. Logic Chain

1. **Modal Popup Cause**:
   - Observations 1.1 and 1.2 demonstrate that when an ingestion failure occurs during file loading, neither `actions.openDataSourcePath` nor `DataSourceSidebar.tsx:handleOpenFile` catches the rejection.
   - This unhandled rejection is caught by `window.addEventListener("unhandledrejection")` (Observation 1.1), which calls `getHostBridge().showErrorDialog()`.
   - In `main.ts` (Observation 1.1), `ipcMain.handle("errorDialog")` invokes `dialog.showErrorBox(title, msg)`.
   - On Windows, `dialog.showErrorBox` creates a native modal window requiring user click interaction.
   - **Inference**: Adding exception boundaries in `openDataSourcePath` and `handleOpenFile`, and removing modal `dialog.showErrorBox` calls in `main.ts` for non-fatal errors will completely eliminate the intrusive pop-up dialog.

2. **In-App Non-Blocking Error State**:
   - Observation 1.3 shows that `AppPane.tsx` already has an error state triggered by `appState.activeLoadingFile.error`.
   - When `openDataSourcePath` catches an error, setting `setActiveLoadingFile({ isLoading: false, fileName, dsPath, percent: 0, error: err.message })` switches the center view to the existing error card without blocking the sidebar.
   - **Inference**: Non-blocking error handling can be achieved cleanly by reusing existing UI components without creating new modals.

3. **Persistent Logging to `toad.log`**:
   - Observation 1.4 proves that `toad.log` is initialized by `electron-log` in `portableAppData.ts` / `main.ts`, and `appWindow.ts` forwards all renderer console output to `toad.log`.
   - **Inference**: Catching the exception and calling `console.error(...)` or `log.error(...)` in main/renderer guarantees the full error trace is recorded to `toad.log`.

4. **UI Status Badge (`!` Icon)**:
   - Observation 1.5 shows `ProjectFilesTable.tsx` already responds to `"ERROR"` status, but renders text `!`.
   - `@blueprintjs/core` `Icon` component is already imported on line 3.
   - **Inference**: Replacing `<span ...>!</span>` with `<span className="status-indicator status-error"><Icon icon="error" size={12} style={{ color: "#ef4444" }} /></span>` renders the required exclamation mark circle icon.

5. **Cache Validation & Eviction at Gateway**:
   - Observation 1.6 shows stale 4.65GB corrupted parquet files remain on disk because `reltab-fs.ts:261` bypassed `nativeCSVImport()` whenever `isCacheHit` was true.
   - **Inference**: Placing schema validation (`isMisparsedDelimiter`) in `reltab-fs.ts` right after `createViewFromParquet` ensures corrupted caches are immediately detected, evicted from disk and ledger, and re-imported cleanly.

---

## 3. Caveats

1. **Tauri Engine**: `IHostBridge` supports both `"v8"` (Electron) and `"tauri"`. Findings in this report focus on the Electron runtime (`V8HostAdapter`), which is active in the Windows build.
2. **First-Page RAM Micro-Cache**: Pre-warmed RAM cache entries for failed files should be evicted via `manager.setFirstPageCache(canon, null)` upon error.
3. No other caveats.

---

## 4. Conclusion

1. The intrusive pop-up dialog is caused by missing `try/catch` boundaries in `openDataSourcePath` / `handleOpenFile` escalating to `window.unhandledrejection` -> `main.ts:dialog.showErrorBox`.
2. Suppressing `dialog.showErrorBox` in `main.ts:errorDialog` (reserving it strictly for fatal app crashes) and routing errors to `activeLoadingFile` in `AppPane.tsx` completely solves R4 while maintaining full UI responsiveness.
3. Full stack traces are automatically routed to `toad.log` (`toadAppData_<suffix>/logs/toad.log`) via `console.error` and `electron-log`.
4. The sidebar already tracks `ERROR` status; changing text `!` to `<Icon icon="error" size={12} style={{ color: "#ef4444" }} />` provides the exact exclamation mark circle icon required by R4.
5. `reltab-fs.ts:createViewFromParquet` must validate the view columns and evict any parquet with `column01..columnN` or comma-separated column 0.
6. The two 4.65GB stale files (`build/Toad-2.4.6/.../sample_40gb_cached_3535af61fe.parquet` and `releases/.../sample_40gb_cached_...tmp_...parquet`) must be removed to satisfy R3.

---

## 5. Verification Method

### 5.1 Verification Commands
1. **Run Integration Test Suite**:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe tests\deep_integration_qa.js
   ```
   *Expected*: All test suites pass (0 failures), confirming ledger, cache validation, and out-of-process worker sandbox.

2. **Verify FastBuild Execution**:
   ```powershell
   .\fastbuild.ps1 -Dev
   ```
   *Expected*: Builds cleanly into `build\Toad-<version>\Toad.exe` without error.

3. **Verify Stale File Deletion**:
   ```powershell
   Test-Path "build/Toad-2.4.6/toadAppData_p486h/temp/ekm8j/sample_40gb_cached_3535af61fe.parquet"
   Test-Path "releases/toadAppData_uthyw/temp/okgrg/sample_40gb_cached_3535af61fe.tmp_1793688800513.parquet"
   ```
   *Expected*: Both return `False`.

4. **Verify Delimiter Ingestion with Mini Sample**:
   Sniff or import the first 1000 lines of `sample_40gb.csv` (or full file):
   *Expected*: Schema contains all 11 proper columns (`Timestamp`, `EventTime`, `RuleTitle`, `RuleID`, `Level`, `Computer`, `Channel`, `EventID`, `RecordID`, `Details`, `ExtraFieldInfo`). Zero `column01..column10` columns exist. Column 0 contains valid timestamps, not concatenated headers.

5. **Verify Error Handling & Status Badging**:
   Attempt to load an invalid or malformed file:
   *Expected*: No modal popup dialog appears. The file displays an exclamation mark circle icon (`!`) in `ProjectFilesTable`. Center pane displays the non-blocking error card with `<Icon icon="error" />`. Full error trace appears in `toad.log`.

### 5.2 Invalidation Conditions
- If `dialog.showErrorBox` appears on screen during ingestion failure, the fix is invalid.
- If `toad.log` does not contain the error trace, logging is invalid.
- If a CSV generates `column01..column10`, R1/R2 parser configuration is invalid.
