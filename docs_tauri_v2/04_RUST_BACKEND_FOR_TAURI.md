# CHUYÊN ĐỀ 04: LẬP TRÌNH BACKEND RUST TRONG TAURI v2
> **Mục tiêu:** Nắm vững các kỹ thuật lập trình Rust thực chiến trong ứng dụng desktop: quản lý State, đa luồng an toàn (Threading & Mutex), bất đồng bộ với `tokio`, Serde JSON và tích hợp cơ sở dữ liệu DuckDB (`duckdb-rs`).

---

## 1. QUẢN LÝ TRẠNG THÁI (STATE MANAGEMENT) VỚI `tauri::State`

Trong Tauri, Backend Rust có thể lưu trữ trạng thái toàn cục (như Connection Pool CSDL, Bộ nhớ đệm RAM cache, Cấu hình người dùng) và tự động tiêm (inject) vào bất kỳ Command nào thông qua `tauri::State`.

### 1.1. Khởi tạo & Đăng ký State
```rust
use std::sync::Mutex;
use tauri::Manager;

pub struct AppConfig {
    pub max_concurrent_files: usize,
    pub duckdb_threads: usize,
}

pub struct AppState {
    pub active_queries: Mutex<usize>,
    pub config: AppConfig,
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Đăng ký State với Tauri container
            app.manage(AppState {
                active_queries: Mutex::new(0),
                config: AppConfig {
                    max_concurrent_files: 4,
                    duckdb_threads: 6,
                },
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_system_status])
        .run(tauri::generate_context!())
        .expect("Lỗi chạy app");
}
```

### 1.2. Tiêm State vào Command
```rust
#[tauri::command]
pub async fn get_system_status(
    state: tauri::State<'_, AppState>
) -> Result<String, String> {
    let mut count = state.active_queries.lock().map_err(|e| e.to_string())?;
    *count += 1;
    
    Ok(format!(
        "Active Queries: {}, Max Threads: {}",
        *count, state.config.duckdb_threads
    ))
}
```

---

## 2. BẤT ĐỒNG BỘ (ASYNC) VỚI `TOKIO` & ĐA LUỒNG AN TOÀN

Để việc đọc file hàng chục gigabyte không làm nghẽn giao diện (UI Freeze), các tác vụ nặng phải được đẩy sang threadpool của `tokio::task::spawn_blocking`:

```rust
use tokio::task;

#[tauri::command]
pub async fn heavy_parquet_conversion(
    csv_path: String,
    parquet_path: String,
) -> Result<usize, String> {
    // Đẩy tác vụ nặng sang CPU threadpool riêng biệt
    let row_count = task::spawn_blocking(move || {
        // Thực thi logic đọc ghi file nặng tại đây
        println!("Đang chuyển đổi {} -> {}", csv_path, parquet_path);
        // ... (xử lý logic)
        1_500_000 // giả sử xử lý 1.5 triệu dòng
    })
    .await
    .map_err(|e| format!("Lỗi task join: {}", e))?;

    Ok(row_count)
}
```

---

## 3. TÍCH HỢP CƠ SỞ DỮ LIỆU DUCKDB TRONG RUST (`duckdb-rs`)

DuckDB có crate chính thức cho Rust là `duckdb`. Đây là giải pháp thay thế trực tiếp cho `reltab-duckdb` của Node.js:

### 3.1. Khai báo trong `Cargo.toml`
```toml
[dependencies]
duckdb = { version = "1.0.0", features = ["bundled", "vtab-arrow"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tokio = { version = "1", features = ["full"] }
```

### 3.2. Mã nguồn Service Query DuckDB
```rust
use duckdb::{Connection, Result as DuckResult};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

pub struct DuckDbService {
    conn: Arc<Mutex<Connection>>,
}

impl DuckDbService {
    pub fn new() -> DuckResult<Self> {
        // Khởi tạo in-memory DuckDB database
        let conn = Connection::open_in_memory()?;
        // Cấu hình tối ưu tương tự Toad Electron
        conn.execute_batch(
            "SET preserve_insertion_order = false;
             SET max_memory = '8GB';"
        )?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn query_to_json(&self, sql: &str) -> Result<Vec<Value>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        
        let column_names: Vec<String> = stmt
            .column_names()
            .into_iter()
            .map(|s| s.to_string())
            .collect();

        let rows = stmt.query_map([], |row| {
            let mut map = serde_json::Map::new();
            for (idx, name) in column_names.iter().enumerate() {
                let val_str: String = row.get(idx).unwrap_or_else(|_| "".to_string());
                map.insert(name.clone(), Value::String(val_str));
            }
            Ok(Value::Object(map))
        }).map_err(|e| e.to_string())?;

        let mut result = Vec::new();
        for r in rows {
            if let Ok(v) = r {
                result.push(v);
            }
        }
        Ok(result)
    }
}
```

---

## 4. XỬ LÝ LỖI CHUẨN MỰC VỚI `thiserror` & `anyhow`

Trong Tauri Command, bạn không nên dùng `unwrap()`. Mọi lỗi cần được chuyển đổi thành chuỗi thân thiện với người dùng trước khi gửi sang JavaScript:

```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ToadError {
    #[error("Tệp không tồn tại: {0}")]
    FileNotFound(String),
    #[error("Lỗi cú pháp SQL: {0}")]
    QuerySyntaxError(String),
    #[error("Hết bộ nhớ RAM (OOM): {0}")]
    OutOfMemory(String),
}

// Chuyển đổi ToadError thành String để trả về JS
impl From<ToadError> for String {
    fn from(err: ToadError) -> Self {
        err.to_string()
    }
}
```
Khi đó hàm Command có thể sử dụng toán tử `?` tiện lợi và an toàn tuyệt đối:
```rust
#[tauri::command]
pub async fn safe_load(path: String) -> Result<String, String> {
    if !std::path::Path::new(&path).exists() {
        return Err(ToadError::FileNotFound(path).into());
    }
    Ok("Nạp thành công".to_string())
}
```
