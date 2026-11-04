# Project: TOAD v2.5.1 Nested JSON Parser & Auto-Flattening

## Architecture & Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            TOAD GUI / CLI Layer                             │
└─────────────────────────────────────────────────────────────────────────────┘
          │                                                    │
          ▼                                                    ▼
┌───────────────────────────────────┐        ┌────────────────────────────────┐
│   Luồng 1: Parse Columns Dialog   │        │   Luồng 2: Direct Ingestion   │
│         (Interactive UI)          │        │    (.json, .jsonl, .evtx)      │
├───────────────────────────────────┤        ├────────────────────────────────┤
│ 1. SampleScanWorker               │        │ 1. streamJsonToParquet         │
│    - 100 rows preview (RAM)       │        │    - csvimport.ts line 2968    │
│    - 1,000 deep scan (timesliced) │        │                                │
│ 2. NestedJsonTraverser            │        │ 2. JsonSchemaIntrospector      │
│    - Recursive leaf extraction    │        │    - DESCRIBE read_json_auto   │
│    - Safe bracket/quoted dot path │        │    - Detect STRUCT columns     │
│ 3. NestedFieldsTable (UI)         │        │ 3. JsonStreamingFlattener      │
│    - Search, type picker, rename  │        │    - Dynamic unpack projection │
│ 4. DuckDbJsonSqlBuilder           │        │    - COPY (SELECT ...) TO      │
│    - CREATE VIEW < 15ms           │        │      Parquet (ZSTD)            │
└───────────────────────────────────┘        └────────────────────────────────┘
          │                                                    │
          ▼                                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                  DuckDB Engine & Columnar Parquet Storage                   │
│         (100% immune to #attributes, #text, @xmlns, dots, spaces)           │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Frozen Interface Contracts | `packages/toadviewer/src/types/NestedJsonContracts.ts` defining `InferredDuckDbType`, `DiscoveredLeafField`, `JsonScanOptions`, `JsonSqlGenerationResult` | M1 | Completed |
| 2 | Core Leaf Traversal & Path Engine | `packages/toadviewer/src/utils/NestedJsonTraverser.ts` recursive traversal, primitives leaf extraction, JSON arrays as strings, safe path expressions | M1 | Completed |
| 3 | DuckDB SQL Generator | `packages/toadviewer/src/utils/DuckDbJsonSqlBuilder.ts` generating safe `CREATE VIEW` with double-quoted aliases and `TRY_CAST` primitive types (<15ms) | M1 | Completed |
| 4 | Direct Ingestion Schema Introspector | `packages/reltab-duckdb/src/json/JsonSchemaIntrospector.ts` running DuckDB `DESCRIBE` on `read_json_auto` to parse `STRUCT` trees | M2 | Completed |
| 5 | Streaming Dynamic Projection Flattener | `packages/reltab-duckdb/src/json/JsonStreamingFlattener.ts` generating recursive unpack `SELECT` expressions into dot-notated columns | M2 | Completed |
| 6 | Ingestion Pipeline Integration | `packages/reltab-duckdb/src/csvimport.ts` integrating two-phase projection into `streamJsonToParquet` for `.json`, `.jsonl`, `.ndjson`, and decoded EVTX | M2 | Completed |
| 7 | Discovered Fields UI & Dialog Integration | `packages/toadviewer/src/components/RegexDialog.tsx` with recursive leaf scanning, quoted JSONPath, Deep Scan (1,000 rows) | M3 | Completed |
| 8 | Version Bump & Packaging | Version v2.5.0.5 packaged with ASAR at 28.07 MB (<45 MB), portable exe at 72.36 MB (<75 MB), zero duplicate binaries | M4 | Completed |
| 9 | Windows EVTX Parity QA | `tests/qa/test_realworld_evtx_json.js` verifying 100% extraction of RecordID 93937 from `System.evtx` (#attributes, #text) | M5 | Completed |
| 10 | Adversarial & Fuzzing Test Suite | `tests/qa/test_json_adversarial_fuzz.js` testing corrupted JSON, unicode, quotes, spaces, SQL injection resistance | M5 | Completed |
| 11 | Full Regression QA Gate | `tests/deep_integration_qa.js` passing 223/223 test cases (100%) with zero regressions | M5 | Completed |

## Milestones
| # | Name | Scope & Files Owned | Dependencies | Status |
|---|------|---------------------|-------------|--------|
| M1 | Core Contracts & Traversal/SQL Engine | `tad-master/packages/toadviewer/src/types/NestedJsonContracts.ts`<br/>`tad-master/packages/toadviewer/src/utils/NestedJsonTraverser.ts`<br/>`tad-master/packages/toadviewer/src/utils/DuckDbJsonSqlBuilder.ts`<br/>`tests/unit/test_nested_traverser.js`<br/>`tests/unit/test_duckdb_json_builder.js` | none | DONE (23/23 unit tests pass, tsc clean) |
| M2 | Direct Ingestion Dynamic Projection Pipeline | `tad-master/packages/reltab-duckdb/src/json/JsonSchemaIntrospector.ts`<br/>`tad-master/packages/reltab-duckdb/src/json/JsonStreamingFlattener.ts`<br/>`tad-master/packages/reltab-duckdb/src/csvimport.ts`<br/>`tests/unit/test_json_schema_introspect.js`<br/>`tests/unit/test_json_streaming_flattener.js` | none | DONE (96/96 unit tests pass) |
| M3 | Interactive UI Discovered Fields & Scanner | `tad-master/packages/toadviewer/src/components/RegexDialog.tsx` | M1 | DONE (Deep Scan 1000 rows, quoted JSONPath) |
| M4 | Version Bump & Packaging Staging | `tools/bump_version.js`<br/>`dist_package.ps1`<br/>`package_release.ps1` | M1, M2 | DONE (v2.5.0.5 published, zero-duplicates) |
| M5 | Comprehensive E2E QA, EVTX Parity & Adversarial Fuzzing | `tests/qa/test_realworld_evtx_json.js`<br/>`tests/qa/test_json_adversarial_fuzz.js`<br/>`tests/deep_integration_qa.js` | M1-M4 | DONE (223/223 deep QA pass, 20/20 fuzz/evtx pass) |
