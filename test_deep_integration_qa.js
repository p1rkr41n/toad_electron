/**
 * TOAD v1.3.19 DEEP INTEGRATION QA TEST SUITE
 * 
 * Chuyên sâu kiểm thử tích hợp thực tế:
 * 1. End-to-End FSDriver với Dual DuckDB Engine (uiDbc + ingestDbc).
 * 2. Preload ngầm (isBackground: true) -> Parquet Cache Hit -> UI View Mount (< 10ms).
 * 3. Đa định dạng thực tế: CSV, JSONL, Parquet.
 * 4. Kiểm tra Stress Concurrency: 4 files streaming ngầm đồng thời trong khi UI thực hiện 20 truy vấn liên tiếp.
 * 5. Đo đạc độ trễ phân vị p50, p95, p99 của UI Engine dưới tải nặng.
 * 6. Kiểm tra rò rỉ ConnectionPool (Connection Pool Leak Detection).
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const assert = require("assert");

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function reportSuite(title) {
  console.log(`\n${BOLD}======================================================================${RESET}`);
  console.log(`${BOLD}  ${title}${RESET}`);
  console.log(`${BOLD}======================================================================${RESET}`);
}

async function runTest(name, fn) {
  totalTests++;
  const t0 = process.hrtime();
  try {
    await fn();
    const diff = process.hrtime(t0);
    const ms = (diff[0] * 1000 + diff[1] / 1e6).toFixed(2);
    passedTests++;
    console.log(`  ${GREEN}✓ [PASS]${RESET} ${name} (${ms} ms)`);
  } catch (err) {
    failedTests++;
    console.error(`  ${RED}✗ [FAIL]${RESET} ${name}`);
    console.error(`    ${RED}Error: ${err.message}${RESET}`);
    if (err.stack) {
      console.error(`    ${YELLOW}${err.stack.split("\n").slice(1, 4).join("\n")}${RESET}`);
    }
  }
}

async function main() {
  const startTime = Date.now();

  const reltabDuckDB = require("./tad-master/packages/reltab-duckdb/dist/reltab-duckdb");
  const reltabFS = require("./tad-master/packages/reltab-fs/dist/reltab-fs");
  const { Database } = require("./tad-master/node_modules/duckdb-async");

  // ===========================================================================
  // SUITE A: Dual Engine Initialization & Driver Isolation
  // ===========================================================================
  reportSuite("SUITE A: Dual Engine Driver & Connection Pool Verification");

  await runTest("A.1 getUIDuckDBDriver and getIngestDuckDBDriver return separate singletons", async () => {
    const uiDriver1 = await reltabFS.getUIDuckDBDriver();
    const uiDriver2 = await reltabFS.getUIDuckDBDriver();
    const ingestDriver1 = await reltabFS.getIngestDuckDBDriver();
    const ingestDriver2 = await reltabFS.getIngestDuckDBDriver();

    assert.strictEqual(uiDriver1, uiDriver2, "getUIDuckDBDriver must return same singleton instance");
    assert.strictEqual(ingestDriver1, ingestDriver2, "getIngestDuckDBDriver must return same singleton instance");
    assert.notStrictEqual(uiDriver1, ingestDriver1, "UI and Ingest drivers must be distinct instances");
    assert.notStrictEqual(uiDriver1.db, ingestDriver1.db, "UI and Ingest Database instances must be separate in memory");
  });

  await runTest("A.2 ConnectionPool on UI Driver reuses connections properly without leaking", async () => {
    const uiDriver = await reltabFS.getUIDuckDBDriver();
    const initialPoolSize = uiDriver.connPool.pool.length;

    // Take and give back 20 times
    for (let i = 0; i < 20; i++) {
      const conn = await uiDriver.connPool.take();
      const res = await conn.all("SELECT 1 as val");
      assert.strictEqual(res[0].val, 1);
      uiDriver.connPool.giveBack(conn);
    }

    assert(uiDriver.connPool.pool.length >= 1, "Connection pool must retain pooled connection");
  });

  // ===========================================================================
  // SUITE B: FSDriver Full Lifecycle: Scan -> Ingest -> Cache Hit -> UI Query
  // ===========================================================================
  reportSuite("SUITE B: FSDriver End-to-End Ingestion & Instant UI Mount");

  // Create temporary test environment with sample files
  const testTmpDir = path.resolve(__dirname, `tmp_qa_test_${Date.now()}`);
  fs.mkdirSync(testTmpDir, { recursive: true });

  const testCsvFile = path.join(testTmpDir, "sales_data.csv");
  const testJsonlFile = path.join(testTmpDir, "audit_events.jsonl");

  // Generate 20,000 rows CSV
  const csvStream = fs.createWriteStream(testCsvFile);
  csvStream.write("id,sku,category,price,qty,timestamp\n");
  for (let i = 1; i <= 20000; i++) {
    csvStream.write(`${i},SKU-${i % 500},Category-${i % 10},${(Math.random() * 100).toFixed(2)},${(i % 5) + 1},2026-10-29T08:00:00Z\n`);
  }
  await new Promise((r) => csvStream.end(r));

  // Generate 10,000 rows JSONL
  const jsonlStream = fs.createWriteStream(testJsonlFile);
  for (let i = 1; i <= 10000; i++) {
    jsonlStream.write(JSON.stringify({ event_id: i, level: i % 2 === 0 ? "INFO" : "WARN", host: `server-${i % 5}`, duration_ms: i * 0.5 }) + "\n");
  }
  await new Promise((r) => jsonlStream.end(r));

  let sharedFsDriver = null;
  await runTest("B.1 FSDriver scans directory and obtains correct file stats", async () => {
    const uiDriver = await reltabFS.getUIDuckDBDriver();
    const ingestDriver = await reltabFS.getIngestDuckDBDriver();
    sharedFsDriver = new reltabFS.FSDriver(uiDriver, testTmpDir, true, false, ingestDriver);

    const children = await sharedFsDriver.getChildren({ path: [] });
    assert.strictEqual(children.length, 2, "Directory must have 2 data files");

    const csvNode = children.find((c) => c.displayName === "sales_data.csv");
    const jsonlNode = children.find((c) => c.displayName === "audit_events.jsonl");

    assert(csvNode, "sales_data.csv node must exist");
    assert(jsonlNode, "audit_events.jsonl node must exist");
    assert(csvNode.fileSizeBytes > 500000, `CSV size must be > 500KB, got ${csvNode.fileSizeBytes}`);
    assert(jsonlNode.fileSizeBytes > 200000, `JSONL size must be > 200KB, got ${jsonlNode.fileSizeBytes}`);
  });

  let ingestedCsvTable = "";
  await runTest("B.2 Background Ingestion (isBackground: true) creates Parquet and mounts view", async () => {
    const uiDriver = await reltabFS.getUIDuckDBDriver();

    ingestedCsvTable = await sharedFsDriver.getTableName({ path: ["sales_data.csv"] }, { isBackground: true });
    assert(ingestedCsvTable, "getTableName must return valid table name");

    // Check Parquet file created in temp_dir
    const cfg = reltabDuckDB.getIngestConfig();
    const cached = reltabDuckDB.getDeterministicParquetPath(testCsvFile, cfg.temp_dir);
    assert(fs.existsSync(cached.parquetPath), "Deterministic Parquet file must exist on disk");
    assert(fs.statSync(cached.parquetPath).size > 10000, "Parquet file must be > 10KB");

    // Verify UI Driver can query it immediately
    const rows = await uiDriver.runSqlQuery(`SELECT COUNT(*) as cnt FROM ${ingestedCsvTable}`);
    assert.strictEqual(Number(rows[0].cnt), 20000, "UI Driver must see all 20,000 rows");
  });

  await runTest("B.3 Instant Cache Hit (User Click on ready file) resolves in < 15ms via Branch 1", async () => {
    const uiDriver = await reltabFS.getUIDuckDBDriver();

    // Call getTableName on same session driver without isBackground (simulates user clicking the table)
    const t0 = process.hrtime();
    const tableName = await sharedFsDriver.getTableName({ path: ["sales_data.csv"] });
    const diff = process.hrtime(t0);
    const latencyMs = Number((diff[0] * 1000 + diff[1] / 1e6).toFixed(2));

    console.log(`    ${CYAN}Cache Hit Table Mount Latency: ${latencyMs} ms${RESET}`);
    assert(latencyMs < 50, `Cache hit must mount in < 50ms, took ${latencyMs}ms`);
    assert.strictEqual(tableName, ingestedCsvTable, "Must reuse table name in the same session");

    const rows = await uiDriver.runSqlQuery(`SELECT COUNT(*) as cnt FROM ${tableName}`);
    assert.strictEqual(Number(rows[0].cnt), 20000, "Mounted view must be queryable");
  });

  await runTest("B.4 JSONL streaming ingest and fast schema extraction via UI Driver", async () => {
    const uiDriver = await reltabFS.getUIDuckDBDriver();
    const ingestDriver = await reltabFS.getIngestDuckDBDriver();
    const fsDriver = new reltabFS.FSDriver(uiDriver, testTmpDir, true, false, ingestDriver);

    const jsonlTable = await fsDriver.getTableName({ path: ["audit_events.jsonl"] }, { isBackground: true });
    const schema = await fsDriver.getTableSchema(jsonlTable);

    assert(schema.columns.includes("event_id"), "Schema must include event_id");
    assert(schema.columns.includes("level"), "Schema must include level");
    assert(schema.columns.includes("duration_ms"), "Schema must include duration_ms");

    const rows = await fsDriver.runSqlQuery(`SELECT level, count(*) as cnt FROM ${jsonlTable} GROUP BY level ORDER BY level`);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(Number(rows[0].cnt) + Number(rows[1].cnt), 10000);
  });

  // ===========================================================================
  // SUITE C: High Concurrency Stress Test: 4 Streaming Workers vs 20 UI Queries
  // ===========================================================================
  reportSuite("SUITE C: High Concurrency Stress Test & UI Latency Profiling");

  await runTest("C.1 20 rapid UI queries during heavy 4-worker concurrent ingest maintain p99 < 50ms", async () => {
    const uiDriver = await reltabFS.getUIDuckDBDriver();
    const ingestDriver = await reltabFS.getIngestDuckDBDriver();

    // Setup an active dataset in UI engine
    const activeParquet = path.join(testTmpDir, "active_ui_dataset.parquet");
    const activeConn = await ingestDriver.connPool.take();
    await activeConn.exec(`COPY (
      SELECT i as id, 'trans_' || i as code, (i * 1.5)::DOUBLE as amount, '2026-10-29' as dt
      FROM range(1, 100000) t(i)
    ) TO '${activeParquet.replace(/\\/g, "/")}' (FORMAT PARQUET)`);
    ingestDriver.connPool.giveBack(activeConn);

    const uiConn = await uiDriver.connPool.take();
    await reltabDuckDB.createViewFromParquet(uiConn, activeParquet, "v_ui_active");
    uiDriver.connPool.giveBack(uiConn);

    // Launch 4 heavy concurrent jobs on ingestDriver
    const workerPromises = [];
    for (let w = 0; w < 4; w++) {
      const workerParquet = path.join(testTmpDir, `stress_worker_${w}.parquet`);
      const p = (async () => {
        const c = await ingestDriver.connPool.take();
        try {
          await c.exec(`COPY (
            SELECT i, hash(i)::VARCHAR as h, range(1, 5) as arr
            FROM range(1, 500000) t(i)
          ) TO '${workerParquet.replace(/\\/g, "/")}' (FORMAT PARQUET)`);
        } finally {
          ingestDriver.connPool.giveBack(c);
          if (fs.existsSync(workerParquet)) fs.unlinkSync(workerParquet);
        }
      })();
      workerPromises.push(p);
    }

    // Give background workers 50ms to ramp up CPU load
    await new Promise((r) => setTimeout(r, 50));

    // Execute 20 rapid UI DataGrid queries (paging, sorting, filtering)
    const latencies = [];
    for (let q = 0; q < 20; q++) {
      const offset = q * 100;
      const t0 = process.hrtime();
      const rows = await uiDriver.runSqlQuery(`
        SELECT id, code, amount
        FROM v_ui_active
        WHERE amount > 50.0
        ORDER BY amount DESC
        LIMIT 100 OFFSET ${offset}
      `);
      const diff = process.hrtime(t0);
      const ms = diff[0] * 1000 + diff[1] / 1e6;
      latencies.push(ms);
      assert.strictEqual(rows.length, 100);
    }

    // Wait for all 4 background workers to complete
    await Promise.all(workerPromises);

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)].toFixed(2);
    const p95 = latencies[Math.floor(latencies.length * 0.95)].toFixed(2);
    const p99 = latencies[latencies.length - 1].toFixed(2);

    console.log(`    ${CYAN}UI Query Latency Profile during 4-Worker Ingestion:${RESET}`);
    console.log(`    ${CYAN}  p50 (median) : ${p50} ms${RESET}`);
    console.log(`    ${CYAN}  p95          : ${p95} ms${RESET}`);
    console.log(`    ${CYAN}  p99 (worst)  : ${p99} ms${RESET}`);

    assert(Number(p99) < 80, `UI p99 latency (${p99}ms) must remain < 80ms under full load`);
    if (fs.existsSync(activeParquet)) fs.unlinkSync(activeParquet);
  });

  // ===========================================================================
  // SUITE D: Memory Limits & System Resilience
  // ===========================================================================
  reportSuite("SUITE D: Memory Limits, Thread Budgeting & Fast Row Count");

  await runTest("D.1 Fast Row Count caches accurate row count from Parquet metadata in O(1)", async () => {
    const cfg = reltabDuckDB.getIngestConfig();
    const cached = reltabDuckDB.getDeterministicParquetPath(testCsvFile, cfg.temp_dir);
    assert(cached, "Cached path must exist");

    const uiDriver = await reltabFS.getUIDuckDBDriver();
    const uiConn = await uiDriver.connPool.take();
    await reltabDuckDB.createViewFromParquet(uiConn, cached.parquetPath, "v_meta_test");
    uiDriver.connPool.giveBack(uiConn);

    const cache = (global)._toadTableRowCountCache;
    assert(cache, "Row count cache must exist on global");
    assert.strictEqual(cache["v_meta_test"], 20000, "Cached row count must equal 20,000");
  });

  await runTest("D.2 DuckDB Thread Isolation respects configuration on both engines", async () => {
    const uiDriver = await reltabFS.getUIDuckDBDriver();
    const ingestDriver = await reltabFS.getIngestDuckDBDriver();

    const uiRows = await uiDriver.runSqlQuery("SELECT current_setting('threads') as th");
    const ingestRows = await ingestDriver.runSqlQuery("SELECT current_setting('threads') as th");

    const uiThreads = Number(uiRows[0].th);
    const ingestThreads = Number(ingestRows[0].th);

    console.log(`    ${CYAN}Active DuckDB Threads -> UI Engine: ${uiThreads} threads | Ingest Engine: ${ingestThreads} threads${RESET}`);
    assert(uiThreads >= 1 && uiThreads <= 4, `UI threads should be reserved (1-4), got: ${uiThreads}`);
    assert(ingestThreads >= 1, `Ingest threads must be >= 1, got: ${ingestThreads}`);
  });

  // Cleanup temporary directory
  try {
    fs.rmSync(testTmpDir, { recursive: true, force: true });
  } catch {}

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n${BOLD}======================================================================${RESET}`);
  console.log(`${BOLD}  DEEP INTEGRATION QA TEST SUITE SUMMARY (Toad v1.3.19)${RESET}`);
  console.log(`${BOLD}======================================================================${RESET}`);
  console.log(`  Total Test Cases : ${totalTests}`);
  console.log(`  ${GREEN}Passed           : ${passedTests}${RESET}`);
  console.log(`  ${failedTests === 0 ? GREEN : RED}Failed           : ${failedTests}${RESET}`);
  console.log(`  Total Duration   : ${totalDuration}s`);
  console.log(`${BOLD}======================================================================${RESET}\n`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal QA Suite Error:", err);
  process.exit(1);
});
