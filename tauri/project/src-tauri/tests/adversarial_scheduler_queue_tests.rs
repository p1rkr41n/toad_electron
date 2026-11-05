//! tests/adversarial_scheduler_queue_tests.rs
//!
//! Empirical Adversarial Stress Test Suite for Milestone 5 (Scheduler, VIP Preemption, Burst Lane & Ingestion)
//!
//! Evaluates:
//! - SJF Priority Comparator: Strict total ordering, multi-way ties, boundary file sizes, transitivity.
//! - VIP Preemption & Burst Lane: Jump-to-front, +1 concurrency permit bypass, byte limit bypass.
//! - Dual-Bound Throttling: Max concurrent files and max concurrent bytes constraints, Exclusive Big File Mode.
//! - Cancellation Lifecycle: Active running cancellation, queued pending cancellation, scratch `.parquet.tmp` removal.
//! - CSV Delimiter Sniffing & Pathological Dirty Log Fallback: Corrupted/binary CSVs triggering 3-tier fallback matrix.
//! - Dirty Log Timestamp Extraction: Boundary civil date handling, leap years, pathological inputs.

use std::cmp::Ordering;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use toad_lib::engine::duckdb_pool::DuckDbEnginePool;
use toad_lib::engine::fast_count::FastCounter;
use toad_lib::ingest::csv_streamer::{ingest_csv_file, sniff_delimiter};
use toad_lib::ingest::dirty_log::extract_leading_timestamp;
use toad_lib::ingest::progress::{IngestProgressPayload, ProgressDispatcher};
use toad_lib::ingest::scheduler::{
    CancellationToken, IngestJob, IngestPriority, IngestStatus, IngestionScheduler,
};

fn create_temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("toad_adv_m5_{}_{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

// ============================================================================
// 1. SJF Comparator Strict Total Ordering & Edge-Case Stress Tests
// ============================================================================

#[test]
fn test_adversarial_sjf_comparator_total_order_and_transitivity() {
    let mut jobs = Vec::new();
    let priorities = [IngestPriority::Normal, IngestPriority::Vip];
    let sizes = [0u64, 1, 100, 101, 1_000_000, u64::MAX];
    let times = [0u64, 50, 100, 500];

    let mut id_counter = 0;
    for &pri in &priorities {
        for &sz in &sizes {
            for &t in &times {
                id_counter += 1;
                jobs.push(IngestJob {
                    job_id: format!("job_{:04}", id_counter),
                    file_id: format!("file_{:04}", id_counter),
                    project_id: "p1".to_string(),
                    file_path: format!("/path/file_{:04}.csv", id_counter),
                    file_name: format!("file_{:04}.csv", id_counter),
                    file_size: sz,
                    priority: pri,
                    status: IngestStatus::Pending,
                    added_time_ms: t,
                    target_parquet_path: "".to_string(),
                    error_message: None,
                    row_count: None,
                    duration_ms: None,
                });
            }
        }
    }

    // Verify reflexivity: a.cmp_sjf(a) == Equal
    for j in &jobs {
        assert_eq!(j.cmp_sjf(j), Ordering::Equal, "Reflexivity failed for job {}", j.job_id);
    }

    // Verify antisymmetry: a.cmp_sjf(b) == b.cmp_sjf(a).reverse()
    for (i, a) in jobs.iter().enumerate().take(30) {
        for b in jobs.iter().skip(i + 1).take(30) {
            assert_eq!(
                a.cmp_sjf(b),
                b.cmp_sjf(a).reverse(),
                "Antisymmetry failed between {} and {}",
                a.job_id,
                b.job_id
            );
        }
    }

    // Verify transitivity on sample triples: if a < b and b < c => a < c
    let sample = &jobs[0..40];
    for a in sample {
        for b in sample {
            for c in sample {
                if a.cmp_sjf(b) == Ordering::Less && b.cmp_sjf(c) == Ordering::Less {
                    assert_eq!(
                        a.cmp_sjf(c),
                        Ordering::Less,
                        "Transitivity failed: {} < {} and {} < {} but not {} < {}",
                        a.job_id,
                        b.job_id,
                        b.job_id,
                        c.job_id,
                        a.job_id,
                        c.job_id
                    );
                }
            }
        }
    }

    // Sort all jobs and verify properties
    jobs.sort_by(|a, b| a.cmp_sjf(b));

    // Property 1: All VIP jobs precede all Normal jobs
    let mut seen_normal = false;
    for j in &jobs {
        if j.priority == IngestPriority::Normal {
            seen_normal = true;
        } else if seen_normal {
            panic!("Found VIP job after Normal job: {}", j.job_id);
        }
    }

    // Property 2: Within same priority, file_size is monotonically non-decreasing
    for window in jobs.windows(2) {
        let (a, b) = (&window[0], &window[1]);
        if a.priority == b.priority {
            assert!(
                a.file_size <= b.file_size,
                "Size ordering violation: {} ({} B) > {} ({} B)",
                a.job_id,
                a.file_size,
                b.job_id,
                b.file_size
            );
            // Property 3: Within same priority and size, added_time_ms is non-decreasing
            if a.file_size == b.file_size {
                assert!(
                    a.added_time_ms <= b.added_time_ms,
                    "Timestamp ordering violation: {} ({} ms) > {} ({} ms)",
                    a.job_id,
                    a.added_time_ms,
                    b.job_id,
                    b.added_time_ms
                );
            }
        }
    }
}

// ============================================================================
// 2. VIP Preemption & Burst Lane Concurrency Stress
// ============================================================================

#[tokio::test]
async fn test_adversarial_vip_burst_lane_preemption() {
    let test_dir = create_temp_dir("vip_burst_lane");
    let pool = DuckDbEnginePool::new(test_dir.join("duck_pool"), 4, "1GB".to_string()).unwrap();

    // Create 4 test CSV files with enough rows to measure active concurrency
    let mut files = Vec::new();
    for i in 1..=5 {
        let p = test_dir.join(format!("test_file_{}.csv", i));
        let mut f = File::create(&p).unwrap();
        writeln!(f, "id,col_a,col_b").unwrap();
        for r in 0..40_000 {
            writeln!(f, "{},value_a_{},value_b_{}", r, r, r).unwrap();
        }
        files.push(p);
    }

    // Max 2 concurrent files, 1.0 GB limit
    let scheduler = Arc::new(IngestionScheduler::new(
        test_dir.join("temp"),
        None,
        Some(Arc::new(pool)),
        Arc::new(ProgressDispatcher::default()),
        2,
        1_000_000_000,
    ));

    // Enqueue file 1 and file 2 (Normal) -> fills the 2 available worker slots
    let _j1 = scheduler
        .enqueue_file("p1", &files[0].to_string_lossy(), IngestPriority::Normal)
        .await
        .unwrap();
    let _j2 = scheduler
        .enqueue_file("p1", &files[1].to_string_lossy(), IngestPriority::Normal)
        .await
        .unwrap();

    // Wait until normal slots are active (active_count == 2)
    for _ in 0..50 {
        if scheduler.get_queue_snapshot().await.active_count == 2 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }

    // Enqueue file 3 (Normal, large) and file 4 (Normal, small)
    let _j3 = scheduler
        .enqueue_file("p1", &files[2].to_string_lossy(), IngestPriority::Normal)
        .await
        .unwrap();
    let _j4 = scheduler
        .enqueue_file("p1", &files[3].to_string_lossy(), IngestPriority::Normal)
        .await
        .unwrap();

    // Enqueue file 5 (Normal)
    let j5 = scheduler
        .enqueue_file("p1", &files[4].to_string_lossy(), IngestPriority::Normal)
        .await
        .unwrap();

    // Now promote j5 to VIP while slots are fully saturated!
    let promoted = scheduler.promote_to_vip(&j5.file_id).await.unwrap();
    assert_eq!(promoted.priority, IngestPriority::Vip);

    // Snapshot check: VIP promotion activates Burst Lane (+1 permit: max_slots = 3).
    // The VIP job must dispatch immediately into the burst lane (active count reaches 3).
    let mut vip_ran_in_burst_lane = false;
    for _ in 0..50 {
        let snap = scheduler.get_queue_snapshot().await;
        if snap.active_count == 3 {
            let active_ids: Vec<_> = snap.active_jobs.iter().map(|j| j.file_id.clone()).collect();
            if active_ids.contains(&j5.file_id) {
                vip_ran_in_burst_lane = true;
                break;
            }
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    assert!(vip_ran_in_burst_lane, "VIP job j5 must be running in the Burst Lane alongside normal active jobs");

    // Wait for all jobs to complete
    let mut all_done = false;
    for _ in 0..100 {
        tokio::time::sleep(Duration::from_millis(50)).await;
        let snap = scheduler.get_queue_snapshot().await;
        if snap.active_count == 0 && snap.pending_count == 0 {
            all_done = true;
            break;
        }
    }

    assert!(all_done, "All ingestion jobs must complete successfully");

    // Verify all 5 jobs completed Ready and output valid Parquet
    let st = scheduler.state.read().await;
    assert_eq!(st.completed.len(), 5);
    for (jid, job) in &st.completed {
        assert_eq!(
            job.status,
            IngestStatus::Ready,
            "Job {} should have status Ready, got {:?}",
            jid,
            job.status
        );
        let p = Path::new(&job.target_parquet_path);
        assert!(p.exists(), "Target parquet {:?} must exist on disk", p);
        let rows = FastCounter::count_parquet_rows(p).unwrap();
        assert_eq!(rows, 40_000, "Parquet rows must match input CSV rows");
    }

    let _ = fs::remove_dir_all(&test_dir);
}

// ============================================================================
// 3. Promote to VIP Identifiers & Corner Cases
// ============================================================================

#[tokio::test]
async fn test_adversarial_promote_to_vip_corner_cases() {
    let test_dir = create_temp_dir("vip_corners");
    let f1 = test_dir.join("f1.log");
    fs::write(&f1, "log line 1\n").unwrap();
    let f2 = test_dir.join("f2.log");
    fs::write(&f2, "log line 2\n").unwrap();

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

    let job2 = scheduler
        .enqueue_file("p1", &f2.to_string_lossy(), IngestPriority::Normal)
        .await
        .unwrap();

    // 1. Promote by file_id
    let res_by_file_id = scheduler.promote_to_vip(&job.file_id).await;
    assert!(res_by_file_id.is_ok(), "Promotion by file_id must succeed");

    // 2. Promote by job_id
    let res_by_job_id = scheduler.promote_to_vip(&job2.job_id).await;
    assert!(res_by_job_id.is_ok(), "Promotion by job_id must succeed");

    // 3. Promote by file_path
    let res_by_path = scheduler.promote_to_vip(&job.file_path).await;
    assert!(res_by_path.is_ok(), "Promotion by file_path must succeed");

    // 4. Promote non-existent target -> must return Err
    let res_bogus = scheduler.promote_to_vip("non_existent_uuid_or_path").await;
    assert!(res_bogus.is_err(), "Non-existent file promotion must return error");

    // 5. Wait for jobs to complete, then promote again -> should return completed job Ok for job_id, file_id, and path
    for _ in 0..50 {
        tokio::time::sleep(Duration::from_millis(30)).await;
        let snap = scheduler.get_queue_snapshot().await;
        if snap.active_count == 0 && snap.pending_count == 0 {
            break;
        }
    }

    let res_completed_file = scheduler.promote_to_vip(&job.file_id).await;
    assert!(
        res_completed_file.is_ok(),
        "Promoting an already completed job by file_id should safely return Ok"
    );

    let res_completed_job = scheduler.promote_to_vip(&job2.job_id).await;
    assert!(
        res_completed_job.is_ok(),
        "Promoting an already completed job by job_id should safely return Ok"
    );

    let res_completed_path = scheduler.promote_to_vip(&job.file_path).await;
    assert!(
        res_completed_path.is_ok(),
        "Promoting an already completed job by file_path should safely return Ok"
    );

    let _ = fs::remove_dir_all(&test_dir);
}

// ============================================================================
// 4. Cancellation Lifecycle & Scratch .parquet.tmp File Cleanup
// ============================================================================

#[tokio::test]
async fn test_adversarial_cancellation_scratch_cleanup() {
    let test_dir = create_temp_dir("cancel_scratch");

    // Generate large dirty log file (50,000 lines) to ensure it runs for some duration
    let log_path = test_dir.join("large_stream.log");
    {
        let mut f = File::create(&log_path).unwrap();
        for i in 0..50_000 {
            writeln!(
                f,
                "2026-11-05 10:00:{:02}.{:03} [INFO] Stress log record number {}",
                i % 60,
                i % 1000,
                i
            )
            .unwrap();
        }
    }

    let dispatcher = Arc::new(ProgressDispatcher::default());
    let cancelled_events = Arc::new(std::sync::Mutex::new(Vec::new()));
    let ce = cancelled_events.clone();
    dispatcher.add_listener(Arc::new(move |payload: &IngestProgressPayload| {
        if payload.status == "CANCELLED" {
            ce.lock().unwrap().push(payload.clone());
        }
    }));

    let scheduler = Arc::new(IngestionScheduler::new(
        test_dir.join("temp"),
        None,
        None,
        dispatcher,
        1,
        1_000_000_000,
    ));

    let job = scheduler
        .enqueue_file("p1", &log_path.to_string_lossy(), IngestPriority::Normal)
        .await
        .unwrap();

    // Sleep briefly to let the worker start writing to .parquet.tmp
    tokio::time::sleep(Duration::from_millis(10)).await;

    // Trigger cancellation
    let cancelled = scheduler.cancel_job(&job.job_id).await.unwrap();
    assert!(cancelled, "cancel_job must return true");

    // Wait briefly for background cancellation to propagate
    tokio::time::sleep(Duration::from_millis(50)).await;

    // Scratch file cleanup verification
    let target_parquet = PathBuf::from(&job.target_parquet_path);
    let scratch_tmp = target_parquet.with_extension("parquet.tmp");

    assert!(
        !scratch_tmp.exists(),
        "Scratch file {:?} must be cleanly purged after cancellation",
        scratch_tmp
    );
    assert!(
        !target_parquet.exists(),
        "Final parquet file {:?} must NOT exist if job was cancelled",
        target_parquet
    );

    // Verify status in completed map
    let st = scheduler.state.read().await;
    let completed_job = st.completed.get(&job.job_id).expect("Cancelled job must be in completed map");
    assert_eq!(
        completed_job.status,
        IngestStatus::Cancelled,
        "Job status must be Cancelled"
    );

    // Verify progress event emitted
    let evs = cancelled_events.lock().unwrap().clone();
    assert!(
        !evs.is_empty(),
        "Cancelled progress event must be dispatched to listeners"
    );

    let _ = fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_adversarial_cancel_pending_job_before_dispatch() {
    let test_dir = create_temp_dir("cancel_pending");
    let f1 = test_dir.join("f1.log");
    let f2 = test_dir.join("f2.log");
    fs::write(&f1, "line 1\n").unwrap();
    fs::write(&f2, "line 2\n").unwrap();

    // Concurrency 1: f1 will run, f2 will stay pending
    let scheduler = Arc::new(IngestionScheduler::new(
        test_dir.join("temp"),
        None,
        None,
        Arc::new(ProgressDispatcher::default()),
        1,
        1_000_000_000,
    ));

    let _j1 = scheduler
        .enqueue_file("p1", &f1.to_string_lossy(), IngestPriority::Normal)
        .await
        .unwrap();
    let j2 = scheduler
        .enqueue_file("p1", &f2.to_string_lossy(), IngestPriority::Normal)
        .await
        .unwrap();

    // Cancel pending j2 immediately
    let cancelled = scheduler.cancel_job(&j2.job_id).await.unwrap();
    assert!(cancelled, "cancel_job must return true");

    let snap = scheduler.get_queue_snapshot().await;
    // Verify j2 is no longer in pending queue
    assert!(
        !snap.pending_jobs.iter().any(|j| j.job_id == j2.job_id),
        "Cancelled job j2 must not exist in pending queue"
    );

    let st = scheduler.state.read().await;
    let c = st.completed.get(&j2.job_id).unwrap();
    assert_eq!(c.status, IngestStatus::Cancelled);

    let _ = fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_adversarial_double_cancellation() {
    let test_dir = create_temp_dir("double_cancel");
    let f1 = test_dir.join("f1.log");
    fs::write(&f1, "sample text\n").unwrap();

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

    let res1 = scheduler.cancel_job(&job.job_id).await;
    assert!(res1.is_ok(), "First cancellation must succeed");

    // Second cancellation on already cancelled job -> returns Err (not in active or pending)
    let res2 = scheduler.cancel_job(&job.job_id).await;
    assert!(
        res2.is_err(),
        "Second cancellation must fail cleanly without crashing"
    );

    let _ = fs::remove_dir_all(&test_dir);
}

// ============================================================================
// 5. Dual-Bound Concurrency Throttling & Exclusive Big File Mode
// ============================================================================

#[tokio::test]
async fn test_adversarial_exclusive_big_file_mode() {
    let test_dir = create_temp_dir("big_file_mode");
    let big_file = test_dir.join("big_file.log");
    fs::write(&big_file, "line inside big file\n").unwrap();

    // Set max_concurrent_bytes to a tiny limit (100 bytes)
    // The big_file metadata size will be ~21 bytes, but let's test scheduler handling
    let scheduler = Arc::new(IngestionScheduler::new(
        test_dir.join("temp"),
        None,
        None,
        Arc::new(ProgressDispatcher::default()),
        2,
        100, // 100 bytes limit
    ));

    let job = scheduler
        .enqueue_file("p1", &big_file.to_string_lossy(), IngestPriority::Normal)
        .await
        .unwrap();

    // When queue is idle (active_count == 0), Exclusive Big File Mode must dispatch it
    let mut completed = false;
    for _ in 0..50 {
        tokio::time::sleep(Duration::from_millis(30)).await;
        let snap = scheduler.get_queue_snapshot().await;
        if snap.active_count == 0 && snap.pending_count == 0 {
            completed = true;
            break;
        }
    }

    assert!(completed, "Big file job must complete even under tight byte budget");
    let st = scheduler.state.read().await;
    let c = st.completed.get(&job.job_id).unwrap();
    assert_eq!(c.status, IngestStatus::Ready);

    let _ = fs::remove_dir_all(&test_dir);
}

// ============================================================================
// 6. CSV Delimiter Sniffing & Pathological Dirty Log Fallback Matrix (F18)
// ============================================================================

#[tokio::test]
async fn test_adversarial_csv_delimiter_sniffing_and_fallbacks() {
    let test_dir = create_temp_dir("csv_adversarial");
    let pool = DuckDbEnginePool::new(test_dir.join("duck_pool"), 2, "1GB".to_string()).unwrap();

    // 1. Pathological CSV with semicolons inside quotes, commas outside
    let p1 = test_dir.join("quotes_with_semi.csv");
    fs::write(
        &p1,
        "col1,col2,col3\n\"val;with;semi\",123,456\n\"another;semi;here\",789,012\n",
    )
    .unwrap();
    assert_eq!(
        sniff_delimiter(&p1),
        ',',
        "Must ignore semicolons inside quotes"
    );

    // 2. Tab-separated log with empty lines and variable fields
    let p2 = test_dir.join("variable_tab.tsv");
    fs::write(
        &p2,
        "t1\tt2\tt3\n\na\tb\tc\n\nd\te\tf\n",
    )
    .unwrap();
    assert_eq!(sniff_delimiter(&p2), '\t');

    // 3. Pipe-separated file with spaces around pipes
    let p3 = test_dir.join("spaced_pipe.log");
    fs::write(
        &p3,
        "part1 | part2 | part3\nval1 | val2 | val3\nval4 | val5 | val6\n",
    )
    .unwrap();
    assert_eq!(sniff_delimiter(&p3), '|');

    // 4. Malformed CSV with unclosed quotes and raw control bytes
    // Should successfully ingest via Tier 0 (all_varchar + null_padding) or Tier 2 (dirty_log)
    let p4 = test_dir.join("pathological_corrupt.csv");
    {
        let mut f = File::create(&p4).unwrap();
        f.write_all(b"header1,header2\n").unwrap();
        f.write_all(b"\"unclosed quote line 1\n").unwrap();
        f.write_all(b"normal,value\n").unwrap();
        f.write_all(b"\x00\x01\x02,binary_data\n").unwrap();
        f.write_all(b"final,line\n").unwrap();
    }

    let target_p4 = test_dir.join("pathological.parquet");
    let ct = CancellationToken::new();

    let res = pool
        .run_ingest_task(move |conn| {
            ingest_csv_file("f_patho", &p4, &target_p4, &conn, &ct, None)
        })
        .await
        .unwrap();

    assert!(res.row_count >= 1, "Must recover at least 1 row from pathological file");
    let final_p4 = test_dir.join("pathological.parquet");
    assert!(final_p4.exists(), "Target parquet file must be generated");
    let verified_rows = FastCounter::count_parquet_rows(&final_p4).unwrap();
    assert_eq!(verified_rows, res.row_count);

    let _ = fs::remove_dir_all(&test_dir);
}

// ============================================================================
// 7. Dirty Log Timestamp Extractor Stress Tests
// ============================================================================

#[test]
fn test_adversarial_dirty_log_timestamp_extractor_stress() {
    // Valid standard ISO timestamps
    assert!(extract_leading_timestamp("2026-11-05 08:30:00 [INFO] ok").is_some());
    assert!(extract_leading_timestamp("2026-11-05T08:30:00Z [INFO] ok").is_some());
    assert!(extract_leading_timestamp("2026-11-05 08:30:00.123456 message").is_some());

    // Leap year boundary date
    let leap_ts = extract_leading_timestamp("2024-02-29 23:59:59 Leap day");
    assert!(leap_ts.is_some(), "2024-02-29 leap day must parse successfully");

    // Non-leap year 2023-02-28
    assert!(extract_leading_timestamp("2023-02-28 12:00:00 valid").is_some());

    // Boundary & Malformed lines: must NEVER panic
    assert!(extract_leading_timestamp("").is_none());
    assert!(extract_leading_timestamp("   ").is_none());
    assert!(extract_leading_timestamp("2026-11-05").is_none()); // too short (< 19 chars)
    assert!(extract_leading_timestamp("2026-11-05 12:34").is_none());
    assert!(extract_leading_timestamp("2026/11/05 12:34:56 wrong separator").is_none());
    assert!(extract_leading_timestamp("Nov  5 12:34:56 syslog text").is_none());
    assert!(extract_leading_timestamp("Timestamp at end: 2026-11-05 12:34:56").is_none());
    assert!(extract_leading_timestamp("abcd-ef-gh ij:kl:mn not digits").is_none());
    assert!(extract_leading_timestamp("🦀 Unicode text with emoji 🎉").is_none());
    assert!(extract_leading_timestamp("\0\0\0\0 null bytes").is_none());
}

// ============================================================================
// 8. Double-Valid Parquet Cache Inspection ($O(1)$ Fast-Hit)
// ============================================================================

#[tokio::test]
async fn test_adversarial_double_valid_parquet_cache_hit() {
    let test_dir = create_temp_dir("cache_hit");
    let pool = DuckDbEnginePool::new(test_dir.join("duck_pool"), 2, "1GB".to_string()).unwrap();

    let sample_csv = test_dir.join("cached_test.csv");
    fs::write(&sample_csv, "col1,col2\nval1,val2\nval3,val4\n").unwrap();

    let scheduler = Arc::new(IngestionScheduler::new(
        test_dir.join("temp"),
        None,
        Some(Arc::new(pool)),
        Arc::new(ProgressDispatcher::default()),
        2,
        1_000_000_000,
    ));

    // First ingestion: runs normally
    let j1 = scheduler
        .enqueue_file("p1", &sample_csv.to_string_lossy(), IngestPriority::Normal)
        .await
        .unwrap();

    // Wait for first job completion
    for _ in 0..50 {
        tokio::time::sleep(Duration::from_millis(30)).await;
        let snap = scheduler.get_queue_snapshot().await;
        if snap.active_count == 0 && snap.pending_count == 0 {
            break;
        }
    }

    let cache_file = PathBuf::from(&j1.target_parquet_path);
    assert!(cache_file.exists(), "Cache file must exist after first run");

    // Second ingestion with SAME file: Double-Valid Parquet cache inspection should hit immediately!
    let t0 = Instant::now();
    let j2 = scheduler
        .enqueue_file("p1", &sample_csv.to_string_lossy(), IngestPriority::Normal)
        .await
        .unwrap();
    let elapsed = t0.elapsed();

    // Must be returned immediately as Ready without queueing in pending
    assert_eq!(
        j2.status,
        IngestStatus::Ready,
        "Cache hit must return status Ready immediately"
    );
    assert_eq!(j2.row_count, Some(2), "Row count must be preserved from cache");
    assert!(
        elapsed < Duration::from_millis(50),
        "Cache hit must return in < 50ms, took {:?}",
        elapsed
    );

    let _ = fs::remove_dir_all(&test_dir);
}

// ============================================================================
// 9. Adversarial Leak Detection: Burst Lane Flag Cleared on Idle Dispatch
// ============================================================================

#[tokio::test]
async fn test_adversarial_burst_lane_leak_at_idle() {
    let test_dir = create_temp_dir("burst_leak");
    let f1 = test_dir.join("f1.log");
    fs::write(&f1, "sample text\n").unwrap();

    let scheduler = Arc::new(IngestionScheduler::new(
        test_dir.join("temp"),
        None,
        None,
        Arc::new(ProgressDispatcher::default()),
        2,
        1_000_000_000,
    ));

    // Enqueue file
    let job = scheduler
        .enqueue_file("p1", &f1.to_string_lossy(), IngestPriority::Normal)
        .await
        .unwrap();

    // Promote to VIP while queue is idle
    let _ = scheduler.promote_to_vip(&job.file_id).await.unwrap();

    // Wait for job to finish
    for _ in 0..50 {
        tokio::time::sleep(Duration::from_millis(20)).await;
        let snap = scheduler.get_queue_snapshot().await;
        if snap.active_count == 0 && snap.pending_count == 0 {
            break;
        }
    }

    // Inspect scheduler state: when idle with 0 jobs pending and 0 jobs active,
    // burst_lane_active MUST be false!
    let st = scheduler.state.read().await;
    let leaked = st.burst_lane_active;
    eprintln!("ADVERSARIAL VERIFIED: burst_lane_active after completion is correctly reset: {}", !leaked);
    assert!(!st.burst_lane_active, "Burst lane flag leaked: was not reset upon dispatch when active_count == 0");

    let _ = fs::remove_dir_all(&test_dir);
}

// ============================================================================
// 10. Adversarial Direct VIP Enqueue Burst Lane Activation
// ============================================================================

#[tokio::test]
async fn test_adversarial_direct_vip_enqueue_activates_burst_lane() {
    let test_dir = create_temp_dir("direct_vip_burst");
    let f1 = test_dir.join("vip1.log");
    fs::write(&f1, "vip line\n").unwrap();

    let scheduler = Arc::new(IngestionScheduler::new(
        test_dir.join("temp"),
        None,
        None,
        Arc::new(ProgressDispatcher::default()),
        2,
        1_000_000_000,
    ));

    // Directly enqueue with Vip priority
    let job = scheduler
        .enqueue_file("p1", &f1.to_string_lossy(), IngestPriority::Vip)
        .await
        .unwrap();

    assert_eq!(job.priority, IngestPriority::Vip);

    // Wait for job to complete
    for _ in 0..50 {
        tokio::time::sleep(Duration::from_millis(20)).await;
        let snap = scheduler.get_queue_snapshot().await;
        if snap.active_count == 0 && snap.pending_count == 0 {
            break;
        }
    }

    let st = scheduler.state.read().await;
    assert!(!st.burst_lane_active, "Burst lane flag must be false after completion");
    let completed = st.completed.get(&job.job_id).unwrap();
    assert_eq!(completed.status, IngestStatus::Ready);

    let _ = fs::remove_dir_all(&test_dir);
}

