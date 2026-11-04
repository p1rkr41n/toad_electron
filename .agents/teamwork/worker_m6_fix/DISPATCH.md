# Dispatch: Worker M6 Fix (DuckDB JSON Fallback & Ingestion Resilience)

## Mission
Implement the technical remediation formulated by Explorers 1, 2, and 3:
1. `tad-master/packages/reltab-duckdb/src/json/JsonStreamingFlattener.ts`:
   - Replace lines 223–246: remove illegal `all_varchar = true`, use default auto-detection with `sample_size = ${sampleSize}`, `ignore_errors = true`, and `maximum_object_size = 67108864`.
   - Wrap `await execQuery(dbConn, fallbackQuery)` in a `try...catch` block with `log.warn` and rethrow to eliminate unhandled promise rejections.
   - Update line 218 log message to `Tier 2 resilient stream`.
2. `tad-master/packages/reltab-duckdb/src/csvimport.ts`:
   - Line 3002: Add diagnostic logging to `streamJsonToParquet`.
   - Lines 3508–3513: Wrap EVTX `tempJsonl` deletion in a `finally` block to prevent temporary file leakage on disk.
   - Lines 3628–3655: In `nativeCSVImport`, insert format-specific guards for `.evtx` and `[".json", ".jsonl", ".ndjson"]` to prevent fallthrough into `read_csv`, adding in-memory JSON fallback or descriptive errors.
3. Build & Verify:
   - Run `npm run build` in `tad-master/packages/reltab-duckdb`.
   - Run `node-v18.20.4-win-x64\node.exe tests/qa/test_extreme_adversarial_challenger2.js` (must pass 61/61 PASS).
   - Run `node-v18.20.4-win-x64\node.exe tests/unit/test_json_streaming_flattener.js`.
   - Run `node-v18.20.4-win-x64\node.exe tests/qa/test_realworld_evtx_json.js`.
   - Run `node-v18.20.4-win-x64\node.exe tests/qa/test_json_adversarial_fuzz.js`.
   - Run `node-v18.20.4-win-x64\node.exe run_tests.js --all`.

## Inputs
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\PROJECT.md`
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\orchestrator\DEAD_ENDS.md`
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m6_fix_1\handoff.md`
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m6_fix_2\handoff.md`
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m6_fix_3\handoff.md`

## Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Write Ownership
- `tad-master/packages/reltab-duckdb/src/json/JsonStreamingFlattener.ts`
- `tad-master/packages/reltab-duckdb/src/csvimport.ts`

Report results to `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m6_fix\handoff.md`.
