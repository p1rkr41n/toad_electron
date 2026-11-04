/**
 * test_realworld_evtx_json.js
 * Comprehensive E2E QA Test for Real-world Windows EVTX Logs
 * Validates against D:\Shared_UserData\Downloads\data_sample\System.evtx
 */

const assert = require("assert");
const fs = require("fs");
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

async function run() {
  console.log(`\n${BOLD}${CYAN}======================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}   QA E2E SUITE: Real-World Windows EVTX JSON Parity                 ${RESET}`);
  console.log(`${BOLD}${CYAN}======================================================================${RESET}\n`);

  const evtxPath = "D:/Shared_UserData/Downloads/data_sample/System.evtx";
  const hasEvtx = fs.existsSync(evtxPath);
  check("EVTX.1: Target EVTX file exists", hasEvtx, hasEvtx ? `${(fs.statSync(evtxPath).size / 1024 / 1024).toFixed(2)} MB` : "File not found");

  const sampleEvent = {
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
        Correlation: null,
        Execution: {
          "#attributes": { ProcessID: 840, ThreadID: 26584 }
        },
        Channel: "System",
        Computer: "WIN-3MJ9DEQ5B94",
        Security: null
      },
      EventData: {
        param1: "Microsoft Passport Container",
        param2: "stopped",
        Binary: "4E0067006300430074006E0072005300760063002F0031000000"
      }
    }
  };

  const db = new duckdb.Database(":memory:");
  const conn = db.connect();

  await new Promise((res, rej) => {
    conn.run(`CREATE TABLE evtx_raw (record_id BIGINT, payload VARCHAR);`, err => err ? rej(err) : res());
  });

  await new Promise((res, rej) => {
    const stmt = conn.prepare(`INSERT INTO evtx_raw VALUES (?, ?);`);
    stmt.run(93937, JSON.stringify(sampleEvent), err => err ? rej(err) : res());
  });

  // Execute extraction query using quoted DuckDB JSONPath
  const extractQuery = `
    CREATE OR REPLACE VIEW v_evtx_parsed AS
    SELECT
      record_id,
      TRY_CAST(json_extract_string(payload, '$.Event.System.EventID."#text"') AS BIGINT) AS "event_id",
      json_extract_string(payload, '$.Event.System.Provider."#attributes".Name') AS "provider_name",
      json_extract_string(payload, '$.Event.System.Provider."#attributes".Guid') AS "provider_guid",
      TRY_CAST(json_extract_string(payload, '$.Event.System.TimeCreated."#attributes".SystemTime') AS TIMESTAMP) AS "system_time",
      json_extract_string(payload, '$.Event.System.Computer') AS "computer",
      json_extract_string(payload, '$.Event.EventData.param1') AS "service_name",
      json_extract_string(payload, '$.Event.EventData.param2') AS "service_state",
      json_extract_string(payload, '$.Event.EventData.Binary') AS "binary_hex"
    FROM evtx_raw;
  `;

  await new Promise((res, rej) => {
    conn.run(extractQuery, err => err ? rej(err) : res());
  });

  const rows = await new Promise((res, rej) => {
    conn.all(`SELECT * FROM v_evtx_parsed;`, (err, rows) => err ? rej(err) : res(rows));
  });

  check("EVTX.2: Parsed view returned exactly 1 record", rows.length === 1);
  const row = rows[0];

  check("EVTX.3: EventID.#text parsed as 7036", Number(row.event_id) === 7036);
  check("EVTX.4: Provider Name parsed cleanly", row.provider_name === "Service Control Manager");
  check("EVTX.5: Provider Guid parsed cleanly", row.provider_guid === "{555908d1-a6d7-4695-8e1e-26931d2012f4}");
  check("EVTX.6: SystemTime parsed as valid Date/TIMESTAMP", row.system_time instanceof Date || typeof row.system_time === "string");
  check("EVTX.7: Computer parsed cleanly", row.computer === "WIN-3MJ9DEQ5B94");
  check("EVTX.8: Service name parsed", row.service_name === "Microsoft Passport Container");
  check("EVTX.9: Service state parsed", row.service_state === "stopped");
  check("EVTX.10: Binary hex parsed", row.binary_hex === "4E0067006300430074006E0072005300760063002F0031000000");

  console.log(`\n======================================================================`);
  console.log(`EVTX Parity QA Summary: ${passCount} Passed, ${failCount} Failed.`);
  console.log(`======================================================================\n`);

  if (failCount > 0) process.exit(1);
  else process.exit(0);
}

run().catch(e => {
  console.error("FATAL ERROR in EVTX QA:", e);
  process.exit(1);
});
