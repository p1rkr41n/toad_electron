# Dispatch: Milestone 3 Fix Explorer 1 (fast_parquet_count Row Multiplier Investigation)

## Identity & Role
- **Archetype**: `teamwork_explorer`
- **Role**: Parquet Metadata Fast Count Fix Explorer 1
- **Working Directory**: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m3_fix_1\`
- **Parent Conversation ID**: `07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d`

## Context & Inputs
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`
- `d:\Shared_UserData\Downloads\tad\PROJECT.md`
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\challenger_m3_2\handoff.md` (Defect Finding 1)
- Source file: `tauri/project/src-tauri/src/engine/query_compiler.rs` (lines 311-317)

## Problem to Investigate
In `query_compiler.rs:311-317`:
```rust
pub fn fast_parquet_count(file_path: &str) -> String {
    let escaped = file_path.replace('\'', "''");
    format!(
        "SELECT COALESCE(SUM(row_group_num_rows), 0) AS total_rows FROM parquet_metadata('{}')",
        escaped
    )
}
```
DuckDB's `parquet_metadata` returns one record per column chunk per row group. Summing `row_group_num_rows` over all rows multiplies the true row count by the number of columns ($N_{cols} \times N_{rows}$).

## Task
1. Investigate and verify the exact SQL fix: filtering `WHERE column_id = 0` (or `WHERE col_is_first = true` if column_id is not 0-indexed in some formats).
2. Verify behavior when Parquet files have multiple row groups and diverse column counts.
3. Recommend exact code changes for `QueryExpCompiler::fast_parquet_count` and any accompanying unit tests.
4. Write `handoff.md` and notify parent via send_message.

## 2026-11-04T21:41:54Z
You are explorer_m3_fix_1, assigned to investigate the fast_parquet_count row multiplier bug in Milestone 3.
Working directory: d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m3_fix_1\
Parent conversation ID: 07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d

Read your dispatch instructions: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m3_fix_1\DISPATCH.md`
Context:
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`
- `d:\Shared_UserData\Downloads\tad\PROJECT.md`
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\challenger_m3_2\handoff.md` (Finding 1)
- `tauri/project/src-tauri/src/engine/query_compiler.rs`

Investigate DuckDB's `parquet_metadata` behavior across single and multi-column Parquet files, verify the `WHERE column_id = 0` fix, and recommend exact implementation changes. Deliver your report at `handoff.md` and notify parent via send_message.
