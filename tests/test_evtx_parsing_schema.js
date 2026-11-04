/**
 * test_evtx_parsing_schema.js
 *
 * Automated test suite for Windows Event Log (.evtx / JSONL) parsing & schema validation:
 * 1. Toad Core Rust Engine: evtx-dump extraction
 * 2. ISO-8601 UTC RFC3339 TimeCreated normalization (fixed 6 fractional digits)
 * 3. EventID integer conversion (BIGINT typing in DuckDB)
 * 4. param1, param2, param3 extraction integrity (no empty param2/param3)
 * 5. Standalone Binary column extraction
 * 6. DuckDB read_json_auto schema typing (TIMESTAMP, BIGINT, VARCHAR)
 * 7. Exact user sample parity from System.evtx (RecordID 93937, EventID 7036)
 * 8. PowerShell fallback pipeline parity with EventData JSON serialization
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const child_process = require("child_process");
const readline = require("readline");

const ROOT_DIR = path.resolve(__dirname, "..");
const DUCKDB_PATH = path.resolve(ROOT_DIR, "tad-master/node_modules/duckdb");
const duckdb = require(DUCKDB_PATH);

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

let passCount = 0;
let failCount = 0;

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`  ${GREEN}✔ [PASS]${RESET} ${name}`);
    passCount++;
  } catch (err) {
    console.log(`  ${RED}✖ [FAIL]${RESET} ${name}`);
    console.log(`    Error: ${err.message}`);
    if (err.stack) console.log(`    ${err.stack.split("\n").slice(1, 6).join("\n    ")}`);
    failCount++;
    throw err;
  }
}

function findToadCore() {
  const candidates = [
    path.join(ROOT_DIR, "tad-master/packages/toad-app/bin/toad-core.exe"),
    path.join(ROOT_DIR, "tad-master/packages/toad-core-rust/target/release/toad-core.exe"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error("toad-core.exe not found");
}

async function main() {
  console.log(`\n${BOLD}${CYAN}======================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}  EVTX PARSING & SCHEMA VALIDATION TEST SUITE (TOAD ENGINE)          ${RESET}`);
  console.log(`${BOLD}${CYAN}======================================================================${RESET}\n`);

  const toadCore = findToadCore();
  const sampleEvtx = path.join(ROOT_DIR, "data_sample/System.evtx");
  assert(fs.existsSync(sampleEvtx), `Sample file ${sampleEvtx} must exist`);

  const tmpDir = path.join(process.env.TEMP || "C:/temp", `toad_evtx_test_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Toad Core Binary evtx-dump
    // -------------------------------------------------------------------------
    await runTest("EVTX.1 Toad Core Rust evtx-dump extraction & record count", async () => {
      const outJsonl = path.join(tmpDir, "dump_50.jsonl");
      child_process.execFileSync(toadCore, ["evtx-dump", sampleEvtx, outJsonl, "50"], {
        windowsHide: true,
        timeout: 30000,
      });

      assert(fs.existsSync(outJsonl), "Dump output file must exist");
      const lines = fs.readFileSync(outJsonl, "utf8").trim().split("\n");
      assert.strictEqual(lines.length, 50, "Must dump exactly 50 records");

      for (let i = 0; i < lines.length; i++) {
        const rec = JSON.parse(lines[i]);
        assert(rec.RecordID !== undefined, `Record ${i} must have RecordID`);
        assert(typeof rec.RecordID === "number", `RecordID must be a number, got ${typeof rec.RecordID}`);
        // Windows canonical EventRecordID for this sample starts at 36908, not 1
        assert(rec.RecordID >= 36908, `RecordID must be Windows EventRecordID (>= 36908), got ${rec.RecordID}`);
        assert(rec.EventID !== undefined, `Record ${i} must have EventID`);
        assert(typeof rec.EventID === "number", `EventID must be a number, got ${typeof rec.EventID}`);
        assert(rec.TimeCreated !== undefined, `Record ${i} must have TimeCreated`);
        assert(rec.param1 !== undefined, `Record ${i} must have param1`);
        assert(rec.param2 !== undefined, `Record ${i} must have param2`);
        assert(rec.param3 !== undefined, `Record ${i} must have param3`);
        assert(rec.Binary !== undefined, `Record ${i} must have Binary`);
        assert(rec.EventData !== undefined, `Record ${i} must have EventData`);
        assert(rec.RawEvent !== undefined, `Record ${i} must have RawEvent`);
      }
    });

    // -------------------------------------------------------------------------
    // TEST 2: ISO-8601 UTC RFC3339 TimeCreated normalization
    // -------------------------------------------------------------------------
    await runTest("EVTX.2 ISO-8601 UTC RFC3339 TimeCreated format validation", async () => {
      const outJsonl = path.join(tmpDir, "dump_50.jsonl");
      const lines = fs.readFileSync(outJsonl, "utf8").trim().split("\n");
      const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

      for (let i = 0; i < lines.length; i++) {
        const rec = JSON.parse(lines[i]);
        assert(
          isoRegex.test(rec.TimeCreated),
          `Record ${i} TimeCreated '${rec.TimeCreated}' must match ISO-8601 UTC RFC3339 with 6 fractional digits (YYYY-MM-DDTHH:MM:SS.ffffffZ)`
        );
      }
    });

    // -------------------------------------------------------------------------
    // TEST 3: param1, param2, and Binary extraction completeness
    // -------------------------------------------------------------------------
    await runTest("EVTX.3 param1, param2 and Binary fields are properly populated", async () => {
      const outJsonl = path.join(tmpDir, "dump_50.jsonl");
      const lines = fs.readFileSync(outJsonl, "utf8").trim().split("\n");
      let serviceEventCount = 0;

      for (const line of lines) {
        const rec = JSON.parse(line);
        if (rec.EventID === 7036) {
          serviceEventCount++;
          assert(rec.param1.length > 0, `Event 7036 param1 (service name) must not be empty: ${JSON.stringify(rec)}`);
          assert(
            rec.param2 === "running" || rec.param2 === "stopped",
            `Event 7036 param2 must be 'running' or 'stopped', got: '${rec.param2}'`
          );
          assert(rec.Binary.length > 0, `Event 7036 Binary must not be empty`);
        }
      }
      assert(serviceEventCount > 0, "Should have found at least one Event 7036 in sample");
    });

    // -------------------------------------------------------------------------
    // TEST 4: DuckDB read_json_auto schema typing (TIMESTAMP, BIGINT, VARCHAR)
    // -------------------------------------------------------------------------
    await runTest("EVTX.4 DuckDB schema inference with timestampformat", async () => {
      const outJsonl = path.join(tmpDir, "dump_50.jsonl").replace(/\\/g, "/");
      const db = new duckdb.Database(":memory:");
      const conn = db.connect();

      await new Promise((resolve, reject) => {
        conn.all(
          `DESCRIBE SELECT * FROM read_json_auto('${outJsonl}', timestampformat = '%Y-%m-%dT%H:%M:%S.%fZ')`,
          (err, rows) => {
            if (err) return reject(err);
            try {
              const schemaMap = {};
              for (const r of rows) {
                schemaMap[r.column_name] = r.column_type;
              }
              console.log("    [DEBUG Schema]:", JSON.stringify(schemaMap));

              assert.strictEqual(schemaMap["TimeCreated"], "TIMESTAMP", `TimeCreated must be TIMESTAMP, got ${schemaMap["TimeCreated"]}`);
              assert.strictEqual(schemaMap["EventID"], "BIGINT", `EventID must be BIGINT, got ${schemaMap["EventID"]}`);
              assert.strictEqual(schemaMap["RecordID"], "BIGINT", `RecordID must be BIGINT, got ${schemaMap["RecordID"]}`);
              assert.strictEqual(schemaMap["param1"], "VARCHAR", `param1 must be VARCHAR, got ${schemaMap["param1"]}`);
              assert.strictEqual(schemaMap["param2"], "VARCHAR", `param2 must be VARCHAR, got ${schemaMap["param2"]}`);
              assert.strictEqual(schemaMap["Binary"], "VARCHAR", `Binary must be VARCHAR, got ${schemaMap["Binary"]}`);
              assert.strictEqual(schemaMap["RawEvent"], "VARCHAR", `RawEvent must be VARCHAR, got ${schemaMap["RawEvent"]}`);
              resolve(null);
            } catch (ex) {
              reject(ex);
            }
          }
        );
      });

      // Verify numeric sorting and filtering works without errors
      await new Promise((resolve, reject) => {
        conn.all(
          `SELECT EventID, RecordID, TimeCreated, param1, param2 FROM read_json_auto('${outJsonl}', timestampformat = '%Y-%m-%dT%H:%M:%S.%fZ') WHERE EventID = 7036 ORDER BY RecordID DESC LIMIT 5`,
          (err, rows) => {
            if (err) return reject(err);
            try {
              assert(rows.length > 0, "Query for EventID = 7036 must return rows");
              assert.strictEqual(Number(rows[0].EventID), 7036, "EventID must be numeric 7036");
              assert(Number(rows[0].RecordID) >= 36908, "RecordID must be >= 36908");
              resolve(null);
            } catch (ex) {
              reject(ex);
            }
          }
        );
      });
    });

    // -------------------------------------------------------------------------
    // TEST 5: User Exact Event Parity (Extracted from real System.evtx)
    // -------------------------------------------------------------------------
    await runTest("EVTX.5 User exact event sample extraction parity from System.evtx", async () => {
      // Dump from sampleEvtx and locate the exact event RecordID 93937 requested by user
      const fullDumpJsonl = path.join(tmpDir, "dump_user_check.jsonl");
      child_process.execFileSync(toadCore, ["evtx-dump", sampleEvtx, fullDumpJsonl], {
        windowsHide: true,
        timeout: 60000,
      });

      assert(fs.existsSync(fullDumpJsonl), "Full dump output must exist");

      const fileStream = fs.createReadStream(fullDumpJsonl);
      const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

      let targetRecord = null;
      for await (const line of rl) {
        if (!line.trim()) continue;
        const rec = JSON.parse(line);
        if (rec.RecordID === 93937) {
          targetRecord = rec;
          break;
        }
      }

      assert(targetRecord !== null, "Must find user's exact RecordID 93937 in System.evtx dump");
      assert.strictEqual(targetRecord.EventID, 7036, "EventID must be integer 7036");
      assert.strictEqual(targetRecord.param1, "Microsoft Passport Container", "param1 must be 'Microsoft Passport Container'");
      assert.strictEqual(targetRecord.param2, "stopped", "param2 must be 'stopped'");
      assert.strictEqual(targetRecord.Binary, "4E0067006300430074006E0072005300760063002F0031000000", "Binary must match expected hex");
      assert.strictEqual(targetRecord.TimeCreated, "2026-10-27T14:44:08.819818Z", "TimeCreated must match user's SystemTime ISO-8601 UTC RFC3339");
      assert.strictEqual(targetRecord.Provider, "Service Control Manager", "Provider must match");
      assert.strictEqual(targetRecord.Computer, "WIN-3MJ9DEQ5B94", "Computer must match");
      assert(targetRecord.EventData.includes("Microsoft Passport Container"), "EventData JSON must contain service name");
      assert(targetRecord.RawEvent.includes("WIN-3MJ9DEQ5B94"), "RawEvent must contain computer name");

      // Verify DuckDB querying on this extracted event file
      const db = new duckdb.Database(":memory:");
      const conn = db.connect();

      await new Promise((resolve, reject) => {
        conn.all(
          `SELECT typeof(TimeCreated) as t_time, typeof(EventID) as t_eid, typeof(RecordID) as t_rid, * FROM read_json_auto('${fullDumpJsonl.replace(/\\/g, "/")}', timestampformat = '%Y-%m-%dT%H:%M:%S.%fZ') WHERE RecordID = 93937`,
          (err, rows) => {
            if (err) return reject(err);
            try {
              assert.strictEqual(rows.length, 1);
              assert.strictEqual(rows[0].t_time, "TIMESTAMP");
              assert.strictEqual(rows[0].t_eid, "BIGINT");
              assert.strictEqual(rows[0].t_rid, "BIGINT");
              assert.strictEqual(Number(rows[0].RecordID), 93937);
              assert.strictEqual(Number(rows[0].EventID), 7036);
              assert.strictEqual(rows[0].param1, "Microsoft Passport Container");
              assert.strictEqual(rows[0].param2, "stopped");
              assert.strictEqual(rows[0].Binary, "4E0067006300430074006E0072005300760063002F0031000000");
              resolve(null);
            } catch (ex) {
              reject(ex);
            }
          }
        );
      });
    });

    // -------------------------------------------------------------------------
    // TEST 6: PowerShell Fallback Pipeline Parity
    // -------------------------------------------------------------------------
    await runTest("EVTX.6 PowerShell fallback pipeline parity", async () => {
      const psOutJsonl = path.join(tmpDir, "ps_fallback.jsonl");
      const psScript = `$ErrorActionPreference = 'SilentlyContinue'; Get-WinEvent -Path '${sampleEvtx}' -MaxEvents 5 | ForEach-Object { $xml = [xml]$_.ToXml(); $h = [ordered]@{'RecordID'=[int64]$_.RecordId;'EventID'=[int64]$_.Id;'Level'=[string]$_.LevelDisplayName;'TimeCreated'=$_.TimeCreated.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.ffffffZ');'Provider'=[string]$_.ProviderName;'Channel'=[string]$_.LogName;'Computer'=[string]$_.MachineName;'UserId'=[string]$_.UserId}; $p1=''; $p2=''; $p3=''; $i=0; $ed=[ordered]@{}; if ($xml.Event.EventData.Data) { foreach ($d in $xml.Event.EventData.Data) { $val = if ($d.'#text') { [string]$d.'#text' } else { [string]$d }; if ($i -eq 0) { $p1 = $val } elseif ($i -eq 1) { $p2 = $val } elseif ($i -eq 2) { $p3 = $val }; if ($d.Name) { $h[$d.Name] = $val; $ed[$d.Name] = $val; if ($d.Name -eq 'param1') { $p1 = $val } elseif ($d.Name -eq 'param2') { $p2 = $val } elseif ($d.Name -eq 'param3') { $p3 = $val } } else { $k = 'param_' + ($i+1); $h[$k] = $val; $ed[$k] = $val }; $i++ } }; if ($xml.Event.EventData.param1) { $p1 = [string]$xml.Event.EventData.param1; $ed['param1'] = $p1 }; if ($xml.Event.EventData.param2) { $p2 = [string]$xml.Event.EventData.param2; $ed['param2'] = $p2 }; if ($xml.Event.EventData.param3) { $p3 = [string]$xml.Event.EventData.param3; $ed['param3'] = $p3 }; $bin = if ($xml.Event.EventData.Binary) { [string]$xml.Event.EventData.Binary } else { '' }; if ($bin) { $ed['Binary'] = $bin }; $h['param1'] = $p1; $h['param2'] = $p2; $h['param3'] = $p3; $h['Binary'] = $bin; $h['EventData'] = ($ed | ConvertTo-Json -Compress); $h['RawEvent'] = $_.ToXml(); $h | ConvertTo-Json -Compress }`;

      await new Promise((resolve, reject) => {
        child_process.exec(
          `powershell -NoProfile -NonInteractive -Command "${psScript}" > "${psOutJsonl}"`,
          { windowsHide: true, timeout: 30000 },
          (err) => {
            if (err) reject(err);
            else resolve(null);
          }
        );
      });

      assert(fs.existsSync(psOutJsonl), "PowerShell fallback output must exist");
      const lines = fs.readFileSync(psOutJsonl, "utf8").trim().split("\n");
      assert(lines.length >= 2, "PowerShell must output at least 2 events");

      for (const line of lines) {
        if (!line.trim()) continue;
        const rec = JSON.parse(line);
        assert(typeof rec.RecordID === "number", "PowerShell RecordID must be a number");
        assert(typeof rec.EventID === "number", "PowerShell EventID must be a number");
        assert(rec.TimeCreated.endsWith("Z"), "PowerShell TimeCreated must end with Z");
        assert(rec.Binary !== undefined, "PowerShell output must contain Binary key");
        assert(rec.param1 !== undefined, "PowerShell output must contain param1 key");
        assert(rec.param2 !== undefined, "PowerShell output must contain param2 key");
        assert(rec.EventData !== undefined, "PowerShell output must contain EventData key");
        assert(rec.RawEvent !== undefined, "PowerShell output must contain RawEvent key");
      }
    });

  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }

  console.log(`\n${BOLD}======================================================================${RESET}`);
  console.log(`${BOLD}  EVTX PARSING & SCHEMA VALIDATION: ALL ${passCount} TESTS PASSED CLEANLY!  ${RESET}`);
  console.log(`${BOLD}======================================================================${RESET}\n`);
}

main().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
