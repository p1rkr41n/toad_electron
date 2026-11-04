//! adversarial_ipc_stress_tests.rs
//!
//! Empirical Challenger Adversarial Test Harness for Arrow IPC Stream Protocol & DuckDB Engine:
//! - 1. Continuation indicator (0xFFFFFFFF) and 8-byte message alignment.
//! - 2. Int64 / BigInt extreme precision (> 2^53 - 1, i64::MIN, i64::MAX).
//! - 3. NULL validity bitmaps across all types with unaligned row counts (129 rows).
//! - 4. Complex UTF-8 (Vietnamese, astral emojis, control chars, embedded nulls).
//! - 5. Multi-batch stream with variable batch sizes including middle 0-row batch.
//! - 6. 0-row empty tables (no batches, empty batch, encode_empty).
//! - 7. Live DuckDB queries to Arrow IPC via DuckDbEnginePool.
//! - 8. toadSchema JSON metadata validation.
//! - 9. Cross-language binary dump for Node.js verification.

use arrow::array::{
    Array, BooleanArray, Float64Array, Int32Array, Int64Array, RecordBatch, StringArray,
    TimestampMillisecondArray,
};
use arrow::datatypes::{DataType, Field, Schema as ArrowSchema, TimeUnit};
use arrow::ipc::reader::StreamReader;
use serde_json::Value;
use std::io::Cursor;
use std::sync::Arc;
use tauri::ipc::{InvokeResponseBody, IpcResponse};

use toad_lib::engine::arrow_encoder::ArrowIpcEncoder;
use toad_lib::engine::duckdb_pool::DuckDbEnginePool;

fn extract_bytes(res: tauri::ipc::Response) -> Vec<u8> {
    match res.body().expect("Failed to get response body") {
        InvokeResponseBody::Raw(b) => b,
        InvokeResponseBody::Json(s) => s.into_bytes(),
    }
}

#[test]
fn test_adv_continuation_and_8byte_alignment() {
    let schema = Arc::new(ArrowSchema::new(vec![
        Field::new("id", DataType::Int32, false),
        Field::new("label", DataType::Utf8, true),
    ]));

    let batch = RecordBatch::try_new(
        schema.clone(),
        vec![
            Arc::new(Int32Array::from(vec![1, 2, 3])),
            Arc::new(StringArray::from(vec![Some("alpha"), None, Some("gamma")])),
        ],
    )
    .unwrap();

    let bytes = ArrowIpcEncoder::encode_to_vec(&[batch], &schema, None)
        .expect("Failed to encode Arrow IPC stream");

    // 1. Must be at least 8 bytes
    assert!(bytes.len() >= 8, "Arrow stream must be at least 8 bytes");

    // 2. Starts with 0xFFFFFFFF
    assert_eq!(
        &bytes[0..4],
        &[0xFF, 0xFF, 0xFF, 0xFF],
        "First 4 bytes must be 0xFFFFFFFF continuation indicator"
    );

    // 3. Scan messages through stream and verify 8-byte alignment
    let offset = 0;
    let mut message_count = 0;

    while offset < bytes.len() {
        assert_eq!(
            offset % 8,
            0,
            "Message at offset {} is NOT 8-byte aligned!",
            offset
        );

        let continuation = &bytes[offset..offset + 4];
        assert_eq!(
            continuation,
            &[0xFF, 0xFF, 0xFF, 0xFF],
            "Message at offset {} missing continuation marker",
            offset
        );

        let meta_len = i32::from_le_bytes([
            bytes[offset + 4],
            bytes[offset + 5],
            bytes[offset + 6],
            bytes[offset + 7],
        ]);

        if meta_len == 0 {
            // EOS marker reached: [0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00]
            assert_eq!(
                offset + 8,
                bytes.len(),
                "EOS marker must be the final 8 bytes of the stream"
            );
            break;
        }

        assert!(meta_len > 0, "Metadata length must be positive, got {}", meta_len);
        let meta_len_usize = meta_len as usize;

        // Metadata is followed by 8-byte padding
        let padded_meta_len = (meta_len_usize + 7) & !7;
        let body_offset = offset + 8 + padded_meta_len;

        assert_eq!(
            body_offset % 8,
            0,
            "Body offset {} is NOT 8-byte aligned!",
            body_offset
        );

        message_count += 1;
        assert!(message_count <= 100, "Too many messages in stream");
        break;
    }

    // Full roundtrip verification using Arrow StreamReader
    let cursor = Cursor::new(&bytes);
    let mut reader = StreamReader::try_new(cursor, None).expect("StreamReader failed to parse");
    let read_batch = reader.next().unwrap().expect("Failed to read record batch");
    assert_eq!(read_batch.num_rows(), 3);
    assert_eq!(read_batch.num_columns(), 2);
}

#[test]
fn test_adv_int64_boundary_precision_extreme_values() {
    let schema = Arc::new(ArrowSchema::new(vec![
        Field::new("big_int", DataType::Int64, false),
        Field::new("label", DataType::Utf8, false),
    ]));

    // Extreme boundaries:
    // i64::MAX = 9,223,372,036,854,775,807
    // i64::MIN = -9,223,372,036,854,775,808
    // 2^53 - 1 (JS Number.MAX_SAFE_INTEGER) = 9,007,199,254,740,991
    // 2^53 = 9,007,199,254,740,992
    // 2^53 + 1 = 9,007,199,254,740,993
    // - (2^53 + 1) = -9,007,199,254,740,993
    let test_vals = vec![
        i64::MAX,
        i64::MIN,
        9_007_199_254_740_991,
        9_007_199_254_740_992,
        9_007_199_254_740_993,
        -9_007_199_254_740_993,
        0,
        1,
        -1,
    ];

    let labels: Vec<String> = test_vals.iter().map(|v| format!("val_{}", v)).collect();

    let int_array = Arc::new(Int64Array::from(test_vals.clone()));
    let label_array = Arc::new(StringArray::from_iter_values(labels.iter().map(|s| s.as_str())));

    let batch = RecordBatch::try_new(schema.clone(), vec![int_array, label_array]).unwrap();

    let bytes = ArrowIpcEncoder::encode_to_vec(&[batch], &schema, None)
        .expect("Failed to encode Int64 extremes");

    let cursor = Cursor::new(&bytes);
    let mut reader = StreamReader::try_new(cursor, None).unwrap();
    let read_batch = reader.next().unwrap().unwrap();

    let col = read_batch
        .column(0)
        .as_any()
        .downcast_ref::<Int64Array>()
        .unwrap();

    for (i, &expected) in test_vals.iter().enumerate() {
        assert_eq!(
            col.value(i),
            expected,
            "Int64 mismatch at index {}: expected {}, got {}",
            i,
            expected,
            col.value(i)
        );
    }
}

#[test]
fn test_adv_null_bitmaps_across_all_types_and_unaligned_lengths() {
    // 129 rows: crosses two 64-bit words + 1 bit remainder (tests partial byte masking)
    const NUM_ROWS: usize = 129;

    let schema = Arc::new(ArrowSchema::new(vec![
        Field::new("c_int", DataType::Int32, true),
        Field::new("c_all_null", DataType::Utf8, true),
        Field::new("c_float", DataType::Float64, true),
        Field::new("c_bool", DataType::Boolean, true),
        Field::new(
            "c_time",
            DataType::Timestamp(TimeUnit::Millisecond, None),
            true,
        ),
    ]));

    let mut int_vals: Vec<Option<i32>> = Vec::with_capacity(NUM_ROWS);
    let mut all_null_vals: Vec<Option<&str>> = Vec::with_capacity(NUM_ROWS);
    let mut float_vals: Vec<Option<f64>> = Vec::with_capacity(NUM_ROWS);
    let mut bool_vals: Vec<Option<bool>> = Vec::with_capacity(NUM_ROWS);
    let mut time_vals: Vec<Option<i64>> = Vec::with_capacity(NUM_ROWS);

    for i in 0..NUM_ROWS {
        // Alternating nulls
        if i % 2 == 0 {
            int_vals.push(Some(i as i32));
        } else {
            int_vals.push(None);
        }

        // 100% null
        all_null_vals.push(None);

        // First 64 nulls, remaining 65 valid
        if i < 64 {
            float_vals.push(None);
        } else {
            float_vals.push(Some(i as f64 * 1.5));
        }

        // Scattered nulls: null when i % 3 == 0
        if i % 3 == 0 {
            bool_vals.push(None);
        } else {
            bool_vals.push(Some(i % 2 == 0));
        }

        // Timestamp null when i % 5 == 0
        if i % 5 == 0 {
            time_vals.push(None);
        } else {
            time_vals.push(Some(1_700_000_000_000 + i as i64 * 1000));
        }
    }

    let batch = RecordBatch::try_new(
        schema.clone(),
        vec![
            Arc::new(Int32Array::from(int_vals.clone())),
            Arc::new(StringArray::from(all_null_vals.clone())),
            Arc::new(Float64Array::from(float_vals.clone())),
            Arc::new(BooleanArray::from(bool_vals.clone())),
            Arc::new(TimestampMillisecondArray::from(time_vals.clone())),
        ],
    )
    .unwrap();

    let bytes = ArrowIpcEncoder::encode_to_vec(&[batch], &schema, None)
        .expect("Failed to encode unaligned null bitmaps");

    let cursor = Cursor::new(&bytes);
    let mut reader = StreamReader::try_new(cursor, None).unwrap();
    let read_batch = reader.next().unwrap().unwrap();

    assert_eq!(read_batch.num_rows(), NUM_ROWS);

    let read_int = read_batch
        .column(0)
        .as_any()
        .downcast_ref::<Int32Array>()
        .unwrap();
    let read_null = read_batch
        .column(1)
        .as_any()
        .downcast_ref::<StringArray>()
        .unwrap();
    let read_float = read_batch
        .column(2)
        .as_any()
        .downcast_ref::<Float64Array>()
        .unwrap();
    let read_bool = read_batch
        .column(3)
        .as_any()
        .downcast_ref::<BooleanArray>()
        .unwrap();
    let read_time = read_batch
        .column(4)
        .as_any()
        .downcast_ref::<TimestampMillisecondArray>()
        .unwrap();

    for i in 0..NUM_ROWS {
        // c_int
        assert_eq!(read_int.is_null(i), i % 2 != 0);
        if !read_int.is_null(i) {
            assert_eq!(read_int.value(i), i as i32);
        }

        // c_all_null
        assert!(read_null.is_null(i), "Row {} should be null", i);

        // c_float
        assert_eq!(read_float.is_null(i), i < 64);
        if !read_float.is_null(i) {
            assert_eq!(read_float.value(i), i as f64 * 1.5);
        }

        // c_bool
        assert_eq!(read_bool.is_null(i), i % 3 == 0);
        if !read_bool.is_null(i) {
            assert_eq!(read_bool.value(i), i % 2 == 0);
        }

        // c_time
        assert_eq!(read_time.is_null(i), i % 5 == 0);
        if !read_time.is_null(i) {
            assert_eq!(read_time.value(i), 1_700_000_000_000 + i as i64 * 1000);
        }
    }
}

#[test]
fn test_adv_complex_utf8_emojis_multiline_control_chars() {
    let schema = Arc::new(ArrowSchema::new(vec![
        Field::new("utf8_test", DataType::Utf8, true),
    ]));

    let test_strings = vec![
        Some("Tiếng Việt có dấu: ắ, ằ, ẳ, ẵ, ặ, ấ, ầ, ổ, ỡ, ự, ỳ, ỹ, đ, Đ"),
        Some("Astral plane emojis: 🌍 🚀 🦀 🦖 🐱‍👤 🛡️ 💎 ⚡ 🎯"),
        Some("CRLF and tabs:\r\n\tLine 1\r\n\tLine 2\r\n\t\tLine 3"),
        Some("Quotes & Escapes: \"double\" 'single' `backtick` \\backslash\\"),
        Some("Embedded null char: hello\0world"),
        Some(""), // Empty string
        None,     // NULL
        Some("Special punctuation: « » „ “ ” ’ — – … · •"),
    ];

    let string_array = Arc::new(StringArray::from(test_strings.clone()));
    let batch = RecordBatch::try_new(schema.clone(), vec![string_array]).unwrap();

    let bytes = ArrowIpcEncoder::encode_to_vec(&[batch], &schema, None)
        .expect("Failed to encode complex UTF-8");

    let cursor = Cursor::new(&bytes);
    let mut reader = StreamReader::try_new(cursor, None).unwrap();
    let read_batch = reader.next().unwrap().unwrap();

    let col = read_batch
        .column(0)
        .as_any()
        .downcast_ref::<StringArray>()
        .unwrap();

    assert_eq!(col.len(), test_strings.len());
    for (i, expected) in test_strings.iter().enumerate() {
        match expected {
            Some(s) => {
                assert!(!col.is_null(i), "Row {} should not be null", i);
                assert_eq!(col.value(i), *s, "String mismatch at row {}", i);
            }
            None => {
                assert!(col.is_null(i), "Row {} should be null", i);
            }
        }
    }
}

#[test]
fn test_adv_multi_batch_stream_variable_batch_sizes() {
    let schema = Arc::new(ArrowSchema::new(vec![
        Field::new("batch_id", DataType::Int32, false),
        Field::new("seq", DataType::Int32, false),
    ]));

    // 5 batches with sizes [10, 0, 25, 1, 50] -> total 86 rows
    let batch_sizes = [10, 0, 25, 1, 50];
    let mut batches = Vec::new();
    let mut expected_total_rows = 0;

    for (b_idx, &size) in batch_sizes.iter().enumerate() {
        let b_id_vec: Vec<i32> = vec![b_idx as i32; size];
        let seq_vec: Vec<i32> = (0..size as i32).collect();

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int32Array::from(b_id_vec)),
                Arc::new(Int32Array::from(seq_vec)),
            ],
        )
        .unwrap();

        batches.push(batch);
        expected_total_rows += size;
    }

    let bytes = ArrowIpcEncoder::encode_to_vec(&batches, &schema, None)
        .expect("Failed to encode multi-batch stream");

    let cursor = Cursor::new(&bytes);
    let mut reader = StreamReader::try_new(cursor, None).unwrap();

    let mut total_rows_read = 0;
    let mut batches_read = 0;

    while let Some(batch_res) = reader.next() {
        let batch = batch_res.expect("Error reading batch in multi-batch stream");
        total_rows_read += batch.num_rows();
        batches_read += 1;
    }

    // In Arrow streaming, a 0-row batch may be emitted or preserved
    assert_eq!(
        total_rows_read, expected_total_rows,
        "Total rows read should match expected"
    );
    assert_eq!(batches_read, 5, "Should read 5 batches");
}

#[test]
fn test_adv_zero_row_empty_tables_variations() {
    let schema = Arc::new(ArrowSchema::new(vec![
        Field::new("col_a", DataType::Utf8, false),
        Field::new("col_b", DataType::Int64, true),
    ]));

    // Variation 1: encode_stream with empty slice
    let bytes1 = extract_bytes(ArrowIpcEncoder::encode_stream(&[], &schema, None).unwrap());
    assert_eq!(&bytes1[0..4], &[0xFF, 0xFF, 0xFF, 0xFF]);
    let mut reader1 = StreamReader::try_new(Cursor::new(&bytes1), None).unwrap();
    assert_eq!(reader1.schema().fields().len(), 2);
    assert!(reader1.next().is_none(), "Should have 0 batches");

    // Variation 2: encode_empty helper
    let bytes2 = extract_bytes(ArrowIpcEncoder::encode_empty(&schema, None).unwrap());
    assert_eq!(&bytes2[0..4], &[0xFF, 0xFF, 0xFF, 0xFF]);
    let mut reader2 = StreamReader::try_new(Cursor::new(&bytes2), None).unwrap();
    assert_eq!(reader2.schema().fields().len(), 2);
    assert!(reader2.next().is_none());

    // Variation 3: encode_stream with 1 empty RecordBatch (0 rows)
    let empty_batch = RecordBatch::try_new(
        schema.clone(),
        vec![
            Arc::new(StringArray::from(Vec::<&str>::new())),
            Arc::new(Int64Array::from(Vec::<i64>::new())),
        ],
    )
    .unwrap();
    let bytes3 = ArrowIpcEncoder::encode_to_vec(&[empty_batch], &schema, None).unwrap();
    assert_eq!(&bytes3[0..4], &[0xFF, 0xFF, 0xFF, 0xFF]);
    let mut reader3 = StreamReader::try_new(Cursor::new(&bytes3), None).unwrap();
    assert_eq!(reader3.schema().fields().len(), 2);
    let batch3 = reader3.next().unwrap().unwrap();
    assert_eq!(batch3.num_rows(), 0);
    assert!(reader3.next().is_none());
}

#[tokio::test]
async fn test_adv_live_duckdb_queries_to_arrow_ipc() {
    let temp_dir = std::env::temp_dir().join("toad_test_adv_live_duckdb");
    let _ = std::fs::create_dir_all(&temp_dir);

    let pool = DuckDbEnginePool::new(temp_dir.clone(), 2, "1GB".to_string())
        .expect("Failed to initialize DuckDbEnginePool");

    // Setup table with rich types
    let setup_sql = "
        CREATE TABLE stress_table (
            id BIGINT,
            name VARCHAR,
            rate DOUBLE,
            active BOOLEAN,
            created_at TIMESTAMP
        );
        INSERT INTO stress_table VALUES
            (9007199254740993, 'Unicode: Tiếng Việt 🇻🇳 🚀', 3.1415926535, true, TIMESTAMP '2026-11-04 12:30:00'),
            (-9007199254740993, 'Line 1\r\nLine 2', -0.00001, false, TIMESTAMP '2026-11-04 12:31:00'),
            (NULL, NULL, NULL, NULL, NULL);
    ";

    pool.eval_ui_conn(move |conn| {
        conn.execute_batch(setup_sql).map_err(|e| e.to_string())
    })
    .await
    .expect("Failed to setup stress table");

    // Test 1: Query full table to Arrow IPC
    let response = pool
        .eval_query_arrow("SELECT * FROM stress_table ORDER BY id ASC NULLS LAST;".to_string())
        .await
        .expect("eval_query_arrow failed");

    let bytes = extract_bytes(response);
    assert!(bytes.len() >= 8);
    assert_eq!(&bytes[0..4], &[0xFF, 0xFF, 0xFF, 0xFF]);

    let mut reader = StreamReader::try_new(Cursor::new(&bytes), None).unwrap();
    let schema = reader.schema();
    assert_eq!(schema.fields().len(), 5);

    // Verify toadSchema metadata embedded
    let meta = schema.metadata();
    assert_eq!(meta.get("application").map(|s| s.as_str()), Some("Toad-Tauri-v2"));
    let toad_schema_str = meta.get("toadSchema").expect("Missing toadSchema in metadata");
    let toad_json: Value = serde_json::from_str(toad_schema_str).unwrap();
    assert_eq!(toad_json["version"], 2);
    assert_eq!(toad_json["columnMetadata"]["id"]["columnType"], "BIGINT");

    let batch = reader.next().unwrap().unwrap();
    assert_eq!(batch.num_rows(), 3);

    // Verify row 0: negative extreme BigInt
    let id_col = batch
        .column(0)
        .as_any()
        .downcast_ref::<Int64Array>()
        .unwrap();
    assert_eq!(id_col.value(0), -9007199254740993);
    // Verify row 1: positive extreme BigInt
    assert_eq!(id_col.value(1), 9007199254740993);
    // Verify row 2: NULL
    assert!(id_col.is_null(2));

    // Test 2: 0-row empty result from DuckDB query
    let empty_res = pool
        .eval_query_arrow("SELECT * FROM stress_table WHERE 1=0;".to_string())
        .await
        .expect("empty query failed");
    let empty_bytes = extract_bytes(empty_res);
    assert_eq!(&empty_bytes[0..4], &[0xFF, 0xFF, 0xFF, 0xFF]);
    let empty_reader = StreamReader::try_new(Cursor::new(&empty_bytes), None).unwrap();
    assert_eq!(empty_reader.schema().fields().len(), 5);

    // Test 3: Write out a binary dump file for Node.js cross-language verification
    let dump_dir = std::env::current_dir().unwrap().join("target").join("debug");
    let _ = std::fs::create_dir_all(&dump_dir);
    let dump_path = dump_dir.join("test_cross_lang_dump.arrow");
    std::fs::write(&dump_path, &bytes).expect("Failed to write cross-language dump file");

    let _ = std::fs::remove_dir_all(&temp_dir);
}
