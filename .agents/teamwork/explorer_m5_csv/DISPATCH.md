# Dispatch: Explorer M5 CSV & JSONL Ingestion (Squad 5)

## 2026-11-05T06:53:00Z
**Mission**: Explore and map the implementation architecture for RFC-4180 CSV/TSV streaming ingest, JSONL/NDJSON line streaming, and dirty log fallback in Toad Tauri v2 (`src-tauri/src/ingest/`).

**Reference Documents**:
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md` (MANDATORY: read first)
- `d:\Shared_UserData\Downloads\tad\PROJECT.md`
- `C:\Users\huydq\.gemini\antigravity\brain\4cd78c02-c356-4448-bdfe-f2930e55fb29\ke_hoach_trien_khai_50_subagents_tauri_v2.md` (§ Squad 5, Agents 5.1, 5.2, 5.4, 5.8)
- Existing code in `tauri/project/src-tauri/src/engine/` and `src-tauri/src/ledger/`

**Specific Investigation Tasks**:
1. **RFC-4180 CSV/TSV Streaming Ingest (`csv_streamer.rs`)**:
   - Delimiter sniffer (comma, tab, semicolon, pipe).
   - Support for compressed `.csv.gz` files via DuckDB or Rust flate2.
   - DuckDB `read_csv` SQL generation with options (`header = true`, `delim`, `quote`, `escape`).
2. **DuckDB Assertion & VARCHAR Guard (`all_varchar = true`)**:
   - Strategy to catch DuckDB C++ vector type conversion assertion errors on dirty/heterogeneous logs.
   - Fallback to re-running with `all_varchar = true` and `auto_detect = true`.
3. **JSONL / NDJSON Stream Ingestion (`jsonl_streamer.rs`)**:
   - Streaming line-by-line reading and DuckDB `read_json_auto` integration.
   - Converting to compressed Parquet cache in `toadAppData/temp/` with ZSTD or Snappy compression.
4. **Dirty Log Fallback & Raw Event Engine (`dirty_log.rs`)**:
   - Unstructured log fallback creating `raw_event VARCHAR, line_number INT64, timestamp TIMESTAMP` columns.
5. **Ledger Integration**:
   - How `toad_ledger.parquet` WAL receives `FILE_INGESTED` events upon successful ingestion.

**Output Deliverables**:
Write a comprehensive investigation report to:
`d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m5_csv\handoff.md`
Report must contain: Observation, Logic Chain, Caveats, Conclusion, and Recommended Implementation Strategy.
Do NOT modify or write any production source code — read-only exploration only.
