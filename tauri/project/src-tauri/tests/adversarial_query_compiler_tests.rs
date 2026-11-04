//! adversarial_query_compiler_tests.rs
//!
//! Empirical Challenge Suite for Milestone 3 QueryExp Compiler & Path Normalization:
//! 1. Forensics path normalization: Windows `\` and `/` slashes, mixed slashes, consecutive slashes, UNC paths.
//! 2. Pattern escaping: Wildcards `%`, `_`, `\` with ESCAPE '\\', SQL injection resistance.
//! 3. Shorthand column identifier disambiguation: ColRef vs String literal, nested AND/OR/NOT.
//! 4. Aggregate emulations: `uniq` across all edge cases (identical, mixed, all nulls, single + null, numbers), `null`.
//! 5. O(1) Parquet metadata count: Sub-millisecond (< 1ms) footer reading vs standard DuckDB COUNT(*).

use duckdb::Connection;
use serde_json::json;
use std::path::PathBuf;
use std::time::Instant;

use toad_lib::engine::fast_count::FastCounter;
use toad_lib::engine::query_compiler::{
    AggColSpec, BinRelExp, FilterExp, QueryExpCompiler, QueryRep, SubExp, TypedValExp, ValExp,
};

fn create_in_memory_duckdb() -> Connection {
    Connection::open_in_memory().expect("Failed to open DuckDB in-memory")
}

// ============================================================================
// CHALLENGE 1: FORENSICS PATH NORMALIZATION EMPIRICAL TEST
// ============================================================================

#[test]
fn adv_test_forensic_path_slash_normalization_execution() {
    let conn = create_in_memory_duckdb();

    conn.execute_batch(
        r#"
        CREATE TABLE forensics_paths (
            id INTEGER,
            file_path VARCHAR
        );
        INSERT INTO forensics_paths VALUES
            (1, 'C:\Windows\System32\cmd.exe'),
            (2, 'C:/Windows/System32/drivers/etc/hosts'),
            (3, 'C:\\Windows\\\System32\drivers'),
            (4, '//server//share/tools/mimikatz.exe'),
            (5, '\\192.168.1.1\admin$\psexec.exe'),
            (6, 'D:\Logs\2026-11-04\event.evtx');
        "#,
    )
    .expect("Failed to create forensics_paths table");

    let q_table = QueryRep::Table {
        table_name: "forensics_paths".to_string(),
    };

    // Subtest 1.1: CONTAINS with Windows backslash
    let q_contains_bs = QueryRep::Filter {
        fexp: FilterExp::Single(SubExp::BinRel(BinRelExp {
            exp_type: "BinRelExp".to_string(),
            op: "CONTAINS".to_string(),
            lhs: ValExp::Typed(TypedValExp::ColRef {
                col_name: "file_path".to_string(),
                tbl_alias: None,
            }),
            rhs: ValExp::Literal(json!("System32\\cmd.exe")),
        })),
        from: Box::new(q_table.clone()),
    };
    let sql_1 = QueryExpCompiler::compile(&q_contains_bs, None, None).unwrap();
    let mut stmt = conn.prepare(&sql_1).unwrap();
    let ids: Vec<i32> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert_eq!(ids, vec![1], "CONTAINS with Windows backslash must match row 1");

    // Subtest 1.2: CONTAINS with forward slash matching row 1 (which had backslashes)
    let q_contains_fs = QueryRep::Filter {
        fexp: FilterExp::Single(SubExp::BinRel(BinRelExp {
            exp_type: "BinRelExp".to_string(),
            op: "CONTAINS".to_string(),
            lhs: ValExp::Typed(TypedValExp::ColRef {
                col_name: "file_path".to_string(),
                tbl_alias: None,
            }),
            rhs: ValExp::Literal(json!("System32/cmd.exe")),
        })),
        from: Box::new(q_table.clone()),
    };
    let sql_2 = QueryExpCompiler::compile(&q_contains_fs, None, None).unwrap();
    let mut stmt = conn.prepare(&sql_2).unwrap();
    let ids: Vec<i32> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert_eq!(ids, vec![1], "CONTAINS with forward slash must match row 1");

    // Subtest 1.3: CONTAINS with mixed slash matching row 2
    let q_contains_mixed = QueryRep::Filter {
        fexp: FilterExp::Single(SubExp::BinRel(BinRelExp {
            exp_type: "BinRelExp".to_string(),
            op: "CONTAINS".to_string(),
            lhs: ValExp::Typed(TypedValExp::ColRef {
                col_name: "file_path".to_string(),
                tbl_alias: None,
            }),
            rhs: ValExp::Literal(json!("drivers\\etc/hosts")),
        })),
        from: Box::new(q_table.clone()),
    };
    let sql_3 = QueryExpCompiler::compile(&q_contains_mixed, None, None).unwrap();
    let mut stmt = conn.prepare(&sql_3).unwrap();
    let ids: Vec<i32> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert_eq!(ids, vec![2], "CONTAINS with mixed slash must match row 2");

    // Subtest 1.4: BEGINS with Windows backslash matching rows 1, 2, 3
    let q_begins = QueryRep::Filter {
        fexp: FilterExp::Single(SubExp::BinRel(BinRelExp {
            exp_type: "BinRelExp".to_string(),
            op: "BEGINS".to_string(),
            lhs: ValExp::Typed(TypedValExp::ColRef {
                col_name: "file_path".to_string(),
                tbl_alias: None,
            }),
            rhs: ValExp::Literal(json!("C:\\Windows")),
        })),
        from: Box::new(q_table.clone()),
    };
    let sql_4 = QueryExpCompiler::compile(&q_begins, None, None).unwrap();
    let mut stmt = conn.prepare(&sql_4).unwrap();
    let mut ids: Vec<i32> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    ids.sort();
    assert_eq!(ids, vec![1, 2, 3], "BEGINS with C:\\Windows must match rows 1, 2, 3");

    // Subtest 1.5: ENDS with event.evtx
    let q_ends = QueryRep::Filter {
        fexp: FilterExp::Single(SubExp::BinRel(BinRelExp {
            exp_type: "BinRelExp".to_string(),
            op: "ENDS".to_string(),
            lhs: ValExp::Typed(TypedValExp::ColRef {
                col_name: "file_path".to_string(),
                tbl_alias: None,
            }),
            rhs: ValExp::Literal(json!("2026-11-04\\event.evtx")),
        })),
        from: Box::new(q_table.clone()),
    };
    let sql_5 = QueryExpCompiler::compile(&q_ends, None, None).unwrap();
    let mut stmt = conn.prepare(&sql_5).unwrap();
    let ids: Vec<i32> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert_eq!(ids, vec![6], "ENDS with 2026-11-04\\event.evtx must match row 6");

    // Subtest 1.6: EQ with forward slash against backslash stored path
    let q_eq_fs = QueryRep::Filter {
        fexp: FilterExp::Single(SubExp::BinRel(BinRelExp {
            exp_type: "BinRelExp".to_string(),
            op: "EQ".to_string(),
            lhs: ValExp::Typed(TypedValExp::ColRef {
                col_name: "file_path".to_string(),
                tbl_alias: None,
            }),
            rhs: ValExp::Literal(json!("C:/Windows/System32/cmd.exe")),
        })),
        from: Box::new(q_table.clone()),
    };
    let sql_6 = QueryExpCompiler::compile(&q_eq_fs, None, None).unwrap();
    let mut stmt = conn.prepare(&sql_6).unwrap();
    let ids: Vec<i32> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert_eq!(ids, vec![1], "EQ with forward slash must match row 1");

    // Subtest 1.7: OmniSearch with backslash
    let q_omni = QueryRep::Filter {
        fexp: FilterExp::Single(SubExp::OmniSearch(toad_lib::engine::query_compiler::OmniSearchRelExp {
            exp_type: "OmniSearchRelExp".to_string(),
            search_term: "System32\\drivers".to_string(),
            columns: vec!["file_path".to_string()],
        })),
        from: Box::new(q_table.clone()),
    };
    let sql_7 = QueryExpCompiler::compile(&q_omni, None, None).unwrap();
    let mut stmt = conn.prepare(&sql_7).unwrap();
    let mut ids: Vec<i32> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    ids.sort();
    // Subtest 1.8: EQ with UNC path (symmetrical path normalization)
    let q_eq_unc = QueryRep::Filter {
        fexp: FilterExp::Single(SubExp::BinRel(BinRelExp {
            exp_type: "BinRelExp".to_string(),
            op: "EQ".to_string(),
            lhs: ValExp::Typed(TypedValExp::ColRef {
                col_name: "file_path".to_string(),
                tbl_alias: None,
            }),
            rhs: ValExp::Literal(json!("\\\\192.168.1.1\\admin$\\psexec.exe")),
        })),
        from: Box::new(q_table.clone()),
    };
    let sql_8 = QueryExpCompiler::compile(&q_eq_unc, None, None).unwrap();
    println!("[EVIDENCE] Generated SQL for UNC EQ: {}", sql_8);
    let mut stmt = conn.prepare(&sql_8).unwrap();
    let ids_unc: Vec<i32> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    println!("[EVIDENCE] UNC EQ query matched row IDs: {:?}", ids_unc);
    let unc_matched = ids_unc.contains(&5);
    println!("[EVIDENCE] Did UNC path match row 5? {}", unc_matched);
    assert!(unc_matched, "UNC path with double backslash must match row 5 in EQ after symmetrical path normalization");
    assert_eq!(ids_unc, vec![5], "UNC path exact match must return row 5");

    // Subtest 1.9: UNC path with forward slashes in EQ
    let q_eq_unc_fs = QueryRep::Filter {
        fexp: FilterExp::Single(SubExp::BinRel(BinRelExp {
            exp_type: "BinRelExp".to_string(),
            op: "EQ".to_string(),
            lhs: ValExp::Typed(TypedValExp::ColRef {
                col_name: "file_path".to_string(),
                tbl_alias: None,
            }),
            rhs: ValExp::Literal(json!("//192.168.1.1/admin$/psexec.exe")),
        })),
        from: Box::new(q_table.clone()),
    };
    let sql_unc_fs = QueryExpCompiler::compile(&q_eq_unc_fs, None, None).unwrap();
    let mut stmt = conn.prepare(&sql_unc_fs).unwrap();
    let ids_unc_fs: Vec<i32> = stmt.query_map([], |row| row.get(0)).unwrap().map(|r| r.unwrap()).collect();
    assert_eq!(ids_unc_fs, vec![5], "UNC path with forward slashes must match row 5 in EQ");

    // Subtest 1.10: UNC path in NEQ
    let q_neq_unc = QueryRep::Filter {
        fexp: FilterExp::Single(SubExp::BinRel(BinRelExp {
            exp_type: "BinRelExp".to_string(),
            op: "NEQ".to_string(),
            lhs: ValExp::Typed(TypedValExp::ColRef {
                col_name: "file_path".to_string(),
                tbl_alias: None,
            }),
            rhs: ValExp::Literal(json!("\\\\192.168.1.1\\admin$\\psexec.exe")),
        })),
        from: Box::new(q_table.clone()),
    };
    let sql_neq = QueryExpCompiler::compile(&q_neq_unc, None, None).unwrap();
    let mut stmt = conn.prepare(&sql_neq).unwrap();
    let ids_neq: Vec<i32> = stmt.query_map([], |row| row.get(0)).unwrap().map(|r| r.unwrap()).collect();
    assert!(!ids_neq.contains(&5), "NEQ must exclude row 5");

    // Subtest 1.11: Quad-backslash UNC in BEGINS
    let q_begins_quad = QueryRep::Filter {
        fexp: FilterExp::Single(SubExp::BinRel(BinRelExp {
            exp_type: "BinRelExp".to_string(),
            op: "BEGINS".to_string(),
            lhs: ValExp::Typed(TypedValExp::ColRef {
                col_name: "file_path".to_string(),
                tbl_alias: None,
            }),
            rhs: ValExp::Literal(json!("\\\\\\\\192.168.1.1")),
        })),
        from: Box::new(q_table.clone()),
    };
    let sql_begins = QueryExpCompiler::compile(&q_begins_quad, None, None).unwrap();
    let mut stmt = conn.prepare(&sql_begins).unwrap();
    let ids_begins: Vec<i32> = stmt.query_map([], |row| row.get(0)).unwrap().map(|r| r.unwrap()).collect();
    assert_eq!(ids_begins, vec![5], "BEGINS with quad backslashes must match row 5");
}

// ============================================================================
// CHALLENGE 2: PATTERN ESCAPING (% _ \ ') EMPIRICAL TEST
// ============================================================================

#[test]
fn adv_test_pattern_wildcards_and_escaping_execution() {
    let conn = create_in_memory_duckdb();

    conn.execute_batch(
        r#"
        CREATE TABLE wildcard_test (
            id INTEGER,
            msg VARCHAR
        );
        INSERT INTO wildcard_test VALUES
            (1, 'CPU utilization is 100%'),
            (2, 'CPU utilization is 1000'),
            (3, 'user_name_admin'),
            (4, 'user-name-admin'),
            (5, 'userXnameXadmin'),
            (6, 'O''Reilly & Associates'),
            (7, 'Admin'' OR ''1''=''1');
        "#,
    )
    .expect("Failed to create wildcard_test table");

    let q_table = QueryRep::Table {
        table_name: "wildcard_test".to_string(),
    };

    // Subtest 2.1: Literal '%' escaping in CONTAINS
    let q_percent = QueryRep::Filter {
        fexp: FilterExp::Single(SubExp::BinRel(BinRelExp {
            exp_type: "BinRelExp".to_string(),
            op: "CONTAINS".to_string(),
            lhs: ValExp::Typed(TypedValExp::ColRef {
                col_name: "msg".to_string(),
                tbl_alias: None,
            }),
            rhs: ValExp::Literal(json!("100%")),
        })),
        from: Box::new(q_table.clone()),
    };
    let sql_percent = QueryExpCompiler::compile(&q_percent, None, None).unwrap();
    let mut stmt = conn.prepare(&sql_percent).unwrap();
    let ids: Vec<i32> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert_eq!(ids, vec![1], "CONTAINS '100%' must ONLY match row 1, not row 2");

    // Subtest 2.2: Literal '_' escaping in CONTAINS
    let q_underscore = QueryRep::Filter {
        fexp: FilterExp::Single(SubExp::BinRel(BinRelExp {
            exp_type: "BinRelExp".to_string(),
            op: "CONTAINS".to_string(),
            lhs: ValExp::Typed(TypedValExp::ColRef {
                col_name: "msg".to_string(),
                tbl_alias: None,
            }),
            rhs: ValExp::Literal(json!("user_name")),
        })),
        from: Box::new(q_table.clone()),
    };
    let sql_underscore = QueryExpCompiler::compile(&q_underscore, None, None).unwrap();
    let mut stmt = conn.prepare(&sql_underscore).unwrap();
    let ids: Vec<i32> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert_eq!(
        ids,
        vec![3],
        "CONTAINS 'user_name' must ONLY match row 3, not rows 4 or 5"
    );

    // Subtest 2.3: Single quote escaping
    let q_quote = QueryRep::Filter {
        fexp: FilterExp::Single(SubExp::BinRel(BinRelExp {
            exp_type: "BinRelExp".to_string(),
            op: "CONTAINS".to_string(),
            lhs: ValExp::Typed(TypedValExp::ColRef {
                col_name: "msg".to_string(),
                tbl_alias: None,
            }),
            rhs: ValExp::Literal(json!("O'Reilly")),
        })),
        from: Box::new(q_table.clone()),
    };
    let sql_quote = QueryExpCompiler::compile(&q_quote, None, None).unwrap();
    let mut stmt = conn.prepare(&sql_quote).unwrap();
    let ids: Vec<i32> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert_eq!(ids, vec![6], "CONTAINS 'O''Reilly' must match row 6");

    // Subtest 2.4: SQL injection resistance
    let q_inject = QueryRep::Filter {
        fexp: FilterExp::Single(SubExp::BinRel(BinRelExp {
            exp_type: "BinRelExp".to_string(),
            op: "CONTAINS".to_string(),
            lhs: ValExp::Typed(TypedValExp::ColRef {
                col_name: "msg".to_string(),
                tbl_alias: None,
            }),
            rhs: ValExp::Literal(json!("' OR '1'='1")),
        })),
        from: Box::new(q_table.clone()),
    };
    let sql_inject = QueryExpCompiler::compile(&q_inject, None, None).unwrap();
    let mut stmt = conn.prepare(&sql_inject).unwrap();
    let ids: Vec<i32> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert_eq!(
        ids,
        vec![7],
        "SQL injection payload must be treated as literal text and match only row 7"
    );
}

// ============================================================================
// CHALLENGE 3: SHORTHAND COLUMN IDENTIFIER DISAMBIGUATION EMPIRICAL TEST
// ============================================================================

#[test]
fn adv_test_shorthand_column_disambiguation_execution() {
    let conn = create_in_memory_duckdb();

    conn.execute_batch(
        r#"
        CREATE TABLE security_events (
            "EventID" INTEGER,
            "Target User" VARCHAR,
            "Status" VARCHAR
        );
        INSERT INTO security_events VALUES
            (4624, 'Administrator', 'Success'),
            (4625, 'Guest', 'Failure'),
            (4624, 'jdoe', 'Success');
        "#,
    )
    .expect("Failed to create security_events table");

    // Shorthand 3.1: Numeric filter with unquoted string LHS
    let shorthand_eq_int = json!({
        "expType": "filter",
        "from": { "expType": "table", "tableName": "security_events" },
        "filterExp": {
            "op": "EQ",
            "lhs": "EventID",
            "rhs": 4624
        }
    });
    let q_rep = QueryExpCompiler::parse_query_exp(&shorthand_eq_int).unwrap();
    let sql = QueryExpCompiler::compile(&q_rep, None, None).unwrap();
    assert!(sql.contains("\"EventID\" = 4624"));

    let mut stmt = conn.prepare(&sql).unwrap();
    let count: i64 = stmt
        .query_map([], |_| Ok(1))
        .unwrap()
        .count() as i64;
    assert_eq!(count, 2, "EventID = 4624 must return 2 rows");

    // Shorthand 3.2: String filter with spaces in column name
    let shorthand_eq_str = json!({
        "expType": "filter",
        "from": { "expType": "table", "tableName": "security_events" },
        "filterExp": {
            "op": "EQ",
            "lhs": "Target User",
            "rhs": "Administrator"
        }
    });
    let q_rep_str = QueryExpCompiler::parse_query_exp(&shorthand_eq_str).unwrap();
    let sql_str = QueryExpCompiler::compile(&q_rep_str, None, None).unwrap();
    assert!(sql_str.contains("\"Target User\" = 'Administrator'"));

    let mut stmt = conn.prepare(&sql_str).unwrap();
    let count: i64 = stmt
        .query_map([], |_| Ok(1))
        .unwrap()
        .count() as i64;
    assert_eq!(count, 1, "Target User = Administrator must return 1 row");

    // Shorthand 3.3: Nested AND with two shorthand clauses
    let shorthand_and = json!({
        "expType": "filter",
        "from": { "expType": "table", "tableName": "security_events" },
        "filterExp": {
            "op": "AND",
            "lhs": { "op": "EQ", "lhs": "EventID", "rhs": 4624 },
            "rhs": { "op": "EQ", "lhs": "Target User", "rhs": "jdoe" }
        }
    });
    let q_rep_and = QueryExpCompiler::parse_query_exp(&shorthand_and).unwrap();
    let sql_and = QueryExpCompiler::compile(&q_rep_and, None, None).unwrap();
    let mut stmt = conn.prepare(&sql_and).unwrap();
    let count: i64 = stmt
        .query_map([], |_| Ok(1))
        .unwrap()
        .count() as i64;
    assert_eq!(count, 1, "Nested AND must return 1 row");

    // Shorthand 3.4: SQL keywords as column identifiers
    conn.execute_batch(
        r#"
        CREATE TABLE keyword_cols (
            "select" VARCHAR,
            "from" VARCHAR,
            "where" INTEGER,
            "order by" VARCHAR
        );
        INSERT INTO keyword_cols VALUES
            ('col_select', 'col_from', 999, 'col_order');
        "#,
    )
    .expect("Failed to create keyword_cols table");

    let shorthand_keywords = json!({
        "expType": "filter",
        "from": { "expType": "table", "tableName": "keyword_cols" },
        "filterExp": {
            "op": "AND",
            "lhs": { "op": "EQ", "lhs": "select", "rhs": "col_select" },
            "rhs": { "op": "EQ", "lhs": "from", "rhs": "col_from" }
        }
    });
    let q_rep_kw = QueryExpCompiler::parse_query_exp(&shorthand_keywords).unwrap();
    let sql_kw = QueryExpCompiler::compile(&q_rep_kw, None, None).unwrap();
    println!("[EVIDENCE] SQL keywords query: {}", sql_kw);
    assert!(sql_kw.contains("\"select\" = 'col_select'"));
    assert!(sql_kw.contains("\"from\" = 'col_from'"));
    let mut stmt = conn.prepare(&sql_kw).unwrap();
    let count: i64 = stmt.query_map([], |_| Ok(1)).unwrap().count() as i64;
    assert_eq!(count, 1, "SQL keywords as quoted identifiers must succeed");

    // Shorthand 3.5: REGEX operator execution in DuckDB
    let q_regex = QueryRep::Filter {
        fexp: FilterExp::Single(SubExp::BinRel(BinRelExp {
            exp_type: "BinRelExp".to_string(),
            op: "REGEX".to_string(),
            lhs: ValExp::Typed(TypedValExp::ColRef {
                col_name: "select".to_string(),
                tbl_alias: None,
            }),
            rhs: ValExp::Literal(json!("^col_[a-z]+$")),
        })),
        from: Box::new(QueryRep::Table { table_name: "keyword_cols".to_string() }),
    };
    let sql_regex = QueryExpCompiler::compile(&q_regex, None, None).unwrap();
    println!("[EVIDENCE] REGEX query: {}", sql_regex);
    let mut stmt = conn.prepare(&sql_regex).unwrap();
    let count: i64 = stmt.query_map([], |_| Ok(1)).unwrap().count() as i64;
    assert_eq!(count, 1, "DuckDB regexp_matches must match pattern");

    // Shorthand 3.6: IN with empty list (must evaluate to 1=0 and return 0 rows)
    let q_in_empty = QueryRep::Filter {
        fexp: FilterExp::Single(SubExp::BinRel(BinRelExp {
            exp_type: "BinRelExp".to_string(),
            op: "IN".to_string(),
            lhs: ValExp::Typed(TypedValExp::ColRef {
                col_name: "select".to_string(),
                tbl_alias: None,
            }),
            rhs: ValExp::Literal(json!([])),
        })),
        from: Box::new(QueryRep::Table { table_name: "keyword_cols".to_string() }),
    };
    let sql_in_empty = QueryExpCompiler::compile(&q_in_empty, None, None).unwrap();
    println!("[EVIDENCE] IN with empty list generated SQL: {}", sql_in_empty);
    assert!(sql_in_empty.contains("WHERE 1=0"), "Empty IN must compile to 1=0 predicate");
    let mut stmt_in_empty = conn.prepare(&sql_in_empty).expect("DuckDB must prepare 1=0 query successfully");
    let count_in_empty: i64 = stmt_in_empty.query_map([], |_| Ok(1)).unwrap().count() as i64;
    assert_eq!(count_in_empty, 0, "Empty IN (1=0) must return exactly 0 rows");

    // Shorthand 3.7: NOTIN with empty list (must evaluate to 1=1 and return all rows)
    let q_notin_empty = QueryRep::Filter {
        fexp: FilterExp::Single(SubExp::BinRel(BinRelExp {
            exp_type: "BinRelExp".to_string(),
            op: "NOTIN".to_string(),
            lhs: ValExp::Typed(TypedValExp::ColRef {
                col_name: "select".to_string(),
                tbl_alias: None,
            }),
            rhs: ValExp::Literal(json!([])),
        })),
        from: Box::new(QueryRep::Table { table_name: "keyword_cols".to_string() }),
    };
    let sql_notin_empty = QueryExpCompiler::compile(&q_notin_empty, None, None).unwrap();
    println!("[EVIDENCE] NOTIN with empty list generated SQL: {}", sql_notin_empty);
    assert!(sql_notin_empty.contains("WHERE 1=1"), "Empty NOTIN must compile to 1=1 predicate");
    let mut stmt_notin_empty = conn.prepare(&sql_notin_empty).expect("DuckDB must prepare 1=1 query successfully");
    let count_notin_empty: i64 = stmt_notin_empty.query_map([], |_| Ok(1)).unwrap().count() as i64;
    assert_eq!(count_notin_empty, 1, "Empty NOTIN (1=1) must return all table rows");
}

// ============================================================================
// CHALLENGE 4: AGGREGATE EMULATIONS EMPIRICAL TEST (UNIQ, NULL)
// ============================================================================

#[test]
fn adv_test_uniq_and_null_aggregate_emulation_execution() {
    let conn = create_in_memory_duckdb();

    conn.execute_batch(
        r#"
        CREATE TABLE agg_cases (
            grp VARCHAR,
            str_val VARCHAR,
            num_val INTEGER
        );
        INSERT INTO agg_cases VALUES
            ('identical', 'Active', 10),
            ('identical', 'Active', 10),
            ('mixed', 'Active', 10),
            ('mixed', 'Inactive', 20),
            ('all_null', NULL, NULL),
            ('all_null', NULL, NULL),
            ('single_with_null', 'OnlyOne', 50),
            ('single_with_null', NULL, NULL);
        "#,
    )
    .expect("Failed to create agg_cases table");

    let q_table = QueryRep::Table {
        table_name: "agg_cases".to_string(),
    };

    let q_group = QueryRep::GroupBy {
        cols: vec!["grp".to_string()],
        aggs: vec![
            AggColSpec::Object {
                fn_name: "uniq".to_string(),
                col: "str_val".to_string(),
                as_name: Some("uniq_str".to_string()),
            },
            AggColSpec::Object {
                fn_name: "uniq".to_string(),
                col: "num_val".to_string(),
                as_name: Some("uniq_num".to_string()),
            },
            AggColSpec::Object {
                fn_name: "null".to_string(),
                col: "str_val".to_string(),
                as_name: Some("null_emulated".to_string()),
            },
        ],
        from: Box::new(q_table),
    };

    let sql = QueryExpCompiler::compile(&q_group, None, None).unwrap();
    let mut stmt = conn.prepare(&sql).unwrap();

    struct AggRow {
        grp: String,
        uniq_str: Option<String>,
        uniq_num: Option<i32>,
        null_emulated: Option<String>,
    }

    let rows: Vec<AggRow> = stmt
        .query_map([], |row| {
            Ok(AggRow {
                grp: row.get(0)?,
                uniq_str: row.get(1)?,
                uniq_num: row.get(2)?,
                null_emulated: row.get(3)?,
            })
        })
        .unwrap()
        .map(|r| r.unwrap())
        .collect();

    for r in &rows {
        assert!(
            r.null_emulated.is_none(),
            "null aggregate must always return NULL"
        );

        match r.grp.as_str() {
            "identical" => {
                assert_eq!(
                    r.uniq_str.as_deref(),
                    Some("Active"),
                    "All identical str_val must return 'Active'"
                );
                assert_eq!(
                    r.uniq_num,
                    Some(10),
                    "All identical num_val must return 10"
                );
            }
            "mixed" => {
                assert_eq!(
                    r.uniq_str, None,
                    "Mixed str_val ('Active' != 'Inactive') must return NULL"
                );
                assert_eq!(
                    r.uniq_num, None,
                    "Mixed num_val (10 != 20) must return NULL"
                );
            }
            "all_null" => {
                assert_eq!(
                    r.uniq_str, None,
                    "All null group must return NULL"
                );
                assert_eq!(
                    r.uniq_num, None,
                    "All null group must return NULL"
                );
            }
            "single_with_null" => {
                assert_eq!(
                    r.uniq_str.as_deref(),
                    Some("OnlyOne"),
                    "Single non-null with nulls must return the single non-null value"
                );
                assert_eq!(
                    r.uniq_num,
                    Some(50),
                    "Single non-null num with nulls must return 50"
                );
            }
            other => panic!("Unexpected grp: {}", other),
        }
    }
}

// ============================================================================
// CHALLENGE 5: FAST PARQUET METADATA COUNT VS STANDARD DUCKDB COUNT(*)
// ============================================================================

#[test]
fn adv_test_fast_parquet_metadata_count_performance_and_parity() {
    let temp_dir = std::env::temp_dir().join("toad_test_parquet_fast_count");
    let _ = std::fs::create_dir_all(&temp_dir);
    let parquet_path = temp_dir.join("multi_rg_bench.parquet");

    let total_rows_expected = 12000;
    let conn_gen = create_in_memory_duckdb();
    let norm_path = parquet_path.to_str().unwrap().replace('\\', "/");
    conn_gen
        .execute_batch(&format!(
            r#"
            COPY (
                SELECT i::INTEGER AS row_id, 'tag_' || i AS tag
                FROM range(0, 12000) t(i)
            ) TO '{}' (FORMAT PARQUET, ROW_GROUP_SIZE 3000);
            "#,
            norm_path
        ))
        .expect("Failed to generate test parquet file via DuckDB");

    // 2. Benchmark FastCounter::count_parquet_rows (O(1) footer read)
    let warmup = FastCounter::count_parquet_rows(&parquet_path).unwrap();
    assert_eq!(warmup, total_rows_expected as i64);

    let iterations = 100;
    let start = Instant::now();
    for _ in 0..iterations {
        let count = FastCounter::count_parquet_rows(&parquet_path).unwrap();
        assert_eq!(count, total_rows_expected as i64);
    }
    let elapsed = start.elapsed();
    let avg_us = elapsed.as_micros() as f64 / iterations as f64;

    println!(
        "[BENCHMARK] FastCounter::count_parquet_rows: {} iterations in {:?}, avg = {:.2} µs ({:.3} ms)",
        iterations, elapsed, avg_us, avg_us / 1000.0
    );

    // Sub-millisecond requirement: avg < 1,000 µs (1 ms)
    assert!(
        avg_us < 1000.0,
        "Fast Parquet metadata count must execute in < 1ms, got {:.2} µs",
        avg_us
    );

    // 3. Parity with standard DuckDB COUNT(*) query
    let conn = create_in_memory_duckdb();
    let sql_standard = format!(
        "SELECT COUNT(*)::BIGINT FROM read_parquet('{}')",
        parquet_path.to_str().unwrap().replace('\\', "/")
    );
    let mut stmt = conn.prepare(&sql_standard).unwrap();
    let duckdb_count: i64 = stmt.query_row([], |row| row.get(0)).unwrap();

    assert_eq!(
        duckdb_count, total_rows_expected as i64,
        "DuckDB standard count must match exactly"
    );

    // 4. Inspect DuckDB parquet_metadata behavior
    let sql_raw_metadata = format!(
        "SELECT row_group_id, column_id, row_group_num_rows FROM parquet_metadata('{}')",
        parquet_path.to_str().unwrap().replace('\\', "/")
    );
    let mut stmt_meta = conn.prepare(&sql_raw_metadata).unwrap();
    let meta_rows: Vec<(i64, i64, i64)> = stmt_meta
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();

    println!("[EVIDENCE] parquet_metadata returned {} rows:", meta_rows.len());
    for (rg_id, col_id, rows) in &meta_rows {
        println!("   rg_id: {}, col_id: {}, num_rows: {}", rg_id, col_id, rows);
    }

    let sql_col0 = format!(
        "SELECT COALESCE(SUM(row_group_num_rows), 0) AS total_rows FROM parquet_metadata('{}') WHERE column_id = 0",
        parquet_path.to_str().unwrap().replace('\\', "/")
    );
    let mut stmt_col0 = conn.prepare(&sql_col0).unwrap();
    let col0_count: i64 = stmt_col0.query_row([], |row| row.get(0)).unwrap();
    println!("[EVIDENCE] With 'WHERE column_id = 0': {}", col0_count);
    assert_eq!(col0_count, total_rows_expected as i64);

    // Verify that QueryExpCompiler::fast_parquet_count accurately returns the true row count:
    let sql_fast = QueryExpCompiler::fast_parquet_count(parquet_path.to_str().unwrap());
    let mut stmt_fast = conn.prepare(&sql_fast).unwrap();
    let fast_count: i64 = stmt_fast.query_row([], |row| row.get(0)).unwrap();
    println!("[EVIDENCE] QueryExpCompiler::fast_parquet_count output: {}", fast_count);
    assert_eq!(
        fast_count, total_rows_expected as i64,
        "QueryExpCompiler::fast_parquet_count must match exact total rows without column multiplication"
    );

    // 5. Test Error Handling on non-existent file
    let bad_path = PathBuf::from("C:\\nonexistent_file_toad_12345.parquet");
    let err_res = FastCounter::count_parquet_rows(&bad_path);
    assert!(err_res.is_err(), "Must return error on nonexistent file");

    // Clean up
    let _ = std::fs::remove_dir_all(&temp_dir);
}
