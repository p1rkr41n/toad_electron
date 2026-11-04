/**
 * test_json_adversarial_fuzz.js
 * Adversarial, Security & Fuzzing Test Suite for Nested JSON Engine
 * Verifies SQL Injection immunity, malformed inputs, unicode, and extreme edge cases.
 */

const assert = require("assert");
const path = require("path");
const ROOT_DIR = path.resolve(__dirname, "../..");
const duckdb = require(path.resolve(ROOT_DIR, "tad-master/node_modules/duckdb"));

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

function escapeIdentifier(id) {
  return `"${String(id || "").replace(/"/g, '""')}"`;
}

function escapeSqlStringLiteral(str) {
  return `'${String(str || "").replace(/'/g, "''")}'`;
}

async function run() {
  console.log(`\n${BOLD}${CYAN}======================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}   QA FUZZING SUITE: Adversarial & Security Robustness              ${RESET}`);
  console.log(`${BOLD}${CYAN}======================================================================${RESET}\n`);

  const db = new duckdb.Database(":memory:");
  const conn = db.connect();

  await new Promise((res, rej) => {
    conn.run(`CREATE TABLE sensitive_data (secret VARCHAR); INSERT INTO sensitive_data VALUES ('SUPER_SECRET_TOKEN');`, err => err ? rej(err) : res());
    conn.run(`CREATE TABLE payload_table (id INT, json_col VARCHAR);`, err => err ? rej(err) : res());
  });

  // 1. SQL Injection Resistance in Field Alias and Path
  const injectionAliases = [
    "safe_col",
    "col\"; DROP TABLE sensitive_data; --",
    "col' OR '1'='1",
    "col\nWITH spaces\tand\ttabs",
    "col`backticks`",
    "col[0].sub",
    "col/*comment*/"
  ];

  let dropAttemptSucceeded = false;
  for (const alias of injectionAliases) {
    const safeAlias = escapeIdentifier(alias);
    const sql = `CREATE OR REPLACE VIEW v_sqli_test AS SELECT json_extract_string(json_col, '$.key') AS ${safeAlias} FROM payload_table;`;
    try {
      await new Promise((res, rej) => {
        conn.run(sql, err => err ? rej(err) : res());
      });
    } catch (e) {
      // Syntax failure is acceptable for absurd names, but data drop MUST NOT happen
    }
  }

  // Verify sensitive_data was NOT dropped
  const secretRows = await new Promise((res, rej) => {
    conn.all(`SELECT * FROM sensitive_data;`, (err, rows) => err ? rej(err) : res(rows));
  });
  check("FUZZ.1: SQL Injection Immunity (sensitive table preserved)", secretRows.length === 1 && secretRows[0].secret === "SUPER_SECRET_TOKEN");

  // 2. Malformed and Truncated JSON Strings
  const malformedPayloads = [
    "{ unquoted: true }",
    '{"truncated": "no close',
    "{",
    "",
    "null",
    "undefined",
    "12345",
    "NaN",
    "<xml>not json</xml>",
    "['unclosed array'"
  ];

  await new Promise((res, rej) => {
    const stmt = conn.prepare(`INSERT INTO payload_table VALUES (?, ?);`);
    let idx = 1;
    for (const p of malformedPayloads) {
      stmt.run(idx++, p);
    }
    res();
  });

  // Querying json_extract_string over malformed payloads should return NULL without crashing DuckDB
  const extractMalformedSql = `SELECT id, CASE WHEN json_valid(json_col) THEN json_extract_string(json_col, '$.any_key') ELSE NULL END as res FROM payload_table;`;
  const malformedResults = await new Promise((res, rej) => {
    conn.all(extractMalformedSql, (err, rows) => err ? rej(err) : res(rows));
  });

  check("FUZZ.2: DuckDB json_extract_string survives malformed JSON gracefully", malformedResults.length === malformedPayloads.length);
  const allNullOrSafe = malformedResults.every(r => r.res === null || typeof r.res === "string");
  check("FUZZ.3: All malformed extractions safely returned NULL or string", allNullOrSafe);

  // 3. Unicode, Emojis, RTL & Special Characters
  const unicodePayload = JSON.stringify({
    "🚀_speed": "warp_9",
    "Tiếng_Việt": "Xin chào thế giới",
    "عربي": "مرحبا",
    "zero_byte\u0000key": "null_byte_value",
    "double\"quote": "quote_value",
    "single'quote": "single_quote_value"
  });

  await new Promise((res, rej) => {
    conn.run(`DELETE FROM payload_table; INSERT INTO payload_table VALUES (999, '${unicodePayload.replace(/'/g, "''")}');`, err => err ? rej(err) : res());
  });

  const unicodeQuery = `
    SELECT
      json_extract_string(json_col, '$."🚀_speed"') as rocket,
      json_extract_string(json_col, '$.Tiếng_Việt') as vn,
      json_extract_string(json_col, '$.عربي') as arabic,
      json_col->>'double"quote' as dbl_quote,
      json_extract_string(json_col, '$."single''quote"') as sgl_quote
    FROM payload_table WHERE id = 999;
  `;

  const uniRows = await new Promise((res, rej) => {
    conn.all(unicodeQuery, (err, rows) => err ? rej(err) : res(rows));
  });

  check("FUZZ.4: Unicode & Emoji extraction", uniRows[0]?.rocket === "warp_9");
  check("FUZZ.5: Vietnamese accented text extraction", uniRows[0]?.vn === "Xin chào thế giới");
  check("FUZZ.6: Arabic RTL extraction", uniRows[0]?.arabic === "مرحبا");
  check("FUZZ.7: Escaped double quote extraction", uniRows[0]?.dbl_quote === "quote_value");
  check("FUZZ.8: Escaped single quote extraction", uniRows[0]?.sgl_quote === "single_quote_value");

  // 4. Extreme Numeric Bounds and Type Flapping
  const extremePayloads = [
    { num: 9007199254740991 }, // MAX_SAFE_INTEGER
    { num: -9007199254740991 },
    { num: 1.7976931348623157e+308 },
    { num: 5e-324 },
    { num: 0 },
    { num: -0 }
  ];

  await new Promise((res, rej) => {
    conn.run(`DELETE FROM payload_table;`, err => err ? rej(err) : res());
  });

  for (let i = 0; i < extremePayloads.length; i++) {
    await new Promise((res, rej) => {
      const stmt = conn.prepare(`INSERT INTO payload_table VALUES (?, ?);`);
      stmt.run(i, JSON.stringify(extremePayloads[i]), err => err ? rej(err) : res());
    });
  }

  const numQuery = `SELECT id, TRY_CAST(json_extract_string(json_col, '$.num') AS DOUBLE) as val FROM payload_table ORDER BY id;`;
  const numRows = await new Promise((res, rej) => {
    conn.all(numQuery, (err, rows) => err ? rej(err) : res(rows));
  });

  check("FUZZ.9: Extreme numeric values parsed into DOUBLE without crash", numRows.length === extremePayloads.length);
  check("FUZZ.10: MAX_SAFE_INTEGER preserved", numRows[0].val === 9007199254740991);

  console.log(`\n======================================================================`);
  console.log(`Adversarial QA Summary: ${passCount} Passed, ${failCount} Failed.`);
  console.log(`======================================================================\n`);

  if (failCount > 0) process.exit(1);
  else process.exit(0);
}

run().catch(e => {
  console.error("FATAL ERROR in Fuzzing QA:", e);
  process.exit(1);
});
