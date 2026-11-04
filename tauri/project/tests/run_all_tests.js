/**
 * run_all_tests.js
 *
 * Master Test Orchestrator for Toad Tauri v2
 * Executes all test suites in isolated child processes using the active Node runtime:
 * 1. test_tauri_arrow_ipc.js (Apache Arrow IPC stream binary & schema verification)
 * 2. test_grid_scroll_stress.js (100K rows virtual scroll concurrency & memory stress)
 * 3. test_e2e_features.js (Comprehensive Tier 1, Tier 2, Tier 3 feature verification)
 *
 * Returns exit code 0 when all tests pass; returns exit code 1 if any suite fails.
 */

const { spawnSync } = require("child_process");
const path = require("path");

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

const SUITES = [
  {
    name: "Arrow IPC Binary Protocol Suite",
    file: "test_tauri_arrow_ipc.js",
    description: "Verifies 0xFFFFFFFF continuation marker, type fidelity, metadata, and invokeBinary",
  },
  {
    name: "100K Rows Grid Virtual Scroll & Stress Suite",
    file: "test_grid_scroll_stress.js",
    description: "Verifies O(1) row coordinates, N-line auto-wrap, FPS benchmark, and memory stability",
  },
  {
    name: "End-to-End Features Suite (Tiers 1, 2, 3)",
    file: "test_e2e_features.js",
    description: "Verifies feature coverage across F01-F33, boundary edge cases, and cross-feature flows",
  },
];

function main() {
  console.log(`\n${BOLD}${CYAN}======================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}   TOAD TAURI v2 - MASTER TEST ORCHESTRATOR & QUALITY SUITE RUNNER    ${RESET}`);
  console.log(`${BOLD}${CYAN}======================================================================${RESET}`);
  console.log(`Node Runtime: ${process.execPath}`);
  console.log(`Platform:     ${process.platform} (${process.arch})`);
  console.log(`Date / Time:  ${new Date().toISOString()}\n`);

  const results = [];
  let totalStartTime = process.hrtime.bigint();

  for (let i = 0; i < SUITES.length; i++) {
    const suite = SUITES[i];
    const scriptPath = path.resolve(__dirname, suite.file);

    console.log(`\n${BOLD}${YELLOW}[Suite ${i + 1}/${SUITES.length}] Running ${suite.name} (${suite.file})...${RESET}`);
    console.log(`Scope: ${suite.description}`);
    console.log(`${CYAN}----------------------------------------------------------------------${RESET}`);

    const suiteStart = process.hrtime.bigint();
    const child = spawnSync(process.execPath, [scriptPath], {
      stdio: "inherit",
      cwd: __dirname,
      env: { ...process.env },
    });
    const suiteEnd = process.hrtime.bigint();
    const durationMs = Number(suiteEnd - suiteStart) / 1e6;

    const passed = child.status === 0;
    results.push({
      name: suite.name,
      file: suite.file,
      passed,
      exitCode: child.status,
      durationMs,
    });

    if (passed) {
      console.log(`${GREEN}✔ Suite ${suite.file} PASSED in ${durationMs.toFixed(2)}ms${RESET}`);
    } else {
      console.error(`${RED}✖ Suite ${suite.file} FAILED with exit code ${child.status} (${durationMs.toFixed(2)}ms)${RESET}`);
    }
  }

  const totalEndTime = process.hrtime.bigint();
  const totalDurationMs = Number(totalEndTime - totalStartTime) / 1e6;

  // Print Summary Table
  console.log(`\n\n${BOLD}${CYAN}======================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}                      MASTER TEST EXECUTION SUMMARY                   ${RESET}`);
  console.log(`${BOLD}${CYAN}======================================================================${RESET}`);

  let allPassed = true;
  for (const r of results) {
    const statusStr = r.passed
      ? `${GREEN}PASS${RESET}`
      : `${RED}FAIL (code ${r.exitCode})${RESET}`;
    console.log(` • [${statusStr}] ${r.name.padEnd(46)} ${r.durationMs.toFixed(1).padStart(8)} ms`);
    if (!r.passed) {
      allPassed = false;
    }
  }

  console.log(`${CYAN}----------------------------------------------------------------------${RESET}`);
  console.log(`Total Suites Run:      ${results.length}`);
  console.log(`Suites Passed:         ${GREEN}${results.filter((r) => r.passed).length}${RESET}`);
  console.log(`Suites Failed:         ${allPassed ? GREEN + "0" : RED + results.filter((r) => !r.passed).length}${RESET}`);
  console.log(`Total Execution Time:  ${totalDurationMs.toFixed(2)} ms`);
  console.log(`${BOLD}${CYAN}======================================================================${RESET}\n`);

  if (!allPassed) {
    console.error(`${BOLD}${RED}OVERALL STATUS: FAILURE - One or more test suites failed.${RESET}\n`);
    process.exit(1);
  } else {
    console.log(`${BOLD}${GREEN}OVERALL STATUS: SUCCESS - 100% of test suites passed cleanly.${RESET}\n`);
    process.exit(0);
  }
}

main();
