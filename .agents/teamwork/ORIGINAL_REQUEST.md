# Original User Request

## Initial Request — 2026-11-04T07:28:22Z

Implement nested JSON parsing and auto-flattening in TOAD (Tabular OLAP Analytics Desktop) for Windows Event Log (EVTX) JSON representations and complex JSON/JSONL logs containing deeply nested fields and special characters.

Working directory: d:\Shared_UserData\Downloads\tad
Integrity mode: development

Reference material:
- Implementation Plan: `C:\Users\huydq\.gemini\antigravity\brain\489b863f-84dc-4fd6-bbfb-142488ba4d23\ke_hoach_phat_trien_nested_json_parser.md`
- Parallel Execution & Testing Plan: `C:\Users\huydq\.gemini\antigravity\brain\489b863f-84dc-4fd6-bbfb-142488ba4d23\phuong_an_trien_khai_va_kiem_thu_song_song_nested_json.md`

## Requirements

### R1. Interactive Extraction in Parse Columns Dialog
In `packages/toadviewer/src/components/RegexDialog.tsx` (and supporting UI components), support extracting from columns containing nested JSON. Recursively traverse objects down to leaf nodes (primitives: string, number, boolean, null) while preserving arrays as JSON strings by default. Generate safe DuckDB bracket paths (`$["path"]["segment"]`) immune to special characters (`#`, `@`, dots, spaces, quotes). Provide a Discovered Fields table with editable column names (defaulting to hierarchical dot notation like `Event.System.EventID.#text`), data type selection, search filtering, and sample scanning with a 100-row initial preview and an asynchronous deep scan option (up to 1,000 rows). Generate and execute DuckDB `CREATE VIEW` statements with safe double-quoted column identifiers in < 15ms.

### R2. Direct File Ingestion Auto-Flattening
In `packages/reltab-duckdb/src/csvimport.ts` (and supporting ingestion modules), implement two-phase dynamic projection for directly ingested `.json` and `.jsonl` files. In Phase 1, introspect the schema via DuckDB (`DESCRIBE SELECT * FROM read_json_auto(path, sample_size = 2048) LIMIT 0;`). In Phase 2, if `STRUCT` columns are present, recursively unpack all nested fields into flattened dot-notated columns and write directly to Parquet (`COPY (SELECT ... FROM read_json_auto(...)) TO 'dst.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);`). If no nested `STRUCT` columns exist, preserve standard ingestion.

### R3. Safe Character Handling and SQL Escaping
Ensure 100% immunity to SQL parsing and identifier errors when JSON keys contain special characters including `#attributes`, `#text`, `@xmlns`, periods, spaces, slashes, and quotes, across both DuckDB JSON extraction paths (`json_extract_string`) and DuckDB column aliases.

### R4. Modular Architecture and Interface Contracts
Organize work across modular boundaries adhering to shared interface definitions (`packages/toadviewer/src/types/NestedJsonContracts.ts`). The team may decide whether to include Stream 7 (Rust native SIMD flattener for >5GB files) or focus on the DuckDB dynamic projection and TypeScript pipeline.

### R5. Workspace Guidelines and Release Standards
Increment release version to TOAD v2.5.1 via `node tools/bump_version.js 2.5.1`. Maintain Git/Jujutsu history cleanly without committing intermediate artifacts, binaries, or duplicate historical executables. All commit messages, release notes, and public artifacts must strictly follow the English-Only Public Language Policy and author identity standard (`HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`).

## Acceptance Criteria

### Correctness and Parity
- [ ] Recursively extracts 100% of leaf fields from real-world Windows EVTX JSON (RecordID 93937 from `D:\Shared_UserData\Downloads\data_sample\System.evtx`), including `#attributes` and `#text` fields.
- [ ] DuckDB bracket path extraction (`$["Event"]["System"]["EventID"]["#text"]`) executes without syntax or escaping errors.
- [ ] Directly ingested nested JSON/JSONL files with `STRUCT` columns are automatically flattened into columnar dot-notated Parquet files.

### UI and Performance
- [ ] Interactive Parse Columns dialog renders discovered fields table with editable column names and search filtering.
- [ ] DuckDB VIEW creation from extracted fields completes in < 15ms.
- [ ] Scanning 1,000 sample rows executes asynchronously without freezing the UI.

### Test Suites and Quality
- [ ] Adversarial and fuzzing test suite passes with corrupted JSON, special characters, and deep recursion.
- [ ] Existing full test suite (`node run_tests.js --all`) passes 100% with zero regressions.
- [ ] Version is updated to 2.5.1 and packaging builds without duplicate historical binaries.

