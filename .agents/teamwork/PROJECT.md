# Project: TOAD v2.5.0 IPC Architectural Migration

## Architecture
- **Renderer Process**: Runs with `contextIsolation: true` and `nodeIntegration: false`. Accesses backend exclusively via `window.toadBridge.invoke(command, payload)` and receives direct `MessagePort` data channel from Main.
- **Preload Script (`packages/toad-app/app/preload.js`)**: Bridges `openParams`, `toadBridge.invoke()`, and forwards `MessagePort` from Main process to Renderer window via `window.postMessage`.
- **Host Bridge Layer (`packages/host-bridge/`)**:
  - `IHostBridge.ts`: Interface declaring `invoke(cmd, payload)`, dialogs, clipboard, and engine status events.
  - `V8HostAdapter.ts`: Consumes `window.toadBridge` in Electron renderer.
  - `HeadlessNodeAdapter.ts`: In-process/worker-thread bridge for headless Node.js CLI test runners (`run_tests.js`).
- **Main Process Supervisor (`packages/toad-app/app/engineSupervisor.ts`)**:
  - Spawns `engineService` via `utilityProcess.fork()`.
  - Creates `MessageChannelMain`, transfers `port1` to Renderer webContents and `port2` to `engineService`.
  - Monitors child lifecycle (`exit` event, heartbeat ping/pong).
  - Auto-restarts child process in < 500ms on unexpected exit, triggers view replay from `toad_ledger.parquet` in < 5ms, and notifies Renderer via `engine:restored`.
- **Dedicated Engine Service (`packages/backend/src/engineService.ts`)**:
  - Runs in Electron `utilityProcess`.
  - Manages DuckDB connection pool, Parquet Write-Ahead Ledger (`toad_ledger.parquet`), and data ingestion.
  - Implements **Hybrid Data Protocol**: JSON for metadata/schema/rowCount + zero-copy Transferable `ArrayBuffer` for table data blocks.
- **Dual-Mode Engine Flag**: `runtime.engine = "utility" | "legacy"` in `config.ini` and `portableAppData.ts`, allowing instant fallback.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | R1.1 Version Bump to v2.5.0 | Bump SemVer to `2.5.0` via `node tools/bump_version.js 2.5.0` across 9 project metadata files | M1 | ORIGINAL_REQUEST.md |
| 2 | R1.2 Dual-Mode Engine Configuration | Add `[runtime] engine = utility | legacy` in `portableAppData.ts` & `config.ini` | M1 | ORIGINAL_REQUEST.md |
| 3 | R2.1 Host Bridge Standardization | Standardize `IHostBridge` with `invoke(cmd, payload)` and update `V8HostAdapter.ts` | M1 | ORIGINAL_REQUEST.md |
| 4 | R2.2 Preload contextBridge Exposure | Enable `contextIsolation: true` / `nodeIntegration: false` in `appWindow.ts` and expose `window.toadBridge` in `preload.js` | M1 | ORIGINAL_REQUEST.md |
| 5 | R2.3 HeadlessNodeAdapter | Implement `HeadlessNodeAdapter` in `packages/host-bridge` ensuring 100% pass for all 168+ CLI tests | M1 | ORIGINAL_REQUEST.md |
| 6 | R3.1 Engine Service Utility Process | Implement `packages/backend/src/engineService.ts` executing on Electron `utilityProcess` with DuckDB & Parquet WAL | M2 | ORIGINAL_REQUEST.md |
| 7 | R3.2 Hybrid Data Protocol | Implement JSON metadata + zero-copy transferable `ArrayBuffer` table data blocks over MessagePort | M2 | ORIGINAL_REQUEST.md |
| 8 | R4.1 Engine Supervisor in Main | Implement `packages/toad-app/app/engineSupervisor.ts` for lifecycle management, heartbeat & MessagePort pairing | M3 | ORIGINAL_REQUEST.md |
| 9 | R4.2 Crash Supervision & Auto-Restart | Auto-restart `utilityProcess` in < 500ms upon unexpected exit (SIGSEGV, OOM, exit != 0) | M3 | ORIGINAL_REQUEST.md |
| 10 | R4.3 Instant Parquet State Recovery | Re-register views from `toad_ledger.parquet` in < 5ms via `CREATE VIEW ... AS SELECT * FROM parquet_scan(...)` | M3 | ORIGINAL_REQUEST.md |
| 11 | R4.4 Self-Healing UI Toast | Display BlueprintJS toast *"Động cơ phân tích vừa được tự động phục hồi"* and re-query active view in `AppPane.tsx` | M3 | ORIGINAL_REQUEST.md |
| 12 | R5.1 Webpack Bundle for Engine Service | Configure Webpack with `target: "node"` to compile `engineService.bundle.js` with node externals | M4 | ORIGINAL_REQUEST.md |
| 13 | R5.2 Native Binary & Packaging Gates | Pack `duckdb.node` in `app.asar.unpacked`, verify `app.asar` < 45 MB, portable exe < 75 MB, zero duplicate binaries | M4 | ORIGINAL_REQUEST.md |
| 14 | R5.3 Headless Engine Service Test Suite | Implement `tests/test_engine_service.js` executing 1,000 queries over MessagePort with verified data integrity | M5 | ORIGINAL_REQUEST.md |
| 15 | R5.4 Crash Resilience Test Suite | Implement `tests/test_engine_crash_recovery.js` asserting < 500ms restart and state recovery | M5 | ORIGINAL_REQUEST.md |
| 16 | R5.5 Unified Test Suite Execution | Execute `node run_tests.js --all` verifying 100% pass across Smoke, Deep QA, Preload 3 Pages, Legacy Use Cases | M5 | ORIGINAL_REQUEST.md |
| 17 | R5.6 FastBuild & Release Verification | Execute `fastbuild.ps1` and verify packaging scripts generate canonical portable release | M5 | ORIGINAL_REQUEST.md |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Version Bump, Dual-Mode & Host Bridge Abstraction | R1.1, R1.2, R2.1, R2.2, R2.3 (`bump_version.js`, `IHostBridge`, `HeadlessNodeAdapter`, `preload.js`, `appWindow.ts`) | Survey | DONE |
| M2 | Dedicated Engine Service & Hybrid Data Protocol | R3.1, R3.2 (`engineService.ts`, hybrid MessagePort protocol, zero-copy `ArrayBuffer` transfer) | M1 | DONE |
| M3 | Engine Supervisor, Crash Recovery & AppPane Toast | R4.1, R4.2, R4.3, R4.4 (`engineSupervisor.ts`, <500ms restart, Parquet replay, `AppPane.tsx` toast) | M2 | DONE |
| M4 | Webpack Bundling, Packaging & Size Conformance | R5.1, R5.2 (`webpack.config.js`, `engineService.bundle.js`, `dist_package.ps1`, asar < 45MB) | M2, M3 | DONE |
| M5 | Comprehensive Verification & Dual-Track E2E QA | R5.3, R5.4, R5.5, R5.6 (1,000 query test, crash recovery test, 168+ CLI tests, fastbuild) | M1, M2, M3, M4 | DONE |

## Code Layout & Write Boundaries
- **M1 Worker**:
  - `tools/bump_version.js`
  - `tad-master/packages/toad-app/app/portableAppData.ts`
  - `tad-master/packages/toad-app/app/appWindow.ts`
  - `tad-master/packages/toad-app/app/preload.js`
  - `tad-master/packages/host-bridge/src/IHostBridge.ts`
  - `tad-master/packages/host-bridge/src/V8HostAdapter.ts`
  - `tad-master/packages/host-bridge/src/HeadlessNodeAdapter.ts` (NEW)
  - `tad-master/packages/host-bridge/src/index.ts`
- **M2 Worker**:
  - `tad-master/packages/backend/src/engineService.ts` (NEW) or `tad-master/packages/reltab/src/remote/engineService.ts`
  - `tad-master/packages/reltab/src/remote/hybridProtocol.ts` (NEW)
  - `tad-master/packages/reltab/src/remote/server.ts`
  - `tad-master/packages/reltab/src/remote/Connection.ts`
- **M3 Worker**:
  - `tad-master/packages/toad-app/app/engineSupervisor.ts` (NEW)
  - `tad-master/packages/toad-app/app/main.ts`
  - `tad-master/packages/toad-app/src/electronRenderMain.tsx`
  - `tad-master/packages/toadviewer/src/components/AppPane.tsx`
- **M4 Worker**:
  - `tad-master/packages/toad-app/webpack.config.js`
  - `package.json` & `tad-master/packages/toad-app/package.json`
  - `fastbuild.ps1`, `dist_package.ps1`
- **M5 Worker**:
  - `tests/test_engine_service.js` (NEW)
  - `tests/test_engine_crash_recovery.js` (NEW)
  - `run_tests.js`
  - `tests/deep_integration_qa.js`

## Interface Contracts
### 1. `window.toadBridge.invoke(command, payload)`
```typescript
export interface IHostBridge {
  engineName: "utility" | "legacy" | "v8" | "headless";
  invoke(functionName: string, req: any): Promise<any>;
  invokeCmd<T = any>(command: string, payload?: any): Promise<T>;
  onEvent(event: string, callback: (...args: any[]) => void): () => void;
  onEngineRestored?(callback: () => void): () => void;
}
```

### 2. Hybrid Data Protocol Wire Format (MessagePort)
- **Request**:
```typescript
interface EngineQueryReq {
  id: number;
  cmd: "evalQuery" | "rowCount" | "getTableSchema" | "runSqlQuery" | "initLedger";
  payload: any;
}
```
- **Response**:
  - Metadata / Small JSON:
    `{ id: number, ok: true, data: { schema: Schema, rowCount: number } }`
  - Large Table Block:
    `{ id: number, ok: true, binary: true, metadata: TableMeta }`
    Transfer List: `[tableBuffer.buffer]` (Zero-copy Transferable ArrayBuffer)

### 3. Supervisor Restored Event
```typescript
// Main -> Renderer via webContents.send or MessagePort
{ type: "engine:restored", timestamp: number, restoredViewsCount: number }
```
In `AppPane.tsx`:
```typescript
AppToaster.show({
  message: "Động cơ phân tích vừa được tự động phục hồi",
  intent: Intent.SUCCESS,
  icon: "refresh",
  timeout: 4000
});
```
