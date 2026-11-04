# Milestone 3 Challenger 2 Report: QueryExp Compiler & Path Normalization

**Challenger**: `challenger_m3_2` (Milestone 3 QueryExp Compiler & Path Normalization Challenger)  
**Parent Conversation ID**: `07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d`  
**Commit Inspected**: `qtrupsms bb7710ea`  
**Gate Verdict**: `REQUEST_CHANGES`

---

## 1. Observation

### 1.1 Automated Suite Baseline Execution
Executed the required automated test suites without modifications to source implementation:
1. `cargo test --manifest-path tauri/project/src-tauri/Cargo.toml`
   - Result: **63 passed, 0 failed, 0 ignored** across 6 test targets (`main.rs` [11], `adversarial_ipc_stress_tests.rs` [7], `adversarial_m2_tests.rs` [18], `adversarial_query_compiler_tests.rs` [5], `core_tests.rs` [6], `engine_tests.rs` [16]).
2. `& "d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tauri/project/tests/test_e2e_features.js`
   - Result: **22 passed, 0 failed (100% pass)**.
3. `& "d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tauri/project/tests/test_grid_scroll_stress.js`
   - Result: **16 passed, 0 failed (100% pass)** (Viewport scroll FPS: 55,285, heap delta: 1.00MB).

---

### 1.2 Empirical Defect Findings

#### Finding 1: `QueryExpCompiler::fast_parquet_count` Inflates Row Counts by Column Count
- **Location**: `tauri/project/src-tauri/src/engine/query_compiler.rs:311-317`
  ```rust
  pub fn fast_parquet_count(file_path: &str) -> String {
      let escaped = file_path.replace('\'', "''");
      format!(
          "SELECT COALESCE(SUM(row_group_num_rows), 0) AS total_rows FROM parquet_metadata('{}')",
          escaped
      )
  }
  ```
- **Observed Behavior**:
  Generated a benchmark Parquet file with 12,000 rows across 2 columns (`row_id: INTEGER`, `tag: VARCHAR`) and 3 row groups via DuckDB:
  ```
  [EVIDENCE] parquet_metadata returned 6 rows:
     rg_id: 0, col_id: 0, num_rows: 4096
     rg_id: 0, col_id: 1, num_rows: 4096
     rg_id: 1, col_id: 0, num_rows: 4096
     rg_id: 1, col_id: 1, num_rows: 4096
     rg_id: 2, col_id: 0, num_rows: 3808
     rg_id: 2, col_id: 1, num_rows: 3808
  ```
  Executing `QueryExpCompiler::fast_parquet_count`:
  ```
  [EVIDENCE] QueryExpCompiler::fast_parquet_count output: 24000
  [EVIDENCE] Standard DuckDB COUNT(*) output: 12000
  [EVIDENCE] FastCounter::count_parquet_rows output: 12000
  ```
- **Root Cause**: In DuckDB, `parquet_metadata(...)` outputs **one record per column chunk per row group**. Summing `row_group_num_rows` sums the row group size $N_{\text{columns}}$ times. A table with 50 columns will report **50× the real row count**.
- **Note**: `duckdb_pool.rs:107` correctly bypasses this SQL query for local files by invoking `FastCounter::count_parquet_rows(path)`, which accurately reads the thrift footer in **190.76 µs (< 0.2 ms)**. However, `QueryExpCompiler::fast_parquet_count` remains defective for any query-based metadata counts.

---

#### Finding 2: Exact Match `EQ` Fails on Windows UNC Paths and Consecutive Slashes
- **Location**: `tauri/project/src-tauri/src/engine/query_compiler.rs:718-726`
  ```rust
  "EQ" => {
      let rhs_sql = Self::compile_val_exp(rhs)?;
      if has_slashes {
          let norm_rhs = rhs_str.unwrap().replace('\\', "/");
          Ok(format!("{} = '{}'", eff_lhs, norm_rhs.replace('\'', "''")))
      } else {
          Ok(format!("{} = {}", lhs_sql, rhs_sql))
      }
  }
  ```
- **Observed Behavior**:
  Inserted Row 5: `\\192.168.1.1\admin$\psexec.exe` into table `forensics_paths`.
  Queried with `{ op: "EQ", lhs: "file_path", rhs: "\\\\192.168.1.1\\admin$\\psexec.exe" }`:
  ```
  [EVIDENCE] Generated SQL for UNC EQ: SELECT * FROM (SELECT * FROM "forensics_paths") AS _t1 WHERE REGEXP_REPLACE("file_path"::VARCHAR, '[\\/]+', '/', 'g') = '//192.168.1.1/admin$/psexec.exe'
  [EVIDENCE] UNC EQ query matched row IDs: []
  [EVIDENCE] Did UNC path match row 5? false
  ```
- **Root Cause**: `eff_lhs` uses `REGEXP_REPLACE(..., '[\\/]+', '/', 'g')`, which collapses consecutive backslashes into a single slash (`/192.168.1.1`). `norm_rhs` uses `.replace('\\', "/")`, which converts `\\` into `//` without collapsing. The query tests `'/192.168.1.1...' = '//192.168.1.1...'`, which evaluates to `FALSE` for all rows.

---

#### Finding 3: Empty `IN ([])` Produces Syntax Error in DuckDB Parser
- **Location**: `tauri/project/src-tauri/src/engine/query_compiler.rs:770-784`
  ```rust
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
  ```
- **Observed Behavior**:
  When frontend filters pass an empty selection array `[]` (e.g. user unchecks all categories), compiled SQL evaluates to:
  ```
  [EVIDENCE] IN with empty list generated SQL: SELECT * FROM (SELECT * FROM "keyword_cols") AS _t1 WHERE "select" IN ()
  [EVIDENCE] DuckDB error on IN (): Parser Error: syntax error at or near ")"
  LINE 1: ... FROM (SELECT * FROM "keyword_cols") AS _t1 WHERE "select" IN ()
                                                                            ^
  ```
- **Root Cause**: Empty array produces an empty string for `in_list`, resulting in invalid SQL `IN ()`.

---

#### Finding 4: Dead Code in `escape_ilike_term`
- **Location**: `tauri/project/src-tauri/src/engine/query_compiler.rs:708, 795-800`
  ```rust
  let has_slashes = rhs_str.map(|s| s.contains('/') || s.contains('\\')).unwrap_or(false);
  ...
  fn escape_ilike_term(term: &str, has_slashes: bool) -> String {
      let base = if has_slashes {
          term.replace('\\', "/").replace("//", "/")
      } else {
          term.replace('\\', "\\\\")
      };
  ```
- **Root Cause**: `has_slashes` is unconditionally `true` if `term` contains `\`. Therefore, the `else` branch `term.replace('\\', "\\\\")` is mathematically unreachable on any string containing `\`. Every backslash is converted to `/`. While harmless for file paths, it prevents literal backslash matching in non-path text.

---

### 1.3 Verified Functionality (Passing Empirical Assertions)
1. **Shorthand Identifier vs Literal Disambiguation**:
   `{ op: "EQ", lhs: "EventID", rhs: 4624 }` successfully compiles to `"EventID" = 4624` (quoted identifier, not string literal `'EventID'`). Reserved SQL keywords (`"select"`, `"from"`, `"where"`, `"order by"`) are safely double-quoted.
2. **Wildcard & SQL Injection Escaping**:
   `CONTAINS '100%'` matches only `'CPU utilization is 100%'` and rejects `'CPU utilization is 1000'`. `CONTAINS 'user_name'` matches only `'user_name_admin'` and rejects `'user-name-admin'`. Injection payload `' OR '1'='1` is safely escaped with `''`.
3. **Aggregate Emulations**:
   - `uniq` on identical values `['Active', 'Active']` -> `'Active'`.
   - `uniq` on mixed values `['Active', 'Inactive']` -> `NULL`.
   - `uniq` on all nulls `[NULL, NULL]` -> `NULL`.
   - `uniq` on single value with nulls `['OnlyOne', NULL]` -> `'OnlyOne'`.
   - `null` aggregate produces `NULL` across all groups.
4. **Fast Parquet Footer Reading**:
   `FastCounter::count_parquet_rows` reads Parquet metadata footers in **190.76 µs (< 0.2 ms)** across 100 benchmark iterations with 100% bit parity to full table scans.

---

## 2. Logic Chain

1. *From Observation 1.2 (Finding 1)*: DuckDB's `parquet_metadata` documentation specifies that row groups contain column chunk metadata. A table with $M$ columns will produce $M$ rows per row group. `QueryExpCompiler::fast_parquet_count` computes $\sum \text{row\_group\_num\_rows}$ over the whole table function, which yields $M \times N_{\text{rows}}$.
2. *From Observation 1.2 (Finding 2)*: Windows logs frequently contain UNC network paths (e.g. `\\server\share`). The LHS normalizes via regex `[\\/]+` to `/server/share`, whereas RHS only replaces `\` with `/` to produce `//server/share`. Because `/server/share` $\neq$ `//server/share`, equality comparisons fail.
3. *From Observation 1.2 (Finding 3)*: Standard SQL grammar rejects empty parenthesized expressions `IN ()`. Deselecting all items in a UI multi-select facet sends `[]`, directly causing an unhandled parser exception in DuckDB.
4. *Conclusion*: Because these defects impact core query execution, correctness of row counts in metadata queries, and path-matching accuracy in Windows forensics, Milestone 3 requires targeted fixes before milestone completion.

---

## 3. Caveats

- In-memory `ui_conn` queries that use `toad:row_count` on disk Parquet files (`duckdb_pool.rs:107`) call `FastCounter::count_parquet_rows`, which is unaffected by Finding 1. Finding 1 only affects SQL statements generated via `QueryExpCompiler::fast_parquet_count`.
- `CONTAINS`, `BEGINS`, and `ENDS` with UNC paths work because `escape_ilike_term` calls `.replace("//", "/")`. Only `EQ` and `NEQ` fail on UNC paths.

---

## 4. Conclusion & Required Changes

**Verdict**: `REQUEST_CHANGES`

The engine team (`worker_m3_engine`) must implement the following 3 minimal fixes:

### Change 1: `query_compiler.rs:311-317` (`fast_parquet_count`)
Filter `parquet_metadata` to a single column chunk (e.g. `WHERE column_id = 0`):
```rust
pub fn fast_parquet_count(file_path: &str) -> String {
    let escaped = file_path.replace('\'', "''");
    format!(
        "SELECT COALESCE(SUM(row_group_num_rows), 0) AS total_rows FROM parquet_metadata('{}') WHERE column_id = 0",
        escaped
    )
}
```

### Change 2: `query_compiler.rs:721, 730` (`norm_rhs` in `EQ` and `NEQ`)
Collapse repeated slashes when normalizing `rhs` paths:
```rust
let norm_rhs = {
    let s = rhs_str.unwrap().replace('\\', "/");
    let mut collapsed = s;
    while collapsed.contains("//") {
        collapsed = collapsed.replace("//", "/");
    }
    collapsed
};
```

### Change 3: `query_compiler.rs:770-784` (`IN` and `NOTIN`)
Handle empty lists cleanly without producing invalid SQL `IN ()`:
```rust
"IN" | "NOTIN" => {
    let is_notin = op_up == "NOTIN";
    match rhs {
        ValExp::Literal(Value::Array(arr)) if arr.is_empty() => {
            if is_notin {
                Ok("1=1".to_string())
            } else {
                Ok("1=0".to_string())
            }
        }
        _ => {
            let neg = if is_notin { "NOT " } else { "" };
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
    }
}
```

---

## 5. Verification Method

To verify the fixes and reproduce these findings:
1. Run the empirical challenge suite:
   ```powershell
   cargo test --manifest-path tauri/project/src-tauri/Cargo.toml --test adversarial_query_compiler_tests -- --nocapture
   ```
2. Run standard suites:
   ```powershell
   cargo test --manifest-path tauri/project/src-tauri/Cargo.toml
   & "d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tauri/project/tests/test_e2e_features.js
   & "d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tauri/project/tests/test_grid_scroll_stress.js
   ```
3. Invalidation condition: All test suites pass, UNC paths match in `EQ`, empty `IN` does not error, and `fast_parquet_count` matches the true row count across multi-column Parquet files.
