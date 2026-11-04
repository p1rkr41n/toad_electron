# E2E Test Infra: TOAD v2.5.1 Nested JSON Parser & Auto-Flattening

## Test Philosophy
- Opaque-box, requirement-driven test verification derived directly from `ORIGINAL_REQUEST.md`.
- Methodology: Category-Partition + Boundary Value Analysis (BVA) + Pairwise Combinatorial + Real-World Workload Testing.
- Non-blocking execution via Node.js v18 test runner with DuckDB native verification.

## Feature Inventory & Test Coverage Matrix
| # | Feature | Source | Tier 1 (Functional) | Tier 2 (Boundary & Corner) | Tier 3 (Cross-Feature Pairwise) | Tier 4 (Real-World EVTX/App) |
|---|---------|--------|:-------------------:|:--------------------------:|:-------------------------------:|:----------------------------:|
| 1 | Core Traversal & Leaf Extraction | R1 | Flat, nested, arrays, primitives, nulls | 100+ deep nesting, empty objects, circular guard | Traversal + Type inference | Windows EVTX System log EventData |
| 2 | Safe Bracket & Quoted DuckDB Path | R1, R3 | Standard keys, nested child | `#attributes`, `#text`, `@xmlns`, spaces, dots, quotes | Bracket path + `TRY_CAST` | Real EVTX RecordID 93937 fields |
| 3 | DuckDB CREATE VIEW Generation | R1 | Standard column selection, aliases | Multi-column, duplicate names, reserved words | VIEW creation + reltab query execution | DuckDB VIEW latency < 15ms |
| 4 | Phase 1 Schema Introspection | R2 | Clean JSON/JSONL sample | Malformed lines, type ambiguity, sample_size=2048 | Introspection + DuckDBDialect scalar map | EVTX JSONL schema with 50+ columns |
| 5 | Phase 2 Dynamic Unpack Projection | R2 | STRUCT unpack into dot-notated columns | Missing STRUCT fields, empty arrays, mixed types | Unpack projection + ZSTD Parquet COPY | Parquet dot-notated output columns |
| 6 | Interactive Parse Columns Dialog UI | R1 | Mode switch, table render, search | Zero matches, 100+ discovered fields, long names | Search filter + inline rename + type select | Deep scan 1,000 rows without UI freeze |
| 7 | Version Bumping & Release Packaging | R5 | SemVer 2.5.1 sync across manifests | Reject past versions, 4th-digit increment logic | Fastbuild + Release packaging | Zero duplicate binary policy, portable exe |

## Test Architecture
- **Master Test Runner**: `node run_tests.js --all`
- **Unit Test Harnesses**:
  - `node tests/unit/test_nested_traverser.js` (Stream 1)
  - `node tests/unit/test_duckdb_json_builder.js` (Stream 4)
  - `node tests/unit/test_json_schema_introspect.js` (Stream 5)
  - `node tests/unit/test_json_streaming_flattener.js` (Stream 6)
- **QA & Parity Suites**:
  - `node tests/qa/test_realworld_evtx_json.js` (Stream 9)
  - `node tests/qa/test_json_adversarial_fuzz.js` (Stream 8)
- **Benchmark Suite**:
  - `node tests/benchmark/test_nested_json_perf.js` (Stream 10)

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Acceptance Threshold |
|---|----------|--------------------|----------------------|
| 1 | Windows EVTX System.evtx RecordID 93937 | F1, F2, F3, F4, F5 | 100% leaf parity, EventID 7036 `#text` and `#attributes` |
| 2 | Ingestion of 10,000+ line nested JSONL log | F4, F5, F7 | Unpacked Parquet generated in < 2.0s, 0 duplicate files |
| 3 | Interactive Parse Columns Dialog Deep Scan | F1, F3, F6 | 1,000 rows scanned asynchronously, 0 UI freeze |
| 4 | Corrupted JSON and SQL Injection resilience | F1, F2, F3 | 0 crashes, safe error handling, 0 unquoted syntax errors |
| 5 | Full TOAD Regression Test Suite | All | 100% pass across all test suites in `run_tests.js --all` |
