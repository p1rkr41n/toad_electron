//! mod.rs
//!
//! Tauri Command Router & Aliases Dispatcher for Toad Desktop
//! - Normalizes namespaced commands (`toad:*`, `project:*`, `engine:*`) and legacy aliases (`evalQuery`, etc.).
//! - Routes system requests to `commands::system` handlers.
//! - Provides clean typed DTO stubs for Query (M3), Ledger (M4), and Forensics (M5).

pub mod system;

use crate::state::AppState;
use serde_json::{json, Value};
use tauri::ipc::{Invoke, InvokeBody, Response};
use tauri::Manager;

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
            // ================================================================
            // Core Toad System Commands
            // ================================================================
            "toad:init_main" | "initMain" | "init_main" => {
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

            "toad:get_config" | "getToadConfig" | "get_config" => {
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

            "toad:open_file_dialog" | "plugin:dialog|open" | "dialog:showOpenDialog" => {
                let resolver = invoke.resolver;
                tauri::async_runtime::spawn(async move {
                    match system::handle_open_file_dialog(app.clone(), Some(payload)).await {
                        Ok(res) => resolver.resolve(res),
                        Err(e) => resolver.reject(e),
                    }
                });
                true
            }

            "toad:write_clipboard"
            | "plugin:clipboard|write_text"
            | "plugin:clipboard-manager|write_text"
            | "clipboard:writeText" => {
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

            "toad:open_url" | "plugin:opener|open_url" | "shell:openExternal" => {
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

            "toad:new_window" | "newWindowFromDSPath" | "new_window" => {
                let resolver = invoke.resolver;
                tauri::async_runtime::spawn(async move {
                    match system::handle_new_window(app.clone(), Some(payload)).await {
                        Ok(res) => resolver.resolve(res),
                        Err(e) => resolver.reject(e),
                    }
                });
                true
            }

            "toad:get_setup_info" | "getSetupInfo" | "get_setup_info" => {
                invoke.resolver.resolve(json!({
                    "appName": "Toad",
                    "version": "2.5.1",
                    "engine": "tauri",
                    "platform": "win32"
                }));
                true
            }

            "toad:open_example" | "openExample" | "open_example" => {
                invoke.resolver.resolve(json!({
                    "success": true,
                    "message": "Example opened"
                }));
                true
            }

            // ================================================================
            // Query & Engine Stubs (Ready for Milestone M3)
            // ================================================================
            "toad:eval_query" | "DataSourceConnection.evalQuery" | "evalQuery" | "toad:query" | "eval_query" => {
                // Return Arrow IPC stream continuation marker (0xFFFFFFFF) placeholder
                let stream_marker = vec![0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00];
                invoke.resolver.resolve(Response::new(stream_marker));
                true
            }

            "toad:row_count" | "DataSourceConnection.rowCount" | "rowCount" | "row_count" => {
                invoke.resolver.resolve(json!({ "rowCount": 0 }));
                true
            }

            "toad:schema"
            | "toad:get_table_schema"
            | "DataSourceConnection.getTableSchema"
            | "schema"
            | "getTableSchema"
            | "get_table_schema" => {
                invoke.resolver.resolve(json!({
                    "columns": [],
                    "columnTypes": {}
                }));
                true
            }

            "toad:run_sql_arrow" | "DataSourceConnection.runSqlQueryArrow" | "run_sql_arrow" => {
                let stream_marker = vec![0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00];
                invoke.resolver.resolve(Response::new(stream_marker));
                true
            }

            "toad:get_table_name" | "DataSourceConnection.getTableName" | "getTableName" | "get_table_name" => {
                invoke.resolver.resolve(json!("main_table"));
                true
            }

            // ================================================================
            // Project Workspace CRUD Stubs (Ready for Milestone M4)
            // ================================================================
            "project:get_workspace" | "project:getWorkspace" | "get_workspace" => {
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

            "project:get_files" | "project:getFiles" | "get_files" => {
                invoke.resolver.resolve(json!({
                    "projectId": "default",
                    "files": []
                }));
                true
            }

            "project:add_files" | "project:addFiles" | "add_files" => {
                invoke.resolver.resolve(json!({ "addedFiles": [] }));
                true
            }

            "project:add_folder" | "project:addFolder" | "add_folder" => {
                invoke.resolver.resolve(json!({ "addedFiles": [] }));
                true
            }

            "project:delete" | "delete_project" => {
                invoke.resolver.resolve(json!({ "success": true }));
                true
            }

            "project:rename" | "rename_project" => {
                invoke.resolver.resolve(json!({ "success": true }));
                true
            }

            "project:create" | "create_project" => {
                invoke.resolver.resolve(json!({
                    "projectId": "new_project",
                    "name": "New Project"
                }));
                true
            }

            "project:set_active" | "project:setActive" | "set_active" => {
                invoke.resolver.resolve(json!({ "success": true }));
                true
            }

            "project:reconcile" | "reconcile_project" => {
                invoke.resolver.resolve(json!({
                    "success": true,
                    "reconciledFiles": 0
                }));
                true
            }

            "project:delete_all" | "project:deleteAll" | "delete_all" => {
                invoke.resolver.resolve(json!({ "success": true }));
                true
            }

            "project:get_cache_size" | "project:getCacheSize" | "get_cache_size" => {
                invoke.resolver.resolve(json!({
                    "cacheSizeBytes": 0,
                    "formatted": "0 B"
                }));
                true
            }

            "project:purge_cache" | "project:purgeCache" | "purge_cache" => {
                invoke.resolver.resolve(json!({
                    "purgedBytes": 0,
                    "filesRemoved": 0
                }));
                true
            }

            "project:remove_file" | "project:removeFile" | "remove_file" => {
                invoke.resolver.resolve(json!({ "success": true }));
                true
            }

            "project:move_orphan_files" | "project:moveOrphanFiles" | "move_orphan_files" => {
                invoke.resolver.resolve(json!({ "movedCount": 0 }));
                true
            }

            // ================================================================
            // Engine Control Stubs
            // ================================================================
            "engine:get_status" | "engine:status" | "engine_status" => {
                invoke.resolver.resolve(json!({
                    "engine": "duckdb-1.0",
                    "status": "READY",
                    "activeConnections": 1
                }));
                true
            }

            "engine:do_restart" | "engine:restart" | "engine_restart" => {
                invoke.resolver.resolve(json!({ "restarted": true }));
                true
            }

            _ => {
                tracing::debug!("Unrecognized command bypassed to Tauri plugin pipeline: {}", cmd);
                false
            }
        }
    }
}
