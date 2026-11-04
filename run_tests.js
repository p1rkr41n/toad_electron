#!/usr/bin/env node
/**
 * TOAD UNIFIED TEST RUNNER
 * Usage:
 *   node run_tests.js          -> Runs Smoke Test + Deep Integration QA (Default)
 *   node run_tests.js --all    -> Runs Smoke Test + Deep Integration QA + Legacy Suites
 *   node run_tests.js --smoke  -> Runs Smoke Test only
 *   node run_tests.js --qa     -> Runs Deep Integration QA only
 *   node run_tests.js --legacy -> Runs Legacy Use Cases only
 */

const { spawn } = require("child_process");
const path = require("path");

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

const args = process.argv.slice(2);
const runAll = args.includes("--all");
const smokeOnly = args.includes("--smoke");
const qaOnly = args.includes("--qa");
const legacyOnly = args.includes("--legacy");
const fuzzOnly = args.includes("--fuzz");
const unitOnly = args.includes("--unit");

const testsToRun = [];

if (smokeOnly) {
  testsToRun.push({ name: "Smoke Test (v2.5.1)", file: "tests/smoke_test.js" });
} else if (qaOnly) {
  testsToRun.push({ name: "Deep Integration QA (223 Tests)", file: "tests/deep_integration_qa.js" });
  testsToRun.push({ name: "Real-World Windows EVTX JSON Parity (35 Tests)", file: "tests/qa/test_realworld_evtx_json.js" });
  testsToRun.push({ name: "Adversarial Robustness & Fuzzing (40 Tests)", file: "tests/qa/test_json_adversarial_fuzz.js" });
  testsToRun.push({ name: "Grid Wrap Concurrency Stress (10 Tests)", file: "tests/qa/test_grid_wrap_concurrency_stress.js" });
} else if (legacyOnly) {
  testsToRun.push({ name: "Legacy Use Cases (19 Tests)", file: "tests/legacy_use_cases.js" });
} else if (fuzzOnly) {
  testsToRun.push({ name: "Adversarial Robustness & Fuzzing (40 Tests)", file: "tests/qa/test_json_adversarial_fuzz.js" });
} else if (unitOnly) {
  testsToRun.push({ name: "Nested Traverser Unit (10 Tests)", file: "tests/unit/test_nested_traverser.js" });
  testsToRun.push({ name: "DuckDB JSON Builder Unit (10 Tests)", file: "tests/unit/test_duckdb_json_builder.js" });
  testsToRun.push({ name: "JSON Schema Introspect Unit (50 Tests)", file: "tests/unit/test_json_schema_introspect.js" });
  testsToRun.push({ name: "JSON Streaming Flattener Unit (46 Tests)", file: "tests/unit/test_json_streaming_flattener.js" });
  testsToRun.push({ name: "Sample Scan Worker Unit (10 Tests)", file: "tests/unit/test_sample_scan_worker.js" });
  testsToRun.push({ name: "Project Files Table Wrap & Resize Unit (15 Tests)", file: "tests/unit/test_project_files_table_wrap_resize.js" });
  testsToRun.push({ name: "DataGrid Floating Wrap Unit (15 Tests)", file: "tests/unit/test_datagrid_floating_wrap.js" });
} else {
  // Default: Smoke Test + Arrow IPC + EVTX Parsing + Nested JSON + Deep Integration QA + Preload 3 Pages + QA Suites + Table/Grid Wrap Suites
  testsToRun.push({ name: "Smoke Test (v2.5.1)", file: "tests/smoke_test.js" });
  testsToRun.push({ name: "Apache Arrow IPC & invokeBinary (15 Tests)", file: "tests/test_arrow_ipc_stream.js" });
  testsToRun.push({ name: "EVTX Parsing & Schema Validation (6 Tests)", file: "tests/test_evtx_parsing_schema.js" });
  testsToRun.push({ name: "Nested JSON & Semi-Structured Ingestion (6 Tests)", file: "tests/test_nested_json.js" });
  testsToRun.push({ name: "Deep Integration QA (223 Tests)", file: "tests/deep_integration_qa.js" });
  testsToRun.push({ name: "Preload 3 Pages & Dynamic PageSize (10 Tests)", file: "tests/test_preload_3_pages.js" });
  testsToRun.push({ name: "Real-World Windows EVTX JSON Parity (35 Tests)", file: "tests/qa/test_realworld_evtx_json.js" });
  testsToRun.push({ name: "Adversarial Robustness & Fuzzing (40 Tests)", file: "tests/qa/test_json_adversarial_fuzz.js" });
  testsToRun.push({ name: "Parse Columns DataGrid Refresh (18 Tests)", file: "tests/test_parse_columns_datagrid_refresh.js" });
  testsToRun.push({ name: "Grid Wrap Concurrency Stress (10 Tests)", file: "tests/qa/test_grid_wrap_concurrency_stress.js" });
  testsToRun.push({ name: "Project Files Table Wrap & Resize Unit (15 Tests)", file: "tests/unit/test_project_files_table_wrap_resize.js" });
  testsToRun.push({ name: "DataGrid Floating Wrap Unit (15 Tests)", file: "tests/unit/test_datagrid_floating_wrap.js" });
  if (runAll) {
    testsToRun.push({ name: "Legacy Use Cases (19 Tests)", file: "tests/legacy_use_cases.js" });
    testsToRun.push({ name: "Nested Traverser Unit (10 Tests)", file: "tests/unit/test_nested_traverser.js" });
    testsToRun.push({ name: "DuckDB JSON Builder Unit (10 Tests)", file: "tests/unit/test_duckdb_json_builder.js" });
    testsToRun.push({ name: "JSON Schema Introspect Unit (50 Tests)", file: "tests/unit/test_json_schema_introspect.js" });
    testsToRun.push({ name: "JSON Streaming Flattener Unit (46 Tests)", file: "tests/unit/test_json_streaming_flattener.js" });
    testsToRun.push({ name: "Sample Scan Worker Unit (10 Tests)", file: "tests/unit/test_sample_scan_worker.js" });
  }
}

function runScript(testItem) {
  return new Promise((resolve, reject) => {
    const fullPath = path.resolve(__dirname, testItem.file);
    let resolved = false;

    const child = spawn(process.execPath, [fullPath], {
      stdio: "inherit",
      env: { ...process.env, TOAD_ROOT: __dirname },
    });

    const finish = (code) => {
      if (!resolved) {
        resolved = true;
        if (code === 0) {
          resolve({ ...testItem, status: "PASS" });
        } else {
          resolve({ ...testItem, status: "FAIL", code });
        }
      }
    };

    child.on("exit", finish);
    child.on("close", finish);
    child.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });
  });
}

async function main() {
  console.log(`\n${BOLD}${CYAN}======================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}        TOAD AUTOMATED TEST SUITE RUNNER (UNIFIED)                   ${RESET}`);
  console.log(`${BOLD}${CYAN}======================================================================${RESET}\n`);

  const results = [];
  const startTime = Date.now();

  for (const t of testsToRun) {
    console.log(`${BOLD}>>> Running: ${t.name}...${RESET}`);
    const res = await runScript(t);
    results.push(res);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  const allPassed = results.every((r) => r.status === "PASS");

  console.log(`\n${BOLD}======================================================================${RESET}`);
  console.log(`${BOLD}                    OVERALL TEST EXECUTION SUMMARY                    ${RESET}`);
  console.log(`${BOLD}======================================================================${RESET}`);
  for (const r of results) {
    const mark = r.status === "PASS" ? `${GREEN}✔ [PASS]${RESET}` : `${RED}✖ [FAIL (code ${r.code})]${RESET}`;
    console.log(`  ${mark} - ${r.name} (${r.file})`);
  }
  console.log(`  Total Duration : ${duration}s`);
  console.log(`${BOLD}======================================================================${RESET}`);

  if (allPassed) {
    console.log(`  ${BOLD}${GREEN}RESULT: ALL TEST SUITES PASSED CLEANLY (100% HEALTHY)${RESET}\n`);
    process.exit(0);
  } else {
    console.log(`  ${BOLD}${RED}RESULT: ONE OR MORE TEST SUITES FAILED!${RESET}\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner execution error:", err);
  process.exit(1);
});
