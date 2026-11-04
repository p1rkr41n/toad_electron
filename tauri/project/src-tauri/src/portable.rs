//! portable.rs
//!
//! Portable Environment & Config Manager for Toad Desktop (Tauri v2)
//! - Resolves executable directory and `toadAppData_[5chars]` folder adjacent to the executable.
//! - Creates standard subdirectories: `temp/`, `logs/`.
//! - Manages and validates `config.ini` with auto-healing to standard defaults.
//! - Implements startup and shutdown cleanup of temporary parquet files (`clean_temp_dir`).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Configuration for general application behavior
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToadGeneralConfig {
    pub viewer: String,
    pub language: String,
    pub page_size: u64,
    pub max_concurrent_files: u32,
    pub max_concurrent_gb: f64,
    pub auto_restore_last_directory: bool,
    pub last_directory: String,
}

impl Default for ToadGeneralConfig {
    fn default() -> Self {
        Self {
            viewer: "toad".to_string(),
            language: "en".to_string(),
            page_size: 1000,
            max_concurrent_files: 4,
            max_concurrent_gb: 1.0,
            auto_restore_last_directory: true,
            last_directory: String::new(),
        }
    }
}

/// Configuration for runtime engine
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToadRuntimeConfig {
    pub engine: String,
    pub auto_fallback: bool,
}

impl Default for ToadRuntimeConfig {
    fn default() -> Self {
        Self {
            engine: "tauri".to_string(),
            auto_fallback: false,
        }
    }
}

/// Configuration for DuckDB engine
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToadDuckDbConfig {
    pub max_memory: String,
    pub threads: u32,
    pub background_threads: String,
    pub add_raw_event: bool,
}

impl Default for ToadDuckDbConfig {
    fn default() -> Self {
        Self {
            max_memory: "auto".to_string(),
            threads: 0,
            background_threads: "auto".to_string(),
            add_raw_event: false,
        }
    }
}

/// Configuration for Parquet storage & cache
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToadParquetConfig {
    pub compression: String,
    pub row_group_size: u64,
}

impl Default for ToadParquetConfig {
    fn default() -> Self {
        Self {
            compression: "snappy".to_string(),
            row_group_size: 25000,
        }
    }
}

/// Configuration for system policies and logging
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToadSystemConfig {
    pub temp_cleanup: bool,
    pub binary_guard: bool,
    pub log_level: String,
}

impl Default for ToadSystemConfig {
    fn default() -> Self {
        Self {
            temp_cleanup: true,
            binary_guard: true,
            log_level: "info".to_string(),
        }
    }
}

/// Consolidated Toad Configuration matching config.ini
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct ToadConfig {
    pub general: ToadGeneralConfig,
    pub runtime: ToadRuntimeConfig,
    pub duckdb: ToadDuckDbConfig,
    pub parquet: ToadParquetConfig,
    pub system: ToadSystemConfig,
}

/// Paths bundle for the portable environment
#[derive(Debug, Clone)]
pub struct PortablePaths {
    pub base_dir: PathBuf,
    pub app_data_dir: PathBuf,
    pub temp_dir: PathBuf,
    pub logs_dir: PathBuf,
    pub config_path: PathBuf,
    pub ledger_path: PathBuf,
}

/// Resolve the directory of the running executable
pub fn get_executable_dir() -> PathBuf {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            return parent.to_path_buf();
        }
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

/// Generate a pseudo-random 5-character lowercase alphanumeric suffix
pub fn generate_portable_suffix() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let pid = std::process::id() as u128;
    let seed = (now ^ (pid << 32) ^ 0x9E3779B97F4A7C15) as u64;

    const CHARSET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut suffix = String::with_capacity(5);
    let mut val = seed;
    for _ in 0..5 {
        let idx = (val % CHARSET.len() as u64) as usize;
        suffix.push(CHARSET[idx] as char);
        val /= CHARSET.len() as u64;
        val ^= (val << 13) | 0x5a5a5a5a;
    }
    suffix
}

/// Detect an existing `toadAppData_[5chars]` directory or create a new one
pub fn detect_or_create_app_data_dir(base_dir: &Path) -> std::io::Result<PathBuf> {
    if let Ok(entries) = fs::read_dir(base_dir) {
        for entry in entries.flatten() {
            if let Ok(ft) = entry.file_type() {
                if ft.is_dir() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.starts_with("toadAppData_") && name.len() == 17 {
                        let suffix = &name[12..];
                        if suffix.chars().all(|c| c.is_ascii_alphanumeric()) {
                            return Ok(entry.path());
                        }
                    }
                }
            }
        }
    }

    // None found: create a new one
    let new_name = format!("toadAppData_{}", generate_portable_suffix());
    let new_path = base_dir.join(new_name);
    fs::create_dir_all(&new_path)?;
    Ok(new_path)
}

/// Initialize portable directory structure and return paths bundle
pub fn resolve_portable_dir(base_dir: Option<&Path>) -> std::io::Result<PortablePaths> {
    let base = match base_dir {
        Some(p) => p.to_path_buf(),
        None => get_executable_dir(),
    };

    let app_data_dir = detect_or_create_app_data_dir(&base)?;
    let temp_dir = app_data_dir.join("temp");
    let logs_dir = app_data_dir.join("logs");
    let config_path = app_data_dir.join("config.ini");
    let ledger_path = app_data_dir.join("toad_ledger.parquet");

    fs::create_dir_all(&temp_dir)?;
    fs::create_dir_all(&logs_dir)?;

    Ok(PortablePaths {
        base_dir: base,
        app_data_dir,
        temp_dir,
        logs_dir,
        config_path,
        ledger_path,
    })
}

/// Parse INI content into a section-to-key-value hash map
pub fn parse_ini(content: &str) -> HashMap<String, HashMap<String, String>> {
    let mut map: HashMap<String, HashMap<String, String>> = HashMap::new();
    let mut current_section = "general".to_string();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(';') {
            continue;
        }
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            current_section = trimmed[1..trimmed.len() - 1].trim().to_lowercase();
            continue;
        }
        if let Some((k, v)) = trimmed.split_once('=') {
            let key = k.trim().to_lowercase();
            let val = v.trim().to_string();
            map.entry(current_section.clone())
                .or_default()
                .insert(key, val);
        }
    }
    map
}

/// Serialize ToadConfig into clean INI format
pub fn serialize_ini(cfg: &ToadConfig) -> String {
    format!(
        r#"# ==============================================================================
#                      TOAD VIEWER SYSTEM CONFIGURATION (CONFIG.INI)
# ==============================================================================
# This file is automatically validated and read by Toad Desktop (Tauri v2).
# You can modify values directly and save at any time.

[general]
viewer = {viewer}
language = {language}
page_size = {page_size}
max_concurrent_files = {max_concurrent_files}
max_concurrent_gb = {max_concurrent_gb}
auto_restore_last_directory = {auto_restore_last_directory}
last_directory = {last_directory}

[runtime]
engine = {engine}
auto_fallback = {auto_fallback}

[duckdb]
max_memory = {max_memory}
threads = {threads}
background_threads = {background_threads}
add_raw_event = {add_raw_event}

[parquet]
compression = {compression}
row_group_size = {row_group_size}

[system]
temp_cleanup = {temp_cleanup}
binary_guard = {binary_guard}
log_level = {log_level}
"#,
        viewer = cfg.general.viewer,
        language = cfg.general.language,
        page_size = cfg.general.page_size,
        max_concurrent_files = cfg.general.max_concurrent_files,
        max_concurrent_gb = cfg.general.max_concurrent_gb,
        auto_restore_last_directory = cfg.general.auto_restore_last_directory,
        last_directory = cfg.general.last_directory,
        engine = cfg.runtime.engine,
        auto_fallback = cfg.runtime.auto_fallback,
        max_memory = cfg.duckdb.max_memory,
        threads = cfg.duckdb.threads,
        background_threads = cfg.duckdb.background_threads,
        add_raw_event = cfg.duckdb.add_raw_event,
        compression = cfg.parquet.compression,
        row_group_size = cfg.parquet.row_group_size,
        temp_cleanup = cfg.system.temp_cleanup,
        binary_guard = cfg.system.binary_guard,
        log_level = cfg.system.log_level,
    )
}

/// Load and parse config.ini; create default and save if absent
pub fn load_or_create_config(config_path: &Path) -> std::io::Result<ToadConfig> {
    if !config_path.exists() {
        let default_cfg = ToadConfig::default();
        let content = serialize_ini(&default_cfg);
        fs::write(config_path, content)?;
        return Ok(default_cfg);
    }

    let mut content = String::new();
    if let Ok(mut f) = File::open(config_path) {
        let _ = f.read_to_string(&mut content);
    }

    let parsed = parse_ini(&content);
    let mut cfg = ToadConfig::default();
    let mut need_rewrite = false;

    // [general]
    if let Some(sec) = parsed.get("general") {
        if let Some(v) = sec.get("viewer") {
            cfg.general.viewer = v.clone();
        } else {
            need_rewrite = true;
        }
        if let Some(l) = sec.get("language") {
            cfg.general.language = l.clone();
        } else {
            need_rewrite = true;
        }
        if let Some(p) = sec.get("page_size") {
            if let Ok(sz) = p.parse::<u64>() {
                if sz > 0 {
                    cfg.general.page_size = sz;
                }
            }
        }
        if let Some(m) = sec.get("max_concurrent_files") {
            if let Ok(val) = m.parse::<u32>() {
                cfg.general.max_concurrent_files = val;
            }
        }
        if let Some(g) = sec.get("max_concurrent_gb") {
            if let Ok(val) = g.parse::<f64>() {
                cfg.general.max_concurrent_gb = val;
            }
        }
        if let Some(a) = sec.get("auto_restore_last_directory") {
            cfg.general.auto_restore_last_directory = a.eq_ignore_ascii_case("true");
        }
        if let Some(d) = sec.get("last_directory") {
            cfg.general.last_directory = d.clone();
        }
    } else {
        need_rewrite = true;
    }

    // [runtime]
    if let Some(sec) = parsed.get("runtime") {
        if let Some(e) = sec.get("engine") {
            cfg.runtime.engine = e.clone();
        }
        if let Some(a) = sec.get("auto_fallback") {
            cfg.runtime.auto_fallback = a.eq_ignore_ascii_case("true");
        }
    }

    // [duckdb]
    if let Some(sec) = parsed.get("duckdb") {
        if let Some(m) = sec.get("max_memory") {
            cfg.duckdb.max_memory = m.clone();
        } else {
            need_rewrite = true;
        }
        if let Some(t) = sec.get("threads") {
            if let Ok(num) = t.parse::<u32>() {
                cfg.duckdb.threads = num;
            } else {
                need_rewrite = true;
            }
        }
        if let Some(bg) = sec.get("background_threads") {
            cfg.duckdb.background_threads = bg.clone();
        }
        if let Some(r) = sec.get("add_raw_event") {
            cfg.duckdb.add_raw_event = r.eq_ignore_ascii_case("true");
        }
    } else {
        need_rewrite = true;
    }

    // [parquet]
    if let Some(sec) = parsed.get("parquet") {
        if let Some(c) = sec.get("compression") {
            cfg.parquet.compression = c.clone();
        }
        if let Some(r) = sec.get("row_group_size") {
            if let Ok(val) = r.parse::<u64>() {
                cfg.parquet.row_group_size = val;
            }
        }
    }

    // [system]
    if let Some(sec) = parsed.get("system") {
        if let Some(t) = sec.get("temp_cleanup") {
            cfg.system.temp_cleanup = t.eq_ignore_ascii_case("true");
        }
        if let Some(b) = sec.get("binary_guard") {
            cfg.system.binary_guard = b.eq_ignore_ascii_case("true");
        }
        if let Some(lvl) = sec.get("log_level") {
            cfg.system.log_level = lvl.clone();
        }
    }

    if need_rewrite {
        let _ = save_config(config_path, &cfg);
    }

    Ok(cfg)
}

/// Save ToadConfig to config.ini
pub fn save_config(config_path: &Path, config: &ToadConfig) -> std::io::Result<()> {
    let content = serialize_ini(config);
    let mut file = File::create(config_path)?;
    file.write_all(content.as_bytes())?;
    file.flush()?;
    Ok(())
}

/// Clean up dangling temporary parquet and cache files in `temp/` on startup or shutdown.
/// Strictly preserves `toad_ledger.parquet` and `*_ledger.parquet`.
pub fn clean_temp_dir(temp_dir: &Path) -> std::io::Result<usize> {
    if !temp_dir.exists() {
        return Ok(0);
    }
    let mut cleaned = 0;
    if let Ok(entries) = fs::read_dir(temp_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let file_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_lowercase();

            // Strictly preserve the state ledger
            if file_name == "toad_ledger.parquet"
                || file_name.ends_with("_ledger.parquet")
                || file_name.ends_with(".lock")
            {
                continue;
            }

            // Retry up to 3 times to handle potential Windows EBUSY / sharing locks
            for attempt in 0..3 {
                let res = if path.is_dir() {
                    fs::remove_dir_all(&path)
                } else {
                    fs::remove_file(&path)
                };
                if res.is_ok() {
                    cleaned += 1;
                    break;
                }
                if attempt < 2 {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
            }
        }
    }
    Ok(cleaned)
}

/// Ensure portable environment and load config
pub fn ensure_portable_environment(
    base_dir: Option<&Path>,
) -> std::io::Result<(PortablePaths, ToadConfig)> {
    let paths = resolve_portable_dir(base_dir)?;
    let config = load_or_create_config(&paths.config_path)?;

    // Clean temp dir if policy is enabled
    if config.system.temp_cleanup {
        let _ = clean_temp_dir(&paths.temp_dir);
    }

    Ok((paths, config))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_suffix_generation() {
        let s1 = generate_portable_suffix();
        assert_eq!(s1.len(), 5);
        assert!(s1.chars().all(|c| c.is_ascii_alphanumeric()));
    }

    #[test]
    fn test_ini_parse_and_serialize() {
        let mut cfg = ToadConfig::default();
        cfg.general.page_size = 5000;
        cfg.duckdb.threads = 8;
        cfg.duckdb.max_memory = "4GB".to_string();

        let ini_text = serialize_ini(&cfg);
        let parsed = parse_ini(&ini_text);

        assert_eq!(parsed["general"]["page_size"], "5000");
        assert_eq!(parsed["duckdb"]["threads"], "8");
        assert_eq!(parsed["duckdb"]["max_memory"], "4GB");
    }

    #[test]
    fn test_clean_temp_preserves_ledger() {
        let temp_dir = std::env::temp_dir().join(format!("toad_test_temp_{}", generate_portable_suffix()));
        fs::create_dir_all(&temp_dir).unwrap();

        let junk_file = temp_dir.join("test_cache_123.parquet");
        let ledger_file = temp_dir.join("toad_ledger.parquet");
        let another_file = temp_dir.join("scratch.tmp");

        fs::write(&junk_file, b"junk").unwrap();
        fs::write(&ledger_file, b"ledger").unwrap();
        fs::write(&another_file, b"tmp").unwrap();

        let cleaned = clean_temp_dir(&temp_dir).unwrap();
        assert_eq!(cleaned, 2);

        assert!(!junk_file.exists());
        assert!(!another_file.exists());
        assert!(ledger_file.exists());

        let _ = fs::remove_file(ledger_file);
        let _ = fs::remove_dir_all(temp_dir);
    }
}
