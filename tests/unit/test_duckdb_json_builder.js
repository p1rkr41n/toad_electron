/**
 * test_duckdb_json_builder.js
 * Unit test suite for DuckDbJsonSqlBuilder:
 * - Safe CREATE VIEW SQL generation with double-quoted aliases
 * - Character immunity: #attributes, #text, @xmlns, dots, spaces, slashes, quotes
 * - TRY_CAST wrapping for typed primitives (BIGINT, DOUBLE, BOOLEAN, TIMESTAMP)
 * - Column collision exclusion (* EXCLUDE (...))
 * - Real in-memory DuckDB query execution and validation
 * - Latency budget verification (< 15ms)
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

const DUCKDB_PATH = path.resolve(ROOT_DIR, "tad-master/node_modules/duckdb");
const duckdb = require(DUCKDB_PATH);

const {
  DuckDbJsonSqlBuilder,
  buildCreateViewSql,
  escapeIdentifier,
  escapeSqlStringLiteral,
  buildFieldExtractionExpression
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

function report(name, pass, detail) {
  if (pass) {
    passCount++;
    console.log(`  ${GREEN}✔ [PASS]${RESET} ${name}${detail ? ` - ${detail}` : ""}`);
  } else {
    failCount++;
    console.error(`  ${RED}✖ [FAIL]${RESET} ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

function queryAll(conn, sql) {
  return new Promise((resolve, reject) => {
    conn.all(sql, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function runTestSuite() {
  console.log(`\n${BOLD}${CYAN}======================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}   UNIT TEST SUITE: DuckDbJsonSqlBuilder (TOAD v2.5.1 M1)          ${RESET}`);
  console.log(`${BOLD}${CYAN}======================================================================${RESET}\n`);

  // TEST 1: Basic CREATE VIEW SQL Generation
  try {
    const fields = [
      {
        pathSegments: ["event_id"],
        dotPath: "event_id",
        customColName: "event_id",
        jsonPathExpr: '$."event_id"',
        sampleValue: "101",
        inferredType: "BIGINT",
        fillRate: 1.0,
        enabled: true
      },
      {
        pathSegments: ["service_name"],
        dotPath: "service_name",
        customColName: "service_name",
        jsonPathExpr: '$."service_name"',
        sampleValue: "sshd",
        inferredType: "VARCHAR",
        fillRate: 1.0,
        enabled: true
      }
    ];

    const result = buildCreateViewSql({
      targetViewName: "view_events",
      sourceTableName: "raw_events",
      sourceColumnName: "payload",
      fields
    });

    assert(result.createViewSql.includes('CREATE VIEW "view_events" AS'));
    assert(result.createViewSql.includes('FROM "raw_events";'));
    assert(result.createViewSql.includes('TRY_CAST(json_extract_string("payload", \'$."event_id"\') AS BIGINT) AS "event_id"'));
    assert(result.createViewSql.includes('json_extract_string("payload", \'$."service_name"\') AS "service_name"'));
    assert.strictEqual(result.activeColumnCount, 2);
    assert.strictEqual(result.columnMappings.length, 2);

    report("SQL_BUILDER.1 Basic CREATE VIEW statement generation and mapping", true);
  } catch (err) {
    report("SQL_BUILDER.1 Basic CREATE VIEW statement generation and mapping", false, err.message);
  }

  // TEST 2: Special Characters Escaping and Immunity
  try {
    // Test escapeIdentifier
    assert.strictEqual(escapeIdentifier("normal"), '"normal"');
    assert.strictEqual(escapeIdentifier('with"quotes"'), '"with""quotes"""');
    assert.strictEqual(escapeIdentifier("with.dots"), '"with.dots"');
    assert.strictEqual(escapeIdentifier("with spaces"), '"with spaces"');
    assert.strictEqual(escapeIdentifier("with/slashes"), '"with/slashes"');
    assert.strictEqual(escapeIdentifier("#attributes.#text"), '"#attributes.#text"');

    // Test escapeSqlStringLiteral
    assert.strictEqual(escapeSqlStringLiteral("$"), "'$'");
    assert.strictEqual(escapeSqlStringLiteral("$'test'"), "'$''test'''");

    // Test complex field with quotes in name
    const specialField = {
      pathSegments: ['quote"key', "single'key", "#text"],
      dotPath: 'quote"key.single\'key.#text',
      customColName: 'custom"col',
      jsonPathExpr: '$."quote\\"key"."single\'key"."#text"',
      sampleValue: "val",
      inferredType: "VARCHAR",
      fillRate: 1.0,
      enabled: true
    };

    const expr = buildFieldExtractionExpression(specialField, "raw_col");
    assert(expr.includes('"custom""col"'));
    assert(expr.includes("single''key")); // single quote doubled in SQL literal

    report("SQL_BUILDER.2 Double-quoted aliases and SQL string literal escaping", true);
  } catch (err) {
    report("SQL_BUILDER.2 Double-quoted aliases and SQL string literal escaping", false, err.message);
  }

  // TEST 3: Type Casting (TRY_CAST vs raw VARCHAR)
  try {
    const typesToTest = [
      { type: "BIGINT", expectedTryCast: true },
      { type: "INTEGER", expectedTryCast: true },
      { type: "DOUBLE", expectedTryCast: true },
      { type: "BOOLEAN", expectedTryCast: true },
      { type: "TIMESTAMP", expectedTryCast: true },
      { type: "VARCHAR", expectedTryCast: false }
    ];

    for (const { type, expectedTryCast } of typesToTest) {
      const field = {
        pathSegments: ["val"],
        dotPath: "val",
        customColName: "val",
        jsonPathExpr: '$."val"',
        sampleValue: "1",
        inferredType: type,
        fillRate: 1.0,
        enabled: true
      };
      const expr = buildFieldExtractionExpression(field, "payload");
      if (expectedTryCast) {
        assert(expr.startsWith(`TRY_CAST(json_extract_string("payload", '$."val"') AS ${type})`));
      } else {
        assert(expr.startsWith('json_extract_string("payload", \'$."val"\')'));
        assert(!expr.includes("TRY_CAST"));
      }
    }

    report("SQL_BUILDER.3 Selective TRY_CAST wrapping for typed primitives and raw VARCHAR optimization", true);
  } catch (err) {
    report("SQL_BUILDER.3 Selective TRY_CAST wrapping for typed primitives and raw VARCHAR optimization", false, err.message);
  }

  // TEST 4: Column Collision Exclusion (* EXCLUDE (...))
  try {
    const fields = [
      {
        pathSegments: ["existing_col"],
        dotPath: "existing_col",
        customColName: "existing_col",
        jsonPathExpr: '$."existing_col"',
        sampleValue: "val",
        inferredType: "VARCHAR",
        fillRate: 1.0,
        enabled: true
      }
    ];

    const result = buildCreateViewSql({
      targetViewName: "v_col_collision",
      sourceTableName: "t_source",
      sourceColumnName: "raw",
      fields,
      excludeExistingColumns: ["existing_col", 'col"with"quote']
    });

    assert(result.createViewSql.includes('* EXCLUDE ("existing_col", "col""with""quote")'));
    report("SQL_BUILDER.4 Column collision exclusion syntax (* EXCLUDE (...))", true);
  } catch (err) {
    report("SQL_BUILDER.4 Column collision exclusion syntax (* EXCLUDE (...))", false, err.message);
  }

  // TEST 5: Arrow Operator Syntax Support
  try {
    const fields = [
      {
        pathSegments: ["Event", "System", "EventID"],
        dotPath: "Event.System.EventID",
        customColName: "event_id",
        jsonPathExpr: '$."Event"."System"."EventID"',
        sampleValue: "7036",
        inferredType: "BIGINT",
        fillRate: 1.0,
        enabled: true
      }
    ];

    const result = buildCreateViewSql({
      targetViewName: "v_arrow",
      sourceTableName: "t_source",
      sourceColumnName: "raw_json",
      fields,
      useArrowSyntax: true
    });

    assert(result.createViewSql.includes('TRY_CAST("raw_json"->\'Event\'->\'System\'->>\'EventID\' AS BIGINT) AS "event_id"'));
    report("SQL_BUILDER.5 Arrow operator extraction syntax support (col->'seg'->>'leaf')", true);
  } catch (err) {
    report("SQL_BUILDER.5 Arrow operator extraction syntax support (col->'seg'->>'leaf')", false, err.message);
  }

  // TEST 6: Real DuckDB In-Memory Execution of Generated SQL
  const db = new duckdb.Database(":memory:");
  const conn = db.connect();

  try {
    await queryAll(conn, 'CREATE TABLE "raw_logs" (id INTEGER, raw_text VARCHAR);');
    const sampleEvent = JSON.stringify({
      Event: {
        System: {
          Provider: { "#attributes": { Name: "Service Control Manager" } },
          EventID: { "#text": 7036 },
          EventRecordID: 93937,
          TimeCreated: { "#attributes": { SystemTime: "2026-10-27T14:44:08.819818Z" } }
        },
        EventData: { param1: "Microsoft Passport Container", param2: "stopped" }
      }
    });

    const safeInsert = sampleEvent.replace(/'/g, "''");
    await queryAll(conn, `INSERT INTO "raw_logs" VALUES (1, '${safeInsert}');`);

    const fields = [
      {
        pathSegments: ["Event", "System", "Provider", "#attributes", "Name"],
        dotPath: "Event.System.Provider.#attributes.Name",
        customColName: "provider_name",
        jsonPathExpr: '$."Event"."System"."Provider"."#attributes"."Name"',
        sampleValue: "Service Control Manager",
        inferredType: "VARCHAR",
        fillRate: 1.0,
        enabled: true
      },
      {
        pathSegments: ["Event", "System", "EventID", "#text"],
        dotPath: "Event.System.EventID.#text",
        customColName: "event_id",
        jsonPathExpr: '$."Event"."System"."EventID"."#text"',
        sampleValue: "7036",
        inferredType: "BIGINT",
        fillRate: 1.0,
        enabled: true
      },
      {
        pathSegments: ["Event", "System", "EventRecordID"],
        dotPath: "Event.System.EventRecordID",
        customColName: "record_id",
        jsonPathExpr: '$."Event"."System"."EventRecordID"',
        sampleValue: "93937",
        inferredType: "BIGINT",
        fillRate: 1.0,
        enabled: true
      },
      {
        pathSegments: ["Event", "System", "TimeCreated", "#attributes", "SystemTime"],
        dotPath: "Event.System.TimeCreated.#attributes.SystemTime",
        customColName: "time_created",
        jsonPathExpr: '$."Event"."System"."TimeCreated"."#attributes"."SystemTime"',
        sampleValue: "2026-10-27T14:44:08.819818Z",
        inferredType: "TIMESTAMP",
        fillRate: 1.0,
        enabled: true
      },
      {
        pathSegments: ["Event", "EventData", "param1"],
        dotPath: "Event.EventData.param1",
        customColName: "param1",
        jsonPathExpr: '$."Event"."EventData"."param1"',
        sampleValue: "Microsoft Passport Container",
        inferredType: "VARCHAR",
        fillRate: 1.0,
        enabled: true
      }
    ];

    const result = buildCreateViewSql({
      targetViewName: "v_evtx_parsed",
      sourceTableName: "raw_logs",
      sourceColumnName: "raw_text",
      fields
    });

    // Execute the generated CREATE VIEW in real DuckDB
    await queryAll(conn, result.createViewSql);

    // Query back from the newly created view
    const rows = await queryAll(conn, 'SELECT id, provider_name, event_id, record_id, param1 FROM "v_evtx_parsed" WHERE id = 1');
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].provider_name, "Service Control Manager");
    assert.strictEqual(rows[0].event_id, 7036n);
    assert.strictEqual(rows[0].record_id, 93937n);
    assert.strictEqual(rows[0].param1, "Microsoft Passport Container");

    report("SQL_BUILDER.6 Real DuckDB in-memory execution of generated CREATE VIEW and data extraction", true);
  } catch (err) {
    report("SQL_BUILDER.6 Real DuckDB in-memory execution of generated CREATE VIEW and data extraction", false, err.message);
  }

  // TEST 7: Character Immunity in Real DuckDB Execution (#, @, dots, spaces, slashes, quotes)
  try {
    await queryAll(conn, 'CREATE TABLE "t_special" (payload VARCHAR);');
    const specialData = JSON.stringify({
      "@xmlns": "http://uri",
      "#tag": "hash_val",
      "dot.separated": 42,
      "space key": true,
      "slash/key": "slash_val",
      'quote"key': "q_val",
      "single'key": "s_val"
    });
    const safeData = specialData.replace(/'/g, "''");
    await queryAll(conn, `INSERT INTO "t_special" VALUES ('${safeData}');`);

    const specialFields = [
      {
        pathSegments: ["@xmlns"],
        dotPath: "@xmlns",
        customColName: "@xmlns",
        jsonPathExpr: '$."@xmlns"',
        sampleValue: "http://uri",
        inferredType: "VARCHAR",
        fillRate: 1.0,
        enabled: true
      },
      {
        pathSegments: ["#tag"],
        dotPath: "#tag",
        customColName: "#tag",
        jsonPathExpr: '$."#tag"',
        sampleValue: "hash_val",
        inferredType: "VARCHAR",
        fillRate: 1.0,
        enabled: true
      },
      {
        pathSegments: ["dot.separated"],
        dotPath: "dot.separated",
        customColName: "dot.separated",
        jsonPathExpr: '$."dot.separated"',
        sampleValue: "42",
        inferredType: "BIGINT",
        fillRate: 1.0,
        enabled: true
      },
      {
        pathSegments: ["space key"],
        dotPath: "space key",
        customColName: "space key",
        jsonPathExpr: '$."space key"',
        sampleValue: "true",
        inferredType: "BOOLEAN",
        fillRate: 1.0,
        enabled: true
      },
      {
        pathSegments: ["slash/key"],
        dotPath: "slash/key",
        customColName: "slash/key",
        jsonPathExpr: '$."slash/key"',
        sampleValue: "slash_val",
        inferredType: "VARCHAR",
        fillRate: 1.0,
        enabled: true
      },
      {
        pathSegments: ['quote"key'],
        dotPath: 'quote"key',
        customColName: 'quote"key',
        jsonPathExpr: '$."quote\\"key"',
        sampleValue: "q_val",
        inferredType: "VARCHAR",
        fillRate: 1.0,
        enabled: true
      },
      {
        pathSegments: ["single'key"],
        dotPath: "single'key",
        customColName: "single'key",
        jsonPathExpr: '$."single\'key"',
        sampleValue: "s_val",
        inferredType: "VARCHAR",
        fillRate: 1.0,
        enabled: true
      }
    ];

    const result = buildCreateViewSql({
      targetViewName: "v_special_immunity",
      sourceTableName: "t_special",
      sourceColumnName: "payload",
      fields: specialFields
    });

    await queryAll(conn, result.createViewSql);
    const rows = await queryAll(conn, 'SELECT * FROM "v_special_immunity"');
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]["@xmlns"], "http://uri");
    assert.strictEqual(rows[0]["#tag"], "hash_val");
    assert.strictEqual(rows[0]["dot.separated"], 42n);
    assert.strictEqual(rows[0]["space key"], true);
    assert.strictEqual(rows[0]["slash/key"], "slash_val");
    assert.strictEqual(rows[0]['quote"key'], "q_val");
    assert.strictEqual(rows[0]["single'key"], "s_val");

    report("SQL_BUILDER.7 100% character immunity in real DuckDB query (#, @, dots, spaces, slashes, quotes)", true);
  } catch (err) {
    report("SQL_BUILDER.7 100% character immunity in real DuckDB query (#, @, dots, spaces, slashes, quotes)", false, err.message);
  }

  // TEST 8: TRY_CAST Resilience on Corrupted Data in Real DuckDB
  try {
    await queryAll(conn, 'CREATE TABLE "t_dirty" (payload VARCHAR);');
    await queryAll(conn, `INSERT INTO "t_dirty" VALUES ('{"val": 999}'), ('{"val": "NOT_A_NUMBER"}');`);

    const dirtyField = {
      pathSegments: ["val"],
      dotPath: "val",
      customColName: "val_num",
      jsonPathExpr: '$."val"',
      sampleValue: "999",
      inferredType: "BIGINT",
      fillRate: 1.0,
      enabled: true
    };

    const result = buildCreateViewSql({
      targetViewName: "v_dirty_handled",
      sourceTableName: "t_dirty",
      sourceColumnName: "payload",
      fields: [dirtyField]
    });

    await queryAll(conn, result.createViewSql);
    const rows = await queryAll(conn, 'SELECT val_num FROM "v_dirty_handled" ORDER BY val_num DESC NULLS LAST');
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].val_num, 999n);
    assert.strictEqual(rows[1].val_num, null); // Corrupted string evaluated to NULL instead of aborting!

    report("SQL_BUILDER.8 TRY_CAST resilience: corrupt data safely yields NULL instead of crashing query", true);
  } catch (err) {
    report("SQL_BUILDER.8 TRY_CAST resilience: corrupt data safely yields NULL instead of crashing query", false, err.message);
  }

  // TEST 9: Latency Budget Verification (< 15ms)
  try {
    const perfFields = [];
    for (let i = 0; i < 15; i++) {
      perfFields.push({
        pathSegments: ["level1", `field_${i}`],
        dotPath: `level1.field_${i}`,
        customColName: `f_${i}`,
        jsonPathExpr: `$."level1"."field_${i}"`,
        sampleValue: String(i * 10),
        inferredType: i % 2 === 0 ? "BIGINT" : "VARCHAR",
        fillRate: 1.0,
        enabled: true
      });
    }

    const perfSql = buildCreateViewSql({
      targetViewName: "v_perf_benchmark",
      sourceTableName: "raw_logs",
      sourceColumnName: "raw_text",
      fields: perfFields
    });

    // Warm-up
    await queryAll(conn, perfSql.createViewSql);
    await queryAll(conn, 'DROP VIEW "v_perf_benchmark"');

    // Measure 5 iterations
    const latencies = [];
    for (let iter = 0; iter < 5; iter++) {
      const vName = `v_perf_iter_${iter}`;
      const iterSql = buildCreateViewSql({
        targetViewName: vName,
        sourceTableName: "raw_logs",
        sourceColumnName: "raw_text",
        fields: perfFields
      });

      const start = process.hrtime.bigint();
      await queryAll(conn, iterSql.createViewSql);
      const end = process.hrtime.bigint();

      const ms = Number(end - start) / 1_000_000;
      latencies.push(ms);
      await queryAll(conn, `DROP VIEW "${vName}"`);
    }

    const avgMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const maxMs = Math.max(...latencies);

    assert(
      maxMs < 15.0,
      `Max latency ${maxMs.toFixed(2)}ms exceeded 15ms budget!`
    );

    report(
      "SQL_BUILDER.9 DuckDB CREATE VIEW latency budget (< 15ms)",
      true,
      `avg: ${avgMs.toFixed(3)}ms, max: ${maxMs.toFixed(3)}ms (Budget: <15ms)`
    );
  } catch (err) {
    report("SQL_BUILDER.9 DuckDB CREATE VIEW latency budget (< 15ms)", false, err.message);
  }

  // TEST 10: Error Handling & Validation
  try {
    // No fields enabled
    assert.throws(
      () =>
        buildCreateViewSql({
          targetViewName: "v_none",
          sourceTableName: "t",
          sourceColumnName: "c",
          fields: [
            {
              pathSegments: ["a"],
              dotPath: "a",
              customColName: "a",
              jsonPathExpr: '$."a"',
              sampleValue: "1",
              inferredType: "VARCHAR",
              fillRate: 1.0,
              enabled: false
            }
          ]
        }),
      /no fields enabled/i
    );

    // Missing table name
    assert.throws(
      () =>
        buildCreateViewSql({
          targetViewName: "v",
          sourceTableName: "",
          sourceColumnName: "c",
          fields: []
        }),
      /Source table name is required/i
    );

    // Missing view name
    assert.throws(
      () =>
        buildCreateViewSql({
          targetViewName: "",
          sourceTableName: "t",
          sourceColumnName: "c",
          fields: []
        }),
      /Target view name is required/i
    );

    report("SQL_BUILDER.10 Input validation and error handling on empty fields/tables", true);
  } catch (err) {
    report("SQL_BUILDER.10 Input validation and error handling on empty fields/tables", false, err.message);
  }

  console.log(`\n${BOLD}======================================================================${RESET}`);
  console.log(`  DUCKDB JSON SQL BUILDER SUMMARY: ${passCount}/${passCount + failCount} PASSED`);
  console.log(`${BOLD}======================================================================${RESET}\n`);

  if (failCount > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
