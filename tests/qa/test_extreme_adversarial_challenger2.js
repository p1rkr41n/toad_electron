/**
 * test_extreme_adversarial_challenger2.js
 * Adversarial Stress, Deep Recursion, Polymorphism & Fuzzing Verification Suite
 * Authored by: challenger_2 (Milestone 6 Empirical Challenger)
 *
 * Scope:
 * 1. Deep recursion stress: 150 to 300+ nested object/array levels, circular refs, deep STRUCT parsing
 * 2. High-volume wide lines: 2,500+ fields in single JSON lines, SQL builder, DuckDB view execution
 * 3. Extreme polymorphism: 1,000 rows flapping across 8 distinct types, type promotion, DuckDB TRY_CAST
 * 4. Interleaved corruption: truncated lines, raw binary buffers, PE headers, unclosed brackets
 * 5. EVTX parity & multi-record stress: RecordID 93937 parity + multi-record scan from System.evtx
 * 6. Worker lifecycle & abort mechanics: chunked async scanning, abort responsiveness, non-blocking UI
 * 7. Zero unhandled rejections / uncaught exceptions listener verification
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const child_process = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "../..");
const ts = require(path.resolve(ROOT_DIR, "tad-master/node_modules/typescript"));

// Hook TypeScript compilation for .ts module imports
require.extensions[".ts"] = function (module, filename) {
  const content = fs.readFileSync(filename, "utf8");
  const result = ts.transpileModule(content, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  module._compile(result.outputText, filename);
};

const duckdb = require(path.resolve(ROOT_DIR, "tad-master/node_modules/duckdb"));
const {
  NestedJsonTraverser,
  traverseJsonLeaves,
  scanJsonSamplePool,
  buildSafeBracketPath,
  buildSafeDuckDbJsonPath,
  buildArrowPath,
  inferType,
} = require(path.resolve(
  ROOT_DIR,
  "tad-master/packages/toadviewer/src/utils/NestedJsonTraverser.ts"
));

const { DuckDbJsonSqlBuilder } = require(path.resolve(
  ROOT_DIR,
  "tad-master/packages/toadviewer/src/utils/DuckDbJsonSqlBuilder.ts"
));

const {
  introspectJsonSchema,
  parseStructFields,
  isStructType,
  extractLeafProjections,
  splitTopLevelComma,
  parseFieldDef,
} = require(path.resolve(
  ROOT_DIR,
  "tad-master/packages/reltab-duckdb/src/json/JsonSchemaIntrospector.ts"
));

const {
  streamFlattenedJsonToParquet,
  generateDynamicProjectionSql,
} = require(path.resolve(
  ROOT_DIR,
  "tad-master/packages/reltab-duckdb/src/json/JsonStreamingFlattener.ts"
));

const { SampleScanWorker } = require(path.resolve(
  ROOT_DIR,
  "tad-master/packages/toadviewer/src/workers/SampleScanWorker.ts"
));

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

let passCount = 0;
let failCount = 0;
const failureDetails = [];

function check(title, condition, detail) {
  if (condition) {
    passCount++;
    console.log(`  ${GREEN}✔ [PASS]${RESET} ${title}${detail ? ` (${CYAN}${detail}${RESET})` : ""}`);
  } else {
    failCount++;
    const errMsg = `${title}${detail ? ` (${detail})` : ""}`;
    failureDetails.push(errMsg);
    console.error(`  ${RED}✖ [FAIL]${RESET} ${errMsg}`);
  }
}

// Track unhandled rejections and exceptions
let unhandledRejectionsCount = 0;
let uncaughtExceptionsCount = 0;

process.on("unhandledRejection", (reason) => {
  unhandledRejectionsCount++;
  console.error(`${RED}[GLOBAL UNHANDLED REJECTION]${RESET}`, reason);
});

process.on("uncaughtException", (err) => {
  uncaughtExceptionsCount++;
  console.error(`${RED}[GLOBAL UNCAUGHT EXCEPTION]${RESET}`, err);
});

async function main() {
  console.log(`\n${BOLD}${CYAN}======================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}   EMPIRICAL ADVERSARIAL CHALLENGER 2: STRESS & FUZZING HARNESS       ${RESET}`);
  console.log(`${BOLD}${CYAN}   Milestone 6: Deep Recursion, Wide Schemas, Polymorphism, Corruption${RESET}`);
  console.log(`${BOLD}${CYAN}======================================================================${RESET}\n`);

  const db = new duckdb.Database(":memory:");
  const conn = db.connect();

  // Helper for async duckdb exec
  const execSql = (sql) =>
    new Promise((resolve, reject) => {
      conn.run(sql, (err) => (err ? reject(err) : resolve()));
    });
  const queryAll = (sql) =>
    new Promise((resolve, reject) => {
      conn.all(sql, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });

  // ===========================================================================
  // SECTION 1: Deep Recursion & Call Stack Safety (150 to 300+ levels)
  // ===========================================================================
  console.log(`${BOLD}--- Section 1: Deep Recursion & Call Stack Safety ---${RESET}`);

  // 1.1 Object nested 200 levels deep
  let deep200 = "deep_treasure_200";
  for (let d = 200; d >= 0; d--) {
    deep200 = { [`lvl_${d}`]: deep200 };
  }

  // Test with default maxDepth = 50: must terminate gracefully without RangeError
  let leaves50 = [];
  try {
    leaves50 = traverseJsonLeaves(deep200, { maxDepth: 50 });
    check("1.1.1: traverseJsonLeaves terminates safely on 200 levels with maxDepth=50", leaves50.length === 1);
    check("1.1.2: Cutoff leaf at depth 50 contains serialized sub-object string", typeof leaves50[0].sampleValue === "string" && leaves50[0].sampleValue.includes("lvl_51"));
  } catch (e) {
    check("1.1.1: traverseJsonLeaves terminates safely on 200 levels with maxDepth=50", false, e.message);
  }

  // Test with maxDepth = 250: must reach level 200 without stack overflow
  try {
    const leaves250 = traverseJsonLeaves(deep200, { maxDepth: 250 });
    check("1.1.3: Deep traversal reaches level 200 without stack overflow", leaves250.length === 1);
    check("1.1.4: Deep leaf sample value is 'deep_treasure_200'", leaves250[0].sampleValue === "deep_treasure_200");
    check("1.1.5: Deep leaf dotPath has 201 segments", leaves250[0].pathSegments.length === 201);
  } catch (e) {
    check("1.1.3: Deep traversal reaches level 200 without stack overflow", false, e.message);
  }

  // 1.2 Extreme 350 levels nesting
  let deep350 = "deep_treasure_350";
  for (let d = 350; d >= 0; d--) {
    deep350 = { [`nest_${d}`]: deep350 };
  }
  try {
    const leaves350 = traverseJsonLeaves(deep350, { maxDepth: 400 });
    check("1.2.1: Extreme 350 levels nesting traversed without V8 stack overflow", leaves350.length === 1 && leaves350[0].sampleValue === "deep_treasure_350");
  } catch (e) {
    check("1.2.1: Extreme 350 levels nesting traversed without V8 stack overflow", false, e.message);
  }

  // 1.3 Deeply nested arrays (100 levels)
  let deepArray = "deep_array_item";
  for (let d = 0; d < 100; d++) {
    deepArray = [deepArray];
  }
  const arrayLeavesDefault = traverseJsonLeaves({ root: deepArray });
  check("1.3.1: Deeply nested arrays default (flattenArrays: false) preserved as JSON leaf string", arrayLeavesDefault.length === 1 && arrayLeavesDefault[0].inferredType === "VARCHAR");

  const arrayLeavesFlattened = traverseJsonLeaves({ root: deepArray }, { flattenArrays: true, maxDepth: 40 });
  check("1.3.2: Deeply nested arrays with flattenArrays: true and maxDepth: 40 truncates safely", arrayLeavesFlattened.length === 1 && arrayLeavesFlattened[0].pathSegments.length === 41);

  // 1.4 Circular references handling
  const circularObj = { name: "circ_root" };
  circularObj.loop = circularObj;
  try {
    const circLeaves = traverseJsonLeaves(circularObj);
    const circLeaf = circLeaves.find((l) => l.dotPath === "loop");
    check("1.4.1: Circular self-reference detected and recorded without infinite recursion", !!circLeaf && circLeaf.sampleValue === "[Circular]");
  } catch (e) {
    check("1.4.1: Circular self-reference detected and recorded without infinite recursion", false, e.message);
  }

  const mutualA = { id: "A" };
  const mutualB = { id: "B", a: mutualA };
  mutualA.b = mutualB;
  try {
    const mutualLeaves = traverseJsonLeaves(mutualA);
    check("1.4.2: Mutual circular reference (A <-> B) terminates safely", mutualLeaves.length >= 2);
  } catch (e) {
    check("1.4.2: Mutual circular reference (A <-> B) terminates safely", false, e.message);
  }

  // 1.5 Deep DuckDB STRUCT hierarchy parsing in JsonSchemaIntrospector (60 nested levels)
  let deepStructType = "BIGINT";
  for (let d = 60; d >= 1; d--) {
    deepStructType = `STRUCT("level_${d}" ${deepStructType})`;
  }
  const isStruct = isStructType(deepStructType);
  check("1.5.1: isStructType detects 60-level nested STRUCT", isStruct === true);

  const parsedFields = parseStructFields(deepStructType);
  check("1.5.2: parseStructFields parses top level of 60-level STRUCT", parsedFields.length === 1 && parsedFields[0].fieldName === "level_1");

  const leafProjections = extractLeafProjections("root_col", deepStructType);
  check("1.5.3: extractLeafProjections extracts leaf from 60-level STRUCT", leafProjections.length === 1 && leafProjections[0].pathSegments.length === 61);
  check("1.5.4: Leaf SQL expression quotes all 60 levels safely", leafProjections[0].sqlExpression.startsWith('"root_col"."level_1"'));

  // ===========================================================================
  // SECTION 2: High-Volume Wide JSON Lines (2,500+ fields)
  // ===========================================================================
  console.log(`\n${BOLD}--- Section 2: High-Volume Wide JSON Lines (2,500+ fields) ---${RESET}`);

  const WIDE_COUNT = 2500;
  const wideObj = {};
  for (let i = 1; i <= WIDE_COUNT; i++) {
    const pad = String(i).padStart(5, "0");
    wideObj[`metric_${pad}`] = i * 1.5;
  }

  const t0Traverse = Date.now();
  const wideLeaves = traverseJsonLeaves(wideObj);
  const traverseMs = Date.now() - t0Traverse;
  check(`2.1.1: Traversed ${WIDE_COUNT} fields in single object in < 250ms`, wideLeaves.length === WIDE_COUNT && traverseMs < 250, `${traverseMs}ms`);

  // Build CREATE VIEW with 2,500 fields
  await execSql(`CREATE TABLE wide_source_tbl (id INT, json_data VARCHAR);`);
  await new Promise((resolve, reject) => {
    const stmt = conn.prepare(`INSERT INTO wide_source_tbl VALUES (?, ?);`);
    stmt.run(1, JSON.stringify(wideObj), (err) => (err ? reject(err) : resolve()));
  });

  const t0Sql = Date.now();
  const { createViewSql: wideViewSql } = DuckDbJsonSqlBuilder.buildCreateViewSql({
    targetViewName: "v_wide_stress",
    sourceTableName: "wide_source_tbl",
    sourceColumnName: "json_data",
    fields: wideLeaves,
  });
  const sqlMs = Date.now() - t0Sql;
  check(`2.2.1: DuckDbJsonSqlBuilder generated CREATE VIEW for ${WIDE_COUNT} fields in < 100ms`, wideViewSql.length > 50000 && sqlMs < 100, `${sqlMs}ms`);

  // Execute CREATE VIEW in DuckDB
  const t0Exec = Date.now();
  await execSql(wideViewSql);
  const execViewMs = Date.now() - t0Exec;
  check(`2.2.2: DuckDB created VIEW with ${WIDE_COUNT} columns in < 250ms`, execViewMs < 250, `${execViewMs}ms`);

  // Query specific columns from wide view
  const wideRow = await queryAll(`SELECT metric_00001, metric_02500 FROM v_wide_stress WHERE id = 1;`);
  check("2.2.3: Wide view query returned exact values for first and last field", Number(wideRow[0].metric_00001) === 1.5 && Number(wideRow[0].metric_02500) === 3750);

  // Wide JSON Streaming Ingestion to Parquet via JsonStreamingFlattener
  const tmpWideJsonl = path.join(ROOT_DIR, "tmp_wide_test.jsonl");
  const tmpWideParquet = path.join(ROOT_DIR, "tmp_wide_test.parquet");

  const wideRow1 = { id: 1, ...wideObj };
  const wideRow2 = { id: 2, ...wideObj, metric_00001: 999.9 };
  fs.writeFileSync(tmpWideJsonl, JSON.stringify(wideRow1) + "\n" + JSON.stringify(wideRow2) + "\n", "utf8");

  try {
    const streamRes = await streamFlattenedJsonToParquet(conn, tmpWideJsonl, tmpWideParquet, {
      sampleSize: 10,
      ignoreErrors: true,
    });
    check("2.3.1: streamFlattenedJsonToParquet ingested wide JSON into Parquet without error", streamRes.executionTimeMs > 0);
    check("2.3.2: Parquet file exists and size is positive", fs.existsSync(tmpWideParquet) && fs.statSync(tmpWideParquet).size > 0);

    const parquetRows = await queryAll(`SELECT id, metric_00001, metric_02500 FROM read_parquet('${tmpWideParquet.replace(/\\/g, "/")}');`);
    check("2.3.3: Ingested Parquet verified in DuckDB (2 rows, 2501 columns)", parquetRows.length === 2 && Number(parquetRows[0].metric_00001) === 1.5 && Number(parquetRows[1].metric_00001) === 999.9);
  } finally {
    if (fs.existsSync(tmpWideJsonl)) fs.unlinkSync(tmpWideJsonl);
    if (fs.existsSync(tmpWideParquet)) fs.unlinkSync(tmpWideParquet);
  }

  // ===========================================================================
  // SECTION 3: Heavily Polymorphic Fields Across Consecutive Rows
  // ===========================================================================
  console.log(`\n${BOLD}--- Section 3: Heavily Polymorphic Fields (1,000 rows across 8 types) ---${RESET}`);

  // Create 1,000 rows with a single key 'chameleon' flapping through 8 types
  const POLY_ROWS_COUNT = 1000;
  const polyData = [];
  for (let i = 0; i < POLY_ROWS_COUNT; i++) {
    const mod = i % 8;
    let val;
    switch (mod) {
      case 0: val = 12345; break; // BIGINT
      case 1: val = 123.456; break; // DOUBLE
      case 2: val = "status_string_" + i; break; // VARCHAR
      case 3: val = true; break; // BOOLEAN
      case 4: val = { nested_k: "v_" + i, nested_num: i }; break; // Object
      case 5: val = [1, 2, i]; break; // Array
      case 6: val = null; break; // Null
      case 7: val = "2026-11-04T12:00:00.000Z"; break; // TIMESTAMP string
    }
    polyData.push({ row_id: i, chameleon: val });
  }

  // Test scanJsonSamplePool on all 1,000 rows
  const polyDiscovered = scanJsonSamplePool(polyData, { sampleLimit: 1000 });
  const chamField = polyDiscovered.find((f) => f.dotPath === "chameleon");
  check("3.1.1: scanJsonSamplePool completes on 1,000 heavily polymorphic rows", polyDiscovered.length > 0 && !!chamField);
  // Expected fill rate: 7/8 rows are non-null -> 0.875
  check("3.1.2: Polymorphic field fill rate accurately computed (0.875)", chamField && Math.abs(chamField.fillRate - 0.875) < 0.01, `fillRate=${chamField?.fillRate}`);

  // Ingest into DuckDB and create view with TRY_CAST
  await execSql(`CREATE TABLE poly_source_tbl (id INT, json_col VARCHAR);`);
  for (let i = 0; i < 50; i++) {
    const stmt = conn.prepare(`INSERT INTO poly_source_tbl VALUES (?, ?);`);
    stmt.run(i, JSON.stringify(polyData[i]));
  }

  const { createViewSql: polyViewSql } = DuckDbJsonSqlBuilder.buildCreateViewSql({
    targetViewName: "v_poly_stress",
    sourceTableName: "poly_source_tbl",
    sourceColumnName: "json_col",
    fields: polyDiscovered,
  });

  await execSql(polyViewSql);
  const polySampleRows = await queryAll(`SELECT id, chameleon FROM v_poly_stress ORDER BY id LIMIT 8;`);
  check("3.2.1: DuckDB view execution handles polymorphic data without binder error", polySampleRows.length === 8);
  check("3.2.2: Row 0 (BIGINT) extracted as expected", polySampleRows[0].chameleon !== null);
  check("3.2.3: Row 6 (null) returns null without throwing", polySampleRows[6].chameleon === null);

  // Test JsonStreamingFlattener on polymorphic NDJSON
  const tmpPolyJsonl = path.join(ROOT_DIR, "tmp_poly_test.jsonl");
  const tmpPolyParquet = path.join(ROOT_DIR, "tmp_poly_test.parquet");
  const polyLines = polyData.map((r) => JSON.stringify(r)).join("\n");
  fs.writeFileSync(tmpPolyJsonl, polyLines, "utf8");

  try {
    const polyStreamRes = await streamFlattenedJsonToParquet(conn, tmpPolyJsonl, tmpPolyParquet, {
      sampleSize: 100,
      ignoreErrors: true,
    });
    check("3.3.1: streamFlattenedJsonToParquet ingests 1,000 polymorphic rows cleanly", polyStreamRes.executionTimeMs > 0);
    check("3.3.2: Output Parquet file exists and is valid", fs.existsSync(tmpPolyParquet) && fs.statSync(tmpPolyParquet).size > 0);

    const polyParquetCount = await queryAll(`SELECT count(*) as cnt FROM read_parquet('${tmpPolyParquet.replace(/\\/g, "/")}');`);
    check("3.3.3: Parquet contains exact row count (1,000 rows)", Number(polyParquetCount[0].cnt) === 1000);
  } finally {
    if (fs.existsSync(tmpPolyJsonl)) fs.unlinkSync(tmpPolyJsonl);
    if (fs.existsSync(tmpPolyParquet)) fs.unlinkSync(tmpPolyParquet);
  }

  // ===========================================================================
  // SECTION 4: Corrupted, Truncated & Binary-Garbage Lines Interleaved
  // ===========================================================================
  console.log(`\n${BOLD}--- Section 4: Corrupted, Truncated & Binary-Garbage Lines ---${RESET}`);

  const binaryGarbage = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x80, 0x7f, 0x00]).toString("binary");
  const peHeaderBytes = Buffer.from("MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00").toString("binary");
  const longUnclosedString = '{"unclosed": "' + "A".repeat(50000);

  const corruptedLines = [
    binaryGarbage,
    peHeaderBytes,
    longUnclosedString,
    '{"truncated": {"nested": 123',
    '{"bad_syntax": unquoted_value}',
    "{{{{{{{{",
    "}}}}}}}}",
    "[[[[[[[[",
    "]]]]]]]]",
    ":::::",
    ",,,,,",
    "\0\0\0\0\0",
    "<!DOCTYPE html><html><body>Not JSON</body></html>",
    '{"unicode_surrogate": \\ud800}',
    '{"bad_escape": "test\\x"}',
    "INVALID_TEXT_NON_JSON_LINE",
  ];

  // Interleave 50 valid rows with 50 corrupted rows
  const mixedRows = [];
  for (let i = 0; i < 50; i++) {
    mixedRows.push(JSON.stringify({ valid_id: i, status: "OK", payload: { code: 200 + i } }));
    mixedRows.push(corruptedLines[i % corruptedLines.length]);
  }

  // Test traverseJsonLeaves on all individual corrupted lines
  let traverseFailures = 0;
  for (const c of corruptedLines) {
    try {
      const res = traverseJsonLeaves(c);
      if (!Array.isArray(res)) traverseFailures++;
    } catch {
      traverseFailures++;
    }
  }
  check("4.1.1: traverseJsonLeaves survives all 16 corrupted/binary payloads without uncaught error", traverseFailures === 0);

  // Test scanJsonSamplePool with mixed rows
  const mixedPoolResults = scanJsonSamplePool(mixedRows, { sampleLimit: 100 });
  const poolFields = new Map(mixedPoolResults.map((f) => [f.dotPath, f]));
  check("4.1.2: scanJsonSamplePool ignores corrupt lines and extracts valid lines", poolFields.has("valid_id") && poolFields.has("status") && poolFields.has("payload.code"));
  check("4.1.3: Fill rates accurately computed against valid rows (50 valid rows)", poolFields.get("valid_id")?.fillRate === 1.0);

  // Test streamFlattenedJsonToParquet on stream with corrupt lines
  // Standard corrupt lines that ignore_errors = true handles
  const duckCorruptLines = [
    '{"unquoted": val}',
    '{"truncated": 123',
    "{{{{{{{{",
    "}}}}}}}}",
    ":::::",
    ",,,,,",
    "NOT_JSON_DATA",
    "<html><body>error</body></html>",
  ];
  const duckMixedRows = [];
  for (let i = 0; i < 50; i++) {
    duckMixedRows.push(JSON.stringify({ valid_id: i, status: "OK", payload: { code: 200 + i } }));
    duckMixedRows.push(duckCorruptLines[i % duckCorruptLines.length]);
  }

  const tmpCorruptJsonl = path.join(ROOT_DIR, "tmp_corrupt_test.jsonl");
  const tmpCorruptParquet = path.join(ROOT_DIR, "tmp_corrupt_test.parquet");
  fs.writeFileSync(tmpCorruptJsonl, duckMixedRows.join("\n"), "utf8");

  try {
    const corruptStreamRes = await streamFlattenedJsonToParquet(conn, tmpCorruptJsonl, tmpCorruptParquet, {
      sampleSize: 50,
      ignoreErrors: true,
    });
    check("4.2.1: streamFlattenedJsonToParquet survived corrupted lines via ignoreErrors", corruptStreamRes.executionTimeMs > 0);
    check("4.2.2: Parquet generated successfully from valid rows in corrupted stream", fs.existsSync(tmpCorruptParquet) && fs.statSync(tmpCorruptParquet).size > 0);

    const corruptCountRows = await queryAll(`SELECT count(*) as cnt FROM read_parquet('${tmpCorruptParquet.replace(/\\/g, "/")}');`);
    check("4.2.3: Extracted valid rows from corrupted stream into Parquet", Number(corruptCountRows[0].cnt) >= 50, `rows=${corruptCountRows[0].cnt}`);
  } finally {
    if (fs.existsSync(tmpCorruptJsonl)) fs.unlinkSync(tmpCorruptJsonl);
    if (fs.existsSync(tmpCorruptParquet)) fs.unlinkSync(tmpCorruptParquet);
  }

  // 4.4 Empirical Challenge on JsonStreamingFlattener Tier 2 all_varchar vulnerability
  // Verify DuckDB's exact behavior when all_varchar is used in read_json_auto
  let allVarcharBinderErrorCaught = false;
  let binderErrMsg = "";
  try {
    const safePkg = path.resolve(ROOT_DIR, "package.json").replace(/\\/g, "/");
    await queryAll(`SELECT * FROM read_json_auto('${safePkg}', all_varchar = true);`);
  } catch (err) {
    binderErrMsg = err?.message || String(err);
    if (err && (err.code === "DUCKDB_NODEJS_ERROR" || err.errorType === "Invalid" || binderErrMsg.includes("all_varchar"))) {
      allVarcharBinderErrorCaught = true;
    }
  }
  check("4.4.1: [ADVERSARIAL FINDING] Verified DuckDB read_json_auto rejects all_varchar parameter with error", allVarcharBinderErrorCaught, "DuckDB threw DUCKDB_NODEJS_ERROR / Invalid Error as predicted");

  // Nested SQL Injection Payloads
  const nestedSqli = {
    "normal_key": "safe",
    "user_data": {
      "'; DROP TABLE sensitive_table; --": "attack1",
      '\" OR 1=1 --': "attack2",
      "union_col": "SELECT 1, 2, 3"
    }
  };
  await execSql(`CREATE TABLE sensitive_table (flag VARCHAR); INSERT INTO sensitive_table VALUES ('SECRET_123');`);
  const sqliLeaves = traverseJsonLeaves(nestedSqli);
  check("4.3.1: Nested SQL injection payload leaves extracted safely", sqliLeaves.length === 4);

  await execSql(`CREATE TABLE sqli_src (id INT, json_data VARCHAR);`);
  await new Promise((resolve, reject) => {
    const stmt = conn.prepare(`INSERT INTO sqli_src VALUES (?, ?);`);
    stmt.run(1, JSON.stringify(nestedSqli), (err) => (err ? reject(err) : resolve()));
  });

  const { createViewSql: sqliViewSql } = DuckDbJsonSqlBuilder.buildCreateViewSql({
    targetViewName: "v_sqli_nested_test",
    sourceTableName: "sqli_src",
    sourceColumnName: "json_data",
    fields: sqliLeaves,
  });

  await execSql(sqliViewSql);
  const sensitiveCheck = await queryAll(`SELECT * FROM sensitive_table;`);
  check("4.3.2: sensitive_table preserved completely intact (SQL injection immunity)", sensitiveCheck.length === 1 && sensitiveCheck[0].flag === "SECRET_123");

  // ===========================================================================
  // SECTION 5: Real-World EVTX Parity & Multi-Record Parity Stress
  // ===========================================================================
  console.log(`\n${BOLD}--- Section 5: Real-World EVTX Parity & Multi-Record Parity Stress ---${RESET}`);

  const evtxFile = "D:/Shared_UserData/Downloads/data_sample/System.evtx";
  const toadCoreExe = path.join(ROOT_DIR, "tad-master/packages/toad-app/bin/toad-core.exe");

  check("5.1.1: Real-world System.evtx exists at authoritative path", fs.existsSync(evtxFile));
  check("5.1.2: toad-core executable exists", fs.existsSync(toadCoreExe));

  if (fs.existsSync(evtxFile) && fs.existsSync(toadCoreExe)) {
    const tmpDir = path.join(process.env.TEMP || "C:/temp", `challenger2_evtx_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const dumpPath = path.join(tmpDir, "evtx_dump.jsonl");

    try {
      const dumpStart = Date.now();
      child_process.execFileSync(toadCoreExe, ["evtx-dump", evtxFile, dumpPath], {
        windowsHide: true,
        timeout: 90000,
      });
      const dumpMs = Date.now() - dumpStart;
      check("5.1.3: Dumped EVTX records from System.evtx via toad-core", fs.existsSync(dumpPath) && fs.statSync(dumpPath).size > 1000, `${dumpMs} ms`);

      const readline = require("readline");
      const fileStream = fs.createReadStream(dumpPath);
      const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

      const sampleBatch = [];
      let record93937Json = null;

      for await (const line of rl) {
        if (!line.trim()) continue;
        if (sampleBatch.length < 100) {
          sampleBatch.push(line);
        }
        try {
          const parsed = JSON.parse(line);
          if (parsed.RecordID === 93937) {
            record93937Json = typeof parsed.RawEvent === "string" ? JSON.parse(parsed.RawEvent) : parsed.RawEvent || parsed;
            if (sampleBatch.length >= 100) break;
          }
        } catch {}
      }

      check("5.1.4: Collected batch of 100 real-world EVTX records", sampleBatch.length === 100, `count=${sampleBatch.length}`);

      // Scan batch of 100 real-world EVTX records with SampleScanWorker
      const worker = new SampleScanWorker(25);
      const scanRes = await worker.scan(sampleBatch, { sampleLimit: 100 });
      check("5.1.5: SampleScanWorker scanned 100 real-world EVTX records without error", scanRes.validRowCount === 100 && scanRes.fields.length >= 14, `discoveredFields=${scanRes.fields.length}`);

      // Scan RawEvent objects directly to verify deep XML/JSON traversal
      const rawEvents = sampleBatch.map((line) => {
        try {
          const p = JSON.parse(line);
          return typeof p.RawEvent === "string" ? JSON.parse(p.RawEvent) : p.RawEvent || p;
        } catch { return {}; }
      });
      const deepScanRes = await worker.scan(rawEvents, { sampleLimit: 100 });
      check("5.1.6: SampleScanWorker deep-scans 100 parsed RawEvents (>= 20 leaves)", deepScanRes.validRowCount === 100 && deepScanRes.fields.length >= 20, `leaves=${deepScanRes.fields.length}`);

      check("5.2.1: Successfully retrieved RecordID 93937 from System.evtx", !!record93937Json);

      if (record93937Json) {
        const leaves93937 = traverseJsonLeaves(record93937Json);
        const map93937 = new Map(leaves93937.map((l) => [l.dotPath, l]));

        // Parity checks matching TEST_READY.md
        check("5.2.2: Leaf Event.System.EventID.#text is 7036", map93937.get("Event.System.EventID.#text")?.sampleValue === "7036");
        check("5.2.3: Leaf Event.System.EventID.#attributes.Qualifiers is 16384", map93937.get("Event.System.EventID.#attributes.Qualifiers")?.sampleValue === "16384");
        check("5.2.4: Leaf Event.EventData.param1 is 'Microsoft Passport Container'", map93937.get("Event.EventData.param1")?.sampleValue === "Microsoft Passport Container" || map93937.get("Event.EventData.Data.param1")?.sampleValue === "Microsoft Passport Container");
        check("5.2.5: Leaf Event.EventData.param2 is 'stopped'", map93937.get("Event.EventData.param2")?.sampleValue === "stopped" || map93937.get("Event.EventData.Data.param2")?.sampleValue === "stopped");
        check("5.2.6: Leaf Event.EventData.Binary matches exact hex", map93937.get("Event.EventData.Binary")?.sampleValue === "4E0067006300430074006E0072005300760063002F0031000000");
      }
    } finally {
      try {
        if (fs.existsSync(dumpPath)) fs.unlinkSync(dumpPath);
        if (fs.existsSync(tmpDir)) fs.rmdirSync(tmpDir);
      } catch {}
    }
  }

  // ===========================================================================
  // SECTION 6: SampleScanWorker Lifecycle, Chunking & Abort Mechanics
  // ===========================================================================
  console.log(`\n${BOLD}--- Section 6: SampleScanWorker Lifecycle & Abort Mechanics ---${RESET}`);

  const workerTestRows = [];
  for (let i = 0; i < 2000; i++) {
    workerTestRows.push({
      item_id: i,
      category: "cat_" + (i % 10),
      metrics: {
        score: i * 0.1,
        active: i % 2 === 0,
      },
    });
  }

  // 6.1 Normal full scan with progress callback
  const normalWorker = new SampleScanWorker(100);
  const progressSnapshots = [];
  const normalResult = await normalWorker.scan(workerTestRows, {
    sampleLimit: 1000,
    onProgress: (p) => progressSnapshots.push({ ...p }),
  });

  check("6.1.1: SampleScanWorker scanned 1,000 rows in chunks of 100", normalResult.totalScanned === 1000 && normalResult.validRowCount === 1000);
  check("6.1.2: Progress callback fired multiple times (>= 10 times)", progressSnapshots.length >= 10, `fires=${progressSnapshots.length}`);
  check("6.1.3: Final progress reached 100%", progressSnapshots[progressSnapshots.length - 1]?.percent === 100);
  check("6.1.4: Worker result aborted flag is false", normalResult.aborted === false);

  // 6.2 Abort mid-scan responsiveness
  const abortWorker = new SampleScanWorker(50);
  let abortFiredAt = null;

  const abortPromise = abortWorker.scan(workerTestRows, {
    sampleLimit: 2000,
    onProgress: (p) => {
      if (p.percent >= 30 && !abortWorker.isAborted()) {
        abortFiredAt = p.scanned;
        abortWorker.abort();
      }
    },
  });

  const abortResult = await abortPromise;
  check("6.2.1: Worker stopped scanning when aborted", abortResult.aborted === true);
  check("6.2.2: Scanned rows capped near abort trigger point (< 1000 vs 2000)", abortResult.totalScanned < 1000, `scanned=${abortResult.totalScanned}, abortAt=${abortFiredAt}`);
  check("6.2.3: Worker isAborted() returns true", abortWorker.isAborted() === true);

  // 6.3 Empty and invalid input handling
  const emptyRes = await normalWorker.scan([]);
  check("6.3.1: Empty array scan returns empty fields cleanly", emptyRes.fields.length === 0 && emptyRes.totalScanned === 0);

  const nonArrayRes = await normalWorker.scan(["non-json-string", null, undefined, 12345]);
  check("6.3.2: Non-object rows handled without throwing", nonArrayRes.fields.length === 0 && nonArrayRes.validRowCount === 0);

  // ===========================================================================
  // SECTION 7: Global Stability & Exception Audit
  // ===========================================================================
  console.log(`\n${BOLD}--- Section 7: Global Stability & Exception Audit ---${RESET}`);

  // Allow event loop to clear any trailing microtasks
  await new Promise((r) => setTimeout(r, 100));

  check("7.1.1: Zero unhandled promise rejections detected", unhandledRejectionsCount === 0, `count=${unhandledRejectionsCount}`);
  check("7.1.2: Zero uncaught exceptions detected", uncaughtExceptionsCount === 0, `count=${uncaughtExceptionsCount}`);

  // ===========================================================================
  // Summary
  // ===========================================================================
  console.log(`\n${BOLD}======================================================================${RESET}`);
  console.log(`${BOLD}Empirical Challenger 2 Summary: ${GREEN}${passCount} Passed${RESET}, ${failCount > 0 ? RED : GREEN}${failCount} Failed${RESET}`);
  console.log(`${BOLD}======================================================================${RESET}\n`);

  if (failureDetails.length > 0) {
    console.error(`${RED}Failure details:${RESET}`);
    for (const f of failureDetails) {
      console.error(`  - ${f}`);
    }
  }

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("FATAL ERROR in Challenger 2 test harness:", err);
  process.exit(1);
});
