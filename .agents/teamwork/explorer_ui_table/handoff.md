# Handoff Report: UI Table & Grid Exploration (Streams 1, 2, 3, 4, 5, 6)

## 1. Observation

Direct code analysis of target files in `tad-master/packages/toadviewer/`:

### 1.1 `ProjectFilesTable.tsx`
- **File Path**: `tad-master/packages/toadviewer/src/components/ProjectFilesTable.tsx` (576 lines total)
- **Lines 99-106**: Type definitions for sorting:
  ```typescript
  export type TableSortCol = "name" | "dir" | "size" | "status";
  export type TableSortDir = "asc" | "desc";
  ```
- **Lines 171-182**: Component declaration and initial states:
  ```typescript
  export const ProjectFilesTable: React.FC<ProjectFilesTableProps> = ({
    files,
    activeFilePath,
    onOpenFile,
    stateRef,
  }) => {
    const [sortCol, setSortCol] = useState<TableSortCol | null>(null);
    const [sortDir, setSortDir] = useState<TableSortDir>("asc");
    const [filterOpenCol, setFilterOpenCol] = useState<TableSortCol | null>(null);
    const [colFilters, setColFilters] = useState<{ [K in TableSortCol]?: string }>({});
    const [updateTick, forceUpdate] = useReducer((x) => x + 1, 0);
  ```
  *Observation*: There is currently no `colWidths` state or width control on headers or columns.
- **Lines 335-340**: Table rendering and header structure:
  ```tsx
  <div className="project-table-container">
    <table className="project-files-table">
      <thead>
        <tr>
          <th className="col-name" onClick={(e) => toggleColumnFilter("name", e)}>
            <div className="th-content">
              <span>Name</span>
              <button
                type="button"
                className="sort-btn"
                title="Sort by Name"
                onClick={(e) => handleSort("name", e)}
              >
  ```
  *Observation*: Headers for `name` (line 339), `dir` (line 369), `size` (line 399), and `status` (line 429) do not have draggable resizer handles. `th.onClick` triggers column filtering.
- **Lines 466-476**: Row rendering and selection logic:
  ```tsx
  displayedFiles.map((f) => {
    const isSelected =
      activeFilePath && normPath(activeFilePath) === normPath(f.filePath);
    const parentDir = getFullParentDir(f.filePath);
    return (
      <tr
        key={f.filePath}
        className={`file-table-row ${isSelected ? "is-selected" : ""}`}
        onClick={() => onOpenFile(f)}
        title={f.filePath}
      >
  ```
  *Observation*: `isSelected` is computed strictly from prop `activeFilePath`. Clicking calls `onOpenFile(f)`. There is no toggle collapse on clicking the active row, no click-outside handler, and no Escape key listener for row collapse.
- **Lines 477-560**: Cell structure:
  - `td.cell-name`: Contains `getFileFormatIcon(f.fileName)`, Blueprint `Tooltip`, and `<span className="file-name-text">`.
  - `td.cell-dir`: Contains Blueprint `Tooltip` and `<span className="file-dir-text">`.

### 1.2 `sidebar.less`
- **File Path**: `tad-master/packages/toadviewer/less/sidebar.less`
- **Lines 1030-1035**: Table baseline layout:
  ```less
  .project-files-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
    table-layout: fixed;
  ```
- **Lines 1089-1094**: Current column widths:
  ```less
  /* Column widths */
  .col-name { width: 38%; }
  .col-dir { width: 32%; }
  .col-size { width: 18%; text-align: right; }
  .col-status { width: 12%; text-align: center; }
  ```
  *Observation*: Percentage widths are hardcoded in CSS without support for dynamic user drag.
- **Lines 1095-1115**: Row height and selection:
  ```less
  tbody tr.file-table-row {
    height: 25px; // Data-dense 24-26px row height
    cursor: pointer;
    border-bottom: 1px solid rgba(0, 0, 0, 0.03);
    transition: background-color 0.1s ease;

    &:hover {
      background-color: rgba(0, 0, 0, 0.04);
    }

    &.is-selected {
      background-color: #0284c7 !important;
      color: #ffffff !important;
  ```
- **Lines 1117-1167**: Cell text truncation:
  - `td` has `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`
  - `.cell-name` has fixed `height: 25px; line-height: 24px;` and `.bp4-popover-target` with `white-space: nowrap;`.
  - `.cell-dir` has `.bp4-popover-target` and `.file-dir-text` with `white-space: nowrap;`.
- **Lines 1243-1295**: Dark mode styles for `.project-files-table` under `.bp4-dark, .toad-dark`.

### 1.3 `DataGrid.tsx`
- **File Path**: `tad-master/packages/toadviewer/src/components/DataGrid.tsx` (1426 lines total)
- **Lines 87-96**: Width calculation constants:
  ```typescript
  const MINCOLWIDTH = 60;
  const MAXCOLWIDTH = 330;
  const CHAR_WIDTH = 7.0;
  const measureStringWidth = (s: string): number => 8 + CHAR_WIDTH * s.length;
  const measureHeaderStringWidth = (s: string): number => 24 + CHAR_WIDTH * s.length;
  ```
- **Lines 432-441**: SlickGrid instantiation and selection model:
  ```typescript
  let grid = new Slick.Grid(`#${containerId}`, dataView, columns, gridOptions);
  (grid as any)._tadProps = props;
  const selectionModel = new CellSelectionModel();
  grid.setSelectionModel(selectionModel);
  ```
- **Lines 601-620**: Header click capture phase listener:
  ```typescript
  const containerElem = document.getElementById(containerId);
  if (containerElem) {
    containerElem.addEventListener(
      "click",
      (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        const headerCol = target?.closest(".slick-header-column");
        if (!headerCol) return;
        if (target.classList.contains("slick-resizable-handle")) return;
        const isSortBtn = target.closest(".toad-header-sort-btn");
        if (!isSortBtn) {
          e.stopPropagation();
          e.stopImmediatePropagation();
        }
      },
      true // capture phase!
    );
  }
  ```
  *Observation*: Line 610 explicitly checks `target.classList.contains("slick-resizable-handle")` to allow drag resizing without sorting. However, there is no `dblclick` listener on the handle for auto-fitting column widths.
- **Lines 623-644**: `grid.onActiveCellChanged` subscription:
  Currently only handles `_expand` column / `expandedRowIndex` (Event Details panel). Does not handle floating cell expansion for overflowing data cells.
- **Lines 647-666 & 1119-1180**: Keyboard handling:
  - `grid.onKeyDown` handles Enter/Space for event detail expansion.
  - Window keydown handles ArrowUp/ArrowDown for event row navigation.
  - No handler for `Escape` to collapse floating active cells.

### 1.4 `slickgrid.scss`
- **File Path**: `tad-master/packages/toadviewer/src/slickgrid.scss` (150 lines total)
- **Lines 68-73**:
  ```scss
  /* --- TOAD Large Column Virtual Containment & Fast Reflow (v2.0.5) --- */
  .slick-cell {
    contain: strict;
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow: hidden;
  }
  ```
  *CRITICAL OBSERVATION*: `.slick-cell` has `contain: strict;`. In CSS, `contain: strict` encompasses `contain: paint`. Any overflowing content or floating popout will be strictly clipped by the browser rendering engine unless `.slick-cell-active-expanded` explicitly sets `contain: none !important;`!
- **Lines 76-150**: Dark mode theme definitions for SlickGrid header, rows, and active cell backgrounds.

### 1.5 `slickgrid-es6/dist/slick.grid.scss`
- **Lines 199-212**:
  ```scss
  .slick-resizable-handle {
    position: absolute;
    font-size: 0.1px;
    display: block;
    cursor: col-resize;
    width: 4px;
    right: 0;
    top: 0;
    height: 100%;
  }
  .slick-resizable-handle-hover {
    background-color: #ccc;
  }
  ```
  *Observation*: SlickGrid renders `.slick-resizable-handle` inside every `.slick-header-column`.

---

## 2. Logic Chain

1. **Stream 1 Logic (File Table Resizer Handles)**:
   - Observation 1.1 shows headers currently have fixed CSS percentage widths and no resizer elements.
   - Observation 1.2 shows `.project-files-table` has `table-layout: fixed`.
   - Adding state `colWidths: ColWidths = { name: 140, dir: 120, size: 70, status: 60 }` with minimum bound `MIN_COL_WIDTH = 45px` directly controls header pixel widths via `<col style={{ width: colWidths[col] }} />` and `<th style={{ width: colWidths[col] }}>`.
   - Placing `<div className="col-resizer-handle" onMouseDown={...} onDoubleClick={...} />` at the right edge of each `th` with `e.stopPropagation()` prevents activating `th.onClick` (column filtering).
   - Global `mousemove` and `mouseup` on `document` ensures dragging remains smooth even when the cursor leaves the header cell bounds.
   - Double-clicking the resizer handle measures the longest text in `displayedFiles` for that column and sets `colWidths[col] = Math.max(45, calculatedWidth)`.

2. **Stream 2 Logic (File Table Active Row Auto-Wrap)**:
   - Observation 1.1 shows row selection is tied directly to `activeFilePath`, with no toggle collapse.
   - Observation 1.2 shows `.cell-name` and `.cell-dir` are locked to single-line 25px with `white-space: nowrap;`.
   - Introducing `selectedRowPath` state:
     - First click on row `f`: `setSelectedRowPath(f.filePath)`, calls `onOpenFile(f)`.
     - Second click on same row (toggle click): `setSelectedRowPath(null)` -> collapses back to 1 line.
     - Escape key or clicking outside `.project-table-container`: `setSelectedRowPath(null)`.
   - When row has `.is-selected`:
     - CSS sets `height: auto !important; td { white-space: normal !important; word-break: break-all !important; overflow-wrap: anywhere !important; }`.
     - Inner wrap containers `.file-name-wrap` and `.file-dir-wrap` get `max-height: 180px; overflow-y: auto;`.
     - All other rows remain single-line 25px with ellipsis, maintaining compact density.

3. **Stream 3 Logic (SlickGrid Double-Click Auto-Fit)**:
   - Observation 1.3 shows `containerElem` intercepts header clicks, and Observation 1.5 shows SlickGrid renders `.slick-resizable-handle` inside each header column.
   - Adding a `dblclick` listener on `containerElem`:
     - Detects when `target.classList.contains("slick-resizable-handle")`.
     - Finds the corresponding column descriptor from `target.closest(".slick-header-column")`.
     - Iterates over visible rows in `grid.getViewport()` (`vp.top` to `vp.bottom`), retrieves formatted string values, and calculates max string length.
     - Applies `width = Math.min(800, Math.max(MINCOLWIDTH, Math.ceil(maxLen * 7.5 + 28)))`.
     - Calls `grid.setColumns(updatedCols)` to update layout instantly without breaking row coordinates.

4. **Stream 4 Logic (SlickGrid Floating In-Place Cell Wrap)**:
   - Observation 1.4 reveals `.slick-cell` has `contain: strict;`. Modifying cell height directly inside SlickGrid breaks virtual scrolling coordinate math (`top = row * rowHeight`).
   - Solution: Floating In-Place Overlay.
     - In `grid.onActiveCellChanged`: check if active cell text overflows (`cellNode.scrollWidth > cellNode.clientWidth || textLength > 25`).
     - If overflowing: attach `.slick-cell-active-expanded` to cell DOM node and `.slick-row-active-expanded` to parent row DOM node.
     - CSS sets `position: absolute; z-index: 20 !important; contain: none !important; max-height: 180px; overflow-y: auto; white-space: normal; word-break: break-word; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15);`.
     - Virtual scroll coordinates remain 100% intact because DOM row height is not altered.
     - Dismissal: Subscribe to `grid.onScroll`, `grid.onViewportChanged`, and `Escape` keydown to remove `.slick-cell-active-expanded`.

5. **Stream 5 Logic (CSS Design System, Themes & Scrollbars)**:
   - Observation 1.2 and 1.4 show styles in `sidebar.less` and `slickgrid.scss`.
   - Adding `.col-resizer-handle` styles with default invisible handle and hover/drag line `rgba(2, 132, 199, 0.75)` (or `rgba(56, 189, 248, 0.85)` in dark mode).
   - Adding custom slim scrollbars (4px width, 2px border-radius) for both table wrap containers and floating grid cells.
   - Adding `body.col-resizing` to lock cursor to `col-resize` and prevent text selection during drag.

6. **Stream 6 Logic (Keyboard Accessibility & Event Isolation)**:
   - Observation 1.1 and 1.3 show multiple overlapping click and keydown handlers.
   - `e.stopPropagation()` on resizer handles prevents accidental sorting or filtering during column drag.
   - `window.onblur` and `document.mouseleave` ensure dragging terminates cleanly if the user switches apps or mouse leaves the window.
   - `Escape` key cleanly collapses active row in `ProjectFilesTable` and dismisses floating cell in `DataGrid`.

---

## 3. Caveats

1. **DOM Virtualization in SlickGrid**: SlickGrid continuously destroys and re-creates cell DOM nodes during scrolling. Therefore, storing the active expanded cell DOM reference must be guarded: whenever scrolling occurs, the expanded class must be cleared immediately before DOM recycling.
2. **Table Container Overflow**: `ProjectFilesTable` is placed inside `.sidebar-content` which has `overflow-x: auto`. When columns are resized wider than the sidebar width, the horizontal scrollbar should appear naturally.
3. **No Caveats on Blueprint Compatibility**: Both Light and Dark theme variables use standard Material Design 3 and Blueprint classes (`--md-sys-color-primary`, `--md-sys-color-surface-container`).

---

## 4. Conclusion & Precise Implementation Blueprints

### 4.1 STREAM 1: `ProjectFilesTable.tsx` Column Resizing Blueprint
- **Target File**: `tad-master/packages/toadviewer/src/components/ProjectFilesTable.tsx`
- **Insertion 1 (Types & Defaults)**: At line 106:
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
  ```
- **Insertion 2 (State & Drag Handlers)**: At line 182:
  ```typescript
  const [colWidths, setColWidths] = useState<ColWidths>(DEFAULT_COL_WIDTHS);
  const draggingRef = useRef<{
    col: TableSortCol;
    startX: number;
    startWidth: number;
  } | null>(null);

  const handleResizeMouseDown = (col: TableSortCol, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = colWidths[col];
    draggingRef.current = { col, startX, startWidth };
    document.body.classList.add("col-resizing");

    const onMouseMove = (moveEvt: MouseEvent) => {
      if (!draggingRef.current) return;
      const delta = moveEvt.clientX - draggingRef.current.startX;
      const newWidth = Math.max(MIN_COL_WIDTH, draggingRef.current.startWidth + delta);
      setColWidths((prev) => ({
        ...prev,
        [draggingRef.current!.col]: newWidth,
      }));
    };

    const onMouseUp = () => {
      draggingRef.current = null;
      document.body.classList.remove("col-resizing");
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("blur", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    window.addEventListener("blur", onMouseUp);
  };

  const handleAutoFit = (col: TableSortCol, e: React.MouseEvent) => {
    e.stopPropagation();
    let maxLen = 0;
    if (col === "name") {
      maxLen = "Name".length;
      displayedFiles.forEach((f) => {
        if (f.fileName && f.fileName.length > maxLen) maxLen = f.fileName.length;
      });
      const fitWidth = Math.max(MIN_COL_WIDTH, Math.ceil(maxLen * 7.2 + 50));
      setColWidths((prev) => ({ ...prev, name: Math.min(fitWidth, 500) }));
    } else if (col === "dir") {
      maxLen = "DirPath".length;
      displayedFiles.forEach((f) => {
        if (f.relDir && f.relDir.length > maxLen) maxLen = f.relDir.length;
      });
      const fitWidth = Math.max(MIN_COL_WIDTH, Math.ceil(maxLen * 6.8 + 36));
      setColWidths((prev) => ({ ...prev, dir: Math.min(fitWidth, 500) }));
    } else if (col === "size") {
      maxLen = "Size".length;
      displayedFiles.forEach((f) => {
        const s = formatFileBytes(f.fileSizeBytes);
        if (s.length > maxLen) maxLen = s.length;
      });
      const fitWidth = Math.max(MIN_COL_WIDTH, Math.ceil(maxLen * 7.0 + 36));
      setColWidths((prev) => ({ ...prev, size: fitWidth }));
    } else if (col === "status") {
      maxLen = "Status".length;
      displayedFiles.forEach((f) => {
        const st = f.effectiveStatus || "";
        if (st.length > maxLen) maxLen = st.length;
      });
      const fitWidth = Math.max(MIN_COL_WIDTH, Math.ceil(maxLen * 7.0 + 36));
      setColWidths((prev) => ({ ...prev, status: fitWidth }));
    }
  };
  ```
- **Insertion 3 (JSX Colgroup & Th Resizers)**: At lines 336-459:
  ```tsx
  <table className="project-files-table">
    <colgroup>
      <col style={{ width: colWidths.name }} />
      <col style={{ width: colWidths.dir }} />
      <col style={{ width: colWidths.size }} />
      <col style={{ width: colWidths.status }} />
    </colgroup>
    <thead>
      <tr>
        <th className="col-name" style={{ width: colWidths.name }} onClick={(e) => toggleColumnFilter("name", e)}>
          ...
          <div
            className="col-resizer-handle"
            title="Drag to resize, double-click to auto-fit"
            onMouseDown={(e) => handleResizeMouseDown("name", e)}
            onDoubleClick={(e) => handleAutoFit("name", e)}
          />
        </th>
        <th className="col-dir" style={{ width: colWidths.dir }} onClick={(e) => toggleColumnFilter("dir", e)}>
          ...
          <div
            className="col-resizer-handle"
            title="Drag to resize, double-click to auto-fit"
            onMouseDown={(e) => handleResizeMouseDown("dir", e)}
            onDoubleClick={(e) => handleAutoFit("dir", e)}
          />
        </th>
        <th className="col-size" style={{ width: colWidths.size }} onClick={(e) => toggleColumnFilter("size", e)}>
          ...
          <div
            className="col-resizer-handle"
            title="Drag to resize, double-click to auto-fit"
            onMouseDown={(e) => handleResizeMouseDown("size", e)}
            onDoubleClick={(e) => handleAutoFit("size", e)}
          />
        </th>
        <th className="col-status" style={{ width: colWidths.status }} onClick={(e) => toggleColumnFilter("status", e)}>
          ...
          <div
            className="col-resizer-handle"
            title="Drag to resize, double-click to auto-fit"
            onMouseDown={(e) => handleResizeMouseDown("status", e)}
            onDoubleClick={(e) => handleAutoFit("status", e)}
          />
        </th>
      </tr>
    </thead>
  ```

---

### 4.2 STREAM 2: `ProjectFilesTable.tsx` Active Row Wrap Blueprint
- **Target File**: `tad-master/packages/toadviewer/src/components/ProjectFilesTable.tsx`
- **Insertion 1 (Selection State & Escape/Outside Listeners)**:
  ```typescript
  const [selectedRowPath, setSelectedRowPath] = useState<string | null>(activeFilePath || null);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeFilePath) {
      setSelectedRowPath(activeFilePath);
    }
  }, [activeFilePath]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (tableContainerRef.current && !tableContainerRef.current.contains(e.target as Node)) {
        setSelectedRowPath(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedRowPath(null);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleRowClick = (f: ProjectWorkspaceFile) => {
    if (selectedRowPath && normPath(selectedRowPath) === normPath(f.filePath)) {
      setSelectedRowPath(null); // toggle collapse
    } else {
      setSelectedRowPath(f.filePath);
      onOpenFile(f);
    }
  };
  ```
- **Insertion 2 (Row Rendering & Wrap Containers)**: Around lines 466-560:
  ```tsx
  <div className="project-table-container" ref={tableContainerRef}>
  ...
  displayedFiles.map((f) => {
    const isSelected = selectedRowPath ? normPath(selectedRowPath) === normPath(f.filePath) : false;
    const parentDir = getFullParentDir(f.filePath);
    return (
      <tr
        key={f.filePath}
        className={`file-table-row ${isSelected ? "is-selected" : ""}`}
        onClick={() => handleRowClick(f)}
        title={f.filePath}
      >
        <td className="cell-name" title={f.filePath}>
          {getFileFormatIcon(f.fileName)}
          <Tooltip ...>
            <div className="file-name-wrap">
              <span className="file-name-text" title={f.filePath}>
                {f.fileName}
              </span>
            </div>
          </Tooltip>
        </td>
        <td className="cell-dir" title={parentDir}>
          <Tooltip ...>
            <div className="file-dir-wrap">
              <span className="file-dir-text" title={parentDir}>
                {f.relDir}
              </span>
            </div>
          </Tooltip>
        </td>
  ```

---

### 4.3 STREAM 3: `DataGrid.tsx` SlickGrid Double-Click Auto-Fit Blueprint
- **Target File**: `tad-master/packages/toadviewer/src/components/DataGrid.tsx`
- **Insertion 1 (autoFitGridColumn function)**: Above `createGrid` (around line 408):
  ```typescript
  const autoFitGridColumn = (grid: any, colId: string, props: DataGridProps) => {
    const { dataView, getColumnFormatter } = props;
    if (!grid || !dataView || !dataView.schema) return;

    const vp = grid.getViewport() || { top: 0, bottom: Math.min(100, dataView.getLength() - 1) };
    const cols = [...grid.getColumns()];
    const targetColIdx = cols.findIndex((c: any) => c.id === colId);
    if (targetColIdx === -1) return;

    const schema = dataView.schema;
    let sf: (val: any) => string;
    try {
      const cf = getColumnFormatter(schema, colId);
      sf = (val: any) => (val != null && cf ? cf(val) ?? val.toString() : "");
    } catch {
      sf = (val: any) => (val != null ? val.toString() : "");
    }

    let maxLen = 0;
    const displayName = schema.displayName(colId) || colId;
    maxLen = Math.max(maxLen, displayName.length);

    const startRow = Math.max(0, vp.top);
    const endRow = Math.min(dataView.getLength() - 1, Math.max(vp.bottom, startRow + 50));

    for (let i = startRow; i <= endRow; i++) {
      const item = dataView.getItem(i);
      if (!item) continue;
      const val = item[colId];
      if (val != null) {
        const str = sf(val);
        const lines = str.split("\n");
        for (const l of lines) {
          if (l.length > maxLen) maxLen = l.length;
        }
      }
    }

    const calculatedWidth = Math.min(800, Math.max(MINCOLWIDTH, Math.ceil(maxLen * 7.5 + 28)));
    cols[targetColIdx] = { ...cols[targetColIdx], width: calculatedWidth };

    grid.setColumns(cols);
    const tadProps = (grid as any)._tadProps;
    if (tadProps?._gridState?.colWidthsMap) {
      tadProps._gridState.colWidthsMap[colId] = calculatedWidth;
    }
    grid.render();
  };
  ```
- **Insertion 2 (dblclick listener on containerElem)**: In `createGrid` around line 620:
  ```typescript
  if (containerElem) {
    containerElem.addEventListener("dblclick", (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target || !target.classList.contains("slick-resizable-handle")) return;

      const headerCol = target.closest(".slick-header-column") as HTMLElement;
      if (!headerCol) return;

      const cols = grid.getColumns();
      if (!cols || cols.length === 0) return;

      const colDef =
        (headerCol as any)._columnData ||
        cols.find((c: any) => headerCol.id && (headerCol.id === c.id || headerCol.id.endsWith(c.id)));
      if (!colDef || colDef.id === "_expand" || colDef.resizable === false) return;

      e.stopPropagation();
      e.preventDefault();

      const curProps = (grid as any)._tadProps || props;
      autoFitGridColumn(grid, colDef.id, curProps);
    });
  }
  ```

---

### 4.4 STREAM 4: `DataGrid.tsx` Floating In-Place Active Cell Wrap Blueprint
- **Target File**: `tad-master/packages/toadviewer/src/components/DataGrid.tsx`
- **Insertion (Floating Cell Lifecycle)**: Inside `createGrid` (around line 621):
  ```typescript
  let currentExpandedCellNode: HTMLElement | null = null;
  let currentExpandedRowNode: HTMLElement | null = null;

  const dismissFloatingCell = () => {
    if (currentExpandedCellNode) {
      currentExpandedCellNode.classList.remove("slick-cell-active-expanded");
      currentExpandedCellNode = null;
    }
    if (currentExpandedRowNode) {
      currentExpandedRowNode.classList.remove("slick-row-active-expanded");
      currentExpandedRowNode = null;
    }
  };

  const tryExpandCell = (row: number, cell: number) => {
    dismissFloatingCell();
    if (row == null || cell == null || row < 0 || cell < 0) return;

    const cols = grid.getColumns();
    if (!cols || !cols[cell] || cols[cell].id === "_expand") return;

    const cellNode = grid.getCellNode(row, cell) as HTMLElement;
    if (!cellNode) return;

    const textLen = (cellNode.textContent || "").trim().length;
    const isOverflowing = cellNode.scrollWidth > cellNode.clientWidth || textLen > 25;

    if (isOverflowing) {
      cellNode.classList.add("slick-cell-active-expanded");
      currentExpandedCellNode = cellNode;

      const rowNode = cellNode.closest(".slick-row") as HTMLElement;
      if (rowNode) {
        rowNode.classList.add("slick-row-active-expanded");
        currentExpandedRowNode = rowNode;
      }
    }
  };

  // Expand cell when active cell changes
  grid.onActiveCellChanged.subscribe((e: any, args: any) => {
    if (args && args.row !== null && args.cell !== null) {
      tryExpandCell(args.row, args.cell);
    }
  });

  // Dismiss on scroll or viewport changes
  grid.onScroll.subscribe(() => {
    dismissFloatingCell();
  });
  grid.onViewportChanged.subscribe(() => {
    dismissFloatingCell();
  });

  // Dismiss on Escape key
  const handleGridEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      dismissFloatingCell();
    }
  };
  window.addEventListener("keydown", handleGridEscape);
  ```

---

### 4.5 STREAM 5: CSS Design System, Blueprint Theme & Scrollbars Blueprint
- **Target File 1**: `tad-master/packages/toadviewer/less/sidebar.less` (lines 1030-1295):
  ```less
  /* Table Header Resizer Handle */
  .project-files-table thead th {
    position: relative; /* required for absolute resizer handle */
  }

  .col-resizer-handle {
    position: absolute;
    top: 0;
    right: 0;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    user-select: none;
    z-index: 10;

    &::after {
      content: "";
      position: absolute;
      top: 0;
      bottom: 0;
      right: 1px;
      width: 2px;
      background: transparent;
      transition: background-color 0.15s ease;
    }

    &:hover::after,
    &.is-resizing::after {
      background-color: rgba(2, 132, 199, 0.75);
    }
  }

  /* Global Cursor during column drag */
  body.col-resizing,
  body.col-resizing * {
    cursor: col-resize !important;
    user-select: none !important;
  }

  /* Active Row Auto-Wrap Expansion */
  .project-files-table tbody tr.file-table-row.is-selected {
    height: auto !important;

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
      min-height: 25px;
      align-items: flex-start !important;

      .bp4-popover-target {
        white-space: normal !important;
        overflow: visible !important;
      }

      .file-name-wrap,
      .file-name-text {
        white-space: normal !important;
        word-break: break-all !important;
        overflow-wrap: anywhere !important;
        max-height: 180px;
        overflow-y: auto;
        display: inline-block;
      }
    }

    .cell-dir {
      .bp4-popover-target {
        white-space: normal !important;
        overflow: visible !important;
      }

      .file-dir-wrap,
      .file-dir-text {
        white-space: normal !important;
        word-break: break-all !important;
        overflow-wrap: anywhere !important;
        max-height: 180px;
        overflow-y: auto;
        display: block;
      }
    }
  }

  /* Custom Slim Scrollbars (4px, radius 2px) */
  .project-files-table .file-name-wrap,
  .project-files-table .file-name-text,
  .project-files-table .file-dir-wrap,
  .project-files-table .file-dir-text {
    &::-webkit-scrollbar {
      width: 4px;
      height: 4px;
    }
    &::-webkit-scrollbar-track {
      background: transparent;
    }
    &::-webkit-scrollbar-thumb {
      background: rgba(148, 163, 184, 0.4);
      border-radius: 2px;
    }
    &::-webkit-scrollbar-thumb:hover {
      background: rgba(148, 163, 184, 0.7);
    }
  }

  /* Dark mode overrides */
  .toad-dark, .bp4-dark {
    .col-resizer-handle:hover::after,
    .col-resizer-handle.is-resizing::after {
      background-color: rgba(56, 189, 248, 0.85);
    }

    .project-files-table .file-name-wrap,
    .project-files-table .file-name-text,
    .project-files-table .file-dir-wrap,
    .project-files-table .file-dir-text {
      &::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.2);
      }
      &::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.4);
      }
    }
  }
  ```

- **Target File 2**: `tad-master/packages/toadviewer/src/slickgrid.scss`:
  ```scss
  /* Resizer handle styling */
  .slick-header-column .slick-resizable-handle {
    width: 6px !important;
    right: -3px !important;
    z-index: 12 !important;

    &::after {
      content: "";
      position: absolute;
      top: 0;
      bottom: 0;
      left: 2px;
      width: 2px;
      background: transparent;
      transition: background-color 0.15s ease;
    }

    &:hover::after,
    &.slick-resizable-handle-hover::after {
      background-color: rgba(2, 132, 199, 0.75) !important;
    }
  }

  /* Floating In-Place Active Cell Wrap */
  .slick-row.slick-row-active-expanded {
    z-index: 15 !important;
    contain: none !important;
  }

  .slick-cell.slick-cell-active-expanded {
    position: absolute !important;
    z-index: 20 !important;
    contain: none !important; /* overrides contain: strict! */
    height: auto !important;
    min-height: 24px !important;
    max-height: 180px !important;
    overflow-y: auto !important;
    overflow-x: hidden !important;
    white-space: normal !important;
    word-break: break-word !important;
    background: #ffffff !important;
    color: #0f172a !important;
    border: 1px solid #0284c7 !important;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15) !important;
    border-radius: 3px;
    padding: 3px 6px !important;

    &::-webkit-scrollbar {
      width: 4px;
      height: 4px;
    }
    &::-webkit-scrollbar-track {
      background: transparent;
    }
    &::-webkit-scrollbar-thumb {
      background: rgba(148, 163, 184, 0.4);
      border-radius: 2px;
    }
    &::-webkit-scrollbar-thumb:hover {
      background: rgba(148, 163, 184, 0.7);
    }
  }

  /* Dark theme overrides for SlickGrid floating cell & resizers */
  .toad-dark, .bp4-dark {
    .slick-header-column .slick-resizable-handle:hover::after,
    .slick-header-column .slick-resizable-handle.slick-resizable-handle-hover::after {
      background-color: rgba(56, 189, 248, 0.85) !important;
    }

    .slick-cell.slick-cell-active-expanded {
      background: var(--md-sys-color-surface-container-high, #2d2f36) !important;
      border-color: var(--md-sys-color-primary, #8ab4f8) !important;
      color: var(--md-sys-color-on-surface, #e3e3e8) !important;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4) !important;

      &::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.2);
      }
      &::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.4);
      }
    }
  }
  ```

---

### 4.6 STREAM 6: Keyboard Accessibility & Event Isolation Blueprint
- **ProjectFilesTable**:
  - `e.stopPropagation(); e.preventDefault()` on resizer handle mousedown and dblclick prevents `toggleColumnFilter` from opening filter input.
  - Window blur / mouseleave cleans up `draggingRef.current`, removes document event listeners, and strips `.col-resizing` from `document.body`.
  - Window Escape keydown listener collapses `selectedRowPath = null`.
- **DataGrid**:
  - Header click capture listener allows `.slick-resizable-handle` events without invoking sort.
  - Window Escape keydown listener calls `dismissFloatingCell()`.
  - Virtual scroll / viewport change cleans up floating cell DOM overlay.

---

## 5. Verification Method

To independently verify the implementation:

### 5.1 Automated Unit & Stress Tests
```powershell
# Run Stream 7: ProjectFilesTable unit tests (15 test cases)
node tests/unit/test_project_files_table_wrap_resize.js

# Run Stream 8: DataGrid SlickGrid unit tests (15 test cases)
node tests/unit/test_datagrid_floating_wrap.js

# Run Stream 9: Virtual scroll concurrency & memory stress tests (10 test cases)
node tests/qa/test_grid_wrap_concurrency_stress.js

# Run Full Unified Test Suite
node run_tests.js --all
```

### 5.2 Manual UI Verification
1. **Sidebar Table Resizing**:
   - Hover between column headers `Name` and `DirPath`. Verify cursor changes to `col-resize` and subtle blue divider line appears.
   - Drag to resize: verify width expands and contracts smoothly without triggering the column filter popover.
   - Verify minWidth stops at 45px.
   - Double-click the resizer divider: verify column auto-fits to the longest text in the visible files.
2. **Sidebar Table Active Row Wrap**:
   - Click a file with a long file name / directory path: verify the row expands up to 180px with a 4px custom slim scrollbar.
   - Click the same row again (toggle): verify it collapses back to 25px single line.
   - Click another row: verify previous row collapses and new row expands.
   - Click outside the table or press `Escape`: verify row collapses.
3. **DataGrid Double-Click Auto-Fit**:
   - Double-click the resizer handle on a column header: verify column auto-fits to visible row data length.
4. **DataGrid Floating In-Place Wrap**:
   - Click a cell with truncated text or JSON string: verify cell receives `.slick-cell-active-expanded`, floats with soft shadow (`z-index: 20`), and scrolls smoothly up to 180px without shifting adjacent rows.
   - Scroll the grid or press `Escape`: verify floating cell dismisses immediately.

### 5.3 Invalidation Conditions
- If `.slick-cell` retains `contain: strict;` when expanded, overflowing text will be invisibly clipped.
- If `e.stopPropagation()` is omitted on `col-resizer-handle`, mousedown will trigger the column filter dropdown.
- If `document.body.classList.remove("col-resizing")` is not called on `window.onblur`, the cursor will remain stuck as `col-resize`.
