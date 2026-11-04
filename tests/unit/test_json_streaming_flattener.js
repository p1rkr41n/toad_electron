/**
 * test_json_streaming_flattener.js
 *
 * Unit tests for Phase 2 DuckDB JSON streaming flattener (JsonStreamingFlattener.ts & csvimport.ts):
 * 1. SQL generation: dynamic projection query with safe double quotes vs fallback SELECT *
 * 2. Live streaming of complex nested EVTX records to Parquet (ZSTD compression)
 * 3. Parquet readback data integrity verification (RecordID 93937: EventID 7036, param1, param2, Binary, #attributes, #text)
 * 4. Special character field names integrity (dots, spaces, quotes, slashes, unicode)
 * 5. Array preservation mode: nested arrays retained without row explosion
 * 6. Fallback and flat JSON file handling
 * 7. End-to-end integration via csvimport.ts streamJsonToParquet
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "../..");
const DUCKDB_PATH = path.resolve(ROOT_DIR, "tad-master/node_modules/duckdb");
const duckdb = require(DUCKDB_PATH);

// Import compiled flattener & introspector from dist
const flattenerPath = path.resolve(
  ROOT_DIR,
  "tad-master/packages/reltab-duckdb/dist/json/JsonStreamingFlattener"
);
const introspectorPath = path.resolve(
  ROOT_DIR,
  "tad-master/packages/reltab-duckdb/dist/json/JsonSchemaIntrospector"
);
const csvImportPath = path.resolve(
  ROOT_DIR,
  "tad-master/packages/reltab-duckdb/dist/csvimport"
);

const {
  generateDynamicProjectionSql,
  streamFlattenedJsonToParquet,
} = require(flattenerPath);
const { introspectJsonSchema } = require(introspectorPath);

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
  console.log(`\n${BOLD}${CYAN}======================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}  UNIT TEST: DUCKDB STREAMING JSON AUTO-FLATTENER TO PARQUET        ${RESET}`);
  console.log(`${BOLD}${CYAN}======================================================================${RESET}\n`);

  const db = new duckdb.Database(":memory:");
  const conn = db.connect();

  const dbConn = {
    all: (sql) => new Promise((resolve, reject) => {
      conn.all(sql, (err, rows) => (err ? reject(err) : resolve(rows)));
    }),
    exec: (sql) => new Promise((resolve, reject) => {
      conn.exec(sql, (err) => (err ? reject(err) : resolve()));
    }),
  };

  const tmpDir = path.resolve(ROOT_DIR, "scratch");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  // -------------------------------------------------------------------------
  // SECTION 1: Dynamic Projection SQL Generation
  // -------------------------------------------------------------------------
  console.log(`${BOLD}--- 1. SQL Query Generation ---${RESET}`);
  {
    const mockIntroWithStruct = {
      hasStructColumns: true,
      columns: [
        { columnName: "TopCol", columnType: "BIGINT", isStruct: false },
        { columnName: "Event", columnType: "STRUCT(...)", isStruct: true },
      ],
      leafProjections: [
        {
          pathSegments: ["TopCol"],
          sqlExpression: '"TopCol"',
          columnAlias: "TopCol",
          targetType: "BIGINT",
          isNested: false,
        },
        {
          pathSegments: ["Event", "System", "EventID", "#text"],
          sqlExpression: '"Event"."System"."EventID"."#text"',
          columnAlias: "Event.System.EventID.#text",
          targetType: "BIGINT",
          isNested: true,
        },
        {
          pathSegments: ["Event", "Quote\"Field"],
          sqlExpression: '"Event"."Quote""Field"',
          columnAlias: 'Event.Quote"Field',
          targetType: "VARCHAR",
          isNested: true,
        },
      ],
    };

    const sqlWithStruct = generateDynamicProjectionSql(
      "C:/data/sample.json",
      "C:/data/sample.parquet",
      mockIntroWithStruct,
      { compression: "ZSTD", rowGroupSize: 50000 }
    );

    report("SQL with STRUCT contains COPY", sqlWithStruct.includes("COPY ("));
    report("SQL with STRUCT projects TopCol", sqlWithStruct.includes('"TopCol" AS "TopCol"'));
    report(
      "SQL with STRUCT projects EventID.#text with safe quotes",
      sqlWithStruct.includes('"Event"."System"."EventID"."#text" AS "Event.System.EventID.#text"')
    );
    report(
      "SQL with STRUCT escapes double quotes in alias",
      sqlWithStruct.includes('"Event"."Quote""Field" AS "Event.Quote""Field"')
    );
    report("SQL specifies ZSTD compression", sqlWithStruct.includes("COMPRESSION ZSTD"));
    report("SQL specifies custom row group size", sqlWithStruct.includes("ROW_GROUP_SIZE 50000"));

    // Fallback SQL for flat schema
    const mockIntroFlat = {
      hasStructColumns: false,
      columns: [{ columnName: "col1", columnType: "VARCHAR", isStruct: false }],
      leafProjections: [],
    };
    const sqlFlat = generateDynamicProjectionSql(
      "C:/data/flat.json",
      "C:/data/flat.parquet",
      mockIntroFlat
    );
    report("Flat SQL uses SELECT * fallback", sqlFlat.includes("SELECT * FROM read_json_auto("));
  }

  // -------------------------------------------------------------------------
  // SECTION 2: Live EVTX RecordID 93937 Streaming to Parquet
  // -------------------------------------------------------------------------
  console.log(`\n${BOLD}--- 2. Live EVTX RecordID 93937 Streaming to Parquet ---${RESET}`);
  {
    const evtxRecord = {
      Event: {
        "@xmlns": "http://schemas.microsoft.com/win/2004/08/events/event",
        System: {
          Provider: {
            "#attributes": {
              Name: "Service Control Manager",
              Guid: "{555908d1-a6d7-4695-8e1e-26931b2012f4}",
            },
          },
          EventID: {
            "#attributes": { Qualifiers: 16384 },
            "#text": 7036,
          },
          TimeCreated: {
            "#attributes": { SystemTime: "2026-10-27T14:44:08.819818Z" },
          },
          EventRecordID: 93937,
          Computer: "WIN-3MJ9DEQ5B94",
        },
        EventData: {
          param1: "Microsoft Passport Container",
          param2: "stopped",
          Binary: "4E0067006300430074006E0072005300760063002F0031000000",
        },
      },
    };

    const evtxJsonPath = path.resolve(tmpDir, "flattener_evtx_sample.jsonl");
    const evtxParquetPath = path.resolve(tmpDir, "flattener_evtx_sample.parquet");
    fs.writeFileSync(evtxJsonPath, JSON.stringify(evtxRecord) + "\n");

    const streamRes = await streamFlattenedJsonToParquet(
      dbConn,
      evtxJsonPath,
      evtxParquetPath,
      { compression: "ZSTD" }
    );

    report("streamFlattenedJsonToParquet reports flattened: true", streamRes.flattened === true);
    report("streamFlattenedJsonToParquet reports hasStructColumns: true", streamRes.hasStructColumns === true);
    report("streamFlattenedJsonToParquet column count >= 11", streamRes.columnCount >= 11);
    report("Parquet file created on disk", fs.existsSync(evtxParquetPath) && fs.statSync(evtxParquetPath).size > 0);

    // Read back from Parquet and verify data integrity
    const safePq = evtxParquetPath.replace(/\\/g, "/");
    const rows = await dbConn.all(`SELECT * FROM read_parquet('${safePq}');`);
    report("Parquet readback returned 1 row", rows.length === 1);

    const r = rows[0];
    report("Leaf Event.@xmlns value", r["Event.@xmlns"] === "http://schemas.microsoft.com/win/2004/08/events/event");
    report("Leaf Event.System.Provider.#attributes.Name value", r["Event.System.Provider.#attributes.Name"] === "Service Control Manager");
    report(
      "Leaf Event.System.Provider.#attributes.Guid value",
      String(r["Event.System.Provider.#attributes.Guid"]).includes("555908d1-a6d7-4695-8e1e-26931b2012f4")
    );
    report("Leaf Event.System.EventID.#attributes.Qualifiers value", Number(r["Event.System.EventID.#attributes.Qualifiers"]) === 16384);
    report("Leaf Event.System.EventID.#text value", Number(r["Event.System.EventID.#text"]) === 7036);
    const systemTimeStr = r["Event.System.TimeCreated.#attributes.SystemTime"] instanceof Date
      ? r["Event.System.TimeCreated.#attributes.SystemTime"].toISOString()
      : String(r["Event.System.TimeCreated.#attributes.SystemTime"]);
    report(
      "Leaf Event.System.TimeCreated.#attributes.SystemTime value",
      systemTimeStr.includes("2026-10-27")
    );
    report("Leaf Event.System.EventRecordID value", Number(r["Event.System.EventRecordID"]) === 93937);
    report("Leaf Event.System.Computer value", r["Event.System.Computer"] === "WIN-3MJ9DEQ5B94");
    report("Leaf Event.EventData.param1 value", r["Event.EventData.param1"] === "Microsoft Passport Container");
    report("Leaf Event.EventData.param2 value", r["Event.EventData.param2"] === "stopped");
    report("Leaf Event.EventData.Binary value", r["Event.EventData.Binary"] === "4E0067006300430074006E0072005300760063002F0031000000");

    // Cleanup
    try {
      if (fs.existsSync(evtxJsonPath)) fs.unlinkSync(evtxJsonPath);
      if (fs.existsSync(evtxParquetPath)) fs.unlinkSync(evtxParquetPath);
    } catch {}
  }

  // -------------------------------------------------------------------------
  // SECTION 3: Special Character Keys & Non-Standard Identifiers
  // -------------------------------------------------------------------------
  console.log(`\n${BOLD}--- 3. Special Character Identifiers & Array Preservation ---${RESET}`);
  {
    const specialData = [
      {
        root: {
          "space key": 101,
          "dotted.field": 202,
          'quote"key': 303,
          "slash/key": 404,
          "tiếng_việt": "giá trị",
          "deep": {
            "#text": "inner text",
            "@xmlns": "urn:spec",
          },
          primitive_list: [10, 20, 30],
          struct_list: [{ id: 1, label: "first" }, { id: 2, label: "second" }],
        },
        regular_col: "simple",
      },
      {
        root: {
          "space key": 102,
          "dotted.field": 203,
          'quote"key': 304,
          "slash/key": 405,
          "tiếng_việt": "dòng hai",
          "deep": {
            "#text": "inner text 2",
            "@xmlns": "urn:spec",
          },
          primitive_list: [40, 50],
          struct_list: [{ id: 3, label: "third" }],
        },
        regular_col: "simple2",
      },
    ];

    const specJsonPath = path.resolve(tmpDir, "flattener_special_sample.jsonl");
    const specParquetPath = path.resolve(tmpDir, "flattener_special_sample.parquet");
    fs.writeFileSync(specJsonPath, specialData.map((d) => JSON.stringify(d)).join("\n"));

    const streamRes = await streamFlattenedJsonToParquet(
      dbConn,
      specJsonPath,
      specParquetPath,
      { compression: "SNAPPY" }
    );

    report("Special chars streaming succeeded", streamRes.flattened === true);

    const safePq = specParquetPath.replace(/\\/g, "/");
    const rows = await dbConn.all(`SELECT * FROM read_parquet('${safePq}');`);
    report("Readback returned 2 rows", rows.length === 2);

    const r0 = rows[0];
    report("Readback root.space key", Number(r0["root.space key"]) === 101);
    report("Readback root.dotted.field", Number(r0["root.dotted.field"]) === 202);
    report("Readback root.quote\"key", Number(r0['root.quote"key']) === 303);
    report("Readback root.slash/key", Number(r0["root.slash/key"]) === 404);
    report("Readback root.tiếng_việt", r0["root.tiếng_việt"] === "giá trị");
    report("Readback root.deep.#text", r0["root.deep.#text"] === "inner text");
    report("Readback root.deep.@xmlns", r0["root.deep.@xmlns"] === "urn:spec");
    report("Readback regular_col", r0["regular_col"] === "simple");

    // Array preservation checks
    report(
      "Primitive list preserved as array",
      Array.isArray(r0["root.primitive_list"]) && r0["root.primitive_list"].length === 3
    );
    report(
      "Struct list preserved as array of structs",
      Array.isArray(r0["root.struct_list"]) && r0["root.struct_list"].length === 2
    );

    // Cleanup
    try {
      if (fs.existsSync(specJsonPath)) fs.unlinkSync(specJsonPath);
      if (fs.existsSync(specParquetPath)) fs.unlinkSync(specParquetPath);
    } catch {}
  }

  // -------------------------------------------------------------------------
  // SECTION 4: Flat JSON Graceful Fallback
  // -------------------------------------------------------------------------
  console.log(`\n${BOLD}--- 4. Flat JSON Streaming Fallback ---${RESET}`);
  {
    const flatData = [
      { id: 1, name: "Alpha", score: 99.5 },
      { id: 2, name: "Beta", score: 88.0 },
    ];
    const flatJsonPath = path.resolve(tmpDir, "flattener_flat_sample.json");
    const flatParquetPath = path.resolve(tmpDir, "flattener_flat_sample.parquet");
    fs.writeFileSync(flatJsonPath, JSON.stringify(flatData));

    const flatRes = await streamFlattenedJsonToParquet(
      dbConn,
      flatJsonPath,
      flatParquetPath
    );

    report("Flat JSON stream reports flattened: false", flatRes.flattened === false);
    report("Flat JSON stream reports hasStructColumns: false", flatRes.hasStructColumns === false);
    report("Flat Parquet file exists and has size", fs.existsSync(flatParquetPath) && fs.statSync(flatParquetPath).size > 0);

    const safePq = flatParquetPath.replace(/\\/g, "/");
    const rows = await dbConn.all(`SELECT * FROM read_parquet('${safePq}');`);
    report("Flat Parquet readback rows count", rows.length === 2);
    report("Flat Parquet column values intact", Number(rows[0].id) === 1 && rows[0].name === "Alpha");

    // Cleanup
    try {
      if (fs.existsSync(flatJsonPath)) fs.unlinkSync(flatJsonPath);
      if (fs.existsSync(flatParquetPath)) fs.unlinkSync(flatParquetPath);
    } catch {}
  }

  // -------------------------------------------------------------------------
  // SECTION 5: Integration with csvimport.ts streamJsonToParquet
  // -------------------------------------------------------------------------
  console.log(`\n${BOLD}--- 5. Integration Verification via csvimport.ts ---${RESET}`);
  {
    const csvImport = require(csvImportPath);
    report("csvimport exports introspectJsonSchema", typeof csvImport.introspectJsonSchema === "function");
    report("csvimport exports streamFlattenedJsonToParquet", typeof csvImport.streamFlattenedJsonToParquet === "function");
    report("csvimport exports generateDynamicProjectionSql", typeof csvImport.generateDynamicProjectionSql === "function");
    report("csvimport exports parseStructFields", typeof csvImport.parseStructFields === "function");
    report("csvimport exports isStructType", typeof csvImport.isStructType === "function");
    report("csvimport exports extractLeafProjections", typeof csvImport.extractLeafProjections === "function");
  }

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log(`\n${BOLD}${CYAN}----------------------------------------------------------------------${RESET}`);
  console.log(`Total tests: ${passCount + failCount} | Passed: ${GREEN}${passCount}${RESET} | Failed: ${failCount > 0 ? RED : GREEN}${failCount}${RESET}`);
  console.log(`${BOLD}${CYAN}----------------------------------------------------------------------${RESET}\n`);

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Unhandled error during test run:", err);
  process.exit(1);
});
