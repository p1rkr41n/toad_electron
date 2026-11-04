/**
 * test_nested_json.js
 *
 * Automated test suite for Nested JSON, Dotted Keys, and Semi-Structured Extraction:
 * 1. DuckDB Ingestion: Ingestion and schema inference of Nested Objects into STRUCT.
 * 2. Nested Array/List: Ingestion and schema inference of Arrays into LIST.
 * 3. Dotted Literal Field Isolation: "target.host" literal column vs target.host struct.
 * 4. Deep Nested Bracket Notation: meta['deep.key'] and nested['deep.key'].
 * 5. Semi-Structured Key-Value Extraction on Hayabusa Log Details.
 * 6. JSONPath Extraction via json_extract_string on JSON columns.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const DUCKDB_PATH = path.resolve(ROOT_DIR, "tad-master/node_modules/duckdb");
const duckdb = require(DUCKDB_PATH);

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

let passedCount = 0;
let totalCount = 0;

function report(name, pass, detail) {
  totalCount++;
  if (pass) {
    passedCount++;
    console.log(`  ${GREEN}✔ [PASS]${RESET} ${name}${detail ? ` - ${detail}` : ""}`);
  } else {
    console.error(`  ${RED}✖ [FAIL]${RESET} ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

async function runTests() {
  console.log(`\n${BOLD}${CYAN}======================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}  NESTED JSON & SEMI-STRUCTURED INGESTION TEST SUITE (TOAD ENGINE)   ${RESET}`);
  console.log(`${BOLD}${CYAN}======================================================================${RESET}\n`);

  const db = new duckdb.Database(":memory:");
  const conn = db.connect();

  const tmpDir = path.resolve(ROOT_DIR, "scratch");
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  // Sample data with nested structs, dotted keys, arrays, and JSON strings
  const testData = [
    {
      id: 101,
      target: { host: "srv-01", ip: "10.0.0.1", geo: { country: "VN", city: "Hanoi" } },
      "target.host": "dotted_alias_01",
      signatures: [{ sid: 1001, severity: "HIGH" }, { sid: 1002, severity: "MED" }],
      metadata: { "attack.tactic": "Lateral Movement" },
      raw_payload: JSON.stringify({ event_type: "LOGIN", context: { auth_method: "Kerberos", success: true } })
    },
    {
      id: 102,
      target: { host: "srv-02", ip: "10.0.0.2", geo: { country: "VN", city: "Da Nang" } },
      "target.host": "dotted_alias_02",
      signatures: [{ sid: 1003, severity: "CRITICAL" }],
      metadata: { "attack.tactic": "Privilege Escalation" },
      raw_payload: JSON.stringify({ event_type: "PROCESS", context: { auth_method: "SYSTEM", success: false } })
    }
  ];

  const tmpJsonPath = path.resolve(tmpDir, "test_nested_sample.jsonl");
  fs.writeFileSync(tmpJsonPath, testData.map((d) => JSON.stringify(d)).join("\n"));
  const safeJsonPath = tmpJsonPath.replace(/\\/g, "/");

  try {
    // TEST 1: Schema inference of Nested Structs
    await new Promise((resolve, reject) => {
      conn.all(`DESCRIBE SELECT * FROM read_json_auto('${safeJsonPath}')`, (err, desc) => {
        if (err) return reject(err);
        const targetCol = desc.find((c) => c.column_name === "target");
        const isStruct = targetCol && targetCol.column_type.startsWith("STRUCT");
        report(
          "NESTED_JSON.1 DuckDB infers nested object as STRUCT",
          isStruct,
          targetCol ? targetCol.column_type : "Not found"
        );
        resolve();
      });
    });

    // TEST 2: Schema inference of Nested Arrays
    await new Promise((resolve, reject) => {
      conn.all(`DESCRIBE SELECT * FROM read_json_auto('${safeJsonPath}')`, (err, desc) => {
        if (err) return reject(err);
        const sigCol = desc.find((c) => c.column_name === "signatures");
        const isList = sigCol && (sigCol.column_type.includes("[]") || sigCol.column_type.startsWith("LIST"));
        report(
          "NESTED_JSON.2 DuckDB infers nested array as LIST/ARRAY",
          isList,
          sigCol ? sigCol.column_type : "Not found"
        );
        resolve();
      });
    });

    // TEST 3: Dotted Literal Field Isolation without collision
    await new Promise((resolve, reject) => {
      conn.all(
        `SELECT target.host AS struct_host, "target.host" AS dotted_literal FROM read_json_auto('${safeJsonPath}') WHERE id = 101`,
        (err, rows) => {
          if (err) return reject(err);
          const ok = rows.length === 1 && rows[0].struct_host === "srv-01" && rows[0].dotted_literal === "dotted_alias_01";
          report(
            "NESTED_JSON.3 Dotted literal field ('target.host') isolates cleanly from struct.field (target.host)",
            ok,
            `struct: ${rows[0]?.struct_host}, literal: ${rows[0]?.dotted_literal}`
          );
          resolve();
        }
      );
    });

    // TEST 4: Deep Nested Bracket Notation for keys with dots
    await new Promise((resolve, reject) => {
      conn.all(
        `SELECT target.geo.city AS deep_city, metadata['attack.tactic'] AS tactic FROM read_json_auto('${safeJsonPath}') WHERE id = 101`,
        (err, rows) => {
          if (err) return reject(err);
          const ok = rows.length === 1 && rows[0].deep_city === "Hanoi" && rows[0].tactic === "Lateral Movement";
          report(
            "NESTED_JSON.4 Deep struct traversal and bracket notation for dotted keys (metadata['attack.tactic'])",
            ok,
            `city: ${rows[0]?.deep_city}, tactic: ${rows[0]?.tactic}`
          );
          resolve();
        }
      );
    });

    // TEST 5: JSONPath Extraction on raw_payload column
    await new Promise((resolve, reject) => {
      conn.all(
        `SELECT 
          json_extract_string(raw_payload, '$.event_type') AS ev_type,
          json_extract_string(raw_payload, '$.context.auth_method') AS auth_method,
          TRY_CAST(json_extract_string(raw_payload, '$.context.success') AS BOOLEAN) AS is_success
        FROM read_json_auto('${safeJsonPath}') WHERE id = 101`,
        (err, rows) => {
          if (err) return reject(err);
          const ok = rows.length === 1 && rows[0].ev_type === "LOGIN" && rows[0].auth_method === "Kerberos" && rows[0].is_success === true;
          report(
            "NESTED_JSON.5 JSONPath extraction via json_extract_string with nested paths and type casting",
            ok,
            `type: ${rows[0]?.ev_type}, auth: ${rows[0]?.auth_method}, success: ${rows[0]?.is_success}`
          );
          resolve();
        }
      );
    });

    // TEST 6: Real-world Hayabusa / Semi-Structured Key-Value Extraction
    const hayabusaSample = "Product: PuTTY release 0.81 (64-bit) \u00a0 Ver: 0.81.0.0 \u00a0 Vendor: Simon Tatham \u00a0 Status: 0";
    await new Promise((resolve, reject) => {
      conn.all(
        `SELECT 
          TRIM(regexp_extract('${hayabusaSample}', 'Product:\\s*([^\\xA0]+)', 1)) AS prod,
          TRIM(regexp_extract('${hayabusaSample}', 'Ver:\\s*([^\\xA0]+)', 1)) AS ver,
          TRY_CAST(TRIM(regexp_extract('${hayabusaSample}', 'Status:\\s*([^\\xA0]+)', 1)) AS INTEGER) AS status`,
        (err, rows) => {
          if (err) return reject(err);
          const ok = rows.length === 1 && rows[0].prod === "PuTTY release 0.81 (64-bit)" && rows[0].ver === "0.81.0.0" && rows[0].status === 0;
          report(
            "NESTED_JSON.6 Semi-structured Key-Value extraction with unicode delimiters and type casting",
            ok,
            `prod: ${rows[0]?.prod}, ver: ${rows[0]?.ver}, status: ${rows[0]?.status}`
          );
          resolve();
        }
      );
    });

    // TEST 7: Real-world Windows EVTX JSON Leaf Extraction with Special Characters (#text, #attributes)
    const evtxEvent = {
      Event: {
        "#attributes": { xmlns: "http://schemas.microsoft.com/win/2004/08/events/event" },
        System: {
          Provider: {
            "#attributes": {
              Name: "Service Control Manager",
              Guid: "{555908d1-a6d7-4695-8e1e-26931d2012f4}",
              EventSourceName: "Service Control Manager"
            }
          },
          EventID: {
            "#attributes": { Qualifiers: 16384 },
            "#text": 7036
          },
          Version: 0,
          Level: 4,
          Task: 0,
          Opcode: 0,
          Keywords: "0x8080000000000000",
          TimeCreated: {
            "#attributes": { SystemTime: "2026-10-27T14:44:08.819818Z" }
          },
          EventRecordID: 93937,
          Channel: "System",
          Computer: "WIN-3MJ9DEQ5B94"
        },
        EventData: {
          param1: "Microsoft Passport Container",
          param2: "stopped",
          Binary: "4E0067006300430074006E0072005300760063002F0031000000"
        }
      }
    };
    const evtxJsonStr = JSON.stringify(evtxEvent).replace(/'/g, "''");
    await new Promise((resolve, reject) => {
      conn.all(
        `SELECT 
          json_extract_string('${evtxJsonStr}', '$.Event."#attributes".xmlns') AS "xmlns",
          json_extract_string('${evtxJsonStr}', '$.Event.System.Provider."#attributes".Name') AS "provider_name",
          TRY_CAST(json_extract_string('${evtxJsonStr}', '$.Event.System.EventID."#text"') AS BIGINT) AS "event_id",
          TRY_CAST(json_extract_string('${evtxJsonStr}', '$.Event.System.EventRecordID') AS BIGINT) AS "record_id",
          TRY_CAST(json_extract_string('${evtxJsonStr}', '$.Event.System.TimeCreated."#attributes".SystemTime') AS TIMESTAMP) AS "time_created",
          json_extract_string('${evtxJsonStr}', '$.Event.EventData.param1') AS "param1"`,
        (err, rows) => {
          if (err) return reject(err);
          const ok = rows.length === 1 &&
            rows[0].provider_name === "Service Control Manager" &&
            rows[0].event_id === 7036n &&
            rows[0].record_id === 93937n &&
            rows[0].param1 === "Microsoft Passport Container";
          report(
            "NESTED_JSON.7 Windows EVTX JSON leaf extraction with DuckDB quoted JSONPath ($.Event.System.EventID.\"#text\")",
            ok,
            `id: ${rows[0]?.event_id}, provider: ${rows[0]?.provider_name}, record: ${rows[0]?.record_id}`
          );
          resolve();
        }
      );
    });

    // TEST 8: Two-Phase Auto-Flattening of Nested JSON to Parquet
    const parquetOutPath = path.resolve(tmpDir, "test_flattened.parquet").replace(/\\/g, "/");
    if (fs.existsSync(parquetOutPath)) fs.unlinkSync(parquetOutPath);

    await new Promise((resolve, reject) => {
      // Phase 1 & 2: Project struct leaves to flat dot-notated columns
      const copySql = `
        COPY (
          SELECT 
            target.host AS "target.host",
            target.ip AS "target.ip",
            target.geo.city AS "target.geo.city",
            "target.host" AS "dotted_alias",
            metadata['attack.tactic'] AS "metadata.attack_tactic"
          FROM read_json_auto('${safeJsonPath}')
        ) TO '${parquetOutPath}' (FORMAT PARQUET, COMPRESSION ZSTD);
      `;
      conn.all(copySql, (copyErr) => {
        if (copyErr) return reject(copyErr);
        conn.all(`SELECT * FROM read_parquet('${parquetOutPath}') WHERE "target.host" = 'srv-01'`, (readErr, pRows) => {
          if (readErr) return reject(readErr);
          const ok = pRows.length === 1 &&
            pRows[0]["target.host"] === "srv-01" &&
            pRows[0]["target.geo.city"] === "Hanoi" &&
            pRows[0]["dotted_alias"] === "dotted_alias_01" &&
            pRows[0]["metadata.attack_tactic"] === "Lateral Movement";
          report(
            "NESTED_JSON.8 Direct Ingestion Two-Phase Auto-Flatten writes flat columnar Parquet with dot-notated columns",
            ok,
            `host: ${pRows[0]?.["target.host"]}, city: ${pRows[0]?.["target.geo.city"]}, alias: ${pRows[0]?.["dotted_alias"]}`
          );
          resolve();
        });
      });
    });

    if (fs.existsSync(parquetOutPath)) fs.unlinkSync(parquetOutPath);

  } finally {
    if (fs.existsSync(tmpJsonPath)) {
      fs.unlinkSync(tmpJsonPath);
    }
  }

  console.log(`\n${BOLD}======================================================================${RESET}`);
  console.log(`  NESTED JSON & SEMI-STRUCTURED SUITE SUMMARY: ${passedCount}/${totalCount} PASSED`);
  console.log(`${BOLD}======================================================================${RESET}\n`);

  if (passedCount !== totalCount) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
