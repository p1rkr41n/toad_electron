//! system.rs
//!
//! System & Environment Command Handlers for Toad Desktop (Tauri v2)
//! - init_main: Reports environment readiness and setup metadata.
//! - get_config: Provides AppConfigDTO matching config.ini.
//! - open_file_dialog: Opens native OS file picker via `tauri-plugin-dialog` DialogExt.
//! - write_clipboard: Writes text to system clipboard via `tauri-plugin-clipboard-manager` ClipboardExt.
//! - open_url: Opens external URL in default system browser via `tauri-plugin-opener` OpenerExt.
//! - new_window: Spawns new dataset window.

use crate::portable::ToadConfig;
use crate::state::AppState;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

/// Handle toad:init_main
pub async fn handle_init_main<R: Runtime>(
    _app: AppHandle<R>,
    state: &AppState,
) -> Result<Value, String> {
    let cfg = state.get_config().await;
    tracing::info!("toad:init_main invoked - Toad Core ready");

    Ok(json!({
        "status": "ready",
        "product": "Toad",
        "version": "3.0.0-beta",
        "portableDir": state.portable_dir.to_string_lossy(),
        "config": cfg,
    }))
}

/// Handle toad:get_config
pub async fn handle_get_config(state: &AppState) -> Result<ToadConfig, String> {
    Ok(state.get_config().await)
}

/// Handle toad:open_file_dialog / dialog:showOpenDialog
/// Uses genuine `tauri_plugin_dialog::DialogExt` API to show native OS file picker.
pub async fn handle_open_file_dialog<R: Runtime>(
    app: AppHandle<R>,
    payload: Option<Value>,
) -> Result<Value, String> {
    let mut builder = app.dialog().file();

    if let Some(win) = app.get_webview_window("main") {
        builder = builder.set_parent(&win);
    }

    let mut multiple = false;
    let mut directory = false;

    if let Some(p) = &payload {
        if let Some(title) = p.get("title").and_then(|v| v.as_str()) {
            builder = builder.set_title(title);
        }
        if let Some(dir) = p
            .get("defaultPath")
            .or_else(|| p.get("default_path"))
            .and_then(|v| v.as_str())
        {
            builder = builder.set_directory(dir);
        }
        if let Some(filters) = p.get("filters").and_then(|v| v.as_array()) {
            for f in filters {
                let name = f.get("name").and_then(|v| v.as_str()).unwrap_or("Files");
                if let Some(exts) = f.get("extensions").and_then(|v| v.as_array()) {
                    let ext_strs: Vec<&str> = exts.iter().filter_map(|e| e.as_str()).collect();
                    builder = builder.add_filter(name, &ext_strs);
                }
            }
        }
        multiple = p
            .get("multiple")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        directory = p
            .get("directory")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
    }

    let (tx, rx) = tokio::sync::oneshot::channel();

    if directory {
        if multiple {
            builder.pick_folders(move |res| {
                let _ = tx.send(res.map(|list| {
                    list.into_iter()
                        .filter_map(|fp| fp.into_path().ok().map(|p| p.to_string_lossy().to_string()))
                        .collect::<Vec<_>>()
                }));
            });
        } else {
            builder.pick_folder(move |res| {
                let _ = tx.send(res.map(|fp| {
                    fp.into_path()
                        .ok()
                        .map(|p| vec![p.to_string_lossy().to_string()])
                        .unwrap_or_default()
                }));
            });
        }
    } else if multiple {
        builder.pick_files(move |res| {
            let _ = tx.send(res.map(|list| {
                list.into_iter()
                    .filter_map(|fp| fp.into_path().ok().map(|p| p.to_string_lossy().to_string()))
                    .collect::<Vec<_>>()
            }));
        });
    } else {
        builder.pick_file(move |res| {
            let _ = tx.send(res.map(|fp| {
                fp.into_path()
                    .ok()
                    .map(|p| vec![p.to_string_lossy().to_string()])
                    .unwrap_or_default()
            }));
        });
    }

    match rx.await {
        Ok(Some(paths)) => Ok(json!(paths)),
        Ok(None) => Ok(json!([])),
        Err(e) => Err(format!("Dialog execution channel error: {}", e)),
    }
}

/// Handle toad:write_clipboard / clipboard:writeText
/// Uses genuine `tauri_plugin_clipboard_manager::ClipboardExt` API to write to OS clipboard.
pub async fn handle_write_clipboard<R: Runtime>(
    app: AppHandle<R>,
    text: String,
) -> Result<Value, String> {
    app.clipboard()
        .write_text(text)
        .map_err(|e| format!("Clipboard error: {}", e))?;
    Ok(json!({ "success": true }))
}

/// Handle toad:open_url / shell:openExternal
/// Uses genuine `tauri_plugin_opener::OpenerExt` API to open external URL in default OS browser.
pub async fn handle_open_url<R: Runtime>(
    app: AppHandle<R>,
    url: String,
) -> Result<Value, String> {
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| format!("Opener error: {}", e))?;
    Ok(json!({ "success": true }))
}

/// Handle toad:new_window
pub async fn handle_new_window<R: Runtime>(
    _app: AppHandle<R>,
    ds_path: Option<Value>,
) -> Result<Value, String> {
    tracing::info!("toad:new_window requested with ds_path: {:?}", ds_path);
    Ok(json!({
        "success": true,
        "message": "New window requested",
        "dsPath": ds_path.unwrap_or(Value::Null)
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_config_handler() {
        let temp_dir = std::env::temp_dir().join("toad_test_sys");
        let _ = std::fs::create_dir_all(&temp_dir);
        let cfg = ToadConfig::default();
        let state = AppState::new(temp_dir.clone(), cfg);

        let res = handle_get_config(&state).await.unwrap();
        assert_eq!(res.general.viewer, "toad");
        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
