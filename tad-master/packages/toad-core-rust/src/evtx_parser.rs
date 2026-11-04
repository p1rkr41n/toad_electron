//! evtx_parser.rs
//!
//! Windows XML Event Log (.evtx) Parser cho TOAD Core Engine.
//! Kế thừa và nâng cấp kiến trúc:
//! - Trích xuất có cấu trúc: RecordID, EventID, TimeCreated, Level, Computer, Channel, Provider, UserId
//! - Flattening toàn bộ EventData thành JSON Object chuẩn hóa
//! - Mô hình Hybrid: trích xuất param1, param2, param3, Binary thành cột độc lập cho DataGrid
//! - Xuất streaming ra JSONL (.jsonl) tốc độ cao cho DuckDB tạo VIEW

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NormalizedEvtxRecord {
    #[serde(rename = "RecordID")]
    pub record_id: Option<i64>,
    #[serde(rename = "EventID")]
    pub event_id: Option<i64>,
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
    #[serde(rename = "param1")]
    pub param1: Option<String>,
    #[serde(rename = "param2")]
    pub param2: Option<String>,
    #[serde(rename = "param3")]
    pub param3: Option<String>,
    #[serde(rename = "Binary")]
    pub binary: Option<String>,
    #[serde(rename = "EventData")]
    pub event_data: Option<String>,
    #[serde(rename = "RawEvent")]
    pub raw_event: Option<String>,
    #[serde(flatten)]
    pub extra_data: BTreeMap<String, serde_json::Value>,
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

/// Trích xuất giá trị chuỗi an toàn từ serde_json::Value bất kể kiểu String, Number, Bool hay Object {#text}
fn extract_val_string(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Object(o) => {
            if let Some(t) = o.get("#text") {
                extract_val_string(t)
            } else {
                v.to_string()
            }
        }
        serde_json::Value::Null => String::new(),
        _ => v.to_string(),
    }
}

/// Trích xuất số nguyên i64 từ Value (Number, String, hoặc Object có #text)
fn extract_i64(v: &serde_json::Value) -> Option<i64> {
    match v {
        serde_json::Value::Number(n) => n.as_i64(),
        serde_json::Value::String(s) => s.trim().parse::<i64>().ok(),
        serde_json::Value::Object(o) => {
            if let Some(t) = o.get("#text") {
                extract_i64(t)
            } else {
                None
            }
        }
        _ => None,
    }
}

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

                // 1. TimeCreated từ header record: định dạng cố định RFC3339 UTC microsecond (YYYY-MM-DDTHH:MM:SS.ffffffZ)
                // Việc dùng SecondsFormat::Micros đảm bảo luôn có đúng 6 chữ số thập phân (kể cả .000000Z),
                // khớp 100% với DuckDB timestampformat = '%Y-%m-%dT%H:%M:%S.%fZ' và PowerShell .ToString('yyyy-MM-ddTHH:mm:ss.ffffffZ')
                let iso_time = rec.timestamp.to_rfc3339_opts(chrono::SecondsFormat::Micros, true);
                map.insert("TimeCreated".to_string(), serde_json::Value::String(iso_time));

                // 2. Parse Event.System & Event.EventData từ rec.data
                let event_obj = rec.data.get("Event");
                let sys_obj = event_obj.and_then(|e| e.get("System"));

                // 2.1 RecordID: ưu tiên EventRecordID chuẩn của Windows Event Log trong System.EventRecordID
                // Nếu không có, fallback về rec.event_record_id (thứ tự chu kỳ chunk)
                let record_id = sys_obj
                    .and_then(|s| s.get("EventRecordID"))
                    .and_then(extract_i64)
                    .unwrap_or(rec.event_record_id as i64);
                map.insert("RecordID".to_string(), serde_json::Value::Number(record_id.into()));

                // 2.2 EventID: chuẩn hóa về kiểu số nguyên BIGINT trong DuckDB
                if let Some(eid_val) = sys_obj.and_then(|s| s.get("EventID")) {
                    if let Some(eid_num) = extract_i64(eid_val) {
                        map.insert("EventID".to_string(), serde_json::Value::Number(eid_num.into()));
                    } else {
                        let s = extract_val_string(eid_val);
                        if !s.is_empty() {
                            map.insert("EventID".to_string(), serde_json::Value::String(s));
                        } else {
                            map.insert("EventID".to_string(), serde_json::Value::Null);
                        }
                    }
                } else {
                    map.insert("EventID".to_string(), serde_json::Value::Null);
                }

                // 2.3 Level: Critical(1), Error(2), Warning(3), Information(4), Verbose(5)
                let lvl_str = if let Some(lvl_val) = sys_obj.and_then(|s| s.get("Level")) {
                    match extract_i64(lvl_val) {
                        Some(1) => "Critical",
                        Some(2) => "Error",
                        Some(3) => "Warning",
                        Some(4) => "Information",
                        Some(5) => "Verbose",
                        _ => "Information",
                    }
                } else {
                    "Information"
                };
                map.insert("Level".to_string(), serde_json::Value::String(lvl_str.to_string()));

                // 2.4 Provider
                let prov_name = sys_obj
                    .and_then(|s| s.get("Provider"))
                    .and_then(|p| {
                        p.get("#attributes")
                            .and_then(|a| a.get("Name"))
                            .and_then(|n| n.as_str())
                            .or_else(|| p.get("Name").and_then(|n| n.as_str()))
                            .or_else(|| p.as_str())
                    })
                    .unwrap_or("");
                map.insert("Provider".to_string(), serde_json::Value::String(prov_name.to_string()));

                // 2.5 Channel
                let chan = sys_obj
                    .and_then(|s| s.get("Channel"))
                    .map(|c| extract_val_string(c))
                    .unwrap_or_default();
                map.insert("Channel".to_string(), serde_json::Value::String(chan));

                // 2.6 Computer
                let comp = sys_obj
                    .and_then(|s| s.get("Computer"))
                    .map(|c| extract_val_string(c))
                    .unwrap_or_default();
                map.insert("Computer".to_string(), serde_json::Value::String(comp));

                // 2.7 UserId
                let uid = sys_obj
                    .and_then(|s| s.get("Security"))
                    .and_then(|sec| {
                        sec.get("#attributes")
                            .and_then(|a| a.get("UserID"))
                            .and_then(|u| u.as_str())
                            .or_else(|| sec.get("UserID").and_then(|u| u.as_str()))
                            .or_else(|| sec.as_str())
                    })
                    .unwrap_or("");
                map.insert("UserId".to_string(), serde_json::Value::String(uid.to_string()));

                // 3. Xử lý EventData & UserData đa hình
                let mut p1 = String::new();
                let mut p2 = String::new();
                let mut p3 = String::new();
                let mut binary_val = String::new();
                let mut event_data_summary = serde_json::Map::new();
                let mut positional_candidates: Vec<String> = Vec::new();

                if let Some(event_data) = event_obj.and_then(|e| e.get("EventData")) {
                    if let Some(data_map) = event_data.as_object() {
                        // Pass 1: Xử lý các trường Data đặc biệt, Binary, hoặc các thuộc tính trực tiếp
                        for (k, v) in data_map {
                            if k == "Data" {
                                if let Some(arr) = v.as_array() {
                                    for (i, item) in arr.iter().enumerate() {
                                        let text_val = extract_val_string(item);
                                        positional_candidates.push(text_val.clone());

                                        if let Some(name) = item
                                            .get("#attributes")
                                            .and_then(|a| a.get("Name"))
                                            .and_then(|n| n.as_str())
                                        {
                                            event_data_summary.insert(name.to_string(), serde_json::Value::String(text_val.clone()));
                                            if name == "param1" { p1 = text_val; }
                                            else if name == "param2" { p2 = text_val; }
                                            else if name == "param3" { p3 = text_val; }
                                        } else {
                                            let key_name = format!("param_{}", i + 1);
                                            event_data_summary.insert(key_name, serde_json::Value::String(text_val));
                                        }
                                    }
                                } else if let Some(item_obj) = v.as_object() {
                                    let text_val = extract_val_string(v);
                                    if let Some(name) = item_obj
                                        .get("#attributes")
                                        .and_then(|a| a.get("Name"))
                                        .and_then(|n| n.as_str())
                                    {
                                        event_data_summary.insert(name.to_string(), serde_json::Value::String(text_val.clone()));
                                        if name == "param1" { p1 = text_val; }
                                        else if name == "param2" { p2 = text_val; }
                                        else if name == "param3" { p3 = text_val; }
                                        else { positional_candidates.push(text_val); }
                                    } else {
                                        event_data_summary.insert("Data".to_string(), serde_json::Value::String(text_val.clone()));
                                        positional_candidates.push(text_val);
                                    }
                                } else {
                                    let text_val = extract_val_string(v);
                                    event_data_summary.insert("Data".to_string(), serde_json::Value::String(text_val.clone()));
                                    positional_candidates.push(text_val);
                                }
                            } else if k == "Binary" {
                                binary_val = extract_val_string(v);
                                event_data_summary.insert(k.clone(), serde_json::Value::String(binary_val.clone()));
                            } else if k != "#attributes" {
                                let text_val = extract_val_string(v);
                                event_data_summary.insert(k.clone(), serde_json::Value::String(text_val.clone()));
                                if k == "param1" { p1 = text_val; }
                                else if k == "param2" { p2 = text_val; }
                                else if k == "param3" { p3 = text_val; }
                                else { positional_candidates.push(text_val); }
                            }
                        }
                    }
                }

                // 4. Xử lý UserData nếu có
                if let Some(user_data) = event_obj.and_then(|e| e.get("UserData")) {
                    if let Some(ud_map) = user_data.as_object() {
                        for (k, v) in ud_map {
                            if k != "#attributes" {
                                if let Some(nested) = v.as_object() {
                                    for (nk, nv) in nested {
                                        if nk != "#attributes" {
                                            let s = extract_val_string(nv);
                                            event_data_summary.insert(nk.clone(), serde_json::Value::String(s.clone()));
                                            positional_candidates.push(s);
                                        }
                                    }
                                } else {
                                    let s = extract_val_string(v);
                                    event_data_summary.insert(k.clone(), serde_json::Value::String(s.clone()));
                                    positional_candidates.push(s);
                                }
                            }
                        }
                    }
                }

                // Pass 2: Điền các vị trí p1, p2, p3 còn trống từ danh sách positional_candidates
                let mut cand_iter = positional_candidates.into_iter().filter(|s| !s.is_empty());
                if p1.is_empty() {
                    if let Some(c) = cand_iter.next() { p1 = c; }
                }
                if p2.is_empty() {
                    if let Some(c) = cand_iter.next() { p2 = c; }
                }
                if p3.is_empty() {
                    if let Some(c) = cand_iter.next() { p3 = c; }
                }

                map.insert("param1".to_string(), serde_json::Value::String(p1));
                map.insert("param2".to_string(), serde_json::Value::String(p2));
                map.insert("param3".to_string(), serde_json::Value::String(p3));
                map.insert("Binary".to_string(), serde_json::Value::String(binary_val));
                map.insert(
                    "EventData".to_string(),
                    serde_json::Value::String(serde_json::to_string(&event_data_summary).unwrap_or_default()),
                );

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
