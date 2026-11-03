# Handoff Report: DuckDB Delimiter Misparsing, Cache Eviction & Error Handling Investigation

**Agent**: DuckDB & Cache Backend Explorer (`explorer_csv_backend`)  
**Handoff Type**: Hard Handoff (Investigation & Root Cause Analysis Complete)  
**Date**: 2026-11-03  
**Target Recipient**: Orchestrator & Implementation Workers  
**Working Directory**: `d:\Shared_UserData\Downloads\tad`  

---

## 1. Observation

1. **Header & Data Structure of `sample_40gb.csv`**:
   - Path: `D:\Shared_UserData\Downloads\data_sample\sample_40gb.csv` (Size: 42,949,671,835 bytes, ~40 GB, 62,301,118 lines).
   - Tool execution (`Get-Content -TotalCount 1`):
     ```
     Timestamp,EventTime,RuleTitle,RuleID,Level,Computer,Channel,EventID,RecordID,Details,ExtraFieldInfo
     ```
   - Exactly 11 columns, comma-separated. The first column name includes the UTF-8 BOM (`\uFEFFTimestamp`).

2. **DuckDB Delimiter Misparsing Reproduction**:
   - Executing `read_csv` with `delim = ','` and `escape = ''` on `sample_40gb.csv`:
     ```
     Invalid Input Error: Error when sniffing file "D:/Shared_UserData/Downloads/data_sample/sample_40gb.csv".
     CSV options could not be auto-detected. Consider setting parser options manually.
     ```
   - Executing `read_csv` with `delim = ','`, NO `escape = ''`, and `all_varchar = true`:
     ```
     Query succeeded in 369 ms!
     Columns detected: [ '﻿Timestamp', 'EventTime', 'RuleTitle', 'RuleID', 'Level', 'Computer', 'Channel', 'EventID', 'RecordID', 'Details', 'ExtraFieldInfo' ]
     ```
   - All 11 proper columns extracted cleanly with exact values.

3. **Corrupted Parquet Cache Discovery**:
   - `build/latest/toadAppData_p486h/temp/ekm8j/sample_40gb_cached_3535af61fe.parquet` (Length: 4,885,541,321 bytes).
   - Direct DuckDB `DESCRIBE` query on this file returned:
     ```
     - ﻿Timestamp,EventTime,RuleTitle,RuleID,Level,Computer,Channel,EventID,RecordID,Details,ExtraFieldInfo (VARCHAR)
     - column01 (VARCHAR)
     - column02 (VARCHAR)
     ...
     - column10 (VARCHAR)
     ```
   - Row 0 query confirmed: Column 0 contains the entire concatenated raw row string, while `column01` through `column10` are all `null`.
   - Identical file present in `build/Toad-2.4.6/toadAppData_p486h/temp/ekm8j/sample_40gb_cached_3535af61fe.parquet`.

4. **Stale Partial Temporary File Discovery**:
   - `releases/toadAppData_uthyw/temp/okgrg/sample_40gb_cached_3535af61fe.tmp_1793688800513.parquet` (Length: 4,880,670,466 bytes).
   - In `releases/toadAppData_uthyw/toad_ledger.parquet`: Event `start-1793688800513-0bvjd` (`FILE_STARTED`, timestamp `1793688800513`) records an incomplete ingestion run.

5. **Cache Hit Bypass Flaw in `reltab-fs.ts`**:
   - In `packages/reltab-fs/src/reltab-fs.ts:261–285`:
     ```typescript
     const isCacheHit = cachedPaths
       ? reltabDuckDB.checkParquetCache(targetPath, cachedPaths, forceReopen)
       : false;

     if (isCacheHit && cachedPaths) {
       uiConn = await this.dbc.connPool.take();
       await reltabDuckDB.createViewFromParquet(uiConn, cachedPaths.parquetPath, tableName);
       return tableName; // <--- EARLY RETURN!
     }

     tableName = await reltabDuckDB.nativeCSVImport(...);
     ```
   - In `packages/reltab-duckdb/src/csvimport.ts:3109`, the `isMisparsedDelimiter` sanity check is located inside `nativeCSVImport()`.
   - Because `checkParquetCache()` evaluated to `true`, `reltab-fs.ts` created the view directly and returned immediately without ever calling `nativeCSVImport()`.

6. **Worker Argument Bug in `ingestWorker.ts`**:
   - In `ingestWorker.ts:21`: `const isComplexLog = process.argv[5] === "1";`
   - In `csvimport.ts:2667–2678`: `args = [params.filePath, params.targetParquetPath, JSON.stringify(cfg)];`
   - `process.argv[5]` is `undefined`, so `isComplexLog` evaluated to `false` for every worker call.

7. **Orphan Cleaner Recurse Defect in `portableAppData.ts`**:
   - In `portableAppData.ts:774`: `purgeOrphanTempFiles()` uses non-recursive `fs.readdirSync(tempDir)`. Subdirectories like `temp/okgrg/` and `temp/ekm8j/` were skipped, leaving orphaned `.tmp_` files uncleaned.

8. **Missing Exception Boundary in `actions.ts`**:
   - In `packages/tadviewer/src/actions.ts:350–384`: `openDataSourcePath` has a `try ... finally` block but **no `catch` block**.
   - Ingestion errors bubble up to `window.addEventListener("unhandledrejection")` in `electronRenderMain.tsx:25`, which calls `getHostBridge().showErrorDialog()`, triggering modal native OS `dialog.showErrorBox()` in `main.ts:494`.

---

## 2. Logic Chain

1. **RFC-4180 Violation -> Delimiter Misidentification**:
   - **Observation 2**: Adding `escape = ''` produces an invalid input error during sniffing, whereas standard configuration parses cleanly in 369ms.
   - **Reasoning**: Lines 46 & 195 contain nested quotes within PowerShell scripts. Disabling quote escape (`escape = ''`) prevents doubled quotes `""` from being recognized. DuckDB disqualifies `,` due to quote syntax errors and chooses pipe `|` because line 195 has 10 pipes.

2. **Delimiter Misidentification -> Synthetic Columns & Column 0 Collapse**:
   - **Observation 3**: The Parquet cache has `Timestamp,EventTime,...` as column 0 and `column01`..`column10`.
   - **Reasoning**: With pipe delimiter, line 1 has 0 pipes, so the entire line becomes column 0's name. Since the schema was determined to have 11 columns, DuckDB auto-names the remaining 10 as `column01`..`column10`. Over 61 million lines contain 0 pipes, so their content falls entirely into column 0 while `column01`..`column10` receive `NULL`.

3. **Cache Bypass -> Reappearance of Corrupted Schema**:
   - **Observation 5**: `reltab-fs.ts` lines 261-285 return `tableName` immediately when `isCacheHit` is `true`.
   - **Observation 3**: The corrupted Parquet cache file existed on disk and its size matched the ledger.
   - **Reasoning**: Even after modifying `nativeCSVImport()`, `checkParquetCache()` evaluated to `true`. `reltab-fs.ts` mounted the existing corrupted Parquet file and returned immediately. `nativeCSVImport()` and its `isMisparsedDelimiter` check were bypassed entirely.

4. **Gateway Eviction -> Automatic Self-Healing**:
   - Moving schema validation (`isMisparsedDelimiter`) directly into `reltab-fs.ts` (upon view creation) and `checkDoubleValidCache` ensures that corrupted caches are caught at the gateway, dropped, deleted from disk, and evicted from the ledger, allowing execution to fall through to `nativeCSVImport()`.

5. **Unhandled Promise Rejections -> Intrusive Pop-up Dialogs**:
   - **Observation 8**: `openDataSourcePath` lacks a `catch` block.
   - **Reasoning**: An ingestion failure results in an unhandled promise rejection. The global listener in `electronRenderMain.tsx` invokes `showErrorDialog()`, which invokes `dialog.showErrorBox()`. Wrapping `openDataSourcePath` in `try ... catch` and updating `activeLoadingFile.error` displays the existing non-blocking center error card in `AppPane.tsx` without triggering native message boxes.

---

## 3. Caveats

1. **Parquet Footer Reading**:
   - While `isParquetFileMisparsedSync` reads the last 16KB of the Parquet file to detect `column01` or comma in header names, extremely wide parquet files with huge metadata could theoretically have the schema beyond 16KB. However, Gateway 2 (`uiConn.all('DESCRIBE ' + tableName)`) performs an exact SQL schema check, providing 100% coverage.
2. **UTF-8 Byte Order Mark (BOM)**:
   - The first column name in `sample_40gb.csv` is `\uFEFFTimestamp`. Column name checks must strip `^\uFEFF` before checking `includes(",")`.
3. **Compilation Prerequisite for `reltab-fs`**:
   - `reltab-fs` has its own TypeScript build step (`tad-master/packages/reltab-fs`). `fastbuild.ps1` must compile `reltab-fs` or `npm run build` must be executed in `packages/reltab-fs` before packaging.

---

## 4. Conclusion

1. **Root Cause Confirmed**: The issue is caused by `escape = ''` breaking RFC-4180 quote escaping, compounded by the cache hit bypass in `reltab-fs.ts:268` which prevented the eviction of pre-existing corrupted Parquet caches.
2. **Gateway Eviction is Required**: Schema sanity checking (`isMisparsedDelimiter` and `column01..columnN` detection) must be integrated into `reltab-fs.ts` (Gate 2) and `checkDoubleValidCache` (Gate 1).
3. **Parser Parameters Standardized**: All CSV ingestion queries must enforce `delim = ','`, omit `escape = ''`, and set `all_varchar = true`.
4. **Cleanup Targets Identified**:
   - Delete `releases/toadAppData_uthyw/temp/okgrg/sample_40gb_cached_3535af61fe.tmp_1793688800513.parquet` (~4.88 GB).
   - Delete `build/latest/toadAppData_p486h/temp/ekm8j/sample_40gb_cached_3535af61fe.parquet` (~4.88 GB).
   - Delete `build/Toad-2.4.6/toadAppData_p486h/temp/ekm8j/sample_40gb_cached_3535af61fe.parquet` (~4.88 GB).
   - Evict `sample_40gb.csv` from all active ledgers.
   - Update `purgeOrphanTempFiles` in `portableAppData.ts` to recurse subfolders.
5. **Non-blocking Error Handling Ready**: Wrap `actions.ts:openDataSourcePath` in `try ... catch`, suppress `dialog.showErrorBox` in `main.ts:errorDialog`, update `ProjectFilesTable.tsx` to display Blueprint `<Icon icon="error" size={12} style={{ color: "#ef4444" }} />`, and forward error traces to `toad.log`.

---

## 5. Verification Method

### 5.1 Parquet Schema Verification Script
Run the following PowerShell command to verify that `sample_40gb.csv` parses cleanly with all 11 proper columns:

```powershell
$env:PATH = "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64;$env:PATH"
@'
const duckdb = require('./tad-master/node_modules/duckdb');
const db = new duckdb.Database(':memory:');
const query = `
  SELECT * FROM read_csv(
    'D:/Shared_UserData/Downloads/data_sample/sample_40gb.csv',
    delim = ',',
    auto_detect = true,
    sample_size = 100000,
    ignore_errors = true,
    null_padding = true,
    all_varchar = true
  ) LIMIT 1
`;
db.all(query, (err, rows) => {
  if (err) { console.error('FAIL:', err); process.exit(1); }
  const cols = Object.keys(rows[0]).map(c => c.replace(/^\uFEFF/, ''));
  console.log('Columns:', cols);
  const expected = ['Timestamp','EventTime','RuleTitle','RuleID','Level','Computer','Channel','EventID','RecordID','Details','ExtraFieldInfo'];
  const matches = expected.every(e => cols.includes(e)) && !cols.some(c => /^column\d+$/i.test(c));
  console.log('Schema valid:', matches ? 'PASS' : 'FAIL');
});
'@ | node
```

### 5.2 Build Command
Execute FastBuild from repository root:
```powershell
.\fastbuild.ps1
```
Verify that `build/Toad-<version>/Toad.exe` is produced and runnable.

### 5.3 Automated Integration Test Suite
Execute the full integration test suite:
```powershell
$env:PATH = "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64;$env:PATH"
node tests/deep_integration_qa.js
```
Confirm all test suites pass.

### 5.4 Invalidation Conditions
- Any occurrence of `column01` through `column10` in table schema.
- Column 0 containing unparsed CSV lines with commas.
- Ingestion error triggering a native OS modal dialog box (`dialog.showErrorBox`).
- Persistent `.tmp_` files remaining in `temp/` subdirectories after application exit.
