# Handoff Report — TOAD v2.5.1 Nested JSON Parser & Auto-Flattening Specification Survey

## 1. Observation

1. **Source Directives & Documents:**
   - `C:\Users\huydq\.gemini\antigravity\brain\489b863f-84dc-4fd6-bbfb-142488ba4d23\ke_hoach_phat_trien_nested_json_parser.md` (165 lines). Line 102 states:
     ```sql
     -- An toàn tuyệt đối với mọi ký tự: #, @, dấu chấm, khoảng trắng
     TRY_CAST(json_extract_string(RawEvent, '$["Event"]["System"]["EventID"]["#text"]') AS BIGINT) AS "Event.System.EventID.#text",
     json_extract_string(RawEvent, '$["Event"]["System"]["Provider"]["#attributes"]["Name"]') AS "Event.System.Provider.#attributes.Name"
     ```
   - `C:\Users\huydq\.gemini\antigravity\brain\489b863f-84dc-4fd6-bbfb-142488ba4d23\phuong_an_trien_khai_va_kiem_thu_song_song_nested_json.md` (246 lines) specifies the 10 work streams, frozen interface contracts (`packages/toadviewer/src/types/NestedJsonContracts.ts`), and 4-phase synchronization roadmap.
   - `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md` (87 lines) lines 57-69 defines R1 to R5 and acceptance criteria.

2. **Existing Codebase State:**
   - `tad-master/packages/toadviewer/src/components/RegexDialog.tsx` currently only supports top-level extraction and regex extraction (`actions.ts` L1312-L1325 uses `json_extract_string(${targetColForExtract}, '$."${escapedKey}"')`).
   - `tad-master/packages/reltab-duckdb/src/csvimport.ts` (L2968-L3008 `streamJsonToParquet`) executes a single-pass `COPY (SELECT * FROM read_json_auto(...)) TO 'dst.parquet'` without unpacking nested `STRUCT(...)` columns.
   - `tests/test_evtx_parsing_schema.js` (L201-L260) establishes ground-truth parity for `System.evtx` RecordID 93937 (`EventID: 7036`, `param1: "Microsoft Passport Container"`, `param2: "stopped"`, `Binary: "4E0067006300430074006E0072005300760063002F0031000000"`).

3. **DuckDB v1.0.0 Engine Probes (Observed via `node-v18.20.4-win-x64\node.exe`):**
   - Executing `SELECT json_extract_string(RawEvent, '$["Event"]')` produces verbatim:
     `Binder Error: JSON path error near '["Event"]'`
     DuckDB's JSON extension parser rejects string property indexing in square brackets (reserving `[...]` for array indices like `$[0]`).
   - Executing `SELECT json_extract_string(RawEvent, '$."Event"."System"."EventID"."#text"')` succeeds with verbatim result:
     `{"res":"7036"}`
   - Executing `SELECT RawEvent->'Event'->'System'->'EventID'->>'#text'` succeeds with verbatim result:
     `{"res":"7036"}`
   - Executing special character paths `$."Special.Key"`, `$."Space Key"`, `$."Slash/Key"`, `$."Quote\"Key"`, `$."Single''Key"` succeeds 100%.
   - Executing `CREATE VIEW` with 7 nested JSON extractions and `TRY_CAST` completed in **1.489 ms - 1.693 ms**, well within the `< 15ms` latency budget.
   - Executing Phase 1 `DESCRIBE SELECT * FROM read_json_auto(...)` yields DuckDB type `STRUCT(...)`.
   - Executing Phase 2 `COPY (SELECT "Event"."System"."EventID"."#text" AS "Event.System.EventID.#text", ... FROM read_json_auto(...)) TO 'test.parquet'` generates a flattened Parquet file with 10 flattened columnar fields.

---

## 2. Logic Chain

1. From Observation 1, the implementation plan specifies bracket paths `$["..."]` to avoid syntax errors caused by special characters like `#attributes` and `#text`.
2. From Observation 3, running `$["Event"]` in DuckDB v1.0.0 results in `Binder Error: JSON path error near '["Event"]'`. Therefore, generating literal square brackets around string keys will cause all view creation queries to fail in DuckDB.
3. From Observation 3, DuckDB v1.0.0 natively and safely handles all special characters (`#`, `@`, `.`, ` `, `/`, `"`, `'`) when using quoted dot notation: `$."segment1"."segment2"` or arrow operators `RawEvent->'segment1'->>'leaf'`.
4. Therefore, the TypeScript SQL builder (`DuckDbJsonSqlBuilder.ts`) must generate either quoted dot notation (`$."Event"."System"."EventID"."#text"`) or translate bracket segments into quoted dot notation while preserving the contract property `jsonPathExpr`.
5. From Observation 2 and Observation 3, direct ingestion in `csvimport.ts` can be upgraded from raw `SELECT * FROM read_json_auto(...)` to the two-phase dynamic projection:
   - Phase 1: `DESCRIBE SELECT * FROM read_json_auto(...) LIMIT 0;` to introspect STRUCT columns.
   - Phase 2: If STRUCT columns exist, generate `COPY (SELECT "col"."sub1"."leaf" AS "col.sub1.leaf", ... FROM read_json_auto(...)) TO 'dst.parquet'`. If no STRUCT columns exist, fall back to standard `SELECT *`.
6. From Observation 2, RecordID 93937 in `data_sample/System.evtx` serves as the authoritative real-world acceptance baseline.

---

## 3. Caveats

1. DuckDB's `read_json_auto` type inference uses a sample size (default 2048 rows in TOAD). If rare fields only appear after row 2048 in a multi-gigabyte JSON file, Phase 1 `DESCRIBE` might not register them in the STRUCT schema. The Deep Sample Scan (1,000 rows) in UI and the Rust Native SIMD flattener (Stream 7) serve as mitigations.
2. In direct ingestion, column names with dots (`"Event.System.EventID.#text"`) in Parquet are treated as standard column identifiers by DuckDB when double-quoted. All downstream queries must wrap column identifiers in double quotes to prevent DuckDB from interpreting dots as struct field dereferences.

---

## 4. Conclusion

The technical specifications for TOAD v2.5.1 Nested JSON Parser & Auto-Flattening are fully documented and verified against authoritative sources and DuckDB v1.0.0:
1. **Interface Contract:** Frozen in `packages/toadviewer/src/types/NestedJsonContracts.ts` (`InferredDuckDbType`, `DiscoveredLeafField`, `JsonScanOptions`, `JsonSqlGenerationResult`).
2. **Path Extraction & Escaping:** Must use quoted dot notation (`$."segment1"."segment2"`) or arrow operators (`-> / ->>`), as bracket notation (`$["..."]`) is rejected by DuckDB v1.0.0. Latency budget `< 15ms` is confirmed (observed ~1.5ms).
3. **Direct Ingestion Two-Phase Pipeline:** Two-phase dynamic projection in `csvimport.ts` via `DESCRIBE` and recursive STRUCT unpacking via `COPY (SELECT ...) TO Parquet` is confirmed feasible and performant.
4. **EVTX Ground Truth:** System.evtx RecordID 93937 confirmed as authoritative parity benchmark.
5. **Execution Plan:** 10 work streams with clean zero-conflict file ownership and 4 synchronization milestones ready for team dispatch.

---

## 5. Verification Method

1. **Inspect Authoritative Specification Report:**
   - Path: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\spec_miner_json_survey\spec_report.md`
2. **Run DuckDB JSON Syntax & Latency Probe:**
   - Execute:
     ```powershell
     node-v18.20.4-win-x64\node.exe .agents\teamwork\spec_miner_json_survey\probe_duckdb.js
     ```
   - Verify:
     - Binder Error output when testing `$["Event"]`
     - Successful extraction with `$."Event"."System"."EventID"."#text"`
     - Measured `CREATE VIEW` latency `< 15ms`
     - Successful two-phase STRUCT unpacking and Parquet COPY
3. **Inspect Sample EVTX Ground Truth:**
   - Execute:
     ```powershell
     node-v18.20.4-win-x64\node.exe tests/test_evtx_parsing_schema.js
     ```
   - Verify: EVTX.5 passes for RecordID 93937.
