# Original User Request

## Initial Approved Prompt — 2026-11-03T09:22:04Z

Full team (multi agents for implementer): Fix the DuckDB CSV sniffer delimiter misparsing and cache hit flaw in Tad, implement non-blocking ingestion error handling with file status badging, clean up corrupted parquet caches, rebuild the application via fastbuild, and verify the schema and build.

Working directory: d:\Shared_UserData\Downloads\tad
Integrity mode: development

Reference report: C:\Users\huydq\.gemini\antigravity\brain\489b863f-84dc-4fd6-bbfb-142488ba4d23\bao_cao_root_cause_analysis_csv_column_split.md

## Requirements

### R1. Gateway Cache Validation & Misparsed Parquet Eviction
Move or mirror `isMisparsedDelimiter` (and rawEvent fallback checks) directly into `checkDoubleValidCache` / before `createViewFromParquet` in `reltab-fs.ts` or `csvimport.ts`. Ensure that if a cached parquet file has `column01..columnN` or column 0 contains commas, it is detected and evicted immediately upon file open or project registration.

### R2. CSV Parser Configuration & Stability
Verify and enforce that `csvimport.ts` and `ingestWorker.ts` use `delim = ','` without `escape = ''` for CSV files, maintaining `all_varchar = true` to prevent native `vector.cpp:1859` assertion crashes.

### R3. Cache and Stale Temporary File Cleanup
Clean up any stale `.tmp_` and corrupted parquet cache files for `sample_40gb.csv` in `releases/toadAppData_*` and active cache directories, ensuring clean ledger state.

### R4. Non-blocking Ingestion Error Handling & Logging
Whenever any file throws an ingestion or processing exception during loading or worker processing:
1. Catch the exception and record the full error trace into the log file (`toad.log`).
2. Update the file's status in the project sidebar/ledger to error status with an exclamation mark circle icon (`!`) to visually indicate a failed file, rather than presenting an intrusive pop-up error dialog that forces the user to click "ignore".

### R5. Build & Workspace Adherence
Run `fastbuild.ps1` to produce the updated runnable application directory / binary. Respect workspace guidelines in `AGENTS.md` (use Jujutsu `jj`, Zero-Duplicate Binary Storage policy).

## Verification Resources
- Use the first 1000 lines in `sample_40gb.csv` as a mini sample for fast test, and let the team decide the verification approach. Full `sample_40gb.csv` can also be verified.
- Reference investigation report: `C:\Users\huydq\.gemini\antigravity\brain\489b863f-84dc-4fd6-bbfb-142488ba4d23\bao_cao_root_cause_analysis_csv_column_split.md`.

## Acceptance Criteria

### Cache Validation & Parser Fix
- [ ] Stale or corrupted parquet caches with `column01..columnN` or comma-separated column 0 are automatically detected and evicted on open.
- [ ] CSV import enforces `delim = ','`, removes `escape = ''`, and retains `all_varchar = true`.
- [ ] Stale `.tmp_` files and corrupted parquet caches for `sample_40gb.csv` are removed from cache directories.

### Ingestion Error Handling & Logging
- [ ] Ingestion exceptions are caught, preventing intrusive pop-up error dialogs requiring manual "ignore" clicks.
- [ ] Full error trace for failed file ingestion is written to the log file (`toad.log`).
- [ ] Failed files are marked with error status and display the exclamation mark circle icon (`!`) on the project sidebar/ledger.

### Build & Version Control
- [ ] `fastbuild.ps1` runs successfully and updates the build output.
- [ ] Workspace guidelines in `AGENTS.md` are respected (no duplicate binary storage across historical versions).

### QA & Verification
- [ ] `sample_40gb.csv` (and/or mini sample of its first 1000 lines) parses cleanly with all 11 proper columns (`Timestamp`, `EventTime`, `RuleTitle`, `RuleID`, `Level`, `Computer`, `Channel`, `EventID`, `RecordID`, `Details`, `ExtraFieldInfo`).
- [ ] No `column01..column10` column names appear in the resulting schema.
- [ ] Column 0 contains proper values, not raw unparsed lines.
