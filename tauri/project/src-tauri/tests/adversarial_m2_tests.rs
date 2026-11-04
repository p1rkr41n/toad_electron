//! adversarial_m2_tests.rs
//!
//! EMPIRICAL ADVERSARIAL STRESS TEST SUITE for Milestone 2
//! Critic & Empirical Challenger: Stress-testing assumptions, failure modes, concurrency,
//! config healing, and edge cases.

use std::collections::HashSet;
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use toad_lib::logger::ErrorResponse;
use toad_lib::portable::{
    clean_temp_dir, detect_or_create_app_data_dir, ensure_portable_environment,
    generate_portable_suffix, load_or_create_config, parse_ini, resolve_portable_dir,
    save_config, ToadConfig,
};
use toad_lib::state::AppState;

/// Helper: unique temporary test directory
fn create_test_dir(prefix: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("toad_adv_{}_{}", prefix, generate_portable_suffix()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("Failed to create test dir");
    dir
}

// ============================================================================
// 1. ADVERSARIAL SUFFIX GENERATION & APPDATA DETECTION
// ============================================================================

#[test]
fn adv_test_suffix_statistical_and_format_integrity() {
    let mut seen = HashSet::new();
    const ITERATIONS: usize = 1000;

    for _ in 0..ITERATIONS {
        let suffix = generate_portable_suffix();
        // Suffix must be strictly 5 lowercase alphanumeric characters
        assert_eq!(suffix.len(), 5, "Suffix length must be exactly 5");
        for c in suffix.chars() {
            assert!(
                c.is_ascii_lowercase() || c.is_ascii_digit(),
                "Suffix character '{}' is not lowercase alphanumeric",
                c
            );
        }
        seen.insert(suffix);
    }

    // High entropy check: across 1000 fast calls, there should be substantial unique values
    assert!(
        seen.len() > 800,
        "Entropy too low: only {} unique suffixes in 1000 iterations",
        seen.len()
    );
}

#[test]
fn adv_test_appdata_detection_adversarial_entries() {
    let test_dir = create_test_dir("appdata_adv");

    // 1. Place fake/invalid matching files and directories:
    // Regular file matching the name pattern (should NOT be detected as dir)
    let fake_file = test_dir.join("toadAppData_12345");
    File::create(&fake_file).unwrap();

    // Directory with non-alphanumeric suffix (should be ignored)
    let invalid_chars_dir = test_dir.join("toadAppData_!@#$%");
    fs::create_dir_all(&invalid_chars_dir).unwrap();

    // Directory too short (4 chars)
    let short_dir = test_dir.join("toadAppData_1234");
    fs::create_dir_all(&short_dir).unwrap();

    // Directory too long (6 chars)
    let long_dir = test_dir.join("toadAppData_123456");
    fs::create_dir_all(&long_dir).unwrap();

    // None of the above are valid toadAppData directories.
    // detect_or_create_app_data_dir should create a NEW legitimate directory!
    let created = detect_or_create_app_data_dir(&test_dir).unwrap();
    assert!(created.is_dir());
    let folder_name = created.file_name().unwrap().to_str().unwrap();
    assert!(folder_name.starts_with("toadAppData_"));
    assert_eq!(folder_name.len(), 17);
    assert_ne!(created, invalid_chars_dir);
    assert_ne!(created, short_dir);
    assert_ne!(created, long_dir);

    // 2. Deterministic reuse: Calling again MUST return the exact same created directory
    let reused = detect_or_create_app_data_dir(&test_dir).unwrap();
    assert_eq!(created, reused, "Expected deterministic reuse of existing appData dir");

    let _ = fs::remove_dir_all(&test_dir);
}

#[test]
fn adv_test_portable_dir_with_spaces_and_unicode() {
    let base_parent = std::env::temp_dir().join(format!("toad_unicode_{}", generate_portable_suffix()));
    let test_dir = base_parent.join("thư mục toad (portable test)");
    fs::create_dir_all(&test_dir).unwrap();

    let paths = resolve_portable_dir(Some(&test_dir)).unwrap();
    assert!(paths.app_data_dir.exists());
    assert!(paths.temp_dir.exists());
    assert!(paths.logs_dir.exists());
    assert_eq!(paths.base_dir, test_dir);

    let _ = fs::remove_dir_all(&base_parent);
}

// ============================================================================
// 2. ADVERSARIAL CONFIG AUTO-HEALING & CORRUPTION RESILIENCE
// ============================================================================

#[test]
fn adv_test_config_empty_file_auto_heals() {
    let test_dir = create_test_dir("cfg_empty");
    let cfg_path = test_dir.join("config.ini");

    // Create 0-byte file
    File::create(&cfg_path).unwrap();
    assert_eq!(fs::metadata(&cfg_path).unwrap().len(), 0);

    // Loading should heal to default config and rewrite file
    let cfg = load_or_create_config(&cfg_path).unwrap();
    assert_eq!(cfg.general.viewer, "toad");
    assert_eq!(cfg.general.page_size, 1000);
    assert_eq!(cfg.duckdb.threads, 0);

    // File should now be populated
    let content = fs::read_to_string(&cfg_path).unwrap();
    assert!(content.contains("[general]"));
    assert!(content.contains("page_size = 1000"));

    let _ = fs::remove_dir_all(&test_dir);
}

#[test]
fn adv_test_config_binary_garbage_and_malformed_syntax() {
    let test_dir = create_test_dir("cfg_garbage");
    let cfg_path = test_dir.join("config.ini");

    // Write hostile garbage: null bytes, invalid UTF-8 bytes, weird characters
    let mut f = File::create(&cfg_path).unwrap();
    f.write_all(b"\x00\xFF\xFE\x00\x01garbage====[[[not a section\r\n===key_without_val\r\n;;;;;\r\n").unwrap();
    drop(f);

    // load_or_create_config MUST NOT PANIC!
    let cfg = load_or_create_config(&cfg_path).unwrap();
    assert_eq!(cfg.general.viewer, "toad");
    assert_eq!(cfg.duckdb.threads, 0);

    // Re-serialized config should be healthy
    let repaired_content = fs::read_to_string(&cfg_path).unwrap();
    assert!(repaired_content.contains("[general]"));
    assert!(repaired_content.contains("viewer = toad"));

    let _ = fs::remove_dir_all(&test_dir);
}

#[test]
fn adv_test_config_extreme_numeric_and_type_tampering() {
    let test_dir = create_test_dir("cfg_extreme_nums");
    let cfg_path = test_dir.join("config.ini");

    let hostile_ini = r#"
[general]
viewer = custom_toad
language = fr
page_size = -999999999999999999999
max_concurrent_files = not_a_number
max_concurrent_gb = NaN
auto_restore_last_directory = maybe

[duckdb]
max_memory = 64GB
threads = 9999999999999999999999999999999999999999
background_threads = 2
add_raw_event = TRUE

[parquet]
compression = zstd
row_group_size = 0

[system]
temp_cleanup = FALSE
binary_guard = true
log_level = trace
"#;
    fs::write(&cfg_path, hostile_ini).unwrap();

    let cfg = load_or_create_config(&cfg_path).unwrap();

    // Custom string was preserved
    assert_eq!(cfg.general.viewer, "custom_toad");
    assert_eq!(cfg.general.language, "fr");
    // Invalid page_size (negative/overflow) safely defaulted
    assert_eq!(cfg.general.page_size, 1000);
    // Invalid max_concurrent_files safely defaulted
    assert_eq!(cfg.general.max_concurrent_files, 4);
    // duckdb.max_memory custom string preserved
    assert_eq!(cfg.duckdb.max_memory, "64GB");
    // duckdb.threads overflow safely defaulted to 0
    assert_eq!(cfg.duckdb.threads, 0);
    // booleans parsed case-insensitively
    assert_eq!(cfg.duckdb.add_raw_event, true);
    assert_eq!(cfg.system.temp_cleanup, false);
    assert_eq!(cfg.system.log_level, "trace");

    let _ = fs::remove_dir_all(&test_dir);
}

#[test]
fn adv_test_config_missing_sections_partial_recovery() {
    let test_dir = create_test_dir("cfg_partial");
    let cfg_path = test_dir.join("config.ini");

    // Only general section present, everything else missing
    let partial_ini = r#"
[general]
viewer = minimal_toad
language = es
page_size = 2500
"#;
    fs::write(&cfg_path, partial_ini).unwrap();

    let cfg = load_or_create_config(&cfg_path).unwrap();
    assert_eq!(cfg.general.viewer, "minimal_toad");
    assert_eq!(cfg.general.language, "es");
    assert_eq!(cfg.general.page_size, 2500);

    // Other sections safely fallback to default values
    assert_eq!(cfg.runtime.engine, "tauri");
    assert_eq!(cfg.duckdb.threads, 0);
    assert_eq!(cfg.parquet.compression, "snappy");
    assert_eq!(cfg.system.temp_cleanup, true);

    // File should have been rewritten to include missing sections (because duckdb was missing)
    let healed_content = fs::read_to_string(&cfg_path).unwrap();
    assert!(healed_content.contains("[duckdb]"));
    assert!(healed_content.contains("[parquet]"));
    assert!(healed_content.contains("[system]"));

    let _ = fs::remove_dir_all(&test_dir);
}

// ============================================================================
// 3. ADVERSARIAL TEMP CLEANUP & LEDGER IMMUTABILITY
// ============================================================================

#[test]
fn adv_test_clean_temp_dir_deep_hierarchy_and_ledger_protection() {
    let temp_dir = create_test_dir("clean_temp_adv");

    // Create a variety of files:
    // 1. Files that MUST be preserved:
    let ledger_1 = temp_dir.join("toad_ledger.parquet");
    let ledger_2 = temp_dir.join("PROJECT_A_LEDGER.PARQUET"); // uppercase
    let ledger_3 = temp_dir.join("session_123_ledger.parquet");
    let lock_1 = temp_dir.join("duckdb.lock");
    let lock_2 = temp_dir.join("workspace.LOCK"); // uppercase

    fs::write(&ledger_1, b"critical ledger 1").unwrap();
    fs::write(&ledger_2, b"critical ledger 2").unwrap();
    fs::write(&ledger_3, b"critical ledger 3").unwrap();
    fs::write(&lock_1, b"lock data 1").unwrap();
    fs::write(&lock_2, b"lock data 2").unwrap();

    // 2. Files and subdirectories that MUST be deleted:
    let cache_parquet = temp_dir.join("cached_query_result.parquet");
    let scratch_tmp = temp_dir.join("scratch_buffer.tmp");
    let random_txt = temp_dir.join("debug_notes.txt");
    fs::write(&cache_parquet, b"cache").unwrap();
    fs::write(&scratch_tmp, b"scratch").unwrap();
    fs::write(&random_txt, b"notes").unwrap();

    // Nested directory containing more junk
    let nested_dir = temp_dir.join("nested_cache_folder");
    fs::create_dir_all(&nested_dir).unwrap();
    fs::write(nested_dir.join("nested_file.parquet"), b"nested").unwrap();

    // Execute cleanup
    let cleaned_count = clean_temp_dir(&temp_dir).unwrap();
    assert!(cleaned_count >= 4, "Should have cleaned at least 4 items, got {}", cleaned_count);

    // Verify non-ledger files/folders removed
    assert!(!cache_parquet.exists(), "Cache parquet must be removed");
    assert!(!scratch_tmp.exists(), "Scratch tmp must be removed");
    assert!(!random_txt.exists(), "Arbitrary text must be removed");
    assert!(!nested_dir.exists(), "Nested folder must be removed");

    // Verify critical ledgers and locks PRESERVED
    assert!(ledger_1.exists(), "toad_ledger.parquet must be preserved");
    assert!(ledger_2.exists(), "PROJECT_A_LEDGER.PARQUET must be preserved (case insensitive)");
    assert!(ledger_3.exists(), "session_123_ledger.parquet must be preserved");
    assert!(lock_1.exists(), "duckdb.lock must be preserved");
    assert!(lock_2.exists(), "workspace.LOCK must be preserved (case insensitive)");

    assert_eq!(fs::read(&ledger_1).unwrap(), b"critical ledger 1");
    assert_eq!(fs::read(&ledger_2).unwrap(), b"critical ledger 2");

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn adv_test_clean_temp_dir_nonexistent_and_empty() {
    let non_existent = std::env::temp_dir().join(format!("toad_nonexistent_{}", generate_portable_suffix()));
    assert_eq!(clean_temp_dir(&non_existent).unwrap(), 0);

    let empty_dir = create_test_dir("clean_empty");
    assert_eq!(clean_temp_dir(&empty_dir).unwrap(), 0);
    let _ = fs::remove_dir_all(&empty_dir);
}

// ============================================================================
// 4. HIGH-CONCURRENCY MULTITHREADED READ/WRITE STRESS ON APPSTATE
// ============================================================================

#[tokio::test]
async fn adv_test_appstate_high_concurrency_stress() {
    let test_dir = create_test_dir("appstate_stress");
    let state = Arc::new(AppState::new(test_dir.clone(), ToadConfig::default()));

    const READERS: usize = 20;
    const WRITERS: usize = 15;
    const ITERATIONS_PER_TASK: usize = 30;

    let mut handles = Vec::new();

    // Spawn concurrent readers
    for r in 0..READERS {
        let state_c = Arc::clone(&state);
        handles.push(tokio::spawn(async move {
            for _ in 0..ITERATIONS_PER_TASK {
                let cfg = state_c.get_config().await;
                // Consistency check: viewer must always be a valid non-empty string
                assert!(!cfg.general.viewer.is_empty());
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
            r
        }));
    }

    // Spawn concurrent writers mutating different fields
    for w in 0..WRITERS {
        let state_c = Arc::clone(&state);
        handles.push(tokio::spawn(async move {
            for i in 0..ITERATIONS_PER_TASK {
                let res = state_c
                    .update_config(move |c| {
                        c.duckdb.threads = ((w * 100) + i) as u32;
                        c.general.page_size = (1000 + (w * 10) + i) as u64;
                    })
                    .await;
                assert!(res.is_ok(), "Concurrent update_config failed");
                tokio::time::sleep(Duration::from_millis(2)).await;
            }
            w + 100
        }));
    }

    // Await all tasks; ensure zero panics
    for h in handles {
        h.await.expect("Task panicked during high concurrency stress");
    }

    // Final integrity checks:
    let final_cfg = state.get_config().await;
    assert!(!final_cfg.general.viewer.is_empty());

    // Disk integrity: config.ini on disk MUST be syntactically valid and match final state
    let on_disk_cfg = load_or_create_config(&state.config_path).unwrap();
    assert_eq!(final_cfg.duckdb.threads, on_disk_cfg.duckdb.threads);
    assert_eq!(final_cfg.general.page_size, on_disk_cfg.general.page_size);

    let _ = fs::remove_dir_all(&test_dir);
}

// ============================================================================
// 5. ERROR RESPONSE CONTRACT & PANIC LOG RECOVERY
// ============================================================================

#[test]
fn adv_test_error_response_roundtrip_all_constructors() {
    let err1 = ErrorResponse::new("ERR_CODE", "Simple error");
    let err2 = ErrorResponse::with_details(
        "ERR_DETAILED",
        "Error with complex JSON",
        serde_json::json!({
            "nested": {
                "values": [1, 2, 3],
                "flag": true,
                "empty": null
            }
        }),
    );
    let err3 = ErrorResponse::not_implemented("Streaming EVTX SIMD");
    let err4 = ErrorResponse::invalid_argument("Expected integer, got string");
    let io_err = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "Access denied");
    let err5 = ErrorResponse::io_error(&io_err);
    let err6 = ErrorResponse::internal_error("Panic caught in worker thread");

    let errors = vec![err1, err2, err3, err4, err5, err6];

    for e in errors {
        // Must implement Display
        let display_str = format!("{}", e);
        assert!(display_str.contains(&e.code));
        assert!(display_str.contains(&e.message));

        // Must round-trip to/from JSON
        let json_str = serde_json::to_string(&e).unwrap();
        let decoded: ErrorResponse = serde_json::from_str(&json_str).unwrap();
        assert_eq!(e, decoded);
    }
}

// ============================================================================
// 6. ADVERSARIAL INI PARSER & SERIALIZER EDGE CASES
// ============================================================================

#[test]
fn adv_test_ini_parser_extreme_whitespace_and_comments() {
    let dirty_ini = r#"
; Top level comment
# Another comment
   [   General   ]   
   viewer   =   custom_app   
   language   =   de   
   page_size   =   4000   
   # Comment in the middle of section
   ; Another comment
   max_concurrent_files   =   8   

[DUCKDB]
   max_memory   =   16GB   
   threads   =   16   
   add_raw_event   =   TRUE   

[system]
   log_level   =   warn   
"#;
    let parsed = parse_ini(dirty_ini);
    assert_eq!(parsed.get("general").unwrap().get("viewer").unwrap(), "custom_app");
    assert_eq!(parsed.get("general").unwrap().get("language").unwrap(), "de");
    assert_eq!(parsed.get("general").unwrap().get("page_size").unwrap(), "4000");
    assert_eq!(parsed.get("general").unwrap().get("max_concurrent_files").unwrap(), "8");
    assert_eq!(parsed.get("duckdb").unwrap().get("max_memory").unwrap(), "16GB");
    assert_eq!(parsed.get("duckdb").unwrap().get("threads").unwrap(), "16");
    assert_eq!(parsed.get("system").unwrap().get("log_level").unwrap(), "warn");
}

#[test]
fn adv_test_save_config_atomic_roundtrip() {
    let test_dir = create_test_dir("save_cfg_adv");
    let cfg_path = test_dir.join("config.ini");

    let mut cfg = ToadConfig::default();
    cfg.general.viewer = "custom_viewer_1".to_string();
    cfg.general.page_size = 7777;
    cfg.duckdb.max_memory = "32GB".to_string();
    cfg.duckdb.threads = 16;
    cfg.parquet.compression = "zstd".to_string();
    cfg.system.log_level = "trace".to_string();

    save_config(&cfg_path, &cfg).unwrap();
    let reloaded = load_or_create_config(&cfg_path).unwrap();

    assert_eq!(reloaded.general.viewer, "custom_viewer_1");
    assert_eq!(reloaded.general.page_size, 7777);
    assert_eq!(reloaded.duckdb.max_memory, "32GB");
    assert_eq!(reloaded.duckdb.threads, 16);
    assert_eq!(reloaded.parquet.compression, "zstd");
    assert_eq!(reloaded.system.log_level, "trace");

    let _ = fs::remove_dir_all(&test_dir);
}

#[test]
fn adv_test_ensure_portable_environment_lifecycle() {
    let test_root = create_test_dir("ensure_portable_adv");

    // 1. Initial invocation creates complete tree and default config
    let (paths, cfg) = ensure_portable_environment(Some(&test_root)).unwrap();
    assert!(paths.app_data_dir.exists());
    assert!(paths.temp_dir.exists());
    assert!(paths.logs_dir.exists());
    assert!(paths.config_path.exists());
    assert_eq!(cfg.general.viewer, "toad");

    // 2. Put a scratch file in temp dir
    let scratch_file = paths.temp_dir.join("scratch_marker.tmp");
    fs::write(&scratch_file, b"temp data").unwrap();
    assert!(scratch_file.exists());

    // 3. Second invocation with temp_cleanup=true should delete scratch_file
    let (paths2, cfg2) = ensure_portable_environment(Some(&test_root)).unwrap();
    assert_eq!(paths.app_data_dir, paths2.app_data_dir);
    assert_eq!(cfg.general.viewer, cfg2.general.viewer);
    assert!(!scratch_file.exists(), "Temporary file should have been cleaned up");

    let _ = fs::remove_dir_all(&test_root);
}

// ============================================================================
// 7. EXHAUSTIVE COMMAND ROUTING & ALIAS RECOGNITION VALIDATION
// ============================================================================

#[test]
fn adv_test_command_aliases_exhaustive_table_validation() {
    use toad_lib::commands::{route_command, CommandAction};

    // Complete mapping set from commandAliases.ts + canonical router
    let expected_mappings = vec![
        ("toad:init_main", vec!["initMain", "init_main"], CommandAction::InitMain),
        ("toad:get_config", vec!["getToadConfig", "get_config"], CommandAction::GetConfig),
        ("toad:new_window", vec!["newWindowFromDSPath", "new_window"], CommandAction::NewWindow),
        ("toad:open_file_dialog", vec!["dialog:showOpenDialog"], CommandAction::OpenFileDialog),
        ("toad:write_clipboard", vec!["clipboard:writeText"], CommandAction::WriteClipboard),
        ("toad:open_url", vec!["shell:openExternal"], CommandAction::OpenUrl),
        ("toad:get_setup_info", vec!["getSetupInfo", "get_setup_info"], CommandAction::GetSetupInfo),
        ("toad:open_example", vec!["openExample", "open_example"], CommandAction::OpenExample),
        ("toad:eval_query", vec!["DataSourceConnection.evalQuery", "evalQuery", "toad:query", "eval_query"], CommandAction::EvalQuery),
        ("toad:row_count", vec!["DataSourceConnection.rowCount", "rowCount", "row_count"], CommandAction::RowCount),
        ("toad:schema", vec!["toad:get_table_schema", "DataSourceConnection.getTableSchema", "schema", "getTableSchema", "get_table_schema"], CommandAction::Schema),
        ("toad:run_sql_arrow", vec!["DataSourceConnection.runSqlQueryArrow", "run_sql_arrow"], CommandAction::RunSqlArrow),
        ("toad:get_table_name", vec!["DataSourceConnection.getTableName", "getTableName", "get_table_name"], CommandAction::GetTableName),
        ("project:get_workspace", vec!["project:getWorkspace", "get_workspace"], CommandAction::ProjectGetWorkspace),
        ("project:get_files", vec!["project:getFiles", "get_files"], CommandAction::ProjectGetFiles),
        ("project:add_files", vec!["project:addFiles", "add_files"], CommandAction::ProjectAddFiles),
        ("project:add_folder", vec!["project:addFolder", "add_folder"], CommandAction::ProjectAddFolder),
        ("project:delete", vec!["delete_project"], CommandAction::ProjectDelete),
        ("project:rename", vec!["rename_project"], CommandAction::ProjectRename),
        ("project:create", vec!["create_project"], CommandAction::ProjectCreate),
        ("project:set_active", vec!["project:setActive", "set_active"], CommandAction::ProjectSetActive),
        ("project:reconcile", vec!["reconcile_project"], CommandAction::ProjectReconcile),
        ("project:delete_all", vec!["project:deleteAll", "delete_all"], CommandAction::ProjectDeleteAll),
        ("project:get_cache_size", vec!["project:getCacheSize", "get_cache_size"], CommandAction::ProjectGetCacheSize),
        ("project:purge_cache", vec!["project:purgeCache", "purge_cache"], CommandAction::ProjectPurgeCache),
        ("project:remove_file", vec!["project:removeFile", "remove_file"], CommandAction::ProjectRemoveFile),
        ("project:move_orphan_files", vec!["project:moveOrphanFiles", "move_orphan_files"], CommandAction::ProjectMoveOrphanFiles),
        ("engine:get_status", vec!["engine:status", "engine_status"], CommandAction::EngineGetStatus),
        ("engine:do_restart", vec!["engine:restart", "engine_restart"], CommandAction::EngineDoRestart),
    ];

    let mut all_unique_commands = HashSet::new();
    for (canonical, aliases, expected_action) in expected_mappings {
        assert_eq!(route_command(canonical), expected_action, "Canonical failed routing: {}", canonical);
        assert!(all_unique_commands.insert(canonical), "Duplicate canonical command: {}", canonical);
        for alias in aliases {
            assert_eq!(route_command(alias), expected_action, "Alias failed routing: {}", alias);
            assert!(all_unique_commands.insert(alias), "Duplicate alias command: {}", alias);
        }
    }

    // Verify canonical Tauri plugin commands are not intercepted and pass through
    let plugin_commands = [
        "plugin:dialog|open",
        "plugin:clipboard|write_text",
        "plugin:clipboard-manager|write_text",
        "plugin:opener|open_url",
        "plugin:fs|read_file",
    ];
    for p_cmd in plugin_commands {
        assert_eq!(route_command(p_cmd), CommandAction::PluginPassthrough);
    }

    assert!(all_unique_commands.len() >= 60, "Expected at least 60 command identifiers mapped, got {}", all_unique_commands.len());
}

// ============================================================================
// 8. ADVERSARIAL ATOMICITY & ROLLBACK SAFETY ON I/O FAILURE
// ============================================================================

#[tokio::test]
async fn adv_test_appstate_update_config_atomicity_on_io_failure() {
    let test_dir = create_test_dir("atomicity_fail_adv");
    let state = AppState::new(test_dir.clone(), ToadConfig::default());

    // 1. Initial configuration baseline
    assert_eq!(state.get_config().await.general.page_size, 1000);
    assert_eq!(state.get_config().await.duckdb.threads, 0);

    // 2. Create an unwritable target: on Windows, writing a file to an existing
    // directory path synchronously fails with an I/O PermissionDenied error.
    let invalid_config_dir = test_dir.join("directory_as_file");
    fs::create_dir_all(&invalid_config_dir).unwrap();

    let failing_state = AppState {
        portable_dir: test_dir.clone(),
        config_path: invalid_config_dir,
        config: Arc::new(tokio::sync::RwLock::new(ToadConfig::default())),
        duckdb_engine: state.duckdb_engine.clone(),
        parquet_ledger: state.parquet_ledger.clone(),
        ingest_queue: state.ingest_queue.clone(),
    };

    // 3. Attempt update: closure attempts to mutate page_size to 9999 and threads to 64
    let result = failing_state
        .update_config(|c| {
            c.general.page_size = 9999;
            c.duckdb.threads = 64;
        })
        .await;

    // Must return an I/O Error
    assert!(result.is_err(), "update_config must return Err when disk I/O fails");

    // 4. CRITICAL ATOMICITY ASSERTION:
    // In-memory state MUST remain 1000 and 0. It must NOT have been mutated!
    let in_memory_cfg = failing_state.get_config().await;
    assert_eq!(
        in_memory_cfg.general.page_size, 1000,
        "Atomicity failure: in-memory page_size was mutated to 9999 despite I/O error!"
    );
    assert_eq!(
        in_memory_cfg.duckdb.threads, 0,
        "Atomicity failure: in-memory threads was mutated to 64 despite I/O error!"
    );

    let _ = fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn adv_test_appstate_update_config_atomicity_on_readonly_file() {
    let test_dir = create_test_dir("atomicity_readonly_adv");
    let file_path = test_dir.join("config.ini");

    let initial_cfg = ToadConfig::default();
    let initial_ini = toad_lib::portable::serialize_ini(&initial_cfg);
    fs::write(&file_path, &initial_ini).expect("Failed to write initial ini");

    // Set read-only attribute
    let mut perms = fs::metadata(&file_path).unwrap().permissions();
    perms.set_readonly(true);
    fs::set_permissions(&file_path, perms).expect("Failed to set read-only attribute");

    let state = AppState {
        portable_dir: test_dir.clone(),
        config_path: file_path.clone(),
        config: Arc::new(tokio::sync::RwLock::new(initial_cfg.clone())),
        duckdb_engine: Arc::new(tokio::sync::RwLock::new(Default::default())),
        parquet_ledger: Arc::new(tokio::sync::RwLock::new(Default::default())),
        ingest_queue: Arc::new(tokio::sync::RwLock::new(Default::default())),
    };

    let res = state
        .update_config(|c| {
            c.general.page_size = 77777;
            c.system.log_level = "error".to_string();
        })
        .await;

    assert!(res.is_err(), "Expected update_config to fail on read-only file");

    let current_cfg = state.get_config().await;
    assert_eq!(current_cfg, initial_cfg, "In-memory state diverged from initial config!");

    // Reset read-only for cleanup
    let mut perms = fs::metadata(&file_path).unwrap().permissions();
    perms.set_readonly(false);
    let _ = fs::set_permissions(&file_path, perms);
    let _ = fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn adv_test_appstate_update_config_dirty_read_isolation() {
    let test_dir = create_test_dir("atomicity_dirty_read_adv");
    let dir_as_file = test_dir.join("unwritable_dir");
    fs::create_dir_all(&dir_as_file).unwrap();

    let state = Arc::new(AppState {
        portable_dir: test_dir.clone(),
        config_path: dir_as_file,
        config: Arc::new(tokio::sync::RwLock::new(ToadConfig::default())),
        duckdb_engine: Arc::new(tokio::sync::RwLock::new(Default::default())),
        parquet_ledger: Arc::new(tokio::sync::RwLock::new(Default::default())),
        ingest_queue: Arc::new(tokio::sync::RwLock::new(Default::default())),
    });

    let mut reader_handles = Vec::new();
    for _ in 0..10 {
        let state_clone = Arc::clone(&state);
        let handle = tokio::spawn(async move {
            for _ in 0..50 {
                let cfg = state_clone.get_config().await;
                assert_eq!(cfg.general.page_size, 1000, "Dirty read detected: page_size != 1000");
                assert_eq!(cfg.duckdb.threads, 0, "Dirty read detected: threads != 0");
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
        });
        reader_handles.push(handle);
    }

    let mut updater_handles = Vec::new();
    for i in 0..5 {
        let state_clone = Arc::clone(&state);
        let handle = tokio::spawn(async move {
            let res = state_clone
                .update_config(move |c| {
                    c.general.page_size = 50000 + i;
                    c.duckdb.threads = 100 + i as u32;
                })
                .await;
            assert!(res.is_err());
        });
        updater_handles.push(handle);
    }

    for h in updater_handles {
        h.await.unwrap();
    }
    for h in reader_handles {
        h.await.unwrap();
    }

    assert_eq!(state.get_config().await.general.page_size, 1000);
    assert_eq!(state.get_config().await.duckdb.threads, 0);

    let _ = fs::remove_dir_all(&test_dir);
}

