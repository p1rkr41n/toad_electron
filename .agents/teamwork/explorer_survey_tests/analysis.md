# Technical Analysis & Specifications: Requirement R3 Test Infrastructure

**Document Version**: 1.0.0  
**Author**: Test Infra Explorer  
**Workspace**: `d:\Shared_UserData\Downloads\tad`  
**Date**: 2026-11-05  

---

## 1. Executive Summary

Requirement R3 mandates the creation, registration, and verification of a comprehensive unit test suite `tests/unit/test_safe_mode_config.js` containing 16 rigorous test cases. This suite validates:
1. Configurable Safe Mode keywords parsed from `config.ini` in `portableAppData.ts`.
2. Whitespace trimming, uppercase normalization, and explicit disabling via `"none"`, `"off"`, or `""`.
3. Non-destructive auto-healing of missing configuration keys while preserving existing sections.
4. MFT exclusion by default (`isComplexLogFile("Windows.NTFS.MFT.csv") === false`) unlocking multi-threaded DuckDB CSV ingestion for forensic MFT exports.
5. Re-enabling MFT safe mode via custom keyword configuration (`customKeywords` or `config.ini`).
6. Core complex log detection (`hayabusa_high.csv`, `Security.evtx`, `application.log`).
7. Boolean parsing for `safe_mode_parallel` (true/false) and environment variable fallback (`process.env.TOAD_SAFE_KEYWORDS`, `process.env.TOAD_SAFE_PARALLEL`).
8. Config serialization/deserialization roundtrip integrity.
9. DuckDB SQL query generation verifying `parallel = true` vs `parallel = false` in Safe Ingest Profiles.
10. Immunity to spaces, backslashes, and international Unicode path formats.
11. English documentation and template comments in `DEFAULT_CONFIG_INI_TEXT`.

All 16 tests must execute cleanly under `.\node-v18.20.4-win-x64\node.exe run_tests.js --unit` and `.\node-v18.20.4-win-x64\node.exe run_tests.js`, achieving **100% HEALTHY** with 0 failures.

---

## 2. Test Runner Architecture (`run_tests.js`)

### 2.1 Argument Parsing & Test Selection
`run_tests.js` parses CLI arguments via `process.argv.slice(2)`:
```javascript
const args = process.argv.slice(2);
const runAll = args.includes("--all");
const smokeOnly = args.includes("--smoke");
const qaOnly = args.includes("--qa");
const legacyOnly = args.includes("--legacy");
const fuzzOnly = args.includes("--fuzz");
const unitOnly = args.includes("--unit");
```

### 2.2 Execution Mechanism
Each test file is executed via `runScript(testItem)`:
- Invokes `spawn(process.execPath, [fullPath], { stdio: "inherit", env: { ...process.env, TOAD_ROOT: __dirname } })`.
- `process.execPath` guarantees that the child process runs with the exact same Node.js executable that invoked `run_tests.js` (`.\node-v18.20.4-win-x64\node.exe`).
- Tests communicate results via standard process exit codes:
  - Exit code `0` maps to `{ status: "PASS" }`.
  - Any non-zero exit code maps to `{ status: "FAIL", code }`.

### 2.3 Result Aggregation & 100% HEALTHY Check
```javascript
const allPassed = results.every((r) => r.status === "PASS");
if (allPassed) {
  console.log(`  ${BOLD}${GREEN}RESULT: ALL TEST SUITES PASSED CLEANLY (100% HEALTHY)${RESET}\n`);
  process.exit(0);
} else {
  console.log(`  ${BOLD}${RED}RESULT: ONE OR MORE TEST SUITES FAILED!${RESET}\n`);
  process.exit(1);
}
```

### 2.4 Registration Specification for `tests/unit/test_safe_mode_config.js`
In `run_tests.js`, the new suite must be registered in:
1. **`unitOnly` branch** (lines ~43-54):
   ```javascript
   } else if (unitOnly) {
     testsToRun.push({ name: "Safe Mode Config & Ingestion Unit (16 Tests)", file: "tests/unit/test_safe_mode_config.js" });
     // ... other unit tests ...
   ```
2. **Default `else` branch** (lines ~54-72):
   ```javascript
     testsToRun.push({ name: "Safe Mode Config & Ingestion Unit (16 Tests)", file: "tests/unit/test_safe_mode_config.js" });
   ```
   *Rationale*: Acceptance Criteria requires both `node run_tests.js --unit` and `node run_tests.js` (default) to pass cleanly. Including `test_safe_mode_config.js` in the default suite ensures continuous verification across general test runs.
3. **`runAll` block** (if applicable) for exhaustive coverage.

---

## 3. Node Execution Environment & Module Loading Strategy

### 3.1 Node Binary & Tooling
- System Node binary: `.\node-v18.20.4-win-x64\node.exe` (Node v18.20.4).
- System npm tool: `.\node-v18.20.4-win-x64\npm.cmd` (npm v10.7.0).
- TypeScript Compiler: `tad-master/node_modules/typescript` (v4.8.3).
- TypeScript Build Targets:
  - `reltab-duckdb`: `npm run build` (`tsc -p tsconfig-build.json`) -> outputs to `tad-master/packages/reltab-duckdb/dist/`.
  - `toad-app`: `npm run build-dev` (`webpack --mode development`) -> outputs to `tad-master/packages/toad-app/dist/`.

### 3.2 Strategy for Unit Testing TypeScript Modules (`portableAppData.ts` & `csvimport.ts`)
We investigated two distinct strategies:

#### Strategy A: Pre-compiled JS (`dist/`)
- Relies on running `npm run build` before executing tests.
- **Limitation**: `portableAppData.ts` in `toad-app` is compiled only during webpack bundling into a monolith `main.bundle.js` rather than individual CommonJS files in `dist/`. Testing individual exported functions (`validateAndEnsureConfig`, `DEFAULT_CONFIG`) from `main.bundle.js` is unwieldy.

#### Strategy B: On-the-Fly TypeScript Transpile Hook (Recommended & Verified)
- Used successfully in existing unit test suites:
  - `tests/unit/test_duckdb_json_builder.js`
  - `tests/unit/test_nested_traverser.js`
- Requires setting `module.paths` to include `tad-master/node_modules`, `toad-app/node_modules`, and `reltab-duckdb/node_modules`.
- Installs a custom loader on `require.extensions['.ts']` using `ts.transpileModule`:
  ```javascript
  const path = require("path");
  const fs = require("fs");
  const ROOT_DIR = process.env.TOAD_ROOT || path.resolve(__dirname, "../..");

  // Ensure workspace modules are discoverable (e.g., electron-log, loglevel, duckdb-async)
  module.paths.push(path.resolve(ROOT_DIR, "tad-master/node_modules"));
  module.paths.push(path.resolve(ROOT_DIR, "tad-master/packages/toad-app/node_modules"));
  module.paths.push(path.resolve(ROOT_DIR, "tad-master/packages/reltab-duckdb/node_modules"));

  const ts = require(path.resolve(ROOT_DIR, "tad-master/node_modules/typescript"));

  require.extensions[".ts"] = function (module, filename) {
    const content = fs.readFileSync(filename, "utf8");
    const result = ts.transpileModule(content, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true
      }
    });
    module._compile(result.outputText, filename);
  };
  ```
- **Verification Result**: Successfully verified via Node execution. Both `portableAppData.ts` and `csvimport.ts` load with all exports intact without any runtime errors.

---

## 4. Detailed Specification of the 16 Unit Test Cases

The test suite must be placed in `tests/unit/test_safe_mode_config.js`. Below is the complete specification for all 16 test cases:

```
================================================================================
Test ID    Test Title                                            Target Function / Module
================================================================================
TC-01      Parsing keywords array from config.ini                 validateAndEnsureConfig
TC-02      Parsing extra whitespace and uppercase strings         validateAndEnsureConfig
TC-03      Disabling safe mode with "none", "off", ""            validateAndEnsureConfig
TC-04      Auto-healing missing keys without altering sections    validateAndEnsureConfig
TC-05      isComplexLogFile default for MFT (returns false)      isComplexLogFile
TC-06      Adding "mft" to keywords causes MFT to return true     isComplexLogFile
TC-07      isComplexLogFile("hayabusa_high.csv") returns true     isComplexLogFile
TC-08      isComplexLogFile("Security.evtx") returns true         isComplexLogFile
TC-09      isComplexLogFile("application.log") returns true       isComplexLogFile
TC-10      Boolean parsing for safe_mode_parallel (true/false)    validateAndEnsureConfig
TC-11      getIngestConfig fallback from process.env              getIngestConfig
TC-12      Roundtrip serialization and parsing                    stringifyConfig / validate
TC-13      DuckDB query generation containing parallel = true     csvimport / ingestWorker
TC-14      DuckDB query generation containing parallel = false    csvimport / ingestWorker
TC-15      Unicode and space file path handling                   isComplexLogFile
TC-16      Default config.ini template contains clear comments    DEFAULT_CONFIG_INI_TEXT
================================================================================
```

### Detailed Case Specifications

#### TC-01: Parsing keywords array from config.ini
- **Purpose**: Verify that comma-separated keywords defined in `[duckdb]` are parsed into a string array.
- **Input**:
  ```ini
  [duckdb]
  safe_mode_keywords = hayabusa, security, custom_tag, winlog
  ```
- **Execution**: Write to temporary INI file, invoke `validateAndEnsureConfig(tempPath)`.
- **Expected Assertion**:
  `assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, ["hayabusa", "security", "custom_tag", "winlog"])`.

#### TC-02: Parsing extra whitespace and uppercase strings
- **Purpose**: Ensure robust sanitization: trimming outer whitespace and lowercasing keyword elements.
- **Input**:
  ```ini
  [duckdb]
  safe_mode_keywords =   HAYABUSA  ,  SECURITY , EvEnT_LoG   ,   AuDiT 
  ```
- **Execution**: Invoke `validateAndEnsureConfig(tempPath)`.
- **Expected Assertion**:
  `assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, ["hayabusa", "security", "event_log", "audit"])`.

#### TC-03: Disabling safe mode with "none", "off", ""
- **Purpose**: Verify that users can explicitly turn off keyword matching.
- **Sub-cases Tested**:
  1. `safe_mode_keywords = none` -> `[]`
  2. `safe_mode_keywords = NONE` -> `[]`
  3. `safe_mode_keywords = off` -> `[]`
  4. `safe_mode_keywords = OFF` -> `[]`
  5. `safe_mode_keywords = ""` -> `[]`
  6. `safe_mode_keywords = ` (empty) -> `[]`
- **Expected Assertion**:
  In each sub-case, `assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, [])`.

#### TC-04: Auto-healing missing keys without altering existing sections
- **Purpose**: Verify that when `config.ini` lacks `safe_mode_keywords` or `safe_mode_parallel` (e.g. from an older version of Toad), the auto-heal logic rewrites the file with default values while leaving all other configured settings strictly intact.
- **Input**:
  ```ini
  [general]
  page_size = 7890
  last_directory = D:\Forensics\Case99
  [duckdb]
  max_memory = 4GB
  threads = 6
  ```
- **Execution**: Invoke `validateAndEnsureConfig(tempPath)`.
- **Expected Assertion**:
  - Returned config has `cfg.general.page_size === 7890`, `cfg.general.last_directory === "D:\\Forensics\\Case99"`.
  - Returned config has `cfg.duckdb.max_memory === "4GB"`, `cfg.duckdb.threads === 6`.
  - Returned config has `cfg.duckdb.safe_mode_parallel === true`.
  - Returned config has default `safe_mode_keywords` (excluding `"mft"`).
  - Re-read file content from disk: confirms that the file was rewritten containing `safe_mode_keywords = ...` and `safe_mode_parallel = true` under `[duckdb]`, and preserving `page_size = 7890`.

#### TC-05: isComplexLogFile("Windows.NTFS.MFT.csv") returning false by default
- **Purpose**: Verify Requirement R1/R2 core optimization: `"mft"` is NOT in default safe mode keywords. MFT files must return `false` to avoid the slow, single-threaded safe mode.
- **Execution**: Clear any global or env overrides (`delete process.env.TOAD_SAFE_KEYWORDS`, `delete global.toadPortableEnv`).
- **Input Paths**:
  - `"Windows.NTFS.MFT.csv"`
  - `"C:/Evidence/MFT_Export.csv"`
  - `"D:\\Cases\\mft_records.csv"`
- **Expected Assertion**: `assert.strictEqual(isComplexLogFile(path), false)` for all MFT CSV files.

#### TC-06: Adding "mft" to keywords causing isComplexLogFile("Windows.NTFS.MFT.csv") to return true
- **Purpose**: Verify user configurability: if a user needs safe mode for a problematic MFT file, adding `"mft"` works immediately.
- **Execution & Sub-cases**:
  1. Passing custom keywords directly: `isComplexLogFile("Windows.NTFS.MFT.csv", ["mft"])` -> `true`.
  2. Setting via environment: `process.env.TOAD_SAFE_KEYWORDS = "mft, hayabusa"`; `isComplexLogFile("Windows.NTFS.MFT.csv")` -> `true`.
  3. Setting via `global.toadPortableEnv.config.duckdb.safe_mode_keywords = ["mft"]`; `isComplexLogFile("Windows.NTFS.MFT.csv")` -> `true`.
- **Expected Assertion**: `assert.strictEqual(..., true)`.

#### TC-07: isComplexLogFile("hayabusa_high.csv") returning true
- **Purpose**: Verify Hayabusa security alerts trigger Safe Ingest Profile by default.
- **Input Paths**: `"hayabusa_high.csv"`, `"C:/Logs/Hayabusa_Output.csv"`, `"hayabusa.tsv"`.
- **Expected Assertion**: `assert.strictEqual(isComplexLogFile(path), true)`.

#### TC-08: isComplexLogFile("Security.evtx") returning true
- **Purpose**: Verify `.evtx` extension detection triggers Safe Profile.
- **Input Paths**: `"Security.evtx"`, `"C:\\Windows\\System32\\Winevt\\Logs\\Security.evtx"`.
- **Expected Assertion**: `assert.strictEqual(isComplexLogFile(path), true)`.

#### TC-09: isComplexLogFile("application.log") returning true
- **Purpose**: Verify `.log` and `.txt` extension detection triggers Safe Profile.
- **Input Paths**: `"application.log"`, `"/var/log/syslog.log"`, `"output.txt"`.
- **Expected Assertion**: `assert.strictEqual(isComplexLogFile(path), true)`.

#### TC-10: Boolean parsing for safe_mode_parallel (true and false)
- **Purpose**: Verify type parsing for `safe_mode_parallel` under `[duckdb]`.
- **Sub-cases Tested**:
  - `safe_mode_parallel = true` -> `true`
  - `safe_mode_parallel = True` -> `true`
  - `safe_mode_parallel = 1` -> `true`
  - `safe_mode_parallel = false` -> `false`
  - `safe_mode_parallel = False` -> `false`
  - `safe_mode_parallel = 0` -> `false`
  - `safe_mode_parallel = invalid` -> default `true`
  - Missing key -> default `true`
- **Expected Assertion**: `assert.strictEqual(cfg.duckdb.safe_mode_parallel, expectedBool)`.

#### TC-11: getIngestConfig fallback from process.env.TOAD_SAFE_KEYWORDS
- **Purpose**: Verify fallback mechanism in `csvimport.ts:getIngestConfig()` when `global.toadPortableEnv` is absent.
- **Execution**:
  - Set `process.env.TOAD_SAFE_KEYWORDS = "crowdstrike, carbonblack, sentinel"`
  - Set `process.env.TOAD_SAFE_PARALLEL = "false"`
  - `delete global.toadPortableEnv`
  - `const cfg = getIngestConfig()`
- **Expected Assertion**:
  - `assert.deepStrictEqual(cfg.safe_mode_keywords, ["crowdstrike", "carbonblack", "sentinel"])`
  - `assert.strictEqual(cfg.safe_mode_parallel, false)`
  - Clean up env variables after test.

#### TC-12: Roundtrip serialization and parsing
- **Purpose**: Ensure `stringifyConfig` and `validateAndEnsureConfig` form a lossless bijection for the new duckdb configuration properties.
- **Execution**:
  - Construct config object with custom keywords: `["hayabusa", "sysmon", "timeline"]` and `safe_mode_parallel: false`.
  - Serialize using `stringifyConfig(cfg)`.
  - Verify generated text contains `safe_mode_keywords = hayabusa, sysmon, timeline` and `safe_mode_parallel = false`.
  - Save to temporary file and parse via `validateAndEnsureConfig(path)`.
- **Expected Assertion**:
  - `assert.deepStrictEqual(parsed.duckdb.safe_mode_keywords, ["hayabusa", "sysmon", "timeline"])`
  - `assert.strictEqual(parsed.duckdb.safe_mode_parallel, false)`

#### TC-13: DuckDB query generation containing parallel = true when safe_mode_parallel = true
- **Purpose**: Verify SQL generated for Stage 1 / Stage 2 Safe Ingest Profile and `nativeCSVImport` contains `parallel = true` (or `parallel=true`) when `safe_mode_parallel` is enabled.
- **Execution**:
  - Inspect query template / generator or test simulated query string with `safe_mode_parallel: true`.
- **Expected Assertion**:
  - `assert.ok(/parallel\s*=\s*true/i.test(generatedSql), "Generated SQL must include parallel = true")`
  - `assert.ok(!/parallel\s*=\s*false/i.test(generatedSql), "Generated SQL must NOT contain parallel = false")`

#### TC-14: DuckDB query generation containing parallel = false when safe_mode_parallel = false
- **Purpose**: Verify SQL generated when `safe_mode_parallel: false` forces single-threaded execution for strict thread-isolation debugging.
- **Execution**:
  - Generate query with `safe_mode_parallel: false`.
- **Expected Assertion**:
  - `assert.ok(/parallel\s*=\s*false/i.test(generatedSql), "Generated SQL must include parallel = false")`

#### TC-15: Unicode and space file path handling
- **Purpose**: Verify `isComplexLogFile` handles non-ASCII characters, spaces, backslashes, and complex path structures.
- **Test Matrix**:
  - `"C:/Evidence/DFIR Case 2026/Windows Security Events.csv"` -> `true` (keyword `security`)
  - `"D:/Điều Tra Số/案件_2026/отчет_hayabusa.csv"` -> `true` (keyword `hayabusa`, Vietnamese/Japanese/Cyrillic path)
  - `"C:\\Evidence Folder\\Normal Table Data.csv"` -> `false`
  - `"C:\\Evidence Folder\\Windows.NTFS.MFT.csv"` -> `false` (default: no `mft`)
  - `"D:\\Forensics\\案件\\application.log"` -> `true` (extension `.log`)
- **Expected Assertion**: Correct boolean returned without throwing exceptions or corrupting paths.

#### TC-16: Default config.ini template containing clear comments
- **Purpose**: Verify `DEFAULT_CONFIG_INI_TEXT` contains user documentation for the new settings.
- **Expected Assertions**:
  - `assert.ok(DEFAULT_CONFIG_INI_TEXT.includes("safe_mode_keywords"), "Must contain safe_mode_keywords template entry")`
  - `assert.ok(DEFAULT_CONFIG_INI_TEXT.includes("safe_mode_parallel"), "Must contain safe_mode_parallel template entry")`
  - Check for explanatory comments documenting default keywords, disabling syntax (`none`, `off`, `""`), and parallel optimization.

---

## 5. Workspace Standards & VCS Compliance

1. **Local Version Control (`jj`)**:
   - Status verified: `tools\jj\jj.exe status` executes cleanly.
   - Dual Git compatibility maintained (`jj git init --colocate`).
   - Working copy is currently on `@`: `mvxwrymp feat(frontend): port toadviewer to Tauri v2...`.
2. **Author Identity Standard**:
   - Commits and PRs must strictly use:
     `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`.
3. **Enterprise Sanitization**:
   - Zero corporate emails, internal hostnames, or private organizational references.
4. **Public Artifact Language Standard**:
   - 100% concise, professional English in public code comments, commits, test output, and documentation.

---

## 6. Implementation Checklist for Subsequent Agents

- [ ] Implement Requirement R1 in `tad-master/packages/toad-app/app/portableAppData.ts`:
  - Update `ToadConfig.duckdb` interface.
  - Update `DEFAULT_CONFIG.duckdb` (`safe_mode_keywords` excluding `"mft"`, `safe_mode_parallel: true`).
  - Update `DEFAULT_CONFIG_INI_TEXT` with bilingual/English comments.
  - Update `stringifyConfig` and `validateAndEnsureConfig` (trimming, lowercase, disabling logic).
  - Update `initPortableEnvironment()` with `process.env.TOAD_SAFE_KEYWORDS`, `TOAD_SAFE_PARALLEL`.
- [ ] Implement Requirement R2 in `tad-master/packages/reltab-duckdb`:
  - Update `csvimport.ts`: `IngestConfig`, `getIngestConfig()`, `isComplexLogFile()`, `streamCsvToParquet()`, `nativeCSVImport()`.
  - Update `ingestWorker.ts`: `safeParallel` flag in Stage 1 & Stage 2 queries.
  - Build `reltab-duckdb`: `& ".\node-v18.20.4-win-x64\npm.cmd" --prefix tad-master/packages/reltab-duckdb run build`.
- [ ] Create `tests/unit/test_safe_mode_config.js` implementing all 16 specified test cases.
- [ ] Register `tests/unit/test_safe_mode_config.js` in `run_tests.js`.
- [ ] Verify test suite execution:
  - `.\node-v18.20.4-win-x64\node.exe run_tests.js --unit` -> 100% HEALTHY.
  - `.\node-v18.20.4-win-x64\node.exe run_tests.js` -> 100% HEALTHY.
