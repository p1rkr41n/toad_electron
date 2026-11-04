# Handoff Report: Frontend Source & Host Bridge Survey
**Task:** Phase 0 (Survey) — Frontend & Host Bridge Investigation  
**Agent:** `explorer_survey_1`  
**Working Directory:** `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_survey_1`  
**Recipient:** Orchestrator (`07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d`)  
**Type:** Hard Handoff (Task Complete)  

---

## 1. Observation

1. **Frontend Codebase Structure:**
   - `tad-master/packages/toadviewer/package.json`: Contains React 18 peer dependencies (`react: ^18.2.0`, `react-dom: ^18.2.0`), `@blueprintjs/core: 4.12.0`, `@blueprintjs/popover2: 1.10.1`, `slickgrid-es6: ^3.0.3`, `@apache-arrow/es2015-cjs: ^16.1.0`, `oneref: ^0.9.0`, `immutable: ^4.0.0`, `victory: ^36.6.10`.
   - `toadviewer` has **zero** native C/C++ dependencies; it is 100% pure TypeScript/JavaScript web canvas code.

2. **IPC Command Aliases & Reverse Mapping Collision:**
   - In `tad-master/packages/host-bridge/src/commandAliases.ts` lines 39-51:
     ```typescript
     "toad:eval_query": "DataSourceConnection.evalQuery",
     "toad:query": "DataSourceConnection.evalQuery",
     "evalQuery": "DataSourceConnection.evalQuery",
     "toad:row_count": "DataSourceConnection.rowCount",
     "rowCount": "DataSourceConnection.rowCount",
     "toad:schema": "DataSourceConnection.getTableSchema",
     "toad:get_table_schema": "DataSourceConnection.getTableSchema",
     "schema": "DataSourceConnection.getTableSchema",
     "getTableSchema": "DataSourceConnection.getTableSchema",
     ```
   - In lines 56-61:
     ```typescript
     export const REVERSE_COMMAND_ALIAS_MAP: Record<string, string> = Object.entries(
       COMMAND_ALIAS_MAP
     ).reduce((acc, [tauriCmd, legacyCmd]) => {
       acc[legacyCmd] = tauriCmd;
       return acc;
     }, {} as Record<string, string>);
     ```
     Because `reduce` iterates in insertion order, later entries overwrite earlier entries. `acc["DataSourceConnection.evalQuery"]` evaluates to `"evalQuery"` rather than `"toad:eval_query"`. `acc["DataSourceConnection.rowCount"]` evaluates to `"rowCount"`. `acc["DataSourceConnection.getTableSchema"]` evaluates to `"getTableSchema"`.

3. **Tauri Host Adapter Implementation:**
   - `tad-master/packages/host-bridge/src/TauriHostAdapter.ts`:
     - Implements `IHostBridge` (lines 16-205).
     - Invokes commands via `tauri.core.invoke(tauriCmd, args || {})` (line 48).
     - Invokes binary via `invokeBinary(cmd, args)` (lines 59-72) which checks `res instanceof Uint8Array`, `ArrayBuffer`, or `Buffer`.
     - Subscribes via `tauri.event.listen(event, handler)` (lines 74-92).
     - Emits via `tauri.event.emit(event, payload)` (lines 94-99).
     - However, `TauriHostAdapter` does not declare a truthy `dataPort` property on itself, which in `Connection.ts` line 262 (`this.tconn && typeof this.tconn.invokeBinary === "function" && this.tconn.dataPort`) would cause `evalQuery` to take the legacy stringified path unless `dataPort` is set to `true`.

4. **Arrow IPC Binary Format & Protocol Detection:**
   - In `tad-master/packages/reltab/src/remote/hybridProtocol.ts`:
     - `isArrowIPC(input)` (lines 63-81) verifies continuation indicator `0xFFFFFFFF` (`u8[0] === 0xff && u8[1] === 0xff && u8[2] === 0xff && u8[3] === 0xff`).
     - `arrowIPCToTableRep(buffer)` (lines 219-289) uses `tableFromIPC(u8)` from `@apache-arrow/es2015-cjs` and extracts `toadSchema` from Arrow metadata (`arrowTable.schema.metadata.get("toadSchema")`).
     - Formats Decimals via `formatArrowDecimal` (lines 171-189) and microsecond Timestamps via `formatArrowTime` (lines 194-214).

5. **Line Calculation, Dynamic Auto-Wrap & Overlay Suppression:**
   - `tad-master/packages/toadviewer/src/utils/CellLineCalculator.ts`: Pure Canvas 2D measurement in browser and deterministic character-width fallback (7.5px) in headless mode. Fully enforces the N-line contract ($N \le 1$: flat 24px; $2 \le N \le 5$: $N \times 17\text{px} + 8\text{px}$; $N > 5$: capped at 93px with slim 4px scrollbar).
   - `tad-master/packages/toadviewer/src/utils/GridOverlayBus.ts`: Emits `dismiss-grid-cell-expand`, `parse-dialog-opened`, `parse-dialog-closed`.
   - `tad-master/packages/toadviewer/src/slickgrid.scss` lines 146-160: When `body.bp4-overlay-open` is active, suppresses `.slick-cell.active`, `.slick-row.active`, `.slick-cell.selected` (transparent background, no box-shadow, no border) and sets `.slick-cell-active-expanded` to `display: none !important`.

6. **Styles & Webpack `~` Imports in Less/Sass:**
   - `tad-master/packages/toadviewer/less/tadviewer.less` line 1-5: `@import "~normalize.css";`, `@import "~@blueprintjs/core/...";`.
   - `tad-master/packages/toadviewer/src/slickgrid.scss` line 1-3: `@import "~slickgrid-es6/...";`.

---

## 2. Logic Chain

1. **From Observation 1 & Observation 3 to Frontend Porting Feasibility:**
   Because all frontend code (`toadviewer`, `reltab`, `aggtree`, `host-bridge`) is free of native Node.js C++ bindings and `TauriHostAdapter` already connects to `window.__TAURI__.core.invoke`, the frontend can be compiled directly into standard static HTML/JS/CSS bundles via Vite 5 and served by Tauri v2 WebView2.
2. **From Observation 2 to Command Dispatcher Specification:**
   Because `commandAliases.ts` overwrites `"DataSourceConnection.evalQuery"` to `"evalQuery"`, if the Rust backend strictly only registers `"toad:eval_query"`, incoming IPC calls will fail with `command not found`. Therefore, Squad 2 (Rust Command Router) and Squad 6 (Host Bridge) must register/support both namespaced (`toad:eval_query`, `toad:row_count`, `toad:schema`) and direct (`evalQuery`, `rowCount`, `getTableSchema`) commands, and `commandAliases.ts` should be patched to prioritize canonical colons `:`.
3. **From Observation 3 to `invokeBinary` Activation:**
   In `reltab/src/remote/Connection.ts` lines 259-263, `invokeBinary` is only used if `(this.tconn as any).dataPort` is truthy. Adding `public readonly dataPort: boolean = true;` to `TauriHostAdapter` guarantees that zero-copy binary Arrow IPC is chosen directly over slower JSON serialization.
4. **From Observation 4 to Rust Arrow Output Requirements:**
   To satisfy `arrowIPCToTableRep`, the Rust backend (Squad 3) must format record batches into an Apache Arrow IPC Stream starting with `0xFFFFFFFF`, embed `toadSchema` JSON in the schema metadata map, and return `tauri::ipc::Response::new(ipc_bytes)`.
5. **From Observation 6 to Vite 5 Configuration:**
   Because Vite 5 does not resolve Webpack `~` prefixes by default, `vite.config.ts` must declare `{ find: /^~/, replacement: '' }` and enable `javascriptEnabled: true` in `css.preprocessorOptions.less`.

---

## 3. Caveats

1. **Dynamic `require()` Calls:** Several components (`ProjectWorkspaceManager.ts`, `MultipleLoadingManager.ts`, `DataSourceSidebar.tsx`) call `require("host-bridge")` dynamically inside click handler methods. In pure ESM without Node.js globals, `require` will throw `ReferenceError` unless transformed to static `import` or shimmed.
2. **BigInt Polyfill Timing:** `BigInt.prototype.toJSON` must execute before any DuckDB schema or query evaluation runs, otherwise `JSON.stringify` throws a `TypeError`.
3. **No Code Implementation in Phase 0:** In accordance with the Explorer subagent instructions (read-only investigation), no source files in `tad-master` or `tauri/project` were modified during this survey.

---

## 4. Conclusion

1. **Frontend Readiness:** `toadviewer` is fully prepared for porting into `tauri/project` using Vite 5 and React 18.
2. **Complete IPC Map Documented:** All 33 IPC commands and aliases, 9 backend-to-frontend events, and 5 frontend-to-backend events are cataloged in `survey_frontend_report.md`.
3. **Clear Downstream Blueprint:** Squads 1, 2, 3, 4, 6, and 7 have actionable data contracts, build requirements, and edge case mitigations ready to execute in Phase 1 (Foundation) through Phase 4 (QA).

---

## 5. Verification Method

1. **Report Verification:**
   Inspect `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_survey_1\survey_frontend_report.md` to verify all commands, types, and architectural requirements.
2. **Alias Collision Reproduction:**
   Run in node:
   ```javascript
   const { REVERSE_COMMAND_ALIAS_MAP } = require('./tad-master/packages/host-bridge/dist/commandAliases');
   console.log('evalQuery mapped to:', REVERSE_COMMAND_ALIAS_MAP['DataSourceConnection.evalQuery']);
   // Output: 'evalQuery' (confirms collision with 'toad:eval_query')
   ```
3. **Arrow Protocol Test:**
   Run the Arrow IPC protocol test suite to verify format detection and roundtrip decoding:
   ```powershell
   node tests/test_arrow_ipc_stream.js
   ```
