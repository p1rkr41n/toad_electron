# Technical Investigation & Architecture Specification: DuckDB Ingestion & Safe Mode Configuration (Requirement R2)

## 1. Executive Summary
This investigation specifies the exact code modifications and behavioral contracts for **Requirement R2** in `packages/reltab-duckdb`. It details how `safe_mode_keywords` and `safe_mode_parallel` are integrated into `IngestConfig`, how `getIngestConfig()` retrieves and falls back to environment variables and defaults (excluding `"mft"`), how `isComplexLogFile()` performs dynamic classification, how query generators in `streamCsvToParquet` and `nativeCSVImport` apply parallelization, how `ingestWorker.ts` handles out-of-process isolation with multi-threaded ingestion, and how packages are synchronized via NTFS junctions.

---

## 2. Ingest Configuration Architecture (`packages/reltab-duckdb/src/csvimport.ts`)

### 2.1 Interface Definition: `IngestConfig`
Currently located at lines 220–230 of `csvimport.ts`:
```typescript
// Current
export interface IngestConfig {
  max_memory: string;
  threads: number;
  background_threads: number | "auto";
  compression: string;
  row_group_size: number;
  binary_guard: boolean;
  temp_dir: string | null;
  ledger_path: string;
  temp_cleanup: boolean;
}
```

**Required Specification:**
Add `safe_mode_keywords: string[];` and `safe_mode_parallel: boolean;`:
```typescript
export interface IngestConfig {
  max_memory: string;
  threads: number;
  background_threads: number | "auto";
  compression: string;
  row_group_size: number;
  binary_guard: boolean;
  temp_dir: string | null;
  ledger_path: string;
  temp_cleanup: boolean;
  safe_mode_keywords: string[];
  safe_mode_parallel: boolean;
}
```

### 2.2 Default Keywords List & Constants
Define standard defaults at module level in `csvimport.ts`:
```typescript
export const DEFAULT_SAFE_MODE_KEYWORDS: string[] = [
  "hayabusa",
  "eventlog",
  "event_log",
  "security",
  "audit",
  "sysmon",
  "timeline",
  "dfir",
  "winlog",
  "firewall",
  "auth",
  "syslog",
];
```
*Note*: As mandated by R1 and R2, `"mft"` is strictly omitted from the default keywords list.

### 2.3 Keyword String Parser Helper
To ensure consistent parsing across `config.ini` and `process.env.TOAD_SAFE_KEYWORDS`:
```typescript
export function parseSafeModeKeywords(raw: string | string[] | undefined | null): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((k) => (typeof k === "string" ? k.trim().toLowerCase() : ""))
      .filter((k) => k.length > 0 && k !== "none" && k !== "off");
  }
  const str = String(raw).trim();
  if (str === "" || str.toLowerCase() === "none" || str.toLowerCase() === "off") {
    return [];
  }
  return str
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0 && k !== "none" && k !== "off");
}
```

### 2.4 Resolution Logic in `getIngestConfig()`
Located at lines 232–273 of `csvimport.ts`.

#### When `(global as any).toadPortableEnv?.config` is present:
1. `safe_mode_keywords`:
   - If `env.config.duckdb.safe_mode_keywords` is an array:
     use `parseSafeModeKeywords(env.config.duckdb.safe_mode_keywords)`.
   - If missing/undefined:
     fallback to `process.env.TOAD_SAFE_KEYWORDS ? parseSafeModeKeywords(process.env.TOAD_SAFE_KEYWORDS) : [...DEFAULT_SAFE_MODE_KEYWORDS]`.
2. `safe_mode_parallel`:
   - If `env.config.duckdb.safe_mode_parallel !== undefined`:
     use `Boolean(env.config.duckdb.safe_mode_parallel)`.
   - If missing/undefined:
     fallback to `process.env.TOAD_SAFE_PARALLEL !== undefined ? (process.env.TOAD_SAFE_PARALLEL.toLowerCase() === "true" || process.env.TOAD_SAFE_PARALLEL === "1") : true`.

#### Standalone / Test / CLI Fallback (when `toadPortableEnv` is absent):
```typescript
const envSafeKeywords = process.env.TOAD_SAFE_KEYWORDS !== undefined
  ? parseSafeModeKeywords(process.env.TOAD_SAFE_KEYWORDS)
  : [...DEFAULT_SAFE_MODE_KEYWORDS];

const envSafeParallel = process.env.TOAD_SAFE_PARALLEL !== undefined
  ? (process.env.TOAD_SAFE_PARALLEL.toLowerCase() === "true" || process.env.TOAD_SAFE_PARALLEL === "1")
  : true;
```

---

## 3. Dynamic Forensic Classification: `isComplexLogFile`

### 3.1 Current Implementation (lines 2703–2730)
```typescript
export function isComplexLogFile(filePath: string): boolean {
  if (!filePath) return false;
  const lower = filePath.toLowerCase().replace(/\\/g, "/");
  const base = path.basename(lower);
  const ext = path.extname(base);

  if ([".log", ".txt", ".evtx"].includes(ext)) {
    return true;
  }

  const complexKeywords = [
    "hayabusa",
    "eventlog",
    "event_log",
    "security",
    "audit",
    "sysmon",
    "mft",
    "timeline",
    "dfir",
    "winlog",
    "firewall",
    "auth",
    "syslog",
  ];

  return complexKeywords.some((kw) => lower.includes(kw));
}
```

### 3.2 Required Specification
```typescript
export function isComplexLogFile(
  filePath: string,
  customKeywords?: string[]
): boolean {
  if (!filePath) return false;
  const lower = filePath.toLowerCase().replace(/\\/g, "/");
  const base = path.basename(lower);
  const ext = path.extname(base);

  // 1. File extension heuristics (unconditionally complex)
  if ([".log", ".txt", ".evtx"].includes(ext)) {
    return true;
  }

  // 2. Keyword heuristic resolution
  // Use customKeywords if provided; otherwise fallback to getIngestConfig().safe_mode_keywords
  const rawKeywords =
    customKeywords !== undefined
      ? customKeywords
      : getIngestConfig().safe_mode_keywords;

  if (!rawKeywords || !Array.isArray(rawKeywords) || rawKeywords.length === 0) {
    return false;
  }

  // 3. Skip empty or whitespace-only entries and check matching
  return rawKeywords.some((kw) => {
    if (typeof kw !== "string") return false;
    const cleanKw = kw.trim().toLowerCase();
    if (cleanKw.length === 0 || cleanKw === "none" || cleanKw === "off") {
      return false;
    }
    return lower.includes(cleanKw);
  });
}
```

### 3.3 Verification of Classification Behaviors
| File Path | Default Keywords | Expected Result | Reason |
|---|---|---|---|
| `Windows.NTFS.MFT.csv` | Default (no `"mft"`) | `false` | `"mft"` omitted from defaults |
| `Windows.NTFS.MFT.csv` | `["mft"]` | `true` | Explicit custom keyword `"mft"` matches |
| `hayabusa_high.csv` | Default | `true` | `"hayabusa"` is in default keywords |
| `Security.evtx` | Any / None | `true` | Ext `.evtx` triggers early return |
| `application.log` | Any / None | `true` | Ext `.log` triggers early return |
| `sales_2026.csv` | Default | `false` | Standard CSV, no matching keyword |
| `customers.parquet` | Default | `false` | Native Parquet, no matching keyword |
| `audit_report.csv` | `[]` (disabled) | `false` | Safe mode disabled |

---

## 4. Query Generator Optimization: Ingestion Pipelines

### 4.1 `streamCsvToParquet` in `csvimport.ts`
Located at lines 2800–2893:
- In `isComplex` block (line 2819):
  Pass `cfg.safe_mode_keywords` to `isComplexLogFile(filePath, cfg.safe_mode_keywords)`.
- In **Stage 1: Safe Profile** query (line 2822):
  Replace hardcoded `parallel = false,` with:
  ```typescript
  parallel = ${cfg.safe_mode_parallel ? "true" : "false"},
  ```
- **Stage 2: Force Header Fallback** (line 2845):
  Remains resilient fallback with `parallel = false`.

### 4.2 `nativeCSVImport` in `csvimport.ts`
Located at lines 3120–3770:
- Retrieve `cfg = getIngestConfig()`.
- Evaluate `isComplexLogFile(filePath, cfg.safe_mode_keywords)` (line 3709).
- In Safe Profile query (line 3711):
  Replace:
  ```typescript
  const query = `CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_csv('${safePath}', ${memDelimClause || "delim=',',"} auto_detect=true, sample_size=100000, ignore_errors=true, null_padding=true, parallel=false, all_varchar=true)`;
  ```
  With:
  ```typescript
  const query = `CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_csv('${safePath}', ${memDelimClause || "delim=',',"} auto_detect=true, sample_size=100000, ignore_errors=true, null_padding=true, parallel=${cfg.safe_mode_parallel ? "true" : "false"}, all_varchar=true)`;
  ```
- Also update `runIngestInWorker` options passing (line 2754) to include `safe_mode_parallel: cfg.safe_mode_parallel` and `safeModeParallel: cfg.safe_mode_parallel`.

---

## 5. Crash Firewall Worker: `ingestWorker.ts`

### 5.1 Argument Parsing & Safe Parallel Evaluation
In `tad-master/packages/reltab-duckdb/src/ingestWorker.ts`:
Line 32:
```typescript
const isComplexLog = process.argv[5] === "1" || cfg.isComplex === true;
```
Add evaluation:
```typescript
const safeParallel = cfg.safe_mode_parallel !== false && cfg.safeModeParallel !== false;
```
*Design Rationale*: Checks both snake_case (`safe_mode_parallel`) and camelCase (`safeModeParallel`), defaulting to `true` unless explicitly set to `false`.

### 5.2 Stage 1 & Stage 2 Safe Ingest Queries
Lines 56–88 in `ingestWorker.ts`:
- **Stage 1 (Auto-Detect)**:
  ```typescript
  const safeLogQuery = `
    COPY (
      SELECT * FROM read_csv(
        '${safeSrc}',
        auto_detect = true,
        sample_size = 100000,
        ignore_errors = true,
        null_padding = true,
        parallel = ${safeParallel ? "true" : "false"},
        all_varchar = true,
        delim = ','
      )
    ) TO '${safeDst}' (FORMAT PARQUET, COMPRESSION ${compression}, ROW_GROUP_SIZE ${rowGroupSize});
  `;
  ```
- **Stage 2 (Force Header Fallback)**:
  ```typescript
  const forceHeaderQuery = `
    COPY (
      SELECT * FROM read_csv(
        '${safeSrc}',
        header = true,
        delim = ',',
        ignore_errors = true,
        null_padding = true,
        parallel = ${safeParallel ? "true" : "false"},
        all_varchar = true
      )
    ) TO '${safeDst}' (FORMAT PARQUET, COMPRESSION ${compression}, ROW_GROUP_SIZE ${rowGroupSize});
  `;
  ```

---

## 6. Monorepo Package Relationship & Build Pipeline

### 6.1 Junction & Symlink Verification
Investigation via PowerShell `Get-Item`:
```
FullName   : D:\Shared_UserData\Downloads\tad\tad-master\packages\toad-app\node_modules\reltab-duckdb
LinkType   : Junction
Target     : {D:\Shared_UserData\Downloads\tad\tad-master\packages\reltab-duckdb\}
Attributes : Directory, ReparsePoint
```
- `tad-master/packages/toad-app/node_modules/reltab-duckdb` is an **NTFS Directory Junction** directly linked to `tad-master/packages/reltab-duckdb`.
- **Source synchronization is automatic**: Any change written to `tad-master/packages/reltab-duckdb/src/csvimport.ts` or `ingestWorker.ts` is immediately reflected under `toad-app/node_modules/reltab-duckdb/src/`.
- **Compilation synchronization is required**: `toad-app`'s runtime requires compiled artifacts in `dist/reltab-duckdb.js` and `dist/ingestWorker.js`. Whenever `src/` files are modified, `npm run build` must be executed in `packages/reltab-duckdb` to update `dist/`.

### 6.2 Build System & Invocation
- Directory: `tad-master/packages/reltab-duckdb`
- Script: `"build": "tsc -p tsconfig-build.json"`
- Target output: `./dist/` (`csvimport.js`, `ingestWorker.js`, etc.)
- Execution Environment: Node.js 18 located at `D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe`.
- Shell Invocation Command:
  ```powershell
  $env:PATH = "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64;$env:PATH"
  Push-Location "tad-master\packages\reltab-duckdb"
  npm.cmd run build
  Pop-Location
  ```

---

## 7. Test Suites & Regressions Analysis

### 7.1 Existing Suite Check: `tests/deep_integration_qa.js`
In `tests/deep_integration_qa.js` (line 5689), Test `LL.1` contains:
```javascript
assert.strictEqual(isComplexLogFile("mft_dump.csv"), true);
```
**CRITICAL REGRESSION NOTICE**:
Before R2, `"mft"` was in the hardcoded keywords list. Under R2, `"mft"` is intentionally excluded from the default keyword list.
Consequently:
- By default, `isComplexLogFile("mft_dump.csv")` will return `false`.
- If line 5689 is not updated, running `run_tests.js` (which runs `deep_integration_qa.js`) will fail at `LL.1`.
- **Recommended Action for Implementer**: In `deep_integration_qa.js`, either:
  1. Test custom keywords: `assert.strictEqual(isComplexLogFile("mft_dump.csv", ["mft"]), true);`, or
  2. Test default behavior: `assert.strictEqual(isComplexLogFile("mft_dump.csv"), false);` and `assert.strictEqual(isComplexLogFile("mft_dump.csv", ["mft"]), true);`.

### 7.2 Unit Test Suite: `tests/unit/test_safe_mode_config.js`
All 16 test cases specified in Requirement R3 can be cleanly implemented and validated against the specified signatures.
