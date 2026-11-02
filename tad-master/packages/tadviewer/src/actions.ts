import { ViewParams } from "./ViewParams";
import { ViewState, getDefaultPageSize, setDefaultPageSize } from "./ViewState";
import { AppState, ExportFormat, IngestProgressInfo, ActiveLoadingFileInfo } from "./AppState";
import { PagedDataView, DataRow } from "./PagedDataView";
import * as reltab from "reltab";
import { Activity, ColumnListTypes } from "./components/defs";
import { Path, PathTree } from "aggtree";
import * as aggtree from "aggtree";
import {
  StateRef,
  update,
  mutableGet,
  awaitableUpdate_,
  addStateChangeListener,
  removeStateChangeListener,
} from "oneref";
import log from "loglevel";
import {
  DataSourcePath,
  DataSourceId,
  resolvePath,
  DataSourceConnection,
  and,
  col,
  constVal,
  NumericColumnHistogramData,
  SubExp,
  FilterExp,
} from "reltab";
import * as util from "./util";
import { QueryView } from "./QueryView";
import {
  MultipleLoadingManager,
  getCanonicalPathFromDSPath,
} from "./MultipleLoadingManager";

export async function initAppState(
  rtc: reltab.ReltabConnection,
  stateRef: StateRef<AppState>
): Promise<void> {
  const st = await awaitableUpdate_(
    stateRef,
    (st: AppState): AppState =>
      st.set("rtc", rtc).set("initialized", true) as AppState
  );
  log.debug("initAppState: st: ", st.toJS());
}

export async function setActivity(
  activity: Activity,
  stateRef: StateRef<AppState>
) {
  await awaitableUpdate_(
    stateRef,
    (st: AppState) => st.set("activity", activity) as AppState
  );
}

export async function startAppLoadingTimer(
  stateRef: StateRef<AppState>
): Promise<void> {
  // hard to precisely type the path-dependent type of pathUpdater, so use any
  const ltUpdater = util.pathUpdater(stateRef, ["appLoadingTimer"]) as any;
  update(
    stateRef,
    (st: AppState): AppState =>
      st.set(
        "appLoadingTimer",
        st.appLoadingTimer.run(200, ltUpdater)
      ) as AppState
  );
}

export async function stopAppLoadingTimer(
  stateRef: StateRef<AppState>
): Promise<void> {
  update(
    stateRef,
    (st: AppState): AppState =>
      st.set("appLoadingTimer", st.appLoadingTimer.stop()) as AppState
  );
}

// replace current view in AppState with a query on the specified
// dataSource
export const setQueryView = async (
  stateRef: StateRef<AppState>,
  dsc: DataSourceConnection,
  sqlQuery: string,
  showColumnHistograms: boolean
): Promise<void> => {
  const appState = mutableGet(stateRef);

  const baseQuery = reltab.sqlQuery(sqlQuery);
  const baseSchema = await aggtree.getBaseSchema(
    dsc,
    baseQuery,
    appState.showRecordCount
  );

  // start off with all columns displayed:
  const displayColumns = baseSchema.columns.slice();

  const openPaths = new PathTree();
  const initialViewParams = new ViewParams({
    displayColumns,
    openPaths,
    showColumnHistograms,
  });

  const viewState = new ViewState({
    dbc: dsc,
    baseSchema,
    baseQuery,
    viewParams: initialViewParams,
    initialViewParams,
    pageSize: getDefaultPageSize(),
  });

  // We explicitly set rather than merge() because merge
  // will attempt to deep convert JS objects to Immutables

  await awaitableUpdate_(
    stateRef,
    (st: AppState): AppState => st.set("viewState", viewState) as AppState
  );
};

export const replaceCurrentView = async (
  dsPath: DataSourcePath,
  stateRef: StateRef<AppState>,
  viewParams?: ViewParams,
  forceReopen?: boolean
): Promise<void> => {
  log.debug("*** replaceCurrentView: dsPath: ", dsPath, " forceReopen: ", forceReopen);
  const appState = mutableGet(stateRef);

  const targetNode = await resolvePath(appState.rtc, dsPath);
  if (targetNode.isContainer) {
    await setActivity("DataSource", stateRef);
    return;
  }

  const dbc = await appState.rtc.connect(dsPath.sourceId);

  const { path } = dsPath;
  const baseTableName = path[path.length - 1];

  const windowTitle = baseTableName;

  const manager = MultipleLoadingManager.getInstance();
  const canon = getCanonicalPathFromDSPath(dsPath);
  const key = JSON.stringify(dsPath);
  const ramCache = !forceReopen
    ? manager.getFirstPageCache(canon) || manager.getFirstPageCache(key)
    : null;

  let queryTableName: string;
  let baseSchema: reltab.Schema;
  let initialDataView: PagedDataView | null = null;

  if (ramCache) {
    log.info(
      `[Actions] RAM First-Page Micro-Cache HIT cho ${baseTableName} (${ramCache.totalRowCount} rows)`
    );
    queryTableName = ramCache.tableName;
    baseSchema = ramCache.schema;

    const rowData: DataRow[] = [];
    for (let i = 0; i < ramCache.tableRep.rowData.length; i++) {
      const row = { ...(ramCache.tableRep.rowData[i] as any) };
      row._id = i;
      row._depth = 0;
      row._isOpen = false;
      row._isLeaf = true;
      row._parentId = null;
      rowData.push(row);
    }
    const pSize = getDefaultPageSize();
    initialDataView = new PagedDataView(
      baseSchema,
      ramCache.totalRowCount,
      0,
      rowData,
      1,
      pSize
    );
  } else {
    queryTableName = await dbc.getTableName(dsPath, { forceReopen });
    const bQuery = reltab.tableQuery(queryTableName);
    baseSchema = await aggtree.getBaseSchema(
      dbc,
      bQuery,
      appState.showRecordCount
    );
  }

  const baseQuery = reltab.tableQuery(queryTableName);

  // start off with all columns displayed:
  const displayColumns = baseSchema.columns.slice();

  const openPaths = new PathTree();
  if (!viewParams) {
    viewParams = new ViewParams({
      displayColumns,
      openPaths,
    });
  }
  const initialViewParams = viewParams;

  const viewState = new ViewState({
    dbc,
    dsPath,
    baseSchema,
    baseQuery,
    viewParams,
    initialViewParams,
    pageSize: getDefaultPageSize(),
    dataView: initialDataView,
  });

  // We explicitly set rather than merge() because merge
  // will attempt to deep convert JS objects to Immutables

  await awaitableUpdate_(
    stateRef,
    (st: AppState): AppState => st.set("viewState", viewState) as AppState
  );

  // Tự động đồng bộ trạng thái tệp sang MultipleLoadingManager (Ready 100%)
  try {
    MultipleLoadingManager.getInstance().markReady(dsPath);
  } catch { }
};

/**
 * Chờ cho đến khi PivotRequester nạp xong dataView đầu tiên cho ViewState hiện tại
 */
export const waitForDataView = (
  stateRef: StateRef<AppState>,
  timeoutMs: number = 8000
): Promise<PagedDataView | null> => {
  return new Promise((resolve) => {
    const curState = mutableGet(stateRef);
    if (curState.viewState?.dataView) {
      return resolve(curState.viewState.dataView);
    }

    let resolved = false;
    let timer: any = null;
    let listenerId: number | null = null;

    const cleanup = () => {
      if (listenerId !== null) {
        removeStateChangeListener(stateRef, listenerId);
        listenerId = null;
      }
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(mutableGet(stateRef).viewState?.dataView || null);
      }
    }, timeoutMs);

    listenerId = addStateChangeListener(stateRef, (st) => {
      if (!resolved && st.viewState?.dataView) {
        resolved = true;
        cleanup();
        resolve(st.viewState.dataView);
      }
    });
  });
};

export const reopenCurrentView = async (
  stateRef: StateRef<AppState>
): Promise<void> => {
  const appState = mutableGet(stateRef);
  const dsPath = appState.viewState?.dsPath;
  if (!dsPath) return;

  try {
    await startAppLoadingTimer(stateRef);
    const curViewParams = appState.viewState?.viewParams;
    await replaceCurrentView(dsPath, stateRef, curViewParams, true);
    await waitForDataView(stateRef, 8000);
  } finally {
    stopAppLoadingTimer(stateRef);
  }
};

export const openDataSourcePath = async (
  path: DataSourcePath,
  stateRef: StateRef<AppState>,
  viewParams?: ViewParams
): Promise<void> => {
  const appState = mutableGet(stateRef);

  const modifiedViewParams =
    appState.viewState?.viewParams !== appState.viewState?.initialViewParams;

  if (modifiedViewParams) {
    setViewConfirmDialogOpen(true, path, stateRef);
  } else {
    const isAlreadyLoading =
      appState.activeLoadingFile && appState.activeLoadingFile.isLoading;
    const manager = MultipleLoadingManager.getInstance();
    const key = JSON.stringify(path);
    const canon = getCanonicalPathFromDSPath(path);
    const item = manager.getItem(key) || manager.getItemByCanonical(canon);
    const isFileAlreadyReady = item && item.status === "ready";
    const ramCache = manager.getFirstPageCache(canon) || manager.getFirstPageCache(key);

    if (!isAlreadyLoading) {
      const fileName = path.path[path.path.length - 1] || "dataset";
      setActiveLoadingFile(
        {
          isLoading: true,
          fileName,
          dsPath: path,
          percent: isFileAlreadyReady ? 100 : 0,
          statusText: isFileAlreadyReady
            ? "Opening table view... 100% completed"
            : "Processing dataset with columnar engine...",
        },
        stateRef
      );
    }

    try {
      manager.pause();
      await startAppLoadingTimer(stateRef);
      await replaceCurrentView(path, stateRef, viewParams);
      const dv = await waitForDataView(stateRef, 8000);
      if (dv && !ramCache) {
        try {
          const vs = mutableGet(stateRef).viewState;
          if (vs && vs.baseSchema && dv.rawData) {
            manager.setFirstPageCache(canon, {
              tableName:
                (vs.baseQuery as any).tableName ||
                path.path[path.path.length - 1],
              schema: vs.baseSchema,
              tableRep: new reltab.TableRep(vs.baseSchema, dv.rawData),
              totalRowCount: dv.totalRowCount,
              cachedAt: Date.now(),
            });
          }
        } catch { }
      }
    } finally {
      stopAppLoadingTimer(stateRef);
      setActiveLoadingFile(null, stateRef);
      manager.resume();
    }
  }
};

// helper to hoist a ViewParams => ViewParams fn to an AppState => AppState
// Always resets the viewport
const vpUpdate =
  (f: (vp: ViewParams) => ViewParams) =>
    (s: AppState): AppState => {
      let nextState = s.updateIn(["viewState", "viewParams"], (vpu: unknown) =>
        f(vpu as ViewParams)
      ) as AppState;
      if (nextState.viewState) {
        nextState = nextState.update("viewState", (vs) =>
          vs!.set("currentPage", 1)
        ) as AppState;
      }
      return nextState;
    };

export const toggleShown = (
  cid: string,
  stateRef: StateRef<AppState>
): void => {
  update(
    stateRef,
    vpUpdate((viewParams) => viewParams.toggleShown(cid))
  );
};
export const toggleAllShown = (stateRef: StateRef<AppState>): void => {
  update(stateRef, (s) => {
    const schema = s.viewState.baseSchema;
    const viewParams = s.viewState.viewParams;
    const allShown = schema.columns.length === viewParams.displayColumns.length;
    const nextDisplayColumns = allShown ? [] : schema.columns;
    return vpUpdate(
      (viewParams) =>
        viewParams.set("displayColumns", nextDisplayColumns) as ViewParams
    )(s);
  });
};

export const applyColumnsChanges = (
  nextDisplayColumns: string[],
  nextVpivots: string[],
  nextSortKey: [string, boolean][],
  stateRef: StateRef<AppState>
): void => {
  update(
    stateRef,
    vpUpdate((viewParams) =>
      viewParams
        .set("displayColumns", nextDisplayColumns)
        .set("vpivots", nextVpivots)
        .set("sortKey", nextSortKey) as ViewParams
    )
  );
};
export const togglePivot = (
  cid: string,
  stateRef: StateRef<AppState>
): void => {
  update(
    stateRef,
    vpUpdate((viewParams) => viewParams.togglePivot(cid))
  );
};
export const toggleSort = (cid: string, stateRef: StateRef<AppState>): void => {
  update(
    stateRef,
    vpUpdate((viewParams) => viewParams.toggleSort(cid))
  );
};
export const setSortDir = (
  cid: string,
  asc: boolean,
  stateRef: StateRef<AppState>
): void => {
  update(
    stateRef,
    vpUpdate((viewParams) => viewParams.setSortDir(cid, asc))
  );
};
export const toggleShowRoot = (stateRef: StateRef<AppState>): void => {
  update(
    stateRef,
    vpUpdate(
      (viewParams) =>
        viewParams.set("showRoot", !viewParams.showRoot) as ViewParams
    )
  );
};
export const setShowColumnHistograms = (
  stateRef: StateRef<AppState>,
  showColumnHistograms: boolean
): void => {
  update(
    stateRef,
    vpUpdate(
      (viewParams) =>
        viewParams.set(
          "showColumnHistograms",
          showColumnHistograms
        ) as ViewParams
    )
  );
};
export const toggleShowColumnHistograms = (
  stateRef: StateRef<AppState>
): void => {
  update(
    stateRef,
    vpUpdate(
      (viewParams) =>
        viewParams.set(
          "showColumnHistograms",
          !viewParams.showColumnHistograms
        ) as ViewParams
    )
  );
};

export const reorderColumnList = (dstProps: any, srcProps: any) => {
  log.debug("reorderColumnList: ", dstProps, srcProps);

  if (dstProps.columnListType !== srcProps.columnListType) {
    log.debug("mismatched column list types, ignoring...");
    return;
  }

  const fieldKey = dstProps.columnListType;
  const isSortKey = fieldKey === ColumnListTypes.SORT;
  update(
    dstProps.stateRef,
    vpUpdate((viewParams) => {
      let colList = viewParams.get(fieldKey).slice();

      if (isSortKey) {
        const srcSortKey = srcProps.rowData;
        const srcIndex = colList.findIndex((k: any) => k[0] === srcSortKey[0]);

        if (srcIndex === -1) {
          return viewParams;
        } // remove source from its current position:

        colList.splice(srcIndex, 1);
        const dstSortKey = dstProps.rowData;
        const dstIndex = colList.findIndex((k: any) => k[0] === dstSortKey[0]);

        if (dstIndex === -1) {
          return viewParams;
        }

        colList.splice(dstIndex, 0, srcSortKey);
        return viewParams.set(fieldKey, colList) as ViewParams;
      } else {
        const srcColumnId = srcProps.rowData;
        const srcIndex = colList.indexOf(srcColumnId);

        if (srcIndex === -1) {
          return viewParams;
        } // remove source from its current position:

        colList.splice(srcIndex, 1);
        const dstColumnId = dstProps.rowData;
        const dstIndex = colList.indexOf(dstColumnId);

        if (dstIndex === -1) {
          return viewParams;
        }

        colList.splice(dstIndex, 0, srcColumnId);

        if (fieldKey === "vpivots") {
          // evil hack
          return viewParams.setVPivots(colList);
        } else {
          return viewParams.set(fieldKey, colList) as ViewParams;
        }
      }
    })
  );
};
/*
 * single column version of setting sort key
 * (until we implement compound sort keys)
 */

export const setSortKey = (
  sortKey: Array<[string, boolean]>,
  stateRef: StateRef<AppState>
) => {
  update(stateRef, (st: AppState): AppState => {
    const nextSt = vpUpdate(
      (viewParams) => viewParams.set("sortKey", sortKey) as ViewParams
    )(st);
    return nextSt;
  });
};

export const setColumnOrder = (
  displayColumns: Array<string>,
  stateRef: StateRef<AppState>
) => {
  update(stateRef, (s: AppState): AppState => {
    if (!s.viewState) return s;
    const nextVP = s.viewState.viewParams.set(
      "displayColumns",
      displayColumns
    ) as ViewParams;
    return s.update("viewState", (vs) => vs!.set("viewParams", nextVP)) as AppState;
  });
};

export const openPath = (path: Path, stateRef: StateRef<AppState>) => {
  log.info("openPath: opening path: ", path);
  update(
    stateRef,
    vpUpdate((viewParams) => viewParams.openPath(path))
  );
};

export const closePath = (path: Path, stateRef: StateRef<AppState>) => {
  update(
    stateRef,
    vpUpdate((viewParams) => viewParams.closePath(path))
  );
};

export const setAggFn = (
  cid: string,
  aggFn: reltab.AggFn,
  stateRef: StateRef<AppState>
) => {
  update(
    stateRef,
    vpUpdate((viewParams) => viewParams.setAggFn(cid, aggFn))
  );
};

export const updateViewport = (
  top: number,
  bottom: number,
  stateRef: StateRef<AppState>
) => {
  update(
    stateRef,
    (st) =>
      st.update(
        "viewState",
        (vs) =>
          vs!.set("viewportTop", top).set("viewportBottom", bottom) as ViewState
      ) as AppState
  );
};

export const setPage = (
  page: number,
  stateRef: StateRef<AppState>
) => {
  update(
    stateRef,
    (st) =>
      st.update("viewState", (vs) => {
        if (!vs) return vs;
        const totalRows = vs.queryView?.rowCount ?? 0;
        const totalPages = Math.max(1, Math.ceil(totalRows / vs.pageSize));
        const targetPage = Math.min(Math.max(1, page), totalPages);
        let nextVs = vs.set("currentPage", targetPage) as ViewState;
        if (nextVs.dataView) {
          nextVs = nextVs.set(
            "dataView",
            nextVs.dataView.withPage(targetPage)
          ) as ViewState;
        }
        return nextVs;
      }) as AppState
  );
};

export const setPageSize = (
  size: number,
  stateRef: StateRef<AppState>
) => {
  const validSize = Math.max(1, Math.floor(size));
  setDefaultPageSize(validSize);
  update(
    stateRef,
    (st) =>
      st.update("viewState", (vs) => {
        if (!vs) return vs;
        let nextVs = vs.set("pageSize", validSize).set("currentPage", 1) as ViewState;
        return nextVs;
      }) as AppState
  );
};

export const setIngestProgress = (
  info: IngestProgressInfo,
  stateRef: StateRef<AppState>
) => {
  update(stateRef, (st) => st.set("ingestProgress", info) as AppState);
};

export const setActiveLoadingFile = (
  info: ActiveLoadingFileInfo | null,
  stateRef: StateRef<AppState>
) => {
  update(stateRef, (st) => st.set("activeLoadingFile", info) as AppState);
};

export const setDefaultFormatOptions = (
  colType: string,
  opts: any,
  stateRef: StateRef<AppState>
) => {
  update(
    stateRef,
    vpUpdate(
      (viewParams) =>
        viewParams.setIn(["defaultFormats", colType], opts) as ViewParams
    )
  );
};

export const setColumnFormatOptions = (
  cid: string,
  opts: any,
  stateRef: StateRef<AppState>
) => {
  update(
    stateRef,
    vpUpdate((viewParams) => viewParams.setColumnFormat(cid, opts))
  );
};

export const setShowHiddenCols = (
  show: boolean,
  stateRef: StateRef<AppState>
) => {
  update(
    stateRef,
    vpUpdate(
      (viewParams) => viewParams.set("showHiddenCols", show) as ViewParams
    )
  );
};

export const setExportBeginDialogOpen = (
  openState: boolean,
  stateRef: StateRef<AppState>
) => {
  update(stateRef, (s) => s.set("exportBeginDialogOpen", openState));
};

export const setExportProgressDialogOpen = (
  openState: boolean,
  exportPathBaseName: string,
  stateRef: StateRef<AppState>
) => {
  log.debug("exportProgressDialogOpen: ", exportPathBaseName);
  update(
    stateRef,
    (s) =>
      s
        .set("exportProgressDialogOpen", openState)
        .set("exportPathBaseName", exportPathBaseName) as AppState
  );
};
export const setExportFormat = (
  exportFormat: ExportFormat,
  stateRef: StateRef<AppState>
) => {
  update(stateRef, (s) => s.set("exportFormat", exportFormat));
};

export const setExportPath = (
  exportPath: string,
  stateRef: StateRef<AppState>
) => {
  update(stateRef, (s) => s.set("exportPath", exportPath));
};

export const setViewConfirmDialogOpen = (
  openState: boolean,
  path: DataSourcePath | null,
  stateRef: StateRef<AppState>
) => {
  update(
    stateRef,
    (s) =>
      s
        .set("viewConfirmDialogOpen", openState)
        .set("viewConfirmSourcePath", path) as AppState
  );
};

export const setExportProgress = (
  percentComplete: number,
  stateRef: StateRef<AppState>
) => {
  update(stateRef, (s) => s.set("exportPercent", percentComplete) as AppState);
};

export const setFilter = (
  fe: reltab.FilterExp,
  stateRef: StateRef<AppState>
) => {
  update(
    stateRef,
    vpUpdate((viewParams) => viewParams.set("filterExp", fe) as ViewParams)
  );
};

export const appendFilterRuleToExp = (
  prevFE: reltab.FilterExp | null | undefined,
  colId: string,
  val: any
): reltab.FilterExp => {
  return appendFilterRuleWithOpToExp(prevFE, colId, "EQ", val);
};

export const appendFilterRuleWithOpToExp = (
  prevFE: reltab.FilterExp | null | undefined,
  colId: string,
  op: reltab.RelOp,
  val: any
): reltab.FilterExp => {
  let newRelExp: reltab.RelExp;
  const opStr = String(op);
  const isNeg = opStr === "NEQ" || opStr === "<>" || opStr === "NOTNULL";

  if (val === null || val === undefined) {
    newRelExp = isNeg
      ? new reltab.UnaryRelExp("NOTNULL", reltab.col(colId))
      : new reltab.UnaryRelExp("ISNULL", reltab.col(colId));
  } else {
    let expVal: any = val;
    if (expVal instanceof Date) {
      const pad = (n: number) => (n < 10 ? "0" + n : n);
      const YYYY = expVal.getFullYear();
      const MM = pad(expVal.getMonth() + 1);
      const DD = pad(expVal.getDate());
      const hh = pad(expVal.getHours());
      const mm = pad(expVal.getMinutes());
      const ss = pad(expVal.getSeconds());
      expVal = `${YYYY}-${MM}-${DD} ${hh}:${mm}:${ss}`;
    } else if (typeof expVal === "bigint") {
      const num = Number(expVal);
      expVal = Number.isSafeInteger(num) ? num : expVal.toString();
    }
    const binOp: reltab.BinRelOp =
      opStr === "<>" || opStr === "NEQ"
        ? "NEQ"
        : opStr === "=" || opStr === "EQ"
          ? "EQ"
          : (op as reltab.BinRelOp);
    newRelExp = new reltab.BinRelExp(
      binOp,
      reltab.col(colId),
      reltab.constVal(expVal)
    );
  }

  if (!prevFE || !prevFE.opArgs || prevFE.opArgs.length === 0) {
    return new reltab.FilterExp("AND", [newRelExp]);
  } else if (prevFE.op === "AND") {
    return new reltab.FilterExp("AND", prevFE.opArgs.concat(newRelExp));
  } else {
    return new reltab.FilterExp("AND", [prevFE, newRelExp]);
  }
};

export const addFilterRule = (
  colId: string,
  val: any,
  stateRef: StateRef<AppState>
): reltab.FilterExp => {
  return addFilterRuleWithOp(colId, "EQ", val, stateRef);
};

export const addFilterRuleWithOp = (
  colId: string,
  op: reltab.RelOp,
  val: any,
  stateRef: StateRef<AppState>
): reltab.FilterExp => {
  const appState = mutableGet(stateRef);
  const prevFE = appState.viewState?.viewParams?.filterExp;
  const nextFE = appendFilterRuleWithOpToExp(prevFE, colId, op, val);
  if (nextFE !== prevFE) {
    setFilter(nextFE, stateRef);
  }
  return nextFE;
};

export const appendTimeBracketToExp = (
  prevFE: reltab.FilterExp | null | undefined,
  colId: string,
  startStr: string,
  endStr: string
): reltab.FilterExp => {
  const gteExp = new reltab.BinRelExp(
    "GE",
    reltab.col(colId),
    reltab.constVal(startStr)
  );
  const lteExp = new reltab.BinRelExp(
    "LE",
    reltab.col(colId),
    reltab.constVal(endStr)
  );
  const newRules = [gteExp, lteExp];

  if (!prevFE || !prevFE.opArgs || prevFE.opArgs.length === 0) {
    return new reltab.FilterExp("AND", newRules);
  } else if (prevFE.op === "AND") {
    return new reltab.FilterExp("AND", prevFE.opArgs.concat(newRules));
  } else {
    return new reltab.FilterExp("AND", [prevFE, ...newRules]);
  }
};

export const addTimeBracketFilter = (
  colId: string,
  startStr: string,
  endStr: string,
  stateRef: StateRef<AppState>
): reltab.FilterExp => {
  const appState = mutableGet(stateRef);
  const prevFE = appState.viewState?.viewParams?.filterExp;
  const nextFE = appendTimeBracketToExp(prevFE, colId, startStr, endStr);
  if (nextFE !== prevFE) {
    setFilter(nextFE, stateRef);
  }
  return nextFE;
};

export const setOmniSearch = (
  searchTerm: string,
  stateRef: StateRef<AppState>
) => {
  update(
    stateRef,
    vpUpdate(
      (viewParams) =>
        viewParams.set("omniSearch", searchTerm) as ViewParams
    )
  );
};

export const setHistogramBrushFilter = (
  colId: string,
  range: [number, number] | null,
  stateRef: StateRef<AppState>
) => {
  let baseFE: FilterExp;
  if (range !== null) {
    const appState = mutableGet(stateRef);
    const prevFE = appState.viewState.viewParams.filterExp;
    // ensure that prevFE is either null or a top-level "AND" operator:
    if (prevFE != null) {
      if (prevFE.op !== "AND") {
        log.info(
          "setHistogramBrushFilter: unexpected structure for current filter expression, ignoring brush filter"
        );
        return;
      }
      // drop any previous mentions of colId from the filter expression:
      const cleanOpArgs = prevFE.opArgs.filter((subExp: SubExp) => {
        if (subExp.expType === "BinRelExp") {
          const lhs = subExp.lhs;
          if (lhs.expType === "ColRef" && lhs.colName === colId) {
            return false;
          }
        }
        return true;
      });
      baseFE = new FilterExp("AND", cleanOpArgs);
    } else {
      baseFE = and();
    }
    const nextFE = baseFE
      .ge(col(colId), constVal(range[0]))
      .le(col(colId), constVal(range[1]));
    update(
      stateRef,
      vpUpdate(
        (viewParams) => viewParams.set("filterExp", nextFE) as ViewParams
      )
    );
  }
};

export const setHistogramBrushRange = (
  colId: string,
  range: [number, number] | null,
  stateRef: StateRef<AppState>
) => {
  if (range !== null) {
    update(
      stateRef,
      (st: AppState): AppState =>
        st.updateIn(["viewState", "queryView"], (qvu: unknown) => {
          const oldQueryView = qvu as QueryView;
          if (!oldQueryView || !oldQueryView.histoMap) {
            return qvu;
          }
          const oldHistData = oldQueryView.histoMap[colId];
          if (!oldHistData) {
            return qvu;
          }
          const newHistData: NumericColumnHistogramData = {
            ...oldHistData,
            brushMinVal: range[0],
            brushMaxVal: range[1],
          };
          const newHistoMap = {
            ...oldQueryView.histoMap,
            [colId]: newHistData,
          };
          const newQueryView = oldQueryView.set("histoMap", newHistoMap);
          return newQueryView;
        }) as AppState
    );
  }
};

let regexViewSeq = 1;

export const setRegexDialogOpen = (
  open: boolean,
  stateRef: StateRef<AppState>
) => {
  update(
    stateRef,
    (st: AppState): AppState => st.set("regexDialogOpen", open) as AppState
  );
};
// Toad v2.0.7: Parse alias for setRegexDialogOpen
export const setParseDialogOpen = setRegexDialogOpen;

export type ExtractionFormatType =
  | "raw"
  | "kv"
  | "json"
  | "json_array"
  | "csv"
  | "space"
  | "arr";

export interface ExtractionFieldMapping {
  sourceKeyOrIdx: string | number;
  outputColName: string;
  colType?: string;
  enabled: boolean;
  tokenIndex?: number;
}

export interface ColumnExtractionParams {
  mode: "simple" | "advanced";
  targetCol: string;
  formatType?: ExtractionFormatType;
  hasHeader?: boolean;
  headerSep?: string;
  headerColName?: string;
  delimiter?: string;
  kvAssign?: string;
  quoteOpen?: string;
  quoteClose?: string;
  trim?: boolean;
  collapseDelimiters?: boolean;
  regexPattern?: string;
  fieldMappings: ExtractionFieldMapping[];
}

export const applyColumnExtraction = async (
  params: ColumnExtractionParams,
  stateRef: StateRef<AppState>
): Promise<void> => {
  const appState = mutableGet(stateRef);
  const viewState = appState.viewState;
  if (!viewState || !viewState.dbc) {
    return;
  }

  const { dbc, dsPath, baseSchema } = viewState;
  if (!baseSchema) {
    return;
  }

  const activeMappings = (params.fieldMappings || []).filter(
    (m) => m.enabled && m.outputColName && m.outputColName.trim().length > 0
  );
  if (params.formatType !== "raw" && activeMappings.length === 0) {
    throw new Error("Please select at least one column to extract!");
  }

  // 1. Determine current table name
  let currentTableName: string;
  const baseRep = (viewState.baseQuery as any)?._rep;
  if (baseRep && baseRep.operator === "table" && baseRep.tableName) {
    currentTableName = baseRep.tableName;
  } else if (dsPath) {
    currentTableName = await dbc.getTableName(dsPath);
  } else {
    throw new Error("Cannot determine current table name for column extraction");
  }

  // 2. Generate unique new view name
  const newTableName = `${currentTableName}_rx${regexViewSeq++}`;

  // 3. Handle Header Prefix CTE isolation if enabled
  const hasHeader = !!params.hasHeader;
  const headerSep = params.headerSep || ": ";
  const headerColName = (params.headerColName || "log_header").trim();
  const rawTargetColEscaped = `"${params.targetCol.replace(/"/g, '""')}"`;

  let cteClause = "";
  let targetColForExtract: string;
  let fromSourceClause: string;
  let headerProjectClause = "";

  if (hasHeader) {
    const sqlHeaderSep = headerSep.replace(/'/g, "''");
    const sepLen = headerSep.length;
    cteClause = `WITH split_log AS (\n  SELECT *,\n    split_part(${rawTargetColEscaped}, '${sqlHeaderSep}', 1) AS "${headerColName.replace(/"/g, '""')}",\n    substr(${rawTargetColEscaped}, length(split_part(${rawTargetColEscaped}, '${sqlHeaderSep}', 1)) + ${sepLen + 1}) AS _body\n  FROM "${currentTableName}"\n)\n`;
    targetColForExtract = "_body";
    fromSourceClause = "FROM split_log";
    headerProjectClause = `"${headerColName.replace(/"/g, '""')}", `;
  } else {
    targetColForExtract = rawTargetColEscaped;
    fromSourceClause = `FROM "${currentTableName}"`;
  }

  // 4. Collect new column names and handle collisions with existing columns
  const newColNames: string[] = [];
  if (hasHeader) {
    newColNames.push(headerColName);
  }
  for (const m of activeMappings) {
    newColNames.push(m.outputColName.trim());
  }

  const existingMatches = newColNames.filter((c) =>
    baseSchema.columns.includes(c)
  );
  const selectExclude =
    existingMatches.length > 0
      ? `* EXCLUDE (${existingMatches.map((c) => `"${c.replace(/"/g, '""')}"`).join(", ")})`
      : `*`;

  // 5. Construct extraction clauses
  const extractClauses: string[] = [];

  if (params.mode === "advanced") {
    const rawPattern = params.regexPattern || "";
    const sqlEscapedRegex = rawPattern.replace(/'/g, "''");
    for (const m of activeMappings) {
      const grpIdx = Number(m.sourceKeyOrIdx);
      const outCol = `"${m.outputColName.trim().replace(/"/g, '""')}"`;
      let expr = `regexp_extract(${targetColForExtract}, '${sqlEscapedRegex}', ${grpIdx})`;
      if (m.colType && m.colType !== "VARCHAR") {
        expr = `TRY_CAST(${expr} AS ${m.colType})`;
      }
      extractClauses.push(`${expr} AS ${outCol}`);
    }
  } else {
    // Mode is "simple"
    const formatType = params.formatType || "raw";
    if (formatType === "kv" || (formatType === "raw" && params.kvAssign && params.kvAssign.trim().length > 0)) {
      if (formatType === "raw" && activeMappings.length === 0) {
        // Passthrough mode
        if (hasHeader) {
          extractClauses.push(`_body AS "payload"`);
        }
      } else {
        const assign = params.kvAssign ? params.kvAssign.trim() : (formatType === "kv" ? "=" : "");
        const delim = params.delimiter || " ";
        const qOpen = params.quoteOpen !== undefined ? params.quoteOpen : '"';
        const qClose = params.quoteClose !== undefined ? params.quoteClose : '"';
        const escapedAssign = assign.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
        const escapedDelim = delim === " " ? "\\s" : delim.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
        const escapedQOpen = qOpen.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
        const escapedQClose = qClose.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
        const sqlDelim = delim.replace(/'/g, "''");
        const sqlAssign = assign.replace(/'/g, "''");

        // Group mappings by outputColName for Smart Coalesce / Aliasing
        const colGroups = new Map<string, { mappings: ExtractionFieldMapping[]; type: string }>();
        for (const m of activeMappings) {
          const outName = m.outputColName.trim();
          if (!colGroups.has(outName)) {
            colGroups.set(outName, { mappings: [], type: m.colType || "VARCHAR" });
          }
          colGroups.get(outName)!.mappings.push(m);
        }

        for (const [outColName, group] of colGroups.entries()) {
          const exprList: string[] = [];
          for (const m of group.mappings) {
            const keyOrIdx = String(m.sourceKeyOrIdx);
            if (m.tokenIndex !== undefined || /^str_?\d+$/i.test(keyOrIdx) || (!assign && /^\d+$/.test(keyOrIdx))) {
              // Positional unkeyed token strX (User rule: strX with X integer increasing without repeating)
              const idx = m.tokenIndex !== undefined ? m.tokenIndex : (Number(keyOrIdx.replace(/^str_?/i, "")) || 1);
              if (assign && assign.trim()) {
                exprList.push(`TRIM(list_extract(list_filter(str_split(${targetColForExtract}, '${sqlDelim}'), x -> trim(x) NOT LIKE '%${sqlAssign}%'), ${idx}))`);
              } else {
                exprList.push(`TRIM(split_part(${targetColForExtract}, '${sqlDelim}', ${idx}))`);
              }
            } else {
              // Key-Value token
              const escapedKey = keyOrIdx.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
              let pattern: string;
              if (qOpen && qClose) {
                pattern = `(?:^|[\\s${escapedDelim},;|])${escapedKey}\\s*${escapedAssign}\\s*(?:${escapedQOpen}([^${escapedQClose}]*)${escapedQClose}|([^\\s${escapedDelim},;\\r\\n|&]+))`;
              } else {
                pattern = `(?:^|[\\s${escapedDelim},;|])${escapedKey}\\s*${escapedAssign}\\s*([^\\s${escapedDelim},;\\r\\n|&]+)`;
              }
              const sqlPattern = pattern.replace(/'/g, "''");
              exprList.push(`COALESCE(NULLIF(regexp_extract(${targetColForExtract}, '${sqlPattern}', 1), ''), regexp_extract(${targetColForExtract}, '${sqlPattern}', 2))`);
            }
          }

          let combinedExpr: string;
          if (exprList.length === 1) {
            combinedExpr = exprList[0];
          } else {
            combinedExpr = `COALESCE(${exprList.map((e) => `NULLIF(${e}, '')`).join(", ")})`;
          }

          if (group.type && group.type !== "VARCHAR") {
            combinedExpr = `TRY_CAST(${combinedExpr} AS ${group.type})`;
          }
          extractClauses.push(`${combinedExpr} AS "${outColName.replace(/"/g, '""')}"`);
        }
      }
    } else if (formatType === "json") {
      for (const m of activeMappings) {
        const key = String(m.sourceKeyOrIdx);
        const outCol = `"${m.outputColName.trim().replace(/"/g, '""')}"`;
        const escapedKey = key
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"')
          .replace(/'/g, "''");
        let expr = `json_extract_string(${targetColForExtract}, '$."${escapedKey}"')`;
        if (m.colType && m.colType !== "VARCHAR") {
          expr = `TRY_CAST(${expr} AS ${m.colType})`;
        }
        extractClauses.push(`${expr} AS ${outCol}`);
      }
    } else if (formatType === "json_array" || formatType === "arr") {
      for (const m of activeMappings) {
        const idx = Number(m.sourceKeyOrIdx);
        const outCol = `"${m.outputColName.trim().replace(/"/g, '""')}"`;
        let expr = `json_extract_string(${targetColForExtract}, '$[${idx}]')`;
        if (m.colType && m.colType !== "VARCHAR") {
          expr = `TRY_CAST(${expr} AS ${m.colType})`;
        }
        extractClauses.push(`${expr} AS ${outCol}`);
      }
    } else if (formatType === "csv") {
      const delim = params.delimiter || ",";
      const regexDelim = delim.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      for (const m of activeMappings) {
        const idx = m.tokenIndex !== undefined ? m.tokenIndex : Math.max(1, Number(String(m.sourceKeyOrIdx).replace(/^str_?/i, "")) || 1);
        const repCount = idx - 1;
        const outCol = `"${m.outputColName.trim().replace(/"/g, '""')}"`;
        const pattern = `^(?:(?:"[^"]*"|[^${regexDelim}]*)${regexDelim}){${repCount}}(?:"([^"]*)"|([^${regexDelim}]*))`;
        const sqlPattern = pattern.replace(/'/g, "''");
        let expr = `COALESCE(NULLIF(regexp_extract(${targetColForExtract}, '${sqlPattern}', 1), ''), regexp_extract(${targetColForExtract}, '${sqlPattern}', 2))`;
        if (params.trim !== false) {
          expr = `TRIM(${expr})`;
        }
        if (m.colType && m.colType !== "VARCHAR") {
          expr = `TRY_CAST(${expr} AS ${m.colType})`;
        }
        extractClauses.push(`${expr} AS ${outCol}`);
      }
    } else {
      // "space" or "raw" delimited
      const delim = params.delimiter !== undefined ? params.delimiter : " ";
      const trim = params.trim !== false;
      const collapse = params.collapseDelimiters !== false;

      for (const m of activeMappings) {
        const idx = m.tokenIndex !== undefined ? m.tokenIndex : Math.max(1, Number(String(m.sourceKeyOrIdx).replace(/^str_?/i, "")) || 1);
        const outCol = `"${m.outputColName.trim().replace(/"/g, '""')}"`;
        let splitTarget: string;
        let splitDelim = delim;

        if (collapse) {
          if (delim === " " || delim === "\\t" || delim === "\t") {
            splitTarget = `regexp_replace(${targetColForExtract}, '\\s+', ' ', 'g')`;
            splitDelim = " ";
          } else {
            const escapedDelimRegex = delim.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
            const sqlEscapedDelim = delim.replace(/'/g, "''");
            splitTarget = `regexp_replace(${targetColForExtract}, '(${escapedDelimRegex})+', '${sqlEscapedDelim}', 'g')`;
          }
        } else {
          splitTarget = targetColForExtract;
        }

        const sqlDelim = splitDelim.replace(/'/g, "''");
        let expr: string;
        if (splitDelim === " " || splitDelim === "\\t" || splitDelim === "\t") {
          expr = `CASE WHEN contains(${splitTarget}, ' ') THEN TRIM(split_part(${splitTarget}, ' ', ${idx})) ELSE NULL END`;
        } else {
          expr = `CASE WHEN contains(${splitTarget}, '${sqlDelim}') THEN TRIM(split_part(${splitTarget}, '${sqlDelim}', ${idx})) ELSE NULL END`;
        }
        if (m.colType && m.colType !== "VARCHAR") {
          expr = `TRY_CAST(${expr} AS ${m.colType})`;
        }
        extractClauses.push(`${expr} AS ${outCol}`);
      }
    }
  }

  // --- Unmatched Column Auto-Pruning Engine (Toad v2.0.5) ---
  const unmatchedColName = `unmatched_${params.targetCol}`;
  const finalExtractClauses = [...extractClauses];
  const finalNewColNames = [...newColNames];

  let createViewSql: string;

  if (extractClauses.length > 0 && (params.mode === "simple" || params.mode === "advanced")) {
    const extractedNames = Array.from(new Set(activeMappings.map((m) => m.outputColName.trim())));
    if (extractedNames.length > 0) {
      const allExtractedNullCond = extractedNames
        .map((c) => `("${c.replace(/"/g, '""')}" IS NULL OR "${c.replace(/"/g, '""')}" = '')`)
        .join(" AND ");

      const preflightSql = `${cteClause}SELECT 1 FROM (SELECT ${selectExclude}, ${headerProjectClause}${extractClauses.join(", ")} ${fromSourceClause}) _sub WHERE ${allExtractedNullCond} LIMIT 1`;
      
      let hasUnmatchedRows = false;
      try {
        const checkRows = await dbc.runSqlQuery(preflightSql);
        if (checkRows && checkRows.length > 0) {
          hasUnmatchedRows = true;
        }
      } catch (err: any) {
        log.warn("[Toad v2.0.5] Pre-flight check warning:", err ? err.message : String(err));
        hasUnmatchedRows = true;
      }

      if (hasUnmatchedRows) {
        log.info(`[Toad v2.0.5] Unmatched rows detected. Adding fallback column: "${unmatchedColName}"`);
        const baseColumnsSelect = `${selectExclude}, ${headerProjectClause}${extractClauses.join(", ")}`;
        const baseExtractSql = `${cteClause}SELECT ${baseColumnsSelect} ${fromSourceClause}`;
        const unmatchedClause = `CASE WHEN (${allExtractedNullCond}) THEN ${targetColForExtract} ELSE NULL END AS "${unmatchedColName.replace(/"/g, '""')}"`;
        createViewSql = `CREATE VIEW "${newTableName}" AS SELECT *, ${unmatchedClause} FROM (${baseExtractSql}) _sub_extract`;
        finalNewColNames.push(unmatchedColName);
      } else {
        log.info(`[Toad v2.0.5] 100% matched clean table! Auto-pruning empty "${unmatchedColName}" column.`);
        const columnsSelectPart = `${selectExclude}, ${headerProjectClause}${extractClauses.join(", ")}`;
        createViewSql = `${cteClause}CREATE VIEW "${newTableName}" AS SELECT ${columnsSelectPart} ${fromSourceClause}`;
      }
    } else {
      const columnsSelectPart = extractClauses.length > 0
        ? `${selectExclude}, ${headerProjectClause}${extractClauses.join(", ")}`
        : (hasHeader ? `${selectExclude}, ${headerProjectClause.slice(0, -2)}` : `*`);
      createViewSql = `${cteClause}CREATE VIEW "${newTableName}" AS SELECT ${columnsSelectPart} ${fromSourceClause}`;
    }
  } else {
    const columnsSelectPart = extractClauses.length > 0
      ? `${selectExclude}, ${headerProjectClause}${extractClauses.join(", ")}`
      : (hasHeader ? `${selectExclude}, ${headerProjectClause.slice(0, -2)}` : `*`);
    createViewSql = `${cteClause}CREATE VIEW "${newTableName}" AS SELECT ${columnsSelectPart} ${fromSourceClause}`;
  }

  log.info("[Toad Column Extractor v2.0.5] Creating View SQL:\n", createViewSql);

  // 6. Execute in DuckDB
  await dbc.runSqlQuery(createViewSql);

  // 7. Construct new base query and retrieve updated schema
  const newBaseQuery = reltab.tableQuery(newTableName);
  const newBaseSchema = await aggtree.getBaseSchema(
    dbc,
    newBaseQuery,
    appState.showRecordCount
  );

  // 8. Update displayColumns: preserve current order, append finalNewColNames at the end!
  const prevDisplayCols = viewState.viewParams.displayColumns.filter(
    (c) => !finalNewColNames.includes(c)
  );
  const nextDisplayCols = [...prevDisplayCols, ...finalNewColNames];

  const nextViewParams = viewState.viewParams.set(
    "displayColumns",
    nextDisplayCols
  );

  const nextViewState = viewState
    .set("baseQuery", newBaseQuery)
    .set("baseSchema", newBaseSchema)
    .set("viewParams", nextViewParams)
    .set("initialViewParams", nextViewParams);

  await awaitableUpdate_(
    stateRef,
    (st: AppState): AppState =>
      st
        .set("viewState", nextViewState)
        .set("regexDialogOpen", false) as AppState
  );
};

/**
 * Generates lexicographically sortable column names (v2.0.13):
 * 1..999     -> str001 .. str999
 * 1000..1998 -> strA001 .. strA999
 * 1999..2997 -> strB001 .. strB999
 */
export function formatStrColName(idx: number): string {
  if (idx <= 0) idx = 1;
  if (idx <= 999) {
    return `str${String(idx).padStart(3, "0")}`;
  }
  const excess = idx - 1000;
  const blockIdx = Math.floor(excess / 999);
  const offset = (excess % 999) + 1;
  const letter = String.fromCharCode(65 + (blockIdx % 26)); // 'A' .. 'Z'
  const cycle = Math.floor(blockIdx / 26);
  const prefix = cycle > 0 ? `${letter}${cycle}` : letter;
  return `str${prefix}${String(offset).padStart(3, "0")}`;
}

/**
 * Parses existing column name to extract 1-based integer index,
 * supporting 3-digit new names (str001), alpha blocks (strA001), and legacy names (str1).
 */
export function parseStrColIndex(name: string): number | null {
  if (!name) return null;
  const trimmed = name.trim();

  // Pattern 1: Alpha-block (strA001 .. strZ999)
  const mAlpha = /^str([A-Z])(\d{3,})$/i.exec(trimmed);
  if (mAlpha) {
    const block = mAlpha[1].toUpperCase().charCodeAt(0) - 65;
    const offset = parseInt(mAlpha[2], 10);
    return 1000 + block * 999 + (offset - 1);
  }

  // Pattern 2: 3-digit new or legacy (str001, str1, str_1, str10)
  const mNum = /^str_?(\d+)$/i.exec(trimmed);
  if (mNum) {
    return parseInt(mNum[1], 10);
  }

  return null;
}

export const applyRegexExtraction = async (
  targetCol: string,
  regexPattern: string,
  numGroups: number,
  stateRef: StateRef<AppState>,
  customNames?: string[]
): Promise<void> => {
  const appState = mutableGet(stateRef);
  const viewState = appState.viewState;
  const baseSchema = viewState?.baseSchema;

  let maxStrIdx = 0;
  if (baseSchema) {
    for (const col of baseSchema.columns) {
      const idx = parseStrColIndex(col);
      if (idx !== null && idx > maxStrIdx) {
        maxStrIdx = idx;
      }
    }
  }
  const startIdx = maxStrIdx + 1;

  let captureGroupCount = 0;
  try {
    captureGroupCount =
      (new RegExp(regexPattern + "|").exec("")?.length || 1) - 1;
  } catch {
    captureGroupCount = 0;
  }
  const fieldMappings: ExtractionFieldMapping[] = [];

  if (numGroups === 1 && captureGroupCount === 0) {
    const colName = (customNames && customNames[0]) || formatStrColName(startIdx);
    fieldMappings.push({
      sourceKeyOrIdx: 0,
      outputColName: colName,
      enabled: true,
    });
  } else {
    for (let i = 0; i < numGroups; i++) {
      const colName = (customNames && customNames[i]) || formatStrColName(startIdx + i);
      fieldMappings.push({
        sourceKeyOrIdx: i + 1,
        outputColName: colName,
        enabled: true,
      });
    }
  }

  return applyColumnExtraction(
    {
      mode: "advanced",
      targetCol,
      regexPattern,
      fieldMappings,
    },
    stateRef
  );
};

export const setColumnDisplayName = (
  colId: string,
  newDisplayName: string,
  stateRef: StateRef<AppState>
): void => {
  const trimmed = newDisplayName.trim();
  if (!trimmed) return;

  update(stateRef, (appState: AppState): AppState => {
    const vs = appState.viewState;
    if (!vs || !vs.baseSchema) return appState;

    const nextBaseSchema = vs.baseSchema.withDisplayName(colId, trimmed);
    let nextVs = vs.set("baseSchema", nextBaseSchema) as ViewState;

    if (vs.dataView && vs.dataView.schema) {
      const nextDataSchema = vs.dataView.schema.withDisplayName(colId, trimmed);
      const nextDataView = new PagedDataView(
        nextDataSchema,
        vs.dataView.totalRowCount,
        vs.dataView.offset,
        vs.dataView.rawData
      );
      nextVs = nextVs.set("dataView", nextDataView) as ViewState;
    }

    return appState.set("viewState", nextVs) as AppState;
  });
};

export { setDefaultPageSize, getDefaultPageSize };

