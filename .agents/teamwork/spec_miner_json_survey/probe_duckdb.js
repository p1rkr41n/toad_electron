const path = require("path");
const duckdb = require(path.resolve(__dirname, "../../../tad-master/node_modules/duckdb"));

const db = new duckdb.Database(":memory:");
const conn = db.connect();

function runQuery(sql) {
  return new Promise((resolve, reject) => {
    conn.all(sql, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function main() {
  console.log("=== PROBING DUCKDB JSON AND BRACKET PATH BEHAVIORS ===");

  const sampleJson = JSON.stringify({
    Event: {
      "@xmlns": "http://schemas.microsoft.com/win/2004/08/events/event",
      "#attributes": { SchemaVersion: "1.0" },
      System: {
        Provider: {
          "#attributes": { Name: "Service Control Manager", Guid: "{555908d1-a6d7-4695-8e1e-26931b2012f4}" }
        },
        EventID: {
          "#attributes": { Qualifiers: 16384 },
          "#text": 7036
        },
        "Special.Key": "DotValue",
        "Space Key": "SpaceValue",
        "Slash/Key": "SlashValue",
        "Quote\"Key": "QuoteValue",
        "Single'Key": "SingleQuoteValue"
      },
      EventData: {
        param1: "Microsoft Passport Container",
        param2: "stopped",
        Binary: "4E0067006300430074006E0072005300760063002F0031000000"
      }
    }
  });

  await runQuery(`CREATE TABLE test_events (id BIGINT, RawEvent VARCHAR);`);
  const escapedJsonSql = sampleJson.replace(/'/g, "''");
  await runQuery(`INSERT INTO test_events VALUES (93937, '${escapedJsonSql}');`);

  // Probe bracket vs quoted dot
  const bracketTests = [
    `SELECT json_extract_string(RawEvent, '$["Event"]') AS res FROM test_events;`,
    `SELECT json_extract_string(RawEvent, '$."Event"') AS res FROM test_events;`,
    `SELECT json_extract_string(RawEvent, '$."Event"."System"."EventID"."#text"') AS res FROM test_events;`,
    `SELECT RawEvent->'Event'->'System'->'EventID'->>'#text' AS res FROM test_events;`
  ];

  for (const s of bracketTests) {
    try {
      const res = await runQuery(s);
      console.log(`[PASS] ${s.trim()} \n    -> Result:`, JSON.stringify(res[0]));
    } catch (err) {
      console.log(`[FAIL] ${s.trim()} \n    -> Error:`, err.message);
    }
  }

  // CREATE VIEW Latency Budget test (< 15ms)
  const viewCols = [
    `TRY_CAST(json_extract_string(RawEvent, '$."Event"."System"."EventID"."#text"') AS BIGINT) AS "Event.System.EventID.#text"`,
    `json_extract_string(RawEvent, '$."Event"."System"."Provider"."#attributes"."Name"') AS "Event.System.Provider.#attributes.Name"`,
    `json_extract_string(RawEvent, '$."Event"."EventData"."param1"') AS "Event.EventData.param1"`,
    `json_extract_string(RawEvent, '$."Event"."EventData"."param2"') AS "Event.EventData.param2"`,
    `json_extract_string(RawEvent, '$."Event"."EventData"."Binary"') AS "Event.EventData.Binary"`,
    `json_extract_string(RawEvent, '$."Event"."@xmlns"') AS "Event.@xmlns"`,
    `json_extract_string(RawEvent, '$."Event"."System"."Special.Key"') AS "Event.System.Special.Key"`
  ];

  const createViewSql = `CREATE VIEW v_extracted AS SELECT *, ${viewCols.join(", ")} FROM test_events;`;
  const start = process.hrtime.bigint();
  await runQuery(createViewSql);
  const end = process.hrtime.bigint();
  const latencyMs = Number(end - start) / 1e6;
  console.log(`[BENCHMARK] CREATE VIEW latency: ${latencyMs.toFixed(3)} ms (Target: < 15ms)`);

  // Direct Ingestion Two-Phase Dynamic Projection
  console.log("\n=== PROBING DIRECT INGESTION TWO-PHASE DYNAMIC PROJECTION ===");
  const fs = require("fs");
  const tmpJsonPath = path.resolve(__dirname, "test_nested.jsonl").replace(/\\/g, "/");
  fs.writeFileSync(tmpJsonPath, sampleJson + "\n");

  const describeRows = await runQuery(`DESCRIBE SELECT * FROM read_json_auto('${tmpJsonPath}', sample_size = 2048);`);
  console.log("Phase 1 Schema Introspection Rows:");
  for (const r of describeRows) {
    console.log(`  - column_name: ${r.column_name}, column_type: ${r.column_type}`);
  }

  const unpackSql = `
    SELECT 
      "Event"."@xmlns" AS "Event.@xmlns",
      "Event"."#attributes"."SchemaVersion" AS "Event.#attributes.SchemaVersion",
      "Event"."System"."EventID"."#text" AS "Event.System.EventID.#text",
      "Event"."System"."Provider"."#attributes"."Name" AS "Event.System.Provider.#attributes.Name",
      "Event"."System"."Special.Key" AS "Event.System.Special.Key",
      "Event"."System"."Space Key" AS "Event.System.Space Key",
      "Event"."System"."Slash/Key" AS "Event.System.Slash/Key",
      "Event"."EventData"."param1" AS "Event.EventData.param1",
      "Event"."EventData"."param2" AS "Event.EventData.param2",
      "Event"."EventData"."Binary" AS "Event.EventData.Binary"
    FROM read_json_auto('${tmpJsonPath}', sample_size = 2048)
  `;

  const unpacked = await runQuery(unpackSql);
  console.log("[PASS] STRUCT dot unpacking successful!");

  const tmpParquetPath = path.resolve(__dirname, "test_out.parquet").replace(/\\/g, "/");
  await runQuery(`COPY (${unpackSql}) TO '${tmpParquetPath}' (FORMAT PARQUET, COMPRESSION ZSTD);`);
  console.log("[PASS] COPY to Parquet successful!");

  try {
    if (fs.existsSync(tmpJsonPath)) fs.unlinkSync(tmpJsonPath);
    if (fs.existsSync(tmpParquetPath)) fs.unlinkSync(tmpParquetPath);
  } catch {}
}

main().catch(console.error);
