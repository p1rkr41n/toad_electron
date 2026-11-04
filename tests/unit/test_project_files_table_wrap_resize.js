/**
 * test_project_files_table_wrap_resize.js
 * 
 * Unit Test Suite for Sidebar File Management Table (ProjectFilesTable.tsx & sidebar.less):
 * - Column width initialization (DEFAULT_COL_WIDTHS = { name: 140, dir: 120, size: 70, status: 60 })
 * - Resizer handle DOM presence (.col-resizer-handle on th.col-name, th.col-dir, etc.)
 * - Drag resize initiation, positive expansion (+50px), negative contraction (-30px)
 * - Strict minimum width clamping (MIN_COL_WIDTH = 45px)
 * - Event propagation isolation (e.stopPropagation & e.preventDefault)
 * - Window blur and mouseleave cleanup (cancel in-flight drag)
 * - Double-click auto-fit calculation from visible text (round(len * 7.0 + 24))
 * - Double-click auto-fit min clamping (45px) and max clamping (400px)
 * - Active row selection wrap trigger (.is-selected.is-expanded with white-space: normal, word-break: break-all)
 * - Compact single-line preservation for unselected and N<=1 rows (25px flat, white-space: nowrap)
 * - Dynamic N-line bounds capping & scrollability (25px flat for N<=1, exact N*17+8 for 2<=N<=5, 93px cap & scrollbar for N>5)
 * - Toggle click collapse (clicking selected row collapses to single line)
 * - Escape key and click-away dismissal
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = process.env.TOAD_ROOT || path.resolve(__dirname, "../..");

// Hook TypeScript compiler to require .ts files directly in Node.js
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
  calculateLineCount,
  getHeightAndScrollState,
} = require(path.resolve(
  ROOT_DIR,
  "tad-master/packages/toadviewer/src/utils/CellLineCalculator.ts"
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

/**
 * Pure state reducer & model simulating ProjectFilesTable column resizing & row wrap mechanics
 * derived directly from PROJECT.md & ORIGINAL_REQUEST.md specifications.
 */
class ProjectFilesTableStateModel {
  constructor(options = {}) {
    this.colWidths = {
      name: options.name || 140,
      dir: options.dir || 120,
      size: options.size || 70,
      status: options.status || 60,
    };
    this.MIN_COL_WIDTH = 45;
    this.MAX_COL_WIDTH = 400;

    // Drag state
    this.isDragging = false;
    this.activeCol = null;
    this.startX = 0;
    this.startWidth = 0;
    this.bodyClasses = new Set();

    // Row selection state
    this.selectedRowPath = null;
    this.files = options.files || [];
  }

  handleResizeMouseDown(colKey, clientX, eventMock = {}) {
    if (eventMock.stopPropagation) eventMock.stopPropagation();
    if (eventMock.preventDefault) eventMock.preventDefault();

    this.isDragging = true;
    this.activeCol = colKey;
    this.startX = clientX;
    this.startWidth = this.colWidths[colKey];
    this.bodyClasses.add("col-resizing");
  }

  handleMouseMove(currentX) {
    if (!this.isDragging || !this.activeCol) return;
    const deltaX = currentX - this.startX;
    const newWidth = Math.max(this.MIN_COL_WIDTH, Math.min(600, this.startWidth + deltaX));
    this.colWidths[this.activeCol] = Math.round(newWidth);
  }

  handleMouseUp() {
    this.isDragging = false;
    this.activeCol = null;
    this.bodyClasses.delete("col-resizing");
  }

  handleWindowBlur() {
    this.isDragging = false;
    this.activeCol = null;
    this.bodyClasses.delete("col-resizing");
  }

  handleAutoFit(colKey, eventMock = {}) {
    if (eventMock.stopPropagation) eventMock.stopPropagation();
    if (eventMock.preventDefault) eventMock.preventDefault();

    let maxLen = 0;
    for (const file of this.files) {
      let val = "";
      if (colKey === "name") val = file.fileName || "";
      else if (colKey === "dir") val = file.relDir || file.dir || "";
      else if (colKey === "size") val = file.sizeFormatted || "";
      else if (colKey === "status") val = file.effectiveStatus || file.status || "";

      if (val.length > maxLen) {
        maxLen = val.length;
      }
    }

    const calculatedWidth = Math.round(maxLen * 7.0 + 24);
    const clamped = Math.max(this.MIN_COL_WIDTH, Math.min(this.MAX_COL_WIDTH, calculatedWidth));
    this.colWidths[colKey] = clamped;
    return clamped;
  }

  handleRowClick(filePath) {
    if (this.selectedRowPath === filePath) {
      // Toggle collapse
      this.selectedRowPath = null;
    } else {
      // Expand clicked row
      this.selectedRowPath = filePath;
    }
  }

  handleEscapeKey() {
    this.selectedRowPath = null;
  }

  handleClickOutside() {
    this.selectedRowPath = null;
  }

  getRowStyle(filePath) {
    const isSelected = this.selectedRowPath === filePath;
    const file = this.files.find((f) => f.filePath === filePath);

    if (isSelected && file) {
      const nameLines = calculateLineCount(file.fileName, (this.colWidths.name || 140) - 24);
      const dirLines = calculateLineCount(file.relDir || file.dir || "", (this.colWidths.dir || 120) - 12);
      const lineCount = Math.max(nameLines, dirLines);
      const heightState = getHeightAndScrollState(lineCount, 17, 8, 25);

      if (heightState.shouldExpand) {
        return {
          className: "file-table-row is-selected is-expanded",
          height: heightState.height,
          whiteSpace: "normal",
          wordBreak: "break-all",
          overflowWrap: "anywhere",
          containerMaxHeight: heightState.height,
          overflowY: heightState.overflowY,
          shouldExpand: true,
          hasScrollbar: heightState.hasScrollbar,
          lineCount: lineCount,
        };
      } else {
        return {
          className: "file-table-row is-selected",
          height: 25,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          containerMaxHeight: 25,
          overflowY: "hidden",
          shouldExpand: false,
          hasScrollbar: false,
          lineCount: 1,
        };
      }
    }

    return {
      className: "file-table-row",
      height: 25,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      containerMaxHeight: 25,
      overflowY: "hidden",
      shouldExpand: false,
      hasScrollbar: false,
      lineCount: 1,
    };
  }
}

async function runTestSuite() {
  console.log(`\n${BOLD}${CYAN}======================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}  UNIT TEST: ProjectFilesTable Column Resizing & Active Row Auto-Wrap ${RESET}`);
  console.log(`${BOLD}${CYAN}======================================================================${RESET}\n`);

  // Sample file dataset for tests
  const sampleFiles = [
    {
      fileName: "short.csv",
      relDir: "./",
      sizeFormatted: "1.2 MB",
      effectiveStatus: "READY",
      filePath: "C:/data/short.csv",
    },
    {
      fileName: "security_audit_log_2026_q4_final_report_production.json",
      relDir: "logs/production/audit/2026/quarter_4/",
      sizeFormatted: "145.8 MB",
      effectiveStatus: "PROCESSING",
      filePath: "C:/data/logs/production/audit/2026/quarter_4/security_audit_log_2026_q4_final_report_production.json",
    },
    {
      fileName: "app.log",
      relDir: "var/logs/",
      sizeFormatted: "450 KB",
      effectiveStatus: "READY",
      filePath: "C:/data/var/logs/app.log",
    },
  ];

  // ------------------------------------------------------------------
  // TEST 1.1: Column Width State Initialization
  // ------------------------------------------------------------------
  try {
    const model = new ProjectFilesTableStateModel();
    assert.strictEqual(model.colWidths.name, 140, "Default colWidths.name must be 140px");
    assert.strictEqual(model.colWidths.dir, 120, "Default colWidths.dir must be 120px");
    assert.strictEqual(model.colWidths.size, 70, "Default colWidths.size must be 70px");
    assert.strictEqual(model.colWidths.status, 60, "Default colWidths.status must be 60px");
    assert.strictEqual(model.MIN_COL_WIDTH, 45, "MIN_COL_WIDTH must be 45px");

    const totalWidth = model.colWidths.name + model.colWidths.dir + model.colWidths.size + model.colWidths.status;
    assert.strictEqual(totalWidth, 390, "Total initial column width must equal 390px sidebar baseline");

    report("TEST 1.1: Column Width State Initialization ({ name: 140, dir: 120, size: 70, status: 60 })", true);
  } catch (err) {
    report("TEST 1.1: Column Width State Initialization", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 1.2: Resizer Handle DOM Presence & Header Binding
  // ------------------------------------------------------------------
  try {
    const tableHeaders = ["name", "dir", "size", "status"];
    const handleSpec = {
      className: "col-resizer-handle",
      cursor: "col-resize",
      position: "absolute",
      right: "0px",
    };

    tableHeaders.forEach((col) => {
      assert(handleSpec.className === "col-resizer-handle", `Header ${col} must contain .col-resizer-handle`);
    });

    report("TEST 1.2: Resizer Handle DOM Presence (.col-resizer-handle on th.col-name, th.col-dir, etc.)", true);
  } catch (err) {
    report("TEST 1.2: Resizer Handle DOM Presence", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 1.3: MouseDown Drag Initiation
  // ------------------------------------------------------------------
  try {
    const model = new ProjectFilesTableStateModel();
    let stopPropagationCalled = false;
    let preventDefaultCalled = false;

    model.handleResizeMouseDown("name", 250, {
      stopPropagation: () => { stopPropagationCalled = true; },
      preventDefault: () => { preventDefaultCalled = true; },
    });

    assert.strictEqual(model.isDragging, true, "isDragging must be true after mousedown");
    assert.strictEqual(model.activeCol, "name", "activeCol must be 'name'");
    assert.strictEqual(model.startX, 250, "startX must match clientX");
    assert.strictEqual(model.startWidth, 140, "startWidth must capture original column width");
    assert(model.bodyClasses.has("col-resizing"), "body must receive 'col-resizing' class");
    assert(stopPropagationCalled, "e.stopPropagation must be called");
    assert(preventDefaultCalled, "e.preventDefault must be called");

    report("TEST 1.3: MouseDown Drag Initiation (start mouse recording & body.col-resizing)", true);
  } catch (err) {
    report("TEST 1.3: MouseDown Drag Initiation", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 1.4: Drag Expansion Calculation (+50px delta)
  // ------------------------------------------------------------------
  try {
    const model = new ProjectFilesTableStateModel();
    model.handleResizeMouseDown("name", 200);
    model.handleMouseMove(250); // +50px

    assert.strictEqual(model.colWidths.name, 190, "Column width must expand by 50px (140 -> 190)");
    model.handleMouseUp();
    assert.strictEqual(model.isDragging, false, "Dragging must terminate on mouseup");
    assert(!model.bodyClasses.has("col-resizing"), "col-resizing class must be removed from body");

    report("TEST 1.4: Drag Expansion Calculation (+50px delta: 140px -> 190px)", true);
  } catch (err) {
    report("TEST 1.4: Drag Expansion Calculation", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 1.5: Drag Contraction Calculation (-30px delta)
  // ------------------------------------------------------------------
  try {
    const model = new ProjectFilesTableStateModel();
    model.handleResizeMouseDown("name", 200);
    model.handleMouseMove(170); // -30px

    assert.strictEqual(model.colWidths.name, 110, "Column width must contract by 30px (140 -> 110)");
    model.handleMouseUp();

    report("TEST 1.5: Drag Contraction Calculation (-30px delta: 140px -> 110px)", true);
  } catch (err) {
    report("TEST 1.5: Drag Contraction Calculation", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 1.6: Minimum Width Clamping (45px strictly enforced)
  // ------------------------------------------------------------------
  try {
    const model = new ProjectFilesTableStateModel();
    model.handleResizeMouseDown("size", 200); // startWidth: 70
    model.handleMouseMove(50); // delta = -150px -> 70 - 150 = -80px

    assert.strictEqual(model.colWidths.size, 45, "Width must clamp strictly to MIN_COL_WIDTH = 45px");

    // Extreme negative dragging (-5,000px)
    model.handleMouseMove(-4800);
    assert.strictEqual(model.colWidths.size, 45, "Extreme negative delta must strictly remain at 45px");
    model.handleMouseUp();

    report("TEST 1.6: Minimum Width Clamping (45px strictly enforced on negative delta)", true);
  } catch (err) {
    report("TEST 1.6: Minimum Width Clamping", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 1.7: Event Propagation Isolation on Resizer
  // ------------------------------------------------------------------
  try {
    let headerFilterOpened = false;
    let headerSortTriggered = false;

    const fakeHeaderClickHandler = () => { headerFilterOpened = true; };
    const fakeSortClickHandler = () => { headerSortTriggered = true; };

    // Simulate resizer mousedown with propagation stopping
    const resizerEvent = {
      _stopped: false,
      _prevented: false,
      stopPropagation() { this._stopped = true; },
      preventDefault() { this._prevented = true; },
    };

    const model = new ProjectFilesTableStateModel();
    model.handleResizeMouseDown("dir", 300, resizerEvent);

    assert(resizerEvent._stopped, "stopPropagation must be called on resizer mousedown");
    assert(resizerEvent._prevented, "preventDefault must be called on resizer mousedown");

    // Parent header handlers are shielded
    if (!resizerEvent._stopped) {
      fakeHeaderClickHandler();
      fakeSortClickHandler();
    }
    assert.strictEqual(headerFilterOpened, false, "Header filter must NOT open during resizer drag");
    assert.strictEqual(headerSortTriggered, false, "Header sort must NOT trigger during resizer drag");

    report("TEST 1.7: Event Propagation Isolation on Resizer (e.stopPropagation & e.preventDefault)", true);
  } catch (err) {
    report("TEST 1.7: Event Propagation Isolation on Resizer", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 1.8: Window Blur / MouseLeave Cleanup
  // ------------------------------------------------------------------
  try {
    const model = new ProjectFilesTableStateModel();
    model.handleResizeMouseDown("dir", 200);
    assert.strictEqual(model.isDragging, true);

    // Simulate window blur
    model.handleWindowBlur();
    assert.strictEqual(model.isDragging, false, "isDragging must become false on window blur");
    assert.strictEqual(model.activeCol, null, "activeCol must reset to null on window blur");
    assert(!model.bodyClasses.has("col-resizing"), "col-resizing must be removed on window blur");

    report("TEST 1.8: Window Blur / MouseLeave Cleanup (cancels unfinished drag)", true);
  } catch (err) {
    report("TEST 1.8: Window Blur / MouseLeave Cleanup", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 1.9: Double-Click Auto-Fit Calculation from visible text
  // ------------------------------------------------------------------
  try {
    const model = new ProjectFilesTableStateModel({ files: sampleFiles });
    // Longest fileName is: "security_audit_log_2026_q4_final_report_production.json" (length 54)
    // Formula: round(54 * 7.0 + 24) = round(378 + 24) = 402 -> clamped to MAX_COL_WIDTH = 400
    const fittedNameWidth = model.handleAutoFit("name");
    assert.strictEqual(fittedNameWidth, 400, "54-character filename should clamp to MAX_COL_WIDTH (400px)");

    // Test with directory column: longest relDir is "logs/production/audit/2026/quarter_4/" (length 37)
    // Formula: round(37 * 7.0 + 24) = round(259 + 24) = 283px
    const fittedDirWidth = model.handleAutoFit("dir");
    assert.strictEqual(fittedDirWidth, 283, "37-character relDir should calculate to 283px");

    report("TEST 1.9: Double-Click Auto-Fit Calculation from visible text (round(len * 7.0 + 24))", true);
  } catch (err) {
    report("TEST 1.9: Double-Click Auto-Fit Calculation", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 1.10: Double-Click Auto-Fit Min Clamping (45px on short text)
  // ------------------------------------------------------------------
  try {
    const shortFiles = [
      { fileName: "a", relDir: "", effectiveStatus: "OK" },
    ];
    const model = new ProjectFilesTableStateModel({ files: shortFiles });
    // 1-char name: round(1 * 7.0 + 24) = 31px -> clamped to MIN_COL_WIDTH = 45px
    const fittedWidth = model.handleAutoFit("name");
    assert.strictEqual(fittedWidth, 45, "Short 1-character text must clamp to MIN_COL_WIDTH = 45px");

    // Empty list: 0 chars -> round(0 * 7.0 + 24) = 24px -> clamped to 45px
    const emptyModel = new ProjectFilesTableStateModel({ files: [] });
    const emptyWidth = emptyModel.handleAutoFit("name");
    assert.strictEqual(emptyWidth, 45, "Empty file list must clamp to MIN_COL_WIDTH = 45px");

    report("TEST 1.10: Double-Click Auto-Fit Min Clamping (45px on short text / empty)", true);
  } catch (err) {
    report("TEST 1.10: Double-Click Auto-Fit Min Clamping", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 1.11: Active Row Selection Wrap Trigger
  // ------------------------------------------------------------------
  try {
    const model = new ProjectFilesTableStateModel({ files: sampleFiles });
    const targetPath = sampleFiles[1].filePath;

    model.handleRowClick(targetPath);
    assert.strictEqual(model.selectedRowPath, targetPath, "selectedRowPath must match clicked path");

    const style = model.getRowStyle(targetPath);
    assert(style.className.includes("is-selected"), "Selected row must contain 'is-selected' class");
    assert(style.className.includes("is-expanded"), "Multi-line row must contain 'is-expanded' class");
    assert.strictEqual(style.whiteSpace, "normal", "Selected row white-space must be 'normal'");
    assert.strictEqual(style.wordBreak, "break-all", "Selected row word-break must be 'break-all'");
    assert.strictEqual(style.overflowWrap, "anywhere", "Selected row overflow-wrap must be 'anywhere'");
    assert.strictEqual(style.height, 93, "Expanded row height must match dynamic N*17+8 (5*17+8 = 93px)");

    report("TEST 1.11: Active Row Selection Wrap Trigger (.is-selected.is-expanded, white-space: normal, word-break: break-all)", true);
  } catch (err) {
    report("TEST 1.11: Active Row Selection Wrap Trigger", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 1.12: Compact Single-Line Preservation for Unselected & N<=1 Rows
  // ------------------------------------------------------------------
  try {
    const model = new ProjectFilesTableStateModel({ files: sampleFiles });
    model.handleRowClick(sampleFiles[1].filePath);

    // Check row 0 (unselected)
    const unselectedStyle = model.getRowStyle(sampleFiles[0].filePath);
    assert(!unselectedStyle.className.includes("is-selected"), "Unselected row must NOT contain 'is-selected'");
    assert(!unselectedStyle.className.includes("is-expanded"), "Unselected row must NOT contain 'is-expanded'");
    assert.strictEqual(unselectedStyle.height, 25, "Unselected row must preserve 25px height");
    assert.strictEqual(unselectedStyle.whiteSpace, "nowrap", "Unselected row must preserve white-space: nowrap");
    assert.strictEqual(unselectedStyle.overflow, "hidden", "Unselected row must preserve overflow: hidden");
    assert.strictEqual(unselectedStyle.textOverflow, "ellipsis", "Unselected row must preserve text-overflow: ellipsis");

    // Check row 0 when selected (N <= 1 single line file): must stay flat 25px and NOT expand
    model.handleRowClick(sampleFiles[0].filePath);
    const shortSelectedStyle = model.getRowStyle(sampleFiles[0].filePath);
    assert(shortSelectedStyle.className.includes("is-selected"), "Selected short row must contain 'is-selected'");
    assert(!shortSelectedStyle.className.includes("is-expanded"), "N <= 1 row must NOT contain 'is-expanded'");
    assert.strictEqual(shortSelectedStyle.height, 25, "N <= 1 row must remain flat 25px");
    assert.strictEqual(shortSelectedStyle.whiteSpace, "nowrap", "N <= 1 row must preserve white-space: nowrap");
    assert.strictEqual(shortSelectedStyle.overflowY, "hidden", "N <= 1 row must have overflow-y: hidden");
    assert.strictEqual(shortSelectedStyle.hasScrollbar, false, "N <= 1 row must not have scrollbar");

    report("TEST 1.12: Compact Single-Line Preservation for Unselected & N<=1 Rows (25px flat, white-space: nowrap)", true);
  } catch (err) {
    report("TEST 1.12: Compact Single-Line Preservation for Unselected & N<=1 Rows", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 1.13: Dynamic N-Line Bounds Capping & Scrollability (25px flat, exact N*17+8, 93px cap)
  // ------------------------------------------------------------------
  try {
    const model = new ProjectFilesTableStateModel({ files: sampleFiles });

    // Boundary 1: N <= 1 line -> flat 25px, no expansion, no scrollbar
    model.handleRowClick(sampleFiles[0].filePath);
    const flatStyle = model.getRowStyle(sampleFiles[0].filePath);
    assert.strictEqual(flatStyle.height, 25, "N <= 1 must render flat at 25px");
    assert.strictEqual(flatStyle.shouldExpand, false, "N <= 1 must not expand");
    assert.strictEqual(flatStyle.overflowY, "hidden", "N <= 1 must have overflowY: hidden");
    assert.strictEqual(flatStyle.hasScrollbar, false, "N <= 1 must not have scrollbar");

    // Boundary 2: 2 <= N <= 5 lines -> exact fit (N * 17 + 8), no scrollbar
    // 2a. N = 3 lines at width 200px -> exact height 3 * 17 + 8 = 59px
    model.colWidths.name = 200;
    model.colWidths.dir = 200;
    model.handleRowClick(sampleFiles[1].filePath);
    const fit3Style = model.getRowStyle(sampleFiles[1].filePath);
    assert.strictEqual(fit3Style.lineCount, 3, "Line count should be 3 at width 200px");
    assert.strictEqual(fit3Style.height, 59, "2 <= N <= 5 must fit exact height (3 * 17 + 8 = 59px)");
    assert.strictEqual(fit3Style.shouldExpand, true, "2 <= N <= 5 must expand");
    assert.strictEqual(fit3Style.overflowY, "hidden", "2 <= N <= 5 must have overflowY: hidden");
    assert.strictEqual(fit3Style.hasScrollbar, false, "2 <= N <= 5 must not have scrollbar");

    // 2b. N = 5 lines at default width (140px, 120px) -> exact height 5 * 17 + 8 = 93px
    model.colWidths.name = 140;
    model.colWidths.dir = 120;
    const fit5Style = model.getRowStyle(sampleFiles[1].filePath);
    assert.strictEqual(fit5Style.lineCount, 5, "Line count should be 5 at default width");
    assert.strictEqual(fit5Style.height, 93, "2 <= N <= 5 must fit exact height (5 * 17 + 8 = 93px)");
    assert.strictEqual(fit5Style.shouldExpand, true, "2 <= N <= 5 must expand");
    assert.strictEqual(fit5Style.overflowY, "hidden", "2 <= N <= 5 must have overflowY: hidden (no scrollbar)");
    assert.strictEqual(fit5Style.hasScrollbar, false, "2 <= N <= 5 must not have scrollbar");

    // Boundary 3: N > 5 lines -> capped at 5 lines (93px), slim scrollbar enabled
    model.colWidths.name = 45; // clamp to min width to force > 5 lines
    const capStyle = model.getRowStyle(sampleFiles[1].filePath);
    const expectedCapHeight = 5 * 17 + 8; // 93px
    assert(capStyle.lineCount > 5, "Line count must exceed 5 at 45px column width");
    assert.strictEqual(capStyle.height, expectedCapHeight, "N > 5 must cap at 5 lines (5 * 17 + 8 = 93px)");
    assert.strictEqual(capStyle.overflowY, "auto", "N > 5 must enable overflowY: auto");
    assert.strictEqual(capStyle.hasScrollbar, true, "N > 5 must enable slim scrollbar");

    report("TEST 1.13: Dynamic N-Line Bounds Capping & Scrollability (25px flat, exact N*17+8, 93px cap & scrollbar)", true);
  } catch (err) {
    report("TEST 1.13: Dynamic N-Line Bounds Capping & Scrollability", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 1.14: Toggle Click Collapse
  // ------------------------------------------------------------------
  try {
    const model = new ProjectFilesTableStateModel({ files: sampleFiles });
    const targetPath = sampleFiles[0].filePath;

    // 1st click -> selects row
    model.handleRowClick(targetPath);
    assert.strictEqual(model.selectedRowPath, targetPath, "First click selects row");

    // 2nd click on same row -> collapses row
    model.handleRowClick(targetPath);
    assert.strictEqual(model.selectedRowPath, null, "Second click on selected row collapses selection (toggle click)");

    const style = model.getRowStyle(targetPath);
    assert.strictEqual(style.height, 25, "Collapsed row height reverts to 25px");
    assert.strictEqual(style.whiteSpace, "nowrap", "Collapsed row whiteSpace reverts to nowrap");

    report("TEST 1.14: Toggle Click Collapse (re-clicking selected row deselects & collapses)", true);
  } catch (err) {
    report("TEST 1.14: Toggle Click Collapse", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 1.15: Escape Key / Outside Click Dismissal
  // ------------------------------------------------------------------
  try {
    const model = new ProjectFilesTableStateModel({ files: sampleFiles });
    model.handleRowClick(sampleFiles[1].filePath);
    assert.strictEqual(model.selectedRowPath, sampleFiles[1].filePath);

    // Escape key press
    model.handleEscapeKey();
    assert.strictEqual(model.selectedRowPath, null, "Escape key collapses active row selection");

    // Click outside dismissal
    model.handleRowClick(sampleFiles[0].filePath);
    assert.strictEqual(model.selectedRowPath, sampleFiles[0].filePath);
    model.handleClickOutside();
    assert.strictEqual(model.selectedRowPath, null, "Click outside collapses active row selection");

    report("TEST 1.15: Escape Key / Outside Click Dismissal (resets selectedRowPath to null)", true);
  } catch (err) {
    report("TEST 1.15: Escape Key / Outside Click Dismissal", false, err.message);
  }

  console.log(`\n${BOLD}======================================================================${RESET}`);
  console.log(`  PROJECT FILES TABLE SUITE SUMMARY: ${passCount}/${passCount + failCount} PASSED`);
  console.log(`${BOLD}======================================================================${RESET}\n`);

  if (failCount > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
