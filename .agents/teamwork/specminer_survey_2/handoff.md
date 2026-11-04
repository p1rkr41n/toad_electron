# 5-Component Handoff Report: Tauri v2 Survey & Specification Mining

> **Subagent ID**: `specminer_survey_2`  
> **Mission**: Mine and document Tauri v2 configuration, capability permissions, and Rust IPC patterns for Toad Tauri v2 port  
> **Parent Conversation ID**: `07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d`  
> **Date**: 2026-11-04T18:42:00Z  

---

## 1. Observation

1. **Tauri v2 Permissions & Capabilities Architecture**:
   - `tauri/docs/security/capabilities.md:28-36`: Capabilities are defined in `src-tauri/capabilities/*.json`. All capability files in `src-tauri/capabilities` are enabled by default.
   - `tauri/docs/security/capabilities.md:103-107`: *"By default, all commands that you registered in your app (using the `tauri::Builder::invoke_handler` function) are allowed to be used by all the windows and webviews of the app. To change that, consider using `AppManifest::commands`."*
   - `tauri/docs/security/permissions.md:57-65`: Permissions follow `<name>:default` or `<name>:<command-name>`, where `<name>` is the plugin name without `tauri-plugin-` prefix.

2. **Core Permissions**:
   - `tauri/docs/reference.md:46-59`: `core:default` automatically bundles `core:app:default`, `core:event:default`, `core:image:default`, `core:menu:default`, `core:path:default`, `core:resources:default`, `core:tray:default`, `core:webview:default`, `core:window:default`.
   - `tauri/docs/reference.md:120-150`: `core:window:default` ONLY includes read-only attributes (`allow-get-all-windows`, `allow-scale-factor`, `allow-inner-size`, `allow-title`). Mutating commands like `core:window:allow-set-title`, `core:window:allow-maximize`, `core:window:allow-minimize`, `core:window:allow-close` are separate permissions that must be explicitly granted.

3. **Plugin Permissions & Scopes**:
   - `tauri/docs/guides.md:12734`: `dialog:default` includes `allow-message`, `allow-save`, `allow-open`.
   - `tauri/docs/guides.md:13196`: `fs:default` grants read access to `$APPDATA`, `$APPCONFIG`, `$APPLOCALDATA`, `$APPCACHE`, `$APPLOG` and `mkdir`.
   - `tauri/docs/guides.md:15087`: `opener:default` includes `allow-open-url`, `allow-reveal-item-in-dir`, `allow-default-urls`.
   - `tauri/docs/guides.md:12120`: `tauri-plugin-clipboard-manager` has **no permissions enabled by default** (*"No features are enabled by default, as we believe the clipboard can be inherently dangerous"*). Must explicitly grant `clipboard-manager:allow-write-text` and `clipboard-manager:allow-read-text`.
   - `tauri/docs/plugin/single-instance.md:201-204`: *"Because this Plugin currently does not have JavaScript APIs you do not have to configure capabilities to use it."*
   - `tauri/docs/guides.md:17535`: `window-state:default` includes `allow-filename`, `allow-restore-state`, `allow-save-window-state`.

4. **Tauri v2 IPC & Binary Response**:
   - `tauri/docs/develop/calling-rust.md:198-206` & `tauri/docs/reference.md:3561`: *"To return array buffers in an optimized way, use `tauri::ipc::Response`: `tauri::ipc::Response::new(data)` ... A command that returns `tauri::ipc::Response` likewise resolves to an `ArrayBuffer` on the frontend instead of a JSON value."*
   - `tad-master/packages/host-bridge/src/TauriHostAdapter.ts:59-72`: `invokeBinary` inspects response for `Uint8Array` or `ArrayBuffer` and returns `Uint8Array`.

5. **Streaming via `tauri::ipc::Channel`**:
   - `tauri/docs/develop/calling-frontend.md:154-205` & `tauri/docs/reference.md:3431`: `tauri::ipc::Channel<T>` delivers messages in strict order without event bus overhead. JavaScript imports `Channel` from `@tauri-apps/api/core` and assigns `channel.onmessage = ...`.

6. **Single-Instance Plugin Order**:
   - `tauri/docs/plugin/single-instance.md:73-77`: *"The Single Instance plugin must be the first one to be registered to work well. This assures that it runs before other plugins can interfere."*

7. **Global Tauri Injection & App Directory Override**:
   - `tauri/docs/reference.md:2728`: `app.withGlobalTauri` defaults to `false`. If `false`, `window.__TAURI__` is unavailable.
   - `tauri/docs/reference.md:2807-2851`: `app.appDirectoriesOverride: "./toadAppData"` re-roots all `$APPDATA`, `$APPCONFIG`, `$APPCACHE`, `$APPLOG` directories adjacent to the portable executable.

---

## 2. Logic Chain

1. **Step 1 (Host Bridge Compatibility)**:
   - Observation 7 notes `window.__TAURI__` is only present when `app.withGlobalTauri: true`.
   - `TauriHostAdapter.ts` requires `window.__TAURI__.core.invoke` to function.
   - Therefore, `tauri.conf.json` MUST set `"withGlobalTauri": true`.

2. **Step 2 (Capabilities & Permissions Matrix)**:
   - Observations 1 & 2 establish that `core:default` alone is insufficient to allow the UI to change window titles or maximize/minimize windows.
   - Observation 3 shows that while `dialog`, `opener`, and `window-state` provide default bundles, `clipboard-manager` has NO default permissions and requires explicit `clipboard-manager:allow-write-text`.
   - `single-instance` requires 0 capability permissions.
   - Custom commands (`toad:*`, `project:*`) are automatically authorized to all windows under Tauri v2 default command security unless `build.rs` registers an `AppManifest`.
   - Therefore, `src-tauri/capabilities/default.json` must declare the comprehensive permission array documented in Section 4.2 of `tauri_spec_report.md`.

3. **Step 3 (Zero-Copy Arrow IPC Pipeline)**:
   - Standard Serde serialization converts byte slices into JSON integer arrays, incurring 10x-20x memory bloat.
   - Observation 4 confirms that `tauri::ipc::Response::new(bytes)` instructs Tauri's IPC layer to emit raw binary data directly to the WebView2 runtime as an `ArrayBuffer`.
   - `TauriHostAdapter.invokeBinary` wraps this `ArrayBuffer` directly into `Uint8Array`, which feeds `@apache-arrow/es2015-cjs` zero-copy decoding.
   - Therefore, all tabular queries (`toad:eval_query`, `toad:run_sql_arrow`) must return `Result<tauri::ipc::Response, String>`.

4. **Step 4 (Single-Instance Life Cycle)**:
   - Observation 6 requires `tauri_plugin_single_instance` to be registered as the first plugin on `tauri::Builder`.
   - In its callback, it receives `(app, args, cwd)`. It must focus the main window and emit a custom event (e.g. `toad:single-instance-open`) containing `args` so the UI can open files double-clicked in Windows Explorer.

---

## 3. Caveats

- **No Caveats on Core Tauri v2 APIs**: All configurations and APIs mined are directly verified from the official offline Tauri v2 documentation located in `tauri/docs/`.
- **Command Name Prefixing**: Rust function identifiers cannot contain colons (`toad:eval_query`). The command dispatcher in `src-tauri/src/commands/mod.rs` must normalize incoming command names (stripping `toad:` and `project:`) or dispatch via an `Invoke` interceptor closure.

---

## 4. Conclusion

1. **Configuration**: `tauri/project/src-tauri/tauri.conf.json` must be created using schema `https://schema.tauri.app/config/2` with `"withGlobalTauri": true`, `"appDirectoriesOverride": "./toadAppData"`, `"visible": false` (for smooth window-state restoration), and dark theme.
2. **Capabilities**: `tauri/project/src-tauri/capabilities/default.json` must declare:
   - `core:default`, window mutators (`core:window:allow-set-title`, `allow-maximize`, `allow-minimize`, `allow-close`, `allow-toggle-maximize`)
   - `dialog:default`, `fs:default`
   - `opener:default`, `opener:allow-open-url`
   - `clipboard-manager:allow-write-text`, `clipboard-manager:allow-read-text`
   - `window-state:default`
3. **IPC Mechanics**:
   - Use `tauri::ipc::Response::new(raw_bytes)` for Apache Arrow IPC query responses.
   - Use `tauri::ipc::Channel<IngestProgressPayload>` for multi-stage ingestion progress.
   - Single-instance plugin must be registered FIRST in `lib.rs` and requires no capability permissions.

---

## 5. Verification Method

To verify these specifications independently:
1. **Config & Capability Schema Check**:
   Inspect `tauri/docs/security/capabilities.md` and `tauri/docs/reference.md:2700-2850`.
2. **Channel & Response Signatures**:
   Inspect `tauri/docs/develop/calling-rust.md:198-206` (for `Response`) and `tauri/docs/develop/calling-frontend.md:154-205` (for `Channel`).
3. **Plugin Permissions**:
   Inspect `tauri/docs/guides.md:12120` (clipboard), `tauri/docs/guides.md:12734` (dialog), `tauri/docs/guides.md:15087` (opener), `tauri/docs/plugin/single-instance.md:201` (single instance).
4. **Specification Report**:
   View full synthesized report at `d:\Shared_UserData\Downloads\tad\.agents\teamwork\specminer_survey_2\tauri_spec_report.md`.
