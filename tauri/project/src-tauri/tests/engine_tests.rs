//! engine_tests.rs
//!
//! Comprehensive Unit and Integration Test Suite for Milestone 3:
//! - F07: In-process Tokio DuckDB connection pool (UI query & Ingestion worker separation)
//! - F08: QueryExp AST Serde deserializer & recursive DuckDB SQL compiler
//! - F09: Apache Arrow IPC stream encoder (0xFFFFFFFF continuation marker, toadSchema metadata)
//! - F10: Fast O(1) Parquet metadata footer row counter
//! - F11: reltab.Schema DTO & DuckDB type mapping
//! - F12: In-memory column stats cache (TTL + LRU eviction)
//! - Commands: Full query dispatch integration

use arrow::array::{BooleanArray, Float64Array, Int32Array, StringArray};
use arrow::datatypes::{DataType, Field, Schema as ArrowSchema};
use arrow::record_batch::RecordBatch;
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;

use toad_lib::engine::arrow_encoder::ArrowIpcEncoder;
use toad_lib::engine::duckdb_pool::DuckDbEnginePool;
use toad_lib::engine::query_compiler::{
    AggColSpec, BinRelExp, FilterExp, QueryExpCompiler, QueryRep, SortKey, SubExp, ValExp,
};
use toad_lib::engine::schema_mapper::SchemaMapper;
use toad_lib::engine::stats_cache::{ColumnStatsDto, ColumnStatsMap, StatsCache};

// ============================================================================
// SECTION 1: DUCKDB ENGINE POOL (F07)
// ============================================================================

#[tokio::test]
async fn test_duckdb_engine_pool_initialization_and_ui_query() {
    let temp_dir = std::env::temp_dir().join("toad_test_m3_pool");
    let _ = std::fs::create_dir_all(&temp_dir);

    let pool = DuckDbEnginePool::new(temp_dir.clone(), 2, "1GB".to_string())
        .expect("Failed to initialize DuckDbEnginePool");

    assert_eq!(pool.threads(), 2);
    assert_eq!(pool.max_memory(), "1GB");

    // Execute table creation and query on UI connection
    let res = pool
        .eval_ui_conn(|conn| {
            conn.execute(
                "CREATE TABLE test_events (id INTEGER, message VARCHAR, val DOUBLE);",
                [],
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO test_events VALUES (1, 'Login success', 42.5), (2, 'Failed attempt', 13.0);",
                [],
            )
            .map_err(|e| e.to_string())?;
            let mut stmt = conn
                .prepare("SELECT COUNT(*)::BIGINT FROM test_events;")
                .map_err(|e| e.to_string())?;
            let count: i64 = stmt.query_row([], |row| row.get(0)).map_err(|e| e.to_string())?;
            Ok(count)
        })
        .await
        .expect("UI query execution failed");

    assert_eq!(res, 2);

    // Test Arrow IPC generation from UI connection
    let _ipc_res = pool
        .eval_query_arrow("SELECT * FROM test_events ORDER BY id;".to_string())
        .await
        .expect("Arrow query evaluation failed");

    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn test_duckdb_worker_ingest_concurrency() {
    let temp_dir = std::env::temp_dir().join("toad_test_m3_worker");
    let _ = std::fs::create_dir_all(&temp_dir);

    let pool = Arc::new(
        DuckDbEnginePool::new(temp_dir.clone(), 4, "1GB".to_string())
            .expect("Failed to initialize DuckDbEnginePool"),
    );

    // Concurrently launch background ingest worker tasks
    let mut handles = Vec::new();
    for i in 0..5 {
        let p = pool.clone();
        let handle = tokio::spawn(async move {
            p.run_ingest_task(move |conn| {
                conn.execute(
                    &format!("CREATE TABLE worker_tbl_{} (id INT, tag VARCHAR);", i),
                    [],
                )
                .map_err(|e| e.to_string())?;
                conn.execute(
                    &format!("INSERT INTO worker_tbl_{} VALUES ({}, 'worker_{}');", i, i, i),
                    [],
                )
                .map_err(|e| e.to_string())?;
                let mut stmt = conn
                    .prepare(&format!("SELECT COUNT(*)::BIGINT FROM worker_tbl_{};", i))
                    .map_err(|e| e.to_string())?;
                let count: i64 = stmt.query_row([], |row| row.get(0)).map_err(|e| e.to_string())?;
                Ok(count)
            })
            .await
        });
        handles.push(handle);
    }

    for h in handles {
        let count = h.await.unwrap().expect("Worker task failed");
        assert_eq!(count, 1);
    }

    let _ = std::fs::remove_dir_all(&temp_dir);
}

// ============================================================================
// SECTION 2: QUERYEXP AST COMPILER (F08)
// ============================================================================

#[test]
fn test_query_compiler_table_and_project() {
    // 1. Base table query
    let q_table = QueryRep::Table {
        table_name: "security_logs".to_string(),
    };
    let sql1 = QueryExpCompiler::compile(&q_table, None, None).unwrap();
    assert_eq!(sql1, "SELECT * FROM \"security_logs\"");

    // 2. Project query
    let q_proj = QueryRep::Project {
        cols: vec!["EventID".to_string(), "Provider".to_string()],
        from: Box::new(q_table),
    };
    let sql2 = QueryExpCompiler::compile(&q_proj, Some(10), Some(50)).unwrap();
    assert_eq!(
        sql2,
        "SELECT \"EventID\", \"Provider\" FROM (SELECT * FROM \"security_logs\") AS _t1 LIMIT 50 OFFSET 10"
    );
}

#[test]
fn test_query_compiler_filter_and_sort() {
    let q_table = QueryRep::Table {
        table_name: "events".to_string(),
    };

    // Filter with binary relation
    let q_filter = QueryRep::Filter {
        fexp: FilterExp::Single(SubExp::BinRel(BinRelExp {
            exp_type: "BinRelExp".to_string(),
            op: "EQ".to_string(),
            lhs: ValExp::Typed(toad_lib::engine::query_compiler::TypedValExp::ColRef {
                col_name: "EventID".to_string(),
                tbl_alias: None,
            }),
            rhs: ValExp::Literal(json!(4624)),
        })),
        from: Box::new(q_table),
    };

    // Sort with NULLS LAST
    let q_sort = QueryRep::Sort {
        keys: vec![SortKey::Tuple("TimeCreated".to_string(), false)],
        from: Box::new(q_filter),
    };

    let sql = QueryExpCompiler::compile(&q_sort, None, None).unwrap();
    assert!(sql.contains("WHERE \"EventID\" = 4624"));
    assert!(sql.contains("ORDER BY \"TimeCreated\" DESC NULLS LAST"));
}

#[test]
fn test_query_compiler_forensic_path_normalization() {
    let q_table = QueryRep::Table {
        table_name: "file_access".to_string(),
    };

    // Windows backslash path in filter
    let q_filter = QueryRep::Filter {
        fexp: FilterExp::Single(SubExp::BinRel(BinRelExp {
            exp_type: "BinRelExp".to_string(),
            op: "CONTAINS".to_string(),
            lhs: ValExp::Typed(toad_lib::engine::query_compiler::TypedValExp::ColRef {
                col_name: "FilePath".to_string(),
                tbl_alias: None,
            }),
            rhs: ValExp::Literal(json!("System32\\drivers")),
        })),
        from: Box::new(q_table),
    };

    let sql = QueryExpCompiler::compile(&q_filter, None, None).unwrap();
    // Path normalization must replace backslashes and normalize
    assert!(sql.contains("REGEXP_REPLACE(\"FilePath\"::VARCHAR, '[\\\\/]+', '/', 'g') ILIKE '%System32/drivers%' ESCAPE '\\'"));
}

#[test]
fn test_query_compiler_pattern_escaping() {
    let q_table = QueryRep::Table {
        table_name: "logs".to_string(),
    };

    // Search term containing SQL wildcard characters '%', '_', '\'
    let q_filter = QueryRep::Filter {
        fexp: FilterExp::Single(SubExp::BinRel(BinRelExp {
            exp_type: "BinRelExp".to_string(),
            op: "BEGINS".to_string(),
            lhs: ValExp::Typed(toad_lib::engine::query_compiler::TypedValExp::ColRef {
                col_name: "Message".to_string(),
                tbl_alias: None,
            }),
            rhs: ValExp::Literal(json!("100%_complete\\final")),
        })),
        from: Box::new(q_table),
    };

    let sql = QueryExpCompiler::compile(&q_filter, None, None).unwrap();
    assert!(sql.contains("ESCAPE '\\'"));
    assert!(sql.contains("100\\%\\_complete/final%"));
}

#[test]
fn test_query_compiler_group_by_and_aggregations() {
    let q_table = QueryRep::Table {
        table_name: "sales".to_string(),
    };

    let q_group = QueryRep::GroupBy {
        cols: vec!["Region".to_string()],
        aggs: vec![
            AggColSpec::Tuple("sum".to_string(), "Amount".to_string()),
            AggColSpec::Tuple("count".to_string(), "*".to_string()),
            AggColSpec::Tuple("uniq".to_string(), "Status".to_string()),
            AggColSpec::Tuple("null".to_string(), "Notes".to_string()),
        ],
        from: Box::new(q_table),
    };

    let sql = QueryExpCompiler::compile(&q_group, None, None).unwrap();
    assert!(sql.contains("GROUP BY \"Region\""));
    assert!(sql.contains("SUM(\"Amount\") AS \"Amount\""));
    assert!(sql.contains("COUNT(*) AS \"*\""));
    // Verify DuckDB uniq aggregate emulation
    assert!(sql.contains("CASE WHEN MIN(\"Status\") = MAX(\"Status\") THEN MIN(\"Status\") ELSE NULL END AS \"Status\""));
    assert!(sql.contains("NULL AS \"Notes\""));
}

#[test]
fn test_query_compiler_omni_search() {
    let q_table = QueryRep::Table {
        table_name: "events".to_string(),
    };

    let q_omni = QueryRep::Filter {
        fexp: FilterExp::Single(SubExp::OmniSearch(toad_lib::engine::query_compiler::OmniSearchRelExp {
            exp_type: "OmniSearchRelExp".to_string(),
            search_term: "malware.exe".to_string(),
            columns: vec![
                "ProcessName".to_string(),
                "CommandLine".to_string(),
                "_hidden_meta".to_string(), // Must be skipped
            ],
        })),
        from: Box::new(q_table),
    };

    let sql = QueryExpCompiler::compile(&q_omni, None, None).unwrap();
    assert!(sql.contains("CONCAT_WS(' ', \"ProcessName\"::VARCHAR, \"CommandLine\"::VARCHAR) ILIKE '%malware.exe%' ESCAPE '\\'"));
    assert!(!sql.contains("_hidden_meta"));
}

#[test]
fn test_query_compiler_compile_count() {
    let q_table = QueryRep::Table {
        table_name: "big_table".to_string(),
    };
    let count_sql = QueryExpCompiler::compile_count(&q_table).unwrap();
    assert_eq!(
        count_sql,
        "SELECT COUNT(*) AS \"rowCount\" FROM (SELECT * FROM \"big_table\") AS _count_sub"
    );
}

#[test]
fn test_query_compiler_shorthand_deserialization() {
    // Shorthand AST used in test_e2e_features.js
    let shorthand_json = json!({
        "expType": "filter",
        "from": {
            "expType": "table",
            "tableName": "security_events"
        },
        "filterExp": {
            "op": "EQ",
            "lhs": "EventID",
            "rhs": 4624
        }
    });

    let query_rep = QueryExpCompiler::parse_query_exp(&shorthand_json)
        .expect("Failed to parse shorthand JSON");

    let sql = QueryExpCompiler::compile(&query_rep, None, None).unwrap();
    assert_eq!(
        sql,
        "SELECT * FROM (SELECT * FROM \"security_events\") AS _t1 WHERE \"EventID\" = 4624"
    );
}

// ============================================================================
// SECTION 3: ARROW IPC STREAM ENCODER (F09)
// ============================================================================

#[test]
fn test_arrow_encoder_stream_marker_and_roundtrip() {
    // 1. Build a simple RecordBatch
    let schema = Arc::new(ArrowSchema::new(vec![
        Field::new("id", DataType::Int32, false),
        Field::new("name", DataType::Utf8, true),
        Field::new("active", DataType::Boolean, false),
        Field::new("score", DataType::Float64, true),
    ]));

    let id_array = Arc::new(Int32Array::from(vec![1, 2, 3]));
    let name_array = Arc::new(StringArray::from(vec![Some("Alice"), None, Some("Charlie")]));
    let active_array = Arc::new(BooleanArray::from(vec![true, false, true]));
    let score_array = Arc::new(Float64Array::from(vec![Some(99.5), Some(88.0), None]));

    let batch = RecordBatch::try_new(
        schema.clone(),
        vec![id_array, name_array, active_array, score_array],
    )
    .unwrap();

    let bytes = ArrowIpcEncoder::encode_to_vec(&[batch], &schema, None)
        .expect("Failed to encode Arrow IPC stream");

    // Assertion 1: Must begin with 0xFFFFFFFF continuation marker
    assert!(bytes.len() >= 8);
    assert_eq!(&bytes[0..4], &[0xFF, 0xFF, 0xFF, 0xFF]);

    // Assertion 2: 32-bit LE metadata length is positive
    let meta_len = i32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
    assert!(meta_len > 0);

    // Assertion 3: Verify stream can be decoded back using Arrow reader
    let cursor = std::io::Cursor::new(bytes);
    let mut reader = arrow::ipc::reader::StreamReader::try_new(cursor, None)
        .expect("Failed to create Arrow StreamReader");

    let decoded_schema = reader.schema();
    assert_eq!(decoded_schema.fields().len(), 4);

    // Verify embedded toadSchema and application metadata
    let meta = decoded_schema.metadata();
    assert_eq!(meta.get("application").map(|s| s.as_str()), Some("Toad-Tauri-v2"));
    assert!(meta.contains_key("toadSchema"));

    let read_batch = reader.next().unwrap().expect("Failed to read record batch");
    assert_eq!(read_batch.num_rows(), 3);
    assert_eq!(read_batch.num_columns(), 4);
}

#[test]
fn test_arrow_encoder_empty_table() {
    let schema = Arc::new(ArrowSchema::new(vec![
        Field::new("col1", DataType::Int32, false),
        Field::new("col2", DataType::Utf8, false),
    ]));

    let bytes = ArrowIpcEncoder::encode_to_vec(&[], &schema, None)
        .expect("Failed to encode empty table");

    assert_eq!(&bytes[0..4], &[0xFF, 0xFF, 0xFF, 0xFF]);

    let cursor = std::io::Cursor::new(bytes);
    let mut reader = arrow::ipc::reader::StreamReader::try_new(cursor, None).unwrap();
    assert_eq!(reader.schema().fields().len(), 2);
    // Must yield 0 batches
    assert!(reader.next().is_none());
}

// ============================================================================
// SECTION 4: FAST PARQUET ROW COUNTER (F10)
// ============================================================================

#[test]
fn test_fast_parquet_count_sql_generation() {
    let path = "C:\\Data\\logs_2026.parquet";
    let sql = QueryExpCompiler::fast_parquet_count(path);
    assert_eq!(
        sql,
        "SELECT COALESCE(SUM(row_group_num_rows), 0) AS total_rows FROM parquet_metadata('C:\\Data\\logs_2026.parquet') WHERE column_id = 0"
    );
}

// ============================================================================
// SECTION 5: SCHEMA MAPPER (F11)
// ============================================================================

#[test]
fn test_schema_mapper_duckdb_kinds() {
    assert_eq!(SchemaMapper::duckdb_type_to_kind("BIGINT"), "integer");
    assert_eq!(SchemaMapper::duckdb_type_to_kind("INTEGER"), "integer");
    assert_eq!(SchemaMapper::duckdb_type_to_kind("SMALLINT"), "integer");
    assert_eq!(SchemaMapper::duckdb_type_to_kind("DOUBLE"), "real");
    assert_eq!(SchemaMapper::duckdb_type_to_kind("DECIMAL(10,2)"), "real");
    assert_eq!(SchemaMapper::duckdb_type_to_kind("VARCHAR"), "text");
    assert_eq!(SchemaMapper::duckdb_type_to_kind("BOOLEAN"), "boolean");
    assert_eq!(SchemaMapper::duckdb_type_to_kind("TIMESTAMP WITH TIME ZONE"), "timestamp");
    assert_eq!(SchemaMapper::duckdb_type_to_kind("DATE"), "timestamp");
    assert_eq!(SchemaMapper::duckdb_type_to_kind("BLOB"), "blob");
}

#[test]
fn test_schema_mapper_to_toad_schema_json() {
    let schema = ArrowSchema::new(vec![
        Field::new("id", DataType::Int64, false),
        Field::new("msg", DataType::Utf8, true),
    ]);

    let json_str = SchemaMapper::to_toad_schema_json(&schema);
    let val: serde_json::Value = serde_json::from_str(&json_str).unwrap();

    assert_eq!(val["version"], 2);
    assert_eq!(val["columns"], json!(["id", "msg"]));
    assert_eq!(val["columnMetadata"]["id"]["columnType"], "BIGINT");
    assert_eq!(val["columnMetadata"]["msg"]["columnType"], "VARCHAR");
}

// ============================================================================
// SECTION 6: STATS CACHE (F12)
// ============================================================================

#[tokio::test]
async fn test_stats_cache_ttl_and_lru() {
    let cache = StatsCache::new(Duration::from_millis(50), 2); // 50ms TTL, max 2 entries

    let mut map1 = ColumnStatsMap::new();
    map1.insert(
        "id".to_string(),
        ColumnStatsDto::Numeric {
            min: Some(1.0),
            max: Some(100.0),
            approx_unique: Some(100),
            count: 100,
            pct_null: Some(0.0),
        },
    );

    let mut map2 = ColumnStatsMap::new();
    map2.insert(
        "val".to_string(),
        ColumnStatsDto::Numeric {
            min: Some(5.0),
            max: Some(50.0),
            approx_unique: Some(10),
            count: 50,
            pct_null: Some(0.1),
        },
    );

    cache.insert("table_a".to_string(), map1.clone(), Some(100)).await;
    cache.insert("table_b".to_string(), map2.clone(), Some(50)).await;

    assert_eq!(cache.len().await, 2);

    // Retrieve table_a
    let hit = cache.get("table_a").await;
    assert!(hit.is_some());
    assert_eq!(hit.unwrap(), map1);

    // Insert 3rd entry -> causes LRU eviction of table_b (since table_a was accessed recently)
    let map3 = ColumnStatsMap::new();
    cache.insert("table_c".to_string(), map3, Some(10)).await;
    assert_eq!(cache.len().await, 2);
    assert!(cache.get("table_a").await.is_some());
    assert!(cache.get("table_b").await.is_none()); // Evicted by LRU

    // Wait for TTL expiration (> 50ms)
    tokio::time::sleep(Duration::from_millis(60)).await;
    assert!(cache.get("table_a").await.is_none()); // Expired by TTL
}

#[test]
fn test_query_compiler_empty_in_and_notin() {
    let q_table = QueryRep::Table {
        table_name: "events".to_string(),
    };

    // 1. Literal empty IN -> 1=0
    let q_in_empty = QueryRep::Filter {
        fexp: FilterExp::Single(SubExp::BinRel(BinRelExp {
            exp_type: "BinRelExp".to_string(),
            op: "IN".to_string(),
            lhs: ValExp::Typed(toad_lib::engine::query_compiler::TypedValExp::ColRef {
                col_name: "Status".to_string(),
                tbl_alias: None,
            }),
            rhs: ValExp::Literal(json!([])),
        })),
        from: Box::new(q_table.clone()),
    };
    let sql_in = QueryExpCompiler::compile(&q_in_empty, None, None).unwrap();
    assert!(sql_in.contains("WHERE 1=0"), "Empty IN must compile to 1=0");

    // 2. Literal empty NOTIN -> 1=1
    let q_notin_empty = QueryRep::Filter {
        fexp: FilterExp::Single(SubExp::BinRel(BinRelExp {
            exp_type: "BinRelExp".to_string(),
            op: "NOTIN".to_string(),
            lhs: ValExp::Typed(toad_lib::engine::query_compiler::TypedValExp::ColRef {
                col_name: "Status".to_string(),
                tbl_alias: None,
            }),
            rhs: ValExp::Literal(json!([])),
        })),
        from: Box::new(q_table.clone()),
    };
    let sql_notin = QueryExpCompiler::compile(&q_notin_empty, None, None).unwrap();
    assert!(sql_notin.contains("WHERE 1=1"), "Empty NOTIN must compile to 1=1");

    // 3. Typed ConstVal non-empty array with strings (single quotes, not double quotes)
    let q_in_vals = QueryRep::Filter {
        fexp: FilterExp::Single(SubExp::BinRel(BinRelExp {
            exp_type: "BinRelExp".to_string(),
            op: "IN".to_string(),
            lhs: ValExp::Typed(toad_lib::engine::query_compiler::TypedValExp::ColRef {
                col_name: "Status".to_string(),
                tbl_alias: None,
            }),
            rhs: ValExp::Typed(toad_lib::engine::query_compiler::TypedValExp::ConstVal {
                val: json!(["Active", "Pending"]),
            }),
        })),
        from: Box::new(q_table),
    };
    let sql_vals = QueryExpCompiler::compile(&q_in_vals, None, None).unwrap();
    assert!(
        sql_vals.contains("\"Status\" IN ('Active', 'Pending')"),
        "Array items must be formatted as single-quoted SQL literals: {}",
        sql_vals
    );
}

#[test]
fn test_query_compiler_empty_ast_safeguards() {
    let q_table = QueryRep::Table {
        table_name: "users".to_string(),
    };

    // 1. Project with empty cols -> SELECT *
    let q_proj = QueryRep::Project {
        cols: vec![],
        from: Box::new(q_table.clone()),
    };
    let sql_proj = QueryExpCompiler::compile(&q_proj, None, None).unwrap();
    assert!(sql_proj.starts_with("SELECT * FROM"));

    // 2. GroupBy with empty cols and aggs -> SELECT *
    let q_group = QueryRep::GroupBy {
        cols: vec![],
        aggs: vec![],
        from: Box::new(q_table.clone()),
    };
    let sql_group = QueryExpCompiler::compile(&q_group, None, None).unwrap();
    assert!(sql_group.starts_with("SELECT * FROM"));

    // 3. Join with empty on -> ON 1=1
    let q_join = QueryRep::Join {
        lhs: Box::new(q_table.clone()),
        rhs: Box::new(q_table),
        on: vec![],
        join_type: None,
    };
    let sql_join = QueryExpCompiler::compile(&q_join, None, None).unwrap();
    assert!(sql_join.contains("ON 1=1"));
}

#[test]
fn test_query_compiler_unc_path_symmetrical_normalization() {
    let q_table = QueryRep::Table {
        table_name: "logs".to_string(),
    };

    // Windows UNC path with double backslashes in EQ
    let q_eq = QueryRep::Filter {
        fexp: FilterExp::Single(SubExp::BinRel(BinRelExp {
            exp_type: "BinRelExp".to_string(),
            op: "EQ".to_string(),
            lhs: ValExp::Typed(toad_lib::engine::query_compiler::TypedValExp::ColRef {
                col_name: "Path".to_string(),
                tbl_alias: None,
            }),
            rhs: ValExp::Literal(json!("\\\\server\\share\\tool.exe")),
        })),
        from: Box::new(q_table.clone()),
    };
    let sql_eq = QueryExpCompiler::compile(&q_eq, None, None).unwrap();
    assert!(sql_eq.contains("REGEXP_REPLACE(\"Path\"::VARCHAR, '[\\\\/]+', '/', 'g') = '/server/share/tool.exe'"));

    // Windows UNC path in NEQ
    let q_neq = QueryRep::Filter {
        fexp: FilterExp::Single(SubExp::BinRel(BinRelExp {
            exp_type: "BinRelExp".to_string(),
            op: "NEQ".to_string(),
            lhs: ValExp::Typed(toad_lib::engine::query_compiler::TypedValExp::ColRef {
                col_name: "Path".to_string(),
                tbl_alias: None,
            }),
            rhs: ValExp::Literal(json!("\\\\server\\share\\tool.exe")),
        })),
        from: Box::new(q_table),
    };
    let sql_neq = QueryExpCompiler::compile(&q_neq, None, None).unwrap();
    assert!(sql_neq.contains("REGEXP_REPLACE(\"Path\"::VARCHAR, '[\\\\/]+', '/', 'g') != '/server/share/tool.exe'"));
}
