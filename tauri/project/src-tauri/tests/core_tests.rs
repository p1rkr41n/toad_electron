use toad_lib::portable::{self, ToadConfig};
use toad_lib::state::AppState;
use toad_lib::logger::{self, ErrorResponse};

#[test]
fn test_suffix_generation() {
    let s = portable::generate_portable_suffix();
    assert_eq!(s.len(), 5);
    assert!(s.chars().all(|c| c.is_ascii_alphanumeric()));
}

#[test]
fn test_ini_roundtrip() {
    let mut cfg = ToadConfig::default();
    cfg.general.page_size = 5000;
    cfg.duckdb.threads = 8;
    cfg.duckdb.max_memory = "4GB".to_string();

    let text = portable::serialize_ini(&cfg);
    let parsed = portable::parse_ini(&text);
    assert_eq!(parsed["general"]["page_size"], "5000");
    assert_eq!(parsed["duckdb"]["threads"], "8");
    assert_eq!(parsed["duckdb"]["max_memory"], "4GB");
}

#[test]
fn test_clean_temp_preserves_ledger() {
    let temp_dir = std::env::temp_dir().join(format!("toad_test_temp_{}", portable::generate_portable_suffix()));
    std::fs::create_dir_all(&temp_dir).unwrap();

    let junk = temp_dir.join("test_cache.parquet");
    let ledger = temp_dir.join("toad_ledger.parquet");
    std::fs::write(&junk, b"junk").unwrap();
    std::fs::write(&ledger, b"ledger").unwrap();

    let cleaned = portable::clean_temp_dir(&temp_dir).unwrap();
    assert_eq!(cleaned, 1);
    assert!(!junk.exists());
    assert!(ledger.exists());

    let _ = std::fs::remove_file(ledger);
    let _ = std::fs::remove_dir_all(temp_dir);
}

#[tokio::test]
async fn test_app_state_concurrency() {
    let temp_dir = std::env::temp_dir().join(format!("toad_test_state_{}", portable::generate_portable_suffix()));
    std::fs::create_dir_all(&temp_dir).unwrap();

    let state = AppState::new(temp_dir.clone(), ToadConfig::default());
    let cfg = state.get_config().await;
    assert_eq!(cfg.general.viewer, "toad");

    let updated = state.update_config(|c| {
        c.general.page_size = 9999;
    }).await.unwrap();
    assert_eq!(updated.general.page_size, 9999);
    assert_eq!(state.get_config().await.general.page_size, 9999);

    let _ = std::fs::remove_dir_all(temp_dir);
}

#[test]
fn test_error_response_dto() {
    let err = ErrorResponse::new("ERR_CODE", "Test message");
    let json = serde_json::to_string(&err).unwrap();
    assert!(json.contains("ERR_CODE"));
    assert!(json.contains("Test message"));
}

#[test]
fn test_logger_setup() {
    let temp_logs = std::env::temp_dir().join(format!("toad_logs_{}", portable::generate_portable_suffix()));
    let res = logger::init_logger(&temp_logs, "debug");
    assert!(res.is_ok());
    let _ = std::fs::remove_dir_all(temp_logs);
}
