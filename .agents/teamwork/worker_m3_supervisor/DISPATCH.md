## 2026-11-03T17:05:56Z
You are worker_m3_supervisor, a teamwork_worker subagent.
Your working directory is: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m3_supervisor\

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

MANDATORY INPUTS (READ BEFORE STARTING WORK):
1. `ORIGINAL_REQUEST.md`: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md` (READ THIS FIRST)
2. `PROJECT.md`: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\PROJECT.md`
3. Spec Miner Analysis: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\spec_miner_ipc_survey\analysis.md`
4. Frontend Explorer Analysis: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_ipc_frontend\analysis.md`
5. Milestone 2 Handoff: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m2_engine_replacement\handoff.md`

YOUR EXCLUSIVE WRITE OWNERSHIP:
You own these files exclusively. Concurrent workers will not touch them:
- `tad-master/packages/toad-app/app/engineSupervisor.ts` (NEW)
- `tad-master/packages/toad-app/app/main.ts`
- `tad-master/packages/toad-app/src/electronRenderMain.tsx`
- `tad-master/packages/toadviewer/src/components/AppPane.tsx`

IMPORTANT TEST ASSERTION CONSTRAINT:
`tests/deep_integration_qa.js` asserts exact string patterns in `electronRenderMain.tsx` (e.g. `console.error(\n      "[UNCAUGHT-PROMISE-REJECTION]"`). You MUST strictly preserve these exact strings when editing `electronRenderMain.tsx`.

TASK DESCRIPTION — MILESTONE 3:
1. Implement `engineSupervisor.ts`:
   - Spawns `engineService.js` (or bundle) using Electron `utilityProcess.fork()`.
   - Checks `runtime.engine = "utility" | "legacy"`: if `"legacy"`, falls back to in-process initialization; otherwise manages `utilityProcess`.
   - On spawn, creates `MessageChannelMain`, forwards `port2` to child process via `process.parentPort` / `child.postMessage`, and sends `port1` to Renderer `webContents.postMessage("toad-engine-port", null, [port1])`.
   - Watches child lifecycle: listens to `child.on("exit")` and `child.on("error")`. If child exits unexpectedly (code != 0), auto-restarts within < 500ms.
   - Upon auto-restart, commands `engineService` to replay all view states from `toad_ledger.parquet` in < 5ms via `replayLedgerViews()`.
   - Sends a fresh `MessagePort` to Renderer, and emits `"engine:restored"` event to Renderer window.
2. Update `main.ts`:
   - Integrate `EngineSupervisor.getInstance().start(mainWindow)` into application startup.
   - Gracefully handle app shutdown and cleanup of child processes.
3. Update `electronRenderMain.tsx` & `AppPane.tsx`:
   - Expose/listen to `engine:restored` event in Renderer.
   - In `AppPane.tsx`, when `engine:restored` is received, show BlueprintJS v4 non-blocking toast:
     `"Động cơ phân tích vừa được tự động phục hồi"` using `Toaster.create({ position: Position.BOTTOM_RIGHT })`, `intent: Intent.SUCCESS`, `icon: "refresh"`, `timeout: 4000`.
   - Re-query/re-open current active view so the user's tabular view instantly refreshes.
4. Verification:
   - Compile `toad-app` and `toadviewer` with `tsc`.
   - Create a crash recovery verification script (`tests/verify_crash_recovery.js` or `tests/test_engine_crash_recovery.js`) testing that killing the engine process triggers auto-restart within 500ms and state restoration from `toad_ledger.parquet`.
   - Run `tests/smoke_test.js` and `tests/legacy_use_cases.js`.
5. Reporting:
   - Write your implementation and test results to `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m3_supervisor\changes.md`.
   - Write a complete handoff report to `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m3_supervisor\handoff.md`.
   - Send a completion message to the orchestrator.
