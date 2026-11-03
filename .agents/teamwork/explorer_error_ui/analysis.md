# TOAD Ingestion Error Handling, UI Status Badging & Build Tooling — Detailed Analysis Report

**Investigator**: Ingestion Error & UI Explorer (`explorer_error_ui`)  
**Date**: 2026-11-03  
**Workspace**: `d:\Shared_UserData\Downloads\tad`  
**Reference Root Cause**: `C:\Users\huydq\.gemini\antigravity\brain\489b863f-84dc-4fd6-bbfb-142488ba4d23\bao_cao_root_cause_analysis_csv_column_split.md`  
**Requirements Addressed**: R3 (Cleanup), R4 (Non-blocking Error Handling & Badging), R5 (Build & Workspace Adherence)

---

## Executive Summary

When a data file fails ingestion or throws an exception during processing, the current application triggers a native OS modal message box (`dialog.showErrorBox`) via unhandled renderer promise rejections. On Windows, this pops up a blocking dialog (often titled `[object Object]` due to IPC argument wrapping) requiring the user to manually click "OK" / "Ignore".

Meanwhile, Tad **already contains** a modern, non-blocking center error card in `AppPane.tsx` (`<div className="center-app-pane center-error-pane">` with Blueprint `<Icon icon="error" />`) designed to inform the user of file failures without freezing the app.

This report provides the full architectural trace from the ingestion worker through the main and renderer processes, pinpoints every location where pop-up error dialogs are triggered, details how to replace them with non-blocking error handling and persistent logging in `toad.log`, verifies the sidebar status badging mechanism (`!` icon in `ProjectFilesTable.tsx`), and documents build and cache cleanup protocols.

---

## 1. Full Ingestion & Error Flow Architecture

### 1.1 Ingestion Flow Overview

```
[User Action: Click / Drag & Drop / Auto-Load]
                │
                ▼
      DataSourceSidebar.tsx
                │
                ├── If status === "ready": actions.openDataSourcePath()
                │                                    │
                │                                    ▼
                │                          actions.ts: replaceCurrentView()
                │                                    │
                │                                    ▼
                │                          reltab-fs.ts: getTableName()
                │
                └── If status !== "ready": MultipleLoadingManager.prioritize()
                                                     │
                                                     ▼
                                        MultipleLoadingManager.ts:
                                        checkAndProcessQueue() (SJF 1s loop)
                                                     │
                                                     ▼
                                        dispatchWorker(processingItem)
                                                     │
                                                     ▼
                                        reltab-fs.ts: getTableName()
                                                     │
        ┌────────────────────────────────────────────┴───────────────────────────┐
        ▼                                                                        ▼
   [Cache Hit]                                                              [Cache Miss]
checkParquetCache() === true                                      nativeCSVImport() (csvimport.ts)
        │                                                                        │
        ▼                                                   ┌────────────────────┴────────────────────┐
createViewFromParquet()                                     ▼                                         ▼
                                                   runIngestInWorker()                      streamCsvToParquet()
                                                   (ingestWorker.js)                        (In-Process Streaming)
                                                            │                                         │
                                                            ▼                                         ▼
                                                   Out-of-Process DuckDB                     DuckDB C++ Queries
                                                   (Physical Crash Firewall)                 (Safe Tier / Standard Tiers)
```

### 1.2 Ingestion Execution & Worker Sandboxing

1. **Out-of-Process Worker Sandbox (`ingestWorker.ts`)**:
   - Location: `tad-master/packages/reltab-duckdb/src/ingestWorker.ts`
   - Invocation: `csvimport.ts:2681` spawns worker via `child_process.fork(workerScript, args, { stdio: ["ignore", "pipe", "pipe", "ipc"] })`.
   - Worker isolates native DuckDB C++ assertion crashes (such as `vector.cpp:1859`).
   - If worker execution fails, it catches at line 189:
     ```typescript
     } catch (err: any) {
       console.error("[IngestWorker] Worker query execution failed:", err?.message || err);
       process.exit(1);
     }
     ```
   - In `csvimport.ts:2697`, the parent process detects non-zero exit code:
     ```typescript
     child.on("exit", (code, signal) => {
       if (code === 0) {
         resolve();
       } else {
         const errMsg = `[Worker Guard] Ingest worker exited with code ${code}, signal ${signal}. ${stderr.trim()}`;
         log.error(errMsg);
         reject(new Error(errMsg));
       }
     });
     ```
   - **Crucial Bug Identified in Worker Arguments**:
     In `ingestWorker.ts:21`:
     `const isComplexLog = process.argv[5] === "1";`
     However, `runIngestInWorker` in `csvimport.ts:2670` packs `isComplex` inside `process.argv[4]` (the `cfg` JSON string). As a result, `process.argv[5]` is `undefined`, so `isComplexLog` evaluates to `false` unless explicitly checked from `cfg.isComplex`.
     *Fix recommendation*: `const isComplexLog = process.argv[5] === "1" || cfg.isComplex === true;`.

2. **In-Process Streaming & Fallback Pipeline (`csvimport.ts`)**:
   - Location: `tad-master/packages/reltab-duckdb/src/csvimport.ts`
   - Tiered execution: Safe Profile -> Tier 0 (RFC-4180 strict) -> Tier 1 (`parallel=false`) -> Tier 2 (`all_varchar=true`) -> Tier 2b (Force Header) -> Tier 3 (Raw Event mode).
   - If streaming fails (line 3528):
     Records `status: "ERROR"` event in `ToadParquetLedger` (`toad_ledger.parquet`), removes temporary `.tmp_` parquet file, and attempts in-memory DuckDB import.
   - If in-memory Tier 2b also fails (line 3671):
     ```typescript
     } catch (err2b) {
       log.error("[Ingest In-Memory Tier 2b] Tat ca cac tier deu that bai:", err2b);
       throw err2b;
     }
     ```
     *Gap identified*: Lines 3671-3674 rethrow `err2b` without recording a final fatal `ERROR` event into `ToadParquetLedger`.

3. **Renderer Hand-off & UI State Updates (`MultipleLoadingManager.ts`)**:
   - Location: `tad-master/packages/tadviewer/src/MultipleLoadingManager.ts`
   - When `dispatchWorker()` encounters an exception (line 911):
     ```typescript
     } catch (err: any) {
       log.error(`[MultipleLoading] Loi khi nap file ${processingItem.fileName}:`, err);
       const errorItem: FileIngestItem = {
         ...processingItem,
         status: "error",
         error: err?.message || String(err),
         version: (processingItem.version || 0) + 1,
       };
       this.files.set(errorItem.key, errorItem);
       this.activeItems.delete(processingItem.key);
       this.notify();
     ```
   - *Gaps identified in `MultipleLoadingManager.ts`*:
     1. Sibling keys sharing the same physical file on disk (`this.canonicalMap.get(processingItem.canonicalPath)`) are **not** updated to `status: "error"`.
     2. `pendingActiveOpenKey` was already reset to `null` on line 902 in the success branch; in the error branch, lines 927-941 only update `activeLoadingFile` if `this.pendingActiveOpenKey === targetItem.key`. If cleared, `activeLoadingFile` remains in `isLoading: true` state indefinitely!
     3. Error information is not synchronized to `ToadParquetLedger` or `ProjectWorkspaceManager`.

---

## 2. Root Cause of Intrusive Pop-Up Error Dialogs

### 2.1 The 4 Dialog Trigger Points

| # | File Path | Line(s) | Mechanism | Behavior / Problem |
|---|-----------|---------|-----------|--------------------|
| 1 | `packages/tad-app/src/electronRenderMain.tsx` | 24–33 | `window.addEventListener("unhandledrejection")` | Catches ANY unhandled promise rejection in renderer, calls `getHostBridge().showErrorDialog("Promise Rejection: ...")`. |
| 2 | `packages/tad-app/src/electronRenderMain.tsx` | 14–23 | `window.addEventListener("error")` | Catches unhandled window errors, calls `getHostBridge().showErrorDialog("Renderer Error: ...")`. |
| 3 | `packages/tad-app/app/main.ts` | 193–195, 488–499 | `ipcMain.handle("errorDialog")` -> `errorDialog()` -> `dialog.showErrorBox()` | Shows native OS modal dialog. Halts all UI interaction until user clicks OK/Ignore. Title shows `[object Object]` due to object argument mismatch. |
| 4 | `packages/tad-app/src/electronRenderMain.tsx` | 336 | `remoteErrorDialog("Error initializing Tad", err.message, true)` | Startup failure triggers fatal dialog and immediately terminates the application. |

### 2.2 Missing Exception Boundary in User Interaction

In `packages/tadviewer/src/components/DataSourceSidebar.tsx:652`:
```typescript
  const handleOpenFile = async (file: ProjectWorkspaceFile) => {
    ...
    if (item && item.status === "ready") {
      ...
      try {
        await actions.openDataSourcePath(dsPath, stateRef);
      } finally {
        if (clickSeq === clickSeqRef.current) {
          actions.setActiveLoadingFile(null, stateRef);
        }
      }
    }
```
**Notice**: There is **no `catch` block** in `handleOpenFile`.
In `packages/tadviewer/src/actions.ts:306` (`openDataSourcePath`):
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
**Notice**: `openDataSourcePath` has a `try ... finally` block, but **no `catch` block**!
When `replaceCurrentView()` throws an ingestion error (e.g. corrupt cache or DuckDB sniffer exception):
1. `openDataSourcePath` fails to catch it and rethrows.
2. `handleOpenFile` fails to catch it.
3. React synthetic event handler yields an unhandled promise rejection.
4. `window.addEventListener("unhandledrejection")` in `electronRenderMain.tsx` intercepts it.
5. Invokes `getHostBridge().showErrorDialog()`.
6. Sends IPC `"errorDialog"` to Main process.
7. Main process calls `dialog.showErrorBox("[object Object]", undefined)`.
8. Native Windows modal dialog freezes user interaction until dismissed!

---

## 3. Logger Architecture & `toad.log` Discovery

### 3.1 `toad.log` File Location & Lifecycle
- **Portable AppData Directory**:
  Managed by `packages/tad-app/app/portableAppData.ts`.
  In portable mode, Toad dynamically locates or creates `toadAppData_<5_random_chars>` (e.g., `toadAppData_uthyw`, `toadAppData_p486h`) immediately adjacent to `Toad.exe`.
- **Log Subdirectory**:
  `path.join(appDataDir, "logs")`.
- **Canonical Log File Path**:
  `path.join(portableEnv.logsDir, "toad.log")`  
  (e.g., `d:\Shared_UserData\Downloads\tad\releases\toadAppData_uthyw\logs\toad.log`).
- **Main Process Logger Configuration** (`packages/tad-app/app/main.ts:784-789`):
  ```typescript
  log.transports.file.resolvePath = () => path.join(portableEnv.logsDir, "toad.log");
  log.transports.file.level = "info";
  ```
  `log` is `electron-log` (v4.4.4).

### 3.2 Renderer-to-File Logging Pipeline
`appWindow.ts:135-137` already hooks into Electron `webContents.on("console-message")`:
```typescript
win.webContents.on("console-message", (event, level, message, line, sourceId) => {
  log.warn(`[RENDERER-CONSOLE] [lvl=${level}] ${message} (${sourceId}:${line})`);
});
```
This means:
**Any `console.error(...)` or `console.warn(...)` executed in the renderer process is automatically redirected by Electron into `toad.log`!**
No extra IPC bridge is required to record error traces into `toad.log` — calling `console.error()` or sending via `getHostBridge().showErrorDialog()` with suppression writes the full error and stack trace cleanly into `toad.log`.

---

## 4. UI Status Badging Investigation

### 4.1 Tracking and Rendering in `ProjectFilesTable.tsx`
File location: `tad-master/packages/tadviewer/src/components/ProjectFilesTable.tsx`.

#### Status Calculation (`getEffectiveStatus`, lines 219–257):
```typescript
  const getEffectiveStatus = (f: ProjectWorkspaceFile): { status: string; percent?: number } => {
    ...
    const item = manager.getItem(key) || manager.getItemByCanonical(canonical);
    if (item) {
      if (item.status === "processing") return { status: "PROCESSING", percent: item.percent };
      if (item.status === "ready") return { status: "READY" };
      if (item.status === "modified") return { status: "MODIFIED" };
      if (item.status === "error") return { status: "ERROR" };
      if (item.status === "pending") return { status: "PENDING" };
    }
    ...
    const rawStatus = (f.status || "READY").toUpperCase();
    return { status: rawStatus };
  };
```

#### Status Badging (`renderStatus`, lines 280–323):
```tsx
  const renderStatus = (status: string, percent?: number) => {
    const s = status.toUpperCase();
    if (s === "PROCESSING") {
      ...
    }
    if (s === "READY" || s === "VALID") {
      return <span className="status-indicator status-ready" title="READY / VALID">🟢</span>;
    }
    if (s === "MODIFIED") {
      return <span className="status-indicator status-modified" title="MODIFIED">🔴</span>;
    }
    if (s === "ERROR") {
      return <span className="status-indicator status-error" title="ERROR">!</span>;
    }
    return <span className="status-indicator status-pending" title="PENDING">◌</span>;
  };
```

### 4.2 Styling in `packages/tadviewer/less/sidebar.less`
Lines 1180–1203:
```less
    .status-indicator {
      display: inline-block;
      font-size: 10px;
      line-height: 1;

      &.status-ready {
        color: #22c55e;
      }
      &.status-modified {
        color: #ef4444;
      }
      &.status-error {
        color: #ef4444;
        font-weight: 700;
      }
      &.status-pending {
        color: #94a3b8;
      }
      &.status-processing {
        color: #0284c7;
        font-weight: 500;
      }
    }
```

### 4.3 Assessment of the `!` Icon
1. **Current State**:
   `ProjectFilesTable.tsx:314` currently renders raw text `!` inside `<span className="status-indicator status-error">`. While it colors red (`#ef4444`), it is a basic text glyph rather than an exclamation mark circle icon.
2. **Optimal BlueprintJS Icon Implementation**:
   `ProjectFilesTable.tsx:3` already imports `Icon` from `@blueprintjs/core`:
   ```tsx
   import { Icon, IconName, Tooltip, Position, Spinner, Intent } from "@blueprintjs/core";
   ```
   In BlueprintJS, `icon="error"` is an exclamation mark inside a filled circle SVG.
   Rendering:
   ```tsx
   if (s === "ERROR") {
     return (
       <span className="status-indicator status-error" title="ERROR: File ingestion failed">
         <Icon icon="error" size={12} style={{ color: "#ef4444" }} />
       </span>
     );
   }
   ```
   This gives a consistent exclamation mark circle icon (`!`), perfectly complementing the 🟢, 🔴, and ◌ circle indicators!

### 4.4 Existing In-App Non-Blocking Error Card (`AppPane.tsx`)
In `packages/tadviewer/src/components/AppPane.tsx:542-554`:
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
Line 536 already advises: *"You can click any other file in the sidebar to analyze it while this dataset continues processing in the background."*
When error handling is properly integrated, failed files display this clean, non-blocking center pane while keeping the entire sidebar interactive.

---

## 5. Gateway Cache Validation & Misparsed Parquet Eviction (R1 / R3)

### 5.1 The Cache Bypass Flaw Explained
In `packages/reltab-fs/src/reltab-fs.ts:261`:
```typescript
  const isCacheHit = cachedPaths
    ? reltabDuckDB.checkParquetCache(targetPath, cachedPaths, forceReopen)
    : false;

  if (isCacheHit && cachedPaths) {
    // MOUNT VIEW DIRECTLY INTO UI ENGINE AND RETURN IMMEDIATELY!
    await reltabDuckDB.createViewFromParquet(uiConn, cachedPaths.parquetPath, tableName);
    return tableName; // <--- Bypasses nativeCSVImport()!
  }
```
In `packages/reltab-duckdb/src/csvimport.ts:3109`, the `isMisparsedDelimiter` logic was placed inside `nativeCSVImport()`.
Because `isCacheHit` evaluates to `true` (source and parquet size/mtime matched), `createViewFromParquet()` was called directly and `nativeCSVImport()` was **never invoked**!

### 5.2 Identified Corrupted & Stale Files on Disk
Direct inspection using PowerShell confirmed two stale cache files:
1. `build/Toad-2.4.6/toadAppData_p486h/temp/ekm8j/sample_40gb_cached_3535af61fe.parquet`: **4,659.22 MB** (Corrupted parquet with `column01..column10` and raw lines in column 0).
2. `releases/toadAppData_uthyw/temp/okgrg/sample_40gb_cached_3535af61fe.tmp_1793688800513.parquet`: **4,654.57 MB** (Stale partial `.tmp_` file).

### 5.3 Stale Temporary File Discovery in `purgeOrphanTempFiles`
In `packages/tad-app/app/portableAppData.ts:774`:
```typescript
export function purgeOrphanTempFiles(tempDir: string): number {
  ...
  const entries = fs.readdirSync(tempDir);
  for (const entry of entries) {
    const isOrphan = entry.endsWith(".tmp") || entry.includes(".tmp_");
    if (isOrphan) {
      ...
    }
  }
}
```
`tempDir` contains project subdirectories (`okgrg`, `ekm8j`, etc.).
Because `fs.readdirSync(tempDir)` only checks the top-level `temp/` folder, it did not recurse into subdirectories. Stale `.tmp_*.parquet` files inside project subfolders remained untouched across sessions.
*Fix recommendation*: Recursively walk `tempDir` or check subdirectories when scanning for `.tmp` / `.tmp_` files.

---

## 6. Build Tooling & Workspace Governance (R5)

### 6.1 FastBuild Script (`fastbuild.ps1`)
`fastbuild.ps1` builds in ~4 stages:
1. TypeScript compilation:
   - `packages/host-bridge` (`npm run build`)
   - `packages/reltab-duckdb` (`npm run build`)
   - `packages/tadviewer` (`npm run build-prod` or `build-dev`)
2. `packages/tad-app` Webpack bundles (`npm run build-prod` or `build-dev`).
3. `electron-builder --dir` (`npm run pack` -> `win-unpacked`).
4. Deployment to `build/Toad-<version>/Toad.exe` and `build/latest` junction.

### 6.2 Testing Suite (`tests/deep_integration_qa.js`)
- Executable via standalone Node: `.\node-v18.20.4-win-x64\node.exe tests\deep_integration_qa.js`.
- Contains 50+ end-to-end integration test suites:
  - Cache validation (`checkDoubleValidCache`, `ToadParquetLedger`).
  - Worker crash isolation (`ingestWorker.js`).
  - Version synchronization across package files.

### 6.3 Versioning & Binary Storage Compliance (`AGENTS.md`)
- **Version Bumping**: When fixing bugs without a specific version target, use `node tools/bump_version.js patch` to automatically increment to the 4th digit (e.g. `2.4.6.1`).
- **Zero-Duplicate Storage Policy**: Never duplicate binaries across version names. Canonical binaries are:
  - Development/Testing: `Toad.exe` (root) or `build/Toad-<version>/Toad.exe`.
  - Releases: `releases/Toad-<version>-x64-portable.exe` and `releases/Toad-<version>-x64-portable.zip`.
  - Prune any stale build/cache duplicates.

---

## 7. Concrete Code Recommendations for Workers

### Recommendation 1: Suppress Pop-Up Dialogs in Main Process
**Target File**: `tad-master/packages/tad-app/app/main.ts`  
**Lines**: 193–195, 488–499

```typescript
// Replace lines 193-195:
ipcMain.handle("errorDialog", (event, arg1, arg2, arg3) => {
  let title = "Error";
  let msg = "";
  let fatal = false;

  if (arg1 && typeof arg1 === "object") {
    title = arg1.title || "Error";
    msg = arg1.message || arg1.msg || "";
    fatal = !!arg1.fatal;
  } else {
    title = arg1 || "Error";
    msg = arg2 || "";
    fatal = !!arg3;
  }

  // Non-blocking: record error trace into toad.log
  log.error(`[NonBlockingError] ${title}: ${msg}`);

  // Only trigger modal dialog if explicitly marked fatal
  if (fatal) {
    dialog.showErrorBox(title, msg);
    app.quit();
  }
});
```

### Recommendation 2: Remove Window Pop-Up Interceptors in Renderer
**Target File**: `tad-master/packages/tad-app/src/electronRenderMain.tsx`  
**Lines**: 13–34

```typescript
if (typeof window !== "undefined") {
  window.addEventListener("error", (e) => {
    // Direct to console.error; appWindow.ts console-message forwards to toad.log
    console.error("[UNCAUGHT-WINDOW-ERROR]", e.message, e.error?.stack);
  });
  window.addEventListener("unhandledrejection", (e) => {
    console.error("[UNCAUGHT-PROMISE-REJECTION]", e.reason?.message, e.reason?.stack);
  });
}
```

### Recommendation 3: Add Exception Boundary in `actions.openDataSourcePath`
**Target File**: `tad-master/packages/tadviewer/src/actions.ts`  
**Lines**: 350–384

```typescript
    try {
      manager.pause();
      await startAppLoadingTimer(stateRef);
      await replaceCurrentView(path, stateRef, viewParams);
      const dv = await waitForDataView(stateRef, 8000);
      ...
    } catch (err: any) {
      console.error(`[Actions] Error opening dataset (${fileName}):`, err?.stack || err);

      // 1. Mark error in MultipleLoadingManager
      manager.markError(path, err?.message || String(err));

      // 2. Set activeLoadingFile to non-blocking error display in center pane
      setActiveLoadingFile(
        {
          isLoading: false,
          fileName,
          dsPath: path,
          percent: 0,
          error: err?.message || String(err),
        },
        stateRef
      );
    } finally {
      stopAppLoadingTimer(stateRef);
      const cur = mutableGet(stateRef).activeLoadingFile;
      if (!cur?.error) {
        setActiveLoadingFile(null, stateRef);
      }
      manager.resume();
    }
```

### Recommendation 4: Enhance `MultipleLoadingManager.markError` & Sibling Synchronization
**Target File**: `tad-master/packages/tadviewer/src/MultipleLoadingManager.ts`  
**Lines**: 911–945

```typescript
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      console.error(`[MultipleLoading] Ingestion failed for ${processingItem.fileName}:`, err?.stack || err);

      const errorItem: FileIngestItem = {
        ...processingItem,
        status: "error",
        error: errMsg,
        version: (processingItem.version || 0) + 1,
      };
      this.files.set(errorItem.key, errorItem);

      // Synchronize to all sibling keys for the same physical file
      if (siblingKeys) {
        for (const sKey of siblingKeys) {
          const sib = this.files.get(sKey);
          if (sib) {
            this.files.set(sKey, {
              ...sib,
              status: "error",
              error: errMsg,
              version: (sib.version || 0) + 1,
            });
          }
        }
      }

      this.activeItems.delete(processingItem.key);
      this.notify();

      // If user was waiting on this file, show the non-blocking error card in center pane
      if (this.stateRef) {
        const appState = mutableGet(this.stateRef);
        if (
          appState.activeLoadingFile?.fileName.toLowerCase() ===
          (processingItem.fileName || "").toLowerCase()
        ) {
          getActions().setActiveLoadingFile(
            {
              isLoading: false,
              fileName: processingItem.fileName,
              dsPath: processingItem.dsPath,
              percent: 0,
              error: errMsg,
            },
            this.stateRef
          );
        }
      }

      setTimeout(() => this.checkAndProcessQueue(), 50);
    }
```

### Recommendation 5: Render Exclamation Mark Circle Icon in `ProjectFilesTable.tsx`
**Target File**: `tad-master/packages/tadviewer/src/components/ProjectFilesTable.tsx`  
**Lines**: 311–316

```tsx
    if (s === "ERROR") {
      return (
        <span
          className="status-indicator status-error"
          title="ERROR: File ingestion failed"
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
        >
          <Icon icon="error" size={12} style={{ color: "#ef4444" }} />
        </span>
      );
    }
```

### Recommendation 6: Move `isMisparsedDelimiter` Cache Eviction to `reltab-fs.ts` Gateway
**Target File**: `tad-master/packages/reltab-fs/src/reltab-fs.ts`  
**Lines**: 268–285

```typescript
    if (isCacheHit && cachedPaths) {
      const extName = path.extname(targetPath).toLowerCase();
      const baseName = path.basename(targetPath, extName);
      const tableName = importInfo?.tableName || reltabDuckDB.genTableName(baseName);

      let uiConn: any = null;
      let cacheValid = true;
      try {
        uiConn = await this.dbc.connPool.take();
        await reltabDuckDB.createViewFromParquet(
          uiConn,
          cachedPaths.parquetPath,
          tableName
        );

        // Gateway Schema Check: Evict misparsed cache on open
        if (extName === ".csv") {
          const cols: any = await uiConn.all(`DESCRIBE ${tableName}`);
          const firstColName = (cols[0]?.column_name || "").replace(/^\uFEFF/, "");
          const isOneColRawEvent = cols.length === 1 && firstColName === "raw_event";
          const isMisparsedDelimiter = firstColName.includes(",") && (cols.length === 1 || cols.some((c: any) => /^column\d+$/i.test(c.column_name)));

          if (isOneColRawEvent || isMisparsedDelimiter) {
            log.warn(`[DualEngine UI] Evicting corrupted cache for ${targetPath}`);
            await uiConn.exec(`DROP VIEW IF EXISTS ${tableName}`);
            try {
              if (fs.existsSync(cachedPaths.parquetPath)) {
                fs.unlinkSync(cachedPaths.parquetPath);
              }
            } catch {}
            reltabDuckDB.ToadParquetLedger.getInstance().recordEvent({
              event_id: `evict-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              timestamp: Date.now(),
              source_path: targetPath,
              source_size: 0,
              source_mtime: 0,
              parquet_path: cachedPaths.parquetPath,
              parquet_size: 0,
              row_count: 0,
              status: "DELETED",
              duration_ms: 0,
              extra_json: JSON.stringify({ reason: "evict_misparsed_delimiter_gateway" }),
            }).catch(() => {});
            cacheValid = false;
          }
        }
      } catch (viewErr) {
        log.warn("[DualEngine UI] Loi khi tao VIEW tu Parquet cache:", viewErr);
        cacheValid = false;
      } finally {
        if (uiConn) {
          this.dbc.connPool.giveBack(uiConn);
        }
      }

      if (cacheValid) {
        ...
        return tableName;
      }
      // If cache was invalid/evicted, fall through to nativeCSVImport() below!
    }
```

### Recommendation 7: Enable Recursive Cleanup in `purgeOrphanTempFiles`
**Target File**: `tad-master/packages/tad-app/app/portableAppData.ts`  
**Lines**: 774–805
Ensure `purgeOrphanTempFiles()` checks child project subfolders in `temp/` so that `.tmp_` files in `temp/okgrg/` are automatically purged at startup.
