import * as reltab from "reltab";
import * as aggtree from "aggtree";
import { PagedDataView, DataRow } from "./PagedDataView";
import { ViewParams } from "./ViewParams";
import { AppState } from "./AppState";
import { QueryView } from "./QueryView";
import {
  DataSourceConnection,
  getColumnHistogramMap,
  ColumnHistogramMap,
} from "reltab"; // eslint-disable-line

import * as oneref from "oneref"; // eslint-disable-line
import { mutableGet, addStateChangeListener } from "oneref";

import * as paging from "./paging";
import * as util from "./util";
import { ViewState } from "./ViewState";
import { Timer, TimerUpdater } from "./Timer";
import _ from "lodash";

// Error dialogs are handled via IHostBridge.showErrorDialog()
/**
 * Use ViewParams to construct a PagedDataView for use with
 * SlickGrid from reltab.TableRep
 */

const mkDataView = (
  viewParams: ViewParams,
  rowCount: number,
  offset: number,
  tableData: reltab.TableRep,
  currentPage: number = 1,
  pageSize: number = 1000
): PagedDataView => {
  const getPath = (dataRow: DataRow, depth: number) => {
    let path: Array<string | null> = [];

    for (let i = 0; i < depth; i++) {
      let pathElem = rowMap["_path" + i] as string | null;
      path.push(pathElem);
    }

    return path;
  };

  var nPivots = viewParams.vpivots.length;
  var rowData = [];
  var parentIdStack = [];

  for (var i = 0; i < tableData.rowData.length; i++) {
    // ?? shouldn't we just be constructing the rowMap once and re-use it for every row??
    var rowMap: DataRow = tableData.rowData[i] as DataRow;
    var depth: number = rowMap._depth;
    var path = getPath(rowMap, depth);
    rowMap._isOpen = viewParams.openPaths.isOpen(path);
    // console.log('mkDataView: row: ', i, ', depth: ', depth, ' path: ', path, ', isOpen: ', rowMap._isOpen)
    rowMap._isLeaf = depth > nPivots;
    rowMap._id = i;
    parentIdStack[depth] = i;
    var parentId = depth > 0 ? parentIdStack[depth - 1] : null;
    rowMap._parentId = parentId;
    rowData.push(rowMap);
  }

  const outSchema = tableData.schema;
  const dataView = new PagedDataView(
    outSchema,
    rowCount,
    offset,
    rowData,
    currentPage,
    pageSize
  );
  return dataView;
};
/*
 * hacky opt for filter count: If empty filter, just retun baseRowCount
 */

const fastFilterRowCount = async (
  rt: DataSourceConnection,
  baseRowCount: number,
  filterExp: reltab.FilterExp,
  filterQuery: reltab.QueryExp,
  onViewRowCount?: (
    query: reltab.QueryExp,
    type: "filtered" | "unfiltered" | "view"
  ) => void,
  onViewRowCountResolved?: (
    query: reltab.QueryExp,
    rowCount: number,
    type: "filtered" | "unfiltered" | "view"
  ) => void
): Promise<number> => {
  if (filterExp.opArgs.length === 0) {
    // short circuit!
    return baseRowCount;
  }

  onViewRowCount?.(filterQuery, "filtered");
  const resolvedNumber = await rt.rowCount(filterQuery);
  onViewRowCountResolved?.(filterQuery, resolvedNumber, "filtered");
  return resolvedNumber;
};
/*
 * hacky opt for using filterRowCount as viewRowCount if not pivoted
 */

const fastViewRowCount = async (
  rt: DataSourceConnection,
  filterRowCount: number,
  vpivots: Array<string>,
  viewQuery: reltab.QueryExp,
  onViewRowCount?: (
    query: reltab.QueryExp,
    type: "filtered" | "unfiltered" | "view"
  ) => void,
  onViewRowCountResolved?: (
    query: reltab.QueryExp,
    rowCount: number,
    type: "filtered" | "unfiltered" | "view"
  ) => void
): Promise<number> => {
  if (vpivots.length === 0) {
    // short circuit!
    return filterRowCount;
  }

  onViewRowCount?.(viewQuery, "view");
  const resolvedNumber = await rt.rowCount(viewQuery);
  onViewRowCountResolved?.(viewQuery, resolvedNumber, "view");
  return resolvedNumber;
};
export function findBestTimeColumn(baseSchema: reltab.Schema): string | null {
  if (!baseSchema || !baseSchema.columns || baseSchema.columns.length === 0) {
    return null;
  }
  const cols = baseSchema.columns;

  const priorities = [
    /^event[_\s]?time$/i,
    /^time[_\s]?created$/i,
    /^timestamp$/i,
    /^utc[_\s]?time$/i,
    /^date[_\s]?time$/i,
    /^time$/i,
    /^date$/i,
  ];

  for (const regex of priorities) {
    const found = cols.find((c) => regex.test(c));
    if (found) return found;
  }

  for (const c of cols) {
    const lower = c.toLowerCase();
    if (
      lower.includes("eventtime") ||
      lower.includes("timecreated") ||
      lower.includes("timestamp") ||
      lower.includes("datetime")
    ) {
      return c;
    }
  }

  for (const c of cols) {
    try {
      const colType = baseSchema.columnType(c);
      if (colType) {
        if (colType.kind === "timestamp" || colType.kind === "date") {
          return c;
        }
        const sqlName = (colType.sqlTypeName || "").toUpperCase();
        if (
          sqlName.includes("TIMESTAMP") ||
          sqlName.includes("DATE") ||
          sqlName.includes("TIME")
        ) {
          return c;
        }
      }
    } catch {}
  }

  return null;
}

/**
 * Use the current ViewParams to construct a QueryExp to send to
 * reltab using aggtree.
 * Map the resulting TableRep from the query into a PagedDataView for
 * use with SlickGrid
 */

const requestQueryView = async (
  rt: DataSourceConnection,
  baseQuery: reltab.QueryExp,
  baseSchema: reltab.Schema,
  viewParams: ViewParams,
  showRecordCount: boolean,
  prevQueryView: QueryView | null | undefined,
  onViewRowCount?: (
    query: reltab.QueryExp,
    type: "filtered" | "unfiltered" | "view"
  ) => void,
  onViewRowCountResolved?: (
    query: reltab.QueryExp,
    rowCount: number,
    type: "filtered" | "unfiltered" | "view"
  ) => void
): Promise<QueryView> => {
  const schemaCols = baseSchema.columns;
  const aggMap: any = {};

  for (let cid of schemaCols) {
    aggMap[cid] = viewParams.getAggFn(baseSchema, cid);
  }

  const effectiveFilterExp = viewParams.filterExp;

  let effectiveSortKey = viewParams.sortKey;
  if (!effectiveSortKey || effectiveSortKey.length === 0) {
    const timeCol = findBestTimeColumn(baseSchema);
    if (timeCol) {
      effectiveSortKey = [[timeCol, false]]; // DESC sort for deterministic ordering
    }
  }

  const filterQuery = baseQuery.filter(effectiveFilterExp);
  const ptree = await aggtree.vpivot(
    rt,
    filterQuery,
    baseSchema,
    viewParams.vpivots,
    viewParams.pivotLeafColumn,
    viewParams.showRoot,
    effectiveSortKey,
    aggMap,
    showRecordCount
  );
  const treeQuery = await ptree.getSortedTreeQuery(viewParams.openPaths); // const t0 = performance.now()  // eslint-disable-line

  onViewRowCount?.(baseQuery, "unfiltered");
  const baseRowCount = await rt.rowCount(baseQuery);
  onViewRowCountResolved?.(baseQuery, baseRowCount, "unfiltered");
  const filterRowCount = await fastFilterRowCount(
    rt,
    baseRowCount,
    effectiveFilterExp,
    filterQuery,
    onViewRowCount,
    onViewRowCountResolved
  );
  const rowCount = await fastViewRowCount(
    rt,
    filterRowCount,
    viewParams.vpivots,
    treeQuery,
    onViewRowCount,
    onViewRowCountResolved
  ); // const t1 = performance.now() // eslint-disable-line
  // console.log('gathering row counts took ', (t1 - t0) / 1000, ' sec')

  let histoMap: ColumnHistogramMap | null = null;
  if (
    viewParams.showColumnHistograms &&
    (prevQueryView == null ||
      prevQueryView.baseQuery !== baseQuery ||
      prevQueryView.histoMap == null)
  ) {
    const statsMap = await rt.getColumnStatsMap(baseQuery);
    histoMap = await getColumnHistogramMap(rt, baseQuery, baseSchema, statsMap);
  } else {
    if (prevQueryView != null) {
      histoMap = prevQueryView.histoMap;
    } else {
      histoMap = null;
    }
  }

  const ret = new QueryView({
    baseQuery,
    query: treeQuery,
    histoMap,
    baseRowCount,
    filterRowCount,
    rowCount,
  });
  return ret;
};

const requestDataView = async (
  rt: DataSourceConnection,
  viewParams: ViewParams,
  queryView: QueryView,
  offset: number,
  limit: number,
  onViewQuery?: (
    query: reltab.QueryExp,
    offset?: number,
    limit?: number
  ) => void,
  currentPage: number = 1,
  pageSize: number = 1000
): Promise<PagedDataView> => {
  onViewQuery?.(queryView.query, offset, limit);
  const tableData = await rt.evalQuery(queryView.query, offset, limit);
  const dataView = mkDataView(
    viewParams,
    queryView.rowCount,
    offset,
    tableData,
    currentPage,
    pageSize
  );
  return dataView;
};

const vsUpdate =
  (f: (vs: ViewState) => ViewState) =>
  (s: AppState): AppState =>
    s.update("viewState", (vs: ViewState | null) =>
      vs == null ? null : f(vs)
    ) as AppState;

/* for debugging: */
function getObjectDiff(obj1: any, obj2: any) {
  const diff = Object.keys(obj1).reduce((result, key) => {
    if (!obj2.hasOwnProperty(key)) {
      result.push(key);
    } else if (_.isEqual(obj1[key], obj2[key])) {
      const resultKeyIndex = result.indexOf(key);
      result.splice(resultKeyIndex, 1);
    }
    return result;
  }, Object.keys(obj2));

  return diff;
}

const noopSetLoadingCallback = (loading: boolean) => {};

/**
 * A PivotRequester listens for changes on the appState and viewport and
 * manages issuing of query requests
 */

export class PivotRequester {
  /*
   * 'pending' is really misnomer here -- for viewParams, offset and limit,
   * which are the parameters observed by PivotRequester, they are really
   * the 'most recent previous' parameters used to make an asynchronous request,
   * which may or may not have already completed.  We want this because we
   * need to compare application state changes with either what's currently
   * displayed OR a pending request.
   */
  pendingViewParams: ViewParams | undefined | null;
  pendingBaseQuery: reltab.QueryExp | undefined | null;
  pendingQueryRequest: Promise<QueryView> | undefined | null;
  pendingDataRequest: Promise<void | PagedDataView> | undefined | null;
  currentQueryView: QueryView | undefined | null; // set when resolved

  pendingOffset: number;
  pendingLimit: number;
  pendingPage: number;
  pageSize: number;
  errorCallback?: (e: Error) => void;
  setLoadingCallback: (loading: boolean) => void;

  constructor(
    stateRef: oneref.StateRef<AppState>,
    errorCallback?: (e: Error) => void,
    setLoadingCallback?: (loading: boolean) => void,
    public onViewQuery?: (
      query: reltab.QueryExp,
      offset?: number,
      limit?: number
    ) => void,
    public onViewRowCount?: (
      query: reltab.QueryExp,
      type: "filtered" | "unfiltered" | "view"
    ) => void,
    public onViewRowCountResolved?: (
      query: reltab.QueryExp,
      rowCount: number,
      type: "filtered" | "unfiltered" | "view"
    ) => void
  ) {
    const appState = mutableGet(stateRef);
    this.pendingQueryRequest = null;
    this.currentQueryView = null;
    this.pendingDataRequest = null;
    this.pendingViewParams = null;
    this.pendingBaseQuery = null;
    this.pendingOffset = 0;
    this.pendingLimit = 0;
    this.pendingPage = 1;
    this.pageSize = 1000;
    this.errorCallback = errorCallback;
    this.setLoadingCallback = setLoadingCallback || noopSetLoadingCallback;

    addStateChangeListener(stateRef, (_) => {
      this.onStateChange(stateRef);
    });

    // And invoke onStateChange initially to get things started:
    this.onStateChange(stateRef);
  } // issue a data request from current QueryView and
  // offset, limit:

  sendDataRequest(
    stateRef: oneref.StateRef<AppState>,
    queryView: QueryView
  ): Promise<PagedDataView> {
    this.setLoadingCallback(true);
    const appState: AppState = mutableGet(stateRef);
    const viewState = appState.viewState;
    const viewParams = viewState.viewParams;

    const curPage = viewState.currentPage || 1;
    const pSize = viewState.pageSize || 1000;
    const totalRowCount = queryView.rowCount;
    const totalPages = Math.max(1, Math.ceil(totalRowCount / pSize));
    const safePage = Math.min(Math.max(1, curPage), totalPages);

    // 5-page sliding buffer: [P-2, P-1, P, P+1, P+2] (max 5,000 rows)
    const bufStartPage = Math.max(1, safePage - 2);
    const bufEndPage = Math.min(totalPages, safePage + 2);
    const offset = (bufStartPage - 1) * pSize;
    const limit = (bufEndPage - bufStartPage + 1) * pSize;

    this.pendingOffset = offset;
    this.pendingLimit = limit;
    this.pendingPage = safePage;

    const requestDsPath = viewState.dsPath;
    const requestBaseQuery = viewState.baseQuery;

    const dreq = requestDataView(
      viewState.dbc,
      viewParams,
      queryView,
      offset,
      limit,
      this.onViewQuery,
      safePage,
      pSize
    );
    this.pendingDataRequest = dreq;
    dreq.then((dataView) => {
      this.pendingDataRequest = null;
      oneref.update(
        stateRef,
        vsUpdate((vs: ViewState) => {
          // Stale Query Guard: Bỏ qua nếu view hiện tại đã đổi sang tệp khác
          if (
            (requestDsPath && JSON.stringify(vs.dsPath) !== JSON.stringify(requestDsPath)) ||
            (requestBaseQuery && vs.baseQuery !== requestBaseQuery)
          ) {
            console.warn("PivotRequester: Bo qua ket qua truy van cu vi view da thay doi.");
            return vs;
          }
          let syncedDataView = dataView;
          if (vs.baseSchema && dataView.schema) {
            let nextSchema = dataView.schema;
            for (const cid of dataView.schema.columns) {
              const baseDn = vs.baseSchema.displayName(cid);
              if (baseDn && baseDn !== cid) {
                nextSchema = nextSchema.withDisplayName(cid, baseDn);
              }
            }
            if (nextSchema !== dataView.schema) {
              syncedDataView = new PagedDataView(
                nextSchema,
                dataView.totalRowCount,
                dataView.offset,
                dataView.rawData,
                safePage,
                pSize
              );
            }
          }
          return vs
            .update("loadingTimer", (lt) => lt.stop())
            .set("dataView", syncedDataView) as ViewState;
        })
      );
      this.setLoadingCallback(false);
      return dataView;
    }).catch((err) => {
      console.error(
        "PivotRequester: caught error fetching data view: ",
        err.message,
        err.stack
      );
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("tad-query-error", {
            detail: { message: err.message },
          })
        );
      }
      this.setLoadingCallback(false);
      oneref.update(
        stateRef,
        vsUpdate((vs: ViewState) =>
          vs.update("loadingTimer", (lt) => lt.stop())
        )
      );
      if (this.errorCallback) {
        this.errorCallback(err instanceof Error ? err : new Error(err));
      }
    });
    return dreq;
  }

  onStateChange(stateRef: oneref.StateRef<AppState>) {
    const appState: AppState = mutableGet(stateRef);
    const viewState = appState.viewState;

    if (viewState === null) {
      return;
    }

    const { queryView } = viewState;
    const viewParams = viewState.viewParams;

    if (
      viewParams !== this.pendingViewParams ||
      viewState.baseQuery !== this.pendingBaseQuery
    ) {
      /*
      log.debug(
        "*** onStateChange: requesting new query: ",
        viewState.toJS(),
        this.pendingViewParams?.toJS()
      );
      */
      /*
      const viewStateJS = viewState.toJS();
      const pendingJS = this.pendingViewParams?.toJS();
      if (viewStateJS && pendingJS) {
        const diffs = getObjectDiff(
          viewState.toJS(),
          this.pendingViewParams?.toJS()
        );
        console.log("*** state change diffs: ", diffs);
      }
      */

      // Might be nice to cancel any pending request here...
      // failing that we could calculate additional pages we need
      // if viewParams are same and only page range differs.
      const prevViewParams = this.pendingViewParams as ViewParams;
      const baseQueryChanged = viewState.baseQuery !== this.pendingBaseQuery;
      this.pendingViewParams = viewParams;
      this.pendingBaseQuery = viewState.baseQuery;

      const isOnlyDisplayOrderChange = (
        prevVP: ViewParams | null | undefined,
        nextVP: ViewParams | null | undefined
      ): boolean => {
        if (!prevVP || !nextVP) return false;
        return (
          prevVP.filterExp === nextVP.filterExp &&
          prevVP.sortKey === nextVP.sortKey &&
          prevVP.vpivots === nextVP.vpivots &&
          prevVP.pivotLeafColumn === nextVP.pivotLeafColumn &&
          prevVP.showColumnHistograms === nextVP.showColumnHistograms &&
          prevVP.showRoot === nextVP.showRoot &&
          prevVP.openPaths === nextVP.openPaths
        );
      };

      if (
        !baseQueryChanged &&
        queryView != null &&
        isOnlyDisplayOrderChange(prevViewParams, viewParams)
      ) {
        // Fast path (Toad v2.0.5): Only displayColumns order changed.
        // In-memory DataView already contains all columns; skip expensive DuckDB re-query and IPC transfer!
        return;
      }
      const requestDsPath = viewState.dsPath;
      const requestBaseQuery = viewState.baseQuery;
      // NOTE!  Very important to pass queryView (latest from appState) and not
      // this.currentQueryView, which may be stale.
      // TODO:  The sequencing and control flow here is really subtle; we should rework this to make
      // it easier to reason about the sequencing.
      const qreq = requestQueryView(
        viewState.dbc,
        viewState.baseQuery,
        viewState.baseSchema,
        this.pendingViewParams,
        appState.showRecordCount,
        queryView,
        this.onViewRowCount,
        this.onViewRowCountResolved
      );
      this.pendingQueryRequest = qreq;
      this.pendingDataRequest = qreq
        .then((queryView) => {
          const curState: AppState = mutableGet(stateRef);
          if (
            curState.viewState &&
            ((requestDsPath && JSON.stringify(curState.viewState.dsPath) !== JSON.stringify(requestDsPath)) ||
             (requestBaseQuery && curState.viewState.baseQuery !== requestBaseQuery))
          ) {
            console.warn("PivotRequester: Bo qua QueryView cu vi nguoi dung da chuyen view.");
            return null as any;
          }
          this.currentQueryView = queryView;
          oneref.update(
            stateRef,
            vsUpdate((vs: ViewState) => {
              /*
               * queryView.rowCount may have changed since last data request;
               * trim viewport to ensure its in range
               */
              const [viewportTop, viewportBottom] = paging.clampViewport(
                queryView.rowCount,
                vs.viewportTop,
                vs.viewportBottom
              );
              return vs
                .set("viewportTop", viewportTop)
                .set("viewportBottom", viewportBottom)
                .set("queryView", queryView) as ViewState;
            })
          );
          /*
          log.debug(
            "*** onStateChange: sending request to satisfy view state update"
          );
          */
          return this.sendDataRequest(stateRef, queryView);
        })
        .catch((err) => {
          console.error(
            "PivotRequester: caught error updating view: ",
            err.message,
            err.stack
          );
          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("tad-query-error", {
                detail: { message: err.message },
              })
            );
          }
          this.setLoadingCallback(false);
          // TODO:
          // remoteErrorDialog("Error constructing view", err.message); // Now let's try and restore to previous view params:
          oneref.update(
            stateRef,
            vsUpdate((vs: ViewState) =>
              vs.update("loadingTimer", (lt) => lt.stop())
            )
          );
          if (this.errorCallback) {
            this.errorCallback(err instanceof Error ? err : new Error(err));
          }
        });
      const ltUpdater = util.pathUpdater<AppState, Timer>(stateRef, [
        "viewState",
        "loadingTimer",
      ]);
      const nextAppState = appState.updateIn(
        ["viewState", "loadingTimer"],
        (lt) => (lt as Timer).run(200, ltUpdater as unknown as TimerUpdater)
      ) as AppState;
      oneref.update(stateRef, (_) => nextAppState);
    } else {
      const curPage = viewState.currentPage || 1;
      const pSize = viewState.pageSize || 1000;
      const pageStartRow = (curPage - 1) * pSize;
      const pageEndRow = pageStartRow + pSize;

      // Check if current page is outside the loaded buffer range or pageSize changed:
      const bufferOutOfRange =
        pageStartRow < this.pendingOffset ||
        pageEndRow > this.pendingOffset + this.pendingLimit;
      const pageSizeChanged = pSize !== this.pageSize;
      this.pageSize = pSize;

      if (this.currentQueryView !== null && (bufferOutOfRange || pageSizeChanged)) {
        const qv: QueryView = this.currentQueryView as any;
        this.sendDataRequest(stateRef, qv);
      }
    }
  }
}
