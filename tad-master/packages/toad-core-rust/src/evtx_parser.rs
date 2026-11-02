//! evtx_parser.rs
//!
//! Windows XML Event Log (.evtx) Parser cho TOAD Core Engine.
//! Kế thừa và nâng cấp kiến trúc từ `rust_kv_bench`:
//! - Trích xuất có cấu trúc: EventID, TimeCreated, Level, Computer, Channel, Provider
//! - Flattening toàn bộ EventData thành JSON Object chuẩn hóa
//! - Xuất streaming ra JSONL (.jsonl) tốc độ cao cho DuckDB tạo VIEW

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NormalizedEvtxRecord {
    #[serde(rename = "RecordID")]
    pub record_id: Option<String>,
    #[serde(rename = "EventID")]
    pub event_id: Option<String>,
    #[serde(rename = "Level")]
    pub level: Option<String>,
    #[serde(rename = "TimeCreated")]
    pub time_created: Option<String>,
    #[serde(rename = "Provider")]
    pub provider: Option<String>,
    #[serde(rename = "Channel")]
    pub channel: Option<String>,
    #[serde(rename = "Computer")]
    pub computer: Option<String>,
    #[serde(rename = "UserId")]
    pub user_id: Option<String>,
    #[serde(flatten)]
    pub event_data: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone)]
pub struct EvtxConvertStats {
    pub total_records: u64,
    pub errors: u64,
    pub elapsed_ms: f64,
}

pub fn escape_json_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 16);
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out
}

use evtx::{EvtxParser, ParserSettings};

/// Chuyển đổi file .evtx sang JSONL có cấu trúc cho Toad Ingestion (Native Multi-Threaded SIMD)
pub fn convert_evtx_to_jsonl(
    evtx_path: &Path,
    output_path: &Path,
    max_records: Option<u64>,
) -> std::io::Result<EvtxConvertStats> {
    let start = std::time::Instant::now();
    let out_file = File::create(output_path)?;
    let mut writer = BufWriter::with_capacity(1024 * 1024, out_file); // 1MB buffer

    let settings = ParserSettings::default().num_threads(0);
    let mut parser = match EvtxParser::from_path(evtx_path) {
        Ok(p) => p.with_configuration(settings),
        Err(e) => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("Failed to open EVTX file: {}", e),
            ));
        }
    };

    let mut total_records: u64 = 0;
    let mut errors: u64 = 0;

    for record_res in parser.records_json_value() {
        if let Some(max) = max_records {
            if total_records >= max {
                break;
            }
        }

        match record_res {
            Ok(rec) => {
                let mut map = serde_json::Map::new();

                // 1. Record ID & Timestamp từ EVTX header
                map.insert(
                    "RecordID".to_string(),
                    serde_json::Value::String(rec.event_record_id.to_string()),
                );
                map.insert(
                    "TimeCreated".to_string(),
                    serde_json::Value::String(rec.timestamp.to_string()),
                );

                // 2. Parse Event.System & Event.EventData từ rec.data
                if let Some(event_obj) = rec.data.get("Event") {
                    if let Some(sys) = event_obj.get("System") {
                        if let Some(eid) = sys.get("EventID") {
                            let eid_str = match eid {
                                serde_json::Value::Number(n) => n.to_string(),
                                serde_json::Value::String(s) => s.clone(),
                                serde_json::Value::Object(o) => o
                                    .get("#text")
                                    .map(|t| match t {
                                        serde_json::Value::String(s) => s.clone(),
                                        serde_json::Value::Number(n) => n.to_string(),
                                        _ => t.to_string(),
                                    })
                                    .unwrap_or_else(|| eid.to_string()),
                                _ => eid.to_string(),
                            };
                            map.insert("EventID".to_string(), serde_json::Value::String(eid_str));
                        }

                        if let Some(lvl) = sys.get("Level") {
                            let lvl_str = match lvl.as_u64() {
                                Some(1) => "Critical",
                                Some(2) => "Error",
                                Some(3) => "Warning",
                                Some(4) => "Information",
                                Some(5) => "Verbose",
                                _ => "Information",
                            };
                            map.insert(
                                "Level".to_string(),
                                serde_json::Value::String(lvl_str.to_string()),
                            );
                        } else {
                            map.insert(
                                "Level".to_string(),
                                serde_json::Value::String("Information".to_string()),
                            );
                        }

                        if let Some(prov) = sys.get("Provider") {
                            if let Some(name) = prov
                                .get("#attributes")
                                .and_then(|a| a.get("Name"))
                                .and_then(|n| n.as_str())
                            {
                                map.insert(
                                    "Provider".to_string(),
                                    serde_json::Value::String(name.to_string()),
                                );
                            } else if let Some(name) = prov.get("Name").and_then(|n| n.as_str()) {
                                map.insert(
                                    "Provider".to_string(),
                                    serde_json::Value::String(name.to_string()),
                                );
                            }
                        }

                        if let Some(chan) = sys.get("Channel").and_then(|c| c.as_str()) {
                            map.insert(
                                "Channel".to_string(),
                                serde_json::Value::String(chan.to_string()),
                            );
                        }

                        if let Some(comp) = sys.get("Computer").and_then(|c| c.as_str()) {
                            map.insert(
                                "Computer".to_string(),
                                serde_json::Value::String(comp.to_string()),
                            );
                        }

                        if let Some(sec) = sys.get("Security") {
                            if let Some(uid) = sec
                                .get("#attributes")
                                .and_then(|a| a.get("UserID"))
                                .and_then(|u| u.as_str())
                            {
                                map.insert(
                                    "UserId".to_string(),
                                    serde_json::Value::String(uid.to_string()),
                                );
                            } else if let Some(uid) = sec.get("UserID").and_then(|u| u.as_str()) {
                                map.insert(
                                    "UserId".to_string(),
                                    serde_json::Value::String(uid.to_string()),
                                );
                            }
                        }
                    }

                    // 3. Trích xuất phẳng EventData & gom nhóm thành JSON chuỗi
                    let mut event_data_summary = serde_json::Map::new();
                    let mut p1 = String::new();
                    let mut p2 = String::new();
                    let mut p3 = String::new();

                    if let Some(event_data) = event_obj.get("EventData") {
                        if let Some(data_map) = event_data.as_object() {
                            for (k, v) in data_map {
                                if k == "Data" {
                                    if let Some(arr) = v.as_array() {
                                        for (i, item) in arr.iter().enumerate() {
                                            let text_val = item
                                                .get("#text")
                                                .and_then(|t| t.as_str())
                                                .unwrap_or("");
                                            if i == 0 { p1 = text_val.to_string(); }
                                            if i == 1 { p2 = text_val.to_string(); }
                                            if i == 2 { p3 = text_val.to_string(); }

                                            if let Some(name) = item
                                                .get("#attributes")
                                                .and_then(|a| a.get("Name"))
                                                .and_then(|n| n.as_str())
                                            {
                                                let val = item.get("#text").unwrap_or(item);
                                                event_data_summary.insert(name.to_string(), val.clone());
                                            } else {
                                                event_data_summary.insert(format!("param_{}", i + 1), item.clone());
                                            }
                                        }
                                    } else if let Some(item_obj) = v.as_object() {
                                        if let Some(name) = item_obj
                                            .get("#attributes")
                                            .and_then(|a| a.get("Name"))
                                            .and_then(|n| n.as_str())
                                        {
                                            let val = item_obj.get("#text").unwrap_or(v);
                                            event_data_summary.insert(name.to_string(), val.clone());
                                        } else {
                                            event_data_summary.insert("Data".to_string(), v.clone());
                                        }
                                    } else {
                                        event_data_summary.insert("Data".to_string(), v.clone());
                                    }
                                } else if k != "#attributes" {
                                    event_data_summary.insert(k.clone(), v.clone());
                                    if p1.is_empty() {
                                        if let Some(s) = v.as_str() { p1 = s.to_string(); }
                                    }
                                }
                            }
                        }
                    }

                    // 4. Trích xuất UserData (nếu có)
                    if let Some(user_data) = event_obj.get("UserData") {
                        if let Some(ud_map) = user_data.as_object() {
                            for (k, v) in ud_map {
                                if k != "#attributes" {
                                    event_data_summary.insert(k.clone(), v.clone());
                                }
                            }
                        }
                    }

                    map.insert("param1".to_string(), serde_json::Value::String(p1));
                    map.insert("param2".to_string(), serde_json::Value::String(p2));
                    map.insert("param3".to_string(), serde_json::Value::String(p3));
                    map.insert(
                        "EventData".to_string(),
                        serde_json::Value::String(serde_json::to_string(&event_data_summary).unwrap_or_default()),
                    );
                }

                // 5. Raw Event String cho Expand / Detail Panel
                let raw_str = serde_json::to_string(&rec.data).unwrap_or_default();
                map.insert("RawEvent".to_string(), serde_json::Value::String(raw_str));

                // Xuất dòng JSON
                let json_line = serde_json::to_string(&map).unwrap_or_default();
                if !json_line.is_empty() {
                    writer.write_all(json_line.as_bytes())?;
                    writer.write_all(b"\n")?;
                    total_records += 1;
                } else {
                    errors += 1;
                }
            }
            Err(_) => {
                errors += 1;
            }
        }
    }

    writer.flush()?;
    let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;

    Ok(EvtxConvertStats {
        total_records,
        errors,
        elapsed_ms,
    })
}
