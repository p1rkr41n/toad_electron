# Dispatch: Milestone 3 Remediation Worker (Iteration 5)

## Identity & Role
- **Archetype**: `teamwork_worker`
- **Role**: Milestone 3 Remediation Worker
- **Working Directory**: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m3_remediation\`
- **Parent Conversation ID**: `07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d`

## Context & Inputs
Read all 3 fix exploration handoff reports and the patch before starting:
1. `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`
2. `d:\Shared_UserData\Downloads\tad\PROJECT.md`
3. Failure Report: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\challenger_m3_2\handoff.md`
4. Fix Reports:
   - `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m3_fix_1\handoff.md` (fast_parquet_count fix)
   - `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m3_fix_2\handoff.md` (UNC path normalization fix)
   - `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m3_fix_3\handoff.md` & `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m3_fix_3\query_compiler_empty_in.patch` (empty IN fix & syntax safeguards)

## Exclusive Write Ownership
You exclusively own and may edit ONLY the following files:
- `tauri/project/src-tauri/src/engine/query_compiler.rs`
- `tauri/project/src-tauri/tests/engine_tests.rs`
- `tauri/project/src-tauri/tests/adversarial_query_compiler_tests.rs`
- `tauri/project/tests/test_e2e_features.js`

Do NOT touch any other files.

## Remediation Tasks

### 1. Fix `fast_parquet_count` Row Multiplier (Finding 1)
- In `tauri/project/src-tauri/src/engine/query_compiler.rs:311-317`:
  ```rust
  pub fn fast_parquet_count(file_path: &str) -> String {
      let escaped = file_path.replace('\'', "''");
      format!(
          "SELECT COALESCE(SUM(row_group_num_rows), 0) AS total_rows FROM parquet_metadata('{}') WHERE column_id = 0",
          escaped
      )
  }
  ```
- Synchronize expected SQL strings in:
  - `tauri/project/src-tauri/tests/engine_tests.rs:392-399`
  - `tauri/project/src-tauri/tests/adversarial_query_compiler_tests.rs:739-746`
  - `tauri/project/tests/test_e2e_features.js:197-200, 440-447`

### 2. Symmetrical Forensics Path Normalization (Finding 2 & 4)
- In `query_compiler.rs`:
  - Implement single-pass `normalize_path_slashes` collapsing consecutive slashes and backslashes into a single `/`.
  - Use `normalize_path_slashes` symmetrically on `norm_rhs` in `EQ` and `NEQ`, and in `escape_ilike_term`.
  - Fix dead code in `escape_ilike_term`: escape backslashes with `\\\\` when not in slash-normalization mode.

### 3. Empty `IN` / `NOTIN` Array Syntax and Safeguards (Finding 3)
- In `query_compiler.rs`:
  - Handle `ValExp::Literal(Value::Array(arr))` and `ValExp::Typed(ConstVal { val: Value::Array(arr) })`:
    - When `arr.is_empty()`: emit `1=0` for `IN` and `1=1` for `NOTIN`.
  - Add safeguards for empty `Project` (`SELECT *`), empty `GroupBy` (`SELECT *`), empty `Join.on` (`... ON 1=1`).
  - Ensure string array elements are formatted with single quotes `'item'`, not double quotes.

### 4. Verification Requirements
Execute all verification commands before committing:
1. `cargo test --manifest-path tauri/project/src-tauri/Cargo.toml` (all tests passing, including adversarial tests).
2. `& "d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tauri/project/tests/test_tauri_arrow_ipc.js`
3. `& "d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tauri/project/tests/test_e2e_features.js`
4. `& "d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tauri/project/tests/run_all_tests.js`

### 5. Jujutsu VCS Standards
- Commit under author:
  `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`
- Professional English commit message. Strictly local commit; NO remote push.

## Mandatory Anti-Cheating Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Deliver completion report at `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m3_remediation\handoff.md` and notify parent via send_message.
