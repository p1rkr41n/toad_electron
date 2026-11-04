/**
 *
 * A DataGrid component, implemented using SlickGrid.
 *
 * This is a refactor of the original GridPane that decouples SlickGrid from Tad. The goal is to define a virtual DataGrid React
 * component that does not have any Tad or SlickGrid details in the
 */
// for debugging resize handler:
// import $ from 'jquery'
import _ from "lodash";
import * as React from "react";

/* /// <reference path="slickgrid-es6.d.ts"> */
import { ResizeSensor, Menu, MenuItem, MenuDivider, Spinner } from "@blueprintjs/core";
import * as he from "he";
import { useRef, useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import * as reltab from "reltab";
import { ColumnType, NumericColumnHistogramData } from "reltab";
import * as SlickGrid from "slickgrid-es6";
import {
  VictoryAxis,
  VictoryBar,
  VictoryBrushContainer,
  VictoryChart,
} from "victory";
import { CellFormatter } from "../FormatOptions";
import { DataRow, PagedDataView } from "../PagedDataView";
import { Cell } from "./SelectionChangeData";
import { SimpleClipboard } from "./SimpleClipboard";

const { Slick } = SlickGrid;
const { Plugins } = SlickGrid as any;
const { CellRangeSelector, CellSelectionModel, CellCopyManager, AutoTooltips } =
  Plugins;

export type OpenURLFn = (url: string) => void;

let divCounter = 0;

const genContainerId = (): string => `epGrid${divCounter++}`;

const baseGridOptions = {
  multiColumnSort: true,
  headerRowHeight: 80,
};

const INDENT_PER_LEVEL = 15; // pixels

const calcIndent = (depth: number): number => INDENT_PER_LEVEL * depth;

/*
 * Formatter for cells in pivot column
 */
const groupCellFormatter = (
  row: any,
  cell: any,
  value: any,
  columnDef: any,
  item: any
) => {
  const toggleCssClass = "slick-group-toggle";
  const toggleExpandedCssClass = "expanded";
  const toggleCollapsedCssClass = "collapsed";
  const groupTitleCssClass = "slick-group-title";

  var indentation = calcIndent(item._depth) + "px";

  // We could consider using the text formatter from ViewParams here, but
  // for now let's just use he.encode() to ensure reasonable escaping
  // of special characters and avoid any HTML / JS injection issues:
  var pivotStr = item._pivot == null ? "" : he.encode(item._pivot);

  const expandClass = !item._isLeaf
    ? item._isOpen
      ? toggleExpandedCssClass
      : toggleCollapsedCssClass
    : "";
  const ret = `
<span class='${toggleCssClass} ${expandClass}' style='margin-left: ${indentation}'>
</span>
<span class='${groupTitleCssClass}' level='${item._depth}'>${pivotStr}</span>`;
  return ret;
};

// scan table data to make best effort at initial column widths
const MINCOLWIDTH = 60;
const MAXCOLWIDTH = 330;

const CHAR_WIDTH = 7.0; // max width of a character in the font used

// TODO: use real font metrics:
const measureStringWidth = (s: string): number => 8 + CHAR_WIDTH * s.length;
const measureHeaderStringWidth = (s: string): number =>
  24 + CHAR_WIDTH * s.length;

// get column width for specific column:
const getColWidth = (
  getColumnFormatter: (schema: reltab.Schema, cid: string) => CellFormatter,
  dataView: PagedDataView,
  cnm: string
) => {
  if (!dataView || typeof dataView.getLength !== "function" || !dataView.schema) {
    return MINCOLWIDTH;
  }
  const { schema } = dataView;
  let sf: (val: any) => string;
  const hasCol =
    schema.columnIndices && schema.columnIndices[cnm] !== undefined;
  if (hasCol) {
    try {
      const cf = getColumnFormatter(schema, cnm);
      sf = (val: any) => (val != null && cf ? cf(val) ?? val.toString() : "");
    } catch {
      sf = (val: any) => (val != null ? val.toString() : "");
    }
  } else {
    sf = (val: any) => (val != null ? val.toString() : "");
  }
  let colWidth = MINCOLWIDTH;
  const nRows = dataView.getLength();
  const sampleLimit = Math.min(nRows, 100);
  for (let i = 0; i < sampleLimit; i++) {
    const row = dataView.getItem(i);
    if (!row) continue;
    const cellVal = row[cnm];
    let cellWidth = MINCOLWIDTH;
    if (cellVal != null) {
      cellWidth = measureStringWidth(sf(cellVal));
    }
    if (cnm === "_pivot") {
      cellWidth += calcIndent((row._depth || 0) + 2);
    }
    colWidth = Math.min(
      MAXCOLWIDTH,
      Math.max(colWidth, cellWidth)
    );
  }
  let displayName = cnm;
  try {
    displayName = dataView.schema.displayName(cnm) || cnm;
  } catch {}
  const headerStrWidth = measureHeaderStringWidth(displayName);
  colWidth = Math.min(
    MAXCOLWIDTH,
    Math.max(colWidth, headerStrWidth)
  );
  return colWidth;
};

type ColWidthMap = { [cid: string]: number };

function getInitialColWidthsMap(
  getColumnFormatter: (schema: reltab.Schema, cid: string) => CellFormatter,
  dataView: PagedDataView
): ColWidthMap {
  // let's approximate the column width:
  var colWidths: ColWidthMap = {};
  if (!dataView || typeof dataView.getLength !== "function") {
    return {};
  }
  var nRows = dataView.getLength();
  if (nRows === 0) {
    return {};
  }
  const initRow = dataView.getItem(0);
  if (!initRow) {
    return {};
  }
  for (let cnm in initRow) {
    if (cnm.startsWith("_") && cnm !== "_pivot") {
      continue;
    }
    colWidths[cnm] = getColWidth(getColumnFormatter, dataView, cnm);
  }

  return colWidths;
}

/*
 * Construct map of SlickGrid column descriptors from base schema
 * and column width info
 *
 * Map should contain entries for all column ids
 */
const mkSlickColMap = (
  schema: reltab.Schema,
  getColumnFormatter: (schema: reltab.Schema, cid: string) => CellFormatter,
  getColumnCssClassName: (schema: reltab.Schema, cid: string) => string | null,
  pivotColumnDisplayName: string,
  colWidths: ColWidthMap,
  expandedRowIndex?: number | null
) => {
  let slickColMap: any = {};

  // hidden columns:
  slickColMap["_id"] = { id: "_id", field: "_id", name: "_id" };
  slickColMap["_parentId"] = {
    id: "_parentId",
    field: "_parentId",
    name: "_parentId",
  };

  // Event details expansion column:
  slickColMap["_expand"] = {
    id: "_expand",
    field: "_expand",
    name: '<span class="bp4-icon bp4-icon-eye-open" style="font-size:11px;color:#8a9ba8;" title="Expand Event Details"></span>',
    toolTip: "Expand / Collapse Event Details",
    width: 34,
    minWidth: 34,
    maxWidth: 34,
    resizable: false,
    sortable: false,
    selectable: true,
    cssClass: "slick-cell-expand-col",
    headerCssClass: "slick-header-expand-col",
    formatter: (
      row: any,
      cell: any,
      value: any,
      columnDef: any,
      item: any
    ) => {
      if (!item || item._isLeaf === false) {
        return "";
      }
      const curProps = (columnDef?._grid as any)?._tadProps;
      const curExpanded =
        curProps?.expandedRowIndex !== undefined
          ? curProps.expandedRowIndex
          : expandedRowIndex;
      const isExpanded =
        curExpanded !== undefined &&
        curExpanded !== null &&
        curExpanded === row;
      const iconClass = isExpanded
        ? "bp4-icon-chevron-down"
        : "bp4-icon-chevron-right";
      const activeClass = isExpanded ? " active" : "";
      const title = isExpanded
        ? "Collapse Event Details"
        : "Expand Event Details";
      return `<button type="button" class="btn-event-expand${activeClass}" title="${title}" data-row="${row}"><span class="bp4-icon ${iconClass}"></span></button>`;
    },
  };

  for (let colId of schema.columns) {
    let cmd = schema.columnMetadata[colId];
    if (!cmd) {
      console.error("could not find column metadata for ", colId, schema);
    }
    let ci: any = {
      id: colId,
      field: colId,
      cssClass: "",
      name: "",
      formatter: null,
    };
    if (colId === "_pivot") {
      ci.cssClass = "pivot-column";
      ci.name = he.encode(pivotColumnDisplayName);
      ci.toolTip = he.encode(pivotColumnDisplayName);
      ci.formatter = groupCellFormatter;
    } else {
      var displayName = (cmd && cmd.displayName) || colId;
      ci.name = he.encode(displayName);
      ci.toolTip = he.encode(displayName);
      ci.sortable = true;
      const ff = getColumnFormatter(schema, colId);
      const cellClass = getColumnCssClassName(schema, colId);
      if (cellClass != null) {
        ci.cssClass = cellClass;
      }
      ci.formatter = (
        row: any,
        cell: any,
        value: any,
        columnDef: any,
        item: any
      ) => (ff as any)(value);
    }
    ci.width = colWidths[colId];
    slickColMap[colId] = ci;
  }
  return slickColMap;
};

interface NumericColumnHistogramProps {
  histData: NumericColumnHistogramData;
  colType: ColumnType;
  onHistogramBrushRange?: (
    colId: string,
    range: [number, number] | null
  ) => void;
  onHistogramBrushFilter?: (
    colId: string,
    range: [number, number] | null
  ) => void;
}

// gross hack to round to two decimal places:
function round(value: number, decimals: number): number {
  return Number(
    Math.round(Number(value.toString() + "e" + decimals.toString())) +
      "e-" +
      decimals
  );
}
const NumericColumnHistogram = ({
  colType,
  histData,
  onHistogramBrushRange,
  onHistogramBrushFilter,
}: NumericColumnHistogramProps) => {
  const {
    colId,
    binWidth,
    niceMinVal,
    niceMaxVal,
    binData,
    brushMinVal,
    brushMaxVal,
  } = histData;
  const chartData = binData.map((count: number, binIndex: number) => ({
    binMid: niceMinVal + (binIndex + 0.5) * binWidth,
    count,
  }));
  const fmtOpts = {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    useGrouping: true,
  };

  const handleBrush = (brushInfo: any) => {
    onHistogramBrushRange?.(colId, brushInfo.x);
  };
  const handleBrushEnd = (brushInfo: any) => {
    let [minVal, maxVal] = brushInfo.x;
    if (colType.kind === "integer") {
      minVal = Math.round(minVal);
      maxVal = Math.round(maxVal);
    } else {
      minVal = round(minVal, 2);
      maxVal = round(maxVal, 2);
    }
    onHistogramBrushFilter?.(colId, [minVal, maxVal]);
  };

  return (
    <VictoryChart
      padding={60}
      domain={{ x: [niceMinVal, niceMaxVal + binWidth * 2] }}
      containerComponent={
        <VictoryBrushContainer
          responsive={true}
          brushDimension="x"
          brushDomain={{ x: [brushMinVal, brushMaxVal] }}
          onBrushDomainChange={handleBrush}
          onBrushDomainChangeEnd={handleBrushEnd}
        />
      }
    >
      <VictoryAxis
        tickValues={[niceMinVal, niceMaxVal]}
        tickFormat={(tick: number) => tick.toLocaleString(undefined, fmtOpts)}
        style={{
          axis: { stroke: "none" },
          tickLabels: { fontSize: 40 },
        }}
      />
      <VictoryAxis
        dependentAxis
        tickCount={2}
        style={{
          axis: { stroke: "none" },
          tickLabels: { fontSize: 40 },
        }}
      />
      <VictoryBar
        style={{ data: { fill: "rgb(25, 118, 210)" } }}
        data={chartData}
        x="binMid"
        y="count"
      />
    </VictoryChart>
  );
};

const getGridOptions = ({ showColumnHistograms, histoMap }: DataGridProps) => {
  const histoCount = histoMap ? Object.keys(histoMap).length : 0;

  const showHeaderRow = showColumnHistograms && histoCount > 0;
  const gridOptions = {
    ...baseGridOptions,
    showHeaderRow,
  };
  return gridOptions;
};

// escape tabs by placing string in quotes
function escapeTabs(cellData: any): any {
  if (typeof cellData === "string" && cellData.indexOf("\t") >= 0) {
    return '"' + cellData.replace(/"/g, '""') + '"';
  }
  return cellData;
}

/* Create grid from the specified set of columns */
const createGrid = (
  containerId: string,
  columns: any,
  dataView: any,
  props: DataGridProps
) => {
  const {
    histoMap,
    onViewportChanged,
    onHistogramBrushRange,
    onHistogramBrushFilter,
    onSetSortKey,
    onGridClick,
    onGridSelectionChange,
    onSetColumnOrder,
    sortKey,
    clipboard,
    openURL,
    embedded,
  } = props;

  const gridOptions = getGridOptions(props);
  let grid = new Slick.Grid(`#${containerId}`, dataView, columns, gridOptions);
  (grid as any)._tadProps = props;
  if (Array.isArray(columns)) {
    columns.forEach((col: any) => {
      if (col) col._grid = grid;
    });
  }

  const selectionModel = new CellSelectionModel();
  grid.setSelectionModel(selectionModel);
  selectionModel.onSelectedRangesChanged.subscribe((e: any, args: any) => {
    if (!args || !args.length || !args[0]) {
      return;
    }
    const { fromCell, toCell, fromRow, toRow } = args[0];

    const gridCols = grid.getColumns();
    if (!gridCols || gridCols.length === 0) return;

    const selectedColumns = gridCols
      .slice(fromCell, toCell + 1)
      .map((col: any) => col?.id)
      .filter((cid: string) => cid && cid !== "_expand");

    let items = [];
    const gridData = grid.getData();
    if (!gridData) return;

    for (let row = fromRow; row <= toRow; row++) {
      const rowData = gridData.getItem(row);
      if (!rowData) continue;
      const selectedDataInRow = [];
      for (let col = fromCell; col <= toCell; col++) {
        const colDef = gridCols[col];
        if (!colDef) continue;
        const cid = colDef.id;
        if (cid === "_expand") continue;
        selectedDataInRow.push(rowData[cid]);
      }
      items.push(selectedDataInRow);
    }

    onGridSelectionChange?.(
      { row: fromRow, column: fromCell },
      { row: toRow, column: toCell },
      selectedColumns,
      items
    );
  });

  const copyManager = new CellCopyManager();
  grid.registerPlugin(copyManager);
  grid.registerPlugin(new AutoTooltips({ enableForCells: true }));

  const copySelectedRange = async (range: any) => {
    if (!range) return;
    let copyRowStrings: string[] = [];
    const gridCols = grid.getColumns();
    const gridData = grid.getData();
    if (!gridCols || !gridData) return;

    for (let row = range.fromRow; row <= range.toRow; row++) {
      const rowData = gridData.getItem(row);
      if (!rowData) continue;
      const copyRow = [];
      for (let col = range.fromCell; col <= range.toCell; col++) {
        const colDef = gridCols[col];
        if (!colDef) continue;
        const cid = colDef.id;
        if (cid === "_expand") continue;
        copyRow.push(escapeTabs(rowData[cid]));
      }
      copyRowStrings.push(copyRow.join("\t"));
    }
    const copyData = copyRowStrings.join("\r\n");
    clipboard.writeText(copyData);
  };

  copyManager.onCopyCells.subscribe(async (e: any, args: any) => {
    const range = args && args.ranges && args.ranges[0];
    if (range) {
      copySelectedRange(range);
    }
  });

  // gross hack, but makes copy menu item work in Electron:
  if (!embedded) {
    document.addEventListener("copy", function (e) {
      const sm = grid.getSelectionModel();
      if (!sm) return;
      const ranges = sm.getSelectedRanges();
      if (ranges && ranges.length > 0 && ranges[0]) {
        copySelectedRange(ranges[0]);
      }
    });
  }
  const rangeSelector = new CellRangeSelector();

  grid.registerPlugin(rangeSelector);

  const updateViewportDebounced = _.debounce(() => {
    const vp = grid.getViewport();
    if (vp) {
      onViewportChanged?.(vp.top, vp.bottom);
    }
  }, 100);

  grid.onViewportChanged.subscribe((e: any, args: any) => {
    updateViewportDebounced();
  });

  grid.onHeaderRowCellRendered.subscribe((e: any, { node, column }: any) => {
    console.log("onHeaderRowCellRendered: ", column);
    if (dataView && histoMap && column && column.id && histoMap[column.id]) {
      const histo = histoMap[column.id];
      const colType = dataView.schema.columnType(column.id);
      const root = ReactDOM.createRoot(node);
      root.render(
        <NumericColumnHistogram
          histData={histo}
          colType={colType}
          onHistogramBrushRange={onHistogramBrushRange}
          onHistogramBrushFilter={onHistogramBrushFilter}
        />
      );
      node.classList.add("slick-editable");
    } else {
      console.log("*** no histo for column: ", column?.id);
    }
  });

  grid.onHeaderCellRendered.subscribe((e: any, args: any) => {
    const { node, column } = args;
    if (!node || !column || column.sortable === false || column.id === "_expand") return;
    let btn: any = (node as any).querySelector(".toad-header-sort-btn");
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toad-header-sort-btn";
      btn.innerHTML = "&#8645;";
      btn.title = "Click to sort";
      node.appendChild(btn);
    }
    const sortCols = grid.getSortColumns() || [];
    const sc = sortCols.find((s: any) => s && s.columnId === column.id);
    if (sc) {
      btn.innerHTML = sc.sortAsc ? "▲" : "▼";
      btn.title = sc.sortAsc
        ? "Sorted Ascending (click to toggle)"
        : "Sorted Descending (click to toggle)";
      node.classList.add("slick-header-column-sorted");
    } else {
      btn.innerHTML = "&#8645;";
      btn.title = "Click to sort";
      node.classList.remove("slick-header-column-sorted");
    }
  });

  grid.onSort.subscribe((e: any, args: any) => {
    if (!args || !args.sortCols) return;
    const sortKey = args.sortCols
      .filter((sc: any) => sc && sc.sortCol && sc.sortCol.field)
      .map((sc: any) => [sc.sortCol.field, sc.sortAsc]);
    onSetSortKey?.(sortKey);
    setTimeout(() => {
      updateHeaderSortButtons(containerId, grid);
    }, 0);
  });

  // Intercept header clicks in capture phase: only sort if sort button was clicked!
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

  // Follow active row when Event Details sidebar is open, or immediately open when active cell is on _expand column
  grid.onActiveCellChanged.subscribe((e: any, args: any) => {
    if (!args || args.row === null || args.row === undefined) return;
    const curProps = (grid as any)._tadProps || props;
    const cols = grid.getColumns();
    const isExpandCol = cols && cols[args.cell]?.id === "_expand";
    const item = grid.getDataItem(args.row);
    if (!item || item._isLeaf === false) return;

    if (isExpandCol) {
      curProps.onExpandEvent?.(item, args.row, true);
      return;
    }

    if (
      curProps.expandedRowIndex !== null &&
      curProps.expandedRowIndex !== undefined
    ) {
      if (args.row !== curProps.expandedRowIndex) {
        curProps.onExpandEvent?.(item, args.row, true);
      }
    }
  });

  // Enter or Space key toggles / opens Event Details for active row
  grid.onKeyDown.subscribe((e: any, args: any) => {
    const curProps = (grid as any)._tadProps || props;
    if (
      e.key === "Enter" ||
      e.key === " " ||
      e.keyCode === 13 ||
      e.keyCode === 32
    ) {
      if (grid.getEditorLock().isActive()) return;
      const active = grid.getActiveCell();
      if (active && active.row !== null && active.row !== undefined) {
        const item = grid.getDataItem(active.row);
        if (item && item._isLeaf !== false) {
          curProps.onExpandEvent?.(item, active.row, true);
          e.preventDefault();
          e.stopPropagation();
        }
      }
    }
  });

  const handleGridClick = (e: any, args: any) => {
    const curProps = (grid as any)._tadProps || props;
    const columns = grid.getColumns();
    if (!columns || !columns[args.cell]) return;
    const col = columns[args.cell];
    var item = grid.getDataItem(args.row);

    if (col && col.id === "_expand") {
      if (item && item._isLeaf !== false) {
        grid.setActiveCell(args.row, 0);
        grid.focus();
        curProps.onExpandEvent?.(item, args.row, true);
      }
      return;
    }

    // If Event Detail sidebar is currently open, clicking on any cell of another row switches details
    if (
      curProps.expandedRowIndex !== null &&
      curProps.expandedRowIndex !== undefined &&
      curProps.expandedRowIndex !== args.row
    ) {
      if (item && item._isLeaf !== false) {
        grid.setActiveCell(args.row, args.cell ?? 0);
      }
    }

    const cellVal = item && col ? item[col.id] : null;
    curProps.onGridClick?.(args.row, args.cell, item, col.id, cellVal);
  };

  grid.onClick.subscribe(handleGridClick);

  const handleGridContextMenu = (e: any) => {
    e.preventDefault();
    const cell = grid.getCellFromEvent(e);
    if (!cell) return;
    const curProps = (grid as any)._tadProps || props;
    const columns = grid.getColumns();
    const col = columns[cell.cell];
    if (
      !col ||
      col.id === "_expand" ||
      col.id === "_id" ||
      col.id === "_parentId"
    ) {
      return;
    }
    const item = grid.getDataItem(cell.row);
    if (!item) return;
    const cellVal = item[col.id];
    curProps.onCellContextMenu?.(e, cell.row, cell.cell, item, col.id, cellVal);
  };

  grid.onContextMenu.subscribe(handleGridContextMenu);

  grid.onColumnsReordered.subscribe((e: any, args: any) => {
    const cols = grid.getColumns();
    const displayColIds = cols
      .map((c: any) => c.field)
      .filter((cid: any) => cid[0] !== "_");
    onSetColumnOrder?.(displayColIds);
  });

  // load the first page
  grid.onViewportChanged.notify();

  setTimeout(() => {
    updateHeaderSortButtons(containerId, grid);
  }, 0);

  return grid;
};

const updateHeaderSortButtons = (containerId: string, grid: any) => {
  const container = document.getElementById(containerId);
  if (!container || !grid) return;
  const sortCols = grid.getSortColumns() || [];
  const sortMap = new Map<string, boolean>();
  for (const sc of sortCols) {
    if (sc && sc.columnId) {
      sortMap.set(sc.columnId, sc.sortAsc);
    }
  }
  const cols = grid.getColumns() || [];

  const headerElems = container.querySelectorAll<HTMLElement>(
    ".slick-header-column"
  );
  headerElems.forEach((elem) => {
    const colData =
      (elem as any)._columnData ||
      cols.find((c: any) => elem.id && elem.id.endsWith(c.id));
    if (!colData || colData.sortable === false || colData.id === "_expand") {
      return;
    }
    const colId = colData.id;

    let btn: any = elem.querySelector(".toad-header-sort-btn");
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toad-header-sort-btn";
      btn.innerHTML = "&#8645;";
      btn.title = "Click to sort";
      elem.appendChild(btn);
    }

    if (sortMap.has(colId)) {
      const isAsc = sortMap.get(colId);
      btn.innerHTML = isAsc ? "▲" : "▼";
      btn.title = isAsc
        ? "Sorted Ascending (click to toggle)"
        : "Sorted Descending (click to toggle)";
      elem.classList.add("slick-header-column-sorted");
    } else {
      btn.innerHTML = "&#8645;";
      btn.title = "Click to sort";
      elem.classList.remove("slick-header-column-sorted");
    }
  });
};

interface GridState {
  grid: any;
  colWidthsMap: ColWidthMap | null;
  slickColMap: any;
  containerId: string;
}

const updateColWidth = (
  gs: GridState,
  getColumnFormatter: (schema: reltab.Schema, cid: string) => CellFormatter,
  dataView: PagedDataView,
  colId: string
) => {
  const colWidth = getColWidth(getColumnFormatter, dataView, colId);
  gs.colWidthsMap![colId] = colWidth;
  gs.slickColMap[colId].width = colWidth;
};

// Get grid columns based on current column visibility settings:
const getGridCols = (
  gs: GridState,
  isPivoted: boolean,
  showHiddenColumns: boolean,
  getColumnFormatter: (schema: reltab.Schema, cid: string) => CellFormatter,
  dataView: PagedDataView,
  displayColumns: string[]
) => {
  const missingCols = displayColumns.filter((cid) => !gs.slickColMap[cid]);
  if (missingCols.length > 0) {
    console.warn(
      `[DataGrid] Warning: ${missingCols.length} columns in displayColumns are missing from dataView schema:`,
      missingCols
    );
  }
  let gridCols = displayColumns
    .map((cid) => gs.slickColMap[cid])
    .filter(Boolean);
  if (isPivoted) {
    updateColWidth(gs, getColumnFormatter, dataView!, "_pivot");
    let pivotCol = gs.slickColMap["_pivot"];
    gridCols.unshift(pivotCol);
  }
  if (showHiddenColumns) {
    const hiddenColIds = _.difference(
      _.keys(gs.slickColMap),
      gridCols.map((gc) => gc.field)
    );
    const hiddenCols = hiddenColIds
      .filter(
        (cid) =>
          cid !== "_expand" &&
          cid !== "_id" &&
          cid !== "_parentId" &&
          cid !== "_isOpen" &&
          cid !== "_isLeaf" &&
          cid !== "_depth"
      )
      .map((cid) => gs.slickColMap[cid]);
    gridCols = gridCols.concat(hiddenCols);
  }
  // Add _expand button column at the very beginning of the table
  const expandCol = gs.slickColMap["_expand"];
  if (expandCol) {
    gridCols.unshift(expandCol);
  }
  return gridCols;
};

/*
 * update grid from dataView
 */
const updateGrid = (gs: GridState, props: DataGridProps) => {
  const {
    dataView,
    getColumnFormatter,
    getColumnCssClassName,
    isPivoted,
    showHiddenColumns,
    displayColumns,
    pivotColumnDisplayName,
    sortKey,
  } = props;

  (gs.grid as any)._tadProps = props;
  gs.slickColMap = mkSlickColMap(
    dataView!.schema,
    getColumnFormatter,
    getColumnCssClassName,
    pivotColumnDisplayName ?? "",
    gs.colWidthsMap!,
    props.expandedRowIndex
  );
  const gridCols = getGridCols(
    gs,
    isPivoted!,
    showHiddenColumns,
    getColumnFormatter,
    dataView!,
    displayColumns
  );

  const grid = gs.grid;
  (grid as any)._tadProps = props;
  if (Array.isArray(gridCols)) {
    gridCols.forEach((col: any) => {
      if (col) col._grid = grid;
    });
  }

  const gridOptions = getGridOptions(props);
  // console.log("updateGrid: gridOptions: ", gridOptions);

  grid.setOptions(gridOptions);
  grid.setHeaderRowVisibility(gridOptions.showHeaderRow);
  grid.setColumns(gridCols);

  const prevDataView = (grid as any)._tadPrevDataView;
  const isSameDataView = prevDataView === dataView;
  (grid as any)._tadPrevDataView = dataView;

  // update sort columns:
  const vpSortKey = sortKey
    ? sortKey.map(([columnId, sortAsc]) => ({ columnId, sortAsc }))
    : [];
  grid.setSortColumns(vpSortKey);

  if (!isSameDataView) {
    grid.setData(dataView);
    grid.invalidateAllRows();
    grid.updateRowCount();
    grid.render();
    grid.resizeCanvas();
  } else {
    // Fast path (Toad v2.0.5): Data has not changed.
    // Only column order/layout was updated; avoid full row invalidation & DOM reconstruction!
    grid.render();
  }
  setTimeout(() => {
    updateHeaderSortButtons(gs.containerId, gs.grid);
  }, 0);
};

const createGridState = (
  containerId: string,
  props: DataGridProps
): GridState => {
  const {
    dataView,
    showColumnHistograms,
    histoMap,
    getColumnFormatter,
    getColumnCssClassName,
    pivotColumnDisplayName,
    showLoadingModal,
    clipboard,
    openURL,
    embedded,
    isPivoted,
    showHiddenColumns,
    displayColumns,
  } = props;

  if (!dataView || !dataView.schema) {
    return { grid: null, colWidthsMap: {}, slickColMap: {}, containerId };
  }

  const colWidthsMap = getInitialColWidthsMap(getColumnFormatter, dataView);
  const slickColMap = mkSlickColMap(
    dataView.schema,
    getColumnFormatter,
    getColumnCssClassName,
    pivotColumnDisplayName ?? "",
    colWidthsMap,
    props.expandedRowIndex
  );
  const gs = { grid: null, colWidthsMap, slickColMap, containerId };

  const gridCols = getGridCols(
    gs,
    isPivoted ?? false,
    showHiddenColumns,
    getColumnFormatter,
    dataView,
    displayColumns
  );
  gs.grid = createGrid(containerId, gridCols, dataView, props);
  return gs;
};

export interface DataGridProps {
  dataView: PagedDataView | null | undefined;
  showColumnHistograms?: boolean;
  histoMap?: reltab.ColumnHistogramMap;
  getColumnFormatter: (schema: reltab.Schema, cid: string) => CellFormatter;
  getColumnCssClassName: (schema: reltab.Schema, cid: string) => string | null;
  pivotColumnDisplayName?: string;
  isPivoted?: boolean;
  showHiddenColumns: boolean;
  displayColumns: string[];
  showLoadingModal: boolean;
  clipboard: SimpleClipboard;
  onViewportChanged?: (top: number, bottom: number) => void;
  onHistogramBrushRange?: (
    colId: string,
    range: [number, number] | null
  ) => void;
  onHistogramBrushFilter?: (
    colId: string,
    range: [number, number] | null
  ) => void;
  sortKey?: [string, boolean][];
  onSetSortKey?: (sortKey: [string, boolean][]) => void;
  onGridClick?: (
    row: number,
    column: number,
    dataRow: DataRow,
    columnId: string,
    cellVal: any
  ) => void;
  onGridSelectionChange?: (
    anchor: Cell,
    focus: Cell,
    columns: string[],
    items: any[][]
  ) => void;
  onSetColumnOrder?: (displayColumns: string[]) => void;
  onExpandEvent?: (dataRow: DataRow, rowIndex: number, forceOpen?: boolean) => void;
  expandedRowIndex?: number | null;
  onFilterIn?: (columnId: string, val: any) => void;
  onFilterOut?: (columnId: string, val: any) => void;
  onTimeBracket?: (columnId: string, val: any, minutes: number) => void;
  onOpenParseDialog?: (columnId: string) => void;
  onCellContextMenu?: (
    e: any,
    row: number,
    cell: number,
    item: any,
    columnId: string,
    cellVal: any
  ) => void;
  openURL: OpenURLFn;
  embedded: boolean;
}

export const DataGrid: React.FunctionComponent<DataGridProps> = (
  props: DataGridProps
) => {
  const {
    dataView,
    showColumnHistograms,
    histoMap,
    showLoadingModal,
    clipboard,
    openURL,
    embedded,
    displayColumns,
    sortKey,
    isPivoted,
    showHiddenColumns,
  } = props;
  const containerIdRef = useRef(genContainerId());
  const [gridState, setGridState] = useState<GridState | null>(null);

  const prevShowColumnHistograms = useRef(showColumnHistograms);
  const displayColumnsKey = displayColumns ? displayColumns.join(",") : "";
  const sortKeyStr = sortKey ? JSON.stringify(sortKey) : "";

  React.useLayoutEffect(() => {
    if (!dataView || !dataView.schema) {
      return;
    }
    let gs = gridState;
    // The extra check here for prevShowColumnHistograms is a workaround
    // for an apparent bug in SlickGrid where it doesn't seem to re-render
    // correctly when we dynamically change the showHeaderRow option on the grid.
    if (
      gs === null ||
      (prevShowColumnHistograms.current !== showColumnHistograms && histoMap)
    ) {
      // log.debug("RawGridPane: creating grid state");
      gs = createGridState(containerIdRef.current, props);
      if (gs && gs.grid) {
        gs.grid.resizeCanvas();
        setGridState(gs);
      }
      // log.debug("RawGridPane: done creating grid state");
      prevShowColumnHistograms.current = showColumnHistograms;
    }
    if (dataView != null && gs && gs.grid) {
      // log.debug("RawGridPane: updating grid");
      updateGrid(gs, props);
    } else {
      // log.debug("RawGridPane: no view change, skipping grid update");
    }
  }, [
    dataView,
    gridState,
    showColumnHistograms,
    displayColumns,
    displayColumnsKey,
    sortKeyStr,
    isPivoted,
    showHiddenColumns,
  ]);

  const prevExpandedRowIndexRef = React.useRef<number | null | undefined>(
    props.expandedRowIndex
  );

  React.useEffect(() => {
    if (gridState && gridState.grid) {
      (gridState.grid as any)._tadProps = props;
      const oldRow = prevExpandedRowIndexRef.current;
      const newRow = props.expandedRowIndex;
      prevExpandedRowIndexRef.current = newRow;

      if (oldRow !== null && oldRow !== undefined) {
        gridState.grid.invalidateRow(oldRow);
      }
      if (newRow !== null && newRow !== undefined) {
        gridState.grid.invalidateRow(newRow);
        gridState.grid.scrollRowIntoView(newRow, false);
      }
      gridState.grid.render();
    }
  }, [props.expandedRowIndex]);

  // Window keydown handler for ArrowUp and ArrowDown to navigate Event Details
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input, textarea, or contentEditable
      const target = e.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName ? target.tagName.toLowerCase() : "";
        if (
          tagName === "input" ||
          tagName === "textarea" ||
          target.isContentEditable
        ) {
          return;
        }
      }

      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        if (!gridState || !gridState.grid || !dataView) return;
        const totalRows = dataView.getLength();
        if (totalRows <= 0) return;

        const active = gridState.grid.getActiveCell();
        if (
          (!active || active.row === null || active.row === undefined) &&
          (props.expandedRowIndex === null || props.expandedRowIndex === undefined)
        ) {
          return;
        }

        const currentRow =
          active && active.row !== null && active.row !== undefined
            ? active.row
            : props.expandedRowIndex!;

        const currentCol =
          active && active.cell !== null && active.cell !== undefined
            ? active.cell
            : 0;

        let targetRow = currentRow;
        if (e.key === "ArrowUp") {
          targetRow = Math.max(0, currentRow - 1);
        } else if (e.key === "ArrowDown") {
          targetRow = Math.min(totalRows - 1, currentRow + 1);
        }

        if (targetRow !== currentRow) {
          e.preventDefault();
          e.stopPropagation();
          const targetItem = gridState.grid.getDataItem(targetRow);
          if (targetItem && targetItem._isLeaf !== false) {
            gridState.grid.setActiveCell(targetRow, currentCol);
            gridState.grid.scrollRowIntoView(targetRow, false);
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [props.expandedRowIndex, dataView, gridState, props.onExpandEvent]);

  const handleGridResize = () => {
    // TODO: debounce?
    if (gridState) {
      gridState.grid.resizeCanvas();
    }
  };

  const handleWindowResize = (e: any) => {
    // console.log("handleWindowResize: ", e);
    if (gridState) {
      /*
      const $container = $(container)
      console.log('$container: ', $container)
      const pvh = $.css($container[0], 'height', true)
      console.log('viewport height before resize:', pvh)
      */
      gridState.grid.resizeCanvas();
      /*
      console.log('viewport height after resize:', $.css($container[0], 'height', true))
      console.log('gridPane.handleWindowResize: done with resize and render')
      */
    }
  };

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    colId: string;
    val: any;
  } | null>(null);

  const handleCellContextMenu = (
    e: any,
    row: number,
    cell: number,
    item: any,
    columnId: string,
    cellVal: any
  ) => {
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      colId: columnId,
      val: cellVal,
    });
  };

  useEffect(() => {
    if (gridState?.grid) {
      gridState.grid._tadProps = {
        ...props,
        onCellContextMenu: handleCellContextMenu,
      };
    }
  });

  useEffect(() => {
    const handleCloseMenu = () => {
      setContextMenu(null);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    if (contextMenu) {
      window.addEventListener("click", handleCloseMenu);
      window.addEventListener("keydown", handleKeyDown);
      return () => {
        window.removeEventListener("click", handleCloseMenu);
        window.removeEventListener("keydown", handleKeyDown);
      };
    }
  }, [contextMenu]);

  const isTimestampCol = (colId: string): boolean => {
    if (!dataView?.schema) return false;
    try {
      const ct = dataView.schema.columnType(colId);
      return (
        ct.kind === "timestamp" ||
        ct.kind === "date" ||
        (typeof ct.sqlTypeName === "string" &&
          /time|date/i.test(ct.sqlTypeName))
      );
    } catch {
      return false;
    }
  };

  if (!dataView || !dataView.schema) {
    return (
      <div
        className="gridPaneOuter"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
        }}
      >
        <Spinner size={36} intent="primary" />
      </div>
    );
  }

  return (
    <div className="gridPaneOuter">
      <div className="gridPaneInner">
        <ResizeSensor onResize={handleGridResize}>
          <div
            id={containerIdRef.current}
            className="slickgrid-container full-height"
          />
        </ResizeSensor>
      </div>
      {contextMenu && (
        <div
          className="toad-grid-context-menu"
          style={{
            position: "fixed",
            left: Math.min(contextMenu.x, window.innerWidth - 240),
            top: Math.min(contextMenu.y, window.innerHeight - 260),
            zIndex: 99999,
            boxShadow: "0 6px 20px rgba(0, 0, 0, 0.28)",
            borderRadius: "4px",
            overflow: "hidden",
            background: "var(--md-sys-color-surface-container, #fff)",
            border: "1px solid var(--md-sys-color-outline-variant, rgba(0, 0, 0, 0.1))",
            minWidth: "210px",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <Menu className="bp4-elevation-3" style={{ background: "transparent" }}>
            <li
              className="bp4-menu-header"
              style={{
                padding: "6px 10px",
                fontSize: "11px",
                color: "var(--md-sys-color-on-surface-variant, #5c7080)",
                borderBottom: "1px solid var(--md-sys-color-outline-variant, #ebf1f5)",
                background: "var(--md-sys-color-surface-container-low, #f5f8fa)",
              }}
            >
              <h6
                className="bp4-heading"
                style={{
                  margin: 0,
                  fontSize: "11px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                <strong>{contextMenu.colId}</strong>:{" "}
                <span style={{ color: "var(--md-sys-color-on-surface, #182026)" }}>
                  {String(contextMenu.val ?? "NULL").slice(0, 26)}
                </span>
              </h6>
            </li>
            <MenuItem
              icon="filter"
              text="Filter for this value (=)"
              onClick={() => {
                props.onFilterIn?.(contextMenu.colId, contextMenu.val);
                setContextMenu(null);
              }}
            />
            <MenuItem
              icon="filter-remove"
              text="Exclude this value (<>)"
              onClick={() => {
                props.onFilterOut?.(contextMenu.colId, contextMenu.val);
                setContextMenu(null);
              }}
            />
            {isTimestampCol(contextMenu.colId) && (
              <>
                <MenuDivider />
                <MenuItem
                  icon="time"
                  text="Time bracket (±5 mins)"
                  onClick={() => {
                    props.onTimeBracket?.(
                      contextMenu.colId,
                      contextMenu.val,
                      5
                    );
                    setContextMenu(null);
                  }}
                />
                <MenuItem
                  icon="time"
                  text="Time bracket (±15 mins)"
                  onClick={() => {
                    props.onTimeBracket?.(
                      contextMenu.colId,
                      contextMenu.val,
                      15
                    );
                    setContextMenu(null);
                  }}
                />
                <MenuItem
                  icon="time"
                  text="Time bracket (±1 hour)"
                  onClick={() => {
                    props.onTimeBracket?.(
                      contextMenu.colId,
                      contextMenu.val,
                      60
                    );
                    setContextMenu(null);
                  }}
                />
              </>
            )}
            <MenuDivider />
            <MenuItem
              icon="derive-column"
              text={`Parse / Extract "${contextMenu.colId}"...`}
              onClick={() => {
                props.onOpenParseDialog?.(contextMenu.colId);
                setContextMenu(null);
              }}
            />
            <MenuItem
              icon="clipboard"
              text="Copy cell value"
              onClick={() => {
                const copyText =
                  contextMenu.val == null ? "" : String(contextMenu.val);
                if (navigator.clipboard) {
                  navigator.clipboard.writeText(copyText);
                } else {
                  clipboard?.writeText(copyText);
                }
                setContextMenu(null);
              }}
            />
          </Menu>
        </div>
      )}
    </div>
  );
};
