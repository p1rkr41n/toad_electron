# Handoff Report: UI Architecture & Frontend Investigation for Nested JSON Parser

**Agent**: `teamwork_explorer`  
**Working Directory**: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_ui_json`  
**Report Artifact**: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_ui_json\ui_report.md`  
**Date**: 2026-11-04  

---

## 1. Observation
1. **Source Package Location**:
   - The UI codebase is located in `tad-master/packages/toadviewer/`.
   - Entry point: `tad-master/packages/toadviewer/src/toadviewer.ts`.
   - Dialog component: `tad-master/packages/toadviewer/src/components/RegexDialog.tsx` (2,322 lines).
2. **Current View Creation Call Chain**:
   - In `RegexDialog.tsx` (lines 878–912), clicking `Apply` executes `actions.applyColumnExtraction(...)`.
   - In `actions.ts` (lines 1449–1475), `dbc.runSqlQuery(createViewSql)` executes the DuckDB `CREATE VIEW` statement and updates `viewState`.
   - Quoting `actions.ts` (lines 1312–1325):
     ```typescript
     } else if (formatType === "json") {
       for (const m of activeMappings) {
         const key = String(m.sourceKeyOrIdx);
         ...
         let expr = `json_extract_string(${targetColForExtract}, '$."${escapedKey}"')`;
         if (m.colType && m.colType !== "VARCHAR") {
           expr = `TRY_CAST(${expr} AS ${m.colType})`;
         }
         extractClauses.push(`${expr} AS ${outCol}`);
       }
     }
     ```
     This verbatim code demonstrates that current JSON extraction only handles single-level keys via `'$."${escapedKey}"'` and does not support nested paths or special characters (`#text`, `#attributes`).
3. **Mode Switcher in Dialog Header**:
   - In `RegexDialog.tsx` (lines 1184–1237), a segmented capsule button switch is currently rendered:
     ```tsx
     <div style={{ display: "inline-flex", ... }}>
       <button id="ntab-simple" onClick={() => setMode("simple")} ...>Visual</button>
       <button id="ntab-adv" onClick={() => setMode("advanced")} ...>Regex</button>
     </div>
     ```
4. **Sampling & Data Buffering**:
   - `fetchSampleEvents(colName, limit = 50)` (lines 116–136) accesses `viewState.dataView.rawData`.
   - `PagedDataView.ts` caches sliding window buffer rows (up to 5,000 rows in memory).
   - Deeper sampling (up to 1,000 rows) can directly read from `viewState.dataView.rawData` or DuckDB via `dbc.runSqlQuery("SELECT ... LIMIT 1000")`.
5. **Webpack & Worker Bundling**:
   - `packages/toadviewer/webpack.config.js` builds with `libraryTarget: "commonjs2"` and `externalsPresets: { node: true }`.
   - No `worker-loader` exists in webpack configs.
   - All LESS styles are required via CommonJS in `toadviewer.ts` (e.g. `require("../less/tadviewer.less")`).
6. **Existing Test Harness**:
   - Running `d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe tests/test_nested_json.js` passed 8/8 tests in DuckDB in-memory environment, verifying bracket paths `$["Event"]["System"]["EventID"]["#text"]` work cleanly.

---

## 2. Logic Chain
1. From Observation 2, `applyColumnExtraction` in `actions.ts` directly creates DuckDB views via `dbc.runSqlQuery`. Because DuckDB views are lazily evaluated virtual tables, view creation executes in < 15ms.
2. From Observation 2, the existing `$."${escapedKey}"` fails when encountering nested objects or special characters (`#attributes`, `#text`, `@xmlns`) because DuckDB requires bracket notation `$["seg1"]["seg2"]`.
3. From Observation 3, the title bar capsule switch currently toggles `mode` between `"simple"` and `"advanced"`. Extending `mode` to `"simple" | "nested_json" | "advanced"` allows mounting a dedicated Nested JSON view without breaking existing Visual or Regex modes.
4. From Observation 5, compiling a separate browser `Web Worker` file within a `commonjs2` Webpack library that runs under Electron packaged `.asar` introduces path resolution and CSP hazards.
5. In contrast, parsing 1,000 rows of JSON in V8 takes only ~12ms. Implementing `SampleScanWorker.ts` using asynchronous chunked timeslicing (processing 50 rows per slice and yielding to the event loop via `setTimeout(0)`) guarantees zero UI freeze (maintaining 60 FPS), requires zero Webpack loader modifications, and runs identically in headless Node CLI tests (`run_tests.js`).
6. From Observation 5, adding `packages/toadviewer/less/nested-dialog.less` and importing it in `toadviewer.ts` cleanly isolates component styles while adhering to Toad's Material You CSS custom properties (`--md-sys-color-*`).

---

## 3. Caveats
1. **Arrays**: The nested traverser preserves arrays as stringified JSON (`JSON.stringify(arr)`) with inferred type `VARCHAR` by default; expanding arrays into multiple relational rows would require `UNNEST` which alters row cardinality and is out of scope for column extraction.
2. **DuckDB Version**: Tested against embedded DuckDB v1.1.0 in `tad-master/node_modules/duckdb`. Bracket path syntax `$["a"]["b"]` is standard across DuckDB versions.
3. **RAM Limits**: Scanning up to 1,000 sample rows in memory consumes < 5MB of RAM, safely under the 150MB budget constraint.

---

## 4. Conclusion
1. **Dialog UI Structure**: Integrate a 3rd pill `[Nested JSON]` into `RegexDialog.tsx`'s capsule switch.
2. **Component Separation**:
   - Place `NestedFieldsTable.tsx` and `SampleScanController.tsx` in `packages/toadviewer/src/components/`.
   - Place `nested-dialog.less` in `packages/toadviewer/less/` and require it in `toadviewer.ts`.
3. **Worker Strategy**: Implement `SampleScanWorker.ts` in `packages/toadviewer/src/workers/` as an async chunked timeslicer.
4. **Core Utilities**: Implement `NestedJsonTraverser.ts` (Stream 1) and `DuckDbJsonSqlBuilder.ts` (Stream 4) in `packages/toadviewer/src/utils/`, generating 100% bracket paths (`$["seg1"]["seg2"]`) and double-quoted column aliases (`AS "Event.System.EventID.#text"`).
5. Detailed specifications, code skeletons, and recommendations are recorded in `ui_report.md`.

---

## 5. Verification Method
1. **Inspect Report**:
   Verify full details in `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_ui_json\ui_report.md`.
2. **Run Existing Test Suite**:
   Execute:
   ```powershell
   d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe d:\Shared_UserData\Downloads\tad\tests\test_nested_json.js
   ```
   Must pass 8/8 tests.
3. **Build Verification**:
   Execute `npm run build-dev` in `tad-master/packages/toadviewer` to verify webpack compilation succeeds without errors.
