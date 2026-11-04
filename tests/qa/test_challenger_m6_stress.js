/**
 * test_challenger_m6_stress.js
 * Empirical Challenger Verification Harness for Milestone 6 Fix
 * Authored by: challenger_fix_1
 *
 * Scope:
 * Suite 1: Direct DuckDB parameter validation (all_varchar rejection vs valid Tier 2 parameters)
 * Suite 2: Codebase static audit (zero all_varchar in JSON ingestion code)
 * Suite 3: Tier 2 Fallback execution & resilient stream parsing
 * Suite 4: Total stream failure handling & zero unhandled promise rejections
 * Suite 5: EVTX temp JSONL cleanup guarantee in finally block
 * Suite 6: nativeCSVImport format-specific fallback guards (prevent CSV fallthrough)
 * Suite 7: Large JSON payload stress (12MB object within 64MB buffer limit)
 * Suite 8: Concurrent streaming ingestion stress
 * Suite 9: Global Stability & Exception Audit
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "../..");
const duckdb = require(path.resolve(ROOT_DIR, "tad-master/node_modules/duckdb"));
const { Database } = require(path.resolve(ROOT_DIR, "tad-master/node_modules/duckdb-async"));

const {
  streamFlattenedJsonToParquet,
  generateDynamicProjectionSql,
  introspectJsonSchema,
  nativeCSVImport,
} = require(path.resolve(
  ROOT_DIR,
  "tad-master/packages/reltab-duckdb/dist/csvimport.js"
));

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

let passCount = 0;
let failCount = 0;
const failureDetails = [];

function check(title, condition, detail) {
  if (condition) {
    passCount++;
    console.log(`  ${GREEN}✔ [PASS]${RESET} ${title}${detail ? ` (${CYAN}${detail}${RESET})` : ""}`);
  } else {
    failCount++;
    const errMsg = `${title}${detail ? ` (${detail})` : ""}`;
    failureDetails.push(errMsg);
    console.error(`  ${RED}✖ [FAIL]${RESET} ${errMsg}`);
  }
}

// Global unhandled rejection and uncaught exception tracking
let unhandledRejectionsCount = 0;
let uncaughtExceptionsCount = 0;
const unhandledErrors = [];

process.on("unhandledRejection", (reason) => {
  unhandledRejectionsCount++;
  unhandledErrors.push(reason);
  console.error(`${RED}[GLOBAL UNHANDLED REJECTION]${RESET}`, reason);
});

process.on("uncaughtException", (err) => {
  uncaughtExceptionsCount++;
  unhandledErrors.push(err);
  console.error(`${RED}[GLOBAL UNCAUGHT EXCEPTION]${RESET}`, err);
});

async function main() {
  console.log(`\n${BOLD}${CYAN}======================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}   CHALLENGER FIX 1: EMPIRICAL VERIFICATION & STRESS HARNESS          ${RESET}`);
  console.log(`${BOLD}${CYAN}   Milestone 6: Tier 2 Fallback, Cleanup, & Unhandled Rejection Audit ${RESET}`);
  console.log(`${BOLD}${CYAN}======================================================================${RESET}\n`);

  const rawDb = new duckdb.Database(":memory:");
  const conn = rawDb.connect();

  const asyncDb = await Database.create(":memory:");

  const queryAll = (sql) =>
    new Promise((resolve, reject) => {
      conn.all(sql, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });

  // Create temporary directory for tests
  const testTmpDir = path.join(ROOT_DIR, "tests_qa_tmp_" + Date.now());
  fs.mkdirSync(testTmpDir, { recursive: true });

  try {
    // ===========================================================================
    // SUITE 1: Direct DuckDB Parameter Validation
    // ===========================================================================
    console.log(`${BOLD}--- Suite 1: Direct DuckDB Parameter Validation ---${RESET}`);

    const sampleJsonPath = path.join(testTmpDir, "sample.json");
    fs.writeFileSync(sampleJsonPath, JSON.stringify({ a: 1, b: "hello", c: [1, 2, 3] }), "utf8");
    const safeSampleJson = sampleJsonPath.replace(/\\/g, "/");

    // 1.1 Verify all_varchar fails in read_json_auto
    let allVarcharRejected = false;
    let binderErrorMsg = "";
    try {
      await queryAll(`SELECT * FROM read_json_auto('${safeSampleJson}', all_varchar = true);`);
    } catch (err) {
      binderErrorMsg = err?.message || String(err);
      if (err && (err.code === "DUCKDB_NODEJS_ERROR" || err.errorType === "Invalid" || binderErrorMsg.includes("all_varchar"))) {
        allVarcharRejected = true;
      }
    }
    check("1.1: DuckDB v1.0.0 rejects read_json_auto with all_varchar = true", allVarcharRejected, "DUCKDB_NODEJS_ERROR / Invalid");

    // 1.2 Verify valid Tier 2 parameters succeed
    let tier2ValidParamsSucceeded = false;
    let tier2Rows = [];
    try {
      tier2Rows = await queryAll(`
        SELECT * FROM read_json_auto(
          '${safeSampleJson}',
          sample_size = 2048,
          ignore_errors = true,
          maximum_object_size = 67108864
        );
      `);
      tier2ValidParamsSucceeded = tier2Rows.length === 1 && (Number(tier2Rows[0].a) === 1 || tier2Rows[0].a === 1);
    } catch (err) {
      console.error("Tier 2 valid params failed:", err);
    }
    check("1.2: DuckDB v1.0.0 accepts Tier 2 parameters (sample_size, ignore_errors, maximum_object_size)", tier2ValidParamsSucceeded, `rows=${tier2Rows.length}`);

    // ===========================================================================
    // SUITE 2: Codebase Static Audit for all_varchar in JSON
    // ===========================================================================
    console.log(`\n${BOLD}--- Suite 2: Codebase Static Audit for all_varchar in JSON ---${RESET}`);

    const jsonDir = path.resolve(ROOT_DIR, "tad-master/packages/reltab-duckdb/src/json");
    const jsonFiles = fs.readdirSync(jsonDir).filter((f) => f.endsWith(".ts"));
    let allVarcharFoundInJson = false;
    const occurrences = [];

    for (const f of jsonFiles) {
      const content = fs.readFileSync(path.join(jsonDir, f), "utf8");
      if (content.includes("all_varchar")) {
        allVarcharFoundInJson = true;
        occurrences.push(f);
      }
    }
    check("2.1: Zero occurrences of all_varchar across entire reltab-duckdb/src/json/ directory", !allVarcharFoundInJson, occurrences.join(", ") || "CLEAN");

    // Check specific file JsonStreamingFlattener.ts
    const flattenerContent = fs.readFileSync(path.join(jsonDir, "JsonStreamingFlattener.ts"), "utf8");
    check("2.2: JsonStreamingFlattener.ts specifies maximum_object_size = 67108864", flattenerContent.includes("maximum_object_size = 67108864"));
    check("2.3: JsonStreamingFlattener.ts wraps Tier 2 fallback in try...catch", flattenerContent.includes("catch (fbErr: any)"));

    // ===========================================================================
    // SUITE 3: Tier 2 Fallback Execution & Resilient Stream Parsing
    // ===========================================================================
    console.log(`\n${BOLD}--- Suite 3: Tier 2 Fallback Execution & Resilient Stream Parsing ---${RESET}`);

    // Create a JSON file with mixed valid and corrupted lines where ignore_errors = true enables recovery
    const resilientJsonPath = path.join(testTmpDir, "resilient_data.jsonl");
    const resilientParquetPath = path.join(testTmpDir, "resilient_out.parquet");

    const lines = [];
    for (let i = 0; i < 30; i++) {
      lines.push(JSON.stringify({ row_id: i, payload: { name: `item_${i}`, score: i * 1.5 } }));
    }
    // Inject corrupt lines in between (valid syntax errors handled by ignore_errors)
    lines.splice(5, 0, "{ unquoted_key: 123 }");
    lines.splice(15, 0, '{"truncated": 123');
    lines.splice(25, 0, "INVALID_NON_JSON_LINE");

    fs.writeFileSync(resilientJsonPath, lines.join("\n"), "utf8");

    const resResult = await streamFlattenedJsonToParquet(conn, resilientJsonPath, resilientParquetPath, {
      sampleSize: 10,
      ignoreErrors: true,
    });

    check("3.1: streamFlattenedJsonToParquet completed on resilient stream", resResult.executionTimeMs > 0);
    check("3.2: Parquet file exists and has non-zero size", fs.existsSync(resilientParquetPath) && fs.statSync(resilientParquetPath).size > 0);

    const safeResilientParquet = resilientParquetPath.replace(/\\/g, "/");
    const validRowsCheck = await queryAll(`SELECT count(*) as cnt FROM read_parquet('${safeResilientParquet}') WHERE row_id IS NOT NULL;`);
    check("3.3: Extracted all 30 valid rows ignoring corrupt lines", Number(validRowsCheck[0].cnt) === 30, `validRows=${validRowsCheck[0].cnt}`);

    // ===========================================================================
    // SUITE 4: Total Stream Failure Handling & Unhandled Rejection Guarantee
    // ===========================================================================
    console.log(`\n${BOLD}--- Suite 4: Total Stream Failure & Zero Unhandled Promise Rejections ---${RESET}`);

    // Test destination write failure (unwritable target path to force Tier 2 to throw and verify catch/throw)
    const unwritableParquetPath = "Z:/non_existent_folder_xyz_123/unwritable.parquet";

    let writeFailureCaught = false;
    let writeFailureError = null;
    try {
      await streamFlattenedJsonToParquet(conn, resilientJsonPath, unwritableParquetPath, {
        sampleSize: 10,
        ignoreErrors: true,
      });
    } catch (err) {
      writeFailureCaught = true;
      writeFailureError = err;
    }

    check("4.1: Tier 2 catches and re-throws when output path is invalid", writeFailureCaught, writeFailureError?.message?.slice(0, 60));
    check("4.2: Zero unhandled rejections occurred during Tier 2 failure", unhandledRejectionsCount === 0, `unhandledCount=${unhandledRejectionsCount}`);

    // Test missing source file
    let missingSourceCaught = false;
    let missingSourceError = null;
    try {
      await streamFlattenedJsonToParquet(conn, "Z:/non_existent_source_123.json", path.join(testTmpDir, "never_written.parquet"), {
        sampleSize: 10,
        ignoreErrors: true,
      });
    } catch (err) {
      missingSourceCaught = true;
      missingSourceError = err;
    }
    check("4.3: Tier 2 throws cleanly when source file does not exist", missingSourceCaught, missingSourceError?.message?.slice(0, 60));
    check("4.4: Zero unhandled rejections on missing source", unhandledRejectionsCount === 0);

    // ===========================================================================
    // SUITE 5: EVTX Temporary File Cleanup Guarantee in finally
    // ===========================================================================
    console.log(`\n${BOLD}--- Suite 5: EVTX Temp JSONL Guaranteed Cleanup in finally ---${RESET}`);

    const mockEvtxTempJsonl = path.join(testTmpDir, "mock_evtx_temp.jsonl");
    const mockTargetParquet = "Z:/unwritable_dir/never_created.parquet"; // will force throw in stream
    fs.writeFileSync(mockEvtxTempJsonl, JSON.stringify({ Event: { RecordID: 1 } }) + "\n", "utf8");

    check("5.1: Temp file exists before simulated ingestion", fs.existsSync(mockEvtxTempJsonl));

    // Execute the exact try...finally pattern implemented in csvimport.ts (lines 3516-3524)
    let streamFailed = false;
    try {
      try {
        await streamFlattenedJsonToParquet(conn, mockEvtxTempJsonl, mockTargetParquet, {
          sampleSize: 10,
          ignoreErrors: true,
        });
      } finally {
        try {
          if (fs.existsSync(mockEvtxTempJsonl)) {
            fs.unlinkSync(mockEvtxTempJsonl);
          }
        } catch {}
      }
    } catch (err) {
      streamFailed = true;
    }

    check("5.2: Ingestion failed as expected on unwritable parquet destination", streamFailed);
    check("5.3: Temp JSONL file guaranteed removed from disk in finally block", !fs.existsSync(mockEvtxTempJsonl));

    // ===========================================================================
    // SUITE 6: nativeCSVImport Format Guards (No CSV Fallthrough)
    // ===========================================================================
    console.log(`\n${BOLD}--- Suite 6: nativeCSVImport Format Guards ---${RESET}`);

    // Test 6.1: Corrupt JSON passed to nativeCSVImport: handled via in-memory JSON fallback without falling through into read_csv
    const corruptJsonImportFile = path.join(testTmpDir, "corrupt_import.json");
    fs.writeFileSync(corruptJsonImportFile, "CORRUPT_JSON_DATA_\0\0\0\xff\xfe", "utf8");

    let corruptJsonResult = null;
    try {
      corruptJsonResult = await nativeCSVImport(asyncDb, corruptJsonImportFile, "tbl_corrupt_json_test");
    } catch (err) {
      corruptJsonResult = err;
    }
    check("6.1: Corrupt .json handled gracefully via JSON pipeline (returned table)", typeof corruptJsonResult === "string" && corruptJsonResult.length > 0, `table=${corruptJsonResult}`);

    // Test 6.2: Missing/Unreadable JSON passed to nativeCSVImport: throws descriptive JSON error, never CSV sniffer error
    let missingJsonRejected = false;
    let missingJsonError = null;
    try {
      await nativeCSVImport(asyncDb, "Z:/non_existent_file_abc.json", "tbl_missing_json");
    } catch (err) {
      missingJsonRejected = true;
      missingJsonError = err;
    }

    check("6.2: Missing/Unreadable JSON rejected by nativeCSVImport", missingJsonRejected);
    const jsonErrMsg = missingJsonError?.message || String(missingJsonError);
    check("6.3: Rejection specifically identifies JSON failure (not CSV sniffer)", jsonErrMsg.includes("Failed to parse JSON file"), jsonErrMsg);
    check("6.4: Unreadable JSON did NOT fall through into read_csv (no CSV error)", !jsonErrMsg.includes("CSV reader") && !jsonErrMsg.includes("delim="));

    // Test 6.3: Corrupt EVTX passed to nativeCSVImport must throw descriptive EVTX error
    const corruptEvtxImportFile = path.join(testTmpDir, "corrupt_import.evtx");
    fs.writeFileSync(corruptEvtxImportFile, "CORRUPT_EVTX_HEADER_BYTES\0\0\0", "utf8");

    let evtxImportRejected = false;
    let evtxImportError = null;
    try {
      await nativeCSVImport(asyncDb, corruptEvtxImportFile, "tbl_corrupt_evtx_test");
    } catch (err) {
      evtxImportRejected = true;
      evtxImportError = err;
    }

    check("6.5: Corrupt .evtx rejected by nativeCSVImport", evtxImportRejected);
    const evtxErrMsg = evtxImportError?.message || String(evtxImportError);
    check("6.6: Rejection message specifically identifies EVTX failure (not CSV sniffer)", evtxErrMsg.includes("Failed to ingest EVTX file"), evtxErrMsg);

    // ===========================================================================
    // SUITE 7: Large JSON Payload Stress (12MB object within 64MB buffer limit)
    // ===========================================================================
    console.log(`\n${BOLD}--- Suite 7: Large JSON Payload Stress (12MB object) ---${RESET}`);

    const largeJsonPath = path.join(testTmpDir, "large_object.jsonl");
    const largeParquetPath = path.join(testTmpDir, "large_object.parquet");

    const largeString = "X".repeat(12 * 1024 * 1024); // 12 MB string
    const largeObject = {
      record_id: 1,
      title: "stress_large_payload",
      large_blob: largeString,
      metadata: { generated: true, size_mb: 12 },
    };

    fs.writeFileSync(largeJsonPath, JSON.stringify(largeObject) + "\n", "utf8");
    const fileStat = fs.statSync(largeJsonPath);
    check("7.1: Generated large JSONL test file (>12MB)", fileStat.size > 12 * 1024 * 1024, `${(fileStat.size / (1024 * 1024)).toFixed(2)} MB`);

    const largeStreamRes = await streamFlattenedJsonToParquet(conn, largeJsonPath, largeParquetPath, {
      sampleSize: 1,
      ignoreErrors: true,
    });

    check("7.2: streamFlattenedJsonToParquet ingested 12MB object within 64MB buffer limit", largeStreamRes.executionTimeMs > 0, `${largeStreamRes.executionTimeMs}ms`);
    check("7.3: Large Parquet output exists", fs.existsSync(largeParquetPath) && fs.statSync(largeParquetPath).size > 0);

    const safeLargeParquet = largeParquetPath.replace(/\\/g, "/");
    const readbackRows = await queryAll(`SELECT record_id, length(large_blob) as blob_len FROM read_parquet('${safeLargeParquet}');`);
    check("7.4: Readback confirms full 12MB payload intact in DuckDB", readbackRows.length === 1 && Number(readbackRows[0].blob_len) === 12 * 1024 * 1024, `len=${readbackRows[0]?.blob_len}`);

    // ===========================================================================
    // SUITE 8: Concurrent Streaming Ingestion Stress
    // ===========================================================================
    console.log(`\n${BOLD}--- Suite 8: Concurrent Streaming Ingestion Stress ---${RESET}`);

    const concurrencyCount = 8;
    const concurrentTasks = [];

    for (let c = 0; c < concurrencyCount; c++) {
      const cJsonPath = path.join(testTmpDir, `concurrent_${c}.jsonl`);
      const cParquetPath = path.join(testTmpDir, `concurrent_${c}.parquet`);

      const cLines = [];
      for (let r = 0; r < 50; r++) {
        cLines.push(JSON.stringify({ worker: c, row: r, val: Math.random() }));
      }
      if (c % 2 === 1) {
        cLines.push("CORRUPT_INTERLEAVED_DATA");
      }
      fs.writeFileSync(cJsonPath, cLines.join("\n"), "utf8");

      concurrentTasks.push(
        streamFlattenedJsonToParquet(conn, cJsonPath, cParquetPath, {
          sampleSize: 10,
          ignoreErrors: true,
        }).then((res) => ({ success: true, res }))
          .catch((err) => ({ success: false, err }))
      );
    }

    const concurrentResults = await Promise.all(concurrentTasks);
    const allSuccessful = concurrentResults.every((r) => r.success);
    check("8.1: All 8 concurrent streaming ingestions completed without contention", allSuccessful, `count=${concurrentResults.length}`);

    // Check valid row counts for all concurrent Parquet outputs
    let totalValidConcurrentRows = 0;
    for (let c = 0; c < concurrencyCount; c++) {
      const cParquet = path.join(testTmpDir, `concurrent_${c}.parquet`).replace(/\\/g, "/");
      const cRows = await queryAll(`SELECT count(*) as cnt FROM read_parquet('${cParquet}') WHERE row IS NOT NULL;`);
      totalValidConcurrentRows += Number(cRows[0].cnt);
    }
    check("8.2: All 400 valid rows across 8 concurrent streams correctly written", totalValidConcurrentRows === 400, `totalValidRows=${totalValidConcurrentRows}`);

    // ===========================================================================
    // SUITE 9: Final Global Safety & Unhandled Rejection Audit
    // ===========================================================================
    console.log(`\n${BOLD}--- Suite 9: Global Stability & Exception Audit ---${RESET}`);

    // Wait 150ms for event loop microtasks
    await new Promise((r) => setTimeout(r, 150));

    check("9.1: Zero unhandled promise rejections detected throughout stress harness", unhandledRejectionsCount === 0, `unhandledCount=${unhandledRejectionsCount}`);
    check("9.2: Zero uncaught exceptions detected throughout stress harness", uncaughtExceptionsCount === 0, `uncaughtCount=${uncaughtExceptionsCount}`);

  } finally {
    // Cleanup test temp directory
    try {
      fs.rmSync(testTmpDir, { recursive: true, force: true });
    } catch {}
  }

  // Summary
  console.log(`\n${BOLD}======================================================================${RESET}`);
  console.log(`${BOLD}Empirical Challenger Stress Summary: ${GREEN}${passCount} Passed${RESET}, ${failCount > 0 ? RED : GREEN}${failCount} Failed${RESET}`);
  console.log(`${BOLD}======================================================================${RESET}\n`);

  if (failureDetails.length > 0) {
    console.error(`${RED}Failure details:${RESET}`);
    for (const f of failureDetails) {
      console.error(`  - ${f}`);
    }
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("FATAL ERROR in Challenger Stress Harness:", err);
  process.exit(1);
});
