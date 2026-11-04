# Tauri v2 Comprehensive Specification & Integration Report

> **Project**: Toad Desktop Tauri v2 Migration (`TOAD-TAURI-V2`)  
> **Author**: Spec Miner Subagent (`specminer_survey_2`)  
> **Target Platform**: Windows 10/11 x64 (Microsoft Edge WebView2)  
> **Specification Sources**: `tauri/docs/`, `tad-master/packages/host-bridge/src/`  
> **Date**: 2026-11-04  

---

## 1. Executive Summary & Core Architectural Mental Model

Tauri v2 introduces a major architectural shift compared to Tauri v1 and Electron:
1. **Capabilities & Permission ACL System**: Replaces the deprecated v1 `allowlist`. Every frontend window/webview is isolated by default and granted explicit permissions via capability files (`src-tauri/capabilities/*.json`).
2. **Unified Core & Plugins**: Standard APIs (`dialog`, `fs`, `opener`, `clipboard`, `single-instance`, `window-state`) have been migrated to modular Rust crates and npm packages (`@tauri-apps/plugin-*`).
3. **High-Throughput IPC**:
   - `tauri::ipc::Response`: Directly returns zero-copy binary array buffers (`ArrayBuffer` / `Uint8Array`) to WebView without JSON or Base64 overhead (critical for Apache Arrow IPC Stream).
   - `tauri::ipc::Channel<T>`: Multiplexed, ordered, low-latency streaming channel between Rust background tasks and frontend listeners (critical for multi-stage forensic ingestion progress).
4. **Global Runtime Injection**: For legacy and adapter bridges (such as Toad's `TauriHostAdapter`), `app.withGlobalTauri: true` is strictly required to expose `window.__TAURI__.core.invoke` and `window.__TAURI__.event`.
5. **Portable Environment Integration**: Tauri v2 natively supports `app.appDirectoriesOverride: "./toadAppData"` in `tauri.conf.json` or dynamic override via `context.config_mut().app.app_directories_override`, perfectly fulfilling Toad's requirement for self-contained `toadAppData_[5chars]` portable directory.

---

## 2. Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Config | `tauri.conf.json` Schema | Root configuration file for Tauri runtime, build toolchain, and bundler | JSON / JSON5 / TOML with schema `https://schema.tauri.app/config/2` | Generates compile-time context via `tauri-build` | Build fails with syntax/validation error if schema invalid | `tauri/docs/develop/configuration-files.md` |
| 2 | Config | `app.withGlobalTauri` | Injects Tauri APIs on `window.__TAURI__` in WebView | Boolean (`true`/`false`) | `window.__TAURI__.core`, `window.__TAURI__.event` | If `false`, `window.__TAURI__` is `undefined`, causing HostAdapter crash | `tauri/docs/reference.md:2728`, `TauriHostAdapter.ts:39` |
| 3 | Config | `app.appDirectoriesOverride` | Overrides app directory resolution (`$APPDATA`, `$APPCONFIG`, etc.) to executable-adjacent folder | Path string (e.g. `"./toadAppData"`) or object | Re-roots base directories for portable storage | Write fails if folder read-only | `tauri/docs/reference.md:2807-2851` |
| 4 | Config | `app.windows` Configuration | Configures main application window geometry, theme, decorations | Array of window definitions (`label`, `title`, `width`, `height`, `decorations`, `theme`, `dragDropEnabled`) | Native Windows Win32 / WebView2 host window | Window fails to open or falls back to system defaults | `tauri/docs/reference.md:2866-2886`, `learn/window-customization.md` |
| 5 | Security | Content Security Policy (`app.security.csp`) | Restricts origin and script execution within WebView2 | CSP string or structured object | Injected HTTP CSP headers / meta tags | Violations blocked by browser engine, logged to console | `tauri/docs/security/csp.md`, `reference.md:2715` |
| 6 | Permissions | Capability Declaration (`capabilities/default.json`) | Defines permissions and maps them to windows | Capability JSON matching `https://schema.tauri.app/config/2/capability` | Grants frontend invoke access | Unauthorized command rejected with IPC permission error | `tauri/docs/security/capabilities.md` |
| 7 | Permissions | `core:default` | Default permission bundle for Tauri core APIs | Reference string `"core:default"` | Allows basic event emission, path resolution, app info | Modifying window size/title blocked unless explicitly permitted | `tauri/docs/reference.md:44-59` |
| 8 | Permissions | `dialog` Plugin Permissions | Grants file open/save dialog access | `"dialog:default"` or `"dialog:allow-open"`, `"dialog:allow-save"`, `"dialog:allow-message"` | Native OS file picker dialog | IPC rejection if permission missing | `tauri/docs/guides.md:12734`, `plugin/dialog.md` |
| 9 | Permissions | `fs` Plugin Permissions & Scope | Grants filesystem operations with granular path scoping | `"fs:default"`, `"fs:allow-read-file"`, path scopes (`$APPDATA/*`) | File byte reads/writes | Path traversal or unpermitted path throws EACCES/PermissionDenied | `tauri/docs/guides.md:13165-13200`, `plugin/file-system.md` |
| 10 | Permissions | `opener` Plugin Permissions | Grants URL and file opener via system default handler | `"opener:default"`, `"opener:allow-open-url"`, `"opener:allow-open-path"` | Launches default browser or file explorer | Blocks untrusted protocols or unlisted paths | `tauri/docs/guides.md:15087`, `plugin/opener.md` |
| 11 | Permissions | `clipboard-manager` Plugin Permissions | Grants clipboard read and write access | `"clipboard-manager:allow-write-text"`, `"clipboard-manager:allow-read-text"` | System clipboard manipulation | Denied by default if not explicitly enabled | `tauri/docs/guides.md:12120`, `plugin/clipboard.md` |
| 12 | Permissions | `single-instance` Plugin Permissions | Single instance lifecycle guard | None required (Rust-only plugin) | Focuses existing window and forwards CLI args | N/A | `tauri/docs/plugin/single-instance.md:201` |
| 13 | Permissions | `window-state` Plugin Permissions | Saves and restores window size, position, and maximized state | `"window-state:default"` | Persistent JSON state across restarts | Fails silently or uses defaults if permission absent | `tauri/docs/plugin/window-state.md`, `guides.md:17535` |
| 14 | Permissions | Custom Commands (`toad:*`, `project:*`) | Application custom commands registered in Rust | Direct Rust functions registered in `generate_handler!` | Application specific business logic | Unregistered command returns `Command not found` | `tauri/docs/security/capabilities.md:103-107` |
| 15 | Rust IPC | `tauri::ipc::Response` | Returns raw binary buffers without JSON stringification | `Vec<u8>` wrapped in `Response::new(raw_bytes)` | Received as `ArrayBuffer` in JavaScript | Memory allocation failure if buffer too large | `tauri/docs/develop/calling-rust.md:198-208` |
| 16 | Rust IPC | `tauri::ipc::Channel<T>` | Low-latency bi-directional streaming channel | `Channel<T>` instance passed from frontend invoke | Streamed messages dispatched to `Channel.onmessage` | If frontend drops listener, `channel.send()` returns `Err` | `tauri/docs/develop/calling-frontend.md:154-205` |
| 17 | Rust IPC | `tauri::generate_handler!` | Macro compiling static dispatch table for commands | Array of command function identifiers | Generated handler closure for `invoke_handler` | Rust compile error if identifier missing or duplicated | `tauri/docs/guides.md:3216`, `calling-rust.md:553` |
| 18 | Rust IPC | Single-Instance Event Pipeline | Forwards CLI file arguments to running instance | `tauri_plugin_single_instance::init` callback `(app, args, cwd)` | Emits Tauri event `toad:single-instance` to main window | Non-desktop targets ignore plugin | `tauri/docs/plugin/single-instance.md:106-118` |

---

## 3. Edge Cases & Observed Behaviors

| # | Feature | Input | Observed Behavior |
|---|---------|-------|-------------------|
| 1 | Window Mutating APIs | Frontend calling `window.setTitle(...)` with only `core:default` | Rejects with permission error! `core:default` only includes read-only getters (`allow-title`, `allow-inner-size`). Mutators like `core:window:allow-set-title`, `core:window:allow-maximize`, `core:window:allow-minimize` must be explicitly added to capabilities. |
| 2 | Global Tauri Injection | Frontend calling `window.__TAURI__.core.invoke` with `app.withGlobalTauri = false` (default) | `window.__TAURI__` is `undefined`. `TauriHostAdapter.invoke` throws fatal exception `[TauriHostAdapter] Tauri runtime not detected`. Must set `"withGlobalTauri": true` in `tauri.conf.json`. |
| 3 | Command Registration | Multiple `.invoke_handler()` calls on `tauri::Builder` | ONLY THE LAST CALL TAKES EFFECT; earlier registered commands are silently overwritten and become unreachable! All commands must be bundled into a single `tauri::generate_handler![...]` invocation. |
| 4 | Arrow IPC Stream Zero-Copy | Returning `Vec<u8>` without `Response::new(...)` | Serde serializes the vector into a JSON number array `[255, 255, 255, 255, ...]`, inflating memory 10x-20x and crashing V8 on large datasets. Using `Response::new(bytes)` transmits raw bytes directly to `ArrayBuffer`. |
| 5 | Command Names with Colons (`toad:eval_query`) | Direct identifier `#[tauri::command] fn toad:eval_query` | Invalid Rust syntax (Rust function identifiers cannot contain colons `:`). Must implement command dispatcher or router in `src-tauri/src/commands/mod.rs` to normalize namespaced aliases or wrap `Invoke`. |
| 6 | Clipboard Default Permission | Requesting clipboard write with `"clipboard:default"` or no capability | Fails! `tauri-plugin-clipboard-manager` has NO default permissions enabled (`"clipboard-manager:default"` does not exist). You must explicitly declare `"clipboard-manager:allow-write-text"` and `"clipboard-manager:allow-read-text"`. |
| 7 | Single Instance Registration Order | Initializing `tauri_plugin_single_instance` after other plugins | Other plugins (e.g. database pool, window state) may begin running before the second instance terminates, creating race conditions. Tauri documentation explicitly mandates registering Single Instance as the FIRST plugin. |
| 8 | Window State Restore & Screen Flicker | Launching with `"visible": true` while `window-state` plugin is active | Window renders briefly at default coordinates and then jumps to restored position. Fix: set `"visible": false` in `tauri.conf.json`; `window-state` automatically reveals window after restoring geometry. |
| 9 | CSP WebAssembly & Inline Styles | Omitting `'unsafe-inline'` from `style-src` | SlickGrid and BlueprintJS dynamically calculate and inject inline element styles (`style="height: 24px; width: 120px;"`), which are blocked by strict CSP without `'unsafe-inline'`. |
| 10 | Portable App Directories | Relative path `"./toadAppData"` in `appDirectoriesOverride` | Fully supported on Windows for portable executable. Automatically resolves `$APPDATA`, `$APPCONFIG`, `$APPCACHE`, and `$APPLOG` relative to the running `.exe` folder. |

---

## 4. Deep-Dive Specification

### 4.1. Tauri v2 Configuration (`tauri.conf.json`)

#### Schema & Format
- **Schema URL**: `https://schema.tauri.app/config/2`
- **File Format**: Standard JSON (stored at `tauri/project/src-tauri/tauri.conf.json`).
- **Core Keys**:
  - `productName`: `"Toad"`
  - `version`: `"2.5.1"`
  - `identifier`: `"com.toad.analyzer"`
  - `mainBinaryName`: `"Toad"`

#### Build Section
```json
"build": {
  "beforeDevCommand": "npm run dev",
  "devUrl": "http://localhost:1420",
  "beforeBuildCommand": "npm run build",
  "frontendDist": "../dist"
}
```

#### App & Window Configuration
```json
"app": {
  "withGlobalTauri": true,
  "appDirectoriesOverride": "./toadAppData",
  "windows": [
    {
      "label": "main",
      "title": "Toad",
      "width": 1440,
      "height": 900,
      "minWidth": 960,
      "minHeight": 600,
      "resizable": true,
      "fullscreen": false,
      "decorations": true,
      "transparent": false,
      "theme": "Dark",
      "visible": false,
      "dragDropEnabled": true
    }
  ],
  "security": {
    "csp": {
      "default-src": "'self'",
      "script-src": "'self'",
      "style-src": "'self' 'unsafe-inline'",
      "img-src": "'self' asset: https://asset.localhost blob: data:",
      "font-src": "'self' data:",
      "connect-src": "'self' ipc: http://ipc.localhost"
    },
    "freezePrototype": false,
    "capabilities": ["default"]
  }
}
```

#### Bundle Section (Windows x64 Portable)
```json
"bundle": {
  "active": true,
  "targets": ["nsis"],
  "icon": ["icons/icon.ico"],
  "windows": {
    "webviewInstallMode": {
      "type": "downloadBootstrapper"
    },
    "nsis": {
      "installMode": "currentUser",
      "displayLanguageSelector": false
    }
  }
}
```

---

### 4.2. Capabilities & Permissions (`src-tauri/capabilities/default.json`)

Tauri v2 requires capability definitions to map fine-grained privileges to windows.

#### Exact Specification for `src-tauri/capabilities/default.json`
```json
{
  "$schema": "https://schema.tauri.app/config/2/capability",
  "identifier": "default",
  "description": "Comprehensive capability permissions for Toad main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-set-title",
    "core:window:allow-maximize",
    "core:window:allow-minimize",
    "core:window:allow-close",
    "core:window:allow-show",
    "core:window:allow-hide",
    "core:window:allow-start-dragging",
    "core:window:allow-toggle-maximize",
    "core:window:allow-internal-toggle-maximize",

    "dialog:default",
    "dialog:allow-open",
    "dialog:allow-save",
    "dialog:allow-message",

    "fs:default",
    "fs:allow-read-file",
    "fs:allow-write-file",
    "fs:allow-exists",
    "fs:allow-read-dir",
    "fs:allow-mkdir",
    "fs:allow-remove",

    "opener:default",
    "opener:allow-open-url",
    "opener:allow-open-path",
    "opener:allow-reveal-item-in-dir",

    "clipboard-manager:allow-write-text",
    "clipboard-manager:allow-read-text",
    "clipboard-manager:allow-clear",

    "window-state:default"
  ]
}
```

#### Detailed Breakdown by Subsystem:

1. **`core:default`**:
   - Automatically grants default read-only queries for:
     - `core:app:default` (`version`, `name`, `identifier`, `tauri_version`)
     - `core:event:default` (`listen`, `unlisten`, `emit`, `emit_to`)
     - `core:path:default` (`resolve`, `join`, `dirname`, `basename`, `normalize`, `is_absolute`)
     - `core:resources:default` (`close`)
     - `core:tray:default`
     - `core:webview:default`
     - `core:window:default` (read-only window properties: size, position, focused, minimized)
   - **Crucial Rule**: Mutating window operations (`set_title`, `maximize`, `minimize`, `close`, `start_dragging`) are NOT in `core:default`. They must be explicitly granted as shown above.

2. **`dialog` Plugin**:
   - `dialog:default` includes `allow-open`, `allow-save`, and `allow-message`.
   - Maps to legacy calls:
     - `plugin:dialog|open` -> `dialog:showOpenDialog`
     - `plugin:dialog|save` -> `dialog:showSaveDialog`
     - `plugin:dialog|error` -> `errorDialog`

3. **`fs` Plugin**:
   - `fs:default` grants read access to `$APPDATA`, `$APPCONFIG`, `$APPLOCALDATA`, `$APPCACHE`, `$APPLOG` and `mkdir`.
   - `fs:allow-read-file`, `fs:allow-write-file`, `fs:allow-exists` allow direct guest filesystem operations.
   - Note: Forensics ingestion occurs natively in Rust (Tokio/DuckDB), bypassing frontend filesystem scope limitations.

4. **`opener` Plugin**:
   - `opener:default` includes `allow-open-url`, `allow-reveal-item-in-dir`, and `allow-default-urls`.
   - Specifically handles `plugin:opener|open_url` (used by `TauriHostAdapter.openExternal(url)`).

5. **`clipboard-manager` Plugin**:
   - In Tauri v2 official plugin (`tauri-plugin-clipboard-manager`), no permissions are enabled by default for security.
   - Must explicitly specify `"clipboard-manager:allow-write-text"` to satisfy `plugin:clipboard|write_text`.

6. **`single-instance` Plugin**:
   - **Zero permissions required**. It operates strictly in native Rust without frontend JavaScript guest APIs.

7. **`window-state` Plugin**:
   - `window-state:default` includes `allow-filename`, `allow-restore-state`, and `allow-save-window-state`.

8. **Custom Commands (`toad:*` and `project:*`)**:
   - By default in Tauri v2, commands registered via `invoke_handler(tauri::generate_handler![...])` on the main app are **automatically permitted to all windows** unless an explicit `AppManifest` is declared in `build.rs`.
   - Therefore, custom commands do not need explicit entries in `capabilities/default.json` under standard Tauri configuration.

---

### 4.3. Tauri v2 Rust IPC Patterns

#### Pattern A: Zero-Copy Binary Response (`tauri::ipc::Response`) for Apache Arrow IPC
Apache Arrow IPC Streams begin with the standard 4-byte continuation marker:
`0xFFFFFFFF` (`[255, 255, 255, 255]` or `0xFF, 0xFF, 0xFF, 0xFF`), followed by the FlatBuffers Schema and RecordBatches.

**Rust Implementation (`src-tauri/src/engine/arrow_encoder.rs`)**:
```rust
use tauri::ipc::Response;

#[tauri::command]
pub async fn toad_eval_query(
    query_exp: serde_json::Value,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<Response, String> {
    // 1. DuckDB executes QueryExp and produces RecordBatch vector
    // 2. Arrow IPC StreamWriter encodes batches into Vec<u8> starting with 0xFFFFFFFF
    let arrow_stream_bytes: Vec<u8> = state.engine.read().await.execute_query(&query_exp).await
        .map_err(|e| e.to_string())?;

    // 3. Return raw binary buffer (delivered to WebView2 as ArrayBuffer)
    Ok(Response::new(arrow_stream_bytes))
}
```

**Frontend Handling (`tad-master/packages/host-bridge/src/TauriHostAdapter.ts`)**:
```typescript
async invokeBinary(cmd: string, args?: Record<string, unknown> | any): Promise<Uint8Array> {
  const tauriCmd = this.resolveTauriCommand(cmd);
  const tauri = this.getTauri();
  if (tauri?.core?.invoke) {
    const res = await tauri.core.invoke(tauriCmd, args || {});
    if (res instanceof Uint8Array) return res;
    if (res instanceof ArrayBuffer) return new Uint8Array(res);
    return new Uint8Array(res);
  }
  return new Uint8Array();
}
```

#### Pattern B: Streaming Progress Channel (`tauri::ipc::Channel`)
For multi-stage log ingestion (CSV, JSONL, EVTX), channels provide ordered, low-overhead event streaming.

**Rust Implementation (`src-tauri/src/ingest/scheduler.rs`)**:
```rust
use tauri::ipc::Channel;
use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(tag = "stage", content = "payload")]
pub enum IngestProgressPayload {
    Scanning { total_bytes: u64 },
    Parsing { percent: f32, bytes_read: u64 },
    Converting { percent: f32, rows_count: usize },
    FlushingParquet { percent: f32 },
    Complete { total_rows: usize, parquet_path: String },
    Error { message: String },
}

#[tauri::command]
pub async fn toad_ingest_file(
    file_path: String,
    on_progress: Channel<IngestProgressPayload>,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<(), String> {
    tauri::async_runtime::spawn(async move {
        let _ = on_progress.send(IngestProgressPayload::Scanning { total_bytes: 1024 * 1024 });
        // Perform streaming decode...
        let _ = on_progress.send(IngestProgressPayload::Parsing { percent: 45.0, bytes_read: 500_000 });
        let _ = on_progress.send(IngestProgressPayload::Complete { total_rows: 50_000, parquet_path: "temp.parquet".into() });
    });
    Ok(())
}
```

**Frontend Guest Binding (`TypeScript`)**:
```typescript
import { Channel, invoke } from '@tauri-apps/api/core';

export async function startFileIngestion(
  filePath: string,
  onProgress: (stage: string, payload: any) => void
): Promise<void> {
  const channel = new Channel<IngestProgressPayload>();
  channel.onmessage = (msg) => {
    onProgress(msg.stage, msg.payload);
  };
  await invoke('toad_ingest_file', { filePath, onProgress: channel });
}
```

#### Pattern C: Command Dispatcher & Namespaced Routing (`src-tauri/src/commands/mod.rs`)
To bridge Toad's namespaced commands (`toad:eval_query`, `project:get_workspace`) with Tauri's Rust identifiers:

```rust
use tauri::ipc::Invoke;

// Command functions defined with valid Rust identifiers
#[tauri::command]
pub async fn eval_query(...) -> Result<tauri::ipc::Response, String> { ... }

#[tauri::command]
pub async fn row_count(...) -> Result<usize, String> { ... }

#[tauri::command]
pub async fn get_workspace(...) -> Result<serde_json::Value, String> { ... }

// Router wrapper to accept both "toad:eval_query" and "eval_query"
pub fn dispatch_invoke() -> impl Fn(Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    let handler = tauri::generate_handler![
        eval_query,
        row_count,
        schema,
        run_sql_arrow,
        get_table_name,
        init_main,
        get_config,
        new_window,
        get_workspace,
        add_files,
        add_folder,
        delete_project,
        rename_project,
        create_project,
        set_active_project,
        reconcile_project,
        get_files,
        delete_all_projects,
        get_cache_size,
        purge_cache,
        remove_file,
        move_orphan_files,
        engine_status,
        engine_restart
    ];

    move |mut invoke: Invoke<tauri::Wry>| {
        // Strip command namespace prefix ("toad:", "project:", "engine:")
        let raw_cmd = invoke.message.command().to_string();
        if let Some(stripped) = raw_cmd.strip_prefix("toad:")
            .or_else(|| raw_cmd.strip_prefix("project:"))
            .or_else(|| raw_cmd.strip_prefix("engine:")) 
        {
            // Re-route with normalized command name
            invoke.message.set_command(stripped.to_string());
        }
        handler(invoke)
    }
}
```
*(Alternatively, registering modular in-crate plugins: `Builder::new("toad")` and `Builder::new("project")` handles `plugin:toad|...` automatically).*

#### Pattern D: Single Instance Setup on Windows
```rust
use tauri::Manager;

pub fn build_app() -> tauri::Builder<tauri::Wry> {
    tauri::Builder::default()
        // MANDATORY: Single instance MUST be the first plugin registered!
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
                // Forward command line arguments to frontend (e.g. double-clicked file path)
                let _ = window.emit("toad:single-instance-open", serde_json::json!({
                    "args": args,
                    "cwd": cwd
                }));
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
}
```

---

## 5. Architectural Recommendations for Implementation Squads

1. **For Squad 1 (Scaffolding & Config)**:
   - Ensure `tauri.conf.json` contains `"withGlobalTauri": true` and `"appDirectoriesOverride": "./toadAppData"`.
   - Set `"visible": false` in `tauri.conf.json` window config so `tauri-plugin-window-state` smoothly restores window position without UI jump.
   - Include all permissions listed in Section 4.2 inside `src-tauri/capabilities/default.json`.

2. **For Squad 2 (Rust Core & OS Integration)**:
   - Register `tauri_plugin_single_instance` as the very first plugin on `tauri::Builder`.
   - In `src-tauri/src/commands/mod.rs`, implement prefix normalization (`toad:`, `project:`) to ensure 100% interoperability with `commandAliases.ts`.
   - Set up `tracing-subscriber` to write to the overridden log directory `$APPLOG/toad.log`.

3. **For Squad 3 (DuckDB Engine & Arrow IPC)**:
   - Always return `Ok(tauri::ipc::Response::new(raw_bytes))` for tabular queries.
   - Never serialize Arrow `RecordBatch` into JSON or Base64.
   - Ensure the byte stream starts with the Apache Arrow IPC 4-byte continuation marker `[0xFF, 0xFF, 0xFF, 0xFF]`.

4. **For Squad 5 (Ingestion Pipelines)**:
   - Use `tauri::ipc::Channel<IngestProgressPayload>` for multi-stage loading progress (5% -> 45% -> 90% -> 100%).
   - Wrap heavy CPU decoding (SIMD EVTX, CSV scanning) in `tokio::task::spawn_blocking` to prevent blocking Tokio async runtime.

5. **For Squad 6 (Frontend & Host Bridge)**:
   - Verify `packages/host-bridge/src/TauriHostAdapter.ts` handles `Uint8Array` directly from `invokeBinary`.
   - Verify that Vite bundle includes CSP compatibility and does not strip runtime global `window.__TAURI__`.
