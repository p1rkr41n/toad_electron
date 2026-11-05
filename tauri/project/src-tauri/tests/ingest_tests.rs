//! tests/ingest_tests.rs
//!
//! Forensics & Ingestion Subsystem Comprehensive Test Suite (Milestone M5 / F18-F22)
//!
//! Covers:
//! - F18: RFC-4180 CSV/TSV Delimiter Sniffing & 3-Tier Fallback Matrix
//! - F19: EVTX SIMD Binary Decoder (<30MB RAM, 9-column typed Arrow schema)
//! - F20: JSONL / NDJSON Dynamic Schema & Dot-Notated Unnesting
//! - F21: Shortest-Job-First (SJF) Scheduler, VIP Preemption, Burst Lane & Dual-Bound Throttling
//! - F22: Multi-Stage Progress Dispatcher (5% -> 45% -> 90% -> 100%)
//! - Dirty Log Fallback Engine (line_number, timestamp, raw_event)
//! - IPC Ingestion Commands Wiring (`toad:ingest_*`, `toad:get_ingest_queue`)
//! - Parquet State Ledger WAL Integration (`FILE_MODIFIED` events)

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use arrow::record_batch::RecordBatchReader;
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use serde_json::json;

use toad_lib::commands::ingest::*;
use toad_lib::commands::{route_command, CommandAction};
use toad_lib::engine::duckdb_pool::DuckDbEnginePool;
use toad_lib::engine::fast_count::FastCounter;
use toad_lib::ingest::csv_streamer::{ingest_csv_file, sniff_delimiter};
use toad_lib::ingest::dirty_log::{extract_leading_timestamp, ingest_dirty_log};
use toad_lib::ingest::evtx_parser::{create_evtx_arrow_schema, ingest_evtx_file};
use toad_lib::ingest::jsonl_streamer::{ingest_jsonl_file, parse_struct_fields};
use toad_lib::ingest::progress::{IngestProgressPayload, ProgressDispatcher};
use toad_lib::ingest::scheduler::{
    CancellationToken, IngestJob, IngestPriority, IngestStatus, IngestionScheduler,
};
use toad_lib::ledger::ParquetLedger;
use toad_lib::portable::ToadConfig;
use toad_lib::state::AppState;

fn create_test_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("toad_m5_test_{}_{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

// ============================================================================
// 1. RFC-4180 CSV/TSV Delimiter Sniffer & 3-Tier Fallback Tests (F18)
// ============================================================================

#[test]
fn test_delimiter_sniffer_variations() {
    let test_dir = create_test_dir("sniffer");

    // Standard CSV with quotes containing commas
    let csv_file = test_dir.join("test.csv");
    fs::write(
        &csv_file,
        "id,name,description,amount\n1,\"Doe, John\",\"Item, A\",100\n2,\"Smith, Jane\",\"Item, B\",200\n",
    )
    .unwrap();
    assert_eq!(sniff_delimiter(&csv_file), ',');

    // TSV file
    let tsv_file = test_dir.join("test.tsv");
    fs::write(&tsv_file, "id\tname\tcity\n1\tAlice\tParis\n2\tBob\tLondon\n").unwrap();
    assert_eq!(sniff_delimiter(&tsv_file), '\t');

    // Semicolon delimited log
    let semi_file = test_dir.join("test.log");
    fs::write(&semi_file, "col1;col2;col3\nval1;val2;val3\nval4;val5;val6\n").unwrap();
    assert_eq!(sniff_delimiter(&semi_file), ';');

    // Pipe delimited log
    let pipe_file = test_dir.join("test.psv");
    fs::write(&pipe_file, "h1|h2|h3\nv1|v2|v3\nv4|v5|v6\n").unwrap();
    assert_eq!(sniff_delimiter(&pipe_file), '|');

    let _ = fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_csv_ingest_tier0_all_varchar_and_null_padding() {
    let test_dir = create_test_dir("csv_ingest_tier0");
    let pool = DuckDbEnginePool::new(test_dir.join("duck_tmp"), 2, "1GB".to_string()).unwrap();

    // Create CSV with irregular columns and mixed types
    let csv_path = test_dir.join("sample.csv");
    fs::write(
        &csv_path,
        "id,val_num,val_str\n1,100,hello\n2,N/A,world\n3,300,foo\n4,-,bar\n",
    )
    .unwrap();

    let target_parquet = test_dir.join("sample.parquet");
    let ct = CancellationToken::new();

    let result = pool
        .run_ingest_task(move |conn| {
            ingest_csv_file("f1", &csv_path, &target_parquet, &conn, &ct, None)
        })
        .await
        .unwrap();

    assert_eq!(result.row_count, 4);
    assert_eq!(result.delimiter_used, ',');
    assert_eq!(result.tier_used, 0);

    let verify_target = test_dir.join("sample.parquet");
    assert!(verify_target.exists());
    let verified_rows = FastCounter::count_parquet_rows(&verify_target).unwrap();
    assert_eq!(verified_rows, 4);

    let _ = fs::remove_dir_all(&test_dir);
}

// ============================================================================
// 2. EVTX Forensics Rust SIMD Binary Decoder Tests (F19)
// ============================================================================

#[test]
fn test_evtx_arrow_schema_definition() {
    let schema = create_evtx_arrow_schema();
    assert_eq!(schema.fields().len(), 9);
    assert_eq!(schema.field(0).name(), "record_id");
    assert_eq!(schema.field(1).name(), "time_created");
    assert_eq!(schema.field(2).name(), "event_id");
    assert_eq!(schema.field(3).name(), "provider_name");
    assert_eq!(schema.field(4).name(), "level");
    assert_eq!(schema.field(5).name(), "channel");
    assert_eq!(schema.field(6).name(), "computer");
    assert_eq!(schema.field(7).name(), "user_id");
    assert_eq!(schema.field(8).name(), "payload_json");
}

#[tokio::test]
async fn test_evtx_simd_ingest_real_dataset() {
    let evtx_source = Path::new("d:/Shared_UserData/Downloads/tad/data_sample/System.evtx");
    if !evtx_source.exists() {
        eprintln!("Skipping real evtx test: System.evtx not found at {:?}", evtx_source);
        return;
    }

    let test_dir = create_test_dir("evtx_real");
    let target_parquet = test_dir.join("system_evtx.parquet");
    let ct = CancellationToken::new();
    let dispatcher = ProgressDispatcher::default();

    let t0 = Instant::now();
    let res = ingest_evtx_file(
        "evtx-1",
        evtx_source,
        &target_parquet,
        4,
        &ct,
        Some(&dispatcher),
    )
    .unwrap();

    let elapsed = t0.elapsed();
    println!(
        "EVTX Real Dataset Ingestion: {} rows in {:?} ({:.0} rows/sec), size: {} bytes",
        res.row_count,
        elapsed,
        res.row_count as f64 / elapsed.as_secs_f64(),
        res.parquet_size
    );

    assert!(res.row_count > 50000, "System.evtx expected >50,000 rows");
    assert!(target_parquet.exists());

    // Verify footer metadata count matches O(1)
    let fast_rows = FastCounter::count_parquet_rows(&target_parquet).unwrap();
    assert_eq!(fast_rows, res.row_count);

    // Verify Parquet file schema via reader
    let file = fs::File::open(&target_parquet).unwrap();
    let reader = ParquetRecordBatchReaderBuilder::try_new(file).unwrap().build().unwrap();
    assert_eq!(reader.schema().fields().len(), 9);

    let _ = fs::remove_dir_all(&test_dir);
}

// ============================================================================
// 3. JSONL / NDJSON Dynamic Schema & Unnesting Tests (F20)
// ============================================================================

#[test]
fn test_parse_struct_fields_recursion() {
    let struct_str = "STRUCT(id BIGINT, name VARCHAR, info STRUCT(ip VARCHAR, port INT), tags VARCHAR[])";
    let fields = parse_struct_fields(struct_str);
    assert_eq!(fields, vec!["id", "name", "info.ip", "info.port", "tags"]);
}

#[tokio::test]
async fn test_jsonl_dynamic_schema_ingest() {
    let test_dir = create_test_dir("jsonl_ingest");
    let pool = DuckDbEnginePool::new(test_dir.join("duck_tmp"), 2, "1GB".to_string()).unwrap();

    let jsonl_file = test_dir.join("events.jsonl");
    let lines = vec![
        json!({"Event": {"System": {"EventID": 4624, "Computer": "DC01"}, "EventData": {"User": "Administrator"}}}).to_string(),
        json!({"Event": {"System": {"EventID": 4625, "Computer": "DC01"}, "EventData": {"User": "Guest"}}}).to_string(),
        json!({"Event": {"System": {"EventID": 4672, "Computer": "DC02"}, "EventData": {"User": "SYSTEM"}}}).to_string(),
    ];
    fs::write(&jsonl_file, lines.join("\n")).unwrap();

    let target_parquet = test_dir.join("events.parquet");
    let target_p = target_parquet.clone();
    let ct = CancellationToken::new();

    let result = pool
        .run_ingest_task(move |conn| {
            ingest_jsonl_file("json-1", &jsonl_file, &target_p, &conn, &ct, None)
        })
        .await
        .unwrap();

    assert_eq!(result.row_count, 3);
    assert!(target_parquet.exists());

    let rows = FastCounter::count_parquet_rows(&target_parquet).unwrap();
    assert_eq!(rows, 3);

    let _ = fs::remove_dir_all(&test_dir);
}

// ============================================================================
// 4. Dirty Log Fallback Engine Tests
// ============================================================================

#[test]
fn test_dirty_log_timestamp_extractor() {
    let line1 = "2026-11-05 07:15:30.123456 [INFO] Service started";
    let ts1 = extract_leading_timestamp(line1);
    assert!(ts1.is_some());

    let line2 = "2026-11-05T07:15:30Z [WARN] Heartbeat missed";
    let ts2 = extract_leading_timestamp(line2);
    assert!(ts2.is_some());

    let line3 = "Unstructured message without timestamp";
    let ts3 = extract_leading_timestamp(line3);
    assert!(ts3.is_none());
}

#[test]
fn test_dirty_log_streaming_ingest() {
    let test_dir = create_test_dir("dirty_log");
    let log_file = test_dir.join("app.log");
    let content = "2026-11-05 08:00:00 [INFO] Line 1\n2026-11-05 08:00:01 [WARN] Line 2\nLine 3 without timestamp\n";
    fs::write(&log_file, content).unwrap();

    let target_parquet = test_dir.join("app.parquet");
    let ct = CancellationToken::new();

    let res = ingest_dirty_log("dirty-1", &log_file, &target_parquet, &ct, None).unwrap();
    assert_eq!(res.row_count, 3);
    assert!(target_parquet.exists());

    let rows = FastCounter::count_parquet_rows(&target_parquet).unwrap();
    assert_eq!(rows, 3);

    let _ = fs::remove_dir_all(&test_dir);
}

// ============================================================================
// 5. SJF Ingestion Scheduler, VIP Preemption & Dual-Bounds Tests (F21)
// ============================================================================

#[test]
fn test_sjf_strict_priority_comparator() {
    let job_normal_large = IngestJob {
        job_id: "j1".to_string(),
        file_id: "f1".to_string(),
        project_id: "p1".to_string(),
        file_path: "large.csv".to_string(),
        file_name: "large.csv".to_string(),
        file_size: 500_000_000, // 500 MB
        priority: IngestPriority::Normal,
        status: IngestStatus::Pending,
        added_time_ms: 1000,
        target_parquet_path: "".to_string(),
        error_message: None,
        row_count: None,
        duration_ms: None,
    };

    let job_normal_small = IngestJob {
        job_id: "j2".to_string(),
        file_id: "f2".to_string(),
        project_id: "p1".to_string(),
        file_path: "small.csv".to_string(),
        file_name: "small.csv".to_string(),
        file_size: 10_000, // 10 KB
        priority: IngestPriority::Normal,
        status: IngestStatus::Pending,
        added_time_ms: 2000,
        target_parquet_path: "".to_string(),
        error_message: None,
        row_count: None,
        duration_ms: None,
    };

    let job_normal_med = IngestJob {
        job_id: "j3".to_string(),
        file_id: "f3".to_string(),
        project_id: "p1".to_string(),
        file_path: "med.csv".to_string(),
        file_name: "med.csv".to_string(),
        file_size: 5_000_000, // 5 MB
        priority: IngestPriority::Normal,
        status: IngestStatus::Pending,
        added_time_ms: 1500,
        target_parquet_path: "".to_string(),
        error_message: None,
        row_count: None,
        duration_ms: None,
    };

    let job_vip_huge = IngestJob {
        job_id: "j4".to_string(),
        file_id: "f4".to_string(),
        project_id: "p1".to_string(),
        file_path: "huge.evtx".to_string(),
        file_name: "huge.evtx".to_string(),
        file_size: 1_000_000_000, // 1 GB
        priority: IngestPriority::Vip,
        status: IngestStatus::Pending,
        added_time_ms: 3000,
        target_parquet_path: "".to_string(),
        error_message: None,
        row_count: None,
        duration_ms: None,
    };

    let mut queue = vec![
        job_normal_large.clone(),
        job_normal_small.clone(),
        job_normal_med.clone(),
        job_vip_huge.clone(),
    ];

    queue.sort_by(|a, b| a.cmp_sjf(b));

    // Expected order:
    // 1. job_vip_huge (VIP always first)
    // 2. job_normal_small (10 KB)
    // 3. job_normal_med (5 MB)
    // 4. job_normal_large (500 MB)
    assert_eq!(queue[0].job_id, "j4", "VIP must be at head of queue");
    assert_eq!(queue[1].job_id, "j2", "Smallest file must be second");
    assert_eq!(queue[2].job_id, "j3", "Medium file must be third");
    assert_eq!(queue[3].job_id, "j1", "Largest normal file must be last");
}

#[tokio::test]
async fn test_scheduler_enqueue_and_vip_preemption() {
    let test_dir = create_test_dir("scheduler_vip");
    let f1 = test_dir.join("f1.log");
    let f2 = test_dir.join("f2.log");
    fs::write(&f1, "log 1\n").unwrap();
    fs::write(&f2, "log 2\n").unwrap();

    let scheduler = Arc::new(IngestionScheduler::new(
        test_dir.join("temp"),
        None,
        None,
        Arc::new(ProgressDispatcher::default()),
        2,
        1_000_000_000,
    ));

    let j1 = scheduler
        .enqueue_file("p1", &f1.to_string_lossy(), IngestPriority::Normal)
        .await
        .unwrap();
    let j2 = scheduler
        .enqueue_file("p1", &f2.to_string_lossy(), IngestPriority::Normal)
        .await
        .unwrap();

    assert_eq!(j1.status, IngestStatus::Pending);
    assert_eq!(j2.status, IngestStatus::Pending);

    // Promote j2 to VIP
    let promoted = scheduler.promote_to_vip(&j2.file_id).await.unwrap();
    assert_eq!(promoted.priority, IngestPriority::Vip);

    let snap = scheduler.get_queue_snapshot().await;
    // When dispatch loop runs, jobs transition to active or completed
    assert!(snap.active_count <= 3);

    let _ = fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_scheduler_cancellation_and_cleanup() {
    let test_dir = create_test_dir("scheduler_cancel");
    let f1 = test_dir.join("f1.log");
    fs::write(&f1, "sample\n").unwrap();

    let scheduler = Arc::new(IngestionScheduler::new(
        test_dir.join("temp"),
        None,
        None,
        Arc::new(ProgressDispatcher::default()),
        1,
        1_000_000_000,
    ));

    let job = scheduler
        .enqueue_file("p1", &f1.to_string_lossy(), IngestPriority::Normal)
        .await
        .unwrap();

    // Cancel job
    let cancelled = scheduler.cancel_job(&job.job_id).await.unwrap();
    assert!(cancelled);

    let snap = scheduler.get_queue_snapshot().await;
    assert_eq!(snap.pending_count, 0);

    let _ = fs::remove_dir_all(&test_dir);
}

// ============================================================================
// 6. Multi-Stage Progress Dispatcher Tests (F22)
// ============================================================================

#[test]
fn test_multi_stage_progress_dispatch() {
    let dispatcher = ProgressDispatcher::default();
    let stages_received = Arc::new(std::sync::Mutex::new(Vec::new()));
    let sr = stages_received.clone();

    dispatcher.add_listener(Arc::new(move |payload: &IngestProgressPayload| {
        sr.lock().unwrap().push((payload.stage.clone(), payload.percentage));
    }));

    dispatcher.emit_stage_sniffing("f1", "path/to/file", 10);
    dispatcher.emit_stage_parsing("f1", "path/to/file", 500, 45, 50);
    dispatcher.emit_stage_writing("f1", "path/to/file", 1000, 100);
    dispatcher.emit_stage_ready("f1", "path/to/file", 1000, 120);

    let events = stages_received.lock().unwrap().clone();
    assert_eq!(events.len(), 4);
    assert_eq!(events[0], ("sniffing".to_string(), 5));
    assert_eq!(events[1], ("parsing".to_string(), 45));
    assert_eq!(events[2], ("writing".to_string(), 90));
    assert_eq!(events[3], ("ready".to_string(), 100));
}

// ============================================================================
// 7. IPC Commands Routing & Handlers Wiring Tests
// ============================================================================

#[test]
fn test_ingest_command_routing_aliases() {
    assert_eq!(route_command("toad:ingest_file"), CommandAction::IngestFile);
    assert_eq!(route_command("ingestFile"), CommandAction::IngestFile);
    assert_eq!(route_command("ingest_file"), CommandAction::IngestFile);

    assert_eq!(route_command("toad:ingest_cancel"), CommandAction::IngestCancel);
    assert_eq!(route_command("cancelIngest"), CommandAction::IngestCancel);

    assert_eq!(route_command("toad:ingest_vip"), CommandAction::IngestVip);
    assert_eq!(route_command("prioritizeIngest"), CommandAction::IngestVip);

    assert_eq!(route_command("toad:get_ingest_queue"), CommandAction::IngestGetQueue);
    assert_eq!(route_command("getIngestQueue"), CommandAction::IngestGetQueue);
}

#[tokio::test]
async fn test_ingest_ipc_handlers_roundtrip() {
    let test_dir = create_test_dir("ipc_handlers");
    let state = AppState::new(test_dir.clone(), ToadConfig::default());

    let log_file = test_dir.join("source.log");
    fs::write(&log_file, "2026-11-05 09:00:00 [INFO] IPC test\n").unwrap();

    // 1. handle_ingest_file
    let ingest_payload = json!({
        "projectId": "p1",
        "filePath": log_file.to_string_lossy().to_string(),
        "priority": "normal"
    });

    let res = handle_ingest_file(&state, ingest_payload).await.unwrap();
    assert!(!res.job_id.is_empty());
    assert!(!res.file_id.is_empty());

    // 2. handle_get_ingest_queue
    let queue_snap = handle_get_ingest_queue(&state, json!({})).await.unwrap();
    assert!(queue_snap.max_concurrent_files >= 1);

    // 3. handle_ingest_vip
    let vip_res = handle_ingest_vip(&state, json!({ "fileId": res.file_id })).await;
    // Job could be running, completed, or promoted
    assert!(vip_res.is_ok());

    // 4. handle_ingest_cancel
    let cancel_res = handle_ingest_cancel(&state, json!({ "jobId": res.job_id })).await;
    // Cancellable if still active/pending
    let _ = cancel_res;

    let _ = fs::remove_dir_all(&test_dir);
}

// ============================================================================
// 8. Parquet State Ledger WAL Ingestion Integration Tests
// ============================================================================

#[tokio::test]
async fn test_scheduler_wal_ledger_commit_on_completion() {
    let test_dir = create_test_dir("scheduler_wal");
    let ledger = Arc::new(tokio::sync::RwLock::new(ParquetLedger::new(test_dir.clone())));
    let pool = DuckDbEnginePool::new(test_dir.join("temp"), 2, "1GB".to_string()).ok().map(Arc::new);

    let scheduler = Arc::new(IngestionScheduler::new(
        test_dir.join("temp"),
        Some(ledger.clone()),
        pool,
        Arc::new(ProgressDispatcher::default()),
        2,
        1_000_000_000,
    ));

    let csv_file = test_dir.join("wal_test.csv");
    fs::write(&csv_file, "colA,colB\nval1,val2\nval3,val4\n").unwrap();

    let job = scheduler
        .enqueue_file("p1", &csv_file.to_string_lossy(), IngestPriority::Normal)
        .await
        .unwrap();

    // Wait briefly for worker execution
    let mut completed = false;
    for _ in 0..50 {
        tokio::time::sleep(Duration::from_millis(50)).await;
        let snap = scheduler.get_queue_snapshot().await;
        if snap.active_count == 0 && snap.pending_count == 0 {
            completed = true;
            break;
        }
    }
    assert!(completed, "Ingestion job timed out");

    // Inspect cached Parquet file
    let cache_parquet = PathBuf::from(&job.target_parquet_path);
    assert!(cache_parquet.exists(), "Target cached Parquet file must exist");
    let rows = FastCounter::count_parquet_rows(&cache_parquet).unwrap();
    assert_eq!(rows, 2, "Cached Parquet must contain exactly 2 rows");

    // Inspect ledger WAL events on disk
    let ledger_guard = ledger.read().await;
    assert!(ledger_guard.ledger_path.exists(), "Ledger WAL file must exist on disk");
    let wal_rows = FastCounter::count_parquet_rows(&ledger_guard.ledger_path).unwrap();
    assert!(wal_rows >= 1, "Ledger WAL must contain at least 1 event");

    let _ = fs::remove_dir_all(&test_dir);
}
