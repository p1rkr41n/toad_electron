# Dispatch: Explorer M5 EVTX Forensics Parser (Squad 5)

## 2026-11-05T06:53:00Z
**Mission**: Explore and map the implementation architecture for high-speed binary Windows Event Log (`.evtx`) ingestion using the Rust SIMD `evtx` crate (`src-tauri/src/ingest/evtx_parser.rs`).

**Reference Documents**:
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md` (MANDATORY: read first)
- `d:\Shared_UserData\Downloads\tad\PROJECT.md`
- `C:\Users\huydq\.gemini\antigravity\brain\4cd78c02-c356-4448-bdfe-f2930e55fb29\ke_hoach_trien_khai_50_subagents_tauri_v2.md` (§ Squad 5, Agent 5.3)
- `Cargo.toml` in `tauri/project/src-tauri/`

**Specific Investigation Tasks**:
1. **`evtx` Crate Evaluation & Dependency Configuration**:
   - Evaluate `evtx = "0.8"` (or latest compatible) in `Cargo.toml`.
   - Thread safety, multithreading parsing across chunks (`evtx::EvtxParser`).
2. **Schema Mapping from Windows Event Log Records**:
   - Extract standard tabular fields:
     `record_id: INT64`, `time_created: TIMESTAMP`, `event_id: INT32`, `provider_name: VARCHAR`, `level: INT32`, `channel: VARCHAR`, `computer: VARCHAR`, `user_id: VARCHAR`, `payload_json: VARCHAR`.
   - Error handling for corrupted EVTX chunks or partial file dumps.
3. **High-Performance Ingestion to Parquet**:
   - Streaming records into Arrow RecordBatches or intermediate JSONL into DuckDB `COPY ... TO 'temp/..._cached.parquet' (FORMAT PARQUET)`.
   - Benchmark expectations and memory footprints.
4. **Integration with Parquet State Ledger WAL**:
   - Appending `FILE_INGESTED` event with `source_path`, `parquet_path`, `row_count`, `parquet_size`.

**Output Deliverables**:
Write a comprehensive investigation report to:
`d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m5_evtx\handoff.md`
Report must contain: Observation, Logic Chain, Caveats, Conclusion, and Recommended Implementation Strategy.
Do NOT modify or write any production source code — read-only exploration only.
