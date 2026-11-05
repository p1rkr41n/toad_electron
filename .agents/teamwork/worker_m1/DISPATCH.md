## 2026-11-05T02:55:34Z
You are the Worker for Milestone 1: "Configuration and Auto-Heal in toad-app".

Your working directory is:
`d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m1`

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Scope & File Ownership:
You EXCLUSIVELY own and modify:
`tad-master/packages/toad-app/app/portableAppData.ts`

Relevant Reference Files:
- Mandatory: Read `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md` before starting.
- Read `d:\Shared_UserData\Downloads\tad\.agents\teamwork\PROJECT.md`.
- Read detailed findings and code templates in `d:\Shared_UserData\Downloads\tad\.agents\teamwork\spec_miner_survey_config\analysis.md`.

Tasks to Implement:
1. In `ToadConfig` interface (under `duckdb`):
   Add:
   ```typescript
   safe_mode_keywords: string[];
   safe_mode_parallel: boolean;
   ```
2. In `DEFAULT_CONFIG.duckdb`:
   Set:
   ```typescript
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
   ```
   (Verify: `"mft"` is NOT present).
3. In `DEFAULT_CONFIG_INI_TEXT`:
   Add bilingual comments and template entries under `[duckdb]`:
   ```ini
   # Safe mode keywords (comma-separated, case-insensitive). Triggers safe all_varchar ingestion for large complex logs.
   # Set to none or off or empty to disable safe mode heuristics.
   # Tu khoa che do an toan (ngan cach bang dau phay). Dat thanh none hoac off de tat.
   safe_mode_keywords = hayabusa, eventlog, event_log, security, audit, sysmon, timeline, dfir, winlog, firewall, auth, syslog

   # Multi-threaded ingestion for safe mode (true = fast parallel scan, false = single-threaded fallback)
   # Doc da luong cho che do an toan (true = quet da luong nhanh, false = don luong)
   safe_mode_parallel = true
   ```
4. In `stringifyConfig`:
   Serialize under `[duckdb]`:
   ```typescript
   safe_mode_keywords = ${cfg.duckdb.safe_mode_keywords.join(", ")}
   safe_mode_parallel = ${cfg.duckdb.safe_mode_parallel}
   ```
5. In `validateAndEnsureConfig`:
   - Parse `safe_mode_keywords` from INI section `[duckdb]`:
     If present, split by comma, trim each element, lowercase. If element is empty, skip. If the raw string or parsed result is `"none"`, `"off"`, or empty, set `safe_mode_keywords = []`.
     If key missing from `[duckdb]`, assign default array and set `needRewrite = true` to auto-heal.
   - Parse `safe_mode_parallel`:
     Parse boolean (check `"true"`, `"false"`, or boolean). Default to `true`.
     If key missing, assign default `true` and set `needRewrite = true` to auto-heal.
   - Ensure auto-heal preserves existing user sections and comments.
6. In `initPortableEnvironment()`:
   Export environment variables:
   ```typescript
   process.env.TOAD_SAFE_KEYWORDS = config.duckdb.safe_mode_keywords.join(",");
   process.env.TOAD_SAFE_PARALLEL = String(config.duckdb.safe_mode_parallel);
   process.env.TOAD_APP_DATA_DIR = appDataDir;
   ```
   and ensure `(global as any).toadPortableEnv = envResult;`.

Verification:
- Compile `toad-app` via webpack:
  `.\node-v18.20.4-win-x64\node.exe .\node-v18.20.4-win-x64\node_modules\npm\bin\npm-cli.js --prefix tad-master/packages/toad-app run build-dev` (or using `npm.cmd`).
- Write complete handoff report to `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m1\handoff.md`.
- Send message to orchestrator upon completion.
