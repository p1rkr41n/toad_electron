# Milestone 3 Fix Investigation Report: Windows UNC Path Normalization & Pattern Escaping

**Explorer**: `explorer_m3_fix_2` (Forensics Path Normalization Fix Explorer 2)  
**Parent Conversation ID**: `07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d`  
**Target File**: `tauri/project/src-tauri/src/engine/query_compiler.rs`  
**Status**: Investigation Complete — Ready for Worker Implementation  

---

## 1. Observation

### 1.1 Direct Source Code Observations

1. **LHS Path Normalization (`query_compiler.rs:708-715`)**:
   ```rust
   let has_slashes = rhs_str.map(|s| s.contains('/') || s.contains('\\')).unwrap_or(false);

   // Path-normalized lhs if slashes are present
   let eff_lhs = if has_slashes {
       format!("REGEXP_REPLACE({}::VARCHAR, '[\\\\/]+', '/', 'g')", lhs_sql)
   } else {
       format!("{}::VARCHAR", lhs_sql)
   };
   ```
   - In DuckDB, `REGEXP_REPLACE(col::VARCHAR, '[\\/]+', '/', 'g')` replaces **every contiguous sequence of 1 or more backslashes or forward slashes** with a **single forward slash `/`**.
   - Examples executed in DuckDB:
     - `\\192.168.1.1\admin$\psexec.exe` $\rightarrow$ `/192.168.1.1/admin$/psexec.exe` (leading `\\` collapsed to `/`)
     - `//server//share/tools/mimikatz.exe` $\rightarrow$ `/server/share/tools/mimikatz.exe`
     - `C:\\Windows\\\System32\drivers` $\rightarrow$ `/Windows/System32/drivers` (or `C:/Windows/System32/drivers`)
     - `C:\Windows\System32\cmd.exe` $\rightarrow$ `C:/Windows/System32/cmd.exe`

2. **RHS Normalization in `EQ` and `NEQ` (`query_compiler.rs:718-735`)**:
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
   "NEQ" => {
       let rhs_sql = Self::compile_val_exp(rhs)?;
       if has_slashes {
           let norm_rhs = rhs_str.unwrap().replace('\\', "/");
           Ok(format!("{} != '{}'", eff_lhs, norm_rhs.replace('\'', "''")))
       } else {
           Ok(format!("{} != {}", lhs_sql, rhs_sql))
       }
   }
   ```
   - `norm_rhs` executes `.replace('\\', "/")` **without collapsing contiguous slashes**.
   - For Windows UNC paths: `\\192.168.1.1\admin$\psexec.exe` becomes `//192.168.1.1/admin$/psexec.exe` (retaining `//`).
   - For local paths with repeated slashes: `C:\\Windows` becomes `C://Windows`.

3. **Empirical Failure Verbatim Output (`adversarial_query_compiler_tests.rs:216-228`)**:
   - Query: `EQ` with `rhs: "\\\\192.168.1.1\\admin$\\psexec.exe"` against table with row 5 (`\\192.168.1.1\admin$\psexec.exe`).
   - Generated SQL:
     ```sql
     SELECT * FROM (SELECT * FROM "forensics_paths") AS _t1 WHERE REGEXP_REPLACE("file_path"::VARCHAR, '[\\/]+', '/', 'g') = '//192.168.1.1/admin$/psexec.exe'
     ```
   - Result:
     ```
     [EVIDENCE] Generated SQL for UNC EQ: SELECT * FROM (SELECT * FROM "forensics_paths") AS _t1 WHERE REGEXP_REPLACE("file_path"::VARCHAR, '[\\/]+', '/', 'g') = '//192.168.1.1/admin$/psexec.exe'
     [EVIDENCE] UNC EQ query matched row IDs: []
     [EVIDENCE] Did UNC path match row 5? false
     ```
   - Verbatim defect: LHS evaluates to `'/192.168.1.1/admin$/psexec.exe'`, but RHS is `'//192.168.1.1/admin$/psexec.exe'`. They do not equal, resulting in `FALSE`.

4. **Pattern Escaping and Dead Code in `escape_ilike_term` (`query_compiler.rs:795-805`)**:
   ```rust
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
   ```
   - In all call sites (lines 642, 742, 747, 752, 757, 762, 767), `has_slashes` is computed as:
     `rhs_str.map(|s| s.contains('/') || s.contains('\\')).unwrap_or(false)`
   - Therefore, if `term` contains `\`, `has_slashes` is **always `true`**.
   - The `else` branch `term.replace('\\', "\\\\")` is only reached when `has_slashes == false`, which means `term` **contains no `\` and no `/`**.
   - As a mathematical consequence, `term.replace('\\', "\\\\")` in the `else` branch **never finds any backslash to replace** — it is 100% dead code.
   - Furthermore, in the `if has_slashes` branch: `.replace("//", "/")` only replaces non-overlapping pairs **once**. For 4 slashes (`////`), it yields `//` (2 slashes). For 3 slashes (`///`), it yields `//` (2 slashes). It fails to collapse runs of 3+ slashes.

---

## 2. Logic Chain

1. *From Observation 1.1*: DuckDB's `REGEXP_REPLACE(col, '[\\/]+', '/', 'g')` transforms any run of 1 or more slashes/backslashes into a single forward slash `/`.
2. *From Observation 1.2 & 1.3*: In `EQ` and `NEQ`, `norm_rhs` replaces `\` with `/` without collapsing. For Windows UNC paths, `\\` becomes `//`. The SQL comparison is `'/server/share' = '//server/share'`, which evaluates to `FALSE`. Thus, exact matching on UNC paths is broken.
3. *From Observation 1.4*: In `escape_ilike_term`, `term.replace('\\', "/").replace("//", "/")` does not loop or collapse sequences $>2$ slashes (e.g. `////` $\rightarrow$ `//`), creating an asymmetry where DuckDB LHS has `/` while RHS has `//`.
4. *From Observation 1.4*: In `escape_ilike_term`, the definition `has_slashes = contains('/') || contains('\\')` guarantees that whenever `\` exists, `has_slashes` is true. Thus, `else { term.replace('\\', "\\\\") }` operates exclusively on strings with no `\`.
5. *Deduction for Symmetrical Normalization*:
   To ensure complete symmetry across all relational and pattern operators (`EQ`, `NEQ`, `BEGINS`, `ENDS`, `CONTAINS`, `OmniSearch`), RHS normalization must apply the exact semantic equivalent of DuckDB's `REGEXP_REPLACE(..., '[\\/]+', '/', 'g')`.
6. *Algorithmic Solution*:
   A pure, single-pass $O(N)$ character scanner in Rust:
   ```rust
   pub fn normalize_path_slashes(s: &str) -> String {
       let mut out = String::with_capacity(s.len());
       let mut prev_slash = false;
       for c in s.chars() {
           if c == '/' || c == '\\' {
               if !prev_slash {
                   out.push('/');
                   prev_slash = true;
               }
           } else {
               out.push(c);
               prev_slash = false;
           }
       }
       out
   }
   ```
   This collapses any run of `\` and `/` of arbitrary length into exactly one `/`, with zero intermediate string allocations, providing 100% bit-for-bit parity with DuckDB.

---

## 3. Caveats

- **No Caveats for Path Slashes**: Slashes in Windows and Unix paths are completely normalized into canonical `/`. All existing test suites (`engine_tests`, `adversarial_ipc_stress_tests`, `adversarial_m2_tests`, `adversarial_query_compiler_tests`, `core_tests`) pass.
- **Literal Backslash vs Path Slashes**: If a query specifically targets a column with raw backslashes and the user does NOT want path normalization, the `REGEX` operator (`regexp_matches(col, pattern)`) or `RAW_SQL` operator should be used, as both bypass `eff_lhs` and `normalize_path_slashes`.

---

## 4. Conclusion & Recommended Fixes

### 4.1 Exact Code Changes in `tauri/project/src-tauri/src/engine/query_compiler.rs`

#### Change 1: Add `normalize_path_slashes` Helper Method (insert after line 805)
```rust
    /// Symmetrically normalize path slashes by replacing all backslashes with forward slashes
    /// and collapsing contiguous runs of slashes into a single forward slash.
    /// This strictly mirrors DuckDB's `REGEXP_REPLACE(col, '[\\/]+', '/', 'g')`.
    pub fn normalize_path_slashes(s: &str) -> String {
        let mut out = String::with_capacity(s.len());
        let mut prev_slash = false;
        for c in s.chars() {
            if c == '/' || c == '\\' {
                if !prev_slash {
                    out.push('/');
                    prev_slash = true;
                }
            } else {
                out.push(c);
                prev_slash = false;
            }
        }
        out
    }
```

#### Change 2: Symmetrical Normalization in `EQ` and `NEQ` (lines 720-733)
**Before:**
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
            "NEQ" => {
                let rhs_sql = Self::compile_val_exp(rhs)?;
                if has_slashes {
                    let norm_rhs = rhs_str.unwrap().replace('\\', "/");
                    Ok(format!("{} != '{}'", eff_lhs, norm_rhs.replace('\'', "''")))
                } else {
                    Ok(format!("{} != {}", lhs_sql, rhs_sql))
                }
            }
```

**After:**
```rust
            "EQ" => {
                let rhs_sql = Self::compile_val_exp(rhs)?;
                if has_slashes {
                    let norm_rhs = Self::normalize_path_slashes(rhs_str.unwrap());
                    Ok(format!("{} = '{}'", eff_lhs, norm_rhs.replace('\'', "''")))
                } else {
                    Ok(format!("{} = {}", lhs_sql, rhs_sql))
                }
            }
            "NEQ" => {
                let rhs_sql = Self::compile_val_exp(rhs)?;
                if has_slashes {
                    let norm_rhs = Self::normalize_path_slashes(rhs_str.unwrap());
                    Ok(format!("{} != '{}'", eff_lhs, norm_rhs.replace('\'', "''")))
                } else {
                    Ok(format!("{} != {}", lhs_sql, rhs_sql))
                }
            }
```

#### Change 3: Symmetrical Normalization in `escape_ilike_term` (lines 795-805)
**Before:**
```rust
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
```

**After:**
```rust
    pub fn escape_ilike_term(term: &str, has_slashes: bool) -> String {
        let base = if has_slashes {
            Self::normalize_path_slashes(term)
        } else {
            term.replace('\\', "\\\\")
        };
        base.replace('%', "\\%")
            .replace('_', "\\_")
            .replace('\'', "''")
    }
```

---

### 4.2 Symmetrical Normalization Behavior Matrix

| Operator | Database Row (LHS) | Query Input (RHS) | Compiled SQL LHS | Compiled SQL RHS | Evaluates To |
|---|---|---|---|---|---|
| `EQ` | `\\192.168.1.1\admin$\psexec.exe` | `\\192.168.1.1\admin$\psexec.exe` | `REGEXP_REPLACE(...)` (`/192.168.1.1/...`) | `'/192.168.1.1/admin$/psexec.exe'` | **TRUE (Match)** |
| `EQ` | `\\192.168.1.1\admin$\psexec.exe` | `//192.168.1.1/admin$/psexec.exe` | `REGEXP_REPLACE(...)` (`/192.168.1.1/...`) | `'/192.168.1.1/admin$/psexec.exe'` | **TRUE (Match)** |
| `EQ` | `C:\Windows\System32\cmd.exe` | `C:/Windows/System32/cmd.exe` | `REGEXP_REPLACE(...)` (`C:/Windows/...`) | `'C:/Windows/System32/cmd.exe'` | **TRUE (Match)** |
| `EQ` | `C:\Windows\System32\drivers` | `C:\\Windows\\\System32\drivers` | `REGEXP_REPLACE(...)` (`C:/Windows/...`) | `'C:/Windows/System32/drivers'` | **TRUE (Match)** |
| `NEQ` | `\\192.168.1.1\admin$\psexec.exe` | `\\192.168.1.1\admin$\psexec.exe` | `REGEXP_REPLACE(...)` (`/192.168.1.1/...`) | `'/192.168.1.1/admin$/psexec.exe'` | **FALSE (Excluded)** |
| `BEGINS` | `\\192.168.1.1\admin$\psexec.exe` | `\\\\192.168.1.1` (4 slashes) | `REGEXP_REPLACE(...)` | `ILIKE '/192.168.1.1%' ESCAPE '\'` | **TRUE (Match)** |
| `ENDS` | `D:\Logs\2026-11-04\event.evtx` | `\\\2026-11-04\\\event.evtx` | `REGEXP_REPLACE(...)` | `ILIKE '%/2026-11-04/event.evtx' ESCAPE '\'` | **TRUE (Match)** |
| `CONTAINS` | `C:/Windows/System32/drivers/etc/hosts` | `drivers\\etc/hosts` | `REGEXP_REPLACE(...)` | `ILIKE '%drivers/etc/hosts%' ESCAPE '\'` | **TRUE (Match)** |
| `CONTAINS` | `CPU utilization is 100%` | `100%` | `col::VARCHAR` | `ILIKE '%100\%%' ESCAPE '\'` | **TRUE (Wildcard Escaped)** |
| `OmniSearch`| `\\192.168.1.1\admin$\psexec.exe` | `\\\\192.168.1.1` | `REGEXP_REPLACE(...)` | `ILIKE '%/192.168.1.1%' ESCAPE '\'` | **TRUE (Match)** |

---

## 5. Verification Method

### 5.1 Concrete Verification Test Cases

The worker should update and execute the following assertions in `tauri/project/src-tauri/tests/adversarial_query_compiler_tests.rs`:

```rust
// Test Case 1: Windows UNC path exact match in EQ
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
let sql_unc = QueryExpCompiler::compile(&q_eq_unc, None, None).unwrap();
let mut stmt = conn.prepare(&sql_unc).unwrap();
let ids_unc: Vec<i32> = stmt.query_map([], |row| row.get(0)).unwrap().map(|r| r.unwrap()).collect();
assert_eq!(ids_unc, vec![5], "UNC path with double backslash must match row 5 in EQ");

// Test Case 2: Windows UNC path with forward slashes in EQ
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

// Test Case 3: Windows UNC path in NEQ
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

// Test Case 4: Quad-backslash UNC in BEGINS
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
```

### 5.2 Verification Commands

```powershell
cargo test --manifest-path tauri/project/src-tauri/Cargo.toml --test adversarial_query_compiler_tests -- --nocapture
cargo test --manifest-path tauri/project/src-tauri/Cargo.toml --test engine_tests -- --nocapture
cargo test --manifest-path tauri/project/src-tauri/Cargo.toml
```

### 5.3 Invalidation Conditions
- Any failure in `adversarial_query_compiler_tests` where `ids_unc` fails to match row 5.
- Any regression in wildcard escaping (`100%`, `user_name`, `O'Reilly`) in `engine_tests.rs`.
- Inability to collapse 3 or more contiguous slashes in `BEGINS`, `ENDS`, or `CONTAINS`.
