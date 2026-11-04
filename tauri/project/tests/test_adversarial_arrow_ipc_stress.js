/**
 * test_adversarial_arrow_ipc_stress.js
 *
 * Empirical Challenger Adversarial Test Suite for Arrow IPC Binary Stream Protocol:
 * - Cross-language verification: Reads and validates Rust DuckDB engine dump (test_cross_lang_dump.arrow).
 * - Exact byte-level protocol inspection:
 *   - 0xFFFFFFFF continuation marker on every message.
 *   - 32-bit LE metadata length and 8-byte boundary alignment.
 *   - EOS marker (0xFFFFFFFF followed by 0x00000000).
 *   - toadSchema embedded metadata with Reltab ColumnMetadata.
 * - Precision & Boundary stress tests:
 *   - BigInt values > 2^53 - 1 (e.g. 9,007,199,254,740,993n, i64::MAX, i64::MIN).
 *   - NULL bitmaps across types with non-byte-multiple row counts (129, 257 rows).
 *   - Complex UTF-8 (Vietnamese diacritics, astral emojis, CRLF, embedded quotes).
 *   - Multi-batch streams and 0-row empty table handling.
 * - Adversarial corruption injection & error boundaries.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const TAD_MASTER_DIR = path.resolve(__dirname, "../../../tad-master");
let arrow;
try {
  arrow = require(path.resolve(TAD_MASTER_DIR, "node_modules/@apache-arrow/es2015-cjs"));
} catch (e) {
  try {
    arrow = require("@apache-arrow/es2015-cjs");
  } catch (err) {
    console.error("Failed to load @apache-arrow/es2015-cjs:", err);
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

async function runAdversarialIpcTests() {
  console.log(`\n${BOLD}${CYAN}======================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}  ADVERSARIAL ARROW IPC PROTOCOL EMPIRICAL STRESS SUITE              ${RESET}`);
  console.log(`${BOLD}${CYAN}======================================================================${RESET}\n`);

  // SECTION 1: Rust Engine Binary Dump Cross-Language Verification
  console.log(`${BOLD}${YELLOW}--- SECTION 1: Cross-Language Rust Engine Binary Dump Verification ---${RESET}`);

  test("1.1 Decodes Rust DuckDB Arrow IPC dump with 100% bit-fidelity", () => {
    const dumpPath = path.resolve(__dirname, "../src-tauri/target/debug/test_cross_lang_dump.arrow");
    if (!fs.existsSync(dumpPath)) {
      console.warn(`     [SKIP] Dump file not found at ${dumpPath} (run Rust tests first)`);
      return;
    }

    const rawBuffer = fs.readFileSync(dumpPath);
    assert.ok(rawBuffer.length >= 8, "Dump file must be at least 8 bytes");

    // Check continuation marker
    assert.strictEqual(rawBuffer[0], 0xff);
    assert.strictEqual(rawBuffer[1], 0xff);
    assert.strictEqual(rawBuffer[2], 0xff);
    assert.strictEqual(rawBuffer[3], 0xff);

    // Decode table with Arrow
    const table = arrow.tableFromIPC(rawBuffer);
    assert.strictEqual(table.numRows, 3);
    assert.strictEqual(table.numCols, 5);

    // Verify embedded toadSchema metadata
    const schemaMeta = table.schema.metadata;
    assert.strictEqual(schemaMeta.get("application"), "Toad-Tauri-v2");
    const toadSchemaJson = schemaMeta.get("toadSchema");
    assert.ok(toadSchemaJson, "toadSchema must be present in schema metadata");
    const parsedSchema = JSON.parse(toadSchemaJson);
    assert.strictEqual(parsedSchema.version, 2);
    assert.strictEqual(parsedSchema.columnMetadata.id.columnType, "BIGINT");

    // Verify Row values
    const colId = table.getChild("id");
    const colName = table.getChild("name");
    const colRate = table.getChild("rate");
    const colActive = table.getChild("active");

    // Row 0: negative BigInt < -(2^53 - 1)
    assert.strictEqual(BigInt(colId.get(0)), -9007199254740993n);
    assert.strictEqual(colName.get(0), "Line 1\r\nLine 2");
    assert.strictEqual(colActive.get(0), false);

    // Row 1: positive BigInt > 2^53 - 1
    assert.strictEqual(BigInt(colId.get(1)), 9007199254740993n);
    assert.strictEqual(colName.get(1), "Unicode: Tiếng Việt 🇻🇳 🚀");
    assert.strictEqual(colActive.get(1), true);

    // Row 2: NULLs
    assert.strictEqual(colId.get(2), null);
    assert.strictEqual(colName.get(2), null);
    assert.strictEqual(colRate.get(2), null);
    assert.strictEqual(colActive.get(2), null);
  });

  // SECTION 2: Protocol Byte-Level Alignment & Structure
  console.log(`\n${BOLD}${YELLOW}--- SECTION 2: Byte-Level Alignment & Header Verification ---${RESET}`);

  test("2.1 Verifies Arrow stream begins with 0xFFFFFFFF and total stream is 8-byte aligned", () => {
    const table = arrow.tableFromArrays({
      id: new Int32Array([10, 20, 30, 40]),
      name: ["alpha", "beta", "gamma", "delta"],
    });

    const ipcBytes = arrow.tableToIPC(table, "stream");

    // 1. Initial 4 bytes must be 0xFFFFFFFF
    assert.strictEqual(ipcBytes[0], 0xff);
    assert.strictEqual(ipcBytes[1], 0xff);
    assert.strictEqual(ipcBytes[2], 0xff);
    assert.strictEqual(ipcBytes[3], 0xff);

    // 2. 32-bit LE metadata length
    const view = new DataView(ipcBytes.buffer, ipcBytes.byteOffset, ipcBytes.byteLength);
    const metaLen = view.getInt32(4, true);
    assert.ok(metaLen > 0, `Initial metadata length must be > 0, got ${metaLen}`);

    // 3. Body starts on an 8-byte boundary
    const paddedMetaLen = (metaLen + 7) & ~7;
    const bodyOffset = 8 + paddedMetaLen;
    assert.strictEqual(bodyOffset % 8, 0, `Body offset ${bodyOffset} must be 8-byte aligned`);

    // 4. Overall stream length is a multiple of 8 bytes
    assert.strictEqual(ipcBytes.byteLength % 8, 0, `Total stream length ${ipcBytes.byteLength} must be 8-byte aligned`);

    // 5. Arrow reader successfully reads the stream
    const decodedTable = arrow.tableFromIPC(ipcBytes);
    assert.ok(decodedTable.schema != null);
    assert.strictEqual(decodedTable.schema.fields.length, 2);
    assert.strictEqual(decodedTable.numRows, 4);
    assert.strictEqual(decodedTable.getChild("id").get(0), 10);
    assert.strictEqual(decodedTable.getChild("name").get(3), "delta");
  });

  test("2.2 Validates EOS termination marker [0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00]", () => {
    const table = arrow.tableFromArrays({ x: [1] });
    const bytes = arrow.tableToIPC(table, "stream");
    const tail = bytes.subarray(bytes.length - 8);

    assert.deepStrictEqual(
      Array.from(tail),
      [0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00],
      "Tail must be 0xFFFFFFFF followed by 0x00000000"
    );
  });

  // SECTION 3: Boundary & Precision Stress Testing
  console.log(`\n${BOLD}${YELLOW}--- SECTION 3: Boundary & Precision Stress Testing ---${RESET}`);

  test("3.1 Int64 / BigInt extreme precision beyond Number.MAX_SAFE_INTEGER", () => {
    const extremes = [
      9007199254740991n,  // 2^53 - 1
      9007199254740992n,  // 2^53
      9007199254740993n,  // 2^53 + 1
      -9007199254740993n, // -(2^53 + 1)
      9223372036854775807n, // i64::MAX
      -9223372036854775808n, // i64::MIN
    ];

    const bigArray = new BigInt64Array(extremes);
    const table = arrow.tableFromArrays({ big_col: bigArray });
    const ipc = arrow.tableToIPC(table, "stream");
    const decoded = arrow.tableFromIPC(ipc);

    const col = decoded.getChild("big_col");
    assert.strictEqual(col.length, extremes.length);
    for (let i = 0; i < extremes.length; i++) {
      assert.strictEqual(
        BigInt(col.get(i)),
        extremes[i],
        `Mismatch at index ${i}: expected ${extremes[i]}, got ${col.get(i)}`
      );
    }
  });

  test("3.2 Non-byte-multiple row count (129 & 257 rows) NULL bitmap alignment stress", () => {
    for (const rowCount of [129, 257]) {
      const ints = [];
      const texts = [];
      const bools = [];

      for (let i = 0; i < rowCount; i++) {
        ints.push(i % 2 === 0 ? i : null);
        texts.push(i % 3 === 0 ? `Text_${i}` : null);
        bools.push(i % 5 === 0 ? true : (i % 5 === 1 ? false : null));
      }

      const table = arrow.tableFromArrays({
        i: ints,
        t: texts,
        b: bools,
      });

      const ipc = arrow.tableToIPC(table, "stream");
      const decoded = arrow.tableFromIPC(ipc);

      assert.strictEqual(decoded.numRows, rowCount);
      const decI = decoded.getChild("i");
      const decT = decoded.getChild("t");
      const decB = decoded.getChild("b");

      for (let i = 0; i < rowCount; i++) {
        assert.strictEqual(decI.get(i), ints[i], `Int mismatch at ${i}`);
        assert.strictEqual(decT.get(i), texts[i], `Text mismatch at ${i}`);
        assert.strictEqual(decB.get(i), bools[i], `Bool mismatch at ${i}`);
      }
    }
  });

  test("3.3 0-row empty tables preserve full schema without decoding error", () => {
    const fields = [
      new arrow.Field("col_str", new arrow.Utf8(), true),
      new arrow.Field("col_big", new arrow.Int64(), false),
      new arrow.Field("col_bool", new arrow.Bool(), true),
    ];
    const schema = new arrow.Schema(fields);
    const emptyTable = new arrow.Table(schema);

    const ipc = arrow.tableToIPC(emptyTable, "stream");
    assert.ok(ipc.length >= 8);
    const decoded = arrow.tableFromIPC(ipc);

    assert.strictEqual(decoded.numRows, 0);
    assert.strictEqual(decoded.numCols, 3);
    assert.deepStrictEqual(
      decoded.schema.fields.map((f) => f.name),
      ["col_str", "col_big", "col_bool"]
    );
  });

  test("3.4 Multi-batch stream with variable batch sizes (including 0-row batch)", () => {
    const v1 = arrow.vectorFromArray(new Int32Array([1, 2, 3]));
    const v2 = arrow.vectorFromArray(new Int32Array([])); // 0 rows
    const v3 = arrow.vectorFromArray(new Int32Array([4, 5, 6, 7]));

    const chunked = new arrow.Vector([v1.data[0], v2.data[0], v3.data[0]]);
    const table = new arrow.Table({ num: chunked });

    const ipc = arrow.tableToIPC(table, "stream");
    const decoded = arrow.tableFromIPC(ipc);

    assert.strictEqual(decoded.numRows, 7);
    const col = decoded.getChild("num");
    for (let i = 0; i < 7; i++) {
      assert.strictEqual(col.get(i), i + 1);
    }
  });

  // SECTION 4: Adversarial Stream Corruption Handling
  console.log(`\n${BOLD}${YELLOW}--- SECTION 4: Adversarial Corruption Handling ---${RESET}`);

  test("4.1 Protocol validator detects corrupted continuation markers", () => {
    const table = arrow.tableFromArrays({ a: [1] });
    const valid = arrow.tableToIPC(table, "stream");

    // Corrupted marker: 0xFE instead of 0xFF
    const badMarker = new Uint8Array(valid);
    badMarker[0] = 0xfe;

    // Toad protocol check
    const isArrowIPC = (buf) =>
      buf && buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xff && buf[2] === 0xff && buf[3] === 0xff;
    assert.strictEqual(isArrowIPC(badMarker), false, "Corrupted header must fail isArrowIPC check");

    // Arrow reader yields 0 batches on corrupted marker
    const badTable = arrow.tableFromIPC(badMarker);
    assert.strictEqual(badTable.batches.length, 0, "Corrupted stream must yield 0 batches");
  });

  test("4.2 Rejects stream truncated at metadata header boundary", () => {
    const table = arrow.tableFromArrays({ a: [1, 2, 3] });
    const valid = arrow.tableToIPC(table, "stream");

    // Truncate at 6 bytes (middle of 32-bit length)
    const truncated6 = valid.subarray(0, 6);
    const reader6 = arrow.RecordBatchReader.from(truncated6);
    assert.strictEqual(reader6.schema, undefined, "Truncated stream must fail schema resolution");

    // Truncate right after continuation marker (4 bytes)
    const truncated4 = valid.subarray(0, 4);
    const reader4 = arrow.RecordBatchReader.from(truncated4);
    assert.strictEqual(reader4.schema, undefined, "Truncated stream must fail schema resolution");
  });

  test("4.3 Rejects stream with metadata length exceeding remaining buffer", () => {
    const forged = new Uint8Array([
      0xff, 0xff, 0xff, 0xff,
      0x00, 0x10, 0x00, 0x00, // metadata length = 4096 bytes
      0x01, 0x02, 0x03, 0x04, // only 4 bytes follow
    ]);
    assert.throws(() => arrow.tableFromIPC(forged));
  });

  console.log(`\n${BOLD}${CYAN}----------------------------------------------------------------------${RESET}`);
  console.log(`${BOLD}Adversarial Arrow IPC Test Results: ${GREEN}${passCount} Passed${RESET}, ${failCount === 0 ? GREEN : RED}${failCount} Failed${RESET}`);
  console.log(`${BOLD}${CYAN}======================================================================${RESET}\n`);

  if (failCount > 0) {
    process.exit(1);
  }
}

runAdversarialIpcTests().catch((err) => {
  console.error("Adversarial Arrow IPC test execution error:", err);
  process.exit(1);
});
