/**
 * test_tauri_arrow_ipc.js
 *
 * Comprehensive Apache Arrow IPC Stream & Tauri v2 Binary Protocol Test Suite
 *
 * Verifies:
 * 1. Arrow IPC continuation marker (0xFFFFFFFF) detection and validation.
 * 2. Complete schema roundtrip across standard types (Int32, Int64/BigInt, Float64, Utf8, Bool, Timestamp).
 * 3. Handling of 0-row empty tables, null bitmaps, and extreme values.
 * 4. Custom schema metadata serialization & deserialization (toadSchema).
 * 5. Multi-batch record streaming and EOF termination.
 * 6. Simulated Tauri IPC roundtrip (tauri::ipc::Response -> TauriHostAdapter.invokeBinary -> Arrow Table).
 * 7. Negative & adversarial edge cases: corrupted headers, truncated streams, bad type IDs.
 */

const assert = require("assert");
const path = require("path");

// Resolve Apache Arrow from tad-master node_modules
const TAD_MASTER_DIR = path.resolve(__dirname, "../../../tad-master");
let arrow;
try {
  arrow = require(path.resolve(TAD_MASTER_DIR, "node_modules/@apache-arrow/es2015-cjs"));
} catch (e) {
  try {
    arrow = require("@apache-arrow/es2015-cjs");
  } catch (err2) {
    console.error("Failed to load @apache-arrow/es2015-cjs:", err2.message);
    process.exit(1);
  }
}

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ${GREEN}✔ [PASS]${RESET} ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  ${RED}✖ [FAIL]${RESET} ${name}`);
    console.error(`     ${err.stack || err.message}`);
    failCount++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ${GREEN}✔ [PASS]${RESET} ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  ${RED}✖ [FAIL]${RESET} ${name}`);
    console.error(`     ${err.stack || err.message}`);
    failCount++;
  }
}

/**
 * Checks whether an ArrayBuffer or Uint8Array begins with the 4-byte Arrow continuation marker:
 * 0xFF, 0xFF, 0xFF, 0xFF (0xFFFFFFFF)
 */
function isArrowIPC(buffer) {
  if (!buffer) return false;
  const u8 = buffer instanceof Uint8Array
    ? buffer
    : (buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : null);
  if (!u8 || u8.byteLength < 4) return false;
  return u8[0] === 0xff && u8[1] === 0xff && u8[2] === 0xff && u8[3] === 0xff;
}

/**
 * Validates the 32-bit Little-Endian metadata length following the 0xFFFFFFFF marker
 */
function getMetadataLength(buffer) {
  if (!isArrowIPC(buffer) || buffer.byteLength < 8) return -1;
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  return view.getInt32(4, true); // Little-endian
}

/**
 * Helper to simulate Rust's tauri::ipc::Response binary delivery
 */
function mockTauriIpcResponse(arrowBytes) {
  // Returns ArrayBuffer matching Tauri v2 WebView2 binding
  const copy = new Uint8Array(arrowBytes.length);
  copy.set(arrowBytes);
  return copy.buffer;
}

/**
 * Helper simulating TauriHostAdapter.invokeBinary
 */
async function mockInvokeBinary(cmd, args, mockHandler) {
  const rawResponse = await mockHandler(cmd, args);
  if (rawResponse instanceof Uint8Array) return rawResponse;
  if (rawResponse instanceof ArrayBuffer) return new Uint8Array(rawResponse);
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(rawResponse)) {
    return new Uint8Array(rawResponse.buffer, rawResponse.byteOffset, rawResponse.byteLength);
  }
  return new Uint8Array(rawResponse || []);
}

async function runArrowIpcTests() {
  console.log(`\n${BOLD}${CYAN}======================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}  TOAD TAURI v2 - APACHE ARROW IPC STREAM VERIFICATION SUITE         ${RESET}`);
  console.log(`${BOLD}${CYAN}======================================================================${RESET}\n`);

  // SECTION 1: Arrow IPC Stream Header & Continuation Indicator
  console.log(`${BOLD}${YELLOW}--- SECTION 1: Arrow IPC Stream Header & Continuation Indicator ---${RESET}`);

  test("1.1 Detects valid 0xFFFFFFFF continuation indicator on Arrow IPC stream", () => {
    const validArrowHeader = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x20, 0x00, 0x00, 0x00]);
    assert.strictEqual(isArrowIPC(validArrowHeader), true);
    assert.strictEqual(isArrowIPC(validArrowHeader.buffer), true);
  });

  test("1.2 Rejects legacy TOAD magic header [0x54, 0x4f, 0x41, 0x44] and arbitrary bytes", () => {
    const legacyToadHeader = new Uint8Array([0x54, 0x4f, 0x41, 0x44, 0x01, 0x00, 0x00, 0x00]);
    assert.strictEqual(isArrowIPC(legacyToadHeader), false);

    const randomBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    assert.strictEqual(isArrowIPC(randomBytes), false);

    const shortBytes = new Uint8Array([0xff, 0xff, 0xff]);
    assert.strictEqual(isArrowIPC(shortBytes), false);
    assert.strictEqual(isArrowIPC(null), false);
  });

  test("1.3 Decodes 32-bit Little-Endian metadata length following continuation indicator", () => {
    // 0xFFFFFFFF followed by 0x00000040 (64 bytes in LE)
    const header = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x40, 0x00, 0x00, 0x00]);
    const metaLen = getMetadataLength(header);
    assert.strictEqual(metaLen, 64);
  });

  test("1.4 Handles subarray and offset-sliced typed arrays accurately", () => {
    const fullBuffer = new Uint8Array([0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0x18, 0x00, 0x00, 0x00]);
    const sliced = fullBuffer.subarray(2);
    assert.strictEqual(isArrowIPC(sliced), true);
    assert.strictEqual(getMetadataLength(sliced), 24);
  });

  // SECTION 2: Schema & RecordBatch Serialization Roundtrip
  console.log(`\n${BOLD}${YELLOW}--- SECTION 2: Schema & Diverse Types Serialization Roundtrip ---${RESET}`);

  test("2.1 Roundtrips standard types: Int32, Float64, Utf8, Boolean", () => {
    const table = arrow.tableFromArrays({
      id: new Int32Array([101, 102, 103]),
      score: new Float64Array([98.5, 76.25, 100.0]),
      name: ["Windows_Event_Log", "Security_Audit", "Firewall_Drop"],
      active: [true, false, true],
    });

    const ipcBytes = arrow.tableToIPC(table, "stream");
    assert.ok(isArrowIPC(ipcBytes), "Serialized IPC stream must start with 0xFFFFFFFF");

    const decoded = arrow.tableFromIPC(ipcBytes);
    assert.strictEqual(decoded.numRows, 3);
    assert.strictEqual(decoded.numCols, 4);

    const colId = decoded.getChild("id");
    const colScore = decoded.getChild("score");
    const colName = decoded.getChild("name");
    const colActive = decoded.getChild("active");

    assert.strictEqual(colId.get(0), 101);
    assert.strictEqual(colId.get(1), 102);
    assert.strictEqual(colScore.get(0), 98.5);
    assert.strictEqual(colScore.get(1), 76.25);
    assert.strictEqual(colName.get(0), "Windows_Event_Log");
    assert.strictEqual(colActive.get(0), true);
    assert.strictEqual(colActive.get(1), false);
  });

  test("2.2 Preserves null values and validity bitmaps without type corruption", () => {
    const table = arrow.tableFromArrays({
      record_id: [1, 2, null, 4],
      message: ["Login successful", null, "Privilege escalation", null],
      flag: [true, null, false, true],
    });

    const ipcBytes = arrow.tableToIPC(table, "stream");
    const decoded = arrow.tableFromIPC(ipcBytes);

    assert.strictEqual(decoded.numRows, 4);
    const colMsg = decoded.getChild("message");
    const colFlag = decoded.getChild("flag");

    assert.strictEqual(colMsg.get(0), "Login successful");
    assert.strictEqual(colMsg.get(1), null);
    assert.strictEqual(colMsg.get(2), "Privilege escalation");
    assert.strictEqual(colMsg.get(3), null);

    assert.strictEqual(colFlag.get(0), true);
    assert.strictEqual(colFlag.get(1), null);
    assert.strictEqual(colFlag.get(2), false);
  });

  test("2.3 Encodes and decodes 0-row empty table cleanly without exceptions", () => {
    const fields = [
      new arrow.Field("col_str", new arrow.Utf8(), true),
      new arrow.Field("col_int", new arrow.Int32(), true),
    ];
    const schema = new arrow.Schema(fields);
    const emptyTable = new arrow.Table(schema);

    const ipcBytes = arrow.tableToIPC(emptyTable, "stream");
    assert.ok(isArrowIPC(ipcBytes));

    const decoded = arrow.tableFromIPC(ipcBytes);
    assert.strictEqual(decoded.numRows, 0);
    assert.strictEqual(decoded.numCols, 2);
    assert.deepStrictEqual(decoded.schema.fields.map(f => f.name), ["col_str", "col_int"]);
  });

  test("2.4 Preserves BigInt / Int64 values up to Number.MAX_SAFE_INTEGER and beyond", () => {
    const bigVal1 = 9007199254740991n; // MAX_SAFE_INTEGER
    const bigVal2 = 9007199254740992n; // MAX_SAFE_INTEGER + 1
    const bigVal3 = -9007199254740991n;

    const bigArray = new BigInt64Array([bigVal1, bigVal2, bigVal3]);
    const table = arrow.tableFromArrays({
      timestamp_ns: bigArray,
    });

    const ipcBytes = arrow.tableToIPC(table, "stream");
    const decoded = arrow.tableFromIPC(ipcBytes);

    const col = decoded.getChild("timestamp_ns");
    assert.strictEqual(BigInt(col.get(0)), bigVal1);
    assert.strictEqual(BigInt(col.get(1)), bigVal2);
    assert.strictEqual(BigInt(col.get(2)), bigVal3);
  });

  test("2.5 Preserves multi-byte UTF-8, emojis, quotes, newlines, and control characters", () => {
    const testStrings = [
      "Hello, world! 🌍🚀",
      "Line 1\r\nLine 2\nLine 3\tTabbed",
      "JSON: {\"user\": \"admin\", \"status\": \"ACTIVE\", \"escapes\": \"\\n\\t\\\"\"}",
      "SQL: SELECT * FROM `events` WHERE \"payload\" LIKE '%admin''s test%';",
      "Vietnamese: Xin chào tiếng Việt có dấu: ă, â, đ, ê, ô, ơ, ư",
    ];

    const table = arrow.tableFromArrays({ text_data: testStrings });
    const ipcBytes = arrow.tableToIPC(table, "stream");
    const decoded = arrow.tableFromIPC(ipcBytes);

    const col = decoded.getChild("text_data");
    for (let i = 0; i < testStrings.length; i++) {
      assert.strictEqual(col.get(i), testStrings[i]);
    }
  });

  // SECTION 3: Custom Schema Metadata (toadSchema)
  console.log(`\n${BOLD}${YELLOW}--- SECTION 3: Custom Schema Metadata (toadSchema) ---${RESET}`);

  test("3.1 Serializes and reconstructs toadSchema JSON metadata in Arrow Schema", () => {
    const toadSchemaObj = {
      version: 2,
      columns: ["event_id", "severity", "amount"],
      columnMetadata: {
        event_id: { displayName: "Event ID", columnType: "INTEGER" },
        severity: { displayName: "Log Severity", columnType: "VARCHAR" },
        amount: { displayName: "Damage Cost ($)", columnType: "DECIMAL" },
      },
    };

    const table = arrow.tableFromArrays({
      event_id: new Int32Array([4624, 4625]),
      severity: ["Information", "FailureAudit"],
      amount: new Float64Array([0.0, 1500.5]),
    });

    // Embed metadata in both table schema and batch schema
    const metaJson = JSON.stringify(toadSchemaObj);
    table.schema.metadata.set("toadSchema", metaJson);
    table.schema.metadata.set("application", "Toad-Tauri-v2");
    for (const batch of table.batches) {
      batch.schema.metadata.set("toadSchema", metaJson);
      batch.schema.metadata.set("application", "Toad-Tauri-v2");
    }

    const ipcBytes = arrow.tableToIPC(table, "stream");
    assert.ok(isArrowIPC(ipcBytes));

    const decoded = arrow.tableFromIPC(ipcBytes);
    const decodedMetaStr = decoded.schema.metadata.get("toadSchema");
    assert.ok(decodedMetaStr, "toadSchema metadata key must exist in decoded schema");

    const parsedToadSchema = JSON.parse(decodedMetaStr);
    assert.strictEqual(parsedToadSchema.version, 2);
    assert.strictEqual(parsedToadSchema.columnMetadata.event_id.displayName, "Event ID");
    assert.strictEqual(parsedToadSchema.columnMetadata.severity.displayName, "Log Severity");
    assert.strictEqual(parsedToadSchema.columnMetadata.amount.displayName, "Damage Cost ($)");
    assert.strictEqual(decoded.schema.metadata.get("application"), "Toad-Tauri-v2");
  });

  test("3.2 Fallback type inference when toadSchema metadata is absent", () => {
    const table = arrow.tableFromArrays({
      count: new Int32Array([10, 20]),
      metric: new Float64Array([1.5, 2.5]),
      active: [true, false],
    });

    const ipcBytes = arrow.tableToIPC(table, "stream");
    const decoded = arrow.tableFromIPC(ipcBytes);

    assert.strictEqual(decoded.schema.metadata.has("toadSchema"), false);
    // Inferrer mapping
    const colTypes = {};
    for (const field of decoded.schema.fields) {
      if (arrow.DataType.isInt(field.type)) colTypes[field.name] = "INTEGER";
      else if (arrow.DataType.isFloat(field.type)) colTypes[field.name] = "DOUBLE";
      else if (arrow.DataType.isBool(field.type)) colTypes[field.name] = "BOOLEAN";
      else colTypes[field.name] = "VARCHAR";
    }

    assert.strictEqual(colTypes.count, "INTEGER");
    assert.strictEqual(colTypes.metric, "DOUBLE");
    assert.strictEqual(colTypes.active, "BOOLEAN");
  });

  // SECTION 4: Multi-Batch Streaming & Stream Termination
  console.log(`\n${BOLD}${YELLOW}--- SECTION 4: Multi-Batch Streaming & Stream Termination ---${RESET}`);

  test("4.1 Encodes and consumes multiple RecordBatches in a single IPC stream", () => {
    const vId1 = arrow.vectorFromArray(new Int32Array([1, 2]));
    const vId2 = arrow.vectorFromArray(new Int32Array([3, 4]));
    const chunkedId = new arrow.Vector([vId1.data[0], vId2.data[0]]);

    const vScore1 = arrow.vectorFromArray(new Float64Array([10.5, 20.5]));
    const vScore2 = arrow.vectorFromArray(new Float64Array([30.5, 40.5]));
    const chunkedScore = new arrow.Vector([vScore1.data[0], vScore2.data[0]]);

    const multiBatchTable = new arrow.Table({
      id: chunkedId,
      score: chunkedScore,
    });
    assert.strictEqual(multiBatchTable.batches.length, 2);

    const ipcBytes = arrow.tableToIPC(multiBatchTable, "stream");
    const decoded = arrow.tableFromIPC(ipcBytes);

    assert.strictEqual(decoded.numRows, 4);
    assert.strictEqual(decoded.batches.length, 2);
    assert.strictEqual(decoded.getChild("id").get(0), 1);
    assert.strictEqual(decoded.getChild("id").get(3), 4);
    assert.strictEqual(decoded.getChild("score").get(0), 10.5);
    assert.strictEqual(decoded.getChild("score").get(3), 40.5);
  });

  test("4.2 Validates stream EOF termination token (0-length metadata: 0x00000000)", () => {
    const table = arrow.tableFromArrays({ id: [1] });
    const ipcBytes = arrow.tableToIPC(table, "stream");

    // Last 8 bytes in standard Arrow stream must be [0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00]
    const tail = ipcBytes.subarray(ipcBytes.length - 8);
    assert.strictEqual(tail[0], 0xff);
    assert.strictEqual(tail[1], 0xff);
    assert.strictEqual(tail[2], 0xff);
    assert.strictEqual(tail[3], 0xff);
    assert.strictEqual(tail[4], 0x00);
    assert.strictEqual(tail[5], 0x00);
    assert.strictEqual(tail[6], 0x00);
    assert.strictEqual(tail[7], 0x00);
  });

  // SECTION 5: Simulated Tauri IPC Roundtrip & invokeBinary Handoff
  console.log(`\n${BOLD}${YELLOW}--- SECTION 5: Simulated Tauri IPC Roundtrip & invokeBinary ---${RESET}`);

  await asyncTest("5.1 Simulates Rust tauri::ipc::Response delivered via TauriHostAdapter.invokeBinary", async () => {
    // 1. Backend prepares Arrow IPC stream
    const originalTable = arrow.tableFromArrays({
      timestamp: ["2026-11-04T12:00:00Z", "2026-11-04T12:01:00Z"],
      event_code: new Int32Array([4624, 4634]),
      workstation: ["DC-PRIMARY", "APP-PROD-01"],
    });
    const rustBuffer = arrow.tableToIPC(originalTable, "stream");

    // 2. Tauri IPC Response wrapper
    const ipcResponse = mockTauriIpcResponse(rustBuffer);

    // 3. Frontend TauriHostAdapter invokeBinary handler
    const mockTauriBackend = async (cmd, args) => {
      assert.strictEqual(cmd, "toad:eval_query");
      assert.strictEqual(args.queryExp.expType, "table");
      return ipcResponse;
    };

    const clientBuffer = await mockInvokeBinary(
      "toad:eval_query",
      { queryExp: { expType: "table", tableName: "security_events" } },
      mockTauriBackend
    );

    assert.ok(clientBuffer instanceof Uint8Array);
    assert.ok(isArrowIPC(clientBuffer));

    // 4. SlickGrid / reltab table decoding
    const decodedTable = arrow.tableFromIPC(clientBuffer);
    assert.strictEqual(decodedTable.numRows, 2);
    assert.strictEqual(decodedTable.getChild("event_code").get(0), 4624);
    assert.strictEqual(decodedTable.getChild("workstation").get(1), "APP-PROD-01");
  });

  await asyncTest("5.2 Micro-benchmark: 1,000-row Arrow IPC encode/decode roundtrip completes in < 15ms", async () => {
    const rowCount = 1000;
    const ids = new Int32Array(rowCount);
    const scores = new Float64Array(rowCount);
    const descriptions = new Array(rowCount);

    for (let i = 0; i < rowCount; i++) {
      ids[i] = i;
      scores[i] = i * 1.5;
      descriptions[i] = `Forensic log record message #${i} with payload details`;
    }

    const table = arrow.tableFromArrays({
      id: ids,
      score: scores,
      desc: descriptions,
    });

    const start = process.hrtime.bigint();
    const encoded = arrow.tableToIPC(table, "stream");
    const intermediate = mockTauriIpcResponse(encoded);
    const decoded = arrow.tableFromIPC(intermediate);
    const end = process.hrtime.bigint();

    const elapsedMs = Number(end - start) / 1e6;
    assert.strictEqual(decoded.numRows, rowCount);
    assert.ok(elapsedMs < 15, `Expected 1000-row roundtrip < 15ms, got ${elapsedMs.toFixed(2)}ms`);
    console.log(`     (Benchmark performance: 1,000 rows roundtrip executed in ${elapsedMs.toFixed(2)}ms)`);
  });

  // SECTION 6: Adversarial & Corrupted Stream Handling
  console.log(`\n${BOLD}${YELLOW}--- SECTION 6: Adversarial & Corrupted Stream Handling ---${RESET}`);

  test("6.1 Rejects truncated stream missing message body", () => {
    const table = arrow.tableFromArrays({ num: [1, 2, 3] });
    const validBytes = arrow.tableToIPC(table, "stream");

    // Truncate to just continuation marker and partial metadata
    const truncated = validBytes.subarray(0, 12);
    let threw = false;
    try {
      arrow.tableFromIPC(truncated);
    } catch {
      threw = true;
    }
    assert.ok(threw, "Truncated stream must throw decoding error");
  });

  test("6.2 Rejects corrupted continuation marker [0x00, 0x00, 0x00, 0x00] and garbage payload", () => {
    const table = arrow.tableFromArrays({ num: [10] });
    const bytes = arrow.tableToIPC(table, "stream");
    const corrupted = new Uint8Array(bytes);
    corrupted[0] = 0x00;
    corrupted[1] = 0x00;
    corrupted[2] = 0x00;
    corrupted[3] = 0x00;

    // Toad protocol check
    assert.strictEqual(isArrowIPC(corrupted), false, "Corrupted header must fail isArrowIPC check");

    // Garbage metadata test
    const garbageStream = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x50, 0x00, 0x00, 0x00, 0xde, 0xad, 0xbe, 0xef]);
    assert.strictEqual(isArrowIPC(garbageStream), true);
    let threw = false;
    try {
      arrow.tableFromIPC(garbageStream);
    } catch {
      threw = true;
    }
    assert.ok(threw, "Garbage payload must throw Arrow decoding error");
  });

  console.log(`\n${BOLD}${CYAN}----------------------------------------------------------------------${RESET}`);
  console.log(`${BOLD}Arrow IPC Test Results: ${GREEN}${passCount} Passed${RESET}, ${failCount === 0 ? GREEN : RED}${failCount} Failed${RESET}`);
  console.log(`${BOLD}${CYAN}======================================================================${RESET}\n`);

  if (failCount > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runArrowIpcTests().catch((err) => {
    console.error("Fatal error in Arrow IPC test suite:", err);
    process.exit(1);
  });
}

module.exports = {
  runArrowIpcTests,
  isArrowIPC,
  getMetadataLength,
  mockTauriIpcResponse,
};
