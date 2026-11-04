# Handoff Report: Squad 2 Sidebar File Management Table (Engineers E05-E08)

## 1. Observation
- **Assigned Files**:
  - `tad-master/packages/toadviewer/src/components/ProjectFilesTable.tsx`
  - `tad-master/packages/toadviewer/less/sidebar.less`
  - `tests/unit/test_project_files_table_wrap_resize.js`
- **Initial Codebase Inspection**:
  - `ProjectFilesTable.tsx`: Line 675 originally set `className={`file-table-row ${isSelected ? "is-selected" : ""}`}` without computing line count or applying dynamic height states.
  - `sidebar.less`: Lines 1141-1204 unconditionally enforced `height: auto !important;`, `white-space: normal !important;`, and `max-height: 180px; overflow-y: auto;` on every `.is-selected` row, causing single-line files (e.g. `short.csv`) to expand unexpectedly.
  - `tests/unit/test_project_files_table_wrap_resize.js`: TEST 1.13 asserted legacy static bounds (`style.containerMaxHeight === "180px"`).
- **Tool Execution & Results**:
  - Test command:
    `& "node-v18.20.4-win-x64\node.exe" tests/unit/test_project_files_table_wrap_resize.js`
    Output:
    ```
    ======================================================================
      UNIT TEST: ProjectFilesTable Column Resizing & Active Row Auto-Wrap 
    ======================================================================

      ✔ [PASS] TEST 1.1: Column Width State Initialization ({ name: 140, dir: 120, size: 70, status: 60 })
      ✔ [PASS] TEST 1.2: Resizer Handle DOM Presence (.col-resizer-handle on th.col-name, th.col-dir, etc.)
      ✔ [PASS] TEST 1.3: MouseDown Drag Initiation (start mouse recording & body.col-resizing)
      ✔ [PASS] TEST 1.4: Drag Expansion Calculation (+50px delta: 140px -> 190px)
      ✔ [PASS] TEST 1.5: Drag Contraction Calculation (-30px delta: 140px -> 110px)
      ✔ [PASS] TEST 1.6: Minimum Width Clamping (45px strictly enforced on negative delta)
      ✔ [PASS] TEST 1.7: Event Propagation Isolation on Resizer (e.stopPropagation & e.preventDefault)
      ✔ [PASS] TEST 1.8: Window Blur / MouseLeave Cleanup (cancels unfinished drag)
      ✔ [PASS] TEST 1.9: Double-Click Auto-Fit Calculation from visible text (round(len * 7.0 + 24))
      ✔ [PASS] TEST 1.10: Double-Click Auto-Fit Min Clamping (45px on short text / empty)
      ✔ [PASS] TEST 1.11: Active Row Selection Wrap Trigger (.is-selected.is-expanded, white-space: normal, word-break: break-all)
      ✔ [PASS] TEST 1.12: Compact Single-Line Preservation for Unselected & N<=1 Rows (25px flat, white-space: nowrap)
      ✔ [PASS] TEST 1.13: Dynamic N-Line Bounds Capping & Scrollability (25px flat, exact N*17+8, 93px cap & scrollbar)
      ✔ [PASS] TEST 1.14: Toggle Click Collapse (re-clicking selected row deselects & collapses)
      ✔ [PASS] TEST 1.15: Escape Key / Outside Click Dismissal (resets selectedRowPath to null)

    ======================================================================
      PROJECT FILES TABLE SUITE SUMMARY: 15/15 PASSED
    ======================================================================
    ```
    Exit code: 0.
  - TypeScript compilation check:
    `& "node-v18.20.4-win-x64\node.exe" "tad-master/node_modules/typescript/bin/tsc" --project "tad-master/packages/toadviewer/tsconfig.json" --noEmit`
    Output: Exited with code 0, zero diagnostic errors.

## 2. Logic Chain
1. **Dynamic Line Calculation & Expansion (E05)**:
   - Imported `calculateLineCount` and `getHeightAndScrollState` from `../utils/CellLineCalculator` into `ProjectFilesTable.tsx`.
   - In the row rendering loop (`displayedFiles.map`), when `isSelected` is true:
     - `nameLines = calculateLineCount(f.fileName, (colWidths.name || 140) - 24)`
     - `dirLines = calculateLineCount(f.relDir, (colWidths.dir || 120) - 12)`
     - `lineCount = Math.max(nameLines, dirLines)`
     - `heightState = getHeightAndScrollState(lineCount, 17, 8, 25)`
   - If `heightState.shouldExpand` ($N \ge 2$):
     - Adds `is-expanded` class to `<tr>`.
     - Applies `style={{ height: heightState.height, overflowY: heightState.overflowY }}` to `<tr>`.
     - Applies `style={{ maxHeight: heightState.height, overflowY: heightState.overflowY }}` to `.file-name-wrap` and `.file-dir-wrap`.
   - If $N \le 1$: row receives only `is-selected` without `is-expanded`, staying flat at 25px without elevation or scrollbar.
2. **Column Resizer & Clamping (E06)**:
   - Header resizer handles maintain `MIN_COL_WIDTH = 45px` clamping on dragging.
   - Double-click triggers `handleAutoFit`, calculating max text length across visible rows clamped to $[45\text{px}, 400\text{px}]$.
3. **Sidebar Styles & Slim Scrollbar (E07)**:
   - In `sidebar.less`:
     - Cleanly separated `.file-table-row.is-selected` from `.file-table-row.is-selected.is-expanded`.
     - `.is-selected`: purely `#0284c7` (dark `#1f385c`) background, white text, flat 25px height, `white-space: nowrap`, `vertical-align: middle`.
     - `.is-selected.is-expanded`: multi-line wrapping (`white-space: normal !important`, `word-break: break-all !important`, `vertical-align: top !important`).
     - Removed hardcoded `max-height: 180px !important;` and `overflow-y: auto;` so inline styles from `CellLineCalculator` govern.
     - Added 4px slim rounded scrollbar (`rgba(255, 255, 255, 0.4)` thumb, radius 2px) for `.is-expanded` when scrollable.
4. **4-Way Collapse Lifecycle & QA (E08)**:
   - Re-clicking active selected row resets `selectedRowPath = null` (Direction 1).
   - Clicking another row switches `selectedRowPath` to the new path (Direction 2).
   - Clicking outside table container dismisses `selectedRowPath = null` (Direction 3).
   - Pressing `Escape` key dismisses `selectedRowPath = null` (Direction 4).
   - Updated `tests/unit/test_project_files_table_wrap_resize.js` simulation model and test cases to assert dynamic $N$-line boundaries:
     - $N \le 1$: flat 25px, no expansion, no scrollbar.
     - $2 \le N \le 5$: exact fit height ($N \times 17 + 8$), `overflow-y: hidden`, no scrollbar.
     - $N > 5$: capped at 5 lines ($93\text{px}$), `overflow-y: auto`, slim scrollbar enabled.

## 3. Caveats
- No caveats. Changes strictly adhere to ownership boundaries and interface contracts specified in `PROJECT.md`.

## 4. Conclusion
- Squad 2 (Engineers E05-E08) tasks are 100% complete.
- The sidebar file table dynamically calculates line wrapping on active selection, expands accurately based on $N$ lines, remains flat for single-line files, clamps column widths to $\ge 45\text{px}$, supports 4-way collapse lifecycle, and passes all 15 automated unit test cases with exit code 0.

## 5. Verification Method
- **Command**:
  ```powershell
  & "node-v18.20.4-win-x64\node.exe" tests/unit/test_project_files_table_wrap_resize.js
  ```
- **Expected Outcome**: All 15 tests pass with summary `15/15 PASSED` and exit code 0.
- **TypeScript Check**:
  ```powershell
  & "node-v18.20.4-win-x64\node.exe" "tad-master/node_modules/typescript/bin/tsc" --project "tad-master/packages/toadviewer/tsconfig.json" --noEmit
  ```
  Expected: Exits with code 0 with zero errors.
- **Files Inspected**:
  - `tad-master/packages/toadviewer/src/components/ProjectFilesTable.tsx`
  - `tad-master/packages/toadviewer/less/sidebar.less`
  - `tests/unit/test_project_files_table_wrap_resize.js`
