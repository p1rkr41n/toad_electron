# Milestone 3 Fix Investigation: `fast_parquet_count` Row Multiplier Bug

**Explorer**: `explorer_m3_fix_1`  
**Parent Conversation ID**: `07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d`  
**Working Directory**: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m3_fix_1\`  
**Scope**: Defect Finding 1 (`QueryExpCompiler::fast_parquet_count` row multiplier in `query_compiler.rs:311-317`)

---

## 1. Observation

### 1.1 Source Code Inspection
In `tauri/project/src-tauri/src/engine/query_compiler.rs:310-317`:
```rust
/// O(1) Fast Parquet Metadata Count
pub fn fast_parquet_count(file_path: &str) -> String {
    let escaped = file_path.replace('\'', "''");
    format!(
        "SELECT COALESCE(SUM(row_group_num_rows), 0) AS total_rows FROM parquet_metadata('{}')",
        escaped
    )
}
```

In `tauri/project/src-tauri/src/engine/duckdb_pool.rs:101-125`:
```rust
/// Execute row count SQL statement or O(1) Parquet metadata count on UI connection
pub async fn eval_row_count(&self, count_sql: String, source_hint: Option<String>) -> Result<i64, String> {
    // Fast path for parquet file sources on disk
    if let Some(ref source) = source_hint {
        let path = Path::new(source);
        if path.exists() && path.extension().map_or(false, |ext| ext.eq_ignore_ascii_case("parquet")) {
            if let Ok(count) = FastCounter::count_parquet_rows(path) {
                return Ok(count);
            }
        }
    }

    self.eval_ui_conn(move |conn| {
        let mut stmt = conn
            .prepare(&count_sql)
            .map_err(|e| format!("DuckDB count query prepare error [{}]: {}", count_sql, e))?;

        let count: i64 = stmt
            .query_row([], |row| row.get(0))
            .map_err(|e| format!("DuckDB count query execution error [{}]: {}", count_sql, e))?;

        Ok(count)
    })
    .await
}
```

### 1.2 Verification of Existing Test Suite Assertions
Grep searches revealed four distinct files that reference or test `fast_parquet_count`:
1. `tauri/project/src-tauri/tests/engine_tests.rs:392-399`:
   ```rust
   #[test]
   fn test_fast_parquet_count_sql_generation() {
       let path = "C:\\Data\\logs_2026.parquet";
       let sql = QueryExpCompiler::fast_parquet_count(path);
       assert_eq!(
           sql,
           "SELECT COALESCE(SUM(row_group_num_rows), 0) AS total_rows FROM parquet_metadata('C:\\Data\\logs_2026.parquet')"
       );
   }
   ```
2. `tauri/project/src-tauri/tests/adversarial_query_compiler_tests.rs:739-746`:
   ```rust
   // Document the flaw in QueryExpCompiler::fast_parquet_count:
   let sql_buggy = QueryExpCompiler::fast_parquet_count(parquet_path.to_str().unwrap());
   let mut stmt_buggy = conn.prepare(&sql_buggy).unwrap();
   let buggy_count: i64 = stmt_buggy.query_row([], |row| row.get(0)).unwrap();
   println!("[EVIDENCE] QueryExpCompiler::fast_parquet_count output: {}", buggy_count);
   // It sums over all column chunks, so buggy_count == total_rows * num_columns
   assert_eq!(buggy_count, (total_rows_expected * 2) as i64);
   ```
3. `tauri/project/tests/test_e2e_features.js:197-200, 440-447`:
   ```javascript
   static fastParquetCountSql(parquetPath) {
     const escaped = parquetPath.replace(/'/g, "''");
     return `SELECT COALESCE(SUM(row_group_num_rows), 0) AS total_rows FROM parquet_metadata('${escaped}')`;
   }
   ...
   test("T1.6 (F10): Fast O(1) Parquet Row Count Generation", () => {
     const parquetFile = "C:\\Data\\logs_2026.parquet";
     const sql = QueryExpCompiler.fastParquetCountSql(parquetFile);
     assert.strictEqual(
       sql,
       "SELECT COALESCE(SUM(row_group_num_rows), 0) AS total_rows FROM parquet_metadata('C:\\Data\\logs_2026.parquet')"
     );
   });
   ```

### 1.3 Empirical DuckDB `parquet_metadata` Behavior Across Diverse Datasets
Executed diagnostic benchmarks using DuckDB 1.0 against varying Parquet layouts:

| Test Case | Parquet Layout | True Count (`read_parquet`) | Unfiltered `parquet_metadata` | `parquet_metadata WHERE column_id = 0` | `parquet_file_metadata` |
|---|---|---|---|---|---|
| **Case 1** | Single Column (5000 rows, 5 row groups) | 5,000 | 5,000 (1.0×) | 5,000 (100% match) | 5,000 |
| **Case 2** | Multi-Column (50 columns, 9000 rows, 3 row groups) | 9,000 | **450,000 (50.0× inflation!)** | 9,000 (100% match) | 9,000 |
| **Case 3** | Zero Rows (0 rows, 0 row groups) | 0 | 0 | 0 (100% match) | 0 |
| **Case 4** | Nested Struct/List (2000 rows, 4 row groups, struct{x,y} + list) | 2,000 | **6,000 (3.0× inflation!)** | 2,000 (100% match) | 2,000 |
| **Case 5** | Multi-File Wildcard (`*.parquet`, 4 files above) | 16,000 | 461,000 (28.8× inflation) | 16,000 (100% match) | 16,000 |

### 1.4 Deep Schema Analysis of `parquet_metadata`
Running `DESCRIBE SELECT * FROM parquet_metadata(...)` in DuckDB confirmed:
- `row_group_num_rows` is of type `BIGINT` and represents the row count of that row group repeated across every column chunk row.
- `column_id` is of type `BIGINT`, strictly 0-indexed (`0, 1, 2, ..., N-1`).
- For complex/nested schemas (e.g. `STRUCT` or `LIST`), DuckDB flattens schema fields into physical column chunks:
  - `column_id = 0`: `path_in_schema = 's_col, x'`, `row_group_num_rows = 2000`
  - `column_id = 1`: `path_in_schema = 's_col, y'`, `row_group_num_rows = 2000`
  - `column_id = 2`: `path_in_schema = 'l_col, list, element'`, `row_group_num_rows = 2000`
  In all cases, `column_id = 0` exists exactly once per row group, and contains the row count of that row group.

### 1.5 Execution Performance Comparison
Benchmarked 200 query iterations on the 50-column dataset:
- `parquet_metadata('...') WHERE column_id = 0`: **1.790 s** (~8.95 ms/query)
- `parquet_file_metadata('...')`: **0.579 s** (~2.89 ms/query)
- Native Rust `FastCounter::count_parquet_rows(path)`: **0.0177 s** (**0.177 ms/query — 50× faster than DuckDB SQL**)

---

## 2. Logic Chain

1. *From Observation 1.3 & 1.4*: In Apache Parquet and DuckDB's `parquet_metadata` table function, row groups are divided into column chunks. For a file with $R$ row groups and $C$ leaf columns, `parquet_metadata` produces $R \times C$ rows. Each row stores the row group's total row count in `row_group_num_rows`.
2. *From Observation 1.1*: `QueryExpCompiler::fast_parquet_count` compiles `SELECT COALESCE(SUM(row_group_num_rows), 0) AS total_rows FROM parquet_metadata('...')`. Because there is no predicate filtering, it sums over all $R \times C$ records, calculating:
   $$\sum_{r=1}^{R} \sum_{c=1}^{C} \text{row\_group\_num\_rows}_r = C \times \sum_{r=1}^{R} \text{row\_group\_num\_rows}_r = C \times N_{\text{total\_rows}}$$
   This results in an exact $C$-fold inflation of the row count.
3. *From Observation 1.3 & 1.4*: In Parquet, every row group contains chunk 0 (`column_id = 0`) representing the first leaf column. Filtering by `WHERE column_id = 0` reduces the result set to exactly $R$ records (one per row group), each with `row_group_num_rows` equal to the true row group size.
4. *From Observation 1.3 (Cases 1-5)*: Adding `WHERE column_id = 0` produces exact bit parity with `read_parquet` `COUNT(*)` across 1-column, multi-column (50 cols), 0-row, nested schemas, and multi-file wildcard globs.
5. *From Observation 1.2*: Three test suites (`engine_tests.rs`, `adversarial_query_compiler_tests.rs`, and `test_e2e_features.js`) have hardcoded string assertions or expected values for `fast_parquet_count`. Applying the fix requires updating all three test locations synchronously to prevent regression failures.

---

## 3. Caveats

1. **In-Memory Local File Path Bypasses SQL**: `duckdb_pool.rs:107` intercepts local file paths using `FastCounter::count_parquet_rows(path)` which directly parses the thrift footer in Rust in **0.177 ms**. This path was never affected by the multiplier defect.
2. **DuckDB `parquet_file_metadata` Alternative**: DuckDB provides `parquet_file_metadata('...')` which has a direct `num_rows` column and runs ~3× faster than `parquet_metadata`. However, `parquet_metadata` is the contract specified in Milestone 3 (F10) and explicitly verified by `test_e2e_features.js` (`assert.ok(fastSql.includes("parquet_metadata"))`). Therefore, `WHERE column_id = 0` is the safest, drop-in compliant fix.

---

## 4. Conclusion & Recommended Implementation

### 4.1 Required Changes

#### Change 1: `tauri/project/src-tauri/src/engine/query_compiler.rs:311-317`
Append `WHERE column_id = 0` to the compiled SQL query:
```rust
<<<<
    /// O(1) Fast Parquet Metadata Count
    pub fn fast_parquet_count(file_path: &str) -> String {
        let escaped = file_path.replace('\'', "''");
        format!(
            "SELECT COALESCE(SUM(row_group_num_rows), 0) AS total_rows FROM parquet_metadata('{}')",
            escaped
        )
    }
====
    /// O(1) Fast Parquet Metadata Count
    pub fn fast_parquet_count(file_path: &str) -> String {
        let escaped = file_path.replace('\'', "''");
        format!(
            "SELECT COALESCE(SUM(row_group_num_rows), 0) AS total_rows FROM parquet_metadata('{}') WHERE column_id = 0",
            escaped
        )
    }
>>>>
```

#### Change 2: `tauri/project/src-tauri/tests/engine_tests.rs:392-399`
Update expected SQL assertion in unit tests:
```rust
<<<<
#[test]
fn test_fast_parquet_count_sql_generation() {
    let path = "C:\\Data\\logs_2026.parquet";
    let sql = QueryExpCompiler::fast_parquet_count(path);
    assert_eq!(
        sql,
        "SELECT COALESCE(SUM(row_group_num_rows), 0) AS total_rows FROM parquet_metadata('C:\\Data\\logs_2026.parquet')"
    );
}
====
#[test]
fn test_fast_parquet_count_sql_generation() {
    let path = "C:\\Data\\logs_2026.parquet";
    let sql = QueryExpCompiler::fast_parquet_count(path);
    assert_eq!(
        sql,
        "SELECT COALESCE(SUM(row_group_num_rows), 0) AS total_rows FROM parquet_metadata('C:\\Data\\logs_2026.parquet') WHERE column_id = 0"
    );
}
>>>>
```

#### Change 3: `tauri/project/src-tauri/tests/adversarial_query_compiler_tests.rs:739-746`
Update adversarial regression assertion from expecting `total_rows * 2` to verifying parity with `total_rows_expected`:
```rust
<<<<
    // Document the flaw in QueryExpCompiler::fast_parquet_count:
    let sql_buggy = QueryExpCompiler::fast_parquet_count(parquet_path.to_str().unwrap());
    let mut stmt_buggy = conn.prepare(&sql_buggy).unwrap();
    let buggy_count: i64 = stmt_buggy.query_row([], |row| row.get(0)).unwrap();
    println!("[EVIDENCE] QueryExpCompiler::fast_parquet_count output: {}", buggy_count);
    // It sums over all column chunks, so buggy_count == total_rows * num_columns
    assert_eq!(buggy_count, (total_rows_expected * 2) as i64);
====
    // Verify that QueryExpCompiler::fast_parquet_count accurately returns the true row count:
    let sql_fast = QueryExpCompiler::fast_parquet_count(parquet_path.to_str().unwrap());
    let mut stmt_fast = conn.prepare(&sql_fast).unwrap();
    let fast_count: i64 = stmt_fast.query_row([], |row| row.get(0)).unwrap();
    println!("[EVIDENCE] QueryExpCompiler::fast_parquet_count output: {}", fast_count);
    assert_eq!(
        fast_count, total_rows_expected as i64,
        "QueryExpCompiler::fast_parquet_count must match exact total rows without column multiplication"
    );
>>>>
```

#### Change 4: `tauri/project/tests/test_e2e_features.js:197-200, 440-447`
Update JavaScript simulation and its test assertion:
```javascript
<<<<
  static fastParquetCountSql(parquetPath) {
    const escaped = parquetPath.replace(/'/g, "''");
    return `SELECT COALESCE(SUM(row_group_num_rows), 0) AS total_rows FROM parquet_metadata('${escaped}')`;
  }
...
  test("T1.6 (F10): Fast O(1) Parquet Row Count Generation", () => {
    const parquetFile = "C:\\Data\\logs_2026.parquet";
    const sql = QueryExpCompiler.fastParquetCountSql(parquetFile);
    assert.strictEqual(
      sql,
      "SELECT COALESCE(SUM(row_group_num_rows), 0) AS total_rows FROM parquet_metadata('C:\\Data\\logs_2026.parquet')"
    );
  });
====
  static fastParquetCountSql(parquetPath) {
    const escaped = parquetPath.replace(/'/g, "''");
    return `SELECT COALESCE(SUM(row_group_num_rows), 0) AS total_rows FROM parquet_metadata('${escaped}') WHERE column_id = 0`;
  }
...
  test("T1.6 (F10): Fast O(1) Parquet Row Count Generation", () => {
    const parquetFile = "C:\\Data\\logs_2026.parquet";
    const sql = QueryExpCompiler.fastParquetCountSql(parquetFile);
    assert.strictEqual(
      sql,
      "SELECT COALESCE(SUM(row_group_num_rows), 0) AS total_rows FROM parquet_metadata('C:\\Data\\logs_2026.parquet') WHERE column_id = 0"
    );
  });
>>>>
```

---

## 5. Verification Method

### 5.1 Verification Commands
Execute the complete verification chain to confirm the fix across Rust and JavaScript suites:
```powershell
# 1. Run adversarial fast parquet test
cargo test --manifest-path tauri/project/src-tauri/Cargo.toml --test adversarial_query_compiler_tests -- adv_test_fast_parquet_metadata_count_performance_and_parity --nocapture

# 2. Run all engine and unit tests
cargo test --manifest-path tauri/project/src-tauri/Cargo.toml

# 3. Run E2E feature verification suite
& "d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tauri/project/tests/test_e2e_features.js
```

### 5.2 Invalidation Conditions
The fix is considered invalid if:
1. `QueryExpCompiler::fast_parquet_count` returns any value greater than the true row count on a multi-column Parquet file.
2. `QueryExpCompiler::fast_parquet_count` returns an error or non-zero count on an empty (0 rows) Parquet file.
3. Any of the 63 existing Rust tests or 22 E2E JS tests fail.
