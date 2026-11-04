# Handoff Report: DuckDB JSON Fallback & Caller Ingestion Resilience Fix

**Agent**: worker_m6_fix (Implementer, QA, Specialist)  
**Date**: 2026-11-04  
**Target Milestone**: Milestone 6 Fix (DuckDB JSON Fallback & Ingestion Resilience)  
**Status**: **HARD HANDOFF (COMPLETE & VERIFIED)**

---

## 1. Observation

1. **Defects in `tad-master/packages/reltab-duckdb/src/json/JsonStreamingFlattener.ts` (Lines 216–246)**:
   - Line 230 contained `all_varchar = true` inside `read_json_auto(...)`. DuckDB v1.0.0 rejects `all_varchar` for `read_json_auto` with:
     ```
     Binder Error: Invalid named parameter "all_varchar" for function read_json_auto
     ```
   - Line 235 executed `await execQuery(dbConn, allVarcharQuery)` nakedly without a `try...catch` wrapper. Any failure (including DuckDB parameter binder errors or binary corruption) caused an unhandled promise rejection.
   - Line 218 log string read:
     `[JsonStreamingFlattener] Standard stream failed, falling back to all_varchar tier:`

2. **Caller Fragility in `tad-master/packages/reltab-duckdb/src/csvimport.ts`**:
   - `streamJsonToParquet` (lines 3002–3018) called `streamFlattenedJsonToParquet` without diagnostic logging on rejection.
   - EVTX `tempJsonl` cleanup (lines 3508–3513) unlinked the temporary JSONL file only upon successful completion. If `streamJsonToParquet` failed, the unlink was bypassed, permanently leaking intermediate JSONL files on disk in `cfg.temp_dir`.
   - `nativeCSVImport` catch block (lines 3599–3639) caught streaming errors and unconditionally fell through into the in-memory CSV import block (`// ===== CHẾ ĐỘ IN-MEMORY FALLBACK =====`). For JSON/JSONL/NDJSON files, DuckDB's CSV sniffer misparsed JSON commas as column delimiters (silent data corruption) or threw `CSV reader does not support null characters` on binary data, masking the true root error.

3. **Compilation & Build Execution**:
   - Command: `& "..\..\..\node-v18.20.4-win-x64\npm.cmd" run build` in `tad-master/packages/reltab-duckdb`
   - Invocation: `tsc -p tsconfig-build.json`
   - Result: Exit code 0, 0 errors, clean TypeScript build.

4. **Empirical Adversarial Challenger 2 Test Suite**:
   - Command: `.\node-v18.20.4-win-x64\node.exe tests/qa/test_extreme_adversarial_challenger2.js`
   - Result: `Empirical Challenger 2 Summary: 61 Passed, 0 Failed (100% PASS)`
   - Verified: Section 4.4.1 confirmed DuckDB rejects `all_varchar`, Section 4.2.1 confirmed corrupted streams survive without unhandled rejections, Section 7.1.1 confirmed 0 unhandled promise rejections, Section 7.1.2 confirmed 0 uncaught exceptions.

5. **JSON Streaming Flattener Unit Suite**:
   - Command: `.\node-v18.20.4-win-x64\node.exe tests/unit/test_json_streaming_flattener.js`
   - Result: `Total tests: 46 | Passed: 46 | Failed: 0`

6. **Real-World EVTX JSON Parity Suite**:
   - Command: `.\node-v18.20.4-win-x64\node.exe tests/qa/test_realworld_evtx_json.js`
   - Result: `EVTX Parity QA Summary: 35 Passed, 0 Failed` (RecordID 93937 parity confirmed).

7. **Adversarial & Fuzzing Suite**:
   - Command: `.\node-v18.20.4-win-x64\node.exe tests/qa/test_json_adversarial_fuzz.js`
   - Result: `Adversarial QA Summary: 40 Passed, 0 Failed`.

8. **Full Master Regression Suite**:
   - Command: `.\node-v18.20.4-win-x64\node.exe run_tests.js --all`
   - Result: `RESULT: ALL TEST SUITES PASSED CLEANLY (100% HEALTHY)` across all 14 suites in 45.81s.

---

## 2. Logic Chain

1. **Step 1 (Eliminating the Invalid DuckDB Parameter)**:
   From Observation 1, DuckDB v1.0.0 table function `read_json_auto()` does not support `all_varchar`. Removing `all_varchar = true` and using default auto-detection with `sample_size = ${sampleSize}`, `ignore_errors = true`, and `maximum_object_size = 67108864` (64 MB buffer for large event payloads) restores native, valid DuckDB JSON execution in Tier 2.
2. **Step 2 (Preventing Unhandled Promise Rejections)**:
   From Observation 1, wrapping `await execQuery(dbConn, fallbackQuery)` in a `try...catch (fbErr: any)` block with `log.warn` and rethrowing ensures that if all three tiers fail (e.g. unparseable binary data), the error is logged cleanly with contextual metadata and thrown as a handled rejection.
3. **Step 3 (Diagnostic Logging in Caller)**:
   From Observation 2, adding a `try...catch` wrapper in `streamJsonToParquet` in `csvimport.ts` logs diagnostic details with the file path when streaming fails before propagating the rejection.
4. **Step 4 (Guaranteed Disk Cleanup)**:
   From Observation 2, wrapping EVTX `await streamJsonToParquet(dbConn, tempJsonl, targetParquetPath, cfg)` in a `try...finally` block guarantees that `tempJsonl` is unlinked even when streaming throws, preventing file leaks in `cfg.temp_dir`.
5. **Step 5 (Format-Specific Guards Against CSV Fallthrough)**:
   From Observation 2, inserting format checks in `nativeCSVImport`:
   - For `.evtx`: immediately throws a descriptive error (`Failed to ingest EVTX file...`), never feeding raw binary EVTX to `read_csv()`.
   - For `[".json", ".jsonl", ".ndjson"]`: attempts an in-memory JSON fallback (`CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_json_auto('${safePath}', ignore_errors = true)`). If this also fails, throws `Failed to parse JSON file...`, completely eliminating the possibility of JSON files falling through into `read_csv()`.
6. **Step 6 (Verification & Regression Safety)**:
   Observations 3, 4, 5, 6, 7, and 8 prove that after applying these minimal, targeted changes, all unit tests, all adversarial Challenger 2 stress tests, and all 14 master regression suites pass with 100% success and zero regressions.

---

## 3. Caveats

- **No Caveats**: The modifications strictly adhered to the minimal change principle, touched only the two owned files (`JsonStreamingFlattener.ts` and `csvimport.ts`), complied with all project conventions, and introduced zero binary duplicates or VCS artifacts.

---

## 4. Conclusion

The technical remediation for Milestone 6 is complete and fully verified:
1. `tad-master/packages/reltab-duckdb/src/json/JsonStreamingFlattener.ts`:
   - Line 9: docstring updated to `resilient auto stream`.
   - Line 218: log updated to `Tier 2 resilient stream`.
   - Lines 223–249: illegal `all_varchar = true` removed, replaced with valid auto-detection (`sample_size`, `ignore_errors = true`, `maximum_object_size = 67108864`), wrapped in `try...catch` with `log.warn` and clean rethrow.
2. `tad-master/packages/reltab-duckdb/src/csvimport.ts`:
   - Lines 3011–3025: Added diagnostic `log.warn` in `streamJsonToParquet`.
   - Lines 3516–3524: Wrapped EVTX `tempJsonl` deletion in `finally` block to prevent disk leakage.
   - Lines 3640–3662: Added format guards for `.evtx` and JSON extensions, preventing fallthrough into `read_csv` and implementing in-memory JSON fallback.
3. All verification suites (61/61 Challenger 2, 46/46 Flattener unit, 35/35 EVTX Parity, 40/40 Fuzzing, 100% full regression) PASS.

---

## 5. Verification Method

To independently reproduce and verify this work:

1. **Rebuild `reltab-duckdb`**:
   ```powershell
   cd tad-master\packages\reltab-duckdb
   & "..\..\..\node-v18.20.4-win-x64\npm.cmd" run build
   cd ..\..\..
   ```
   *Expected*: Exits with code 0.

2. **Run Adversarial Challenger 2 Test**:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe tests/qa/test_extreme_adversarial_challenger2.js
   ```
   *Expected*: `61 Passed, 0 Failed` (100% PASS).

3. **Run Flattener Unit Suite**:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe tests/unit/test_json_streaming_flattener.js
   ```
   *Expected*: `Total tests: 46 | Passed: 46 | Failed: 0`.

4. **Run EVTX Parity QA Suite**:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe tests/qa/test_realworld_evtx_json.js
   ```
   *Expected*: `EVTX Parity QA Summary: 35 Passed, 0 Failed`.

5. **Run Master Regression Test Suite**:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe run_tests.js --all
   ```
   *Expected*: `RESULT: ALL TEST SUITES PASSED CLEANLY (100% HEALTHY)`.

6. **Invalidation Conditions**:
   - Any recurrence of `Binder Error: Invalid named parameter "all_varchar"`.
   - Any unhandled promise rejection or unhandled crash when ingesting malformed JSON.
   - Any fallthrough of JSON/EVTX files into `read_csv()`.
