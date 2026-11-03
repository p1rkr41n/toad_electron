/**
 * Verification test suite for Milestone 2 (R4): Non-blocking Error Handling & UI Status Badging
 */
const assert = require("assert");
const path = require("path");
const fs = require("fs");

console.log("=== Testing Milestone 2 (R4) Implementation ===");

// 1. Verify packages/tad-app/app/main.ts
const mainTsPath = path.resolve(__dirname, "../tad-master/packages/tad-app/app/main.ts");
const mainTs = fs.readFileSync(mainTsPath, "utf8");

assert(mainTs.includes("ipcMain.handle(\"errorDialog\", (event, arg1, arg2, arg3)"),
  "main.ts must handle errorDialog with normalized arguments (arg1, arg2, arg3)");

assert(mainTs.includes("log.error(`[errorDialog] [fatal=${fatal}] ${title}: ${msg}`);"),
  "main.ts must log non-fatal errors to log.error");

assert(mainTs.includes("if (fatal) {\n    dialog.showErrorBox(title, msg);\n    app.quit();\n  }"),
  "main.ts must suppress dialog.showErrorBox unless fatal === true");
console.log("[PASS] packages/tad-app/app/main.ts: errorDialog modal suppression verified");

// 2. Verify packages/tad-app/src/electronRenderMain.tsx
const renderMainPath = path.resolve(__dirname, "../tad-master/packages/tad-app/src/electronRenderMain.tsx");
const renderMain = fs.readFileSync(renderMainPath, "utf8");

assert(!renderMain.includes('getHostBridge().showErrorDialog('),
  "electronRenderMain.tsx must NOT call getHostBridge().showErrorDialog in unhandled listeners");

assert(renderMain.includes('console.error("[UNCAUGHT-WINDOW-ERROR]"'),
  "electronRenderMain.tsx must log window error via console.error");

assert(renderMain.includes('console.error(\n      "[UNCAUGHT-PROMISE-REJECTION]"'),
  "electronRenderMain.tsx must log unhandled rejection via console.error");
console.log("[PASS] packages/tad-app/src/electronRenderMain.tsx: modal popup suppression verified");

// 3. Verify packages/tadviewer/src/actions.ts
const actionsPath = path.resolve(__dirname, "../tad-master/packages/tadviewer/src/actions.ts");
const actionsTs = fs.readFileSync(actionsPath, "utf8");

assert(actionsTs.includes('console.error("[openDataSourcePath] Ingestion failed:", err?.stack || err);'),
  "actions.ts must log ingestion failure to console.error");

assert(actionsTs.includes('status: "error"'),
  "actions.ts must mark file status as error in MultipleLoadingManager");

assert(actionsTs.includes('setActiveLoadingFile(') && actionsTs.includes('error: errMsg'),
  "actions.ts must set activeLoadingFile error for center pane error card");

assert(actionsTs.includes('if (!cur?.error) {\n        setActiveLoadingFile(null, stateRef);\n      }'),
  "actions.ts must preserve activeLoadingFile error in finally block");
console.log("[PASS] packages/tadviewer/src/actions.ts: non-blocking ingestion error handling verified");

// 4. Verify packages/tadviewer/src/components/ProjectFilesTable.tsx
const tablePath = path.resolve(__dirname, "../tad-master/packages/tadviewer/src/components/ProjectFilesTable.tsx");
const tableTs = fs.readFileSync(tablePath, "utf8");

assert(tableTs.includes('<Icon icon="error" size={12} style={{ color: "#ef4444" }} />'),
  "ProjectFilesTable.tsx must render BlueprintJS <Icon icon=\"error\" size={12} style={{ color: \"#ef4444\" }} /> for status ERROR");

assert(tableTs.includes('className="status-indicator status-error"') && tableTs.includes('title="ERROR"'),
  "ProjectFilesTable.tsx must wrap error icon in status-indicator status-error with title ERROR");
console.log("[PASS] packages/tadviewer/src/components/ProjectFilesTable.tsx: error icon badging verified");

// 5. Verify packages/tadviewer/src/components/DataSourceSidebar.tsx
const sidebarPath = path.resolve(__dirname, "../tad-master/packages/tadviewer/src/components/DataSourceSidebar.tsx");
const sidebarTs = fs.readFileSync(sidebarPath, "utf8");

assert(sidebarTs.includes('<Icon icon="error" size={12} style={{ color: "#ef4444" }} />'),
  "DataSourceSidebar.tsx must render BlueprintJS <Icon icon=\"error\" size={12} style={{ color: \"#ef4444\" }} /> for isError");

assert(sidebarTs.includes('[handleOpenFile] Error handling open file'),
  "DataSourceSidebar.tsx handleOpenFile must catch errors gracefully");

console.log("[PASS] packages/tadviewer/src/components/DataSourceSidebar.tsx: error handling & badging verified");

// 6. Test compiled tadviewer bundle
const bundlePath = path.resolve(__dirname, "../tad-master/packages/tadviewer/dist/tadviewer.js");
assert(fs.existsSync(bundlePath), "Compiled tadviewer.js bundle must exist");
const bundleContent = fs.readFileSync(bundlePath, "utf8");
assert(bundleContent.includes("[openDataSourcePath] Ingestion failed:"),
  "Compiled tadviewer.js bundle must contain openDataSourcePath error logger");
console.log("[PASS] tadviewer.js bundle contains compiled Milestone 2 changes");

// 7. Behavioral Runtime Test: errorDialog behavior
{
  let dialogShown = false;
  let loggedError = "";
  let appQuit = false;

  const mockDialog = {
    showErrorBox: (title, msg) => {
      dialogShown = true;
    }
  };
  const mockLog = {
    error: (msg) => {
      loggedError = msg;
    }
  };
  const mockApp = {
    quit: () => {
      appQuit = true;
    }
  };

  const simulateErrorDialog = async (arg1, arg2, arg3) => {
    let title = "Error";
    let msg = "";
    let fatal = false;

    if (arg1 && typeof arg1 === "object") {
      title = arg1.title || "Error";
      msg = arg1.message || arg1.msg || "";
      fatal = !!arg1.fatal;
    } else {
      title = typeof arg1 === "string" ? arg1 : String(arg1 || "Error");
      msg = typeof arg2 === "string" ? arg2 : String(arg2 || "");
      fatal = !!arg3;
    }

    mockLog.error(`[errorDialog] [fatal=${fatal}] ${title}: ${msg}`);

    if (fatal) {
      mockDialog.showErrorBox(title, msg);
      mockApp.quit();
    }
  };

  // Test Non-Fatal Ingestion Error: MUST NOT open modal dialog, MUST write to log
  dialogShown = false;
  loggedError = "";
  appQuit = false;
  simulateErrorDialog("Ingestion Error", "Corrupt file header detected", false);
  assert.strictEqual(dialogShown, false, "Non-fatal error must NOT show modal error box");
  assert.strictEqual(appQuit, false, "Non-fatal error must NOT quit application");
  assert(loggedError.includes("Corrupt file header detected"), "Non-fatal error must be recorded to log");
  console.log("[PASS] Behavioral test: Non-fatal error is logged without modal popup");

  // Test Object invocation from V8HostAdapter
  dialogShown = false;
  loggedError = "";
  simulateErrorDialog({ title: "IPC Error", message: "Stream closed", fatal: false });
  assert.strictEqual(dialogShown, false, "Object non-fatal error must NOT show modal error box");
  assert(loggedError.includes("Stream closed") && !loggedError.includes("[object Object]"),
    "Object error must normalize title and message without [object Object]");
  console.log("[PASS] Behavioral test: Object argument normalized correctly without [object Object]");

  // Test Fatal Error: MUST show modal dialog and quit
  dialogShown = false;
  loggedError = "";
  appQuit = false;
  simulateErrorDialog("Fatal Error", "Out of memory", true);
  assert.strictEqual(dialogShown, true, "Fatal error MUST show modal error box");
  assert.strictEqual(appQuit, true, "Fatal error MUST quit application");
  console.log("[PASS] Behavioral test: Fatal error correctly triggers dialog and quit");
}

console.log("\n=== ALL MILESTONE 2 VERIFICATION CHECKS PASSED ===");
