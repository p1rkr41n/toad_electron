//! duckdb_pool.rs
//!
//! In-Process Tokio Async DuckDB Connection Pool with Dual-Engine Driver Isolation:
//! - Dedicated UI connection for sub-millisecond query evaluation.
//! - Ingestion worker pool for heavy background imports (CSV, EVTX, Parquet).
//! - Thread-safe access via tokio::sync::Mutex and tokio::task::spawn_blocking.

use duckdb::{AccessMode, Config, Connection, Result as DuckResult};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::ipc::Response;
use tokio::sync::{Mutex, Semaphore};

use crate::engine::arrow_encoder::ArrowIpcEncoder;
use crate::engine::fast_count::FastCounter;
use crate::engine::schema_mapper::{SchemaDto, SchemaMapper};
use crate::engine::stats_cache::StatsCache;

/// Dual-engine DuckDB connection manager
pub struct DuckDbEnginePool {
    /// Dedicated UI connection protected by an async mutex
    ui_conn: Arc<Mutex<Connection>>,
    /// Scratch/temp directory for cached parquet files
    pub temp_dir: PathBuf,
    /// Concurrency throttle for background workers
    worker_semaphore: Arc<Semaphore>,
    /// Configured threads count
    threads: u32,
    /// Configured max memory string
    max_memory: String,
    /// Column statistics cache
    stats_cache: Arc<StatsCache>,
}

impl DuckDbEnginePool {
    /// Initialize in-process DuckDB dual-engine pool
    pub fn new(temp_dir: PathBuf, threads: u32, max_memory: String) -> DuckResult<Self> {
        let config = Config::default().access_mode(AccessMode::Automatic)?;
        let conn = Connection::open_in_memory_with_flags(config)?;

        // Configure engine pragmas
        if threads > 0 {
            conn.execute(&format!("PRAGMA threads = {};", threads), [])?;
        }
        if max_memory != "auto" && !max_memory.is_empty() {
            conn.execute(&format!("PRAGMA max_memory = '{}';", max_memory), [])?;
        }
        // Enable preserve_insertion_order for predictable table scans
        conn.execute("PRAGMA preserve_insertion_order = true;", [])?;

        let max_workers = if threads > 0 { threads.max(2) } else { 4 } as usize;

        Ok(Self {
            ui_conn: Arc::new(Mutex::new(conn)),
            temp_dir,
            worker_semaphore: Arc::new(Semaphore::new(max_workers)),
            threads,
            max_memory,
            stats_cache: Arc::new(StatsCache::default_cache()),
        })
    }

    /// Access the Column Statistics Cache
    pub fn stats_cache(&self) -> &StatsCache {
        &self.stats_cache
    }

    /// Configured threads count
    pub fn threads(&self) -> u32 {
        self.threads
    }

    /// Configured max memory
    pub fn max_memory(&self) -> &str {
        &self.max_memory
    }

    /// Execute a blocking closure against the dedicated UI DuckDB connection
    pub async fn eval_ui_conn<F, T>(&self, query_fn: F) -> Result<T, String>
    where
        F: FnOnce(&Connection) -> Result<T, String> + Send + 'static,
        T: Send + 'static,
    {
        let conn_arc = self.ui_conn.clone();
        tokio::task::spawn_blocking(move || {
            let conn = conn_arc.blocking_lock();
            query_fn(&conn)
        })
        .await
        .map_err(|e| format!("Tokio join error during DuckDB evaluation: {}", e))?
    }

    /// Execute SQL query on UI connection and encode results to binary Arrow IPC Stream Response
    pub async fn eval_query_arrow(&self, sql: String) -> Result<Response, String> {
        self.eval_ui_conn(move |conn| {
            ArrowIpcEncoder::query_to_arrow_ipc(conn, &sql)
        })
        .await
    }

    /// Execute row count SQL statement or O(1) Parquet metadata count on UI connection
    pub async fn eval_row_count(&self, count_sql: String, source_hint: Option<String>) -> Result<i64, String> {
        // Fast path for parquet file sources on disk
        if let Some(ref source) = source_hint {
            let path = Path::new(source);
            if path.exists() && path.extension().map_or(false, |ext| ext.eq_ignore_ascii_case("parquet")) {
                if let Ok(count) = FastCounter::count_parquet_rows(path) {
                    return Ok(count);
                }
            }
        }

        self.eval_ui_conn(move |conn| {
            let mut stmt = conn
                .prepare(&count_sql)
                .map_err(|e| format!("DuckDB count query prepare error [{}]: {}", count_sql, e))?;

            let count: i64 = stmt
                .query_row([], |row| row.get(0))
                .map_err(|e| format!("DuckDB count query execution error [{}]: {}", count_sql, e))?;

            Ok(count)
        })
        .await
    }

    /// Retrieve schema DTO for a given table or query
    pub async fn eval_schema(&self, table_or_query: String) -> Result<SchemaDto, String> {
        self.eval_ui_conn(move |conn| {
            // First attempt: SELECT * FROM (...) LIMIT 0 with query_arrow to extract complete Arrow schema
            let probe_sql = if table_or_query.trim_start().to_uppercase().starts_with("SELECT") {
                format!("SELECT * FROM ({}) AS _schema_probe LIMIT 0", table_or_query.trim().trim_end_matches(';'))
            } else {
                format!("SELECT * FROM \"{}\" LIMIT 0", table_or_query.replace('"', "\"\""))
            };

            if let Ok(mut stmt) = conn.prepare(&probe_sql) {
                if let Ok(arrow) = stmt.query_arrow([]) {
                    let arrow_schema = arrow.get_schema();
                    return Ok(SchemaMapper::from_arrow_schema(&arrow_schema));
                }
            }

            // Fallback attempt: DESCRIBE <table>
            let desc_sql = format!("DESCRIBE \"{}\"", table_or_query.replace('"', "\"\""));
            if let Ok(mut stmt) = conn.prepare(&desc_sql) {
                if let Ok(mut rows) = stmt.query([]) {
                    let mut cols = Vec::new();
                    while let Ok(Some(row)) = rows.next() {
                        let name: String = row.get(0).unwrap_or_default();
                        let col_type: String = row.get(1).unwrap_or_else(|_| "VARCHAR".to_string());
                        cols.push((name, col_type));
                    }
                    if !cols.is_empty() {
                        return Ok(SchemaMapper::from_column_types(cols));
                    }
                }
            }

            // Default empty schema fallback
            Ok(SchemaDto {
                dialect: "duckdb".to_string(),
                columns: Vec::new(),
                column_metadata: std::collections::HashMap::new(),
                column_types: std::collections::HashMap::new(),
            })
        })
        .await
    }

    /// Create an isolated worker connection for background ingestion tasks
    pub fn create_worker_connection(&self) -> DuckResult<Connection> {
        let conn = Connection::open_in_memory()?;
        if self.threads > 0 {
            let _ = conn.execute(&format!("PRAGMA threads = {};", self.threads.min(2)), []);
        }
        Ok(conn)
    }

    /// Execute background ingestion with worker semaphore throttling
    pub async fn run_ingest_task<F, T>(&self, task: F) -> Result<T, String>
    where
        F: FnOnce(Connection) -> Result<T, String> + Send + 'static,
        T: Send + 'static,
    {
        let _permit = self
            .worker_semaphore
            .acquire()
            .await
            .map_err(|e| format!("Worker semaphore error: {}", e))?;

        let conn = self
            .create_worker_connection()
            .map_err(|e| format!("Failed to create worker connection: {}", e))?;

        tokio::task::spawn_blocking(move || task(conn))
            .await
            .map_err(|e| format!("Worker task join error: {}", e))?
    }
}
