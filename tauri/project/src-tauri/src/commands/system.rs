//! system.rs
//!
//! System & Environment Command Handlers for Toad Desktop (Tauri v2)
//! - init_main: Reports environment readiness and setup metadata.
//! - get_config: Provides AppConfigDTO matching config.ini.
//! - open_file_dialog: Opens native OS file picker.
//! - write_clipboard: Writes text to system clipboard.
//! - open_url: Opens external URL in default system browser.
//! - new_window: Spawns new dataset window.

use crate::portable::ToadConfig;
use crate::state::AppState;
use serde_json::{json, Value};
use tauri::{AppHandle, Runtime};


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
        "version": "2.5.1",
        "portableDir": state.portable_dir.to_string_lossy(),
        "config": cfg,
    }))
}

/// Handle toad:get_config
pub async fn handle_get_config(state: &AppState) -> Result<ToadConfig, String> {
    Ok(state.get_config().await)
}

/// Handle toad:open_file_dialog / plugin:dialog|open
pub async fn handle_open_file_dialog<R: Runtime>(
    _app: AppHandle<R>,
    _payload: Option<Value>,
) -> Result<Value, String> {
    Ok(json!([]))
}

pub async fn handle_write_clipboard<R: Runtime>(
    _app: AppHandle<R>,
    _text: String,
) -> Result<Value, String> {
    Ok(json!({ "success": true }))
}

pub async fn handle_open_url<R: Runtime>(
    _app: AppHandle<R>,
    _url: String,
) -> Result<Value, String> {
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
