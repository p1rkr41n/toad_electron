# Handoff Report: SlickGrid, Dynamic Auto-Wrap & Filter UI Exploration (M6)

**Agent**: `explorer_m6_grid` (Squad 6: SlickGrid, Formatting & Filter UI Explorer)  
**Parent**: `07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d`  
**Milestone**: M6 (Frontend Porting & Host Bridge Integration — Features F25, F26, F27, F28)  
**Status**: Complete  

---

## 1. Observation

### 1.1 SlickGrid Data Model, Virtualization & Arrow RecordBatches (F25)
1. **Arrow IPC Binary Stream Decoder**:
   - Location: `tad-master/packages/reltab/src/remote/hybridProtocol.ts` (lines 61-81, 219-289).
   - In `isArrowIPC` (lines 75-80), Arrow IPC stream is identified by the 4-byte continuation token `[0xFF, 0xFF, 0xFF, 0xFF]`.
   - In `arrowIPCToTableRep` (lines 233-288):
     ```typescript
     const arrowTable = tableFromIPC(u8);
     const numRows = arrowTable.numRows;
     const fields = arrowTable.schema.fields;
     const columnNames = fields.map((f: any) => f.name);
     // Schema reconstituted from metadata:
     const toadSchemaStr = rawMeta instanceof Map ? rawMeta.get("toadSchema") : (rawMeta as any)?.toadSchema;
     ```
   - Arrow columns are extracted row-by-row into `Row` objects with type scaling for `Decimal` (TypeId 7 via `formatArrowDecimal`) and `Time` (TypeId 9 via `formatArrowTime`). Returns a `reltab.TableRep(schema, rows)`.

2. **PagedDataView Virtualized Sliding Buffer**:
   - Location: `tad-master/packages/toadviewer/src/PagedDataView.ts` (lines 15-94).
   - Page size is fixed at `1,000` rows; sliding buffer maintains up to 5 pages (`5,000` rows) in `rawData`:
     ```typescript
     getLength(): number {
       const pageStart = (this.currentPage - 1) * this.pageSize;
       if (pageStart >= this.totalRowCount) return 0;
       return Math.min(this.pageSize, this.totalRowCount - pageStart);
     }
     getItem(pageIndex: number): DataRow | null {
       const globalIdx = (this.currentPage - 1) * this.pageSize + pageIndex;
       const itemIndex = globalIdx - this.offset;
       return (itemIndex >= 0 && itemIndex < this.rawData.length) ? this.rawData[itemIndex] : null;
     }
     ```
   - `getItemMetadata(index)` tags non-leaf rows (`!item._isLeaf`) with CSS class `"grid-aggregate-row"`.

3. **Data Request Pipeline**:
   - Location: `tad-master/packages/toadviewer/src/PivotRequester.ts` (lines 28-76, 294-320, 440-490).
   - `requestDataView` calls `rt.evalQuery(queryView.query, offset, limit)`.
   - In Tauri v2 runtime, `DataSourceConnection.evalQuery` routes to `TauriHostAdapter.invokeBinary("toad:eval_query", ...)` (mapped to command alias `evalQuery`), which invokes the Rust DuckDB engine returning binary Arrow IPC bytes (`tauri::ipc::Response`).
   - `mkDataView` (lines 28-76) decorates `tableData.rowData` with tree hierarchy fields: `_isOpen`, `_isLeaf`, `_depth`, `_id`, `_parentId`, constructing `new PagedDataView(outSchema, rowCount, offset, rowData, currentPage, pageSize)`.

4. **SlickGrid Column Wiring & Formatting**:
   - Location: `tad-master/packages/toadviewer/src/components/DataGrid.tsx` (lines 185-292).
   - Hidden columns: `_id`, `_parentId`.
   - Expand column: `_expand` (width 34px fixed, renders eye icon header and expand/collapse chevron button).
   - Pivot column: `_pivot` (renders `groupCellFormatter` with indent `calcIndent(item._depth) = 15px * depth`, toggle chevron caret, and `he.encode(item._pivot)`).
   - Value columns: mapped from `schema.columns`, with `sortable: true`, custom formatter `(row, cell, value) => (ff as any)(value)`, and column width approximated by scanning up to 100 rows clamped between `MINCOLWIDTH = 60px` and `MAXCOLWIDTH = 330px`.
   - Header hover sort button: lines 820-857 inject `.toad-header-sort-btn` with hover transition; header click event listener runs in capture phase (`true`, lines 863-879) to stop propagation unless sort button was specifically targeted. Double-click on `.slick-resizable-handle` triggers `autoFitGridColumn` (lines 882-913).

5. **Slate / Material 3 Dark Theme**:
   - Location: `tad-master/packages/toadviewer/src/slickgrid.scss` (lines 162-262) & `src/toadTheme.ts` (lines 5-31).
   - Controlled via `localStorage.getItem("toad-theme-v2")`. Toggles `.toad-dark, .bp4-dark, .theme-dracula` on `<html>` and `<body>`.
   - Surfaces: `--md-sys-color-surface-container: #25262c`, `--md-sys-color-surface-dim: #18181c`.
   - Alternating rows: `--toad-grid-row-even: #1e1f24`, `--toad-grid-row-odd: #23252b`.
   - Row borders: `1px solid rgba(255, 255, 255, 0.04) !important`.
   - Hover background: `rgba(138, 180, 248, 0.08) !important`.
   - Selected cell: `rgba(138, 180, 248, 0.22) !important` with outline `1px solid #8ab4f8`.

---

### 1.2 Dynamic Auto-Wrap Column Height Calculation Formula (F26)
1. **Mathematical & Heuristic Engine**:
   - Location: `tad-master/packages/toadviewer/src/utils/CellLineCalculator.ts`.
   - `calculateLineCount(text, colWidth, options)` (lines 75-136):
     - Effective width: `Math.max(20, colWidth - padding)` (default padding = 12px).
     - Browser mode: measures segments with HTML5 Canvas 2D (`ctx.measureText(segment).width`) and simulates word-wrapping.
     - Node / Headless fallback: deterministic character-width heuristic (`maxCharsPerLine = Math.floor(effectiveWidth / charWidth)` with default `charWidth = 7.5px`).
     - Line splits: explicit CRLF (`\r\n`), CR (`\r`), LF (`\n`) newlines preserve empty lines. Unbroken tokens (e.g., long hashes, URLs, JSON) wrap character-by-character.
   - `getHeightAndScrollState(lineCount, lineHeight = 17, vertPadding = 8, defaultHeight = 24)` (lines 236-274):
     * **$N \le 1$**: `height = 24px`, `overflowY = "hidden"`, `hasScrollbar = false`, `shouldExpand = false`, `className = "cell-flat"`.
     * **$2 \le N \le 5$**: `height = N * 17px + 8px`, `overflowY = "hidden"`, `hasScrollbar = false`, `shouldExpand = true`, `className = "cell-expanded-fit"`.
       - $N=2 \rightarrow 42\text{px}$
       - $N=3 \rightarrow 59\text{px}$
       - $N=4 \rightarrow 76\text{px}$
       - $N=5 \rightarrow 93\text{px}$
     * **$N > 5$**: `height = 5 * 17px + 8px = 93px` (capped), `overflowY = "auto"`, `hasScrollbar = true`, `shouldExpand = true`, `className = "cell-expanded-scroll"`.

2. **Integration across All Three Tables**:
   - **Table 1 (Sidebar Files Table)**: `tad-master/packages/toadviewer/src/components/ProjectFilesTable.tsx` (lines 681-705). On selected row: computes `Math.max(calculateLineCount(fileName, nameWidth - 24), calculateLineCount(relDir, dirWidth - 12))`. If `heightState.shouldExpand`, applies `height` and `overflowY` to row and wrapper.
   - **Table 2 (Main DataGrid)**: `tad-master/packages/toadviewer/src/components/DataGrid.tsx` (`tryExpandCell`, lines 626-691). Computes `N = calculateLineCount(textContent, colWidth - 16)`. If $N \le 1$, immediately aborts (flat 24px). If $N \ge 2$, adds `.slick-cell-active-expanded` to cell, sets inline `height: heightState.height + "px"`, `overflow-y: heightState.overflowY`, and adds `.slick-row-has-expanded, .slick-row-active-expanded` to the row container.
   - **Table 3 (Parse Columns Table)**: `tad-master/packages/toadviewer/src/components/NestedFieldsTable.tsx` (lines 622-660). Computes `lineCount = calculateLineCount(field.sampleValue, colWidths.sample, { padding: 12 })`. When expanded, renders `.sample-val-text.is-expanded` with inline height and `overflow-y: heightState.overflowY`.

3. **CSS Layering & Isolation**:
   - Location: `tad-master/packages/toadviewer/src/slickgrid.scss` (lines 68-73, 105-143).
   - `.slick-cell`: `contain: strict; text-overflow: ellipsis; white-space: nowrap; overflow: hidden;` for high-performance virtualization.
   - `.slick-cell.slick-cell-active-expanded`: `position: absolute !important; z-index: 20 !important; contain: none !important;` (overrides strict containment), `white-space: normal !important; word-break: break-word !important; background: #ffffff; border: 1px solid #0284c7; box-shadow: 0 4px 14px rgba(0,0,0,0.15);`.
   - Slim scrollbar: custom `::-webkit-scrollbar` with `width: 4px`, `border-radius: 2px`.

4. **4-Way Collapse Lifecycle**:
   - **(1) Re-click active cell**: `handleGridClick` in `DataGrid.tsx` (lines 1040-1059) checks if `currentExpandedPos.row === args.row && currentExpandedPos.cell === args.cell` and not just activated $\rightarrow$ calls `dismissFloatingCell()`.
   - **(2) Click another cell**: `grid.onActiveCellChanged` (lines 917-930) triggers `tryExpandCell(args.row, args.cell)`, which executes `dismissFloatingCell()` on entry.
   - **(3) Click outside**: `handleGridOutsideClick` on document `mousedown` (lines 972-985) detects if `!container.contains(target)` $\rightarrow$ calls `dismissFloatingCell()`.
   - **(4) Escape key**: `handleGridEscape` on window `keydown` and `grid.onKeyDown` (lines 962-970, 1009-1013) checks `e.key === "Escape"` $\rightarrow$ calls `dismissFloatingCell()`.
   - **Additional triggers**: `grid.onScroll` (line 954) and `grid.onViewportChanged` (line 957) invoke `dismissFloatingCell()`.

---

### 1.3 Active Cell Glow Suppression behind Modal Overlays (F27)
1. **GridOverlayBus Event Bus**:
   - Location: `tad-master/packages/toadviewer/src/utils/GridOverlayBus.ts`.
   - Events defined:
     - `EVENT_DISMISS_GRID_CELL_EXPAND` (`"dismiss-grid-cell-expand"`)
     - `EVENT_PARSE_DIALOG_OPENED` (`"parse-dialog-opened"`)
     - `EVENT_PARSE_DIALOG_CLOSED` (`"parse-dialog-closed"`)
   - Dual-environment dispatcher: dispatches `window.dispatchEvent(new CustomEvent(...))` in browser DOM; falls back to an in-memory `Map<string, Set<ListenerCallback>>` in headless Node.js testing.

2. **Dialog Open Emission & Active Cell Reset**:
   - Location: `tad-master/packages/toadviewer/src/components/RegexDialog.tsx` (lines 236-266).
   - On `isOpen === true`:
     ```typescript
     emitDismissGridCellExpand();
     emitParseDialogOpened();
     // Remove floating DOM classes
     document.querySelectorAll(".slick-cell-active-expanded").forEach(c => c.classList.remove("slick-cell-active-expanded"));
     document.querySelectorAll(".slick-row-has-expanded, .slick-row-active-expanded").forEach(r => {
       r.classList.remove("slick-row-has-expanded");
       r.classList.remove("slick-row-active-expanded");
     });
     // Reset active cell focus
     if (maybeGrid && typeof maybeGrid.resetActiveCell === "function") {
       maybeGrid.resetActiveCell();
     }
     ```
   - On `isOpen === false`: calls `emitParseDialogClosed()`.

3. **CSS Overlay Suppression Rules**:
   - Location: `tad-master/packages/toadviewer/src/slickgrid.scss` (lines 145-160):
     ```scss
     body.bp4-overlay-open {
       .slick-cell.active,
       .slick-row.active,
       .slick-cell.selected {
         background: transparent !important;
         box-shadow: none !important;
         outline: none !important;
         border-color: transparent !important;
       }
       .slick-cell-active-expanded,
       .slick-row-has-expanded,
       .slick-row-active-expanded {
         display: none !important;
       }
     }
     ```
   - BlueprintJS automatically mounts `bp4-overlay-open` onto `document.body` whenever any modal, popover dialog, or drawer is opened. This stylesheet completely neutralizes white/blue active cell borders, outlines, glow, and elevated floating boxes behind the backdrop.

---

### 1.4 ArcSight ESM Filter & Pivot UI Condition Tree (F28)
1. **Filter Tree Data Structure & Bidirectional Mapping**:
   - Location: `tad-master/packages/toadviewer/src/components/FilterEditor.tsx` (lines 26-101).
   - Visual nodes:
     - `FilterRuleNode`: `{ id: string; type: "rule"; relExp: reltab.RelExp | null }`
     - `FilterGroupNode`: `{ id: string; type: "group"; op: reltab.BoolOp; children: Array<FilterRuleNode | FilterGroupNode> }`
   - `filterExpToTree(fe: FilterExp | null): FilterGroupNode` converts recursive `FilterExp` instances into a visual tree.
   - `treeToFilterExp(group: FilterGroupNode): FilterExp` traverses the tree, filters out empty rules, and constructs a clean nested `new FilterExp(group.op, opArgs)`.

2. **ArcSight ESM Operator Spectrum**:
   - Location: `tad-master/packages/reltab/src/FilterExp.ts` (lines 25-82).
   - Relational Binary Operators: `EQ` (=), `NEQ` (<>), `GT` (>), `GE` (>=), `LT` (<), `LE` (<=), `BEGINS` / `STARTSWITH` ("starts with"), `NOTBEGINS` ("does not start with"), `ENDS` / `ENDSWITH` ("ends with"), `NOTENDS` ("does not end with"), `CONTAINS` ("contains"), `NOTCONTAINS` ("does not contain"), `IN` ("in..."), `NOTIN` ("not in...").
   - Relational Unary Operators: `ISNULL` ("is null"), `NOTNULL` ("is not null").
   - Boolean Group Operators: `AND`, `OR`, `NOT`.
   - In `FilterEditorRow.tsx`:
     - Searchable column select via `react-select` (lines 751-797).
     - Distinct value cache autocomplete via `getOrLoadDistinctValues` (lines 527-561).
     - Multi-tag pill input `MultiTagPillInput` (lines 230-305) for `IN` / `NOTIN`, supporting tag pills, comma/Enter tokenization, clipboard paste splitting, and backspace deletion.

3. **Native Rust DuckDB SQL Compilation**:
   - Location: `tauri/project/src-tauri/src/engine/query_compiler.rs` (lines 581-815).
   - AST input deserialized via `serde(untagged)` into `QueryRep` / `FilterExp`.
   - String pattern operators compile to DuckDB dialect with path-slash normalization:
     - `CONTAINS` $\rightarrow$ `CONCAT_WS(...) ILIKE '%<term>%' ESCAPE '\'`
     - `BEGINS` / `STARTSWITH` $\rightarrow$ `ILIKE '<term>%' ESCAPE '\'`
     - `ENDS` $\rightarrow$ `ILIKE '%<term>' ESCAPE '\'`
     - Path slash normalization: if search term contains `/` or `\`, transforms LHS using `REGEXP_REPLACE(col::VARCHAR, '[\\/]+', '/', 'g')`.
     - `IN` / `NOTIN`: empty arrays compile to `1=0` / `1=1` guard; non-empty arrays format into quoted string / numeric lists.

4. **Pivot Table Configuration Integration**:
   - Location: `tad-master/packages/toadviewer/src/components/PivotSidebar.tsx` & `src/ViewParams.ts`.
   - `ViewParams` stores:
     - `vpivots: string[]` (columns forming pivot tree levels)
     - `pivotLeafColumn: string | null` (leaf level projection)
     - `openPaths: PathTree` (tracking expanded tree nodes by path array)
     - `showRoot: boolean` (global aggregations row at index 0)
     - `aggMap: AggMap` (aggregation function per column: `sum`, `avg`, `min`, `max`, `count`, `distinct`, `uniq`)
   - `aggtree.vpivot(rt, filterQuery, baseSchema, vpivots, pivotLeafColumn, showRoot, sortKey, aggMap)` builds the SQL query hierarchy.
   - In `DataGrid.tsx`: renders `_pivot` column with indent `calcIndent(depth)` ($15\text{px} \times \text{depth}$) and chevron toggles.
   - Clicking pivot toggle triggers `onGridClick` in `GridPane.tsx` (lines 153-169):
     ```typescript
     if (columnId === "_pivot") {
       if (item._isOpen) actions.closePath(path, stateRef);
       else actions.openPath(path, stateRef);
     }
     ```
     Updating `openPaths` triggers `PivotRequester` to refetch the tree data view.

---

## 2. Logic Chain

1. **Premise**: In Toad Tauri v2, the frontend (`toadviewer`) communicates with the backend exclusively via `TauriHostAdapter` using in-process Tokio IPC.
   - **Step 1**: Binary Arrow IPC streams are returned from `toad:eval_query` (`0xFFFFFFFF` continuation indicator).
   - **Step 2**: The existing decoding path in `tad-master/packages/reltab/src/remote/hybridProtocol.ts` (`arrowIPCToTableRep` using `@apache-arrow/es2015-cjs`) decodes zero-copy binary bytes into `TableRep`.
   - **Step 3**: `PagedDataView` wraps `TableRep.rowData` into a virtualized 1,000-row page with a 5-page sliding buffer (max 5,000 rows).
   - **Step 4**: SlickGrid renders only visible rows in the viewport by querying `dataView.getLength()` and `dataView.getItem(i)`. Memory consumption remains bounded regardless of total database row count.

2. **Premise**: Cell contents in security log analysis (EVTX messages, stack traces, nested JSON) can be arbitrarily long or multi-line.
   - **Step 1**: Unconditional cell expansion breaks virtualized row layout and causes viewport jitter.
   - **Step 2**: The strict contract formula in `CellLineCalculator.ts` ($N \le 1 \rightarrow 24\text{px}$ flat; $2 \le N \le 5 \rightarrow N \times 17\text{px} + 8\text{px}$; $N > 5 \rightarrow 93\text{px}$ capped with auto scrollbar) satisfies both compact readability and deep inspection.
   - **Step 3**: Overriding SlickGrid's `contain: strict` with `contain: none !important` and `z-index: 20` on `.slick-cell-active-expanded` allows the active cell to elevate in-place without shifting surrounding row positions.
   - **Step 4**: The 4-way collapse lifecycle (re-click, click another cell, click outside, press Escape) reliably dismantles floating overlays before any subsequent action.

3. **Premise**: High-contrast active cell borders and selection glow bleeding through semi-transparent modal dialog backdrops degrade UI professionalism.
   - **Step 1**: The combination of `GridOverlayBus` broadcasting `dismiss-grid-cell-expand`, programmatic `grid.resetActiveCell()`, and CSS selector `body.bp4-overlay-open` fully suppresses cell highlights.
   - **Step 2**: In `slickgrid.scss`, setting `.slick-cell.active, .slick-row.active, .slick-cell.selected` to `background: transparent !important; box-shadow: none !important; outline: none !important; border-color: transparent !important;` guarantees zero glow behind modal dialogs.

4. **Premise**: ArcSight ESM forensic investigations require expressive multi-condition filter trees and multi-level pivot aggregation.
   - **Step 1**: `filterExpToTree` and `treeToFilterExp` provide lossless bidirectional translation between React UI state and `reltab.FilterExp`.
   - **Step 2**: `query_compiler.rs` on the Rust backend compiles all ArcSight operators (`EQ`, `NEQ`, `CONTAINS`, `BEGINS`/`STARTSWITH`, `ENDS`, `IN`, `NOTIN`, `ISNULL`, `NOTNULL`, `AND`, `OR`, `NOT`) directly into DuckDB SQL expressions, including slash normalization.
   - **Step 3**: `aggtree.vpivot` integrates with `ViewParams` and `DataGrid` to render multi-level tree hierarchies with rollup metrics and fast expand/collapse branch navigation.

---

## 3. Caveats

1. **HTML5 Canvas 2D in Headless Tests**:
   - `CellLineCalculator.ts` relies on `document.createElement("canvas")` and `ctx.measureText` in the browser. In headless Node.js unit tests (where DOM canvas is absent), it falls back to the deterministic heuristic mode (`charWidth = 7.5px`). Test suites are calibrated to this heuristic. Implementers must ensure that any custom font configurations passed in browser mode match the monospace or proportional font metric settings.
2. **Vite 5 Bundling & SCSS Preprocessor**:
   - In `tauri/project/vite.config.ts`, alias `{ find: /^~/, replacement: '' }` is configured to resolve SlickGrid SCSS variable imports (`@import "~slickgrid-es6/..."`). SCSS preprocessor option `api: 'modern-compiler'` is set. Implementers must verify that `slickgrid.scss` imports compile cleanly under Vite 5 without Webpack-specific loader dependencies.
3. **BlueprintJS v4 Styling**:
   - ToadViewer uses `@blueprintjs/core` v4 (`bp4-*` class namespaces). Modal backdrop overlay suppression depends on `body.bp4-overlay-open`. If BlueprintJS is updated or if custom modal components are used, ensure that `body.bp4-overlay-open` is attached or dispatch through `GridOverlayBus`.
4. **DataPort Feature Flag**:
   - In `TauriHostAdapter.ts`, binary IPC responses must be received as `Uint8Array`. Ensure Tauri v2 permissions allow binary IPC response transfer (`tauri::ipc::Response`).

---

## 4. Conclusion

- **SlickGrid Virtualization (F25)** is fully designed and operational via `@apache-arrow/es2015-cjs` zero-copy decoding into `TableRep` and `PagedDataView` (1,000-row pagination with 5-page sliding buffer). It seamlessly connects to the Tauri v2 backend streaming Arrow IPC protocol.
- **Dynamic Auto-Wrap (F26)** is implemented mathematically in `CellLineCalculator.ts` and wired into all three tables (`ProjectFilesTable`, `DataGrid`, `NestedFieldsTable`), enforcing the contract:
  - $N \le 1$: flat 24px, no scrollbar.
  - $2 \le N \le 5$: $N \times 17\text{px} + 8\text{px}$, `overflow-y: hidden`.
  - $N > 5$: 93px capped, `overflow-y: auto` with 4px slim scrollbar.
  - 4-way collapse lifecycle (re-click, click another cell, click outside, Escape) and scroll dismissal are verified.
- **Active Cell Glow Suppression (F27)** is enforced by `GridOverlayBus` events, `grid.resetActiveCell()`, and `body.bp4-overlay-open` CSS rules, eliminating all active cell outlines and glow behind modal overlays.
- **ArcSight ESM & Pivot Table (F28)** provides a complete condition tree query editor supporting all standard operators (`EQ`, `NEQ`, `CONTAINS`, `STARTSWITH`, `IN`, `AND`, `OR`, `NOT`) compiled into DuckDB SQL via `query_compiler.rs`, paired with `aggtree.vpivot` multi-level tree aggregation.

---

## 5. Verification Method

### 5.1 Test Execution Commands
All test suites can be executed independently using the Node runtime:
```powershell
# 1. CellLineCalculator Boundary & Contract Suite (25 Tests)
& "d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tests/unit/test_cell_line_calculator.js

# 2. Modal Cell Glow Suppression QA Suite (10 Tests)
& "d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tests/qa/test_modal_cell_glow_suppression.js

# 3. Parse Columns Dialog & Nested Dropdown Suite (15 Tests)
& "d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tests/unit/test_parse_dialog_nested_dropdown.js

# 4. DataGrid Floating Cell Wrap & Auto-Fit Suite (15 Tests)
& "d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tests/unit/test_datagrid_floating_wrap.js

# 5. Filter Editor Apply Lifecycle Suite (10 Tests)
& "d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tests/unit/test_filter_editor_apply_lifecycle.js

# 6. 100K Rows Virtual Scroll & Concurrency Stress Suite (10 Tests)
& "d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tests/qa/test_grid_wrap_concurrency_stress.js
```

### 5.2 Verification Results Summary
- `test_cell_line_calculator.js`: **25 / 25 PASS (100%)**
- `test_modal_cell_glow_suppression.js`: **10 / 10 PASS (100%)**
- `test_parse_dialog_nested_dropdown.js`: **15 / 15 PASS (100%)**
- `test_datagrid_floating_wrap.js`: **15 / 15 PASS (100%)**
- `test_filter_editor_apply_lifecycle.js`: **10 / 10 PASS (100%)**
- `test_grid_wrap_concurrency_stress.js`: **10 / 10 PASS (100%)**

### 5.3 Invalidation Conditions
- Any drift from the height formula ($N \le 1$: 24px, $2 \le N \le 5$: $N \times 17 + 8\text{px}$, $N > 5$: 93px) invalidates Test 22-24.
- Any cell border, outline, or glow remaining visible when `body.bp4-overlay-open` is active invalidates Test 2-6 and 9 of the QA suppression suite.
- Failure of `grid.onScroll` or `Escape` to dismiss floating cell overlays invalidates Test 2.13 and 2.14.
- Inability of `treeToFilterExp` or `query_compiler.rs` to compile nested `AND`/`OR` or `IN` pill lists invalidates F28 condition tree contracts.
