//! query.rs
//!
//! Query and Engine Command Handlers for Toad Desktop (Tauri v2)
//! Bridges frontend Reltab and ToadViewer IPC commands to the native DuckDB engine and Arrow IPC streamer.

use crate::engine::query_compiler::{QueryExpCompiler, QueryRep};
use crate::state::AppState;
use serde_json::{json, Value};
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

/// Retrieves the active main table name
pub async fn handle_get_table_name(
    _app: AppHandle,
    _state: &AppState,
    _payload: Value,
) -> Result<Value, String> {
    Ok(json!("main_table"))
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
