# Project: Configurable Safe Mode Keywords & DuckDB Multi-threaded Ingestion

## Architecture
- **Configuration & Environment Layer (`toad-app/app/portableAppData.ts`)**:
  - `ToadConfig.duckdb`: adds `safe_mode_keywords: string[]` and `safe_mode_parallel: boolean`.
  - `DEFAULT_CONFIG.duckdb`: default keywords `["hayabusa", "eventlog", "event_log", "security", "audit", "sysmon", "timeline", "dfir", "winlog", "firewall", "auth", "syslog"]` (excluding `"mft"`), and `safe_mode_parallel: true`.
  - `DEFAULT_CONFIG_INI_TEXT`: bilingual comments and template entries for `safe_mode_keywords` and `safe_mode_parallel`.
  - `stringifyConfig`: serializes `safe_mode_keywords` and `safe_mode_parallel`.
  - `validateAndEnsureConfig`: robust parsing of comma-separated keywords (trimming, lowercasing, `"none"`, `"off"`, `""` -> `[]`), parsing boolean `safe_mode_parallel`, and auto-healing missing keys without altering existing sections.
  - `initPortableEnvironment()`: exports `process.env.TOAD_SAFE_KEYWORDS`, `process.env.TOAD_SAFE_PARALLEL`, and `process.env.TOAD_APP_DATA_DIR`.

- **Engine Ingestion & Worker Layer (`reltab-duckdb/src/csvimport.ts`, `ingestWorker.ts`)**:
  - `IngestConfig`: adds `safe_mode_keywords: string[]` and `safe_mode_parallel: boolean`.
  - `getIngestConfig()`: retrieves config from `env.config.duckdb`, falling back to `process.env.TOAD_SAFE_KEYWORDS` (or default 12 keywords without `"mft"`) and `process.env.TOAD_SAFE_PARALLEL`.
  - `isComplexLogFile(filePath, customKeywords?)`: uses `customKeywords || getIngestConfig().safe_mode_keywords`, skipping whitespace/empty tokens. Returns `false` by default for `Windows.NTFS.MFT.csv`.
  - `streamCsvToParquet`: sets `parallel = ${cfg.safe_mode_parallel ? "true" : "false"}` in Stage 1 Safe Profile.
  - `nativeCSVImport`: sets `parallel=${cfg.safe_mode_parallel ? "true" : "false"}` in `CREATE OR REPLACE TABLE` query.
  - `ingestWorker.ts`: evaluates `safeParallel = cfg.safe_mode_parallel !== false && cfg.safeModeParallel !== false` and applies `parallel = ${safeParallel ? "true" : "false"}` in Stage 1 and Stage 2 Safe Ingest Profiles.
  - Synchronization: `toad-app/node_modules/reltab-duckdb` is an NTFS junction to `packages/reltab-duckdb`. `npm run build` compiles TypeScript to `dist/`.

- **Testing & Verification Layer (`tests/unit/test_safe_mode_config.js`, `run_tests.js`)**:
  - Unit test suite `test_safe_mode_config.js` implementing all 16 test cases covering parsing, whitespace, "none"/"off"/"" disable, auto-healing, MFT classification, boolean parsing, env fallback, serialization, DuckDB query generation, unicode paths, and INI comments.
  - Registered in `run_tests.js` under `--unit` and default runner.
  - Regression fix in `tests/deep_integration_qa.js:5689` to verify MFT classification with custom keywords.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | ToadConfig type definition | Add safe_mode_keywords and safe_mode_parallel to ToadConfig.duckdb | M1 | ORIGINAL_REQUEST §R1 |
| 2 | Default config values | DEFAULT_CONFIG.duckdb defaults to 12 keywords (no mft) and parallel=true | M1 | ORIGINAL_REQUEST §R1 |
| 3 | INI template & comments | Bilingual comments and template entries in DEFAULT_CONFIG_INI_TEXT | M1 | ORIGINAL_REQUEST §R1 |
| 4 | INI serialization | stringifyConfig writes safe_mode_keywords and safe_mode_parallel | M1 | ORIGINAL_REQUEST §R1 |
| 5 | INI parsing & auto-heal | validateAndEnsureConfig parses keywords array, boolean, and auto-heals missing keys | M1 | ORIGINAL_REQUEST §R1 |
| 6 | Environment variable export | initPortableEnvironment exports TOAD_SAFE_KEYWORDS, TOAD_SAFE_PARALLEL, TOAD_APP_DATA_DIR | M1 | ORIGINAL_REQUEST §R1 |
| 7 | IngestConfig type definition | Add safe_mode_keywords and safe_mode_parallel to IngestConfig | M2 | ORIGINAL_REQUEST §R2 |
| 8 | getIngestConfig fallback | Fallback hierarchy: env.config.duckdb -> process.env -> default keywords (no mft) | M2 | ORIGINAL_REQUEST §R2 |
| 9 | isComplexLogFile classifier | Prioritize customKeywords, fallback to safe_mode_keywords, ignore empty tokens, default mft=false | M2 | ORIGINAL_REQUEST §R2 |
| 10 | Multi-threaded Safe Profile | streamCsvToParquet Stage 1 uses parallel=${cfg.safe_mode_parallel ? "true" : "false"} | M2 | ORIGINAL_REQUEST §R2 |
| 11 | Multi-threaded Native Import | nativeCSVImport query uses parallel=${cfg.safe_mode_parallel ? "true" : "false"} | M2 | ORIGINAL_REQUEST §R2 |
| 12 | Worker safeParallel | ingestWorker.ts evaluates safeParallel and applies to Stage 1 & 2 queries | M2 | ORIGINAL_REQUEST §R2 |
| 13 | Deep Integration QA update | Update tests/deep_integration_qa.js:5689 to align with new mft default behavior | M2 | Survey findings |
| 14 | Unit test suite (16 cases) | Create tests/unit/test_safe_mode_config.js covering all 16 specified cases | M3 | ORIGINAL_REQUEST §R3 |
| 15 | Test runner registration | Register test_safe_mode_config.js in run_tests.js (--unit and default) | M3 | ORIGINAL_REQUEST §R3 |
| 16 | TypeScript & Webpack build | Compile reltab-duckdb and toad-app with exit code 0 | M4 | ORIGINAL_REQUEST Acceptance |
| 17 | Gate & Integrity audit | Independent Reviewers, Challengers, and Forensic Auditor verification | M4 | Orchestration protocol |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | M1: Configuration & Auto-Heal | `portableAppData.ts` (Features 1-6) | none | DONE |
| 2 | M2: DuckDB Ingestion & Worker | `csvimport.ts`, `ingestWorker.ts`, `deep_integration_qa.js` (Features 7-13) | M1 | DONE |
| 3 | M3: Unit Tests & Runner Integration | `tests/unit/test_safe_mode_config.js`, `run_tests.js` (Features 14-15) | M1, M2 | DONE |
| 4 | M4: Gate Verification & Audit | Builds (`tsc`, `webpack`), test suites (`--unit`, full), dual reviewers, dual challengers, forensic auditor (Features 16-17) | M1, M2, M3 | DONE |

## Interface Contracts
### `portableAppData.ts` <-> `csvimport.ts`
- Environment Variables:
  - `process.env.TOAD_SAFE_KEYWORDS`: comma-separated string (e.g. `"hayabusa,eventlog,..."` or `""` or `"none"`)
  - `process.env.TOAD_SAFE_PARALLEL`: `"true"` | `"false"`
  - `process.env.TOAD_APP_DATA_DIR`: string path
- Global Object:
  - `(global as any).toadPortableEnv.config.duckdb.safe_mode_keywords`: `string[]`
  - `(global as any).toadPortableEnv.config.duckdb.safe_mode_parallel`: `boolean`

### `csvimport.ts` <-> `ingestWorker.ts`
- Worker arguments JSON payload:
  - `cfg.safe_mode_parallel` (or `cfg.safeModeParallel`): `boolean`

## Code Layout
- `tad-master/packages/toad-app/app/portableAppData.ts` (owned by M1)
- `tad-master/packages/reltab-duckdb/src/csvimport.ts` (owned by M2)
- `tad-master/packages/reltab-duckdb/src/ingestWorker.ts` (owned by M2)
- `tests/deep_integration_qa.js` (owned by M2)
- `tests/unit/test_safe_mode_config.js` (owned by M3)
- `run_tests.js` (owned by M3)
