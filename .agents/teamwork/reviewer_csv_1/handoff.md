# Handoff Report: Functional & Schema Correctness Review (Milestones 1–3, R1–R5)

**Agent**: `reviewer_csv_1`  
**Role**: Reviewer & Adversarial Critic (Functional & Schema Reviewer)  
**Date**: 2026-11-03  
**Status**: COMPLETE (Hard Handoff)  
**Verdict**: **APPROVE**  

---

## 1. Observation

Direct code inspections, runtime executions, and adversarial tests produced the following evidence:

### 1.1 CSV Parser Parameters (`ingestWorker.ts` & `csvimport.ts`) — R2
- `tad-master/packages/reltab-duckdb/src/ingestWorker.ts`:
  - Lines 27–32: Reads configuration JSON from `process.argv[4]` and correctly evaluates:
    ```typescript
    const isComplexLog = process.argv[5] === "1" || cfg.isComplex === true;
    ```
    This eliminates the previous flaw where `isComplexLog` was always `undefined` when config was bundled into `argv[4]`.
  - Lines 58–67, 76–84: Safe Profile sets `delim = ','` explicitly, retains `all_varchar = true`, `null_padding = true`, `ignore_errors = true`, and specifies no `escape = ''`.
  - Lines 91–93, 98–109, 120–132, 144–156: Standard CSV fallback sets `defaultDelimClause = isCsv ? "delim = ','," : isTsv ? "delim = '\\t'," : ""`. All tiers (Tier 0, Tier 1, Tier 2, Tier 2b) now explicitly include `all_varchar = true`, preventing native C++ `D_ASSERT(vector.GetType().InternalType() == PhysicalType::VARCHAR)` (`vector.cpp:1859`).
- `tad-master/packages/reltab-duckdb/src/csvimport.ts`:
  - Lines 2781–2783, 2862–2874: Sets `defaultDelimClause = isCsv ? "delim = ','," : isTsv ? "delim = '\\t'," : ""`.
  - Tier 0, Tier 1, and in-memory queries (lines 2862–2924, 3684–3703) enforce `delim = ','`, retain `all_varchar = true`, and completely eradicate `escape = ''`, restoring RFC-4180 double-quote escaping `""`.

### 1.2 Gateway Cache Validation & Misparsed Parquet Eviction — R1
- `tad-master/packages/reltab-duckdb/src/csvimport.ts`:
  - Lines 2392–2419: Implements `isParquetFileMisparsedSync(parquetPath: string): boolean`. Reads Thrift FileMetaData at `stat.size - 8` (checking magic bytes `PAR1`), parses schema strings from the footer, and detects `/column0*\d+/i` or comma-separated column 0 headers (`/Timestamp,EventTime/i` or `/,\w+,/i`).
  - Lines 2463–2466: Integrated into `getCacheValidityStatus()`, returning `"CORRUPTED"` on misparsed CSV cache.
  - Lines 2504–2511: Integrated into `checkDoubleValidCache()`, returning `false` on misparsed CSV cache.
- `tad-master/packages/reltab-fs/src/reltab-fs.ts`:
  - Lines 284–340: Immediately after `createViewFromParquet(uiConn, cachedPaths.parquetPath, tableName)`, runs `DESCRIBE ${tableName}`.
  - Lines 286–290: Inspects columns:
    ```typescript
    const firstColName = (cols[0]?.column_name || "").replace(/^\uFEFF/, "");
    const isOneColRawEvent = cols.length === 1 && firstColName === "raw_event";
    const hasSyntheticCol = cols.some((c: any) => /^column0*\d+$/i.test(c.column_name));
    const hasCommaInCol0 = firstColName.includes(",");
    const isMisparsed = isOneColRawEvent || hasSyntheticCol || hasCommaInCol0;
    ```
  - Lines 298–337: If misparsed:
    a) Drops view: `DROP VIEW IF EXISTS ${tableName}`.  
    b) Unlinks physical file: `fs.unlinkSync(cachedPaths.parquetPath)`.  
    c) Records tombstone in `ToadParquetLedger` (`status: "DELETED"`).  
    d) Invalidates RAM caches and `importMap[targetPath]`.  
    e) Sets `mountSuccess = false` and falls through to NHÁNH 2 (Streaming Ingest) for multi-column re-ingestion.

### 1.3 Cache and Stale Temporary File Cleanup — R3
- `tad-master/packages/tad-app/app/portableAppData.ts`:
  - Lines 775–817: `purgeOrphanTempFiles` recursively traverses subdirectories with `walkAndPurge(dir)`. Cleans orphaned `.tmp` and `.tmp_*.parquet` files while strictly preserving `toad_ledger.parquet` and complete caches.
- Verified on disk:
  - Corrupt 4.88 GB file `build/Toad-2.4.6/toadAppData_p486h/temp/ekm8j/sample_40gb_cached_3535af61fe.parquet`: REMOVED.
  - Stale 4.88 GB temporary file `releases/toadAppData_uthyw/temp/okgrg/sample_40gb_cached_3535af61fe.tmp_1793688800513.parquet`: REMOVED.
  - Zero matching `*.tmp_*` files exist in `releases/` and `build/`.

### 1.4 Non-blocking Ingestion Error Handling & Badging — R4
- `tad-master/packages/tad-app/app/main.ts`:
  - Lines 488–515: `errorDialog` normalizes both object arguments `{ title, message, fatal }` and positional arguments, logs the full trace via `log.error`, and strictly confines `dialog.showErrorBox()` to `if (fatal)`. Non-fatal ingestion failures NEVER display an intrusive modal popup.
- `tad-master/packages/tad-app/src/electronRenderMain.tsx`:
  - Lines 14–23: Removed `getHostBridge().showErrorDialog()` from `window.error` and `window.unhandledrejection`, routing directly to `console.error` (which forwards to `toad.log`).
- `tad-master/packages/tadviewer/src/actions.ts`:
  - Lines 372–435: `openDataSourcePath` wraps `replaceCurrentView` with `try/catch`. On failure, logs stack to `console.error`, marks `MultipleLoadingManager` status as `"error"`, sets `activeLoadingFile` with `error: errMsg` (activating the center card in `AppPane.tsx`), and bypasses `setActiveLoadingFile(null)` in `finally` when an error is active.
- `tad-master/packages/tadviewer/src/components/ProjectFilesTable.tsx`:
  - Lines 311–320: Renders BlueprintJS `<Icon icon="error" size={12} style={{ color: "#ef4444" }} />` inside `<span className="status-indicator status-error" title="ERROR">`.
- `tad-master/packages/tadviewer/src/components/DataSourceSidebar.tsx`:
  - Lines 246–253: Renders BlueprintJS `<Icon icon="error" size={12} style={{ color: "#ef4444" }} />`.

### 1.5 Build & Executable Artifact Verification — R5
- `build/Toad-2.4.6/Toad.exe`: File size 180,267,520 bytes, FileVersion 2.4.6.1, ProductVersion 2.4.6.1.
- `build/latest`: Valid Windows directory junction pointing to `D:\Shared_UserData\Downloads\tad\build\Toad-2.4.6`.
- Zero-Duplicate Binary Storage policy verified: No duplicate version binaries exist across `releases/` or `build/`.

### 1.6 Independent Test Executions
1. `tests/deep_integration_qa.js`:
   - Execution command: `& "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tests\deep_integration_qa.js`
   - Result: **Total Test Cases: 222 | Passed: 222 | Failed: 0 | Total Duration: 15.89s** (Exit code 0).
2. `tests/test_milestone2_ui_error.js`:
   - Execution command: `& "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tests\test_milestone2_ui_error.js`
   - Result: All 8 checks passed (modal suppression, normalization, badging, compiled bundle verification).
3. Dedicated Adversarial Test (`scratch/reviewer_independent_qa.js`):
   - Parsed first 1000 lines of `D:/Shared_UserData/Downloads/data_sample/sample_40gb.csv`.
   - Verified exact 11 columns: `Timestamp`, `EventTime`, `RuleTitle`, `RuleID`, `Level`, `Computer`, `Channel`, `EventID`, `RecordID`, `Details`, `ExtraFieldInfo`.
   - Verified 0 synthetic columns (`column01..column10`).
   - Verified column 0 values are valid ISO timestamps (`2024-04-12 18:23:40...`) and do NOT contain raw unparsed commas.
   - Tested Gateway eviction via live `FSDriver`: Synthesized a corrupted Parquet cache (single-column misparsed simulation), verified `FSDriver.getTableName` caught the misparse, unlinked the corrupt parquet file, fell through to streaming import, and returned all 11 proper columns.
   - Tested `isParquetFileMisparsedSync` edge cases: 0-byte file, truncated 8-byte file, and invalid magic header were all safely detected as invalid format.

---

## 2. Logic Chain

1. **Root Cause Resolution (Delimiter Sniffing & Assertion Crashes)**:
   - Observation 1.1 establishes that `delim = ','` is explicitly supplied to all CSV queries, `all_varchar = true` is enforced across all tiers, and `cfg.isComplex` is read from `argv[4]`.
   - This directly eliminates the two primary failure modes:
     a) Delimiter sniffer defaulting to `|` or semicolon when complex lines appear.
     b) Native DuckDB vector downcast assertion crashes (`vector.cpp:1859`).

2. **Defense-in-Depth Cache Validation & Automatic Self-Healing**:
   - Observation 1.2 and Observation 1.6 establish that corrupt caches are now intercepted at two independent levels:
     - Level 1 (Static probe): `isParquetFileMisparsedSync` inspects Thrift footer metadata before loading, rejecting corrupted parquet files in `checkDoubleValidCache` and `getCacheValidityStatus`.
     - Level 2 (Gateway probe): `reltab-fs.ts` validates `DESCRIBE` columns immediately after `createViewFromParquet`. If corrupted columns exist, the view is dropped, the file is unlinked, the ledger is updated, and execution falls through to clean re-ingestion.
   - This guarantees that no stale or misparsed cache can ever poison the user's view.

3. **User Experience Stability (Non-blocking & Badging)**:
   - Observations 1.4 and 1.6 confirm that ingestion exceptions are cleanly caught and logged to `toad.log`, modal popups are suppressed, and the file's error state is clearly displayed via the BlueprintJS circular exclamation icon (`<Icon icon="error" />`) while keeping the UI fully interactive.

4. **Integrity & Compliance**:
   - Observations 1.1–1.6 confirm that the implementation contains real functional logic, genuine Thrift parsing, real DuckDB execution, zero hardcoded facade returns, and adheres to the `AGENTS.md` Zero-Duplicate Binary Storage policy.

---

## 3. Caveats

- **Byte Order Mark (BOM)**: `sample_40gb.csv` includes a UTF-8 BOM (`\uFEFF`) at the start of line 1. DuckDB preserves this byte in the first column name (`\uFEFFTimestamp`). The implementation handles this via `(cols[0]?.column_name || "").replace(/^\uFEFF/, "")`, ensuring reliable detection.
- **No further caveats**: All requirements R1 through R5 are verified end-to-end.

---

## 4. Conclusion

**Verdict: APPROVE**

All requirements from `ORIGINAL_REQUEST.md` and `PROJECT.md` (R1 through R5) have been completely implemented, verified, and stress-tested without regression or integrity violations:
- R1 (Gateway Cache Validation & Eviction): Verified.
- R2 (CSV Parser Delimiter Comma & all_varchar): Verified.
- R3 (Cache & Stale Temp Cleanup): Verified.
- R4 (Non-blocking Ingestion Error Handling & UI Badging): Verified.
- R5 (Build & Fastbuild Binary Verification): Verified.

---

## 5. Verification Method

To independently reproduce the verification results:

1. **Run Full QA Test Suite (222 Tests)**:
   ```powershell
   & "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tests\deep_integration_qa.js
   ```
   *Expected*: Total Test Cases: 222 | Passed: 222 | Failed: 0.

2. **Run Milestone 2 UI Error Handling & Modal Suppression Tests**:
   ```powershell
   & "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tests\test_milestone2_ui_error.js
   ```
   *Expected*: `=== ALL MILESTONE 2 VERIFICATION CHECKS PASSED ===`.

3. **Run Independent Adversarial Schema & Gateway Eviction Test**:
   ```powershell
   & "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" scratch\reviewer_independent_qa.js
   ```
   *Expected*: Exact 11 columns, 0 synthetic columns, and successful FSDriver eviction and recovery.

4. **Verify Fastbuild Binary**:
   ```powershell
   Get-Item "build\Toad-2.4.6\Toad.exe" | Format-List FullName, Length, VersionInfo
   ```

### Invalidation Conditions
- If any test in `deep_integration_qa.js` fails.
- If opening a corrupt Parquet cache does not trigger automatic eviction and fallback in `reltab-fs.ts`.
- If an ingestion failure triggers `dialog.showErrorBox()` when `fatal === false`.
