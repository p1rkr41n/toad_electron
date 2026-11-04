# Tauri 2.0 Architecture & Development Guide (AI Compact Reference)

> **Purpose**: A high-density, authoritative reference designed specifically for AI models and senior developers building high-performance **Windows Desktop** applications using **Tauri 2.0**, **Rust**, and **React / Vite / TypeScript**.
> **Scope**: Windows x64 Desktop, high-throughput IPC, DuckDB / Big Data integration, state management, security capabilities, and native OS APIs.

---

## 1. Tauri 2.0 Core Mental Model

```
+-------------------------------------------------------------------------+
|                              FRONTEND                                   |
|   React 18/19 + Vite + TypeScript (Rendered in Microsoft Edge WebView2) |
|   Imports: @tauri-apps/api/core, @tauri-apps/api/event, @tauri-apps/plugin-* |
+------------------------------------+------------------------------------+
                                     |
                         IPC (JSON / Binary / Channels)
                                     |
+------------------------------------+------------------------------------+
|                             CORE RUST                                   |
|   src-tauri/src/lib.rs (Logic & State) | src-tauri/src/main.rs (Runner) |
|   - tokio / tauri::async_runtime (Thread pool & background ingestion)   |
|   - Native DuckDB / SIMD / Parquet / FS / SQLite / Shell / Windows API  |
+-------------------------------------------------------------------------+
```

### Critical Differences: Tauri v2 vs v1 vs Electron
1. **No Allowlist in `tauri.conf.json`**: Tauri v2 completely replaced the v1 `allowlist` with the **Capabilities & Permissions System** (`src-tauri/capabilities/*.json`).
2. **Frontend Import Paths**: Core IPC functions come from `@tauri-apps/api/core` (`invoke`), NOT `@tauri-apps/api/tauri`. Plugins have separate packages: `@tauri-apps/plugin-fs`, `@tauri-apps/plugin-dialog`, etc.
3. **Rust Entry Architecture**: App logic resides in `src-tauri/src/lib.rs` inside `pub fn run()`. `main.rs` only calls `app_lib::run()`.
4. **Channels for Streaming**: Tauri v2 introduces `tauri::ipc::Channel<T>` for low-latency streaming of chunks/rows to the frontend without event bus overhead.

---

## 2. Canonical Directory Structure

```
tauri-project/
├── index.html
├── package.json
├── vite.config.ts
├── src/                               # Frontend (React / TS)
│   ├── App.tsx
│   ├── main.tsx
│   └── api/                           # Typed Rust IPC bridges
└── src-tauri/                         # Backend (Rust)
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── capabilities/
    │   └── default.json               # Window permissions & ACLs
    ├── icons/                         # .ico for Windows
    └── src/
        ├── lib.rs                     # App builder, plugins, handlers
        ├── main.rs                    # Entrypoint
        ├── commands/                  # IPC Command handlers
        └── state.rs                   # Shared AppState (Mutex/RwLock)
```

---

## 3. Configuration Essentials

### `src-tauri/Cargo.toml`
```toml
[package]
name = "toad-desktop"
version = "2.4.6"
description = "High-Performance Log & Tabular Data Analyzer"
edition = "2021"

[lib]
name = "toad_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
tauri-plugin-shell = "2"
tauri-plugin-single-instance = "2"
tauri-plugin-window-state = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
parking_lot = "0.12"
```

### `src-tauri/tauri.conf.json` (Windows Optimized)
```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Toad",
  "version": "2.4.6",
  "identifier": "com.toad.analyzer",
  "build": {
    "beforeDevCommand": "npm run build:dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build:prod",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "Toad Log Analyzer",
        "width": 1440,
        "height": 900,
        "minWidth": 960,
        "minHeight": 600,
        "resizable": true,
        "fullscreen": false,
        "decorations": true,
        "transparent": false,
        "theme": "Dark"
      }
    ],
    "security": {
      "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' asset: https://asset.localhost;"
    }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "icon": ["icons/icon.ico"],
    "windows": {
      "certificateThumbprint": null,
      "digestAlgorithm": "sha256",
      "timestampUrl": "",
      "webviewInstallMode": { "type": "downloadBootstrapper" },
      "nsis": {
        "installMode": "currentUser",
        "displayLanguageSelector": false
      }
    }
  }
}
```

---

## 4. Permissions & Capabilities (Tauri v2 Core Security)

Permissions are declared in `src-tauri/capabilities/default.json` to grant the frontend access to core features and plugins.

```json
{
  "$schema": "https://schema.tauri.app/config/2/capability",
  "identifier": "default",
  "description": "Default permissions for main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-set-title",
    "core:window:allow-maximize",
    "core:window:allow-minimize",
    "dialog:default",
    "dialog:allow-open",
    "dialog:allow-save",
    "fs:default",
    "fs:allow-read-file",
    "fs:allow-write-file",
    "fs:allow-exists",
    "shell:default",
    "single-instance:default",
    "window-state:default"
  ]
}
```

---

## 5. IPC Architecture & Code Patterns

### Pattern A: Standard Command (Request / Response)

**Backend (`src-tauri/src/lib.rs` / `commands.rs`)**:
```rust
use serde::{Deserialize, Serialize};
use tauri::State;
use std::sync::Arc;
use parking_lot::RwLock;

#[derive(Serialize, Deserialize)]
pub struct QueryResult {
    pub rows_count: usize,
    pub elapsed_ms: u64,
}

#[derive(Default)]
pub struct AppState {
    pub active_project: Arc<RwLock<Option<String>>>,
}

#[tauri::command]
pub async fn execute_query(
    sql: String,
    limit: usize,
    state: State<'_, AppState>,
) -> Result<QueryResult, String> {
    if sql.trim().is_empty() {
        return Err("SQL query cannot be empty".to_string());
    }
    // Perform query logic asynchronously
    Ok(QueryResult { rows_count: 1000, elapsed_ms: 12 })
}
```

**Frontend (`src/api/query.ts`)**:
```typescript
import { invoke } from '@tauri-apps/api/core';

export interface QueryResult {
  rows_count: number;
  elapsed_ms: number;
}

export async function runQuery(sql: string, limit = 1000): Promise<QueryResult> {
  try {
    return await invoke<QueryResult>('execute_query', { sql, limit });
  } catch (err) {
    console.error('IPC Query error:', err);
    throw new Error(String(err));
  }
}
```

---

### Pattern B: High-Throughput Streaming via `Channel` (Crucial for Big Data / DuckDB)

Avoid sending multi-megabyte JSON arrays over standard `invoke`! Use `Channel` to stream record batches progressively.

**Backend (`src-tauri/src/commands.rs`)**:
```rust
use tauri::ipc::Channel;
use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum StreamMessage {
    Chunk { batch_id: usize, rows: Vec<serde_json::Value> },
    Progress { percentage: f32 },
    Done { total_rows: usize },
    Error { message: String },
}

#[tauri::command]
pub async fn stream_large_dataset(
    file_path: String,
    on_event: Channel<StreamMessage>,
) -> Result<(), String> {
    tauri::async_runtime::spawn(async move {
        for batch_id in 0..10 {
            // Emulate batch ingestion from DuckDB / Parquet
            let batch = StreamMessage::Chunk {
                batch_id,
                rows: vec![],
            };
            if on_event.send(batch).is_err() {
                break; // Frontend listener dropped
            }
            let _ = on_event.send(StreamMessage::Progress { percentage: (batch_id + 1) as f32 * 10.0 });
        }
        let _ = on_event.send(StreamMessage::Done { total_rows: 100_000 });
    });

    Ok(())
}
```

**Frontend (`src/api/stream.ts`)**:
```typescript
import { invoke, Channel } from '@tauri-apps/api/core';

type StreamMessage =
  | { type: 'Chunk'; data: { batch_id: number; rows: any[] } }
  | { type: 'Progress'; data: { percentage: number } }
  | { type: 'Done'; data: { total_rows: number } }
  | { type: 'Error'; data: { message: string } };

export async function ingestDatasetStream(
  filePath: string,
  onBatch: (rows: any[]) => void,
  onProgress: (pct: number) => void
): Promise<number> {
  return new Promise(async (resolve, reject) => {
    const channel = new Channel<StreamMessage>();

    channel.onmessage = (msg) => {
      switch (msg.type) {
        case 'Chunk':
          onBatch(msg.data.rows);
          break;
        case 'Progress':
          onProgress(msg.data.percentage);
          break;
        case 'Done':
          resolve(msg.data.total_rows);
          break;
        case 'Error':
          reject(new Error(msg.data.message));
          break;
      }
    };

    await invoke('stream_large_dataset', { filePath, onEvent: channel });
  });
}
```

---

### Pattern C: Raw Binary Response (Zero-Copy Transfer)

For transferring raw Arrow, Parquet bytes, or bitmaps directly without UTF-8 stringification.

**Backend**:
```rust
use tauri::ipc::Response;

#[tauri::command]
pub fn fetch_parquet_bytes(table_id: String) -> Result<Response, String> {
    let raw_bytes: Vec<u8> = vec![0x50, 0x41, 0x52, 0x31]; // Parquet magic header PAR1
    Ok(Response::new(raw_bytes))
}
```

**Frontend**:
```typescript
import { invoke } from '@tauri-apps/api/core';

export async function getParquetBuffer(tableId: string): Promise<ArrayBuffer> {
  const bytes = await invoke<ArrayBuffer>('fetch_parquet_bytes', { tableId });
  return bytes;
}
```

---

## 6. App Builder & Initialization Template (`lib.rs`)

```rust
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        // 1. Plugins
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        
        // 2. Global State Management
        .manage(AppState::default())
        
        // 3. Setup Lifecycle Hook
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        
        // 4. Register Command Handlers
        .invoke_handler(tauri::generate_handler![
            execute_query,
            stream_large_dataset,
            fetch_parquet_bytes
        ])
        .run(tauri::generate_context!())
        .expect("error while running Toad Tauri application");
}
```

---

## 7. Windows Desktop Native Integration

### Native File Dialogs (Windows Explorer)
```typescript
import { open, save } from '@tauri-apps/plugin-dialog';

// Multi-file selection for log ingestion
const selected = await open({
  multiple: true,
  filters: [
    { name: 'Data & Logs', extensions: ['csv', 'parquet', 'json', 'evtx', 'log'] },
    { name: 'All Files', extensions: ['*'] }
  ]
});
```

### Windows System Tray
```rust
use tauri::{tray::TrayIconBuilder, menu::{Menu, MenuItem}};

let quit = MenuItem::with_id(app, "quit", "Exit Toad", true, None::<&str>)?;
let menu = Menu::with_items(app, &[&quit])?;

TrayIconBuilder::new()
    .icon(app.default_window_icon().unwrap().clone())
    .menu(&menu)
    .on_menu_event(|app, event| {
        if event.id == "quit" {
            app.exit(0);
        }
    })
    .build(app)?;
```

---

## 8. Performance & Big Data Best Practices

| Bottleneck | Bad Practice | Recommended Pattern |
| :--- | :--- | :--- |
| **Large Result Sets** | Returning `Vec<T>` with 500k objects via `invoke` | Use `tauri::ipc::Channel` for streaming or `Response::new(raw_bytes)` |
| **Blocking Work** | Heavy DuckDB query directly in `#[tauri::command]` | Wrap in `tokio::task::spawn_blocking` or `tauri::async_runtime::spawn` |
| **State Contention** | `std::sync::Mutex` across frequent async threads | Use `parking_lot::RwLock` or channels / message queues |
| **Window State** | Manual registry or config saving | Use `tauri-plugin-window-state` |
| **Packaging Size** | Bundling full chromium browser (Electron) | Tauri uses host WebView2: portable build binary is ~10-15 MB (or ~70 MB with embedded DuckDB/Rust engine) |

---

## 9. AI Developer Cheat Sheet (Quick Syntax Verification)

- **Import `invoke`**: `import { invoke } from '@tauri-apps/api/core';` *(Never `@tauri-apps/api/tauri`)*
- **Import `listen` / `emit`**: `import { listen, emit } from '@tauri-apps/api/event';`
- **Register State in Rust**: `app.manage(MyState::new());` -> Access in handler with `state: State<'_, MyState>`
- **Async Commands**: Always make command `async fn my_cmd(...) -> Result<T, E>` if doing I/O or background compute.
- **Return Errors**: Convert Rust error to string or serialize custom error struct: `.map_err(|e| e.to_string())`.
- **Capability Schema**: Always ensure `src-tauri/capabilities/default.json` includes `core:default` and required plugin namespaces.

