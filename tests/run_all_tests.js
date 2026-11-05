/**
 * Root forwarding wrapper for tauri/project/tests/run_all_tests.js
 */
const { spawnSync } = require("child_process");
const path = require("path");

const script = path.resolve(__dirname, "../tauri/project/tests/run_all_tests.js");
const res = spawnSync(process.execPath, [script], {
  stdio: "inherit",
  cwd: path.dirname(script),
});

process.exit(res.status ?? 0);
