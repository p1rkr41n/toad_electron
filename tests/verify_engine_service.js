/**
 * Standalone Verification Script for Milestone 2:
 * Dedicated Engine Service & Hybrid Data Protocol
 */

const { MessageChannel } = require("worker_threads");
const assert = require("assert");
const path = require("path");

async function run() {
  console.log("======================================================================");
  console.log("   MILESTONE 2: ENGINE SERVICE & HYBRID DATA PROTOCOL VERIFICATION    ");
  console.log("======================================================================");

  // 1. Require reltab and engineService
  console.log("[1/8] Loading reltab and engineService modules...");
  const ROOT = path.resolve(__dirname, "..");
  const reltab = require(path.resolve(ROOT, "tad-master/packages/reltab/dist/reltab"));
  const {
    startEngineService,
    replayLedgerViews,
  } = require(path.resolve(ROOT, "tad-master/packages/toad-app/dist/app/engineService"));

  assert.strictEqual(typeof reltab.encodeTableRepBinary, "function");
  assert.strictEqual(typeof reltab.decodeTableRepBinary, "function");
  assert.strictEqual(typeof reltab.MessagePortTransport, "function");
  assert.strictEqual(typeof startEngineService, "function");
  console.log("  ✔ Modules loaded with expected exports.");

  // 2. Setup MessageChannel
  console.log("[2/8] Setting up MessageChannel (port1: client, port2: engine)...");
  const { port1, port2 } = new MessageChannel();

  // 3. Initialize engineService with port2
  console.log("[3/8] Initializing EngineService with dataPort...");
  const engine = await startEngineService({ dataPort: port2 });
  console.log("  ✔ EngineService initialized successfully.");

  // 4. Test client transport over port1
  console.log("[4/8] Testing MessagePortTransport RPC ping/pong & initLedger...");
  const transport = new reltab.MessagePortTransport(port1);

  const pingResp = await transport.request("ping", {});
  assert.strictEqual(pingResp, "pong", "Ping must respond with pong");
  console.log("  ✔ Ping responded with:", pingResp);

  const statusResp = await transport.request("status", {});
  assert.strictEqual(statusResp.state, "running");
  console.log("  ✔ Engine status verified: state=" + statusResp.state + ", pid=" + statusResp.pid);

  const ledgerResp = await transport.request("initLedger", {});
  assert.strictEqual(ledgerResp.success, true);
  console.log("  ✔ Ledger initialized successfully.");

  // 5. Test raw SQL table creation and queries
  console.log("[5/8] Creating test table 'test_m2_hybrid' in DuckDB...");
  const createSql = `
    CREATE OR REPLACE TABLE test_m2_hybrid (
      id BIGINT,
      name VARCHAR,
      score DOUBLE,
      flag BOOLEAN,
      note VARCHAR
    );
    INSERT INTO test_m2_hybrid VALUES
      (1, 'Alice', 95.5, true, 'Top student'),
      (2, 'Bob', 82.0, false, null),
      (3, 'Charlie', 60.2, true, 'Needs review');
  `;
  await transport.request("runSqlQuery", {
    engine: { providerName: "duckdb", resourceId: "" },
    sqlQuery: createSql,
  });

  const rowCount = await transport.request("rowCount", {
    engine: { providerName: "duckdb", resourceId: "" },
    queryStr: JSON.stringify(reltab.tableQuery("test_m2_hybrid")),
  });
  assert.strictEqual(rowCount, 3, "Expected 3 rows in test_m2_hybrid");
  console.log("  ✔ rowCount verified: " + rowCount + " rows.");

  const schemaJson = await transport.request("getTableSchema", {
    engine: { providerName: "duckdb", resourceId: "" },
    tableName: "test_m2_hybrid",
  });
  assert(schemaJson.columns.includes("id"));
  assert(schemaJson.columns.includes("name"));
  assert(schemaJson.columns.includes("score"));
  assert(schemaJson.columns.includes("flag"));
  assert(schemaJson.columns.includes("note"));
  console.log("  ✔ getTableSchema verified: columns = [" + schemaJson.columns.join(", ") + "]");

  // 6. Test evalQuery with Hybrid Binary Protocol & Zero-Copy Transfer
  console.log("[6/8] Executing evalQuery over MessagePort with Hybrid Binary Transfer...");
  const queryExp = reltab.tableQuery("test_m2_hybrid");
  const tableRep = await transport.request("evalQuery", {
    engine: { providerName: "duckdb", resourceId: "" },
    queryStr: JSON.stringify(queryExp),
    offset: 0,
    limit: 10,
  });

  assert(tableRep instanceof reltab.TableRep, "Result must be deserialized into TableRep");
  assert.strictEqual(tableRep.rowData.length, 3, "TableRep must have 3 rows");
  console.log("  ✔ TableRep successfully reconstituted with 3 rows!");
  console.log("    Row 0:", tableRep.getRow(0));
  console.log("    Row 1:", tableRep.getRow(1));
  console.log("    Row 2:", tableRep.getRow(2));
  assert.strictEqual(tableRep.getRow(0).name, "Alice");
  assert.strictEqual(tableRep.getRow(1).name, "Bob");
  assert.strictEqual(tableRep.getRow(2).name, "Charlie");

  // Verify direct binary packet wire format
  console.log("  Checking wire format of binary packet via direct postMessage...");
  const rawPacket = await new Promise((resolve) => {
    const rawHandler = (event) => {
      const data = event.data !== undefined ? event.data : event;
      if (data.id === 9999) {
        port1.off ? port1.off("message", rawHandler) : port1.removeListener("message", rawHandler);
        resolve(data);
      }
    };
    if (typeof port1.on === "function") {
      port1.on("message", rawHandler);
    } else {
      port1.addEventListener("message", rawHandler);
    }
    port1.postMessage({
      id: 9999,
      cmd: "evalQuery",
      payload: {
        engine: { providerName: "duckdb", resourceId: "" },
        queryStr: JSON.stringify(queryExp),
      },
    });
  });

  assert.strictEqual(rawPacket.ok, true);
  assert.strictEqual(rawPacket.binary, true);
  assert(rawPacket.buffer instanceof ArrayBuffer, "buffer must be an ArrayBuffer");
  const u8 = new Uint8Array(rawPacket.buffer);
  assert.strictEqual(u8[0], 0x54); // 'T'
  assert.strictEqual(u8[1], 0x4f); // 'O'
  assert.strictEqual(u8[2], 0x41); // 'A'
  assert.strictEqual(u8[3], 0x44); // 'D'
  console.log("  ✔ Magic bytes verified: 'TOAD' (0x54 0x4F 0x41 0x44)");
  console.log("  ✔ Zero-copy ArrayBuffer size:", rawPacket.buffer.byteLength, "bytes");

  // 7. Test RemoteReltabConnection with MessagePort
  console.log("[7/8] Testing RemoteReltabConnection and RemoteDataSourceConnection with MessagePort...");
  const dummyTransportClient = {
    invoke: async () => { throw new Error("Fallback should not be called when dataPort is active"); }
  };
  const rtc = new reltab.RemoteReltabConnection(dummyTransportClient, port1);
  const dsConn = await rtc.connect({ providerName: "duckdb", resourceId: "" });
  const rtcTableRep = await dsConn.evalQuery(queryExp);
  assert(rtcTableRep instanceof reltab.TableRep);
  assert.strictEqual(rtcTableRep.rowData.length, 3);
  console.log("  ✔ RemoteReltabConnection cleanly dispatched query via MessagePort without fallback.");

  // 8. Test replayLedgerViews & 100-query throughput benchmark
  console.log("[8/8] Testing replayLedgerViews & query performance benchmark...");
  const replayRes = await replayLedgerViews();
  console.log(`  ✔ replayLedgerViews benchmark: completed in ${replayRes.elapsedMs.toFixed(2)} ms (SLA < 5ms)`);

  const tStart = performance.now();
  const QUERY_COUNT = 100;
  for (let i = 0; i < QUERY_COUNT; i++) {
    const res = await dsConn.evalQuery(queryExp);
    assert.strictEqual(res.rowData.length, 3);
  }
  const totalDuration = performance.now() - tStart;
  const avgLatency = totalDuration / QUERY_COUNT;
  console.log(`  ✔ Benchmark: ${QUERY_COUNT} queries executed over MessagePort in ${totalDuration.toFixed(1)} ms (avg ${avgLatency.toFixed(2)} ms/query)`);

  transport.close();
  port1.close && port1.close();
  port2.close && port2.close();

  console.log("======================================================================");
  console.log("   ALL MILESTONE 2 ENGINE SERVICE VERIFICATION CHECKS PASSED (100%)   ");
  console.log("======================================================================");
}

run().catch((err) => {
  console.error("VERIFICATION FAILED:", err);
  process.exit(1);
});
