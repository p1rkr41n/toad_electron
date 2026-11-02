//! lib.rs
//!
//! TOAD Core Engine - Native Rust Ingestion, EVTX Parser & Portable AppData Manager
//! Được thiết kế theo Mô hình A để cung cấp core logic hiệu năng cao cho Toad Viewer.

pub mod binary_guard;
pub mod config_manager;
pub mod csv_engine;
pub mod evtx_parser;
pub mod io_monitor;

pub use binary_guard::{inspect_file, FileFormatCategory, GUARD_BUFFER_SIZE};
pub use config_manager::{
    clean_temp_dir, ensure_portable_app_data_dir, gen_random_suffix, get_executable_dir,
    init_portable_environment, validate_and_ensure_config, validate_and_ensure_presets,
    PortableEnvironment, ToadConfig, DEFAULT_CONFIG_INI, DEFAULT_PRESETS_JSON,
};
pub use csv_engine::{inspect_csv, normalize_dirty_csv, sniff_delimiter, CsvMetadata};
pub use evtx_parser::{convert_evtx_to_jsonl, EvtxConvertStats, NormalizedEvtxRecord};
pub use io_monitor::{get_process_io_bytes, IoCounters};
