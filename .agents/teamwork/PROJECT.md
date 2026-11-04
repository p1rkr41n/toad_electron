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
| 1 | Frozen Interface Contracts | `packages/toadviewer/src/types/NestedJsonContracts.ts` defining `InferredDuckDbType`, `DiscoveredLeafField`, `JsonScanOptions`, `JsonSqlGenerationResult` | M1 | R4 |
| 2 | Core Leaf Traversal & Bracket Path Engine | `packages/toadviewer/src/utils/NestedJsonTraverser.ts` recursive traversal, primitives leaf extraction, JSON arrays as strings, safe path expressions | M1 | R1, R3 |
| 3 | DuckDB SQL Generator | `packages/toadviewer/src/utils/DuckDbJsonSqlBuilder.ts` generating safe `CREATE VIEW` with double-quoted aliases and `TRY_CAST` primitive types (<15ms) | M1 | R1, R3 |
| 4 | Direct Ingestion Schema Introspector | `packages/reltab-duckdb/src/json/JsonSchemaIntrospector.ts` running DuckDB `DESCRIBE` on `read_json_auto(sample_size=2048) LIMIT 0` to parse `STRUCT` trees | M2 | R2 |
| 5 | Streaming Dynamic Projection Flattener | `packages/reltab-duckdb/src/json/JsonStreamingFlattener.ts` generating recursive unpack `SELECT` expressions into dot-notated columns | M2 | R2, R3 |
| 6 | Ingestion Pipeline Integration | `packages/reltab-duckdb/src/csvimport.ts` integrating two-phase projection into `streamJsonToParquet` for `.json`, `.jsonl`, `.ndjson`, and decoded EVTX | M2 | R2 |
| 7 | Discovered Fields UI Component | `packages/toadviewer/src/components/NestedFieldsTable.tsx` with real-time search, inline column name editing, type selection, fill rate meter | M3 | R1 |
| 8 | Asynchronous Sample Scanner | `packages/toadviewer/src/workers/SampleScanWorker.ts` & `SampleScanController.tsx` (100 preview + 1,000 async deep scan without UI freezing) | M3 | R1 |
| 9 | RegexDialog Integration | `packages/toadviewer/src/components/RegexDialog.tsx` & `nested-dialog.less` with segmented mode pill `[Nested JSON]`, wiring table, scanner and SQL builder | M3 | R1 |
| 10 | Version Bump to v2.5.1 | Synchronize SemVer 3-digit `2.5.1` across all metadata files via `node tools/bump_version.js 2.5.1` | M4 | R5 |
| 11 | Packaging & Release Verification | Verify `fastbuild.ps1`, `package_release.ps1`, ASAR < 45MB, portable exe < 75MB, zero duplicate historical binaries | M4 | R5 |
| 12 | Windows EVTX Parity QA | `tests/qa/test_realworld_evtx_json.js` verifying 100% extraction of RecordID 93937 from `System.evtx` (#attributes, #text) | M5 | R1, R3 |
| 13 | Adversarial & Fuzzing Test Suite | `tests/qa/test_json_adversarial_fuzz.js` testing corrupted JSON, deep recursion, unicode, quotes, spaces, SQL injection resistance | M5 | R3 |
| 14 | Full Regression QA Gate | `node run_tests.js --all` passing 100% across all test suites with zero regressions | M5 | R5 |
| 15 | Adversarial Verification Gate | 2 Reviewers, 2 Challengers, and 1 Forensic Auditor (`teamwork_auditor`) gate check | M6 | Gate |

## Milestones
| # | Name | Scope & Files Owned | Dependencies | Status |
|---|------|---------------------|-------------|--------|
| M1 | Core Contracts & Traversal/SQL Engine | `tad-master/packages/toadviewer/src/types/NestedJsonContracts.ts`<br/>`tad-master/packages/toadviewer/src/utils/NestedJsonTraverser.ts`<br/>`tad-master/packages/toadviewer/src/utils/DuckDbJsonSqlBuilder.ts`<br/>`tests/unit/test_nested_traverser.js`<br/>`tests/unit/test_duckdb_json_builder.js` | none | IN_PROGRESS (`5c070185-4355-4490-a986-abb327855850`) |
| M2 | Direct Ingestion Dynamic Projection Pipeline | `tad-master/packages/reltab-duckdb/src/json/JsonSchemaIntrospector.ts`<br/>`tad-master/packages/reltab-duckdb/src/json/JsonStreamingFlattener.ts`<br/>`tad-master/packages/reltab-duckdb/src/csvimport.ts`<br/>`tests/unit/test_json_schema_introspect.js`<br/>`tests/unit/test_json_streaming_flattener.js` | none | IN_PROGRESS (`0c93082f-f29f-4b1f-9ed2-b45aac72db39`) |
| M3 | Interactive UI Discovered Fields & Async Scanner | `tad-master/packages/toadviewer/src/workers/SampleScanWorker.ts`<br/>`tad-master/packages/toadviewer/src/components/SampleScanController.tsx`<br/>`tad-master/packages/toadviewer/src/components/NestedFieldsTable.tsx`<br/>`tad-master/packages/toadviewer/less/nested-dialog.less`<br/>`tad-master/packages/toadviewer/src/components/RegexDialog.tsx`<br/>`tad-master/packages/toadviewer/src/toadviewer.ts` | M1 | PLANNED |
| M4 | Version Bump v2.5.1 & Packaging Staging | `tools/bump_version.js`<br/>`package.json` manifests<br/>`dist_package.ps1`<br/>`package_release.ps1` | M1, M2 | PLANNED |
| M5 | Comprehensive E2E QA, EVTX Parity & Adversarial Fuzzing | `tests/qa/test_realworld_evtx_json.js`<br/>`tests/qa/test_json_adversarial_fuzz.js`<br/>`run_tests.js` | M1, M2, M3, M4 | PLANNED |
| M6 | Independent Review, Challenger & Forensic Audit Gate | Gate verification: 2 Reviewers, 2 Challengers, 1 Forensic Auditor | M1-M5 | PLANNED |

## Interface Contracts

### `packages/toadviewer/src/types/NestedJsonContracts.ts`
```typescript
export type InferredDuckDbType = 
  | "BIGINT" 
  | "INTEGER" 
  | "DOUBLE" 
  | "BOOLEAN" 
  | "TIMESTAMP" 
  | "VARCHAR";

export interface DiscoveredLeafField {
  /** Hierarchical path segments: ["Event", "System", "EventID", "#text"] */
  readonly pathSegments: string[];
  
  /** Hierarchical dot notation name: "Event.System.EventID.#text" */
  readonly dotPath: string;
  
  /** Editable user-defined column name */
  customColName: string;
  
  /** Safe JSON path expression: '$."Event"."System"."EventID"."#text"' or '$["Event"]["System"]...' */
  readonly jsonPathExpr: string;
  
  /** Sample value string */
  readonly sampleValue: string;
  
  /** Inferred DuckDB column type */
  inferredType: InferredDuckDbType;
  
  /** Occurrence rate across sample pool (0.0 to 1.0) */
  readonly fillRate: number;
  
  /** Extraction checkbox status */
  enabled: boolean;
}

export interface JsonScanOptions {
  sampleLimit: number;          // 100 (initial) or 1000 (deep)
  flattenArrays: boolean;       // false: keep array as JSON string
  maxDepth?: number;            // recursion guard (default: 50)
}

export interface JsonSqlGenerationResult {
  readonly createViewSql: string;
  readonly activeColumnCount: number;
  readonly columnMappings: Array<{ sourcePath: string; outputColumn: string }>;
}
```

## Code Layout
- Frontend contracts: `tad-master/packages/toadviewer/src/types/NestedJsonContracts.ts`
- Frontend logic: `tad-master/packages/toadviewer/src/utils/` and `src/workers/`
- Frontend UI: `tad-master/packages/toadviewer/src/components/` and `less/`
- Backend logic: `tad-master/packages/reltab-duckdb/src/json/` and `src/csvimport.ts`
- Tests: `tests/unit/`, `tests/qa/`, and `run_tests.js`
- Packaging: `tools/bump_version.js`, `fastbuild.ps1`, `package_release.ps1`
