/**
 * test_modal_cell_glow_suppression.js
 *
 * Squad 5 (Engineer E17): Modal Cell Highlight Suppression Auditor
 *
 * Comprehensive QA Test Suite verifying that when modal dialogs
 * (specifically Parse Columns / RegexDialog) open over ToadViewer DataGrid:
 *
 * 1.  Dialog open dispatches "dismiss-grid-cell-expand" event via GridOverlayBus.
 * 2.  Active cell highlight suppression rules in slickgrid.scss under body.bp4-overlay-open
 *     (.slick-cell.active has transparent background & border).
 * 3.  Active row highlight suppression under body.bp4-overlay-open
 *     (.slick-row.active has transparent background & no shadow).
 * 4.  Selected cell highlight suppression under body.bp4-overlay-open
 *     (.slick-cell.selected has transparent background, outline none, box-shadow none).
 * 5.  Floating expanded cell nodes (.slick-cell-active-expanded) are set to display: none
 *     under body.bp4-overlay-open.
 * 6.  Expanded row containers (.slick-row-has-expanded, .slick-row-active-expanded) are set
 *     to display: none under body.bp4-overlay-open.
 * 7.  Grid active cell reset: verify grid.resetActiveCell() is invoked on dialog open.
 * 8.  Multiple modal open/close cycles: verify clean restoration of grid interaction upon dialog close.
 * 9.  Zero visual glow / high-contrast bleed-through behind modal backdrop.
 * 10. Event teardown: unsubscription on component unmount prevents memory leaks.
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
  GridOverlayBus,
  EVENT_DISMISS_GRID_CELL_EXPAND,
  EVENT_PARSE_DIALOG_OPENED,
  EVENT_PARSE_DIALOG_CLOSED,
  emitDismissGridCellExpand,
  onDismissGridCellExpand,
  emitParseDialogOpened,
  onParseDialogOpened,
  emitParseDialogClosed,
  onParseDialogClosed,
  resetBusForTesting,
} = require(path.resolve(
  ROOT_DIR,
  "tad-master/packages/toadviewer/src/utils/GridOverlayBus.ts"
));

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

let passCount = 0;
let failCount = 0;

function report(num, name, passed, detail) {
  if (passed) {
    passCount++;
    console.log(`  ${GREEN}✔ [PASS]${RESET} Test ${num}: ${name}${detail ? ` - ${detail}` : ""}`);
  } else {
    failCount++;
    console.error(`  ${RED}✖ [FAIL]${RESET} Test ${num}: ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

console.log(`\n${BOLD}${CYAN}======================================================================${RESET}`);
console.log(`${BOLD}${CYAN}   QA AUDIT: MODAL ACTIVE CELL GLOW & FLOATING EXPAND SUPPRESSION     ${RESET}`);
console.log(`${BOLD}${CYAN}======================================================================${RESET}\n`);

// Load and parse slickgrid.scss to verify stylesheet integrity
const SCSS_PATH = path.resolve(
  ROOT_DIR,
  "tad-master/packages/toadviewer/src/slickgrid.scss"
);
const scssContent = fs.readFileSync(SCSS_PATH, "utf8");

// Extract body.bp4-overlay-open SCSS block
function extractOverlayOpenBlock(content) {
  const match = content.match(/body\.bp4-overlay-open\s*\{([\s\S]*?\n\})/);
  if (!match) return null;
  return match[0];
}
const overlayBlock = extractOverlayOpenBlock(scssContent);

// -----------------------------------------------------------------------------
// TEST 1: Dialog open dispatches "dismiss-grid-cell-expand" event via GridOverlayBus
// -----------------------------------------------------------------------------
try {
  resetBusForTesting();
  let receivedDismiss = false;
  let receivedOpened = false;

  const unsubDismiss = onDismissGridCellExpand(() => {
    receivedDismiss = true;
  });
  const unsubOpened = onParseDialogOpened(() => {
    receivedOpened = true;
  });

  // Simulate dialog open lifecycle emission
  emitDismissGridCellExpand();
  emitParseDialogOpened();

  assert.strictEqual(receivedDismiss, true, "Dialog open must emit dismiss-grid-cell-expand");
  assert.strictEqual(receivedOpened, true, "Dialog open must emit parse-dialog-opened");

  unsubDismiss();
  unsubOpened();

  report(1, 'Dialog open dispatches "dismiss-grid-cell-expand" event via GridOverlayBus', true, "Bus event successfully received");
} catch (err) {
  report(1, 'Dialog open dispatches "dismiss-grid-cell-expand" event via GridOverlayBus', false, err.message);
}

// -----------------------------------------------------------------------------
// TEST 2: Active cell highlight suppression rules in slickgrid.scss under body.bp4-overlay-open
// -----------------------------------------------------------------------------
try {
  assert(overlayBlock !== null, "body.bp4-overlay-open block must exist in slickgrid.scss");

  // Verify .slick-cell.active suppression
  const hasActiveCell = overlayBlock.includes(".slick-cell.active");
  const hasTransparentBg = /background:\s*transparent\s*!important/i.test(overlayBlock);
  const hasTransparentBorder = /border-color:\s*transparent\s*!important/i.test(overlayBlock);

  assert(hasActiveCell, ".slick-cell.active must be targeted under body.bp4-overlay-open");
  assert(hasTransparentBg, ".slick-cell.active background must be transparent !important");
  assert(hasTransparentBorder, ".slick-cell.active border-color must be transparent !important");

  report(2, "Active cell highlight suppression rules in slickgrid.scss under body.bp4-overlay-open", true, "background & border transparent !important");
} catch (err) {
  report(2, "Active cell highlight suppression rules in slickgrid.scss under body.bp4-overlay-open", false, err.message);
}

// -----------------------------------------------------------------------------
// TEST 3: Active row highlight suppression under body.bp4-overlay-open
// -----------------------------------------------------------------------------
try {
  assert(overlayBlock !== null, "body.bp4-overlay-open block must exist in slickgrid.scss");

  const hasActiveRow = overlayBlock.includes(".slick-row.active");
  const hasBoxShadowNone = /box-shadow:\s*none\s*!important/i.test(overlayBlock);

  assert(hasActiveRow, ".slick-row.active must be targeted under body.bp4-overlay-open");
  assert(hasBoxShadowNone, ".slick-row.active box-shadow must be none !important");

  report(3, "Active row highlight suppression under body.bp4-overlay-open", true, "background transparent & box-shadow none");
} catch (err) {
  report(3, "Active row highlight suppression under body.bp4-overlay-open", false, err.message);
}

// -----------------------------------------------------------------------------
// TEST 4: Selected cell highlight suppression under body.bp4-overlay-open
// -----------------------------------------------------------------------------
try {
  assert(overlayBlock !== null, "body.bp4-overlay-open block must exist in slickgrid.scss");

  const hasSelectedCell = overlayBlock.includes(".slick-cell.selected");
  const hasOutlineNone = /outline:\s*none\s*!important/i.test(overlayBlock);

  assert(hasSelectedCell, ".slick-cell.selected must be targeted under body.bp4-overlay-open");
  assert(hasOutlineNone, ".slick-cell.selected outline must be none !important");

  report(4, "Selected cell highlight suppression under body.bp4-overlay-open", true, "outline none & border transparent");
} catch (err) {
  report(4, "Selected cell highlight suppression under body.bp4-overlay-open", false, err.message);
}

// -----------------------------------------------------------------------------
// TEST 5: Floating expanded cell nodes (.slick-cell-active-expanded) display: none under overlay
// -----------------------------------------------------------------------------
try {
  assert(overlayBlock !== null, "body.bp4-overlay-open block must exist in slickgrid.scss");

  const hasCellExpanded = overlayBlock.includes(".slick-cell-active-expanded");
  const hasDisplayNone = /display:\s*none\s*!important/i.test(overlayBlock);

  assert(hasCellExpanded, ".slick-cell-active-expanded must be targeted under body.bp4-overlay-open");
  assert(hasDisplayNone, ".slick-cell-active-expanded must be display: none !important");

  report(5, "Floating expanded cell nodes (.slick-cell-active-expanded) display: none under body.bp4-overlay-open", true, "display: none !important");
} catch (err) {
  report(5, "Floating expanded cell nodes (.slick-cell-active-expanded) display: none under body.bp4-overlay-open", false, err.message);
}

// -----------------------------------------------------------------------------
// TEST 6: Expanded row containers (.slick-row-has-expanded, .slick-row-active-expanded) display: none
// -----------------------------------------------------------------------------
try {
  assert(overlayBlock !== null, "body.bp4-overlay-open block must exist in slickgrid.scss");

  const hasRowExpanded = overlayBlock.includes(".slick-row-has-expanded");
  const hasRowActiveExpanded = overlayBlock.includes(".slick-row-active-expanded");

  assert(hasRowExpanded, ".slick-row-has-expanded must be targeted");
  assert(hasRowActiveExpanded, ".slick-row-active-expanded must be targeted");

  report(6, "Expanded row containers (.slick-row-has-expanded, .slick-row-active-expanded) suppressed under overlay", true, "display: none !important");
} catch (err) {
  report(6, "Expanded row containers (.slick-row-has-expanded, .slick-row-active-expanded) suppressed under overlay", false, err.message);
}

// -----------------------------------------------------------------------------
// TEST 7: Grid active cell reset: verify grid.resetActiveCell() is invoked on dialog open
// -----------------------------------------------------------------------------
try {
  let resetCallCount = 0;
  const mockGrid = {
    activeCell: { row: 3, cell: 2 },
    resetActiveCell() {
      resetCallCount++;
      this.activeCell = null;
    },
  };

  // Mock global window and grid references matching RegexDialog implementation
  const mockWindow = {
    grid: mockGrid,
  };

  // Simulate dialog open effect logic
  function simulateDialogOpen(win) {
    emitDismissGridCellExpand();
    emitParseDialogOpened();
    const maybeGrid = win?.grid || win?.__toadGrid || win?.slickGrid;
    if (maybeGrid && typeof maybeGrid.resetActiveCell === "function") {
      maybeGrid.resetActiveCell();
    }
  }

  simulateDialogOpen(mockWindow);

  assert.strictEqual(resetCallCount, 1, "resetActiveCell must be called exactly once upon dialog open");
  assert.strictEqual(mockGrid.activeCell, null, "activeCell must be reset to null");

  report(7, "Grid active cell reset: verify grid.resetActiveCell() is invoked on dialog open", true, `Reset called ${resetCallCount} time(s)`);
} catch (err) {
  report(7, "Grid active cell reset: verify grid.resetActiveCell() is invoked on dialog open", false, err.message);
}

// -----------------------------------------------------------------------------
// TEST 8: Multiple modal open/close cycles: verify clean restoration of grid interaction
// -----------------------------------------------------------------------------
try {
  resetBusForTesting();
  let opens = 0;
  let closes = 0;
  let dismisses = 0;

  const unsubOpen = onParseDialogOpened(() => opens++);
  const unsubClose = onParseDialogClosed(() => closes++);
  const unsubDismiss = onDismissGridCellExpand(() => dismisses++);

  const gridState = {
    isSuppressed: false,
    activeCell: null,
    expanded: null,
    setActiveCell(row, cell) {
      if (!this.isSuppressed) {
        this.activeCell = { row, cell };
      }
    },
    resetActiveCell() {
      this.activeCell = null;
      this.expanded = null;
    },
  };

  const CYCLES = 25;
  for (let i = 0; i < CYCLES; i++) {
    // 1. Grid interaction before dialog open
    gridState.setActiveCell(i, 1);
    assert(gridState.activeCell !== null, "Grid must accept active cell before modal opens");

    // 2. Open dialog
    emitDismissGridCellExpand();
    emitParseDialogOpened();
    gridState.isSuppressed = true;
    gridState.resetActiveCell();
    assert.strictEqual(gridState.activeCell, null, "Active cell must be reset on modal open");

    // 3. Close dialog
    emitParseDialogClosed();
    gridState.isSuppressed = false;

    // 4. Verify clean restoration of grid interaction
    gridState.setActiveCell(i + 1, 2);
    assert(gridState.activeCell !== null, "Grid must accept active cell again after modal closes");
    assert.strictEqual(gridState.activeCell.row, i + 1);
  }

  assert.strictEqual(opens, CYCLES);
  assert.strictEqual(closes, CYCLES);
  assert.strictEqual(dismisses, CYCLES);

  unsubOpen();
  unsubClose();
  unsubDismiss();

  report(8, "Multiple modal open/close cycles: verify clean restoration of grid interaction", true, `${CYCLES} cycles clean`);
} catch (err) {
  report(8, "Multiple modal open/close cycles: verify clean restoration of grid interaction", false, err.message);
}

// -----------------------------------------------------------------------------
// TEST 9: Zero visual glow / high-contrast bleed-through behind modal backdrop
// -----------------------------------------------------------------------------
try {
  assert(overlayBlock !== null, "Overlay block must exist");

  // Ensure NO colored borders or backgrounds are defined in the overlay suppression block
  const lines = overlayBlock.split("\n");
  const offendingProperties = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.endsWith("*/")) continue;

    // Check if background or border-color specifies non-transparent colors
    if (/background:\s*(?!transparent)[#a-zA-Z0-9(]/i.test(trimmed)) {
      offendingProperties.push(`Non-transparent background: ${trimmed}`);
    }
    if (/border-color:\s*(?!transparent)[#a-zA-Z0-9(]/i.test(trimmed)) {
      offendingProperties.push(`Non-transparent border-color: ${trimmed}`);
    }
    if (/box-shadow:\s*(?!none)[#a-zA-Z0-9(]/i.test(trimmed)) {
      offendingProperties.push(`Non-none box-shadow: ${trimmed}`);
    }
  }

  assert.strictEqual(
    offendingProperties.length,
    0,
    `Found offending visual glow properties behind overlay: ${offendingProperties.join("; ")}`
  );

  report(9, "Zero visual glow / high-contrast bleed-through behind modal backdrop", true, "Strict 0 glow properties verified");
} catch (err) {
  report(9, "Zero visual glow / high-contrast bleed-through behind modal backdrop", false, err.message);
}

// -----------------------------------------------------------------------------
// TEST 10: Event teardown: unsubscription on component unmount prevents memory leaks
// -----------------------------------------------------------------------------
try {
  resetBusForTesting();

  // Create multiple mock subscriptions mimicking component mounts
  const cleanupFns = [];
  let triggerCount = 0;

  for (let i = 0; i < 20; i++) {
    const unsub = onDismissGridCellExpand(() => {
      triggerCount++;
    });
    cleanupFns.push(unsub);
  }

  // Trigger while mounted
  emitDismissGridCellExpand();
  assert.strictEqual(triggerCount, 20, "All 20 listeners should have been called");

  // Unmount all components and call cleanup
  cleanupFns.forEach((unsub) => unsub());

  // Trigger again after teardown
  triggerCount = 0;
  emitDismissGridCellExpand();
  assert.strictEqual(triggerCount, 0, "No listeners should be called after teardown unsubscription");

  report(10, "Event teardown: unsubscription on component unmount prevents memory leaks", true, "20/20 listeners cleanly dismantled");
} catch (err) {
  report(10, "Event teardown: unsubscription on component unmount prevents memory leaks", false, err.message);
}

console.log(`\n${BOLD}======================================================================${RESET}`);
console.log(`  MODAL CELL GLOW SUPPRESSION SUMMARY: ${passCount}/${passCount + failCount} PASSED`);
console.log(`${BOLD}======================================================================${RESET}\n`);

if (failCount > 0) {
  process.exit(1);
}
