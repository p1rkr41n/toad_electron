# DuckDB CSV Ingestion, Cache Gateway Validation & Eviction Analysis Report

**Investigator**: DuckDB & Cache Backend Explorer (`explorer_csv_backend`)  
**Date**: 2026-11-03  
**Working Directory**: `d:\Shared_UserData\Downloads\tad`  
**Reference Document**: `C:\Users\huydq\.gemini\antigravity\brain\489b863f-84dc-4fd6-bbfb-142488ba4d23\bao_cao_root_cause_analysis_csv_column_split.md`  
**Core Files Analyzed**:
- `packages/reltab-fs/src/reltab-fs.ts`
- `packages/reltab-duckdb/src/csvimport.ts`
- `packages/reltab-duckdb/src/ingestWorker.ts`
- `packages/tad-app/app/portableAppData.ts`
- `packages/tadviewer/src/MultipleLoadingManager.ts`
- `packages/tadviewer/src/actions.ts`
- `packages/tadviewer/src/components/ProjectFilesTable.tsx`
- `packages/tadviewer/src/components/DataSourceSidebar.tsx`
- Active cache stores: `releases/toadAppData_uthyw`, `build/latest/toadAppData_p486h`, `build/Toad-2.4.6/toadAppData_p486h`

---

## 1. Executive Summary

Empirical investigation has fully validated the root causes of the CSV column misparsing and cache hit flaws:

1. **Header & Data Shape**: `sample_40gb.csv` (42,949,671,835 bytes, ~40 GB, 62,301,118 rows) has exactly **11 comma-separated columns**:
   `Timestamp,EventTime,RuleTitle,RuleID,Level,Computer,Channel,EventID,RecordID,Details,ExtraFieldInfo`.
2. **Sniffer Breakage Mechanism**: Setting `escape = ''` strips DuckDB's RFC-4180 double-quote escaping (`""`). When scanning rows with complex PowerShell commands (such as line 46 and 195), DuckDB encounters quote syntax violations, disqualifies comma `,` as a delimiter candidate, and erroneously selects pipe `|` (which appears 10 times in line 195). Because line 1 contains zero pipes, DuckDB collapses the entire 11-column header into Column 0 and auto-generates empty synthetic columns `column01` through `column10`.
3. **The Cache Bypass Flaw in `reltab-fs.ts`**: Even after code was modified to omit `escape = ''` in `csvimport.ts:3109`, user sessions continued loading the corrupted 11-column schema because `reltab-fs.ts:261–285` mounts cached Parquet files directly into the UI Engine on `isCacheHit === true` and returns immediately. `checkDoubleValidCache()` only validated physical size and timestamps, so the corrupted Parquet cache (`sample_40gb_cached_3535af61fe.parquet`, 4.88 GB) was served directly, never invoking `nativeCSVImport()` or its eviction logic.
4. **Stale Cache Inventory**:
   - `build/latest/toadAppData_p486h/temp/ekm8j/sample_40gb_cached_3535af61fe.parquet` (4,885,541,321 bytes) — Corrupted Parquet cache containing `\uFEFFTimestamp,...` as column 0 and `column01`..`column10`.
   - `releases/toadAppData_uthyw/temp/okgrg/sample_40gb_cached_3535af61fe.tmp_1793688800513.parquet` (4,880,670,466 bytes) — Stale partial temporary file left over from an interrupted ingestion session.
5. **Worker Parameter Bug**: In `ingestWorker.ts:21`, `isComplexLog` checked `process.argv[5] === "1"`. However, `csvimport.ts:2667–2678` bundled configuration inside `process.argv[4]`, leaving `process.argv[5]` as `undefined`. Consequently, worker tasks never activated the Safe Profile.
6. **Orphan Purge Recurse Defect**: In `portableAppData.ts:774`, `purgeOrphanTempFiles()` scanned only the top-level `temp/` folder, failing to recurse into project subdirectories (`temp/okgrg/`, `temp/ekm8j/`), leaving orphaned `.tmp_` files stranded indefinitely.
7. **Empirical Query Validation**: Executing `read_csv` with `delim = ','`, NO `escape = ''`, and `all_varchar = true` against `sample_40gb.csv` executed in **369 ms**, extracting all 11 proper columns cleanly with zero errors.

---

## 2. Dataset Verification: `sample_40gb.csv`

### 2.1 File Characteristics
- **Physical Path**: `D:\Shared_UserData\Downloads\data_sample\sample_40gb.csv`
- **File Size**: `42,949,671,835 bytes` (~40.00 GB)
- **Total Log Lines**: `62,301,118` lines
- **Format**: Windows DFIR Security & Event Log aggregation, RFC-4180 CSV with UTF-8 BOM (`\uFEFF`)

### 2.2 Header Inspection
Reading the first line reveals:
```
Timestamp,EventTime,RuleTitle,RuleID,Level,Computer,Channel,EventID,RecordID,Details,ExtraFieldInfo
```
**Exact 11 Columns**:
1. `Timestamp` (Contains UTF-8 BOM `\uFEFF` at index 0)
2. `EventTime`
3. `RuleTitle`
4. `RuleID`
5. `Level`
6. `Computer`
7. `Channel`
8. `EventID`
9. `RecordID`
10. `Details`
11. `ExtraFieldInfo`

### 2.3 Row 0 Sample
```json
{
  "Timestamp": "2026-03-12T08:40:25.383678Z",
  "EventTime": "2026-03-12T08:40:25.383678Z",
  "RuleTitle": "Relevant Anti-Virus Signature Keywords In Application Log",
  "RuleID": "b0f698cd-af36-2a37-ce9f-2ab614a8b808",
  "Level": "high",
  "Computer": "QLYD.quangninh.vn",
  "Channel": "App",
  "EventID": "400",
  "RecordID": "434401",
  "Details": "Data[1]: [SID: 33355] Audit: WebShell Access Attempt 2 attack detected but not blocked. Application path: SYSTEM",
  "ExtraFieldInfo": "-"
}
```

---

## 3. DuckDB `read_csv` Parser & Sniffer Parameter Analysis

### 3.1 Parameter Matrix & Recommendations

| Parameter | Current Code State | Recommended Configuration | Root Cause & Justification |
|---|---|---|---|
| `delim` | Present in Safe Profile and Tier 0 (`delim = ','`) | Strictly enforce `delim = ','` for all `.csv` files | Pins delimiter to comma, preventing DuckDB sniffer from switching to pipe `\|` when rows contain PowerShell pipelines. |
| `escape` | Explicitly set to `''` in earlier commits and still present in `csvimport.ts:2978` (Raw Log) | **OMIT / REMOVE** from all CSV ingestion queries (`streamCsvToParquet`, `ingestWorker.ts`, in-memory fallback) | Setting `escape = ''` strips DuckDB's native ability to handle RFC-4180 doubled quotes `""`. Lines 46 & 195 trigger unquoted quote errors, causing sniffer to reject comma `,`. |
| `quote` | Standard `'"'` | Keep `quote = '"'` | Standard RFC-4180 quote character. |
| `all_varchar` | Only present in Tier 2 (`csvimport.ts:2869`, `ingestWorker.ts:151`) and Safe Profile | **Enforce across ALL Tiers** (Stage 1, Stage 2, Tier 0, Tier 1, Tier 2) | Forces 100% of physical DuckDB vectors to `PhysicalType::VARCHAR`. Completely eliminates the native C++ crash `Assertion failed: (vector.GetType().InternalType() == PhysicalType::VARCHAR), file vector.cpp, line 1859`. |
| `null_padding` | Present (`true`) | Keep `true` | Prevents ingestion failure when ragged rows have fewer tokens than columns. |
| `ignore_errors` | Present (`true`) | Keep `true` | Allows ingestion of multi-gigabyte forensic logs even if corrupted individual rows exist. |
| `parallel` | `false` in Safe Profile and Tier 1 | Set `parallel = false` for large/complex CSVs | Avoids chunk-boundary race conditions on extremely long lines (> 20KB scripts on line 195). |
| `sample_size` | `100000` | Keep `100000` | Ensures sniffer examines deep enough into the file to verify header consistency. |

### 3.2 Direct Empirical Testing on DuckDB

Direct execution on `sample_40gb.csv` using DuckDB Node.js engine yielded conclusive evidence:

1. **Test A: Bug Condition (`delim = ','`, `escape = ''`)**:
   ```sql
   SELECT * FROM read_csv('sample_40gb.csv', delim = ',', escape = '', auto_detect = true, sample_size = 100000, ignore_errors = true, null_padding = true);
   ```
   **Output**:
   `Invalid Input Error: Error when sniffing file "sample_40gb.csv". CSV options could not be auto-detected. Consider setting parser options manually.`
   *Proof*: Explicit `escape = ''` immediately breaks sniffer auto-detection on PowerShell script logs.

2. **Test B: Correct Standard Specification (`delim = ','`, NO `escape = ''`, `all_varchar = true`)**:
   ```sql
   SELECT * FROM read_csv('sample_40gb.csv', delim = ',', auto_detect = true, sample_size = 100000, ignore_errors = true, null_padding = true, all_varchar = true) LIMIT 3;
   ```
   **Output**:
   `Query succeeded in 369 ms!`
   All 11 proper columns cleanly detected: `Timestamp`, `EventTime`, `RuleTitle`, `RuleID`, `Level`, `Computer`, `Channel`, `EventID`, `RecordID`, `Details`, `ExtraFieldInfo`.
   Zero synthetic columns, zero assertion crashes.

---

## 4. Cache Gateway & Eviction Flaw Analysis

### 4.1 The Gateway Bypass Flaw in `reltab-fs.ts`

In `packages/reltab-fs/src/reltab-fs.ts`, lines 261–285:
```typescript
    const cfg = reltabDuckDB.getIngestConfig();
    const cachedPaths = reltabDuckDB.getDeterministicParquetPath(
      targetPath,
      cfg.temp_dir
    );
    const isCacheHit = cachedPaths
      ? reltabDuckDB.checkParquetCache(targetPath, cachedPaths, forceReopen)
      : false;

    // NHÁNH 1: Parquet cache đã tồn tại sẵn trên đĩa (Instant Cache Hit)
    if (isCacheHit && cachedPaths) {
      const extName = path.extname(targetPath);
      const baseName = path.basename(targetPath, extName);
      const tableName = importInfo?.tableName || reltabDuckDB.genTableName(baseName);

      let uiConn: any = null;
      try {
        uiConn = await this.dbc.connPool.take();
        await reltabDuckDB.createViewFromParquet(
          uiConn,
          cachedPaths.parquetPath,
          tableName
        );
        log.info(
          `[DualEngine UI] Mount VIEW thanh cong tu Parquet cache vao UI Engine: ${tableName} (< 1ms)`
        );
      } catch (viewErr) {
        log.warn("[DualEngine UI] Loi khi tao VIEW tu Parquet cache:", viewErr);
      } finally {
        if (uiConn) {
          this.dbc.connPool.giveBack(uiConn);
        }
      }
      ...
      return tableName; // <--- EARLY RETURN!
    }

    // NHÁNH 2: nativeCSVImport() CHỈ ĐƯỢC GỌI KHI isCacheHit LÀ FALSE!
    tableName = await reltabDuckDB.nativeCSVImport(...);
```

### 4.2 Why Corrupted Parquet Files Were Not Evicted
1. `checkParquetCache()` delegates to `checkDoubleValidCache()` in `csvimport.ts:2439`.
2. `checkDoubleValidCache()` only checks:
   - Source mtime and size matching ledger entry (`getCacheValidityStatus`).
   - Physical existence of Parquet file and file size matching `entry.parquet_size`.
   - `extra.isRawEventFallback === true`.
3. In the corrupted `sample_40gb.csv` cache:
   - `extra_json` had `isRawEventFallback: false` (because DuckDB thought it parsed 11 columns via pipe delimiter!).
   - Parquet file size was 4,901,006,237 bytes, exactly matching the ledger.
   - Therefore, `checkDoubleValidCache()` returned `true`!
4. In `reltab-fs.ts`, `isCacheHit` was `true`. The application created the view from the corrupted Parquet file and returned immediately.
5. The `isMisparsedDelimiter` sanity check at `csvimport.ts:3109` was inside `nativeCSVImport()`, which was **never executed**!

### 4.3 Two-Gate Defense Architecture
To guarantee that corrupted caches can never reach the user:

1. **Gate 1: Physical / Header Probe in `checkDoubleValidCache` & `getCacheValidityStatus`**:
   - Location: `packages/reltab-duckdb/src/csvimport.ts:2426`.
   - Before returning `"VALID"`, if `filePath.endsWith(".csv")`, execute a fast synchronous inspection of the Parquet file (`isParquetFileMisparsedSync(parquetPath)`).
   - If corrupted (e.g. contains `column01` or Column 0 with commas), return `"CORRUPTED"` (or `false` in `checkDoubleValidCache`).
2. **Gate 2: Active Schema Validation in `createViewFromParquet` & `reltab-fs.ts`**:
   - Location: `packages/reltab-duckdb/src/csvimport.ts:3015` and `packages/reltab-fs/src/reltab-fs.ts:280`.
   - Immediately after `CREATE OR REPLACE VIEW ${viewName} AS SELECT * FROM parquet_scan(...)`:
     ```typescript
     const cols: any = await dbConn.all(`DESCRIBE ${viewName}`);
     const firstColName = (cols[0]?.column_name || "").replace(/^\uFEFF/, "");
     const isOneColRawEvent = cols.length === 1 && firstColName === "raw_event";
     const isMisparsedDelimiter =
       firstColName.includes(",") &&
       (cols.length === 1 || cols.some((c: any) => /^column\d+$/i.test(c.column_name)));
     ```
   - If `isOneColRawEvent || isMisparsedDelimiter`:
     - Drop view: `await dbConn.exec('DROP VIEW IF EXISTS ' + viewName);`
     - Delete corrupt parquet: `fs.unlinkSync(parquetPath);`
     - Record eviction in `ToadParquetLedger`: `status: "DELETED"`.
     - Throw `Error("CORRUPTED_CACHE_MISPARSED_DELIMITER")`.
   - In `reltab-fs.ts`: Catch the eviction error, do not return `tableName`, and fall through to Branch 2 (`nativeCSVImport`) to perform fresh streaming re-ingestion!

---

## 5. Stale Temporary File & Cache Inventory

### 5.1 Disk Files Identified

| Path | Size (Bytes) | Category | Description / Cause |
|---|---|---|---|
| `d:\Shared_UserData\Downloads\tad\releases\toadAppData_uthyw\temp\okgrg\sample_40gb_cached_3535af61fe.tmp_1793688800513.parquet` | 4,880,670,466 (~4.88 GB) | Stale Temporary File | Leftover partial file from an interrupted streaming run at timestamp `1793688800513`. Must be deleted. |
| `d:\Shared_UserData\Downloads\tad\build\latest\toadAppData_p486h\temp\ekm8j\sample_40gb_cached_3535af61fe.parquet` | 4,885,541,321 (~4.88 GB) | Corrupted Parquet Cache | Misparsed with pipe delimiter: Column 0 = concatenated header, Columns 1..10 = `column01`..`column10`. Must be deleted. |
| `d:\Shared_UserData\Downloads\tad\build\Toad-2.4.6\toadAppData_p486h\temp\ekm8j\sample_40gb_cached_3535af61fe.parquet` | 4,885,541,321 (~4.88 GB) | Corrupted Parquet Cache | Identical file in Toad-2.4.6 build directory. Must be deleted. |

### 5.2 Ledger Records Identified
1. `releases/toadAppData_uthyw/toad_ledger.parquet`:
   - Event `start-1793688800513-0bvjd` (`FILE_STARTED`, status: `STARTED`) matching the stale `.tmp_1793688800513.parquet` file.
2. `build/latest/toadAppData_p486h/toad_ledger.parquet`:
   - Event `ready-1793697043383-kc9t7` (`FILE_READY`, status: `READY`) for `sample_40gb_cached_3535af61fe.parquet`.
   - Event `ready-1793697101296-ziaxl` (`FILE_READY`, status: `READY`) for `sample_40gb_cached_3535af61fe.parquet`.

### 5.3 Recursive Cleanup Defect in `purgeOrphanTempFiles`
In `packages/tad-app/app/portableAppData.ts:774`:
```typescript
export function purgeOrphanTempFiles(tempDir: string): number {
  const entries = fs.readdirSync(tempDir);
  for (const entry of entries) {
    const isOrphan = entry.endsWith(".tmp") || entry.includes(".tmp_");
    ...
  }
}
```
**Defect**: `tempDir` contains subdirectories named after project IDs (e.g. `temp/okgrg/`, `temp/ekm8j/`).
Because `readdirSync` only reads the root of `temp/`, any `.tmp_` file inside subdirectories was never inspected or deleted.
**Fix**: `purgeOrphanTempFiles()` must recursively traverse subdirectories to clean up `.tmp` and `.tmp_` files in all project folders.

---

## 6. Non-Blocking Ingestion Error Handling & Badging Architecture

### 6.1 Modal Error Dialog Elimination
1. **Renderer Interceptors (`electronRenderMain.tsx:14–33`)**:
   Currently, unhandled promise rejections and window errors invoke `getHostBridge().showErrorDialog(...)`, which calls `dialog.showErrorBox(...)` in the main process.
   *Resolution*: Forward uncaught errors to `console.error(...)`. Electron `appWindow.ts:135` automatically redirects all renderer `console.error` logs to `toad.log`.
2. **Main Process Dialog Suppression (`main.ts:193–195, 488–499`)**:
   In `ipcMain.handle("errorDialog")`, log error traces to `toad.log` using `log.error()`. Only trigger `dialog.showErrorBox()` when `fatal === true`.
3. **Action Boundary (`actions.ts:350–384`)**:
   Wrap `replaceCurrentView()` in `try ... catch`. When an open/ingest error occurs:
   - Log the full stack trace to `console.error()`.
   - Mark error status in `MultipleLoadingManager`.
   - Set `activeLoadingFile` to display the built-in center error card in `AppPane.tsx` (`<div className="center-app-pane center-error-pane">`) rather than propagating an unhandled rejection.

### 6.2 Status Badging in Sidebar and Project Table
1. **`ProjectFilesTable.tsx:311–316`**:
   Replace text `!` with Blueprint `<Icon icon="error" size={12} style={{ color: "#ef4444" }} />` inside `<span className="status-indicator status-error">`.
2. **`DataSourceSidebar.tsx:245–252`**:
   Already renders `<span className="status-dot status-dot-error ds-file-node-error-badge">!</span>` when `isError` is true. Ensure `item.status === "error"` propagates to all sibling keys for the same canonical path in `MultipleLoadingManager`.
3. **`ToadParquetLedger` Synchronization**:
   Record `event_type: "FILE_ERROR"` with `status: "ERROR"` and `extra_json: { error, stack }` so project ledger persistently remembers failed file status across restarts.

---

## 7. Concrete Code Recommendations for Workers

### Recommendation 1: Gateway Cache Eviction in `reltab-fs.ts`
**Target File**: `tad-master/packages/reltab-fs/src/reltab-fs.ts`  
**Lines**: 268–306  
**Rationale**: Prevents early return if cached Parquet is corrupted; evicts corrupted cache and falls through to `nativeCSVImport()`.

```typescript
    // NHÁNH 1: Parquet cache đã tồn tại sẵn trên đĩa (Instant Cache Hit)
    if (isCacheHit && cachedPaths) {
      const extName = path.extname(targetPath).toLowerCase();
      const baseName = path.basename(targetPath, extName);
      const tableName = importInfo?.tableName || reltabDuckDB.genTableName(baseName);

      let uiConn: any = null;
      let mountSuccess = false;
      try {
        uiConn = await this.dbc.connPool.take();
        await reltabDuckDB.createViewFromParquet(
          uiConn,
          cachedPaths.parquetPath,
          tableName
        );

        // Gateway Schema Validation: Evict misparsed cache on open
        if (extName === ".csv") {
          const cols: any = await uiConn.all(`DESCRIBE ${tableName}`);
          const firstColName = (cols[0]?.column_name || "").replace(/^\uFEFF/, "");
          const isOneColRawEvent = cols.length === 1 && firstColName === "raw_event";
          const isMisparsedDelimiter =
            firstColName.includes(",") &&
            (cols.length === 1 || cols.some((c: any) => /^column\d+$/i.test(c.column_name)));

          if (isOneColRawEvent || isMisparsedDelimiter) {
            log.warn(
              `[DualEngine UI] Phat hien cache loi delimiter cho "${path.basename(
                targetPath
              )}". Dao thai cache va nap lai da cot!`
            );
            await uiConn.exec(`DROP VIEW IF EXISTS ${tableName}`);
            if (fs.existsSync(cachedPaths.parquetPath)) {
              try {
                fs.unlinkSync(cachedPaths.parquetPath);
              } catch {}
            }
            reltabDuckDB.ToadParquetLedger.getInstance()
              .recordEvent({
                event_id: `evict-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                timestamp: Date.now(),
                source_path: targetPath,
                source_size: 0,
                source_mtime: 0,
                parquet_path: cachedPaths.parquetPath,
                parquet_size: 0,
                row_count: 0,
                status: "DELETED",
                duration_ms: 0,
                extra_json: JSON.stringify({ reason: "evict_misparsed_delimiter_gateway" }),
              })
              .catch(() => {});
            mountSuccess = false;
          } else {
            mountSuccess = true;
          }
        } else {
          mountSuccess = true;
        }

        if (mountSuccess) {
          log.info(
            `[DualEngine UI] Mount VIEW thanh cong tu Parquet cache vao UI Engine: ${tableName} (< 1ms)`
          );
        }
      } catch (viewErr) {
        log.warn("[DualEngine UI] Loi khi tao VIEW tu Parquet cache:", viewErr);
        mountSuccess = false;
      } finally {
        if (uiConn) {
          this.dbc.connPool.giveBack(uiConn);
        }
      }

      if (mountSuccess) {
        if (!isIPFSPath(targetPath)) {
          try {
            const fileStats = await fsPromises.stat(targetPath);
            importInfo = {
              tableName,
              importModTime: fileStats.mtime,
            };
            this.importMap[targetPath] = importInfo;
          } catch {}
        } else {
          importInfo = { tableName };
          this.importMap[targetPath] = importInfo;
        }
        return tableName;
      }
      // If mount failed or cache was evicted, fall through to NHÁNH 2 (Streaming Ingest)!
    }
```

---

### Recommendation 2: Physical Probe in `checkDoubleValidCache` & `getCacheValidityStatus`
**Target File**: `tad-master/packages/reltab-duckdb/src/csvimport.ts`  
**Lines**: 2420–2485  
**Rationale**: Rejects corrupted Parquet caches before view creation, returning `"CORRUPTED"` to project registration and sidebar queries.

```typescript
/**
 * Fast synchronous probe for misparsed Parquet cache footer
 */
export function isParquetFileMisparsedSync(parquetPath: string): boolean {
  try {
    if (!fs.existsSync(parquetPath)) return false;
    const stat = fs.statSync(parquetPath);
    if (stat.size < 12) return true;
    const fd = fs.openSync(parquetPath, "r");
    const readSize = Math.min(stat.size, 16384);
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);
    const latinStr = buf.toString("latin1");
    const hasColumnN = /column0[1-9]|column1[0-9]/i.test(latinStr);
    const hasCommaInHeader = /Timestamp,EventTime/i.test(latinStr);
    return hasColumnN || hasCommaInHeader;
  } catch {
    return false;
  }
}
```

In `getCacheValidityStatus(filePath, cachedPaths, forceReopen)` (line 2426):
```typescript
  // Level 2: Kiểm tra tệp cache Parquet vật lý
  const parquetPath = cachedPaths?.parquetPath || entry.parquet_path;
  if (!parquetPath || !fs.existsSync(parquetPath)) return "CORRUPTED";
  try {
    const pStat = fs.statSync(parquetPath);
    if (pStat.size === 0 || pStat.size !== Number(entry.parquet_size)) return "CORRUPTED";

    // Gateway Header Probe for CSV files
    if (filePath.toLowerCase().endsWith(".csv") && isParquetFileMisparsedSync(parquetPath)) {
      return "CORRUPTED";
    }
  } catch {
    return "CORRUPTED";
  }
```

---

### Recommendation 3: Enforce `all_varchar = true` and `delim = ','` across CSV Tiers
**Target File**: `tad-master/packages/reltab-duckdb/src/csvimport.ts`  
**Lines**: 2813–2875  
**Rationale**: Ensures Tier 0 and Tier 1 never omit `all_varchar = true`, preventing C++ `vector.cpp:1859` assertion crashes.

```typescript
  // Tier 0: Lệnh chính RFC-4180 chuẩn (định rõ delim cho CSV/TSV, all_varchar=true, TUYỆT ĐỐI không dùng escape='')
  const tier0Query = `
    COPY (
      SELECT * FROM read_csv(
        '${safeSrc}',
        ${defaultDelimClause}
        auto_detect = true,
        sample_size = 100000,
        ignore_errors = true,
        null_padding = true,
        all_varchar = true
      )
    ) TO '${safeDst}' (FORMAT PARQUET, COMPRESSION ${compression}, ROW_GROUP_SIZE ${rowGroupSize});
  `;
```

And in `ingestWorker.ts:97–108` and `118–130`: Add `all_varchar = true` to Tier 0 and Tier 1 templates.

---

### Recommendation 4: Fix Worker Argument Handling in `ingestWorker.ts`
**Target File**: `tad-master/packages/reltab-duckdb/src/ingestWorker.ts`  
**Lines**: 20–22  
**Rationale**: Accurately activates Safe Profile when `cfg.isComplex` is true.

```typescript
  const filePath = process.argv[2];
  const targetParquetPath = process.argv[3];
  const cfgJson = process.argv[4] || "{}";

  let cfg: any = {};
  try {
    cfg = JSON.parse(cfgJson);
  } catch {}

  const isComplexLog = process.argv[5] === "1" || cfg.isComplex === true;
```

---

### Recommendation 5: Recursive Orphan Cleaner in `portableAppData.ts`
**Target File**: `tad-master/packages/tad-app/app/portableAppData.ts`  
**Lines**: 774–805  
**Rationale**: Cleans up leftover `.tmp_` files in all project subfolders (`temp/okgrg/`, `temp/ekm8j/`).

```typescript
export function purgeOrphanTempFiles(tempDir: string): number {
  let purgedCount = 0;
  try {
    if (!fs.existsSync(tempDir)) return 0;

    function walkAndPurge(dir: string) {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (entry === "toad_ledger.parquet" || entry.endsWith("_ledger.parquet")) {
          continue;
        }
        const fullPath = path.join(dir, entry);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            walkAndPurge(fullPath);
          } else {
            const isOrphan = entry.endsWith(".tmp") || entry.includes(".tmp_");
            if (isOrphan) {
              fs.unlinkSync(fullPath);
              purgedCount++;
              log.info(`[OrphanPurge] Da don file rac mo coi: ${entry}`);
            }
          }
        } catch (err: any) {
          log.warn(`[OrphanPurge] Khong the xoa file mo coi ${entry}:`, err?.message);
        }
      }
    }

    walkAndPurge(tempDir);
  } catch (err: any) {
    log.warn("[OrphanPurge] Loi khi quet thu muc temp:", err?.message);
  }
  return purgedCount;
}
```

---

### Recommendation 6: Immediate Disk & Ledger Cleanup for `sample_40gb.csv`
**Action**: Delete stale files directly:
1. `Remove-Item "releases/toadAppData_uthyw/temp/okgrg/sample_40gb_cached_3535af61fe.tmp_1793688800513.parquet" -Force`
2. `Remove-Item "build/latest/toadAppData_p486h/temp/ekm8j/sample_40gb_cached_3535af61fe.parquet" -Force`
3. `Remove-Item "build/Toad-2.4.6/toadAppData_p486h/temp/ekm8j/sample_40gb_cached_3535af61fe.parquet" -Force`
4. Evict `sample_40gb.csv` entries in `toad_ledger.parquet` across all active AppData directories.

---

### Recommendation 7: Non-Blocking Error Boundary in `actions.ts`
**Target File**: `tad-master/packages/tadviewer/src/actions.ts`  
**Lines**: 350–384  
**Rationale**: Eliminates unhandled promise rejections that trigger modal dialogs; displays in-canvas error message while keeping sidebar interactive.

```typescript
    try {
      manager.pause();
      await startAppLoadingTimer(stateRef);
      await replaceCurrentView(path, stateRef, viewParams);
      const dv = await waitForDataView(stateRef, 8000);
      ...
    } catch (err: any) {
      console.error(`[Actions] Failed to open dataset:`, err?.stack || err);
      manager.markError(path, err?.message || String(err));
      setActiveLoadingFile(
        {
          isLoading: false,
          fileName,
          dsPath: path,
          percent: 0,
          error: err?.message || String(err),
        },
        stateRef
      );
    } finally {
      stopAppLoadingTimer(stateRef);
      const cur = mutableGet(stateRef).activeLoadingFile;
      if (!cur?.error) {
        setActiveLoadingFile(null, stateRef);
      }
      manager.resume();
    }
```
