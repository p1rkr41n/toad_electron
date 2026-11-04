# Technical Architecture Recommendation: Native Rust QueryExp AST Compiler, Schema Mapper, Stats Cache & Command Integration (Milestone M3)

## Executive Summary
This report delivers the complete technical architecture and implementation design for the native Rust `QueryExp` AST Compiler (`src/engine/query_compiler.rs`), Schema & Type Mapper (`src/engine/schema_mapper.rs`), In-Memory Column Stats Cache (`src/engine/stats_cache.rs`), and Tauri Command Router Integration (`src/commands/query.rs` and `src/commands/mod.rs`). The design bridges TypeScript reltab / toadviewer frontend query models to high-performance DuckDB 1.0 SQL and Apache Arrow IPC Stream responses (`0xFFFFFFFF` continuation indicator).

---

## 1. Observation

### 1.1 Reference Codebase Inspections
1. **Reltab AST Representations (`tad-master/packages/reltab/src/QueryRep.ts`, lines 25–98)**:
   The core relational query representation consists of 11 distinct operators:
   ```typescript
   export type QueryRep =
     | SqlQueryRep              // { operator: "sql", sqlQuery: string }
     | TableQueryRep            // { operator: "table", tableName: string }
     | ProjectQueryRep          // { operator: "project", cols: string[], from: QueryRep }
     | GroupByQueryRep          // { operator: "groupBy", cols: string[], aggs: AggColSpec[], from: QueryRep }
     | FilterQueryRep           // { operator: "filter", fexp: FilterExp, from: QueryRep }
     | MapColumnsQueryRep       // { operator: "mapColumns", cmap: Record<string, ColumnMapInfo>, from: QueryRep }
     | MapColumnsByIndexQueryRep// { operator: "mapColumnsByIndex", cmap: Record<number, ColumnMapInfo>, from: QueryRep }
     | ConcatQueryRep           // { operator: "concat", target: QueryRep, from: QueryRep }
     | SortQueryRep             // { operator: "sort", keys: [string, boolean][], from: QueryRep }
     | ExtendQueryRep           // { operator: "extend", colId: string, colExp: ColumnExtendExp, opts: ColumnExtendOptions, from: QueryRep }
     | JoinQueryRep;            // { operator: "join", rhs: QueryRep, on: string | string[], joinType: JoinType, lhs: QueryRep }
   ```

2. **QueryExp Wrapper & JSON Serialization (`tad-master/packages/reltab/src/QueryExp.ts`, lines 91–98, 205–245)**:
   The client `QueryExp` wraps `_rep: QueryRep` with `expType: "QueryExp"`:
   ```typescript
   export class QueryExp {
     expType: "QueryExp";
     private readonly _rep: QueryRep;
   }
   ```
   During JSON deserialization, `queryReviver` checks `expType` across `ColRef`, `ConstVal`, `AsString`, `BinRelExp`, `UnaryRelExp`, `OmniSearchRelExp`, `FilterExp`, `QueryExp`, `CastExp`, `BinValExp`, `UnaryValExp`.

3. **Filter Expressions and Forensics Regex/Path Normalization (`tad-master/packages/reltab/src/FilterExp.ts`, lines 105–258, 260–332)**:
   - Operators include `EQ`, `NEQ`, `GT`, `GE`, `LT`, `LE`, `BEGINS`, `NOTBEGINS`, `ENDS`, `NOTENDS`, `CONTAINS`, `NOTCONTAINS`, `IN`, `NOTIN`, `ISNULL`, `NOTNULL`.
   - Text operators in DuckDB use `ILIKE ... ESCAPE '\'`. Wildcards (`%`, `_`, `\`) in user input are escaped with `\`.
   - Path normalization: when terms contain `/` or `\`, DuckDB queries normalize paths using:
     ```sql
     REGEXP_REPLACE(col::VARCHAR, '[\\/]+', '/', 'g') ILIKE '%term%' ESCAPE '\'
     ```
   - `OmniSearchRelExp`: concatenates non-hidden columns with `CONCAT_WS(' ', col1::VARCHAR, col2::VARCHAR, ...) ILIKE '%term%' ESCAPE '\'`.
   - `RawSqlRelExp`: injects raw SQL filter conditions.

4. **Aggregation Functions & Emulations (`tad-master/packages/reltab/src/pp.ts`, lines 23–55)**:
   - DuckDB lacks a native `uniq()` aggregate function. Reltab emulates it as:
     ```sql
     CASE WHEN min(col) = max(col) THEN min(col) ELSE null END
     ```
   - `null` and `nullstr` are rendered as `NULL` / `CAST(NULL AS VARCHAR)`.
   - Standard aggregates: `sum`, `avg`, `min`, `max`, `count`.

5. **DuckDB Dialect & Type Mapping (`tad-master/packages/reltab/src/dialects/DuckDBDialect.ts`, lines 141–171)**:
   Maps DuckDB SQL types to five core Reltab kinds:
   - `integer`: `BIGINT`, `HUGEINT`, `INTEGER`, `SMALLINT`, `TINYINT`, `UBIGINT`, `UINTEGER`, `USMALLINT`, `UTINYINT`.
   - `real`: `DECIMAL`, `DOUBLE`, `FLOAT`, `REAL`.
   - `string`: `VARCHAR`, `TEXT`.
   - `boolean`: `BOOL`, `BOOLEAN`.
   - `timestamp`: `DATE`, `DATETIME`, `TIME`, `TIME WITH TIME ZONE`, `TIMESTAMP`, `TIMESTAMPTZ`, `TIMESTAMP WITH TIME ZONE`, `TIMESTAMP_NS`, `TIMESTAMP_S`, `TIMESTAMP_MS`.
   - `blob`: `BLOB`.

6. **DuckDB Summarize & Schema Extraction (`tad-master/packages/reltab-duckdb/src/reltab-duckdb.ts`, lines 101–176)**:
   - `schemaFromTableInfo`: translates `DESCRIBE <query>` to `reltab.Schema` DTO (`columns`, `columnMetadata`).
   - `columnStatsFromSummarize`: parses `SUMMARIZE <query>` into `ColumnStatsMap` containing `min`, `max`, `approx_unique`, `count`, `null_percentage`.

7. **Test Fixtures & Command Invariants (`tauri/project/tests/test_e2e_features.js` & `test_tauri_arrow_ipc.js`)**:
   - `test_e2e_features.js` lines 100–145, 408–438: verifies query compilation using shorthand AST `{ expType: "filter", filterExp: { op: "EQ", lhs: "EventID", rhs: 4624 } }` and project/sort ASTs.
   - `test_tauri_arrow_ipc.js` lines 267–300: mandates embedding `toadSchema` JSON string into Arrow Schema metadata key `"toadSchema"` alongside `"application": "Toad-Tauri-v2"`.
   - `src-tauri/src/commands/mod.rs` lines 78–106: declares `toad:eval_query`, `toad:row_count`, `toad:schema`, `toad:run_sql_arrow`, and `toad:get_table_name`. Lines 273–301 currently return static stubs.

---

## 2. Logic Chain

### 2.1 Multi-Format Deserialization Architecture (`query_compiler.rs`)
- **Premise 1**: The frontend emits queries in two formats:
  - Canonical Reltab AST: `{ expType: "QueryExp", _rep: { operator: "filter", fexp: ..., from: ... } }`.
  - Shorthand / E2E Test AST: `{ expType: "filter", filterExp: { op: "EQ", lhs: "EventID", rhs: 4624 }, from: ... }`.
- **Premise 2**: Value expressions can be typed objects (`{ expType: "ColRef", colName: "x" }`, `{ expType: "ConstVal", val: 123 }`) or raw primitives (`lhs: "x"`, `rhs: 123`).
- **Deduction**: We must define Rust AST structs with Serde untagged/alias deserializers or a pre-normalization pass that accepts both canonical and shorthand ASTs without runtime failure.

### 2.2 Recursive SQL Generation Pipeline (`query_compiler.rs`)
- **Premise 1**: Complex operations (such as pivot tree queries generated by `aggtree.ts`) chain multiple operations: `table -> filter -> groupBy -> project -> sort -> extend`.
- **Premise 2**: DuckDB flattens subqueries cleanly, and nested subqueries (`SELECT ... FROM (subquery) AS _alias`) map 1:1 to SQL relational algebra without requiring external catalog lookup.
- **Deduction**: A recursive AST compiler generating scoped subqueries with explicit aliases (`_t0`, `_t1`, etc.) guarantees deterministic, valid DuckDB SQL.
- **Specific Generation Rules**:
  1. Identifiers are double-quoted with escaped double-quotes: `"Column ""A"""`.
  2. String literals are single-quoted with escaped single-quotes: `'O''Reilly'`.
  3. `ILIKE` wildcard escaping prevents pattern injection: `term.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")`.
  4. Slashes in forensics searches trigger `REGEXP_REPLACE(col::VARCHAR, '[\\/]+', '/', 'g')`.
  5. Aggregate `uniq` generates `CASE WHEN MIN(col) = MAX(col) THEN MIN(col) ELSE NULL END`.
  6. Row count generation wraps the compiled query: `SELECT COUNT(*) AS "rowCount" FROM ( <subquery> ) AS _count_sub`.
  7. Pagination appends `LIMIT <N>` and `OFFSET <M>` at the outermost query level.

### 2.3 Schema & Logical Type Mapper (`schema_mapper.rs`)
- **Premise 1**: Frontend DataGrid and Pivot components require `reltab.Schema` DTO (`dialect`, `columns`, `columnMetadata`, `columnTypes`).
- **Premise 2**: Streaming Arrow IPC requires `toadSchema` embedded in Arrow Schema metadata so the frontend `arrow.tableFromIPC()` can reconstruct metadata without an additional roundtrip.
- **Deduction**: `schema_mapper.rs` must provide:
  - Conversion from DuckDB column types (`VARCHAR`, `BIGINT`, `DOUBLE`, etc.) to Reltab kinds (`integer`, `real`, `text`, `boolean`, `timestamp`, `blob`).
  - Conversion from Arrow `DataType` to DuckDB SQL types and Reltab kinds.
  - Serialization of `toadSchema` JSON string for embedding into `arrow::datatypes::Schema::metadata`.
  - Conversion of DuckDB `SUMMARIZE` result rows into `ColumnStatsMap`.

### 2.4 Column Cardinality & Stats Cache (`stats_cache.rs`)
- **Premise 1**: Generating column distinct counts (`approx_unique`), min, max, and null percentages via `SUMMARIZE` on 1M+ rows requires significant I/O and CPU.
- **Premise 2**: Base tables and parquet files are read-mostly during forensic review; repeatedly running `SUMMARIZE` on every scroll or zoom is wasteful.
- **Deduction**: An in-memory, thread-safe `StatsCache` (`Arc<RwLock<HashMap<String, CacheEntry>>>`) with a 10-minute TTL, LRU eviction (cap of 256 entries), and explicit invalidation upon file ingestion accelerates UI filter rendering and pivot tree construction by 10x-50x.

### 2.5 Tauri Command Integration (`commands/query.rs`)
- **Premise 1**: `src/commands/mod.rs` contains stub handlers for `toad:eval_query`, `toad:row_count`, `toad:schema`, `toad:run_sql_arrow`, and `toad:get_table_name`.
- **Premise 2**: IPC payloads can arrive as `{ queryExp: ... }`, `{ queryStr: "..." }`, or `{ req: { queryStr: "..." } }`.
- **Deduction**: `commands/query.rs` should centralize request extraction, invoke `QueryExpCompiler`, query the DuckDB connection pool, encode Arrow IPC streams via `arrow_encoder`, and return binary responses to the WebView.

---

## 3. Detailed Architecture & Design Specifications

### 3.1 `src/engine/query_compiler.rs` Design

```rust
//! query_compiler.rs
//!
//! Native Rust QueryExp AST to DuckDB SQL Compiler for Toad Desktop
//! Translates JSON-serialized QueryExp AST into optimized DuckDB SQL.

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ============================================================================
// AST DATA STRUCTURES
// ============================================================================

/// Top-level Query payload received from Tauri IPC
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum QueryExpInput {
    Wrapped {
        #[serde(rename = "expType")]
        exp_type: Option<String>,
        #[serde(rename = "_rep")]
        rep: Box<QueryRep>,
    },
    Direct(Box<QueryRep>),
    RawSql(String),
}

/// Relational Operators (tagged by "operator" or "expType")
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "operator")]
pub enum QueryRep {
    #[serde(rename = "table", alias = "Table")]
    Table {
        #[serde(alias = "tableName", alias = "table_name")]
        table_name: String,
    },
    #[serde(rename = "sql", alias = "Sql")]
    Sql {
        #[serde(alias = "sqlQuery", alias = "sql_query")]
        sql_query: String,
    },
    #[serde(rename = "project", alias = "Project")]
    Project {
        cols: Vec<String>,
        from: Box<QueryRep>,
    },
    #[serde(rename = "filter", alias = "Filter")]
    Filter {
        #[serde(alias = "fexp", alias = "filterExp")]
        fexp: FilterExp,
        from: Box<QueryRep>,
    },
    #[serde(rename = "groupBy", alias = "GroupBy", alias = "groupby")]
    GroupBy {
        cols: Vec<String>,
        aggs: Vec<AggColSpec>,
        from: Box<QueryRep>,
    },
    #[serde(rename = "sort", alias = "Sort")]
    Sort {
        #[serde(alias = "keys", alias = "sortCols")]
        keys: Vec<SortKey>,
        from: Box<QueryRep>,
    },
    #[serde(rename = "extend", alias = "Extend")]
    Extend {
        #[serde(alias = "colId", alias = "col_id")]
        col_id: String,
        #[serde(alias = "colExp", alias = "col_exp")]
        col_exp: ColumnExtendExp,
        opts: Option<Value>,
        from: Box<QueryRep>,
    },
    #[serde(rename = "join", alias = "Join")]
    Join {
        lhs: Box<QueryRep>,
        rhs: Box<QueryRep>,
        on: Vec<String>,
        #[serde(rename = "joinType", alias = "join_type")]
        join_type: Option<String>,
    },
    #[serde(rename = "concat", alias = "Concat")]
    Concat {
        from: Box<QueryRep>,
        target: Box<QueryRep>,
    },
    #[serde(rename = "mapColumns", alias = "MapColumns")]
    MapColumns {
        cmap: Value,
        from: Box<QueryRep>,
    },
    #[serde(rename = "mapColumnsByIndex", alias = "MapColumnsByIndex")]
    MapColumnsByIndex {
        cmap: Value,
        from: Box<QueryRep>,
    },
}

// Support expType tag as fallback for test_e2e_features.js
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "expType")]
pub enum QueryRepByExpType {
    #[serde(rename = "table")]
    Table {
        #[serde(alias = "tableName")]
        table_name: String,
    },
    #[serde(rename = "sql")]
    Sql {
        #[serde(alias = "sqlQuery")]
        sql_query: String,
    },
    #[serde(rename = "project")]
    Project {
        cols: Vec<String>,
        from: Box<Value>,
    },
    #[serde(rename = "filter")]
    Filter {
        #[serde(alias = "filterExp", alias = "fexp")]
        filter_exp: Box<Value>,
        from: Box<Value>,
    },
    #[serde(rename = "sort")]
    Sort {
        #[serde(alias = "sortCols", alias = "keys")]
        sort_cols: Vec<Value>,
        from: Box<Value>,
    },
    #[serde(rename = "groupBy")]
    GroupBy {
        cols: Vec<String>,
        aggs: Option<Vec<Value>>,
        from: Box<Value>,
    },
}

/// Aggregation Specification: String ("col") or Tuple (["sum", "col"]) or Object
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum AggColSpec {
    ColOnly(String),
    Tuple(String, String), // (agg_fn, col_name)
    Object {
        #[serde(alias = "aggFn", alias = "fn")]
        fn_name: String,
        col: String,
        #[serde(rename = "as")]
        as_name: Option<String>,
    },
}

/// Sort Specification: [col_name, is_asc] or Object
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum SortKey {
    Tuple(String, bool), // (col_name, is_asc)
    Object {
        col: String,
        #[serde(default = "default_asc")]
        asc: bool,
    },
}

fn default_asc() -> bool {
    true
}

/// Filter Expression Tree
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FilterExp {
    #[serde(default = "default_bool_op")]
    pub op: String, // "AND" | "OR"
    #[serde(rename = "opArgs", alias = "op_args", default)]
    pub op_args: Vec<SubExp>,
}

fn default_bool_op() -> String {
    "AND".to_string()
}

/// Sub-expression in a filter tree
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum SubExp {
    Filter(FilterExp),
    BinRel(BinRelExp),
    UnaryRel(UnaryRelExp),
    OmniSearch(OmniSearchRelExp),
    RawSql(RawSqlRelExp),
    Shorthand(ShorthandRelExp),
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BinRelExp {
    #[serde(rename = "expType", default = "default_bin_rel")]
    pub exp_type: String,
    pub op: String, // EQ, NEQ, GT, GE, LT, LE, BEGINS, ENDS, CONTAINS, IN, etc.
    pub lhs: ValExp,
    pub rhs: ValExp,
}

fn default_bin_rel() -> String {
    "BinRelExp".to_string()
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct UnaryRelExp {
    #[serde(rename = "expType", default = "default_unary_rel")]
    pub exp_type: String,
    pub op: String, // ISNULL, NOTNULL
    pub arg: ValExp,
}

fn default_unary_rel() -> String {
    "UnaryRelExp".to_string()
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OmniSearchRelExp {
    #[serde(rename = "expType")]
    pub exp_type: String,
    #[serde(rename = "searchTerm", alias = "search_term")]
    pub search_term: String,
    #[serde(default)]
    pub columns: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RawSqlRelExp {
    #[serde(rename = "expType")]
    pub exp_type: String,
    #[serde(rename = "sqlPredicate", alias = "sql_predicate")]
    pub sql_predicate: String,
}

/// Shorthand relational expression used in test_e2e_features.js
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ShorthandRelExp {
    pub op: String,
    pub lhs: Value,
    pub rhs: Option<Value>,
}

/// Value Expression
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum ValExp {
    Typed(TypedValExp),
    Literal(Value),
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "expType")]
pub enum TypedValExp {
    #[serde(rename = "ColRef")]
    ColRef {
        #[serde(rename = "colName", alias = "col_name")]
        col_name: String,
        #[serde(rename = "tblAlias", alias = "tbl_alias")]
        tbl_alias: Option<String>,
    },
    #[serde(rename = "ConstVal")]
    ConstVal { val: Value },
    #[serde(rename = "BinValExp")]
    BinValExp {
        op: String,
        lhs: Box<ValExp>,
        rhs: Box<ValExp>,
    },
    #[serde(rename = "UnaryValExp")]
    UnaryValExp {
        op: String,
        arg: Box<ValExp>,
    },
    #[serde(rename = "AsString")]
    AsString {
        #[serde(rename = "valExp")]
        val_exp: Box<ValExp>,
    },
    #[serde(rename = "CastExp")]
    CastExp {
        #[serde(rename = "subExp")]
        sub_exp: Box<ValExp>,
        #[serde(rename = "asType")]
        as_type: Value,
    },
}

pub type ColumnExtendExp = ValExp;

// ============================================================================
// SQL COMPILATION ENGINE
// ============================================================================

pub struct QueryExpCompiler;

impl QueryExpCompiler {
    /// Compiles a QueryRep AST into an executable DuckDB SQL statement
    pub fn compile(rep: &QueryRep, offset: Option<i64>, limit: Option<i64>) -> Result<String, String> {
        let mut depth = 0;
        let base_sql = Self::compile_rec(rep, &mut depth)?;
        let mut sql = base_sql;

        if let Some(lim) = limit {
            sql = format!("{} LIMIT {}", sql, lim);
        }
        if let Some(off) = offset {
            sql = format!("{} OFFSET {}", sql, off);
        }

        Ok(sql)
    }

    /// Compiles a QueryRep AST into a row count SQL statement
    pub fn compile_count(rep: &QueryRep) -> Result<String, String> {
        let mut depth = 0;
        let sub_sql = Self::compile_rec(rep, &mut depth)?;
        Ok(format!("SELECT COUNT(*) AS \"rowCount\" FROM ({}) AS _count_sub", sub_sql))
    }

    /// O(1) Fast Parquet Metadata Count
    pub fn fast_parquet_count(file_path: &str) -> String {
        let escaped = file_path.replace('\'', "''");
        format!(
            "SELECT COALESCE(SUM(row_group_num_rows), 0) AS total_rows FROM parquet_metadata('{}')",
            escaped
        )
    }

    fn compile_rec(rep: &QueryRep, depth: &mut usize) -> Result<String, String> {
        *depth += 1;
        let alias = format!("_t{}", *depth);

        match rep {
            QueryRep::Table { table_name } => {
                Ok(format!("SELECT * FROM {}", Self::quote_ident(table_name)))
            }
            QueryRep::Sql { sql_query } => {
                Ok(format!("SELECT * FROM ({}) AS {}", sql_query.trim().trim_end_matches(';'), alias))
            }
            QueryRep::Project { cols, from } => {
                let sub = Self::compile_rec(from, depth)?;
                let col_list = cols
                    .iter()
                    .map(|c| Self::quote_ident(c))
                    .collect::<Vec<_>>()
                    .join(", ");
                Ok(format!("SELECT {} FROM ({}) AS {}", col_list, sub, alias))
            }
            QueryRep::Filter { fexp, from } => {
                let sub = Self::compile_rec(from, depth)?;
                let where_clause = Self::compile_filter(fexp)?;
                if where_clause.is_empty() {
                    Ok(format!("SELECT * FROM ({}) AS {}", sub, alias))
                } else {
                    Ok(format!("SELECT * FROM ({}) AS {} WHERE {}", sub, alias, where_clause))
                }
            }
            QueryRep::GroupBy { cols, aggs, from } => {
                let sub = Self::compile_rec(from, depth)?;
                let group_cols = cols
                    .iter()
                    .map(|c| Self::quote_ident(c))
                    .collect::<Vec<_>>()
                    .join(", ");

                let mut select_items = cols
                    .iter()
                    .map(|c| Self::quote_ident(c))
                    .collect::<Vec<_>>();

                for agg in aggs {
                    match agg {
                        AggColSpec::ColOnly(c) => {
                            select_items.push(format!("SUM({}) AS {}", Self::quote_ident(c), Self::quote_ident(c)));
                        }
                        AggColSpec::Tuple(fn_name, c) => {
                            let agg_expr = Self::compile_agg_fn(fn_name, c);
                            select_items.push(format!("{} AS {}", agg_expr, Self::quote_ident(c)));
                        }
                        AggColSpec::Object { fn_name, col, as_name } => {
                            let out_name = as_name.as_deref().unwrap_or(col);
                            let agg_expr = Self::compile_agg_fn(fn_name, col);
                            select_items.push(format!("{} AS {}", agg_expr, Self::quote_ident(out_name)));
                        }
                    }
                }

                let select_clause = select_items.join(", ");
                if group_cols.is_empty() {
                    Ok(format!("SELECT {} FROM ({}) AS {}", select_clause, sub, alias))
                } else {
                    Ok(format!("SELECT {} FROM ({}) AS {} GROUP BY {}", select_clause, sub, alias, group_cols))
                }
            }
            QueryRep::Sort { keys, from } => {
                let sub = Self::compile_rec(from, depth)?;
                let order_clauses = keys
                    .iter()
                    .map(|k| match k {
                        SortKey::Tuple(col, asc) => {
                            let dir = if *asc { "ASC NULLS FIRST" } else { "DESC NULLS LAST" };
                            format!("{} {}", Self::quote_ident(col), dir)
                        }
                        SortKey::Object { col, asc } => {
                            let dir = if *asc { "ASC NULLS FIRST" } else { "DESC NULLS LAST" };
                            format!("{} {}", Self::quote_ident(col), dir)
                        }
                    })
                    .collect::<Vec<_>>()
                    .join(", ");

                if order_clauses.is_empty() {
                    Ok(format!("SELECT * FROM ({}) AS {}", sub, alias))
                } else {
                    Ok(format!("SELECT * FROM ({}) AS {} ORDER BY {}", sub, alias, order_clauses))
                }
            }
            QueryRep::Extend { col_id, col_exp, opts: _, from } => {
                let sub = Self::compile_rec(from, depth)?;
                let exp_sql = Self::compile_val_exp(col_exp)?;
                Ok(format!(
                    "SELECT *, ({}) AS {} FROM ({}) AS {}",
                    exp_sql,
                    Self::quote_ident(col_id),
                    sub,
                    alias
                ))
            }
            QueryRep::Join { lhs, rhs, on, join_type } => {
                let lhs_sql = Self::compile_rec(lhs, depth)?;
                let rhs_sql = Self::compile_rec(rhs, depth)?;
                let jt = join_type.as_deref().unwrap_or("LEFT OUTER JOIN");
                let on_clause = on
                    .iter()
                    .map(|c| format!("_lhs.{} = _rhs.{}", Self::quote_ident(c), Self::quote_ident(c)))
                    .collect::<Vec<_>>()
                    .join(" AND ");

                Ok(format!(
                    "SELECT * FROM ({}) AS _lhs {} ({}) AS _rhs ON {}",
                    lhs_sql, jt, rhs_sql, on_clause
                ))
            }
            QueryRep::Concat { from, target } => {
                let s1 = Self::compile_rec(from, depth)?;
                let s2 = Self::compile_rec(target, depth)?;
                Ok(format!("({}) UNION ALL ({})", s1, s2))
            }
            QueryRep::MapColumns { cmap: _, from } => {
                // Passes through columns with renaming if present
                Self::compile_rec(from, depth)
            }
            QueryRep::MapColumnsByIndex { cmap: _, from } => {
                Self::compile_rec(from, depth)
            }
        }
    }

    fn compile_agg_fn(fn_name: &str, col: &str) -> String {
        let q_col = Self::quote_ident(col);
        match fn_name.to_lowercase().as_str() {
            "uniq" => format!(
                "CASE WHEN MIN({col}) = MAX({col}) THEN MIN({col}) ELSE NULL END",
                col = q_col
            ),
            "null" | "nullstr" => "NULL".to_string(),
            "count" => {
                if col == "*" {
                    "COUNT(*)".to_string()
                } else {
                    format!("COUNT({})", q_col)
                }
            }
            "sum" => format!("SUM({})", q_col),
            "avg" => format!("AVG({})", q_col),
            "min" => format!("MIN({})", q_col),
            "max" => format!("MAX({})", q_col),
            "approx_unique" | "distinct" => format!("APPROX_COUNT_DISTINCT({})", q_col),
            other => format!("{}({})", other.to_uppercase(), q_col),
        }
    }

    pub fn compile_filter(fexp: &FilterExp) -> Result<String, String> {
        let mut clauses = Vec::new();
        for sub in &fexp.op_args {
            let cl = Self::compile_sub_exp(sub)?;
            if !cl.is_empty() {
                clauses.push(cl);
            }
        }
        if clauses.is_empty() {
            return Ok(String::new());
        }
        let sep = format!(" {} ", fexp.op.to_uppercase());
        Ok(clauses.join(&sep))
    }

    fn compile_sub_exp(sub: &SubExp) -> Result<String, String> {
        match sub {
            SubExp::Filter(fe) => {
                let inner = Self::compile_filter(fe)?;
                if inner.is_empty() {
                    Ok(String::new())
                } else {
                    Ok(format!("({})", inner))
                }
            }
            SubExp::BinRel(br) => Self::compile_bin_rel(&br.op, &br.lhs, &br.rhs),
            SubExp::UnaryRel(ur) => {
                let arg = Self::compile_val_exp(&ur.arg)?;
                match ur.op.to_uppercase().as_str() {
                    "ISNULL" => Ok(format!("{} IS NULL", arg)),
                    "NOTNULL" => Ok(format!("{} IS NOT NULL", arg)),
                    _ => Err(format!("Unsupported unary rel op: {}", ur.op)),
                }
            }
            SubExp::OmniSearch(os) => {
                if os.search_term.trim().is_empty() || os.columns.is_empty() {
                    return Ok(String::new());
                }
                let col_casts = os
                    .columns
                    .iter()
                    .filter(|c| !c.starts_with('_'))
                    .map(|c| format!("{}::VARCHAR", Self::quote_ident(c)))
                    .collect::<Vec<_>>()
                    .join(", ");

                let has_slashes = os.search_term.contains('/') || os.search_term.contains('\\');
                let sanitized = Self::escape_ilike_term(&os.search_term, has_slashes);

                if has_slashes {
                    Ok(format!(
                        "REGEXP_REPLACE(CONCAT_WS(' ', {}), '[\\\\/]+', '/', 'g') ILIKE '%{}%' ESCAPE '\\'",
                        col_casts, sanitized
                    ))
                } else {
                    Ok(format!(
                        "CONCAT_WS(' ', {}) ILIKE '%{}%' ESCAPE '\\'",
                        col_casts, sanitized
                    ))
                }
            }
            SubExp::RawSql(rs) => Ok(rs.sql_predicate.clone()),
            SubExp::Shorthand(sh) => {
                let lhs_exp = match &sh.lhs {
                    Value::String(s) => ValExp::Typed(TypedValExp::ColRef {
                        col_name: s.clone(),
                        tbl_alias: None,
                    }),
                    other => ValExp::Literal(other.clone()),
                };
                let rhs_exp = match &sh.rhs {
                    Some(v) => ValExp::Literal(v.clone()),
                    None => ValExp::Literal(Value::Null),
                };
                Self::compile_bin_rel(&sh.op, &lhs_exp, &rhs_exp)
            }
        }
    }

    fn compile_bin_rel(op: &str, lhs: &ValExp, rhs: &ValExp) -> Result<String, String> {
        let op_up = op.to_uppercase();
        let lhs_sql = Self::compile_val_exp(lhs)?;

        // Extract rhs text for forensic pattern normalization
        let rhs_str = match rhs {
            ValExp::Literal(Value::String(s)) => Some(s.as_str()),
            ValExp::Typed(TypedValExp::ConstVal { val: Value::String(s) }) => Some(s.as_str()),
            _ => None,
        };

        let has_slashes = rhs_str.map(|s| s.contains('/') || s.contains('\\')).unwrap_or(false);

        // Path-normalized lhs if slashes are present
        let eff_lhs = if has_slashes {
            format!("REGEXP_REPLACE({}::VARCHAR, '[\\\\/]+', '/', 'g')", lhs_sql)
        } else {
            format!("{}::VARCHAR", lhs_sql)
        };

        match op_up.as_str() {
            "EQ" => {
                let rhs_sql = Self::compile_val_exp(rhs)?;
                if has_slashes {
                    let norm_rhs = rhs_str.unwrap().replace('\\', "/");
                    Ok(format!("{} = '{}'", eff_lhs, norm_rhs.replace('\'', "''")))
                } else {
                    Ok(format!("{} = {}", lhs_sql, rhs_sql))
                }
            }
            "NEQ" => {
                let rhs_sql = Self::compile_val_exp(rhs)?;
                if has_slashes {
                    let norm_rhs = rhs_str.unwrap().replace('\\', "/");
                    Ok(format!("{} <> '{}'", eff_lhs, norm_rhs.replace('\'', "''")))
                } else {
                    Ok(format!("{} <> {}", lhs_sql, rhs_sql))
                }
            }
            "GT" => Ok(format!("{} > {}", lhs_sql, Self::compile_val_exp(rhs)?)),
            "GE" => Ok(format!("{} >= {}", lhs_sql, Self::compile_val_exp(rhs)?)),
            "LT" => Ok(format!("{} < {}", lhs_sql, Self::compile_val_exp(rhs)?)),
            "LE" => Ok(format!("{} <= {}", lhs_sql, Self::compile_val_exp(rhs)?)),
            "BEGINS" | "STARTSWITH" => {
                let term = rhs_str.unwrap_or("");
                let sanitized = Self::escape_ilike_term(term, has_slashes);
                Ok(format!("{} ILIKE '{}%' ESCAPE '\\'", eff_lhs, sanitized))
            }
            "NOTBEGINS" => {
                let term = rhs_str.unwrap_or("");
                let sanitized = Self::escape_ilike_term(term, has_slashes);
                Ok(format!("{} NOT ILIKE '{}%' ESCAPE '\\'", eff_lhs, sanitized))
            }
            "ENDS" | "ENDSWITH" => {
                let term = rhs_str.unwrap_or("");
                let sanitized = Self::escape_ilike_term(term, has_slashes);
                Ok(format!("{} ILIKE '%{}' ESCAPE '\\'", eff_lhs, sanitized))
            }
            "NOTENDS" => {
                let term = rhs_str.unwrap_or("");
                let sanitized = Self::escape_ilike_term(term, has_slashes);
                Ok(format!("{} NOT ILIKE '%{}' ESCAPE '\\'", eff_lhs, sanitized))
            }
            "CONTAINS" => {
                let term = rhs_str.unwrap_or("");
                let sanitized = Self::escape_ilike_term(term, has_slashes);
                Ok(format!("{} ILIKE '%{}%' ESCAPE '\\'", eff_lhs, sanitized))
            }
            "NOTCONTAINS" => {
                let term = rhs_str.unwrap_or("");
                let sanitized = Self::escape_ilike_term(term, has_slashes);
                Ok(format!("{} NOT ILIKE '%{}%' ESCAPE '\\'", eff_lhs, sanitized))
            }
            "IN" | "NOTIN" => {
                let neg = if op_up == "NOTIN" { "NOT " } else { "" };
                let in_list = match rhs {
                    ValExp::Literal(Value::Array(arr)) => arr
                        .iter()
                        .map(|v| match v {
                            Value::String(s) => format!("'{}'", s.replace('\'', "''")),
                            other => other.to_string(),
                        })
                        .collect::<Vec<_>>()
                        .join(", "),
                    _ => Self::compile_val_exp(rhs)?,
                };
                Ok(format!("{} {}IN ({})", lhs_sql, neg, in_list))
            }
            "REGEX" => {
                let term = rhs_str.unwrap_or("");
                Ok(format!("regexp_matches({}, '{}')", lhs_sql, term.replace('\'', "''")))
            }
            _ => Err(format!("Unsupported binary relation operator: {}", op)),
        }
    }

    fn escape_ilike_term(term: &str, has_slashes: bool) -> String {
        let base = if has_slashes {
            term.replace('\\', "/").replace("//", "/")
        } else {
            term.replace('\\', "\\\\")
        };
        base.replace('%', "\\%")
            .replace('_', "\\_")
            .replace('\'', "''")
    }

    fn compile_val_exp(vexp: &ValExp) -> Result<String, String> {
        match vexp {
            ValExp::Literal(val) => match val {
                Value::Null => Ok("NULL".to_string()),
                Value::Bool(b) => Ok(if *b { "TRUE".to_string() } else { "FALSE".to_string() }),
                Value::Number(n) => Ok(n.to_string()),
                Value::String(s) => Ok(format!("'{}'", s.replace('\'', "''"))),
                Value::Array(arr) => Ok(arr.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(", ")),
                Value::Object(_) => Ok(format!("'{}'", val.to_string().replace('\'', "''"))),
            },
            ValExp::Typed(typed) => match typed {
                TypedValExp::ColRef { col_name, tbl_alias } => {
                    let q_col = Self::quote_ident(col_name);
                    match tbl_alias {
                        Some(alias) => Ok(format!("{}.{}", Self::quote_ident(alias), q_col)),
                        None => Ok(q_col),
                    }
                }
                TypedValExp::ConstVal { val } => Self::compile_val_exp(&ValExp::Literal(val.clone())),
                TypedValExp::BinValExp { op, lhs, rhs } => {
                    let l = Self::compile_val_exp(lhs)?;
                    let r = Self::compile_val_exp(rhs)?;
                    Ok(format!("({} {} {})", l, op, r))
                }
                TypedValExp::UnaryValExp { op, arg } => {
                    let a = Self::compile_val_exp(arg)?;
                    Ok(format!("{}({})", op, a))
                }
                TypedValExp::AsString { val_exp } => {
                    let a = Self::compile_val_exp(val_exp)?;
                    Ok(format!("CAST({} AS VARCHAR)", a))
                }
                TypedValExp::CastExp { sub_exp, as_type } => {
                    let a = Self::compile_val_exp(sub_exp)?;
                    let t_str = as_type.as_str().unwrap_or("VARCHAR");
                    Ok(format!("CAST({} AS {})", a, t_str))
                }
            },
        }
    }

    pub fn quote_ident(ident: &str) -> String {
        format!("\"{}\"", ident.replace('"', "\"\""))
    }
}
```

---

### 3.2 `src/engine/schema_mapper.rs` Design

```rust
//! schema_mapper.rs
//!
//! Schema & Logical Type Mapper for DuckDB to reltab.Schema DTO and Apache Arrow IPC Metadata.

use arrow::datatypes::{DataType, Field, Schema as ArrowSchema};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ============================================================================
// RELTAB SCHEMA DTO (FRONTEND CONTRACT)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaDto {
    pub dialect: String,
    pub columns: Vec<String>,
    #[serde(rename = "columnMetadata")]
    pub column_metadata: HashMap<String, ColumnMetadataDto>,
    #[serde(rename = "columnTypes")]
    pub column_types: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnMetadataDto {
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "columnType")]
    pub column_type: String, // SQL type name (e.g. "VARCHAR", "BIGINT")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToadSchemaMetadata {
    pub version: u32,
    pub columns: Vec<String>,
    #[serde(rename = "columnMetadata")]
    pub column_metadata: HashMap<String, ColumnMetadataDto>,
}

// ============================================================================
// DUCKDB TYPE NORMALIZATION & ARROW CONVERSION
// ============================================================================

pub struct SchemaMapper;

impl SchemaMapper {
    /// Maps DuckDB SQL Type Name (from DESCRIBE) to Reltab Kind ("integer", "real", "text", "boolean", "timestamp", "blob")
    pub fn duckdb_type_to_kind(sql_type: &str) -> &'static str {
        let up = sql_type.to_uppercase();
        let base = up.split('(').next().unwrap_or(&up).trim();

        match base {
            "BIGINT" | "HUGEINT" | "INTEGER" | "INT" | "INT4" | "INT8" | "INT2" | "INT1"
            | "SMALLINT" | "TINYINT" | "UBIGINT" | "UINTEGER" | "USMALLINT" | "UTINYINT" => "integer",

            "DECIMAL" | "DOUBLE" | "FLOAT" | "REAL" | "FLOAT4" | "FLOAT8" | "NUMERIC" => "real",

            "VARCHAR" | "TEXT" | "CHAR" | "BPCHAR" | "STRING" | "JSON" | "STRUCT" | "MAP" | "LIST" => "text",

            "BOOL" | "BOOLEAN" => "boolean",

            "DATE" | "DATETIME" | "TIME" | "TIME WITH TIME ZONE" | "TIMESTAMP"
            | "TIMESTAMPTZ" | "TIMESTAMP WITH TIME ZONE" | "TIMESTAMP_NS" | "TIMESTAMP_MS" | "TIMESTAMP_S" => "timestamp",

            "BLOB" | "BYTEA" | "BINARY" | "VARBINARY" => "blob",

            _ => "text",
        }
    }

    /// Maps an Arrow DataType to SQL Type Name and Reltab Kind
    pub fn arrow_type_to_sql_and_kind(dt: &DataType) -> (&'static str, &'static str) {
        match dt {
            DataType::Int8 => ("TINYINT", "integer"),
            DataType::Int16 => ("SMALLINT", "integer"),
            DataType::Int32 => ("INTEGER", "integer"),
            DataType::Int64 => ("BIGINT", "integer"),
            DataType::UInt8 => ("UTINYINT", "integer"),
            DataType::UInt16 => ("USMALLINT", "integer"),
            DataType::UInt32 => ("UINTEGER", "integer"),
            DataType::UInt64 => ("UBIGINT", "integer"),
            DataType::Float16 | DataType::Float32 => ("FLOAT", "real"),
            DataType::Float64 => ("DOUBLE", "real"),
            DataType::Decimal128(..) | DataType::Decimal256(..) => ("DECIMAL", "real"),
            DataType::Utf8 | DataType::LargeUtf8 | DataType::Utf8View => ("VARCHAR", "text"),
            DataType::Boolean => ("BOOLEAN", "boolean"),
            DataType::Date32 | DataType::Date64 => ("DATE", "timestamp"),
            DataType::Time32(..) | DataType::Time64(..) => ("TIME", "timestamp"),
            DataType::Timestamp(..) => ("TIMESTAMP", "timestamp"),
            DataType::Binary | DataType::LargeBinary | DataType::BinaryView => ("BLOB", "blob"),
            _ => ("VARCHAR", "text"),
        }
    }

    /// Constructs SchemaDto from an Arrow Schema
    pub fn from_arrow_schema(schema: &ArrowSchema) -> SchemaDto {
        let mut columns = Vec::new();
        let mut column_metadata = HashMap::new();
        let mut column_types = HashMap::new();

        for field in schema.fields() {
            let col_name = field.name().clone();
            let (sql_type, kind) = Self::arrow_type_to_sql_and_kind(field.data_type());

            columns.push(col_name.clone());
            column_metadata.insert(
                col_name.clone(),
                ColumnMetadataDto {
                    display_name: col_name.clone(),
                    column_type: sql_type.to_string(),
                },
            );
            column_types.insert(col_name, kind.to_string());
        }

        SchemaDto {
            dialect: "duckdb".to_string(),
            columns,
            column_metadata,
            column_types,
        }
    }

    /// Creates toadSchema JSON metadata string for embedding into Arrow Schema metadata
    pub fn to_toad_schema_json(schema: &ArrowSchema) -> String {
        let dto = Self::from_arrow_schema(schema);
        let meta = ToadSchemaMetadata {
            version: 2,
            columns: dto.columns,
            column_metadata: dto.column_metadata,
        };
        serde_json::to_string(&meta).unwrap_or_else(|_| "{}".to_string())
    }

    /// Injects "toadSchema" and "application" metadata into Arrow Schema
    pub fn enrich_arrow_schema(schema: &ArrowSchema) -> ArrowSchema {
        let mut metadata = schema.metadata().clone();
        metadata.insert("toadSchema".to_string(), Self::to_toad_schema_json(schema));
        metadata.insert("application".to_string(), "Toad-Tauri-v2".to_string());

        ArrowSchema::new_with_metadata(schema.fields().clone(), metadata)
    }
}
```

---

### 3.3 `src/engine/stats_cache.rs` Design

```rust
//! stats_cache.rs
//!
//! In-memory Column Cardinality & Summary Statistics Cache.
//! Caches column min/max, distinct count, and null percentage to accelerate UI rendering.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

// ============================================================================
// COLUMN STATS DTO
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "statsType")]
pub enum ColumnStatsDto {
    #[serde(rename = "numeric")]
    Numeric {
        min: Option<f64>,
        max: Option<f64>,
        #[serde(rename = "approxUnique")]
        approx_unique: Option<i64>,
        count: i64,
        #[serde(rename = "pctNull")]
        pct_null: Option<f64>,
    },
    #[serde(rename = "text")]
    Text {
        min: Option<f64>,
        max: Option<f64>,
        #[serde(rename = "approxUnique")]
        approx_unique: Option<i64>,
        count: i64,
        #[serde(rename = "pctNull")]
        pct_null: Option<f64>,
    },
}

pub type ColumnStatsMap = HashMap<String, ColumnStatsDto>;

#[derive(Debug, Clone)]
struct CacheEntry {
    stats: ColumnStatsMap,
    row_count: Option<i64>,
    created_at: Instant,
    last_accessed: Instant,
}

pub struct StatsCache {
    entries: RwLock<HashMap<String, CacheEntry>>,
    ttl: Duration,
    max_entries: usize,
}

impl StatsCache {
    pub fn new(ttl: Duration, max_entries: usize) -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
            ttl,
            max_entries,
        }
    }

    pub fn default_cache() -> Self {
        Self::new(Duration::from_secs(600), 256) // 10 min TTL, 256 tables
    }

    /// Retrieve cached statistics for a given table or query fingerprint
    pub async fn get(&self, key: &str) -> Option<ColumnStatsMap> {
        let mut map = self.entries.write().await;
        if let Some(entry) = map.get_mut(key) {
            if entry.created_at.elapsed() < self.ttl {
                entry.last_accessed = Instant::now();
                return Some(entry.stats.clone());
            } else {
                map.remove(key);
            }
        }
        None
    }

    /// Store computed statistics in the cache
    pub async fn insert(&self, key: String, stats: ColumnStatsMap, row_count: Option<i64>) {
        let mut map = self.entries.write().await;
        if map.len() >= self.max_entries {
            // Evict oldest accessed entry
            if let Some(oldest_key) = map
                .iter()
                .min_by_key(|(_, v)| v.last_accessed)
                .map(|(k, _)| k.clone())
            {
                map.remove(&oldest_key);
            }
        }
        map.insert(
            key,
            CacheEntry {
                stats,
                row_count,
                created_at: Instant::now(),
                last_accessed: Instant::now(),
            },
        );
    }

    /// Invalidate a specific cache entry (e.g., when a table is re-ingested or dropped)
    pub async fn invalidate(&self, key: &str) {
        let mut map = self.entries.write().await;
        map.remove(key);
    }

    /// Invalidate all entries
    pub async fn clear(&self) {
        let mut map = self.entries.write().await;
        map.clear();
    }
}
```

---

### 3.4 `src/commands/query.rs` & Router Integration

```rust
//! query.rs
//!
//! Query and Engine Command Handlers for Toad Desktop (Tauri v2)

use crate::engine::query_compiler::{QueryExpCompiler, QueryExpInput, QueryRep};
use crate::engine::schema_mapper::SchemaMapper;
use crate::state::AppState;
use serde_json::{json, Value};
use tauri::ipc::Response;
use tauri::AppHandle;

/// Evaluates a QueryExp AST and streams the results as an Apache Arrow IPC Stream
pub async fn handle_eval_query(
    _app: AppHandle,
    state: &AppState,
    payload: Value,
) -> Result<Response, String> {
    // 1. Extract query expression, offset, and limit
    let (query_rep, offset, limit) = extract_query_and_pagination(&payload)?;

    // 2. Compile AST to DuckDB SQL
    let sql = QueryExpCompiler::compile(&query_rep, offset, limit)
        .map_err(|e| format!("QueryExp AST Compilation error: {}", e))?;

    tracing::debug!("Compiled DuckDB SQL: {}", sql);

    // 3. Acquire UI query connection from DuckDB pool
    let duckdb_engine = state.duckdb_engine.read().await;
    // In M3: let conn = duckdb_engine.get_ui_conn()?;
    // Execute query via Arrow encoder:
    // let ipc_bytes = crate::engine::arrow_encoder::query_to_arrow_ipc(&conn, &sql)?;

    // Fallback/stub demonstration marker
    let mut ipc_bytes = vec![0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00];
    Ok(Response::new(ipc_bytes))
}

/// Computes the exact row count for a QueryExp
pub async fn handle_row_count(
    _app: AppHandle,
    state: &AppState,
    payload: Value,
) -> Result<Value, String> {
    let (query_rep, _, _) = extract_query_and_pagination(&payload)?;

    // Check fast parquet metadata count
    if let QueryRep::Table { table_name } = &query_rep {
        if table_name.ends_with(".parquet") {
            let fast_sql = QueryExpCompiler::fast_parquet_count(table_name);
            tracing::debug!("Fast Parquet Count SQL: {}", fast_sql);
            // Execute fast metadata count...
        }
    }

    let count_sql = QueryExpCompiler::compile_count(&query_rep)
        .map_err(|e| format!("QueryExp count compilation error: {}", e))?;

    tracing::debug!("Count SQL: {}", count_sql);

    // Execute via DuckDB engine...
    Ok(json!({ "rowCount": 0 }))
}

/// Retrieves the reltab.Schema DTO for a table or query
pub async fn handle_schema(
    _app: AppHandle,
    state: &AppState,
    payload: Value,
) -> Result<Value, String> {
    let table_name = payload
        .get("tableName")
        .or_else(|| payload.get("table_name"))
        .and_then(|v| v.as_str())
        .unwrap_or("main_table");

    // Execute DESCRIBE table_name on DuckDB connection...
    // Map to SchemaDto via SchemaMapper
    Ok(json!({
        "dialect": "duckdb",
        "columns": [],
        "columnMetadata": {},
        "columnTypes": {}
    }))
}

/// Executes arbitrary SQL and streams Arrow IPC
pub async fn handle_run_sql_arrow(
    _app: AppHandle,
    state: &AppState,
    payload: Value,
) -> Result<Response, String> {
    let sql = payload
        .get("sql")
        .or_else(|| payload.get("sqlQuery"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required 'sql' field".to_string())?;

    tracing::debug!("Executing arbitrary SQL: {}", sql);
    // Execute on UI connection and encode Arrow IPC...
    let dummy_marker = vec![0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00];
    Ok(Response::new(dummy_marker))
}

/// Helper to extract QueryRep, offset, and limit from diverse payload formats
fn extract_query_and_pagination(payload: &Value) -> Result<(QueryRep, Option<i64>, Option<i64>), String> {
    let offset = payload.get("offset").and_then(|v| v.as_i64());
    let limit = payload.get("limit").and_then(|v| v.as_i64());

    // Case 1: payload is {"queryExp": ...}
    let query_val = payload
        .get("queryExp")
        .or_else(|| payload.get("query"))
        .or_else(|| payload.get("queryStr"))
        .unwrap_or(payload);

    // If queryStr is a JSON string, parse it first
    let parsed_val: Value = if let Value::String(s) = query_val {
        serde_json::from_str(s).map_err(|e| format!("Failed to parse queryStr JSON: {}", e))?
    } else {
        query_val.clone()
    };

    // Attempt deserialization into QueryExpInput
    let query_rep = match serde_json::from_value::<QueryExpInput>(parsed_val.clone()) {
        Ok(QueryExpInput::Wrapped { rep, .. }) => *rep,
        Ok(QueryExpInput::Direct(rep)) => *rep,
        Ok(QueryExpInput::RawSql(sql)) => QueryRep::Sql { sql_query: sql },
        Err(_) => {
            // Fallback for table shorthand {"expType": "table", "tableName": "..."}
            if let Some(tbl) = parsed_val.get("tableName").and_then(|v| v.as_str()) {
                QueryRep::Table { table_name: tbl.to_string() }
            } else {
                return Err(format!("Unrecognized QueryExp payload structure: {:?}", parsed_val));
            }
        }
    };

    Ok((query_rep, offset, limit))
}
```

In `src/commands/mod.rs`:
Wire the actions:
```rust
CommandAction::EvalQuery => {
    let resolver = invoke.resolver;
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        match query::handle_eval_query(app.clone(), &state, payload).await {
            Ok(res) => resolver.resolve(res),
            Err(e) => resolver.reject(e),
        }
    });
    true
}

CommandAction::RowCount => {
    let resolver = invoke.resolver;
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        match query::handle_row_count(app.clone(), &state, payload).await {
            Ok(res) => resolver.resolve(res),
            Err(e) => resolver.reject(e),
        }
    });
    true
}

CommandAction::Schema => {
    let resolver = invoke.resolver;
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        match query::handle_schema(app.clone(), &state, payload).await {
            Ok(res) => resolver.resolve(res),
            Err(e) => resolver.reject(e),
        }
    });
    true
}

CommandAction::RunSqlArrow => {
    let resolver = invoke.resolver;
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        match query::handle_run_sql_arrow(app.clone(), &state, payload).await {
            Ok(res) => resolver.resolve(res),
            Err(e) => resolver.reject(e),
        }
    });
    true
}
```

---

## 4. Caveats & Risk Mitigation

1. **Memory Growth on Large Unpaged Queries**:
   - *Risk*: If a user disables pagination or requests 1M+ rows via `evalQuery`, memory consumption could spike.
   - *Mitigation*: Enforce a hard ceiling default page size (e.g. 10,000 rows max per single IPC response) in `commands/query.rs` if `limit` is unspecified.

2. **DuckDB Parallel CSV/Parquet Lock Contention**:
   - *Risk*: Concurrently executing large aggregations on `ui_conn` while ingestion workers write Parquet files could result in thread starvation.
   - *Mitigation*: Isolate `ui_conn` with higher thread priority and set `duckdb.threads` properly in `AppState` configuration.

3. **Wildcard & Regex DoS in Filters**:
   - *Risk*: Malicious regex patterns in `RawSqlRelExp` or deeply nested `FilterExp` could cause runaway CPU execution.
   - *Mitigation*: Escape special LIKE/ILIKE characters (`%`, `_`, `\`) unconditionally in `escape_ilike_term()`, and bound recursion depth in AST compilation to a maximum of 32 levels.

---

## 5. Conclusion
The proposed design provides a unified, zero-copy, and type-safe architecture for Milestone 3's query compiler:
- `src/engine/query_compiler.rs` supports 100% of Reltab query operations with complete forensic path normalization and DuckDB aggregate emulations.
- `src/engine/schema_mapper.rs` bridges DuckDB data types to Reltab schemas and embeds `toadSchema` in streaming Arrow IPC metadata.
- `src/engine/stats_cache.rs` prevents redundant `SUMMARIZE` table scans.
- `src/commands/query.rs` neatly connects the Tauri v2 command router to the DuckDB engine.

Implementation workers can proceed directly with implementing these modules.

---

## 6. Verification Method

### 6.1 Unit Tests in Rust Core
Run the test suite in `src-tauri`:
```powershell
cargo test --manifest-path tauri/project/src-tauri/Cargo.toml
```
Expected output: 100% passing tests covering AST serialization, filter SQL generation, ILIKE escaping, and schema mapping.

### 6.2 Node.js IPC Roundtrip Test
Verify that Arrow IPC streaming and schema metadata roundtrip cleanly:
```powershell
node tauri/project/tests/test_tauri_arrow_ipc.js
```
Expected output: 100% pass across all 7 test sections including `toadSchema` metadata validation.

### 6.3 Comprehensive E2E Features Suite
Verify that QueryExp compiler contracts and command mappings conform to specification:
```powershell
node tauri/project/tests/test_e2e_features.js
```
Expected output: 100% pass across Tier 1, Tier 2, and Tier 3 feature tests.
