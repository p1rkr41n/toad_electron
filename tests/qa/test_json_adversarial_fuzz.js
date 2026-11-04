/**
 * test_json_adversarial_fuzz.js
 * Adversarial, Security & Fuzzing Test Suite for TOAD v2.5.1 Nested JSON Engine
 *
 * Verifies:
 * 1. SQL Injection immunity in JSON keys, JSONPath expressions, and column aliases
 * 2. Deep recursion (>100 levels) protection (stack overflow prevention)
 * 3. Corrupted & truncated JSON lines handling in parser, scanner, and DuckDB
 * 4. Quotes, slashes, whitespace, and EVTX special character escaping
 * 5. Multi-byte Unicode, Emojis, and RTL language extraction
 * 6. Polymorphic field types across rows (integer, float, string, boolean, object, array, null)
 * 7. Extreme numeric bounds and float precision
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

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
} = require(path.resolve(
  ROOT_DIR,
  "tad-master/packages/toadviewer/src/utils/NestedJsonTraverser.ts"
));
const {
  DuckDbJsonSqlBuilder,
  escapeIdentifier,
  escapeSqlStringLiteral,
} = require(path.resolve(
  ROOT_DIR,
  "tad-master/packages/toadviewer/src/utils/DuckDbJsonSqlBuilder.ts"
));

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

let passCount = 0;
let failCount = 0;

function check(title, condition, detail) {
  if (condition) {
    passCount++;
    console.log(`  ${GREEN}✔ [PASS]${RESET} ${title}${detail ? ` (${detail})` : ""}`);
  } else {
    failCount++;
    console.error(`  ${RED}✖ [FAIL]${RESET} ${title}${detail ? ` (${detail})` : ""}`);
  }
}

async function run() {
  console.log(`\n${BOLD}${CYAN}======================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}   QA FUZZING SUITE: Adversarial & Security Robustness (v2.5.1)      ${RESET}`);
  console.log(`${BOLD}${CYAN}======================================================================${RESET}\n`);

  const db = new duckdb.Database(":memory:");
  const conn = db.connect();

  // ---------------------------------------------------------------------------
  // SUITE 1: SQL Injection Immunity in JSON Keys and Column Aliases
  // ---------------------------------------------------------------------------
  console.log(`${BOLD}--- Suite 1: SQL Injection Resistance in Payload Keys ---${RESET}`);

  await new Promise((res, rej) => {
    conn.run(
      `CREATE TABLE sensitive_data (secret VARCHAR); INSERT INTO sensitive_data VALUES ('CONFIDENTIAL_FLAG_9988');`,
      (err) => (err ? rej(err) : res())
    );
  });
  await new Promise((res, rej) => {
    conn.run(`CREATE TABLE payload_table (id INT, json_col VARCHAR);`, (err) => (err ? rej(err) : res()));
  });

  const injectionKeyPayload = {
    "' OR 1=1; DROP TABLE sensitive_data; --": "sqli_value_1",
    '"; DROP TABLE sensitive_data; --': "sqli_value_2",
    "admin' --": "sqli_value_3",
    "'; DELETE FROM sensitive_data WHERE '1'='1": "sqli_value_4",
    "1' UNION SELECT secret FROM sensitive_data --": "sqli_value_5",
    "col/*comment*/": "sqli_value_6",
    "col\nWITH newline\tand\ttab": "sqli_value_7",
  };

  await new Promise((res, rej) => {
    const stmt = conn.prepare(`INSERT INTO payload_table VALUES (?, ?);`);
    stmt.run(100, JSON.stringify(injectionKeyPayload), (err) => (err ? rej(err) : res()));
  });

  // Traverse leaves
  const sqliFields = traverseJsonLeaves(injectionKeyPayload);
  check("FUZZ.1: Traversed 7 adversarial payload keys without crash", sqliFields.length === 7);

  // Generate CREATE VIEW using DuckDbJsonSqlBuilder
  const { createViewSql } = DuckDbJsonSqlBuilder.buildCreateViewSql({
    targetViewName: "v_sqli_attack_test",
    sourceTableName: "payload_table",
    sourceColumnName: "json_col",
    fields: sqliFields,
  });

  // Execute CREATE VIEW
  await new Promise((res, rej) => {
    conn.run(createViewSql, (err) => (err ? rej(err) : res()));
  });

  // Verify sensitive_data was NOT dropped or deleted
  const sensitiveRows = await new Promise((res, rej) => {
    conn.all(`SELECT * FROM sensitive_data;`, (err, rows) => (err ? rej(err) : res(rows)));
  });
  check(
    "FUZZ.2: SQL Injection Immunity: sensitive_data table preserved intact",
    sensitiveRows.length === 1 && sensitiveRows[0].secret === "CONFIDENTIAL_FLAG_9988"
  );

  // Query values from the generated view
  const viewRows = await new Promise((res, rej) => {
    conn.all(`SELECT * FROM v_sqli_attack_test WHERE id = 100;`, (err, rows) => (err ? rej(err) : res(rows)));
  });
  check("FUZZ.3: View successfully queried 1 row with safely quoted aliases", viewRows.length === 1);
  check(
    "FUZZ.4: Extracted value for key containing DROP TABLE payload",
    viewRows[0]["' OR 1=1; DROP TABLE sensitive_data; --"] === "sqli_value_1"
  );

  // ---------------------------------------------------------------------------
  // SUITE 2: Deep Recursion (>100 levels) Protection
  // ---------------------------------------------------------------------------
  console.log(`\n${BOLD}--- Suite 2: Deep Recursion (>100 levels) Protection ---${RESET}`);

  // Build an object nested 120 levels deep
  const TOTAL_DEPTH = 120;
  let deepObject = "deep_treasure_at_level_120";
  for (let d = TOTAL_DEPTH; d >= 0; d--) {
    deepObject = { [`depth_lvl_${d}`]: deepObject };
  }

  // A: Test with maxDepth = 150 (must reach deepest leaf without stack overflow)
  let deepFields150 = [];
  try {
    deepFields150 = traverseJsonLeaves(deepObject, { maxDepth: 150 });
  } catch (err) {
    check("FUZZ.5: Deep recursion 120 levels does not throw RangeError", false, err.message);
  }
  check(
    "FUZZ.5: Deep recursion 120 levels does not throw RangeError",
    deepFields150.length === 1 && deepFields150[0].sampleValue === "deep_treasure_at_level_120"
  );

  // B: Test with default safety cap maxDepth = 50 (must cut off safely)
  const deepFields50 = traverseJsonLeaves(deepObject, { maxDepth: 50 });
  check("FUZZ.6: Default maxDepth cap (50) gracefully terminates recursion", deepFields50.length === 1);
  check("FUZZ.7: Cutoff field contains serialized sub-object", deepFields50[0].dotPath.startsWith("depth_lvl_0.depth_lvl_1"));

  // Ingest deep JSON into DuckDB and query using DuckDB JSONPath
  const deepJsonStr = JSON.stringify(deepObject);
  await new Promise((res, rej) => {
    const stmt = conn.prepare(`INSERT INTO payload_table VALUES (?, ?);`);
    stmt.run(120, deepJsonStr, (err) => (err ? rej(err) : res()));
  });

  const deepSegments = [];
  for (let d = 0; d <= 10; d++) {
    deepSegments.push(`depth_lvl_${d}`);
  }
  const duckPathLvl10 = buildSafeDuckDbJsonPath(deepSegments);
  const deepQueryLvl10 = `SELECT json_extract_string(json_col, '${duckPathLvl10}') as sub FROM payload_table WHERE id = 120;`;
  const deepRows10 = await new Promise((res, rej) => {
    conn.all(deepQueryLvl10, (err, rows) => (err ? rej(err) : res(rows)));
  });
  check("FUZZ.8: DuckDB json_extract_string traverses nested object cleanly", typeof deepRows10[0]?.sub === "string");

  // ---------------------------------------------------------------------------
  // SUITE 3: Corrupted & Truncated JSON Lines Handling
  // ---------------------------------------------------------------------------
  console.log(`\n${BOLD}--- Suite 3: Corrupted & Truncated JSON Lines Resilience ---${RESET}`);

  const malformedPayloads = [
    '{"truncated_mid_string": "missing_close_quote',
    '{"truncated_mid_object": {"level1": {"level2": 123',
    '{"unquoted_keys": unquoted_val, invalid_syntax}',
    "[1, 2, 3, {'unclosed_bracket'",
    "{",
    "}",
    "[",
    "]",
    ":",
    ",",
    "",
    "   \t\r\n  ",
    "null",
    "undefined",
    "NaN",
    "Infinity",
    "<xml><event id='1'>not json</event></xml>",
    "RANDOM_NON_JSON_CORRUPT_BUFFER_DATA",
    Buffer.from([0x00, 0xff, 0xfe, 0x12, 0x34]).toString(),
  ];

  // A: Test traverseJsonLeaves on all malformed strings (must never throw)
  let parseThrows = 0;
  for (const m of malformedPayloads) {
    try {
      const res = traverseJsonLeaves(m);
      if (!Array.isArray(res)) parseThrows++;
    } catch (_) {
      parseThrows++;
    }
  }
  check("FUZZ.9: traverseJsonLeaves survives all malformed strings safely", parseThrows === 0);

  // B: Test scanJsonSamplePool with mix of corrupt and valid lines
  const mixedPool = [
    '{"valid_id": 1, "status": "ok"}',
    ...malformedPayloads,
    '{"valid_id": 2, "status": "success", "extra": 42}',
  ];
  const samplePoolResults = scanJsonSamplePool(mixedPool, { sampleLimit: 100 });
  const poolMap = new Map(samplePoolResults.map((f) => [f.dotPath, f]));

  check("FUZZ.10: scanJsonSamplePool skips corrupt lines and extracts valid lines", poolMap.has("valid_id") && poolMap.has("status"));
  check("FUZZ.11: Fill rates computed based on valid rows (2 valid rows)", poolMap.get("valid_id")?.fillRate === 1.0);
  check("FUZZ.12: Sparse field fill rate computed accurately (1/2 = 0.5)", poolMap.get("extra")?.fillRate === 0.5);

  // C: Test DuckDB handling of malformed JSON
  await new Promise((res, rej) => {
    conn.run(`DELETE FROM payload_table WHERE id >= 200;`, (err) => (err ? rej(err) : res()));
  });

  await new Promise((res, rej) => {
    const stmt = conn.prepare(`INSERT INTO payload_table VALUES (?, ?);`);
    let idx = 200;
    for (const p of malformedPayloads) {
      stmt.run(idx++, p);
    }
    res();
  });

  const malformedCheckSql = `
    SELECT
      id,
      CASE WHEN json_valid(json_col) THEN json_extract_string(json_col, '$.any_key') ELSE NULL END AS safe_extract
    FROM payload_table WHERE id >= 200;
  `;
  const malformedDbResults = await new Promise((res, rej) => {
    conn.all(malformedCheckSql, (err, rows) => (err ? rej(err) : res(rows)));
  });
  check(
    "FUZZ.13: DuckDB query over malformed rows completes without crash",
    malformedDbResults.length === malformedPayloads.length
  );
  check(
    "FUZZ.14: All malformed extractions safely returned NULL",
    malformedDbResults.every((r) => r.safe_extract === null)
  );

  // ---------------------------------------------------------------------------
  // SUITE 4: Special Characters Stress (Quotes, Slashes, Dots, Spaces, EVTX)
  // ---------------------------------------------------------------------------
  console.log(`\n${BOLD}--- Suite 4: Special Characters, Quotes & Slashes Stress ---${RESET}`);

  const specialCharPayload = {
    'double"quote"key': "quote_value",
    "single'quote'key": "single_quote_value",
    "path\\with\\backslashes": "backslashes_value",
    "path/with/forward/slashes": "forward_slashes_value",
    "nested.dot.separated.key": "dots_value",
    "spaces and \t tabs": "spaces_value",
    "#attributes": "evtx_attributes_value",
    "#text": "evtx_text_value",
    "@xmlns": "evtx_xmlns_value",
    "'\"/\\#.@": "all_special_combined",
  };

  await new Promise((res, rej) => {
    conn.run(`DELETE FROM payload_table WHERE id = 300;`, (err) => (err ? rej(err) : res()));
  });

  await new Promise((res, rej) => {
    const stmt = conn.prepare(`INSERT INTO payload_table VALUES (?, ?);`);
    stmt.run(300, JSON.stringify(specialCharPayload), (err) => (err ? rej(err) : res()));
  });

  const specialFields = traverseJsonLeaves(specialCharPayload);
  check("FUZZ.15: All 10 special character keys extracted as leaves", specialFields.length === 10);

  const { createViewSql: specialViewSql } = DuckDbJsonSqlBuilder.buildCreateViewSql({
    targetViewName: "v_special_chars_test",
    sourceTableName: "payload_table",
    sourceColumnName: "json_col",
    fields: specialFields,
  });

  await new Promise((res, rej) => {
    conn.run(specialViewSql, (err) => (err ? rej(err) : res()));
  });

  const specialRows = await new Promise((res, rej) => {
    conn.all(`SELECT * FROM v_special_chars_test WHERE id = 300;`, (err, rows) => (err ? rej(err) : res(rows)));
  });
  const sp = specialRows[0];
  check("FUZZ.16: Extracted double-quote key value correctly", sp['double"quote"key'] === "quote_value");
  check("FUZZ.17: Extracted single-quote key value correctly", sp["single'quote'key"] === "single_quote_value");
  check("FUZZ.18: Extracted backslashes key value correctly", sp["path\\with\\backslashes"] === "backslashes_value");
  check("FUZZ.19: Extracted forward-slashes key value correctly", sp["path/with/forward/slashes"] === "forward_slashes_value");
  check("FUZZ.20: Extracted dot-separated key value correctly", sp["nested.dot.separated.key"] === "dots_value");
  check("FUZZ.21: Extracted EVTX #attributes key value correctly", sp["#attributes"] === "evtx_attributes_value");
  check("FUZZ.22: Extracted EVTX #text key value correctly", sp["#text"] === "evtx_text_value");
  check("FUZZ.23: Extracted all special combined key value correctly", sp["'\"/\\#.@"] === "all_special_combined");

  // ---------------------------------------------------------------------------
  // SUITE 5: Multi-Byte Unicode, Emojis, and RTL
  // ---------------------------------------------------------------------------
  console.log(`\n${BOLD}--- Suite 5: Multi-byte Unicode, Emojis & RTL Languages ---${RESET}`);

  const unicodePayload = {
    "🚀_speed": "warp_9",
    "🔥_fire": "hot_flame",
    "Tiếng_Việt_có_dấu": "Xin chào thế giới TOAD v2.5.1",
    "العربية_RTL": "مرحبا بك في تطبيق تود",
    "日本語_テスト": "データ分析エンジン",
    "zero\u200Bwidth": "invisible_separator",
  };

  await new Promise((res, rej) => {
    conn.run(`DELETE FROM payload_table WHERE id = 400;`, (err) => (err ? rej(err) : res()));
  });

  await new Promise((res, rej) => {
    const stmt = conn.prepare(`INSERT INTO payload_table VALUES (?, ?);`);
    stmt.run(400, JSON.stringify(unicodePayload), (err) => (err ? rej(err) : res()));
  });

  const uniFields = traverseJsonLeaves(unicodePayload);
  const { createViewSql: uniViewSql } = DuckDbJsonSqlBuilder.buildCreateViewSql({
    targetViewName: "v_unicode_fuzz_test",
    sourceTableName: "payload_table",
    sourceColumnName: "json_col",
    fields: uniFields,
  });

  await new Promise((res, rej) => {
    conn.run(uniViewSql, (err) => (err ? rej(err) : res()));
  });

  const uniRows = await new Promise((res, rej) => {
    conn.all(`SELECT * FROM v_unicode_fuzz_test WHERE id = 400;`, (err, rows) => (err ? rej(err) : res(rows)));
  });
  const u = uniRows[0];
  check("FUZZ.24: Emoji key '🚀_speed' extracted", u["🚀_speed"] === "warp_9");
  check("FUZZ.25: Emoji key '🔥_fire' extracted", u["🔥_fire"] === "hot_flame");
  check("FUZZ.26: Vietnamese diacritics preserved perfectly", u["Tiếng_Việt_có_dấu"] === "Xin chào thế giới TOAD v2.5.1");
  check("FUZZ.27: Arabic RTL preserved perfectly", u["العربية_RTL"] === "مرحبا بك في تطبيق تود");
  check("FUZZ.28: Japanese CJK characters preserved perfectly", u["日本語_テスト"] === "データ分析エンジン");

  // ---------------------------------------------------------------------------
  // SUITE 6: Polymorphic Field Types Across Rows
  // ---------------------------------------------------------------------------
  console.log(`\n${BOLD}--- Suite 6: Polymorphic Field Types Across Rows ---${RESET}`);

  const polymorphicRows = [
    { row_id: 1, poly_col: 100 },                                // integer
    { row_id: 2, poly_col: 99.95 },                              // float
    { row_id: 3, poly_col: "status_active" },                    // string
    { row_id: 4, poly_col: true },                               // boolean
    { row_id: 5, poly_col: { nested_key: "nested_val" } },       // object
    { row_id: 6, poly_col: [1, 2, 3] },                          // array
    { row_id: 7, poly_col: null },                               // null
  ];

  await new Promise((res, rej) => {
    conn.run(`DELETE FROM payload_table WHERE id >= 500;`, (err) => (err ? rej(err) : res()));
  });

  await new Promise((res, rej) => {
    const stmt = conn.prepare(`INSERT INTO payload_table VALUES (?, ?);`);
    for (const r of polymorphicRows) {
      stmt.run(500 + r.row_id, JSON.stringify(r), (err) => (err ? rej(err) : res()));
    }
  });

  // Test scanJsonSamplePool handling polymorphic types
  const polyFields = scanJsonSamplePool(polymorphicRows, { sampleLimit: 10 });
  const polyField = polyFields.find((f) => f.dotPath === "poly_col");
  check("FUZZ.29: scanJsonSamplePool scans polymorphic rows without error", !!polyField);
  check("FUZZ.30: Polymorphic field fill rate is 6/7 (0.8571)", polyField?.fillRate === 0.8571);

  // In DuckDB, extract polymorphic column using json_extract_string and TRY_CAST
  const polyQuery = `
    SELECT
      id - 500 AS rid,
      json_extract_string(json_col, '$.poly_col') AS raw_extract,
      TRY_CAST(json_extract_string(json_col, '$.poly_col') AS BIGINT) AS as_bigint,
      TRY_CAST(json_extract_string(json_col, '$.poly_col') AS DOUBLE) AS as_double
    FROM payload_table
    WHERE id >= 501 AND id <= 507
    ORDER BY id;
  `;
  const polyDbRows = await new Promise((res, rej) => {
    conn.all(polyQuery, (err, rows) => (err ? rej(err) : res(rows)));
  });

  check("FUZZ.31: DuckDB returned all 7 polymorphic rows without binder errors", polyDbRows.length === 7);
  check("FUZZ.32: Integer row parsed as string '100' and bigint 100", polyDbRows[0].raw_extract === "100" && Number(polyDbRows[0].as_bigint) === 100);
  check("FUZZ.33: Float row parsed as double 99.95", Number(polyDbRows[1].as_double) === 99.95);
  check("FUZZ.34: String row returns NULL for as_bigint via TRY_CAST without error", polyDbRows[2].as_bigint === null);
  check("FUZZ.35: Object row parsed as stringified JSON representation", polyDbRows[4].raw_extract === '{"nested_key":"nested_val"}');
  check("FUZZ.36: Array row parsed as stringified JSON representation", polyDbRows[5].raw_extract === "[1,2,3]");
  check("FUZZ.37: Null row extracted safely as NULL", polyDbRows[6].raw_extract === null);

  // ---------------------------------------------------------------------------
  // SUITE 7: Extreme Numeric Bounds and Precision
  // ---------------------------------------------------------------------------
  console.log(`\n${BOLD}--- Suite 7: Extreme Numeric Bounds and Precision ---${RESET}`);

  const extremeNumericPayloads = [
    { num: 9007199254740991 }, // Number.MAX_SAFE_INTEGER
    { num: -9007199254740991 }, // Number.MIN_SAFE_INTEGER
    { num: 1.7976931348623157e+308 }, // Double max
    { num: 5e-324 }, // Subnormal min float
    { num: 0 },
    { num: -0 },
  ];

  await new Promise((res, rej) => {
    conn.run(`DELETE FROM payload_table WHERE id >= 600;`, (err) => (err ? rej(err) : res()));
  });

  for (let i = 0; i < extremeNumericPayloads.length; i++) {
    await new Promise((res, rej) => {
      const stmt = conn.prepare(`INSERT INTO payload_table VALUES (?, ?);`);
      stmt.run(600 + i, JSON.stringify(extremeNumericPayloads[i]), (err) => (err ? rej(err) : res()));
    });
  }

  const numQuery = `SELECT id - 600 as idx, TRY_CAST(json_extract_string(json_col, '$.num') AS DOUBLE) as val FROM payload_table WHERE id >= 600 ORDER BY id;`;
  const numRows = await new Promise((res, rej) => {
    conn.all(numQuery, (err, rows) => (err ? rej(err) : res(rows)));
  });

  check("FUZZ.38: Extreme numeric values parsed into DOUBLE without crash", numRows.length === extremeNumericPayloads.length);
  check("FUZZ.39: MAX_SAFE_INTEGER preserved in extraction", numRows[0].val === 9007199254740991);
  check("FUZZ.40: MIN_SAFE_INTEGER preserved in extraction", numRows[1].val === -9007199254740991);

  console.log(`\n======================================================================`);
  console.log(`Adversarial QA Summary: ${passCount} Passed, ${failCount} Failed.`);
  console.log(`======================================================================\n`);

  if (failCount > 0) process.exit(1);
  else process.exit(0);
}

run().catch((e) => {
  console.error("FATAL ERROR in Fuzzing QA:", e);
  process.exit(1);
});
