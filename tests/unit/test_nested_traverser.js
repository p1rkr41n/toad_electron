/**
 * test_nested_traverser.js
 * Unit test suite for NestedJsonTraverser:
 * - Recursive leaf node extraction
 * - JSON array preservation as string
 * - DuckDB type inference (BIGINT, DOUBLE, BOOLEAN, TIMESTAMP, VARCHAR)
 * - Safe bracket path and DuckDB quoted dot path generation
 * - Fill rate computation across sample event pool
 * - Windows EVTX Record 93937 schema parity
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

const {
  NestedJsonTraverser,
  traverseJsonLeaves,
  scanJsonSamplePool,
  inferType,
  buildSafeBracketPath,
  buildSafeDuckDbJsonPath,
  buildArrowPath
} = require(path.resolve(
  ROOT_DIR,
  "tad-master/packages/toadviewer/src/utils/NestedJsonTraverser.ts"
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

async function runTestSuite() {
  console.log(`\n${BOLD}${CYAN}======================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}   UNIT TEST SUITE: NestedJsonTraverser (TOAD v2.5.1 M1)            ${RESET}`);
  console.log(`${BOLD}${CYAN}======================================================================${RESET}\n`);

  // TEST 1: Basic Flat Object Traversal
  try {
    const flatObj = {
      name: "Server-01",
      port: 8080,
      active: true,
      ratio: 0.95,
      description: null
    };
    const fields = traverseJsonLeaves(flatObj);
    const byPath = new Map(fields.map((f) => [f.dotPath, f]));

    assert.strictEqual(fields.length, 5);
    assert.strictEqual(byPath.get("name").inferredType, "VARCHAR");
    assert.strictEqual(byPath.get("port").inferredType, "BIGINT");
    assert.strictEqual(byPath.get("active").inferredType, "BOOLEAN");
    assert.strictEqual(byPath.get("ratio").inferredType, "DOUBLE");
    assert.strictEqual(byPath.get("description").sampleValue, "null");
    report("TRAVERSER.1 Flat object traversal and primitive type detection", true);
  } catch (err) {
    report("TRAVERSER.1 Flat object traversal and primitive type detection", false, err.message);
  }

  // TEST 2: Deeply Nested Hierarchy Traversal
  try {
    const deepObj = {
      level1: {
        level2: {
          level3: {
            level4: "deepValue"
          }
        }
      }
    };
    const fields = traverseJsonLeaves(deepObj);
    assert.strictEqual(fields.length, 1);
    const leaf = fields[0];
    assert.deepStrictEqual(leaf.pathSegments, ["level1", "level2", "level3", "level4"]);
    assert.strictEqual(leaf.dotPath, "level1.level2.level3.level4");
    assert.strictEqual(leaf.jsonPathExpr, '$."level1"."level2"."level3"."level4"');
    assert.strictEqual(leaf.sampleValue, "deepValue");
    assert.strictEqual(leaf.inferredType, "VARCHAR");
    report("TRAVERSER.2 Deep 4-level nested object traversal", true);
  } catch (err) {
    report("TRAVERSER.2 Deep 4-level nested object traversal", false, err.message);
  }

  // TEST 3: Array Preservation as JSON String (without row burst)
  try {
    const arrayObj = {
      id: 101,
      tags: ["alpha", "beta", "gamma"],
      nestedList: [{ a: 1 }, { b: 2 }]
    };
    const fields = traverseJsonLeaves(arrayObj);
    const byPath = new Map(fields.map((f) => [f.dotPath, f]));

    assert.strictEqual(fields.length, 3);
    assert.strictEqual(byPath.get("tags").inferredType, "VARCHAR");
    assert.strictEqual(byPath.get("tags").sampleValue, JSON.stringify(["alpha", "beta", "gamma"]));
    assert.strictEqual(byPath.get("nestedList").inferredType, "VARCHAR");
    assert.strictEqual(
      byPath.get("nestedList").sampleValue,
      JSON.stringify([{ a: 1 }, { b: 2 }])
    );
    report("TRAVERSER.3 Array preservation as JSON string without row explosion", true);
  } catch (err) {
    report("TRAVERSER.3 Array preservation as JSON string without row explosion", false, err.message);
  }

  // TEST 4: DuckDB Type Inference (inferType)
  try {
    // BIGINT
    assert.strictEqual(inferType(12345), "BIGINT");
    assert.strictEqual(inferType(-999), "BIGINT");
    assert.strictEqual(inferType(0), "BIGINT");
    assert.strictEqual(inferType(BigInt(9007199254740991)), "BIGINT");

    // DOUBLE
    assert.strictEqual(inferType(3.14159), "DOUBLE");
    assert.strictEqual(inferType(-0.5), "DOUBLE");
    assert.strictEqual(inferType(1e-5), "DOUBLE");

    // BOOLEAN
    assert.strictEqual(inferType(true), "BOOLEAN");
    assert.strictEqual(inferType(false), "BOOLEAN");

    // TIMESTAMP (ISO-8601 strings)
    assert.strictEqual(inferType("2026-10-27T14:44:08.819818Z"), "TIMESTAMP");
    assert.strictEqual(inferType("2026-11-04T07:48:00Z"), "TIMESTAMP");
    assert.strictEqual(inferType("2026-10-27 14:44:08"), "TIMESTAMP");
    assert.strictEqual(inferType("2026-10-27T14:44:08.123+00:00"), "TIMESTAMP");

    // VARCHAR
    assert.strictEqual(inferType("Service Control Manager"), "VARCHAR");
    assert.strictEqual(inferType("stopped"), "VARCHAR");
    assert.strictEqual(inferType(""), "VARCHAR");
    assert.strictEqual(inferType(["arr"]), "VARCHAR");
    assert.strictEqual(inferType(null), "VARCHAR");
    assert.strictEqual(inferType(undefined), "VARCHAR");

    report("TRAVERSER.4 Strict DuckDB type inference across primitives and ISO timestamps", true);
  } catch (err) {
    report("TRAVERSER.4 Strict DuckDB type inference across primitives and ISO timestamps", false, err.message);
  }

  // TEST 5: Safe Bracket Path Generation ($["seg1"]["seg2"])
  try {
    const bracket1 = buildSafeBracketPath(["Event", "System", "EventID", "#text"]);
    assert.strictEqual(bracket1, '$["Event"]["System"]["EventID"]["#text"]');

    const bracketSpecial = buildSafeBracketPath(['special"quote', "dot.key", "slash/key", "@xmlns"]);
    assert.strictEqual(bracketSpecial, '$["special\\"quote"]["dot.key"]["slash/key"]["@xmlns"]');

    assert.strictEqual(buildSafeBracketPath([]), "$");
    report("TRAVERSER.5 Safe bracket path generator with character escaping", true);
  } catch (err) {
    report("TRAVERSER.5 Safe bracket path generator with character escaping", false, err.message);
  }

  // TEST 6: Safe DuckDB Quoted Dot Path Generation ($."seg1"."seg2")
  try {
    const dot1 = buildSafeDuckDbJsonPath(["Event", "System", "EventID", "#text"]);
    assert.strictEqual(dot1, '$."Event"."System"."EventID"."#text"');

    const dotSpecial = buildSafeDuckDbJsonPath(['quote"key', "space key", "dot.key", "slash/key"]);
    assert.strictEqual(dotSpecial, '$."quote\\"key"."space key"."dot.key"."slash/key"');

    assert.strictEqual(buildSafeDuckDbJsonPath([]), "$");
    report("TRAVERSER.6 Authoritative DuckDB quoted dot path generator", true);
  } catch (err) {
    report("TRAVERSER.6 Authoritative DuckDB quoted dot path generator", false, err.message);
  }

  // TEST 7: Arrow Operator Path Generation (col->'seg'->>'leaf')
  try {
    const arrowMulti = buildArrowPath("RawEvent", ["Event", "System", "EventID"]);
    assert.strictEqual(arrowMulti, '"RawEvent"->\'Event\'->\'System\'->>\'EventID\'');

    const arrowSingle = buildArrowPath("payload", ["leafKey"]);
    assert.strictEqual(arrowSingle, '"payload"->>\'leafKey\'');

    const arrowQuote = buildArrowPath("col", ["quote'key", "leaf"]);
    assert.strictEqual(arrowQuote, '"col"->\'quote\'\'key\'->>\'leaf\'');
    report("TRAVERSER.7 Safe DuckDB Arrow operator path generator", true);
  } catch (err) {
    report("TRAVERSER.7 Safe DuckDB Arrow operator path generator", false, err.message);
  }

  // TEST 8: Windows EVTX Record 93937 Schema Parity
  try {
    const evtxRecord93937 = {
      Event: {
        "@xmlns": "http://schemas.microsoft.com/win/2004/08/events/event",
        System: {
          Provider: {
            "#attributes": {
              Name: "Service Control Manager",
              Guid: "{555908d1-a6d7-4695-8e1e-26931d2012f4}"
            }
          },
          EventID: {
            "#attributes": { Qualifiers: 16384 },
            "#text": 7036
          },
          TimeCreated: {
            "#attributes": { SystemTime: "2026-10-27T14:44:08.819818Z" }
          },
          EventRecordID: 93937,
          Computer: "WIN-3MJ9DEQ5B94"
        },
        EventData: {
          param1: "Microsoft Passport Container",
          param2: "stopped",
          Binary: "4E0067006300430074006E0072005300760063002F0031000000"
        }
      }
    };

    const fields = traverseJsonLeaves(evtxRecord93937);
    const fieldMap = new Map(fields.map((f) => [f.dotPath, f]));

    // Check all 11 required leaf paths from spec_report § 7.2
    const expected = [
      { path: "Event.@xmlns", type: "VARCHAR", val: "http://schemas.microsoft.com/win/2004/08/events/event" },
      { path: "Event.System.Provider.#attributes.Name", type: "VARCHAR", val: "Service Control Manager" },
      { path: "Event.System.Provider.#attributes.Guid", type: "VARCHAR", val: "{555908d1-a6d7-4695-8e1e-26931d2012f4}" },
      { path: "Event.System.EventID.#attributes.Qualifiers", type: "BIGINT", val: "16384" },
      { path: "Event.System.EventID.#text", type: "BIGINT", val: "7036" },
      { path: "Event.System.TimeCreated.#attributes.SystemTime", type: "TIMESTAMP", val: "2026-10-27T14:44:08.819818Z" },
      { path: "Event.System.EventRecordID", type: "BIGINT", val: "93937" },
      { path: "Event.System.Computer", type: "VARCHAR", val: "WIN-3MJ9DEQ5B94" },
      { path: "Event.EventData.param1", type: "VARCHAR", val: "Microsoft Passport Container" },
      { path: "Event.EventData.param2", type: "VARCHAR", val: "stopped" },
      { path: "Event.EventData.Binary", type: "VARCHAR", val: "4E0067006300430074006E0072005300760063002F0031000000" }
    ];

    for (const exp of expected) {
      assert(fieldMap.has(exp.path), `Missing expected field: ${exp.path}`);
      const actual = fieldMap.get(exp.path);
      assert.strictEqual(actual.inferredType, exp.type, `Type mismatch for ${exp.path}`);
      assert.strictEqual(actual.sampleValue, exp.val, `Value mismatch for ${exp.path}`);
    }

    report(
      "TRAVERSER.8 Windows EVTX Record 93937 100% leaf extraction parity (#attributes, #text, @xmlns)",
      true,
      `Matched all ${expected.length} leaf fields`
    );
  } catch (err) {
    report(
      "TRAVERSER.8 Windows EVTX Record 93937 100% leaf extraction parity (#attributes, #text, @xmlns)",
      false,
      err.message
    );
  }

  // TEST 9: Fill Rate Computation across Multi-Event Sample Pool
  try {
    const samplePool = [
      { id: 1, host: "server-a", ip: "10.0.0.1", tag: "web" },
      { id: 2, host: "server-b", ip: "10.0.0.2" },
      { id: 3, host: "server-c", ip: "10.0.0.3", tag: "db" },
      { id: 4, host: "server-d" }
    ];

    const fields = scanJsonSamplePool(samplePool, { sampleLimit: 100 });
    const byPath = new Map(fields.map((f) => [f.dotPath, f]));

    assert.strictEqual(byPath.get("id").fillRate, 1.0);     // 4/4
    assert.strictEqual(byPath.get("host").fillRate, 1.0);   // 4/4
    assert.strictEqual(byPath.get("ip").fillRate, 0.75);    // 3/4
    assert.strictEqual(byPath.get("tag").fillRate, 0.5);    // 2/4
    report("TRAVERSER.9 Fill rate accurately computed across sample pool (1.0, 0.75, 0.5)", true);
  } catch (err) {
    report("TRAVERSER.9 Fill rate accurately computed across sample pool (1.0, 0.75, 0.5)", false, err.message);
  }

  // TEST 10: Edge Cases, Circular References & Max Depth Protection
  try {
    // Circular reference
    const circularObj = { a: 1 };
    circularObj.self = circularObj;
    const circFields = traverseJsonLeaves(circularObj);
    assert(circFields.length >= 1);

    // Max depth
    const deepObj = { a: { b: { c: { d: { e: { f: "too_deep" } } } } } };
    const limitedFields = traverseJsonLeaves(deepObj, { maxDepth: 3 });
    assert(limitedFields.some((f) => f.dotPath.startsWith("a.b.c")));

    // Invalid JSON string
    const invalidFields = traverseJsonLeaves("INVALID_JSON{");
    assert.strictEqual(invalidFields.length, 0);

    // Null/undefined
    assert.strictEqual(traverseJsonLeaves(null).length, 0);
    assert.strictEqual(traverseJsonLeaves(undefined).length, 0);

    // Empty object
    assert.strictEqual(traverseJsonLeaves({}).length, 0);

    report("TRAVERSER.10 Edge cases handled gracefully (circular, maxDepth, invalid JSON, null)", true);
  } catch (err) {
    report("TRAVERSER.10 Edge cases handled gracefully (circular, maxDepth, invalid JSON, null)", false, err.message);
  }

  console.log(`\n${BOLD}======================================================================${RESET}`);
  console.log(`  NESTED JSON TRAVERSER SUMMARY: ${passCount}/${passCount + failCount} PASSED`);
  console.log(`${BOLD}======================================================================${RESET}\n`);

  if (failCount > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
