# Project: Intelligent Line Calculation, Dynamic Auto-Wrap & Parse Columns Refactor

## Architecture
- **Squad 1: Core Mathematical Engine & Global Event Bus (`CellLineCalculator.ts`, `GridOverlayBus.ts`)**:
  - Pure mathematical line calculation module (`calculateLineCount(text, colWidth, options)`):
    - Uses Canvas 2D context (`measureText`) in browser environment.
    - Uses deterministic character-width heuristic fallback ($C_w = 7.5\text{px}$ or $7.0\text{px}$) in headless Node.js CLI testing environments.
    - Preserves explicit newlines (`\r\n|\r|\n`), handles null/undefined/empty string ($N=1$), numbers, timestamps, and unbroken strings.
  - Height & Scroll State Mapper (`getHeightAndScrollState(N, lineHeight = 17, padding = 8, defaultHeight = 24)`):
    - $N \le 1$: `{ shouldExpand: false, height: 24, overflowY: "hidden", hasScrollbar: false }` (flat single-line, no expansion, no scrollbar).
    - $2 \le N \le 5$: `{ shouldExpand: true, height: N * 17 + 8, overflowY: "hidden", hasScrollbar: false }` (exact fit, no scrollbar).
    - $N > 5$: `{ shouldExpand: true, height: 93, overflowY: "auto", hasScrollbar: true }` (capped at 5 lines, 4px slim scrollbar).
  - Cross-Component Overlay Event Bus (`GridOverlayBus.ts`):
    - Standardized events: `"dismiss-grid-cell-expand"`, `"parse-dialog-opened"`, `"parse-dialog-closed"`.
    - Typed dispatch and subscription helpers with safe in-memory fallback for non-DOM test environments.

- **Squad 2: Sidebar File Management Table (`ProjectFilesTable.tsx`, `sidebar.less`)**:
  - HTML table layout (`table-layout: fixed; width: 100%`).
  - Draggable divider handles (`col-resizer-handle`) on `name`, `dir`, `size`, `status` with $\ge 45\text{px}$ minWidth clamping.
  - Double-click auto-fit calculates width from visible rows.
  - Active Row Dynamic Auto-Wrap:
    - Selected row receives `.is-selected` (strictly blue highlight, white text, compact 25px height, `nowrap`).
    - When $N \ge 2$, row also receives `.is-expanded` and inline `height: heightState.height` and `overflow-y: heightState.overflowY`.
    - `sidebar.less`: Removes unconditional `height: auto !important` and `max-height: 180px` from `.is-selected`.
  - 4-Way Collapse Lifecycle: Re-click active row, click another file, click outside table, or press `Escape`.

- **Squad 3: Main SlickGrid Data Table (`DataGrid.tsx`, `slickgrid.scss`)**:
  - Virtual scrolling table (SlickGrid) with fixed 24px row height invariant.
  - Double-click header auto-fit: auto-fits column width on visible rows (clamped 60px to 500px).
  - Floating In-Place Active Cell Dynamic Wrap:
    - `tryExpandCell(row, cell)` calls `calculateLineCount`.
    - $N \le 1$: Returns immediately (flat cell, no floating element, no `.slick-cell-active-expanded`).
    - $2 \le N \le 5$: Applies inline `height = N * 17 + 8` and `overflowY = "hidden"`, `.slick-cell-active-expanded`.
    - $N > 5$: Applies inline `height = 93px` and `overflowY = "auto"`, `.slick-cell-active-expanded`.
    - Removes `max-height: 180px !important;` from `slickgrid.scss` so inline styles govern.
  - 4-Way Dismissal Lifecycle: Re-click active cell, click another cell, click outside grid (`document.mousedown`), press `Escape`, or scroll viewport.
  - Event Bus Integration: Listens for `"dismiss-grid-cell-expand"` to dismiss floating cells immediately.
  - Modal Overlay Dimming: Adds `body.bp4-overlay-open` rules in `slickgrid.scss` suppressing `.slick-cell.active`, `.slick-row.active`, `.slick-cell.selected` (transparent background, transparent border, no shadow, no outline).

- **Squad 4: Parse Columns & Nested JSON Dialog (`RegexDialog.tsx`, `NestedFieldsTable.tsx`)**:
  - Header Mode Switcher: Removes `#ntab-nested`. Header displays strictly two tabs: `[Visual]` (`#ntab-simple`) and `[Regex]` (`#ntab-adv`).
  - Unified Format Dropdown: Adds `<option value="nested_json">Nested JSON</option>` to `#minFormatSelect`.
  - Removes redundant `#btn-switch-nested` (`Auto-Flatten Available ➔`).
  - View Switch & Auto-Scan Trigger:
    - When `nested_json` selected: triggers `triggerNestedScan(100)` if fields empty and switches body to Nested JSON view (`SampleScanController`, `NestedFieldsTable`, live DuckDB SQL preview).
    - When any other format selected: reverts body to Visual sample view.
  - `handleApply`: Supports both `formatType === "nested_json"` and `mode === "nested_json"`.
  - Nested & Discovered Fields Tables: Adds column resizer handles and dynamic cell auto-wrap.

- **Squad 5: Systems QA, Packaging & Release Pipeline (`tests/`, `dist_package.ps1`, `package_release.ps1`, `jj`)**:
  - 3 New Test Suites:
    - `tests/unit/test_cell_line_calculator.js`: 25 test cases for boundary line counts ($N=1,2,5,6,100$), widths ($45\text{px}-1200\text{px}$), special characters, and nested JSON.
    - `tests/unit/test_parse_dialog_nested_dropdown.js`: 15 test cases verifying tab switcher, format dropdown switching, and auto-scan trigger.
    - `tests/qa/test_modal_cell_glow_suppression.js`: 10 test cases verifying grid active cell reset and highlight suppression on modal open.
  - Existing Test Suite Updates: Updates assertions in `test_project_files_table_wrap_resize.js`, `test_datagrid_floating_wrap.js`, and `test_grid_wrap_concurrency_stress.js` from static 180px to dynamic $N$-line boundaries.
  - Runner Registration: Registers all 21 suites in `run_tests.js` (target 575+ tests, 100% PASS).
  - Production Packaging: Clean cache via `tools/clean_cache.ps1`, compile TypeScript, build Webpack, package single `Toad.exe` at root and `Toad-2.5.1-x64-portable.*` in `releases/`.
  - Jujutsu VCS: Commit under `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>` with 100% professional English messages.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F01 | Pure Math Line Calculator | Canvas 2D measurement + Node character heuristic ($C_w = 7.5\text{px}$) in `CellLineCalculator.ts` | M1 | Plan E01 |
| F02 | Height & Scroll State Mapper | $N \le 1$ flat (24px), $2 \le N \le 5$ fit ($N \times 17 + 8$), $N > 5$ cap (93px) with scrollbar | M1 | Plan E02 |
| F03 | Global Overlay Event Bus | Standardized `"dismiss-grid-cell-expand"` event dispatcher/subscriber in `GridOverlayBus.ts` | M1 | Plan E03 |
| F04 | Unit Tests: Line Calculator | 25 test cases covering boundary counts, widths, JSON in `test_cell_line_calculator.js` | M1 | Plan E04 |
| F05 | Sidebar Row Height & Wrap | `ProjectFilesTable.tsx` calculates line counts, applies `.is-expanded` and inline height | M2 | Plan E05 |
| F06 | Sidebar Column Resizer Handles | Draggable divider handles with $\ge 45\text{px}$ minWidth clamping and double-click auto-fit | M2 | Plan E06 |
| F07 | Sidebar Styles & Slim Scrollbar | `sidebar.less` separates `.is-selected` from `.is-expanded`, adds 4px slim scrollbar | M2 | Plan E07 |
| F08 | Sidebar 4-Way Collapse & QA | Toggle click, other row, click outside, Escape; update `test_project_files_table_wrap_resize.js` | M2 | Plan E08 |
| F09 | DataGrid Dynamic Floating Sizer | `tryExpandCell` in `DataGrid.tsx` calculates $N$ lines, applies exact fit or 5-line cap | M3 | Plan E09 |
| F10 | DataGrid 4-Way Dismissal & Bus | Re-click collapse, outside click, Escape, scroll, `"dismiss-grid-cell-expand"` listener | M3 | Plan E10 |
| F11 | DataGrid Styles & Overlay Dimming | `slickgrid.scss` removes 180px override, adds `body.bp4-overlay-open` highlight suppression | M3 | Plan E11 |
| F12 | DataGrid Floating Wrap QA | Update `test_datagrid_floating_wrap.js` for dynamic $N$-line boundaries and coordinate invariance | M3 | Plan E12 |
| F13 | Parse Dialog Header Switcher | In `RegexDialog.tsx`, remove `#ntab-nested`; tabs strictly `[Visual]` and `[Regex]` | M4 | Plan E13 |
| F14 | Parse Dialog Format Dropdown | Add `nested_json` to `minFormatSelect`, remove `#btn-switch-nested`, auto-scan trigger | M4 | Plan E14 |
| F15 | Parse Dialog Apply & Table Wrap | Support `formatType === "nested_json"` in `handleApply`; add resizers/wrap in `NestedFieldsTable` | M4 | Plan E15 |
| F16 | Parse Dialog Dropdown QA | 15 test cases in `test_parse_dialog_nested_dropdown.js` for tabs, dropdown, auto-scan | M4 | Plan E16 |
| F17 | Modal Cell Glow Suppression QA | 10 test cases in `test_modal_cell_glow_suppression.js` verifying active cell reset & suppression | M5 | Plan E17 |
| F18 | Multi-Table Stress Testing | 10 test cases in `test_grid_wrap_concurrency_stress.js` (100K rows, memory guard, FPS) | M5 | Plan E18 |
| F19 | Master Test Runner Integration | Register all 21 suites in `run_tests.js`, achieving 575+ tests 100% PASS | M5 | Plan E18 |
| F20 | Production Packaging Pipeline | `clean_cache.ps1`, `dist_package.ps1`, `package_release.ps1`, zero-duplicate binaries | M5 | Plan E19 |
| F21 | Final Release & Jujutsu Audit | Zero-duplicate binary check, Jujutsu commits under HelloKittyXamKinLung, 100% English | M5 | Plan E20 |
| F22 | Gate Verification & Audit | 2 Reviewers, 2 Challengers, 1 Forensic Auditor gate verification | M6 | Process |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Squad 1: Core Mathematical Engine & Foundation | `CellLineCalculator.ts`, `GridOverlayBus.ts`, `test_cell_line_calculator.js` (F01–F04) | none | DONE |
| M2 | Squad 2: Sidebar File Management Table | `ProjectFilesTable.tsx`, `sidebar.less`, `test_project_files_table_wrap_resize.js` (F05–F08) | M1 | DONE |
| M3 | Squad 3: Main SlickGrid Data Table | `DataGrid.tsx`, `slickgrid.scss`, `test_datagrid_floating_wrap.js` (F09–F12) | M1 | DONE |
| M4 | Squad 4: Parse Columns & Nested JSON Dialog | `RegexDialog.tsx`, `NestedFieldsTable.tsx`, `test_parse_dialog_nested_dropdown.js` (F13–F16) | M1 | DONE |
| M5 | Squad 5: Systems QA, Packaging & Release | `test_modal_cell_glow_suppression.js`, `test_grid_wrap_concurrency_stress.js`, `run_tests.js`, packaging, jj (F17–F21) | M2, M3, M4 | IN_PROGRESS |
| M6 | Milestone 6: Gate Verification | Full test suite execution, 2 Reviewers, 2 Challengers, 1 Forensic Auditor (F22) | M5 | PLANNED |

---

## Interface Contracts

### 1. `CellLineCalculator.ts` Contracts
```typescript
export interface LineCalculationOptions {
  charWidth?: number;       // Default: 7.5px (or 7.0px for proportional text)
  padding?: number;         // Horizontal cell padding (default: 16px)
  font?: string;            // Default: '11px sans-serif'
}

export interface CellHeightState {
  shouldExpand: boolean;
  lineCount: number;
  height: number;
  overflowY: "hidden" | "auto";
  hasScrollbar: boolean;
  className?: string;
}

export function calculateLineCount(
  text: any,
  colWidth: number,
  options?: LineCalculationOptions
): number;

export function getHeightAndScrollState(
  lineCount: number,
  lineHeight?: number,      // Default: 17px
  vertPadding?: number,     // Default: 8px
  defaultHeight?: number    // Default: 24px (or 25px for sidebar)
): CellHeightState;
```
- Mapping rules:
  - $N \le 1$: `{ shouldExpand: false, lineCount, height: defaultHeight, overflowY: "hidden", hasScrollbar: false }`
  - $2 \le N \le 5$: `{ shouldExpand: true, lineCount, height: N * lineHeight + vertPadding, overflowY: "hidden", hasScrollbar: false }`
  - $N > 5$: `{ shouldExpand: true, lineCount, height: 5 * lineHeight + vertPadding, overflowY: "auto", hasScrollbar: true }`

### 2. `GridOverlayBus.ts` Contracts
```typescript
export const EVENT_DISMISS_GRID_CELL_EXPAND = "dismiss-grid-cell-expand";
export const EVENT_PARSE_DIALOG_OPENED = "parse-dialog-opened";
export const EVENT_PARSE_DIALOG_CLOSED = "parse-dialog-closed";

export function emitDismissGridCellExpand(): void;
export function onDismissGridCellExpand(callback: () => void): () => void;

export function emitParseDialogOpened(): void;
export function onParseDialogOpened(callback: () => void): () => void;

export function emitParseDialogClosed(): void;
export function onParseDialogClosed(callback: () => void): () => void;
```

### 3. Modal Overlay Highlight Suppression Contract
- When `body.bp4-overlay-open` is present:
  - `.slick-cell.active`, `.slick-row.active`, `.slick-cell.selected`:
    `background: transparent !important; box-shadow: none !important; outline: none !important; border-color: transparent !important;`
  - `.slick-cell-active-expanded`, `.slick-row-has-expanded`, `.slick-row-active-expanded`:
    `display: none !important;`
- In `RegexDialog.tsx` on `isOpen === true`:
  - Calls `emitDismissGridCellExpand()`
  - Removes `.slick-cell-active-expanded`, `.slick-row-has-expanded`, `.slick-row-active-expanded` DOM elements
  - Calls `grid.resetActiveCell()` if grid instance available.

---

## Code Layout
- `tad-master/packages/toadviewer/src/utils/CellLineCalculator.ts`: Owned by Squad 1 (M1)
- `tad-master/packages/toadviewer/src/utils/GridOverlayBus.ts`: Owned by Squad 1 (M1)
- `tests/unit/test_cell_line_calculator.js`: Owned by Squad 1 (M1)
- `tad-master/packages/toadviewer/src/components/ProjectFilesTable.tsx`: Owned by Squad 2 (M2)
- `tad-master/packages/toadviewer/less/sidebar.less`: Owned by Squad 2 (M2)
- `tests/unit/test_project_files_table_wrap_resize.js`: Owned by Squad 2 (M2)
- `tad-master/packages/toadviewer/src/components/DataGrid.tsx`: Owned by Squad 3 (M3)
- `tad-master/packages/toadviewer/src/slickgrid.scss`: Owned by Squad 3 (M3)
- `tests/unit/test_datagrid_floating_wrap.js`: Owned by Squad 3 (M3)
- `tad-master/packages/toadviewer/src/components/RegexDialog.tsx`: Owned by Squad 4 (M4)
- `tad-master/packages/toadviewer/src/components/NestedFieldsTable.tsx`: Owned by Squad 4 (M4)
- `tests/unit/test_parse_dialog_nested_dropdown.js`: Owned by Squad 4 (M4)
- `tests/qa/test_modal_cell_glow_suppression.js`: Owned by Squad 5 (M5)
- `tests/qa/test_grid_wrap_concurrency_stress.js`: Owned by Squad 5 (M5)
- `run_tests.js`: Owned by Squad 5 (M5)
- Packaging and Release Scripts (`dist_package.ps1`, `package_release.ps1`, `tools/clean_cache.ps1`): Owned by Squad 5 (M5)
