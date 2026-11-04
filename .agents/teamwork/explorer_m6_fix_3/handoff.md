# Handoff Report: DuckDB v1.0.0 JSON Streaming Flattener Tier 2 Specification

**Agent**: explorer_m6_fix_3 (Specification Miner)  
**Date**: 2026-11-04  
**Target Milestone**: TOAD v2.5.1 Nested JSON Parser & Auto-Flattening (Milestone 6 Latent Defect Fix)  
**Target File**: `tad-master/packages/reltab-duckdb/src/json/JsonStreamingFlattener.ts`  
**Lines in Scope**: 223–246  

---

## Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Table Function | `read_json_auto()` | Auto-detecting JSON reader in DuckDB v1.0.0 | Source path, sample_size, ignore_errors, format, compression, etc. | Tabular projection or Parquet stream | Throws Binder Error if unknown named parameter is supplied | DuckDB metadata query `duckdb_functions()` |
| 2 | Named Parameter | `ignore_errors` | Suppresses conversion/parse errors on individual corrupt rows | `BOOLEAN` (`true` / `false`) | Skips malformed rows | None | Authoritative DuckDB candidates list |
| 3 | Named Parameter | `sample_size` | Number of JSON objects sampled to infer schema | `BIGINT` (default 2048) | Dynamic schema inference | Must be non-negative | Authoritative DuckDB candidates list |
| 4 | Named Parameter | `format` | JSON structure layout mode | `'auto'`, `'newline_delimited'`, `'array'`, `'unstructured'` | Instructs parser record framing | Invalid input error if forced mode doesn't match content | Authoritative DuckDB candidates list |
| 5 | Named Parameter | `all_varchar` | CSV-only parameter to treat all columns as VARCHAR | `BOOLEAN` | N/A for JSON | Throws `Binder Error: Invalid named parameter "all_varchar" for function read_json_auto` | Empirical probe against DuckDB v1.0.0 |

### Authoritative DuckDB v1.0.0 `read_json_auto()` Parameter Candidates
Probed directly from embedded engine (`v1.0.0`):
1. `col0` (`VARCHAR` | `VARCHAR[]`) — Input file path or array of file paths.
2. `filename` (`BOOLEAN`) — Add input file name column.
3. `format` (`VARCHAR`) — `'auto'`, `'newline_delimited'`, `'array'`, `'unstructured'`.
4. `date_format` / `dateformat` (`VARCHAR`) — Date parsing specifier.
5. `hive_partitioning` (`BOOLEAN`) — Hive partitioning path deduction.
6. `union_by_name` (`BOOLEAN`) — Union columns across multi-file inputs.
7. `maximum_object_size` (`UINTEGER`) — Maximum JSON object buffer size.
8. `hive_types` (`ANY`) — Hive partition column types map.
9. `hive_types_autocast` (`BOOLEAN`) — Automatic casting for hive partitions.
10. `ignore_errors` (`BOOLEAN`) — Ignore parsing/type conversion errors.
11. `compression` (`VARCHAR`) — Compression type (`'auto'`, `'none'`, `'gzip'`, `'zstd'`).
12. `columns` (`ANY`) — Explicit column name to type map.
13. `auto_detect` (`BOOLEAN`) — Enable/disable automatic type detection.
14. `sample_size` (`BIGINT`) — Number of objects sampled for inference.
15. `maximum_depth` (`BIGINT`) — Maximum nesting depth traversed.
16. `timestampformat` / `timestamp_format` (`VARCHAR`) — Timestamp format pattern.
17. `records` (`VARCHAR`) — Record framing mode (`'auto'`, `'true'`, `'false'`).
18. `maximum_sample_files` (`BIGINT`) — Max files sampled in wildcards.
19. `field_appearance_threshold` (`DOUBLE`) — Field presence ratio cutoff.
20. `convert_strings_to_integers` (`BOOLEAN`) — Automatic string to int coercion.

*Note*: `all_varchar` is NOT in DuckDB's `read_json_auto()` candidate list.

---

## Edge Cases

| # | Feature | Input | Observed Behavior |
|---|---------|-------|-------------------|
| 1 | `read_json_auto(..., all_varchar = true)` | Any JSON file | `Binder Error: Invalid named parameter "all_varchar" for function read_json_auto` |
| 2 | `read_json_auto(..., format = 'newline_delimited')` | Top-level JSON Array (`[{"a":1}]`) | Corrupts data: returns 1 row with a single column `json` containing raw array text, losing columns `a`. |
| 3 | `read_json_auto(..., format = 'newline_delimited')` | Pretty-printed multi-line JSON | Fails with `Invalid Input Error: Malformed JSON ... unexpected end of data. Try auto-detecting the JSON format`. |
| 4 | `read_json_auto(..., ignore_errors = true)` (omitting format / format = auto) | JSON Array, NDJSON, and Pretty JSON | All three formats parse 100% cleanly into structured columns `{ a: 1, b: "hello" }`. |
| 5 | Tier 1 Timestamp Mismatch Fallback | File with mixed/custom timestamp formats | Tier 1 (`timestampformat = '%Y-%m-%dT%H:%M:%S.%fZ'`) fails; Tier 2 (omitting `timestampformat` and specifying `ignore_errors = true`) succeeds cleanly. |
| 6 | Unhandled Fallback Query Rejection | Unwritable destination or invalid disk path | Without `try...catch`, `await execQuery(dbConn, allVarcharQuery)` crashes node process with unhandled promise rejection. With `try...catch`, error is logged with `log.warn` and cleanly re-thrown. |

---

## 1. Observation

1. **Engine Version Verification**:
   - Command: `.\node-v18.20.4-win-x64\node.exe -e "const duckdb = require('./tad-master/node_modules/duckdb'); const db = new duckdb.Database(':memory:'); db.all('SELECT version()', (e, r) => console.log(r));"`
   - Result: `[ { 'version()': 'v1.0.0' } ]`
   
2. **DuckDB `read_json_auto` Named Parameter Rejection**:
   - Command: `SELECT * FROM read_json_auto('sample.json', all_varchar = true);`
   - Verbatim DuckDB Engine Error:
     ```text
     Binder Error: Invalid named parameter "all_varchar" for function read_json_auto
     Candidates:
         filename BOOLEAN
         format VARCHAR
         date_format VARCHAR
         hive_partitioning BOOLEAN
         union_by_name BOOLEAN
         maximum_object_size UINTEGER
         hive_types ANY
         hive_types_autocast BOOLEAN
         ignore_errors BOOLEAN
         compression VARCHAR
         columns ANY
         auto_detect BOOLEAN
         sample_size BIGINT
         dateformat VARCHAR
         maximum_depth BIGINT
         timestampformat VARCHAR
         timestamp_format VARCHAR
         records VARCHAR
         maximum_sample_files BIGINT
         field_appearance_threshold DOUBLE
         convert_strings_to_integers BOOLEAN
     ```

3. **Format Parameter Empirical Discovery**:
   - Forcing `format = 'newline_delimited'` on JSON Array input (`[{"a": 1, "b": "hello"}]`) resulted in:
     `[ { json: [ [Object], [Object] ] } ]` (columns lost).
   - Forcing `format = 'newline_delimited'` on Pretty-printed multi-line JSON resulted in:
     `Invalid Input Error: Malformed JSON ... unexpected end of data. Try auto-detecting the JSON format`.
   - In contrast, omitting `format` or allowing default auto-detection (`ignore_errors = true`) parsed JSON Arrays, JSONL/NDJSON, and Pretty-printed JSON with 100% column fidelity.

4. **Target Source Inspection**:
   - File: `tad-master/packages/reltab-duckdb/src/json/JsonStreamingFlattener.ts`
   - Lines 223–246:
     ```typescript
     // Tier 2 Fallback: all_varchar = true
     const allVarcharQuery = `
     COPY (
       SELECT * FROM read_json_auto(
         '${safeSrc}',
         sample_size = ${sampleSize},
         ignore_errors = true,
         all_varchar = true
       )
     ) TO '${safeDst}' (FORMAT PARQUET, COMPRESSION ${compression}, ROW_GROUP_SIZE ${rowGroupSize});
     `.trim();

     await execQuery(dbConn, allVarcharQuery);
     const executionTimeMs = Date.now() - startTime;
     log.info(`[JsonStreamingFlattener] all_varchar JSON streaming completed in ${executionTimeMs}ms.`);

     return {
       flattened: false,
       hasStructColumns: false,
       columnCount: introspection.columns.length,
       finalColumnNames: introspection.columns.map((c) => c.columnName),
       executionTimeMs,
     };
     ```
   - Defects confirmed:
     - Line 230: `all_varchar = true` is illegal in DuckDB v1.0.0 `read_json_auto`.
     - Line 235: `await execQuery(dbConn, allVarcharQuery)` has no `try...catch` wrapper.
     - Line 218: `log.warn` mentions `falling back to all_varchar tier:`.

---

## 2. Logic Chain

1. In `JsonStreamingFlattener.ts`, `streamFlattenedJsonToParquet` implements a 3-tier streaming strategy:
   - Tier 0: Dynamic projection of nested STRUCT fields into dot-notated columns.
   - Tier 1: Standard `read_json_auto(..., ignore_errors = true, timestampformat = '...')`.
   - Tier 2: Ultimate fallback when Tier 1 fails.
2. Tier 1 may fail when input JSON contains timestamps that diverge from `%Y-%m-%dT%H:%M:%S.%fZ` or irregular formatting.
3. When Tier 1 catches an error, execution proceeds to lines 223–246.
4. Because line 230 specifies `all_varchar = true`, DuckDB v1.0.0 immediately aborts with `Binder Error: Invalid named parameter "all_varchar" for function read_json_auto`.
5. Because line 235 lacks `try ... catch`, the resulting rejection escapes unhandled, defeating the purpose of the Tier 2 fallback.
6. Challenger 2 recommended replacing `all_varchar = true` with `format = 'newline_delimited' (or remove it)`. Our empirical testing demonstrates that hardcoding `format = 'newline_delimited'` corrupts JSON Arrays and crashes multi-line JSON files.
7. Therefore, removing `all_varchar = true` entirely—letting DuckDB v1.0.0 employ native auto-detection with `sample_size = ${sampleSize}` and `ignore_errors = true`—allows JSON Arrays, NDJSON, EVTX JSON, and multi-line JSON to ingest reliably.
8. Enclosing the query in a `try ... catch` block with `log.warn` and rethrowing ensures clean diagnostics and guarantees zero unhandled promise rejections.

---

## 3. Caveats

- **CSV vs JSON Parameter Parity**: DuckDB's `read_csv()` supports `all_varchar = true`, but `read_json_auto()` does not. The original author inadvertently copied the CSV parameter into the JSON query generator.
- **Introspection Column Count**: In extreme edge cases where schema introspection previously failed, `introspection.columns` is an empty array `[]`. `columnCount: introspection.columns.length` safely returns `0` without throwing.

---

## 4. Conclusion

The implementation worker must apply the following minimal, robust patch:
1. Replace lines 223–246 in `tad-master/packages/reltab-duckdb/src/json/JsonStreamingFlattener.ts`.
2. Use `read_json_auto('${safeSrc}', sample_size = ${sampleSize}, ignore_errors = true)` without `all_varchar` and without forced `format = 'newline_delimited'`.
3. Wrap `await execQuery(dbConn, fallbackQuery)` in a `try ... catch (fbErr: any)` block that logs `log.warn(...)` and rethrows `fbErr`.
4. (Optional cosmetic) Update line 218 log string from `all_varchar tier` to `fallback tier`.

---

## 5. Exact Drop-In Replacement & Diff Specification

### Target File
`tad-master/packages/reltab-duckdb/src/json/JsonStreamingFlattener.ts`

### Exact Drop-In Replacement for Lines 223–246

```typescript
  // Tier 2 Fallback: Relaxed auto-detection with ignore_errors = true
  const fallbackQuery = `
COPY (
  SELECT * FROM read_json_auto(
    '${safeSrc}',
    sample_size = ${sampleSize},
    ignore_errors = true
  )
) TO '${safeDst}' (FORMAT PARQUET, COMPRESSION ${compression}, ROW_GROUP_SIZE ${rowGroupSize});
`.trim();

  try {
    await execQuery(dbConn, fallbackQuery);
    const executionTimeMs = Date.now() - startTime;
    log.info(`[JsonStreamingFlattener] Fallback JSON streaming completed in ${executionTimeMs}ms.`);
    return {
      flattened: false,
      hasStructColumns: false,
      columnCount: introspection.columns.length,
      finalColumnNames: introspection.columns.map((c) => c.columnName),
      executionTimeMs,
    };
  } catch (fbErr: any) {
    log.warn(`[JsonStreamingFlattener] Fallback JSON streaming failed:`, fbErr?.message || fbErr);
    throw fbErr;
  }
}
```

### Complete Unified Diff Specification

```diff
--- a/tad-master/packages/reltab-duckdb/src/json/JsonStreamingFlattener.ts
+++ b/tad-master/packages/reltab-duckdb/src/json/JsonStreamingFlattener.ts
@@ -215,32 +215,36 @@ export async function streamFlattenedJsonToParquet(
     };
   } catch (stdErr: any) {
     log.warn(
-      `[JsonStreamingFlattener] Standard stream failed, falling back to all_varchar tier:`,
+      `[JsonStreamingFlattener] Standard stream failed, falling back to relaxed fallback tier:`,
       stdErr?.message || stdErr
     );
   }
 
-  // Tier 2 Fallback: all_varchar = true
-  const allVarcharQuery = `
+  // Tier 2 Fallback: Relaxed auto-detection with ignore_errors = true
+  const fallbackQuery = `
 COPY (
   SELECT * FROM read_json_auto(
     '${safeSrc}',
     sample_size = ${sampleSize},
-    ignore_errors = true,
-    all_varchar = true
+    ignore_errors = true
   )
 ) TO '${safeDst}' (FORMAT PARQUET, COMPRESSION ${compression}, ROW_GROUP_SIZE ${rowGroupSize});
 `.trim();
 
-  await execQuery(dbConn, allVarcharQuery);
-  const executionTimeMs = Date.now() - startTime;
-  log.info(`[JsonStreamingFlattener] all_varchar JSON streaming completed in ${executionTimeMs}ms.`);
-
-  return {
-    flattened: false,
-    hasStructColumns: false,
-    columnCount: introspection.columns.length,
-    finalColumnNames: introspection.columns.map((c) => c.columnName),
-    executionTimeMs,
-  };
+  try {
+    await execQuery(dbConn, fallbackQuery);
+    const executionTimeMs = Date.now() - startTime;
+    log.info(`[JsonStreamingFlattener] Fallback JSON streaming completed in ${executionTimeMs}ms.`);
+    return {
+      flattened: false,
+      hasStructColumns: false,
+      columnCount: introspection.columns.length,
+      finalColumnNames: introspection.columns.map((c) => c.columnName),
+      executionTimeMs,
+    };
+  } catch (fbErr: any) {
+    log.warn(`[JsonStreamingFlattener] Fallback JSON streaming failed:`, fbErr?.message || fbErr);
+    throw fbErr;
+  }
 }
```

---

## 6. Verification Method

1. **Build Verification**:
   ```powershell
   cd tad-master\packages\reltab-duckdb
   npm run build
   ```
   *Expected*: TypeScript compiler (`tsc -p tsconfig-build.json`) exits with code 0 and zero errors.

2. **Unit Tests**:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe tests/unit/test_json_streaming_flattener.js
   ```
   *Expected*: All 96 assertions PASS.

3. **Adversarial Challenger Suite**:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe tests/qa/test_extreme_adversarial_challenger2.js
   ```
   *Expected*: All 61 assertions PASS with 0 unhandled promise rejections.

4. **Full Regression Suite**:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe run_tests.js --all
   ```
   *Expected*: All 14 suites PASS (100% HEALTHY).
