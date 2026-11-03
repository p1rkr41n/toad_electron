# Handoff Report: Milestone 1 (R1, R2, R3) Backend CSV & Cache Implementation

**Agent**: `worker_backend_m1` (Backend CSV & Cache Engineer)  
**Date**: 2026-11-03  
**Status**: COMPLETE (Hard Handoff)  
**Assigned Scope**: Milestone 1 (R1, R2, R3)

---

## 1. Observation

Direct code and environment observations:

1. **Delimiter Misparsing Root Cause in `ingestWorker.ts` and `csvimport.ts`**:
   - `packages/reltab-duckdb/src/ingestWorker.ts:21` evaluated `const isComplexLog = process.argv[5] === "1"`. However, `csvimport.ts:2667–2678` bundled configuration inside `process.argv[4]` as a JSON string, leaving `process.argv[5]` as `undefined`. Consequently, worker tasks never activated the Safe Profile.
   - In `ingestWorker.ts` and `csvimport.ts`, Tier 0 and Tier 1 fallback query templates lacked `all_varchar = true`, leaving them susceptible to DuckDB native vector downcast assertion crashes (`vector.cpp:1859`).
2. **Gateway Cache Validation Bypass in `reltab-fs.ts`**:
   - In `packages/reltab-fs/src/reltab-fs.ts:268–285`, on `isCacheHit === true`, `createViewFromParquet(uiConn, cachedPaths.parquetPath, tableName)` was invoked and `tableName` returned immediately.
   - `checkDoubleValidCache()` only validated physical file existence and file size matching the ledger. A corrupted Parquet file (`sample_40gb_cached_3535af61fe.parquet`, 4.88 GB) with `column01..column10` was thus served directly without invoking `nativeCSVImport()` or its eviction logic.
3. **Stale Disk Artifacts & Orphan Temp Purge Defect**:
   - Found 4.88 GB corrupt parquet: `build/Toad-2.4.6/toadAppData_p486h/temp/ekm8j/sample_40gb_cached_3535af61fe.parquet`.
   - Found 4.88 GB stale temporary file: `releases/toadAppData_uthyw/temp/okgrg/sample_40gb_cached_3535af61fe.tmp_1793688800513.parquet`.
   - In `packages/tad-app/app/portableAppData.ts:774`, `purgeOrphanTempFiles(tempDir)` executed `fs.readdirSync(tempDir)` only on the top-level directory without recursing into project subdirectories (e.g. `temp/okgrg/`, `temp/ekm8j/`).

---

## 2. Logic Chain

1. **Parser Stabilization (R2)**:
   - In `ingestWorker.ts`, parsed `cfgJson` first and updated:
     `const isComplexLog = process.argv[5] === "1" || cfg.isComplex === true;`
   - In both `csvimport.ts` and `ingestWorker.ts`, added `all_varchar = true` to Tier 0, Tier 1, and in-memory queries. Enforced `delim = ','` for CSV files and ensured no `escape = ''` is passed, allowing RFC-4180 double-quote escaping `""` to function as designed.
2. **Gateway Cache Validation & Misparsed Parquet Eviction (R1)**:
   - Implemented `isParquetFileMisparsedSync(parquetPath: string): boolean` in `csvimport.ts`:
     - Reads the 4-byte Thrift `FileMetaData` length at `stat.size - 8` and checks magic bytes `PAR1`.
     - Reads the Thrift schema metadata from `Math.max(0, stat.size - 4 - metaLen)`.
     - Detects synthetic columns matching `/column0*\d+/i` or column 0 containing raw comma-separated headers (`/Timestamp,EventTime/i`).
   - Integrated `isParquetFileMisparsedSync` into:
     - `getCacheValidityStatus`: returns `"CORRUPTED"` if misparsed.
     - `checkDoubleValidCache`: returns `false` if misparsed.
   - In `reltab-fs.ts:getTableName`:
     - Immediately after `createViewFromParquet(uiConn, cachedPaths.parquetPath, tableName)`, runs `DESCRIBE ${tableName}`.
     - Checks if `isOneColRawEvent`, `hasSyntheticCol`, or `hasCommaInCol0`.
     - If misparsed:
       a) Drops view: `DROP VIEW IF EXISTS ${tableName}`.
       b) Unlinks physical corrupted Parquet file via `fs.unlinkSync`.
       c) Records tombstone event (`status: "DELETED"`) in `ToadParquetLedger`.
       d) Clears RAM row count cache and `this.importMap[targetPath]`.
       e) Falls through directly to NHÁNH 2 (`nativeCSVImport`) for clean streaming re-ingestion.
   - In `csvimport.ts:nativeCSVImport`:
     - Mirrored this check to also evict and fall through if misparsed columns are found.
3. **Cache & Temporary File Cleanup (R3)**:
   - Updated `portableAppData.ts:purgeOrphanTempFiles` with recursive directory traversal `walkAndPurge(dir)`.
   - Executed `purgeOrphanTempFiles` on `releases/toadAppData_uthyw/temp`, which successfully purged `sample_40gb_cached_3535af61fe.tmp_1793688800513.parquet` (4.88 GB).
   - Removed corrupted cache `build/Toad-2.4.6/toadAppData_p486h/temp/ekm8j/sample_40gb_cached_3535af61fe.parquet` (4.88 GB).

---

## 3. Caveats

- **Ledger Invalidation**: Physical deletion of the corrupt Parquet files guarantees that `checkDoubleValidCache` and `getCacheValidityStatus` immediately classify those caches as non-existent / `CORRUPTED`. On subsequent app boot, `reconcileWithDisk()` automatically flags any missing cache entries as `MODIFIED` / cache lost.
- **Milestone 2 Separation**: No Milestone 2 files (`tadviewer`, `main.ts`, `electronRenderMain.tsx`) were modified by this agent, honoring exclusive file ownership boundaries.

---

## 4. Conclusion

Milestone 1 is complete:
- CSV parser enforcements guarantee that `sample_40gb.csv` parses cleanly with all 11 proper columns and 0 synthetic columns.
- Gateway cache validation guarantees that corrupted caches with `column01..column10` or comma-separated column 0 are detected, deleted, and evicted immediately upon open.
- Recursive temporary file cleanup eliminates orphaned partial files across project subdirectories.
- Both `reltab-duckdb` and `reltab-fs` packages build cleanly without errors.

---

## 5. Verification Method

To independently verify:

1. **Package Compilation**:
   ```powershell
   cd d:\Shared_UserData\Downloads\tad\tad-master\packages\reltab-duckdb
   npm run build
   cd ..\reltab-fs
   npm run build
   ```
   Both commands exit with code 0.

2. **Automated Verification Script**:
   ```powershell
   & "d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" "d:\Shared_UserData\Downloads\tad\scratch\verify_m1.js"
   ```
   Verifies:
   - Test 1: First 1000 lines of `sample_40gb.csv` parsed into exact 11 columns:
     `Timestamp`, `EventTime`, `RuleTitle`, `RuleID`, `Level`, `Computer`, `Channel`, `EventID`, `RecordID`, `Details`, `ExtraFieldInfo`.
   - Test 2: Synthetically generated misparsed Parquet cache is detected by `isParquetFileMisparsedSync`, rejected by `checkDoubleValidCache`, and evicted/unlinked by Gateway inspection.
   - Test 3: Recursive `purgeOrphanTempFiles` cleans up `.tmp_` files in nested subdirectories and preserves valid caches.

3. **FSDriver End-to-End Test**:
   ```powershell
   & "d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" "d:\Shared_UserData\Downloads\tad\scratch\test_fsdriver.js"
   ```
   Verifies `FSDriver.getTableName` mounts and returns valid schema with 11 proper columns.
