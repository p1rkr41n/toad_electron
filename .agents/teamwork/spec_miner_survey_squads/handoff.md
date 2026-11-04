# Handoff Report: Specification Mining Survey Squads

**Date**: 2026-11-04T18:05:00Z  
**Agent**: `teamwork_spec_miner`  
**Working Directory**: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\spec_miner_survey_squads\`  
**Target Milestone**: 5-Squad 20-Engineer Intelligent Wrap, Parse Dialog Refactor & Modal Glow Suppression  
**Handoff Type**: Hard (Task Complete)

---

## 1. Observation

Direct evidence observed from the authoritative specification and codebase:

1. **`ORIGINAL_REQUEST.md` (lines 14-54)**:
   - "R1. Intelligent Line Calculation & Dynamic Auto-Wrap across All 3 Tables... N <= 1 line: Flat single-line, NO expansion, NO elevation, default height (24px-25px), no scrollbar. 2 <= N <= 5 lines: Expand to fit exactly N lines (height = N * 17px + 8px), NO scrollbar (overflow-y: hidden). N > 5 lines: Capped height at exactly 5 lines (approx 93-95px), enable slim 4px vertical scrollbar (overflow-y: auto). 4-way collapse lifecycle: re-click active cell, click another cell, click outside, or press Escape."
   - "R2. Parse Columns Header & Format Dropdown Refactor... In RegexDialog.tsx: Remove #ntab-nested from header mode switcher. Top tabs strictly only: [Visual] and [Regex]. In minFormatSelect dropdown: add <option value="nested_json">Nested JSON</option>. Remove redundant button #btn-switch-nested. When nested_json selected: trigger scan triggerNestedScan(100) if empty... Update handleApply to support both formatType === 'nested_json' and mode === 'nested_json'."
   - "R3. Active Cell Highlight Suppression behind Modal Overlays... When dialog opens (isOpen === true), dispatch 'dismiss-grid-cell-expand', dismiss floating cell nodes... call grid.resetActiveCell(). When body.bp4-overlay-open is active, suppress .slick-cell.active, .slick-row.active, .slick-cell.selected... Coordinate cross-component overlay events via GridOverlayBus.ts."
   - "R4. Automated Unit & Stress Test Suites... test_cell_line_calculator.js (25 tests), test_parse_dialog_nested_dropdown.js (15 tests), test_modal_cell_glow_suppression.js (10 tests)... target 575+ tests."

2. **`tad-master/packages/toadviewer/src/utils/CellLineCalculator.ts`**:
   - File exists at `d:\Shared_UserData\Downloads\tad\tad-master\packages\toadviewer\src\utils\CellLineCalculator.ts` but is currently 0 bytes (empty).

3. **`tad-master/packages/toadviewer/src/utils/GridOverlayBus.ts`**:
   - Does not yet exist in the codebase; will be created by Squad 1 / E03.

4. **`tad-master/packages/toadviewer/src/components/ProjectFilesTable.tsx` (lines 667-775)**:
   - Row rendering currently sets `className={\`file-table-row \${isSelected ? "is-selected" : ""}\`}` without computing line counts or distinguishing `is-expanded`.
   - `sidebar.less` (lines 1141-1175) forces `height: auto !important; max-height: 180px; overflow-y: auto;` on all `.is-selected` rows.

5. **`tad-master/packages/toadviewer/src/components/DataGrid.tsx` (lines 605-654 & 880-940)**:
   - `tryExpandCell` checks only `cellNode.scrollWidth > cellNode.clientWidth || textLen > 28` and applies `.slick-cell-active-expanded` without line calculation or height bounding.
   - `window.addEventListener("keydown", handleGridEscape)` handles Escape, but `dismiss-grid-cell-expand` and outside click listeners are absent.
   - `slickgrid.scss` (lines 116-120) forces `max-height: 180px !important; overflow-y: auto !important;` on all `.slick-cell-active-expanded`.

6. **`tad-master/packages/toadviewer/src/components/RegexDialog.tsx` (lines 1504-1589 & 1753-1787)**:
   - Header switcher contains 3 buttons: `#ntab-simple` (Visual), `#ntab-nested` (Nested JSON), `#ntab-adv` (Regex).
   - Dropdown `#minFormatSelect` contains `kv`, `json`, `space`, `raw`, `csv`, `arr` but lacks `nested_json`.
   - Lines 1761-1787 conditionally render button `#btn-switch-nested`.
   - `handleApply` (lines 1133-1200) only tests `if (mode === "nested_json")`, missing `formatType === "nested_json"`.
   - `actions.ts` (lines 1117-1125) defines `ExtractionFormatType` without `"nested_json"`.

7. **`run_tests.js` (lines 29-72)**:
   - Currently registers 18 test suites across unit, qa, and default categories. 3 new suites are pending registration.

8. **`package_release.ps1` & `tools/clean_cache.ps1`**:
   - Standardizes release author to `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`, strictly checks zero-duplicate binaries, and outputs to root `Toad.exe` and `releases/Toad-2.5.1-x64-portable.*`.

---

## 2. Logic Chain

1. **Step 1 (Line Math & Height State Foundation)**:
   - From Obs 1 & Obs 2, `CellLineCalculator.ts` must provide two pure mathematical functions:
     - `calculateLineCount(text, colWidth, options)`: determines visual lines $N$ using Canvas 2D `ctx.measureText` or headless character heuristic $C_w \approx 7.2\text{px}$.
     - `getHeightAndScrollState(N, lineHeight = 17, padding = 8, defaultHeight = 24)`:
       - $N \le 1$: `{ shouldExpand: false, height: 24, overflowY: "hidden", hasScrollbar: false }`.
       - $2 \le N \le 5$: `{ shouldExpand: true, height: N * 17 + 8, overflowY: "hidden", hasScrollbar: false }`.
       - $N > 5$: `{ shouldExpand: true, height: 93, overflowY: "auto", hasScrollbar: true }`.
   - This contract guarantees that 2 to 5 lines never exhibit scrollbars, and long text is strictly capped at 93px (5 lines).

2. **Step 2 (CSS Isolation & Override Removal)**:
   - From Obs 4 & Obs 5, `sidebar.less` and `slickgrid.scss` currently hardcode `max-height: 180px !important; overflow-y: auto !important;`.
   - Because `!important` in stylesheets overrides inline element styles, removing `max-height: 180px !important` from both `.file-table-row.is-selected` and `.slick-cell-active-expanded` is required to allow `CellLineCalculator` inline height to take precedence.

3. **Step 3 (Modal Active Cell Glow Suppression)**:
   - From Obs 1, 5 & 6, when a modal opens, Blueprint appends `bp4-overlay-open` to `<body>`.
   - By adding CSS rules targeting `body.bp4-overlay-open .slick-cell.active`, `body.bp4-overlay-open .slick-row.active`, and `body.bp4-overlay-open .slick-cell.selected` with `background: transparent !important; box-shadow: none !important; outline: none !important; border-color: transparent !important;`, any active cell glow behind the backdrop is visually extinguished.
   - Concurrently, `RegexDialog` must dispatch `"dismiss-grid-cell-expand"` via `GridOverlayBus` and call `grid.resetActiveCell()` to clear floating DOM elements and grid coordinates.

4. **Step 4 (Parse Columns Dialog Streamlining)**:
   - From Obs 6, removing `#ntab-nested` simplifies the header switcher to strictly `[Visual]` and `[Regex]`.
   - Adding `nested_json` to `#minFormatSelect` and updating `ExtractionFormatType` in `actions.ts` unifies ingestion modes into a single dropdown.
   - Removing `#btn-switch-nested` eliminates interface clutter.
   - Triggering `triggerNestedScan(100)` when `nested_json` is selected ensures immediate feedback.
   - Updating `handleApply` to support `mode === "nested_json" || formatType === "nested_json"` ensures SQL generation and schema view creation execute reliably.

5. **Step 5 (Parallel Partitioning & Test Assurance)**:
   - Dividing the 20 engineers into 5 squads with strictly defined file boundaries (S1 Foundation, S2 Sidebar, S3 DataGrid, S4 Parse Dialog, S5 Systems QA & Release) prevents concurrent edits to the same files.
   - Registering 3 new test suites (50 tests total) in `run_tests.js` increases total coverage to 575+ tests, validating zero regressions.

---

## 3. Caveats

- **Read-Only Scope**: In strict adherence to the dispatch instruction, no source code, stylesheets, or test scripts were modified, and no build or test commands were run.
- **Canvas Headless Simulation**: In Node.js CLI test environments where `HTMLCanvasElement` is unavailable, `calculateLineCount` must reliably fallback to the character-width heuristic ($C_w = 7.2\text{px}$) to pass tests without DOM dependencies.

---

## 4. Conclusion

The specification survey is 100% complete:
- Exact mathematical formulas and height state mapping rules are established.
- 4-way collapse lifecycle conditions are documented.
- Parse Columns UX and format dropdown refactor requirements are mapped to exact code locations.
- Modal active cell highlight suppression strategy (CSS + DOM cleanup + Event bus) is finalized.
- 50 new test case specifications across 3 suites and updates to existing suites are specified.
- The 20-engineer 5-Squad no-conflict partitioning matrix is complete and ready for execution.

All findings are comprehensively documented in:
`d:\Shared_UserData\Downloads\tad\.agents\teamwork\spec_miner_survey_squads\analysis.md`

---

## 5. Verification Method

To independently verify this specification survey:
1. Inspect the detailed analysis file:
   - Path: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\spec_miner_survey_squads\analysis.md`
2. Cross-reference file line references with codebase:
   - `ProjectFilesTable.tsx` lines 667-775
   - `DataGrid.tsx` lines 605-654 & 880-940
   - `RegexDialog.tsx` lines 1504-1589 & 1753-1787
   - `slickgrid.scss` lines 112-146
   - `sidebar.less` lines 1141-1175
3. Downstream implementation test command:
   ```powershell
   & "node-v18.20.4-win-x64\node.exe" run_tests.js --all
   ```
   *Expected outcome upon completion of implementation: 575+ tests PASS.*
