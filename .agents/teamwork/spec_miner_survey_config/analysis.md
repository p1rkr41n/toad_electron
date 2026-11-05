# Configuration Specification Analysis: Configurable Safe Mode Keywords & Parallel Ingestion (Requirement R1)

**Investigator**: Config Spec Miner  
**Date**: 2026-11-05  
**Working Directory**: `.agents/teamwork/spec_miner_survey_config`  
**Reference Sources**: `ORIGINAL_REQUEST.md`, `tad-master/packages/toad-app/app/portableAppData.ts`, `tad-master/packages/reltab-duckdb/src/csvimport.ts`, `tad-master/packages/reltab-duckdb/src/ingestWorker.ts`, `tests/deep_integration_qa.js`

---

## 1. Executive Summary & Objective

In Toad v2.4.5, DuckDB streaming ingestion introduced a "Safe Ingest Profile" (`all_varchar = true`, `parallel = false`) to eliminate native C++ crashes (`D_ASSERT(vector.GetType().InternalType() == PhysicalType::VARCHAR)`) during the ingestion of heterogeneous forensic log files. However, the keywords classifying files into Safe Mode were hardcoded inside `isComplexLogFile()` (including `"mft"`), and `parallel` execution was strictly forced to `false`. For massive multi-gigabyte files (such as NTFS `$MFT` dumps containing 50M+ rows), single-threaded VARCHAR ingestion caused significant throughput bottlenecks and prevented user customization.

The objective of **Requirement R1** is to make Safe Mode fully configurable and flexible:
1. Allow users to define custom keywords via `config.ini` under `[duckdb] -> safe_mode_keywords`.
2. Allow users to toggle multi-threaded parallel ingestion in Safe Mode via `config.ini` under `[duckdb] -> safe_mode_parallel`.
3. Provide robust INI validation, case/whitespace normalization, explicit disabling (`none`, `off`, `""`), and auto-healing of missing keys/sections while preserving existing user configurations.
4. Export configuration to environment variables (`TOAD_SAFE_KEYWORDS`, `TOAD_SAFE_PARALLEL`, `TOAD_APP_DATA_DIR`) for propagation to child utility processes and standalone worker processes.

---

## 2. Authoritative Specification Probes & Code Contracts

### 2.1 Interface Contract: `ToadConfig` (`tad-master/packages/toad-app/app/portableAppData.ts`)

In `portableAppData.ts` (lines 21-50), `ToadConfig` defines the schema for configuration sections. The `duckdb` section must be extended:

```typescript
export interface ToadConfig {
  general: {
    viewer: string;
    language: string;
    page_size: number;
    max_concurrent_files: number;
    max_concurrent_gb: number;
    auto_restore_last_directory: boolean;
    last_directory: string;
  };
  runtime: {
    engine: "utility" | "legacy" | "v8" | "tauri";
    auto_fallback?: boolean;
  };
  duckdb: {
    max_memory: string;
    threads: number;
    background_threads: number | "auto";
    add_raw_event: boolean;
    // --- NEW IN R1 ---
    safe_mode_keywords: string[];
    safe_mode_parallel: boolean;
  };
  parquet: {
    compression: "zstd" | "snappy" | "gzip" | "none";
    row_group_size: number;
  };
  system: {
    temp_cleanup: boolean;
    binary_guard: boolean;
    uv_threadpool_size?: number | "auto";
  };
}
```

- `safe_mode_keywords: string[]`: Array of lowercase keyword strings matched against normalized file paths.
- `safe_mode_parallel: boolean`: Flag enabling multi-threaded DuckDB CSV ingestion (`parallel = true`) while maintaining `all_varchar = true`.

---

### 2.2 Default Configuration: `DEFAULT_CONFIG` (`portableAppData.ts`)

In `DEFAULT_CONFIG.duckdb` (lines 80-85):

```typescript
export const DEFAULT_CONFIG: ToadConfig = {
  general: { ... },
  runtime: { ... },
  duckdb: {
    max_memory: "auto",
    threads: 0,
    background_threads: "auto",
    add_raw_event: false,
    // --- NEW IN R1 ---
    safe_mode_keywords: [
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
    ],
    safe_mode_parallel: true,
  },
  parquet: { ... },
  system: { ... },
};
```

**Key Invariants:**
1. `"mft"` is **strictly excluded** from default keywords. MFT files will not trigger Safe Mode by default and will ingest via high-performance standard multi-threading.
2. `safe_mode_parallel` defaults to `true` (enabling parallel ingestion across cores during Safe Mode).

---

### 2.3 Template Text & Bilingual Comments: `DEFAULT_CONFIG_INI_TEXT` (`portableAppData.ts`)

In `DEFAULT_CONFIG_INI_TEXT` (lines 134-154), the `[duckdb]` section must be augmented with clear English and Vietnamese comments:

```ini
[duckdb]
# Maximum RAM allocated for DuckDB engine:
#   - auto : Automatically balances with available system RAM (recommended)
#   - Or: 512MB, 1GB, 2GB, 4GB, 8GB...
max_memory = auto

# Maximum CPU threads used for parallel processing:
#   - 0 : Utilize all available CPU cores/threads (default)
#   - Or: 1, 2, 4, 8...
threads = 0

# CPU threads dedicated for background file ingestion ('auto' or integer >= 1):
#   - auto : Automatically reserves 2 CPU cores for UI/query responsiveness (RECOMMENDED)
#   - Or: 1, 2, 4, 8...
background_threads = auto

# Automatically synthesize a consolidated [raw_event] column:
#   - false : (RECOMMENDED) Preserves lightning-fast columnar analytics
#   - true  : Concatenates all row values into a raw text string
add_raw_event = false

# Safe Mode CSV Ingestion Keywords (comma-separated list):
#   - Files with paths matching any keyword use 100% VARCHAR Safe Profile to eliminate DuckDB D_ASSERT collisions.
#   - To completely disable Safe Mode, set to: none, off, or leave empty ''
# Từ khóa nhận diện file log phức tạp để tự động kích hoạt Safe Mode:
#   - Khi tên hoặc đường dẫn file chứa từ khóa, DuckDB sẽ nạp ở chế độ all_varchar=true an toàn tuyệt đối.
#   - Điền 'none', 'off' hoặc để trống '' nếu muốn tắt hoàn toàn Safe Mode.
safe_mode_keywords = hayabusa, eventlog, event_log, security, audit, sysmon, timeline, dfir, winlog, firewall, auth, syslog

# Multi-threaded parallel execution in Safe Mode:
#   - true  : (RECOMMENDED) Enable parallel CSV ingestion in Safe Mode (faster processing)
#   - false : Fall back to single-threaded sequential ingestion
# Chế độ đa luồng khi nạp file trong Safe Mode:
#   - true  : (KHUYẾN NGHỊ) Bật đa luồng tăng tốc tối đa nhưng vẫn bảo đảm an toàn VARCHAR
#   - false : Chạy tuần tự đơn luồng (dành cho file cực dị bị vỡ chunk đa luồng)
safe_mode_parallel = true
```

---

### 2.4 Serialization Contract: `stringifyConfig` (`portableAppData.ts`)

In `stringifyConfig(cfg: ToadConfig): string` (lines 310-343):

```typescript
function stringifyConfig(cfg: ToadConfig): string {
  return `# ==============================================================================
#                      TOAD VIEWER SYSTEM CONFIGURATION (CONFIG.INI)
# ==============================================================================

[general]
viewer = ${cfg.general.viewer}
language = ${cfg.general.language}
page_size = ${cfg.general.page_size}
max_concurrent_files = ${cfg.general.max_concurrent_files}
max_concurrent_gb = ${cfg.general.max_concurrent_gb}
auto_restore_last_directory = ${cfg.general.auto_restore_last_directory}
last_directory = ${cfg.general.last_directory}

[runtime]
engine = ${cfg.runtime?.engine ?? "utility"}
auto_fallback = ${cfg.runtime?.auto_fallback ?? true}

[duckdb]
max_memory = ${cfg.duckdb.max_memory}
threads = ${cfg.duckdb.threads}
background_threads = ${cfg.duckdb.background_threads}
add_raw_event = ${cfg.duckdb.add_raw_event}
safe_mode_keywords = ${cfg.duckdb.safe_mode_keywords.join(", ")}
safe_mode_parallel = ${cfg.duckdb.safe_mode_parallel}

[parquet]
compression = ${cfg.parquet.compression}
row_group_size = ${cfg.parquet.row_group_size}

[system]
temp_cleanup = ${cfg.system.temp_cleanup}
binary_guard = ${cfg.system.binary_guard}
uv_threadpool_size = ${cfg.system.uv_threadpool_size ?? "auto"}
`;
}
```

**Roundtrip Invariant:**
- If `cfg.duckdb.safe_mode_keywords` is `[]`, `.join(", ")` serializes to `""` (`safe_mode_keywords = `). When re-parsed, `""` parses back into `[]`.
- If `cfg.duckdb.safe_mode_parallel` is `false`, it serializes as `"false"`. When re-parsed, it parses back into `false`.

---

### 2.5 Validation, Parsing & Auto-Healing Contract: `validateAndEnsureConfig` (`portableAppData.ts`)

In `validateAndEnsureConfig(configPath: string): ToadConfig` (lines 386-631), parsing and validation must operate as follows:

#### A. Parsing `safe_mode_keywords`:
```typescript
let safe_mode_keywords: string[];
if (parsed.duckdb?.safe_mode_keywords === undefined) {
  safe_mode_keywords = [...DEFAULT_CONFIG.duckdb.safe_mode_keywords];
  needRewrite = true;
} else {
  const rawKw = String(parsed.duckdb.safe_mode_keywords).trim();
  const rawKwLower = rawKw.toLowerCase();
  if (rawKwLower === "" || rawKwLower === "none" || rawKwLower === "off") {
    safe_mode_keywords = [];
  } else {
    safe_mode_keywords = rawKw
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter((k) => k.length > 0 && k !== "none" && k !== "off");
  }
}
```

1. **Missing Key**: When `safe_mode_keywords` is omitted from `config.ini`, default keywords `DEFAULT_CONFIG.duckdb.safe_mode_keywords` are used and `needRewrite = true` is flagged.
2. **Disabling Tokens**: Values `"none"`, `"off"`, `""`, or whitespace-only (case-insensitive) cleanly resolve to empty array `[]`.
3. **Whitespace & Uppercase Normalization**: Inputs like `"  HAYABUSA ,  Security , SYSMON  "` are trimmed and lowercased to `["hayabusa", "security", "sysmon"]`.
4. **Empty Item Filtering**: Multiple commas like `",,"` or `"hayabusa, , security"` do not produce empty strings `""` (which would unintentionally match every file path).

#### B. Parsing `safe_mode_parallel`:
```typescript
let safe_mode_parallel: boolean;
if (parsed.duckdb?.safe_mode_parallel !== undefined) {
  const rawBool = String(parsed.duckdb.safe_mode_parallel).trim().toLowerCase();
  if (rawBool === "true") {
    safe_mode_parallel = true;
  } else if (rawBool === "false") {
    safe_mode_parallel = false;
  } else {
    safe_mode_parallel = DEFAULT_CONFIG.duckdb.safe_mode_parallel;
    needRewrite = true;
  }
} else {
  safe_mode_parallel = DEFAULT_CONFIG.duckdb.safe_mode_parallel;
  needRewrite = true;
}
```

1. **Explicit Booleans**: `"true"` -> `true`, `"false"` -> `false`.
2. **Missing Key**: Missing key falls back to `DEFAULT_CONFIG.duckdb.safe_mode_parallel` (`true`) and sets `needRewrite = true`.
3. **Invalid Strings**: Non-boolean values (e.g. `"yes"`, `"123"`) fall back to default (`true`) and set `needRewrite = true` to repair the INI file.

#### C. Auto-Healing & User Modification Preservation:
- Existing user modifications (e.g., custom `page_size = 500`, custom `threads = 8`, custom `max_memory = 4GB`) are retained in `validatedConfig`.
- If `needRewrite` is `true` (because new keys `safe_mode_keywords` or `safe_mode_parallel` were missing, or corrupted values repaired), `stringifyConfig(validatedConfig)` writes out the complete file, auto-healing the missing keys while preserving all existing sections and user values.

---

### 2.6 Environment Variable Propagation Contract: `initPortableEnvironment()` (`portableAppData.ts`)

In `initPortableEnvironment(): PortableEnvironment` (lines 869-929):

```typescript
export function initPortableEnvironment(): PortableEnvironment {
  // ...
  const appDataDir = ensurePortableAppDataDir(exeDir);
  // ...
  const config = validateAndEnsureConfig(configPath);
  validateAndEnsurePresets(presetsPath);

  // Export environment variables for IPC and child processes
  process.env.TOAD_APP_DATA_DIR = appDataDir;
  process.env.TOAD_SAFE_KEYWORDS = config.duckdb.safe_mode_keywords.join(",");
  process.env.TOAD_SAFE_PARALLEL = String(config.duckdb.safe_mode_parallel);

  // Set global reference for in-process access
  const envResult: PortableEnvironment = {
    exeDir,
    appDataDir,
    tempDir,
    electronDataDir,
    logsDir,
    ledgerPath,
    config,
  };
  (global as any).toadPortableEnv = envResult;

  log.info(`    AppData    : ${appDataDir}`);
  log.info(`    Safe Keys  : ${process.env.TOAD_SAFE_KEYWORDS}`);
  log.info(`    Safe Paral : ${process.env.TOAD_SAFE_PARALLEL}`);

  return envResult;
}
```

---

## 3. Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Configuration | `ToadConfig.duckdb.safe_mode_keywords` | Schema definition for safe mode keyword list | None (Type definition) | `string[]` | Compile-time type check | `portableAppData.ts:35-40`, `ORIGINAL_REQUEST.md:12` |
| 2 | Configuration | `ToadConfig.duckdb.safe_mode_parallel` | Schema definition for multi-threaded safe ingestion toggle | None (Type definition) | `boolean` | Compile-time type check | `portableAppData.ts:35-40`, `ORIGINAL_REQUEST.md:12` |
| 3 | Defaults | Default safe mode keywords (Excluding MFT) | 12 default keywords: hayabusa, eventlog, event_log, security, audit, sysmon, timeline, dfir, winlog, firewall, auth, syslog | None | Array of 12 strings | N/A (Constant) | `portableAppData.ts:80-85`, `ORIGINAL_REQUEST.md:14` |
| 4 | Defaults | Default `safe_mode_parallel` | Default parallel execution in safe mode set to `true` | None | `true` | N/A (Constant) | `portableAppData.ts:80-85`, `ORIGINAL_REQUEST.md:15` |
| 5 | Documentation | Bilingual INI comments | English & Vietnamese explanations for safe mode keywords and parallel flags in `DEFAULT_CONFIG_INI_TEXT` | None | Formatted INI template string | N/A | `portableAppData.ts:134-154`, `ORIGINAL_REQUEST.md:16` |
| 6 | Serialization | INI stringification of safe mode fields | Serializes `safe_mode_keywords = k1, k2` and `safe_mode_parallel = true/false` | `ToadConfig` | String (INI format) | Gracefully serializes empty array to empty value | `portableAppData.ts:310-343`, `ORIGINAL_REQUEST.md:17` |
| 7 | Validation | Keyword parsing & normalization | Splits comma-separated strings, trims whitespace, converts to lowercase, eliminates empty segments | INI string | `string[]` | Unknown/unrecognized values parsed safely | `portableAppData.ts:405-620`, `ORIGINAL_REQUEST.md:18` |
| 8 | Validation | Safe mode disabling tokens | Treats `"none"`, `"off"`, `""`, and whitespace-only as `[]` | `"none"`, `"off"`, `""` | `[]` | No error; disables safe mode heuristics | `portableAppData.ts:405-620`, `ORIGINAL_REQUEST.md:18` |
| 9 | Validation | Boolean `safe_mode_parallel` parsing | Parses `"true"` -> `true`, `"false"` -> `false` | INI string | `boolean` | Invalid string triggers auto-heal to default `true` | `portableAppData.ts:405-620`, `ORIGINAL_REQUEST.md:18` |
| 10 | Auto-Healing | Non-destructive INI healing | Detects missing keys or missing sections and rewrites `config.ini` while preserving existing user options | File path to `config.ini` | Updated `config.ini` | Recovers silently; logs info message | `portableAppData.ts:620-628`, `ORIGINAL_REQUEST.md:18` |
| 11 | Environment | `TOAD_SAFE_KEYWORDS` export | Populates `process.env.TOAD_SAFE_KEYWORDS` as comma-separated string upon startup | `ToadConfig` | `process.env` string | Empty string when disabled | `portableAppData.ts:869-929`, `ORIGINAL_REQUEST.md:19` |
| 12 | Environment | `TOAD_SAFE_PARALLEL` export | Populates `process.env.TOAD_SAFE_PARALLEL` as `"true"` or `"false"` upon startup | `ToadConfig` | `process.env` string | String representation of boolean | `portableAppData.ts:869-929`, `ORIGINAL_REQUEST.md:19` |
| 13 | Environment | `TOAD_APP_DATA_DIR` export | Populates `process.env.TOAD_APP_DATA_DIR` with absolute portable app directory | `appDataDir` | `process.env` string | Validated existing path | `portableAppData.ts:869-929`, `ORIGINAL_REQUEST.md:19` |
| 14 | Cross-Process | Utility process env inheritance | `EngineSupervisor` passes `...process.env` to Electron utility process, propagating config flags | `process.env` | Child process env | Inherited automatically | `engineSupervisor.ts:153` |
| 15 | Cross-Process | Child worker env inheritance | `runIngestInWorker` passes `...process.env` to worker process, propagating config flags | `process.env` | Worker process env | Inherited automatically | `csvimport.ts:2764` |

---

## 4. Edge Cases

| # | Feature | Input | Observed Behavior |
|---|---------|-------|-------------------|
| 1 | Keyword Parsing | `"  HAYABUSA  ,  Security ,  WINLOG  "` | Whitespace is trimmed and characters lowercased: `["hayabusa", "security", "winlog"]`. |
| 2 | Disabling Token | `"none"` or `"NONE"` or `"  none  "` | Recognized as safe mode disabled: returns `[]`. |
| 3 | Disabling Token | `"off"` or `"Off"` | Recognized as safe mode disabled: returns `[]`. |
| 4 | Disabling Token | `""` or `"   "` (empty or spaces only) | Recognized as safe mode disabled: returns `[]`. |
| 5 | Corrupted Commas | `",,,,,"` or `"hayabusa, , , security"` | Empty tokens filtered out: returns `["hayabusa", "security"]`. |
| 6 | Disabling Tokens inside List | `"hayabusa, none, security"` | Filter removes `"none"`: returns `["hayabusa", "security"]`. |
| 7 | Parallel Parsing | `"TRUE"`, `" True "`, `"true"` | Parsed to boolean `true`. |
| 8 | Parallel Parsing | `"FALSE"`, `" False "`, `"false"` | Parsed to boolean `false`. |
| 9 | Parallel Invalid Input | `"maybe"`, `"123"`, `""` | Falls back to default `true` and flags `needRewrite = true` to heal file. |
| 10 | Missing `[duckdb]` Section | INI file missing `[duckdb]` section entirely | Populates full `DEFAULT_CONFIG.duckdb` and writes missing section. |
| 11 | Missing Keys Only | `config.ini` has `[duckdb]` with `threads = 4`, but lacks `safe_mode_keywords` | Preserves `threads = 4`, appends default `safe_mode_keywords` and `safe_mode_parallel`, rewrites file. |
| 12 | Roundtrip Serialization | `safe_mode_keywords = []` | Serialized to `safe_mode_keywords = `, re-parsed back to `[]` identically. |
| 13 | Roundtrip Serialization | `safe_mode_parallel = false` | Serialized to `safe_mode_parallel = false`, re-parsed back to `false` identically. |
| 14 | MFT Default Heuristic | `"Windows.NTFS.MFT.csv"` with default config | Excluded from keywords: `isComplexLogFile("Windows.NTFS.MFT.csv")` returns `false`. |
| 15 | MFT Custom Heuristic | `"Windows.NTFS.MFT.csv"` with keywords containing `"mft"` | `isComplexLogFile` returns `true`. |
| 16 | Format Extension Priority | `"application.log"`, `"Security.evtx"`, `"trace.txt"` | Matches extension `.log`, `.evtx`, `.txt`: returns `true` regardless of keywords. |

---

## 5. Cross-Module Dependencies & Interface Impact

### 5.1 Consumers in `tad-master/packages/reltab-duckdb/`

1. **`IngestConfig` Interface (`csvimport.ts:220-230`)**:
   Must declare:
   ```typescript
   export interface IngestConfig {
     // ... existing fields ...
     safe_mode_keywords: string[];
     safe_mode_parallel: boolean;
   }
   ```

2. **`getIngestConfig()` (`csvimport.ts:232-273`)**:
   - Primary: Read from `global.toadPortableEnv?.config?.duckdb`.
   - Fallback (when running standalone or during test suites):
     - `safe_mode_keywords`: Read from `process.env.TOAD_SAFE_KEYWORDS`. If set, parse comma-separated items (treating `"none"`, `"off"`, `""` as `[]`). If undefined, use default list without `"mft"`.
     - `safe_mode_parallel`: Read from `process.env.TOAD_SAFE_PARALLEL`. If set, evaluate `!== "false"`. If undefined, default to `true`.

3. **`isComplexLogFile(filePath: string, customKeywords?: string[])` (`csvimport.ts:2703`)**:
   - Accept optional `customKeywords?: string[]`.
   - Resolve active keywords: `const keywords = customKeywords !== undefined ? customKeywords : getIngestConfig().safe_mode_keywords;`
   - Filter out empty or whitespace-only strings:
     ```typescript
     if (!keywords || !Array.isArray(keywords) || keywords.length === 0) return false;
     const cleanKeywords = keywords.map(k => (k || "").trim().toLowerCase()).filter(k => k.length > 0);
     return cleanKeywords.some(kw => lower.includes(kw));
     ```

4. **`streamCsvToParquet` (`csvimport.ts:2831`)**:
   - In Safe Profile Stage 1: Change `parallel = false,` to:
     ```typescript
     parallel = ${cfg.safe_mode_parallel ? "true" : "false"},
     ```

5. **`nativeCSVImport` (`csvimport.ts:3711`)**:
   - In Safe Profile query: Change `parallel=false` to:
     ```typescript
     parallel=${cfg.safe_mode_parallel ? "true" : "false"}
     ```

6. **`ingestWorker.ts` (`ingestWorker.ts:30-31, 64, 82`)**:
   - Support both snake_case and camelCase:
     ```typescript
     const safeParallel = cfg.safe_mode_parallel !== false && cfg.safeModeParallel !== false;
     ```
   - In Stage 1 and Stage 2 queries: `parallel = ${safeParallel ? "true" : "false"}`.

---

### 5.2 Critical Discovery: Existing Test Suite Collision in `tests/deep_integration_qa.js`

In `tests/deep_integration_qa.js` line 5689:
```javascript
  await runTest("LL.1 isComplexLogFile Heuristics Detection", async () => {
    const { isComplexLogFile } = reltabDuckDB;
    assert.strictEqual(typeof isComplexLogFile, "function", "isComplexLogFile must be exported");

    // Complex/Forensic logs
    assert.strictEqual(isComplexLogFile("Windows.EventLogs.Hayabusa%2Foutput.csv"), true);
    assert.strictEqual(isComplexLogFile("C:/cases/dfir/Security.evtx"), true);
    assert.strictEqual(isComplexLogFile("TimelineExplorer/output.csv"), true);
    assert.strictEqual(isComplexLogFile("C:/temp/sysmon_events.log"), true);
    assert.strictEqual(isComplexLogFile("audit_trail.txt"), true);
    assert.strictEqual(isComplexLogFile("mft_dump.csv"), true); // <--- CAUTION!
```

**Observation:**
In v2.4.5, `"mft"` was hardcoded in `isComplexLogFile`. Therefore, line 5689 asserted `isComplexLogFile("mft_dump.csv") === true`.
However, under the new specification (Requirement R1 & R3):
- `"mft"` is deliberately excluded from default keywords.
- Requirement R3 explicitly specifies:
  `Test 5: isComplexLogFile("Windows.NTFS.MFT.csv") returning false by default.`
  `Test 6: Adding "mft" to keywords causing isComplexLogFile("Windows.NTFS.MFT.csv") to return true.`
- Acceptance Criteria requires:
  `Running .\node-v18.20.4-win-x64\node.exe run_tests.js passes with 100% HEALTHY and 0 failed tests.`

**Impact & Recommendation:**
If `run_tests.js` executes `tests/deep_integration_qa.js` without `"mft"` in keywords, line 5689 will fail. The implementer and test miner must ensure either:
1. `tests/deep_integration_qa.js` line 5689 is updated to match the new behavior:
   `assert.strictEqual(isComplexLogFile("mft_dump.csv", ["mft"]), true);` or `assert.strictEqual(isComplexLogFile("mft_dump.csv"), false);`, OR
2. In `deep_integration_qa.js` setup for Suite LL, `process.env.TOAD_SAFE_KEYWORDS` is scoped appropriately. Updating line 5689 in `deep_integration_qa.js` is the standard approach since v2.4.5 behavior was superseded.

---

### 5.3 Compilation & Module Linkage

1. **Junction in `toad-app`**:
   `tad-master/packages/toad-app/node_modules/reltab-duckdb` is an NTFS directory junction pointing directly to `tad-master/packages/reltab-duckdb`.
2. **Build Targets**:
   - `tad-master/packages/reltab-duckdb`: `npm run build` executes `tsc -p tsconfig-build.json` generating `dist/reltab-duckdb.js` and `dist/reltab-duckdb.d.ts`.
   - `tad-master/packages/toad-app`: `npm run build-dev` runs webpack development bundle.
   - Any changes to `portableAppData.ts` are compiled via webpack into `dist/main.bundle.js`.

---

## 6. Verification Method

To verify the Requirement R1 specification:

1. **Unit Test Execution**:
   Run the newly added unit test suite via:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe run_tests.js --unit
   ```
   Must execute all 16 test cases in `tests/unit/test_safe_mode_config.js`.

2. **Full Regression Execution**:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe run_tests.js
   ```
   Must pass 100% HEALTHY with 0 failures across all test suites.

3. **TypeScript Compilation Check**:
   ```powershell
   cd tad-master/packages/reltab-duckdb
   npm run build
   ```
   Must complete with exit code 0.
