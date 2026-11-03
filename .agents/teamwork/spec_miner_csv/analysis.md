# Comprehensive CSV Sniffer, Cache Invalidation, and Error Handling Specification

**Document Version**: 1.0.0  
**Author**: Specification Miner (`spec_miner_csv`)  
**Date**: 2026-11-03  
**Working Workspace**: `d:\Shared_UserData\Downloads\tad`  
**Reference Document**: `C:\Users\huydq\.gemini\antigravity\brain\489b863f-84dc-4fd6-bbfb-142488ba4d23\bao_cao_root_cause_analysis_csv_column_split.md`  
**Authoritative Contracts**: `ORIGINAL_REQUEST.md`, `AGENTS.md`, DuckDB v1.0.0 CSV Engine Specification  

---

## 1. Root Cause Analysis: DuckDB Delimiter Misparsing & Cache Hit Flaws

### 1.1 Technical Mechanism: Invalidation of RFC-4180 Quote Escaping via `escape = ''`
In RFC-4180 standard CSV format, quotation marks inside quoted fields are represented by doubled quotes: `""`.
In DuckDB, the standard CSV parser and sniffer operate with:
- `quote = '"'`
- `escape = '"'` (or default RFC-4180 escaping)

In earlier iterations of Toad, developers introduced `escape = ''` (empty string) into DuckDB `read_csv()` query templates in an attempt to suppress a native C++ assertion crash (`vector.cpp:1859`). However, explicitly passing `escape = ''` completely strips DuckDB of the ability to escape doubled quotes.

When encountering files with nested quotes (such as DFIR security logs and PowerShell command executions in `sample_40gb.csv`):
1. Lines such as 46, 194, and 195 contain scripts with embedded quotation marks (e.g., `[Parameter(ParameterSetName='ByU"`, `$args[0]`).
2. With `escape = ''`, DuckDB interprets the first `"` inside a string as an immediate, premature column boundary.
3. The remainder of the line triggers quote syntax errors (`unterminated quote` or `unquoted quote`).
4. During CSV sniffing (with `sample_size = 100000`), DuckDB tests candidate delimiters (`,`, `;`, `\t`, `|`).
5. Because candidate `,` triggers syntax violations on quote characters, DuckDB's sniffer **permanently eliminates comma `,` from the list of valid delimiters**.

### 1.2 Delimiter Misidentification: Selection of Pipe (`|`) on Line 195
1. Line 195 of `sample_40gb.csv` is a 24,443-character PowerShell script log containing 524 quotation marks and **exactly 10 pipe `|` characters** (from pipeline expressions: `... | Out-String | Select-Object | ...`).
2. These 10 pipes split line 195 into **11 distinct segments**.
3. With `null_padding = true`, DuckDB's sniffer favors candidate delimiters that split sampled rows into the largest consistent column count without violating syntax.
4. Because `,` was eliminated due to quote errors, DuckDB selects **pipe `|`** as the table's delimiter, establishing a schema of **11 columns**.

### 1.3 Synthetic Column Generation (`column01` .. `column10`) & Column 0 Collapse
1. **Header Collapse**:
   - Line 1 (CSV header): `Timestamp,EventTime,RuleTitle,RuleID,Level,Computer,Channel,EventID,RecordID,Details,ExtraFieldInfo`.
   - Line 1 contains 10 commas but **0 pipe `|` characters**.
   - When parsed with delimiter `|`, the entire header line is treated as a single token. DuckDB assigns this entire 11-column concatenated string as the name of **Column 0**:
     `"Timestamp,EventTime,RuleTitle,RuleID,Level,Computer,Channel,EventID,RecordID,Details,ExtraFieldInfo"`.
2. **Auto-naming of Missing Columns**:
   - Because the schema requires 11 columns but line 1 only supplied 1 name, DuckDB's column auto-namer generates names for the remaining 10 columns: `column01`, `column02`, `column03`, ..., `column10`.
3. **Data Distribution Across Rows**:
   - **Over 61 million log rows** contain 0 pipes. The entire raw log line falls into Column 0, leaving `column01` .. `column10` completely `NULL`.
   - **1,217,945 WMI Provider log rows** (e.g. line 13,851: `...Provider: Microsoft|DSLDAPClassProvider|V1.0...`) contain exactly 2 pipes. They split into 3 segments: Column 0, `column01`, and `column02`, leaving `column03` .. `column10` empty.

### 1.4 Cache Hit Bypass Flaw in `reltab-fs.ts`
Even after an earlier fix attempted to remove `escape = ''` and lock `delim = ','` in `csvimport.ts:3109`, user sessions continued to display the corrupted schema due to an architectural cache-hit bypass in `reltab-fs.ts:261–285`:

```typescript
// reltab-fs.ts lines 261-268
const isCacheHit = cachedPaths
  ? reltabDuckDB.checkParquetCache(targetPath, cachedPaths, forceReopen)
  : false;

if (isCacheHit && cachedPaths) {
  // Direct VIEW creation bypassing all CSV parsing and CSV cache checks!
  await reltabDuckDB.createViewFromParquet(uiConn, cachedPaths.parquetPath, tableName);
  return tableName; // <--- EARLY RETURN!
}

// nativeCSVImport() is ONLY called when isCacheHit is false!
tableName = await reltabDuckDB.nativeCSVImport(...);
```

1. `checkParquetCache()` delegates to `checkDoubleValidCache()`, which only validates file existence, size, and modification timestamp (`mtime`).
2. Because the corrupt parquet file (`sample_40gb_cached_3535af61fe.parquet`, 4.88 GB) was already present on disk and its size matched the ledger entry (`status: "READY"`), `isCacheHit` returned `true`.
3. `reltab-fs.ts` mounted the corrupted Parquet file directly into the UI Engine and returned immediately.
4. The cache sanity check (`isMisparsedDelimiter`) in `csvimport.ts:3109` was situated inside `nativeCSVImport()`, which was **never invoked** when `isCacheHit` was `true`.

### 1.5 RAM First-Page Micro-Cache (< 2ms) Contamination
In `MultipleLoadingManager.ts:825–848`, upon completing background ingestion, the first 1,000 rows were pre-warmed into an in-memory Map:
```typescript
const cacheEntry: FirstPageCacheEntry = {
  tableName,
  schema: tableRep.schema,
  tableRep,
  totalRowCount,
  cachedAt: Date.now(),
};
this.setFirstPageCache(processingItem.canonicalPath, cacheEntry);
```
When a user clicked the file in the sidebar, `actions.ts:168–193` retrieved the first 1,000 corrupted rows directly from memory in < 2ms, completely masking any backend reload attempts.

### 1.6 Empirical Verification via DuckDB Node API
Direct verification against `D:\Shared_UserData\Downloads\data_sample\sample_40gb.csv` confirmed:

- **With `escape = ''` (Bug simulation)**:
  ```sql
  SELECT * FROM read_csv('sample_40gb.csv', escape = '', auto_detect = true, sample_size = 1000, ignore_errors = true, null_padding = true, parallel = false, all_varchar = true)
  ```
  Result: Column 0 = `Timestamp,EventTime,RuleTitle,RuleID,Level,Computer,Channel,EventID,RecordID,Details,ExtraFieldInfo`, followed by `column01` .. `column10` (100% bug reproduction).

- **With `delim = ','` AND `escape = ''`**:
  ```sql
  SELECT * FROM read_csv('sample_40gb.csv', delim = ',', escape = '', auto_detect = true, ...)
  ```
  Result: Fails immediately with `Invalid Input Error: CSV options could not be auto-detected. Consider setting parser options manually.`

- **Standard Parser (`delim = ','`, NO `escape = ''`, `all_varchar = true`)**:
  ```sql
  SELECT * FROM read_csv('sample_40gb.csv', delim = ',', auto_detect = true, sample_size = 1000, ignore_errors = true, null_padding = true, parallel = false, all_varchar = true)
  ```
  Result: All 11 proper columns extracted cleanly with exact values:
  `Timestamp`, `EventTime`, `RuleTitle`, `RuleID`, `Level`, `Computer`, `Channel`, `EventID`, `RecordID`, `Details`, `ExtraFieldInfo`.

---

## 2. Requirements Specification (R1 through R5)

### 2.1 R1: Gateway Cache Validation & Misparsed Parquet Eviction
- **Requirement**: Move or mirror `isMisparsedDelimiter` (and rawEvent fallback checks) directly into `checkDoubleValidCache` and into `reltab-fs.ts` before / immediately following `createViewFromParquet()`.
- **Target Logic**:
  1. If a cached parquet file exhibits:
     - Column 0 whose name contains commas (e.g. `Timestamp,EventTime,...`), or
     - Contains any synthetic columns matching `/^column\d+$/i` (e.g. `column01`..`column10`), or
     - For `.csv` files, contains only 1 column named `raw_event` (from an unwanted fallback).
  2. The cache must be immediately classified as corrupted/evicted:
     - Drop the temporary view (`DROP VIEW IF EXISTS <tableName>`).
     - Unlink the physical corrupt parquet file from disk.
     - Clear the RAM first-page micro-cache for that canonical path.
     - Record an eviction event (`status: "DELETED"`) in `ToadParquetLedger`.
     - In `reltab-fs.ts`, do not return the table name; fall through directly to `nativeCSVImport()` to perform fresh streaming re-ingestion.

### 2.2 R2: CSV Parser Configuration & Stability
- **Requirement**: Verify and enforce that `csvimport.ts` and `ingestWorker.ts` use `delim = ','` without `escape = ''` for CSV files, maintaining `all_varchar = true` to prevent native `vector.cpp:1859` assertion crashes.
- **Parser Settings**:
  - `delim = ','` (strictly applied to `.csv` files; tab `\t` for `.tsv`).
  - No `escape = ''` (rely on RFC-4180 quote escaping `""`).
  - `all_varchar = true` maintained across all safe profiles and fallback tiers.
  - `null_padding = true` and `ignore_errors = true` enabled.
  - In `ingestWorker.ts`, fix argument resolution so `isComplexLog` accurately detects `cfg.isComplex === true` or `process.argv[5] === "1"`.

### 2.3 R3: Cache and Stale Temporary File Cleanup
- **Requirement**: Clean up any stale `.tmp_` files and corrupted parquet cache files for `sample_40gb.csv` in `releases/toadAppData_*`, `build/Toad-*/toadAppData_*`, and active cache directories, ensuring clean ledger state.
- **Target Inventory**:
  1. `build/Toad-2.4.6/toadAppData_p486h/temp/ekm8j/sample_40gb_cached_3535af61fe.parquet` (4.88 GB corrupt parquet).
  2. `releases/toadAppData_uthyw/temp/okgrg/sample_40gb_cached_3535af61fe.tmp_1793688800513.parquet` (4.88 GB stale partial temp file).
  3. Recursive scanning in `portableAppData.ts:purgeOrphanTempFiles()` so that subdirectories of `temp/` (e.g. `temp/okgrg/`, `temp/ekm8j/`) have orphan `.tmp` and `.tmp_` files deleted at startup.

### 2.4 R4: Non-blocking Ingestion Error Handling & Logging
- **Requirement**: Whenever any file throws an ingestion or processing exception during loading or worker processing:
  1. Catch the exception and record the full error trace into the log file (`toad.log`).
  2. Update the file's status in the project sidebar/ledger to error status with an exclamation mark circle icon (`!`) to visually indicate a failed file, rather than presenting an intrusive pop-up error dialog that forces the user to click "ignore".
- **Implementation Specifications**:
  1. In `actions.ts:openDataSourcePath()`, wrap `replaceCurrentView()` in `try ... catch`. On error:
     - Log full stack trace via `console.error` (which `appWindow.ts:135` automatically redirects to `toad.log`).
     - Set status to `"error"` in `MultipleLoadingManager`.
     - Update `activeLoadingFile` to display the existing center error card in `AppPane.tsx` (`<div className="center-app-pane center-error-pane">`) rather than throwing an unhandled rejection.
  2. In `main.ts:193` (`errorDialog` IPC handler):
     - Log error details to `toad.log`.
     - Suppress `dialog.showErrorBox` unless `fatal === true`.
  3. In `electronRenderMain.tsx:24–33`:
     - Prevent unhandled promise rejections from popping up blocking dialogs.
  4. In `ProjectFilesTable.tsx:311–316`:
     - Render BlueprintJS `<Icon icon="error" size={12} style={{ color: "#ef4444" }} />` for status `"ERROR"`, matching the circular design language of 🟢, 🔴, and ◌.

### 2.5 R5: Build & Workspace Adherence
- **Requirement**: Run `fastbuild.ps1` to produce the updated runnable application directory / binary. Respect workspace guidelines in `AGENTS.md` (use Jujutsu `jj`, Zero-Duplicate Binary Storage policy).
- **Standards**:
  - `reltab-fs` TypeScript compilation must be executed prior to or within `fastbuild.ps1` so that changes in `reltab-fs/src/reltab-fs.ts` are reflected in `dist/reltab-fs.js`.
  - Binary outputs restricted to canonical locations: `build/Toad-<version>/Toad.exe` and `Toad.exe`.
  - Use Jujutsu `jj` commands (`jj status`, `jj diff`, `jj describe`) for tracking changes.

---

## 3. DuckDB CSV Parser Parameters & Crash Mechanisms

### 3.1 Parameter Reference Matrix

| Parameter | Recommended Value | Reason | Risk if Misconfigured |
|---|---|---|---|
| `delim` | `','` for `.csv`, `'\t'` for `.tsv` | Pins the delimiter so the sniffer does not pick pipe `\|` or other characters. | Omitting allows DuckDB to choose `\|` when rows contain scripts. |
| `escape` | OMIT / Default (DO NOT set `''`) | Enables standard RFC-4180 double-quote escaping `""`. | Setting `''` destroys quote parsing, causing syntax errors on quotes. |
| `quote` | `'"'` | Standard quote wrapper for string fields. | Changing to `''` breaks comma-containing text fields. |
| `all_varchar` | `true` | Forces 100% of columns to `PhysicalType::VARCHAR`. Completely eliminates type-mismatch assertions in C++. | Setting to `false` triggers `vector.cpp:1859` assertion when dirty data is encountered. |
| `null_padding` | `true` | Pads ragged/short lines with `NULL` rather than failing. | Setting to `false` causes immediate parse failure on uneven log rows. |
| `ignore_errors` | `true` | Skips irrecoverably malformed rows rather than aborting ingestion. | Setting to `false` aborts multi-gigabyte ingestion on a single bad line. |
| `parallel` | `false` (for complex logs/fallbacks) | Eliminates chunk-boundary race conditions and token splitting on extremely long lines (> 20KB). | `true` on complex logs can cause line chunking failures. |
| `sample_size` | `100000` | Sufficient statistical sample to correctly infer header and columns. | Small sample (< 1000) may miss edge-case quoting patterns. |

### 3.2 Native DuckDB `vector.cpp:1859` Assertion Crash Mechanism
In DuckDB's native C++ engine (`duckdb.node`):
- When `read_csv` infers a column as a primitive numeric type (e.g., `INTEGER` or `DOUBLE`), it allocates a fixed-width native vector.
- When an edge-case row contains non-numeric text or improperly escaped strings, DuckDB attempts to manipulate vector buffers or downcast string tokens into numeric memory.
- In native debug or release builds with assertions enabled, this triggers:
  `Assertion failed: (vector.GetType().InternalType() == PhysicalType::VARCHAR), function Resize, file .../vector.cpp, line 1859.`
- Because this occurs in native C++ addon code, an uncaught assertion instantly terminates the Node.js / Electron host process (hard crash with no JS stack trace).
- **The True Remedy**: Setting `all_varchar = true` ensures that **every** vector allocated is physically `PhysicalType::VARCHAR`. String vectors cannot trigger numeric type conversion assertions, completely neutralizing `vector.cpp:1859` without breaking quote parsing.

### 3.3 Safe Ingest Profile vs Fallback Strategy

```
Input File (.csv)
      │
      ▼
Is Complex Log File? (MFT, Security, EventLog, etc.)
  ├── YES ──► Safe Ingest Profile:
  │           delim = ',', all_varchar = true, parallel = false, no escape = ''
  │           (Stage 1: auto_detect=true -> Stage 2: force header=true)
  │
  └── NO  ──► 4-Tier Defensive Fallback Pipeline:
              ├── Tier 0: RFC-4180 Standard (delim = ',', auto_detect = true)
              ├── Tier 1: Tier 0 + parallel = false
              ├── Tier 2: Tier 1 + all_varchar = true
              ├── Tier 2b: Force Header (header = true, delim = ',', all_varchar = true)
              └── Tier 3: Raw Event Mode (single 'raw_event' column)
```

### 3.4 Worker Argument Passing Bug
In `tad-master/packages/reltab-duckdb/src/ingestWorker.ts:21`:
`const isComplexLog = process.argv[5] === "1";`
However, `csvimport.ts:2667–2678` constructs arguments as:
`args = [params.filePath, params.targetParquetPath, JSON.stringify(cfg)];`
`process.argv[4]` is the JSON configuration, and `process.argv[5]` is `undefined`!
To fix this, `ingestWorker.ts` must parse `isComplex` from `cfg`:
```typescript
const isComplexLog = process.argv[5] === "1" || cfg.isComplex === true;
```

---

## 4. Gateway Cache Validation & Eviction Specification

### 4.1 Placement in Gateway Pipeline
Gateway validation must operate at two distinct inspection gates:
1. **Gate 1: Physical / Metadata Gate (`checkDoubleValidCache` / `getCacheValidityStatus`)**:
   - Location: `packages/reltab-duckdb/src/csvimport.ts:2439`.
   - Executed during: Project registration, sidebar listing, and `reltab-fs.ts` cache check.
   - Synchronous inspection: Reads the Parquet footer (last 8,192 bytes) synchronously using `fs.readSync()`.
   - If the footer contains `column01` or Column 0 with commas, immediately returns `false` (or `"CORRUPTED"` in `getCacheValidityStatus`).
2. **Gate 2: Active Connection Gate (`reltab-fs.ts:getTableName`)**:
   - Location: `packages/reltab-fs/src/reltab-fs.ts:268`.
   - Executed during: File opening and user view mounting.
   - Immediately following `createViewFromParquet()`, executes:
     `const cols = await uiConn.all("DESCRIBE " + tableName);`
   - Validates column names against the misparse pattern.
   - If misparsed, drops view, unlinks parquet, records eviction, and falls through to `nativeCSVImport()`.

### 4.2 Misparsed Cache Definition & Detection Criteria
A cache entry for a `.csv` file is misparsed if ANY of the following hold true:
1. `cols.length === 1 && cols[0].column_name === "raw_event"` (Corrupted 1-column raw event fallback).
2. `cols[0].column_name.replace(/^\uFEFF/, "").includes(",")` (Column 0 contains commas, indicating header string concatenation).
3. Any column matches `/^column\d+$/i` (e.g. `column01`..`column10`, generated by sniffer column shortfall).
4. `extra_json` in the ledger has `isRawEventFallback === true` or `isMisparsedDelimiter === true`.

### 4.3 Eviction Protocol
When a misparsed cache is detected:
1. **View Cleanup**: `await dbConn.exec("DROP VIEW IF EXISTS " + tableName);`
2. **Disk Unlink**:
   ```typescript
   if (fs.existsSync(parquetPath)) {
     try { fs.unlinkSync(parquetPath); } catch {}
   }
   ```
3. **RAM Micro-cache Invalidation**:
   `MultipleLoadingManager.getInstance().clearFirstPageCache(targetPath);`
4. **Ledger Eviction Record**:
   ```typescript
   ToadParquetLedger.getInstance().recordEvent({
     event_id: `evict-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
     timestamp: Date.now(),
     source_path: targetPath,
     source_size: 0,
     source_mtime: 0,
     parquet_path: parquetPath,
     parquet_size: 0,
     row_count: 0,
     status: "DELETED",
     duration_ms: 0,
     extra_json: JSON.stringify({ reason: "evict_misparsed_delimiter_gateway" }),
   }).catch(() => {});
   ```
5. **Fallthrough**: Continue execution directly into the fresh streaming import pipeline without returning early.

### 4.4 Synchronous Fast Parquet Footer Probe
To allow synchronous functions (`checkDoubleValidCache`) to inspect schema without opening a DuckDB connection:
```typescript
export function isParquetFileMisparsedSync(parquetPath: string): boolean {
  try {
    if (!fs.existsSync(parquetPath)) return false;
    const stat = fs.statSync(parquetPath);
    if (stat.size < 12) return true; // Parquet magic is 4 bytes at start, 4 bytes at end + 4 bytes length
    const fd = fs.openSync(parquetPath, "r");
    const readSize = Math.min(stat.size, 16384);
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);
    const latinStr = buf.toString("latin1");
    // Check for column01..columnN pattern or comma inside first column string
    const hasColumnN = /column0[1-9]|column1[0-9]/i.test(latinStr);
    const hasCommaInHeader = /Timestamp,EventTime/i.test(latinStr);
    return hasColumnN || hasCommaInHeader;
  } catch {
    return false;
  }
}
```

---

## 5. Cache & Stale Temporary File Cleanup Specifications

### 5.1 Stale Files Inventory
Direct scanning identified the following corrupted files requiring immediate cleanup:

| Path | Size | Status | Action |
|---|---|---|---|
| `build/Toad-2.4.6/toadAppData_p486h/temp/ekm8j/sample_40gb_cached_3535af61fe.parquet` | 4,885,541,321 B (~4.88 GB) | Corrupted Parquet with `column01`..`column10` | Delete file & purge ledger entry |
| `releases/toadAppData_uthyw/temp/okgrg/sample_40gb_cached_3535af61fe.tmp_1793688800513.parquet` | 4,880,670,466 B (~4.88 GB) | Partial stale temporary file | Delete file |

### 5.2 Recursive Traversal Defect in `purgeOrphanTempFiles`
In `packages/tad-app/app/portableAppData.ts:774`:
```typescript
// CURRENT DEFECTIVE CODE:
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

**Required Specification**:
The orphan cleaner must recursively traverse all subdirectories of `tempDir`, locating and removing:
1. Any file matching `*.tmp` or containing `.tmp_`.
2. Any empty project subdirectories left behind.

---

## 6. Non-Blocking Ingestion Error Handling & Badging Specification

### 6.1 Pop-up Dialog Interception & Suppression
1. **Main Process (`packages/tad-app/app/main.ts`)**:
   In the IPC handler for `"errorDialog"` (lines 193–195 and 488–499):
   - Record error messages to `toad.log` using `log.error(...)`.
   - Suppress `dialog.showErrorBox()` unless `fatal === true`.
   - Prevent title formatting bugs (`[object Object]`) by normalizing object arguments:
     ```typescript
     const title = typeof arg1 === "object" ? arg1.title || "Error" : arg1 || "Error";
     const msg = typeof arg1 === "object" ? arg1.message || "" : arg2 || "";
     ```
2. **Renderer Global Interceptors (`packages/tad-app/src/electronRenderMain.tsx`)**:
   - In `window.addEventListener("unhandledrejection")` and `window.addEventListener("error")`:
   - Replace calls to `getHostBridge().showErrorDialog()` with `console.error(...)`.
   - Because `appWindow.ts:135` forwards all `console.error` messages to `toad.log`, full error traces are captured in `toad.log` without triggering native message boxes.

### 6.2 Full Stack Trace Logging to `toad.log`
- All ingestion failures must record:
  1. Timestamp (UTC or local system time).
  2. Source file path.
  3. Error name, message, and full JavaScript/Node.js stack trace.
  4. DuckDB error code / binder message if applicable.
- This is achieved via `console.error("[IngestionError] Failed processing file:", filePath, err.stack)`.

### 6.3 UI Badging in `ProjectFilesTable.tsx` & `DataSourceSidebar.tsx`
- When a file has status `"ERROR"`:
  - In `ProjectFilesTable.tsx:311–316`:
    Replace the text `!` glyph with:
    ```tsx
    <span className="status-indicator status-error" title={`ERROR: ${item?.error || "Ingestion failed"}`}>
      <Icon icon="error" size={12} style={{ color: "#ef4444" }} />
    </span>
    ```
  - In `DataSourceSidebar.tsx:245–252`:
    Ensure the error dot renders the red exclamation circle and tooltip displays the error reason.
  - In `MultipleLoadingManager.ts`:
    Ensure `dispatchWorker` error handler propagates `status: "error"` to all sibling keys sharing the same canonical file path.

### 6.4 Center Error Pane Activation (`AppPane.tsx`)
In `AppPane.tsx:542–554`, Toad already provides a non-blocking error display:
```tsx
<div className="center-app-pane center-error-pane">
  <div className="main-error-card">
    <Icon icon="error" iconSize={40} intent="danger" />
    <h3 className="main-error-title">Error loading {activeLoading.fileName}</h3>
    <p className="main-error-desc">{activeLoading.error}</p>
  </div>
</div>
```
When `actions.ts:openDataSourcePath` catches an ingestion error, it must set `activeLoadingFile` to:
`{ isLoading: false, fileName, dsPath, percent: 0, error: err.message }`
This immediately presents the center error card while keeping the entire sidebar interactive, allowing the user to select other files without clicking "OK" or "Ignore".

---

## 7. Build & Verification Criteria

### 7.1 FastBuild Pipeline & TypeScript Dependencies
`fastbuild.ps1` builds the following packages:
1. `packages/host-bridge`
2. `packages/reltab-duckdb`
3. `packages/tadviewer`
4. `packages/tad-app` (Webpack prod/dev bundles)
5. `electron-builder --dir` -> `build/Toad-<version>/Toad.exe`

**Critical Build Step Requirement**:
Because `reltab-fs.ts` is in `packages/reltab-fs/src/reltab-fs.ts`, `reltab-fs` must be built (`npm run build` in `packages/reltab-fs`) whenever `reltab-fs.ts` is modified. `fastbuild.ps1` must either include `reltab-fs` in STEP 1 or developers must compile `reltab-fs` prior to fastbuild.

### 7.2 Schema Verification Expectations for `sample_40gb.csv`
Upon opening `sample_40gb.csv` (or the first 1,000 lines mini-sample):
1. **Schema Column Count**: Exactly 11 columns.
2. **Column Names**:
   1. `Timestamp` (or `\uFEFFTimestamp`)
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
3. **No Synthetic Columns**: Zero occurrences of `column01`, `column02`, ..., `column10`.
4. **Column 0 Content**: Must contain clean ISO timestamp strings (e.g. `2026-03-12T08:40:25.383678Z`), not unparsed CSV rows with commas.
5. **Nested Quotes**: Lines with PowerShell commands (e.g. line 46, 195) must have `RuleTitle` properly extracted and `Details` containing the full script content without quote truncation.

### 7.3 Version Bumping & Zero-Duplicate Storage
- Version bump if required: Auto 4th-digit increment (e.g. `2.4.6.1`) via `tools/bump_version.js`.
- Strictly adhere to Zero-Duplicate Binary Storage policy: no copying binaries across version folders.

---

## Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | CSV Parser | Direct Delimiter Pinning | Enforces `delim = ','` on `.csv` files, preventing sniffer from picking pipe `\|`. | File path, CSV buffer | Delimiter locked to `,` | Fails if `escape = ''` is also set | `csvimport.ts:2742`, `ingestWorker.ts:92` |
| 2 | CSV Parser | Quote Escaping Restoration | Omission of `escape = ''` restores RFC-4180 double-quote escaping `""`. | CSV with nested quotes | Clean tokenization of quoted text | Sniffer falls back if quotes malformed | `bao_cao_root_cause_analysis_csv_column_split.md`, DuckDB node tests |
| 3 | CSV Parser | All-VARCHAR Memory Layout | Forces `all_varchar = true` across all columns to eliminate `vector.cpp:1859` assertion. | CSV rows with mixed types | Physical string vectors for all columns | Never crashes on type mismatch | `csvimport.ts:2748`, `ingestWorker.ts:64` |
| 4 | Cache Gateway | Parquet Schema Gateway Validation | Inspects `DESCRIBE` on newly created Parquet view in `reltab-fs.ts` to detect misparsed columns on open. | Mounted table name | Valid schema or eviction signal | Drops view and evicts parquet if corrupted | `reltab-fs.ts:268`, `csvimport.ts:3106` |
| 5 | Cache Gateway | Synchronous Parquet Footer Probe | Reads the last 8KB of Parquet files to detect `column01` and comma-containing header names without DuckDB. | Parquet file path | Boolean `isMisparsed` | Returns `false` on file read error | Node.js buffer inspection on `sample_40gb_cached_*.parquet` |
| 6 | Cache Gateway | Ledger Eviction Audit Trail | Appends `status: "DELETED"` tombstone to `ToadParquetLedger` when misparsed cache is evicted. | Source path, Parquet path, reason | Record in `toad_ledger.parquet` | Warns if ledger write fails | `csvimport.ts:3123`, `ToadParquetLedger` |
| 7 | Cleanup | Startup Recursive Orphan Purge | Recursively scans all subdirectories of `temp/` to delete orphan `.tmp` and `.tmp_*.parquet` files. | `tempDir` path | Purged file count | Logs warning on locked files | `portableAppData.ts:774` |
| 8 | Error Handling | Non-blocking Exception Boundary | Catches ingestion errors in `actions.ts:openDataSourcePath`, logging stack traces and setting error state. | `DataSourcePath`, error | `activeLoadingFile.error` set | Suppresses unhandled rejection | `actions.ts:350`, `MultipleLoadingManager.ts:911` |
| 9 | Error Handling | Dialog Suppression in Main Process | Logs all errors to `toad.log` and suppresses `dialog.showErrorBox()` unless `fatal === true`. | Error title, message, fatal flag | Entry in `toad.log` | Quits app only if fatal | `main.ts:193`, `main.ts:488` |
| 10 | Error Handling | Renderer Console Message Forwarder | Automatically redirects renderer `console.error` and `console.warn` into `toad.log` via Electron IPC. | Renderer console stream | Log lines in `toad.log` | None | `appWindow.ts:135`, `portableAppData.ts:786` |
| 11 | UI Badging | Exclamation Mark Circle Badging | Displays BlueprintJS `<Icon icon="error" />` in red (`#ef4444`) for failed files in project table. | File status `"ERROR"` | SVG circle exclamation badge | Tooltip shows error string | `ProjectFilesTable.tsx:311`, `DataSourceSidebar.tsx:245` |
| 12 | UI Center Pane | Non-blocking Center Error Card | Displays prominent error message with `icon="error"` in `AppPane.tsx` while keeping sidebar navigable. | `activeLoading.error` string | Rendered error card | None | `AppPane.tsx:542` |
| 13 | Build Tooling | Standalone Unpacked FastBuild | Builds runnable directory `build/Toad-<version>/Toad.exe` in ~35s bypassing LZMA compression. | PowerShell invocation | Unpacked app folder | Throws if bundle missing | `fastbuild.ps1` |
| 14 | Worker Sandbox | Out-of-Process Worker Sandbox | Forks separate Node/Electron process (`ingestWorker.js`) to contain any potential native DuckDB aborts. | Input path, output path, config | Process exit code 0 or 1 | Main app remains responsive | `ingestWorker.ts:17`, `csvimport.ts:2663` |

---

## Edge Cases

| # | Feature | Input | Observed Behavior |
|---|---------|-------|-------------------|
| 1 | CSV Sniffer | `sample_40gb.csv` with `escape = ''` | Sniffer rejects `,` as delimiter candidate due to quote errors in PowerShell scripts; picks pipe `\|` (10 pipes on line 195); collapses entire header into Column 0; auto-generates `column01`..`column10`. |
| 2 | CSV Parser | `sample_40gb.csv` with `delim = ','` AND `escape = ''` | Throws `Invalid Input Error: CSV options could not be auto-detected`. Fails ingestion. |
| 3 | CSV Parser | `sample_40gb.csv` with `delim = ','`, NO `escape = ''`, `all_varchar = true` | Cleanly extracts all 11 proper columns: `Timestamp`, `EventTime`, `RuleTitle`, `RuleID`, `Level`, `Computer`, `Channel`, `EventID`, `RecordID`, `Details`, `ExtraFieldInfo`. Zero assertion crashes. |
| 4 | Cache Validation | Parquet file containing `column01`..`column10` | Previous implementation: `checkParquetCache` matched size/mtime, returning `true`, bypassing `nativeCSVImport` and serving corrupt table. New spec: Gateway detects misparsed columns on open, deletes parquet file, and triggers full re-ingestion. |
| 5 | Cache Validation | CSV file cached with single `raw_event` column | Previous implementation: Served single-column raw log view. New spec: Evicts cache on open and re-ingests as multi-column CSV. |
| 6 | File Ingestion Error | Corrupt data file or unreadable disk sector | Previous implementation: Unhandled promise rejection bubbles to `window.error`, calling `dialog.showErrorBox("[object Object]")`, freezing UI until user clicks Ignore. New spec: Catches error in `openDataSourcePath`, logs full trace to `toad.log`, badges file with red `!` circle icon, and renders center error card while keeping sidebar interactive. |
| 7 | Temp Cleaner | Stale `.tmp_*.parquet` in `temp/okgrg/` subfolder | Previous implementation: `purgeOrphanTempFiles` only checked top-level `temp/`, leaving 4.88 GB file orphaned indefinitely. New spec: Recursive scan purges `.tmp_` files in all subfolders. |
| 8 | Worker Process | Worker invocation with `isComplex` flag in config | `ingestWorker.ts:21` checked `process.argv[5] === "1"`, but `csvimport.ts` passed config JSON in `process.argv[4]`. New spec: Checks `cfg.isComplex === true` to activate Safe Profile. |
| 9 | UTF-8 BOM in Header | CSV beginning with byte order mark `\uFEFFTimestamp` | DuckDB names first column `\uFEFFTimestamp`. Column matching must strip `^\uFEFF` before validating column names or running queries. |
