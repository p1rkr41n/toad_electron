# Original User Request

## Approved Task Prompt — 2026-11-05T02:42:32Z

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

## User Feedback / Follow-up — 2026-11-05T02:44:27Z

[User Feedback / Bug Report for Milestone 7 Packaging]
The user encountered a Windows System Error dialog when executing Toad.exe:
"---------------------------
Toad.exe - System Error
---------------------------
The code execution cannot proceed because WebView2Loader.dll was not found. Reinstalling the program may fix this problem. 
---------------------------
OK   
---------------------------"

Root Cause Analysis:
1. The host Rust toolchain is x86_64-pc-windows-gnu (MinGW). In webview2-com-sys (src/lib.rs):
   #[cfg_attr(target_env = "msvc", link(name = "WebView2LoaderStatic", kind = "static"))]
   #[cfg_attr(not(target_env = "msvc"), link(name = "WebView2Loader.dll"))]
   Under the GNU toolchain (not msvc), webview2-com-sys dynamically links against WebView2Loader.dll rather than embedding it statically.
2. Therefore, on Windows GNU targets, WebView2Loader.dll MUST always be present alongside Toad.exe and duckdb.dll in any directory where Toad.exe is executed (including root directory D:\Shared_UserData\Downloads\tad\, release folders, and inside portable zip archives).
3. In package_portable.ps1, ensure WebView2Loader.dll is reliably deployed alongside Toad.exe everywhere Toad.exe is placed, or consider packaging options.

Please incorporate this fix into Milestone 7 packaging and release verification.


## Approved Task Prompt (Tauri v2 Port & Rebuild) — 2026-11-04T18:31:22Z

Use a team of 50 engineers across 7 squads to port and rebuild the Toad application for Windows on Tauri v2 at `D:\Shared_UserData\Downloads\tad\tauri\project`, reference Tauri v2 documentation at `D:\Shared_UserData\Downloads\tad\tauri\docs/`, and package a portable release at `D:\Shared_UserData\Downloads\tad\tauri\project\releases/`.

Working directory: D:\Shared_UserData\Downloads\tad
Integrity mode: development

Reference material:
- Approved plan: `C:\Users\huydq\.gemini\antigravity\brain\4cd78c02-c356-4448-bdfe-f2930e55fb29\ke_hoach_trien_khai_50_subagents_tauri_v2.md`
- Tauri v2 documentation: `D:\Shared_UserData\Downloads\tad\tauri\docs/`
- Existing Frontend source: `tad-master/packages/toadviewer`
- IPC Command aliases: `packages/host-bridge/src/commandAliases.ts`
- Host Adapter: `packages/host-bridge/src/TauriHostAdapter.ts`

## Requirements

### R1. Scaffolding, Toolchain & Jujutsu Version Control
Set up the Tauri v2 project structure at `tauri/project` with Vite 5 and React 18. Update the root `.gitignore` to track `tauri/project/` while strictly excluding build artifacts (`tauri/project/src-tauri/target/`, `node_modules/`, `dist/`). Manage local version control using Jujutsu (`jj`), recording commits under identity `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>` with professional English commit messages. Strictly perform local builds only (never call `git push` or GitHub Release API).

### R2. Native Rust Core, DuckDB Engine & Forensics Ingestion
Implement a 100% Native Rust backend in `src-tauri` using In-Process Tokio Async:
- DuckDB 1.0 connection pool with dual-engine driver (UI query connection and ingestion worker connections).
- QueryExp AST compiler to generate optimized DuckDB SQL.
- Streaming tabular query results to WebView as binary Apache Arrow IPC Stream (`0xFFFFFFFF` marker) via `tauri::ipc::Response`.
- Ingestion pipelines for RFC-4180 CSV/TSV, JSONL/NDJSON, and binary Windows Event Logs (`.evtx`) decoded via Rust SIMD `evtx` crate.
- Write-Ahead Log Parquet state ledger (`toad_ledger.parquet`) and portable environment creating `toadAppData_[5chars]` adjacent to the executable.

### R3. Frontend Porting & Host Bridge Integration
Port and bundle the frontend into `tauri/project/dist/` using Vite 5, reusing React 18, virtualized SlickGrid, pivot table, and ArcSight ESM filter from `tad-master/packages/toadviewer`. Connect the UI via `packages/host-bridge/src/TauriHostAdapter.ts` adhering strictly to IPC command aliases in `packages/host-bridge/src/commandAliases.ts`. Support zero-copy Arrow IPC decoding via `@apache-arrow/es2015-cjs` directly into SlickGrid models. Preserve dark theme and dynamic column wrap/resizing.

### R4. Automated Testing & Verification
Implement and execute automated test suites as planned for Squad 1 and Squad 7:
- Rust Core Unit & Command Tests (`cargo test --verbose` in `src-tauri`).
- Frontend production build verification (`npm run build`).
- Arrow IPC roundtrip integration tests (`node tests/test_tauri_arrow_ipc.js`).
- 100K rows virtual scroll concurrency and memory stress tests (`node tests/test_grid_scroll_stress.js`).

### R5. Production Portable Packaging & Release Audit
Build packaging automation script `tauri/project/tools/package_portable.ps1`:
- Compile optimized binary `Toad-2.5.1-x64-portable.exe` (or incremented version e.g. `2.5.2` per versioning policy, < 50MB) and compressed archive `Toad-*-x64-portable.zip` into `tauri/project/releases/` and root `releases/`.
- Generate `SHA256SUMS.txt` and verify PE header metadata.
- Strictly adhere to Zero-Duplicate Binary storage policy (no intermediate historical version duplicates).

## Acceptance Criteria

### Automated Test Verification
- [ ] Rust Core unit tests pass with 100% success (`cargo test` in `src-tauri`).
- [ ] Vite frontend build completes without errors (`npm run build`).
- [ ] Arrow IPC binary stream integration test passes with 100% roundtrip accuracy.
- [ ] 100K rows scroll stress test passes (FPS > 55, stable RAM delta < 25MB).

### Functional & Packaging Verification
- [ ] Portable executable `Toad-*-x64-portable.exe` (< 50MB), archive `Toad-*-x64-portable.zip`, and `SHA256SUMS.txt` are created in `tauri/project/releases/` and root `releases/`.
- [ ] Launching `Toad.exe` / portable executable opens window in < 300ms and creates portable `toadAppData_[id]` folder adjacent to the executable.
- [ ] Drag-and-drop loading of CSV, Parquet, and EVTX files correctly renders table data in virtualized SlickGrid.
- [ ] Jujutsu repository tracks clean commit history locally under author `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>` without remote git push or GitHub API interactions.
