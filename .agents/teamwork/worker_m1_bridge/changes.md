# Milestone 1: Bridge & Config Foundation Implementation Report

**Agent**: `worker_m1_bridge`  
**Milestone**: Milestone 1 (M1 - Version Bump, Dual-Mode & Host Bridge Abstraction)  
**Date**: 2026-11-03  
**Status**: Completed & Verified  

---

## 1. Summary of Changes

Milestone 1 establishes the structural foundation for the TOAD v2.5.0 IPC architectural migration, decoupling the Chromium Renderer from direct Node.js execution, enabling `contextIsolation: true`, and standardizing IPC through a Tauri-like Host Bridge interface.

### 1.1 Version Bumping to 2.5.0
- Executed `node tools/bump_version.js 2.5.0` using the workspace Node runtime (`node-v18.20.4-win-x64\node.exe`).
- Synchronized all 9 required metadata files to SemVer `2.5.0`:
  1. `tad-master/packages/toad-app/package.json` -> `version: "2.5.0"`
  2. `tad-master/packages/host-bridge/package.json` -> `version: "2.5.0"`
  3. `tad-master/packages/reltab-duckdb/package.json` -> `version: "2.5.0"`
  4. `tad-master/packages/toadviewer/package.json` -> `version: "2.5.0"`
  5. `tad-master/packages/toadviewer/src/components/RegexDialog.tsx` -> Header badge updated to `v2.5.0`
  6. `dist_package.ps1` -> Assertions updated to accept `Toad-2.5.0-x64-portable.exe` and `v2.5.0`
  7. `package_release.ps1` -> `$Version = "2.5.0"`
  8. `README.md` -> Version badge updated to `Version-2.5.0`
  9. `releases/HelloKittyXamKinLung.Toad.yaml` -> `PackageVersion: 2.5.0`

### 1.2 Dual-Mode Engine Configuration (`portableAppData.ts`)
- **File**: `tad-master/packages/toad-app/app/portableAppData.ts`
- Extended `ToadConfig` interface with:
  ```typescript
  runtime: {
    engine: "utility" | "legacy" | "v8" | "tauri";
    auto_fallback?: boolean;
  };
  ```
- Set `DEFAULT_CONFIG.runtime = { engine: "utility", auto_fallback: true }`.
- Added `[runtime]` section to `DEFAULT_CONFIG_INI_TEXT` template and `stringifyConfig()`.
- Implemented robust `[runtime]` section validation in `validateAndEnsureConfig()` with auto-healing and fallback preservation.

### 1.3 BrowserWindow Dual-Mode WebPreferences (`appWindow.ts`)
- **File**: `tad-master/packages/toad-app/app/appWindow.ts`
- Detected engine mode via `(global as any).toadPortableEnv?.config?.runtime?.engine || "utility"`.
- When `engineMode !== "legacy"`:
  - `contextIsolation: true`
  - `nodeIntegration: false`
- When `engineMode === "legacy"`:
  - `contextIsolation: false`
  - `nodeIntegration: true`
- Forwarded `--toadEngineMode=${engineMode}` in `additionalArguments`.

### 1.4 Preload ContextBridge & Port Forwarding (`preload.js`)
- **File**: `tad-master/packages/toad-app/app/preload.js`
- Safely parses `--toadOpenParams=` and legacy `--tadOpenParams=` from `process.argv`.
- Listens for `"toad-engine-port"` message from Main process and forwards `port` to Renderer via `window.postMessage({ type: "toad-engine-port-handshake" }, "*", [port])`.
- Defines `toadBridge` with `invoke(command, payload)`, `send(channel, payload)`, `on(channel, listener)`, clipboard writing, and external URL opening.
- Safely exposes `window.toadBridge` and `window.openParams` using `contextBridge.exposeInMainWorld` when available, with graceful fallback to `window.toadBridge` in legacy mode.
- Synchronized to `dist/preload.js`.

### 1.5 Host Bridge Standardization & HeadlessNodeAdapter (`packages/host-bridge/`)
- **`IHostBridge.ts`**:
  - Declared `engineName: "utility" | "legacy" | "v8" | "headless" | "tauri"`.
  - Added Tauri v2 invocation signature: `invokeCmd<T = any>(command: string, payload?: any): Promise<T>`.
  - Added MessagePort and Lifecycle listeners: `setupDataPort?(port: any): void`, `onEngineCrash?(listener: () => void): () => void`, `onEngineRestored?(callback: () => void): () => void`.
- **`V8HostAdapter.ts`**:
  - Preferentially consumes `(window as any).toadBridge` when `contextIsolation: true`.
  - Falls back gracefully to `window.require("electron")` in legacy mode.
  - Implemented `invokeCmd`, `setupDataPort`, `onEngineRestored`, and `onEngineCrash`.
  - Listens to window `"message"` event for `"toad-engine-port-handshake"` to establish the direct data channel.
- **`HeadlessNodeAdapter.ts` (NEW)**:
  - Implements `IHostBridge` for pure Node.js environments (test runners, headless CLI).
  - `readonly engineName = "headless"`.
  - Provides `registerHandler(command, handler)` and `setDirectDispatcher(dispatcher)`.
  - Implements OS dialog fallbacks and EventEmitter-backed pub/sub (`onEvent`, `sendEvent`, `onEngineRestored`, `onEngineCrash`).
- **`index.ts`**:
  - Exported `HeadlessNodeAdapter`.

---

## 2. Verification Commands & Results

1. **Host-Bridge TypeScript Compilation**:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe tad-master/node_modules/typescript/bin/tsc -p tad-master/packages/host-bridge/tsconfig.json
   ```
   *Result*: Code 0. Successfully emitted `dist/` containing `HeadlessNodeAdapter.js`, `V8HostAdapter.js`, `IHostBridge.js`, `index.js`, and `.d.ts` definitions.

2. **Webpack Build for `toad-app`**:
   ```powershell
   cd tad-master/packages/toad-app; ..\..\..\node-v18.20.4-win-x64\node.exe ..\..\node_modules\webpack\bin\webpack.js --mode development
   ```
   *Result*: Code 0. `main.bundle.js` and `toadapp.bundle.js` compiled cleanly in 10s without errors.

3. **Smoke Test Verification**:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe tests/smoke_test.js
   ```
   *Result*: 100% PASS. Binary PE Header verified valid ('MZ'), portable exe within budget (72.10 MB), zero uncaught exceptions during bootstrap.

4. **Legacy Use Cases Test Suite (19 tests)**:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe tests/legacy_use_cases.js
   ```
   *Result*: 19 / 19 PASS (100%). All config.ini parsing, defaults, auto-healing, and concurrency tests passed without errors.

5. **Preload 3 Pages Test Suite (10 tests)**:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe tests/test_preload_3_pages.js
   ```
   *Result*: 10 / 10 PASS (100%). RAM LRU cache and 3-page buffer indexing verified.

6. **Host Bridge Unit Verification**:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe -e "const { HeadlessNodeAdapter, V8HostAdapter } = require('./tad-master/packages/host-bridge/dist/index.js'); ... "
   ```
   *Result*: `v8`, `headless`, `invokeCmd`, and `onEngineRestored` event bus verified cleanly.
