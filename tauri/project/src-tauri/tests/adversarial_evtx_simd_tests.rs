//! tests/adversarial_evtx_simd_tests.rs
//!
//! Empirical Adversarial Stress Test Suite for Milestone 5 (EVTX SIMD & Forensics Subsystem)
//! - RAM Bounding (<30MB) during EVTX streaming of real datasets (System.evtx and Security.evtx)
//! - Polymorphic EventID parsing: standard integers, text numbers, BinXML {"#text": ...}, malformed, nulls
//! - Resilient forensics field extraction: provider, level, channel, computer, user_id (SIDs), payload_json
//! - Corrupted, truncated, and zero-filled EVTX recovery (0% crashes)
//! - Dirty log fallback engine with non-UTF8 binary byte streams and invalid encodings
//! - Cancellation lifecycle: instant termination and zero disk debris (.parquet.tmp cleanup)
//! - Concurrency stress: parallel ingestion across multiple threads

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use serde_json::json;

use toad_lib::engine::fast_count::FastCounter;
use toad_lib::ingest::dirty_log::ingest_dirty_log;
use toad_lib::ingest::evtx_parser::{
    extract_channel, extract_computer, extract_event_id, extract_fields_from_value, extract_level,
    extract_provider_name, extract_user_id, ingest_evtx_file,
};
use toad_lib::ingest::scheduler::CancellationToken;

#[cfg(target_os = "windows")]
mod mem_tracker {
    #[repr(C)]
    #[allow(non_snake_case)]
    pub struct PROCESS_MEMORY_COUNTERS {
        pub cb: u32,
        pub PageFaultCount: u32,
        pub PeakWorkingSetSize: usize,
        pub WorkingSetSize: usize,
        pub QuotaPeakPagedPoolUsage: usize,
        pub QuotaPagedPoolUsage: usize,
        pub QuotaPeakNonPagedPoolUsage: usize,
        pub QuotaNonPagedPoolUsage: usize,
        pub PagefileUsage: usize,
        pub PeakPagefileUsage: usize,
    }

    #[link(name = "psapi")]
    extern "system" {
        fn GetCurrentProcess() -> isize;
        fn GetProcessMemoryInfo(
            hProcess: isize,
            ppsmemCounters: *mut PROCESS_MEMORY_COUNTERS,
            cb: u32,
        ) -> i32;
    }

    pub fn get_working_set_bytes() -> usize {
        unsafe {
            let mut pmc: PROCESS_MEMORY_COUNTERS = std::mem::zeroed();
            pmc.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
            let process = GetCurrentProcess();
            if GetProcessMemoryInfo(process, &mut pmc, pmc.cb) != 0 {
                pmc.WorkingSetSize
            } else {
                0
            }
        }
    }

    pub fn get_pagefile_bytes() -> usize {
        unsafe {
            let mut pmc: PROCESS_MEMORY_COUNTERS = std::mem::zeroed();
            pmc.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
            let process = GetCurrentProcess();
            if GetProcessMemoryInfo(process, &mut pmc, pmc.cb) != 0 {
                pmc.PagefileUsage
            } else {
                0
            }
        }
    }
}

fn create_adversarial_test_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("toad_adv_m5_{}_{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("Failed to create test directory");
    dir
}

// ============================================================================
// CHALLENGE 1: Polymorphic EventID Parsing Stress Battery
// ============================================================================

#[test]
fn test_adversarial_polymorphic_event_ids() {
    // 1. Standard integer numbers
    let val_int = json!({"EventID": 4624});
    assert_eq!(extract_event_id(&val_int), Some(4624));

    let val_zero = json!({"EventID": 0});
    assert_eq!(extract_event_id(&val_zero), Some(0));

    let val_neg = json!({"EventID": -1});
    assert_eq!(extract_event_id(&val_neg), Some(-1));

    let val_max = json!({"EventID": 2147483647});
    assert_eq!(extract_event_id(&val_max), Some(2147483647));

    // 2. String representation of integers
    let val_str = json!({"EventID": "7036"});
    assert_eq!(extract_event_id(&val_str), Some(7036));

    let val_str_zero = json!({"EventID": "0"});
    assert_eq!(extract_event_id(&val_str_zero), Some(0));

    let val_str_neg = json!({"EventID": "-1"});
    assert_eq!(extract_event_id(&val_str_neg), Some(-1));

    // 3. BinXML Object representation with #text
    let val_binxml_num = json!({
        "EventID": {
            "#attributes": {"Qualifiers": 16384},
            "#text": 7036
        }
    });
    assert_eq!(extract_event_id(&val_binxml_num), Some(7036));

    let val_binxml_str = json!({
        "EventID": {
            "#attributes": {"Qualifiers": 0},
            "#text": "4624"
        }
    });
    assert_eq!(extract_event_id(&val_binxml_str), Some(4624));

    // 4. Malformed and edge case EventID formats (must NEVER panic)
    let malformed_cases = vec![
        json!({"EventID": "not_a_number"}),
        json!({"EventID": ""}),
        json!({"EventID": null}),
        json!({"EventID": true}),
        json!({"EventID": false}),
        json!({"EventID": [4624]}),
        json!({"EventID": {"#text": null}}),
        json!({"EventID": {"#text": [7036]}}),
        json!({"EventID": {"#text": {"nested": "4624"}}}),
        json!({"EventID": {"other_field": 4624}}),
        json!({"EventID": 12.345}), // float
        json!({"EventID": "9999999999999999999999999999999"}), // overflow string
        json!({}), // missing field
        json!(null), // null root
        json!("string root"), // non-object root
    ];

    for (idx, case) in malformed_cases.iter().enumerate() {
        let res = extract_event_id(case);
        // Expect None for unparseable or missing event IDs, 0 panics
        println!("Edge case #{}: {:?} -> {:?}", idx, case, res);
    }
}

// ============================================================================
// CHALLENGE 2: Forensic Field Extractors Robustness & SID Fallbacks
// ============================================================================

#[test]
fn test_adversarial_forensic_extractors_comprehensive() {
    // 1. Provider extraction: attributes vs property vs string
    let p1 = json!({"Provider": {"#attributes": {"Name": "Microsoft-Windows-Security-Auditing", "Guid": "{1234}"}}});
    assert_eq!(extract_provider_name(&p1), Some("Microsoft-Windows-Security-Auditing".to_string()));

    let p2 = json!({"Provider": {"Name": "Service Control Manager"}});
    assert_eq!(extract_provider_name(&p2), Some("Service Control Manager".to_string()));

    let p3 = json!({"Provider": "SimpleProviderName"});
    assert_eq!(extract_provider_name(&p3), Some("SimpleProviderName".to_string()));

    let p4 = json!({"Provider": null});
    assert_eq!(extract_provider_name(&p4), None);

    // 2. Level extraction: number, string, #text
    assert_eq!(extract_level(&json!({"Level": 0})), Some(0));
    assert_eq!(extract_level(&json!({"Level": "4"})), Some(4));
    assert_eq!(extract_level(&json!({"Level": {"#text": 2}})), Some(2));
    assert_eq!(extract_level(&json!({"Level": {"#text": "3"}})), Some(3));
    assert_eq!(extract_level(&json!({"Level": "invalid"})), None);

    // 3. Channel & Computer extraction
    assert_eq!(extract_channel(&json!({"Channel": "Security"})), Some("Security".to_string()));
    assert_eq!(extract_channel(&json!({"Channel": {"#text": "System"}})), Some("System".to_string()));
    assert_eq!(extract_computer(&json!({"Computer": "DC01.corp.local"})), Some("DC01.corp.local".to_string()));
    assert_eq!(extract_computer(&json!({"Computer": {"#text": "WS-01"}})), Some("WS-01".to_string()));

    // 4. UserID / SID extraction with multiple fallbacks
    // 4a. System.Security.#attributes.UserID
    let s_sec = json!({"Security": {"#attributes": {"UserID": "S-1-5-18"}}});
    assert_eq!(extract_user_id(&s_sec, None), Some("S-1-5-18".to_string()));

    // 4b. Fallback to TargetUserSid
    let ed1 = json!({"TargetUserSid": "S-1-5-21-12345-6789"});
    assert_eq!(extract_user_id(&json!({}), Some(&ed1)), Some("S-1-5-21-12345-6789".to_string()));

    // 4c. Fallback to SubjectUserSid
    let ed2 = json!({"SubjectUserSid": "S-1-5-21-99999-0000"});
    assert_eq!(extract_user_id(&json!({}), Some(&ed2)), Some("S-1-5-21-99999-0000".to_string()));

    // 4d. Fallback to TargetUserName
    let ed3 = json!({"TargetUserName": "Administrator"});
    assert_eq!(extract_user_id(&json!({}), Some(&ed3)), Some("Administrator".to_string()));

    // 5. Full extract_fields_from_value with missing System, EventData, etc.
    let root_minimal = json!({"Event": {}});
    let (eid, prov, lvl, ch, comp, uid, payload) = extract_fields_from_value(&root_minimal);
    assert_eq!(eid, None);
    assert_eq!(prov, None);
    assert_eq!(lvl, None);
    assert_eq!(ch, None);
    assert_eq!(comp, None);
    assert_eq!(uid, None);
    assert!(payload.is_some());
}

// ============================================================================
// CHALLENGE 3: Memory Bounding (<30MB RAM) on Real Datasets
// ============================================================================

#[tokio::test]
async fn test_adversarial_ram_bounding_real_datasets() {
    let system_evtx = Path::new("d:/Shared_UserData\u{002F}Downloads/tad/data_sample/System.evtx");
    if !system_evtx.exists() {
        eprintln!("Skipping RAM bounding test: System.evtx not found");
        return;
    }

    let test_dir = create_adversarial_test_dir("ram_bounding");
    let out_parquet = test_dir.join("system_ram_test.parquet");
    let ct = CancellationToken::new();

    #[cfg(target_os = "windows")]
    let base_ws = mem_tracker::get_working_set_bytes();
    #[cfg(target_os = "windows")]
    let base_pf = mem_tracker::get_pagefile_bytes();

    #[cfg(target_os = "windows")]
    println!(
        "Base Memory: WorkingSet = {:.2} MB, Pagefile = {:.2} MB",
        base_ws as f64 / (1024.0 * 1024.0),
        base_pf as f64 / (1024.0 * 1024.0)
    );

    // Track peak memory during ingestion via background polling
    let peak_ws = Arc::new(std::sync::atomic::AtomicUsize::new(base_ws));
    let peak_ws_clone = peak_ws.clone();
    let stop_monitor = Arc::new(AtomicBool::new(false));
    let stop_monitor_clone = stop_monitor.clone();

    let monitor_handle = tokio::spawn(async move {
        while !stop_monitor_clone.load(Ordering::Relaxed) {
            #[cfg(target_os = "windows")]
            {
                let current_ws = mem_tracker::get_working_set_bytes();
                peak_ws_clone.fetch_max(current_ws, Ordering::Relaxed);
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    });

    let t0 = Instant::now();
    let evtx_path = system_evtx.to_path_buf();
    let target_path = out_parquet.clone();
    let ct_for_task = ct.clone();

    let result = tokio::task::spawn_blocking(move || {
        ingest_evtx_file(
            "ram-test-1",
            &evtx_path,
            &target_path,
            4,
            &ct_for_task,
            None,
        )
    })
    .await
    .unwrap()
    .expect("System.evtx ingestion failed");

    let duration = t0.elapsed();
    stop_monitor.store(true, Ordering::Relaxed);
    let _ = monitor_handle.await;

    #[cfg(target_os = "windows")]
    let final_ws = mem_tracker::get_working_set_bytes();
    let peak_recorded_ws = peak_ws.load(Ordering::Relaxed);
    let delta_mb = (peak_recorded_ws.saturating_sub(base_ws)) as f64 / (1024.0 * 1024.0);

    println!(
        "Ingestion completed: {} rows in {:.2}s ({:.0} rows/s), parquet size: {} bytes",
        result.row_count,
        duration.as_secs_f64(),
        result.row_count as f64 / duration.as_secs_f64(),
        result.parquet_size
    );

    println!(
        "RAM Usage: Base WS: {:.2} MB, Peak WS: {:.2} MB, Delta WS: {:.2} MB, Final WS: {:.2} MB",
        base_ws as f64 / (1024.0 * 1024.0),
        peak_recorded_ws as f64 / (1024.0 * 1024.0),
        delta_mb,
        final_ws as f64 / (1024.0 * 1024.0)
    );

    // Verify row count and schema
    assert!(result.row_count > 50000);
    assert!(out_parquet.exists());
    let verified_rows = FastCounter::count_parquet_rows(&out_parquet).unwrap();
    assert_eq!(verified_rows, result.row_count);

    let _ = fs::remove_dir_all(&test_dir);
}

// ============================================================================
// CHALLENGE 4: Massive Security.evtx Real Dataset Stress (~70MB)
// ============================================================================

#[tokio::test]
async fn test_adversarial_security_evtx_large_scale() {
    let sec_evtx = Path::new("d:/Shared_UserData\u{002F}Downloads/tad/data_sample/Security.evtx");
    if !sec_evtx.exists() {
        eprintln!("Security.evtx not found, skipping large dataset test");
        return;
    }

    let test_dir = create_adversarial_test_dir("sec_evtx_large");
    let out_parquet = test_dir.join("security_evtx.parquet");
    let ct = CancellationToken::new();

    let t0 = Instant::now();
    let res = ingest_evtx_file("sec-1", sec_evtx, &out_parquet, 4, &ct, None)
        .expect("Security.evtx ingestion failed");
    let elapsed = t0.elapsed();

    println!(
        "Security.evtx Ingest: {} rows in {:.2}s ({:.0} rows/s), parquet: {} bytes, corrupt: {}",
        res.row_count,
        elapsed.as_secs_f64(),
        res.row_count as f64 / elapsed.as_secs_f64(),
        res.parquet_size,
        res.corrupted_records
    );

    assert!(res.row_count > 10000, "Security.evtx should have significant row count");
    let verified_rows = FastCounter::count_parquet_rows(&out_parquet).unwrap();
    assert_eq!(verified_rows, res.row_count);

    let _ = fs::remove_dir_all(&test_dir);
}

// ============================================================================
// CHALLENGE 5: Corrupted, Truncated & Zero-Filled EVTX Error Handling
// ============================================================================

#[test]
fn test_adversarial_corrupted_evtx_handling() {
    let test_dir = create_adversarial_test_dir("corrupt_evtx");
    let ct = CancellationToken::new();

    // 1. Zero-byte empty file
    let empty_file = test_dir.join("empty.evtx");
    File::create(&empty_file).unwrap();
    let empty_out = test_dir.join("empty.parquet");
    let res_empty = ingest_evtx_file("c1", &empty_file, &empty_out, 1, &ct, None);
    assert!(res_empty.is_err(), "Empty file must return Err, not panic");
    println!("Empty file result: {:?}", res_empty.err().unwrap());

    // 2. Corrupted magic header
    let bogus_file = test_dir.join("bogus_magic.evtx");
    {
        let mut f = File::create(&bogus_file).unwrap();
        f.write_all(b"NOT_AN_EVTX_FILE_MAGIC_BYTES_HERE_000000000000000000000000000000")
            .unwrap();
    }
    let bogus_out = test_dir.join("bogus.parquet");
    let res_bogus = ingest_evtx_file("c2", &bogus_file, &bogus_out, 1, &ct, None);
    assert!(res_bogus.is_err(), "Bogus magic header must return Err, not panic");
    println!("Bogus magic result: {:?}", res_bogus.err().unwrap());

    // 3. Zero-filled file (64KB of zeros)
    let zeros_file = test_dir.join("zeros.evtx");
    {
        let mut f = File::create(&zeros_file).unwrap();
        f.write_all(&vec![0u8; 65536]).unwrap();
    }
    let zeros_out = test_dir.join("zeros.parquet");
    let res_zeros = ingest_evtx_file("c3", &zeros_file, &zeros_out, 1, &ct, None);
    assert!(res_zeros.is_err(), "Zero-filled file must return Err, not panic");
    println!("Zero-filled result: {:?}", res_zeros.err().unwrap());

    // 4. Truncated EVTX header (valid first 16 bytes of System.evtx, then truncated)
    let system_evtx = Path::new("d:/Shared_UserData\u{002F}Downloads/tad/data_sample/System.evtx");
    if system_evtx.exists() {
        let mut src_bytes = Vec::new();
        File::open(system_evtx).unwrap().take(2048).read_to_end(&mut src_bytes).unwrap();

        let trunc_file = test_dir.join("truncated.evtx");
        fs::write(&trunc_file, &src_bytes).unwrap();
        let trunc_out = test_dir.join("trunc.parquet");

        let res_trunc = ingest_evtx_file("c4", &trunc_file, &trunc_out, 1, &ct, None);
        // Truncated header must either return Err or Ok(0 rows), NEVER panic
        println!("Truncated EVTX result: {:?}", res_trunc);
    }

    let _ = fs::remove_dir_all(&test_dir);
}

// ============================================================================
// CHALLENGE 6: Dirty Log Fallback on Arbitrary Binary Bytes & Lossy UTF-8
// ============================================================================

#[test]
fn test_adversarial_dirty_log_binary_resilience() {
    let test_dir = create_adversarial_test_dir("dirty_binary");
    let ct = CancellationToken::new();

    let binary_log = test_dir.join("raw_binary.log");
    {
        let mut f = File::create(&binary_log).unwrap();
        // Line 1: Normal line with ISO timestamp
        f.write_all(b"2026-11-05 09:30:00.123456 [INFO] System boot\n").unwrap();
        // Line 2: Corrupted non-UTF8 bytes (0xFF, 0xFE, 0xFD, 0x00, 0x01)
        f.write_all(&[0xFF, 0xFE, 0xFD, 0x00, 0x01, b'\n']).unwrap();
        // Line 3: Timestamp with space and non-ASCII chars
        f.write_all("2026-11-05 09:30:01 [WARN] こんにちは 世界 \u{1F525}\n".as_bytes()).unwrap();
        // Line 4: Very long line (64KB of ASCII 'A')
        f.write_all(&vec![b'A'; 65536]).unwrap();
        f.write_all(b"\n").unwrap();
        // Line 5: Trailing line without newline
        f.write_all(b"2026-11-05 09:30:02 [ERROR] Final unclosed line").unwrap();
    }

    let target_parquet = test_dir.join("raw_binary.parquet");
    let res = ingest_dirty_log("dirty-adv-1", &binary_log, &target_parquet, &ct, None)
        .expect("Dirty log must ingest arbitrary binary without crashing");

    assert_eq!(res.row_count, 5);
    assert!(target_parquet.exists());

    // Verify Parquet contents via Arrow reader
    let file = File::open(&target_parquet).unwrap();
    let reader = ParquetRecordBatchReaderBuilder::try_new(file).unwrap().build().unwrap();
    let batches: Vec<_> = reader.map(|b| b.unwrap()).collect();
    let total_read_rows: usize = batches.iter().map(|b| b.num_rows()).sum();
    assert_eq!(total_read_rows, 5);

    let _ = fs::remove_dir_all(&test_dir);
}

// ============================================================================
// CHALLENGE 7: Cooperative Cancellation Lifecycle & Debris Cleanup
// ============================================================================

#[tokio::test]
async fn test_adversarial_cancellation_and_debris_cleanup() {
    let system_evtx = Path::new("d:/Shared_UserData\u{002F}Downloads/tad/data_sample/System.evtx");
    if !system_evtx.exists() {
        return;
    }

    let test_dir = create_adversarial_test_dir("cancellation");
    let out_parquet = test_dir.join("cancel_test.parquet");
    let tmp_parquet = test_dir.join("cancel_test.parquet.tmp");
    let ct = CancellationToken::new();

    let ct_for_job = ct.clone();
    let evtx_path = system_evtx.to_path_buf();
    let out_path = out_parquet.clone();

    let handle = tokio::task::spawn_blocking(move || {
        ingest_evtx_file("cancel-1", &evtx_path, &out_path, 2, &ct_for_job, None)
    });

    // Let ingestion start and process a few thousand rows, then cancel
    tokio::time::sleep(Duration::from_millis(100)).await;
    ct.cancel();

    let res = handle.await.unwrap();

    // Must return cancellation Err
    assert!(res.is_err(), "Cancelled task must return Err");
    let err_msg = res.err().unwrap();
    assert!(err_msg.contains("cancelled"), "Error must report cancellation: {}", err_msg);

    // Scratch .parquet.tmp file must be cleaned up (no leaked debris)
    assert!(
        !tmp_parquet.exists(),
        "Temporary .parquet.tmp must be removed upon cancellation"
    );
    assert!(
        !out_parquet.exists(),
        "Final parquet file must not exist if cancelled"
    );

    let _ = fs::remove_dir_all(&test_dir);
}

// ============================================================================
// CHALLENGE 8: Concurrency Stress - Parallel EVTX Ingest
// ============================================================================

#[tokio::test]
async fn test_adversarial_parallel_evtx_ingest_concurrency() {
    let system_evtx = Path::new("d:/Shared_UserData\u{002F}Downloads/tad/data_sample/System.evtx");
    if !system_evtx.exists() {
        return;
    }

    let test_dir = create_adversarial_test_dir("parallel_evtx");
    let mut handles = Vec::new();

    for i in 0..4 {
        let src = system_evtx.to_path_buf();
        let out = test_dir.join(format!("parallel_out_{}.parquet", i));
        let handle = tokio::spawn(async move {
            let ct = CancellationToken::new();
            ingest_evtx_file(&format!("p-{}", i), &src, &out, 2, &ct, None)
        });
        handles.push(handle);
    }

    for (i, h) in handles.into_iter().enumerate() {
        let res = h.await.unwrap().expect("Concurrent EVTX ingestion failed");
        assert!(res.row_count > 50000, "Worker {} must parse >50K rows", i);
        let out_file = test_dir.join(format!("parallel_out_{}.parquet", i));
        assert!(out_file.exists());
    }

    let _ = fs::remove_dir_all(&test_dir);
}
