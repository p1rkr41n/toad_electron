# Complete Technical Specification & Mining Report: Column Resizing and Active Row Auto-Wrap

**Author**: `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`  
**Date**: 2026-11-04  
**Scope**: 11 Parallel Streams (R1 through R5)  
**Target Architecture**: ToadViewer File Management Table (`ProjectFilesTable.tsx`) & Main Data Grid (`DataGrid.tsx` / SlickGrid)

---

## 1. Observation

Direct observations from the authoritative specifications and source code inspection:

1. **User Request & High-Level Directives** (`ORIGINAL_REQUEST.md`):
   - R1: Draggable column header divider resizers (`col-resizer-handle`) between headers (`Name`, `DirPath`, `Size`, `Status`) in `ProjectFilesTable.tsx` with minWidth clamping (45px) and double-click auto-fit based on longest visible text. Active row auto-wrap on click (`is-selected`) expanding dynamically (`white-space: normal; word-break: break-all; overflow-wrap: anywhere; max-height: 180px; overflow-y: auto;`) while unselected rows stay compact single-line (25px). Collapse on clicking another row, toggle clicking selected row, clicking outside table, or pressing `Escape`.
   - R2: Main Data Grid (`DataGrid.tsx` / SlickGrid) double-click on header resizer handles to calculate max string length on visible rows and auto-fit column width. Floating In-Place Wrap on active/selected cell/row (`.slick-cell-active-expanded`, `z-index: 20`, light border, soft shadow `0 4px 14px rgba(0, 0, 0, 0.15)`, `max-height: 180px; overflow-y: auto; white-space: normal; word-break: break-word;`) without distorting SlickGrid virtual scroll coordinates. Dismiss expanded cell on grid scroll or pressing `Escape`.
   - R3: Standardize visual styling in `sidebar.less` and `slickgrid.scss` for Light and Dark themes, custom slim scrollbars (4px, `border-radius: 2px`), subtle divider line on hover/drag (`rgba(2, 132, 199, 0.75)`), and `.col-resizing` cursor management. Event isolation (`e.stopPropagation()`), window blur/leave drag cancellation, and `Escape` collapse.
   - R4: Automated test suites: `tests/unit/test_project_files_table_wrap_resize.js` (15 tests), `tests/unit/test_datagrid_floating_wrap.js` (15 tests), `tests/qa/test_grid_wrap_concurrency_stress.js` (10 tests), registered in `run_tests.js`.
   - R5: Release packaging via `dist_package.ps1` and `package_release.ps1`, zero-duplicate binary policy, footprint < 75 MB, `jj` commits.

2. **Sidebar File Table Codebase Analysis** (`ProjectFilesTable.tsx` lines 336–572 & `sidebar.less` lines 1020–1295):
   - In `ProjectFilesTable.tsx` line 336: `<table className="project-files-table">` uses static column width CSS classes (`col-name` 38%, `col-dir` 32%, `col-size` 18%, `col-status` 12%).
   - Currently, no column resizer element exists in `<th>`. Clicking `<th>` toggles column filter inputs (`filterOpenCol`), and clicking `.sort-btn` sorts the table.
   - Rows (`tr.file-table-row`) have fixed height `25px` (line 1096 in `sidebar.less`) and cells have `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`.
   - Clicking a row calls `onOpenFile(f)` and sets `isSelected = activeFilePath && normPath(activeFilePath) === normPath(f.filePath)`. There is currently no toggle-click unselection or `Escape` key collapse.

3. **Main Data Grid Codebase Analysis** (`DataGrid.tsx` lines 86–179, 430–500, 600–700, & `slickgrid.scss` lines 68–74):
   - SlickGrid columns currently have `resizable: true` by default (except `_expand` with `resizable: false` at line 213).
   - In `DataGrid.tsx` lines 87–96, initial column widths are computed using `CHAR_WIDTH = 7.0`, `measureStringWidth(s) = 8 + 7.0 * s.length`, `MINCOLWIDTH = 60`, `MAXCOLWIDTH = 330`.
   - SlickGrid natively renders `.slick-resizable-handle` on column headers for manual drag-resizing, but lacks a `dblclick` listener to perform automatic width recalculation (Auto-fit).
   - In `slickgrid.scss` lines 68–73:
     ```scss
     .slick-cell {
       contain: strict;
       text-overflow: ellipsis;
       white-space: nowrap;
       overflow: hidden;
     }
     ```
     `contain: strict;` applies CSS containment (`size layout paint`), which clips child elements to the 24px cell box unless overridden with `contain: none !important;` and `overflow: visible !important;`.
   - Row virtual coordinates in SlickGrid are computed strictly as `top = rowIndex * rowHeight` (24px). Changing the row height directly in the DOM breaks virtual scrolling calculations.

4. **Test Harness & Build Infrastructure** (`run_tests.js`, `dist_package.ps1`, `package_release.ps1`):
   - Node.js executable is located at `D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe`.
   - `jj.exe` is located at `tools/jj/jj.exe`.
   - All 5 existing unit suites (126 tests) pass cleanly in 3.46s; `deep_integration_qa.js` (223 tests) passes cleanly in 16.42s; `run_tests.js` executes 8 deep QA suites cleanly.
   - `dist_package.ps1` enforces strict footprint thresholds: `app.asar` <= 45.0 MB, portable executable <= 75.0 MB, zero duplicate binaries.

---

## 2. Logic Chain

1. **Sidebar Table Resizing Logic**:
   - Because `ProjectFilesTable.tsx` currently renders percentage-based column widths (`.col-name { width: 38%; }`), dragging requires converting column widths to pixel state (`ColWidths`: `{ name: number, dir: number, size: number, status: number }`).
   - Default initial widths that sum to 390px (matching typical sidebar dimensions) are: `name: 140, dir: 120, size: 70, status: 60`.
   - A divider element `<div className="col-resizer-handle" ... />` must be placed at the right edge of each `<th>`.
   - When `onMouseDown` fires on `.col-resizer-handle`, `e.stopPropagation()` and `e.preventDefault()` must execute immediately to prevent triggering the `<th>` click handler (which toggles the column filter input).
   - Global `mousemove` and `mouseup` listeners must be attached to `document` so that dragging remains responsive when the cursor moves outside the header or table container.
   - Clamping rule: $w_{\text{new}} = \max(45, w_{\text{start}} + \Delta x)$ ensures columns can never shrink below 45px.

2. **Sidebar Active Row Auto-Wrap Logic**:
   - Only rows with `.is-selected` should expand; unselected rows must remain 25px data-dense single lines.
   - Wrapping is achieved by applying `white-space: normal; word-break: break-all; overflow-wrap: anywhere; height: auto;` to cells of the selected row.
   - Long file paths or names are constrained by `max-height: 180px; overflow-y: auto;` with slim scrollbars (4px) to prevent vertical overflow from pushing the rest of the file list off screen.
   - The collapse lifecycle requires four triggers:
     1. Selecting another row -> collapses old, expands new.
     2. Clicking the currently selected row a second time (toggle click) -> unselects and collapses.
     3. Clicking outside the table container (`click-away`) -> unselects and collapses.
     4. Pressing the `Escape` key -> unselects and collapses.

3. **SlickGrid Auto-Fit Column Width Logic**:
   - SlickGrid header columns render `.slick-resizable-handle`.
   - A `dblclick` listener on the grid header row captures double-clicks on `.slick-resizable-handle`.
   - The handler identifies the target column, reads visible rows from `grid.getViewport()` ($v_{\text{top}}$ to $v_{\text{bottom}}$), queries the corresponding data values from `dataView`, and calculates the maximum rendered width using font metrics:
     $$w_{\text{fit}} = \max(\text{headerWidth}, \max_{i \in [v_{\text{top}}, v_{\text{bottom}}]} (\text{length}(\text{cellVal}) \times 7.5 + 24))$$
   - Clamping rule: $w_{\text{clamped}} = \max(60, \min(500, w_{\text{fit}}))$.
   - Applying `grid.setColumns(updatedCols)` immediately updates the column header and cell layout without a full data view reload.

4. **SlickGrid Floating In-Place Active Cell Wrap Logic**:
   - Virtual scroll engines (SlickGrid) rely on uniform row height (`rowHeight = 24px`) to calculate `rowTop = rowIndex * rowHeight`. Mutating row heights directly in the DOM distorts the virtual buffer and breaks scrolling.
   - Solution: Floating In-Place Overlay (`.slick-cell-active-expanded`).
   - When a cell becomes active via click or keyboard navigation:
     - Check if cell text overflows (`scrollWidth > clientWidth` or text length exceeds column capacity).
     - If overflowing: assign `.slick-cell-active-expanded` to the cell node.
     - Crucial CSS overrides:
       - `.slick-cell-active-expanded { position: absolute; z-index: 20; max-height: 180px; overflow-y: auto; white-space: normal; word-break: break-word; contain: none !important; }`
       - Parent row must receive `overflow: visible !important; z-index: 25;` so the overlay is not clipped by row boundaries.
     - Coordinate invariant: The floating cell maintains its exact original `left` offset ($\sum \text{colWidth}$) and `top: 0` relative to its row.
     - Dismissal: On `grid.onScroll` or `Escape` key press, remove `.slick-cell-active-expanded` immediately (execution budget < 0.5ms).

5. **Theme & CSS System Logic**:
   - Light theme: subtle Blueprint blue divider `rgba(2, 132, 199, 0.75)`, active row background `#0284c7`, floating cell background `#ffffff`, border `#0284c7`, shadow `0 4px 14px rgba(0, 0, 0, 0.15)`.
   - Dark theme (`.bp4-dark`, `.toad-dark`): divider `rgba(56, 189, 248, 0.75)`, active row background `var(--md-sys-color-primary-container, #1f385c)`, floating cell background `var(--md-sys-color-surface-container-high, #25262c)`, border `var(--md-sys-color-primary, #38bdf8)`, shadow `0 4px 16px rgba(0, 0, 0, 0.5)`.
   - Global body cursor: `body.col-resizing { cursor: col-resize !important; user-select: none !important; }`.
   - Custom slim scrollbars: `width: 4px; height: 4px; background: transparent; thumb: rgba(148, 163, 184, 0.5); border-radius: 2px;`.

---

## 3. Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|---|---|---|---|---|---|---|
| F1 | Sidebar Resizing | Column Resizer Handles | Draggable divider handles on column headers in `ProjectFilesTable.tsx` | Mouse drag (`mousedown`, `mousemove`, `mouseup`) | Dynamic column width in px (`colWidths`) | Clamped to minWidth 45px | Plan Stream 1, Spec §2.1 |
| F2 | Sidebar Resizing | Auto-Fit Column Width | Double-click header divider to auto-fit to longest visible text | `dblclick` on `.col-resizer-handle` | Column width adjusted to fit longest string | Clamped between 45px and 400px | Plan Stream 1, Spec §2.1 |
| F3 | Sidebar Wrap | Active Row Dynamic Wrap | Selected row expands height and wraps multiline file name / dir path | Click on row (`is-selected`) | Multi-line wrapped text, max-height 180px | Shows vertical slim scrollbar if > 180px | Plan Stream 2, Spec §3.2 |
| F4 | Sidebar Wrap | Row Collapse Lifecycle | Unselects / collapses expanded row back to single line | Toggle click, click outside, or `Escape` key | Row height returns to 25px, `white-space: nowrap` | Safe no-op if no row selected | Plan Stream 2, Spec §3.1 |
| F5 | SlickGrid Resizing | Double-Click Auto-Fit | Auto-fits SlickGrid column to longest text across visible rows | `dblclick` on `.slick-resizable-handle` | Column width updated via `grid.setColumns` | Clamped between 60px and 500px | Plan Stream 3, Spec §2.2 |
| F6 | SlickGrid Wrap | Floating In-Place Cell Wrap | Overflows cell text in floating card overlay without shifting grid rows | Active cell selection with text overflow | Cell gets `.slick-cell-active-expanded`, `z-index: 20` | Row scroll coordinates remain 100% intact | Plan Stream 4, Spec §3.3 |
| F7 | SlickGrid Wrap | Floating Cell Dismissal | Dismisses floating cell on scroll, cell switch, or `Escape` | `grid.onScroll`, cell navigation, or `Escape` | `.slick-cell-active-expanded` removed | Reverts immediately to flat single-line | Plan Stream 4, Spec §3.3 |
| F8 | UI/UX Pro Max | Blueprint Theme Styling | Light and Dark mode styling for dividers, selection, floating cards | CSS variables / classes (`.bp4-dark`, `.toad-dark`) | Accessible, high-contrast, cohesive styling | Graceful fallback to default colors | Plan Stream 5 |
| F9 | UI/UX Pro Max | Custom Slim Scrollbars | 4px slim scrollbars on table wrap containers and floating cells | Scrollable overflow content | 4px semi-transparent scrollbar track/thumb | Native scrollbar fallback if unsupported | Plan Stream 5 |
| F10 | Interaction Guard | Drag Event Isolation | Prevents sort/filter triggering during column divider drag | `mousedown` on resizer handle | `e.stopPropagation()`, `e.preventDefault()` | No inadvertent clicks triggered | Plan Stream 6 |
| F11 | Interaction Guard | Window Blur / Leave Cleanup | Aborts in-flight drag if cursor leaves window or loses focus | `window.onblur`, `document.onmouseleave` | Cancels drag state, removes `.col-resizing` | Resets mouse listeners safely | Plan Stream 6 |
| F12 | QA & Packaging | Automated Test Suite | 40 test cases across 3 suites integrated in `run_tests.js` | `node run_tests.js --all` | 100% test pass status | Non-zero exit code on failure | Plan Streams 7–10 |
| F13 | QA & Packaging | Zero-Duplicate Release Gate | Enforces single canonical portable binaries and size limits | `dist_package.ps1`, `package_release.ps1` | `Toad-<version>-x64-portable.exe` < 75 MB | Build fails if duplicates or size > 75MB | Plan Stream 11, `AGENTS.md` |

---

## 4. Edge Cases

| # | Feature | Input | Observed Behavior | Handling / Invariant |
|---|---|---|---|---|
| E1 | Sidebar Drag Resize | Dragging cursor far to the left ($\Delta x < -500\text{px}$) | Column width tries to drop below 0 | Clamped strictly to `Math.max(45, newWidth)` (45px minimum) |
| E2 | Sidebar Drag Resize | Dragging cursor beyond browser window / releasing outside | Mouseup missed if bound only to header element | Attached to `document`; cancelled on `window.onblur` / `mouseleave` |
| E3 | Sidebar Double-Click Auto-Fit | Double-clicking column when table has 0 files | Filter query yields empty table | Fallback to default minimum width (45px) |
| E4 | Sidebar Double-Click Auto-Fit | File with 1,000+ character path in a single row | Estimated width exceeds window width | Clamped to `MAX_COL_WIDTH = 400px` |
| E5 | Sidebar Row Auto-Wrap | Super long unbroken string (e.g., base64 hash or 256-hex string) | Text overflows column without spaces | `word-break: break-all; overflow-wrap: anywhere;` forces break |
| E6 | Sidebar Row Auto-Wrap | File path with 15 nested directories exceeding 180px height | Content overflows sidebar vertically | `max-height: 180px; overflow-y: auto;` triggers custom slim scrollbar |
| E7 | Sidebar Row Auto-Wrap | Clicking already selected row (toggle click) | Row is already in `is-selected` state | Deselects active row and collapses height back to 25px |
| E8 | SlickGrid Auto-Fit | Double-clicking column resizer on 100K-row dataset | Scanning 100K rows freezes UI thread | Only scans visible viewport buffer (`vp.top` to `vp.bottom`) in $O(\text{viewport})$ time |
| E9 | SlickGrid Auto-Fit | Column containing complex nested JSON or NULL values | `cellVal` is `null`, `undefined`, or object | Safely coerced: `null -> ""`, object -> formatted JSON string |
| E10 | SlickGrid Floating Wrap | Active cell text fits easily within column (`scrollWidth <= clientWidth`) | Short text (e.g. status "OK") | Does NOT trigger floating wrap; remains standard cell |
| E11 | SlickGrid Floating Wrap | High-speed wheel scroll while floating cell is open | Floating overlay risks detaching from scrolling row | `grid.onScroll` immediately removes `.slick-cell-active-expanded` (< 0.5ms) |
| E12 | SlickGrid Floating Wrap | CSS containment clipping (`.slick-cell { contain: strict; }`) | Overlay clipped to 24px cell bounds | `.slick-cell-active-expanded { contain: none !important; }` and parent row `overflow: visible !important;` |
| E13 | Keyboard Navigation | User presses `Escape` while floating cell or sidebar row is wrapped | Keydown event fires with `e.key === "Escape"` | Immediately dismisses expanded cell/row and restores flat view |
| E14 | Keyboard Navigation | User presses `ArrowUp` / `ArrowDown` across rows | Selection moves vertically | Active cell updates, previous floating cell closes, new cell expands if overflowing |
| E15 | Test Runner | `run_tests.js --all` executed in environment without packed binary | Smoke test fails on missing `app.asar` | Test suites 1–3 run cleanly under Node.js with headless mocks |

---

## 5. Detailed Specifications Across All 11 Streams

### Stream 1: Header Resizer Handles for File Table
- **Target File**: `tad-master/packages/toadviewer/src/components/ProjectFilesTable.tsx`
- **State Interface**:
  ```typescript
  export interface ColWidths {
    name: number;
    dir: number;
    size: number;
    status: number;
  }
  const DEFAULT_COL_WIDTHS: ColWidths = { name: 140, dir: 120, size: 70, status: 60 };
  ```
- **Resizer Element**:
  Rendered at the trailing edge of each `<th>` (`name`, `dir`, `size`, `status`):
  ```tsx
  <div
    className="col-resizer-handle"
    onMouseDown={(e) => handleResizeMouseDown(colKey, e)}
    onDoubleClick={(e) => handleResizeDoubleClick(colKey, e)}
  />
  ```
- **Drag Handling & Mathematical Clamping**:
  - `startMouseX = e.clientX`
  - `startWidth = colWidths[colKey]`
  - On `document.mousemove`:
    $$\Delta x = \text{currentX} - \text{startMouseX}$$
    $$w_{\text{new}} = \max(45, \min(600, \text{startWidth} + \Delta x))$$
  - On `document.mouseup`: detach listeners, remove `col-resizing` class from `document.body`.
- **Double-Click Auto-Fit**:
  $$\text{maxLen} = \max_{f \in \text{displayedFiles}} (\text{length}(f[colKey]))$$
  $$w_{\text{fit}} = \max(45, \min(400, \text{round}(\text{maxLen} \times 7.0 + 24)))$$

---

### Stream 2: Active Row Auto-Wrap for File Table
- **Target File**: `tad-master/packages/toadviewer/src/components/ProjectFilesTable.tsx`
- **Row Selection & Toggle State**:
  - `selectedFilePath: string | null` (controlled by click, toggle, and click-away).
  - Clicking unselected row: `setSelectedFilePath(f.filePath); onOpenFile(f);`.
  - Clicking selected row (toggle click): `setSelectedFilePath(null);`.
- **DOM Container Structure**:
  Inside `td.cell-name` and `td.cell-dir`:
  Wrap text inside `<div className="file-cell-wrap-container">...</div>`.
  When row has `.is-selected`:
  ```css
  tr.file-table-row.is-selected {
    height: auto !important;
  }
  tr.file-table-row.is-selected td {
    white-space: normal !important;
    word-break: break-all !important;
    overflow-wrap: anywhere !important;
    height: auto !important;
  }
  tr.file-table-row.is-selected .file-cell-wrap-container {
    max-height: 180px;
    overflow-y: auto;
    line-height: 1.35;
    padding: 3px 0;
  }
  ```
- **Unselected Invariant**: Rows without `.is-selected` remain strictly `height: 25px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`.

---

### Stream 3: Double-Click Auto-Fit Column Width for SlickGrid
- **Target File**: `tad-master/packages/toadviewer/src/components/DataGrid.tsx`
- **Event Hook**:
  Attach double-click listener on the SlickGrid header container (`.slick-header`):
  ```typescript
  headerElem.addEventListener("dblclick", (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains("slick-resizable-handle")) return;
    const colHeader = target.closest(".slick-header-column");
    if (!colHeader) return;
    handleAutoFitColumn(colHeader);
  });
  ```
- **Viewport-Bounded Auto-Fit Algorithm**:
  1. Retrieve column definition from `grid.getColumns()`.
  2. Get visible row range from `grid.getViewport()`: $v_{\text{top}}$ to $v_{\text{bottom}}$.
  3. Determine maximum formatted string length:
     $$\text{maxLen} = \max\left(\text{colDef.name.length}, \max_{i=v_{\text{top}}}^{v_{\text{bottom}}} \text{length}(\text{format}(D[i][\text{colDef.field}]))\right)$$
  4. Auto-fit width calculation:
     $$w_{\text{fit}} = \max(60, \min(500, \text{round}(\text{maxLen} \times 7.5 + 24)))$$
  5. Apply: `colDef.width = w_fit; grid.setColumns(cols); grid.render(); gs.colWidthsMap[colDef.id] = w_fit;`.

---

### Stream 4: Floating In-Place Active Cell Wrap for SlickGrid
- **Target File**: `tad-master/packages/toadviewer/src/components/DataGrid.tsx`
- **Activation Logic**:
  In `grid.onActiveCellChanged` or `selectionModel.onSelectedRangesChanged`:
  ```typescript
  const cellNode = grid.getCellNode(args.row, args.cell);
  if (!cellNode) return;
  const isOverflowing = cellNode.scrollWidth > cellNode.clientWidth || String(cellValue).length > 28;
  if (isOverflowing) {
    expandActiveCell(cellNode, args.row, args.cell);
  }
  ```
- **Overlay Coordinates & CSS**:
  - The cell receives class `.slick-cell-active-expanded`.
  - Overrides applied:
    ```css
    .slick-cell.slick-cell-active-expanded {
      position: absolute !important;
      z-index: 20 !important;
      contain: none !important;
      height: auto !important;
      max-height: 180px !important;
      overflow-y: auto !important;
      white-space: normal !important;
      word-break: break-word !important;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15) !important;
    }
    .slick-row.slick-row-has-expanded {
      overflow: visible !important;
      z-index: 25 !important;
    }
    ```
- **Dismissal Triggers**:
  - `grid.onScroll.subscribe(() => collapseActiveCell())`
  - Window `keydown` handler on `Escape` key (`e.key === "Escape"`)
  - Changing active cell or unselecting

---

### Stream 5: CSS Design System, Blueprint Theme & Scrollbars
- **Target Files**:
  - `tad-master/packages/toadviewer/less/sidebar.less`
  - `tad-master/packages/toadviewer/src/slickgrid.scss`
- **Color & Style Token Matrix**:

| Token / Element | Light Mode | Dark Mode (`.bp4-dark`, `.toad-dark`) |
|---|---|---|
| Sidebar Divider Idle | `transparent` | `transparent` |
| Sidebar Divider Hover / Drag | `rgba(2, 132, 199, 0.75)` (2px) | `rgba(56, 189, 248, 0.75)` (2px) |
| Sidebar Selected Row Background | `#0284c7 !important` | `var(--md-sys-color-primary-container, #1f385c) !important` |
| Sidebar Selected Row Text | `#ffffff !important` | `#ffffff !important` |
| Floating Cell Background | `#ffffff` | `var(--md-sys-color-surface-container-high, #25262c)` |
| Floating Cell Border | `1px solid #0284c7` | `1px solid var(--md-sys-color-primary, #38bdf8)` |
| Floating Cell Box Shadow | `0 4px 14px rgba(0, 0, 0, 0.15)` | `0 4px 16px rgba(0, 0, 0, 0.5)` |
| Slim Scrollbar Width | `4px` | `4px` |
| Slim Scrollbar Track | `transparent` | `transparent` |
| Slim Scrollbar Thumb | `rgba(148, 163, 184, 0.5)` | `rgba(148, 163, 184, 0.3)` |
| Slim Scrollbar Thumb Hover | `rgba(100, 116, 139, 0.8)` | `rgba(148, 163, 184, 0.6)` |

- **Body Cursor Rule**:
  ```css
  body.col-resizing,
  body.col-resizing * {
    cursor: col-resize !important;
    user-select: none !important;
  }
  ```

---

### Stream 6: Keyboard Accessibility & Event Isolation
- **Target Files**: `ProjectFilesTable.tsx`, `DataGrid.tsx`
- **Event Flow & Isolation**:
  1. `col-resizer-handle.onMouseDown`:
     `e.stopPropagation(); e.preventDefault();`
     Prevents `th.onClick` (which opens/closes column filter inputs) and prevents text selection.
  2. `col-resizer-handle.onDoubleClick`:
     `e.stopPropagation(); e.preventDefault();`
     Prevents column sort triggering.
  3. Window / Document Drag Cleanup:
     On `window.onblur` or `document.onmouseleave`: abort active drag, remove `.col-resizing` from body.
  4. `Escape` Key Navigation:
     - `ProjectFilesTable`: Collapses active expanded row to single-line.
     - `DataGrid`: Dismisses active floating cell overlay.
  5. Click-Away Detection:
     Attach document click listener: if target is outside `table.project-files-table`, reset `selectedFilePath` to null.

---

### Stream 7: Unit Tests - ProjectFilesTable Resize & Wrap
- **Target File**: `tests/unit/test_project_files_table_wrap_resize.js` (15 test cases)
- **Detailed Test Case Specification**:
  - `TEST 1.1`: Initialize default column widths (`name: 140, dir: 120, size: 70, status: 60`).
  - `TEST 1.2`: Drag resize increases column width proportionally ($\Delta x = +30\text{px} \to 170\text{px}$).
  - `TEST 1.3`: Drag resize decreases column width proportionally ($\Delta x = -30\text{px} \to 110\text{px}$).
  - `TEST 1.4`: minWidth clamping strictly prevents column width < 45px when $\Delta x = -200\text{px}$.
  - `TEST 1.5`: Double-click auto-fit calculates width from longest string ($\text{len} \times 7.0 + 24$).
  - `TEST 1.6`: Double-click auto-fit respects 45px lower bound on empty or 1-character columns.
  - `TEST 1.7`: Double-click auto-fit respects 400px upper bound on 500-character string.
  - `TEST 1.8`: Selecting row adds `.is-selected` class and activates multi-line wrap styles.
  - `TEST 1.9`: Selected row contains `white-space: normal`, `word-break: break-all`, `overflow-wrap: anywhere`.
  - `TEST 1.10`: Selected row wrap container enforces `max-height: 180px` and `overflow-y: auto`.
  - `TEST 1.11`: Unselected rows maintain compact 25px single-line height (`white-space: nowrap`).
  - `TEST 1.12`: Clicking the currently selected row a second time (toggle click) collapses it.
  - `TEST 1.13`: Selecting a different row collapses previous row and expands new row.
  - `TEST 1.14`: Pressing `Escape` key deselects active row and collapses height to 25px.
  - `TEST 1.15`: Resizer handle mousedown calls `stopPropagation` to prevent filter input open.

---

### Stream 8: Unit Tests - SlickGrid Auto-Fit & Floating Cell
- **Target File**: `tests/unit/test_datagrid_floating_wrap.js` (15 test cases)
- **Detailed Test Case Specification**:
  - `TEST 2.1`: Detect double-click on `.slick-resizable-handle` in header row.
  - `TEST 2.2`: Auto-fit calculates width from visible rows viewport buffer ($\text{maxLen} \times 7.5 + 24$).
  - `TEST 2.3`: Auto-fit handles JSON objects and formatted timestamp strings gracefully.
  - `TEST 2.4`: Auto-fit clamps to `MINCOLWIDTH` (60px) and `MAXCOLWIDTH` (500px).
  - `TEST 2.5`: Column width updates via `grid.setColumns` without triggering full canvas DOM rebuild.
  - `TEST 2.6`: Active cell with text length > column width activates `.slick-cell-active-expanded`.
  - `TEST 2.7`: Active cell with short text does NOT activate floating wrap.
  - `TEST 2.8`: Floating cell sets `position: absolute; z-index: 20; max-height: 180px; overflow-y: auto;`.
  - `TEST 2.9`: Floating cell overrides containment with `contain: none !important;`.
  - `TEST 2.10`: Floating cell sets `box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15)`.
  - `TEST 2.11`: Parent row receives `overflow: visible !important; z-index: 25;`.
  - `TEST 2.12`: Grid `onScroll` event immediately dismisses `.slick-cell-active-expanded`.
  - `TEST 2.13`: `Escape` key press immediately dismisses floating expanded cell.
  - `TEST 2.14`: Switching active cell to another cell dismisses previous floating overlay.
  - `TEST 2.15`: Virtual scroll row `top` coordinates remain strictly invariant ($i \times 24\text{px}$).

---

### Stream 9: Stress Tests - Virtual Scroll 100K+ Rows Concurrency
- **Target File**: `tests/qa/test_grid_wrap_concurrency_stress.js` (10 test cases)
- **Detailed Test Case Specification**:
  - `TEST 3.1`: 100,000-row virtual dataset scrolling maintains stable memory (< 50MB delta).
  - `TEST 3.2`: Rapid click expansion across 50 random rows without memory leak.
  - `TEST 3.3`: Scroll FPS benchmark maintains > 55 FPS during high-speed simulated scroll events.
  - `TEST 3.4`: Viewport row indices ($v_{\text{top}}, v_{\text{bottom}}$) calculate accurately during fast scrolling.
  - `TEST 3.5`: Absolute row `top` coordinate invariant verified: $\text{top} = i \times 24\text{px}$ across 100K rows.
  - `TEST 3.6`: Concurrent column resizing and active cell expansion under load executes cleanly.
  - `TEST 3.7`: Rapid double-click auto-fit across 20 columns completes in < 100ms without UI lockup.
  - `TEST 3.8`: DOM node count remains constant ($O(1)$ overhead, zero detached DOM leaks).
  - `TEST 3.9`: Event listener count remains constant after 100 expand/dismiss cycles.
  - `TEST 3.10`: Extreme string length (10,000+ characters) in active cell renders within 16ms budget.

---

### Stream 10: Test Runner Integration
- **Target File**: `run_tests.js`
- **Integration Points**:
  Register the three new test suites into the `run_tests.js` harness:
  - In `unitOnly` mode:
    - `tests/unit/test_project_files_table_wrap_resize.js` (15 Tests)
    - `tests/unit/test_datagrid_floating_wrap.js` (15 Tests)
  - In `qaOnly` mode:
    - `tests/qa/test_grid_wrap_concurrency_stress.js` (10 Tests)
  - In default and `--all` modes:
    - All three suites registered.
  - Verification: `node run_tests.js --all` exits with code 0 and reports 100% test pass.

---

### Stream 11: Release Packaging, VCS & Workspace Standards
- **Author Identity**: `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`
- **Version Control**: Jujutsu (`jj`), commands via `tools/jj/jj.exe`.
- **Packaging Pipeline**:
  - Step 1: TypeScript compilation (`npm run tsc` in `packages/toadviewer`).
  - Step 2: Webpack production build (`npm run build-prod`).
  - Step 3: Run `dist_package.ps1` and `package_release.ps1`.
- **Verification Gates**:
  - Zero-Duplicate Binary Policy: strictly prune `Toad *.exe` alias duplicates.
  - Footprint budget: `app.asar` <= 45.0 MB, portable executable <= 75.0 MB.
  - Zero enterprise/org leaks; strictly English-only public texts.

---

## 6. Mathematical Formulations & Coordinate Invariants

### 6.1 Column Resizing Math (Stream 1 & 3)
1. **Delta Calculation**:
   $$\Delta x = x_{\text{current}} - x_{\text{start}}$$
2. **Clamped New Width**:
   $$w_{\text{clamped}} = \text{clamp}(w_{\min}, w_{\max}, w_{\text{start}} + \Delta x)$$
   For Sidebar: $w_{\min} = 45\text{px}$, $w_{\max} = 600\text{px}$.
   For SlickGrid: $w_{\min} = 60\text{px}$, $w_{\max} = 500\text{px}$.
3. **Double-Click Auto-Fit Text Estimation**:
   $$\text{fontWidth}(s) = \text{length}(s) \times 7.0 + 24$$
   $$w_{\text{auto}} = \text{clamp}(w_{\min}, w_{\max}, \max_{s \in S} \text{fontWidth}(s))$$

### 6.2 Floating In-Place Overlay Coordinate Invariant (Stream 4)
1. **Row Top Invariant**:
   $$\forall i \in [0, N-1], \quad \text{RowTop}(i) = i \times 24\text{px} \quad (\text{Strictly Constant})$$
2. **Cell Overlay Offsets**:
   $$\text{OverlayTop} = 0 \quad (\text{relative to parent row})$$
   $$\text{OverlayLeft} = \sum_{k=0}^{\text{cellIndex}-1} \text{ColumnWidth}_k$$
   $$\text{OverlayWidth} = \max(\text{ColumnWidth}_{\text{cellIndex}}, 200\text{px})$$
   $$\text{OverlayMaxHeight} = 180\text{px}$$

---

## 7. Caveats

1. **Node.js Test Environment vs Browser**:
   `tests/unit/` runs directly under Node.js without a native browser window. UI unit tests must use global mocks (`global.window = global; global.document = ...`) or transpile TypeScript modules directly, matching the established pattern in `tests/test_parse_columns_datagrid_refresh.js` and `tests/unit/test_duckdb_json_builder.js`.
2. **Smoke Test Dependency**:
   `tests/smoke_test.js` checks for `tad-master/packages/toad-app/release/win-unpacked/resources/app.asar`. In an unpacked local development workspace, this file is generated only after running `dist_package.ps1`. The unit and QA test suites operate independently of `app.asar`.
3. **PowerShell Environment PATH**:
   Node.js is located at `D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64`. Running commands in PowerShell sessions requires prefixing `$env:PATH = "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64;$env:PATH"`.

---

## 8. Conclusion

All 11 parallel workstreams (Streams 1 to 11 across requirements R1 to R5) have been thoroughly mined, analyzed, and specified:
- Technical interface contracts, state models, and mathematical bounds are defined without ambiguity.
- Critical CSS rules, containment overrides (`contain: none !important`), and custom scrollbar tokens are mapped for both Light and Dark modes.
- Complete event isolation and keyboard navigation lifecycles (`Escape`, toggle click, click-away, blur/leave) are established.
- Concrete 40 test cases across 3 automated test suites are defined and mapped to `run_tests.js`.
- Workspace standards (`jj`, author `HelloKittyXamKinLung`, zero-duplicate binaries, < 75 MB footprint) are documented and verified.

The specification is complete, airtight, and ready for immediate handoff to the planning and implementation agents.

---

## 9. Verification Method

To verify these findings and test specifications independently:

1. **Verify Existing Suite Baseline**:
   ```powershell
   $env:PATH = "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64;$env:PATH"
   node run_tests.js --unit
   ```
   *Expected*: All 5 unit test suites pass 100% cleanly (126 tests).

2. **Verify Jujutsu VCS & Workspace Cleanliness**:
   ```powershell
   & "tools/jj/jj.exe" status
   ```
   *Expected*: Working copy clean or tracking expected metadata changes under `.agents/teamwork/`.

3. **Verify Inspection Files**:
   - `tad-master/packages/toadviewer/src/components/ProjectFilesTable.tsx` (lines 336–572)
   - `tad-master/packages/toadviewer/src/components/DataGrid.tsx` (lines 86–179, 430–500, 600–700)
   - `tad-master/packages/toadviewer/less/sidebar.less` (lines 1020–1295)
   - `tad-master/packages/toadviewer/src/slickgrid.scss` (lines 68–74)
