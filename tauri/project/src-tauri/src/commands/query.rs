//! query.rs
//!
//! Query and Engine Command Handlers for Toad Desktop (Tauri v2)
//! Bridges frontend Reltab and ToadViewer IPC commands to the native DuckDB engine and Arrow IPC streamer.

use crate::engine::query_compiler::{QueryExpCompiler, QueryRep};
use crate::state::AppState;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::ipc::Response;
use tauri::AppHandle;

/// Evaluates a QueryExp AST and streams the results as an Apache Arrow IPC Stream (0xFFFFFFFF marker)
pub async fn handle_eval_query(
    _app: AppHandle,
    state: &AppState,
    payload: Value,
) -> Result<Response, String> {
    // 1. Extract query expression, offset, and limit
    let (query_rep, offset, limit) = extract_query_and_pagination(&payload)?;

    // 2. Compile AST to DuckDB SQL
    let sql = QueryExpCompiler::compile(&query_rep, offset, limit)
        .map_err(|e| format!("QueryExp AST compilation error: {}", e))?;

    tracing::debug!("Compiled DuckDB SQL: {}", sql);

    // 3. Execute via DuckDB pool and encode as Arrow IPC stream
    let pool = state.get_duckdb_pool().await;
    pool.eval_query_arrow(sql).await
}

/// Computes the exact row count for a QueryExp or table
pub async fn handle_row_count(
    _app: AppHandle,
    state: &AppState,
    payload: Value,
) -> Result<Value, String> {
    let (query_rep, _, _) = extract_query_and_pagination(&payload)?;

    let source_hint = match &query_rep {
        QueryRep::Table { table_name } => Some(table_name.clone()),
        _ => None,
    };

    let count_sql = QueryExpCompiler::compile_count(&query_rep)
        .map_err(|e| format!("QueryExp count compilation error: {}", e))?;

    tracing::debug!("Count SQL: {}", count_sql);

    let pool = state.get_duckdb_pool().await;
    let count = pool.eval_row_count(count_sql, source_hint).await?;
    Ok(json!({ "rowCount": count }))
}

/// Retrieves the reltab.Schema DTO for a table or query
pub async fn handle_schema(
    _app: AppHandle,
    state: &AppState,
    payload: Value,
) -> Result<Value, String> {
    let target = if let Some(tbl) = payload.get("tableName").or_else(|| payload.get("table_name")).and_then(|v| v.as_str()) {
        tbl.to_string()
    } else if let Some(sql) = payload.get("sql").or_else(|| payload.get("sqlQuery")).and_then(|v| v.as_str()) {
        sql.to_string()
    } else if let Ok((query_rep, _, _)) = extract_query_and_pagination(&payload) {
        QueryExpCompiler::compile(&query_rep, None, Some(0))
            .unwrap_or_else(|_| "main_table".to_string())
    } else {
        "main_table".to_string()
    };

    let pool = state.get_duckdb_pool().await;
    let schema_dto = pool.eval_schema(target).await?;
    serde_json::to_value(&schema_dto).map_err(|e| format!("Schema serialization error: {}", e))
}

/// Executes arbitrary SQL and streams Arrow IPC
pub async fn handle_run_sql_arrow(
    _app: AppHandle,
    state: &AppState,
    payload: Value,
) -> Result<Response, String> {
    let sql = payload
        .get("sql")
        .or_else(|| payload.get("sqlQuery"))
        .or_else(|| payload.get("query"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required 'sql' or 'sqlQuery' field in payload".to_string())?;

    tracing::debug!("Executing arbitrary SQL Arrow query: {}", sql);
    let pool = state.get_duckdb_pool().await;
    pool.eval_query_arrow(sql.to_string()).await
}

/// Retrieves the active main table name, dynamically binding the target file to DuckDB views
pub async fn handle_get_table_name(
    _app: AppHandle,
    state: &AppState,
    payload: Value,
) -> Result<Value, String> {
    // 1. Robustly extract file path from diverse frontend RPC payloads
    let file_path = payload
        .get("resourceId")
        .or_else(|| payload.get("filePath"))
        .or_else(|| payload.get("file_path"))
        .or_else(|| payload.get("path").and_then(|p| p.get("sourceId")).and_then(|s| s.get("resourceId")))
        .or_else(|| payload.get("req").and_then(|r| r.get("path")).and_then(|p| p.get("sourceId")).and_then(|s| s.get("resourceId")))
        .or_else(|| payload.get("engine").and_then(|e| e.get("resourceId")))
        .and_then(|v| v.as_str());

    let file_path = match file_path {
        Some(p) if !p.trim().is_empty() => p.trim(),
        _ => return Ok(json!("main_table")),
    };

    let path_obj = Path::new(file_path);
    if !path_obj.exists() {
        tracing::warn!("Target file does not exist on disk: {}", file_path);
        return Ok(json!("main_table"));
    }

    let (size, mtime) = if let Ok(meta) = std::fs::metadata(path_obj) {
        let size = meta.len();
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        (size, mtime)
    } else {
        (0, 0)
    };

    let path_hash = (mtime ^ ((size as i64) << 16) ^ 0x5a5a5a5a) as u32;
    let view_name = format!("tbl_{:08x}", path_hash);

    let stem = path_obj
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let cache_name = format!("{}_cached_{:08x}.parquet", stem, path_hash);

    let temp_dir = state.portable_dir.join("temp");

    // 2. Check if a pre-computed Parquet cache exists in temp_dir or any project subdirectory
    let mut cached_parquet_path: Option<PathBuf> = None;
    if temp_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&temp_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    let candidate = p.join(&cache_name);
                    if candidate.exists() && candidate.metadata().map(|m| m.len() > 0).unwrap_or(false) {
                        cached_parquet_path = Some(candidate);
                        break;
                    }
                } else if p.is_file() && p.file_name().map(|n| n == cache_name.as_str()).unwrap_or(false) {
                    if p.metadata().map(|m| m.len() > 0).unwrap_or(false) {
                        cached_parquet_path = Some(p);
                        break;
                    }
                }
            }
        }
    }

    let ext = path_obj
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    // 3. Special handling for EVTX (if not already cached into parquet, parse synchronously)
    if ext == "evtx" && cached_parquet_path.is_none() {
        let target = temp_dir.join(&cache_name);
        let fid = format!("direct_evtx_{:08x}", path_hash);
        let ct = crate::ingest::scheduler::CancellationToken::new();
        let src = path_obj.to_path_buf();
        let dst = target.clone();
        let ingest_res = tokio::task::spawn_blocking(move || {
            crate::ingest::evtx_parser::ingest_evtx_file(&fid, &src, &dst, 4, &ct, None)
        })
        .await;

        if let Ok(Ok(_)) = ingest_res {
            cached_parquet_path = Some(target);
        }
    }

    // 4. Construct SQL source expression
    let sanitized_target = if let Some(ref pq) = cached_parquet_path {
        pq.to_string_lossy().replace('\\', "/").replace('\'', "''")
    } else {
        file_path.replace('\\', "/").replace('\'', "''")
    };

    let source_expr = if cached_parquet_path.is_some() || ext == "parquet" {
        format!("read_parquet('{}')", sanitized_target)
    } else {
        match ext.as_str() {
            "json" | "jsonl" | "ndjson" => {
                format!("read_json_auto('{}', sample_size = 2048, ignore_errors = true)", sanitized_target)
            }
            "csv" | "tsv" | "tab" | "txt" => {
                format!(
                    "read_csv('{}', auto_detect = true, sample_size = 100000, ignore_errors = true, null_padding = true, all_varchar = true)",
                    sanitized_target
                )
            }
            "log" => {
                format!(
                    "read_csv('{}', delim = ' ', header = false, null_padding = true, ignore_errors = true, all_varchar = true)",
                    sanitized_target
                )
            }
            _ => {
                format!(
                    "read_csv('{}', auto_detect = true, sample_size = 100000, ignore_errors = true, null_padding = true, all_varchar = true)",
                    sanitized_target
                )
            }
        }
    };

    // 5. Execute DDL to create/replace unique view and default main_table alias
    let ddl = format!(
        "CREATE OR REPLACE VIEW \"{}\" AS SELECT * FROM {};\nCREATE OR REPLACE VIEW \"main_table\" AS SELECT * FROM \"{}\";",
        view_name, source_expr, view_name
    );

    tracing::info!(
        "[query] Dynamic View Binding: view='{}', file='{}', expr='{}'",
        view_name,
        file_path,
        source_expr
    );

    let pool = state.get_duckdb_pool().await;
    let ddl_to_exec = ddl.clone();
    let exec_res = pool.eval_ui_conn(move |conn| {
        conn.execute_batch(&ddl_to_exec)
            .map_err(|e| format!("Failed to create DuckDB view for file: {}", e))?;
        Ok(())
    })
    .await;

    if let Err(e) = exec_res {
        if ext == "log" && cached_parquet_path.is_none() {
            tracing::warn!(
                "[query] read_csv failed for log file ({}), falling back to synchronous dirty_log: {}",
                file_path,
                e
            );
            let target = temp_dir.join(&cache_name);
            let fid = format!("direct_log_{:08x}", path_hash);
            let ct = crate::ingest::scheduler::CancellationToken::new();
            let src = path_obj.to_path_buf();
            let dst = target.clone();
            let ingest_res = tokio::task::spawn_blocking(move || {
                crate::ingest::dirty_log::ingest_dirty_log(&fid, &src, &dst, &ct, None)
            })
            .await;

            if let Ok(Ok(_)) = ingest_res {
                let pq_target = target.to_string_lossy().replace('\\', "/").replace('\'', "''");
                let fallback_source = format!("read_parquet('{}')", pq_target);
                let fallback_ddl = format!(
                    "CREATE OR REPLACE VIEW \"{}\" AS SELECT * FROM {};\nCREATE OR REPLACE VIEW \"main_table\" AS SELECT * FROM \"{}\";",
                    view_name, fallback_source, view_name
                );
                pool.eval_ui_conn(move |conn| {
                    conn.execute_batch(&fallback_ddl)
                        .map_err(|e| format!("Failed to create fallback DuckDB view for file: {}", e))?;
                    Ok(())
                })
                .await?;
            } else {
                return Err(format!("Failed to create DuckDB view and dirty_log fallback failed: {}", e));
            }
        } else {
            return Err(e);
        }
    }

    Ok(json!(view_name))
}

/// Helper to extract QueryRep, offset, and limit from diverse payload formats
fn extract_query_and_pagination(
    payload: &Value,
) -> Result<(QueryRep, Option<i64>, Option<i64>), String> {
    let offset = payload.get("offset").and_then(|v| v.as_i64());
    let limit = payload.get("limit").and_then(|v| v.as_i64());

    // Extract query representation object or string
    let query_val = payload
        .get("queryExp")
        .or_else(|| payload.get("query"))
        .or_else(|| payload.get("queryStr"))
        .or_else(|| payload.get("req"))
        .unwrap_or(payload);

    let query_rep = QueryExpCompiler::parse_query_exp(query_val)?;
    Ok((query_rep, offset, limit))
}

/// Retrieves the root node metadata for a data source connection
pub async fn handle_get_root_node(
    _app: AppHandle,
    _state: &AppState,
    payload: Value,
) -> Result<Value, String> {
    let resource_id = payload
        .get("resourceId")
        .or_else(|| payload.get("filePath"))
        .or_else(|| payload.get("file_path"))
        .or_else(|| payload.get("path").and_then(|p| p.get("sourceId")).and_then(|s| s.get("resourceId")))
        .or_else(|| payload.get("req").and_then(|r| r.get("path")).and_then(|p| p.get("sourceId")).and_then(|s| s.get("resourceId")))
        .or_else(|| payload.get("engine").and_then(|e| e.get("resourceId")))
        .and_then(|v| v.as_str())
        .unwrap_or(".");

    let path = Path::new(resource_id);
    let display_name = path
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| resource_id.to_string());

    let is_dir = path.is_dir();
    let kind = if is_dir { "Directory" } else { "File" };
    let size = if let Ok(meta) = path.metadata() {
        Some(meta.len())
    } else {
        None
    };

    tracing::debug!(
        "[query] getRootNode: resourceId='{}', kind='{}', isContainer={}",
        resource_id,
        kind,
        is_dir
    );

    Ok(json!({
        "id": ".",
        "kind": kind,
        "displayName": display_name,
        "isContainer": is_dir,
        "fileSizeBytes": size
    }))
}

/// Retrieves child nodes for a container data source
pub async fn handle_get_children(
    _app: AppHandle,
    _state: &AppState,
    payload: Value,
) -> Result<Value, String> {
    let resource_id = payload
        .get("resourceId")
        .or_else(|| payload.get("filePath"))
        .or_else(|| payload.get("file_path"))
        .or_else(|| payload.get("path").and_then(|p| p.get("sourceId")).and_then(|s| s.get("resourceId")))
        .or_else(|| payload.get("engine").and_then(|e| e.get("resourceId")))
        .and_then(|v| v.as_str())
        .unwrap_or(".");

    let path = Path::new(resource_id);
    if path.is_dir() {
        let mut children = Vec::new();
        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.flatten() {
                let p = entry.path();
                let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
                let is_entry_dir = p.is_dir();
                let kind = if is_entry_dir { "Directory" } else { "File" };
                let size = entry.metadata().ok().map(|m| m.len());
                children.push(json!({
                    "id": name,
                    "kind": kind,
                    "displayName": name,
                    "isContainer": is_entry_dir,
                    "fileSizeBytes": size
                }));
            }
        }
        Ok(json!(children))
    } else {
        Ok(json!([]))
    }
}

/// Retrieves cached column statistics or returns empty map
pub async fn handle_get_column_stats_map(
    _app: AppHandle,
    state: &AppState,
    payload: Value,
) -> Result<Value, String> {
    let pool = state.get_duckdb_pool().await;
    if let Ok((query_rep, _, _)) = extract_query_and_pagination(&payload) {
        if let QueryRep::Table { table_name } = &query_rep {
            if let Some(stats) = pool.stats_cache().get(table_name).await {
                return serde_json::to_value(&stats).map_err(|e| e.to_string());
            }
        }
    }
    Ok(json!({}))
}

/// Executes arbitrary SQL query and returns rows as JSON array of objects
pub async fn handle_run_sql(
    _app: AppHandle,
    state: &AppState,
    payload: Value,
) -> Result<Value, String> {
    let sql = payload
        .get("sql")
        .or_else(|| payload.get("sqlQuery"))
        .or_else(|| payload.get("query"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required 'sql' or 'sqlQuery' field in payload".to_string())?;

    let pool = state.get_duckdb_pool().await;
    let sql_str = sql.to_string();
    pool.eval_ui_conn(move |conn| {
        let mut stmt = conn.prepare(&sql_str).map_err(|e| e.to_string())?;
        let col_names: Vec<String> = stmt.column_names().into_iter().map(|s| s.to_string()).collect();
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        let mut results = Vec::new();
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let mut row_map = serde_json::Map::new();
            for (i, col_name) in col_names.iter().enumerate() {
                let val: Value = if let Ok(v) = row.get::<_, i64>(i) {
                    json!(v)
                } else if let Ok(v) = row.get::<_, f64>(i) {
                    json!(v)
                } else if let Ok(v) = row.get::<_, String>(i) {
                    json!(v)
                } else if let Ok(v) = row.get::<_, bool>(i) {
                    json!(v)
                } else {
                    Value::Null
                };
                row_map.insert(col_name.clone(), val);
            }
            results.push(Value::Object(row_map));
        }
        Ok(Value::Array(results))
    }).await
}
