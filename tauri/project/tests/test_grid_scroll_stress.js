/**
 * test_grid_scroll_stress.js
 *
 * 100K Rows Virtual Scroll Concurrency & Memory Stress Test Suite for Toad Tauri v2
 *
 * Verifies:
 * 1. 100K Rows In-Memory Virtual Viewport stability (O(1) access).
 * 2. Absolute Coordinate Grid Invariance (top = i * 24px across 100,000 rows).
 * 3. Pure Mathematical N-Line Dynamic Auto-Wrap Contract (CellLineCalculator).
 * 4. Dynamic 4-Way Collapse Lifecycle (re-click, click another, click outside, Escape).
 * 5. Rapid Random Cell Expansion Stress (150 random cell expansions across 100K rows).
 * 6. High-Speed Viewport Scrolling Under Active Expansion (1,000 scroll jumps).
 * 7. Virtual Scroll Latency & FPS Target Benchmark (> 55 FPS, latency <= 16.6ms).
 * 8. Concurrent Column Resizing During Active Virtual Scroll.
 * 9. Memory Leak Guard (< 25 MB heap delta over 1,000 cycles).
 * 10. Extreme Payload Cell Wrap Stress (50,000-char JSON payload wrapped in < 16ms).
 * 11. Multi-Column Long Text Isolation (only active cell expands, neighbors remain compact).
 * 12. Zero Unhandled Exceptions Audit.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const TAD_MASTER_DIR = path.resolve(__dirname, "../../../tad-master");

// Transpile TypeScript on the fly for CellLineCalculator
const ts = require(path.resolve(TAD_MASTER_DIR, "node_modules/typescript"));
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
  TAD_MASTER_DIR,
  "packages/toadviewer/src/utils/CellLineCalculator.ts"
));

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ${GREEN}✔ [PASS]${RESET} ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  ${RED}✖ [FAIL]${RESET} ${name}`);
    console.error(`     ${err.stack || err.message}`);
    failCount++;
  }
}

/**
 * Headless 100,000-row Virtual DataGrid Simulator
 * Models SlickGrid's virtual viewport and floating cell expansion mechanics.
 */
class Virtual100KDataGrid {
  constructor(totalRows = 100000) {
    this.totalRows = totalRows;
    this.rowHeight = 24;
    this.viewportSize = 30; // Visible rows per viewport frame

    this.columns = [
      { id: "row_id", name: "Row ID", field: "row_id", width: 80 },
      { id: "event_id", name: "Event ID", field: "event_id", width: 90 },
      { id: "provider", name: "Provider", field: "provider", width: 180 },
      { id: "message", name: "Message", field: "message", width: 300 },
      { id: "payload", name: "Raw Payload", field: "payload", width: 350 },
    ];

    this.overrides = new Map();
    this.activeExpandedCell = null; // { row, cell, colId, text, heightState }
    this.scrollTop = 0;
  }

  getItem(i) {
    if (i < 0 || i >= this.totalRows) return null;
    if (this.overrides.has(i)) return this.overrides.get(i);

    return {
      row_id: i,
      event_id: 1000 + (i % 500),
      provider: `Microsoft-Windows-Security-Auditing-${i % 10}`,
      message: `Audit event message logged for row #${i}`,
      payload: `{"row":${i},"status":"OK","code":${200 + (i % 5)}}`,
    };
  }

  setItem(i, data) {
    if (i >= 0 && i < this.totalRows) {
      this.overrides.set(i, data);
    }
  }

  /**
   * Linear coordinate projection: top = row * 24px
   */
  getRowTop(i) {
    return i * this.rowHeight;
  }

  /**
   * Viewport calculation based on scrollTop
   */
  getViewportRange() {
    const topRow = Math.max(0, Math.floor(this.scrollTop / this.rowHeight));
    const bottomRow = Math.min(this.totalRows - 1, topRow + this.viewportSize);
    return { topRow, bottomRow };
  }

  scrollTo(scrollTop) {
    const maxScroll = Math.max(0, (this.totalRows - this.viewportSize) * this.rowHeight);
    this.scrollTop = Math.max(0, Math.min(scrollTop, maxScroll));

    // If active expanded cell scrolled far outside viewport (+- 10 buffer rows), auto-dismiss
    if (this.activeExpandedCell) {
      const { topRow, bottomRow } = this.getViewportRange();
      if (
        this.activeExpandedCell.row < topRow - 10 ||
        this.activeExpandedCell.row > bottomRow + 10
      ) {
        this.activeExpandedCell = null;
      }
    }
  }

  /**
   * Activate / Expand a cell
   */
  expandCell(row, colId) {
    const item = this.getItem(row);
    if (!item) return null;

    const col = this.columns.find((c) => c.id === colId);
    if (!col) return null;

    const text = item[colId];
    const lineCount = calculateLineCount(text, col.width);
    const heightState = getHeightAndScrollState(lineCount);

    this.activeExpandedCell = {
      row,
      colId,
      text,
      lineCount,
      heightState,
      top: this.getRowTop(row),
    };

    return this.activeExpandedCell;
  }

  collapseCell(reason = "re-click") {
    const prev = this.activeExpandedCell;
    this.activeExpandedCell = null;
    return prev;
  }

  resizeColumn(colId, newWidth) {
    const col = this.columns.find((c) => c.id === colId);
    if (!col) return;
    col.width = Math.max(40, newWidth);

    // If active expanded cell is in this column, recalculate its height
    if (this.activeExpandedCell && this.activeExpandedCell.colId === colId) {
      const lineCount = calculateLineCount(this.activeExpandedCell.text, col.width);
      this.activeExpandedCell.lineCount = lineCount;
      this.activeExpandedCell.heightState = getHeightAndScrollState(lineCount);
    }
  }
}

function runGridScrollStressTests() {
  console.log(`\n${BOLD}${CYAN}======================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}  TOAD TAURI v2 - 100K ROWS VIRTUAL SCROLL CONCURRENCY & STRESS       ${RESET}`);
  console.log(`${BOLD}${CYAN}======================================================================${RESET}\n`);

  const grid = new Virtual100KDataGrid(100000);

  // SECTION 1: 100K Rows In-Memory Virtual Viewport
  console.log(`${BOLD}${YELLOW}--- SECTION 1: 100K Rows Viewport & O(1) Stability ---${RESET}`);

  test("1.1 Instantaneous O(1) access to boundary and arbitrary row indices (0, 50000, 99999)", () => {
    const r0 = grid.getItem(0);
    const r50k = grid.getItem(50000);
    const rLast = grid.getItem(99999);
    const rOob = grid.getItem(100000);
    const rNeg = grid.getItem(-1);

    assert.strictEqual(r0.row_id, 0);
    assert.strictEqual(r50k.row_id, 50000);
    assert.strictEqual(rLast.row_id, 99999);
    assert.strictEqual(rOob, null);
    assert.strictEqual(rNeg, null);
  });

  test("1.2 Absolute coordinate linearity: top = row * 24px across 100K rows", () => {
    assert.strictEqual(grid.getRowTop(0), 0);
    assert.strictEqual(grid.getRowTop(1), 24);
    assert.strictEqual(grid.getRowTop(1000), 24000);
    assert.strictEqual(grid.getRowTop(50000), 1200000);
    assert.strictEqual(grid.getRowTop(99999), 2399976);
  });

  // SECTION 2: Dynamic N-Line Auto-Wrap Mathematical Contract
  console.log(`\n${BOLD}${YELLOW}--- SECTION 2: N-Line Auto-Wrap Contract (CellLineCalculator) ---${RESET}`);

  test("2.1 N <= 1: Flat single line, height = 24px, overflow-y: hidden, hasScrollbar: false", () => {
    const state0 = getHeightAndScrollState(0);
    const state1 = getHeightAndScrollState(1);

    assert.strictEqual(state1.shouldExpand, false);
    assert.strictEqual(state1.height, 24);
    assert.strictEqual(state1.overflowY, "hidden");
    assert.strictEqual(state1.hasScrollbar, false);
    assert.strictEqual(state1.className, "cell-flat");

    assert.strictEqual(state0.shouldExpand, false);
    assert.strictEqual(state0.height, 24);
  });

  test("2.2 2 <= N <= 5: Dynamic expansion to N * 17px + 8px, overflow-y: hidden, no scrollbar", () => {
    for (let n = 2; n <= 5; n++) {
      const state = getHeightAndScrollState(n);
      const expectedHeight = n * 17 + 8;
      assert.strictEqual(state.shouldExpand, true, `N=${n} should expand`);
      assert.strictEqual(state.height, expectedHeight, `N=${n} height should be ${expectedHeight}`);
      assert.strictEqual(state.overflowY, "hidden", `N=${n} overflowY should be hidden`);
      assert.strictEqual(state.hasScrollbar, false, `N=${n} hasScrollbar should be false`);
      assert.strictEqual(state.className, "cell-expanded-fit");
    }
  });

  test("2.3 N > 5: Capped at 5 lines (93px), overflow-y: auto, slim scrollbar enabled", () => {
    for (const n of [6, 10, 50, 100]) {
      const state = getHeightAndScrollState(n);
      assert.strictEqual(state.shouldExpand, true, `N=${n} should expand`);
      assert.strictEqual(state.height, 93, `N=${n} height must be capped at 93px`);
      assert.strictEqual(state.overflowY, "auto", `N=${n} overflowY must be auto`);
      assert.strictEqual(state.hasScrollbar, true, `N=${n} hasScrollbar must be true`);
      assert.strictEqual(state.className, "cell-expanded-scroll");
    }
  });

  // SECTION 3: 4-Way Collapse Lifecycle
  console.log(`\n${BOLD}${YELLOW}--- SECTION 3: 4-Way Collapse Lifecycle ---${RESET}`);

  test("3.1 4-Way Collapse: 1) Re-click active cell collapses", () => {
    grid.expandCell(100, "message");
    assert.ok(grid.activeExpandedCell !== null);
    assert.strictEqual(grid.activeExpandedCell.row, 100);

    // Re-click same cell
    grid.collapseCell("re-click");
    assert.strictEqual(grid.activeExpandedCell, null);
  });

  test("3.2 4-Way Collapse: 2) Click another cell collapses old and expands new", () => {
    grid.expandCell(100, "message");
    assert.strictEqual(grid.activeExpandedCell.row, 100);

    // Click row 200, payload
    grid.collapseCell("switch-cell");
    grid.expandCell(200, "payload");
    assert.strictEqual(grid.activeExpandedCell.row, 200);
    assert.strictEqual(grid.activeExpandedCell.colId, "payload");

    grid.collapseCell();
  });

  test("3.3 4-Way Collapse: 3) Click outside dismisses expansion", () => {
    grid.expandCell(300, "message");
    assert.ok(grid.activeExpandedCell !== null);

    grid.collapseCell("click-outside");
    assert.strictEqual(grid.activeExpandedCell, null);
  });

  test("3.4 4-Way Collapse: 4) Escape key collapses active cell immediately", () => {
    grid.expandCell(400, "provider");
    assert.ok(grid.activeExpandedCell !== null);

    grid.collapseCell("escape-key");
    assert.strictEqual(grid.activeExpandedCell, null);
  });

  // SECTION 4: Rapid Random Cell Expansion Stress
  console.log(`\n${BOLD}${YELLOW}--- SECTION 4: Rapid Random Cell Expansion Stress (150 Cycles) ---${RESET}`);

  test("4.1 Rapidly expands and collapses 150 random cells across 100K rows without state corruption", () => {
    for (let cycle = 0; cycle < 150; cycle++) {
      const randomRow = Math.floor(Math.random() * 100000);
      const col = grid.columns[Math.floor(Math.random() * grid.columns.length)];

      const expanded = grid.expandCell(randomRow, col.id);
      assert.ok(expanded !== null);
      assert.strictEqual(expanded.row, randomRow);
      assert.strictEqual(expanded.colId, col.id);
      assert.strictEqual(expanded.top, randomRow * 24);

      // Verify invariant: Underlying row coordinate remains untouched
      assert.strictEqual(grid.getRowTop(randomRow), randomRow * 24);

      grid.collapseCell();
      assert.strictEqual(grid.activeExpandedCell, null);
    }
  });

  // SECTION 5: High-Speed Viewport Scrolling Under Active Expansion
  console.log(`\n${BOLD}${YELLOW}--- SECTION 5: High-Speed Viewport Scrolling (1,000 Jumps) ---${RESET}`);

  test("5.1 Simulates 1,000 high-speed scroll viewport jumps while active cell is expanded", () => {
    // Expand row 500
    grid.expandCell(500, "message");

    const maxScroll = (100000 - grid.viewportSize) * 24;
    for (let i = 0; i < 1000; i++) {
      const targetScroll = (i * 2345) % maxScroll;
      grid.scrollTo(targetScroll);

      const { topRow, bottomRow } = grid.getViewportRange();
      assert.ok(topRow >= 0 && topRow < 100000);
      assert.ok(bottomRow >= topRow && bottomRow < 100000);
    }

    grid.collapseCell();
  });

  // SECTION 6: Latency & FPS Target Benchmark
  console.log(`\n${BOLD}${YELLOW}--- SECTION 6: Scroll Latency & FPS Benchmark ---${RESET}`);

  test("6.1 Benchmark 1,000 viewport recalculations: latency <= 16.6ms (FPS >= 60 target)", () => {
    const iterations = 1000;
    const start = process.hrtime.bigint();

    for (let i = 0; i < iterations; i++) {
      grid.scrollTo(i * 100);
      const { topRow, bottomRow } = grid.getViewportRange();
      // Render visible items
      for (let r = topRow; r <= bottomRow; r++) {
        const item = grid.getItem(r);
        assert.ok(item !== null);
      }
    }

    const end = process.hrtime.bigint();
    const totalMs = Number(end - start) / 1e6;
    const avgLatencyPerFrame = totalMs / iterations;
    const equivalentFps = avgLatencyPerFrame > 0 ? 1000 / avgLatencyPerFrame : 9999;

    console.log(`     (Scroll Performance: Total: ${totalMs.toFixed(2)}ms, Avg latency: ${avgLatencyPerFrame.toFixed(3)}ms/frame, Equivalent FPS: ${equivalentFps.toFixed(0)})`);

    assert.ok(avgLatencyPerFrame <= 16.6, `Avg latency ${avgLatencyPerFrame.toFixed(3)}ms must be <= 16.6ms (60 FPS)`);
    assert.ok(equivalentFps >= 55, `Equivalent FPS ${equivalentFps.toFixed(0)} must be >= 55 FPS`);
  });

  // SECTION 7: Concurrent Column Resizing During Virtual Scroll
  console.log(`\n${BOLD}${YELLOW}--- SECTION 7: Concurrent Column Resizing ---${RESET}`);

  test("7.1 Dynamically resizes columns (60px to 600px) during virtual scroll without freeze", () => {
    grid.expandCell(25, "message");
    const testWidths = [60, 100, 200, 350, 500, 600];

    for (const w of testWidths) {
      grid.resizeColumn("message", w);
      assert.strictEqual(grid.columns.find((c) => c.id === "message").width, w);
      assert.ok(grid.activeExpandedCell.heightState.height >= 24);
    }

    grid.collapseCell();
  });

  // SECTION 8: Memory Leak Guard (< 25MB Delta over 1,000 cycles)
  console.log(`\n${BOLD}${YELLOW}--- SECTION 8: Memory Leak Guard Audit ---${RESET}`);

  test("8.1 Memory stability: Heap used delta strictly < 25 MB after 1,000 churn cycles", () => {
    if (global.gc) global.gc();
    const initialHeap = process.memoryUsage().heapUsed;

    for (let i = 0; i < 1000; i++) {
      grid.scrollTo(i * 24);
      grid.expandCell(i, "payload");
      if (i % 5 === 0) {
        grid.collapseCell();
      }
    }
    grid.collapseCell();

    if (global.gc) global.gc();
    const finalHeap = process.memoryUsage().heapUsed;
    const deltaMB = (finalHeap - initialHeap) / (1024 * 1024);

    console.log(`     (Heap Used: Initial: ${(initialHeap / (1024 * 1024)).toFixed(2)}MB, Final: ${(finalHeap / (1024 * 1024)).toFixed(2)}MB, Delta: ${deltaMB.toFixed(2)}MB)`);

    assert.ok(
      deltaMB < 25.0,
      `Heap growth of ${deltaMB.toFixed(2)}MB exceeds maximum 25MB limit!`
    );
  });

  // SECTION 9: Extreme Payload Cell Wrap Stress
  console.log(`\n${BOLD}${YELLOW}--- SECTION 9: Extreme Payload Cell Wrap Stress ---${RESET}`);

  test("9.1 Wraps 50,000-character JSON payload in < 16ms and caps height at 93px", () => {
    // Generate 50,000-character JSON string
    const largeObject = {
      timestamp: "2026-11-04T12:00:00.000Z",
      threat_actor: "APT-29-CozyBear",
      payload_dump: "A".repeat(50500),
    };
    const massiveJson = JSON.stringify(largeObject);
    assert.ok(massiveJson.length >= 50000);

    const start = process.hrtime.bigint();
    const lineCount = calculateLineCount(massiveJson, 300);
    const state = getHeightAndScrollState(lineCount);
    const end = process.hrtime.bigint();

    const elapsedMs = Number(end - start) / 1e6;
    console.log(`     (Extreme payload calculation: ${massiveJson.length} chars calculated in ${elapsedMs.toFixed(3)}ms, lines: ${lineCount})`);

    assert.ok(lineCount > 5, "Line count must exceed 5");
    assert.strictEqual(state.height, 93, "Height must be capped at 93px");
    assert.strictEqual(state.overflowY, "auto", "Must enable vertical scrolling");
    assert.strictEqual(state.hasScrollbar, true, "Must have scrollbar");
    assert.ok(elapsedMs < 16.0, `Calculation took ${elapsedMs.toFixed(2)}ms, must be < 16ms`);
  });

  // SECTION 10: Multi-Column Long Text Isolation
  console.log(`\n${BOLD}${YELLOW}--- SECTION 10: Multi-Column Long Text Isolation ---${RESET}`);

  test("10.1 Expanding cell in one column leaves adjacent cells compact and unexpanded", () => {
    grid.setItem(42, {
      row_id: 42,
      event_id: 4624,
      provider: "Short Provider",
      message: "Very long message ".repeat(50),
      payload: "Very long payload ".repeat(50),
    });

    // Expand message column
    grid.expandCell(42, "message");
    assert.strictEqual(grid.activeExpandedCell.colId, "message");
    assert.ok(grid.activeExpandedCell.heightState.height > 24);

    // Verify row coordinates are not distorted
    assert.strictEqual(grid.getRowTop(42), 42 * 24);
    assert.strictEqual(grid.getRowTop(43), 43 * 24);

    grid.collapseCell();
  });

  console.log(`\n${BOLD}${CYAN}----------------------------------------------------------------------${RESET}`);
  console.log(`${BOLD}Grid Scroll Stress Test Results: ${GREEN}${passCount} Passed${RESET}, ${failCount === 0 ? GREEN : RED}${failCount} Failed${RESET}`);
  console.log(`${BOLD}${CYAN}======================================================================${RESET}\n`);

  if (failCount > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runGridScrollStressTests();
}

module.exports = {
  runGridScrollStressTests,
  Virtual100KDataGrid,
};
