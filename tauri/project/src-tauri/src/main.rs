// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    toad_lib::run();
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::Arc;
    use toad_lib::commands::{route_command, system, CommandAction};
    use toad_lib::logger::{init_logger, ErrorResponse};
    use toad_lib::portable::{
        clean_temp_dir, detect_or_create_app_data_dir, ensure_portable_environment,
        load_or_create_config, parse_ini, resolve_portable_dir, save_config, serialize_ini,
        ToadConfig,
    };
    use toad_lib::state::AppState;

    #[test]
    fn test_portable_directory_resolution() {
        let temp_dir = std::env::temp_dir().join("toad_test_res_dir");
        let _ = fs::create_dir_all(&temp_dir);
        let resolved = resolve_portable_dir(Some(&temp_dir)).unwrap();
        assert!(resolved.app_data_dir.exists());

        let default_resolved = resolve_portable_dir(None).unwrap();
        assert!(default_resolved.app_data_dir.exists());
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_app_data_detection_and_creation() {
        let temp_root = std::env::temp_dir().join("toad_test_appdata_detect");
        let _ = fs::remove_dir_all(&temp_root);
        fs::create_dir_all(&temp_root).unwrap();

        // 1. Initial creation
        let dir1 = detect_or_create_app_data_dir(&temp_root).unwrap();
        assert!(dir1.exists());
        let folder_name = dir1.file_name().unwrap().to_str().unwrap();
        assert!(folder_name.starts_with("toadAppData_"));

        // 2. Deterministic reuse: subsequent call in same directory reuses existing folder
        let dir2 = detect_or_create_app_data_dir(&temp_root).unwrap();
        assert_eq!(dir1, dir2);

        let _ = fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn test_ini_parser_and_serializer_roundtrip() {
        let sample_ini = r#"
# Global configuration comment
[general]
viewer = toad
language = en
page_size = 1000

[duckdb]
threads = 8
max_memory = auto

[system]
log_level = debug
temp_cleanup = false
"#;

        let parsed = parse_ini(sample_ini);
        assert_eq!(parsed.get("general").unwrap().get("viewer").unwrap(), "toad");
        assert_eq!(parsed.get("general").unwrap().get("language").unwrap(), "en");
        assert_eq!(parsed.get("general").unwrap().get("page_size").unwrap(), "1000");
        assert_eq!(parsed.get("duckdb").unwrap().get("threads").unwrap(), "8");
        assert_eq!(parsed.get("system").unwrap().get("log_level").unwrap(), "debug");
        assert_eq!(parsed.get("system").unwrap().get("temp_cleanup").unwrap(), "false");

        let default_cfg = ToadConfig::default();
        let serialized = serialize_ini(&default_cfg);
        let re_parsed = parse_ini(&serialized);
        assert_eq!(re_parsed.get("general").unwrap().get("viewer").unwrap(), "toad");
        assert_eq!(re_parsed.get("system").unwrap().get("log_level").unwrap(), "info");
    }

    #[test]
    fn test_config_load_and_auto_healing() {
        let temp_dir = std::env::temp_dir().join("toad_test_config_heal");
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();
        let cfg_path = temp_dir.join("config.ini");

        // Test 1: File does not exist -> creates default
        let cfg1 = load_or_create_config(&cfg_path).unwrap();
        assert_eq!(cfg1.general.viewer, "toad");
        assert_eq!(cfg1.system.log_level, "info");
        assert!(cfg_path.exists());

        // Test 2: Modify config and save
        let mut cfg_modified = cfg1.clone();
        cfg_modified.duckdb.threads = 12;
        cfg_modified.system.temp_cleanup = false;
        save_config(&cfg_path, &cfg_modified).unwrap();

        let reloaded = load_or_create_config(&cfg_path).unwrap();
        assert_eq!(reloaded.duckdb.threads, 12);
        assert_eq!(reloaded.system.temp_cleanup, false);

        // Test 3: Corrupted file -> auto-healing restores valid default configuration
        fs::write(&cfg_path, "!!! corrupted garbage %$# [invalid").unwrap();
        let healed = load_or_create_config(&cfg_path).unwrap();
        assert_eq!(healed.general.viewer, "toad");
        assert_eq!(healed.duckdb.threads, 0);

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_clean_temp_dir_preserves_ledger() {
        let temp_dir = std::env::temp_dir().join("toad_test_clean_temp");
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();

        // Create temporary parquet cache and garbage files
        let cache_parquet = temp_dir.join("scratch_cache_123.parquet");
        let scratch_tmp = temp_dir.join("temp_buffer.tmp");
        let ledger_parquet = temp_dir.join("toad_ledger.parquet");

        fs::write(&cache_parquet, b"parquet dummy cache").unwrap();
        fs::write(&scratch_tmp, b"temp buffer content").unwrap();
        fs::write(&ledger_parquet, b"CRITICAL LEDGER DATA").unwrap();

        // Run clean_temp_dir
        clean_temp_dir(&temp_dir).unwrap();

        // Assert scratch cache and tmp files are deleted
        assert!(!cache_parquet.exists(), "Temporary parquet cache must be deleted");
        assert!(!scratch_tmp.exists(), "Temporary buffer file must be deleted");

        // Assert toad_ledger.parquet is strictly preserved
        assert!(ledger_parquet.exists(), "toad_ledger.parquet must be preserved!");
        let ledger_content = fs::read(&ledger_parquet).unwrap();
        assert_eq!(ledger_content, b"CRITICAL LEDGER DATA");

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_ensure_portable_environment_complete_tree() {
        let temp_root = std::env::temp_dir().join("toad_test_portable_tree");
        let _ = fs::remove_dir_all(&temp_root);
        fs::create_dir_all(&temp_root).unwrap();

        let (paths, config) = ensure_portable_environment(Some(&temp_root)).unwrap();

        assert!(paths.app_data_dir.exists());
        assert!(paths.temp_dir.exists());
        assert!(paths.logs_dir.exists());
        assert!(paths.config_path.exists());
        assert_eq!(config.general.viewer, "toad");

        let _ = fs::remove_dir_all(&temp_root);
    }

    #[tokio::test]
    async fn test_app_state_concurrency() {
        let temp_dir = std::env::temp_dir().join("toad_test_state_concurrency");
        let _ = fs::create_dir_all(&temp_dir);
        let cfg = ToadConfig::default();
        let state = Arc::new(AppState::new(temp_dir.clone(), cfg));

        let mut handles = Vec::new();
        // Spawn 10 concurrent readers and writers
        for i in 0..10 {
            let state_clone = Arc::clone(&state);
            handles.push(tokio::spawn(async move {
                let current = state_clone.get_config().await;
                assert_eq!(current.general.viewer, "toad");

                if i % 2 == 0 {
                    let _ = state_clone
                        .update_config(|cfg| {
                            cfg.duckdb.threads = (i + 1) * 2;
                        })
                        .await;
                }
            }));
        }

        for handle in handles {
            handle.await.unwrap();
        }

        let final_cfg = state.get_config().await;
        assert!(final_cfg.general.viewer == "toad");

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_logger_initialization_and_error_dto() {
        let temp_dir = std::env::temp_dir().join("toad_test_logger");
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();

        let init_res = init_logger(&temp_dir, "debug");
        assert!(init_res.is_ok());

        // Test ErrorResponse structured DTOs
        let err1 = ErrorResponse::invalid_argument("Invalid SQL query syntax");
        assert_eq!(err1.code, "ERR_INVALID_ARGUMENT");
        assert_eq!(err1.message, "Invalid SQL query syntax");
        assert!(err1.details.is_none());

        let err2 = ErrorResponse::with_details(
            "INTERNAL_ERROR",
            "DuckDB execution failure",
            serde_json::json!({ "reason": "Out of memory" }),
        );
        assert_eq!(err2.code, "INTERNAL_ERROR");
        assert_eq!(err2.message, "DuckDB execution failure");
        assert_eq!(
            err2.details.as_ref().unwrap()["reason"],
            "Out of memory"
        );

        let err3 = ErrorResponse::not_implemented("Worksheet 42");
        assert_eq!(err3.code, "ERR_NOT_IMPLEMENTED");
        assert!(err3.message.contains("Worksheet 42"));

        // Verify JSON serialization contract
        let json_val = serde_json::to_value(&err2).unwrap();
        assert_eq!(json_val["code"], "INTERNAL_ERROR");
        assert_eq!(json_val["message"], "DuckDB execution failure");
        assert_eq!(json_val["details"]["reason"], "Out of memory");

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_system_command_handlers() {
        let temp_dir = std::env::temp_dir().join("toad_test_system_handlers");
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();

        let cfg = ToadConfig::default();
        let state = AppState::new(temp_dir.clone(), cfg);

        // Test handle_get_config
        let config_res = system::handle_get_config(&state).await;
        assert!(config_res.is_ok());
        let retrieved_cfg = config_res.unwrap();
        assert_eq!(retrieved_cfg.general.viewer, "toad");
        assert_eq!(retrieved_cfg.duckdb.threads, 0);

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_command_alias_routing_coverage() {
        // Genuine unit test asserting routing normalization through `toad_lib::commands::route_command`
        let commands = [
            ("toad:init_main", "initMain", CommandAction::InitMain),
            ("toad:get_config", "getToadConfig", CommandAction::GetConfig),
            ("toad:eval_query", "evalQuery", CommandAction::EvalQuery),
            ("toad:row_count", "rowCount", CommandAction::RowCount),
            ("toad:schema", "getTableSchema", CommandAction::Schema),
            ("toad:new_window", "newWindowFromDSPath", CommandAction::NewWindow),
            ("toad:open_file_dialog", "dialog:showOpenDialog", CommandAction::OpenFileDialog),
            ("toad:write_clipboard", "clipboard:writeText", CommandAction::WriteClipboard),
            ("toad:open_url", "shell:openExternal", CommandAction::OpenUrl),
            ("project:get_workspace", "get_workspace", CommandAction::ProjectGetWorkspace),
            ("project:get_files", "get_files", CommandAction::ProjectGetFiles),
            ("engine:get_status", "engine_status", CommandAction::EngineGetStatus),
        ];

        for (canonical, legacy, expected_action) in commands {
            assert_eq!(
                route_command(canonical),
                expected_action,
                "Canonical command '{}' must route to {:?}",
                canonical,
                expected_action
            );
            assert_eq!(
                route_command(legacy),
                expected_action,
                "Legacy alias '{}' must route to {:?}",
                legacy,
                expected_action
            );
        }

        // CRITICAL: Verify native Tauri plugin commands are NEVER hijacked and ALWAYS pass through
        let plugin_commands = [
            "plugin:dialog|open",
            "plugin:dialog|save",
            "plugin:dialog|message",
            "plugin:clipboard-manager|write_text",
            "plugin:clipboard-manager|read_text",
            "plugin:clipboard|write_text",
            "plugin:opener|open_url",
            "plugin:opener|open_path",
            "plugin:opener|reveal_item_in_dir",
            "plugin:fs|read_file",
            "plugin:fs|write_file",
            "plugin:window-state|save",
        ];

        for plugin_cmd in plugin_commands {
            assert_eq!(
                route_command(plugin_cmd),
                CommandAction::PluginPassthrough,
                "Plugin command '{}' must pass through to native Tauri plugins",
                plugin_cmd
            );
        }

        assert_eq!(
            route_command("nonexistent:command"),
            CommandAction::PluginPassthrough
        );
    }

    #[tokio::test]
    async fn test_app_state_atomicity_on_io_failure() {
        let temp_dir = std::env::temp_dir().join("toad_test_state_atomicity");
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();

        let cfg = ToadConfig::default();
        let invalid_config_dir = temp_dir.join("sub_dir_target");
        fs::create_dir_all(&invalid_config_dir).unwrap();

        let state = AppState {
            portable_dir: temp_dir.clone(),
            config_path: invalid_config_dir,
            config: Arc::new(tokio::sync::RwLock::new(cfg)),
            duckdb_engine: Arc::new(tokio::sync::RwLock::new(Default::default())),
            parquet_ledger: Arc::new(tokio::sync::RwLock::new(Default::default())),
            ingest_queue: Arc::new(tokio::sync::RwLock::new(Default::default())),
        };

        let res = state
            .update_config(|c| {
                c.general.page_size = 8888;
            })
            .await;

        assert!(res.is_err());
        assert_eq!(state.get_config().await.general.page_size, 1000);

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
