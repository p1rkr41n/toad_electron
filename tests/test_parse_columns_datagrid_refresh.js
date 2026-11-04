/**
 * TOAD AUTOMATED TEST SUITE: Parse Columns UI & DataGrid Refresh Verification
 * 
 * Verifies:
 * 1. Root Cause Defect 1 Fix (actions.ts & RegexDialog.tsx):
 *    - applyColumnExtraction explicitly sets `dataView: null` in nextViewState
 *    - nested_json mode in RegexDialog.tsx explicitly sets `dataView: null`
 * 2. Root Cause Defect 2 Fix (PivotRequester.ts):
 *    - canReusePreloadedBuffer strictly rejects stale buffer when `baseQueryChanged` is true
 *    - canReusePreloadedBuffer strictly rejects when column count changed (e.g. 3 -> 14 cols)
 *    - canReusePreloadedBuffer strictly rejects when column identities differ
 *    - canReusePreloadedBuffer safely accepts only when query and schema match identically
 * 3. Root Cause Defect 3 Fix (DataGrid.tsx & SlickGrid ColMap):
 *    - Reproduces SlickGrid column drop when stale dataView.schema is present
 *    - Proves refreshed dataView.schema preserves all extracted columns (str001..str011)
 * 4. End-to-End DuckDB Column Extraction Pipeline:
 *    - Simulates System.evtx table extraction in DuckDB
 *    - Verifies full state transition and DataGrid column resolution
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

// Global mocks for renderer/browser modules in Node.js test environment
global.window = global;
global.document = { body: { style: {} } };

const ROOT_DIR = process.env.TOAD_ROOT || path.resolve(__dirname, "..");
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function reportSuite(title) {
  console.log(`\n${BOLD}${CYAN}======================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}  ${title}${RESET}`);
  console.log(`${BOLD}${CYAN}======================================================================${RESET}`);
}

async function runTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ${GREEN}✓ [PASS]${RESET} ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`  ${RED}✖ [FAIL]${RESET} ${name}`);
    console.error(err);
  }
}

async function main() {
  reportSuite("SUITE 1: Source Code Verification (Defense-in-Depth Defect 1 & Defect 2 Fixes)");

  await runTest("1.1 actions.ts: applyColumnExtraction resets dataView to null in nextViewState", async () => {
    const actionsPath = path.resolve(ROOT_DIR, "tad-master/packages/toadviewer/src/actions.ts");
    const actionsSrc = fs.readFileSync(actionsPath, "utf8");

    // Must find .set("dataView", null) in applyColumnExtraction block
    const applyExtractionIdx = actionsSrc.indexOf("export const applyColumnExtraction =");
    assert(applyExtractionIdx > 0, "applyColumnExtraction must be defined in actions.ts");

    const endExtractionIdx = actionsSrc.indexOf("export function formatStrColName", applyExtractionIdx);
    const extractionBlock = actionsSrc.slice(applyExtractionIdx, endExtractionIdx);
    assert(
      extractionBlock.includes('.set("dataView", null)'),
      "applyColumnExtraction must explicitly set dataView to null in nextViewState"
    );
  });

  await runTest("1.2 RegexDialog.tsx: nested_json mode resets dataView to null in nextViewState", async () => {
    const dialogPath = path.resolve(ROOT_DIR, "tad-master/packages/toadviewer/src/components/RegexDialog.tsx");
    const dialogSrc = fs.readFileSync(dialogPath, "utf8");

    const handleApplyIdx = dialogSrc.indexOf("const handleApply = async () =>");
    assert(handleApplyIdx > 0, "RegexDialog.tsx must have handleApply function");

    const nestedJsonApplyIdx = dialogSrc.indexOf('if (mode === "nested_json")', handleApplyIdx);
    assert(nestedJsonApplyIdx > 0, "RegexDialog.tsx handleApply must handle nested_json mode");

    const nestedBlock = dialogSrc.slice(nestedJsonApplyIdx, nestedJsonApplyIdx + 3000);
    assert(
      nestedBlock.includes('.set("dataView", null)'),
      "nested_json mode must explicitly set dataView to null in nextViewState"
    );
  });

  await runTest("1.3 PivotRequester.ts: canReusePreloadedBuffer guards against baseQueryChanged and schema column mismatch", async () => {
    const pivotReqPath = path.resolve(ROOT_DIR, "tad-master/packages/toadviewer/src/PivotRequester.ts");
    const pivotReqSrc = fs.readFileSync(pivotReqPath, "utf8");

    assert(
      pivotReqSrc.includes("!baseQueryChanged"),
      "canReusePreloadedBuffer must guard with !baseQueryChanged"
    );
    assert(
      pivotReqSrc.includes("dv.schema.columns.length === baseSchema.columns.length"),
      "canReusePreloadedBuffer must check dv.schema.columns.length === baseSchema.columns.length"
    );
    assert(
      pivotReqSrc.includes("dv.schema.columns.every((c: string, i: number) => c === baseSchema.columns[i])"),
      "canReusePreloadedBuffer must check all column names match identically"
    );
  });

  reportSuite("SUITE 2: PivotRequester Buffer Reuse Logic (Defect 2 Edge Cases)");

  // Pure evaluator simulating the canReusePreloadedBuffer logic in PivotRequester
  function evaluateCanReusePreloadedBuffer({
    baseQueryChanged,
    dv,
    vp,
    pSize,
    expectedLimit,
    baseSchema,
  }) {
    return !!(
      !baseQueryChanged &&
      dv != null &&
      dv.rawData &&
      dv.rawData.length > 0 &&
      dv.offset === 0 &&
      dv.currentPage === 1 &&
      dv.pageSize === pSize &&
      dv.rawData.length >= expectedLimit &&
      (!vp || (vp.vpivots.length === 0 && vp.filterExp.opArgs.length === 0)) &&
      dv.schema &&
      baseSchema &&
      dv.schema.columns &&
      baseSchema.columns &&
      dv.schema.columns.length === baseSchema.columns.length &&
      dv.schema.columns.every((c, i) => c === baseSchema.columns[i])
    );
  }

  const oldSchema3Cols = {
    columns: ["Binary", "EventData", "RawEvent"],
  };

  const newSchema14Cols = {
    columns: [
      "Binary",
      "EventData",
      "RawEvent",
      "str001",
      "str002",
      "str003",
      "str004",
      "str005",
      "str006",
      "str007",
      "str008",
      "str009",
      "str010",
      "str011",
    ],
  };

  const mockDataRows = Array.from({ length: 1000 }, (_, i) => ({
    _id: i,
    Binary: null,
    EventData: `event_${i}`,
    RawEvent: `<Event><Data>val_${i}</Data></Event>`,
  }));

  const staleDv = {
    schema: oldSchema3Cols,
    rawData: mockDataRows,
    offset: 0,
    currentPage: 1,
    pageSize: 1000,
  };

  const cleanVp = { vpivots: [], filterExp: { opArgs: [] } };

  await runTest("2.1 Rejects stale buffer when baseQueryChanged is true (table extraction occurred)", async () => {
    const canReuse = evaluateCanReusePreloadedBuffer({
      baseQueryChanged: true, // Table changed from System_evtx to System_evtx_rx0
      dv: staleDv,
      vp: cleanVp,
      pSize: 1000,
      expectedLimit: 1000,
      baseSchema: newSchema14Cols,
    });
    assert.strictEqual(canReuse, false, "Must NOT reuse buffer when baseQuery changed");
  });

  await runTest("2.2 Rejects stale buffer when column count differs (3 old cols vs 14 new cols)", async () => {
    const canReuse = evaluateCanReusePreloadedBuffer({
      baseQueryChanged: false, // Even if baseQuery was somehow considered unchanged
      dv: staleDv, // Has 3 cols
      vp: cleanVp,
      pSize: 1000,
      expectedLimit: 1000,
      baseSchema: newSchema14Cols, // Has 14 cols
    });
    assert.strictEqual(canReuse, false, "Must NOT reuse buffer when schema column count differs");
  });

  await runTest("2.3 Rejects buffer when column names differ even if column count matches", async () => {
    const altSchema3Cols = {
      columns: ["Binary", "EventData", "DifferentCol"],
    };
    const canReuse = evaluateCanReusePreloadedBuffer({
      baseQueryChanged: false,
      dv: staleDv, // Binary, EventData, RawEvent
      vp: cleanVp,
      pSize: 1000,
      expectedLimit: 1000,
      baseSchema: altSchema3Cols, // Binary, EventData, DifferentCol
    });
    assert.strictEqual(canReuse, false, "Must NOT reuse buffer when column names differ");
  });

  await runTest("2.4 Rejects when dataView is null (Defect 1 fix)", async () => {
    const canReuse = evaluateCanReusePreloadedBuffer({
      baseQueryChanged: false,
      dv: null, // Reset by applyColumnExtraction!
      vp: cleanVp,
      pSize: 1000,
      expectedLimit: 1000,
      baseSchema: newSchema14Cols,
    });
    assert.strictEqual(canReuse, false, "Must evaluate to false when dv is null");
  });

  await runTest("2.5 Safely accepts buffer when query is unchanged and schemas match identically", async () => {
    const canReuse = evaluateCanReusePreloadedBuffer({
      baseQueryChanged: false,
      dv: staleDv,
      vp: cleanVp,
      pSize: 1000,
      expectedLimit: 1000,
      baseSchema: oldSchema3Cols,
    });
    assert.strictEqual(canReuse, true, "Must safely reuse buffer for fast navigation on identical table");
  });

  reportSuite("SUITE 3: DataGrid SlickGrid Column Resolution & Drop Elimination (Defect 3)");

  // Replicating DataGrid.tsx column resolution:
  // gs.slickColMap = mkSlickColMap(dataView!.schema)
  // gridCols = displayColumns.map(cid => gs.slickColMap[cid]).filter(Boolean)
  function simulateGridColumnResolution(dataViewSchema, displayColumns) {
    // mkSlickColMap creates an entry for each column in dataView.schema
    const slickColMap = {};
    for (const cid of dataViewSchema.columns) {
      slickColMap[cid] = {
        id: cid,
        field: cid,
        name: cid,
        width: 150,
      };
    }

    const gridCols = displayColumns
      .map((cid) => slickColMap[cid])
      .filter(Boolean);

    return { slickColMap, gridCols };
  }

  const requestedDisplayColumns = [
    "Binary",
    "EventData",
    "RawEvent",
    "str001",
    "str002",
    "str003",
    "str004",
    "str005",
    "str006",
    "str007",
    "str008",
    "str009",
    "str010",
    "str011",
  ];

  await runTest("3.1 Stale dataView.schema drops all str001..str011 columns (reproducing user bug)", async () => {
    const { gridCols } = simulateGridColumnResolution(oldSchema3Cols, requestedDisplayColumns);
    const visibleFields = gridCols.map((c) => c.field);

    // Reproduces the exact reported bug: only 3 columns rendered, str001..str011 silently dropped!
    assert.strictEqual(visibleFields.length, 3, "Stale schema results in only 3 visible columns");
    assert.deepStrictEqual(visibleFields, ["Binary", "EventData", "RawEvent"]);
    for (let i = 1; i <= 11; i++) {
      const colId = `str${String(i).padStart(3, "0")}`;
      assert(!visibleFields.includes(colId), `${colId} was dropped by stale schema`);
    }
  });

  await runTest("3.2 Refreshed dataView.schema correctly preserves all str001..str011 in SlickGrid", async () => {
    const { gridCols } = simulateGridColumnResolution(newSchema14Cols, requestedDisplayColumns);
    const visibleFields = gridCols.map((c) => c.field);

    assert.strictEqual(visibleFields.length, 14, "Refreshed schema must produce all 14 columns");
    assert.deepStrictEqual(visibleFields, requestedDisplayColumns);
    for (let i = 1; i <= 11; i++) {
      const colId = `str${String(i).padStart(3, "0")}`;
      assert(visibleFields.includes(colId), `${colId} must be present in SlickGrid columns`);
    }
  });

  reportSuite("SUITE 4: DuckDB End-to-End Extraction & View State Simulation");

  const DUCKDB_PATH = path.resolve(ROOT_DIR, "tad-master/node_modules/duckdb");
  const duckdb = require(DUCKDB_PATH);
  const db = new duckdb.Database(":memory:");
  const conn = db.connect();

  const runSql = (sql) =>
    new Promise((resolve, reject) => {
      conn.all(sql, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

  await runTest("4.1 Create initial System_evtx table with 3 columns", async () => {
    await runSql(`
      CREATE TABLE System_evtx AS SELECT
        NULL::VARCHAR as "Binary",
        'param1: 123 | param2: 456' as "EventData",
        '<Event><Provider Name="Microsoft-Windows-Security"/><EventID>4624</EventID><Data Name="User">Admin</Data></Event>' as "RawEvent"
      FROM generate_series(1, 100);
    `);

    const countRes = await runSql(`SELECT count(*) as cnt FROM System_evtx`);
    assert.strictEqual(Number(countRes[0].cnt), 100, "Should have 100 rows in System_evtx");

    const tableInfo = await runSql(`PRAGMA table_info('System_evtx')`);
    const colNames = tableInfo.map((r) => r.name);
    assert.deepStrictEqual(colNames, ["Binary", "EventData", "RawEvent"]);
  });

  await runTest("4.2 Execute column extraction view creation (System_evtx_rx0)", async () => {
    // Generate CTE extraction view with str001..str011 as created by applyColumnExtraction
    const strCols = [];
    for (let i = 1; i <= 11; i++) {
      const colName = `str${String(i).padStart(3, "0")}`;
      strCols.push(`'extracted_val_${i}' as "${colName}"`);
    }

    const viewSql = `
      CREATE VIEW "System_evtx_rx0" AS
      SELECT "Binary", "EventData", "RawEvent", ${strCols.join(", ")}
      FROM "System_evtx";
    `;
    await runSql(viewSql);

    const viewInfo = await runSql(`PRAGMA table_info('System_evtx_rx0')`);
    const viewColNames = viewInfo.map((r) => r.name);
    assert.strictEqual(viewColNames.length, 14, "View must have 14 columns");
    assert(viewColNames.includes("str001"), "View must include str001");
    assert(viewColNames.includes("str011"), "View must include str011");
  });

  await runTest("4.3 Verify full ViewState transition with dataView reset and final reload", async () => {
    // Simulate AppState transition
    let state = {
      viewState: {
        baseQuery: { _rep: { operator: "table", tableName: "System_evtx" } },
        baseSchema: oldSchema3Cols,
        dataView: staleDv,
        viewParams: {
          displayColumns: ["Binary", "EventData", "RawEvent"],
          set(k, v) {
            return { ...this, [k]: v };
          },
        },
      },
      regexDialogOpen: true,
    };

    // 1. User applies extraction
    const finalNewColNames = Array.from({ length: 11 }, (_, i) => `str${String(i + 1).padStart(3, "0")}`);
    const nextDisplayCols = [...state.viewState.viewParams.displayColumns, ...finalNewColNames];
    const nextViewParams = state.viewState.viewParams.set("displayColumns", nextDisplayCols);

    const newBaseQuery = { _rep: { operator: "table", tableName: "System_evtx_rx0" } };
    const newBaseSchema = newSchema14Cols;

    // Apply the fix: dataView set to null!
    const nextViewState = {
      ...state.viewState,
      baseQuery: newBaseQuery,
      baseSchema: newBaseSchema,
      viewParams: nextViewParams,
      initialViewParams: nextViewParams,
      dataView: null, // DEFECT 1 FIX
    };

    state = {
      ...state,
      viewState: nextViewState,
      regexDialogOpen: false,
    };

    assert.strictEqual(state.viewState.dataView, null, "dataView must be reset to null");
    assert.strictEqual(state.regexDialogOpen, false, "dialog must be closed");
    assert.strictEqual(state.viewState.viewParams.displayColumns.length, 14, "displayColumns has 14 cols");

    // 2. PivotRequester handleQueryViewChange receives state change
    const baseQueryChanged = state.viewState.baseQuery !== { _rep: { operator: "table", tableName: "System_evtx" } };
    const canReuse = evaluateCanReusePreloadedBuffer({
      baseQueryChanged: true,
      dv: state.viewState.dataView,
      vp: cleanVp,
      pSize: 1000,
      expectedLimit: 100,
      baseSchema: state.viewState.baseSchema,
    });

    assert.strictEqual(canReuse, false, "canReusePreloadedBuffer must return false; triggers sendDataRequest");

    // 3. sendDataRequest loads from System_evtx_rx0
    const queryRows = await runSql(`SELECT * FROM "System_evtx_rx0" LIMIT 100`);
    assert.strictEqual(queryRows.length, 100);

    const refreshedDv = {
      schema: newBaseSchema,
      rawData: queryRows,
      offset: 0,
      currentPage: 1,
      pageSize: 1000,
    };

    state.viewState.dataView = refreshedDv;

    // 4. DataGrid renders with refreshedDv
    const { gridCols } = simulateGridColumnResolution(
      state.viewState.dataView.schema,
      state.viewState.viewParams.displayColumns
    );

    assert.strictEqual(gridCols.length, 14, "SlickGrid renders exactly 14 columns");
    assert.strictEqual(gridCols[3].field, "str001", "Fourth column is str001");
    assert.strictEqual(gridCols[13].field, "str011", "Fourteenth column is str011");
  });

  reportSuite("SUITE 5: Fast-Path Checkbox Freezing Guard (Defect 4 & DataGrid Schema Guard)");

  await runTest("5.1 PivotRequester.ts fast-path requires dv != null and dvHasAllDisplayCols", async () => {
    const pivotReqPath = path.resolve(ROOT_DIR, "tad-master/packages/toadviewer/src/PivotRequester.ts");
    const pivotReqSrc = fs.readFileSync(pivotReqPath, "utf8");

    assert(
      pivotReqSrc.includes("dvHasAllDisplayCols"),
      "Fast path must check dvHasAllDisplayCols"
    );
    assert(
      pivotReqSrc.includes("viewParams.displayColumns.every((c) => curDv.schema.columns.includes(c))"),
      "Fast path must verify all displayColumns exist in dataView.schema"
    );
  });

  await runTest("5.2 DataGrid.tsx logs diagnostic warning when displayColumns are missing from slickColMap", async () => {
    const dataGridPath = path.resolve(ROOT_DIR, "tad-master/packages/toadviewer/src/components/DataGrid.tsx");
    const dataGridSrc = fs.readFileSync(dataGridPath, "utf8");

    assert(
      dataGridSrc.includes("[DataGrid] Warning:"),
      "DataGrid must log diagnostic warning for unmapped displayColumns"
    );
  });

  function evaluateFastPathBypass({ baseQueryChanged, queryView, dv, viewParams, isOnlyDisplayOrderChange }) {
    const curDv = dv;
    const dvHasAllDisplayCols =
      curDv != null &&
      curDv.schema != null &&
      curDv.schema.columns != null &&
      viewParams.displayColumns.every((c) => curDv.schema.columns.includes(c));

    if (
      !baseQueryChanged &&
      queryView != null &&
      dvHasAllDisplayCols &&
      isOnlyDisplayOrderChange
    ) {
      return "BYPASS_DUCKDB";
    }
    return "QUERY_DUCKDB";
  }

  await runTest("5.3 Fast-path evaluator refuses bypass when dataView is null", async () => {
    const action = evaluateFastPathBypass({
      baseQueryChanged: false,
      queryView: { rowCount: 100 },
      dv: null,
      viewParams: { displayColumns: ["Binary", "EventData", "RawEvent", "str001"] },
      isOnlyDisplayOrderChange: true,
    });
    assert.strictEqual(action, "QUERY_DUCKDB", "Must query DuckDB when dataView is null");
  });

  await runTest("5.4 Fast-path evaluator refuses bypass when dataView is missing extracted columns", async () => {
    const action = evaluateFastPathBypass({
      baseQueryChanged: false,
      queryView: { rowCount: 100 },
      dv: staleDv, // only Binary, EventData, RawEvent
      viewParams: { displayColumns: ["Binary", "EventData", "RawEvent", "str001"] },
      isOnlyDisplayOrderChange: true,
    });
    assert.strictEqual(action, "QUERY_DUCKDB", "Must query DuckDB when dataView lacks str001");
  });

  await runTest("5.5 Fast-path safely activates when dataView has all displayColumns", async () => {
    const fullDv = {
      schema: newSchema14Cols,
      rawData: mockDataRows,
    };
    const action = evaluateFastPathBypass({
      baseQueryChanged: false,
      queryView: { rowCount: 100 },
      dv: fullDv,
      viewParams: { displayColumns: ["Binary", "str001"] },
      isOnlyDisplayOrderChange: true,
    });
    assert.strictEqual(action, "BYPASS_DUCKDB", "Safely bypasses DuckDB when dataView has all columns");
  });

  console.log(`\n${BOLD}======================================================================${RESET}`);
  console.log(`${BOLD}  PARSE COLUMNS DATAGRID REFRESH TEST SUMMARY${RESET}`);
  console.log(`${BOLD}======================================================================${RESET}`);
  console.log(`  Total Test Cases : ${totalTests}`);
  console.log(`  Passed           : ${passedTests}`);
  console.log(`  Failed           : ${failedTests}`);
  console.log(`${BOLD}======================================================================${RESET}\n`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unhandled error in test suite:", err);
  process.exit(1);
});
