//! lib.rs
//!
//! TOAD Core Engine - Native Rust Ingestion, EVTX Parser, Streaming Transcoder & N-API Bridge

pub mod binary_guard;
pub mod config_manager;
pub mod csv_engine;
pub mod evtx_parser;
pub mod io_monitor;
#[cfg(feature = "node-api")]
pub mod napi_bridge;
pub mod transcode;

pub use binary_guard::{inspect_file, FileFormatCategory, GUARD_BUFFER_SIZE};
pub use config_manager::{
    clean_temp_dir, ensure_portable_app_data_dir, gen_random_suffix, get_executable_dir,
    init_portable_environment, validate_and_ensure_config, validate_and_ensure_presets,
    PortableEnvironment, ToadConfig, DEFAULT_CONFIG_INI, DEFAULT_PRESETS_JSON,
};
pub use csv_engine::{inspect_csv, normalize_dirty_csv, sniff_delimiter, CsvMetadata};
pub use evtx_parser::{
    convert_evtx_to_jsonl, normalize_evtx_record_value, EvtxConvertStats, NormalizedEvtxRecord,
};
pub use io_monitor::{get_process_io_bytes, IoCounters};
pub use transcode::{
    detect_text_encoding, detect_utf16_slice, transcode_to_utf8, DetectedEncoding, TranscodeStats,
    Utf16Endian, STREAM_CHUNK_SIZE,
};
