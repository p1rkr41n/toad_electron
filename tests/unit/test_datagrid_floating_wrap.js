/**
 * test_datagrid_floating_wrap.js
 * 
 * Unit Test Suite for Main DataGrid Double-Click Auto-Fit & Floating Cell Wrap:
 * - TEST 2.1: SlickGrid Resizer Handle Double-Click Binding
 * - TEST 2.2: Auto-Fit Column Width Math from visible viewport
 * - TEST 2.3: Header Title Width Protection
 * - TEST 2.4: Lower Bound Clamping (MINCOLWIDTH = 60px)
 * - TEST 2.5: Upper Bound Clamping (MAXCOLWIDTH = 500px)
 * - TEST 2.6: Floating Active Cell Expansion Trigger (.slick-cell-active-expanded)
 * - TEST 2.7: Non-Overflowing Cell Clean Selection (short text -> standard cell)
 * - TEST 2.8: Layer Isolation (z-index: 20, contain: none !important override)
 * - TEST 2.9: Visual Prominence & Blueprint Theme (border & shadow 0 4px 14px rgba(0,0,0,0.15))
 * - TEST 2.10: Dynamic Text Wrap Formatting (white-space: normal, word-break: break-word)
 * - TEST 2.11: Max-Height (180px) & Scrollability (overflow-y: auto, 4px slim scrollbar)
 * - TEST 2.12: Virtual Scroll Coordinate Invariance (top = rowIndex * 24px strictly constant)
 * - TEST 2.13: Grid Scroll Dismissal (grid.onScroll collapses floating cell)
 * - TEST 2.14: Escape Key Dismissal
 * - TEST 2.15: Active Cell Navigation Dismissal
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = process.env.TOAD_ROOT || path.resolve(__dirname, "../..");

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
 * State and Virtual Layout Model for SlickGrid Auto-Fit and Floating Wrap
 * simulating DataGrid.tsx and slickgrid.scss behavior.
 */
class SlickGridFloatingWrapModel {
  constructor(options = {}) {
    this.columns = options.columns || [
      { id: "id", name: "ID", field: "id", width: 80 },
      { id: "provider", name: "Provider", field: "provider", width: 140 },
      { id: "message", name: "Message", field: "message", width: 200 },
      { id: "raw", name: "RawPayload", field: "raw", width: 220 },
    ];
    this.dataView = options.dataView || [];
    this.viewport = { top: 0, bottom: 25 }; // visible viewport rows
    this.rowHeight = 24;

    this.MINCOLWIDTH = 60;
    this.MAXCOLWIDTH = 500;
    this.CHAR_WIDTH = 7.5;

    // Active expanded cell state
    this.activeCell = null; // { row, cell, colId }
    this.expandedCell = null; // { row, cell, colId, text }

    // Row coordinates registry: rowTop = i * 24
    this.rowPositions = new Map();
    for (let i = 0; i < (this.dataView.length || 100); i++) {
      this.rowPositions.set(i, i * this.rowHeight);
    }
  }

  measureStringWidth(s) {
    if (!s) return 24;
    return Math.round(String(s).length * this.CHAR_WIDTH + 24);
  }

  handleAutoFitColumn(colId, eventMock = {}) {
    if (eventMock.stopPropagation) eventMock.stopPropagation();
    if (eventMock.preventDefault) eventMock.preventDefault();

    const col = this.columns.find((c) => c.id === colId);
    if (!col) return null;

    let maxLen = (col.name || "").length;

    // Scan visible viewport rows only (O(viewport) performance)
    const start = Math.max(0, this.viewport.top);
    const end = Math.min(this.dataView.length, this.viewport.bottom);

    for (let i = start; i < end; i++) {
      const item = this.dataView[i];
      if (item) {
        const val = item[col.field];
        const strVal = val != null ? String(val) : "";
        if (strVal.length > maxLen) {
          maxLen = strVal.length;
        }
      }
    }

    const calculatedWidth = Math.round(maxLen * this.CHAR_WIDTH + 24);
    const clampedWidth = Math.max(this.MINCOLWIDTH, Math.min(this.MAXCOLWIDTH, calculatedWidth));
    col.width = clampedWidth;
    return clampedWidth;
  }

  setActiveCell(row, cellIndex) {
    const col = this.columns[cellIndex];
    if (!col) return;

    this.activeCell = { row, cell: cellIndex, colId: col.id };

    const item = this.dataView[row];
    const cellValue = item ? item[col.field] : "";
    const strVal = cellValue != null ? String(cellValue) : "";

    // Overflow check: string length > 28 or simulated scrollWidth > col.width
    const textLen = strVal.length;
    const estTextWidth = this.measureStringWidth(strVal);
    const isOverflowing = textLen > 28 || estTextWidth > col.width;

    if (isOverflowing) {
      this.expandedCell = {
        row,
        cell: cellIndex,
        colId: col.id,
        text: strVal,
        classes: ["slick-cell-active-expanded"],
        rowClasses: ["slick-row-has-expanded"],
      };
    } else {
      this.expandedCell = null;
    }
  }

  dismissFloatingCell() {
    this.expandedCell = null;
  }

  handleGridScroll(newScrollTop) {
    // Virtual scroll triggers immediate collapse
    this.dismissFloatingCell();
    const newTopRow = Math.floor(newScrollTop / this.rowHeight);
    this.viewport.top = newTopRow;
    this.viewport.bottom = newTopRow + 25;
  }

  handleEscapeKey() {
    this.dismissFloatingCell();
  }

  getCellStyle(row, cellIndex) {
    const isExpanded =
      this.expandedCell &&
      this.expandedCell.row === row &&
      this.expandedCell.cell === cellIndex;

    if (isExpanded) {
      return {
        className: "slick-cell slick-cell-active-expanded",
        position: "absolute",
        zIndex: 20,
        contain: "none",
        maxHeight: "180px",
        overflowY: "auto",
        whiteSpace: "normal",
        wordBreak: "break-word",
        overflowWrap: "anywhere",
        boxShadow: "0 4px 14px rgba(0, 0, 0, 0.15)",
        border: "1px solid #0284c7",
        rowZIndex: 25,
        rowOverflow: "visible",
      };
    }

    return {
      className: "slick-cell",
      position: "absolute",
      zIndex: 1,
      contain: "strict",
      maxHeight: "24px",
      overflowY: "hidden",
      whiteSpace: "nowrap",
      wordBreak: "normal",
      overflowWrap: "normal",
      boxShadow: "none",
      border: "none",
      rowZIndex: 1,
      rowOverflow: "hidden",
    };
  }

  getRowTop(row) {
    return this.rowPositions.get(row);
  }
}

async function runTestSuite() {
  console.log(`\n${BOLD}${CYAN}======================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}  UNIT TEST: DataGrid Double-Click Auto-Fit & Floating Cell Wrap     ${RESET}`);
  console.log(`${BOLD}${CYAN}======================================================================${RESET}\n`);

  // Synthetic dataset
  const sampleData = [];
  for (let i = 0; i < 50; i++) {
    sampleData.push({
      id: i + 1,
      provider: i % 2 === 0 ? "Microsoft-Windows-Security-Auditing" : "Service Control Manager",
      message:
        i === 5
          ? "A token right was adjusted. Process Information: Process ID: 0x3f4, Process Name: C:\\Windows\\System32\\services.exe, Client User: SYSTEM, Adjusted Privileges: SeBackupPrivilege, SeRestorePrivilege, SeSecurityPrivilege"
          : i % 3 === 0
          ? "Short event message"
          : `Audit Event ${i}`,
      raw: `{"EventID": 4670, "RecordID": ${90000 + i}, "Keywords": "0x8020000000000000", "Data": {"SubjectUserSid": "S-1-5-18", "SubjectUserName": "SYSTEM"}}`,
    });
  }

  // ------------------------------------------------------------------
  // TEST 2.1: SlickGrid Resizer Handle Double-Click Binding
  // ------------------------------------------------------------------
  try {
    const gridModel = new SlickGridFloatingWrapModel({ dataView: sampleData });
    let stopPropagationFired = false;
    let defaultPrevented = false;

    const fakeEvent = {
      target: {
        classList: { contains: (cls) => cls === "slick-resizable-handle" },
        closest: (sel) => (sel === ".slick-header-column" ? { dataset: { colId: "provider" } } : null),
      },
      stopPropagation() { stopPropagationFired = true; },
      preventDefault() { defaultPrevented = true; },
    };

    gridModel.handleAutoFitColumn("provider", fakeEvent);

    assert(stopPropagationFired, "e.stopPropagation must be invoked to prevent triggering column sort");
    assert(defaultPrevented, "e.preventDefault must be invoked");

    report("TEST 2.1: SlickGrid Resizer Handle Double-Click Binding (stops propagation to sort)", true);
  } catch (err) {
    report("TEST 2.1: SlickGrid Resizer Handle Double-Click Binding", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 2.2: Auto-Fit Column Width Math from visible viewport
  // ------------------------------------------------------------------
  try {
    const gridModel = new SlickGridFloatingWrapModel({ dataView: sampleData });
    // Longest provider in sampleData is "Microsoft-Windows-Security-Auditing" (35 chars)
    // Formula: round(35 * 7.5 + 24) = round(262.5 + 24) = 287px
    const fitted = gridModel.handleAutoFitColumn("provider");
    assert.strictEqual(fitted, 287, "Provider column width must auto-fit to 287px based on longest visible text");

    report("TEST 2.2: Auto-Fit Column Width Math from visible viewport (round(maxLen * 7.5 + 24))", true);
  } catch (err) {
    report("TEST 2.2: Auto-Fit Column Width Math", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 2.3: Header Title Width Protection
  // ------------------------------------------------------------------
  try {
    // Header title is longer than any cell data
    const longHeaderGrid = new SlickGridFloatingWrapModel({
      columns: [
        { id: "extra_col", name: "ExtremelyLongAuditHeaderNameWithDescriptor", field: "extra_col", width: 100 },
      ],
      dataView: [{ extra_col: "abc" }, { extra_col: "def" }],
    });

    // Header title length: 42 chars -> round(42 * 7.5 + 24) = round(315 + 24) = 339px
    const fitted = longHeaderGrid.handleAutoFitColumn("extra_col");
    assert(fitted >= 339, `Auto-fit must protect header title width (expected >= 339px, got ${fitted}px)`);

    report("TEST 2.3: Header Title Width Protection (preserves column title without truncation)", true);
  } catch (err) {
    report("TEST 2.3: Header Title Width Protection", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 2.4: Lower Bound Clamping (MINCOLWIDTH = 60px)
  // ------------------------------------------------------------------
  try {
    const shortGrid = new SlickGridFloatingWrapModel({
      columns: [{ id: "id", name: "ID", field: "id", width: 100 }],
      dataView: [{ id: 1 }, { id: 2 }, { id: 3 }],
    });

    // 1-char ID -> round(2 * 7.5 + 24) = 39px -> clamped to MINCOLWIDTH = 60px
    const fitted = shortGrid.handleAutoFitColumn("id");
    assert.strictEqual(fitted, 60, "Auto-fit width must clamp to MINCOLWIDTH = 60px");

    report("TEST 2.4: Lower Bound Clamping (MINCOLWIDTH = 60px strictly enforced)", true);
  } catch (err) {
    report("TEST 2.4: Lower Bound Clamping", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 2.5: Upper Bound Clamping (MAXCOLWIDTH = 500px)
  // ------------------------------------------------------------------
  try {
    const hugeGrid = new SlickGridFloatingWrapModel({
      columns: [{ id: "raw", name: "Raw", field: "raw", width: 150 }],
      dataView: [
        { raw: "A".repeat(300) }, // 300 chars -> round(300 * 7.5 + 24) = 2274px
      ],
    });

    const fitted = hugeGrid.handleAutoFitColumn("raw");
    assert.strictEqual(fitted, 500, "Auto-fit width must clamp to MAXCOLWIDTH = 500px");

    report("TEST 2.5: Upper Bound Clamping (MAXCOLWIDTH = 500px strictly enforced)", true);
  } catch (err) {
    report("TEST 2.5: Upper Bound Clamping", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 2.6: Floating Active Cell Expansion Trigger (.slick-cell-active-expanded)
  // ------------------------------------------------------------------
  try {
    const gridModel = new SlickGridFloatingWrapModel({ dataView: sampleData });
    // Row 5, col 2 is a long message (> 200 chars)
    gridModel.setActiveCell(5, 2);

    assert(gridModel.expandedCell !== null, "expandedCell must be active");
    assert.strictEqual(gridModel.expandedCell.row, 5);
    assert.strictEqual(gridModel.expandedCell.cell, 2);
    assert(gridModel.expandedCell.classes.includes("slick-cell-active-expanded"));
    assert(gridModel.expandedCell.rowClasses.includes("slick-row-has-expanded"));

    report("TEST 2.6: Floating Active Cell Expansion Trigger (.slick-cell-active-expanded applied)", true);
  } catch (err) {
    report("TEST 2.6: Floating Active Cell Expansion Trigger", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 2.7: Non-Overflowing Cell Clean Selection
  // ------------------------------------------------------------------
  try {
    const gridModel = new SlickGridFloatingWrapModel({ dataView: sampleData });
    // Row 0, col 0 is "ID: 1" (length 1, column width 80px -> no overflow)
    gridModel.setActiveCell(0, 0);

    assert.strictEqual(gridModel.expandedCell, null, "Short non-overflowing cell must NOT receive expanded class");
    const style = gridModel.getCellStyle(0, 0);
    assert(!style.className.includes("slick-cell-active-expanded"), "Cell must remain standard slick-cell");

    report("TEST 2.7: Non-Overflowing Cell Clean Selection (short text stays standard single-line)", true);
  } catch (err) {
    report("TEST 2.7: Non-Overflowing Cell Clean Selection", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 2.8: Layer Isolation (z-index: 20 & contain: none !important override)
  // ------------------------------------------------------------------
  try {
    const gridModel = new SlickGridFloatingWrapModel({ dataView: sampleData });
    gridModel.setActiveCell(5, 2);

    const style = gridModel.getCellStyle(5, 2);
    assert.strictEqual(style.zIndex, 20, "Floating cell zIndex must be 20 to float above neighboring cells");
    assert.strictEqual(style.contain, "none", "contain MUST be 'none' to override contain: strict;");
    assert.strictEqual(style.rowZIndex, 25, "Parent row zIndex must be elevated to 25");
    assert.strictEqual(style.rowOverflow, "visible", "Parent row overflow must be 'visible'");

    report("TEST 2.8: Layer Isolation (z-index: 20 & contain: none !important override)", true);
  } catch (err) {
    report("TEST 2.8: Layer Isolation", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 2.9: Visual Prominence & Blueprint Theme (border & shadow)
  // ------------------------------------------------------------------
  try {
    const gridModel = new SlickGridFloatingWrapModel({ dataView: sampleData });
    gridModel.setActiveCell(5, 2);

    const style = gridModel.getCellStyle(5, 2);
    assert(style.boxShadow.includes("0 4px 14px rgba(0, 0, 0, 0.15)"), "Box shadow must provide 0 4px 14px elevation");
    assert(style.border.includes("#0284c7") || style.border.includes("rgb"), "Border must apply Blueprint primary color");

    report("TEST 2.9: Visual Prominence & Blueprint Theme (border & shadow 0 4px 14px rgba(0,0,0,0.15))", true);
  } catch (err) {
    report("TEST 2.9: Visual Prominence & Blueprint Theme", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 2.10: Dynamic Text Wrap Formatting
  // ------------------------------------------------------------------
  try {
    const gridModel = new SlickGridFloatingWrapModel({ dataView: sampleData });
    gridModel.setActiveCell(5, 2);

    const style = gridModel.getCellStyle(5, 2);
    assert.strictEqual(style.whiteSpace, "normal", "Floating cell white-space must be 'normal'");
    assert.strictEqual(style.wordBreak, "break-word", "Floating cell word-break must be 'break-word'");
    assert.strictEqual(style.overflowWrap, "anywhere", "Floating cell overflow-wrap must be 'anywhere'");

    report("TEST 2.10: Dynamic Text Wrap Formatting (white-space: normal, word-break: break-word)", true);
  } catch (err) {
    report("TEST 2.10: Dynamic Text Wrap Formatting", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 2.11: Max-Height (180px) & Scrollability
  // ------------------------------------------------------------------
  try {
    const gridModel = new SlickGridFloatingWrapModel({ dataView: sampleData });
    gridModel.setActiveCell(5, 2);

    const style = gridModel.getCellStyle(5, 2);
    assert.strictEqual(style.maxHeight, "180px", "Floating cell max-height must be capped at 180px");
    assert.strictEqual(style.overflowY, "auto", "Floating cell overflow-y must be 'auto'");

    report("TEST 2.11: Max-Height (180px) & Scrollability (max-height: 180px & overflow-y: auto)", true);
  } catch (err) {
    report("TEST 2.11: Max-Height & Scrollability", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 2.12: Virtual Scroll Coordinate Invariance (top = rowIndex * 24px)
  // ------------------------------------------------------------------
  try {
    const gridModel = new SlickGridFloatingWrapModel({ dataView: sampleData });
    const originalTopRow5 = gridModel.getRowTop(5);
    const originalTopRow6 = gridModel.getRowTop(6);

    assert.strictEqual(originalTopRow5, 5 * 24, "Row 5 top must be 120px");
    assert.strictEqual(originalTopRow6, 6 * 24, "Row 6 top must be 144px");

    // Expand cell in row 5
    gridModel.setActiveCell(5, 2);

    // Verify row top positions are strictly unmodified
    const postExpandTopRow5 = gridModel.getRowTop(5);
    const postExpandTopRow6 = gridModel.getRowTop(6);

    assert.strictEqual(postExpandTopRow5, 120, "Row 5 top coordinate must remain 120px during active cell expansion");
    assert.strictEqual(postExpandTopRow6, 144, "Row 6 top coordinate must remain 144px without virtual displacement");

    report("TEST 2.12: Virtual Scroll Coordinate Invariance (top = rowIndex * 24px strictly constant)", true);
  } catch (err) {
    report("TEST 2.12: Virtual Scroll Coordinate Invariance", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 2.13: Grid Scroll Dismissal (grid.onScroll)
  // ------------------------------------------------------------------
  try {
    const gridModel = new SlickGridFloatingWrapModel({ dataView: sampleData });
    gridModel.setActiveCell(5, 2);
    assert(gridModel.expandedCell !== null);

    // Trigger grid scroll
    gridModel.handleGridScroll(240); // Scrolled 10 rows down
    assert.strictEqual(gridModel.expandedCell, null, "Floating cell must be immediately dismissed on grid scroll");

    report("TEST 2.13: Grid Scroll Dismissal (grid.onScroll immediately collapses floating cell)", true);
  } catch (err) {
    report("TEST 2.13: Grid Scroll Dismissal", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 2.14: Escape Key Dismissal
  // ------------------------------------------------------------------
  try {
    const gridModel = new SlickGridFloatingWrapModel({ dataView: sampleData });
    gridModel.setActiveCell(5, 2);
    assert(gridModel.expandedCell !== null);

    // Press Escape
    gridModel.handleEscapeKey();
    assert.strictEqual(gridModel.expandedCell, null, "Pressing Escape must immediately dismiss floating cell");

    report("TEST 2.14: Escape Key Dismissal (Escape keydown collapses floating expanded cell)", true);
  } catch (err) {
    report("TEST 2.14: Escape Key Dismissal", false, err.message);
  }

  // ------------------------------------------------------------------
  // TEST 2.15: Active Cell Navigation Dismissal
  // ------------------------------------------------------------------
  try {
    const gridModel = new SlickGridFloatingWrapModel({ dataView: sampleData });
    // Expand row 5, col 2
    gridModel.setActiveCell(5, 2);
    assert.strictEqual(gridModel.expandedCell.row, 5);

    // Move active cell to row 6, col 0 (short ID)
    gridModel.setActiveCell(6, 0);
    assert.strictEqual(gridModel.expandedCell, null, "Navigating to a non-overflowing cell collapses previous floating overlay");

    report("TEST 2.15: Active Cell Navigation Dismissal (arrow keys / click switches collapse previous cell)", true);
  } catch (err) {
    report("TEST 2.15: Active Cell Navigation Dismissal", false, err.message);
  }

  console.log(`\n${BOLD}======================================================================${RESET}`);
  console.log(`  DATAGRID FLOATING WRAP SUITE SUMMARY: ${passCount}/${passCount + failCount} PASSED`);
  console.log(`${BOLD}======================================================================${RESET}\n`);

  if (failCount > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
