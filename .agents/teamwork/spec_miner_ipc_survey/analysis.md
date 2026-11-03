# TOAD v2.5.0 IPC Architectural Migration Specification Mining Analysis

**Author**: `spec_miner_ipc_survey` (Specification Miner Subagent)  
**Date**: 2026-11-03  
**Status**: Exhaustive Specification Survey Complete  
**Integrity Mode**: Development / Zero-Regression

---

## 1. Executive Summary & Authoritative Spec Sources

This document provides the exhaustive specification, requirements analysis, architectural blueprints, interface schemas, binary data transfer protocols, crash supervision lifecycle, and verification matrix for the **TOAD v2.5.0 IPC Architectural Migration**.

### Authoritative Document Hierarchy
1. **`ORIGINAL_REQUEST.md`** (`d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`): Primary project mandate, 5 core requirements (R1–R5), and acceptance criteria.
2. **Approved Planning Document** (`c:\Users\huydq\.gemini\antigravity\brain\489b863f-84dc-4fd6-bbfb-142488ba4d23\ke_hoach_chuyen_doi_ipc_utilityprocess.md`): 100% agreed architectural blueprint from `/grill-me` session.
3. **Architecture Specification** (`d:\Shared_UserData\Downloads\tad\docs\FUTURE_KE_HOACH_CHUYEN_DOI_MO_HINH_IPC_UTILITYPROCESS.md`): Technical blueprint for Tauri-like IPC abstraction, `utilityProcess`, MessagePort, and Single Source of Truth Parquet Ledger.
4. **Existing Codebase Baseline** (TOAD v2.4.8.1 in `tad-master`):
   - Host Bridge: `packages/host-bridge/src/` (`IHostBridge.ts`, `V8HostAdapter.ts`, `index.ts`)
   - Electron Shell: `packages/toad-app/app/` (`main.ts`, `appWindow.ts`, `preload.js`, `portableAppData.ts`)
   - Relational Core: `packages/reltab/` (`remote/server.ts`, `Connection.ts`, `Transport.ts`, `TableRep.ts`, `QueryExp.ts`)
   - Database Layer: `packages/reltab-duckdb/` (`reltab-duckdb.ts`, `csvimport.ts`)
   - UI Canvas: `packages/toadviewer/` (`electronRenderMain.tsx`, `AppPane.tsx`, `ProjectWorkspaceManager.ts`, `MultipleLoadingManager.ts`)
   - Test Runner & Packaging: `run_tests.js`, `tests/smoke_test.js`, `tests/deep_integration_qa.js`, `fastbuild.ps1`, `dist_package.ps1`

---

## 2. Requirements Decomposition & Technical Specification

### R1. Version Bumping & Dual-Mode Rollout

#### Version Standard
- **Target Version**: `2.5.0` (SemVer 3-digit versioning).
- **Execution**: Automated synchronization via `node tools/bump_version.js 2.5.0`.
- **Synchronized Targets**:
  - `tad-master/packages/toad-app/package.json` (`version: "2.5.0"`)
  - `tad-master/packages/host-bridge/package.json` (`version: "2.5.0"`)
  - `tad-master/packages/reltab-duckdb/package.json` (`version: "2.5.0"`)
  - `tad-master/packages/toadviewer/package.json` (`version: "2.5.0"`)
  - `tad-master/packages/toadviewer/src/components/RegexDialog.tsx` (version stamp `v2.5.0`)
  - `dist_package.ps1` (regex assertion updated to accept `v2.5.0`)
  - `package_release.ps1` (`$Version = "2.5.0"`)
  - `README.md` (version badge & header update)
  - `releases/HelloKittyXamKinLung.Toad.yaml` (`PackageVersion: 2.5.0`)

#### Dual-Mode Rollout Architecture
- **Configuration Contract**: `config.ini` under `[runtime]` section:
  ```ini
  [runtime]
  engine = utility    # Options: "utility" (default for v2.5.0) | "legacy"
  auto_fallback = true
  ```
- **Runtime Resolution**:
  - `toadPortableEnv.config.runtime.engine`:
    - `"utility"`: Launches Dedicated Engine Service via `utilityProcess.fork("engineService.bundle.js")`, enables Chromium security boundary (`nodeIntegration: false`, `contextIsolation: true`), routes queries over `MessagePort`.
    - `"legacy"`: Falls back to v2.4.x in-process execution model (`nodeIntegration: true`, `contextIsolation: false`, DuckDB running in Main process).
- **3-Phase Incremental Rollout**:
  - **Phase 1**: Host Bridge abstraction (`IHostBridge`, `invokeCmd`, `HeadlessNodeAdapter`), preload hardening (`contextBridge.exposeInMainWorld`).
  - **Phase 2**: Dedicated Engine Service (`engineService.ts` in `utilityProcess`), `MessageChannelMain` routing, `EngineSupervisor`.
  - **Phase 3**: Zero-copy `ArrayBuffer` data protocol over `MessagePort`, instant WAL self-recovery (`toad_ledger.parquet`), UI non-blocking toast in `AppPane.tsx`, Webpack packaging and test automation.

---

### R2. Host Bridge Abstraction & CLI Test Compatibility

#### Interface Contract: `IHostBridge` (`packages/host-bridge/src/IHostBridge.ts`)
```typescript
import { TransportClient } from "reltab";

export type EngineName = "v8" | "tauri" | "utility" | "headless";

export interface IHostBridge extends TransportClient {
  readonly engineName: EngineName;

  // Low-level RPC TransportClient compatibility (reltab RemoteConnection)
  invoke(functionName: string, req: any): Promise<any>;

  // Tauri v2 standard asynchronous invocation signature
  invokeCmd<T = any>(command: string, payload?: Record<string, any>): Promise<T>;

  // Configuration management
  getConfig(): Promise<AppConfigDTO>;

  // Native OS Dialogs
  showOpenDialog(options: OpenDialogOptions): Promise<string[] | null>;
  showSaveDialog(options: SaveDialogOptions): Promise<string | null>;
  showErrorDialog(title: string, message: string, fatal?: boolean): Promise<void>;

  // OS Integration & Clipboard
  openExternal(url: string): Promise<void>;
  copyToClipboard(text: string): void;
  openNewWindow(dsPath: any): Promise<void>;

  // High-Speed Data Port setup
  setupDataPort?(port: MessagePort): void;

  // Engine Lifecycle Supervision Listeners
  onEngineCrash?(listener: (details?: any) => void): () => void;
  onEngineRestored?(listener: () => void): () => void;

  // Pub/Sub Events between Host Shell and UI Canvas
  onEvent<T = any>(channel: string, listener: (data: T) => void): () => void;
  sendEvent(channel: string, payload?: any): void;

  // Theme Management
  setTheme(theme: "light" | "dark"): void;
  getTheme(): "light" | "dark";
}
```

#### Preload Architecture (`packages/toad-app/app/preload.js`)
When `contextIsolation: true`, Renderer execution is sandboxed from Node.js primitives. `preload.js` acts as the secure bridge using `contextBridge`:
```javascript
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("toadBridge", {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  on: (channel, listener) => {
    const wrapped = (event, ...args) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  send: (channel, payload) => ipcRenderer.send(channel, payload),
  onPortHandshake: (callback) => {
    window.addEventListener("message", (event) => {
      if (event.data && event.data.type === "toad-data-port-handshake") {
        callback(event.ports[0]);
      }
    });
  }
});
```

#### CLI Test Compatibility: `HeadlessNodeAdapter` (`packages/host-bridge/src/HeadlessNodeAdapter.ts`)
- **Requirement**: Allow all 168+ test cases across 4 test suites (`run_tests.js --all`: Smoke Test, Deep Integration QA, Preload 3 Pages, Legacy Use Cases) to run in headless Node.js without BrowserWindow.
- **Behavior**:
  - Implements `IHostBridge` with `engineName = "headless"`.
  - Dispatches `invoke` and `invokeCmd` directly to in-process handlers (`reltab` server functions, `DuckDBDriver`, `reltabFS`, `ToadParquetLedger`).
  - Dialog methods return mock data or graceful nulls.
  - Clipboard methods use in-memory buffers.
  - Event listeners use Node.js `EventEmitter`.
  - Zero Electron BrowserWindow or GUI dependencies.

---

### R3. Dedicated Engine Service & Hybrid Data Protocol

#### Engine Service Architecture (`packages/toad-app/app/engineService.ts`)
- Runs as an independent process spawned via `utilityProcess.fork(path.join(__dirname, "engineService.bundle.js"))`.
- Isolated from Chromium Renderer crashes and Main Process event loop blockages.
- Internal responsibilities:
  1. Initializes DuckDB connection pool (`reltab-duckdb`) with `duckdb.node` native binary.
  2. Initializes and replays `ToadParquetLedger` (`toad_ledger.parquet`).
  3. Listens on `process.parentPort` for management messages from Supervisor.
  4. Accepts `port2` (MessagePort) from Supervisor during handshake.
  5. Mounts fast query dispatcher directly onto `port2`.

#### Hybrid Data Protocol Specification
Data transferred across `MessagePort` between Renderer and `engineService` is split into two optimal paths:

```
+--------------------------------------------------------------------------------+
|                             HYBRID DATA PROTOCOL                               |
+------------------------------------+-------------------------------------------+
| (A) Control & Metadata Channel      | (B) High-Speed Table Data Channel         |
| Serialization: JSON DTO            | Serialization: Transferable ArrayBuffer   |
| Use cases:                         | Use cases:                                |
|  - rowCount                        |  - evalQuery (page blocks)                |
|  - getTableSchema                  |  - TableRep binary buffers                |
|  - getTableName                    |  - Columnar Typed Arrays                  |
|  - getColumnStatsMap               |                                           |
| Characteristics:                   | Characteristics:                          |
|  - Highly structured               |  - Zero-Copy ownership transfer           |
|  - Small payload (< 2 KB)          |  - Instant deserialization (< 2ms)        |
|  - Human/Debug-readable JSON       |  - 60 FPS smooth scrolling in SlickGrid   |
+------------------------------------+-------------------------------------------+
```

#### Binary Wire Format for `evalQuery` (Zero-Copy Transferable Buffer):
```
[Offset 0..3]   : Magic Bytes 0x54, 0x4F, 0x41, 0x44 ("TOAD")
[Offset 4..7]   : Protocol Version (uint32, e.g., 1)
[Offset 8..11]  : JSON Header Length N (uint32)
[Offset 12..12+N-1]: JSON Schema & Metadata String (UTF-8 encoded)
                   Contains: { rowCount, columnCount, columns: [{ name, type, kind }] }
[Offset 12+N..] : Binary Columnar / Row Data Block (TypedArray buffers)
```
- Transferred via `port.postMessage(responsePacket, [buffer])`.
- In Renderer: Transferable array buffer is zero-copy mapped into `TableRep` instances in $< 2\text{ ms}$, bypassing V8 string serialization and `JSON.parse` overhead.

---

### R4. Engine Supervisor & Auto-Recovery Protocol

#### Supervisor Architecture (`packages/toad-app/app/engineSupervisor.ts`)
The Main Process acts as the Supervisor for the `utilityProcess` life cycle:
1. **Spawn**: Spawns `engineProcess = utilityProcess.fork(bundlePath, [], { serviceName: "Toad Engine Service" })`.
2. **Channel Creation**: Instantiates `const { port1, port2 } = new MessageChannelMain()`.
3. **Data Channel Handshake**:
   - Sends `port2` to Engine Service: `engineProcess.postMessage({ type: "init-data-channel" }, [port2])`.
   - Sends `port1` to Renderer: `webContents.postMessage("port-handshake", { type: "data-port" }, [port1])`.
4. **Crash Detection & Auto-Restart**:
   - Listens to `engineProcess.on("exit", (code) => { ... })`.
   - If `code !== 0` or process dies unexpectedly:
     - **T0 (0ms)**: Supervisor catches `exit`.
     - **T1 (< 200ms)**: Supervisor re-forks a new `utilityProcess`.
     - **T2 (< 300ms)**: Generates a new `MessageChannelMain`, transfers `port2` to new engine, transfers `port1` to Renderer.
     - **T3 (< 350ms)**: Engine Service re-initializes DuckDB and scans `toad_ledger.parquet`.
     - **T4 (< 355ms)**: Engine restores all active view snapshots via DuckDB Parquet views in $< 5\text{ ms}$.
     - **T5 (< 400ms)**: Supervisor sends `engine-restored` event to Renderer.
     - **Total recovery time**: $< 500\text{ ms}$ (well within SLA).

#### Parquet Ledger WAL Replay Mechanism
- **File**: `toad_ledger.parquet` in local application data directory (`toadAppData_[id]/` or `temp/`).
- **Storage**: Append-only Write-Ahead Log storing:
  `event_id`, `event_type`, `timestamp`, `project_id`, `project_name`, `source_path`, `source_size`, `source_mtime`, `parquet_path`, `parquet_size`, `row_count`, `status`.
- **Replay Logic**:
  - Filter ledger for entries where `status = "READY"` and `parquet_path` exists on disk.
  - Execute DuckDB zero-copy view restoration:
    ```sql
    CREATE OR REPLACE VIEW "<viewName>" AS 
    SELECT * FROM read_parquet('<escapedParquetPath>');
    ```
  - Replay benchmark: $< 5\text{ ms}$ because underlying `.parquet` files are already indexed and valid on disk.

#### UI User Experience & Toast (`packages/toadviewer/src/components/AppPane.tsx`)
- `AppPane.tsx` subscribes to `onEngineRestored` on the host bridge.
- Upon receiving recovery signal:
  - Invokes BlueprintJS `OverlayToaster` (or `Toaster`):
    - **Message**: `"Động cơ phân tích vừa được tự động phục hồi"`
    - **Intent**: `Intent.PRIMARY`
    - **Timeout**: `4000ms`
    - **Position**: Bottom or Bottom-Right.
  - Automatically triggers `actions.reopenCurrentView(stateRef)` so current table view reconciles without requiring a manual window reload (F5).

---

### R5. Packaging, Binary Footprint & VCS Conformance

#### Webpack Configuration (`packages/toad-app/webpack.config.js`)
- Bundle target: `engineService: "./app/engineService.ts"`.
- Output: `dist/engineService.bundle.js`.
- Target: `node` (utilityProcess).
- Externals: `duckdb` (native C++ node binding), `duckdb-async`, `toad-core-rust`, Node built-ins (`fs`, `path`, `os`, `crypto`).
- Sourcemaps: disabled in production (`devtool: false`).

#### Asar Packaging & Native Addons
- `duckdb.node` packed into `app.asar.unpacked`:
  - Verified path: `resources/app.asar.unpacked/node_modules/duckdb/lib/binding/duckdb.node`.
  - Configured in `package.json` under `build.asarUnpack: ["**/*.node"]`.

#### Strict Footprint Budget
- **`app.asar` size**: $< 45\text{ MB}$ (Current baseline: $\approx 16\text{ MB}$).
- **Portable Executable (`Toad.exe`)**: $< 75\text{ MB}$ (Current baseline: $\approx 72\text{ MB}$).
- **Binary De-duplication Policy**:
  - No duplicate versioned binaries (`Toad 2.0.x.exe`, `Toad 2.1.x.exe`) created or copied.
  - Canonical outputs:
    - Root: `Toad.exe`
    - Releases: `releases/Toad-2.5.0-x64-portable.exe` and `releases/Toad-2.5.0-x64-portable.zip`.

#### Version Control Conformance (Jujutsu `jj`)
- Local VCS default is Jujutsu (`jj`), colocated with git.
- All intermediate build artifacts (`build/`, `dist/`, `release/`, `node_modules/`, `*.exe`, `*.zip`) strictly excluded via `.gitignore`.
- Clean commit tracking using `jj describe`.

---

## 3. Architecture Blueprints & Sequence Diagrams

### 3.1. System Initialization & Port Handshake Sequence

```
UI Canvas (Renderer)      preload.js (Bridge)        Main (Supervisor)        Engine (utilityProcess)
       |                          |                          |                          |
       |                          |                          |--- utilityProcess.fork()->| (Spawns engineService)
       |                          |                          |                          |
       |                          |                          |--- new MessageChannelMain()
       |                          |                          |    (port1, port2)        |
       |                          |                          |                          |
       |                          |                          |-- postMessage(port2) --->| (Stores port2)
       |                          |                          |                          |
       |                          |<-- postMessage(port1) ---|                          |
       |                          |    (port-handshake)      |                          |
       |<-- onPortHandshake(port1)|                          |                          |
       |                          |                          |                          |
       |========================== DIRECT MESSAGEPORT LINK ESTABLISHED =================|
       |                                                                                |
```

### 3.2. Direct High-Speed Query Flow (Zero-Copy)

```
UI Canvas (Renderer)              Direct MessagePort                Engine Service (DuckDB)
       |                                   |                                   |
       |-- invoke("evalQuery", queryReq) ->|                                   |
       |                                   |---------------------------------->| Executes DuckDB query
       |                                   |                                   | Serializes to TableRep
       |                                   |                                   | Allocates Transferable ArrayBuffer
       |                                   |<-- postMessage(meta, [buffer]) ---|
       |<-- Reconstitutes TableRep (<2ms) -|
       |
```

### 3.3. Crash Supervision & Auto-Recovery Sequence

```
UI Canvas (Renderer)      preload.js (Bridge)        Main (Supervisor)        Engine (utilityProcess)
       |                          |                          |                          |
       |                          |                          |                          x [CRASH: OOM / Native Segfault]
       |                          |                          |<-- 'exit' (code != 0) ---|
       |                          |                          |                          |
       |                          |                          |-- [Timer: 0ms]           |
       |                          |                          |-- Fork new utilityProcess|---> Spawns new engine
       |                          |                          |-- Create MessageChannel  |
       |                          |                          |-- Transfer port2 ------->|-- Read toad_ledger.parquet
       |                          |                          |                          |-- Recreate views (< 5ms)
       |                          |<-- 'engine-reconnected' -|                          |
       |                          |    (new port1)           |                          |
       |<-- onEngineRestored() ---|                          |                          |
       |-- Toast: "Động cơ phân tích vừa được tự động phục hồi"                         |
       |-- Automatic reopenCurrentView()                                                |
       |-- Table view seamlessly restored (< 500ms total elapsed)                       |
```

---

## 4. Comprehensive IPC Command Dictionary

### 4.1. High-Speed Data Commands (over MessagePort to `engineService`)

| # | Command Name | Request Payload Schema | Return Structure | Error Handling | Purpose |
|---|--------------|------------------------|------------------|----------------|---------|
| 1 | `DataSourceConnection.evalQuery` / `evalQuery` | `{ engine: DataSourceId, queryStr: string, offset?: number, limit?: number, options?: EvalQueryOptions }` | Hybrid Packet: Schema JSON metadata + zero-copy `ArrayBuffer` data block | `{ status: "Err", errVal: SerializedError }` | Execute relational query AST with pagination and zero-copy transfer |
| 2 | `DataSourceConnection.rowCount` / `rowCount` | `{ engine: DataSourceId, queryStr: string, options?: EvalQueryOptions }` | `{ status: "Ok", value: number }` | `{ status: "Err", errVal: SerializedError }` | Get total row count matching query expression |
| 3 | `DataSourceConnection.getTableName` / `getTableName` | `{ engine: DataSourceId, path: DataSourcePath, forceReopen?: boolean, isBackground?: boolean }` | `{ status: "Ok", value: string }` | `{ status: "Err", errVal: SerializedError }` | Get or register DuckDB view/table name for source path |
| 4 | `DataSourceConnection.getTableSchema` / `getTableSchema` | `{ engine: DataSourceId, tableName: string }` | `{ status: "Ok", value: SchemaDTO }` | `{ status: "Err", errVal: SerializedError }` | Retrieve typed column schema for table |
| 5 | `DataSourceConnection.getColumnStatsMap` / `getColumnStatsMap` | `{ engine: DataSourceId, queryStr: string }` | `{ status: "Ok", value: ColumnStatsMapDTO }` | `{ status: "Err", errVal: SerializedError }` | Get summary stats (min, max, distinct, nulls) for columns |
| 6 | `DataSourceConnection.getRootNode` / `getRootNode` | `{ engine: DataSourceId }` | `{ status: "Ok", value: DataSourceNodeDTO }` | `{ status: "Err", errVal: SerializedError }` | Get root database container node |
| 7 | `DataSourceConnection.getChildren` / `getChildren` | `{ engine: DataSourceId, path: DataSourcePath }` | `{ status: "Ok", value: DataSourceNodeDTO[] }` | `{ status: "Err", errVal: SerializedError }` | List child tables / views in data source |
| 8 | `DataSourceConnection.runSqlQuery` / `runSqlQuery` | `{ engine: DataSourceId, sqlQuery: string }` | `{ status: "Ok", value: Row[] }` | `{ status: "Err", errVal: SerializedError }` | Run direct raw SQL query on DuckDB instance |
| 9 | `getDataSources` | `{}` | `{ status: "Ok", value: { dataSourceIds: DataSourceId[] } }` | `{ status: "Err", errVal: SerializedError }` | List all registered data source IDs |

### 4.2. Management Commands (Main Process IPC `invoke`)

| # | Command Name | Request Payload Schema | Return Structure | Error Handling | Purpose |
|---|--------------|------------------------|------------------|----------------|---------|
| 10 | `initMain` | `{ "show-queries"?: boolean }` | `void` | Logged and propagated | Initialize main process logging and options |
| 11 | `getToadConfig` | `{}` | `AppConfigDTO` | Fallbacks to default config if missing | Retrieve active portable configuration (`config.ini`) |
| 12 | `dialog:showOpenDialog` | `OpenDialogOptions` (`{ title?, defaultPath?, filters?, directory?, multiple? }`) | `string[] \| null` | Returns null on cancel/error | Display native OS file or directory picker |
| 13 | `dialog:showSaveDialog` | `SaveDialogOptions` (`{ title?, defaultPath?, filters? }`) | `string \| null` | Returns null on cancel/error | Display native OS file save dialog |
| 14 | `errorDialog` | `{ title: string, message: string, fatal?: boolean }` | `void` | Fallbacks to console error | Show native OS modal error dialog |
| 15 | `newWindowFromDSPath` | `DataSourcePath` | `void` | Throws error if window creation fails | Open a new BrowserWindow viewing target datasource |
| 16 | `project:getWorkspace` | `{}` | `ProjectWorkspaceDTO` | Returns default empty workspace | Retrieve active project and all project metadata |
| 17 | `project:getFiles` | `{ projectId: string }` | `ProjectWorkspaceFile[]` | Returns empty array if project not found | List files assigned to specified project |
| 18 | `project:create` | `{ projectName: string }` | `ProjectInfo` | Throws on disk/ledger write error | Create a new isolated project in workspace |
| 19 | `project:rename` | `{ projectId: string, newName: string }` | `boolean` | Throws if project missing or name collision | Rename project metadata in `toad_ledger.parquet` |
| 20 | `project:delete` | `{ projectId: string }` | `boolean` | Throws on error | Tombstone project in `toad_ledger.parquet` |
| 21 | `project:deleteAll` | `{}` | `boolean` | Throws on error | Purge all project workspaces and reset ledger |
| 22 | `project:getCacheSize` | `{ projectId: string }` | `{ totalBytes: number, fileCount: number }` | Returns 0s if empty | Calculate disk cache footprint for project |
| 23 | `project:purgeCache` | `{ projectId: string }` | `boolean` | Throws on error | Purge transient Parquet cache for project |
| 24 | `project:removeFile` | `{ projectId: string, filePath: string }` | `boolean` | Throws on error | Remove file from project and tombstone in ledger |
| 25 | `project:addFiles` | `{ projectId: string, filePaths: string[] }` | `boolean` | Throws on error | Add multiple files to project |
| 26 | `project:addFolder` | `{ projectId: string, folderPath: string }` | `boolean` | Throws on error | Recursively scan and add folder files to project |
| 27 | `project:moveOrphanFiles` | `{ targetProjectId: string }` | `boolean` | Throws on error | Move orphan/legacy files into a target project |
| 28 | `project:setActive` | `{ projectId: string }` | `boolean` | Throws on error | Set active project in workspace session |
| 29 | `project:reconcile` | `{}` | `StartupReconciliationResult` | Throws on error | Trigger WAL startup reconciliation pass |
| 30 | `engine:status` | `{}` | `{ state: "running" \| "restarting" \| "crashed", pid: number, uptime: number }` | Fallbacks to default | Report engine service health and PID |
| 31 | `engine:restart` | `{ force?: boolean }` | `{ success: boolean }` | Throws on failure | Manually trigger engine restart via supervisor |

---

## 5. Features Discovered Table

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Rollout | Version Bumping to 2.5.0 | Increment version across 9 project files to 2.5.0 | Version string `2.5.0` | Updated `package.json`, `RegexDialog`, ps1 scripts | Script exits with code 1 if version invalid | ORIGINAL_REQUEST.md & `tools/bump_version.js` |
| 2 | Rollout | Dual-Mode Engine Feature Flag | Toggles between dedicated `utilityProcess` and legacy in-process engine | `config.ini` `[runtime] engine = "utility" \| "legacy"` | Conditional `webPreferences` and backend spawn | Defaults to `"utility"`, auto-fallbacks to `"legacy"` if unsupported | Plan doc §2 & `appWindow.ts` |
| 3 | Host Bridge | Tauri-Standard `invokeCmd` | Extends `IHostBridge` with Tauri v2 asynchronous command invoke signature | `command: string, payload?: Record<string, any>` | `Promise<T>` | Rejects promise with structured error | Architecture doc §5 & `IHostBridge.ts` |
| 4 | Host Bridge | Sandboxed Preload Bridge | Exposes `window.toadBridge` safely without leaking raw Node/Electron APIs | `channel`, `payload` | Bridge API on `window` | Throws if called when contextBridge uninitialized | Plan doc §4 & `preload.js` |
| 5 | Host Bridge | `HeadlessNodeAdapter` | Node.js adapter implementing `IHostBridge` for test runners without BrowserWindow | Method calls, queries | Promises resolved via in-process drivers | Rejects with deserialized error | Plan doc §4 & `run_tests.js` |
| 6 | Engine Service | Dedicated Electron `utilityProcess` | Isolates DuckDB Driver, Parquet Ledger and ingestion from Main and Renderer | Fork script `engineService.bundle.js` | Child process with isolated memory | Main Supervisor catches crash on `exit` event | Architecture doc §2 & `engineService.ts` |
| 7 | Data Protocol | Direct MessagePort Data Channel | High-speed point-to-point data link connecting Renderer and Engine Service | `port1`, `port2` via `MessageChannelMain` | MessagePort instance | Reconnection protocol on port closure | Architecture doc §2 & Plan doc §3 |
| 8 | Data Protocol | Zero-Copy Transferable `ArrayBuffer` | Transfers tabular binary blocks without JSON string serialization | Query AST, page offset/limit | Transferable `ArrayBuffer` with Schema header | Returns error response packet if query invalid | Architecture doc §2 & `TableRep.ts` |
| 9 | Supervision | Process Supervisor (`engineSupervisor.ts`) | Main process supervisor managing `utilityProcess` lifecycle and auto-recovery | Process exit signal, crash code | Fork restart, new MessageChannel handshake | Triggers retry loop with backoff if spawn fails | Plan doc §4 & `engineSupervisor.ts` |
| 10 | Recovery | Parquet Ledger State Restoration | Replays `toad_ledger.parquet` WAL snapshots into DuckDB in $< 5\text{ ms}$ | `toad_ledger.parquet` WAL | DuckDB view registrations | Recreates clean 0-row ledger if corrupted | Plan doc §4 & `csvimport.ts` |
| 11 | UI / UX | Non-blocking Recovery Toast | Displays BlueprintJS toast notification and automatically refreshes view | `engine-restored` event | Toast notification in `AppPane.tsx` + `reopenCurrentView` | Graceful fallback if toast cannot mount | Plan doc §4 & `AppPane.tsx` |
| 12 | Packaging | Webpack `engineService` Bundle | Bundles engine service entrypoint for Node/utility target | `engineService.ts` source | `dist/engineService.bundle.js` | Webpack build fails if imports unresolved | Plan doc §4 & `webpack.config.js` |
| 13 | Packaging | Asar Unpack for `duckdb.node` | Extracts native C++ DuckDB binding to `app.asar.unpacked` | Native addon binaries | Unpacked binary on disk | Assertion error in `dist_package.ps1` if missing | `package.json` & `dist_package.ps1` |
| 14 | Packaging | Footprint Guard Gates | Enforces `< 45MB` for `app.asar` and `< 75MB` for portable `.exe` | Packaged binaries | File size validation | Build script throws gate error if budget exceeded | `dist_package.ps1` lines 76-96 |
| 15 | VCS | Jujutsu (`jj`) Version Control | Manages local commits and enforces zero-duplicate binary policy | `jj commit`, `jj status` | Clean colocated git commits | Working copy cleanly tracked | AGENTS.md & Workspace rules |

---

## 6. Edge Cases & Boundary Conditions

| # | Feature | Input / Trigger | Observed / Specified Behavior |
|---|---------|-----------------|-------------------------------|
| 1 | Crash Supervision | `process.kill(enginePid, "SIGKILL")` | Main supervisor detects exit code != 0, triggers auto-restart within $< 500\text{ ms}$, creates new MessagePort pair, pushes port1 to Renderer, and replays Parquet ledger views in $< 5\text{ ms}$. |
| 2 | Crash Supervision | Rapid sequential crashes (flapping engine) | Supervisor counts restart attempts within 10s window; if restarts exceed 5 within 10s, displays fatal error dialog rather than looping infinitely. |
| 3 | Dual-Mode Rollout | `config.ini` has `runtime.engine = "legacy"` | `appWindow.ts` sets `nodeIntegration: true`, `contextIsolation: false`, bypasses `utilityProcess.fork`, and initializes DuckDB directly in Main process (100% backwards compatibility). |
| 4 | Dual-Mode Rollout | `config.ini` is missing or corrupted | System auto-heals `config.ini`, defaults to `runtime.engine = "utility"`, and logs warning. |
| 5 | MessagePort Handshake | Renderer reloads (F5) while engine is running | `BrowserWindow` re-triggers preload handshake; Supervisor issues new `port1` to reloaded webContents without restarting `utilityProcess`. |
| 6 | Zero-Copy Transfer | Query returns 0 rows (empty table or filter mismatch) | Engine sends valid binary packet with Schema header and empty data payload (0 bytes); Renderer reconstructs empty `TableRep` without crashing. |
| 7 | Zero-Copy Transfer | Query returns massive result (> 500,000 rows without limit) | Query is clamped to `pageSize` (default 1,000 rows) or streams partitioned blocks; transferable buffer avoids V8 heap exhaustion and UI thread lockup. |
| 8 | WAL Restoration | `toad_ledger.parquet` contains references to files deleted from disk | Startup reconciliation detects missing physical source files, marks status as `DELETED` in ledger, and skips view registration without error. |
| 9 | WAL Restoration | `toad_ledger.parquet` is corrupted (truncated byte stream) | Double-validation detects invalid Parquet header, recovers from in-memory snapshot or resets ledger to 0 rows via `WHERE 1 = 0`. |
| 10 | Headless CLI Tests | Test suites run in environment where `window` is undefined | `HeadlessNodeAdapter` intercepts all calls, bypasses `window.toadBridge` checks, and executes against Node.js driver directly (100% test pass rate). |
| 11 | Packaging | `app.asar` size exceeds 45.0 MB | `dist_package.ps1` size gate triggers exception: `FOOTPRINT GATE ERROR: app.asar size exceeds 45.0 MB threshold!` and halts release. |
| 12 | Packaging | Portable exe exceeds 75.0 MB | `dist_package.ps1` size gate triggers exception: `FOOTPRINT GATE ERROR: Portable exe exceeds 75.0 MB threshold!` and halts release. |

---

## 7. Verification Plan & Test Automation Matrix

| Acceptance Criterion | Verification Method | Command | Expected Outcome |
|----------------------|---------------------|---------|------------------|
| AC1: All Test Suites Pass | Unified Test Runner | `node run_tests.js --all` | 100% PASS across Smoke Test (6), Deep Integration QA (133), Preload 3 Pages (10), Legacy Use Cases (19) — total 168+ tests. |
| AC2: Headless Engine Service | Dedicated MessagePort Test Suite | `node tests/test_engine_service.js` | 1,000 sequential and concurrent queries over MessagePort with verified data integrity and latency $< 2\text{ ms}$. |
| AC3: Crash Resilience & WAL Replay | Simulation Test Suite | `node tests/test_engine_crash_recovery.js` | Kills `utilityProcess` with SIGKILL; asserts restart $< 500\text{ ms}$, view restore $< 5\text{ ms}$, and UI event delivery. |
| AC4: FastBuild Compilation | PowerShell FastBuild Script | `.\fastbuild.ps1` | Compiles `engineService.bundle.js`, `main.bundle.js`, and `toadapp.bundle.js`; unpacks to `build/Toad-2.5.0/Toad.exe`. |
| AC5: Production Packaging & Footprint | Packaging Verification Script | `.\dist_package.ps1` | Produces `releases/Toad-2.5.0-x64-portable.exe` ($< 75\text{ MB}$) and `app.asar` ($< 45\text{ MB}$) with `duckdb.node` unpacked. Zero duplicate binaries. |
| AC6: Dual-Mode Feature Flag | End-to-End Config Toggle | `node -e "..."` & launch tests | Verifies switching between `runtime.engine = "utility"` and `runtime.engine = "legacy"` toggles `contextIsolation` cleanly. |
