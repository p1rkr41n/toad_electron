# Comprehensive Codebase Survey: Tables, Dialogs, Styles & Utilities

**Survey Target**: `tad-master/packages/toadviewer/`  
**Explorer**: Teamwork Explorer (`explorer_survey_tables`)  
**Date**: 2026-11-04T18:00:00Z  
**Scope**: Read-Only Architecture & Implementation Survey for the 20-Engineer Parallel Execution Plan  

---

## Executive Summary

This survey provides an exhaustive, code-level blueprint of the ToadViewer frontend across four core areas:
1. **Mathematical Engine & Cross-Component Event Bus** (`src/utils/CellLineCalculator.ts`, `src/utils/GridOverlayBus.ts`, `src/utils/`)
2. **Sidebar File Management Table** (`src/components/ProjectFilesTable.tsx`, `less/sidebar.less`)
3. **Main SlickGrid Data Table** (`src/components/DataGrid.tsx`, `src/slickgrid.scss`)
4. **Parse Columns & Nested JSON Dialog** (`src/components/RegexDialog.tsx`, `src/components/NestedFieldsTable.tsx`, `less/nested-dialog.less`)

All findings are documented below with verified file paths, exact line numbers, current behavior, structural deficiencies relative to requirements R1–R5, and precise integration insertion points for each squad.

---

## 1. Utility Architecture Survey (`src/utils/`)

### 1.1 `src/utils/CellLineCalculator.ts`
- **Location**: `tad-master/packages/toadviewer/src/utils/CellLineCalculator.ts`
- **Current State**: File exists in workspace, 0 bytes (empty file, 1 blank line).
- **Required Implementation (Squad 1: E01, E02)**:
  - **E01 Mathematical Line Calculator**:
    ```typescript
    export interface LineCalculationOptions {
      charWidth?: number;       // Default: 7.5px (monospace/data font)
      padding?: number;         // Horizontal cell padding (default: 16px)
      font?: string;            // Default: '11px sans-serif' or '11px monospace'
    }

    export function calculateLineCount(
      text: any,
      colWidth: number,
      options?: LineCalculationOptions
    ): number;
    ```
    - **Canvas 2D Measurement**: In browser environments (`typeof document !== 'undefined' && document.createElement`), use an off-screen `<canvas>` context `ctx.measureText(segment).width`.
    - **Headless / Node Heuristic Fallback**: In test environments (`process.versions.node` without DOM), fallback to `charWidth = 7.5` (or `7.0` for proportional text).
    - **Newline Preservation**: Split raw text by `/\r\n|\r|\n/`. Compute wrapped lines for each newline segment and sum them (minimum 1 per explicit segment).
    - **Edge Cases**:
      - `null`, `undefined`, `""`, `0`, `false`: Return `1`.
      - Extreme long string without whitespace (e.g. JSON token or hash): Calculate wrapping based on `Math.ceil(textWidth / usableColWidth)`.
      - Usable column width: `Math.max(20, colWidth - padding)`.
  - **E02 Height & Scroll State Mapper**:
    ```typescript
    export interface CellHeightState {
      shouldExpand: boolean;
      lineCount: number;
      height: number;
      overflowY: "hidden" | "auto";
      hasScrollbar: boolean;
      className?: string;
    }

    export function getHeightAndScrollState(
      lineCount: number,
      lineHeight: number = 17,
      vertPadding: number = 8,
      defaultHeight: number = 24
    ): CellHeightState;
    ```
    - **Contract Rule 1 ($N \le 1$)**: Flat single line, default height (24px or 25px), `shouldExpand: false`, `overflowY: "hidden"`, `hasScrollbar: false`.
    - **Contract Rule 2 ($2 \le N \le 5$)**: Exact fit, height $= N \times 17\text{px} + 8\text{px}$ (e.g., $N=2 \to 42\text{px}$, $N=3 \to 59\text{px}$, $N=4 \to 76\text{px}$, $N=5 \to 93\text{px}$), `shouldExpand: true`, `overflowY: "hidden"`, `hasScrollbar: false`.
    - **Contract Rule 3 ($N > 5$)**: Capped at 5 lines ($H = 5 \times 17\text{px} + 8\text{px} = 93\text{px}$), `shouldExpand: true`, `overflowY: "auto"`, `hasScrollbar: true`.

### 1.2 `src/utils/GridOverlayBus.ts`
- **Location**: `tad-master/packages/toadviewer/src/utils/GridOverlayBus.ts` [NEW FILE]
- **Current State**: Does not exist in the repository.
- **Required Implementation (Squad 1: E03)**:
  - Standardized custom event dispatcher and subscriber:
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
  - Dispatches `window.dispatchEvent(new CustomEvent(...))` when `window` exists, with safe in-memory event emitter fallback for non-DOM tests.

### 1.3 Other Existing Utilities in `src/utils/`
- `DuckDbJsonSqlBuilder.ts`: Contains `escapeIdentifier(id)` and `buildCreateViewSql(options)` for generating DuckDB JSON extraction views with double quotes and arrow `->` operators.
- `NestedJsonTraverser.ts`: Contains recursive JSON leaf traversal and `inferType(value)` which categorizes primitives into `VARCHAR`, `BIGINT`, `DOUBLE`, `BOOLEAN`, or `TIMESTAMP`.
- `ForensicDecoder.ts`: Contains binary decoding routines for EVTX records and hexadecimal dumps.

---

## 2. Sidebar File Management Table Survey (`ProjectFilesTable.tsx` & `sidebar.less`)

### 2.1 Component Structure (`ProjectFilesTable.tsx`)
- **File**: `tad-master/packages/toadviewer/src/components/ProjectFilesTable.tsx` (782 lines)
- **Table Container**: Line 474: `<div className="project-table-container" ref={tableContainerRef}>`
- **Table Element**: Line 475: `<table className="project-files-table">`
- **Column Definition**: Lines 102-114:
  - `DEFAULT_COL_WIDTHS = { name: 140, dir: 120, size: 70, status: 60 }`
  - `MIN_COL_WIDTH = 45; MAX_COL_WIDTH = 400;`
  - Columns: `col-name`, `col-dir`, `col-size`, `col-status`
- **Header Resizer Handles**:
  - `Name`: Line 501: `<div className="col-resizer-handle" onMouseDown={(e) => handleResizeMouseDown("name", e)} onDoubleClick={(e) => handleAutoFit("name", e)} ... />`
  - `DirPath`: Line 545
  - `Size`: Line 589
  - `Status`: Line 633
  - **Resize Dragging Logic** (Lines 343-375):
    - `handleResizeMouseDown` adds `document.body.classList.add("col-resizing")`.
    - Clamps width: `Math.max(MIN_COL_WIDTH, draggingRef.current.startWidth + delta)`.
    - Clean teardown: Listens to `mousemove`, `mouseup`, `blur`, `mouseleave`.
  - **Auto-Fit Logic** (Lines 377-408):
    - `handleAutoFit`: Loops `displayedFiles`, finds `maxLen`, calls `calculateAutoFitWidth(maxLen)`.
    - `calculateAutoFitWidth` (Line 119): `Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, Math.round(maxLen * 7.0 + 24)))`.

### 2.2 Row Rendering & Current Selection Limitation
- **Row Mapping Loop** (Lines 667-775):
  ```tsx
  668: const isSelected = selectedRowPath
  669:   ? normPath(selectedRowPath) === normPath(f.filePath)
  670:   : false;
  ...
  674: <tr
  675:   key={f.filePath}
  676:   className={`file-table-row ${isSelected ? "is-selected" : ""}`}
  677:   onClick={() => handleRowClick(f)}
  678:   title={f.filePath}
  679: >
  ```
- **Deficiency Identified**:
  - The component only toggles `.is-selected`.
  - It **never** computes line counts or determines if text wraps.
  - It does **not** attach `.is-expanded` or apply any dynamic height or overflow styling.

### 2.3 Row Selection & 4-Way Collapse Lifecycle
- **Click to Toggle Row Selection**:
  - Lines 410-417:
    ```tsx
    const handleRowClick = (f: ProjectWorkspaceFile) => {
      if (selectedRowPath && normPath(selectedRowPath) === normPath(f.filePath)) {
        setSelectedRowPath(null); // toggle collapse (Direction 1)
      } else {
        setSelectedRowPath(f.filePath); // switch row (Direction 2)
        onOpenFile(f);
      }
    };
    ```
- **Outside Click & Escape Dismissal**:
  - Lines 222-244:
    ```tsx
    const handleOutsideClick = (e: MouseEvent) => {
      if (tableContainerRef.current && !tableContainerRef.current.contains(e.target as Node)) {
        setSelectedRowPath(null); // Direction 3
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedRowPath(null); // Direction 4
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("keydown", handleKeyDown);
    ```
  - **Observation**: The 4-way collapse lifecycle is already wired to `selectedRowPath`. However, because `is-selected` unconditionally expanded in CSS, single-line selections were expanding unnecessarily.

### 2.4 Style Deficiencies in `less/sidebar.less`
- **Location**: `tad-master/packages/toadviewer/less/sidebar.less` (Lines 1131-1204)
- **Current CSS**:
  ```less
  tbody tr.file-table-row {
    height: 25px;
    ...
    &.is-selected {
      height: auto !important;
      background-color: #0284c7 !important;
      color: #ffffff !important;

      td {
        white-space: normal !important;
        word-break: break-all !important;
        overflow-wrap: anywhere !important;
        vertical-align: top !important;
        padding-top: 5px !important;
        padding-bottom: 5px !important;
      }

      .cell-name {
        height: auto !important;
        ...
        .file-name-wrap, .file-name-text {
          white-space: normal !important;
          word-break: break-all !important;
          max-height: 180px;
          overflow-y: auto;
          display: block;
        }
      }
      .cell-dir {
        .file-dir-wrap, .file-dir-text {
          white-space: normal !important;
          word-break: break-all !important;
          max-height: 180px;
          overflow-y: auto;
          display: block;
        }
      }
    }
  }
  ```
- **Analysis of Problem**:
  - `&.is-selected` unconditionally sets `height: auto !important;`, forcing every selected file (even `short.csv`) to expand and wrap.
  - `max-height: 180px; overflow-y: auto;` violates the 5-line cap contract ($H \approx 93\text{px}$).
- **Required Squad 2 Insertion Point (E05, E07)**:
  - **In `sidebar.less`**:
    - Retain `.file-table-row.is-selected`: Only blue background (`#0284c7` / dark `#1f385c`) and white text. Height remains flat `25px`, `white-space: nowrap`, `vertical-align: middle`.
    - Create `.file-table-row.is-selected.is-expanded`: Apply `white-space: normal`, `word-break: break-all`, `vertical-align: top`.
    - Remove hardcoded `max-height: 180px` from `.file-name-wrap` and `.file-dir-wrap`. Allow inline `height` and `overflow-y` to govern.
  - **In `ProjectFilesTable.tsx`**:
    - When `isSelected`:
      ```tsx
      const nameLines = calculateLineCount(f.fileName, colWidths.name - 24);
      const dirLines = calculateLineCount(f.relDir, colWidths.dir - 12);
      const lineCount = Math.max(nameLines, dirLines);
      const heightState = getHeightAndScrollState(lineCount, 17, 8, 25);
      ```
    - If `heightState.shouldExpand`: add `is-expanded` class and apply inline `heightState.height` and `heightState.overflowY`.

---

## 3. Main SlickGrid Data Table Survey (`DataGrid.tsx` & `slickgrid.scss`)

### 3.1 Floating Cell Architecture (`DataGrid.tsx`)
- **File**: `tad-master/packages/toadviewer/src/components/DataGrid.tsx` (1,733 lines)
- **Cell Expansion State Variables** (Lines 574-575):
  ```ts
  let currentExpandedCellNode: HTMLElement | null = null;
  let currentExpandedRowNode: HTMLElement | null = null;
  ```
- **Dismissal Implementation** (`dismissFloatingCell`, Lines 577-603):
  - Removes `.slick-cell-active-expanded` from `currentExpandedCellNode`.
  - Removes `.slick-row-has-expanded` and `.slick-row-active-expanded` from `currentExpandedRowNode`.
  - Queries container for any orphan `.slick-cell-active-expanded` and `.slick-row-has-expanded` and cleans them up.
- **Current `tryExpandCell` Implementation** (Lines 605-654):
  ```ts
  const tryExpandCell = (row: number, cell: number) => {
    dismissFloatingCell();
    ...
    const cellNode = typeof grid.getCellNode === "function" ? (grid.getCellNode(row, cell) as HTMLElement) : null;
    if (!cellNode) return;

    const textContent = (cellNode.textContent || "").trim();
    const textLen = textContent.length;
    // Overflow condition: scrollWidth > clientWidth or text length > 28
    const isOverflowing = cellNode.scrollWidth > cellNode.clientWidth || textLen > 28;

    if (isOverflowing) {
      cellNode.classList.add("slick-cell-active-expanded");
      currentExpandedCellNode = cellNode;

      const rowNode = (cellNode.closest ? cellNode.closest(".slick-row") : cellNode.parentElement) as HTMLElement;
      if (rowNode) {
        rowNode.classList.add("slick-row-has-expanded");
        rowNode.classList.add("slick-row-active-expanded");
        currentExpandedRowNode = rowNode;
      }
    }
  };
  ```

### 3.2 Current Deficiencies in `DataGrid.tsx`
1. **Uncalibrated Expansion**:
   - Checks only `scrollWidth > clientWidth || textLen > 28`.
   - Does not calculate $N$ lines using `CellLineCalculator`.
   - Never applies dynamic inline height or distinguishes between $2 \le N \le 5$ (overflow: hidden) and $N > 5$ (overflow: auto).
2. **Missing Outside Click Handler**:
   - `DataGrid.tsx` lacks a document `mousedown` listener to dismiss the expanded cell when clicking outside the grid viewport.
3. **No Re-Click Toggle Collapse**:
   - In `grid.onClick` (Line 965), clicking on the already expanded cell does not toggle it back to collapsed.
4. **No Overlay Bus Integration**:
   - `DataGrid` does not listen for `"dismiss-grid-cell-expand"` or `"parse-dialog-opened"`.
5. **Event Teardown Gaps**:
   - `grid.destroy` (Lines 931-938) only removes `handleGridEscape`. Any newly added listeners must be unregistered in `grid.destroy`.

### 3.3 Style Survey in `src/slickgrid.scss`
- **Location**: `tad-master/packages/toadviewer/src/slickgrid.scss`
- **Floating Active Cell Rules** (Lines 105-146):
  ```scss
  .slick-row.slick-row-has-expanded,
  .slick-row.slick-row-active-expanded {
    overflow: visible !important;
    z-index: 25 !important;
  }

  .slick-cell.slick-cell-active-expanded {
    position: absolute !important;
    z-index: 20 !important;
    contain: none !important;
    height: auto !important;
    min-height: 24px !important;
    max-height: 180px !important; // PROBLEM: Hardcoded 180px override!
    overflow-y: auto !important;  // PROBLEM: Hardcoded scrollbar override!
    overflow-x: hidden !important;
    white-space: normal !important;
    word-break: break-word !important;
    background: #ffffff !important;
    color: #0f172a !important;
    border: 1px solid #0284c7 !important;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15) !important;
    border-radius: 3px;
    padding: 3px 6px !important;
    box-sizing: border-box !important;
  }
  ```
- **Dark Mode Overrides** (Lines 230-248):
  - `.slick-cell.slick-cell-active-expanded` overrides background to `#25262c`, border to `#38bdf8`.
- **CRITICAL DEFICIENCY: Missing Overlay Suppression**:
  - `src/slickgrid.scss` currently contains **zero** rules referencing `bp4-overlay-open`.
  - When Blueprint modal opens, `body.bp4-overlay-open` is attached to `<body>`, but underlying SlickGrid cells (`.slick-cell.active`, `.slick-row.active`, `.slick-cell.selected`) continue to display high-contrast highlights (`rgba(138, 180, 248, 0.16)` or light theme blue outline), causing visual bleed-through behind the overlay.

---

## 4. Parse Columns & Nested JSON Dialog Survey (`RegexDialog.tsx` & `NestedFieldsTable.tsx`)

### 4.1 Mode Switcher Tabs (`RegexDialog.tsx`)
- **Location**: Lines 1504-1588 of `tad-master/packages/toadviewer/src/components/RegexDialog.tsx`
- **Current Tab Header**:
  ```tsx
  1507: <button type="button" id="ntab-simple" onClick={() => setMode("simple")}>...Visual</button>
  1533: <button type="button" id="ntab-nested" onClick={() => { setMode("nested_json"); ... }}>...Nested JSON</button>
  1564: <button type="button" id="ntab-adv" onClick={() => setMode("advanced")}>...Regex</button>
  ```
- **Requirement R2 Action (Squad 4: E13)**:
  - **Remove `#ntab-nested`** entirely from this header bar.
  - The mode switcher must display **strictly two tabs**: `[Visual]` (`#ntab-simple`) and `[Regex]` (`#ntab-adv`).

### 4.2 Format Dropdown & Redundant Switch Button
- **Location**: Lines 1731-1787 of `RegexDialog.tsx`
- **Current Dropdown Options**:
  ```tsx
  <select id="minFormatSelect" value={formatType} onChange={...}>
    <option value="kv">Key=Value</option>
    <option value="json">JSON</option>
    <option value="space">Delimited</option>
    <option value="raw">Raw</option>
    <option value="csv">CSV</option>
    <option value="arr">Array</option>
  </select>
  ```
- **Current Redundant Switch Button** (Lines 1761-1787):
  ```tsx
  {formatType === "json" && (
    <button
      type="button"
      id="btn-switch-nested"
      onClick={() => {
        setMode("nested_json");
        triggerNestedScan(100);
      }}
    >
      <span>Auto-Flatten Available ➔</span>
    </button>
  )}
  ```
- **Requirement R2 Action (Squad 4: E14)**:
  1. Add `<option value="nested_json">Nested JSON</option>` to `minFormatSelect`.
  2. **Delete `#btn-switch-nested`** completely.
  3. Update `minFormatSelect` `onChange`:
     - If selected value is `"nested_json"`:
       - Set `formatType("nested_json")` (and/or sync `mode("nested_json")`).
       - If `nestedFields.length === 0 && selectedCol`, immediately execute `triggerNestedScan(100)`.
     - If switching to any other format (`kv`, `json`, `space`, `raw`, `csv`, `arr`):
       - Revert view to standard Visual mode (`mode("simple")`).

### 4.3 Nested JSON Workspace Triggering & Rendering
- **Scan Controller & Table Container** (Lines 2100-2170):
  ```tsx
  {mode === "nested_json" && (
    <div className="nested-json-content">
      <SampleScanController ... />
      <NestedFieldsTable ... />
      {/* Live DuckDB SQL Preview Accordion */}
    </div>
  )}
  ```
- **Trigger Logic** (`triggerNestedScan`, Lines 273-316):
  - Fetches rows with `fetchRawRowsForScan(selectedCol, limit)`.
  - Instantiates `SampleScanWorker(50)` and updates `ScanProgress`.
  - Sets discovered fields in `setNestedFields(res.fields)`.

### 4.4 `handleApply` Extraction Logic
- **Location**: Lines 1129-1262 of `RegexDialog.tsx`
- **Current Condition**:
  - Line 1133: `if (mode === "nested_json")`
  - Line 1200: `else if (mode === "simple")`
  - Line 1231: `else { /* advanced */ }`
- **Requirement R2 Action**:
  - Update condition:
    ```tsx
    if (mode === "nested_json" || (formatType as any) === "nested_json") {
      // Execute DuckDbJsonSqlBuilder CREATE VIEW pipeline
    }
    ```

### 4.5 Dialog Open/Close Lifecycle & Modal Active Cell Suppression
- **Location**: Lines 218-228 of `RegexDialog.tsx`
- **Current `useEffect` on Open**:
  ```tsx
  useEffect(() => {
    if (isOpen && columns.length > 0) {
      if (appState.parseTargetCol && columns.includes(appState.parseTargetCol)) {
        setSelectedCol(appState.parseTargetCol);
      } else if (!selectedCol || !columns.includes(selectedCol)) {
        setSelectedCol(columns[0]);
      }
    }
  }, [isOpen, columns, selectedCol, appState.parseTargetCol]);
  ```
- **Missing Lifecycle Operations (Squad 5: E17)**:
  - When `isOpen === true`:
    1. Dispatch `"dismiss-grid-cell-expand"` via `GridOverlayBus` or `window.dispatchEvent`.
    2. Clean up any floating DOM elements (`.slick-cell-active-expanded`, `.slick-row-has-expanded`).
    3. Call `grid.resetActiveCell()` if grid instance is accessible.
  - When `isOpen === false`:
    - Dispatch `"parse-dialog-closed"` to restore normal grid state.

### 4.6 `NestedFieldsTable.tsx` & Discovered Fields Table Survey
- **File**: `tad-master/packages/toadviewer/src/components/NestedFieldsTable.tsx` (379 lines)
- **Table Headers** (Lines 187-251):
  - `col-check` (width: 32px)
  - `col-name` (min-width: 170px, max-width: 250px)
  - `col-type` (width: 105px)
  - `col-fill` (width: 110px)
  - `col-sample` (min-width: 160px)
- **Deficiencies Identified**:
  - Headers do **not** have `.col-resizer-handle` elements.
  - Cell `col-sample` (Lines 360-369) has `.sample-val-text` with hardcoded `white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px;`.
  - In `RegexDialog.tsx` Simple Mode (Lines 2434-2449), the Discovered Fields `SAMPLE VALUE` cell has identical hardcoded single-line truncation.
- **Squad 4 Insertion Point (E15)**:
  - Add resizer handles `<div className="col-resizer-handle" ... />` to table headers in `NestedFieldsTable.tsx` and Discovered Fields in `RegexDialog.tsx`.
  - When user clicks on a sample value cell, use `CellLineCalculator` to apply dynamic height and wrapping according to the N-line contract ($N \le 1$: flat, $2 \le N \le 5$: exact fit, $N > 5$: 5-line scrollbar).

---

## 5. Architectural Cross-Reference Matrix

| Component | Target File | Key Functions / DOM Elements | Current State | Required Modification |
|:---|:---|:---|:---|:---|
| **Line Math Engine** | `src/utils/CellLineCalculator.ts` | `calculateLineCount`, `getHeightAndScrollState` | Empty file (0 bytes) | Implement Canvas 2D measurement, Node fallback, and N-line contract mapping |
| **Event Bus** | `src/utils/GridOverlayBus.ts` | `emitDismissGridCellExpand`, `onDismissGridCellExpand` | Missing | Create global event bus with typed helpers |
| **Files Table** | `src/components/ProjectFilesTable.tsx` | `tbody tr.file-table-row`, `handleRowClick` | Only adds `is-selected` | Compute line counts, apply `is-expanded` and inline height/overflow |
| **Sidebar Styles** | `less/sidebar.less` | `.file-table-row.is-selected` | Forces `height: auto !important` and `180px` max-height | Separate `.is-selected` (flat 25px) from `.is-selected.is-expanded` |
| **Main DataGrid** | `src/components/DataGrid.tsx` | `tryExpandCell`, `dismissFloatingCell` | Naive `> 28` char check, no outside click | Integrate `CellLineCalculator`, outside click, active re-click toggle, overlay listener |
| **Grid Styles** | `src/slickgrid.scss` | `.slick-cell-active-expanded`, `body.bp4-overlay-open` | Hardcoded `max-height: 180px`, no overlay rules | Remove 180px hardcode, add `body.bp4-overlay-open` highlight suppression |
| **Dialog Header** | `src/components/RegexDialog.tsx` | `#ntab-simple`, `#ntab-nested`, `#ntab-adv` | Has 3 tabs | Remove `#ntab-nested`, keep strictly Visual & Regex |
| **Format Select** | `src/components/RegexDialog.tsx` | `#minFormatSelect`, `#btn-switch-nested` | 6 options, extra button | Add `nested_json` option, delete `#btn-switch-nested` |
| **Apply Handler** | `src/components/RegexDialog.tsx` | `handleApply` | Checks `mode === "nested_json"` | Support `formatType === "nested_json"` or `mode === "nested_json"` |
| **Modal Lifecycle** | `src/components/RegexDialog.tsx` | `isOpen` `useEffect` | No grid cleanup | Dispatch dismiss event, reset active cell, remove floating nodes |
| **Nested Table** | `src/components/NestedFieldsTable.tsx` | `thead th`, `.col-sample` | Fixed widths, truncated text | Add column resizer handles, dynamic cell auto-wrap |

---

## 6. Synthesis & Next Actions for Implementation Squads

1. **Squad 1 (Foundation)**: E01/E02 should immediately implement `CellLineCalculator.ts` and E03 implement `GridOverlayBus.ts`. E04 can write `test_cell_line_calculator.js`.
2. **Squad 2 (Sidebar)**: E05/E07 can safely update `ProjectFilesTable.tsx` and `sidebar.less` without touching DataGrid or Dialog files.
3. **Squad 3 (DataGrid)**: E09/E10/E11 can update `tryExpandCell`, event subscriptions, and `slickgrid.scss`.
4. **Squad 4 (Dialog)**: E13/E14/E15 can update `RegexDialog.tsx` header tabs, dropdown, and `NestedFieldsTable.tsx`.
5. **Squad 5 (QA & Release)**: E17 can implement the modal glow suppression test, and E19/E20 can run packaging and release verification.
