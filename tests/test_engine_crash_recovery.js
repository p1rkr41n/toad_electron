/**
 * Milestone 3: Crash Recovery & Engine Supervisor Verification Test Suite
 *
 * Verifies:
 * 1. EngineSupervisor singleton initialization & lifecycle management.
 * 2. Dedicated Engine Service spawn & MessagePort pairing.
 * 3. Parquet Ledger state persistence & replay SLA (< 5ms).
 * 4. Crash detection on SIGKILL / unhandled exit and auto-restart in < 500ms.
 * 5. State restoration from toad_ledger.parquet upon restart.
 * 6. "engine:restored" notification delivery.
 * 7. UI Integration in AppPane.tsx (BlueprintJS Toast & active view reload).
 * 8. Dual-mode fallback (legacy vs utility).
 */

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { MessageChannel } = require("worker_threads");

const ROOT = path.resolve(__dirname, "..");
const reltab = require(path.resolve(ROOT, "tad-master/packages/reltab/dist/reltab"));
const reltabDuckDB = require(path.resolve(ROOT, "tad-master/packages/reltab-duckdb/dist/reltab-duckdb"));
const { EngineSupervisor } = require(path.resolve(ROOT, "tad-master/packages/toad-app/dist/app/engineSupervisor"));
const { replayLedgerViews } = require(path.resolve(ROOT, "tad-master/packages/toad-app/dist/app/engineService"));

async function run() {
  console.log("======================================================================");
  console.log("   MILESTONE 3: ENGINE SUPERVISOR & CRASH RESILIENCE TEST SUITE      ");
  console.log("======================================================================");

  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toad_m3_test_"));
  process.env.TOAD_TEMP_DIR = testTempDir;
  reltabDuckDB.ToadParquetLedger.resetInstance();
  const testLedgerPath = path.join(testTempDir, "toad_ledger.parquet");
  const testParquetPath = path.join(testTempDir, "customers_m3.parquet");

  try {
    // ------------------------------------------------------------------
    // TEST 1: Supervisor Module & Singleton Interface
    // ------------------------------------------------------------------
    console.log("[1/7] Verifying EngineSupervisor exports and singleton contract...");
    const supervisor = EngineSupervisor.getInstance();
    assert(supervisor, "EngineSupervisor singleton must be instantiated");
    assert.strictEqual(typeof supervisor.start, "function");
    assert.strictEqual(typeof supervisor.stop, "function");
    assert.strictEqual(typeof supervisor.restart, "function");
    assert.strictEqual(typeof supervisor.autoRecover, "function");
    assert.strictEqual(typeof supervisor.attachWindow, "function");
    assert.strictEqual(typeof supervisor.getStatus, "function");
    console.log("  ✔ EngineSupervisor instance and methods verified.");

    // ------------------------------------------------------------------
    // TEST 2: Prepare Parquet Dataset & ToadParquetLedger WAL Entry
    // ------------------------------------------------------------------
    console.log("[2/7] Preparing test dataset and registering in ToadParquetLedger...");
    await reltabDuckDB.initToadLedger();
    const ledger = reltabDuckDB.ToadParquetLedger.getInstance();
    await ledger.initLedger();

    // Create a real Parquet file with test rows using DuckDB
    const db = await reltab.getConnection({ providerName: "duckdb", resourceId: "" });
    const createTableSql = `
      CREATE OR REPLACE TABLE test_customers (
        cust_id INTEGER,
        cust_name VARCHAR,
        balance DOUBLE,
        is_active BOOLEAN
      );
      INSERT INTO test_customers VALUES
        (101, 'Nguyen Van A', 1500000.0, true),
        (102, 'Tran Thi B', 2850000.5, true),
        (103, 'Le Van C', 420000.0, false);
      COPY test_customers TO '${testParquetPath.replace(/\\/g, "/")}' (FORMAT PARQUET);
    `;
    await db.runSqlQuery(createTableSql);
    assert(fs.existsSync(testParquetPath), "Test Parquet file must exist on disk");
    const parquetSize = fs.statSync(testParquetPath).size;
    assert(parquetSize > 0, "Test Parquet file must not be empty");

    // Register active entry in ledger
    const sourcePath = path.join(testTempDir, "customers_m3.csv");
    await ledger.recordEvent({
      event_id: `evt-${Date.now()}`,
      event_type: "INGEST_READY",
      timestamp: Date.now(),
      project_id: "prj_m3_test",
      project_name: "M3 Project",
      source_path: sourcePath,
      source_size: 1024,
      source_mtime: Date.now(),
      parquet_path: testParquetPath,
      parquet_size: parquetSize,
      row_count: 3,
      status: "READY",
      duration_ms: 5,
      extra_json: JSON.stringify({ view: "customers_m3" }),
    });
    console.log("  ✔ Parquet file created and registered in ledger (3 rows, size: " + parquetSize + " bytes).");

    // ------------------------------------------------------------------
    // TEST 3: Benchmark replayLedgerViews (< 5ms SLA)
    // ------------------------------------------------------------------
    console.log(`[3/7] Benchmarking replayLedgerViews() restoration latency...`);
    // Warmup
    await replayLedgerViews();
    const tReplayStart = performance.now();
    const replayResult = await replayLedgerViews();
    const replayElapsed = performance.now() - tReplayStart;
    const avgReplayPerView = replayElapsed / Math.max(1, replayResult.count);
    console.log(`  ✔ replayLedgerViews restored ${replayResult.count} views in ${replayElapsed.toFixed(2)} ms (avg ${avgReplayPerView.toFixed(2)} ms/view, SLA < 5ms)`);
    assert(replayResult.count >= 1, "At least 1 view must be restored from ledger");
    assert(avgReplayPerView < 5, `Average replay latency per view (${avgReplayPerView.toFixed(2)}ms) must satisfy SLA < 5ms`);

    // Verify restored view queryable
    const viewName = "customers_m3";
    const viewCount = await db.runSqlQuery(`SELECT COUNT(*) as cnt FROM "${viewName}"`);
    assert.strictEqual(Number(viewCount[0].cnt), 3, "Restored view must return 3 rows");
    console.log(`  ✔ Query on restored view '${viewName}' successfully returned 3 rows.`);

    // ------------------------------------------------------------------
    // TEST 4: EngineSupervisor Process Spawn & Lifecycle Tracking
    // ------------------------------------------------------------------
    console.log("[4/7] Starting EngineSupervisor in utility mode...");
    process.env.TOAD_ENGINE_MODE = "utility";
    await supervisor.start();

    const initialStatus = supervisor.getStatus();
    console.log("  ✔ Supervisor status:", JSON.stringify(initialStatus));
    assert.strictEqual(initialStatus.state, "running", "Supervisor state must be 'running'");
    assert(initialStatus.pid !== null && initialStatus.pid > 0, "Child engine PID must be valid");
    const firstPid = initialStatus.pid;

    // ------------------------------------------------------------------
    // TEST 5: Simulate Engine Crash (SIGKILL) & Verify Auto-Restart < 500ms
    // ------------------------------------------------------------------
    console.log(`[5/7] Simulating engine crash (SIGKILL on PID ${firstPid})...`);

    let crashCaught = false;
    let crashPayload = null;
    supervisor.once("engine:crash", (payload) => {
      crashCaught = true;
      crashPayload = payload;
      console.log(`  ✔ Crash detected by supervisor: code=${payload.code}, signal=${payload.signal}`);
    });

    const restorePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timeout waiting for engine:restored event (exceeded 1500ms)"));
      }, 1500);

      supervisor.once("engine:restored", (event) => {
        clearTimeout(timeout);
        resolve(event);
      });
    });

    const tKill = performance.now();
    // Trigger SIGKILL on child
    supervisor.killChildForTest("SIGKILL");

    const restoredEvent = await restorePromise;
    const totalRecoveryTimeMs = performance.now() - tKill;

    console.log(`  ✔ 'engine:restored' received in ${totalRecoveryTimeMs.toFixed(2)} ms!`);
    console.log("    Event Payload:", JSON.stringify(restoredEvent));

    assert(crashCaught, "Supervisor must catch child process crash");
    assert(
      totalRecoveryTimeMs < 500,
      `Total recovery time (${totalRecoveryTimeMs.toFixed(2)} ms) must satisfy SLA < 500ms`
    );
    assert(restoredEvent.restoredViewsCount >= 1, "Restored event must report at least 1 view");
    assert(restoredEvent.pid !== null, "New engine PID must not be null");
    assert.notStrictEqual(restoredEvent.pid, firstPid, "New engine PID must be different from crashed PID");

    const postCrashStatus = supervisor.getStatus();
    assert.strictEqual(postCrashStatus.state, "running", "Supervisor state must return to 'running'");
    assert.strictEqual(postCrashStatus.restartCount, 1, "Restart count must increment to 1");
    console.log(`  ✔ Engine successfully auto-restarted with new PID ${postCrashStatus.pid} (restartCount: 1).`);

    // ------------------------------------------------------------------
    // TEST 6: Static Analysis & Contract Verification of UI Components
    // ------------------------------------------------------------------
    console.log("[6/7] Verifying Renderer & AppPane integration contracts...");

    // 1. Verify electronRenderMain.tsx
    const renderMainPath = path.resolve(ROOT, "tad-master/packages/toad-app/src/electronRenderMain.tsx");
    const renderMainSrc = fs.readFileSync(renderMainPath, "utf8");
    assert(
      renderMainSrc.includes('ipcRenderer.on("engine:restored"'),
      "electronRenderMain.tsx must listen to engine:restored IPC event"
    );
    assert(
      renderMainSrc.includes('console.error(\n      "[UNCAUGHT-PROMISE-REJECTION]"'),
      "electronRenderMain.tsx must preserve exact UNCAUGHT-PROMISE-REJECTION string"
    );
    assert(
      renderMainSrc.includes('console.error("[UNCAUGHT-WINDOW-ERROR]"'),
      "electronRenderMain.tsx must preserve exact UNCAUGHT-WINDOW-ERROR string"
    );
    console.log("  ✔ electronRenderMain.tsx: IPC listener and uncaught rejection assertions verified.");

    // 2. Verify AppPane.tsx
    const appPanePath = path.resolve(ROOT, "tad-master/packages/toadviewer/src/components/AppPane.tsx");
    const appPaneSrc = fs.readFileSync(appPanePath, "utf8");
    assert(
      appPaneSrc.includes('message: "Động cơ phân tích vừa được tự động phục hồi"'),
      "AppPane.tsx must specify exact toast message: 'Động cơ phân tích vừa được tự động phục hồi'"
    );
    assert(
      appPaneSrc.includes("position: Position.BOTTOM_RIGHT"),
      "AppPane.tsx must specify Toaster position: Position.BOTTOM_RIGHT"
    );
    assert(
      appPaneSrc.includes("intent: Intent.SUCCESS"),
      "AppPane.tsx must specify toast intent: Intent.SUCCESS"
    );
    assert(
      appPaneSrc.includes('icon: "refresh"'),
      "AppPane.tsx must specify toast icon: 'refresh'"
    );
    assert(
      appPaneSrc.includes("timeout: 4000"),
      "AppPane.tsx must specify toast timeout: 4000"
    );
    assert(
      appPaneSrc.includes("actions.reopenCurrentView(stateRef)"),
      "AppPane.tsx must invoke actions.reopenCurrentView(stateRef) upon restoration"
    );
    console.log("  ✔ AppPane.tsx: BlueprintJS Toast contract and active view refresh verified.");

    // ------------------------------------------------------------------
    // TEST 7: Dual-Mode Fallback (Legacy Mode Support)
    // ------------------------------------------------------------------
    console.log("[7/7] Verifying dual-mode legacy engine fallback...");
    await supervisor.stop();

    process.env.TOAD_ENGINE_MODE = "legacy";
    const legacySupervisor = EngineSupervisor.getInstance();
    await legacySupervisor.start();

    const legacyStatus = legacySupervisor.getStatus();
    console.log("  ✔ Legacy mode status:", JSON.stringify(legacyStatus));
    assert.strictEqual(legacyStatus.engineMode, "legacy", "EngineMode must be 'legacy'");
    assert.strictEqual(legacyStatus.state, "legacy", "State must be 'legacy'");
    assert.strictEqual(legacyStatus.pid, null, "Legacy mode must not spawn a child process");
    console.log("  ✔ Dual-mode fallback gracefully initializes in-process without child process.");

    // Cleanup
    await supervisor.stop();
    delete process.env.TOAD_ENGINE_MODE;

    console.log("======================================================================");
    console.log("   ALL MILESTONE 3 ENGINE SUPERVISOR CHECKS PASSED (100%)             ");
    console.log("======================================================================");
  } finally {
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch {}
  }
}

run().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
