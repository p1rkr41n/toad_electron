/**
 * Root forwarding wrapper for tauri/project/tests/test_tauri_arrow_ipc.js
 */
const { runArrowIpcTests } = require("../tauri/project/tests/test_tauri_arrow_ipc.js");
runArrowIpcTests().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
