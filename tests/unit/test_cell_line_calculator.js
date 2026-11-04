/**
 * test_cell_line_calculator.js
 *
 * Squad 1 (Engineer E04): Core Engine Unit Test Specialist
 *
 * Comprehensive test suite for CellLineCalculator and GridOverlayBus:
 * - Line count calculation across boundaries (N = 1, 2, 3, 4, 5, 6, 100)
 * - Column width variations (narrow 45px to ultra-wide 1200px)
 * - Edge cases (empty string, null, undefined, numbers, timestamps, unicode)
 * - Multiline strings (LF \n, CRLF \r\n, consecutive blank lines)
 * - Long unbroken strings & JSON payloads
 * - Height & scroll state contract verification (N <= 1, 2 <= N <= 5, N > 5)
 * - GridOverlayBus typed event dispatch, subscription, and unsubscription
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Hook TypeScript compiler to require .ts files directly in Node.js
const ROOT_DIR = path.resolve(__dirname, "../..");
const ts = require(path.resolve(ROOT_DIR, "tad-master/node_modules/typescript"));

require.extensions[".ts"] = function (module, filename) {
  const content = fs.readFileSync(filename, "utf8");
  const result = ts.transpileModule(content, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    }
  });
  module._compile(result.outputText, filename);
};

const {
  CellLineCalculator,
  calculateLineCount,
  getHeightAndScrollState
} = require(path.resolve(
  ROOT_DIR,
  "tad-master/packages/toadviewer/src/utils/CellLineCalculator.ts"
));

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
  resetBusForTesting
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

function report(testNum, name, passed, detail) {
  if (passed) {
    passCount++;
    console.log(`  ${GREEN}✔ [PASS]${RESET} Test ${testNum}: ${name}${detail ? ` (${detail})` : ""}`);
  } else {
    failCount++;
    console.error(`  ${RED}✖ [FAIL]${RESET} Test ${testNum}: ${name}${detail ? ` (${detail})` : ""}`);
  }
}

console.log(`\n${BOLD}${CYAN}================================================================${RESET}`);
console.log(`${BOLD}${CYAN}  Squad 1: CellLineCalculator & GridOverlayBus Test Suite (25 Tests)${RESET}`);
console.log(`${BOLD}${CYAN}================================================================${RESET}\n`);

// -----------------------------------------------------------------------------
// Test 1: Boundary N = 1 (Short single-line text fits without wrapping)
// -----------------------------------------------------------------------------
try {
  const n = calculateLineCount("Hello World", 200);
  assert.strictEqual(n, 1, `Expected N=1, got ${n}`);
  report(1, "Boundary N=1: Short single-line text fits in standard column", true, `N=${n}`);
} catch (e) {
  report(1, "Boundary N=1: Short single-line text fits in standard column", false, e.message);
}

// -----------------------------------------------------------------------------
// Test 2: Boundary N = 2 (Exact two-line wrapping)
// -----------------------------------------------------------------------------
try {
  // With charWidth = 10, padding = 0, colWidth = 100 -> maxCharsPerLine = 10
  // "1234567890 1234567890" -> word 1 (10 chars), word 2 (10 chars) -> exactly 2 lines
  const n = calculateLineCount("1234567890 1234567890", 100, { charWidth: 10, padding: 0 });
  assert.strictEqual(n, 2, `Expected N=2, got ${n}`);
  report(2, "Boundary N=2: Text wraps into exactly two lines", true, `N=${n}`);
} catch (e) {
  report(2, "Boundary N=2: Text wraps into exactly two lines", false, e.message);
}

// -----------------------------------------------------------------------------
// Test 3: Boundary N = 3 (Exact three-line wrapping)
// -----------------------------------------------------------------------------
try {
  const n = calculateLineCount("Line One\nLine Two\nLine Three", 200);
  assert.strictEqual(n, 3, `Expected N=3, got ${n}`);
  report(3, "Boundary N=3: Three explicit newline segments yield N=3", true, `N=${n}`);
} catch (e) {
  report(3, "Boundary N=3: Three explicit newline segments yield N=3", false, e.message);
}

// -----------------------------------------------------------------------------
// Test 4: Boundary N = 4 (Exact four-line wrapping)
// -----------------------------------------------------------------------------
try {
  const n = calculateLineCount("Alpha\nBeta\nGamma\nDelta", 200);
  assert.strictEqual(n, 4, `Expected N=4, got ${n}`);
  report(4, "Boundary N=4: Four explicit segments yield N=4", true, `N=${n}`);
} catch (e) {
  report(4, "Boundary N=4: Four explicit segments yield N=4", false, e.message);
}

// -----------------------------------------------------------------------------
// Test 5: Boundary N = 5 (Upper boundary for exact fit without scrollbar)
// -----------------------------------------------------------------------------
try {
  const n = calculateLineCount("Row 1\nRow 2\nRow 3\nRow 4\nRow 5", 200);
  assert.strictEqual(n, 5, `Expected N=5, got ${n}`);
  report(5, "Boundary N=5: Upper boundary for exact fit yields N=5", true, `N=${n}`);
} catch (e) {
  report(5, "Boundary N=5: Upper boundary for exact fit yields N=5", false, e.message);
}

// -----------------------------------------------------------------------------
// Test 6: Boundary N = 6 (First line count triggering scrollbar requirement)
// -----------------------------------------------------------------------------
try {
  const n = calculateLineCount("Item 1\nItem 2\nItem 3\nItem 4\nItem 5\nItem 6", 200);
  assert.strictEqual(n, 6, `Expected N=6, got ${n}`);
  report(6, "Boundary N=6: Threshold triggering scrollbar yields N=6", true, `N=${n}`);
} catch (e) {
  report(6, "Boundary N=6: Threshold triggering scrollbar yields N=6", false, e.message);
}

// -----------------------------------------------------------------------------
// Test 7: Boundary N = 100 (Large text payload scaling)
// -----------------------------------------------------------------------------
try {
  const hundredLines = Array.from({ length: 100 }, (_, i) => `record_entry_${i + 1}`).join("\n");
  const n = calculateLineCount(hundredLines, 400);
  assert.strictEqual(n, 100, `Expected N=100, got ${n}`);
  report(7, "Boundary N=100: Large multiline string yields exact N=100", true, `N=${n}`);
} catch (e) {
  report(7, "Boundary N=100: Large multiline string yields exact N=100", false, e.message);
}

// -----------------------------------------------------------------------------
// Test 8: Column width narrow boundary (45px minimum sidebar width)
// -----------------------------------------------------------------------------
try {
  // At 45px width, effective width is clamped to Math.max(20, 45 - 12) = 33px
  const n = calculateLineCount("Quick brown fox jumps", 45);
  assert.ok(n >= 3, `Expected N >= 3 in narrow 45px column, got ${n}`);
  assert.strictEqual(typeof n, "number");
  assert.ok(Number.isInteger(n));
  report(8, "Column width narrow boundary (45px): Clamps to min width without error", true, `N=${n}`);
} catch (e) {
  report(8, "Column width narrow boundary (45px): Clamps to min width without error", false, e.message);
}

// -----------------------------------------------------------------------------
// Test 9: Column width medium boundary (140px default filename column)
// -----------------------------------------------------------------------------
try {
  const text = "database_migration_v2_duckdb_schema.parquet";
  const n = calculateLineCount(text, 140);
  assert.ok(n >= 2, `Expected N >= 2 for long filename in 140px, got ${n}`);
  report(9, "Column width medium boundary (140px): Standard column wraps properly", true, `N=${n}`);
} catch (e) {
  report(9, "Column width medium boundary (140px): Standard column wraps properly", false, e.message);
}

// -----------------------------------------------------------------------------
// Test 10: Column width wide boundary (400px vs 140px monotonicity)
// -----------------------------------------------------------------------------
try {
  const text = "A moderately long sentence demonstrating that wider columns result in fewer visual lines.";
  const nNarrow = calculateLineCount(text, 140);
  const nWide = calculateLineCount(text, 400);
  assert.ok(nWide < nNarrow, `Expected nWide (${nWide}) < nNarrow (${nNarrow})`);
  assert.ok(nWide >= 1);
  report(10, "Column width wide boundary (400px): Wider column yields fewer lines", true, `140px: ${nNarrow} lines, 400px: ${nWide} lines`);
} catch (e) {
  report(10, "Column width wide boundary (400px): Wider column yields fewer lines", false, e.message);
}

// -----------------------------------------------------------------------------
// Test 11: Column width ultra-wide boundary (1200px)
// -----------------------------------------------------------------------------
try {
  const text = "Even a very long descriptive paragraph fits on a single visual line when column width is 1200px.";
  const n = calculateLineCount(text, 1200);
  assert.strictEqual(n, 1, `Expected N=1 for 1200px width, got ${n}`);
  report(11, "Column width ultra-wide boundary (1200px): Fits on 1 line", true, `N=${n}`);
} catch (e) {
  report(11, "Column width ultra-wide boundary (1200px): Fits on 1 line", false, e.message);
}

// -----------------------------------------------------------------------------
// Test 12: Edge case: Empty string ""
// -----------------------------------------------------------------------------
try {
  const n = calculateLineCount("", 100);
  assert.strictEqual(n, 1, `Expected N=1 for empty string, got ${n}`);
  report(12, "Edge case: Empty string evaluates to N=1", true, `N=${n}`);
} catch (e) {
  report(12, "Edge case: Empty string evaluates to N=1", false, e.message);
}

// -----------------------------------------------------------------------------
// Test 13: Edge case: null and undefined
// -----------------------------------------------------------------------------
try {
  const nNull = calculateLineCount(null, 100);
  const nUndef = calculateLineCount(undefined, 100);
  assert.strictEqual(nNull, 1, `Expected N=1 for null, got ${nNull}`);
  assert.strictEqual(nUndef, 1, `Expected N=1 for undefined, got ${nUndef}`);
  report(13, "Edge case: null and undefined evaluate to N=1", true, `null: ${nNull}, undefined: ${nUndef}`);
} catch (e) {
  report(13, "Edge case: null and undefined evaluate to N=1", false, e.message);
}

// -----------------------------------------------------------------------------
// Test 14: Edge case: Numeric inputs (0, positive, negative, float)
// -----------------------------------------------------------------------------
try {
  const nZero = calculateLineCount(0, 100);
  const nBigInt = calculateLineCount(9876543210, 100);
  const nFloat = calculateLineCount(-123.4567, 100);
  assert.strictEqual(nZero, 1);
  assert.strictEqual(nBigInt, 1);
  assert.strictEqual(nFloat, 1);
  report(14, "Edge case: Numeric inputs (0, integers, floats) evaluate correctly", true, `0: ${nZero}, int: ${nBigInt}, float: ${nFloat}`);
} catch (e) {
  report(14, "Edge case: Numeric inputs (0, integers, floats) evaluate correctly", false, e.message);
}

// -----------------------------------------------------------------------------
// Test 15: Edge case: Boolean and ISO 8601 timestamps
// -----------------------------------------------------------------------------
try {
  const nTrue = calculateLineCount(true, 100);
  const nFalse = calculateLineCount(false, 100);
  const nTs = calculateLineCount("2026-11-04T18:00:00.000Z", 250);
  assert.strictEqual(nTrue, 1);
  assert.strictEqual(nFalse, 1);
  assert.strictEqual(nTs, 1);
  report(15, "Edge case: Boolean and ISO 8601 timestamps evaluate properly", true, `true: ${nTrue}, ts: ${nTs}`);
} catch (e) {
  report(15, "Edge case: Boolean and ISO 8601 timestamps evaluate properly", false, e.message);
}

// -----------------------------------------------------------------------------
// Test 16: Explicit LF newlines (\n)
// -----------------------------------------------------------------------------
try {
  const n = calculateLineCount("Header\nBody Paragraph\nFooter", 300);
  assert.strictEqual(n, 3, `Expected N=3, got ${n}`);
  report(16, "Explicit LF newlines: Correctly counts segments", true, `N=${n}`);
} catch (e) {
  report(16, "Explicit LF newlines: Correctly counts segments", false, e.message);
}

// -----------------------------------------------------------------------------
// Test 17: Explicit Windows CRLF newlines (\r\n)
// -----------------------------------------------------------------------------
try {
  const n = calculateLineCount("WindowsLine1\r\nWindowsLine2\r\nWindowsLine3\r\nWindowsLine4", 300);
  assert.strictEqual(n, 4, `Expected N=4, got ${n}`);
  report(17, "Explicit CRLF newlines: Correctly parses Windows-style line breaks", true, `N=${n}`);
} catch (e) {
  report(17, "Explicit CRLF newlines: Correctly parses Windows-style line breaks", false, e.message);
}

// -----------------------------------------------------------------------------
// Test 18: Multiline string with consecutive empty lines
// -----------------------------------------------------------------------------
try {
  // "First\n\n\nLast" has 4 lines (First, empty, empty, Last)
  const n = calculateLineCount("First\n\n\nLast", 300);
  assert.strictEqual(n, 4, `Expected N=4 for blank lines preservation, got ${n}`);
  report(18, "Consecutive empty lines: Preserves blank lines in line count", true, `N=${n}`);
} catch (e) {
  report(18, "Consecutive empty lines: Preserves blank lines in line count", false, e.message);
}

// -----------------------------------------------------------------------------
// Test 19: Long unbroken string / hash (no whitespace, no infinite loop)
// -----------------------------------------------------------------------------
try {
  const hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"; // 64 chars
  // At colWidth 100, padding 0, charWidth 10 -> maxCharsPerLine = 10 -> ceil(64/10) = 7 lines
  const n = calculateLineCount(hash, 100, { charWidth: 10, padding: 0 });
  assert.strictEqual(n, 7, `Expected N=7 for 64-char unbroken hash, got ${n}`);
  report(19, "Unbroken long string / hash: Wraps without infinite loop", true, `N=${n}`);
} catch (e) {
  report(19, "Unbroken long string / hash: Wraps without infinite loop", false, e.message);
}

// -----------------------------------------------------------------------------
// Test 20: Complex nested JSON string payload
// -----------------------------------------------------------------------------
try {
  const payload = JSON.stringify({
    event_id: 93937,
    provider: "Microsoft-Windows-Security-Auditing",
    data: {
      subject_user_sid: "S-1-5-18",
      target_user_name: "SYSTEM",
      logon_type: 5
    }
  });
  const n = calculateLineCount(payload, 120);
  assert.ok(n >= 3, `Expected N >= 3 for JSON in 120px column, got ${n}`);
  report(20, "Nested JSON string: Accurately wraps serialized JSON payload", true, `N=${n}`);
} catch (e) {
  report(20, "Nested JSON string: Accurately wraps serialized JSON payload", false, e.message);
}

// -----------------------------------------------------------------------------
// Test 21: Unicode and special characters (Vietnamese diacritics & symbols)
// -----------------------------------------------------------------------------
try {
  const unicodeText = "Thử nghiệm thuật toán tính dòng thông minh ToadViewer v2.5.1";
  const n = calculateLineCount(unicodeText, 150);
  assert.ok(n >= 2, `Expected N >= 2 for Vietnamese sentence in 150px, got ${n}`);
  report(21, "Unicode text: Handles multibyte diacritics and symbols gracefully", true, `N=${n}`);
} catch (e) {
  report(21, "Unicode text: Handles multibyte diacritics and symbols gracefully", false, e.message);
}

// -----------------------------------------------------------------------------
// Test 22: getHeightAndScrollState contract for N <= 1 (Flat compact state)
// -----------------------------------------------------------------------------
try {
  const state0 = getHeightAndScrollState(0);
  const state1 = getHeightAndScrollState(1);
  const stateCustom = getHeightAndScrollState(1, 17, 8, 25);

  assert.strictEqual(state1.shouldExpand, false);
  assert.strictEqual(state1.lineCount, 1);
  assert.strictEqual(state1.height, 24);
  assert.strictEqual(state1.overflowY, "hidden");
  assert.strictEqual(state1.hasScrollbar, false);

  assert.strictEqual(state0.shouldExpand, false);
  assert.strictEqual(state0.height, 24);

  assert.strictEqual(stateCustom.height, 25, "Custom defaultHeight (25px) respected");
  report(22, "getHeightAndScrollState (N <= 1): Returns flat single-line contract", true, `height=${state1.height}px, overflowY=${state1.overflowY}, hasScrollbar=${state1.hasScrollbar}`);
} catch (e) {
  report(22, "getHeightAndScrollState (N <= 1): Returns flat single-line contract", false, e.message);
}

// -----------------------------------------------------------------------------
// Test 23: getHeightAndScrollState contract for 2 <= N <= 5 (Exact fit, no scrollbar)
// -----------------------------------------------------------------------------
try {
  const s2 = getHeightAndScrollState(2);
  const s3 = getHeightAndScrollState(3);
  const s4 = getHeightAndScrollState(4);
  const s5 = getHeightAndScrollState(5);

  // Exact formula: N * 17 + 8
  assert.strictEqual(s2.shouldExpand, true);
  assert.strictEqual(s2.height, 2 * 17 + 8); // 42px
  assert.strictEqual(s2.overflowY, "hidden");
  assert.strictEqual(s2.hasScrollbar, false);

  assert.strictEqual(s3.shouldExpand, true);
  assert.strictEqual(s3.height, 3 * 17 + 8); // 59px
  assert.strictEqual(s3.overflowY, "hidden");
  assert.strictEqual(s3.hasScrollbar, false);

  assert.strictEqual(s4.shouldExpand, true);
  assert.strictEqual(s4.height, 4 * 17 + 8); // 76px
  assert.strictEqual(s4.overflowY, "hidden");
  assert.strictEqual(s4.hasScrollbar, false);

  assert.strictEqual(s5.shouldExpand, true);
  assert.strictEqual(s5.height, 5 * 17 + 8); // 93px
  assert.strictEqual(s5.overflowY, "hidden");
  assert.strictEqual(s5.hasScrollbar, false);

  report(23, "getHeightAndScrollState (2 <= N <= 5): Exact fit without scrollbar", true, `H2=42px, H3=59px, H4=76px, H5=93px`);
} catch (e) {
  report(23, "getHeightAndScrollState (2 <= N <= 5): Exact fit without scrollbar", false, e.message);
}

// -----------------------------------------------------------------------------
// Test 24: getHeightAndScrollState contract for N > 5 (Capped at 93px with scrollbar)
// -----------------------------------------------------------------------------
try {
  const s6 = getHeightAndScrollState(6);
  const s100 = getHeightAndScrollState(100);

  // Capped formula: 5 * 17 + 8 = 93px
  assert.strictEqual(s6.shouldExpand, true);
  assert.strictEqual(s6.height, 93);
  assert.strictEqual(s6.overflowY, "auto");
  assert.strictEqual(s6.hasScrollbar, true);

  assert.strictEqual(s100.shouldExpand, true);
  assert.strictEqual(s100.height, 93);
  assert.strictEqual(s100.overflowY, "auto");
  assert.strictEqual(s100.hasScrollbar, true);

  report(24, "getHeightAndScrollState (N > 5): Capped at 93px with auto scrollbar", true, `H(N=6)=${s6.height}px, H(N=100)=${s100.height}px, overflowY=${s6.overflowY}`);
} catch (e) {
  report(24, "getHeightAndScrollState (N > 5): Capped at 93px with auto scrollbar", false, e.message);
}

// -----------------------------------------------------------------------------
// Test 25: GridOverlayBus typed dispatch, subscription, and unsubscription
// -----------------------------------------------------------------------------
try {
  resetBusForTesting();

  let dismissCallCount = 0;
  let dialogOpenCount = 0;
  let dialogCloseCount = 0;

  const unsubDismiss = onDismissGridCellExpand(() => {
    dismissCallCount++;
  });

  const unsubOpen = onParseDialogOpened(() => {
    dialogOpenCount++;
  });

  const unsubClose = onParseDialogClosed(() => {
    dialogCloseCount++;
  });

  // Emit events
  emitDismissGridCellExpand();
  emitParseDialogOpened();
  emitParseDialogClosed();

  assert.strictEqual(dismissCallCount, 1, "Dismiss handler invoked once");
  assert.strictEqual(dialogOpenCount, 1, "Dialog opened handler invoked once");
  assert.strictEqual(dialogCloseCount, 1, "Dialog closed handler invoked once");

  // Test unsubscription
  unsubDismiss();
  unsubOpen();
  unsubClose();

  // Re-emit - should not increment counts
  emitDismissGridCellExpand();
  emitParseDialogOpened();
  emitParseDialogClosed();

  assert.strictEqual(dismissCallCount, 1, "Dismiss handler not invoked after unsubscribe");
  assert.strictEqual(dialogOpenCount, 1, "Dialog opened handler not invoked after unsubscribe");
  assert.strictEqual(dialogCloseCount, 1, "Dialog closed handler not invoked after unsubscribe");

  report(25, "GridOverlayBus: Correctly handles emit, subscribe, and unsubscribe lifecycle", true, `events verified: ${EVENT_DISMISS_GRID_CELL_EXPAND}, ${EVENT_PARSE_DIALOG_OPENED}, ${EVENT_PARSE_DIALOG_CLOSED}`);
} catch (e) {
  report(25, "GridOverlayBus: Correctly handles emit, subscribe, and unsubscribe lifecycle", false, e.message);
}

// -----------------------------------------------------------------------------
// Test Summary
// -----------------------------------------------------------------------------
console.log(`\n${BOLD}${CYAN}----------------------------------------------------------------${RESET}`);
console.log(`  Tests Passed: ${GREEN}${passCount} / 25${RESET}`);
console.log(`  Tests Failed: ${failCount > 0 ? RED : GREEN}${failCount}${RESET}`);
console.log(`${BOLD}${CYAN}----------------------------------------------------------------${RESET}\n`);

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
