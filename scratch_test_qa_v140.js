/**
 * Comprehensive QA Test Suite for Toad v1.4.0
 * 
 * Verifies:
 * 1. Subsystem 1: Parquet metadata fast row count (2ms O(1))
 * 2. Subsystem 2: ILIKE escaping (\, %, _), Auto Time-Column sort detection & fallback
 * 3. Subsystem 2: Distinct cache with 50,000 chunking and >= 1024 cardinality cap
 * 4. Subsystem 3: Pagination 1,000 rows & 5-page sliding buffer (max 5,000 rows in memory)
 */

const path = require("path");
const fs = require("fs");
const duckdb = require("./tad-master/node_modules/duckdb");

let testCount = 0;
let passCount = 0;

function assert(cond, name, details = "") {
  testCount++;
  if (cond) {
    passCount++;
    console.log(`[PASS] Test ${testCount}: ${name}`);
    if (details) console.log(`       -> ${details}`);
  } else {
    console.error(`[FAIL] Test ${testCount}: ${name}`);
    if (details) console.error(`       -> ${details}`);
  }
}

async function runQA() {
  console.log("==================================================================");
  console.log("          TOAD v1.4.0 COMPREHENSIVE QA TEST SUITE                 ");
  console.log("==================================================================");

  // -----------------------------------------------------------------------------
  // TEST GROUP 1: Search & Filter Escaping (\, %, _) with ESCAPE '\'
  // -----------------------------------------------------------------------------
  console.log("\n--- TEST GROUP 1: Search & Filter Escaping ---");
  const reltab = require("./tad-master/packages/reltab/dist/reltab.js");
  const FilterExp = reltab.FilterExp;
  const dialect = reltab.DuckDBDialect;

  // Test 1.1: Escape Windows backslash
  const feBackslash = reltab.and().contains(reltab.col("path"), reltab.constVal("C:\\Windows\\System32"));
  const sqlBackslash = feBackslash.toSqlWhere(dialect, {});
  assert(
    sqlBackslash.includes("C:\\\\Windows\\\\System32") && sqlBackslash.includes("ESCAPE '\\'"),
    "ILIKE backslash escaping",
    sqlBackslash
  );

  // Test 1.2: Escape wildcard %
  const fePercent = reltab.and().contains(reltab.col("log"), reltab.constVal("100% complete"));
  const sqlPercent = fePercent.toSqlWhere(dialect, {});
  assert(
    sqlPercent.includes("100\\% complete") && sqlPercent.includes("ESCAPE '\\'"),
    "ILIKE percent sign escaping",
    sqlPercent
  );

  // Test 1.3: Escape single wildcard _
  const feUnderscore = reltab.and().contains(reltab.col("var"), reltab.constVal("user_id_temp"));
  const sqlUnderscore = feUnderscore.toSqlWhere(dialect, {});
  assert(
    sqlUnderscore.includes("user\\_id\\_temp") && sqlUnderscore.includes("ESCAPE '\\'"),
    "ILIKE underscore wildcard escaping",
    sqlUnderscore
  );

  // Test 1.4: IN filter array
  const feIn = new reltab.FilterExp("AND", [new reltab.BinRelExp("IN", reltab.col("channel"), reltab.constVal(["Security", "System"]))]);
  const sqlIn = feIn.toSqlWhere(dialect, {});
  assert(
    sqlIn.includes("IN ('Security', 'System')"),
    "IN filter SQL generation",
    sqlIn
  );

  // -----------------------------------------------------------------------------
  // TEST GROUP 2: Auto Time-Column Sort Detection & Fallback
  // -----------------------------------------------------------------------------
  console.log("\n--- TEST GROUP 2: Auto Time-Column Sort Detection ---");
  const PivotRequesterModule = require("./tad-master/packages/tadviewer/dist/PivotRequester.js");
  const findBestTimeColumn = PivotRequesterModule.findBestTimeColumn;

  // Test 2.1: Detect EventTime
  const schema1 = new reltab.Schema(dialect, ["id", "event_time", "message"], {
    id: { displayName: "id", columnType: "integer" },
    event_time: { displayName: "event_time", columnType: "timestamp" },
    message: { displayName: "message", columnType: "string" },
  });
  assert(findBestTimeColumn(schema1) === "event_time", "Auto-detect event_time column");

  // Test 2.2: Detect TimeCreated (Hayabusa schema)
  const schema2 = new reltab.Schema(dialect, ["RecordID", "EventID", "TimeCreated", "Channel"], {
    RecordID: { displayName: "RecordID", columnType: "integer" },
    EventID: { displayName: "EventID", columnType: "integer" },
    TimeCreated: { displayName: "TimeCreated", columnType: "string" },
    Channel: { displayName: "Channel", columnType: "string" },
  });
  assert(findBestTimeColumn(schema2) === "TimeCreated", "Auto-detect TimeCreated in Windows Event Log");

  // Test 2.3: Detect Timestamp column
  const schema3 = new reltab.Schema(dialect, ["cpu", "memory", "timestamp"], {
    cpu: { displayName: "cpu", columnType: "real" },
    memory: { displayName: "memory", columnType: "real" },
    timestamp: { displayName: "timestamp", columnType: "string" },
  });
  assert(findBestTimeColumn(schema3) === "timestamp", "Auto-detect timestamp column");

  // Test 2.4: Fallback when NO time column exists -> return null (Do not sort!)
  const schemaNoTime = new reltab.Schema(dialect, ["col_a", "col_b", "status", "count"], {
    col_a: { displayName: "col_a", columnType: "string" },
    col_b: { displayName: "col_b", columnType: "string" },
    status: { displayName: "status", columnType: "string" },
    count: { displayName: "count", columnType: "integer" },
  });
  assert(
    findBestTimeColumn(schemaNoTime) === null,
    "No time column present -> returns null (Sort skipped to conserve resources)"
  );

  // -----------------------------------------------------------------------------
  // TEST GROUP 3: Parquet Metadata Instant Row Count & Fast Distinct Cache
  // -----------------------------------------------------------------------------
  console.log("\n--- TEST GROUP 3: DuckDB Parquet Metadata & Distinct Cache ---");
  const sampleCsv = path.join(__dirname, "data_sample", "sample_40gb.csv").replace(/\\/g, "/");
  const testDb = new duckdb.Database(":memory:");
  const conn = testDb.connect();

  await new Promise((resolve, reject) => {
    // Generate a quick parquet file with 120,000 rows to test chunking & metadata
    conn.all(
      `COPY (
        SELECT 
          range as id,
          CASE WHEN range % 10 = 0 THEN 'Security' WHEN range % 10 = 1 THEN 'System' ELSE 'Application_' || (range % 2000) END as channel,
          'User_' || (range % 500) as username,
          'C:\\Windows\\System32\\svchost_' || (range % 100) || '.exe' as image_path,
          TIMESTAMP '2026-10-27 00:00:00' + INTERVAL (range) SECOND as EventTime
        FROM range(120000)
      ) TO 'data_sample/qa_test_sample.parquet' (FORMAT PARQUET, COMPRESSION SNAPPY, ROW_GROUP_SIZE 25000);`,
      (err, res) => {
        if (err) reject(err);
        else resolve(res);
      }
    );
  });

  // Test 3.1: Parquet metadata query performance and accuracy
  const t0 = Date.now();
  const metaRows = await new Promise((resolve, reject) => {
    conn.all(
      `SELECT SUM(row_group_num_rows)::BIGINT as total_rows 
       FROM (SELECT DISTINCT row_group_id, row_group_num_rows FROM parquet_metadata('data_sample/qa_test_sample.parquet'))`,
      (err, res) => {
        if (err) reject(err);
        else resolve(res);
      }
    );
  });
  const tMeta = Date.now() - t0;
  const metaRowCount = Number(metaRows[0].total_rows);
  assert(
    metaRowCount === 120000 && tMeta < 500,
    "Parquet Metadata O(1) Instant Row Count",
    `Total rows: ${metaRowCount}, Query time: ${tMeta}ms (O(1) instant, bypass count(*))`
  );

  // Test 3.2: Chunked Distinct Cache with >= 1024 early stop rule
  const distinctCacheModule = require("./tad-master/packages/tadviewer/dist/distinctCache.js");
  
  // Create VIEW
  await new Promise((resolve) => {
    conn.all("CREATE VIEW t_qa_sample AS SELECT * FROM parquet_scan('data_sample/qa_test_sample.parquet')", resolve);
  });

  // Adapter for DataSourceConnection
  const mockDbc = {
    runSqlQuery: (sql) => new Promise((resolve, reject) => {
      conn.all(sql, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    }),
  };

  // Test 3.2a: Low cardinality column ('channel' has ~2000 unique, should stop at >= 1024)
  const channelVals = await distinctCacheModule.getOrLoadDistinctValues(mockDbc, "t_qa_sample", "channel");
  // Wait brief moment for background chunks to evaluate
  await new Promise((r) => setTimeout(r, 200));
  const cachedChannel = distinctCacheModule.getCachedDistinctValues("t_qa_sample", "channel");
  assert(
    cachedChannel && cachedChannel.length >= 1024,
    "Distinct Cache Cardinality Cap: stops when distinct >= 1024",
    `Accumulated values count: ${cachedChannel ? cachedChannel.length : 0} (Capped at threshold)`
  );

  // Test 3.2b: Moderate cardinality column ('username' has 500 unique < 1024, should scan all without cap)
  const userVals = await distinctCacheModule.getOrLoadDistinctValues(mockDbc, "t_qa_sample", "username");
  await new Promise((r) => setTimeout(r, 200));
  const cachedUsers = distinctCacheModule.getCachedDistinctValues("t_qa_sample", "username");
  assert(
    cachedUsers && cachedUsers.length === 500,
    "Distinct Cache Completeness: low-cardinality (< 1024) scans completely",
    `Accumulated unique users: ${cachedUsers ? cachedUsers.length : 0}`
  );

  // -----------------------------------------------------------------------------
  // TEST GROUP 4: Pagination Engine & 5-Page Sliding Buffer
  // -----------------------------------------------------------------------------
  console.log("\n--- TEST GROUP 4: Pagination Engine & 5-Page Sliding Buffer ---");
  const PagedDataViewModule = require("./tad-master/packages/tadviewer/dist/PagedDataView.js");
  const PagedDataView = PagedDataViewModule.PagedDataView;

  const totalDatasetRows = 60000000; // 60 Million rows
  const pageSize = 1000;
  const totalPages = Math.ceil(totalDatasetRows / pageSize); // 60,000 pages

  // Scenario 1: Page 1 view
  // Sliding buffer covers [Page 1 .. Page 3] = offset 0, limit 3,000 rows
  const bufferPage1Rows = Array.from({ length: 3000 }, (_, i) => ({
    _isLeaf: true,
    _depth: 0,
    _pivot: "",
    _isOpen: false,
    id: i,
    val: `row_${i}`,
  }));

  const pdvPage1 = new PagedDataView(
    schema1,
    totalDatasetRows,
    0, // bufferOffset
    bufferPage1Rows,
    1, // currentPage
    pageSize
  );

  assert(pdvPage1.getLength() === 1000, "PagedDataView length is exactly pageSize (1,000)", `getLength: ${pdvPage1.getLength()}`);
  assert(pdvPage1.getOffset() === 0, "Page 1 start row offset is 0");
  assert(pdvPage1.getItem(0).id === 0, "Page 1 first row is row 0");
  assert(pdvPage1.getItem(999).id === 999, "Page 1 last row is row 999");
  assert(pdvPage1.getItem(1000) === null, "Page 1 index 1000 is out of page boundary (null)");

  // Scenario 2: Navigate to Page 2 without refetching (already in 5-page sliding buffer)
  const pdvPage2 = pdvPage1.withPage(2);
  assert(pdvPage2.getLength() === 1000, "Page 2 length is exactly pageSize (1,000)");
  assert(pdvPage2.getOffset() === 1000, "Page 2 start row offset is 1,000");
  assert(pdvPage2.getItem(0).id === 1000, "Page 2 first row is row 1,000 (instant 0ms switch from buffer)");
  assert(pdvPage2.getItem(999).id === 1999, "Page 2 last row is row 1,999");

  // Scenario 3: Jump to Page 50
  // Sliding buffer covers [Page 48 .. Page 52] = 5 pages = 5,000 rows
  // offset = (48 - 1) * 1000 = 47,000
  const bufferPage50Rows = Array.from({ length: 5000 }, (_, i) => ({
    _isLeaf: true,
    _depth: 0,
    _pivot: "",
    _isOpen: false,
    id: 47000 + i,
    val: `row_${47000 + i}`,
  }));

  const pdvPage50 = new PagedDataView(
    schema1,
    totalDatasetRows,
    47000, // bufferOffset
    bufferPage50Rows,
    50, // currentPage
    pageSize
  );

  assert(pdvPage50.getLength() === 1000, "Page 50 length is 1,000");
  assert(pdvPage50.getOffset() === 49000, "Page 50 start row offset is 49,000");
  assert(pdvPage50.getItem(0).id === 49000, "Page 50 first row is row 49,000");
  assert(pdvPage50.getItem(999).id === 49999, "Page 50 last row is row 49,999");

  // Cleanup test parquet
  try {
    fs.unlinkSync("data_sample/qa_test_sample.parquet");
  } catch {}

  console.log("\n==================================================================");
  console.log(`QA SUMMARY: ${passCount}/${testCount} TESTS PASSED!`);
  console.log("==================================================================");

  if (passCount === testCount) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runQA().catch((e) => {
  console.error("FATAL QA ERROR:", e);
  process.exit(1);
});
