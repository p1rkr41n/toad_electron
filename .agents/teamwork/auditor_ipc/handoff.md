# Handoff Report — Forensic Integrity Audit (auditor_ipc)

## 1. Observation

Direct empirical observations gathered during forensic audit:

1. **Dedicated Engine Service & DuckDB Integration**:
   - `tad-master/packages/toad-app/app/engineService.ts` lines 76–93:
     `await reltabDuckDB.initToadLedger();`
     `await reltab.getConnection({ providerName: "duckdb", resourceId: "" });`
     `const ledger = reltabDuckDB.ToadParquetLedger.getInstance();`
     `await this.replayLedgerViews();`
   - Line 418: `return await handleEngineQueryReq(req, port);` connects to `reltab/src/remote/server.ts` line 489 `dispatchEngineCommand(cmd, payload)`, which executes genuine DuckDB queries (`dbConnEvalQuery`, `dbConnRowCount`, `dbConnGetTableSchema`, `dbConnRunSqlQuery`).
   - `tad-master/packages/backend/src/engineService.ts`: Re-exports `toad-app/app/engineService`.

2. **Hybrid Data Protocol & Zero-Copy Binary Transfer**:
   - `tad-master/packages/reltab/src/remote/hybridProtocol.ts`:
     - Line 22: `export const HYBRID_MAGIC_BYTES = [0x54, 0x4f, 0x41, 0x44]; // "TOAD"`
     - Lines 116–125: Magic bytes set at offsets 0..3, version at 4..7, metadata length at 8..11, schema JSON at offset 12, row data at 12+N.
     - Line 218: `port.postMessage(msg, [buffer]);` transfers buffer as Transferable without copying.
     - Lines 145–199: `decodeTableRepBinary` parses the binary buffer back into `TableRep`.

3. **Engine Supervisor & Auto-Recovery**:
   - `tad-master/packages/toad-app/app/engineSupervisor.ts`:
     - Line 148: Spawns `utilityProcess.fork(scriptPath)` with fallback to `cp.fork(scriptPath)`.
     - Lines 185–191: Listens to child `exit` event, calling `handleChildExit(code, signal)`.
     - Lines 280–323: `autoRecover()` measures recovery time via `performance.now()`, respawns child, triggers `replayLedgerViews()`, reconnects MessagePorts, and emits `engine:restored` event.
     - Lines 77–87: `resolveEngineMode()` respects `runtime.engine = "utility" | "legacy"`, correctly falling back to in-process mode.

4. **Headless Node Adapter & UI Integration**:
   - `tad-master/packages/host-bridge/src/HeadlessNodeAdapter.ts` (lines 16–189): Implements `IHostBridge` with `invoke`, dialog mocks, clipboard, and `engine:restored` event listeners, allowing headless test execution without Electron window dependencies.
   - `tad-master/packages/toadviewer/src/components/AppPane.tsx`:
     - Line 525: `message: "Động cơ phân tích vừa được tự động phục hồi"`
     - Line 526: `intent: Intent.SUCCESS`
     - Line 527: `icon: "refresh"`
     - Line 528: `timeout: 4000`
     - Line 536: `await actions.reopenCurrentView(stateRef);`
     - Lines 32–34: `appToaster = Toaster.create({ position: Position.BOTTOM_RIGHT });`

5. **Packaging Gates & Jujutsu VCS**:
   - `tad-master/packages/toad-app/webpack.config.js` lines 139–153: `engine` target is `"node"`, compiling `engineService.bundle.js` with `webpack-node-externals`.
   - `dist_package.ps1` lines 80 & 99: Enforces `app.asar` size <= 45.0 MB and portable exe <= 75.0 MB.
   - `releases/` directory: Top level contains only canonical versioned files (`Toad-2.5.0-x64-portable.exe`, `Toad-2.5.0-x64-portable.zip`) and no duplicate alias binaries.
   - Jujutsu log (`tools/jj/jj.exe log -r "@" -n 1`):
     `@  osxolpnr contact@vncert.vn 2026-11-04 01:00:10 c5b63682 feat: TOAD v2.5.0 IPC architectural migration to Electron utilityProcess`

6. **Empirical Test Suite Execution**:
   - `.\node-v18.20.4-win-x64\node.exe tests/test_engine_service.js`:
     - 1,000 queries completed in 2,164.93 ms (average 2.16 ms/query).
     - Heap growth: +12.00 MB. Zero data corruption. Magic bytes `TOAD` verified. Exit code: 0.
   - `.\node-v18.20.4-win-x64\node.exe tests/test_engine_crash_recovery.js`:
     - `replayLedgerViews` measured at 2.74 ms (SLA < 5ms).
     - SIGKILL crash auto-recovery completed in 265.43 ms (SLA < 500ms).
     - New engine PID 34708 verified. Exit code: 0.
   - `.\node-v18.20.4-win-x64\node.exe run_tests.js --all`:
     - Smoke Test (v2.5.0): PASS
     - Deep Integration QA (222 Tests): PASS (222/222)
     - Preload 3 Pages & Dynamic PageSize (10 Tests): PASS (10/10)
     - Legacy Use Cases (19 Tests): PASS (19/19)
     - Total duration: 29.62s. Exit code: 0.
   - `powershell -ExecutionPolicy Bypass -File fastbuild.ps1 -SkipTsc`:
     - Successfully built `engineService.bundle.js` (12.6 KiB) and packaged `build\Toad-2.5.0\Toad.exe`. Total build time: 76.8 s. Exit code: 0.

---

## 2. Logic Chain

1. From Observation 1, the code does not return dummy values; `engineService.ts` and `server.ts` run genuine SQL statements via DuckDB connections.
2. From Observation 2, `hybridProtocol.ts` sets byte-level framing with magic bytes `TOAD` and transfers `ArrayBuffer` directly over MessagePort transfer lists.
3. From Observation 3, `engineSupervisor.ts` attaches to actual child process exit events, auto-restarts within 265.43 ms (< 500ms SLA), and replays views from Parquet in 2.74 ms (< 5ms SLA).
4. From Observation 4, `HeadlessNodeAdapter.ts` fulfills the host bridge contract enabling CLI test runners to operate headless, and `AppPane.tsx` displays the exact required recovery toast text and triggers view reload.
5. From Observation 5, packaging scripts assert hard size limits (< 45MB asar, < 75MB exe), releases follow zero-duplicate policies, and VCS working copy commit is clean.
6. From Observation 6, all 4 unified test suites (251 tests) plus dedicated headless 1,000-query benchmark and crash resilience tests pass 100% without failures.
7. Therefore, the implementation is fully authentic, meets all functional criteria, and exhibits zero prohibited cheating patterns.

---

## 3. Caveats

No caveats. All checklist items were directly inspected in source files and verified through dynamic execution of automated tests and packaging builds.

---

## 4. Conclusion

**Verdict: CLEAN**

The Out-of-Process Analytics Engine migration (v2.5.0) has passed all forensic integrity checks. There are no hardcoded responses, no dummy facades, no fabricated verification files, and no VCS or packaging violations. The work product is fully accepted.

---

## 5. Verification Method

To independently reproduce the audit findings:

1. **Verify 1,000 Headless Engine Queries & Hybrid Protocol**:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe tests/test_engine_service.js
   ```
   *Expected*: 1,000 queries pass, magic bytes `'TOAD'` verified, average latency < 20ms, heap delta < 150MB, exit code 0.

2. **Verify Crash Supervision & SLA Auto-Recovery**:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe tests/test_engine_crash_recovery.js
   ```
   *Expected*: SIGKILL detected, auto-restart < 500ms, Parquet view replay < 5ms, exit code 0.

3. **Verify Unified Test Runner (All 4 Suites)**:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe run_tests.js --all
   ```
   *Expected*: All 4 test suites pass 100% (Smoke, Deep QA 222 tests, Preload 3 Pages 10 tests, Legacy Use Cases 19 tests), exit code 0.

4. **Verify FastBuild & Bundle Generation**:
   ```powershell
   powershell -ExecutionPolicy Bypass -File fastbuild.ps1 -SkipTsc
   ```
   *Expected*: `engineService.bundle.js` generated in `dist/`, `build\Toad-2.5.0\Toad.exe` generated cleanly, exit code 0.

5. **Verify Clean JJ Commit**:
   ```powershell
   .\tools\jj\jj.exe log -r "@" -n 1
   ```
