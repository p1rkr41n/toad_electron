//! napi_bridge.rs
//!
//! Zero-overhead N-API FFI bridge (`toad_core.node`) for Node.js & Electron UtilityProcess.
//! Eliminates process-spawn overhead for Binary Guard, EVTX conversion, UTF-16/Gzip transcoding,
//! and Win32 I/O counter monitoring while preserving `toad-core.exe` CLI parity.

use crate::binary_guard::inspect_file;
use crate::config_manager::clean_temp_dir;
use crate::evtx_parser::convert_evtx_to_jsonl;
use crate::io_monitor::get_process_io_bytes;
use crate::transcode::{detect_text_encoding, transcode_to_utf8};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;

fn run_unwind_safe<T, F>(label: &str, f: F) -> Result<T>
where
    F: FnOnce() -> Result<T>,
{
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(res) => res,
        Err(payload) => {
            let detail = if let Some(s) = payload.downcast_ref::<&str>() {
                (*s).to_string()
            } else if let Some(s) = payload.downcast_ref::<String>() {
                s.clone()
            } else {
                "unknown panic".to_string()
            };
            Err(Error::from_reason(format!(
                "[ToadCore N-API] Panic caught in {}: {}",
                label, detail
            )))
        }
    }
}

#[napi(object)]
pub struct InspectFileResult {
    pub valid: bool,
    pub category: String,
    pub encoding: String,
    pub error: Option<String>,
}

#[napi(object)]
pub struct EvtxStatsResult {
    pub total_records: f64,
    pub errors: f64,
    pub elapsed_ms: f64,
}

#[napi(object)]
pub struct TranscodeStatsResult {
    pub encoding: String,
    pub bytes_written: f64,
    pub elapsed_ms: f64,
}

#[napi(object)]
pub struct IoBytesResult {
    pub pid: u32,
    pub read_bytes: f64,
    pub write_bytes: f64,
}

#[napi(js_name = "inspectFile")]
pub fn inspect_file_napi(file_path: String) -> InspectFileResult {
    match catch_unwind(AssertUnwindSafe(|| {
        let path = Path::new(&file_path);
        match inspect_file(path) {
            Ok(cat) => {
                let encoding = detect_text_encoding(path)
                    .map(|e| e.as_str().to_string())
                    .unwrap_or_else(|_| "binary".to_string());
                InspectFileResult {
                    valid: true,
                    category: cat.as_str().to_string(),
                    encoding,
                    error: None,
                }
            }
            Err(err) => InspectFileResult {
                valid: false,
                category: "ForbiddenBinary".to_string(),
                encoding: "binary".to_string(),
                error: Some(err.to_string()),
            },
        }
    })) {
        Ok(res) => res,
        Err(_) => InspectFileResult {
            valid: false,
            category: "ForbiddenBinary".to_string(),
            encoding: "binary".to_string(),
            error: Some("[ToadCore N-API] Panic caught during inspectFile".to_string()),
        },
    }
}

#[napi(js_name = "detectEncoding")]
pub fn detect_encoding_napi(file_path: String) -> Result<String> {
    run_unwind_safe("detectEncoding", || {
        let path = Path::new(&file_path);
        let enc = detect_text_encoding(path).map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(enc.as_str().to_string())
    })
}

#[napi(js_name = "transcodeToUtf8")]
pub fn transcode_to_utf8_napi(input_path: String, output_path: String) -> Result<TranscodeStatsResult> {
    run_unwind_safe("transcodeToUtf8", || {
        let stats = transcode_to_utf8(Path::new(&input_path), Path::new(&output_path))
            .map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(TranscodeStatsResult {
            encoding: stats.encoding,
            bytes_written: stats.bytes_written as f64,
            elapsed_ms: stats.elapsed_ms,
        })
    })
}

#[napi(js_name = "evtxToJsonl")]
pub fn evtx_to_jsonl_napi(
    input_path: String,
    output_path: String,
    max_records: Option<f64>,
) -> Result<EvtxStatsResult> {
    run_unwind_safe("evtxToJsonl", || {
        let max_u64 = max_records.and_then(|m| if m > 0.0 { Some(m as u64) } else { None });
        let stats = convert_evtx_to_jsonl(Path::new(&input_path), Path::new(&output_path), max_u64)
            .map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(EvtxStatsResult {
            total_records: stats.total_records as f64,
            errors: stats.errors as f64,
            elapsed_ms: stats.elapsed_ms,
        })
    })
}

#[napi(js_name = "getProcessIoBytes")]
pub fn get_process_io_bytes_napi(pid: Option<u32>) -> Option<IoBytesResult> {
    let target_pid = pid.unwrap_or(0);
    let actual_pid = if target_pid == 0 {
        std::process::id()
    } else {
        target_pid
    };
    get_process_io_bytes(target_pid).map(|(r, w)| IoBytesResult {
        pid: actual_pid,
        read_bytes: r as f64,
        write_bytes: w as f64,
    })
}

#[napi(js_name = "cleanTempDir")]
pub fn clean_temp_dir_napi(temp_dir: String) -> Result<u32> {
    let cleaned = clean_temp_dir(Path::new(&temp_dir))
        .map_err(|e| Error::from_reason(e.to_string()))?;
    Ok(cleaned as u32)
}
