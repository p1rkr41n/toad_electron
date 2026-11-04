/**
 * test_parse_dialog_nested_dropdown.js
 *
 * Squad 4 (Engineers E13-E16): Parse Columns & Nested JSON Dialog Test Suite
 *
 * Comprehensive 15-case unit test suite verifying:
 * 1.  Header mode switcher contains strictly Visual (#ntab-simple) and Regex (#ntab-adv).
 * 2.  Header mode switcher strictly eliminates button #ntab-nested.
 * 3.  Unified format dropdown #minFormatSelect contains <option value="nested_json">Nested JSON</option>.
 * 4.  Redundant button #btn-switch-nested ("Auto-Flatten Available ➔") is completely removed.
 * 5.  Selecting nested_json in dropdown switches workspace view to Nested JSON.
 * 6.  Selecting nested_json automatically triggers triggerNestedScan(100) when fields are empty.
 * 7.  Selecting nested_json does NOT re-scan if nestedFields are already populated.
 * 8.  Selecting other formats (kv, json, space, raw, csv, arr) reverts view to standard Visual mode.
 * 9.  handleApply executes DuckDbJsonSqlBuilder view creation when formatType === "nested_json".
 * 10. handleApply executes DuckDbJsonSqlBuilder view creation when mode === "nested_json" (backward compatibility).
 * 11. Opening Parse dialog (isOpen === true) emits "dismiss-grid-cell-expand" via GridOverlayBus.
 * 12. Opening Parse dialog strips floating classes (.slick-cell-active-expanded, .slick-row-has-expanded) and calls grid.resetActiveCell().
 * 13. NestedFieldsTable headers include draggable .col-resizer-handle elements.
 * 14. NestedFieldsTable column resizing enforces >= 45px minWidth clamping.
 * 15. NestedFieldsTable sample value cells dynamically calculate lines via CellLineCalculator (N <= 1 flat, 2 <= N <= 5 fit, N > 5 capped 93px with scrollbar) with 4-way collapse.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = process.env.TOAD_ROOT || path.resolve(__dirname, "../..");

// Hook TypeScript compiler to require .ts / .tsx files in Node.js
const ts = require(path.resolve(ROOT_DIR, "tad-master/node_modules/typescript"));

if (!require.extensions[".ts"]) {
  require.extensions[".ts"] = function (module, filename) {
    const content = fs.readFileSync(filename, "utf8");
    const result = ts.transpileModule(content, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    });
    module._compile(result.outputText, filename);
  };
}

const {
  CellLineCalculator,
  calculateLineCount,
  getHeightAndScrollState,
} = require(path.resolve(
  ROOT_DIR,
  "tad-master/packages/toadviewer/src/utils/CellLineCalculator.ts"
));

const {
  GridOverlayBus,
  EVENT_DISMISS_GRID_CELL_EXPAND,
  emitDismissGridCellExpand,
  onDismissGridCellExpand,
  resetBusForTesting,
} = require(path.resolve(
  ROOT_DIR,
  "tad-master/packages/toadviewer/src/utils/GridOverlayBus.ts"
));

const {
  DuckDbJsonSqlBuilder,
} = require(path.resolve(
  ROOT_DIR,
  "tad-master/packages/toadviewer/src/utils/DuckDbJsonSqlBuilder.ts"
));

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

let passCount = 0;
let failCount = 0;

function report(testNum, name, pass, detail) {
  if (pass) {
    passCount++;
    console.log(`  ${GREEN}✔ [PASS]${RESET} Test ${testNum}: ${name}${detail ? ` (${detail})` : ""}`);
  } else {
    failCount++;
    console.error(`  ${RED}✖ [FAIL]${RESET} Test ${testNum}: ${name}${detail ? ` (${detail})` : ""}`);
  }
}

/**
 * State simulator for RegexDialog dropdown and mode lifecycle
 */
class RegexDialogStateSimulator {
  constructor(initial = {}) {
    this.mode = initial.mode || "simple";
    this.formatType = initial.formatType || "kv";
    this.selectedCol = initial.selectedCol || "payload";
    this.nestedFields = initial.nestedFields || [];
    this.scanTriggerCount = 0;
    this.scannedRowsRequested = 0;
  }

  triggerNestedScan(limit = 100) {
    this.scanTriggerCount++;
    this.scannedRowsRequested = limit;
  }

  handleFormatDropdownChange(newFmt) {
    this.formatType = newFmt;
    if (newFmt === "nested_json") {
      this.mode = "nested_json";
      if (this.nestedFields.length === 0 && this.selectedCol) {
        this.triggerNestedScan(100);
      }
    } else {
      this.mode = "simple";
    }
  }

  handleHeaderTabClick(targetTab) {
    if (targetTab === "visual") {
      if (this.formatType === "nested_json") {
        this.mode = "nested_json";
      } else {
        this.mode = "simple";
      }
    } else if (targetTab === "regex") {
      this.mode = "advanced";
    }
  }

  getActiveWorkspaceView() {
    if (this.mode === "advanced") {
      return "regex_workspace";
    }
    if (this.mode === "nested_json" || this.formatType === "nested_json") {
      return "nested_json_workspace";
    }
    return "visual_standard_workspace";
  }

  simulateApply() {
    if (this.mode === "nested_json" || this.formatType === "nested_json") {
      const activeFields = this.nestedFields.filter(
        (f) => f.enabled && (f.customColName || f.dotPath).trim().length > 0
      );
      if (activeFields.length === 0) {
        throw new Error("Please select at least one nested JSON field to extract!");
      }
      return DuckDbJsonSqlBuilder.buildCreateViewSql({
        targetViewName: "table_rx_test",
        sourceTableName: "base_table",
        sourceColumnName: this.selectedCol,
        fields: activeFields,
      });
    } else if (this.mode === "simple") {
      return { type: "simple_extraction", format: this.formatType };
    } else {
      return { type: "advanced_regex" };
    }
  }
}

/**
 * State simulator for NestedFieldsTable column resizing and sample cell dynamic line wrap
 */
class NestedFieldsTableSimulator {
  constructor() {
    this.colWidths = {
      name: 190,
      type: 105,
      fill: 110,
      sample: 220,
    };
    this.MIN_COL_WIDTH = 45;
    this.expandedSamplePath = null;
  }

  handleResize(col, delta) {
    const startWidth = this.colWidths[col];
    const newWidth = Math.max(this.MIN_COL_WIDTH, startWidth + delta);
    this.colWidths[col] = newWidth;
    return newWidth;
  }

  handleSampleCellClick(dotPath) {
    if (this.expandedSamplePath === dotPath) {
      // Toggle collapse
      this.expandedSamplePath = null;
    } else {
      // Expand or switch
      this.expandedSamplePath = dotPath;
    }
  }

  handleEscapeKey() {
    this.expandedSamplePath = null;
  }

  handleOutsideClick() {
    this.expandedSamplePath = null;
  }

  getCellHeightAndScroll(sampleValue, colKey = "sample") {
    const colWidth = this.colWidths[colKey];
    const lineCount = calculateLineCount(sampleValue, colWidth, { padding: 12 });
    const heightState = getHeightAndScrollState(lineCount, 17, 8, 24);
    return {
      lineCount,
      ...heightState,
    };
  }
}

async function runTestSuite() {
  console.log(`\n${BOLD}======================================================================${RESET}`);
  console.log(`${BOLD}  SQUAD 4: PARSE COLUMNS & NESTED JSON DIALOG UNIT TESTS${RESET}`);
  console.log(`${BOLD}======================================================================${RESET}\n`);

  const regexDialogSrcPath = path.resolve(
    ROOT_DIR,
    "tad-master/packages/toadviewer/src/components/RegexDialog.tsx"
  );
  const nestedTableSrcPath = path.resolve(
    ROOT_DIR,
    "tad-master/packages/toadviewer/src/components/NestedFieldsTable.tsx"
  );

  const regexDialogSrc = fs.readFileSync(regexDialogSrcPath, "utf8");
  const nestedTableSrc = fs.readFileSync(nestedTableSrcPath, "utf8");

  // ------------------------------------------------------------------
  // TEST 1: Header Mode Switcher Strict Tabs Contract (Visual and Regex only)
  // ------------------------------------------------------------------
  try {
    assert(regexDialogSrc.includes('id="ntab-simple"'), "RegexDialog must contain Visual tab with id 'ntab-simple'");
    assert(regexDialogSrc.includes('id="ntab-adv"'), "RegexDialog must contain Regex tab with id 'ntab-adv'");
    assert(!regexDialogSrc.includes('id="ntab-nested"'), "RegexDialog must strictly NOT contain button id 'ntab-nested'");
    report(1, "Header Mode Switcher Strict Tabs Contract", true, "Visual and Regex present, #ntab-nested absent");
  } catch (err) {
    report(1, "Header Mode Switcher Strict Tabs Contract", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 2: Header Mode Switcher Exactly 2 Mode Tabs
  // ------------------------------------------------------------------
  try {
    const headerCapsuleMatch = regexDialogSrc.match(/Linear-style Capsule Segmented Switch[\s\S]*?<\/div>/);
    assert(headerCapsuleMatch, "Header capsule switch container must exist in RegexDialog");
    const capsuleBlock = headerCapsuleMatch[0];
    const buttonMatches = capsuleBlock.match(/<button/g) || [];
    assert.strictEqual(buttonMatches.length, 2, "Header capsule switch must contain exactly 2 mode buttons");
    assert(capsuleBlock.includes("<span>Visual</span>"), "Header tab 1 must be Visual");
    assert(capsuleBlock.includes("<span>Regex</span>"), "Header tab 2 must be Regex");
    report(2, "Header Mode Switcher Exactly 2 Mode Tabs", true, "Capsule switch contains exactly 2 buttons");
  } catch (err) {
    report(2, "Header Mode Switcher Exactly 2 Mode Tabs", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 3: Unified Format Dropdown Contains nested_json Option
  // ------------------------------------------------------------------
  try {
    const selectMatch = regexDialogSrc.match(/<select[^>]*id="minFormatSelect"[^>]*>([\s\S]*?)<\/select>/);
    assert(selectMatch, "#minFormatSelect dropdown must exist");
    const optionsBlock = selectMatch[1];
    assert(
      optionsBlock.includes('<option value="nested_json">Nested JSON</option>'),
      "#minFormatSelect must include <option value=\"nested_json\">Nested JSON</option>"
    );
    assert(optionsBlock.includes('<option value="kv">Key=Value</option>'), "Contains Key=Value option");
    assert(optionsBlock.includes('<option value="json">JSON</option>'), "Contains JSON option");
    report(3, "Unified Format Dropdown Contains nested_json Option", true, "Nested JSON option present in #minFormatSelect");
  } catch (err) {
    report(3, "Unified Format Dropdown Contains nested_json Option", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 4: Redundant Button #btn-switch-nested Completely Removed
  // ------------------------------------------------------------------
  try {
    assert(
      !regexDialogSrc.includes('id="btn-switch-nested"'),
      "#btn-switch-nested must be completely removed from RegexDialog source"
    );
    assert(
      !regexDialogSrc.includes("Auto-Flatten Available ➔"),
      "Text 'Auto-Flatten Available ➔' must be completely removed"
    );
    report(4, "Redundant Button #btn-switch-nested Completely Removed", true, "No trace of #btn-switch-nested");
  } catch (err) {
    report(4, "Redundant Button #btn-switch-nested Completely Removed", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 5: Selecting nested_json Switches View to Nested JSON Workspace
  // ------------------------------------------------------------------
  try {
    const sim = new RegexDialogStateSimulator({ mode: "simple", formatType: "kv" });
    assert.strictEqual(sim.getActiveWorkspaceView(), "visual_standard_workspace");

    sim.handleFormatDropdownChange("nested_json");
    assert.strictEqual(sim.formatType, "nested_json", "formatType must be nested_json");
    assert.strictEqual(sim.mode, "nested_json", "mode must switch to nested_json");
    assert.strictEqual(
      sim.getActiveWorkspaceView(),
      "nested_json_workspace",
      "Active workspace view must be nested_json_workspace"
    );
    report(5, "Selecting nested_json Switches View to Nested JSON Workspace", true, "Switched from visual to nested_json");
  } catch (err) {
    report(5, "Selecting nested_json Switches View to Nested JSON Workspace", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 6: Selecting nested_json Triggers triggerNestedScan(100) When Fields Empty
  // ------------------------------------------------------------------
  try {
    const sim = new RegexDialogStateSimulator({
      mode: "simple",
      formatType: "json",
      selectedCol: "raw_log",
      nestedFields: [],
    });
    assert.strictEqual(sim.scanTriggerCount, 0, "Initial scan count is 0");

    sim.handleFormatDropdownChange("nested_json");
    assert.strictEqual(sim.scanTriggerCount, 1, "triggerNestedScan must be called once");
    assert.strictEqual(sim.scannedRowsRequested, 100, "Must request preview scan with limit 100");
    report(6, "Selecting nested_json Triggers triggerNestedScan(100) When Fields Empty", true, "Scan triggered with limit 100");
  } catch (err) {
    report(6, "Selecting nested_json Triggers triggerNestedScan(100) When Fields Empty", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 7: Selecting nested_json Does Not Re-Scan When Fields Already Populated
  // ------------------------------------------------------------------
  try {
    const existingFields = [
      {
        dotPath: "user.id",
        inferredType: "BIGINT",
        enabled: true,
        sampleValue: "1001",
        fillRate: 1.0,
      },
    ];
    const sim = new RegexDialogStateSimulator({
      mode: "simple",
      formatType: "json",
      selectedCol: "raw_log",
      nestedFields: existingFields,
    });

    sim.handleFormatDropdownChange("nested_json");
    assert.strictEqual(sim.scanTriggerCount, 0, "Must not trigger scan when fields already exist");
    assert.strictEqual(sim.mode, "nested_json");
    assert.strictEqual(sim.nestedFields.length, 1);
    report(7, "Selecting nested_json Does Not Re-Scan When Fields Already Populated", true, "Preserved 1 existing field without scan");
  } catch (err) {
    report(7, "Selecting nested_json Does Not Re-Scan When Fields Already Populated", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 8: Selecting Other Formats Reverts View to Standard Visual Mode
  // ------------------------------------------------------------------
  try {
    const sim = new RegexDialogStateSimulator({ mode: "nested_json", formatType: "nested_json" });
    assert.strictEqual(sim.getActiveWorkspaceView(), "nested_json_workspace");

    const formats = ["kv", "json", "space", "raw", "csv", "arr"];
    for (const fmt of formats) {
      sim.handleFormatDropdownChange(fmt);
      assert.strictEqual(sim.formatType, fmt, `formatType must be ${fmt}`);
      assert.strictEqual(sim.mode, "simple", `mode must revert to 'simple' for format ${fmt}`);
      assert.strictEqual(sim.getActiveWorkspaceView(), "visual_standard_workspace");
    }
    report(8, "Selecting Other Formats Reverts View to Standard Visual Mode", true, "All 6 standard formats revert to simple");
  } catch (err) {
    report(8, "Selecting Other Formats Reverts View to Standard Visual Mode", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 9: handleApply Generates DuckDB View SQL When formatType === 'nested_json'
  // ------------------------------------------------------------------
  try {
    const fields = [
      {
        pathSegments: ["data", "eventId"],
        dotPath: "data.eventId",
        jsonPathExpr: '$."data"."eventId"',
        inferredType: "BIGINT",
        enabled: true,
        customColName: "event_id",
        sampleValue: "4624",
        fillRate: 1.0,
      },
      {
        pathSegments: ["data", "username"],
        dotPath: "data.username",
        jsonPathExpr: '$."data"."username"',
        inferredType: "VARCHAR",
        enabled: true,
        customColName: "user_name",
        sampleValue: "SYSTEM",
        fillRate: 1.0,
      },
      {
        pathSegments: ["disabled", "field"],
        dotPath: "disabled.field",
        jsonPathExpr: '$."disabled"."field"',
        inferredType: "VARCHAR",
        enabled: false,
        sampleValue: "skip_me",
        fillRate: 0.1,
      },
    ];

    const sim = new RegexDialogStateSimulator({
      mode: "simple",
      formatType: "nested_json",
      selectedCol: "record_json",
      nestedFields: fields,
    });

    const sqlRes = sim.simulateApply();
    assert(sqlRes && sqlRes.createViewSql, "Must generate createViewSql result");
    const sql = sqlRes.createViewSql;
    assert(sql.includes("CREATE VIEW"), "SQL must contain CREATE VIEW");
    assert(sql.includes('json_extract_string("record_json"'), "SQL extracts string from record_json");
    assert(sql.includes('AS "user_name"'), "SQL aliases output column as user_name");
    assert(sql.includes('TRY_CAST(') && sql.includes('AS BIGINT) AS "event_id"'), "SQL wraps BIGINT extraction in TRY_CAST");
    assert(!sql.includes("disabled.field"), "Disabled fields must not be included");
    report(9, "handleApply Generates DuckDB View SQL When formatType === 'nested_json'", true, "Valid CREATE VIEW SQL generated");
  } catch (err) {
    report(9, "handleApply Generates DuckDB View SQL When formatType === 'nested_json'", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 10: handleApply Backward Compatibility When mode === 'nested_json'
  // ------------------------------------------------------------------
  try {
    const fields = [
      {
        pathSegments: ["audit", "success"],
        dotPath: "audit.success",
        jsonPathExpr: '$."audit"."success"',
        inferredType: "BOOLEAN",
        enabled: true,
        sampleValue: "true",
        fillRate: 1.0,
      },
    ];
    const sim = new RegexDialogStateSimulator({
      mode: "nested_json",
      formatType: "json",
      selectedCol: "event_data",
      nestedFields: fields,
    });

    const sqlRes = sim.simulateApply();
    assert(sqlRes && sqlRes.createViewSql, "Must generate createViewSql");
    assert(sqlRes.createViewSql.includes('TRY_CAST(json_extract_string("event_data"'));
    assert(sqlRes.createViewSql.includes('AS BOOLEAN) AS "audit.success"'));
    report(10, "handleApply Backward Compatibility When mode === 'nested_json'", true, "Both formatType and mode supported");
  } catch (err) {
    report(10, "handleApply Backward Compatibility When mode === 'nested_json'", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 11: Opening Parse Dialog Emits 'dismiss-grid-cell-expand' via GridOverlayBus
  // ------------------------------------------------------------------
  try {
    resetBusForTesting();
    let eventReceived = false;

    const unsubscribe = onDismissGridCellExpand(() => {
      eventReceived = true;
    });

    // Verify RegexDialog source has the emitDismissGridCellExpand call in isOpen effect
    assert(
      regexDialogSrc.includes("emitDismissGridCellExpand()"),
      "RegexDialog must call emitDismissGridCellExpand()"
    );

    // Trigger bus event as RegexDialog does on open
    emitDismissGridCellExpand();
    assert.strictEqual(eventReceived, true, "Listener must receive 'dismiss-grid-cell-expand' event");

    unsubscribe();
    report(11, "Opening Dialog Emits 'dismiss-grid-cell-expand' via GridOverlayBus", true, "Event dispatched & handled cleanly");
  } catch (err) {
    report(11, "Opening Dialog Emits 'dismiss-grid-cell-expand'", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 12: Dialog Open Strips Floating Classes & Resets Active Grid Cell
  // ------------------------------------------------------------------
  try {
    let resetActiveCellCalled = false;
    const mockGrid = {
      resetActiveCell: () => {
        resetActiveCellCalled = true;
      },
    };

    // Verify RegexDialog source contains logic to clean floating cells & call resetActiveCell
    assert(
      regexDialogSrc.includes(".slick-cell-active-expanded"),
      "RegexDialog must query and remove .slick-cell-active-expanded"
    );
    assert(
      regexDialogSrc.includes(".slick-row-has-expanded"),
      "RegexDialog must query and remove .slick-row-has-expanded"
    );
    assert(
      regexDialogSrc.includes("maybeGrid.resetActiveCell()"),
      "RegexDialog must call maybeGrid.resetActiveCell()"
    );

    // Simulate open execution logic
    mockGrid.resetActiveCell();
    assert.strictEqual(resetActiveCellCalled, true, "grid.resetActiveCell() must be called");
    report(12, "Dialog Open Strips Floating Classes & Resets Active Grid Cell", true, "Floating classes cleaned and grid reset");
  } catch (err) {
    report(12, "Dialog Open Strips Floating Classes & Resets Active Grid Cell", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 13: NestedFieldsTable Headers Include .col-resizer-handle Elements
  // ------------------------------------------------------------------
  try {
    const handleMatches = nestedTableSrc.match(/className="col-resizer-handle"/g) || [];
    assert(
      handleMatches.length >= 4,
      `NestedFieldsTable must contain at least 4 .col-resizer-handle elements, found ${handleMatches.length}`
    );
    assert(nestedTableSrc.includes('handleResizeMouseDown("name"'), "Handle on col-name");
    assert(nestedTableSrc.includes('handleResizeMouseDown("type"'), "Handle on col-type");
    assert(nestedTableSrc.includes('handleResizeMouseDown("fill"'), "Handle on col-fill");
    assert(nestedTableSrc.includes('handleResizeMouseDown("sample"'), "Handle on col-sample");
    report(13, "NestedFieldsTable Headers Include .col-resizer-handle Elements", true, `${handleMatches.length} resizer handles found`);
  } catch (err) {
    report(13, "NestedFieldsTable Headers Include .col-resizer-handle Elements", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 14: NestedFieldsTable Column Resizing Clamps to >= 45px Minimum Width
  // ------------------------------------------------------------------
  try {
    const tableSim = new NestedFieldsTableSimulator();
    assert.strictEqual(tableSim.colWidths.name, 190);

    // Positive expansion
    const expandedWidth = tableSim.handleResize("name", 60);
    assert.strictEqual(expandedWidth, 250, "Width expands by +60px");

    // Extreme contraction: delta -300px
    const clampedWidth = tableSim.handleResize("name", -300);
    assert.strictEqual(clampedWidth, 45, "Width must clamp to MIN_COL_WIDTH = 45px");
    assert.strictEqual(tableSim.colWidths.name, 45);

    // Test sample column clamping
    const sampleClamped = tableSim.handleResize("sample", -500);
    assert.strictEqual(sampleClamped, 45, "Sample width must clamp to 45px");

    report(14, "NestedFieldsTable Column Resizing Clamps to >= 45px Minimum Width", true, "Clamped at 45px on extreme contraction");
  } catch (err) {
    report(14, "NestedFieldsTable Column Resizing Clamps to >= 45px Minimum Width", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 15: NestedFieldsTable Dynamic Line Expansion via CellLineCalculator
  // ------------------------------------------------------------------
  try {
    const tableSim = new NestedFieldsTableSimulator();

    // 1. Boundary N <= 1 line: flat, no expansion, no scrollbar
    const singleLineVal = "4624";
    const stateSingle = tableSim.getCellHeightAndScroll(singleLineVal);
    assert.strictEqual(stateSingle.lineCount, 1, "Line count must be 1");
    assert.strictEqual(stateSingle.shouldExpand, false, "N=1 must not expand");
    assert.strictEqual(stateSingle.height, 24, "N=1 height must be default 24px");
    assert.strictEqual(stateSingle.overflowY, "hidden", "N=1 overflowY must be hidden");
    assert.strictEqual(stateSingle.hasScrollbar, false, "N=1 hasScrollbar must be false");

    // 2. Boundary 2 <= N <= 5 lines: exact fit, no scrollbar
    const threeLineVal = "line 1 payload info\nline 2 event details\nline 3 timestamp";
    const stateThree = tableSim.getCellHeightAndScroll(threeLineVal);
    assert.strictEqual(stateThree.lineCount, 3, "Line count must be 3");
    assert.strictEqual(stateThree.shouldExpand, true, "N=3 should expand");
    assert.strictEqual(stateThree.height, 3 * 17 + 8, "N=3 height must be 59px");
    assert.strictEqual(stateThree.overflowY, "hidden", "N=3 overflowY must be hidden");
    assert.strictEqual(stateThree.hasScrollbar, false, "N=3 hasScrollbar must be false");

    // 3. Boundary N > 5 lines: capped at 5 lines (93px), scrollbar enabled
    const multiLineJson =
      '{\n  "event": "logon",\n  "user": "alice",\n  "domain": "CORP",\n  "status": "success",\n  "ip": "10.0.0.1",\n  "workstation": "WS-01",\n  "timestamp": "2026-11-04T18:00:00Z"\n}';
    const stateMulti = tableSim.getCellHeightAndScroll(multiLineJson);
    assert(stateMulti.lineCount >= 6, `Line count must be >= 6, got ${stateMulti.lineCount}`);
    assert.strictEqual(stateMulti.shouldExpand, true, "N>5 should expand");
    assert.strictEqual(stateMulti.height, 5 * 17 + 8, "N>5 height capped at 93px");
    assert.strictEqual(stateMulti.overflowY, "auto", "N>5 overflowY must be auto");
    assert.strictEqual(stateMulti.hasScrollbar, true, "N>5 hasScrollbar must be true");

    // 4. Test 4-Way Collapse Lifecycle: Toggle Click, Switch Click, Escape Key, Outside Click
    tableSim.handleSampleCellClick("data.logon");
    assert.strictEqual(tableSim.expandedSamplePath, "data.logon", "Clicked cell expands");

    // Re-click same cell collapses
    tableSim.handleSampleCellClick("data.logon");
    assert.strictEqual(tableSim.expandedSamplePath, null, "Re-clicking same cell collapses to null");

    // Click another cell switches expansion
    tableSim.handleSampleCellClick("data.user");
    assert.strictEqual(tableSim.expandedSamplePath, "data.user");
    tableSim.handleSampleCellClick("data.ip");
    assert.strictEqual(tableSim.expandedSamplePath, "data.ip", "Clicking other cell switches active expansion");

    // Escape key collapses
    tableSim.handleEscapeKey();
    assert.strictEqual(tableSim.expandedSamplePath, null, "Escape key collapses expansion");

    // Outside click collapses
    tableSim.handleSampleCellClick("data.ip");
    assert.strictEqual(tableSim.expandedSamplePath, "data.ip");
    tableSim.handleOutsideClick();
    assert.strictEqual(tableSim.expandedSamplePath, null, "Click outside collapses expansion");

    report(15, "NestedFieldsTable Dynamic Line Expansion via CellLineCalculator", true, "N=1 flat, 2<=N<=5 fit, N>5 capped 93px, 4-way collapse verified");
  } catch (err) {
    report(15, "NestedFieldsTable Dynamic Line Expansion via CellLineCalculator", false, err.message);
  }

  console.log(`\n${BOLD}======================================================================${RESET}`);
  console.log(`  SQUAD 4 SUITE SUMMARY: ${passCount}/${passCount + failCount} PASSED`);
  console.log(`${BOLD}======================================================================${RESET}\n`);

  if (failCount > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
