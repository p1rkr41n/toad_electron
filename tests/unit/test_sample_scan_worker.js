/**
 * test_sample_scan_worker.js
 * Unit test suite for SampleScanWorker:
 * - Asynchronous chunked timeslicing (50-row chunks yielding to event loop)
 * - Preview scan (100 rows) vs deep scan (1,000 rows)
 * - Progress callback reporting ({ scanned, total, discoveredCount, percent })
 * - Cancellation / Abort mid-scan
 * - Preservation of user customizations (customColName, enabled) across scans
 * - Fill rate computation and DuckDB type promotion (BIGINT -> DOUBLE)
 * - Windows EVTX leaf schema discovery parity (#attributes, #text, @xmlns)
 * - Dirty & malformed JSON resilience
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Hook TypeScript compiler to require .ts files directly in Node.js
const ROOT_DIR = path.resolve(__dirname, "../..");
const ts = require(path.resolve(ROOT_DIR, "tad-master/node_modules/typescript"));

require.extensions[".ts"] = function (module, filename) {
  const content = fs.readFileSync(filename, "utf8");
  const result = ts.transpileModule(content, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    }
  });
  module._compile(result.outputText, filename);
};

const { SampleScanWorker } = require(path.resolve(
  ROOT_DIR,
  "tad-master/packages/toadviewer/src/workers/SampleScanWorker.ts"
));

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

let passCount = 0;
let failCount = 0;

function report(name, pass, detail) {
  if (pass) {
    passCount++;
    console.log(`  ${GREEN}✔ [PASS]${RESET} ${name}${detail ? ` - ${detail}` : ""}`);
  } else {
    failCount++;
    console.error(`  ${RED}✖ [FAIL]${RESET} ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

async function runTests() {
  console.log(`\n${BOLD}======================================================================${RESET}`);
  console.log(`${BOLD}   UNIT TEST SUITE: SampleScanWorker (TOAD v2.5.1 M3)                 ${RESET}`);
  console.log(`${BOLD}======================================================================${RESET}\n`);

  // ------------------------------------------------------------------
  // Test 1: Fast initial preview scan (100 rows) with chunked progress
  // ------------------------------------------------------------------
  try {
    const worker = new SampleScanWorker(50);
    const rows = [];
    for (let i = 0; i < 120; i++) {
      rows.push(JSON.stringify({
        id: i + 1,
        user: { name: `User_${i}`, role: i % 2 === 0 ? "admin" : "member" },
        active: i % 3 === 0,
        tags: ["alpha", "beta"],
        timestamp: "2026-11-04T08:00:00.000Z"
      }));
    }

    const progressReports = [];
    const res = await worker.scanPreview(rows, undefined, (p) => {
      progressReports.push({ ...p });
    });

    const isLimit100 = res.totalScanned === 100;
    const hasChunks = progressReports.length === 2; // 50, 100
    const finalProg = progressReports[progressReports.length - 1];
    const isProg100 = finalProg && finalProg.scanned === 100 && finalProg.percent === 100;

    const dotPaths = res.fields.map(f => f.dotPath);
    const hasRequiredPaths =
      dotPaths.includes("id") &&
      dotPaths.includes("user.name") &&
      dotPaths.includes("user.role") &&
      dotPaths.includes("active") &&
      dotPaths.includes("tags") &&
      dotPaths.includes("timestamp");

    report(
      "WORKER.1 Fast preview scan (100 rows) with chunked progress reporting",
      isLimit100 && hasChunks && isProg100 && hasRequiredPaths,
      `Scanned: ${res.totalScanned}, Chunks: ${progressReports.length}, Fields: ${res.fields.length}`
    );
  } catch (err) {
    report("WORKER.1 Fast preview scan", false, err.message);
  }

  // ------------------------------------------------------------------
  // Test 2: Deep scan up to 1,000 rows discovering rare fields
  // ------------------------------------------------------------------
  try {
    const worker = new SampleScanWorker(50);
    const rows = [];
    for (let i = 0; i < 1000; i++) {
      const obj = {
        common_id: i + 1,
        metadata: { host: `server-${i % 10}` }
      };
      // Rare field only in rows 850 to 860
      if (i >= 850 && i < 860) {
        obj.security = { alert_code: 9901, threat_level: "critical" };
      }
      rows.push(JSON.stringify(obj));
    }

    const progressReports = [];
    const res = await worker.scanDeep(rows, undefined, (p) => {
      progressReports.push(p.percent);
    });

    const is1000Scanned = res.totalScanned === 1000;
    const dotPaths = res.fields.map(f => f.dotPath);
    const rareAlertFound = dotPaths.includes("security.alert_code");
    const rareThreatFound = dotPaths.includes("security.threat_level");
    const chunkCount = progressReports.length; // 1000 / 50 = 20 chunks

    report(
      "WORKER.2 Deep scan (1,000 rows) across 20 chunks discovering rare fields (row 850+)",
      is1000Scanned && rareAlertFound && rareThreatFound && chunkCount === 20,
      `Chunks: ${chunkCount}, Rare fields discovered: security.alert_code (${res.fields.find(f => f.dotPath === "security.alert_code")?.fillRate})`
    );
  } catch (err) {
    report("WORKER.2 Deep scan (1,000 rows)", false, err.message);
  }

  // ------------------------------------------------------------------
  // Test 3: Abort / cancellation mid-scan
  // ------------------------------------------------------------------
  try {
    const worker = new SampleScanWorker(50);
    const rows = [];
    for (let i = 0; i < 1000; i++) {
      rows.push(JSON.stringify({ row: i + 1, payload: { a: i } }));
    }

    let progressCount = 0;
    const scanPromise = worker.scanDeep(rows, undefined, (p) => {
      progressCount++;
      // Abort after 3rd chunk (scanned 150 rows)
      if (p.scanned >= 150) {
        worker.abort();
      }
    });

    const res = await scanPromise;
    const isAborted = res.aborted === true && worker.isAborted() === true;
    const stoppedEarly = res.totalScanned < 1000 && res.totalScanned >= 150;

    report(
      "WORKER.3 Cancellation / Abort mid-scan stops worker cleanly without freezing",
      isAborted && stoppedEarly,
      `Stopped at row: ${res.totalScanned} of 1000, Progress updates: ${progressCount}`
    );
  } catch (err) {
    report("WORKER.3 Cancellation mid-scan", false, err.message);
  }

  // ------------------------------------------------------------------
  // Test 4: Accurate fill rate computation
  // ------------------------------------------------------------------
  try {
    const worker = new SampleScanWorker(50);
    const rows = [];
    for (let i = 0; i < 200; i++) {
      const obj = { always: i + 1 };
      if (i < 100) obj.half = `val_${i}`;
      if (i < 50) obj.quarter = true;
      rows.push(JSON.stringify(obj));
    }

    const res = await worker.scan(rows, { sampleLimit: 200 });
    const alwaysField = res.fields.find(f => f.dotPath === "always");
    const halfField = res.fields.find(f => f.dotPath === "half");
    const quarterField = res.fields.find(f => f.dotPath === "quarter");

    const passAlways = alwaysField && alwaysField.fillRate === 1.0;
    const passHalf = halfField && halfField.fillRate === 0.5;
    const passQuarter = quarterField && quarterField.fillRate === 0.25;

    report(
      "WORKER.4 Fill rate accurately computed across sample pool (1.0, 0.5, 0.25)",
      passAlways && passHalf && passQuarter,
      `always: ${alwaysField?.fillRate}, half: ${halfField?.fillRate}, quarter: ${quarterField?.fillRate}`
    );
  } catch (err) {
    report("WORKER.4 Fill rate accurately computed", false, err.message);
  }

  // ------------------------------------------------------------------
  // Test 5: Preservation of user renames and disabled state across scans
  // ------------------------------------------------------------------
  try {
    const initialWorker = new SampleScanWorker(50);
    const initialRows = [
      JSON.stringify({ user: { id: 1, name: "Alice" }, meta: { ip: "1.1.1.1" } }),
      JSON.stringify({ user: { id: 2, name: "Bob" }, meta: { ip: "2.2.2.2" } })
    ];

    const initialRes = await initialWorker.scanPreview(initialRows);

    // Simulate user editing fields in UI
    const userCustomizedFields = initialRes.fields.map(f => {
      if (f.dotPath === "user.name") {
        return { ...f, customColName: "UserName" };
      }
      if (f.dotPath === "meta.ip") {
        return { ...f, enabled: false };
      }
      return f;
    });

    // Deep scan with more rows and new field
    const deepRows = [
      JSON.stringify({ user: { id: 1, name: "Alice" }, meta: { ip: "1.1.1.1" }, new_metric: 42 }),
      JSON.stringify({ user: { id: 2, name: "Bob" }, meta: { ip: "2.2.2.2" }, new_metric: 84 }),
      JSON.stringify({ user: { id: 3, name: "Charlie" }, meta: { ip: "3.3.3.3" }, new_metric: 126 })
    ];

    const deepWorker = new SampleScanWorker(50);
    const deepRes = await deepWorker.scanDeep(deepRows, userCustomizedFields);

    const userNameField = deepRes.fields.find(f => f.dotPath === "user.name");
    const metaIpField = deepRes.fields.find(f => f.dotPath === "meta.ip");
    const newMetricField = deepRes.fields.find(f => f.dotPath === "new_metric");

    const preservedRename = userNameField && userNameField.customColName === "UserName";
    const preservedDisabled = metaIpField && metaIpField.enabled === false;
    const newFieldAdded = newMetricField && newMetricField.enabled === true;
    const newCountCorrect = deepRes.newFieldsCount === 1;

    report(
      "WORKER.5 User column renames and disabled toggles preserved across scans",
      preservedRename && preservedDisabled && newFieldAdded && newCountCorrect,
      `Renamed: "${userNameField?.customColName}", meta.ip enabled: ${metaIpField?.enabled}, new fields count: ${deepRes.newFieldsCount}`
    );
  } catch (err) {
    report("WORKER.5 User column renames preserved", false, err.message);
  }

  // ------------------------------------------------------------------
  // Test 6: Dynamic DuckDB type promotion across chunks (BIGINT -> DOUBLE)
  // ------------------------------------------------------------------
  try {
    const worker = new SampleScanWorker(50);
    const rows = [];
    // Chunk 1: all integers
    for (let i = 0; i < 50; i++) {
      rows.push(JSON.stringify({ value: i + 1 }));
    }
    // Chunk 2: floating point value
    rows.push(JSON.stringify({ value: 99.75 }));
    for (let i = 51; i < 100; i++) {
      rows.push(JSON.stringify({ value: i }));
    }

    const res = await worker.scanPreview(rows);
    const valueField = res.fields.find(f => f.dotPath === "value");
    const isDouble = valueField && valueField.inferredType === "DOUBLE";

    report(
      "WORKER.6 Inferred DuckDB type automatically promoted from BIGINT to DOUBLE on decimal values",
      isDouble,
      `Inferred type: ${valueField?.inferredType}`
    );
  } catch (err) {
    report("WORKER.6 Type promotion", false, err.message);
  }

  // ------------------------------------------------------------------
  // Test 7: Windows EVTX Record 93937 schema parity across chunks
  // ------------------------------------------------------------------
  try {
    const evtxRecord = {
      Event: {
        "#attributes": { xmlns: "http://schemas.microsoft.com/win/2004/08/events/event" },
        System: {
          Provider: { "#attributes": { Name: "Service Control Manager", Guid: "{555908d1-a6d7-4695-8e1e-26931b2012f4}" } },
          EventID: { "#attributes": { Qualifiers: 16384 }, "#text": 7036 },
          Version: 0,
          Level: 4,
          Task: 0,
          Opcode: 0,
          Keywords: "0x8080000000000000",
          TimeCreated: { "#attributes": { SystemTime: "2026-10-27T14:44:08.819818Z" } },
          EventRecordID: 93937,
          Correlation: null,
          Execution: { "#attributes": { ProcessID: 808, ThreadID: 3512 } },
          Channel: "System",
          Computer: "SEC-OPS-DC01.corp.internal",
          Security: { "#attributes": { UserID: "S-1-5-18" } }
        }
      }
    };

    const worker = new SampleScanWorker(50);
    const rows = [];
    for (let i = 0; i < 100; i++) {
      rows.push(JSON.stringify(evtxRecord));
    }

    const res = await worker.scanPreview(rows);
    const paths = res.fields.map(f => f.dotPath);

    const requiredEvtxPaths = [
      "Event.#attributes.xmlns",
      "Event.System.Provider.#attributes.Name",
      "Event.System.Provider.#attributes.Guid",
      "Event.System.EventID.#attributes.Qualifiers",
      "Event.System.EventID.#text",
      "Event.System.TimeCreated.#attributes.SystemTime",
      "Event.System.EventRecordID",
      "Event.System.Execution.#attributes.ProcessID",
      "Event.System.Execution.#attributes.ThreadID",
      "Event.System.Computer",
      "Event.System.Security.#attributes.UserID"
    ];

    const matchedAll = requiredEvtxPaths.every(p => paths.includes(p));
    const timeCreatedField = res.fields.find(f => f.dotPath === "Event.System.TimeCreated.#attributes.SystemTime");
    const isTimestamp = timeCreatedField && timeCreatedField.inferredType === "TIMESTAMP";
    const eventIdField = res.fields.find(f => f.dotPath === "Event.System.EventID.#text");
    const isBigInt = eventIdField && eventIdField.inferredType === "BIGINT";

    report(
      "WORKER.7 Windows EVTX Record 93937 100% leaf discovery parity (#attributes, #text)",
      matchedAll && isTimestamp && isBigInt,
      `Matched ${requiredEvtxPaths.length} EVTX leaves, TimeCreated is TIMESTAMP, EventID is BIGINT`
    );
  } catch (err) {
    report("WORKER.7 Windows EVTX leaf parity", false, err.message);
  }

  // ------------------------------------------------------------------
  // Test 8: Malformed & dirty data resilience
  // ------------------------------------------------------------------
  try {
    const worker = new SampleScanWorker(50);
    const rows = [
      "{ corrupted json broken",
      "",
      null,
      undefined,
      42,
      JSON.stringify({ valid_id: 1, message: "OK 1" }),
      "not a json line at all",
      JSON.stringify({ valid_id: 2, message: "OK 2" }),
      "{ \"unclosed\": true",
      JSON.stringify({ valid_id: 3, message: "OK 3" })
    ];

    const res = await worker.scanPreview(rows);
    const validIdField = res.fields.find(f => f.dotPath === "valid_id");
    const messageField = res.fields.find(f => f.dotPath === "message");

    const passValidFields = validIdField && messageField;
    const validCount = res.validRowCount === 3;

    report(
      "WORKER.8 Dirty and malformed JSON rows gracefully skipped without throwing error",
      passValidFields && validCount,
      `Valid rows processed: ${res.validRowCount} of ${rows.length}`
    );
  } catch (err) {
    report("WORKER.8 Malformed JSON resilience", false, err.message);
  }

  // ------------------------------------------------------------------
  // Test 9: Object input support (pre-parsed objects)
  // ------------------------------------------------------------------
  try {
    const worker = new SampleScanWorker(50);
    const rows = [
      { num: 10, data: { status: "active" } },
      { num: 20, data: { status: "inactive" } }
    ];

    const res = await worker.scanPreview(rows);
    const numField = res.fields.find(f => f.dotPath === "num");
    const statusField = res.fields.find(f => f.dotPath === "data.status");

    report(
      "WORKER.9 Direct object input rows supported seamlessly (pre-parsed RAM objects)",
      numField && statusField,
      `Fields: ${res.fields.map(f => f.dotPath).join(", ")}`
    );
  } catch (err) {
    report("WORKER.9 Direct object input", false, err.message);
  }

  // ------------------------------------------------------------------
  // Test 10: Timeslicing latency & responsiveness check
  // ------------------------------------------------------------------
  try {
    const worker = new SampleScanWorker(50);
    const rows = [];
    for (let i = 0; i < 500; i++) {
      rows.push(JSON.stringify({
        a: i,
        b: { c: i * 2, d: `str_${i}` },
        ts: "2026-11-04T08:00:00Z"
      }));
    }

    const t0 = Date.now();
    let tickCount = 0;
    const timer = setInterval(() => {
      tickCount++;
    }, 1);

    const res = await worker.scan(rows, { sampleLimit: 500, chunkSize: 50 });
    clearInterval(timer);
    const elapsed = Date.now() - t0;

    // Because worker yields to event loop via setTimeout(0), the interval timer should tick
    const hasYielded = tickCount > 0;
    const fastExecution = elapsed < 2000;

    report(
      "WORKER.10 Chunked timeslicing yields to event loop without freezing execution thread",
      hasYielded && fastExecution && res.totalScanned === 500,
      `Elapsed: ${elapsed}ms, Event loop ticks during scan: ${tickCount}`
    );
  } catch (err) {
    report("WORKER.10 Timeslicing latency check", false, err.message);
  }

  console.log(`\n${BOLD}======================================================================${RESET}`);
  console.log(`  ${BOLD}SAMPLE SCAN WORKER SUMMARY: ${passCount}/10 PASSED${RESET}`);
  console.log(`${BOLD}======================================================================${RESET}\n`);

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests();
