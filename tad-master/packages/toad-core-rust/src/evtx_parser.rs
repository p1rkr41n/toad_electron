//! evtx_parser.rs
//!
//! Windows XML Event Log (.evtx) Parser for TOAD Core Engine.
//! - Structured extraction: RecordID, EventID, TimeCreated, Level, Computer, Channel, Provider, UserId
//! - Polymorphic EventData & UserData flattening into JSON summary
//! - Hybrid columnar extraction: param1, param2, param3, Binary as top-level columns for DataGrid
//! - High-throughput multi-threaded streaming output to JSONL (.jsonl) for DuckDB

use evtx::{EvtxParser, ParserSettings};
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

/// Safely extracts a string value from a `serde_json::Value` regardless of String, Number, Bool, or `{ "#text": ... }` wrapper.
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

/// Extracts a signed 64-bit integer from a Value (Number, String, or `{ "#text": ... }` object).
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

/// Pure record normalizer used by `convert_evtx_to_jsonl` and unit tests.
pub fn normalize_evtx_record_value(
    iso_time: String,
    fallback_record_id: u64,
    data: &serde_json::Value,
) -> serde_json::Map<String, serde_json::Value> {
    let mut map = serde_json::Map::new();
    map.insert("TimeCreated".to_string(), serde_json::Value::String(iso_time));

    let event_obj = data.get("Event");
    let sys_obj = event_obj.and_then(|e| e.get("System"));

    let record_id = sys_obj
        .and_then(|s| s.get("EventRecordID"))
        .and_then(extract_i64)
        .unwrap_or(fallback_record_id as i64);
    map.insert("RecordID".to_string(), serde_json::Value::Number(record_id.into()));

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

    let chan = sys_obj
        .and_then(|s| s.get("Channel"))
        .map(extract_val_string)
        .unwrap_or_default();
    map.insert("Channel".to_string(), serde_json::Value::String(chan));

    let comp = sys_obj
        .and_then(|s| s.get("Computer"))
        .map(extract_val_string)
        .unwrap_or_default();
    map.insert("Computer".to_string(), serde_json::Value::String(comp));

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

    let mut p1 = String::new();
    let mut p2 = String::new();
    let mut p3 = String::new();
    let mut binary_val = String::new();
    let mut event_data_summary = serde_json::Map::new();
    let mut positional_candidates: Vec<String> = Vec::new();

    if let Some(event_data) = event_obj.and_then(|e| e.get("EventData")) {
        if let Some(data_map) = event_data.as_object() {
            for (k, v) in data_map {
                if k == "Data" {
                    if let Some(arr) = v.as_array() {
                        for (i, item) in arr.iter().enumerate() {
                            let text_val = extract_val_string(item);

                            if let Some(name) = item
                                .get("#attributes")
                                .and_then(|a| a.get("Name"))
                                .and_then(|n| n.as_str())
                            {
                                event_data_summary
                                    .insert(name.to_string(), serde_json::Value::String(text_val.clone()));
                                if name == "param1" {
                                    p1 = text_val;
                                } else if name == "param2" {
                                    p2 = text_val;
                                } else if name == "param3" {
                                    p3 = text_val;
                                } else {
                                    positional_candidates.push(text_val);
                                }
                            } else {
                                let key_name = format!("param_{}", i + 1);
                                event_data_summary
                                    .insert(key_name, serde_json::Value::String(text_val.clone()));
                                positional_candidates.push(text_val);
                            }
                        }
                    } else if let Some(item_obj) = v.as_object() {
                        let text_val = extract_val_string(v);
                        if let Some(name) = item_obj
                            .get("#attributes")
                            .and_then(|a| a.get("Name"))
                            .and_then(|n| n.as_str())
                        {
                            event_data_summary
                                .insert(name.to_string(), serde_json::Value::String(text_val.clone()));
                            if name == "param1" {
                                p1 = text_val;
                            } else if name == "param2" {
                                p2 = text_val;
                            } else if name == "param3" {
                                p3 = text_val;
                            } else {
                                positional_candidates.push(text_val);
                            }
                        } else {
                            event_data_summary
                                .insert("Data".to_string(), serde_json::Value::String(text_val.clone()));
                            positional_candidates.push(text_val);
                        }
                    } else {
                        let text_val = extract_val_string(v);
                        event_data_summary
                            .insert("Data".to_string(), serde_json::Value::String(text_val.clone()));
                        positional_candidates.push(text_val);
                    }
                } else if k == "Binary" {
                    binary_val = extract_val_string(v);
                    event_data_summary
                        .insert(k.clone(), serde_json::Value::String(binary_val.clone()));
                } else if k != "#attributes" {
                    let text_val = extract_val_string(v);
                    event_data_summary
                        .insert(k.clone(), serde_json::Value::String(text_val.clone()));
                    if k == "param1" {
                        p1 = text_val;
                    } else if k == "param2" {
                        p2 = text_val;
                    } else if k == "param3" {
                        p3 = text_val;
                    } else {
                        positional_candidates.push(text_val);
                    }
                }
            }
        }
    }

    if let Some(user_data) = event_obj.and_then(|e| e.get("UserData")) {
        if let Some(ud_map) = user_data.as_object() {
            for (k, v) in ud_map {
                if k != "#attributes" {
                    if let Some(nested) = v.as_object() {
                        for (nk, nv) in nested {
                            if nk != "#attributes" {
                                let s = extract_val_string(nv);
                                event_data_summary
                                    .insert(nk.clone(), serde_json::Value::String(s.clone()));
                                positional_candidates.push(s);
                            }
                        }
                    } else {
                        let s = extract_val_string(v);
                        event_data_summary
                            .insert(k.clone(), serde_json::Value::String(s.clone()));
                        positional_candidates.push(s);
                    }
                }
            }
        }
    }

    let mut cand_iter = positional_candidates.into_iter().filter(|s| !s.is_empty());
    if p1.is_empty() {
        if let Some(c) = cand_iter.next() {
            p1 = c;
        }
    }
    if p2.is_empty() {
        if let Some(c) = cand_iter.next() {
            p2 = c;
        }
    }
    if p3.is_empty() {
        if let Some(c) = cand_iter.next() {
            p3 = c;
        }
    }

    map.insert("param1".to_string(), serde_json::Value::String(p1));
    map.insert("param2".to_string(), serde_json::Value::String(p2));
    map.insert("param3".to_string(), serde_json::Value::String(p3));
    map.insert("Binary".to_string(), serde_json::Value::String(binary_val));
    map.insert(
        "EventData".to_string(),
        serde_json::Value::String(serde_json::to_string(&event_data_summary).unwrap_or_default()),
    );

    let raw_str = serde_json::to_string(data).unwrap_or_default();
    map.insert("RawEvent".to_string(), serde_json::Value::String(raw_str));
    map
}

/// Converts a Windows `.evtx` file into structured `.jsonl` using multi-threaded native parsing.
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
                let iso_time = rec.timestamp.to_rfc3339_opts(chrono::SecondsFormat::Micros, true);
                let map = normalize_evtx_record_value(iso_time, rec.event_record_id, &rec.data);

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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_escape_json_str_control_chars() {
        let raw = "line1\nline2\r\t\"quoted\"\\backslash\x07bell";
        let escaped = escape_json_str(raw);
        assert_eq!(
            escaped,
            "line1\\nline2\\r\\t\\\"quoted\\\"\\\\backslash\\u0007bell"
        );
    }

    #[test]
    fn test_normalize_named_eventdata_and_attributes() {
        let sample = json!({
            "Event": {
                "System": {
                    "EventRecordID": 93937,
                    "EventID": { "#text": "7036" },
                    "Level": 2,
                    "Provider": { "#attributes": { "Name": "Service Control Manager" } },
                    "Channel": "System",
                    "Computer": "WIN-SRV01.corp.local",
                    "Security": { "#attributes": { "UserID": "S-1-5-18" } }
                },
                "EventData": {
                    "Data": [
                        { "#attributes": { "Name": "param1" }, "#text": "Windows Update" },
                        { "#attributes": { "Name": "param2" }, "#text": "running" }
                    ],
                    "Binary": "770075006100"
                }
            }
        });

        let out = normalize_evtx_record_value(
            "2026-03-15T10:20:30.123456Z".to_string(),
            1,
            &sample,
        );

        assert_eq!(out.get("RecordID").and_then(|v| v.as_i64()), Some(93937));
        assert_eq!(out.get("EventID").and_then(|v| v.as_i64()), Some(7036));
        assert_eq!(out.get("Level").and_then(|v| v.as_str()), Some("Error"));
        assert_eq!(
            out.get("Provider").and_then(|v| v.as_str()),
            Some("Service Control Manager")
        );
        assert_eq!(out.get("UserId").and_then(|v| v.as_str()), Some("S-1-5-18"));
        assert_eq!(
            out.get("param1").and_then(|v| v.as_str()),
            Some("Windows Update")
        );
        assert_eq!(out.get("param2").and_then(|v| v.as_str()), Some("running"));
        assert_eq!(out.get("param3").and_then(|v| v.as_str()), Some(""));
        assert_eq!(
            out.get("Binary").and_then(|v| v.as_str()),
            Some("770075006100")
        );
    }

    #[test]
    fn test_normalize_positional_and_userdata_fallback() {
        let sample = json!({
            "Event": {
                "System": {
                    "EventID": 4624,
                    "Level": 4,
                    "Provider": "Microsoft-Windows-Security-Auditing",
                    "Channel": "Security",
                    "Computer": "DC01"
                },
                "UserData": {
                    "LogonInfo": {
                        "TargetUser": "Administrator",
                        "Workstation": "WS-ADMIN",
                        "IpAddress": "10.0.0.5"
                    }
                }
            }
        });

        let out = normalize_evtx_record_value(
            "2026-03-15T12:00:00.000000Z".to_string(),
            42,
            &sample,
        );

        assert_eq!(out.get("RecordID").and_then(|v| v.as_i64()), Some(42));
        assert_eq!(out.get("EventID").and_then(|v| v.as_i64()), Some(4624));
        assert_eq!(
            out.get("Level").and_then(|v| v.as_str()),
            Some("Information")
        );
        // BTree/Map iteration fills param1..param3 from UserData fields
        assert!(!out.get("param1").and_then(|v| v.as_str()).unwrap_or("").is_empty());
        let ed_str = out.get("EventData").and_then(|v| v.as_str()).unwrap_or("{}");
        let ed_json: serde_json::Value = serde_json::from_str(ed_str).unwrap();
        assert_eq!(
            ed_json.get("TargetUser").and_then(|v| v.as_str()),
            Some("Administrator")
        );
        assert_eq!(
            ed_json.get("IpAddress").and_then(|v| v.as_str()),
            Some("10.0.0.5")
        );
    }

    #[test]
    fn test_invalid_evtx_file_returns_error() {
        let bad_evtx = std::env::temp_dir().join("toad_test_corrupt.evtx");
        let out_jsonl = std::env::temp_dir().join("toad_test_corrupt_out.jsonl");
        std::fs::write(&bad_evtx, b"NOT_AN_EVTX_HEADER_0123456789").unwrap();

        let res = convert_evtx_to_jsonl(&bad_evtx, &out_jsonl, Some(10));
        let _ = std::fs::remove_file(&bad_evtx);
        let _ = std::fs::remove_file(&out_jsonl);
        assert!(res.is_err());
    }
}
