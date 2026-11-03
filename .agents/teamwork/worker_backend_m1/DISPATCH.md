## 2026-11-03T09:45:45Z
You are a worker implementer agent. Your identity:
- Working directory: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_backend_m1\
- Role: Backend CSV & Cache Engineer

MANDATORY FIRST STEP:
Read ORIGINAL_REQUEST.md at:
d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md

Read PROJECT.md at:
d:\Shared_UserData\Downloads\tad\.agents\teamwork\PROJECT.md

Read survey analysis reports:
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\spec_miner_csv\analysis.md
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_csv_backend\analysis.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

EXCLUSIVE FILE OWNERSHIP:
You exclusively own and may modify:
- packages/reltab-fs/src/reltab-fs.ts
- packages/reltab-fs/src/csvimport.ts
- packages/reltab-duckdb/src/ingestWorker.ts
- packages/tad-app/app/portableAppData.ts
Do NOT modify any files owned by Milestone 2 (tadviewer, main.ts, electronRenderMain.tsx).

YOUR TASK: Implement Milestone 1 (R1, R2, R3):
1. CSV Parser Enforcements (R2):
   - In `packages/reltab-fs/src/csvimport.ts` and `packages/reltab-duckdb/src/ingestWorker.ts`, enforce `delim = ','` for CSV files, remove `escape = ''`, maintain `all_varchar = true`, `null_padding = true`, and `ignore_errors = true`.
   - Fix worker argument reading in `packages/reltab-duckdb/src/ingestWorker.ts`: ensure `isComplexLog` evaluates correctly (`process.argv[5] === "1" || cfg.isComplex === true`).
2. Gateway Cache Validation & Misparsed Parquet Eviction (R1):
   - In `packages/reltab-fs/src/reltab-fs.ts` (around `getTableName` / `createViewFromParquet`): inspect the table columns immediately upon mounting a cached parquet file. If any column matches `/^column0*\d+$/i` or if column 0 contains commas (e.g., raw unparsed CSV header like `\uFEFFTimestamp,EventTime...`), immediately:
     a) Evict/delete the corrupted parquet cache file from disk.
     b) Invalidate the cache in the ledger / RAM cache.
     c) Drop the view if already created.
     d) Fall through to fresh streaming CSV import (`nativeCSVImport`).
   - Mirror this validation into `packages/reltab-fs/src/csvimport.ts:checkDoubleValidCache` so that invalid caches are never considered valid cache hits.
3. Cache & Stale Temporary File Cleanup (R3):
   - Clean up any stale `.tmp_` and corrupted parquet cache files for `sample_40gb.csv` in `releases/toadAppData_*`, `build/`, and active cache directories.
   - Fix `purgeOrphanTempFiles` in `packages/tad-app/app/portableAppData.ts:774`: make it recursive so that project subdirectories in `temp/` (e.g. `temp/okgrg/`, `temp/ekm8j/`) are scanned and stale `.tmp_` files are cleaned up across sessions.
4. Compilation & Verification:
   - Run `npm run build` in `packages/reltab-fs` to compile TypeScript to `dist/reltab-fs.js`.
   - Run `npm run build` in `packages/reltab-duckdb` if modified.
   - Run a quick node verification script on `sample_40gb.csv` (first 1000 lines or sample) to confirm that parsing produces all 11 proper columns without `column01..column10` and that corrupted cache eviction works.

Update your progress.md after each step.
When complete, write your handoff report to:
`d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_backend_m1\handoff.md`
and send a handoff message back to the orchestrator.
