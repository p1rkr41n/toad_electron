/**
 * test_json_schema_introspect.js
 *
 * Unit tests for Phase 1 DuckDB JSON schema introspection (JsonSchemaIntrospector.ts):
 * 1. Safe identifier quoting & character escaping (#attributes, #text, @xmlns, dots, spaces, quotes, slashes, unicode)
 * 2. Struct type detection (isStructType) handling nested structs and rejecting struct arrays/lists
 * 3. Robust comma splitting at top-level depth (splitTopLevelComma)
 * 4. Struct field definition parser (parseFieldDef & parseStructFields)
 * 5. Recursive leaf projection extraction (extractLeafProjections) with Windows EVTX RecordID 93937 schema parity
 * 6. Live DuckDB DESCRIBE query execution & schema inference integration
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "../..");
const DUCKDB_PATH = path.resolve(ROOT_DIR, "tad-master/node_modules/duckdb");
const duckdb = require(DUCKDB_PATH);

// Import compiled introspector from dist
const introspectorPath = path.resolve(
  ROOT_DIR,
  "tad-master/packages/reltab-duckdb/dist/json/JsonSchemaIntrospector"
);
const {
  quoteSqlIdentifier,
  escapeSqlStringLiteral,
  isStructType,
  splitTopLevelComma,
  parseFieldDef,
  parseStructFields,
  extractLeafProjections,
  introspectJsonSchema,
  buildDynamicProjection,
} = require(introspectorPath);

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
  console.log(`${BOLD}${CYAN}  UNIT TEST: DUCKDB JSON SCHEMA INTROSPECTION & STRUCT PARSING      ${RESET}`);
  console.log(`${BOLD}${CYAN}======================================================================${RESET}\n`);

  // -------------------------------------------------------------------------
  // SECTION 1: SQL Identifier Quoting & Escaping
  // -------------------------------------------------------------------------
  console.log(`${BOLD}--- 1. Identifier Quoting & Escaping ---${RESET}`);
  {
    report("Simple identifier", quoteSqlIdentifier("Event") === '"Event"');
    report("Identifier with double quotes", quoteSqlIdentifier('My"Quote"Col') === '"My""Quote""Col"');
    report("Identifier with # prefix", quoteSqlIdentifier("#attributes") === '"#attributes"');
    report("Identifier with @ prefix", quoteSqlIdentifier("@xmlns") === '"@xmlns"');
    report("Identifier with dot", quoteSqlIdentifier("Event.System") === '"Event.System"');
    report("Identifier with space", quoteSqlIdentifier("Process Name") === '"Process Name"');
    report("Identifier with slash", quoteSqlIdentifier("path/to/file") === '"path/to/file"');
    report("Identifier with Unicode", quoteSqlIdentifier("Tiếng_Việt") === '"Tiếng_Việt"');
    report("String literal escaping", escapeSqlStringLiteral("O'Reilly's Test") === "O''Reilly''s Test");
  }

  // -------------------------------------------------------------------------
  // SECTION 2: Struct Type Detection (isStructType)
  // -------------------------------------------------------------------------
  console.log(`\n${BOLD}--- 2. Struct Type Detection (isStructType) ---${RESET}`);
  {
    report("Standard STRUCT", isStructType("STRUCT(a BIGINT, b VARCHAR)"));
    report("Case insensitive STRUCT", isStructType("struct (a int)"));
    report("Nested STRUCT", isStructType('STRUCT("nested" STRUCT(c DOUBLE))'));
    report("Primitive BIGINT is not struct", !isStructType("BIGINT"));
    report("Primitive VARCHAR is not struct", !isStructType("VARCHAR"));
    report("Primitive TIMESTAMP is not struct", !isStructType("TIMESTAMP"));
    report("Array of STRUCT is not struct", !isStructType("STRUCT(a INT)[]"));
    report("Array with whitespace STRUCT is not struct", !isStructType("STRUCT(a INT)[ ]"));
    report("LIST of STRUCT is not struct", !isStructType("LIST(STRUCT(a INT))"));
    report("Null/Empty input", !isStructType("") && !isStructType(null) && !isStructType(undefined));
  }

  // -------------------------------------------------------------------------
  // SECTION 3: Top-Level Comma Splitting (splitTopLevelComma)
  // -------------------------------------------------------------------------
  console.log(`\n${BOLD}--- 3. Top-Level Comma Splitting (splitTopLevelComma) ---${RESET}`);
  {
    const parts1 = splitTopLevelComma("a BIGINT, b VARCHAR, c DOUBLE");
    report("Simple comma split", parts1.length === 3 && parts1[0] === "a BIGINT" && parts1[1] === "b VARCHAR" && parts1[2] === "c DOUBLE");

    const parts2 = splitTopLevelComma('"deep,comma" BIGINT, nested STRUCT(x INT, y VARCHAR)');
    report("Commas inside quotes and parens", parts2.length === 2 && parts2[0] === '"deep,comma" BIGINT' && parts2[1] === "nested STRUCT(x INT, y VARCHAR)");

    const parts3 = splitTopLevelComma('"quote""name,more" VARCHAR, arr BIGINT[]');
    report("Escaped quotes with comma", parts3.length === 2 && parts3[0] === '"quote""name,more" VARCHAR' && parts3[1] === "arr BIGINT[]");
  }

  // -------------------------------------------------------------------------
  // SECTION 4: Field Definition & Struct Tree Parsing
  // -------------------------------------------------------------------------
  console.log(`\n${BOLD}--- 4. Struct Field Parsing (parseStructFields) ---${RESET}`);
  {
    const unquotedDef = parseFieldDef("EventRecordID BIGINT");
    report("Unquoted field def", unquotedDef.fieldName === "EventRecordID" && unquotedDef.fieldType === "BIGINT");

    const quotedDef = parseFieldDef('"#attributes" STRUCT(Name VARCHAR)');
    report("Quoted field def", quotedDef.fieldName === "#attributes" && quotedDef.fieldType === "STRUCT(Name VARCHAR)");

    const escapedDef = parseFieldDef('"quote""key" BIGINT');
    report("Escaped quote field def", escapedDef.fieldName === 'quote"key' && escapedDef.fieldType === "BIGINT");

    // Deep struct parsing
    const complexType = 'STRUCT("@xmlns" VARCHAR, "System" STRUCT(Provider STRUCT("#attributes" STRUCT("Name" VARCHAR, Guid UUID)), EventID STRUCT("#attributes" STRUCT(Qualifiers BIGINT), "#text" BIGINT)), arr_struct STRUCT(x INT)[])';
    const fields = parseStructFields(complexType);
    report("Complex struct parses top fields", fields.length === 3);
    report("Field 0 is @xmlns (VARCHAR)", fields[0].fieldName === "@xmlns" && !fields[0].isStruct);
    report("Field 1 is System (STRUCT)", fields[1].fieldName === "System" && fields[1].isStruct && fields[1].children.length === 2);
    report("System.Provider is STRUCT", fields[1].children[0].fieldName === "Provider" && fields[1].children[0].isStruct);
    report("System.EventID is STRUCT", fields[1].children[1].fieldName === "EventID" && fields[1].children[1].isStruct);
    report("arr_struct is treated as non-struct array", fields[2].fieldName === "arr_struct" && !fields[2].isStruct);
  }

  // -------------------------------------------------------------------------
  // SECTION 5: Leaf Projection Extraction & EVTX RecordID 93937 Parity
  // -------------------------------------------------------------------------
  console.log(`\n${BOLD}--- 5. Leaf Projections & EVTX RecordID 93937 Schema Parity ---${RESET}`);
  {
    const evtxType = 'STRUCT("@xmlns" VARCHAR, "System" STRUCT(Provider STRUCT("#attributes" STRUCT("Name" VARCHAR, Guid UUID)), EventID STRUCT("#attributes" STRUCT(Qualifiers BIGINT), "#text" BIGINT), TimeCreated STRUCT("#attributes" STRUCT(SystemTime VARCHAR)), EventRecordID BIGINT, Computer VARCHAR), EventData STRUCT(param1 VARCHAR, param2 VARCHAR, "Binary" VARCHAR))';
    const leaves = extractLeafProjections("Event", evtxType);

    report("EVTX leaf count parity (11 leaves)", leaves.length === 11);

    const expectedPaths = [
      { alias: "Event.@xmlns", sql: '"Event"."@xmlns"', type: "VARCHAR" },
      { alias: "Event.System.Provider.#attributes.Name", sql: '"Event"."System"."Provider"."#attributes"."Name"', type: "VARCHAR" },
      { alias: "Event.System.Provider.#attributes.Guid", sql: '"Event"."System"."Provider"."#attributes"."Guid"', type: "UUID" },
      { alias: "Event.System.EventID.#attributes.Qualifiers", sql: '"Event"."System"."EventID"."#attributes"."Qualifiers"', type: "BIGINT" },
      { alias: "Event.System.EventID.#text", sql: '"Event"."System"."EventID"."#text"', type: "BIGINT" },
      { alias: "Event.System.TimeCreated.#attributes.SystemTime", sql: '"Event"."System"."TimeCreated"."#attributes"."SystemTime"', type: "VARCHAR" },
      { alias: "Event.System.EventRecordID", sql: '"Event"."System"."EventRecordID"', type: "BIGINT" },
      { alias: "Event.System.Computer", sql: '"Event"."System"."Computer"', type: "VARCHAR" },
      { alias: "Event.EventData.param1", sql: '"Event"."EventData"."param1"', type: "VARCHAR" },
      { alias: "Event.EventData.param2", sql: '"Event"."EventData"."param2"', type: "VARCHAR" },
      { alias: "Event.EventData.Binary", sql: '"Event"."EventData"."Binary"', type: "VARCHAR" },
    ];

    for (const exp of expectedPaths) {
      const match = leaves.find((l) => l.columnAlias === exp.alias);
      const isMatch = match && match.sqlExpression === exp.sql && match.targetType === exp.type;
      report(`EVTX Leaf: ${exp.alias}`, !!isMatch, isMatch ? `${match.sqlExpression} (${match.targetType})` : "Mismatch");
    }
  }

  // -------------------------------------------------------------------------
  // SECTION 6: Live DuckDB Integration (DESCRIBE Introspection)
  // -------------------------------------------------------------------------
  console.log(`\n${BOLD}--- 6. Live DuckDB DESCRIBE Schema Introspection ---${RESET}`);
  {
    const db = new duckdb.Database(":memory:");
    const conn = db.connect();

    // Promisified connection wrapper
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

    // 1. Nested JSON with structs and special characters
    const testNestedData = {
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
      TopPrimitive: 42,
      "Dotted.Key": "DotValue",
      "Space Key": "SpaceValue",
      'Quote"Key': "QuoteValue",
      "Slash/Key": "SlashValue",
      "Tiếng_Việt": "Xin chào",
    };

    const nestedFilePath = path.resolve(tmpDir, "unit_test_nested.json");
    fs.writeFileSync(nestedFilePath, JSON.stringify(testNestedData));

    const introResult = await introspectJsonSchema(dbConn, nestedFilePath, 2048);
    report("introspectJsonSchema detects STRUCT columns", introResult.hasStructColumns === true);
    report("introspectJsonSchema finds all top-level columns", introResult.columns.length === 7);
    report("introspectJsonSchema produces leaf projections", introResult.leafProjections.length >= 17);

    // Verify dynamic projection builder output
    const dynProj = buildDynamicProjection(introResult);
    report("buildDynamicProjection produces projection expressions", dynProj.projectionExpressions.length === introResult.leafProjections.length);
    report("buildDynamicProjection hasStructColumns is true", dynProj.hasStructColumns === true);

    // 2. Flat JSON without structs
    const flatData = [
      { id: 1, name: "Alice", active: true },
      { id: 2, name: "Bob", active: false },
    ];
    const flatFilePath = path.resolve(tmpDir, "unit_test_flat.json");
    fs.writeFileSync(flatFilePath, JSON.stringify(flatData));

    const flatResult = await introspectJsonSchema(dbConn, flatFilePath, 2048);
    report("introspectJsonSchema on flat JSON hasStructColumns is false", flatResult.hasStructColumns === false);
    report("Flat JSON leaf projections match column count", flatResult.leafProjections.length === 3);

    // Cleanup scratch files
    try {
      if (fs.existsSync(nestedFilePath)) fs.unlinkSync(nestedFilePath);
      if (fs.existsSync(flatFilePath)) fs.unlinkSync(flatFilePath);
    } catch {}
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
