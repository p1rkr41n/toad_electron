# Project: Column Resizing and Active Row Auto-Wrap (ToadViewer)

## Architecture
- **Sidebar File Management Table (`ProjectFilesTable.tsx` & `sidebar.less`)**:
  - HTML table layout (`table-layout: fixed; width: 100%`).
  - Draggable divider handles (`col-resizer-handle`) positioned on trailing edges of `<th>` (`name`, `dir`, `size`, `status`).
  - Width state: `colWidths: ColWidths = { name, dir, size, status }`, clamped to `MIN_COL_WIDTH = 45px`.
  - Double-click auto-fit: estimates width from longest visible text in column.
  - Active row wrap: `.is-selected` activates `white-space: normal; word-break: break-all; overflow-wrap: anywhere; max-height: 180px; overflow-y: auto;` via custom slim scrollbars (4px, 2px radius).
  - Collapse lifecycle: toggle re-click, outside click-away, and `Escape` key.
  - Event isolation: `e.stopPropagation()` and `e.preventDefault()` on divider dragging; cleanup on `window.onblur` and `document.mouseleave`.

- **Main Data Grid (`DataGrid.tsx` & `slickgrid.scss`)**:
  - Virtual scroll table (SlickGrid) with fixed row height (24px).
  - Double-click auto-fit: intercept `dblclick` on `.slick-resizable-handle` in header row, calculate max string width across visible rows (`dataView.getItem(i)`), clamped between 60px and 500px, update `grid.setColumns` and `colWidthsMap`.
  - Floating In-Place Active Cell Wrap: when active cell content overflows (`scrollWidth > clientWidth` or text length > 28), apply `.slick-cell-active-expanded` (`position: absolute; z-index: 20; contain: none !important; max-height: 180px; overflow-y: auto; white-space: normal; word-break: break-word; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15)`).
  - Parent row receives `.slick-row.slick-row-has-expanded` (`z-index: 25 !important; overflow: visible !important;`).
  - Strict Virtual Invariant: Row coordinates remain $\text{top} = i \times 24\text{px}$.
  - Dismissal: immediately dismissed on `grid.onScroll`, `grid.onViewportChanged`, and `Escape` key.

- **Automated QA & Runner (`run_tests.js`, `tests/unit/`, `tests/qa/`)**:
  - Headless Node.js testing harness using native `assert`.
  - 15 unit tests for `ProjectFilesTable` wrap & resize.
  - 15 unit tests for `DataGrid` floating wrap & auto-fit.
  - 10 stress tests for 100K-row virtual scroll concurrency, FPS (> 55 FPS), coordinate preservation, and memory stability.

- **Packaging & VCS Pipeline (`dist_package.ps1`, `package_release.ps1`, `jj`)**:
  - TypeScript compilation & Webpack production bundling.
  - Executable footprint < 75 MB, zero duplicate binaries.
  - Jujutsu commits under `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Sidebar Resizer Handles | Draggable handles on Name, DirPath, Size, Status in `ProjectFilesTable.tsx` with minWidth 45px clamping | M1 | Survey F1 |
| F2 | Sidebar Double-Click Auto-Fit | Double-click header divider to auto-fit to longest visible text | M1 | Survey F2 |
| F3 | Sidebar Active Row Auto-Wrap | Selected row expands height and wraps multiline file name / dir path with max-height 180px | M1 | Survey F3 |
| F4 | Sidebar Row Collapse Lifecycle | Unselects / collapses expanded row on toggle click, click-away, or Escape key | M1 | Survey F4 |
| F5 | Sidebar Styling & Themes | Blueprint Light & Dark styles in `sidebar.less`, custom 4px slim scrollbars, body `.col-resizing` | M1 | Survey F8, F9 |
| F6 | Sidebar Event Isolation | `e.stopPropagation()` on resizer mousedown/dblclick, window blur/leave cleanup | M1 | Survey F10, F11 |
| F7 | SlickGrid Double-Click Auto-Fit | Auto-fits column width on `.slick-resizable-handle` dblclick using visible rows (60px to 500px clamp) | M2 | Survey F5 |
| F8 | SlickGrid Floating Cell Wrap | `.slick-cell-active-expanded` floating in-place with z-index 20, shadow, max-height 180px, contain none | M2 | Survey F6 |
| F9 | SlickGrid Coordinate Invariance | Virtual scroll row coordinates strictly preserved (`top = i * 24px`) without layout disruption | M2 | Survey F6, Spec |
| F10 | SlickGrid Floating Dismissal | Floating cell dismissed on `grid.onScroll`, `grid.onViewportChanged`, cell change, or Escape | M2 | Survey F7 |
| F11 | SlickGrid Styling & Themes | Light & Dark styles in `slickgrid.scss`, divider highlight, custom slim scrollbar | M2 | Survey F8, F9 |
| F12 | Unit Tests: File Table | 15 test cases in `tests/unit/test_project_files_table_wrap_resize.js` | M3 | Survey F12 |
| F13 | Unit Tests: DataGrid | 15 test cases in `tests/unit/test_datagrid_floating_wrap.js` | M3 | Survey F12 |
| F14 | Stress Tests: Virtual Concurrency | 10 test cases in `tests/qa/test_grid_wrap_concurrency_stress.js` (100K rows, >55 FPS, memory guard) | M3 | Survey F12 |
| F15 | Test Runner Integration | Register suites in `run_tests.js` so that `node run_tests.js --all` passes 100% | M3 | Survey F12 |
| F16 | Packaging & Zero-Duplicate Gate | Compile TypeScript, run Webpack, `dist_package.ps1`, `package_release.ps1`, size < 75 MB, jj commits | M4 | Survey F13 |
| F17 | Gate Verification & Review | 2 Reviewers, 2 Challengers, 1 Forensic Auditor gate verification | M5 | Process |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Sidebar Table Resizing & Auto-Wrap | `ProjectFilesTable.tsx`, `sidebar.less` (F1–F6) | none | DONE |
| M2 | Main DataGrid Auto-Fit & Floating Wrap | `DataGrid.tsx`, `slickgrid.scss` (F7–F11) | none | DONE |
| M3 | E2E Testing Track: Suites & Runner | 3 test suites (F12–F14) and `run_tests.js` (F15) | none | DONE |
| M4 | Release Packaging & Jujutsu VCS | TypeScript build, Webpack, packaging scripts, jj (F16) | M1, M2 | DONE |
| M5 | Final Milestone: Gate Verification | Full E2E verification, 2 Reviewers, 2 Challengers, 1 Auditor (F17) | M1, M2, M3, M4 | DONE |

---

## Interface Contracts

### 1. `ProjectFilesTable.tsx` State & Interfaces
```typescript
export interface ColWidths {
  name: number;
  dir: number;
  size: number;
  status: number;
}

export const DEFAULT_COL_WIDTHS: ColWidths = {
  name: 140,
  dir: 120,
  size: 70,
  status: 60,
};

export const MIN_COL_WIDTH = 45;
export const MAX_COL_WIDTH = 400;
```
- `handleResizeMouseDown(col: TableSortCol, e: React.MouseEvent)`:
  - Invokes `e.stopPropagation()` and `e.preventDefault()`.
  - Attaches `mousemove` and `mouseup` to `document`.
  - Adds `document.body.classList.add("col-resizing")`.
  - Clamps: $w_{\text{new}} = \max(45, w_{\text{start}} + \Delta x)$.
  - Cleans up on `mouseup` or `window.onblur`.
- `handleAutoFit(col: TableSortCol, e: React.MouseEvent)`:
  - Invokes `e.stopPropagation()` and `e.preventDefault()`.
  - Measures visible rows, calculates $w_{\text{fit}} = \text{clamp}(45, 400, \text{round}(\text{maxLen} \times 7.0 + 24))$.
- Row selection & wrap:
  - Selected row gets `.is-selected`, wraps text up to `max-height: 180px; overflow-y: auto;`.
  - Toggle click, click-away, and `Escape` reset selected row.

### 2. `DataGrid.tsx` Interfaces & SlickGrid Hooks
```typescript
const autoFitGridColumn = (grid: any, colId: string, props: DataGridProps) => void;
```
- Listens for `dblclick` on `.slick-resizable-handle` in header row.
- Measures visible viewport rows ($v_{\text{top}}$ to $v_{\text{bottom}}$), clamps to $[60, 500]\text{px}$.
- Floating Cell Lifecycle:
  - `expandActiveCell(row, cell)`: attaches `.slick-cell-active-expanded` to cell and `.slick-row-has-expanded` to row.
  - Coordinates: relative `left` offset unchanged, `top: 0`, `contain: none !important; z-index: 20; max-height: 180px; overflow-y: auto;`.
  - `dismissFloatingCell()`: called on `grid.onScroll`, `grid.onViewportChanged`, active cell switch, and `Escape` key.

### 3. Test Suites & Runner Contracts
- Each test file in `tests/unit/` and `tests/qa/` runs as a standalone Node script.
- Must exit `0` on success and `1` on assertion failure.
- `run_tests.js` registers:
  - `tests/unit/test_project_files_table_wrap_resize.js` (15 test cases)
  - `tests/unit/test_datagrid_floating_wrap.js` (15 test cases)
  - `tests/qa/test_grid_wrap_concurrency_stress.js` (10 test cases)

---

## Code Layout
- `tad-master/packages/toadviewer/src/components/ProjectFilesTable.tsx`: Owned by M1 Worker
- `tad-master/packages/toadviewer/less/sidebar.less`: Owned by M1 Worker
- `tad-master/packages/toadviewer/src/components/DataGrid.tsx`: Owned by M2 Worker
- `tad-master/packages/toadviewer/src/slickgrid.scss`: Owned by M2 Worker
- `tests/unit/test_project_files_table_wrap_resize.js`: Owned by M3 Test Writer
- `tests/unit/test_datagrid_floating_wrap.js`: Owned by M3 Test Writer
- `tests/qa/test_grid_wrap_concurrency_stress.js`: Owned by M3 Test Writer
- `run_tests.js`: Owned by M3 Test Writer
