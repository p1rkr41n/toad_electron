//! jsonl_streamer.rs
//!
//! JSONL / NDJSON Streaming Ingestion & Dynamic Schema Unnesting Engine (Milestone M5 / F20)
//! - 2-phase schema introspection via DuckDB `read_json_auto` and `DESCRIBE`.
//! - Recursively unnests nested DuckDB `STRUCT` columns into flat dot-notated columnar fields
//!   (e.g. `"Event"."System"."EventID" AS "Event.System.EventID"`).
//! - Streams directly into compressed Parquet (`_cached_<hash>.parquet`) with Snappy compression.
//! - Fallback to `dirty_log` if input contains non-JSON or severely damaged lines.

use std::path::Path;
use std::time::Instant;

use duckdb::Connection;

use crate::engine::fast_count::FastCounter;
use crate::ingest::dirty_log::ingest_dirty_log;
use crate::ingest::progress::ProgressDispatcher;
use crate::ingest::scheduler::CancellationToken;

#[derive(Debug, Clone, Default)]
pub struct JsonlIngestResult {
    pub row_count: i64,
    pub parquet_size: i64,
    pub unnested_columns_count: usize,
    pub duration_ms: i64,
}

/// Recursively parses DuckDB STRUCT signature into leaf path projections.
/// Example input: `STRUCT(name VARCHAR, age BIGINT, info STRUCT(city VARCHAR, zip INT))`
/// Output leaves: `["name", "age", "info.city", "info.zip"]`
pub fn parse_struct_fields(struct_type_str: &str) -> Vec<String> {
    let s = struct_type_str.trim();
    if !s.starts_with("STRUCT(") || !s.ends_with(')') {
        return Vec::new();
    }

    let inner = &s[7..s.len() - 1].trim();
    let mut fields = Vec::new();
    let mut depth = 0;
    let mut current_field = String::new();

    for c in inner.chars() {
        match c {
            '(' => {
                depth += 1;
                current_field.push(c);
            }
            ')' => {
                depth -= 1;
                current_field.push(c);
            }
            ',' if depth == 0 => {
                let trimmed = current_field.trim().to_string();
                if !trimmed.is_empty() {
                    fields.push(trimmed);
                }
                current_field.clear();
            }
            _ => {
                current_field.push(c);
            }
        }
    }
    let trimmed = current_field.trim().to_string();
    if !trimmed.is_empty() {
        fields.push(trimmed);
    }

    let mut result = Vec::new();
    for f in fields {
        // Each field is in format: `field_name TYPE` or `"field_name" TYPE`
        let parts: Vec<&str> = f.splitn(2, ' ').collect();
        if parts.is_empty() {
            continue;
        }
        let raw_name = parts[0].trim().trim_matches('"');
        let field_type = if parts.len() > 1 { parts[1].trim() } else { "" };

        if field_type.starts_with("STRUCT(") {
            let sub_leaves = parse_struct_fields(field_type);
            if sub_leaves.is_empty() {
                result.push(raw_name.to_string());
            } else {
                for sub in sub_leaves {
                    result.push(format!("{}.{}", raw_name, sub));
                }
            }
        } else {
            result.push(raw_name.to_string());
        }
    }

    result
}

/// Build SQL projection for dot-notated paths:
/// `root.sub.leaf` becomes `"root"."sub"."leaf" AS "root.sub.leaf"`
fn build_projection_for_leaf(root_col: &str, leaf_path: &str) -> String {
    let full_path = if leaf_path.is_empty() {
        root_col.to_string()
    } else {
        format!("{}.{}", root_col, leaf_path)
    };

    let segments: Vec<&str> = full_path.split('.').collect();
    let quoted_chain: Vec<String> = segments.iter().map(|seg| format!("\"{}\"", seg.replace('"', "\"\""))).collect();
    let expr = quoted_chain.join(".");
    format!("{} AS \"{}\"", expr, full_path.replace('"', "\"\""))
}

/// Ingest a JSONL / NDJSON file into compressed Parquet with dynamic schema unnesting.
pub fn ingest_jsonl_file(
    file_id: &str,
    source_path: &Path,
    target_parquet_path: &Path,
    conn: &Connection,
    cancellation_token: &CancellationToken,
    dispatcher: Option<&ProgressDispatcher>,
) -> Result<JsonlIngestResult, String> {
    let t0 = Instant::now();

    if let Some(disp) = dispatcher {
        disp.emit_stage_sniffing(file_id, &source_path.to_string_lossy(), t0.elapsed().as_millis() as u64);
    }

    let temp_out = target_parquet_path.with_extension("parquet.tmp");
    if let Some(parent) = temp_out.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if temp_out.exists() {
        let _ = std::fs::remove_file(&temp_out);
    }

    let safe_src = source_path
        .to_string_lossy()
        .replace('\\', "/")
        .replace('\'', "''");
    let safe_dst = temp_out
        .to_string_lossy()
        .replace('\\', "/")
        .replace('\'', "''");

    if cancellation_token.is_cancelled() {
        let _ = std::fs::remove_file(&temp_out);
        return Err("Ingestion cancelled by user".to_string());
    }

    // Phase 1: Introspect schema using DESCRIBE
    let describe_sql = format!(
        "DESCRIBE SELECT * FROM read_json_auto('{src}', sample_size = 2048, ignore_errors = true) LIMIT 0;",
        src = safe_src
    );

    let mut projections: Vec<String> = Vec::new();
    let mut has_structs = false;

    if let Ok(mut stmt) = conn.prepare(&describe_sql) {
        if let Ok(mut rows) = stmt.query([]) {
            while let Ok(Some(row)) = rows.next() {
                let col_name: String = row.get(0).unwrap_or_default();
                let col_type: String = row.get(1).unwrap_or_default();

                if col_type.starts_with("STRUCT(") {
                    has_structs = true;
                    let leaves = parse_struct_fields(&col_type);
                    if leaves.is_empty() {
                        projections.push(format!("\"{}\"", col_name.replace('"', "\"\"")));
                    } else {
                        for leaf in leaves {
                            projections.push(build_projection_for_leaf(&col_name, &leaf));
                        }
                    }
                } else {
                    projections.push(format!("\"{}\"", col_name.replace('"', "\"\"")));
                }
            }
        }
    }

    if cancellation_token.is_cancelled() {
        let _ = std::fs::remove_file(&temp_out);
        return Err("Ingestion cancelled by user".to_string());
    }

    if let Some(disp) = dispatcher {
        disp.emit_stage_parsing(file_id, &source_path.to_string_lossy(), 0, 45, t0.elapsed().as_millis() as u64);
    }

    // Phase 2: Copy to Parquet
    let unnested_count = projections.len();
    let copy_sql = if has_structs && !projections.is_empty() {
        format!(
            "COPY (SELECT {projections} FROM read_json_auto('{src}', sample_size = 2048, ignore_errors = true)) TO '{dst}' (FORMAT PARQUET, COMPRESSION SNAPPY, ROW_GROUP_SIZE 122880);",
            projections = projections.join(", "),
            src = safe_src,
            dst = safe_dst
        )
    } else {
        format!(
            "COPY (SELECT * FROM read_json_auto('{src}', sample_size = 2048, ignore_errors = true)) TO '{dst}' (FORMAT PARQUET, COMPRESSION SNAPPY, ROW_GROUP_SIZE 122880);",
            src = safe_src,
            dst = safe_dst
        )
    };

    let mut exec_result = conn.execute_batch(&copy_sql);

    // Fallback if unnested query fails: try plain read_json_auto
    if exec_result.is_err() && has_structs && !cancellation_token.is_cancelled() {
        tracing::warn!("Unnested JSON projection failed; falling back to flat read_json_auto");
        let _ = std::fs::remove_file(&temp_out);
        let fallback_sql = format!(
            "COPY (SELECT * FROM read_json_auto('{src}', sample_size = 2048, ignore_errors = true)) TO '{dst}' (FORMAT PARQUET, COMPRESSION SNAPPY, ROW_GROUP_SIZE 122880);",
            src = safe_src,
            dst = safe_dst
        );
        exec_result = conn.execute_batch(&fallback_sql);
    }

    if cancellation_token.is_cancelled() {
        let _ = std::fs::remove_file(&temp_out);
        return Err("Ingestion cancelled by user".to_string());
    }

    // Fallback to dirty_log if read_json_auto completely fails
    if exec_result.is_err() {
        tracing::warn!("JSON read_json_auto failed; falling back to dirty_log");
        let _ = std::fs::remove_file(&temp_out);
        let dirty_res = ingest_dirty_log(
            file_id,
            source_path,
            target_parquet_path,
            cancellation_token,
            dispatcher,
        )?;
        return Ok(JsonlIngestResult {
            row_count: dirty_res.row_count,
            parquet_size: dirty_res.parquet_size,
            unnested_columns_count: 3,
            duration_ms: t0.elapsed().as_millis() as i64,
        });
    }

    if let Some(disp) = dispatcher {
        disp.emit_stage_writing(file_id, &source_path.to_string_lossy(), 0, t0.elapsed().as_millis() as u64);
    }

    if target_parquet_path.exists() {
        let _ = std::fs::remove_file(target_parquet_path);
    }
    std::fs::rename(&temp_out, target_parquet_path)
        .map_err(|e| format!("Atomic rename error for JSONL parquet: {}", e))?;

    let row_count = FastCounter::count_parquet_rows(target_parquet_path).unwrap_or(0);
    let parquet_size = std::fs::metadata(target_parquet_path)
        .map(|m| m.len() as i64)
        .unwrap_or(0);

    if let Some(disp) = dispatcher {
        disp.emit_stage_ready(
            file_id,
            &source_path.to_string_lossy(),
            row_count as u64,
            t0.elapsed().as_millis() as u64,
        );
    }

    Ok(JsonlIngestResult {
        row_count,
        parquet_size,
        unnested_columns_count: unnested_count,
        duration_ms: t0.elapsed().as_millis() as i64,
    })
}
