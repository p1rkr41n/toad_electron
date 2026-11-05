# Handoff Report: DuckDB Ingestion & Safe Mode Survey (Requirement R2)

## 1. Observation

- **O1: IngestConfig Interface**
  - Path: `tad-master/packages/reltab-duckdb/src/csvimport.ts:220-230`
  - Current content:
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
    }
    ```
  - Missing fields: `safe_mode_keywords: string[];` and `safe_mode_parallel: boolean;`.

- **O2: getIngestConfig() Configuration & Fallback**
  - Path: `tad-master/packages/reltab-duckdb/src/csvimport.ts:232-273`
  - Reads `(global as any).toadPortableEnv?.config` when running inside Electron.
  - In standalone/CLI/test fallback (lines 253-272), returns default values without reading `process.env.TOAD_SAFE_KEYWORDS` or `process.env.TOAD_SAFE_PARALLEL`.

- **O3: isComplexLogFile Heuristic Classifier**
  - Path: `tad-master/packages/reltab-duckdb/src/csvimport.ts:2703-2730`
  - Current signature: `export function isComplexLogFile(filePath: string): boolean`.
  - Current keyword list includes hardcoded `"mft"` (line 2720) and does not accept `customKeywords`.
  - Extension check at line 2709 returns `true` for `[".log", ".txt", ".evtx"]`.

- **O4: Safe Profile Queries in streamCsvToParquet and nativeCSVImport**
  - In `streamCsvToParquet` (`csvimport.ts:2831`):
    `parallel = false,` is currently hardcoded in Stage 1 Safe Profile.
  - In `nativeCSVImport` (`csvimport.ts:3711`):
    `parallel=false` is currently hardcoded in `CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_csv(...)`.

- **O5: Out-of-Process Worker ingestWorker.ts**
  - Path: `tad-master/packages/reltab-duckdb/src/ingestWorker.ts:53-88`
  - Lines 64 and 83 hardcode `parallel = false,` in both Stage 1 and Stage 2 Safe Ingest Profiles.
  - `cfg` is parsed from `process.argv[4]` JSON string at line 29.
  - Does not evaluate `safeParallel = cfg.safe_mode_parallel !== false && cfg.safeModeParallel !== false`.

- **O6: Package Relationship & Monorepo Linkage**
  - Path: `tad-master/packages/toad-app/node_modules/reltab-duckdb`
  - Command: `Get-Item 'tad-master\packages\toad-app\node_modules\reltab-duckdb' | Format-List FullName, LinkType, Target`
  - Output:
    ```
    FullName   : D:\Shared_UserData\Downloads\tad\tad-master\packages\toad-app\node_modules\reltab-duckdb
    LinkType   : Junction
    Target     : {D:\Shared_UserData\Downloads\tad\tad-master\packages\reltab-duckdb\}
    Attributes : Directory, ReparsePoint
    ```
  - It is an NTFS Junction. Changes to source files in `packages/reltab-duckdb/src/` are instantaneously mirrored in `toad-app/node_modules/reltab-duckdb/src/`.
  - Compiled output goes to `tad-master/packages/reltab-duckdb/dist/` via `tsc -p tsconfig-build.json`.

- **O7: Existing Deep Integration QA Suite Test LL.1**
  - Path: `tests/deep_integration_qa.js:5689`
  - Current assertion: `assert.strictEqual(isComplexLogFile("mft_dump.csv"), true);`
  - When `"mft"` is removed from the default keyword list (per R1 & R2), this assertion will evaluate to `false` and cause `deep_integration_qa.js` to fail if not adapted.

- **O8: Build Scripts and Toolchain**
  - Node.js runtime: `D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe`
  - Building `packages/reltab-duckdb`:
    ```powershell
    $env:PATH = "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64;$env:PATH"
    Push-Location "tad-master\packages\reltab-duckdb"
    npm.cmd run build
    Pop-Location
    ```
  - Verified: Compiles cleanly with exit code 0.

---

## 2. Logic Chain

1. **Need for Configurable Keywords and Parallel Ingestion**:
   - Ingestion of large forensics files (e.g. MFT, multi-gigabyte CSVs) currently defaults to single-threaded ingestion (`parallel=false`) or forces complex safe mode on files containing "mft" even when standard fast ingestion is desired.
   - Adding `safe_mode_keywords` and `safe_mode_parallel` to `IngestConfig` allows granular control (Observation O1).

2. **Environment Variable Fallback**:
   - `getIngestConfig()` must serve both Electron main process (`global.toadPortableEnv`) and child processes/test runners (`process.env`).
   - If `global.toadPortableEnv?.config` is absent, parsing `process.env.TOAD_SAFE_KEYWORDS` (handling `"none"`, `"off"`, `""` as empty array `[]`) and `process.env.TOAD_SAFE_PARALLEL` ensures deterministic testability outside of the full GUI app (Observation O2).
   - If neither environment variable is provided, defaulting keywords to the 12 specified terms (strictly without `"mft"`) satisfies Requirement R2.

3. **Dynamic Heuristics Classification**:
   - Changing `isComplexLogFile(filePath: string, customKeywords?: string[])` to prioritize `customKeywords` (if passed) over `getIngestConfig().safe_mode_keywords` allows caller overrides.
   - Filtering out empty and whitespace-only strings avoids accidental matches against `""` which would match all filenames (Observation O3).

4. **Multi-Threaded Safe Profile Streaming**:
   - DuckDB's `read_csv` function supports multi-threaded parallel ingestion via `parallel = true`.
   - In `streamCsvToParquet` Stage 1 and `nativeCSVImport`, substituting `parallel = ${cfg.safe_mode_parallel ? "true" : "false"}` enables multi-threaded reading when enabled in config (default: `true`), while permitting single-threaded fallback when set to `false` (Observation O4).

5. **Worker Process Crash Firewall**:
   - `ingestWorker.ts` is invoked out-of-process.
   - Reading `safeParallel = cfg.safe_mode_parallel !== false && cfg.safeModeParallel !== false` handles both snake_case and camelCase parameters gracefully.
   - Injecting `parallel = ${safeParallel ? "true" : "false"}` into Stage 1 and Stage 2 of `ingestWorker.ts` aligns the isolated worker with the in-process engine (Observation O5).

6. **Build and Packaging Integrity**:
   - Because `node_modules/reltab-duckdb` is an NTFS junction to `packages/reltab-duckdb`, code edits apply instantly to both paths.
   - Running `npm run build` inside `packages/reltab-duckdb` compiles TypeScript into `dist/` which is read at runtime (Observation O6, O8).

7. **Regression Guard**:
   - Because `tests/deep_integration_qa.js:5689` asserts `isComplexLogFile("mft_dump.csv") === true`, removing `"mft"` from default keywords will break this test unless it tests custom keywords or tests `false` by default (Observation O7).

---

## 3. Caveats

1. **Junction Write Caveat**: Because `toad-app/node_modules/reltab-duckdb` is an NTFS Junction pointing directly to `tad-master/packages/reltab-duckdb`, do NOT attempt to copy files between them as it would overwrite the same physical files.
2. **Regression in deep_integration_qa.js**: As identified in O7, Test `LL.1` in `tests/deep_integration_qa.js` line 5689 expects `isComplexLogFile("mft_dump.csv")` to be `true`. Since R1/R2 mandates `"mft"` removal from default keywords, the QA test suite must be updated so `mft_dump.csv` is checked with custom keywords `["mft"]` or checked against `false` by default.
3. **Node PATH Precedence**: The system PATH does not have `npm` or `node` by default; commands must prepend `D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64` to `$env:PATH`.

---

## 4. Conclusion

Requirement R2 for `reltab-duckdb` is completely mapped and architecturally validated:
1. `IngestConfig`: Add `safe_mode_keywords: string[]` and `safe_mode_parallel: boolean`.
2. `getIngestConfig()`: Read from `env.config.duckdb`, falling back to `process.env.TOAD_SAFE_KEYWORDS` (or defaults without `"mft"`) and `process.env.TOAD_SAFE_PARALLEL` (default `true`).
3. `isComplexLogFile`: Support `customKeywords?: string[]` defaulting to `getIngestConfig().safe_mode_keywords`, filtering out whitespace/empty tokens.
4. `streamCsvToParquet`: Use `parallel = ${cfg.safe_mode_parallel ? "true" : "false"}` in Stage 1 Safe Profile.
5. `nativeCSVImport`: Use `parallel=${cfg.safe_mode_parallel ? "true" : "false"}` in the `CREATE OR REPLACE TABLE` query.
6. `ingestWorker.ts`: Evaluate `safeParallel = cfg.safe_mode_parallel !== false && cfg.safeModeParallel !== false` and use in Stage 1 and Stage 2 queries.
7. Packages are linked via NTFS Junctions, requiring only `npm run build` in `tad-master/packages/reltab-duckdb` to produce updated `dist/` outputs.

---

## 5. Verification Method

To independently verify the implementation:
1. **Compilation Check**:
   ```powershell
   $env:PATH = "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64;$env:PATH"
   Push-Location "tad-master\packages\reltab-duckdb"
   npm.cmd run build
   Pop-Location
   ```
   *Expected*: Exit code 0, updated `dist/csvimport.js` and `dist/ingestWorker.js`.

2. **Unit Test Suite (Requirement R3)**:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe run_tests.js --unit
   ```
   *Expected*: 100% PASS across all unit tests including the 16 tests in `tests/unit/test_safe_mode_config.js`.

3. **Full Integration Test**:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe run_tests.js
   ```
   *Expected*: 100% HEALTHY, 0 failed tests (with `deep_integration_qa.js:5689` adapted for `"mft"` custom keyword).
