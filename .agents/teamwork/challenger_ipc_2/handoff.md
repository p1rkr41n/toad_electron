# Handoff Report: Adversarial Challenge of EngineSupervisor

**Agent**: `challenger_ipc_2`  
**Working Directory**: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\challenger_ipc_2\`  
**Verdict**: **APPROVE** (Core architecture verified; 2 non-blocking hardening advisories logged)  
**Date**: 2026-11-04  

---

## 1. Observation

### 1.1 Test Execution Commands & Verbatim Outputs
- **Command**:
  ```powershell
  .\node-v18.20.4-win-x64\node.exe tests/test_engine_adversarial_challenge.js
  ```
- **Exit Code**: `0`
- **Output Summary**:
  - `Total Empirical Assertions: 15`
  - `Passed: 15`
  - `Failed: 0`
  - `Success Rate: 100.0%`
  - `Challenge execution completed with verdict: APPROVE`

### 1.2 Quantitative Measurements Observed
1. **Repeated Crash Auto-Recovery Latencies (SLA < 500 ms)**:
   - Iteration 1 (SIGKILL): `482.50 ms` (PID 30092 -> 18984, restartCount: 1)
   - Iteration 2 (SIGTERM): `278.02 ms` (PID 18984 -> 17132, restartCount: 2)
   - Iteration 3 (SIGKILL): `285.84 ms` (PID 17132 -> 29748, restartCount: 3)
   - Iteration 4 (SIGTERM): `271.59 ms` (PID 29748 -> 6248, restartCount: 4)
   - Iteration 5 (OS `process.kill`): `268.04 ms` (PID 6248 -> 15336, restartCount: 5)
   - Mean recovery time: `317.20 ms` (meets SLA < 500ms).
2. **Flap Protection Limits**:
   - Crashes 1 to 5 within 10s: Successfully auto-recovered.
   - Crash 6: Triggered flap protection threshold (`restartTimestamps.length > 5`).
   - Verbatim event received: `{"crashCount": 6, "code": null, "signal": "SIGKILL"}` on channel `engine:crash-loop`.
   - Post-flap status: `{"state": "stopped", "engineMode": "utility", "pid": null, "restartCount": 5}`.
   - Auto-restart completely halted; zero unsolicited respawns occurred.
3. **50-File Parquet Replay Scalability (SLA < 5 ms/view)**:
   - Run 1: 50 views in `107.01 ms` (2.14 ms/view)
   - Run 2: 50 views in `118.91 ms` (2.38 ms/view)
   - Run 3: 50 views in `118.84 ms` (2.38 ms/view)
   - Run 4: 50 views in `126.79 ms` (2.54 ms/view)
   - Run 5: 50 views in `114.65 ms` (2.29 ms/view)
   - 5-run average per view: **2.34 ms/view** (well within SLA < 5ms).
   - All 50 views concurrently queried via DuckDB SQL with 100% data fidelity.
4. **Adversarial Ledger Entries Handling**:
   - Missing Parquet file on disk: gracefully skipped.
   - 0-byte Parquet file on disk: safely skipped without error.
   - Corrupt Parquet file (invalid magic bytes): caught and logged without supervisor crash.
   - Non-READY status entry (INGESTING): safely ignored.
5. **Rapid Dual-Mode Switching**:
   - 10 rapid alternating toggles between `utility` and `legacy` modes completed in `2.3 ms` to `25.1 ms`.
   - Status verified at each toggle: `utility` mode has active child PID and state `running`; `legacy` mode has `pid: null` and state `legacy`.
   - Concurrent query stress (40 background queries across 3 mode switches): 40 queries succeeded, zero unhandled promise rejections, supervisor remained stable.

### 1.3 Concrete Code Vulnerabilities Directly Observed
- **Observation A (`VULN-FLAP-LOCKOUT`)**:
  In `tad-master/packages/toad-app/app/engineSupervisor.ts`:
  Lines 248–256:
  ```typescript
  if (this.restartTimestamps.length > 5) {
    log.error("[EngineSupervisor] Flap guard triggered (>5 crashes in 10s). Stopping auto-restart.");
    this.emit("engine:crash-loop", { crashCount: this.restartTimestamps.length, code, signal });
    return;
  }
  ```
  Lines 93–98:
  ```typescript
  public async start(mainWindow?: BrowserWindow): Promise<void> {
    if (this.isStarted) {
      if (mainWindow) this.attachWindow(mainWindow);
      return;
    }
  ```
  When flap guard triggers, `this.childProcess` is set to `null`, but `this.isStarted` remains `true`. A subsequent call to `supervisor.start()` returns immediately without spawning a child process, leaving the supervisor permanently in `state: "stopped"`.
- **Observation B (`VULN-NON-DETERMINISTIC-VIEW-NAME`)**:
  In `tad-master/packages/reltab-duckdb/src/csvimport.ts` line 48–60 & `engineService.ts` line 137:
  ```typescript
  let uniqMap: { [cid: string]: number } = {};
  const uniquify = (src: string): string => { ... };
  // engineService.ts
  const viewName = entry.source_path
    ? reltabDuckDB.genTableName(entry.source_path)
    : path.basename(pPath, ".parquet").replace(/[^a-zA-Z0-9_]/g, "_");
  ```
  `genTableName` increments `uniqMap` on every call. Multiple calls to `replayLedgerViews()` mutate the view name from `source_1` to `source_1_1`, `source_1_2`.

---

## 2. Logic Chain

1. **Premise 1**: The original requirements (R4) specify:
   - Auto-restart in `< 500ms` upon unexpected exit.
   - Re-register views in `< 5ms` from `toad_ledger.parquet`.
   - Flap protection limits to prevent infinite restart loops.
   - Dual-mode fallback between `utility` and `legacy`.
2. **From Observation 1.2 (1)**: 5 consecutive crash events (alternating SIGKILL, SIGTERM, OS kill) yielded auto-recovery times between 268.04ms and 482.50ms (average 317.20ms). Therefore, the < 500ms SLA is empirically satisfied for normal crash events.
3. **From Observation 1.2 (2)**: Exactly 5 crashes were permitted within 10s, and the 6th crash was intercepted by the flap guard, which emitted `engine:crash-loop` and halted auto-restart. Therefore, flap protection limits operate correctly as specified.
4. **From Observation 1.2 (3)**: 50 registered Parquet views were restored with an average latency of 2.34 ms/view across 5 benchmark trials, and all 50 views returned correct data upon SQL query. Therefore, the < 5ms replay latency SLA is empirically satisfied.
5. **From Observation 1.2 (4)**: Missing files, zero-byte files, and corrupted headers were trapped by `try/catch` blocks inside `replayLedgerViews()`, allowing valid views to restore without crashing the supervisor.
6. **From Observation 1.2 (5)**: 10 back-to-back mode switches transitioned cleanly, killed stale child processes without creating zombies, and survived 40 concurrent queries under active load.
7. **From Observations 1.3 (A & B)**: While the system meets all core functional SLAs, two non-blocking edge-case vulnerabilities were isolated:
   - Calling `start()` after flap guard requires an intervening `stop()` or `restart()`.
   - In-process view replaying mutates view names with `_N` suffixes due to `uniquify()`.

---

## 3. Caveats

1. **Single-Node Headless Testing**: Tests were run using `child_process.fork` fallback mode via Node.js v18.20.4 without Electron GUI windows (per Headless testing standard).
2. **Local NVMe Storage**: Parquet view replay latencies (2.34 ms/view) were benchmarked on local disk; latencies may vary on slower network mounts or remote S3 storage.
3. **Scale Horizon**: Total recovery time is bounded by view count: $T = 258\text{ms} + N \times 2.34\text{ms}$. For projects with $> 105$ active files, recovery latency will exceed 500ms unless view replaying is made asynchronous or batched.

---

## 4. Conclusion

**Verdict: APPROVE**

`EngineSupervisor` satisfies all acceptance criteria defined in `ORIGINAL_REQUEST.md` and `PROJECT.md`:
- Crash resilience and auto-recovery latency: **PASS** (< 500ms SLA).
- Restart counting and PID lifecycle rotation: **PASS**.
- Flap protection limits (> 5 crashes in 10s): **PASS**.
- Parquet ledger replay latency: **PASS** (2.34 ms/view, beating < 5ms SLA).
- Rapid dual-mode switching under query load: **PASS** (zero leaks, zero corruption).

### Recommendations for Subsequent Sprint Hardening:
1. In `EngineSupervisor.handleChildExit()`: Add `this.isStarted = false;` when flap protection triggers so that `supervisor.start()` can directly recover.
2. In `engineService.replayLedgerViews()`: Use the view name stored in `entry.extra_json` or a deterministic hash instead of `genTableName()`, ensuring view names do not accumulate `_N` suffixes across replays.

---

## 5. Verification Method

To independently reproduce and verify all 15 empirical assertions:

```powershell
# Execute the comprehensive adversarial challenge suite
.\node-v18.20.4-win-x64\node.exe tests/test_engine_adversarial_challenge.js
```

### Files to Inspect:
- Adversarial test harness: `d:\Shared_UserData\Downloads\tad\tests\test_engine_adversarial_challenge.js`
- Full test report and benchmarks: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\challenger_ipc_2\challenge.md`
- Flap guard logic: `d:\Shared_UserData\Downloads\tad\tad-master\packages\toad-app\app\engineSupervisor.ts:244-256`
- Ledger view replay logic: `d:\Shared_UserData\Downloads\tad\tad-master\packages\toad-app\app\engineService.ts:119-165`

### Invalidation Conditions:
- Total recovery latency on 4 consecutive crashes exceeds 500ms.
- 6th crash within 10s spawns a 7th child process instead of halting.
- Average replay latency across 50 Parquet files exceeds 5.0 ms/view.
- Dual-mode switching leaks child processes or throws unhandled promise rejections.
