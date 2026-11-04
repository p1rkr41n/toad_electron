# Frontend Source & Host Bridge Integration Survey Report
**Project:** Toad Tauri v2 Migration (`TOAD-TAURI-V2`)  
**Investigator:** Explorer Subagent 1 (`explorer_survey_1`)  
**Date:** 2026-11-04  
**Scope:** `tad-master/packages/toadviewer` & `tad-master/packages/host-bridge`  

---

## 1. Executive Summary & Architectural Overview

The goal of this survey is to analyze the existing frontend source code in `tad-master/packages/toadviewer` and the host abstraction layer in `tad-master/packages/host-bridge` to establish the exact technical requirements, IPC command catalog, data contracts, and potential pitfalls for porting the Toad frontend into `tauri/project` using **Vite 5** and **React 18** under **Tauri v2**.

### Key High-Level Findings:
1. **Frontend Portability is Extremely High (Zero C++ Dependencies):**  
   Unlike the previous Electron architecture where DuckDB ran in Node.js via `reltab-duckdb` (native C++ `.node` add-on), the frontend packages (`toadviewer`, `reltab`, `aggtree`, `host-bridge`) are **100% pure TypeScript / JavaScript**. There are zero native C/C++ dependencies in the frontend canvas (Ring 3). The entire data analytics engine and file decoding pipeline moves natively into Rust (`src-tauri`).
2. **Standardized Host Bridge Interface Already Implemented:**  
   `TauriHostAdapter.ts` already implements `IHostBridge`, providing concrete bindings for `window.__TAURI__.core.invoke`, binary responses (`invokeBinary`), and event listening (`window.__TAURI__.event.listen`).
3. **Critical Reverse Command Alias Overwrite Discovered:**  
   In `packages/host-bridge/src/commandAliases.ts`, duplicate reverse mapping keys overwrite canonical commands: `"DataSourceConnection.evalQuery"` resolves to `"evalQuery"` rather than `"toad:eval_query"`; `"DataSourceConnection.rowCount"` resolves to `"rowCount"` rather than `"toad:row_count"`; `"DataSourceConnection.getTableSchema"` resolves to `"getTableSchema"` rather than `"toad:schema"`. This must be addressed in the Rust command router or in the alias builder.
4. **Vite 5 Bundler Requirements Identified:**  
   - Less and Sass style compilation requires handling Webpack's legacy `~` prefix (`~slickgrid-es6`, `~@blueprintjs`, `~normalize.css`).
   - Dynamic `require("host-bridge")` calls inside event handlers must either be replaced with static ESM imports or supported via a lightweight runtime provider.
   - BigInt serialization polyfill (`BigInt.prototype.toJSON`) is required globally before any Arrow/DuckDB queries run.

---

## 2. Deep Dive: `tad-master/packages/toadviewer`

### 2.1 Package Dependencies & Peer Dependencies

From `packages/toadviewer/package.json`:
- **Core Framework & State:**
  - `react`: `^18.2.0`, `react-dom`: `^18.2.0` (Peer dependencies)
  - `oneref`: `^0.9.0` (Immutable reference-based state management via `StateRef`, `mkRef`, `refContainer`, `update`)
  - `immutable`: `^4.0.0` (Immutable data structures for view parameters and paths)
  - `lodash`: `^4.17.21` (Utility functions)
  - `loglevel`: `^1.8.0` (Client-side logging)
  - `use-deep-compare`: `1.1.0` (React hook for deep dependency comparison)
- **UI Components & Icons:**
  - `@blueprintjs/core`: `4.12.0` (Dialogs, Buttons, FormGroups, Tooltips, Menus)
  - `@blueprintjs/popover2`: `1.10.1` (Popovers and Context Menus)
  - `@blueprintjs/icons`: `^4.10.1` (SVG icon set)
  - `react-select`: `^5.2.1` (Dropdown selectors)
  - `react-dnd` & `react-dnd-html5-backend`: `^14.0.5` / `^14.1.0` (Drag-and-drop column reordering)
  - `victory`: `^36.6.10` (SVG histograms and distribution charts in column headers)
- **Grid Virtualization:**
  - `slickgrid-es6`: `^3.0.3` (Virtualized 60fps high-performance data table)
  - `he`: `^1.2.0` (HTML entity encoding/decoding for safe cell rendering)
- **Vectorized Data & Query AST:**
  - `@apache-arrow/es2015-cjs`: `^16.1.0` (High-speed zero-copy Arrow IPC stream decoder)
  - `reltab`: `^0.12.0` / `^0.14.0` (Relational query AST: `QueryExp`, `FilterExp`, `Schema`, `TableRep`)
  - `aggtree`: `^0.12.0` (Hierarchical pivot aggregation engine)
  - `host-bridge`: `^2.4.0` (Interface abstraction to host runtime)

### 2.2 React 18 Integration
- Initialized using the modern React 18 Concurrent Root API:
  ```typescript
  const root = ReactDOM.createRoot(document.getElementById("app")!);
  root.render(<App ... />);
  ```
- Component state updates use `oneref.refContainer(stateRef, AppPane)` which subscribes to state reference changes and triggers React re-renders without full component tree remounts.

### 2.3 SlickGrid Virtualization
- Implemented in `packages/toadviewer/src/components/DataGrid.tsx`.
- Connects to `PagedDataView` (paging data model) which requests pages dynamically from the DuckDB backend via `RemoteReltabConnection`.
- Fast Reflow Containment: Default cells use `contain: strict; text-overflow: ellipsis; white-space: nowrap; overflow: hidden;` to maintain 60 FPS even on 100,000+ rows.

### 2.4 Column Resizing & Dblclick Auto-Fit
- Header resizing handle: `.slick-resizable-handle` styled to 6px wide with an active hover line indicator (`rgba(2, 132, 199, 0.75)` in light theme, `rgba(56, 189, 248, 0.85)` in dark theme).
- Double-click Auto-Fit: Captures `dblclick` on `.slick-resizable-handle` in `DataGrid.tsx` (lines 882-913):
  ```typescript
  const calculatedWidth = Math.min(500, Math.max(60, Math.round(maxLen * 7.5 + 24)));
  ```
  Measures visible viewport rows, clamps column width between 60px and 500px, and updates grid column definitions.

### 2.5 Floating In-Place Cell Auto-Wrap & Mathematical Engine (`CellLineCalculator`)
- Implemented in `packages/toadviewer/src/utils/CellLineCalculator.ts`.
- **Canvas 2D Measurement & Headless Fallback:**
  - In browser runtime (WebView2), uses an offscreen `HTMLCanvasElement` 2D context (`ctx.measureText(segment).width`) to accurately measure visual line wrapping under the active font (`Inter, sans-serif`).
  - In headless / Node.js test environments, falls back to deterministic character width (`fallbackCharWidth: 7.5px`, `padding: 12px`).
- **N-Line Contract Compliance:**
  - **$N \le 1$:** `shouldExpand = false`, flat single-line, default height (24px), `overflow-y: hidden`, `hasScrollbar: false`.
  - **$2 \le N \le 5$:** `shouldExpand = true`, dynamic expansion to exactly $N \times 17\text{px} + 8\text{px}$, `overflow-y: hidden`, `hasScrollbar: false`.
  - **$N > 5$:** `shouldExpand = true`, height capped at 5 lines ($5 \times 17\text{px} + 8\text{px} = 93\text{px}$), `overflow-y: auto`, slim 4px scrollbar enabled.
- **4-Way Collapse Lifecycle:**
  1. Re-clicking the active cell toggles it back to compact state.
  2. Clicking another cell/row expands the new cell and collapses the old.
  3. Clicking outside the grid container dismisses the expansion.
  4. Pressing `Escape` collapses the floating active cell immediately.
- **Multi-Table Deployment:** Applied across Table 1 (`ProjectFilesTable.tsx`), Table 2 (`DataGrid.tsx`), and Table 3 (`NestedFieldsTable.tsx` / `RegexDialog.tsx`).

### 2.6 Active Cell Glow Suppression behind Modal Overlays (`GridOverlayBus`)
- Implemented in `packages/toadviewer/src/utils/GridOverlayBus.ts` and `src/slickgrid.scss`.
- When modal dialogs (such as `RegexDialog.tsx`) open (`isOpen === true`):
  1. Calls `emitDismissGridCellExpand()` and `emitParseDialogOpened()`.
  2. Removes `.slick-cell-active-expanded`, `.slick-row-has-expanded`, and `.slick-row-active-expanded`.
  3. Calls `grid.resetActiveCell()` to remove active cell focus.
  4. Global CSS rule in `slickgrid.scss`:
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
     Completely eliminates ugly glowing white or blue rectangles behind modal backdrops.

### 2.7 Styling Pipeline: Less, Sass & Dark Themes
- Primary Stylesheet:
  - `src/slickgrid.scss`: Contains SlickGrid theme, resizer handles, floating cell wrap, and dark mode overrides.
  - `less/tadviewer.less`: Root styles, layout containers, and loading overlays.
  - `less/sidebar.less`: Workspace sidebar, project tree, file lists, and context menus.
  - `less/nested-dialog.less`: Parse columns modal layout and nested JSON tree styling.
  - `less/activityBar.less`, `less/filterEditor.less`, `less/eventDetailSidebar.less`, etc.
- Dark Themes: Supports Google Material 3 (`.toad-dark`) and Blueprint Dark (`.bp4-dark`) with full WCAG AAA compliant slate backgrounds (`#18181c`, `#1e1f24`, `#25262c`, `#38bdf8`).

### 2.8 ArcSight ESM Filter Condition Tree
- Implemented in `packages/toadviewer/src/components/FilterEditor.tsx` and `FilterEditorRow.tsx`.
- Hierarchical Boolean tree supporting nested `AND` and `OR` groups.
- Visual pill input, operator selectors (`=`, `<>`, `>`, `>=`, `<`, `<=`, `starts with`, `ends with`, `contains`, `is null`, `is not null`, `in...`), and live matching row counter.
- Compiles directly into `reltab.FilterExp` AST for execution in DuckDB.

### 2.9 Pivot Tables & Aggregations
- Implemented in `packages/toadviewer/src/PivotRequester.ts`.
- Uses `aggtree.vpivot` to construct multi-level grouping and aggregation queries.
- Manages open/collapsed tree paths (`openPaths`), depth indentations (`calcIndent(depth)`), and aggregation functions (`count`, `sum`, `avg`, `min`, `max`).

### 2.10 Parse Columns Dialog (`RegexDialog.tsx`)
- Supports Regex extraction, CSV delimiter splitting, and **Nested JSON auto-flattening**.
- R2 Compliance:
  - Modal switcher displays strictly `[Visual]` and `[Regex]`.
  - Format selector contains `Nested JSON` (`<option value="nested_json">Nested JSON</option>`).
  - Switching to `nested_json` dynamically renders `SampleScanController`, `NestedFieldsTable`, and live DuckDB SQL preview (`DuckDbJsonSqlBuilder`).

---

## 3. Deep Dive: `tad-master/packages/host-bridge`

### 3.1 Host Bridge Architecture

`IHostBridge` (`packages/host-bridge/src/IHostBridge.ts`) defines the contract between the frontend UI and the host runtime:
- Extends `reltab.TransportClient` so database queries flow through `invoke` naturally.
- Concrete implementation: `TauriHostAdapter` (`packages/host-bridge/src/TauriHostAdapter.ts`).
- Singleton access via `getHostBridge()` and `setHostBridge(customBridge: IHostBridge)`.

```
+-------------------------------------------------------------------+
|                        React 18 UI Canvas                         |
|   (AppPane, DataGrid, ProjectFilesTable, RegexDialog, Sidebar)    |
+---------------------------------+---------------------------------+
                                  |
                   IHostBridge / TauriHostAdapter
                                  |
            +---------------------+---------------------+
            |                                           |
  window.__TAURI__.core.invoke                window.__TAURI__.event
  (Commands & invokeBinary)                   (listen & emit)
            |                                           |
+-----------v-------------------------------------------v-----------+
|                     Tauri v2 Rust Backend                         |
|    - AppState & Command Router (tauri::Builder)                   |
|    - DuckDB 1.0 In-Process Async Pool                             |
|    - Streaming Arrow IPC Protocol (tauri::ipc::Response)          |
|    - Parquet State Ledger WAL (toad_ledger.parquet)               |
+-------------------------------------------------------------------+
```

### 3.2 Canonical IPC Command Aliases Table

The following table comprehensively maps all commands defined in `commandAliases.ts`:

| Canonical Tauri Command | Legacy IPC Channel | Category | Description | Payload Parameters | Response Type |
|---|---|---|---|---|---|
| `toad:init_main` | `initMain` | Lifecycle | Initializes backend core & WAL | `{}` | `void` / Status |
| `toad:get_config` | `getToadConfig` | Config | Retrieves `config.ini` settings | `{}` | `AppConfigDTO` |
| `toad:new_window` | `newWindowFromDSPath` | Window | Opens a new app window | `dsPath: DataSourcePath` | `void` |
| `toad:get_setup_info` | `getSetupInfo` | Environment | Returns system & engine info | `{}` | `SetupInfoDTO` |
| `toad:open_example` | `openExample` | Demo | Loads embedded sample file | `{}` | `void` |
| `toad:eval_query` | `DataSourceConnection.evalQuery` | Engine | Evaluates QueryExp AST | `{ engine, queryStr, offset, limit, options }` | **Binary Arrow IPC** (`Uint8Array`) |
| `toad:query` | `DataSourceConnection.evalQuery` | Engine | Alias for `toad:eval_query` | Same as `toad:eval_query` | **Binary Arrow IPC** |
| `toad:row_count` | `DataSourceConnection.rowCount` | Engine | Returns query row count | `{ engine, queryStr, options }` | `number` |
| `toad:schema` | `DataSourceConnection.getTableSchema` | Engine | Fetches DuckDB table schema | `{ tableName: string }` | `SchemaDTO` |
| `toad:get_table_schema` | `DataSourceConnection.getTableSchema` | Engine | Alias for `toad:schema` | `{ tableName: string }` | `SchemaDTO` |
| `toad:get_table_name` | `DataSourceConnection.getTableName` | Engine | Resolves source path to DuckDB view | `{ engine, path, forceReopen, isBackground }` | `string` (table name) |
| `toad:run_sql_arrow` | `DataSourceConnection.runSqlQueryArrow` | Engine | Executes raw SQL to Arrow | `{ sqlQuery: string }` | **Binary Arrow IPC** |
| `engine:get_status` | `engine:status` | Engine | Engine health & memory usage | `{}` | `{ status, memory_used, threads }` |
| `engine:do_restart` | `engine:restart` | Engine | Restarts DuckDB connection pool | `{}` | `{ success: boolean }` |
| `plugin:dialog|open` | `dialog:showOpenDialog` | Plugin | Native Windows open file dialog | `OpenDialogOptions` | `string[] \| null` |
| `plugin:dialog|save` | `dialog:showSaveDialog` | Plugin | Native Windows save file dialog | `SaveDialogOptions` | `string \| null` |
| `plugin:dialog|error` | `errorDialog` | Plugin | Native Windows error dialog | `{ title, message, fatal }` | `void` |
| `plugin:clipboard|write_text` | `clipboard:writeText` | Plugin | Copies string to clipboard | `{ text: string }` | `void` |
| `plugin:opener|open_url` | `shell:openExternal` | Plugin | Opens URL in default browser | `{ url: string }` | `void` |
| `project:get_workspace` | `project:getWorkspace` | Workspace | Retrieves all projects & active ID | `{}` | `{ projects, activeProjectId }` |
| `project:get_files` | `project:getFiles` | Workspace | Retrieves files for a project | `{ projectId: string }` | `ProjectWorkspaceFile[]` |
| `project:create` | `project:create` | Workspace | Creates new project entry in WAL | `{ projectName, projectId? }` | `string` (project ID) |
| `project:rename` | `project:rename` | Workspace | In-place metadata rename | `{ projectId, newName }` | `boolean` |
| `project:delete` | `project:delete` | Workspace | Cascade deletes project & cache | `{ projectId: string }` | `{ deletedFiles, freedBytes }` |
| `project:delete_all` | `project:deleteAll` | Workspace | Deletes all projects & caches | `{}` | `{ success, freedBytes, deletedProjects }` |
| `project:set_active` | `project:setActive` | Workspace | Sets active project ID | `{ projectId: string }` | `void` |
| `project:reconcile` | `project:reconcile` | Workspace | Reconciles missing files on startup | `{}` | `ReconciliationResult` |
| `project:get_cache_size` | `project:getCacheSize` | Workspace | Calculates cache footprint | `{ projectId: string }` | `{ fileCount, totalBytes, formattedSize }` |
| `project:purge_cache` | `project:purgeCache` | Workspace | Cleans up parquet cache files | `{ projectId: string }` | `{ purgedFiles, freedBytes }` |
| `project:add_files` | `project:addFiles` | Workspace | Adds source files to project | `{ projectId, filePaths: string[] }` | `void` |
| `project:add_folder` | `project:addFolder` | Workspace | Recursively adds folder files | `{ projectId, folderPath: string }` | `string[]` (added paths) |
| `project:remove_file` | `project:removeFile` | Workspace | Removes single file from project | `{ projectId, filePath: string }` | `{ freedBytes: number }` |
| `project:move_orphan_files` | `project:moveOrphanFiles` | Workspace | Moves orphan files to target | `{ targetProjectId: string }` | `void` |

---

### 3.3 Critical Findings: Reverse Alias Collisions

In `packages/host-bridge/src/commandAliases.ts`:
```typescript
export const COMMAND_ALIAS_MAP: Record<string, string> = {
  ...
  "toad:eval_query": "DataSourceConnection.evalQuery",
  "toad:query": "DataSourceConnection.evalQuery",
  "evalQuery": "DataSourceConnection.evalQuery",
  "toad:row_count": "DataSourceConnection.rowCount",
  "rowCount": "DataSourceConnection.rowCount",
  "toad:schema": "DataSourceConnection.getTableSchema",
  "toad:get_table_schema": "DataSourceConnection.getTableSchema",
  "schema": "DataSourceConnection.getTableSchema",
  "getTableSchema": "DataSourceConnection.getTableSchema",
  ...
};

export const REVERSE_COMMAND_ALIAS_MAP: Record<string, string> = Object.entries(
  COMMAND_ALIAS_MAP
).reduce((acc, [tauriCmd, legacyCmd]) => {
  acc[legacyCmd] = tauriCmd;
  return acc;
}, {} as Record<string, string>);
```

#### Collision Mechanism:
When `REVERSE_COMMAND_ALIAS_MAP` is generated by iterating over `COMMAND_ALIAS_MAP`, later entries overwrite earlier entries with the same value:
1. `["toad:eval_query", "DataSourceConnection.evalQuery"]` sets `acc["DataSourceConnection.evalQuery"] = "toad:eval_query"`.
2. `["evalQuery", "DataSourceConnection.evalQuery"]` **overwrites** `acc["DataSourceConnection.evalQuery"] = "evalQuery"`!
3. Similarly, `acc["DataSourceConnection.rowCount"]` becomes `"rowCount"` (NOT `"toad:row_count"`).
4. `acc["DataSourceConnection.getTableSchema"]` becomes `"getTableSchema"` (NOT `"toad:schema"`).

#### Impact & Action Required:
If the Rust backend expects the namespaced command name `toad:eval_query`, calling `resolveTauriCommand("DataSourceConnection.evalQuery")` in `TauriHostAdapter` currently outputs `"evalQuery"`, which will result in command not found!
**Resolution Recommendation:**
Update `commandAliases.ts` so canonical namespaced commands (starting with `toad:`, `project:`, `plugin:`) take strict precedence and are never overwritten:
```typescript
export const REVERSE_COMMAND_ALIAS_MAP: Record<string, string> = Object.entries(
  COMMAND_ALIAS_MAP
).reduce((acc, [tauriCmd, legacyCmd]) => {
  // Only assign if not already set, or if tauriCmd contains the canonical namespace ':'
  if (!acc[legacyCmd] || tauriCmd.includes(":")) {
    acc[legacyCmd] = tauriCmd;
  }
  return acc;
}, {} as Record<string, string>);
```
Additionally, the Rust command dispatcher (`src-tauri/src/commands/mod.rs`) should register both aliases to guarantee 100% fail-safe compatibility.

---

### 3.4 Vectorized Apache Arrow IPC Stream Protocol (`0xFFFFFFFF`)

The high-throughput data transfer between the Rust DuckDB engine and the React UI operates via zero-copy Arrow IPC Streams:
- **Format Indicator:** Every Arrow IPC Stream starts with the continuation token `0xFFFFFFFF` (4 bytes `[0xFF, 0xFF, 0xFF, 0xFF]`).
- **Rust Backend:** Returns binary data wrapped in `tauri::ipc::Response`:
  ```rust
  let ipc_bytes: Vec<u8> = duckdb_batch_to_arrow_ipc(&batch)?;
  Ok(tauri::ipc::Response::new(ipc_bytes))
  ```
- **Frontend WebView2:**
  - `TauriHostAdapter.invokeBinary(cmd, args)` receives the raw `ArrayBuffer` directly from WebView2.
  - Passes the buffer to `arrowIPCToTableRep(buffer)` in `packages/reltab/src/remote/hybridProtocol.ts`.
  - Uses `tableFromIPC(u8)` from `@apache-arrow/es2015-cjs`.
  - Reconstitutes the `toadSchema` metadata embedded in the Arrow schema header.
  - Columnar values are mapped into Row objects for `TableRep` and fed into `PagedDataView` for SlickGrid.
  - Decodes Decimals (`formatArrowDecimal`), 64-bit BigInts, microsecond Timestamps (`formatArrowTime`), Dates, and Booleans with bit-level fidelity.

---

### 3.5 Event Subsystem Catalog

Tauri v2 event bridge operates via `TauriHostAdapter.listen` (`window.__TAURI__.event.listen`) and `TauriHostAdapter.emit` (`window.__TAURI__.event.emit`).

#### Backend -> Frontend Events:
1. `project:workspaceChanged`: Dispatched when any project or file is added, deleted, or updated. Triggers `ProjectWorkspaceManager.notify()`.
2. `toad-ingest-progress`: Dispatched continuously during background CSV/EVTX/JSONL ingestion. Payload:
   ```json
   {
     "filePath": "C:\\logs\\Security.evtx",
     "percent": 68,
     "status": "processing",
     "speedMBs": 112.5,
     "etaSec": 2
   }
   ```
   Caught by `appMain.tsx` and updated in `MultipleLoadingManager`.
3. `open-file`: Dispatched when the user double-clicks an associated file (`.csv`, `.parquet`, `.evtx`) or launches with CLI arguments. Payload: `{ openParams }`.
4. `reopen-current-file`: Dispatched on file modification or external reload request.
5. `engine:restored`: Dispatched if an in-process engine panic was caught and recovered by Rust panic guard. Shows non-blocking toast and reconciles view.
6. `project-add-files` / `project-add-folder`: Triggered from native application menu shortcuts.
7. `request-serialize-app-state`: Shell requests current UI workspace state.
8. `request-serialize-filter-query`: Shell requests current filter query SQL/JSON.
9. `open-export-begin-dialog`, `open-export-progress-dialog`, `close-export-progress-dialog`, `export-progress`.

#### Frontend -> Backend Events:
1. `render-init-complete`: Emitted when React 18 finishes initial DOM mount in `main.tsx`.
2. `response-serialize-app-state`: Returns serialized workspace state JSON to shell.
3. `response-serialize-filter-query`: Returns serialized filter query string.
4. `browse-export-path`: Requests native file save dialog for export.
5. `export-file`: Triggers background export job with format and options.

---

## 4. Vite 5 Porting Strategy & Build Requirements

### 4.1 Target Layout in `tauri/project`
```
tauri/project/
├── index.html                  # Pure web entrypoint
├── package.json                # React 18, Vite 5, @tauri-apps/api@^2.0.0
├── vite.config.ts              # Vite 5 bundler configuration
├── tsconfig.json               # TypeScript configuration
├── src/
│   ├── main.tsx                # Entrypoint (React 18 createRoot, polyfills, bridge init)
│   ├── App.tsx                 # Root application wrapper
│   └── ...                     # Source ported from toadviewer & host-bridge
└── src-tauri/                  # 100% Native Rust Backend
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── capabilities/
    │   └── default.json
    └── src/
        ├── lib.rs
        └── main.rs
```

### 4.2 Required Dependencies for `tauri/project/package.json`
```json
{
  "name": "toad-tauri-app",
  "version": "2.5.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@apache-arrow/es2015-cjs": "^16.1.0",
    "@blueprintjs/core": "^4.12.0",
    "@blueprintjs/icons": "^4.10.1",
    "@blueprintjs/popover2": "^1.10.1",
    "@tauri-apps/api": "^2.0.0",
    "@tauri-apps/plugin-clipboard-manager": "^2.0.0",
    "@tauri-apps/plugin-dialog": "^2.0.0",
    "@tauri-apps/plugin-opener": "^2.0.0",
    "he": "^1.2.0",
    "immutable": "^4.3.7",
    "lodash": "^4.17.21",
    "loglevel": "^1.9.1",
    "normalize.css": "^8.0.1",
    "oneref": "^0.9.0",
    "react": "^18.2.0",
    "react-dnd": "^14.0.5",
    "react-dnd-html5-backend": "^14.1.0",
    "react-dom": "^18.2.0",
    "react-select": "^5.8.0",
    "slickgrid-es6": "^3.0.3",
    "use-deep-compare": "^1.3.0",
    "victory": "^36.6.10"
  },
  "devDependencies": {
    "@types/he": "^1.2.3",
    "@types/lodash": "^4.17.13",
    "@types/node": "^20.17.0",
    "@types/react": "^18.2.79",
    "@types/react-dom": "^18.2.25",
    "@types/slickgrid": "^2.1.35",
    "@vitejs/plugin-react": "^4.3.3",
    "less": "^4.2.0",
    "sass": "^1.80.6",
    "typescript": "^5.6.3",
    "vite": "^5.4.10"
  }
}
```

### 4.3 `vite.config.ts` Configuration Essentials
1. **Handling Webpack `~` Prefix in Less & Sass:**
   Vite's CSS preprocessor does not strip `~` by default. Configure an alias regex:
   ```typescript
   import { defineConfig } from 'vite';
   import react from '@vitejs/plugin-react';
   import path from 'path';

   export default defineConfig({
     plugins: [react()],
     resolve: {
       alias: [
         { find: /^~/, replacement: '' },
         { find: 'toadviewer', replacement: path.resolve(__dirname, '../../tad-master/packages/toadviewer/src') },
         { find: 'reltab', replacement: path.resolve(__dirname, '../../tad-master/packages/reltab/src') },
         { find: 'aggtree', replacement: path.resolve(__dirname, '../../tad-master/packages/aggtree/src') },
         { find: 'host-bridge', replacement: path.resolve(__dirname, '../../tad-master/packages/host-bridge/src') },
       ],
     },
     css: {
       preprocessorOptions: {
         less: {
           javascriptEnabled: true,
           math: 'always',
         },
         scss: {
           api: 'modern-compiler',
         },
       },
     },
     build: {
       target: 'esnext',
       outDir: 'dist',
       emptyOutDir: true,
     },
   });
   ```
2. **Replacing Dynamic `require("host-bridge")` in ESM:**
   In `ProjectWorkspaceManager.ts`, `MultipleLoadingManager.ts`, and `DataSourceSidebar.tsx`, replace dynamic `require("host-bridge")` with static ESM:
   ```typescript
   import { getHostBridge } from "host-bridge";
   ```
   Or instantiate `setHostBridge(new TauriHostAdapter())` during initialization in `main.tsx`.

3. **Global BigInt Serialization Shim:**
   Place this snippet at the very top of `main.tsx` before any other imports:
   ```typescript
   if (typeof BigInt !== "undefined" && !(BigInt.prototype as any).toJSON) {
     (BigInt.prototype as any).toJSON = function () {
       const num = Number(this);
       return Number.isSafeInteger(num) ? num : this.toString();
     };
   }
   ```

---

## 5. Edge Cases & Risk Analysis

| # | Component | Risk / Edge Case | Manifestation | Mitigation Strategy |
|---|---|---|---|---|
| **E1** | `commandAliases.ts` | Reverse key collision in `reduce` | Calls `evalQuery` instead of `toad:eval_query` | Prioritize namespaced keys with `:` and register both in Rust command router |
| **E2** | `Connection.ts` | `dataPort` falsy bypasses `invokeBinary` | Skips binary Arrow decoder, falls back to JSON | Set `(adapter as any).dataPort = true` on `TauriHostAdapter` |
| **E3** | Less / Sass | Webpack `~` module prefix fails in Vite | `[vite:css] Failed to resolve import "~slickgrid-es6"` | Add `{ find: /^~/, replacement: '' }` alias in `vite.config.ts` |
| **E4** | `toadviewer` | Dynamic `require("host-bridge")` inside click events | Runtime `ReferenceError: require is not defined` | Migrate to static ESM `import { getHostBridge }` |
| **E5** | Arrow Decoder | 0-row empty result set | TableRep missing column schemas | Rust Arrow encoder must still emit Schema batch for empty tables |
| **E6** | Arrow BigInt | JS `JSON.stringify` throws on BigInt | Crash when serializing filter state or query | Polyfill `BigInt.prototype.toJSON` at root entrypoint `main.tsx` |
| **E7** | Modal Overlay | Active grid cell glows blue/white behind dialog | Visual glitch through semi-transparent backdrop | Dispatch `dismiss-grid-cell-expand`, call `resetActiveCell()`, and apply `body.bp4-overlay-open` suppression |
| **E8** | Column Wrap | Extreme cell text length (>100,000 chars) | Layout thrashing or canvas measurement freeze | Heuristic token clamp in `CellLineCalculator` (measures first 1,000 chars max) |

---

## 6. Recommendations for Downstream Squads

1. **Squad 1 (Toolchain & Scaffolding):**
   - Create `tauri/project/package.json` and `vite.config.ts` with the exact dependencies and `~` prefix resolver alias specified in Section 4.
   - Configure `index.html` to point to `/src/main.tsx` and activate `withGlobalTauri: true` in `tauri.conf.json`.
2. **Squad 2 (Rust Core & Commands):**
   - In `src-tauri/src/commands/mod.rs`, ensure commands handle both canonical namespaced names (`toad:eval_query`) and un-prefixed aliases (`evalQuery`).
   - Register plugins: `tauri_plugin_dialog`, `tauri_plugin_clipboard_manager`, `tauri_plugin_opener`, `tauri_plugin_single_instance`, `tauri_plugin_window_state`.
3. **Squad 3 (DuckDB Engine & Arrow Stream):**
   - Output binary RecordBatches directly using `tauri::ipc::Response::new(arrow_bytes)` starting with `0xFFFFFFFF`.
   - Embed `toadSchema` JSON string in Arrow Schema metadata for zero-copy schema reconstitution.
4. **Squad 4 (Parquet Ledger & Workspace):**
   - Provide IPC handlers for all 14 `project:*` commands matching the data contracts detailed in Section 3.2.
   - Dispatch `project:workspaceChanged` after every project mutation.
5. **Squad 6 (Frontend & Host Bridge):**
   - Explicitly activate `setHostBridge(new TauriHostAdapter())` in `main.tsx`.
   - Ensure `TauriHostAdapter.dataPort = true` so `reltab` routes all queries through `invokeBinary`.
6. **Squad 7 (QA & Verification):**
   - Verify Arrow IPC roundtrip with zero bit drift using `tests/test_arrow_ipc_stream.js`.
   - Run 100K rows scroll stress test verifying FPS > 55 and RAM delta < 25MB.
