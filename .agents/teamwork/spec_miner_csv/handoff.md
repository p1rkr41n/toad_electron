# Handoff Report — CSV Delimiter Sniffer, Cache Invalidation, and Non-Blocking Error Handling

**Agent**: `spec_miner_csv` (Specification Miner)  
**Recipient**: `orchestrator` / `parent` (ID: `463c7962-7642-4e36-b3b9-9f66c7c8f52c`)  
**Date**: 2026-11-03  
**Status**: Task Complete (Hard Handoff)  
**Detailed Report**: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\spec_miner_csv\analysis.md`  

---

## 1. Observation

1. **Root Cause Report**:
   - Path: `C:\Users\huydq\.gemini\antigravity\brain\489b863f-84dc-4fd6-bbfb-142488ba4d23\bao_cao_root_cause_analysis_csv_column_split.md`
   - Quoting Section 2: *"Khi code gán cứng `escape = ''` (chuỗi rỗng), DuckDB bị tước đoạt hoàn toàn khả năng escape dấu ngoặc kép kép... Với `escape = ''`, DuckDB coi dấu `"` đầu tiên trong chuỗi là điểm kết thúc cột sớm bất thường... Dòng 195 là một dòng log PowerShell dài 24,443 ký tự, chứa 524 dấu ngoặc kép và chứa đúng 10 ký tự Pipe `|`... DuckDB chính thức chọn dấu Pipe `|` làm Delimiter của toàn bộ bảng, với cấu trúc dự kiến gồm 11 cột."*
   - Quoting Section 3: *"File thực thi chưa từng được biên dịch lại (Binary Out of Date)... Lỗ hổng kiến trúc Cache Hit bypass qua logic xóa cache lỗi... trong `reltab-fs.ts` dòng 261-285... `checkParquetCache()` chỉ so khớp kích thước/mtime tệp... `isCacheHit` trả về `true`... không bao giờ gọi tới hàm `nativeCSVImport()`."*

2. **Empirical DuckDB Reproductions via Node.js**:
   - Command: `& "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" -e "const { Database } = require('D:/Shared_UserData/Downloads/tad/tad-master/node_modules/duckdb-async'); ..."`
   - Result with `escape = ''`:
     `Columns: ['\uFEFFTimestamp,EventTime,RuleTitle,RuleID,Level,Computer,Channel,EventID,RecordID,Details,ExtraFieldInfo', 'column01', 'column02', 'column03', 'column04', 'column05', 'column06', 'column07', 'column08', 'column09', 'column10']`
   - Result with `delim = ','` AND `escape = ''`:
     `Error: Invalid Input Error: Error when sniffing file ... CSV options could not be auto-detected.`
   - Result with `delim = ','`, NO `escape = ''`, `all_varchar = true`:
     `Columns: ['\uFEFFTimestamp', 'EventTime', 'RuleTitle', 'RuleID', 'Level', 'Computer', 'Channel', 'EventID', 'RecordID', 'Details', 'ExtraFieldInfo']`
     Extracted row 0: `Timestamp: '2026-03-12T08:40:25.383678Z'`, `RuleTitle: 'Relevant Anti-Virus Signature Keywords In Application Log'`, `EventID: '400'`.

3. **Stale Cache Inspection on Disk**:
   - Inspecting Parquet footer of `build/Toad-2.4.6/toadAppData_p486h/temp/ekm8j/sample_40gb_cached_3535af61fe.parquet`:
     `Matches in footer: ['Timestamp,EventTime,RuleTitle,RuleID,Level,Computer,Channel,EventID,RecordID,Details,ExtraFieldInfo', 'column01', 'column02', ... 'column10']` (4,885,541,321 bytes).
   - Stale temporary file: `releases/toadAppData_uthyw/temp/okgrg/sample_40gb_cached_3535af61fe.tmp_1793688800513.parquet` (4,880,670,466 bytes).
   - Ledger entry in `build/.../toad_ledger.parquet`:
     `{"event_id": "ready-1793698222570-6lrmt", "source_path": "...sample_40gb.csv", "status": "READY", "extra_json": "{\"ext\":\".csv\",\"view\":\"sample_40gb\",\"isRawEventFallback\":false}"}`.

4. **Pop-up Error Dialog Trace in Codebase**:
   - `packages/tadviewer/src/actions.ts:350–384` (`openDataSourcePath`): Contains `try ... finally` but lacks `catch`. Exceptions in `replaceCurrentView()` bubble up as unhandled promise rejections.
   - `packages/tad-app/src/electronRenderMain.tsx:24–33`:
     ```typescript
     window.addEventListener("unhandledrejection", (e) => {
       getHostBridge().showErrorDialog("Promise Rejection: " + ..., ...);
     });
     ```
   - `packages/tad-app/app/main.ts:193–195` & `488–499`:
     ```typescript
     ipcMain.handle("errorDialog", (event, title, msg, fatal) => errorDialog(title, msg, fatal));
     const errorDialog = async (title, msg, fatal = false) => {
       dialog.showErrorBox(title, msg);
     };
     ```
     Triggers a blocking modal dialog on Windows requiring manual "OK"/"Ignore" clicks.
   - `packages/tad-app/app/appWindow.ts:135–137`:
     ```typescript
     win.webContents.on("console-message", (event, level, message, line, sourceId) => {
       log.warn(`[RENDERER-CONSOLE] [lvl=${level}] ${message} (${sourceId}:${line})`);
     });
     ```
     `console.error` in the renderer is automatically forwarded to `toad.log`.

5. **UI Badging & Center Error Card**:
   - `packages/tadviewer/src/components/ProjectFilesTable.tsx:311–316`:
     ```tsx
     if (s === "ERROR") {
       return <span className="status-indicator status-error" title="ERROR">!</span>;
     }
     ```
   - `packages/tadviewer/src/components/AppPane.tsx:542–554`: Contains a fully styled non-blocking center error card: `<div className="center-app-pane center-error-pane"><Icon icon="error" iconSize={40} intent="danger" />...</div>`.

6. **Worker Sandbox & Temp Cleaner Defects**:
   - `packages/reltab-duckdb/src/ingestWorker.ts:21`: Reads `process.argv[5] === "1"`, but `csvimport.ts:2670` packs config in `process.argv[4]`. `isComplexLog` evaluates to `false`.
   - `packages/tad-app/app/portableAppData.ts:774` (`purgeOrphanTempFiles`): Only reads top-level entries of `temp/` without recursing into project subfolders (`okgrg`, `ekm8j`).

---

## 2. Logic Chain

1. **Why Delimiter Was Misparsed**:
   - Passing `escape = ''` disabled standard doubled-quote escaping (`""`) per RFC-4180 [Obs 1, 2].
   - DFIR logs contain PowerShell scripts with embedded quotes, causing quote syntax errors when comma was evaluated as delimiter [Obs 1, 2].
   - DuckDB's sniffer disqualified comma `,` and selected pipe `|` because line 195 has 10 pipes splitting it into 11 columns [Obs 1].
   - The header has 0 pipes, collapsing the entire 11 column names into Column 0 and generating `column01` .. `column10` [Obs 1, 2].

2. **Why the Bug Persisted After Code Fix**:
   - The fix was placed in `csvimport.ts:nativeCSVImport()` [Obs 1, 3].
   - In `reltab-fs.ts`, `isCacheHit` verified that the corrupted Parquet file on disk matched the ledger size/mtime and called `createViewFromParquet()` directly, returning before `nativeCSVImport()` was reached [Obs 1, 3].
   - The corrupt parquet file on disk still had the invalid footer [Obs 3].
   - RAM micro-cache served the first 1,000 corrupted rows in < 2ms [Obs 1].

3. **Why Pop-Up Dialogs Freeze the Application**:
   - `actions.openDataSourcePath()` does not catch exceptions from `replaceCurrentView()` [Obs 4].
   - The unhandled rejection is caught by `window.addEventListener("unhandledrejection")` in `electronRenderMain.tsx`, which invokes IPC `errorDialog` [Obs 4].
   - Main process invokes `dialog.showErrorBox()`, freezing the UI until the user clicks Ignore [Obs 4].
   - Suppressing `dialog.showErrorBox()` for non-fatal errors and catching in `openDataSourcePath()` displays the existing center error card in `AppPane.tsx` while keeping the sidebar interactive [Obs 4, 5].

4. **Why Stale `.tmp_` Files Remained on Disk**:
   - `purgeOrphanTempFiles()` in `portableAppData.ts` only called `fs.readdirSync(tempDir)` on the root `temp/` directory without inspecting project subdirectories (`temp/okgrg/`, `temp/ekm8j/`) [Obs 3, 6].

---

## 3. Caveats

1. **Read-Only Investigation**: As a specification miner, no code changes or file modifications were made to product code. All observations were made via static code analysis, directory inspection, and read-only node query execution.
2. **UTF-8 BOM Header Handling**: Line 1 of `sample_40gb.csv` begins with a UTF-8 BOM (`\uFEFF`). DuckDB names the first column `\uFEFFTimestamp`. Any column lookup or regex matching must strip `^\uFEFF`.
3. **Build Script Coverage**: `fastbuild.ps1` builds `host-bridge`, `reltab-duckdb`, and `tadviewer`, but does not explicitly invoke `npm run build` in `packages/reltab-fs`. If `reltab-fs/src/reltab-fs.ts` is modified, it must be compiled to `dist/reltab-fs.js` before packaging.

---

## 4. Conclusion

1. **R1 (Gateway Cache Validation)**: Gateway validation must be situated in `reltab-fs.ts:getTableName` immediately following `createViewFromParquet()` (via `DESCRIBE ${tableName}`) and in `csvimport.ts:checkDoubleValidCache()` (via fast footer check or ledger inspection). Any cache with `column01`..`columnN` or comma-containing column 0 must be evicted on the spot, deleting the parquet file and falling through to fresh streaming re-ingestion.
2. **R2 (Parser Parameters)**: Strictly enforce `delim = ','`, remove `escape = ''`, retain `all_varchar = true`, `null_padding = true`, and `ignore_errors = true`. Fix `ingestWorker.ts` argument reading (`cfg.isComplex === true`).
3. **R3 (Cleanup)**: Delete `build/Toad-2.4.6/toadAppData_p486h/temp/ekm8j/sample_40gb_cached_3535af61fe.parquet` and `releases/toadAppData_uthyw/temp/okgrg/sample_40gb_cached_3535af61fe.tmp_1793688800513.parquet`. Update `purgeOrphanTempFiles()` to recursively scan project subdirectories.
4. **R4 (Non-blocking Error Handling)**: Wrap `actions.openDataSourcePath()` in `try ... catch`, update `MultipleLoadingManager` status to `"error"`, render BlueprintJS `<Icon icon="error" size={12} style={{ color: "#ef4444" }} />` in `ProjectFilesTable.tsx`, and suppress non-fatal `dialog.showErrorBox()` in `main.ts`. All error traces are already forwarded to `toad.log` via `appWindow.ts:135`.
5. **R5 (Build & Compliance)**: Ensure `packages/reltab-fs` is built, run `fastbuild.ps1`, verify with Jujutsu `jj`, and observe Zero-Duplicate Binary Storage.

---

## 5. Verification Method

1. **DuckDB Direct Sniffer Verification**:
   ```powershell
   & "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" -e "const { Database } = require('D:/Shared_UserData/Downloads/tad/tad-master/node_modules/duckdb-async'); (async () => { const db = await Database.create(':memory:'); const conn = await db.connect(); const desc = await conn.all('DESCRIBE SELECT * FROM read_csv(\'D:/Shared_UserData/Downloads/data_sample/sample_40gb.csv\', delim = \',\', auto_detect = true, sample_size = 1000, ignore_errors = true, null_padding = true, parallel = false, all_varchar = true)'); console.log('Columns:', desc.map(d => d.column_name)); })();"
   ```
   *Expected Output*: Exactly 11 columns starting with `Timestamp` (or `\uFEFFTimestamp`), `EventTime`, `RuleTitle`, etc. Zero `column01`..`column10`.

2. **Parquet Footer Inspection Command**:
   ```powershell
   & "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" -e "const fs = require('fs'); const p = '<parquetPath>'; const stat = fs.statSync(p); const fd = fs.openSync(p, 'r'); const buf = Buffer.alloc(8192); fs.readSync(fd, buf, 0, 8192, stat.size - 8192); fs.closeSync(fd); console.log(buf.toString('latin1').match(/column\d+|Timestamp[^\x00-\x1f]+/g));"
   ```
   *Expected Output*: Should show proper column names without `column01` or commas in column 0.

3. **FastBuild & Launch Command**:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\fastbuild.ps1 -Dev
   ```
   Verify that `build/Toad-2.4.6/Toad.exe` builds cleanly and can be launched without errors.

4. **Integration Test Suite**:
   ```powershell
   & "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tests\deep_integration_qa.js
   ```
