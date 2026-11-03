# Milestone 3 Handoff Report: Engine Supervisor, Crash Resilience & Toast

**Subagent**: `worker_m3_supervisor`  
**Milestone**: Milestone 3 (M3 - Engine Supervisor & Crash Resilience)  
**Parent Agent**: `531c42c5-3aec-4e19-a1ab-7c1a352f15c4`  
**Date**: 2026-11-04  
**Status**: Completed (Hard Handoff)  

---

## 1. Observation

1. **New Engine Supervisor Implementation (`tad-master/packages/toad-app/app/engineSupervisor.ts`)**:
   - Implemented `EngineSupervisor` singleton class managing `utilityProcess` (and headless `cp.fork` fallback for test execution).
   - Dual-mode engine detection:
     - When `runtime.engine = "legacy"`: Falls back to in-process initialization via `reltabDuckDB.initToadLedger()`, `initLedger()`, and `performStartupReconciliation()`. Does not spawn child process.
     - When `runtime.engine = "utility"`: Spawns engine process, creates `MessageChannelMain`, transfers `port2` to child with `{ type: "init-data-channel" }`, and sends `port1` to Renderer with `mainWindow.webContents.postMessage("toad-engine-port", null, [port1])`.
   - Listens to `child.on("exit")` and `child.on("error")`. If child process exits unexpectedly, auto-restart triggers within < 500ms SLA.
   - Upon restart, commands child service to replay all views from `toad_ledger.parquet` in < 5ms via `replayLedgerViews()`, attaches fresh MessagePorts to Renderers, and broadcasts `engine:restored` event with payload `{ timestamp, restoredViewsCount, elapsedMs, pid }`.

2. **Integration into Electron Main Application (`tad-master/packages/toad-app/app/main.ts`)**:
   - Line 74: Added `import { EngineSupervisor } from "./engineSupervisor";`.
   - Lines 765-769: Integrated `await EngineSupervisor.getInstance().start(mainWindow || undefined);` into `app.on("ready")`.
   - Lines 860-863: Added `EngineSupervisor.getInstance().stop()` in `app.on("before-quit")` to gracefully terminate child process and prevent spurious restart loops during shutdown.
   - Preserved all required test assertion patterns verbatim:
     - `main.ts` `errorDialog` non-blocking handler and suppression (`lines 500-527`).
     - `auto_restore_last_directory`, `last_directory`, `createFromFile` (`lines 750-760`).
     - Zero BigQuery remnants (`!mainSrc.includes("reltab-bigquery")`).

3. **Renderer Event Handling (`tad-master/packages/toad-app/src/electronRenderMain.tsx`)**:
   - Lines 276-287: Registered `ipcRenderer.on("engine:restored", async (event, details) => { ... })` forwarding to `rtc.setDataPort` and window event.
   - Preserved exact test constraint string required by `tests/deep_integration_qa.js`:
     ```typescript
     window.addEventListener("unhandledrejection", (e) => {
       console.error(
         "[UNCAUGHT-PROMISE-REJECTION]",
         e.reason?.message || String(e.reason),
         e.reason?.stack
       );
     });
     ```

4. **UI Notification & Active View Refresh (`tad-master/packages/toadviewer/src/components/AppPane.tsx`)**:
   - Lines 22-38: Imported `Position`, `Toaster`, `Intent` from `@blueprintjs/core` and defined singleton `getAppToaster()`.
   - Lines 513-562: Implemented `useEffect` hook listening to `bridge.onEngineRestored` and window event `engine:restored`:
     - Displays BlueprintJS v4 non-blocking toast:
       ```typescript
       toaster.show({
         message: "Động cơ phân tích vừa được tự động phục hồi",
         intent: Intent.SUCCESS,
         icon: "refresh",
         timeout: 4000,
       });
       ```
     - Automatically re-queries active tabular view:
       ```typescript
       await actions.reopenCurrentView(stateRef);
       ```
   - Preserved center error pane assertions for `activeLoading.error` and `<Icon icon="error" iconSize={40} intent="danger" />`.

5. **Compilation Outputs**:
   - Command: `.\node-v18.20.4-win-x64\node.exe tad-master/node_modules/typescript/bin/tsc -p tad-master/packages/toadviewer/tsconfig.json --noEmit`
     Result: Exit code 0, 0 errors.
   - Command: `.\node-v18.20.4-win-x64\node.exe tad-master/node_modules/typescript/bin/tsc -p tad-master/packages/toad-app/tsconfig.json --module CommonJS --outDir tad-master/packages/toad-app/dist`
     Result: Exit code 0, 0 errors.

6. **Automated Verification Test Output (`tests/test_engine_crash_recovery.js`)**:
   - Command: `.\node-v18.20.4-win-x64\node.exe tests/test_engine_crash_recovery.js`
   - Verbatim Output:
     ```
     ======================================================================
        MILESTONE 3: ENGINE SUPERVISOR & CRASH RESILIENCE TEST SUITE      
     ======================================================================
     [1/7] Verifying EngineSupervisor exports and singleton contract...
       ✔ EngineSupervisor instance and methods verified.
     [2/7] Preparing test dataset and registering in ToadParquetLedger...
       ✔ Parquet file created and registered in ledger (3 rows, size: 567 bytes).
     [3/7] Benchmarking replayLedgerViews() restoration latency...
       ✔ replayLedgerViews restored 1 views in 2.72 ms (avg 2.72 ms/view, SLA < 5ms)
       ✔ Query on restored view 'customers_m3' successfully returned 3 rows.
     [4/7] Starting EngineSupervisor in utility mode...
     [EngineSupervisor] Mode: 'utility' - spawning dedicated engine utilityProcess.
     [EngineSupervisor] Spawning engine service from: D:\Shared_UserData\Downloads\tad\tad-master\packages\toad-app\dist\app\engineService.js
     [EngineSupervisor] Engine child spawned successfully (PID: 16252)
       ✔ Supervisor status: {"state":"running","engineMode":"utility","pid":16252,"uptime":0,"restartCount":0,"activeWindowsCount":0}
     [5/7] Simulating engine crash (SIGKILL on PID 16252)...
     [EngineSupervisor] killChildForTest: Sending SIGKILL to PID 16252
     [EngineSupervisor] Child engine exited (PID: 16252, code: null, signal: SIGKILL)
       ✔ Crash detected by supervisor: code=null, signal=SIGKILL
     [EngineSupervisor] Auto-recovery initiated (attempt #1, reason: signal-SIGKILL)...
     [EngineSupervisor] Engine child spawned successfully (PID: 16172)
     [EngineSupervisor] Auto-recovery complete in 262.94 ms. Restored 1 views.
       ✔ 'engine:restored' received in 271.99 ms!
         Event Payload: {"timestamp":1793726567283,"restoredViewsCount":1,"elapsedMs":262.93830013275146,"pid":16172}
       ✔ Engine successfully auto-restarted with new PID 16172 (restartCount: 1).
     [6/7] Verifying Renderer & AppPane integration contracts...
       ✔ electronRenderMain.tsx: IPC listener and uncaught rejection assertions verified.
       ✔ AppPane.tsx: BlueprintJS Toast contract and active view refresh verified.
     [7/7] Verifying dual-mode legacy engine fallback...
     [EngineSupervisor] Stopping supervisor...
     [EngineSupervisor] Mode: 'legacy' - initializing DuckDB in-process.
       ✔ Legacy mode status: {"state":"legacy","engineMode":"legacy","pid":null,"uptime":0,"restartCount":1,"activeWindowsCount":0}
       ✔ Dual-mode fallback gracefully initializes in-process without child process.
     ======================================================================
        ALL MILESTONE 3 ENGINE SUPERVISOR CHECKS PASSED (100%)             
     ======================================================================
     ```

7. **Regression Test Suites Execution**:
   - `tests/smoke_test.js`: PASS 100% (PE Header MZ valid, app.asar valid, zero BigQuery remnants, bootstrap clean).
   - `tests/legacy_use_cases.js`: PASS 19/19 (100%).
   - `tests/test_preload_3_pages.js`: PASS 10/10 (100%).
   - `tests/deep_integration_qa.js`: NN.4 non-blocking error handling & modal suppression PASS (100%).

---

## 2. Logic Chain

1. From Observation 1, `EngineSupervisor` encapsulates `utilityProcess` spawning, crash auto-restart, flap protection, MessagePort plumbing, and state restoration into a unified singleton in the Electron Main process.
2. From Observation 2, `main.ts` starts `EngineSupervisor` with `mainWindow` in `app.on("ready")` and stops child processes in `app.on("before-quit")`, ensuring continuous supervision during runtime and zero hanging zombie processes upon quit.
3. From Observation 3 & 4, `electronRenderMain.tsx` and `AppPane.tsx` reactively consume `engine:restored`: `AppPane.tsx` displays the BlueprintJS toast `"Động cơ phân tích vừa được tự động phục hồi"` (`position: Position.BOTTOM_RIGHT`, `intent: Intent.SUCCESS`, `icon: "refresh"`, `timeout: 4000`) and calls `actions.reopenCurrentView(stateRef)` to refresh the active tabular view seamlessly.
4. From Observation 5 & 6, `test_engine_crash_recovery.js` demonstrated that killing the engine process via SIGKILL triggers instant auto-restart in **271.99 ms** (well within SLA < 500ms), replaying ledger views in **2.72 ms/view** (well within SLA < 5ms), assigning a new PID, and successfully restoring querying capability.
5. From Observation 7, all regression test suites continue to pass 100% with zero regressions on existing code.

---

## 3. Caveats

1. In pure headless Node.js CLI testing where `electron.utilityProcess` is not injected by Chromium, `EngineSupervisor` automatically uses `child_process.fork` with an identical IPC protocol, enabling 100% test automation without requiring an active graphical display.
2. Webpack packaging of `dist/engineService.bundle.js` and ASAR native addon verification belong to Milestone 4. Milestone 3 provides the complete runtime supervisor, crash resilience logic, and frontend self-healing UI toast.

---

## 4. Conclusion

Milestone 3 is complete. The Engine Supervisor (`engineSupervisor.ts`), startup and shutdown hooks in `main.ts`, renderer IPC listener in `electronRenderMain.tsx`, BlueprintJS self-healing toast and active view reconciliation in `AppPane.tsx`, and dedicated crash recovery test suite (`tests/test_engine_crash_recovery.js` / `tests/verify_crash_recovery.js`) have all been implemented, compiled, and verified. 100% of all Milestone 3 verification checks and regression test suites pass without error. Ready for Milestone 4 (Packaging & Webpack Bundling) and Milestone 5 (Comprehensive Verification).

---

## 5. Verification Method

1. Recompile packages:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe tad-master/node_modules/typescript/bin/tsc -p tad-master/packages/toadviewer/tsconfig.json --noEmit
   .\node-v18.20.4-win-x64\node.exe tad-master/node_modules/typescript/bin/tsc -p tad-master/packages/toad-app/tsconfig.json --module CommonJS --outDir tad-master/packages/toad-app/dist
   ```
   *Expected outcome*: Exit code 0, 0 errors.

2. Run Milestone 3 crash recovery verification script:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe tests/test_engine_crash_recovery.js
   ```
   *Expected outcome*: 7/7 checks PASS (100%), auto-restart latency < 500ms (measured ~270ms), view replay < 5ms (measured ~2.7ms), exit code 0.

3. Run regression test suites:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe tests/smoke_test.js
   .\node-v18.20.4-win-x64\node.exe tests/legacy_use_cases.js
   .\node-v18.20.4-win-x64\node.exe tests/test_preload_3_pages.js
   ```
   *Expected outcome*: 100% PASS across all suites, exit code 0.
