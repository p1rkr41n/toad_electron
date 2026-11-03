# TOAD v2.5.0 IPC Migration: Frontend Host Bridge, Preload & Webpack Architecture Analysis

## 1. Executive Summary & Problem Scope

In TOAD versions prior to v2.5.0 (v2.4.8.1 baseline), the application operates in an in-process, tightly coupled architecture:
- `BrowserWindow` in `packages/toad-app/app/appWindow.ts` is configured with `nodeIntegration: true` and `contextIsolation: false`.
- The Chromium Renderer process directly accesses Node.js APIs (`require('electron')`, `ipcRenderer`, `shell`, `clipboard`).
- DuckDB driver (`reltab-duckdb`) executes queries either in-process or via ad-hoc child processes, exposing the UI to white-screen crashes if DuckDB encounters native C++ assertion failures or segmentation faults.
- Preload script (`packages/toad-app/app/preload.js`) directly mutates `window.openParams` from `process.argv` without using `contextBridge`.

The TOAD v2.5.0 architectural migration achieves complete compute isolation:
1. **Dedicated Engine Service (`utilityProcess`)**: Separates DuckDB Driver, Parquet Ledger, and ingestion pipeline into a supervised Electron `utilityProcess` (`engineService.bundle.js`).
2. **Standardized Tauri-like Host Bridge (`IHostBridge`)**: Standardizes all frontend communication behind `window.toadBridge.invoke(command, payload)` with `contextIsolation: true` and `nodeIntegration: false`. This ensures 100% of UI code remains reusable when migrating to Tauri v2 (Rust + WebView2).
3. **Direct MessagePort Data Channel**: Main process establishes a `MessageChannelMain`, passing one port to `utilityProcess` and one port to Renderer for high-speed queries with zero-copy transferable `ArrayBuffer` data blocks.
4. **Crash Supervision & Self-Healing Toast**: When the `utilityProcess` crashes, Main supervisor auto-restarts it in `< 500ms`, reloads snapshot state from `toad_ledger.parquet` in `< 5ms`, and displays a non-blocking toast in `AppPane.tsx`: *"Động cơ phân tích vừa được tự động phục hồi"*, seamlessly reconciling view state.
5. **Zero-Regression CLI Compatibility**: Implements `HeadlessNodeAdapter` in `packages/host-bridge` so that all 168+ test cases in `run_tests.js` and `deep_integration_qa.js` continue executing in pure Node.js environments.

---

## 2. Codebase Investigation Findings

### 2.1 Workspace Structure & Layout Mapping
- **Root Directory**: `d:\Shared_UserData\Downloads\tad\`
- **Monorepo Directory**: `tad-master/`
  - `packages/host-bridge/`: Interface `IHostBridge.ts`, `V8HostAdapter.ts`, `index.ts`.
  - `packages/toadviewer/`: UI library containing `src/components/AppPane.tsx`, `ProjectWorkspaceManager.ts`, `MultipleLoadingManager.ts`.
  - `packages/toad-app/`: Electron desktop application shell containing:
    - `app/appWindow.ts`: BrowserWindow configuration.
    - `app/main.ts`: Main process lifecycle & IPC dispatch.
    - `app/preload.js`: Preload script copied to `dist/preload.js`.
    - `src/electronRenderMain.tsx`: Renderer entry point.
    - `webpack.config.js`: Webpack 5.112.0 build configuration.
- **Node Runtime**: Workspace contains a portable Node.js v18.20.4 runtime at `d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe`.

### 2.2 Preload Script & BrowserWindow Configuration
- **Current `preload.js`** (`packages/toad-app/app/preload.js`):
  - Parses `--toadOpenParams=` and `--tadOpenParams=` from `process.argv`.
  - Directly assigns `window.openParams = JSON.parse(...)`.
  - `contextBridge` usage is commented out.
- **Current `appWindow.ts`** (`packages/toad-app/app/appWindow.ts` L122-130):
  ```typescript
  webPreferences: {
    nodeIntegration: true,
    contextIsolation: false,
    preload: path.join(__dirname, "preload.js"),
    additionalArguments: [
      `--toadOpenParams=${JSON.stringify(openParams)}`,
      `--tadOpenParams=${JSON.stringify(openParams)}`,
    ],
  }
  ```
- **Observed Gap**: If `contextIsolation: true` is enabled without updating `preload.js`, `window.openParams` set in preload is in the isolated context and completely invisible to `electronRenderMain.tsx`, causing initial file load to fail. `contextBridge.exposeInMainWorld` is strictly required.

### 2.3 Renderer Host Bridge & `electronRenderMain.tsx`
- **Current `electronRenderMain.tsx`**:
  - Directly imports `clipboard`, `ipcRenderer`, `shell` from `"electron"`.
  - Calls `ipcRenderer.invoke(...)` for `"initMain"`, `"getToadConfig"`, `"errorDialog"`, `"newWindowFromDSPath"`.
  - Listens to IPC channels (`"request-serialize-app-state"`, `"set-show-hidden-cols"`, `"reopen-current-file"`, etc.) via `ipcRenderer.on`.
- **Current `V8HostAdapter.ts`** (`packages/host-bridge/src/V8HostAdapter.ts`):
  - Checks `(window as any).electron || (window as any).require?.("electron")`.
  - With `nodeIntegration: false` and `contextIsolation: true`, `window.require` is undefined, throwing `[V8HostAdapter] ipcRenderer not available for invoking...`.
- **Observed Solution**: `V8HostAdapter` must inspect `(window as any).toadBridge` first. If present, it delegates `invoke`, `onEvent`, and `sendEvent` to `toadBridge`.

### 2.4 Toast Notification in `AppPane.tsx`
- **Dependencies**: `@blueprintjs/core` is installed at version `4.12.0`.
- **Verification**: Verified via local Node runtime that `@blueprintjs/core` exports `Toaster`, `Position`, and `Intent`.
- **Location**: `tad-master/packages/toadviewer/src/components/AppPane.tsx`.
- **Observed Pattern**: `AppPane.tsx` does not currently instantiate a `Toaster`. It should instantiate `AppToaster = Toaster.create({ position: Position.BOTTOM_RIGHT })` and listen for engine recovery events to trigger `AppToaster.show({ message: "Động cơ phân tích vừa được tự động phục hồi", intent: Intent.SUCCESS, icon: "refresh" })`.

### 2.5 Webpack 5.112.0 Target Verification
- **Target Test Execution**: Executed verification of targets on Webpack v5.112.0 in workspace:
  - `target: "node"` -> **SUPPORTED**
  - `target: "electron-main"` -> **SUPPORTED**
  - `target: "electron-renderer"` -> **SUPPORTED**
  - `target: "electron-utility"` -> **NOT SUPPORTED** (`Unknown target 'electron-utility'`).
- **Architectural Decision**: Webpack bundle for `engineService.ts` must use `target: "node"` (or `"electron-main"`). In Electron, `utilityProcess` executes a standard Node.js environment with access to `process.parentPort` and native `.node` addons. Using `target: "node"` with `externalsPresets: { node: true }` and `webpack-node-externals` is the standard, battle-tested approach.

### 2.6 Native Binary Packing (`duckdb.node`)
- **ASAR Configuration** (`packages/toad-app/package.json` L94-96):
  `"asarUnpack": ["**/*.node"]` is already in place.
- **Verification Gate** (`dist_package.ps1` L80-84):
  `$duckDbUnpacked = "$appDir\release\win-unpacked\resources\app.asar.unpacked\node_modules\duckdb\lib\binding\duckdb.node"`
  When Electron runs from `app.asar`, Electron's native module loader redirects `require('duckdb')` to `app.asar.unpacked/node_modules/duckdb/lib/binding/duckdb.node`.
- In `utilityProcess`, because it is spawned via `utilityProcess.fork(bundlePath)`, ASAR unpacking works automatically.

---

## 3. Detailed Architecture Specifications

### 3.1 Preload Script (`packages/toad-app/app/preload.js`)
When `contextIsolation: true`, the preload script executes in an isolated V8 context with access to Electron primitives (`contextBridge`, `ipcRenderer`). It exposes a secure `toadBridge` surface to the main world:

```javascript
/* preload.js - TOAD v2.5.0 Secure Host Bridge */
const { contextBridge, ipcRenderer } = require("electron");

// 1. Parse openParams from process.argv
const argPrefixToad = '--toadOpenParams=';
const argPrefixTad = '--tadOpenParams=';
let openParams = null;

for (let i = 0; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg.startsWith(argPrefixToad)) {
    try {
      openParams = JSON.parse(arg.slice(argPrefixToad.length));
    } catch {}
    break;
  }
}
if (!openParams) {
  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith(argPrefixTad)) {
      try {
        openParams = JSON.parse(arg.slice(argPrefixTad.length));
      } catch {}
      break;
    }
  }
}

// 2. MessagePort Handshake: listen for data channel port from Main Process
ipcRenderer.on("toad-engine-port", (event) => {
  const port = event.ports && event.ports[0];
  if (port) {
    // Forward the MessagePort to the Main World (window context)
    window.postMessage({ type: "toad-engine-port-handshake" }, "*", [port]);
  }
});

// 3. Define the secure toadBridge API
const toadBridge = {
  // Tauri-standard invoke signature
  invoke: (command, payload) => ipcRenderer.invoke(command, payload),

  // One-way message sending
  send: (channel, payload) => ipcRenderer.send(channel, payload),

  // Event subscription with automatic unsubscribe callback
  on: (channel, listener) => {
    const handler = (event, data) => listener(data);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },

  // Clipboard operations
  clipboard: {
    writeText: (text) => ipcRenderer.send("clipboard:writeText", text),
  },

  // External URLs
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),

  // Initial Open Parameters
  openParams: openParams,
};

// 4. Safely expose into Main World
try {
  contextBridge.exposeInMainWorld("toadBridge", toadBridge);
  // Also expose window.openParams for backwards compatibility
  if (openParams) {
    contextBridge.exposeInMainWorld("openParams", openParams);
  }
} catch (e) {
  // Fallback for contextIsolation: false mode (legacy)
  window.toadBridge = toadBridge;
  window.openParams = openParams;
}
```

### 3.2 Dual-Mode BrowserWindow Option (`packages/toad-app/app/appWindow.ts`)
Support seamless toggling between `utility` (default) and `legacy` modes based on configuration:

```typescript
// packages/toad-app/app/appWindow.ts
const toadPortableEnv = initPortableEnvironment();
const isLegacy = toadPortableEnv?.config?.runtime?.engine === "legacy";
const useUtilityProcess = !isLegacy;

let winProps = {
  title: "TOAD",
  icon: path.join(__dirname, "icon.png"),
  width: 1280,
  height: 980,
  x: 0,
  y: 0,
  webPreferences: {
    nodeIntegration: !useUtilityProcess,
    contextIsolation: useUtilityProcess,
    preload: path.join(__dirname, "preload.js"),
    additionalArguments: [
      `--toadOpenParams=${JSON.stringify(openParams)}`,
      `--tadOpenParams=${JSON.stringify(openParams)}`,
    ],
  },
};
```

### 3.3 MessagePort Pairing & Handshake Protocol

```
+-------------------------------------------------------------------------+
|                              MAIN PROCESS                               |
|                     (EngineSupervisor / Lifecycle)                      |
+-------------------+---------------------------------+-------------------+
                    |                                 |
      1. utilityProcess.fork()          2. new MessageChannelMain()
                    |                                 |
                    v                                 v
+-----------------------------+          +--------------------------------+
|       UTILITY PROCESS       |          |        port1 (Renderer)        |
|     (engineService.ts)      |          |       port2 (UtilityProc)      |
+-----------------------------+          +--------------------------------+
  Receives port2 via:                                 |
  utilityProc.postMessage(                            |
    { type: 'init-data-channel' },                    |
    [port2]                                           |
  )                                                   |
                                                      |
  Sends port1 to BrowserWindow via: ------------------+
  mainWindow.webContents.postMessage(
    "toad-engine-port",
    null,
    [port1]
  )
                                                      |
                                                      v
                                         +--------------------------------+
                                         |         PRELOAD SCRIPT         |
                                         +--------------------------------+
                                           Intercepts ipcRenderer.on:
                                           "toad-engine-port"
                                           Transfers port to Main World:
                                           window.postMessage(
                                             { type: 'port-handshake' },
                                             '*',
                                             [port1]
                                           )
                                                      |
                                                      v
                                         +--------------------------------+
                                         |        UI RENDERER WORLD       |
                                         |      (V8HostAdapter / UI)      |
                                         +--------------------------------+
                                           window.addEventListener('msg')
                                           hostBridge.setupDataPort(port1)
```

#### High-Speed Data Protocol:
- **Metadata / Schema / RowCount**: Handled via standard JSON message envelope over the MessagePort:
  ```json
  { "id": 42, "cmd": "rowCount", "queryStr": "..." }
  ```
- **Table Rep Data (`evalQuery`)**:
  - Engine transforms column vectors into flat binary buffers (`Float64Array`, `Int32Array`, UTF-8 byte buffers).
  - Sent back over `port2.postMessage({ id: 42, schema, count, buffers }, [buffer1, buffer2])` (Zero-Copy Transfer).
  - Renderer constructs `TableRep` instantly without JSON string parsing overhead.

### 3.4 HeadlessNodeAdapter (`packages/host-bridge/src/HeadlessNodeAdapter.ts`)
To satisfy Requirement R2 (100% test compatibility for all 168+ test cases without an Electron window):

```typescript
import { IHostBridge, OpenDialogOptions, SaveDialogOptions, AppConfigDTO } from "./IHostBridge";
import { EventEmitter } from "events";

/**
 * HeadlessNodeAdapter:
 * Implements IHostBridge for pure Node.js CLI testing (run_tests.js, deep_integration_qa.js).
 * Bypasses Electron BrowserWindow and ipcRenderer completely.
 */
export class HeadlessNodeAdapter implements IHostBridge {
  readonly engineName = "headless" as const;
  private emitter = new EventEmitter();
  private dataPort: any = null;
  private customHandlers: Map<string, (payload: any) => Promise<any>> = new Map();

  constructor() {}

  public registerHandler(command: string, handler: (payload: any) => Promise<any>): void {
    this.customHandlers.set(command, handler);
  }

  async invoke(functionName: string, req: any): Promise<any> {
    const handler = this.customHandlers.get(functionName);
    if (handler) {
      return await handler(req);
    }
    // Fallback: direct local reltab invocation if registered
    throw new Error(`[HeadlessNodeAdapter] No handler registered for '${functionName}'`);
  }

  async invokeCmd<T = any>(command: string, payload?: Record<string, any>): Promise<T> {
    return this.invoke(command, payload);
  }

  setupDataPort(port: any): void {
    this.dataPort = port;
  }

  onEngineCrash(listener: () => void): () => void {
    return this.onEvent("engine:crash", listener);
  }

  onEngineRestored(listener: () => void): () => void {
    return this.onEvent("engine:restored", listener);
  }

  async getConfig(): Promise<AppConfigDTO> {
    return {
      general: {
        viewer: "toad",
        language: "en",
        page_size: 1000,
        max_concurrent_files: 4,
        max_concurrent_gb: 1.0,
      },
      runtime: {
        engine: "v8",
        auto_fallback: true,
      },
      duckdb: {
        max_memory: "auto",
        threads: 0,
        background_threads: "auto",
        add_raw_event: false,
      },
      parquet: {
        compression: "snappy",
        row_group_size: 25000,
      },
      system: {
        temp_cleanup: true,
        binary_guard: true,
      },
    };
  }

  async showOpenDialog(options: OpenDialogOptions): Promise<string[] | null> {
    return options.defaultPath ? [options.defaultPath] : null;
  }

  async showSaveDialog(options: SaveDialogOptions): Promise<string | null> {
    return options.defaultPath || null;
  }

  async showErrorDialog(title: string, message: string, fatal = false): Promise<void> {
    console.error(`[HeadlessErrorDialog] ${title}: ${message}`);
  }

  async openExternal(url: string): Promise<void> {}
  copyToClipboard(text: string): void {}
  async openNewWindow(dsPath: any): Promise<void> {}

  onEvent<T = any>(channel: string, listener: (data: T) => void): () => void {
    this.emitter.on(channel, listener);
    return () => {
      this.emitter.removeListener(channel, listener);
    };
  }

  sendEvent(channel: string, payload?: any): void {
    this.emitter.emit(channel, payload);
  }

  setTheme(theme: "light" | "dark"): void {}
  getTheme(): "light" | "dark" {
    return "light";
  }
}
```

### 3.5 V8HostAdapter Integration with `toadBridge` (`packages/host-bridge/src/V8HostAdapter.ts`)
Update `V8HostAdapter` to support both `window.toadBridge` (isolated mode) and fallback `window.require('electron')` (legacy mode):

```typescript
export class V8HostAdapter implements IHostBridge {
  readonly engineName = "v8" as const;
  private toadBridge: any = null;
  private ipc: any = null;
  private clipboard: any = null;
  private shell: any = null;
  private dataPort: MessagePort | null = null;

  constructor() {
    this.initAPIs();
    this.initPortListener();
  }

  private initAPIs() {
    if (typeof window !== "undefined") {
      // 1. Prioritize secure toadBridge exposed by preload.js
      if ((window as any).toadBridge) {
        this.toadBridge = (window as any).toadBridge;
        return;
      }
      // 2. Legacy fallback if contextIsolation: false
      try {
        const electron = (window as any).electron || (window as any).require?.("electron");
        if (electron) {
          this.ipc = electron.ipcRenderer;
          this.clipboard = electron.clipboard;
          this.shell = electron.shell;
        }
      } catch {}
    }
  }

  private initPortListener() {
    if (typeof window !== "undefined") {
      window.addEventListener("message", (event) => {
        if (event.data?.type === "toad-engine-port-handshake" && event.ports?.[0]) {
          this.setupDataPort(event.ports[0]);
        }
      });
    }
  }

  public setupDataPort(port: MessagePort): void {
    this.dataPort = port;
    this.dataPort.start();
    // Reconnection notification
    this.sendEvent("engine:restored", {});
  }

  async invoke(functionName: string, req: any): Promise<any> {
    if (this.toadBridge) {
      return await this.toadBridge.invoke(functionName, req);
    }
    if (this.ipc) {
      return await this.ipc.invoke(functionName, req);
    }
    throw new Error(`[V8HostAdapter] Neither toadBridge nor ipcRenderer is available for '${functionName}'`);
  }

  async invokeCmd<T = any>(command: string, payload?: Record<string, any>): Promise<T> {
    return this.invoke(command, payload);
  }

  onEvent<T = any>(channel: string, listener: (data: T) => void): () => void {
    if (this.toadBridge) {
      return this.toadBridge.on(channel, listener);
    }
    if (this.ipc) {
      const handler = (_: any, data: T) => listener(data);
      this.ipc.on(channel, handler);
      return () => this.ipc.removeListener(channel, handler);
    }
    return () => {};
  }

  sendEvent(channel: string, payload?: any): void {
    if (this.toadBridge) {
      this.toadBridge.send(channel, payload);
    } else if (this.ipc) {
      this.ipc.send(channel, payload);
    }
  }

  onEngineRestored(listener: () => void): () => void {
    return this.onEvent("engine:restored", listener);
  }

  onEngineCrash(listener: () => void): () => void {
    return this.onEvent("engine:crash", listener);
  }
  // (Remaining methods showOpenDialog, showSaveDialog, etc. delegate to this.invoke)
}
```

### 3.6 UI Toast & Crash Recovery in `AppPane.tsx`
In `tad-master/packages/toadviewer/src/components/AppPane.tsx`:

```typescript
import {
  FocusStyleManager,
  Button,
  Dialog,
  Classes,
  ProgressBar,
  FormGroup,
  InputGroup,
  HTMLSelect,
  Text,
  Collapse,
  Spinner,
  Icon,
  Position,
  Toaster,
  Intent,
} from "@blueprintjs/core";

// Singleton AppToaster instance (lazy loaded in browser DOM)
export const AppToaster = typeof window !== "undefined"
  ? Toaster.create({
      position: Position.BOTTOM_RIGHT,
      canEscapeKeyClear: true,
    })
  : (null as any);

// Inside AppPane component:
useEffect(() => {
  let bridge: any = null;
  try {
    const { getHostBridge } = require("host-bridge");
    bridge = getHostBridge();
  } catch {}

  if (!bridge) return;

  const handleRestored = async () => {
    // 1. Display non-blocking Blueprint Toast notification
    if (AppToaster) {
      AppToaster.show({
        message: "Động cơ phân tích vừa được tự động phục hồi",
        intent: Intent.SUCCESS,
        icon: "refresh",
        timeout: 4000,
      });
    }

    // 2. Automatically reconcile view state from DuckDB / Parquet Ledger
    try {
      await actions.reopenCurrentView(stateRef);
    } catch (err) {
      log.error("Failed to reconcile view after engine auto-recovery:", err);
    }
  };

  let cleanup: (() => void) | undefined;
  if (typeof bridge.onEngineRestored === "function") {
    cleanup = bridge.onEngineRestored(handleRestored);
  } else if (typeof bridge.onEvent === "function") {
    cleanup = bridge.onEvent("engine:restored", handleRestored);
  }

  return () => {
    cleanup?.();
  };
}, [stateRef]);
```

### 3.7 Webpack Configuration (`packages/toad-app/webpack.config.js`)
We add the `engine` configuration entry to compile `engineService.ts` -> `engineService.bundle.js` with `target: "node"`:

```javascript
// packages/toad-app/webpack.config.js

var engine = {
  target: "node",
  entry: {
    engineService: "./app/engineService.ts",
  },
  externalsPresets: { node: true },
  externals: [
    nodeExternals(),
    nodeExternals({ modulesDir: "../../node_modules" }),
  ],
  node: {
    __dirname: false,
    __filename: false,
  },
};

const configMap = {
  development: [
    merge(app, development()),
    merge(render, development()),
    merge(engine, development()),
  ],
  production: [
    merge(app, production()),
    merge(render, production()),
    merge(engine, production()),
  ],
};
```

### 3.8 Build & Packaging Scripts Audit

1. **`fastbuild.ps1`**:
   - Update Step 2:
     ```powershell
     if (-not (Test-Path "$appDir\dist\engineService.bundle.js")) {
         throw "ERROR: dist\engineService.bundle.js was not generated!"
     }
     ```
2. **`dist_package.ps1`**:
   - Update Step 3:
     ```powershell
     $engineBundle = "$appDir\dist\engineService.bundle.js"
     if (-not (Test-Path $engineBundle)) {
         throw "ERROR: Cannot find engineService.bundle.js!"
     }
     ```
   - Update version verification pattern (L55) to recognize `v2.5.0`.
   - Native binding assertion (L80-84) already verifies `duckdb.node` in `app.asar.unpacked`.
3. **`tools/bump_version.js`**:
   - Running `node tools/bump_version.js 2.5.0` automatically synchronizes:
     - `packages/toad-app/package.json` -> `2.5.0`
     - `packages/host-bridge/package.json` -> `2.5.0`
     - `packages/reltab-duckdb/package.json` -> `2.5.0`
     - `packages/toadviewer/package.json` -> `2.5.0`
     - `packages/toadviewer/src/components/RegexDialog.tsx` -> `v2.5.0`
     - `dist_package.ps1` -> `Toad-2.5.0-x64-portable.exe`
     - `package_release.ps1` -> `2.5.0`
     - `README.md` -> `Toad (v2.5.0)`
     - `releases/HelloKittyXamKinLung.Toad.yaml` -> `PackageVersion: 2.5.0`

---

## 4. Implementation Phasing & Risk Assessment

| Phase | Core Objective | Key Deliverables | Risk & Mitigation |
| :--- | :--- | :--- | :--- |
| **Phase 1: Bridge & Isolation** | Standardize `IHostBridge` & expose `toadBridge` | `IHostBridge.ts`, `HeadlessNodeAdapter.ts`, `V8HostAdapter.ts`, `preload.js` | *Risk*: `electronRenderMain` loses globals.<br>*Mitigation*: Dual-mode flag in `appWindow.ts` preserves fallback. |
| **Phase 2: Engine Service & Port** | Standalone `engineService.ts` in `utilityProcess` | `engineService.ts`, `engineSupervisor.ts`, Webpack `engine` bundle | *Risk*: Webpack target incompatibility.<br>*Mitigation*: Use verified `target: "node"`, not unsupported `electron-utility`. |
| **Phase 3: Resilience & Packaging** | Auto-restart `< 500ms`, UI toast, and packaging | `AppPane.tsx` toast integration, `fastbuild.ps1`, `dist_package.ps1` | *Risk*: ASAR size bloat > 45MB.<br>*Mitigation*: Zero-duplicate policy, `duckdb.node` in `app.asar.unpacked`. |
