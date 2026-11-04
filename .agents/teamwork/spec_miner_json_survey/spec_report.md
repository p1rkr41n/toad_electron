# Authoritative Technical Specification Report
# TOAD v2.5.1 Nested JSON Parser & Auto-Flattening Engine

**Document Version:** 1.0.0  
**Target Release:** TOAD v2.5.1  
**Specification Sources:**
1. `C:\Users\huydq\.gemini\antigravity\brain\489b863f-84dc-4fd6-bbfb-142488ba4d23\ke_hoach_phat_trien_nested_json_parser.md`
2. `C:\Users\huydq\.gemini\antigravity\brain\489b863f-84dc-4fd6-bbfb-142488ba4d23\phuong_an_trien_khai_va_kiem_thu_song_song_nested_json.md`
3. `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`
4. Empirical DuckDB v1.0.0 engine probes and existing codebase in `packages/toadviewer/` and `packages/reltab-duckdb/`

---

## 1. Executive Summary & Architecture Overview

Security logs (Windows EVTX, Sysmon, Kubernetes audit, AWS CloudTrail, Zeek, Suricata) are structured as deeply nested JSON/JSONL with non-standard field identifiers containing XML metadata tags (`#attributes`, `#text`, `@xmlns`), dots, spaces, quotes, and slashes.

TOAD v2.5.1 delivers a dual-flow nested JSON processing architecture:
1. **Interactive Extraction (Parse Columns Dialog in `RegexDialog.tsx`):**
   Scans raw JSON strings in existing table columns, traverses recursively to primitive leaf nodes (`string`, `number`, `boolean`, `null`), displays discovered fields with editable column names and type selectors, and executes an instant DuckDB `CREATE VIEW` statement in `< 15ms`.
2. **Direct Ingestion Auto-Flattening (Two-Phase Dynamic Projection in `csvimport.ts`):**
   When dragging/dropping `.json` or `.jsonl` files directly into TOAD, executes Phase 1 schema introspection (`DESCRIBE SELECT * FROM read_json_auto(...) LIMIT 0;`). If `STRUCT` columns are detected, generates Phase 2 recursive unpack projection (`"Event"."System"."EventID"."#text" AS "Event.System.EventID.#text"`) and streams directly to columnar Parquet via DuckDB `COPY (...) TO 'dst.parquet'` with 0ms pivot/filter readiness.

---

## 2. Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Contract | `InferredDuckDbType` Union | Strict DuckDB type definition union for leaf schema inference | String identifier | `"BIGINT" \| "INTEGER" \| "DOUBLE" \| "BOOLEAN" \| "TIMESTAMP" \| "VARCHAR"` | Type checking error on unapproved types | `NestedJsonContracts.ts` spec |
| 2 | Contract | `DiscoveredLeafField` Interface | Metadata describing an extracted leaf field from nested JSON | Raw JSON value & hierarchy path | Strongly typed object containing `pathSegments`, `dotPath`, `customColName`, `jsonPathExpr`, `sampleValue`, `inferredType`, `fillRate`, `enabled` | Invalid structure rejected at compile time | `NestedJsonContracts.ts` spec |
| 3 | Contract | `JsonScanOptions` Interface | Configuration parameters controlling sample scanning depth | Options object | `sampleLimit: number`, `flattenArrays: boolean`, `maxDepth?: number` | Falls back to defaults (100 rows, flattenArrays: false) | `NestedJsonContracts.ts` spec |
| 4 | Contract | `JsonSqlGenerationResult` Interface | Generated SQL contract for DuckDB view creation | Active field mappings & source table | `createViewSql: string`, `activeColumnCount: number`, `columnMappings: Array` | Throws error if 0 active columns selected | `NestedJsonContracts.ts` spec |
| 5 | Traversal | Leaf Node Extraction | Recursively traverses objects down to primitive leaves while preserving arrays as JSON strings | Any JSON object / array / primitive | Array of `DiscoveredLeafField` items | Gracefully skips `null`/`undefined`, stringifies malformed JSON | `NestedJsonTraverser.ts` spec |
| 6 | Traversal | Array Preservation Mode | Preserves arrays as stringified JSON representation without bursting rows | JSON Array `[1, 2, 3]` | Single string `"[1,2,3]"` with inferred type `VARCHAR` | Non-array values traversed normally | Architecture Spec § 3.1.A |
| 7 | Escaping | Safe DuckDB JSON Extraction Path | Generates quoted dot path or arrow syntax immune to `#`, `@`, dots, spaces, slashes | Array of path segments: `["Event", "System", "EventID", "#text"]` | SQL expression: `$."Event"."System"."EventID"."#text"` | Throws if segment is empty | DuckDB v1.0.0 probe & Plan § 3.1.B |
| 8 | Escaping | Safe Double-Quoted Column Aliases | Double-quotes all output column aliases to prevent DuckDB identifier and dot collision | Output column name e.g. `Event.System.EventID.#text` | `"Event.System.EventID.#text"` (internal double quotes escaped as `""`) | Prevents SQL syntax error | Architecture Spec § 3.1.B |
| 9 | Escaping | Primitive `TRY_CAST` Wrapping | Wraps extracted string values in `TRY_CAST(... AS <type>)` to prevent query failure on dirty logs | Raw extracted string & target `InferredDuckDbType` | `TRY_CAST(expr AS BIGINT)` etc., or raw expr for `VARCHAR` | Evaluates to `NULL` on corrupt/uncastable value instead of aborting | Architecture Spec § 3.1.B |
| 10 | UI/UX | Discovered Fields Table Component | Dedicated UI component embedded in `RegexDialog.tsx` showing editable columns, types, and fill rates | Discovered fields array | Interactive table with search filter, checkboxes, inline rename, type dropdown | None; non-blocking UI update | Stream 2 Spec (`NestedFieldsTable.tsx`) |
| 11 | UI/UX | Inline Column Renaming | Double click / input edit on field names before executing SQL generation | User text input | Updated `customColName` used in SQL alias | Sanitizes double quotes | Architecture Spec § 3.1.C |
| 12 | UI/UX | Real-time Search & Filter Toolbar | Live filtering of discovered fields by field name or sample value | Search string | Filtered subset view of discovered fields | Shows empty state if no match | Architecture Spec § 3.1.C |
| 13 | Scanner | Fast Initial Sample Scanner (100 Rows) | Scans first 100 rows synchronously from memory cache in `< 5ms` | Buffer / table cache | Initial schema state populated instantly | Non-blocking fallback to 10 rows if cache small | Stream 3 Spec (`SampleScanWorker.ts`) |
| 14 | Scanner | Deep Sample Scanner (1,000 Rows) | Asynchronous background worker scanning up to 1,000 rows for rare fields | User button click | Progress spinner, discovered field delta count (`+12 new fields`) | Catch block displays error callout | Stream 3 Spec (`SampleScanWorker.ts`) |
| 15 | SQL Builder | DuckDB VIEW Generator | Generates `CREATE VIEW "<name>" AS SELECT *, ... FROM "<table>"` | Source table name, target column, active field mappings | Valid DuckDB DDL string executable in `< 15ms` | Throws if target table or columns invalid | Stream 4 Spec (`DuckDbJsonSqlBuilder.ts`) |
| 16 | SQL Builder | Name Collision Detection & Exclusion | Excludes colliding existing columns via `* EXCLUDE (...)` | Existing schema & new column names | Clean SELECT clause without duplicate column errors | Preserves original table columns | `actions.ts` L1222-L1226 |
| 17 | Direct Ingest | Phase 1 Schema Introspection | Introspects `STRUCT` schema from `read_json_auto` without loading full dataset | Ingestion file path | List of column names and DuckDB type definitions (`STRUCT(...)`) | Falls back to standard ingestion on introspect error | Stream 5 Spec (`JsonSchemaIntrospector.ts`) |
| 18 | Direct Ingest | Phase 2 Recursive Struct Unpacking | Unpacks nested `STRUCT` fields into dot-notated projection expressions | Column name & nested `STRUCT` type definition | Array of projections: `"col"."sub1"."sub2" AS "col.sub1.sub2"` | Leaves primitive non-struct columns unchanged | Stream 6 Spec (`JsonStreamingFlattener.ts`) |
| 19 | Direct Ingest | Direct Streaming to Parquet | Copies unpacked projection directly into ZSTD-compressed Parquet | Source file path, destination parquet path, projection list | Flattened `.parquet` file with zero duplicate columns | Falls back to `all_varchar = true` on unresolvable type error | Stream 6 Spec (`JsonStreamingFlattener.ts`) |
| 20 | Native SIMD | Rust Native SIMD Flattener | High-throughput fallback for gigantic JSON files (`> 5GB`) converting NDJSON at `> 500 MB/s` | Large JSON/NDJSON file | Flattened NDJSON / Arrow IPC Stream | Returns non-zero exit code on corrupt stream | Stream 7 Spec (`toad-core-rust`) |
| 21 | QA & Parity | EVTX Record 93937 Schema Parity | Validates 100% leaf field extraction parity against Windows System.evtx | `System.evtx` RecordID 93937 | Verified fields: `EventID: 7036`, `param1: "Microsoft Passport Container"`, `param2: "stopped"`, `Binary`, `#attributes`, `#text` | Test assertion failure on missing/mismatched leaf | Stream 9 Spec (`test_realworld_evtx_json.js`) |
| 22 | QA & Fuzzing | Adversarial JSON Fuzzing Suite | Validates engine resilience against 100+ deformed JSON patterns | Corrupt JSON, deep nesting (>100 levels), quotes in keys, nulls | Engine handles gracefully without crash | Reports syntax errors safely to UI | Stream 8 Spec (`test_json_adversarial_fuzz.js`) |

---

## 3. Edge Cases & Observed Engine Behaviors

| # | Feature | Input | Observed Behavior |
|---|---------|-------|-------------------|
| 1 | DuckDB JSON Path | `$["Event"]["System"]["EventID"]["#text"]` (Bracket notation with strings) | **Binder Error:** `JSON path error near '["Event"]'`. DuckDB v1.0.0 JSONPath parser only supports integers inside brackets for array indices (`$[0]`). |
| 2 | DuckDB JSON Path | `$."Event"."System"."EventID"."#text"` (Quoted dot notation) | **PASS:** DuckDB extracts leaf value `"7036"` cleanly. Fully immune to `#`, `@`, spaces, dots, slashes. |
| 3 | DuckDB JSON Path | `RawEvent->'Event'->'System'->'EventID'->>'#text'` (Arrow operators) | **PASS:** Extracts string `"7036"` natively without JSONPath syntax parsing overhead. |
| 4 | Special Characters | Key containing dot: `{"Special.Key": "DotValue"}` with `$."Special.Key"` | **PASS:** Returns `"DotValue"`. Dot inside double quotes is treated as literal character, not path separator. |
| 5 | Special Characters | Key containing space: `{"Space Key": "SpaceValue"}` with `$."Space Key"` | **PASS:** Returns `"SpaceValue"`. |
| 6 | Special Characters | Key containing slash: `{"Slash/Key": "SlashValue"}` with `$."Slash/Key"` | **PASS:** Returns `"SlashValue"`. |
| 7 | Special Characters | Key containing double quote: `{"Quote\"Key": "QuoteValue"}` | **PASS:** When escaped as `$."Quote\"Key"` (or `\"` inside SQL string literal), returns `"QuoteValue"`. |
| 8 | Special Characters | Key containing single quote: `{"Single'Key": "SingleQuoteValue"}` | **PASS:** In SQL string literal, doubled as `''`: `$."Single''Key"`. Returns `"SingleQuoteValue"`. |
| 9 | XML Metadata Tags | `#attributes` and `#text` in EVTX: `{"EventID": {"#text": 7036}}` | **PASS:** `$."EventID"."#text"` resolves to `7036`; `TRY_CAST(... AS BIGINT)` produces `7036n`. |
| 10 | XML Namespace | Root `@xmlns`: `{"@xmlns": "http://schemas..."}` | **PASS:** `$."@xmlns"` returns `"http://schemas..."`. No syntax collision with `@`. |
| 11 | `TRY_CAST` Corrupt Data | Extracted value `"stopped"` cast to `BIGINT`: `TRY_CAST('stopped' AS BIGINT)` | **PASS:** Evaluates to `NULL`. Query succeeds without terminating or corrupting view. |
| 12 | Direct Ingestion STRUCT | Nested STRUCT: `Event STRUCT(System STRUCT(EventID STRUCT("#text" BIGINT)))` | **PASS:** Projection `"Event"."System"."EventID"."#text" AS "Event.System.EventID.#text"` executes natively in `read_json_auto` and writes to Parquet. |
| 13 | Direct Ingestion Non-STRUCT | Flat JSON file without `STRUCT` columns | **PASS:** Direct ingestion bypasses Phase 2 dynamic projection and uses default `SELECT * FROM read_json_auto(...)`. |
| 14 | Column Name Collision | Existing table has column `EventID`; extraction extracts `EventID` | **PASS:** Query generator applies `* EXCLUDE ("EventID")` to avoid duplicate column name error in DuckDB. |
| 15 | View Latency Budget | `CREATE VIEW` with 7+ complex nested JSON extractions and `TRY_CAST` | **PASS:** Measured latency: **1.489 ms - 1.693 ms** (Target: `< 15ms`). Meets latency budget with >8x margin. |

---

## 4. Frozen Interface Definitions (`NestedJsonContracts.ts`)

File location: `packages/toadviewer/src/types/NestedJsonContracts.ts` (monorepo path: `tad-master/packages/toadviewer/src/types/NestedJsonContracts.ts`).

```typescript
/**
 * NestedJsonContracts.ts
 * Authoritative Frozen Interface Definitions for TOAD v2.5.1 Nested JSON Parser & Auto-Flattening
 */

export type InferredDuckDbType =
  | "BIGINT"
  | "INTEGER"
  | "DOUBLE"
  | "BOOLEAN"
  | "TIMESTAMP"
  | "VARCHAR";

export interface DiscoveredLeafField {
  /** Original hierarchical segment array: ["Event", "System", "EventID", "#text"] */
  readonly pathSegments: string[];

  /** Default hierarchical dot-notation display name: "Event.System.EventID.#text" */
  readonly dotPath: string;

  /** User-customized column name (defaults to dotPath, editable in UI) */
  customColName: string;

  /**
   * DuckDB-safe JSON path extraction expression:
   * e.g. '$."Event"."System"."EventID"."#text"'
   */
  readonly jsonPathExpr: string;

  /** Sample representation value from preview scan */
  readonly sampleValue: string;

  /** Automatically inferred DuckDB data type */
  inferredType: InferredDuckDbType;

  /** Occurrence rate across scanned sample rows (0.0 - 100.0%) */
  readonly fillRate: number;

  /** Column extraction toggle status (default: true) */
  enabled: boolean;
}

export interface JsonScanOptions {
  /** Maximum sample rows to scan (100 for fast preview, 1000 for deep scan) */
  sampleLimit: number;

  /**
   * Whether to preserve arrays as stringified JSON representations (default: false).
   * When false, arrays are kept as stringified VARCHARs without row explosion.
   */
  flattenArrays: boolean;

  /** Maximum recursion depth limit (default: undefined = unlimited) */
  maxDepth?: number;
}

export interface JsonSqlGenerationResult {
  /** Complete CREATE VIEW SQL DDL statement */
  readonly createViewSql: string;

  /** Total number of enabled output columns */
  readonly activeColumnCount: number;

  /** Mapping from source JSON path expressions to target column aliases */
  readonly columnMappings: Array<{
    sourcePath: string;
    outputColumn: string;
    targetType: InferredDuckDbType;
  }>;
}

// Supporting contracts for Ingestion Introspection (Stream 5 & Stream 6)
export interface DuckDbStructField {
  readonly fieldName: string;
  readonly fieldType: string;
  readonly isStruct: boolean;
  readonly children?: DuckDbStructField[];
}

export interface IngestDynamicProjectionResult {
  readonly hasStructColumns: boolean;
  readonly projectionExpressions: string[];
  readonly finalColumnNames: string[];
}
```

---

## 5. DuckDB JSON Path Extraction Syntax & Escaping Rules

### 5.1. Syntax Investigation & Empirical Engine Validation

Our specification probing against the authoritative DuckDB v1.0.0 engine yielded a critical finding:
- **Conceptual plan syntax (`$["Event"]["System"]`):** Fails in DuckDB with `Binder Error: JSON path error near '["Event"]'`. DuckDB's internal JSONPath parser reserves `[...]` exclusively for array indexing (`$[0]`).
- **Authoritative DuckDB Quoted Dot Path (`$."Event"."System"`):** Passes 100% cleanly across all standard and special characters.
- **Alternative Operator Path (`RawEvent->'Event'->'System'->>'#text'`):** Also passes 100% cleanly.

### 5.2. Escaping Rules for Special Characters

To guarantee 100% immunity to SQL parsing and identifier errors:

1. **Inside JSON Path Expression (`$."seg1"."seg2"`):**
   - Segments are enclosed in double quotes: `."<segment>"`
   - Double quotes inside segment names (`"`) are escaped with backslash `\"`:
     `$."Event"."System"."Quote\"Key"`
   - In TypeScript generator:
     ```typescript
     export function buildSafeDuckDbJsonPath(segments: string[]): string {
       return '$' + segments.map(s => `."${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join('');
     }
     ```
2. **Inside SQL String Literals (Single-Quote Escaping):**
   - In DuckDB SQL, the entire path is a string literal passed to `json_extract_string(...)`.
   - Any single quote (`'`) in a segment or expression must be doubled (`''`):
     ```typescript
     const sqlLiteral = pathExpr.replace(/'/g, "''");
     ```
3. **Inside Column Aliases (Double-Quote Escaping):**
   - All output column aliases must be wrapped in double quotes: `"Event.System.EventID.#text"`
   - Any double quote (`"`) inside an alias must be doubled (`""`):
     ```typescript
     const safeColAlias = `"${alias.replace(/"/g, '""')}"`;
     ```
4. **Data Type Casting via `TRY_CAST`:**
   - Primitives other than `VARCHAR` are wrapped in `TRY_CAST`:
     ```sql
     TRY_CAST(json_extract_string("RawEvent", '$."Event"."System"."EventID"."#text"') AS BIGINT) AS "Event.System.EventID.#text"
     ```
   - For `VARCHAR`, `TRY_CAST` is omitted for optimal performance:
     ```sql
     json_extract_string("RawEvent", '$."Event"."System"."Provider"."#attributes"."Name"') AS "Event.System.Provider.#attributes.Name"
     ```

### 5.3. Latency Budget Verification

- **Requirement:** `CREATE VIEW` latency budget `< 15ms`.
- **Observed Probe Latency:** **1.489 ms** to **1.693 ms** for 7+ deeply nested fields with `TRY_CAST`.
- **Margin:** > 800% under budget.

---

## 6. Direct Ingestion Two-Phase Dynamic Projection (`csvimport.ts`)

File location: `packages/reltab-duckdb/src/csvimport.ts` (monorepo path: `tad-master/packages/reltab-duckdb/src/csvimport.ts`).

### 6.1. Architecture Workflow

```mermaid
sequenceDiagram
    participant User
    participant CsvImport as csvimport.ts
    participant DuckDB as DuckDB Engine
    participant Parquet as Destination Parquet

    User->>CsvImport: Drag & drop .json / .jsonl file
    CsvImport->>DuckDB: Phase 1: DESCRIBE SELECT * FROM read_json_auto(path, sample_size = 2048) LIMIT 0;
    DuckDB-->>CsvImport: Schema rows (column_name, column_type)
    
    alt Contains STRUCT columns
        CsvImport->>CsvImport: Parse STRUCT tree recursively to leaf paths
        CsvImport->>CsvImport: Generate projection list ("Event"."System"."#text" AS "Event.System.#text")
        CsvImport->>DuckDB: Phase 2: COPY (SELECT <projections> FROM read_json_auto(path, ignore_errors=true)) TO 'dst.parquet'
        DuckDB->>Parquet: Stream flattened columns directly into Parquet
    else No STRUCT columns (Flat JSON)
        CsvImport->>DuckDB: Standard COPY (SELECT * FROM read_json_auto(path)) TO 'dst.parquet'
        DuckDB->>Parquet: Stream original columns
    end
    
    CsvImport->>DuckDB: CREATE VIEW from Parquet file
    CsvImport-->>User: Table ready for instant Pivot/Filter/Sort (0ms)
```

### 6.2. Phase 1: Schema Introspection Spec

Query:
```sql
DESCRIBE SELECT * FROM read_json_auto('${safeSrc}', sample_size = 2048) LIMIT 0;
```
Introspection parser traverses `column_type` string:
- If `column_type` does not start with `STRUCT(`, column is passed through:
  `"${colName}" AS "${colName}"`
- If `column_type` starts with `STRUCT(`, recursive unpack parser splits nested fields, tracking segment path hierarchy:
  e.g. `colName: "Event"`, path: `["System", "EventID", "#text"]`.

### 6.3. Phase 2: Projection Generation & Parquet COPY Spec

Generated projection items format:
```sql
"Event"."System"."EventID"."#text" AS "Event.System.EventID.#text",
"Event"."System"."Provider"."#attributes"."Name" AS "Event.System.Provider.#attributes.Name",
"Event"."EventData"."param1" AS "Event.EventData.param1"
```
Execution statement:
```sql
COPY (
  SELECT
    "Event"."System"."EventID"."#text" AS "Event.System.EventID.#text",
    "Event"."System"."Provider"."#attributes"."Name" AS "Event.System.Provider.#attributes.Name",
    "Event"."EventData"."param1" AS "Event.EventData.param1"
  FROM read_json_auto('${safeSrc}', sample_size = 2048, ignore_errors = true)
) TO '${safeDst}' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 100000);
```

Empirical probe verified:
Parquet file generated via this query reads back 100% of flattened columns with perfect types.

---

## 7. Real-World Windows EVTX JSON Parity Requirements

### 7.1. Target Test Record: RecordID 93937

- **Source File:** `d:\Shared_UserData\Downloads\tad\data_sample\System.evtx`
- **Target Event ID:** `7036` (Service Control Manager status transition)
- **TimeCreated:** `2026-10-27T14:44:08.819818Z` (ISO-8601 UTC RFC3339, 6 fractional digits)
- **Computer:** `WIN-3MJ9DEQ5B94`
- **Provider:** `Service Control Manager`
- **Service Name (`param1`):** `Microsoft Passport Container`
- **Service State (`param2`):** `stopped`
- **Binary Payload:** `4E0067006300430074006E0072005300760063002F0031000000`

### 7.2. EVTX JSON Leaf Hierarchy Parity Table

| Leaf Dot Path | Expected Data Type | RecordID 93937 Value | DuckDB Extractor Expression |
| :--- | :--- | :--- | :--- |
| `Event.@xmlns` | `VARCHAR` | `"http://schemas.microsoft.com/win/2004/08/events/event"` | `json_extract_string(RawEvent, '$."Event"."@xmlns"')` |
| `Event.System.Provider.#attributes.Name` | `VARCHAR` | `"Service Control Manager"` | `json_extract_string(RawEvent, '$."Event"."System"."Provider"."#attributes"."Name"')` |
| `Event.System.Provider.#attributes.Guid` | `VARCHAR` | `"{555908d1-a6d7-4695-8e1e-26931b2012f4}"` | `json_extract_string(RawEvent, '$."Event"."System"."Provider"."#attributes"."Guid"')` |
| `Event.System.EventID.#attributes.Qualifiers` | `BIGINT` | `16384` | `TRY_CAST(json_extract_string(RawEvent, '$."Event"."System"."EventID"."#attributes"."Qualifiers"') AS BIGINT)` |
| `Event.System.EventID.#text` | `BIGINT` | `7036` | `TRY_CAST(json_extract_string(RawEvent, '$."Event"."System"."EventID"."#text"') AS BIGINT)` |
| `Event.System.TimeCreated.#attributes.SystemTime` | `TIMESTAMP` | `"2026-10-27T14:44:08.819818Z"` | `TRY_CAST(json_extract_string(RawEvent, '$."Event"."System"."TimeCreated"."#attributes"."SystemTime"') AS TIMESTAMP)` |
| `Event.System.EventRecordID` | `BIGINT` | `93937` | `TRY_CAST(json_extract_string(RawEvent, '$."Event"."System"."EventRecordID"') AS BIGINT)` |
| `Event.System.Computer` | `VARCHAR` | `"WIN-3MJ9DEQ5B94"` | `json_extract_string(RawEvent, '$."Event"."System"."Computer"')` |
| `Event.EventData.param1` | `VARCHAR` | `"Microsoft Passport Container"` | `json_extract_string(RawEvent, '$."Event"."EventData"."param1"')` |
| `Event.EventData.param2` | `VARCHAR` | `"stopped"` | `json_extract_string(RawEvent, '$."Event"."EventData"."param2"')` |
| `Event.EventData.Binary` | `VARCHAR` | `"4E0067006300430074006E0072005300760063002F0031000000"` | `json_extract_string(RawEvent, '$."Event"."EventData"."Binary"')` |

---

## 8. 10 Work Streams Parallel Execution Plan & Quality Gates

### 8.1. Stream Ownership Matrix (Zero Conflict)

| Stream | Role | Responsibilities | Assigned File Boundaries |
|:---|:---|:---|:---|
| **Stream 1** | Core Algorithm Engineer | Recursive JSON traversal, leaf node extraction, segment array generation, array stringification | `packages/toadviewer/src/utils/NestedJsonTraverser.ts`<br/>`tests/unit/test_nested_traverser.js` |
| **Stream 2** | UI/UX Components Engineer | Discovered fields table UI, inline column rename, real-time search filter, select all/invert | `packages/toadviewer/src/components/NestedFieldsTable.tsx`<br/>`packages/toadviewer/less/nested-dialog.less` |
| **Stream 3** | Async Scan Worker Engineer | Sliding sample scanner (100 rows default cache, 1,000 rows deep scan async worker with progress indicator) | `packages/toadviewer/src/workers/SampleScanWorker.ts`<br/>`packages/toadviewer/src/components/SampleScanController.tsx` |
| **Stream 4** | DuckDB SQL Architect | Safe SQL VIEW generator, quoted dot path builder, `TRY_CAST` typing, column collision exclusion | `packages/toadviewer/src/utils/DuckDbJsonSqlBuilder.ts`<br/>`tests/unit/test_duckdb_json_builder.js` |
| **Stream 5** | Ingest Schema Engineer | Phase 1 schema introspection, `read_json_auto` schema parsing for `STRUCT` columns | `packages/reltab-duckdb/src/json/JsonSchemaIntrospector.ts`<br/>`tests/unit/test_json_schema_introspect.js` |
| **Stream 6** | Ingest Pipeline Engineer | Phase 2 unpack projection generation, streaming `COPY (...) TO Parquet` execution, fallback handling | `packages/reltab-duckdb/src/json/JsonStreamingFlattener.ts`<br/>`tests/unit/test_json_streaming_flattener.js` |
| **Stream 7** | Rust Core Systems Engineer | High-speed SIMD flattener fallback for `> 5GB` files using `simd-json` crate | `packages/toad-core-rust/src/json_flattener.rs`<br/>`packages/toad-core-rust/src/bin/toad-json.rs` |
| **Stream 8** | Adversarial & Security QA | Fuzzing test suite: corrupted JSON, deep recursion (>100 levels), quotes in keys, nulls, injection | `tests/qa/test_json_adversarial_fuzz.js`<br/>`tests/fixtures/fuzz_samples/` |
| **Stream 9** | EVTX Domain Security QA | Real-world validation against `System.evtx` (Record 93937), Sysmon, CloudTrail, 100% leaf parity | `tests/qa/test_realworld_evtx_json.js`<br/>`tests/fixtures/evtx_json_samples/` |
| **Stream 10** | Benchmark & Packaging Staging | Performance benchmark (RAM < 150MB, view creation < 15ms), zero-duplicate binary packaging | `tests/benchmark/test_nested_json_perf.js`<br/>`package_release.ps1` |

### 8.2. Four-Phase Synchronization Milestones

1. **Checkpoint 0 (Day 1 - Contract Freeze):**
   - `NestedJsonContracts.ts` frozen in `packages/toadviewer/src/types/`.
   - Mock test stubs created for all streams.
2. **Checkpoint 1 (Day 2-3 - Independent Dev & Unit Tests):**
   - Streams 1-4 pass unit tests for Parse Columns dialog components.
   - Streams 5-6 pass unit tests for two-phase direct ingestion.
   - Stream 7 completes Rust binary build.
3. **Checkpoint 2 (Day 4 - Cross-Integration Wiring):**
   - `RegexDialog.tsx` integrates Streams 1-4.
   - `csvimport.ts` integrates Streams 5-6.
   - End-to-end integration verified on `System.evtx`.
4. **Checkpoint 3 (Day 5 - Full QA & v2.5.1 Release):**
   - Adversarial fuzzing and EVTX parity suites pass 100%.
   - Full regression suite `node run_tests.js --all` passes 100%.
   - Release version bumped to `2.5.1` with clean packaging.

### 8.3. Automated Test Commands & Quality Gates

#### Test Execution Commands:
```powershell
# Unit Tests (Streams 1, 4, 6)
node-v18.20.4-win-x64\node.exe tests/unit/test_nested_traverser.js
node-v18.20.4-win-x64\node.exe tests/unit/test_duckdb_json_builder.js
node-v18.20.4-win-x64\node.exe tests/unit/test_json_streaming_flattener.js

# Adversarial QA & EVTX Parity (Streams 8, 9)
node-v18.20.4-win-x64\node.exe tests/qa/test_json_adversarial_fuzz.js
node-v18.20.4-win-x64\node.exe tests/qa/test_realworld_evtx_json.js

# Full System Regression Gate
node-v18.20.4-win-x64\node.exe run_tests.js --all
```

#### Quality Gates:
- **Gate 1 (Correctness):** 100% leaf field extraction parity on RecordID 93937 (`Event.System.EventID.#text = 7036`, `param1 = "Microsoft Passport Container"`).
- **Gate 2 (Safety):** 0 syntax or escaping errors with `#attributes`, `#text`, `@xmlns`, periods, spaces, slashes, double quotes, and single quotes.
- **Gate 3 (Latency):** `CREATE VIEW` latency `< 15ms` (measured ~1.5ms); 10,000-line JSON direct ingestion `< 2.0s`.
- **Gate 4 (Zero Regression):** 100% pass rate across all existing test suites.
- **Gate 5 (Packaging):** Clean packaging via `package_release.ps1` with zero duplicate binaries.
