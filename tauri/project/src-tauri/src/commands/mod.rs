//! mod.rs
//!
//! Tauri Command Router & Aliases Dispatcher for Toad Desktop
//! - Classifies and normalizes namespaced commands (`toad:*`, `project:*`, `engine:*`) and legacy aliases (`evalQuery`, etc.).
//! - Passes all native Tauri plugin commands (`plugin:*`) through to Tauri's registered plugins (`return false`).
//! - Routes system requests to `commands::system` handlers with genuine plugin extension traits.
//! - Provides clean typed DTO stubs for Query (M3), Ledger (M4), and Forensics (M5).

pub mod query;
pub mod system;

use crate::state::AppState;
use serde_json::{json, Value};
use tauri::ipc::{Invoke, InvokeBody};
use tauri::Manager;

/// Discrete actions supported by the Toad command dispatcher
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandAction {
    // System Commands
    InitMain,
    GetConfig,
    OpenFileDialog,
    WriteClipboard,
    OpenUrl,
    NewWindow,
    GetSetupInfo,
    OpenExample,

    // Query & Engine Stubs (Milestone M3)
    EvalQuery,
    RowCount,
    Schema,
    RunSqlArrow,
    GetTableName,

    // Project Workspace CRUD Stubs (Milestone M4)
    ProjectGetWorkspace,
    ProjectGetFiles,
    ProjectAddFiles,
    ProjectAddFolder,
    ProjectDelete,
    ProjectRename,
    ProjectCreate,
    ProjectSetActive,
    ProjectReconcile,
    ProjectDeleteAll,
    ProjectGetCacheSize,
    ProjectPurgeCache,
    ProjectRemoveFile,
    ProjectMoveOrphanFiles,

    // Engine Control Stubs
    EngineGetStatus,
    EngineDoRestart,

    /// Native Tauri plugin commands (or unhandled commands) bypassed to the plugin pipeline
    PluginPassthrough,
}

/// Classify an incoming IPC command string into a `CommandAction`.
/// Canonical Tauri plugin command strings (`plugin:*`) MUST NOT be matched here,
/// ensuring they resolve to `CommandAction::PluginPassthrough`.
pub fn route_command(cmd: &str) -> CommandAction {
    match cmd {
        // ================================================================
        // Core Toad System Commands
        // ================================================================
        "toad:init_main" | "initMain" | "init_main" => CommandAction::InitMain,
        "toad:get_config" | "getToadConfig" | "get_config" => CommandAction::GetConfig,
        "toad:open_file_dialog" | "dialog:showOpenDialog" => CommandAction::OpenFileDialog,
        "toad:write_clipboard" | "clipboard:writeText" => CommandAction::WriteClipboard,
        "toad:open_url" | "shell:openExternal" => CommandAction::OpenUrl,
        "toad:new_window" | "newWindowFromDSPath" | "new_window" => CommandAction::NewWindow,
        "toad:get_setup_info" | "getSetupInfo" | "get_setup_info" => CommandAction::GetSetupInfo,
        "toad:open_example" | "openExample" | "open_example" => CommandAction::OpenExample,

        // ================================================================
        // Query & Engine Stubs (Milestone M3)
        // ================================================================
        "toad:eval_query"
        | "DataSourceConnection.evalQuery"
        | "evalQuery"
        | "toad:query"
        | "eval_query" => CommandAction::EvalQuery,

        "toad:row_count"
        | "DataSourceConnection.rowCount"
        | "rowCount"
        | "row_count" => CommandAction::RowCount,

        "toad:schema"
        | "toad:get_table_schema"
        | "DataSourceConnection.getTableSchema"
        | "schema"
        | "getTableSchema"
        | "get_table_schema" => CommandAction::Schema,

        "toad:run_sql_arrow"
        | "DataSourceConnection.runSqlQueryArrow"
        | "run_sql_arrow" => CommandAction::RunSqlArrow,

        "toad:get_table_name"
        | "DataSourceConnection.getTableName"
        | "getTableName"
        | "get_table_name" => CommandAction::GetTableName,

        // ================================================================
        // Project Workspace CRUD Stubs (Milestone M4)
        // ================================================================
        "project:get_workspace" | "project:getWorkspace" | "get_workspace" => {
            CommandAction::ProjectGetWorkspace
        }
        "project:get_files" | "project:getFiles" | "get_files" => {
            CommandAction::ProjectGetFiles
        }
        "project:add_files" | "project:addFiles" | "add_files" => {
            CommandAction::ProjectAddFiles
        }
        "project:add_folder" | "project:addFolder" | "add_folder" => {
            CommandAction::ProjectAddFolder
        }
        "project:delete" | "delete_project" => CommandAction::ProjectDelete,
        "project:rename" | "rename_project" => CommandAction::ProjectRename,
        "project:create" | "create_project" => CommandAction::ProjectCreate,
        "project:set_active" | "project:setActive" | "set_active" => {
            CommandAction::ProjectSetActive
        }
        "project:reconcile" | "reconcile_project" => CommandAction::ProjectReconcile,
        "project:delete_all" | "project:deleteAll" | "delete_all" => {
            CommandAction::ProjectDeleteAll
        }
        "project:get_cache_size" | "project:getCacheSize" | "get_cache_size" => {
            CommandAction::ProjectGetCacheSize
        }
        "project:purge_cache" | "project:purgeCache" | "purge_cache" => {
            CommandAction::ProjectPurgeCache
        }
        "project:remove_file" | "project:removeFile" | "remove_file" => {
            CommandAction::ProjectRemoveFile
        }
        "project:move_orphan_files" | "project:moveOrphanFiles" | "move_orphan_files" => {
            CommandAction::ProjectMoveOrphanFiles
        }

        // ================================================================
        // Engine Control Stubs
        // ================================================================
        "engine:get_status" | "engine:status" | "engine_status" => {
            CommandAction::EngineGetStatus
        }
        "engine:do_restart" | "engine:restart" | "engine_restart" => {
            CommandAction::EngineDoRestart
        }

        // Any other command (including canonical `plugin:*`) falls through
        _ => CommandAction::PluginPassthrough,
    }
}

/// Build the custom invoke handler closure for Tauri Builder
pub fn dispatch_invoke() -> impl Fn(Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    move |invoke: Invoke<tauri::Wry>| {
        let cmd = invoke.message.command().to_string();
        let app = invoke.message.webview().app_handle().clone();

        let payload: Value = match invoke.message.payload() {
            InvokeBody::Json(val) => val.clone(),
            InvokeBody::Raw(_) => Value::Null,
        };

        match route_command(cmd.as_str()) {
            CommandAction::PluginPassthrough => {
                tracing::debug!("Bypassing unintercepted/plugin command to Tauri plugin pipeline: {}", cmd);
                false
            }

            CommandAction::InitMain => {
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

            CommandAction::GetConfig => {
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

            CommandAction::OpenFileDialog => {
                let resolver = invoke.resolver;
                tauri::async_runtime::spawn(async move {
                    match system::handle_open_file_dialog(app.clone(), Some(payload)).await {
                        Ok(res) => resolver.resolve(res),
                        Err(e) => resolver.reject(e),
                    }
                });
                true
            }

            CommandAction::WriteClipboard => {
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

            CommandAction::OpenUrl => {
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

            CommandAction::NewWindow => {
                let resolver = invoke.resolver;
                tauri::async_runtime::spawn(async move {
                    match system::handle_new_window(app.clone(), Some(payload)).await {
                        Ok(res) => resolver.resolve(res),
                        Err(e) => resolver.reject(e),
                    }
                });
                true
            }

            CommandAction::GetSetupInfo => {
                invoke.resolver.resolve(json!({
                    "appName": "Toad",
                    "version": "2.5.1",
                    "engine": "tauri",
                    "platform": "win32"
                }));
                true
            }

            CommandAction::OpenExample => {
                invoke.resolver.resolve(json!({
                    "success": true,
                    "message": "Example opened"
                }));
                true
            }

            CommandAction::EvalQuery => {
                let resolver = invoke.resolver;
                tauri::async_runtime::spawn(async move {
                    let state = app.state::<AppState>();
                    match query::handle_eval_query(app.clone(), &state, payload).await {
                        Ok(res) => resolver.resolve(res),
                        Err(e) => resolver.reject(e),
                    }
                });
                true
            }

            CommandAction::RowCount => {
                let resolver = invoke.resolver;
                tauri::async_runtime::spawn(async move {
                    let state = app.state::<AppState>();
                    match query::handle_row_count(app.clone(), &state, payload).await {
                        Ok(res) => resolver.resolve(res),
                        Err(e) => resolver.reject(e),
                    }
                });
                true
            }

            CommandAction::Schema => {
                let resolver = invoke.resolver;
                tauri::async_runtime::spawn(async move {
                    let state = app.state::<AppState>();
                    match query::handle_schema(app.clone(), &state, payload).await {
                        Ok(res) => resolver.resolve(res),
                        Err(e) => resolver.reject(e),
                    }
                });
                true
            }

            CommandAction::RunSqlArrow => {
                let resolver = invoke.resolver;
                tauri::async_runtime::spawn(async move {
                    let state = app.state::<AppState>();
                    match query::handle_run_sql_arrow(app.clone(), &state, payload).await {
                        Ok(res) => resolver.resolve(res),
                        Err(e) => resolver.reject(e),
                    }
                });
                true
            }

            CommandAction::GetTableName => {
                let resolver = invoke.resolver;
                tauri::async_runtime::spawn(async move {
                    let state = app.state::<AppState>();
                    match query::handle_get_table_name(app.clone(), &state, payload).await {
                        Ok(res) => resolver.resolve(res),
                        Err(e) => resolver.reject(e),
                    }
                });
                true
            }

            CommandAction::ProjectGetWorkspace => {
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

            CommandAction::ProjectGetFiles => {
                invoke.resolver.resolve(json!({
                    "projectId": "default",
                    "files": []
                }));
                true
            }

            CommandAction::ProjectAddFiles | CommandAction::ProjectAddFolder => {
                invoke.resolver.resolve(json!({ "addedFiles": [] }));
                true
            }

            CommandAction::ProjectDelete => {
                invoke.resolver.resolve(json!({ "success": true }));
                true
            }

            CommandAction::ProjectRename => {
                invoke.resolver.resolve(json!({ "success": true }));
                true
            }

            CommandAction::ProjectCreate => {
                invoke.resolver.resolve(json!({
                    "projectId": "new_project",
                    "name": "New Project"
                }));
                true
            }

            CommandAction::ProjectSetActive => {
                invoke.resolver.resolve(json!({ "success": true }));
                true
            }

            CommandAction::ProjectReconcile => {
                invoke.resolver.resolve(json!({
                    "success": true,
                    "reconciledFiles": 0
                }));
                true
            }

            CommandAction::ProjectDeleteAll => {
                invoke.resolver.resolve(json!({ "success": true }));
                true
            }

            CommandAction::ProjectGetCacheSize => {
                invoke.resolver.resolve(json!({
                    "cacheSizeBytes": 0,
                    "formatted": "0 B"
                }));
                true
            }

            CommandAction::ProjectPurgeCache => {
                invoke.resolver.resolve(json!({
                    "purgedBytes": 0,
                    "filesRemoved": 0
                }));
                true
            }

            CommandAction::ProjectRemoveFile => {
                invoke.resolver.resolve(json!({ "success": true }));
                true
            }

            CommandAction::ProjectMoveOrphanFiles => {
                invoke.resolver.resolve(json!({ "movedCount": 0 }));
                true
            }

            CommandAction::EngineGetStatus => {
                invoke.resolver.resolve(json!({
                    "engine": "duckdb-1.0",
                    "status": "READY",
                    "activeConnections": 1
                }));
                true
            }

            CommandAction::EngineDoRestart => {
                invoke.resolver.resolve(json!({ "restarted": true }));
                true
            }
        }
    }
}
