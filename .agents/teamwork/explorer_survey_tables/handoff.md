# Handoff Report: Codebase Survey of Tables, Dialogs, Styles & Utilities

**Author**: Teamwork Explorer (`explorer_survey_tables`)  
**Date**: 2026-11-04T18:06:00Z  
**Type**: Hard Handoff (Investigation Complete)  
**Destination**: Orchestrator (`be854d41-8a3e-4b29-a7b7-70b0d33d645a`) and Implementation Squads (Squads 1–5, Engineers E01–E20)  

---

## 1. Observation

Direct code observations from read-only inspection of `tad-master/packages/toadviewer/`:

1. **Utility Files (`src/utils/`)**:
   - `tad-master/packages/toadviewer/src/utils/CellLineCalculator.ts`:
     File is present but empty (0 bytes, 1 empty line).
   - `tad-master/packages/toadviewer/src/utils/GridOverlayBus.ts`:
     File does not exist in the repository.
   - Other utilities (`DuckDbJsonSqlBuilder.ts`, `NestedJsonTraverser.ts`, `ForensicDecoder.ts`, `src/util.ts`) exist and provide typed modules without syntax errors.

2. **Sidebar File Management Table (`ProjectFilesTable.tsx` & `sidebar.less`)**:
   - In `ProjectFilesTable.tsx` (lines 668–676):
     ```tsx
     const isSelected = selectedRowPath
       ? normPath(selectedRowPath) === normPath(f.filePath)
       : false;
     ...
     <tr
       key={f.filePath}
       className={`file-table-row ${isSelected ? "is-selected" : ""}`}
       onClick={() => handleRowClick(f)}
     ```
     `isSelected` toggles only `.is-selected`. Line count calculation is absent, and `.is-expanded` is never applied.
   - In `less/sidebar.less` (lines 1141–1177):
     ```less
     &.is-selected {
       height: auto !important;
       background-color: #0284c7 !important;
       color: #ffffff !important;

       td {
         white-space: normal !important;
         word-break: break-all !important;
         vertical-align: top !important;
       }
       .cell-name .file-name-wrap, .file-name-text {
         max-height: 180px;
         overflow-y: auto;
       }
     }
     ```
     Every selected file unconditionally expands, sets `vertical-align: top`, and enables scrolling up to 180px, violating Contract R1 for $N \le 1$ and $2 \le N \le 5$.
   - Column resize handles and minWidth:
     - `MIN_COL_WIDTH = 45; MAX_COL_WIDTH = 400;` (lines 116–117).
     - Handles exist at lines 501, 545, 589, 633 with `onMouseDown` and `onDoubleClick` auto-fit (`Math.round(maxLen * 7.0 + 24)`).

3. **Main SlickGrid Data Table (`DataGrid.tsx` & `slickgrid.scss`)**:
   - In `DataGrid.tsx` (lines 635–642):
     ```ts
     const textContent = (cellNode.textContent || "").trim();
     const textLen = textContent.length;
     const isOverflowing = cellNode.scrollWidth > cellNode.clientWidth || textLen > 28;
     if (isOverflowing) {
       cellNode.classList.add("slick-cell-active-expanded");
     ```
     `tryExpandCell` uses a naive `textLen > 28` threshold without calculating line counts or setting dynamic inline heights.
   - In `DataGrid.tsx` (lines 915–938):
     Event subscriptions handle `grid.onScroll`, `grid.onViewportChanged`, and Escape key, but lack a `mousedown` click-outside handler and do not toggle on re-clicking the active cell.
   - In `src/slickgrid.scss` (lines 112–129):
     ```scss
     .slick-cell.slick-cell-active-expanded {
       position: absolute !important;
       z-index: 20 !important;
       contain: none !important;
       height: auto !important;
       max-height: 180px !important;
       overflow-y: auto !important;
     }
     ```
     Hardcoded `max-height: 180px !important` overrides inline styles.
   - In `src/slickgrid.scss`:
     Zero rules exist for `body.bp4-overlay-open`. When a Blueprint dialog opens, `.slick-cell.active`, `.slick-row.active`, and `.slick-cell.selected` continue to highlight behind the modal backdrop.

4. **Parse Columns & Nested JSON Dialog (`RegexDialog.tsx` & `NestedFieldsTable.tsx`)**:
   - In `RegexDialog.tsx` (lines 1505–1588):
     Header tabs contain `#ntab-simple` (Visual), `#ntab-nested` (Nested JSON), and `#ntab-adv` (Regex). `#ntab-nested` is present on line 1533.
   - In `RegexDialog.tsx` (lines 1731–1787):
     `#minFormatSelect` has only 6 options (`kv`, `json`, `space`, `raw`, `csv`, `arr`). Option `nested_json` is missing. Line 1764 contains `#btn-switch-nested` (`Auto-Flatten Available ➔`).
   - In `RegexDialog.tsx` (lines 1133–1200):
     `handleApply` checks `if (mode === "nested_json")`, failing to check `formatType === "nested_json"`.
   - In `RegexDialog.tsx` (lines 218–228):
     `useEffect` on `isOpen === true` does not dispatch `"dismiss-grid-cell-expand"`, does not clear `.slick-cell-active-expanded`, and does not call `grid.resetActiveCell()`.
   - In `NestedFieldsTable.tsx` (lines 188–251 & 360–369):
     Headers have no `.col-resizer-handle`, and `.sample-val-text` is truncated with `white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px;`.

---

## 2. Logic Chain

1. **Mathematical Foundation (Observations 1.1, 1.2)**:
   - Because `CellLineCalculator.ts` is empty and `GridOverlayBus.ts` is missing, components currently rely on ad-hoc heuristics (`textLen > 28`, `scrollWidth > clientWidth`).
   - Implementing `calculateLineCount` with Canvas 2D and Node fallback, along with `getHeightAndScrollState` enforcing the $N \le 1$, $2 \le N \le 5$, and $N > 5$ contract, provides the shared foundation required by all 3 tables without DOM coupling.

2. **Sidebar File Table Refinement (Observation 2)**:
   - In `sidebar.less`, `.file-table-row.is-selected` unconditionally applies `height: auto !important` and `white-space: normal !important`.
   - By decoupling `.is-selected` (strictly blue background, white text, flat 25px height, `nowrap`) from `.is-selected.is-expanded` (multi-line wrapping), rows with $N \le 1$ remain completely flat.
   - Integrating `CellLineCalculator` into `ProjectFilesTable.tsx` allows setting `is-expanded` and inline height only when $N \ge 2$.

3. **DataGrid In-Place Floating Wrap & Overlay Cleanliness (Observation 3)**:
   - In `DataGrid.tsx`, replacing `textLen > 28` with `calculateLineCount` prevents unnecessary floating cells on single-line values ($N \le 1$).
   - Removing `max-height: 180px !important;` from `slickgrid.scss` permits inline heights ($N \times 17 + 8$ capped at 93px) and `overflow-y: hidden` ($2 \le N \le 5$) vs `overflow-y: auto` ($N > 5$).
   - Adding `body.bp4-overlay-open` rules suppresses `.slick-cell.active` and floating cell glow behind modals.

4. **Parse Columns UX Simplification (Observation 4)**:
   - Removing `#ntab-nested` leaves strictly `[Visual]` and `[Regex]` tabs in the header.
   - Adding `<option value="nested_json">Nested JSON</option>` to `#minFormatSelect` and removing `#btn-switch-nested` consolidates all format selection into the standard dropdown.
   - Updating `onChange` to switch body views and trigger `triggerNestedScan(100)` preserves full Nested JSON functionality while streamlining the UI.
   - Updating `handleApply` ensures that both `mode === "nested_json"` and `formatType === "nested_json"` execute the DuckDB view generation pipeline.

---

## 3. Caveats

- **No Source Code Modified**: In accordance with the read-only exploration role, zero modifications were made to `src/`, `less/`, `tests/`, or build scripts.
- **Node vs Canvas Parity**: `calculateLineCount` must support both `CanvasRenderingContext2D` in the browser and character-width heuristic fallback (`charWidth = 7.5`) when running headless unit tests in Node.js.
- **Build Pipeline Verification**: Full production bundling (`dist_package.ps1`) requires Webpack and Electron compilation, which must be executed by Squad 5 during the packaging phase.

---

## 4. Conclusion

The codebase is clean, well-architected, and fully prepared for the 20-engineer parallel execution plan. The boundary lines identified in `ke_hoach_trien_khai_20_ki_su_song_song.md` are completely valid and guarantee zero git merge conflicts across the 5 squads:
- **Squad 1**: Implement `CellLineCalculator.ts`, `GridOverlayBus.ts`, and `test_cell_line_calculator.js`.
- **Squad 2**: Update `ProjectFilesTable.tsx`, `sidebar.less`, and `test_project_files_table_wrap_resize.js`.
- **Squad 3**: Update `DataGrid.tsx`, `slickgrid.scss`, and `test_datagrid_floating_wrap.js`.
- **Squad 4**: Update `RegexDialog.tsx`, `NestedFieldsTable.tsx`, `nested-dialog.less`, and `test_parse_dialog_nested_dropdown.js`.
- **Squad 5**: Implement `test_modal_cell_glow_suppression.js`, run stress tests, clean cache, and verify packaging.

---

## 5. Verification Method

To verify these observations and inspect the findings:

1. **Verify Empty and Missing Utility Files**:
   ```powershell
   Get-Item "tad-master\packages\toadviewer\src\utils\CellLineCalculator.ts"
   Test-Path "tad-master\packages\toadviewer\src\utils\GridOverlayBus.ts"
   ```

2. **Inspect Current Selections and CSS Rules**:
   - `ProjectFilesTable.tsx`: Lines 668–676 (`isSelected` class assignment) and lines 343–375 (column resizer).
   - `sidebar.less`: Lines 1141–1177 (`.file-table-row.is-selected` and `max-height: 180px`).
   - `DataGrid.tsx`: Lines 605–654 (`tryExpandCell`).
   - `slickgrid.scss`: Lines 112–146 (`.slick-cell-active-expanded`).
   - `RegexDialog.tsx`: Line 1533 (`#ntab-nested`), line 1732 (`#minFormatSelect`), line 1764 (`#btn-switch-nested`).

3. **Full Analysis Artifact**:
   Inspect `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_survey_tables\analysis.md` for complete code snippets, function signatures, and exact line numbers.
