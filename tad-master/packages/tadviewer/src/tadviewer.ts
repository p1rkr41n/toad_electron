if (typeof BigInt !== "undefined" && !(BigInt.prototype as any).toJSON) {
  (BigInt.prototype as any).toJSON = function () {
    const num = Number(this);
    return Number.isSafeInteger(num) ? num : this.toString();
  };
}

import * as actions from "./actions";
require("./slickgrid.scss");
require("../less/tadviewer.less");

require("../less/activityBar.less");
require("../less/sidebar.less");

require("../less/columnSelector.less");

require("../less/columnList.less");

require("../less/singleColumnSelect.less");

require("../less/modal.less");

require("../less/footer.less");

require("../less/filterEditor.less");
require("../less/delayedCalcFooter.less");
require("../less/eventDetailSidebar.less");

export { initAppState } from "./actions";
export * from "./AppState";
export * from "./components/AppPane";
export * from "./components/EventDetailSidebar";
export * from "./components/CellClickData";
export * from "./components/SelectionChangeData";
export * from "./components/TadViewerPane";
export * from "./PivotRequester";
export * from "./ViewParams";
export * from "./ViewState";
export * from "./utils/ForensicDecoder";
export * from "./toadTheme";
export * from "./MultipleLoadingManager";
export { actions };
