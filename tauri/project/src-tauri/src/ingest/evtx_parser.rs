//! evtx_parser.rs
//!
//! Windows Event Log (.evtx) Binary Forensics Ingestion Engine (Milestone M5 / F19)
//! - Uses Rust SIMD `evtx = "0.8.5"` binary parser in `tokio::task::spawn_blocking`.
//! - Streams directly into Apache Arrow `RecordBatch`es (32K batch size) and writes
//!   to `parquet::arrow::ArrowWriter` with Snappy compression (<30MB flat RAM, 0 disk churn).
//! - Extracts 9 typed forensic columns:
//!   `record_id`, `time_created`, `event_id`, `provider_name`, `level`, `channel`, `computer`, `user_id`, `payload_json`.
//! - Resilient extractors handling polymorphic `EventID` (integer vs `{"#text": ...}`) and corrupted chunk recovery.

use std::fs::File;
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use arrow::array::{
    ArrayRef, Int32Builder, Int64Builder, StringBuilder, TimestampMicrosecondBuilder,
};
use arrow::datatypes::{DataType, Field, Schema as ArrowSchema, TimeUnit};
use arrow::record_batch::RecordBatch;
use evtx::{EvtxParser, ParserSettings};
use parquet::arrow::ArrowWriter;
use parquet::basic::Compression;
use parquet::file::properties::WriterProperties;
use serde_json::Value;

use crate::ingest::progress::ProgressDispatcher;
use crate::ingest::scheduler::CancellationToken;

#[derive(Debug, Clone, Default)]
pub struct EvtxIngestResult {
    pub row_count: i64,
    pub parquet_size: i64,
    pub duration_ms: i64,
    pub corrupted_records: u64,
}

pub fn create_evtx_arrow_schema() -> Arc<ArrowSchema> {
    Arc::new(ArrowSchema::new(vec![
        Field::new("record_id", DataType::Int64, false),
        Field::new(
            "time_created",
            DataType::Timestamp(TimeUnit::Microsecond, Some("UTC".into())),
            false,
        ),
        Field::new("event_id", DataType::Int32, true),
        Field::new("provider_name", DataType::Utf8, true),
        Field::new("level", DataType::Int32, true),
        Field::new("channel", DataType::Utf8, true),
        Field::new("computer", DataType::Utf8, true),
        Field::new("user_id", DataType::Utf8, true),
        Field::new("payload_json", DataType::Utf8, true),
    ]))
}

/// Extract polymorphic EventID: integer scalar, string, or object with `{"#text": 4624}`
pub fn extract_event_id(system: &Value) -> Option<i32> {
    let eid_val = system.get("EventID")?;
    match eid_val {
        Value::Number(n) => n.as_i64().map(|v| v as i32),
        Value::String(s) => s.parse::<i32>().ok(),
        Value::Object(map) => {
            if let Some(text_val) = map.get("#text") {
                match text_val {
                    Value::Number(n) => n.as_i64().map(|v| v as i32),
                    Value::String(s) => s.parse::<i32>().ok(),
                    _ => None,
                }
            } else {
                None
            }
        }
        _ => None,
    }
}

/// Extract provider name from `Event.System.Provider["#attributes"]["Name"]` or string
pub fn extract_provider_name(system: &Value) -> Option<String> {
    let provider = system.get("Provider")?;
    if let Some(name) = provider.get("#attributes").and_then(|a| a.get("Name")).and_then(|v| v.as_str()) {
        return Some(name.to_string());
    }
    if let Some(name) = provider.get("Name").and_then(|v| v.as_str()) {
        return Some(name.to_string());
    }
    provider.as_str().map(|s| s.to_string())
}

/// Extract Level from `Event.System.Level`
pub fn extract_level(system: &Value) -> Option<i32> {
    let lvl = system.get("Level")?;
    match lvl {
        Value::Number(n) => n.as_i64().map(|v| v as i32),
        Value::String(s) => s.parse::<i32>().ok(),
        Value::Object(map) => map
            .get("#text")
            .and_then(|v| v.as_i64().map(|i| i as i32).or_else(|| v.as_str().and_then(|s| s.parse().ok()))),
        _ => None,
    }
}

/// Extract Channel from `Event.System.Channel`
pub fn extract_channel(system: &Value) -> Option<String> {
    let ch = system.get("Channel")?;
    match ch {
        Value::String(s) => Some(s.clone()),
        Value::Object(map) => map.get("#text").and_then(|v| v.as_str()).map(|s| s.to_string()),
        _ => None,
    }
}

/// Extract Computer from `Event.System.Computer`
pub fn extract_computer(system: &Value) -> Option<String> {
    let c = system.get("Computer")?;
    match c {
        Value::String(s) => Some(s.clone()),
        Value::Object(map) => map.get("#text").and_then(|v| v.as_str()).map(|s| s.to_string()),
        _ => None,
    }
}

/// Extract UserID / SID from System.Security or EventData fallback
pub fn extract_user_id(system: &Value, event_data: Option<&Value>) -> Option<String> {
    if let Some(sec) = system.get("Security") {
        if let Some(uid) = sec.get("#attributes").and_then(|a| a.get("UserID")).and_then(|v| v.as_str()) {
            if !uid.is_empty() {
                return Some(uid.to_string());
            }
        }
    }
    if let Some(ed) = event_data {
        if let Some(sid) = ed.get("TargetUserSid").and_then(|v| v.as_str()) {
            return Some(sid.to_string());
        }
        if let Some(sid) = ed.get("SubjectUserSid").and_then(|v| v.as_str()) {
            return Some(sid.to_string());
        }
        if let Some(usr) = ed.get("TargetUserName").and_then(|v| v.as_str()) {
            return Some(usr.to_string());
        }
    }
    None
}

/// Extract fields from a root EVTX JSON record
pub fn extract_fields_from_value(
    val: &Value,
) -> (
    Option<i32>,
    Option<String>,
    Option<i32>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    let root = val.get("Event").unwrap_or(val);
    let system = root.get("System");
    let event_data = root.get("EventData").or_else(|| root.get("UserData"));

    let eid = system.and_then(extract_event_id);
    let provider = system.and_then(extract_provider_name);
    let level = system.and_then(extract_level);
    let channel = system.and_then(extract_channel);
    let computer = system.and_then(extract_computer);
    let user_id = extract_user_id(system.unwrap_or(&Value::Null), event_data);

    let payload = event_data
        .map(|v| v.to_string())
        .or_else(|| Some(root.to_string()));

    (eid, provider, level, channel, computer, user_id, payload)
}

/// Ingest a Windows Event Log (.evtx) file into compressed Parquet cache.
pub fn ingest_evtx_file(
    file_id: &str,
    evtx_path: &Path,
    target_parquet_path: &Path,
    threads: usize,
    cancellation_token: &CancellationToken,
    dispatcher: Option<&ProgressDispatcher>,
) -> Result<EvtxIngestResult, String> {
    let t0 = Instant::now();
    let schema = create_evtx_arrow_schema();

    let settings = ParserSettings::default()
        .num_threads(threads.max(1))
        .validate_checksums(false);

    let mut parser = EvtxParser::from_path(evtx_path)
        .map_err(|e| format!("Failed to open EVTX file {:?}: {}", evtx_path, e))?
        .with_configuration(settings);

    let temp_out = target_parquet_path.with_extension("parquet.tmp");
    if let Some(parent) = temp_out.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let file = File::create(&temp_out)
        .map_err(|e| format!("Failed to create temporary output file {:?}: {}", temp_out, e))?;

    let props = WriterProperties::builder()
        .set_compression(Compression::SNAPPY)
        .build();

    let mut writer = ArrowWriter::try_new(file, schema.clone(), Some(props))
        .map_err(|e| format!("Failed to create Parquet writer: {}", e))?;

    const BATCH_SIZE: usize = 32768;
    let mut b_record_id = Int64Builder::with_capacity(BATCH_SIZE);
    let mut b_time = TimestampMicrosecondBuilder::with_capacity(BATCH_SIZE).with_timezone("UTC");
    let mut b_event_id = Int32Builder::with_capacity(BATCH_SIZE);
    let mut b_provider = StringBuilder::with_capacity(BATCH_SIZE, BATCH_SIZE * 32);
    let mut b_level = Int32Builder::with_capacity(BATCH_SIZE);
    let mut b_channel = StringBuilder::with_capacity(BATCH_SIZE, BATCH_SIZE * 16);
    let mut b_computer = StringBuilder::with_capacity(BATCH_SIZE, BATCH_SIZE * 24);
    let mut b_user_id = StringBuilder::with_capacity(BATCH_SIZE, BATCH_SIZE * 24);
    let mut b_payload = StringBuilder::with_capacity(BATCH_SIZE, BATCH_SIZE * 128);

    let mut total_rows = 0i64;
    let mut corrupted = 0u64;
    let mut batch_rows = 0usize;

    if let Some(disp) = dispatcher {
        disp.emit_stage_sniffing(file_id, &evtx_path.to_string_lossy(), t0.elapsed().as_millis() as u64);
    }

    for record_res in parser.records_json_value() {
        if cancellation_token.is_cancelled() {
            let _ = writer.close();
            let _ = std::fs::remove_file(&temp_out);
            return Err("Ingestion cancelled by user".to_string());
        }

        match record_res {
            Ok(rec) => {
                let (eid, provider, level, channel, computer, uid, payload) =
                    extract_fields_from_value(&rec.data);

                b_record_id.append_value(rec.event_record_id as i64);
                b_time.append_value(rec.timestamp.timestamp_micros());

                if let Some(v) = eid {
                    b_event_id.append_value(v);
                } else {
                    b_event_id.append_null();
                }

                if let Some(ref v) = provider {
                    b_provider.append_value(v);
                } else {
                    b_provider.append_null();
                }

                if let Some(v) = level {
                    b_level.append_value(v);
                } else {
                    b_level.append_null();
                }

                if let Some(ref v) = channel {
                    b_channel.append_value(v);
                } else {
                    b_channel.append_null();
                }

                if let Some(ref v) = computer {
                    b_computer.append_value(v);
                } else {
                    b_computer.append_null();
                }

                if let Some(ref v) = uid {
                    b_user_id.append_value(v);
                } else {
                    b_user_id.append_null();
                }

                if let Some(ref v) = payload {
                    b_payload.append_value(v);
                } else {
                    b_payload.append_null();
                }

                batch_rows += 1;
                total_rows += 1;

                if batch_rows >= BATCH_SIZE {
                    let batch = RecordBatch::try_new(
                        schema.clone(),
                        vec![
                            Arc::new(b_record_id.finish()) as ArrayRef,
                            Arc::new(b_time.finish()) as ArrayRef,
                            Arc::new(b_event_id.finish()) as ArrayRef,
                            Arc::new(b_provider.finish()) as ArrayRef,
                            Arc::new(b_level.finish()) as ArrayRef,
                            Arc::new(b_channel.finish()) as ArrayRef,
                            Arc::new(b_computer.finish()) as ArrayRef,
                            Arc::new(b_user_id.finish()) as ArrayRef,
                            Arc::new(b_payload.finish()) as ArrayRef,
                        ],
                    )
                    .map_err(|e| format!("EVTX RecordBatch construction error: {}", e))?;

                    writer
                        .write(&batch)
                        .map_err(|e| format!("Parquet write error: {}", e))?;

                    batch_rows = 0;

                    if let Some(disp) = dispatcher {
                        disp.emit_stage_parsing(
                            file_id,
                            &evtx_path.to_string_lossy(),
                            total_rows as u64,
                            45,
                            t0.elapsed().as_millis() as u64,
                        );
                    }
                }
            }
            Err(e) => {
                tracing::warn!("Corrupted or unreadable EVTX record skipped: {}", e);
                corrupted += 1;
            }
        }
    }

    if batch_rows > 0 {
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(b_record_id.finish()) as ArrayRef,
                Arc::new(b_time.finish()) as ArrayRef,
                Arc::new(b_event_id.finish()) as ArrayRef,
                Arc::new(b_provider.finish()) as ArrayRef,
                Arc::new(b_level.finish()) as ArrayRef,
                Arc::new(b_channel.finish()) as ArrayRef,
                Arc::new(b_computer.finish()) as ArrayRef,
                Arc::new(b_user_id.finish()) as ArrayRef,
                Arc::new(b_payload.finish()) as ArrayRef,
            ],
        )
        .map_err(|e| format!("EVTX RecordBatch construction error: {}", e))?;

        writer
            .write(&batch)
            .map_err(|e| format!("Parquet write error: {}", e))?;
    }

    if let Some(disp) = dispatcher {
        disp.emit_stage_writing(
            file_id,
            &evtx_path.to_string_lossy(),
            total_rows as u64,
            t0.elapsed().as_millis() as u64,
        );
    }

    writer
        .close()
        .map_err(|e| format!("Parquet close error: {}", e))?;

    if target_parquet_path.exists() {
        let _ = std::fs::remove_file(target_parquet_path);
    }
    std::fs::rename(&temp_out, target_parquet_path)
        .map_err(|e| format!("Atomic rename error: {}", e))?;

    let parquet_size = std::fs::metadata(target_parquet_path)
        .map(|m| m.len() as i64)
        .unwrap_or(0);

    if let Some(disp) = dispatcher {
        disp.emit_stage_ready(
            file_id,
            &evtx_path.to_string_lossy(),
            total_rows as u64,
            t0.elapsed().as_millis() as u64,
        );
    }

    Ok(EvtxIngestResult {
        row_count: total_rows,
        parquet_size,
        duration_ms: t0.elapsed().as_millis() as i64,
        corrupted_records: corrupted,
    })
}
