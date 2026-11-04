# Dispatch — Explorer M4-Fix-2 (2026-11-05T06:13:00Z)

## Objective
Design optimization for WAL deserialization in `parquet_ledger.rs` to achieve < 5ms startup reconciliation latency.

## Inputs & Context
1. Read `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`.
2. Read `d:\Shared_UserData\Downloads\tad\.agents\teamwork\challenger_m4_1\handoff.md` (§1.4 and §2.2).
3. Inspect `tauri/project/src-tauri/src/ledger/parquet_ledger.rs` (`read_all_events_from_parquet`).
4. Problem:
   `read_all_events_from_parquet` invokes `duckdb::Connection::open_in_memory()` and executes dynamic `DESCRIBE` and `SELECT` SQL queries. This takes 35-47ms on Windows, violating the `< 5ms` startup reconciliation performance contract.
5. Task:
   Design a pure Rust Parquet deserializer using the native `parquet = "54"` and `arrow = "54"` crates (e.g. `parquet::file::reader::SerializedFileReader` or Arrow `RecordBatchReader`).
   - Extract row groups directly into `Vec<LedgerEvent>` in pure Rust.
   - Handle both 16-field modern schema and legacy column aliases (`source_path`, `source_size`, `extra_json`).
   - Show how this reduces latency to ~200-500µs (< 1ms).
6. Deliver detailed recommendation to `.agents/teamwork/explorer_m4_fix_2/handoff.md`.

## 2026-11-04T23:14:08Z
[Message] sender=07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d priority=MESSAGE_PRIORITY_HIGH
Design the latency optimization for WAL event reading in `tauri/project/src-tauri/src/ledger/parquet_ledger.rs` (`read_all_events_from_parquet`).
Replace the in-memory DuckDB queries with native Rust `parquet = "54"` / `arrow = "54"` reader to achieve < 5ms startup reconciliation latency.
Deliver your technical recommendation to `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m4_fix_2\handoff.md` and report completion back via send_message.
