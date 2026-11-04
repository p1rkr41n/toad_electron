//! Toad Desktop Tauri v2 Core Engine
//!
//! Features:
//! - F03: Portable directory resolution & config.ini management
//! - F04: AppState concurrency & panic guard
//! - F05: Native OS plugins (single instance, window state, dialog, opener, clipboard, fs)
//! - F06: Command dispatcher & aliases router

pub mod commands;
pub mod engine;
pub mod ingest;
pub mod ledger;
pub mod logger;
pub mod portable;
pub mod state;

#[cfg_attr(test, allow(unused_imports))]
use tauri::{Emitter, Manager};

#[cfg(not(test))]
pub fn build_app() -> Result<tauri::Builder<tauri::Wry>, Box<dyn std::error::Error>> {
    let (paths, config) = portable::ensure_portable_environment(None)?;
    let _ = logger::init_logger(&paths.logs_dir, &config.system.log_level);
    let app_state = state::AppState::new(paths.app_data_dir, config);

    let builder = tauri::Builder::default()
        // MANDATORY: Single instance MUST be the first plugin registered!
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            tracing::info!(
                args = ?args,
                cwd = ?cwd,
                "Single instance triggered; focusing existing window and forwarding args"
            );
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
                let _ = window.emit(
                    "toad:single-instance-open",
                    serde_json::json!({
                        "args": args,
                        "cwd": cwd,
                    }),
                );
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .manage(app_state)
        .invoke_handler(commands::dispatch_invoke());

    Ok(builder)
}

/// Main application entry point invoked from main.rs
#[cfg(not(test))]
pub fn run() {
    tracing::info!("Starting Toad Desktop v2.5.1 Core Runtime...");

    match build_app() {
        Ok(builder) => {
            builder
                .run(tauri::generate_context!())
                .expect("Failed to run Toad Tauri v2 application");
        }
        Err(e) => {
            eprintln!("Fatal error during Toad initialization: {}", e);
            tracing::error!("Fatal error during Toad initialization: {}", e);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_portable_paths_and_config() {
        let temp_dir = std::env::temp_dir().join("toad_test_lib_init");
        let (paths, config) = portable::ensure_portable_environment(Some(&temp_dir)).unwrap();

        assert!(paths.app_data_dir.exists());
        assert!(paths.temp_dir.exists());
        assert!(paths.logs_dir.exists());
        assert!(paths.config_path.exists());
        assert_eq!(config.general.viewer, "toad");

        let _ = std::fs::remove_dir_all(&paths.app_data_dir);
        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
