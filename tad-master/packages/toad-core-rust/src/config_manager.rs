//! config_manager.rs
//!
//! Quản lý Portable AppData và Thẩm định Cấu hình (Config Validation) bằng Pure Rust:
//! - Tự động sinh/tái sử dụng `toadAppData_[5_random_chars]` cạnh file .exe
//! - Thẩm định 4 cấp độ và Auto-Heal cho `config.ini`
//! - Đảm bảo `filters_preset.json`
//! - Dọn dẹp sạch sẽ `temp/` khi thoát với cơ chế retry xử lý file lock Windows EBUSY

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Result as IoResult};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

static COUNTER: AtomicU64 = AtomicU64::new(100);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToadGeneralConfig {
    pub viewer: String,
    pub language: String,
    pub page_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToadDuckDbConfig {
    pub max_memory: String,
    pub threads: u32,
    pub add_raw_event: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToadParquetConfig {
    pub compression: String,
    pub row_group_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToadSystemConfig {
    pub temp_cleanup: bool,
    pub binary_guard: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToadConfig {
    pub general: ToadGeneralConfig,
    pub duckdb: ToadDuckDbConfig,
    pub parquet: ToadParquetConfig,
    pub system: ToadSystemConfig,
}

impl Default for ToadConfig {
    fn default() -> Self {
        Self {
            general: ToadGeneralConfig {
                viewer: "toad".to_string(),
                language: "vi".to_string(),
                page_size: 1000,
            },
            duckdb: ToadDuckDbConfig {
                max_memory: "auto".to_string(),
                threads: 0,
                add_raw_event: false,
            },
            parquet: ToadParquetConfig {
                compression: "snappy".to_string(),
                row_group_size: 100_000,
            },
            system: ToadSystemConfig {
                temp_cleanup: true,
                binary_guard: true,
            },
        }
    }
}

pub const DEFAULT_CONFIG_INI: &str = r#"# ==============================================================================
#                      CAU HINH HE THONG TOAD VIEWER (CONFIG.INI)
# ==============================================================================
# File nay duoc tu dong tham dinh (validate) va doc truoc moi lan mo file.
# Ban co the thay doi truc tiep va luu lai (Ctrl+S) bat cu luc nao.

[general]
# Che do trinh xem: toad (mac dinh)
viewer = toad
# Ngon ngu hien thi: vi / en
language = vi
# So luong dong mac dinh moi trang: 1000 (khong gioi han tran tren)
page_size = 1000

[duckdb]
# Gioi han RAM cap phat cho DuckDB:
#   - auto : Tu dong can bang theo RAM he thong (khuyen dung)
#   - Hoac: 512MB, 1GB, 2GB, 4GB, 8GB...
max_memory = auto

# So luong luong CPU toi da xu ly song song:
#   - 0 : Su dung toan bo nhan/luong CPU (mac dinh)
#   - Hoac: 1, 2, 4, 8...
threads = 0

# Co tu dong them cot tong hop [raw_event] khong?
#   - false : (KHUYEN DUNG) Giu nguyen Columnar sieu toc
#   - true  : Gom gia tri cac cot thanh 1 chuoi text
add_raw_event = false

[parquet]
# Thuat toan nen file Parquet tam:
#   - snappy : (KHUYEN DUNG) Nen nhanh nhat, toc do mo file nhanh gap 4x - 5x
#   - zstd   : Ty le nen cao nhat
#   - gzip   : Nen tieu chuan
#   - none   : Khong nen
compression = snappy

# Kich thuoc moi Row Group (so dong/block du lieu):
#   - Giup skip cac block khong khop khi loc AND/OR. Mac dinh: 100000
row_group_size = 100000

[system]
# Tu dong xoa file Parquet tam khi dong Toad:
#   - true  : Tu dong don sach (KHUYEN DUNG)
#   - false : Giu lai file Parquet de tai su dung
temp_cleanup = true

# Tu dong chan file nhi phan doc hai (Binary Guard):
#   - true  : Quet 8KB dau, tu choi file binary (KHUYEN DUNG)
#   - false : Bo qua kiem tra
binary_guard = true
"#;

pub const DEFAULT_PRESETS_JSON: &str = r#"{
  "version": "1.0",
  "presets": [
    {
      "name": "Hayabusa Critical & High",
      "description": "Loc cac su kien muc do Critical va High",
      "filter": {
        "op": "OR",
        "clauses": [
          { "field": "Level", "op": "EQ", "value": "critical" },
          { "field": "Level", "op": "EQ", "value": "high" }
        ]
      }
    },
    {
      "name": "Suspicious PowerShell Execution",
      "description": "Loc tien trinh powershell voi co ma hoa hoac bypass",
      "filter": {
        "op": "AND",
        "clauses": [
          { "field": "Image", "op": "CONTAINS", "value": "powershell" },
          {
            "op": "OR",
            "clauses": [
              { "field": "CommandLine", "op": "CONTAINS", "value": "-enc" },
              { "field": "CommandLine", "op": "CONTAINS", "value": "bypass" }
            ]
          }
        ]
      }
    }
  ]
}"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortableEnvironment {
    pub exe_dir: PathBuf,
    pub app_data_dir: PathBuf,
    pub temp_dir: PathBuf,
    pub electron_data_dir: PathBuf,
    pub logs_dir: PathBuf,
    pub config: ToadConfig,
}

/// Sinh chuỗi ngẫu nhiên 5 ký tự an toàn không cần crate ngoài
pub fn gen_random_suffix(len: usize) -> String {
    const CHARSET: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos() as u64;
    let count = COUNTER.fetch_add(13, Ordering::SeqCst);
    let mut seed = nanos.wrapping_add(count).wrapping_mul(6364136223846793005);

    (0..len)
        .map(|_| {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
            let idx = ((seed >> 33) as usize) % CHARSET.len();
            CHARSET[idx] as char
        })
        .collect()
}

/// Xác định thư mục chứa file .exe thật sự
pub fn get_executable_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("PORTABLE_EXECUTABLE_DIR") {
        let p = PathBuf::from(dir);
        if p.exists() {
            return p;
        }
    }
    if let Ok(file) = std::env::var("PORTABLE_EXECUTABLE_FILE") {
        let p = PathBuf::from(file);
        if let Some(parent) = p.parent() {
            if parent.exists() {
                return parent.to_path_buf();
            }
        }
    }
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Tìm hoặc tạo mới thư mục toadAppData_[5_chars]
pub fn ensure_portable_app_data_dir(exe_dir: &Path) -> IoResult<PathBuf> {
    if let Ok(entries) = fs::read_dir(exe_dir) {
        for entry in entries.flatten() {
            if let Ok(ft) = entry.file_type() {
                if ft.is_dir() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.starts_with("toadAppData_") && name.len() == 17 {
                        return Ok(entry.path());
                    }
                }
            }
        }
    }

    // Nếu chưa có, tạo mới
    let new_name = format!("toadAppData_{}", gen_random_suffix(5));
    let new_path = exe_dir.join(new_name);
    fs::create_dir_all(&new_path)?;
    Ok(new_path)
}

/// Parse file INI đơn giản
fn parse_ini(content: &str) -> HashMap<String, HashMap<String, String>> {
    let mut map: HashMap<String, HashMap<String, String>> = HashMap::new();
    let mut current_section = "__root__".to_string();

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

/// Thẩm định và Auto-Heal file config.ini
pub fn validate_and_ensure_config(config_path: &Path) -> IoResult<ToadConfig> {
    if !config_path.exists() {
        fs::write(config_path, DEFAULT_CONFIG_INI)?;
        return Ok(ToadConfig::default());
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
            if v == "toad" || v == "tad" {
                cfg.general.viewer = v.clone();
            } else {
                need_rewrite = true;
            }
        } else {
            need_rewrite = true;
        }

        if let Some(l) = sec.get("language") {
            if l == "vi" || l == "en" {
                cfg.general.language = l.clone();
            } else {
                need_rewrite = true;
            }
        } else {
            need_rewrite = true;
        }

        if let Some(p) = sec.get("page_size") {
            if let Ok(sz) = p.parse::<u64>() {
                if sz > 0 {
                    cfg.general.page_size = sz;
                } else {
                    need_rewrite = true;
                }
            } else {
                need_rewrite = true;
            }
        } else {
            need_rewrite = true;
        }
    } else {
        need_rewrite = true;
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
        } else {
            need_rewrite = true;
        }

        if let Some(r) = sec.get("add_raw_event") {
            cfg.duckdb.add_raw_event = r.eq_ignore_ascii_case("true");
        } else {
            need_rewrite = true;
        }
    } else {
        need_rewrite = true;
    }

    // [parquet]
    if let Some(sec) = parsed.get("parquet") {
        if let Some(c) = sec.get("compression") {
            let lower = c.to_lowercase();
            if ["zstd", "snappy", "gzip", "none"].contains(&lower.as_str()) {
                cfg.parquet.compression = lower;
            } else {
                need_rewrite = true;
            }
        } else {
            need_rewrite = true;
        }

        if let Some(r) = sec.get("row_group_size") {
            if let Ok(num) = r.parse::<u64>() {
                if (1_000..=10_000_000).contains(&num) {
                    cfg.parquet.row_group_size = num;
                } else {
                    need_rewrite = true;
                }
            } else {
                need_rewrite = true;
            }
        } else {
            need_rewrite = true;
        }
    } else {
        need_rewrite = true;
    }

    // [system]
    if let Some(sec) = parsed.get("system") {
        if let Some(tc) = sec.get("temp_cleanup") {
            cfg.system.temp_cleanup = tc.eq_ignore_ascii_case("true");
        } else {
            need_rewrite = true;
        }

        if let Some(bg) = sec.get("binary_guard") {
            cfg.system.binary_guard = bg.eq_ignore_ascii_case("true");
        } else {
            need_rewrite = true;
        }
    } else {
        need_rewrite = true;
    }

    // Auto-Heal nếu có lỗi
    if need_rewrite {
        let serialized = format!(
            r#"# ==============================================================================
#                      CAU HINH HE THONG TOAD VIEWER (CONFIG.INI)
# ==============================================================================

[general]
viewer = {}
language = {}
page_size = {}

[duckdb]
max_memory = {}
threads = {}
add_raw_event = {}

[parquet]
compression = {}
row_group_size = {}

[system]
temp_cleanup = {}
binary_guard = {}
"#,
            cfg.general.viewer,
            cfg.general.language,
            cfg.general.page_size,
            cfg.duckdb.max_memory,
            cfg.duckdb.threads,
            cfg.duckdb.add_raw_event,
            cfg.parquet.compression,
            cfg.parquet.row_group_size,
            cfg.system.temp_cleanup,
            cfg.system.binary_guard,
        );
        let _ = fs::write(config_path, serialized);
    }

    Ok(cfg)
}

/// Đảm bảo presets file tồn tại
pub fn validate_and_ensure_presets(presets_path: &Path) -> IoResult<()> {
    if !presets_path.exists() {
        fs::write(presets_path, DEFAULT_PRESETS_JSON)?;
        return Ok(());
    }
    // Kiểm tra tính hợp lệ của JSON
    if let Ok(content) = fs::read_to_string(presets_path) {
        if serde_json::from_str::<serde_json::Value>(&content).is_err() {
            // Corrupt -> Phục hồi
            let _ = fs::write(presets_path, DEFAULT_PRESETS_JSON);
        }
    }
    Ok(())
}

/// Dọn dẹp thư mục temp với Windows EBUSY retry
pub fn clean_temp_dir(temp_dir: &Path) -> IoResult<usize> {
    if !temp_dir.exists() {
        return Ok(0);
    }
    let mut cleaned = 0;
    if let Ok(entries) = fs::read_dir(temp_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            // Tuyệt đối không xóa state ledger
            if file_name == "toad_ledger.parquet" || file_name.ends_with("_ledger.parquet") {
                continue;
            }

            let mut deleted = false;
            // Retry tối đa 3 lần
            for attempt in 0..3 {
                let res = if path.is_dir() {
                    fs::remove_dir_all(&path)
                } else {
                    fs::remove_file(&path)
                };
                if res.is_ok() {
                    deleted = true;
                    cleaned += 1;
                    break;
                }
                if attempt < 2 {
                    thread::sleep(Duration::from_millis(50));
                }
            }
            if !deleted {
                eprintln!("[TempCleaner] Không thể xóa: {}", path.display());
            }
        }
    }
    Ok(cleaned)
}

/// Khởi tạo toàn bộ Portable Environment
pub fn init_portable_environment(custom_exe_dir: Option<PathBuf>) -> IoResult<PortableEnvironment> {
    let exe_dir = custom_exe_dir.unwrap_or_else(get_executable_dir);
    let app_data_dir = ensure_portable_app_data_dir(&exe_dir)?;

    let temp_dir = app_data_dir.join("temp");
    let electron_data_dir = app_data_dir.join("electron_data");
    let logs_dir = app_data_dir.join("logs");

    fs::create_dir_all(&temp_dir)?;
    fs::create_dir_all(&electron_data_dir)?;
    fs::create_dir_all(&logs_dir)?;

    let config_path = app_data_dir.join("config.ini");
    let presets_path = app_data_dir.join("filters_preset.json");

    let config = validate_and_ensure_config(&config_path)?;
    let _ = validate_and_ensure_presets(&presets_path);

    // Dọn rác mồ côi (Chỉ dọn khi temp_cleanup = true trong config.ini)
    if config.system.temp_cleanup {
        let _ = clean_temp_dir(&temp_dir);
    }

    Ok(PortableEnvironment {
        exe_dir,
        app_data_dir,
        temp_dir,
        electron_data_dir,
        logs_dir,
        config,
    })
}
