if (typeof BigInt !== "undefined" && !(BigInt.prototype as any).toJSON) {
  (BigInt.prototype as any).toJSON = function () {
    const num = Number(this);
    return Number.isSafeInteger(num) ? num : this.toString();
  };
}

import * as actions from "./actions";
import "./slickgrid.scss";
import "../less/tadviewer.less";
import "../less/activityBar.less";
import "../less/sidebar.less";
import "../less/columnSelector.less";
import "../less/columnList.less";
import "../less/singleColumnSelect.less";
import "../less/modal.less";
import "../less/footer.less";
import "../less/filterEditor.less";
import "../less/delayedCalcFooter.less";
import "../less/eventDetailSidebar.less";
import "../less/nested-dialog.less";

export { initAppState } from "./actions";
export * from "./AppState";
export * from "./components/AppPane";
export * from "./components/EventDetailSidebar";
export * from "./components/CellClickData";
export * from "./components/SelectionChangeData";
export * from "./components/TadViewerPane";
export * from "./components/SampleScanController";
export * from "./components/NestedFieldsTable";
export * from "./workers/SampleScanWorker";
export * from "./utils/NestedJsonTraverser";
export * from "./utils/DuckDbJsonSqlBuilder";
export * from "./types/NestedJsonContracts";
export * from "./PivotRequester";
export * from "./ViewParams";
export * from "./ViewState";
export * from "./utils/ForensicDecoder";
export * from "./toadTheme";
export * from "./MultipleLoadingManager";
export * from "./ProjectWorkspaceManager";
export { tableFromIPC, tableToIPC, Table as ArrowTable } from "@apache-arrow/es2015-cjs";
export { arrowIPCToTableRep, decodeTableRepBinary, encodeTableRepArrow, isArrowIPC } from "reltab";
export { actions };
