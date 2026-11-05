# Handoff Report: Configurable Safe Mode Keywords & Parallel Ingestion (Requirement R1)

**Agent**: Config Spec Miner (`spec_miner_survey_config`)  
**Recipient**: Orchestrator (`19413780-831c-4722-80e8-c33ef9d32515`)  
**Type**: Hard Handoff  
**Date**: 2026-11-05  

---

## 1. Observation

1. **`ToadConfig` interface in `tad-master/packages/toad-app/app/portableAppData.ts:35-40`**:
   `duckdb` currently defines:
   ```typescript
   duckdb: {
     max_memory: string;
     threads: number;
     background_threads: number | "auto";
     add_raw_event: boolean;
   };
   ```
   Requires addition of `safe_mode_keywords: string[];` and `safe_mode_parallel: boolean;`.

2. **`DEFAULT_CONFIG.duckdb` in `portableAppData.ts:80-85`**:
   Currently lacks safe mode fields. Default keywords specified in `ORIGINAL_REQUEST.md:14`:
   `["hayabusa", "eventlog", "event_log", "security", "audit", "sysmon", "timeline", "dfir", "winlog", "firewall", "auth", "syslog"]` (excluding `"mft"`), and `safe_mode_parallel: true`.

3. **`DEFAULT_CONFIG_INI_TEXT` in `portableAppData.ts:134-154`**:
   Contains `[duckdb]` section ending with `add_raw_event = false`. Template lines and bilingual comments must be inserted here.

4. **`stringifyConfig` in `portableAppData.ts:328-333`**:
   Currently formats:
   ```typescript
   [duckdb]
   max_memory = ${cfg.duckdb.max_memory}
   threads = ${cfg.duckdb.threads}
   background_threads = ${cfg.duckdb.background_threads}
   add_raw_event = ${cfg.duckdb.add_raw_event}
   ```
   Must serialize `safe_mode_keywords = ${cfg.duckdb.safe_mode_keywords.join(", ")}` and `safe_mode_parallel = ${cfg.duckdb.safe_mode_parallel}`.

5. **`validateAndEnsureConfig` in `portableAppData.ts:508-546` & `620-628`**:
   Currently validates `max_memory`, `threads`, `background_threads`, `add_raw_event`. Must parse comma-separated `safe_mode_keywords`, trimming and lowercasing entries; handling `"none"`, `"off"`, `""` as `[]`; parsing boolean `safe_mode_parallel`; and triggering auto-heal (`needRewrite = true`) for missing keys/sections while preserving existing user modifications.

6. **`initPortableEnvironment` in `portableAppData.ts:869-929`**:
   Initializes paths and validates config. Must export:
   - `process.env.TOAD_APP_DATA_DIR = appDataDir;`
   - `process.env.TOAD_SAFE_KEYWORDS = config.duckdb.safe_mode_keywords.join(",");`
   - `process.env.TOAD_SAFE_PARALLEL = String(config.duckdb.safe_mode_parallel);`
   and store `(global as any).toadPortableEnv = envResult;`.

7. **Cross-module interactions in `tad-master/packages/reltab-duckdb/src/csvimport.ts`**:
   - Lines 220-230: `IngestConfig` interface must declare `safe_mode_keywords: string[]; safe_mode_parallel: boolean;`.
   - Lines 232-273: `getIngestConfig()` must read from `env.config.duckdb` and fallback to `process.env.TOAD_SAFE_KEYWORDS` and `process.env.TOAD_SAFE_PARALLEL`.
   - Lines 2703-2730: `isComplexLogFile(filePath, customKeywords?)` currently hardcodes 13 keywords (including `"mft"`). Must switch to `customKeywords || getIngestConfig().safe_mode_keywords`, filtering out whitespace/empty tokens.
   - Lines 2831 & 3711: `streamCsvToParquet` and `nativeCSVImport` currently hardcode `parallel = false`. Must use `parallel = ${cfg.safe_mode_parallel ? "true" : "false"}`.

8. **Existing Test Suite Collision in `tests/deep_integration_qa.js:5689`**:
   Line 5689 asserts `assert.strictEqual(isComplexLogFile("mft_dump.csv"), true);`. Under the new specification, `"mft"` is excluded from default keywords so `isComplexLogFile("mft_dump.csv")` returns `false` by default. This will cause Suite LL in `deep_integration_qa.js` to fail during `node run_tests.js` unless updated or overridden.

9. **NTFS Junction Link**:
   `tad-master/packages/toad-app/node_modules/reltab-duckdb` is an NTFS junction link directly targeting `tad-master/packages/reltab-duckdb`.

10. **Test Environment**:
    Existing unit tests (`.\node-v18.20.4-win-x64\node.exe run_tests.js --unit`) pass cleanly (10 suites, 196 tests, duration 8.78s).

---

## 2. Logic Chain

1. From **Observation 1 & 2**, adding `safe_mode_keywords: string[]` and `safe_mode_parallel: boolean` to `ToadConfig` and `DEFAULT_CONFIG.duckdb` establishes the static type contract and ensures consistent defaults across the entire TypeScript application.
2. From **Observation 3, 4 & 5**, `validateAndEnsureConfig` performs 4-tier validation. If a user has an existing `config.ini` from an earlier version of Toad lacking `safe_mode_keywords` or `safe_mode_parallel`, the parser will assign the defaults and set `needRewrite = true`. `stringifyConfig` then writes out the file, healing the configuration without modifying any existing user keys (e.g., custom `page_size`, `threads`, or `max_memory`).
3. From **Observation 5**, when parsing `safe_mode_keywords`, trimming and lowercasing elements guarantees case-insensitivity. Treating `"none"`, `"off"`, and `""` as `[]` provides an explicit, user-friendly mechanism to completely disable Safe Mode heuristics.
4. From **Observation 6 & 7**, exporting `process.env.TOAD_SAFE_KEYWORDS`, `process.env.TOAD_SAFE_PARALLEL`, and `process.env.TOAD_APP_DATA_DIR` inside `initPortableEnvironment()` enables child utility processes (forked via `engineSupervisor.ts` with `...process.env`) and worker processes (forked via `runIngestInWorker` with `...process.env`) to access the user's config without needing IPC roundtrips.
5. From **Observation 8**, because v2.4.5 hardcoded `"mft"` and tested it in `tests/deep_integration_qa.js:5689`, the intentional removal of `"mft"` from default keywords in v2.5.2 will break line 5689 unless the test is updated to reflect the new specification (e.g. `isComplexLogFile("mft_dump.csv", ["mft"])` or asserting `false`).

---

## 3. Caveats

1. **Junction vs Build Dist**: While `tad-master/packages/toad-app/node_modules/reltab-duckdb` is a junction, if any runtime code requires `dist/reltab-duckdb.js`, `npm run build` inside `tad-master/packages/reltab-duckdb` must be executed after modifying TypeScript files.
2. **File Extension Matching**: In `isComplexLogFile()`, files with `.log`, `.txt`, and `.evtx` extensions are flagged as complex regardless of keywords. Disabling safe mode via keywords (`[]`) only prevents keyword substring matching; it does not disable `.log`, `.txt`, `.evtx` extension detection unless explicitly desired by the user.

---

## 4. Conclusion

Requirement R1 is fully investigated and documented. The interfaces, default values, parsing semantics, auto-healing behavior, serialization roundtrip, and environment variable propagations are specified down to exact line numbers and code blocks. The downstream impacts on `reltab-duckdb` and the collision with `deep_integration_qa.js:5689` are documented in `analysis.md` for the implementer and test miner.

---

## 5. Verification Method

Independent verification of the findings:

1. **Inspect Specification Analysis**:
   Review `.agents/teamwork/spec_miner_survey_config/analysis.md` for complete feature mappings, edge cases, and code templates.
2. **Verify Target Files**:
   - `tad-master/packages/toad-app/app/portableAppData.ts` (lines 35-40, 80-85, 134-154, 328-333, 508-631, 869-929).
   - `tad-master/packages/reltab-duckdb/src/csvimport.ts` (lines 220-273, 2703-2730, 2831, 3711).
   - `tests/deep_integration_qa.js` (line 5689).
3. **Execute Unit Test Baseline**:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe run_tests.js --unit
   ```
   Confirms baseline tests pass (100% HEALTHY).
4. **Invalidation Conditions**:
   - If `DEFAULT_CONFIG.duckdb.safe_mode_keywords` includes `"mft"`, this invalidates the specification requirement.
   - If `safe_mode_parallel` defaults to `false`, this invalidates the specification requirement.
