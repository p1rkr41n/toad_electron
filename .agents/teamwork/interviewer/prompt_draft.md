Implement configurable safe mode keywords via `config.ini` and optimize DuckDB multi-threaded ingestion for the Toad production application.

Integrity mode: development

## Requirements

### R1. Configuration and Auto-Heal in `toad-app`
- Update `ToadConfig` interface in `tad-master/packages/toad-app/app/portableAppData.ts` to add `safe_mode_keywords: string[]` and `safe_mode_parallel: boolean` under `duckdb`.
- In `DEFAULT_CONFIG.duckdb`:
  - Set `safe_mode_keywords: ["hayabusa", "eventlog", "event_log", "security", "audit", "sysmon", "timeline", "dfir", "winlog", "firewall", "auth", "syslog"]` (excluding `"mft"`).
  - Set `safe_mode_parallel: true`.
- In `DEFAULT_CONFIG_INI_TEXT`: Add bilingual comments and template entries for `safe_mode_keywords` and `safe_mode_parallel` under `[duckdb]`.
- In `stringifyConfig`: Serialize `safe_mode_keywords = ${cfg.duckdb.safe_mode_keywords.join(", ")}` and `safe_mode_parallel = ${cfg.duckdb.safe_mode_parallel}`.
- In `validateAndEnsureConfig`: Parse comma-separated `safe_mode_keywords` (trim elements; treat `"none"`, `"off"`, or `""` as empty array `[]` to disable safe mode) and parse boolean `safe_mode_parallel`. Auto-heal the configuration by rewriting missing keys while preserving existing sections.
- In `initPortableEnvironment()`: Export environment variables `process.env.TOAD_SAFE_KEYWORDS`, `process.env.TOAD_SAFE_PARALLEL`, and `process.env.TOAD_APP_DATA_DIR`.

### R2. Engine Ingestion and Worker in `reltab-duckdb`
- In `tad-master/packages/reltab-duckdb/src/csvimport.ts`:
  - Add `safe_mode_keywords: string[]` and `safe_mode_parallel: boolean` to `IngestConfig`.
  - In `getIngestConfig()`: Retrieve configuration from `env.config.duckdb`, falling back to `process.env.TOAD_SAFE_KEYWORDS` or the default keyword list (without `"mft"`).
  - In `isComplexLogFile(filePath: string, customKeywords?: string[])`: Use `customKeywords || getIngestConfig().safe_mode_keywords` instead of hardcoded keywords, skipping empty or whitespace-only entries.
  - In `streamCsvToParquet`: Use `parallel = ${cfg.safe_mode_parallel ? "true" : "false"}` in Stage 1 Safe Profile.
  - In `nativeCSVImport`: Use `parallel=${cfg.safe_mode_parallel ? "true" : "false"}` in the `CREATE OR REPLACE TABLE` query.
  - Synchronize changes to `tad-master/packages/toad-app/node_modules/reltab-duckdb/src/csvimport.ts`.
- In `tad-master/packages/reltab-duckdb/src/ingestWorker.ts`:
  - Evaluate `safeParallel = cfg.safe_mode_parallel !== false && cfg.safeModeParallel !== false`.
  - Use `parallel = ${safeParallel ? "true" : "false"}` in Stage 1 and Stage 2 of Safe Ingest Profile.

### R3. Test Suite, Verification and Workspace Compliance
- Create unit test suite `tests/unit/test_safe_mode_config.js` with 16 test cases covering:
  1. Parsing keywords array from `config.ini`.
  2. Parsing extra whitespace and uppercase strings.
  3. Disabling safe mode with `"none"`, `"off"`, `""`.
  4. Auto-healing missing keys without altering existing sections.
  5. `isComplexLogFile("Windows.NTFS.MFT.csv")` returning `false` by default.
  6. Adding `"mft"` to keywords causing `isComplexLogFile("Windows.NTFS.MFT.csv")` to return `true`.
  7. `isComplexLogFile("hayabusa_high.csv")` returning `true`.
  8. `isComplexLogFile("Security.evtx")` returning `true`.
  9. `isComplexLogFile("application.log")` returning `true`.
  10. Boolean parsing for `safe_mode_parallel` (`true` and `false`).
  11. `getIngestConfig` fallback from `process.env.TOAD_SAFE_KEYWORDS`.
  12. Roundtrip serialization and parsing.
  13. DuckDB query generation containing `parallel = true` when `safe_mode_parallel = true`.
  14. DuckDB query generation containing `parallel = false` when `safe_mode_parallel = false`.
  15. Unicode and space file path handling.
  16. Default `config.ini` template containing clear comments.
- Register `tests/unit/test_safe_mode_config.js` in `run_tests.js`.
- Comply with workspace conventions:
  - Commit author name: `HelloKittyXamKinLung`, email: `p1rkr41n@users.noreply.github.com`.
  - Zero enterprise/org leaks.
  - English-only public language policy.

## Acceptance Criteria

### Test Suite Execution
- [ ] Running `.\node-v18.20.4-win-x64\node.exe run_tests.js --unit` passes all 16 unit tests in `test_safe_mode_config.js`.
- [ ] Running `.\node-v18.20.4-win-x64\node.exe run_tests.js` passes with 100% HEALTHY and 0 failed tests.

### Build and Compilation
- [ ] TypeScript compilation in `tad-master/packages/reltab-duckdb` via `npm run build` succeeds with exit code 0.
- [ ] Webpack compilation in `tad-master/packages/toad-app` via `npm run build-dev` succeeds with exit code 0.
