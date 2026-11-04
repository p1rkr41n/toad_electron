// proposed_read_all_events_from_parquet.rs
// Pure Rust Native Parquet / Arrow WAL Deserializer for Toad Tauri v2
// Replaces in-memory DuckDB instantiation in `tauri/project/src-tauri/src/ledger/parquet_ledger.rs`

use arrow::array::{Array, Int32Array, Int64Array, LargeStringArray, StringArray};
use arrow::record_batch::RecordBatch;
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

enum CachedStringCol<'a> {
    Utf8(&'a StringArray),
    LargeUtf8(&'a LargeStringArray),
}

impl<'a> CachedStringCol<'a> {
    #[inline]
    fn get(&self, row: usize) -> Option<String> {
        match self {
            Self::Utf8(arr) => {
                if arr.is_null(row) {
                    None
                } else {
                    Some(arr.value(row).to_string())
                }
            }
            Self::LargeUtf8(arr) => {
                if arr.is_null(row) {
                    None
                } else {
                    Some(arr.value(row).to_string())
                }
            }
        }
    }
}

enum CachedI64Col<'a> {
    I64(&'a Int64Array),
    I32(&'a Int32Array),
}

impl<'a> CachedI64Col<'a> {
    #[inline]
    fn get(&self, row: usize) -> Option<i64> {
        match self {
            Self::I64(arr) => {
                if arr.is_null(row) {
                    None
                } else {
                    Some(arr.value(row))
                }
            }
            Self::I32(arr) => {
                if arr.is_null(row) {
                    None
                } else {
                    Some(arr.value(row) as i64)
                }
            }
        }
    }
}

#[inline]
fn get_string_array<'a>(batch: &'a RecordBatch, col_idx: Option<usize>) -> Option<CachedStringCol<'a>> {
    let idx = col_idx?;
    if idx >= batch.num_columns() {
        return None;
    }
    let col = batch.column(idx);
    if let Some(arr) = col.as_any().downcast_ref::<StringArray>() {
        Some(CachedStringCol::Utf8(arr))
    } else if let Some(arr) = col.as_any().downcast_ref::<LargeStringArray>() {
        Some(CachedStringCol::LargeUtf8(arr))
    } else {
        None
    }
}

#[inline]
fn get_i64_array<'a>(batch: &'a RecordBatch, col_idx: Option<usize>) -> Option<CachedI64Col<'a>> {
    let idx = col_idx?;
    if idx >= batch.num_columns() {
        return None;
    }
    let col = batch.column(idx);
    if let Some(arr) = col.as_any().downcast_ref::<Int64Array>() {
        Some(CachedI64Col::I64(arr))
    } else if let Some(arr) = col.as_any().downcast_ref::<Int32Array>() {
        Some(CachedI64Col::I32(arr))
    } else {
        None
    }
}

/// Read all events from Parquet WAL via native Rust Parquet / Arrow reader (< 0.5ms)
pub fn read_all_events_from_parquet(ledger_path: &Path) -> Result<Vec<LedgerEvent>, String> {
    if !ledger_path.exists()
        || fs::metadata(ledger_path)
            .map(|m| m.len() == 0)
            .unwrap_or(true)
    {
        return Ok(Vec::new());
    }

    let file = fs::File::open(ledger_path)
        .map_err(|e| format!("Failed to open ledger file: {}", e))?;

    let builder = ParquetRecordBatchReaderBuilder::try_new(file)
        .map_err(|e| format!("ParquetRecordBatchReaderBuilder error: {}", e))?;

    let schema = builder.schema();
    let mut col_map: HashMap<String, usize> = HashMap::with_capacity(schema.fields().len());
    for (idx, field) in schema.fields().iter().enumerate() {
        col_map.insert(field.name().to_lowercase(), idx);
    }

    let col_event_id = col_map.get("event_id").copied();
    let col_event_type = col_map.get("event_type").copied();
    let col_timestamp = col_map.get("timestamp").copied();
    let col_project_id = col_map.get("project_id").copied();
    let col_project_name = col_map.get("project_name").copied();
    let col_file_id = col_map.get("file_id").copied();
    let col_file_path = col_map
        .get("file_path")
        .or_else(|| col_map.get("source_path"))
        .copied();
    let col_file_size = col_map
        .get("file_size")
        .or_else(|| col_map.get("source_size"))
        .copied();
    let col_file_type = col_map.get("file_type").copied();
    let col_source_mtime = col_map.get("source_mtime").copied();
    let col_parquet_path = col_map.get("parquet_path").copied();
    let col_parquet_size = col_map.get("parquet_size").copied();
    let col_row_count = col_map.get("row_count").copied();
    let col_status = col_map.get("status").copied();
    let col_duration_ms = col_map.get("duration_ms").copied();
    let col_metadata_json = col_map
        .get("metadata_json")
        .or_else(|| col_map.get("extra_json"))
        .copied();

    let reader = builder
        .build()
        .map_err(|e| format!("Failed to build Parquet reader: {}", e))?;

    let mut events = Vec::new();

    for batch_res in reader {
        let batch = batch_res.map_err(|e| format!("Parquet record batch read error: {}", e))?;
        let num_rows = batch.num_rows();
        if num_rows == 0 {
            continue;
        }

        // Cache column arrays once per batch to eliminate per-cell dynamic downcasting
        let arr_event_id = get_string_array(&batch, col_event_id);
        let arr_event_type = get_string_array(&batch, col_event_type);
        let arr_timestamp = get_i64_array(&batch, col_timestamp);
        let arr_project_id = get_string_array(&batch, col_project_id);
        let arr_project_name = get_string_array(&batch, col_project_name);
        let arr_file_id = get_string_array(&batch, col_file_id);
        let arr_file_path = get_string_array(&batch, col_file_path);
        let arr_file_size = get_i64_array(&batch, col_file_size);
        let arr_file_type = get_string_array(&batch, col_file_type);
        let arr_source_mtime = get_i64_array(&batch, col_source_mtime);
        let arr_parquet_path = get_string_array(&batch, col_parquet_path);
        let arr_parquet_size = get_i64_array(&batch, col_parquet_size);
        let arr_row_count = get_i64_array(&batch, col_row_count);
        let arr_status = get_string_array(&batch, col_status);
        let arr_duration_ms = get_i64_array(&batch, col_duration_ms);
        let arr_metadata_json = get_string_array(&batch, col_metadata_json);

        for row in 0..num_rows {
            let ev = LedgerEvent {
                event_id: arr_event_id
                    .as_ref()
                    .and_then(|a| a.get(row))
                    .unwrap_or_default(),
                event_type: arr_event_type
                    .as_ref()
                    .and_then(|a| a.get(row))
                    .unwrap_or_else(|| "FILE_ADDED".to_string()),
                timestamp: arr_timestamp
                    .as_ref()
                    .and_then(|a| a.get(row))
                    .unwrap_or(0),
                project_id: arr_project_id
                    .as_ref()
                    .and_then(|a| a.get(row))
                    .unwrap_or_else(|| "orphan_prj".to_string()),
                project_name: arr_project_name.as_ref().and_then(|a| a.get(row)),
                file_id: arr_file_id.as_ref().and_then(|a| a.get(row)),
                file_path: arr_file_path.as_ref().and_then(|a| a.get(row)),
                file_size: arr_file_size.as_ref().and_then(|a| a.get(row)),
                file_type: arr_file_type.as_ref().and_then(|a| a.get(row)),
                source_mtime: arr_source_mtime.as_ref().and_then(|a| a.get(row)),
                parquet_path: arr_parquet_path.as_ref().and_then(|a| a.get(row)),
                parquet_size: arr_parquet_size.as_ref().and_then(|a| a.get(row)),
                row_count: arr_row_count.as_ref().and_then(|a| a.get(row)),
                status: Some(
                    arr_status
                        .as_ref()
                        .and_then(|a| a.get(row))
                        .unwrap_or_else(|| "READY".to_string()),
                ),
                duration_ms: arr_duration_ms.as_ref().and_then(|a| a.get(row)),
                metadata_json: arr_metadata_json.as_ref().and_then(|a| a.get(row)),
            };
            events.push(ev);
        }
    }

    events.sort_by_key(|e| e.timestamp);
    Ok(events)
}
