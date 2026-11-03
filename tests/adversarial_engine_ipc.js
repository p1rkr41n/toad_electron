/**
 * ADVERSARIAL CHALLENGE HARNESS: MessagePort Transport, Hybrid Wire Protocol & Concurrency
 * Archetype: EMPIRICAL CHALLENGER (challenger_ipc_1)
 * Roles: critic, specialist
 *
 * Comprehensive Empirical Adversarial Test Matrix:
 * 1. Wire Protocol & Binary Corruption Vectors (Truncation, magic bytes, version mismatch, buffer overrun, corrupted JSON)
 * 2. Malformed Packets & Error Handling Resilience (No ID, unknown cmd, invalid SQL syntax, malformed queryStr, non-existent tables)
 * 3. High-Concurrency Interleaved Queries (200 & 500 concurrent in-flight queries over single MessagePort, race condition & crosstalk test)
 * 4. Zero-Copy Transferable ArrayBuffer Integrity (Bit-level magic bytes, 4 concurrent streams with Unicode, numeric extremes, NULLs)
 * 5. Large Result Sets (5,000+ & 10,000 rows) Memory, Throughput & Boundary Limits (limit 0, offset beyond rowCount, heap delta)
 */

const { MessageChannel } = require("worker_threads");
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const { performance } = require("perf_hooks");

const ROOT = path.resolve(__dirname, "..");
module.paths.push(path.resolve(ROOT, "tad-master/node_modules"));
module.paths.push(path.resolve(ROOT, "tad-master/packages/reltab-duckdb/node_modules"));

const reltab = require(path.resolve(ROOT, "tad-master/packages/reltab/dist/reltab"));
const {
  startEngineService,
  EngineService,
} = require(path.resolve(ROOT, "tad-master/packages/toad-app/dist/app/engineService"));

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

let totalChallenges = 0;
let passedChallenges = 0;
let failedChallenges = 0;
const failureDetails = [];
const findingsList = [];

function suiteHeader(title) {
  console.log(`\n${BOLD}======================================================================${RESET}`);
  console.log(`${BOLD}  ${title}${RESET}`);
  console.log(`${BOLD}======================================================================${RESET}`);
}

async function runChallenge(name, fn) {
  totalChallenges++;
  const t0 = performance.now();
  try {
    await fn();
    const ms = (performance.now() - t0).toFixed(2);
    passedChallenges++;
    console.log(`  ${GREEN}✓ [PASS]${RESET} ${name} (${ms} ms)`);
  } catch (err) {
    failedChallenges++;
    failureDetails.push({ name, error: err.message, stack: err.stack });
    console.error(`  ${RED}✗ [FAIL]${RESET} ${name}`);
    console.error(`    ${RED}Error: ${err.message}${RESET}`);
  }
}

async function main() {
  console.log(`${BOLD}${CYAN}======================================================================`);
  console.log(`   ADVERSARIAL CHALLENGER: ENGINE SERVICE & HYBRID PROTOCOL QA        `);
  console.log(`======================================================================${RESET}`);

  // Setup shared engine service and MessagePort
  const { port1, port2 } = new MessageChannel();
  const engine = await startEngineService({ dataPort: port2 });
  const transport = new reltab.MessagePortTransport(port1);

  const dummyClient = {
    invoke: async () => { throw new Error("Fallback invoke not allowed in MessagePort test"); }
  };
  const rtc = new reltab.RemoteReltabConnection(dummyClient, port1);
  const dsConn = await rtc.connect({ providerName: "duckdb", resourceId: "" });

  // ------------------------------------------------------------------
  // SUITE 1: WIRE PROTOCOL & BINARY CORRUPTION VECTORS
  // ------------------------------------------------------------------
  suiteHeader("SUITE 1: Wire Protocol & Binary Corruption Vectors");

  await runChallenge("1.1 Truncated buffer (< 12 bytes: 0, 4, 8, 11 bytes)", async () => {
    for (const size of [0, 4, 8, 11]) {
      const buf = new Uint8Array(size).buffer;
      assert.throws(
        () => reltab.decodeTableRepBinary(buf),
        /buffer too short/i,
        `Buffer of size ${size} must throw 'buffer too short'`
      );
    }
  });

  await runChallenge("1.2 Corrupted magic bytes ('DEAD', 'TOAx', zeroes)", async () => {
    const validDummy = new Uint8Array(16);
    // Set magic bytes to 'DEAD' (0x44, 0x45, 0x41, 0x44)
    validDummy[0] = 0x44; validDummy[1] = 0x45; validDummy[2] = 0x41; validDummy[3] = 0x44;
    assert.throws(
      () => reltab.decodeTableRepBinary(validDummy.buffer),
      /invalid magic bytes/i,
      "Magic bytes 'DEAD' must throw 'invalid magic bytes'"
    );

    // Set magic bytes to 'TOAx'
    validDummy[0] = 0x54; validDummy[1] = 0x4f; validDummy[2] = 0x41; validDummy[3] = 0x78;
    assert.throws(
      () => reltab.decodeTableRepBinary(validDummy.buffer),
      /invalid magic bytes/i,
      "Magic bytes 'TOAx' must throw 'invalid magic bytes'"
    );
  });

  await runChallenge("1.3 Unsupported protocol version (version 0, 2, 9999)", async () => {
    const buf = new ArrayBuffer(20);
    const u8 = new Uint8Array(buf);
    const view = new DataView(buf);
    // 'TOAD'
    u8[0] = 0x54; u8[1] = 0x4f; u8[2] = 0x41; u8[3] = 0x44;

    for (const badVer of [0, 2, 9999]) {
      view.setUint32(4, badVer, true);
      view.setUint32(8, 0, true);
      assert.throws(
        () => reltab.decodeTableRepBinary(buf),
        /unsupported protocol version/i,
        `Version ${badVer} must throw 'unsupported protocol version'`
      );
    }
  });

  await runChallenge("1.4 Buffer overrun attack (metadata length exceeds actual buffer size)", async () => {
    const buf = new ArrayBuffer(24);
    const u8 = new Uint8Array(buf);
    const view = new DataView(buf);
    // 'TOAD'
    u8[0] = 0x54; u8[1] = 0x4f; u8[2] = 0x41; u8[3] = 0x44;
    view.setUint32(4, 1, true); // Version 1
    view.setUint32(8, 5000000, true); // 5 MB claimed metadata length on a 24-byte buffer!

    assert.throws(
      () => reltab.decodeTableRepBinary(buf),
      /corrupted packet, metadata length exceeds buffer/i,
      "Buffer overrun metadata length must throw 'corrupted packet'"
    );
  });

  await runChallenge("1.5 Corrupted metadata JSON string (garbage UTF-8 in metadata block)", async () => {
    const badJsonStr = "{ invalid_meta_json: true, ";
    const metaBytes = new TextEncoder().encode(badJsonStr);
    const totalLen = 12 + metaBytes.length;
    const buf = new ArrayBuffer(totalLen);
    const u8 = new Uint8Array(buf);
    const view = new DataView(buf);
    u8[0] = 0x54; u8[1] = 0x4f; u8[2] = 0x41; u8[3] = 0x44;
    view.setUint32(4, 1, true);
    view.setUint32(8, metaBytes.length, true);
    u8.set(metaBytes, 12);

    assert.throws(
      () => reltab.decodeTableRepBinary(buf),
      SyntaxError,
      "Malformed metadata JSON must throw SyntaxError"
    );
  });

  await runChallenge("1.6 Corrupted row data JSON string (garbage UTF-8 in row data block)", async () => {
    // Valid schema metadata using reltab.DuckDBDialect
    const schema = new reltab.Schema(reltab.DuckDBDialect, ["col1"], {
      col1: { displayName: "col1", columnType: "INTEGER" }
    });
    const metadata = {
      version: 1,
      rowCount: 5,
      columnCount: schema.columns.length,
      columns: schema.columns,
      schema: schema.toJSON()
    };
    const metaBytes = new TextEncoder().encode(JSON.stringify(metadata));
    const badRowBytes = new TextEncoder().encode("[{ col1: 1 }, broken_json");
    const totalLen = 12 + metaBytes.length + badRowBytes.length;
    const buf = new ArrayBuffer(totalLen);
    const u8 = new Uint8Array(buf);
    const view = new DataView(buf);
    u8[0] = 0x54; u8[1] = 0x4f; u8[2] = 0x41; u8[3] = 0x44;
    view.setUint32(4, 1, true);
    view.setUint32(8, metaBytes.length, true);
    u8.set(metaBytes, 12);
    u8.set(badRowBytes, 12 + metaBytes.length);

    assert.throws(
      () => reltab.decodeTableRepBinary(buf),
      SyntaxError,
      "Malformed row data JSON must throw SyntaxError"
    );
  });

  await runChallenge("1.7 Zero-row TableRep encoding and decoding roundtrip", async () => {
    const schema = new reltab.Schema(reltab.DuckDBDialect, ["id", "name"], {
      id: { displayName: "id", columnType: "INTEGER" },
      name: { displayName: "name", columnType: "VARCHAR" }
    });
    const emptyTable = new reltab.TableRep(schema, []);
    const { buffer } = reltab.encodeTableRepBinary(emptyTable);
    assert(buffer.byteLength >= 12, "Empty table buffer must have header");
    const decoded = reltab.decodeTableRepBinary(buffer);
    assert.strictEqual(decoded.rowData.length, 0, "Decoded empty table must have 0 rows");
    assert.deepStrictEqual(decoded.schema.columns, ["id", "name"], "Schema columns preserved");
  });

  await runChallenge("1.8 Non-buffer / invalid inputs rejection", async () => {
    for (const badInput of [null, undefined, 12345, "string-buffer", {}, []]) {
      assert.throws(
        () => reltab.decodeTableRepBinary(badInput),
        /invalid input/i,
        `Input ${badInput} must throw 'invalid input'`
      );
    }
  });

  // ------------------------------------------------------------------
  // SUITE 2: MALFORMED PACKETS & ENGINE ERROR RESILIENCE
  // ------------------------------------------------------------------
  suiteHeader("SUITE 2: Malformed Packets & Engine Error Resilience");

  await runChallenge("2.1 Packets with missing or non-number ID ignored cleanly", async () => {
    // Send unnumbered messages directly to port2
    port1.postMessage({ cmd: "ping" }); // No id
    port1.postMessage({ id: "string-id-99", cmd: "ping" }); // String id
    port1.postMessage(null); // null
    port1.postMessage("raw text message"); // raw string

    // Service must remain alive and respond to valid ping with numeric id
    const pingResp = await transport.request("ping", {});
    assert.strictEqual(pingResp, "pong", "Engine must still respond to valid ping");
  });

  await runChallenge("2.2 Unknown command rejection over MessagePort", async () => {
    let rejected = false;
    try {
      await transport.request("unknownExploitCommand", { payload: 123 });
    } catch (err) {
      rejected = true;
      assert(/unknown engine command/i.test(err.message), `Expected unknown command error, got: ${err.message}`);
    }
    assert.strictEqual(rejected, true, "Unknown command must reject promise cleanly");
  });

  await runChallenge("2.3 Invalid SQL table in runSqlQuery rejects cleanly without crashing engine", async () => {
    let rejected = false;
    try {
      await dsConn.runSqlQuery("SELECT * FROM non_existent_adversarial_table_9999");
    } catch (err) {
      rejected = true;
      assert(err.message.length > 0, "Error must contain descriptive message");
    }
    assert.strictEqual(rejected, true, "Querying non-existent table must reject");
  });

  await runChallenge("2.4 Incomplete/malformed SQL syntax rejects cleanly", async () => {
    let rejected = false;
    try {
      await dsConn.runSqlQuery("SELECT FROM WHERE ;;;");
    } catch (err) {
      rejected = true;
      assert(err.message.length > 0, "Error must contain syntax error details");
    }
    assert.strictEqual(rejected, true, "Malformed SQL syntax must reject");
  });

  await runChallenge("2.5 Malformed queryStr in evalQuery rejects cleanly", async () => {
    let rejected = false;
    try {
      await transport.request("evalQuery", {
        engine: { providerName: "duckdb", resourceId: "" },
        queryStr: "{ malformed json string without close",
      });
    } catch (err) {
      rejected = true;
      assert(err instanceof Error, "Must return deserialized Error instance");
    }
    assert.strictEqual(rejected, true, "Malformed queryStr in evalQuery must reject");
  });

  await runChallenge("2.6 Malformed queryStr in rowCount rejects cleanly", async () => {
    let rejected = false;
    try {
      await transport.request("rowCount", {
        engine: { providerName: "duckdb", resourceId: "" },
        queryStr: "NOT A VALID JSON",
      });
    } catch (err) {
      rejected = true;
    }
    assert.strictEqual(rejected, true, "Malformed queryStr in rowCount must reject");
  });

  await runChallenge("2.7 Non-existent table in getTableSchema rejects cleanly", async () => {
    let rejected = false;
    try {
      await dsConn.getTableSchema("non_existent_schema_target_table");
    } catch (err) {
      rejected = true;
    }
    assert.strictEqual(rejected, true, "getTableSchema on non-existent table must reject");
  });

  await runChallenge("2.8 Post-error resilience: engine survives 7 consecutive errors and runs normally", async () => {
    const pingResp = await transport.request("ping", {});
    assert.strictEqual(pingResp, "pong", "Engine must be alive and operational after errors");

    const status = await transport.request("status", {});
    assert.strictEqual(status.state, "running", "Engine state must be 'running'");
    assert(status.queryCount > 0, "Query counter must reflect handled queries");
  });

  await runChallenge("2.9 Request on closed transport behavior (Verify immediate reject vs permanent hang)", async () => {
    const { port1: temp1, port2: temp2 } = new MessageChannel();
    const tempTransport = new reltab.MessagePortTransport(temp1);
    tempTransport.close();

    let hung = true;
    let rejectedImmediately = false;
    tempTransport.request("ping", {}).catch(() => {
      hung = false;
      rejectedImmediately = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    if (hung) {
      findingsList.push({
        severity: "LOW",
        title: "MessagePortTransport.request() on closed transport hangs indefinitely",
        description: "Calling request() after close() silently registers the promise in pendingReqs and calls postMessage on a closed port without checking isClosed or setting port to null, causing callers to await forever.",
      });
      console.log(`    ${YELLOW}⚠ Finding detected: request() on closed transport hung indefinitely instead of rejecting immediately!${RESET}`);
    } else {
      assert.strictEqual(rejectedImmediately, true);
    }
    temp2.close && temp2.close();
  });

  // ------------------------------------------------------------------
  // SUITE 3: HIGH-CONCURRENCY INTERLEAVED QUERIES (RACE CONDITIONS)
  // ------------------------------------------------------------------
  suiteHeader("SUITE 3: High-Concurrency Interleaved Queries (Race Conditions)");

  // Setup test fixture table with 200 rows
  await dsConn.runSqlQuery(`
    CREATE OR REPLACE TABLE test_concurrency_fixture (
      id INTEGER,
      tag VARCHAR,
      val DOUBLE,
      active BOOLEAN
    );
  `);
  const rowsSql = [];
  for (let i = 1; i <= 200; i++) {
    rowsSql.push(`(${i}, 'TAG-${i}', ${(i * 1.5).toFixed(2)}, ${i % 2 === 0})`);
  }
  await dsConn.runSqlQuery(`INSERT INTO test_concurrency_fixture VALUES ${rowsSql.join(",")};`);

  const concurrencyQuery = reltab.tableQuery("test_concurrency_fixture");

  await runChallenge("3.1 200 concurrent interleaved in-flight queries over single MessagePort", async () => {
    const CONCURRENT_COUNT = 200;
    const promises = [];
    const tStart = performance.now();

    for (let i = 0; i < CONCURRENT_COUNT; i++) {
      const mode = i % 4;
      if (mode === 0) {
        // evalQuery with specific offset: row at index 0 must have id = offset + 1
        const offset = (i * 3) % 150;
        const limit = 10;
        const p = dsConn.evalQuery(concurrencyQuery, offset, limit).then((res) => {
          assert.strictEqual(res.rowData.length, limit, `Query #${i} expected ${limit} rows`);
          assert.strictEqual(res.getRow(0).id, offset + 1, `Query #${i} offset mismatch! Expected ${offset + 1}, got ${res.getRow(0).id}`);
          return { type: "evalQuery", index: i, ok: true };
        });
        promises.push(p);
      } else if (mode === 1) {
        // rowCount
        const p = dsConn.rowCount(concurrencyQuery).then((cnt) => {
          assert.strictEqual(cnt, 200, `Query #${i} expected rowCount 200, got ${cnt}`);
          return { type: "rowCount", index: i, ok: true };
        });
        promises.push(p);
      } else if (mode === 2) {
        // getTableSchema
        const p = dsConn.getTableSchema("test_concurrency_fixture").then((schema) => {
          assert.deepStrictEqual(schema.columns, ["id", "tag", "val", "active"], `Query #${i} schema mismatch`);
          return { type: "getTableSchema", index: i, ok: true };
        });
        promises.push(p);
      } else {
        // runSqlQuery
        const targetId = (i % 200) + 1;
        const p = dsConn.runSqlQuery(`SELECT id, tag FROM test_concurrency_fixture WHERE id = ${targetId}`).then((rows) => {
          assert.strictEqual(rows.length, 1, `Query #${i} expected 1 row`);
          assert.strictEqual(rows[0].id, targetId, `Query #${i} expected id ${targetId}, got ${rows[0].id}`);
          return { type: "runSqlQuery", index: i, ok: true };
        });
        promises.push(p);
      }
    }

    const results = await Promise.all(promises);
    const duration = performance.now() - tStart;
    assert.strictEqual(results.length, CONCURRENT_COUNT, "All 200 concurrent queries must resolve");
    console.log(`    ${CYAN}→ 200 concurrent queries resolved in ${duration.toFixed(2)} ms (${(duration / CONCURRENT_COUNT).toFixed(2)} ms/op)${RESET}`);
  });

  await runChallenge("3.2 500 burst rapid interleaved queries with zero cross-talk or ID collision", async () => {
    const BURST_COUNT = 500;
    const promises = [];
    const tStart = performance.now();

    for (let i = 0; i < BURST_COUNT; i++) {
      const targetId = (i % 200) + 1;
      const p = dsConn.runSqlQuery(`SELECT id, val FROM test_concurrency_fixture WHERE id = ${targetId}`).then((rows) => {
        assert.strictEqual(rows[0].id, targetId, `Query #${i} cross-talk detected! Expected ${targetId}, got ${rows[0].id}`);
        return true;
      });
      promises.push(p);
    }

    const results = await Promise.all(promises);
    const duration = performance.now() - tStart;
    assert.strictEqual(results.length, BURST_COUNT);
    console.log(`    ${CYAN}→ 500 burst queries resolved in ${duration.toFixed(2)} ms (${(duration / BURST_COUNT).toFixed(2)} ms/op)${RESET}`);
  });

  // ------------------------------------------------------------------
  // SUITE 4: ZERO-COPY TRANSFERABLE ARRAYBUFFER INTEGRITY & MULTI-STREAM
  // ------------------------------------------------------------------
  suiteHeader("SUITE 4: Zero-Copy Transferable ArrayBuffer Integrity & Multi-Stream");

  // Create 4 distinct tables representing adversarial data profiles
  await dsConn.runSqlQuery(`
    CREATE OR REPLACE TABLE stream_unicode (
      id INTEGER,
      text_vn VARCHAR,
      text_emoji VARCHAR,
      text_special VARCHAR
    );
    INSERT INTO stream_unicode VALUES
      (1, 'Động cơ phân tích phục hồi tự động', '🚀⚡🔥💻🎉', 'Quotes "double" and ''single'' and \\backslashes\\ and \ttabs\t and \nnewlines\n'),
      (2, 'Tiếng Việt có dấu: ẵ, ặ, ẳ, ấ, ầ, ẩ, ẫ, ậ, ơ, ở, ỡ, ờ, ợ, ư, ừ, ử, ữ, ự', '🐸🐢🐍🐊', '<xml id="123">&amp; &lt; &gt;</xml>'),
      (3, 'Cà phê sữa đá Sài Gòn', '✨🌟⭐', 'Special regex chars: .*+?^$\\{}()|[]/');

    CREATE OR REPLACE TABLE stream_numerics (
      id INTEGER,
      d_max DOUBLE,
      d_min DOUBLE,
      d_zero DOUBLE,
      d_neg DOUBLE,
      int_big BIGINT
    );
    INSERT INTO stream_numerics VALUES
      (1, 1.7976931348623157e+308, 5e-324, 0.0, -0.0, 9223372036854775807),
      (2, 1e-10, -1e-10, 1000000.999, -9999999.999, -9223372036854775808),
      (3, 42.0, -42.0, 3.141592653589793, -2.718281828459045, 0);

    CREATE OR REPLACE TABLE stream_nulls (
      id INTEGER,
      nullable_str VARCHAR,
      nullable_int INTEGER,
      nullable_bool BOOLEAN
    );
    INSERT INTO stream_nulls VALUES
      (1, NULL, NULL, NULL),
      (2, 'not-null', 42, true),
      (3, NULL, 99, false),
      (4, 'has-string', NULL, NULL);

    CREATE OR REPLACE TABLE stream_types (
      id INTEGER,
      created_date DATE,
      is_active BOOLEAN
    );
    INSERT INTO stream_types VALUES
      (1, DATE '2026-11-03', true),
      (2, DATE '2000-01-01', false),
      (3, DATE '2038-01-19', true);
  `);

  await runChallenge("4.1 Direct inspection of Transferable ArrayBuffer 'TOAD' magic bytes and header", async () => {
    const rawPacket = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Raw packet timeout")), 5000);
      const handler = (event) => {
        const data = event?.data?.id !== undefined ? event.data : event;
        if (data && data.id === 7777) {
          clearTimeout(timeout);
          port1.off ? port1.off("message", handler) : port1.removeListener("message", handler);
          resolve(data);
        }
      };
      if (typeof port1.on === "function") port1.on("message", handler);
      else port1.addEventListener("message", handler);

      port1.postMessage({
        id: 7777,
        cmd: "evalQuery",
        payload: {
          engine: { providerName: "duckdb", resourceId: "" },
          queryStr: JSON.stringify(reltab.tableQuery("stream_unicode")),
        },
      });
    });

    assert.strictEqual(rawPacket.ok, true);
    assert.strictEqual(rawPacket.binary, true);
    assert(rawPacket.buffer instanceof ArrayBuffer, "Must transfer an ArrayBuffer instance");

    const u8 = new Uint8Array(rawPacket.buffer);
    assert.strictEqual(u8[0], 0x54, "Byte 0 == 'T'");
    assert.strictEqual(u8[1], 0x4f, "Byte 1 == 'O'");
    assert.strictEqual(u8[2], 0x41, "Byte 2 == 'A'");
    assert.strictEqual(u8[3], 0x44, "Byte 3 == 'D'");

    const view = new DataView(rawPacket.buffer);
    const ver = view.getUint32(4, true);
    const metaLen = view.getUint32(8, true);
    assert.strictEqual(ver, 1, "Protocol version must be 1");
    assert(metaLen > 0, "Metadata length must be positive");
    assert(rawPacket.buffer.byteLength >= 12 + metaLen, "Buffer must contain metadata");
  });

  await runChallenge("4.2 Concurrent multi-stream execution: verify cell-exact data fidelity", async () => {
    const qUnicode = dsConn.evalQuery(reltab.tableQuery("stream_unicode"));
    const qNumerics = dsConn.evalQuery(reltab.tableQuery("stream_numerics"));
    const qNulls = dsConn.evalQuery(reltab.tableQuery("stream_nulls"));
    const qTypes = dsConn.evalQuery(reltab.tableQuery("stream_types"));

    const [tUnicode, tNumerics, tNulls, tTypes] = await Promise.all([
      qUnicode, qNumerics, qNulls, qTypes
    ]);

    // Verify stream_unicode
    assert.strictEqual(tUnicode.rowData.length, 3);
    assert.strictEqual(tUnicode.getRow(0).text_vn, "Động cơ phân tích phục hồi tự động");
    assert.strictEqual(tUnicode.getRow(0).text_emoji, "🚀⚡🔥💻🎉");
    assert(tUnicode.getRow(0).text_special.includes("\\backslashes\\"));
    assert.strictEqual(tUnicode.getRow(1).text_emoji, "🐸🐢🐍🐊");

    // Verify stream_numerics
    assert.strictEqual(tNumerics.rowData.length, 3);
    assert.strictEqual(tNumerics.getRow(0).d_max, 1.7976931348623157e+308);
    assert.strictEqual(tNumerics.getRow(0).int_big, 9223372036854775807n, "64-bit signed int max must match exactly");
    assert.strictEqual(tNumerics.getRow(1).int_big, -9223372036854775808n, "64-bit signed int min must match exactly");
    assert.strictEqual(tNumerics.getRow(2).id, 3);
    assert.strictEqual(tNumerics.getRow(2).d_zero, 3.141592653589793);

    // Verify stream_nulls
    assert.strictEqual(tNulls.rowData.length, 4);
    assert.strictEqual(tNulls.getRow(0).nullable_str, null);
    assert.strictEqual(tNulls.getRow(0).nullable_int, null);
    assert.strictEqual(tNulls.getRow(0).nullable_bool, null);
    assert.strictEqual(tNulls.getRow(1).nullable_str, "not-null");
    assert.strictEqual(tNulls.getRow(1).nullable_int, 42);
    assert.strictEqual(tNulls.getRow(1).nullable_bool, true);
    assert.strictEqual(tNulls.getRow(2).nullable_str, null);
    assert.strictEqual(tNulls.getRow(2).nullable_int, 99);
    assert.strictEqual(tNulls.getRow(2).nullable_bool, false);

    // Verify stream_types
    assert.strictEqual(tTypes.rowData.length, 3);
    assert.strictEqual(tTypes.getRow(0).is_active, true);
    assert.strictEqual(tTypes.getRow(1).is_active, false);
  });

  // ------------------------------------------------------------------
  // SUITE 5: LARGE RESULT SETS (5,000+ ROWS) MEMORY & BOUNDARIES
  // ------------------------------------------------------------------
  suiteHeader("SUITE 5: Large Result Sets (5,000+ & 10,000 Rows), Throughput & Boundaries");

  console.log("  Populating large test table: 10,000 rows x 8 columns...");
  await dsConn.runSqlQuery(`
    CREATE OR REPLACE TABLE test_large_dataset (
      row_id INTEGER,
      sku VARCHAR,
      category VARCHAR,
      unit_price DOUBLE,
      quantity INTEGER,
      in_stock BOOLEAN,
      created_date VARCHAR,
      notes VARCHAR
    );
  `);

  // Batch insert 10,000 rows
  const BATCH_SIZE = 1000;
  for (let batch = 0; batch < 10; batch++) {
    const batchRows = [];
    for (let r = 1; r <= BATCH_SIZE; r++) {
      const id = batch * BATCH_SIZE + r;
      const cat = ["Electronics", "Appliances", "Books", "Clothing", "Toys"][id % 5];
      const price = ((id * 7.77) % 999 + 1).toFixed(2);
      const qty = (id * 13) % 500;
      const stock = id % 3 !== 0;
      const note = id % 7 === 0 ? "NULL" : `'Auto generated benchmark record #${id}'`;
      batchRows.push(`(${id}, 'SKU-${100000 + id}', '${cat}', ${price}, ${qty}, ${stock}, '2026-11-03', ${note})`);
    }
    await dsConn.runSqlQuery(`INSERT INTO test_large_dataset VALUES ${batchRows.join(",")};`);
  }

  const largeCount = await dsConn.rowCount(reltab.tableQuery("test_large_dataset"));
  assert.strictEqual(largeCount, 10000, "Fixture table must have exactly 10,000 rows");
  console.log(`  ✔ Fixture table populated with ${largeCount} rows.`);

  const largeQuery = reltab.tableQuery("test_large_dataset");

  await runChallenge("5.1 Querying 5,000 rows in single batch over MessagePort (throughput & integrity)", async () => {
    const t0 = performance.now();
    const res = await dsConn.evalQuery(largeQuery, 0, 5000);
    const elapsedMs = performance.now() - t0;

    assert.strictEqual(res.rowData.length, 5000, "Must return exactly 5,000 rows");
    assert.strictEqual(res.getRow(0).row_id, 1, "First row id must be 1");
    assert.strictEqual(res.getRow(2499).row_id, 2500, "Middle row id must be 2500");
    assert.strictEqual(res.getRow(4999).row_id, 5000, "Last row id must be 5000");

    const rowsPerSec = ((5000 / elapsedMs) * 1000).toFixed(0);
    console.log(`    ${CYAN}→ 5,000 rows transferred & decoded in ${elapsedMs.toFixed(2)} ms (${rowsPerSec} rows/sec)${RESET}`);
  });

  await runChallenge("5.2 Querying 10,000 rows (full table) over MessagePort & Memory Stability", async () => {
    // Record memory before
    if (global.gc) global.gc();
    const memBefore = process.memoryUsage();

    const t0 = performance.now();
    const res = await dsConn.evalQuery(largeQuery, 0, 10000);
    const elapsedMs = performance.now() - t0;

    assert.strictEqual(res.rowData.length, 10000, "Must return exactly 10,000 rows");
    assert.strictEqual(res.getRow(0).row_id, 1);
    assert.strictEqual(res.getRow(9999).row_id, 10000);

    const memAfter = process.memoryUsage();
    const heapDeltaMb = (memAfter.heapUsed - memBefore.heapUsed) / (1024 * 1024);

    console.log(`    ${CYAN}→ 10,000 rows transferred in ${elapsedMs.toFixed(2)} ms, Heap delta: ${heapDeltaMb.toFixed(2)} MB${RESET}`);
    assert(heapDeltaMb < 100, `Heap memory growth for 10k rows must be < 100 MB (measured: ${heapDeltaMb.toFixed(2)} MB)`);
  });

  await runChallenge("5.3 Boundary: Offset beyond rowCount (offset 15,000 on 10,000 rows)", async () => {
    const res = await dsConn.evalQuery(largeQuery, 15000, 100);
    assert.strictEqual(res.rowData.length, 0, "Query with offset > total rows must return 0 rows");
    assert.strictEqual(res.schema.columns.length, 8, "Schema must remain valid even with 0 rows");
  });

  await runChallenge("5.4 Boundary: evalQuery with limit = 0 (Verify limit 0 behavior)", async () => {
    // Adversarial hypothesis: does limit = 0 return 0 rows or entire table due to ternary `limit ? limit : null`?
    const res = await dsConn.evalQuery(largeQuery, 0, 0);
    console.log(`    ${CYAN}→ evalQuery(query, 0, 0) returned: ${res.rowData.length} rows${RESET}`);
    if (res.rowData.length > 0) {
      findingsList.push({
        severity: "MEDIUM",
        title: "Ternary limit ? limit : null in RemoteDataSourceConnection converts limit=0 to null",
        description: `Calling evalQuery(query, 0, 0) returned ${res.rowData.length} rows instead of 0 rows because '0 ? 0 : null' evaluates to null in JavaScript.`,
      });
      console.log(`    ${YELLOW}⚠ Finding detected: limit=0 converted to null, returned all rows instead of 0 rows!${RESET}`);
    } else {
      assert.strictEqual(res.rowData.length, 0, "evalQuery with limit 0 should return 0 rows");
    }
  });

  await runChallenge("5.5 Boundary: evalQuery with offset = 0 and valid limit", async () => {
    const res = await dsConn.evalQuery(largeQuery, 0, 15);
    assert.strictEqual(res.rowData.length, 15, "evalQuery(query, 0, 15) must return 15 rows");
    assert.strictEqual(res.getRow(0).row_id, 1, "First row id must be 1");
  });

  // ------------------------------------------------------------------
  // CLEANUP & SUMMARY
  // ------------------------------------------------------------------
  suiteHeader("CLEANUP & HARNESS SUMMARY");

  transport.close();
  port1.close && port1.close();
  port2.close && port2.close();
  await engine.shutdown();

  console.log(`\n${BOLD}======================================================================${RESET}`);
  console.log(`  ADVERSARIAL HARNESS EXECUTION SUMMARY`);
  console.log(`  Total Challenges Executed : ${totalChallenges}`);
  console.log(`  Passed Challenges         : ${GREEN}${passedChallenges}${RESET}`);
  console.log(`  Failed Challenges         : ${failedChallenges > 0 ? RED : GREEN}${failedChallenges}${RESET}`);
  console.log(`  Findings Discovered       : ${findingsList.length > 0 ? YELLOW : GREEN}${findingsList.length}${RESET}`);
  console.log(`${BOLD}======================================================================${RESET}`);

  if (findingsList.length > 0) {
    console.log(`\n${YELLOW}${BOLD}DISCOVERED ADVERSARIAL FINDINGS:${RESET}`);
    findingsList.forEach((f, idx) => {
      console.log(`  [${f.severity}] Finding #${idx + 1}: ${f.title}`);
      console.log(`    Details: ${f.description}`);
    });
  }

  if (failedChallenges > 0) {
    console.error(`\n${RED}Failure details:${RESET}`);
    failureDetails.forEach((f, idx) => {
      console.error(`  ${idx + 1}. ${f.name}`);
      console.error(`     Error: ${f.error}`);
    });
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FATAL ERROR IN ADVERSARIAL HARNESS:", err);
  process.exit(1);
});
