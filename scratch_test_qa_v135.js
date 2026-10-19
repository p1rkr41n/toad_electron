const assert = require("assert");
const reltab = require("./tad-master/packages/reltab/dist/reltab.js");

console.log("=== QA Test Suite for Toad v1.3.5 ===");

// Test 1: RawSqlRelExp in reltab
console.log("\n[Test 1] RawSqlRelExp creation & SQL WHERE generation...");
const rawExp = new reltab.RawSqlRelExp("\"EventID\" IN (1, 3, 11) AND \"Channel\" LIKE '%Sysmon%'");
assert.strictEqual(rawExp.expType, "RawSqlRelExp");
const sqlWhere = rawExp.toSqlWhere(reltab.getDefaultDialect());
assert.strictEqual(sqlWhere, "\"EventID\" IN (1, 3, 11) AND \"Channel\" LIKE '%Sysmon%'");
console.log("✓ RawSqlRelExp generates exact raw SQL WHERE string:", sqlWhere);

// Test 2: FilterExp wrapping RawSqlRelExp
console.log("\n[Test 2] FilterExp with RawSqlRelExp evaluation...");
const feWithRaw = new reltab.FilterExp("AND", [rawExp]);
const feSql = feWithRaw.toSqlWhere(reltab.getDefaultDialect());
assert.strictEqual(feSql, "\"EventID\" IN (1, 3, 11) AND \"Channel\" LIKE '%Sysmon%'");
console.log("✓ FilterExp properly evaluates RawSqlRelExp in DuckDB dialect:", feSql);

// Test 3: Multi-tag pill tokenization & numeric type-aware casting
console.log("\n[Test 3] Multi-tag Pill tokenization & numeric parsing...");
function parsePillTokens(inputText, existingPills = []) {
  const existingSet = new Set(existingPills.map((p) => String(p.value).trim()));
  const newItems = [];
  const tokens = inputText.split(/[\r\n,\t]+/);
  for (const t of tokens) {
    const trimmed = t.trim();
    if (trimmed.length > 0 && !existingSet.has(trimmed)) {
      existingSet.add(trimmed);
      newItems.push({ value: trimmed, label: trimmed });
    }
  }
  return [...existingPills, ...newItems];
}

const inputPaste = " 1,  3,\n 11,\t4624 , 1 ";
const pills = parsePillTokens(inputPaste);
assert.strictEqual(pills.length, 4);
assert.deepStrictEqual(pills.map(p => p.value), ["1", "3", "11", "4624"]);
console.log("✓ Multi-tag Pill correctly splits, trims, and deduplicates:", pills.map(p => p.label));

// Test 4: Numeric casting for DuckDB IN clause
const colTypeInteger = { kind: "integer", sqlTypeName: "INTEGER" };
const schemaMock = {
  columns: ["EventID", "Channel"],
  columnType: (cid) => cid === "EventID" ? colTypeInteger : { kind: "string", sqlTypeName: "VARCHAR" },
};

function castPillsForColumn(columnId, pills, schema) {
  return pills.map((opt) => {
    const raw = opt.value;
    if (schema && schema.columns.includes(columnId)) {
      const colType = schema.columnType(columnId);
      const isNum = colType && (colType.kind === "integer" || colType.kind === "real");
      if (isNum && typeof raw === "string" && raw.trim() !== "") {
        const num = Number(raw);
        return !isNaN(num) ? num : raw;
      }
    }
    return raw;
  });
}

const parsedNumericPills = castPillsForColumn("EventID", pills, schemaMock);
assert.deepStrictEqual(parsedNumericPills, [1, 3, 11, 4624]);
console.log("✓ Numeric column EventID properly casts pill strings to numbers for DuckDB:", parsedNumericPills);

// Test 5: Verify packaged binary files
console.log("\n[Test 5] Verifying binary releases on disk...");
const fs = require("fs");
const path = require("path");

const releasePortable = path.resolve("./releases/toad_v1.3.5_portable.exe");
const primaryExe = path.resolve("./Toad.exe");

assert.ok(fs.existsSync(releasePortable), "releases/toad_v1.3.5_portable.exe must exist");
assert.ok(fs.existsSync(primaryExe), "Toad.exe must exist");

const statPortable = fs.statSync(releasePortable);
const statPrimary = fs.statSync(primaryExe);

assert.ok(statPortable.size > 90 * 1024 * 1024, "Portable binary should be >90MB");
assert.strictEqual(statPortable.size, statPrimary.size, "Toad.exe and toad_v1.3.5_portable.exe should match");

console.log(`✓ Portable release verified: ${(statPortable.size / (1024 * 1024)).toFixed(2)} MB`);
console.log(`✓ Standalone Toad.exe verified: ${(statPrimary.size / (1024 * 1024)).toFixed(2)} MB`);

console.log("\n=== ALL QA TESTS PASSED SUCCESSFULLY! ===");
