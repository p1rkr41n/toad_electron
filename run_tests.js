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

const testsToRun = [];

if (smokeOnly) {
  testsToRun.push({ name: "Smoke Test (v2.5.0)", file: "tests/smoke_test.js" });
} else if (qaOnly) {
  testsToRun.push({ name: "Deep Integration QA (222 Tests)", file: "tests/deep_integration_qa.js" });
} else if (legacyOnly) {
  testsToRun.push({ name: "Legacy Use Cases (19 Tests)", file: "tests/legacy_use_cases.js" });
} else {
  // Default: Smoke Test + Arrow IPC + Deep Integration QA + Preload 3 Pages
  testsToRun.push({ name: "Smoke Test (v2.5.0)", file: "tests/smoke_test.js" });
  testsToRun.push({ name: "Apache Arrow IPC & invokeBinary (15 Tests)", file: "tests/test_arrow_ipc_stream.js" });
  testsToRun.push({ name: "Deep Integration QA (223 Tests)", file: "tests/deep_integration_qa.js" });
  testsToRun.push({ name: "Preload 3 Pages & Dynamic PageSize (10 Tests)", file: "tests/test_preload_3_pages.js" });
  if (runAll) {
    testsToRun.push({ name: "Legacy Use Cases (19 Tests)", file: "tests/legacy_use_cases.js" });
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
