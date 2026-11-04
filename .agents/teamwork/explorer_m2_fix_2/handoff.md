# Technical Investigation & Test Remediation Report: Milestone 2 Command Alias Routing Test Design

**Author**: Explorer M2-Fix-2 (Genuine Command Routing Test Design)  
**Target Milestone**: Milestone 2 Remediation (Rust Core Engine & OS Plugins — Features F05, F06)  
**Target Scope**:
- `tauri/project/src-tauri/src/main.rs` (Lines 258–277)
- `tauri/project/src-tauri/src/commands/mod.rs`  
**Date**: 2026-11-04T20:25:00Z  

---

## 1. Observation

### 1.1 The Identified Integrity Violation in `src/main.rs` (Lines 258–277)

In `tauri/project/src-tauri/src/main.rs`, the test `test_command_alias_routing_coverage` was implemented verbatim as follows:

```rust
    #[test]
    fn test_command_alias_routing_coverage() {
        // Verify canonical and legacy alias mapping sets
        let commands = [
            ("toad:init_main", "initMain"),
            ("toad:get_config", "getToadConfig"),
            ("toad:eval_query", "evalQuery"),
            ("toad:row_count", "rowCount"),
            ("toad:schema", "getTableSchema"),
            ("toad:new_window", "newWindowFromDSPath"),
            ("project:get_workspace", "get_workspace"),
            ("project:get_files", "get_files"),
            ("engine:get_status", "engine_status"),
        ];

        for (canonical, legacy) in commands {
            assert!(!canonical.is_empty());
            assert!(!legacy.is_empty());
        }
    }
```

**Verifiable Observations**:
1. `test_command_alias_routing_coverage` does not call `toad_lib::commands::dispatch_invoke`, nor any function or constant from the application library.
2. It instantiates an array of 9 tuples of string literals defined solely within the test function scope.
3. The assertions `assert!(!canonical.is_empty())` and `assert!(!legacy.is_empty())` merely verify that the string literals written in the test itself are not empty strings.
4. If every command handler and alias were deleted from `commands/mod.rs`, this test would still pass unconditionally.
5. In the Forensic Auditor report (`d:\Shared_UserData\Downloads\tad\.agents\teamwork\auditor_m2_1\handoff.md`, Check 1 & Section 1.1), this test was flagged as a **CRITICAL INTEGRITY VIOLATION (REJECTED)** for being a tautological / self-certifying dummy test.

---

### 1.2 Root Cause in `src/commands/mod.rs`

Inspection of `tauri/project/src-tauri/src/commands/mod.rs` (Lines 15–288) reveals why the original developer wrote this tautological test:

```rust
/// Build the custom invoke handler closure for Tauri Builder
pub fn dispatch_invoke() -> impl Fn(Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    move |invoke: Invoke<tauri::Wry>| {
        let cmd = invoke.message.command().to_string();
        let app = invoke.message.webview().app_handle().clone();

        let payload: Value = match invoke.message.payload() {
            InvokeBody::Json(val) => val.clone(),
            InvokeBody::Raw(_) => Value::Null,
        };

        match cmd.as_str() {
            "toad:init_main" | "initMain" | "init_main" => { ... true }
            "toad:get_config" | "getToadConfig" | "get_config" => { ... true }
            ...
            _ => {
                tracing::debug!("Unrecognized command bypassed to Tauri plugin pipeline: {}", cmd);
                false
            }
        }
    }
}
```

**Verifiable Architectural Bottlenecks**:
1. `dispatch_invoke()` returns a closure accepting `Invoke<tauri::Wry>`.
2. In Tauri v2, `Invoke<R>` is an internal IPC construct produced by the Tauri webview runtime (`tauri::ipc::Invoke`). Tauri v2 does not expose a public standalone constructor for `Invoke` for unit testing without initializing an active `AppHandle` and webview.
3. Because alias normalization and command execution were tightly coupled inside the closure's `match cmd.as_str()`, there was **no standalone, callable function or mapping table** exposed for unit tests to inspect or exercise.
4. Facing the inability to construct `Invoke<tauri::Wry>` in a unit test, the developer took an unacceptable shortcut: writing a tautological test that tested nothing in the codebase.

---

### 1.3 Canonical Contract in Frontend Bridge (`commandAliases.ts`)

Inspection of `tad-master/packages/host-bridge/src/commandAliases.ts` defines the canonical frontend-to-backend command alias mapping table:
- 29 canonical commands across 4 operational domains:
  - **Core Toad System**: `toad:init_main`, `toad:get_config`, `toad:new_window`, `toad:get_setup_info`, `toad:open_example`, `toad:open_file_dialog`, `toad:write_clipboard`, `toad:open_url`.
  - **Query Engine & DTOs**: `toad:eval_query`, `toad:row_count`, `toad:schema`, `toad:run_sql_arrow`, `toad:get_table_name`.
  - **Project Workspace CRUD**: `project:get_workspace`, `project:get_files`, `project:add_files`, `project:add_folder`, `project:delete`, `project:rename`, `project:create`, `project:set_active`, `project:reconcile`, `project:delete_all`, `project:get_cache_size`, `project:purge_cache`, `project:remove_file`, `project:move_orphan_files`.
  - **Engine Control**: `engine:get_status`, `engine:do_restart`.
- Plus legacy Electron aliases (e.g., `initMain`, `getToadConfig`, `evalQuery`, `DataSourceConnection.evalQuery`, `rowCount`, `getTableSchema`, `get_workspace`, `engine_status`) and snake_case variants.

---

## 2. Logic Chain

1. **Integrity Mandate**:
   - The project's zero-cheating principle strictly forbids tautological tests, dummy checks, and fake assertions.
   - Tests must assert observable properties of application code. If the application logic changes, breaks, or regresses, the test MUST fail.

2. **Decoupling Strategy (Single Responsibility Principle)**:
   - Command dispatching in Tauri v2 consists of two distinct concerns:
     1. **Command Normalization (Pure Logic)**: Given an incoming raw command string `&str` (which may be a canonical name, a legacy camelCase alias, or a snake_case alias), resolve it to its canonical command identifier `&'static str`, or return `None` if unrecognized / delegated.
     2. **Command Execution (I/O & Tauri Runtime)**: Dispatch the resolved canonical command to the appropriate handler using `InvokeResolver` and `AppHandle`.
   - By extracting Command Normalization into a public, pure function:
     ```rust
     pub fn normalize_command(cmd: &str) -> Option<&'static str>
     ```
     we decouple the routing and aliasing logic from Tauri's runtime types (`Invoke<tauri::Wry>`).

3. **Synergy with Native Plugin Anti-Hijacking (Fix for Auditor Finding 2)**:
   - In Tauri v2, native plugin calls (e.g., `"plugin:dialog|open"`, `"plugin:clipboard|write_text"`, `"plugin:opener|open_url"`) must NOT be intercepted by Toad's custom command router; they must return `false` so Tauri's internal plugin router dispatches them to native OS dialogs and clipboard APIs.
   - Under this normalization design:
     - `normalize_command("plugin:dialog|open")` evaluates to `None`.
     - `normalize_command("unknown:command")` evaluates to `None`.
     - In `dispatch_invoke()`, any command returning `None` immediately returns `false` (bypassing directly to Tauri's plugin pipeline).
   - This cleanly fixes the plugin hijacking issue while providing a centralized, verifiable gatekeeper for all incoming IPC calls.

4. **Authentic Test Strategy (Zero Tautology)**:
   - With `normalize_command` exposed in `toad_lib::commands`, the unit test in `src/main.rs`:
     1. Calls `normalize_command(alias)` on every known canonical name and legacy alias.
     2. Asserts `assert_eq!(normalize_command(alias), Some(expected_canonical))`.
     3. Asserts negative pass-through cases: `assert_eq!(normalize_command("plugin:dialog|open"), None)` and `assert_eq!(normalize_command("bogus_cmd"), None)`.
   - **Falsifiability Check**:
     - If an alias is removed or mistyped in the backend, `assert_eq!` immediately fails.
     - If a developer accidentally intercepts a plugin command in `normalize_command`, the bypass test immediately fails.
     - The test exercises real, production-compiled application code.

---

## 3. Caveats

1. **Scope of Unit Testing**:
   - `normalize_command` unit tests verify 100% of the command identification and alias routing logic.
   - Testing end-to-end execution of Tauri commands involving live OS GUI windows or webviews requires integration tests or Tauri's mock context (`tauri::test`). Handlers themselves (`system::handle_get_config`, etc.) are separately unit-tested in `commands/system.rs` and `main.rs`.
2. **Companion Test in `adversarial_m2_tests.rs`**:
   - In `tests/adversarial_m2_tests.rs:512-558` (`adv_test_command_aliases_exhaustive_table_validation`), the test previously validated a local vector against a HashSet and mistakenly listed `"plugin:dialog|open"` as an alias of `"toad:open_file_dialog"`.
   - While the auditor's specific integrity violation was cited in `src/main.rs:258-277`, the remediation worker should also update `adv_test_command_aliases_exhaustive_table_validation` to assert against `normalize_command`.

---

## 4. Conclusion & Actionable Fix Recommendation

> **Note for Worker M2**: As an Explorer, this report contains technical designs and code specifications only. Source files have not been modified. Apply the following changes to implement the fix.

### 4.1 Recommended Changes in `tauri/project/src-tauri/src/commands/mod.rs`

#### A. Add `normalize_command` Function

Add the following public function in `tauri/project/src-tauri/src/commands/mod.rs`:

```rust
/// Normalizes an incoming raw command string (canonical, legacy Electron alias,
/// or snake_case alias) into its canonical command identifier.
///
/// Returns `Some(&'static str)` for recognized Toad commands.
/// Returns `None` for native plugin commands (e.g., `plugin:dialog|open`) or
/// unrecognized commands, indicating they should bypass custom dispatching.
pub fn normalize_command(cmd: &str) -> Option<&'static str> {
    match cmd {
        // ================================================================
        // Core Toad System Commands
        // ================================================================
        "toad:init_main" | "initMain" | "init_main" => Some("toad:init_main"),
        "toad:get_config" | "getToadConfig" | "get_config" => Some("toad:get_config"),
        "toad:open_file_dialog" | "dialog:showOpenDialog" => Some("toad:open_file_dialog"),
        "toad:write_clipboard" | "clipboard:writeText" => Some("toad:write_clipboard"),
        "toad:open_url" | "shell:openExternal" => Some("toad:open_url"),
        "toad:new_window" | "newWindowFromDSPath" | "new_window" => Some("toad:new_window"),
        "toad:get_setup_info" | "getSetupInfo" | "get_setup_info" => Some("toad:get_setup_info"),
        "toad:open_example" | "openExample" | "open_example" => Some("toad:open_example"),

        // ================================================================
        // Query & Engine Stubs (Milestone M3)
        // ================================================================
        "toad:eval_query"
        | "DataSourceConnection.evalQuery"
        | "evalQuery"
        | "toad:query"
        | "eval_query" => Some("toad:eval_query"),

        "toad:row_count"
        | "DataSourceConnection.rowCount"
        | "rowCount"
        | "row_count" => Some("toad:row_count"),

        "toad:schema"
        | "toad:get_table_schema"
        | "DataSourceConnection.getTableSchema"
        | "schema"
        | "getTableSchema"
        | "get_table_schema" => Some("toad:schema"),

        "toad:run_sql_arrow"
        | "DataSourceConnection.runSqlQueryArrow"
        | "run_sql_arrow" => Some("toad:run_sql_arrow"),

        "toad:get_table_name"
        | "DataSourceConnection.getTableName"
        | "getTableName"
        | "get_table_name" => Some("toad:get_table_name"),

        // ================================================================
        // Project Workspace CRUD Stubs (Milestone M4)
        // ================================================================
        "project:get_workspace" | "project:getWorkspace" | "get_workspace" => {
            Some("project:get_workspace")
        }
        "project:get_files" | "project:getFiles" | "get_files" => Some("project:get_files"),
        "project:add_files" | "project:addFiles" | "add_files" => Some("project:add_files"),
        "project:add_folder" | "project:addFolder" | "add_folder" => Some("project:add_folder"),
        "project:delete" | "delete_project" => Some("project:delete"),
        "project:rename" | "rename_project" => Some("project:rename"),
        "project:create" | "create_project" => Some("project:create"),
        "project:set_active" | "project:setActive" | "set_active" => Some("project:set_active"),
        "project:reconcile" | "reconcile_project" => Some("project:reconcile"),
        "project:delete_all" | "project:deleteAll" | "delete_all" => Some("project:delete_all"),
        "project:get_cache_size" | "project:getCacheSize" | "get_cache_size" => {
            Some("project:get_cache_size")
        }
        "project:purge_cache" | "project:purgeCache" | "purge_cache" => {
            Some("project:purge_cache")
        }
        "project:remove_file" | "project:removeFile" | "remove_file" => {
            Some("project:remove_file")
        }
        "project:move_orphan_files" | "project:moveOrphanFiles" | "move_orphan_files" => {
            Some("project:move_orphan_files")
        }

        // ================================================================
        // Engine Control Stubs
        // ================================================================
        "engine:get_status" | "engine:status" | "engine_status" => Some("engine:get_status"),
        "engine:do_restart" | "engine:restart" | "engine_restart" => Some("engine:do_restart"),

        // All other commands (including plugin:dialog|open, plugin:clipboard|write_text, etc.)
        _ => None,
    }
}
```

#### B. Refactor `dispatch_invoke()` to Use `normalize_command`

Replace lines 26–287 in `commands/mod.rs` with clean dispatching on normalized commands:

```rust
pub fn dispatch_invoke() -> impl Fn(Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    move |invoke: Invoke<tauri::Wry>| {
        let raw_cmd = invoke.message.command();
        let canonical_cmd = match normalize_command(raw_cmd) {
            Some(cmd) => cmd,
            None => {
                tracing::debug!("Unrecognized command bypassed to Tauri plugin pipeline: {}", raw_cmd);
                return false;
            }
        };

        let app = invoke.message.webview().app_handle().clone();
        let payload: Value = match invoke.message.payload() {
            InvokeBody::Json(val) => val.clone(),
            InvokeBody::Raw(_) => Value::Null,
        };

        match canonical_cmd {
            // Core Toad System Commands
            "toad:init_main" => {
                let resolver = invoke.resolver;
                tauri::async_runtime::spawn(async move {
                    let state = app.state::<AppState>();
                    match system::handle_init_main(app.clone(), &state).await {
                        Ok(res) => resolver.resolve(res),
                        Err(e) => resolver.reject(e),
                    }
                });
                true
            }

            "toad:get_config" => {
                let resolver = invoke.resolver;
                tauri::async_runtime::spawn(async move {
                    let state = app.state::<AppState>();
                    match system::handle_get_config(&state).await {
                        Ok(res) => resolver.resolve(res),
                        Err(e) => resolver.reject(e),
                    }
                });
                true
            }

            "toad:open_file_dialog" => {
                let resolver = invoke.resolver;
                tauri::async_runtime::spawn(async move {
                    match system::handle_open_file_dialog(app.clone(), Some(payload)).await {
                        Ok(res) => resolver.resolve(res),
                        Err(e) => resolver.reject(e),
                    }
                });
                true
            }

            "toad:write_clipboard" => {
                let text = payload
                    .get("text")
                    .and_then(|t| t.as_str())
                    .unwrap_or("")
                    .to_string();
                let resolver = invoke.resolver;
                tauri::async_runtime::spawn(async move {
                    match system::handle_write_clipboard(app.clone(), text).await {
                        Ok(res) => resolver.resolve(res),
                        Err(e) => resolver.reject(e),
                    }
                });
                true
            }

            "toad:open_url" => {
                let url = payload
                    .get("url")
                    .and_then(|u| u.as_str())
                    .unwrap_or("")
                    .to_string();
                let resolver = invoke.resolver;
                tauri::async_runtime::spawn(async move {
                    match system::handle_open_url(app.clone(), url).await {
                        Ok(res) => resolver.resolve(res),
                        Err(e) => resolver.reject(e),
                    }
                });
                true
            }

            "toad:new_window" => {
                let resolver = invoke.resolver;
                tauri::async_runtime::spawn(async move {
                    match system::handle_new_window(app.clone(), Some(payload)).await {
                        Ok(res) => resolver.resolve(res),
                        Err(e) => resolver.reject(e),
                    }
                });
                true
            }

            "toad:get_setup_info" => {
                invoke.resolver.resolve(json!({
                    "appName": "Toad",
                    "version": "2.5.1",
                    "engine": "tauri",
                    "platform": "win32"
                }));
                true
            }

            "toad:open_example" => {
                invoke.resolver.resolve(json!({
                    "success": true,
                    "message": "Example opened"
                }));
                true
            }

            // Query & Engine Stubs (Milestone M3)
            "toad:eval_query" => {
                let stream_marker = vec![0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00];
                invoke.resolver.resolve(Response::new(stream_marker));
                true
            }

            "toad:row_count" => {
                invoke.resolver.resolve(json!({ "rowCount": 0 }));
                true
            }

            "toad:schema" => {
                invoke.resolver.resolve(json!({
                    "columns": [],
                    "columnTypes": {}
                }));
                true
            }

            "toad:run_sql_arrow" => {
                let stream_marker = vec![0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00];
                invoke.resolver.resolve(Response::new(stream_marker));
                true
            }

            "toad:get_table_name" => {
                invoke.resolver.resolve(json!("main_table"));
                true
            }

            // Project Workspace CRUD Stubs (Milestone M4)
            "project:get_workspace" => {
                invoke.resolver.resolve(json!({
                    "activeProjectId": "default",
                    "projects": [
                        {
                            "id": "default",
                            "name": "Untitled-1",
                            "createdAt": 0,
                            "filesCount": 0
                        }
                    ]
                }));
                true
            }

            "project:get_files" => {
                invoke.resolver.resolve(json!({
                    "projectId": "default",
                    "files": []
                }));
                true
            }

            "project:add_files" => {
                invoke.resolver.resolve(json!({ "addedFiles": [] }));
                true
            }

            "project:add_folder" => {
                invoke.resolver.resolve(json!({ "addedFiles": [] }));
                true
            }

            "project:delete" => {
                invoke.resolver.resolve(json!({ "success": true }));
                true
            }

            "project:rename" => {
                invoke.resolver.resolve(json!({ "success": true }));
                true
            }

            "project:create" => {
                invoke.resolver.resolve(json!({
                    "projectId": "new_project",
                    "name": "New Project"
                }));
                true
            }

            "project:set_active" => {
                invoke.resolver.resolve(json!({ "success": true }));
                true
            }

            "project:reconcile" => {
                invoke.resolver.resolve(json!({
                    "success": true,
                    "reconciledFiles": 0
                }));
                true
            }

            "project:delete_all" => {
                invoke.resolver.resolve(json!({ "success": true }));
                true
            }

            "project:get_cache_size" => {
                invoke.resolver.resolve(json!({
                    "cacheSizeBytes": 0,
                    "formatted": "0 B"
                }));
                true
            }

            "project:purge_cache" => {
                invoke.resolver.resolve(json!({
                    "purgedBytes": 0,
                    "filesRemoved": 0
                }));
                true
            }

            "project:remove_file" => {
                invoke.resolver.resolve(json!({ "success": true }));
                true
            }

            "project:move_orphan_files" => {
                invoke.resolver.resolve(json!({ "movedCount": 0 }));
                true
            }

            // Engine Control Stubs
            "engine:get_status" => {
                invoke.resolver.resolve(json!({
                    "engine": "duckdb-1.0",
                    "status": "READY",
                    "activeConnections": 1
                }));
                true
            }

            "engine:do_restart" => {
                invoke.resolver.resolve(json!({ "restarted": true }));
                true
            }

            _ => false,
        }
    }
}
```

---

### 4.2 Recommended Replacement in `tauri/project/src-tauri/src/main.rs` (Lines 258–277)

Replace the tautological test in `src/main.rs` with the following genuine test that tests application routing logic directly:

```rust
    #[test]
    fn test_command_alias_routing_coverage() {
        use toad_lib::commands::normalize_command;

        // Exhaustive test cases of (input_alias, expected_canonical_command)
        let alias_test_cases = [
            // Core Toad System Commands
            ("toad:init_main", "toad:init_main"),
            ("initMain", "toad:init_main"),
            ("init_main", "toad:init_main"),
            ("toad:get_config", "toad:get_config"),
            ("getToadConfig", "toad:get_config"),
            ("get_config", "toad:get_config"),
            ("toad:open_file_dialog", "toad:open_file_dialog"),
            ("dialog:showOpenDialog", "toad:open_file_dialog"),
            ("toad:write_clipboard", "toad:write_clipboard"),
            ("clipboard:writeText", "toad:write_clipboard"),
            ("toad:open_url", "toad:open_url"),
            ("shell:openExternal", "toad:open_url"),
            ("toad:new_window", "toad:new_window"),
            ("newWindowFromDSPath", "toad:new_window"),
            ("new_window", "toad:new_window"),
            ("toad:get_setup_info", "toad:get_setup_info"),
            ("getSetupInfo", "toad:get_setup_info"),
            ("get_setup_info", "toad:get_setup_info"),
            ("toad:open_example", "toad:open_example"),
            ("openExample", "toad:open_example"),
            ("open_example", "toad:open_example"),

            // Query & Engine Stubs (Milestone M3)
            ("toad:eval_query", "toad:eval_query"),
            ("DataSourceConnection.evalQuery", "toad:eval_query"),
            ("evalQuery", "toad:eval_query"),
            ("toad:query", "toad:eval_query"),
            ("eval_query", "toad:eval_query"),
            ("toad:row_count", "toad:row_count"),
            ("DataSourceConnection.rowCount", "toad:row_count"),
            ("rowCount", "toad:row_count"),
            ("row_count", "toad:row_count"),
            ("toad:schema", "toad:schema"),
            ("toad:get_table_schema", "toad:schema"),
            ("DataSourceConnection.getTableSchema", "toad:schema"),
            ("schema", "toad:schema"),
            ("getTableSchema", "toad:schema"),
            ("get_table_schema", "toad:schema"),
            ("toad:run_sql_arrow", "toad:run_sql_arrow"),
            ("DataSourceConnection.runSqlQueryArrow", "toad:run_sql_arrow"),
            ("run_sql_arrow", "toad:run_sql_arrow"),
            ("toad:get_table_name", "toad:get_table_name"),
            ("DataSourceConnection.getTableName", "toad:get_table_name"),
            ("getTableName", "toad:get_table_name"),
            ("get_table_name", "toad:get_table_name"),

            // Project Workspace CRUD Stubs (Milestone M4)
            ("project:get_workspace", "project:get_workspace"),
            ("project:getWorkspace", "project:get_workspace"),
            ("get_workspace", "project:get_workspace"),
            ("project:get_files", "project:get_files"),
            ("project:getFiles", "project:get_files"),
            ("get_files", "project:get_files"),
            ("project:add_files", "project:add_files"),
            ("project:addFiles", "project:add_files"),
            ("add_files", "project:add_files"),
            ("project:add_folder", "project:add_folder"),
            ("project:addFolder", "project:add_folder"),
            ("add_folder", "project:add_folder"),
            ("project:delete", "project:delete"),
            ("delete_project", "project:delete"),
            ("project:rename", "project:rename"),
            ("rename_project", "project:rename"),
            ("project:create", "project:create"),
            ("create_project", "project:create"),
            ("project:set_active", "project:set_active"),
            ("project:setActive", "project:set_active"),
            ("set_active", "project:set_active"),
            ("project:reconcile", "project:reconcile"),
            ("reconcile_project", "project:reconcile"),
            ("project:delete_all", "project:delete_all"),
            ("project:deleteAll", "project:delete_all"),
            ("delete_all", "project:delete_all"),
            ("project:get_cache_size", "project:get_cache_size"),
            ("project:getCacheSize", "project:get_cache_size"),
            ("get_cache_size", "project:get_cache_size"),
            ("project:purge_cache", "project:purge_cache"),
            ("project:purgeCache", "project:purge_cache"),
            ("purge_cache", "project:purge_cache"),
            ("project:remove_file", "project:remove_file"),
            ("project:removeFile", "project:remove_file"),
            ("remove_file", "project:remove_file"),
            ("project:move_orphan_files", "project:move_orphan_files"),
            ("project:moveOrphanFiles", "project:move_orphan_files"),
            ("move_orphan_files", "project:move_orphan_files"),

            // Engine Control Stubs
            ("engine:get_status", "engine:get_status"),
            ("engine:status", "engine:get_status"),
            ("engine_status", "engine:get_status"),
            ("engine:do_restart", "engine:do_restart"),
            ("engine:restart", "engine:do_restart"),
            ("engine_restart", "engine:do_restart"),
        ];

        // 1. Verify every alias resolves to its expected canonical command
        for (alias, expected_canonical) in alias_test_cases {
            let actual = normalize_command(alias);
            assert_eq!(
                actual,
                Some(expected_canonical),
                "Alias '{}' must normalize to canonical command '{}', but got '{:?}'",
                alias,
                expected_canonical,
                actual
            );
        }

        // 2. Anti-hijacking & bypass verification:
        // Native Tauri plugin commands MUST return None to allow Tauri to route them natively
        assert_eq!(
            normalize_command("plugin:dialog|open"),
            None,
            "Native dialog plugin command must NOT be intercepted"
        );
        assert_eq!(
            normalize_command("plugin:dialog|save"),
            None,
            "Native dialog save command must NOT be intercepted"
        );
        assert_eq!(
            normalize_command("plugin:clipboard|write_text"),
            None,
            "Native clipboard write command must NOT be intercepted"
        );
        assert_eq!(
            normalize_command("plugin:clipboard-manager|write_text"),
            None,
            "Native clipboard-manager write command must NOT be intercepted"
        );
        assert_eq!(
            normalize_command("plugin:opener|open_url"),
            None,
            "Native opener command must NOT be intercepted"
        );

        // 3. Unrecognized command returns None
        assert_eq!(normalize_command("unknown:nonexistent_command"), None);
        assert_eq!(normalize_command(""), None);
    }
```

---

## 5. Verification Method

Once Worker M2 applies the recommendations above, independent verification can be performed with the following commands:

### 5.1 Unit Test Target Execution
Execute strictly the command alias test:
```powershell
cargo test --manifest-path tauri/project/src-tauri/Cargo.toml test_command_alias_routing_coverage -- --nocapture
```
Expected output:
```
test tests::test_command_alias_routing_coverage ... ok
test result: ok. 1 passed; 0 failed
```

### 5.2 Full Test Suite Execution
Execute the entire test suite across all targets:
```powershell
cargo test --manifest-path tauri/project/src-tauri/Cargo.toml
```
Expected output:
- 10 tests passing in `src/main.rs`
- 6 tests passing in `tests/core_tests.rs`
- 11 tests passing in `tests/adversarial_m2_tests.rs`
- 0 failed, 0 errors.

### 5.3 Inspection Verification
1. Inspect `src/main.rs`:
   ```powershell
   Get-Content -Path tauri\project\src-tauri\src\main.rs | Select-String -Pattern "assert!\(!canonical.is_empty\(\)\)"
   ```
   Must return 0 matches (no tautological assertion remains).
2. Inspect `src/commands/mod.rs`:
   ```powershell
   Get-Content -Path tauri\project\src-tauri\src\commands\mod.rs | Select-String -Pattern "pub fn normalize_command"
   ```
   Must return the function signature.

### 5.4 Invalidation Conditions
This recommendation will be invalidated if:
1. `normalize_command` fails to compile with `toad_lib::commands::normalize_command`.
2. Any canonical command or legacy alias in `commandAliases.ts` fails to resolve.
3. Native plugin commands (`plugin:dialog|open`, etc.) are resolved instead of returning `None`.
