import * as React from "react";
import * as reltab from "reltab";
import * as actions from "../actions";
import { FilterEditor } from "./FilterEditor";
import { AppState } from "../AppState";
import { StateRef } from "oneref";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { getDefaultDialect } from "reltab";
import { Button } from "@blueprintjs/core";
import { ParseSplitIcon } from "./icons/ParseSplitIcon";

export interface FooterControl {
  isExpanded: () => boolean;
  addRuleFromDetail: (colId: string, val: any) => void;
  toggleExpanded: () => void;
  setExpanded: (expanded: boolean) => void;
}

export interface FooterProps {
  appState: AppState;
  stateRef: StateRef<AppState>;
  onFilter?: (filterExp: reltab.FilterExp) => void;
  rightFooterSlot?: JSX.Element;
  registerFooterControl?: (ctrl: FooterControl) => void;
}

export const Footer: React.FunctionComponent<FooterProps> = (
  props: FooterProps
) => {
  const {
    appState,
    stateRef,
    rightFooterSlot = undefined,
    onFilter,
    registerFooterControl,
  } = props;
  const [expanded, setExpanded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [footerHeight, setFooterHeight] = useState<number>(200);
  const [isResizing, setIsResizing] = useState(false);
  const [liveUpdate, setLiveUpdate] = useState(false);

  const viewState = appState.viewState;
  const currentAppFE = viewState?.viewParams?.filterExp || new reltab.FilterExp();

  const [appliedFE, setAppliedFE] = useState<reltab.FilterExp>(currentAppFE);
  const [activeFE, setActiveFE] = useState<reltab.FilterExp>(currentAppFE);

  // Keep appliedFE and activeFE in sync with appState whenever currentAppFE changes
  useEffect(() => {
    setAppliedFE(currentAppFE);
    setActiveFE(currentAppFE);
    setDirty(false);
  }, [currentAppFE]);

  const dragStartY = useRef(0);
  const startHeight = useRef(200);

  const handleFilterButtonClicked = (event: any) => {
    event.preventDefault();
    const nextState = !expanded;
    if (nextState) {
      setAppliedFE(currentAppFE);
      setActiveFE(currentAppFE);
      setDirty(false);
    }
    setExpanded(nextState);
  };

  const handleFilterCancel = () => {
    const fe = appliedFE || new reltab.FilterExp();
    if (liveUpdate) {
      actions.setFilter(fe, stateRef);
      onFilter?.(fe);
    }
    setActiveFE(fe);
    setExpanded(false);
    setDirty(false);
  };

  const handleFilterApply = (fe: reltab.FilterExp) => {
    actions.setFilter(fe, stateRef);
    setAppliedFE(fe);
    setActiveFE(fe);
    setDirty(false);
    onFilter?.(fe);
  };

  const handleFilterDone = () => {
    setExpanded(false);
    setDirty(false);
  };

  // Module 1 Query change (from visual tree or actions in FilterEditor)
  const handleQueryChange = (nextFE: reltab.FilterExp) => {
    setActiveFE(nextFE);
    setDirty(true);
    if (liveUpdate) {
      actions.setFilter(nextFE, stateRef);
      setAppliedFE(nextFE);
      onFilter?.(nextFE);
    }
  };

  // Module 2 Live Update toggle
  const handleToggleLiveUpdate = (checked: boolean) => {
    setLiveUpdate(checked);
    if (checked) {
      actions.setFilter(activeFE, stateRef);
      setAppliedFE(activeFE);
      onFilter?.(activeFE);
    }
  };

  // Add rule from Event Details when Filter is open
  const handleAddRuleFromDetail = useCallback(
    (colId: string, val: any) => {
      const current = activeFE || new reltab.FilterExp();
      const nextFE = actions.appendFilterRuleToExp(current, colId, val);
      setActiveFE(nextFE);
      setDirty(true);
      if (liveUpdate) {
        actions.setFilter(nextFE, stateRef);
        setAppliedFE(nextFE);
        onFilter?.(nextFE);
      }
    },
    [activeFE, liveUpdate, stateRef, onFilter]
  );

  useEffect(() => {
    if (registerFooterControl) {
      registerFooterControl({
        isExpanded: () => expanded,
        addRuleFromDetail: handleAddRuleFromDetail,
        toggleExpanded: () => {
          setExpanded((prev) => {
            const nextState = !prev;
            if (nextState) {
              setAppliedFE(currentAppFE);
              setActiveFE(currentAppFE);
              setDirty(false);
            }
            return nextState;
          });
        },
        setExpanded: (val: boolean) => {
          if (val) {
            setAppliedFE(currentAppFE);
            setActiveFE(currentAppFE);
            setDirty(false);
          }
          setExpanded(val);
        },
      });
    }
  }, [expanded, currentAppFE, handleAddRuleFromDetail, registerFooterControl]);

  // Drag resizer handlers
  const handleResizerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    dragStartY.current = e.clientY;
    startHeight.current = footerHeight;
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = dragStartY.current - e.clientY;
      const maxHeight = Math.max(300, window.innerHeight - 80);
      const nextHeight = Math.max(140, Math.min(maxHeight, startHeight.current + delta));
      setFooterHeight(nextHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("blur", handleMouseUp);
    document.addEventListener("mouseleave", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("blur", handleMouseUp);
      document.removeEventListener("mouseleave", handleMouseUp);
    };
  }, [isResizing]);

  const handleToggleMaximize = useCallback(() => {
    setFooterHeight((prev) => {
      const maxHeight = Math.max(300, window.innerHeight - 100);
      return prev >= 450 ? 200 : Math.min(550, maxHeight);
    });
  }, []);

  const filterStr = useMemo(() => {
    try {
      return activeFE.toSqlWhere(getDefaultDialect());
    } catch {
      return "";
    }
  }, [activeFE]);

  const expandClass = expanded ? "footer-expanded" : "footer-collapsed";
  const resizingClass = isResizing ? " is-resizing" : "";

  const editorComponent = expanded ? (
    <FilterEditor
      appState={appState}
      stateRef={stateRef}
      schema={viewState.baseSchema}
      filterExp={activeFE}
      liveUpdate={liveUpdate}
      onToggleLiveUpdate={handleToggleLiveUpdate}
      onQueryChange={handleQueryChange}
      onCancel={handleFilterCancel}
      onApply={handleFilterApply}
      onDone={handleFilterDone}
    />
  ) : null;

  const vs = appState.viewState;
  const currentPage = vs?.currentPage || 1;
  const pageSize = vs?.pageSize || 1000;
  const [inputPage, setInputPage] = useState<string>(String(currentPage));

  useEffect(() => {
    setInputPage(String(currentPage));
  }, [currentPage]);

  let pagerBlock = null;
  let rowCountBlock = null;
  const queryView = appState.viewState?.queryView;
  if (queryView) {
    const numFmt = (num: number) =>
      num.toLocaleString(undefined, { useGrouping: true });

    const { rowCount, baseRowCount, filterRowCount } = queryView;
    const totalPages = Math.max(1, Math.ceil(rowCount / pageSize));

    const pageStartRow = rowCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const pageEndRow = Math.min(rowCount, currentPage * pageSize);

    const handlePageSubmit = (valStr: string) => {
      let p = parseInt(valStr, 10);
      if (isNaN(p) || p < 1) p = 1;
      if (p > totalPages) p = totalPages;
      setInputPage(String(p));
      actions.setPage(p, stateRef);
    };

    const handlePageSizeChange = (valStr: string) => {
      const p = parseInt(valStr, 10);
      if (!isNaN(p) && p > 0) {
        actions.setPageSize(p, stateRef);
      }
    };

    pagerBlock = (
      <div className="footer-pagination-block">
        <Button
          className="bp4-minimal pager-btn"
          icon="double-chevron-left"
          title="First Page (Page 1)"
          disabled={currentPage <= 1}
          onClick={() => actions.setPage(1, stateRef)}
        />
        <Button
          className="bp4-minimal pager-btn"
          icon="chevron-left"
          title="Previous Page"
          disabled={currentPage <= 1}
          onClick={() => actions.setPage(Math.max(1, currentPage - 1), stateRef)}
        />
        <span className="pager-label">Page</span>
        <input
          type="number"
          className="bp4-input pager-input"
          min={1}
          max={totalPages}
          value={inputPage}
          onChange={(e) => setInputPage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handlePageSubmit(inputPage);
            }
          }}
          onBlur={() => handlePageSubmit(inputPage)}
        />
        <span className="pager-label">of {numFmt(totalPages)}</span>
        <Button
          className="bp4-minimal pager-btn"
          icon="chevron-right"
          title="Next Page"
          disabled={currentPage >= totalPages}
          onClick={() => actions.setPage(Math.min(totalPages, currentPage + 1), stateRef)}
        />
        <Button
          className="bp4-minimal pager-btn"
          icon="double-chevron-right"
          title={`Last Page (Page ${totalPages})`}
          disabled={currentPage >= totalPages}
          onClick={() => actions.setPage(totalPages, stateRef)}
        />
      </div>
    );

    const rowCountStr = numFmt(rowCount);
    const rcParts = [];
    if (rowCount > 0) {
      rcParts.push(`Showing ${numFmt(pageStartRow)} - ${numFmt(pageEndRow)} of `);
    }
    rcParts.push(rowCountStr);
    if (rowCount !== baseRowCount) {
      rcParts.push(" (");
      if (filterRowCount !== baseRowCount && filterRowCount !== rowCount) {
        const filterCountStr = numFmt(filterRowCount);
        rcParts.push(filterCountStr);
        rcParts.push(" Filtered, ");
      }
      rcParts.push(numFmt(baseRowCount));
      rcParts.push(" Total)");
    }
    const rcStr = rcParts.join("");
    const standardPageSizes = [500, 1000, 2500, 5000, 10000];
    const isCustomPageSize = !standardPageSizes.includes(pageSize);

    rowCountBlock = (
      <div className="footer-block footer-row-count-block">
        <span className="footer-value">
          {rcStr} Row{rowCount === 1 ? "" : "s"}
        </span>
        <div className="footer-pagesize-wrapper" title="Number of rows loaded per page">
          <label className="footer-pagesize-label">Rows/page:</label>
          <select
            className="footer-pagesize-select"
            value={pageSize}
            onChange={(e) => handlePageSizeChange(e.target.value)}
          >
            <option value={500}>500</option>
            <option value={1000}>1,000</option>
            <option value={2500}>2,500</option>
            <option value={5000}>5,000</option>
            <option value={10000}>10,000</option>
            {isCustomPageSize && (
              <option value={pageSize}>{numFmt(pageSize)} (Custom)</option>
            )}
          </select>
        </div>
      </div>
    );
  }

  return (
    <div
      className={"footer " + expandClass + resizingClass}
      style={expanded ? { height: `${footerHeight}px` } : undefined}
    >
      {expanded && (
        <div
          className="footer-resizer-bar"
          onMouseDown={handleResizerMouseDown}
          onDoubleClick={handleToggleMaximize}
          title="Drag up/down to resize filter panel (Double-click to toggle maximize)"
        >
          <div className="footer-resizer-pill" />
        </div>
      )}
      <div className="footer-top-row">
        <div className="footer-filter-block">
          <Button
            className="bp4-minimal filter-toggle-btn"
            icon={expanded ? "chevron-down" : "chevron-up"}
            text="Filter"
            onClick={(event: any) => handleFilterButtonClicked(event)}
          />
          <Button
            className="bp4-minimal parse-toggle-btn regex-toggle-btn"
            icon={<ParseSplitIcon size={14} />}
            text="Parse"
            title="Parse & Extract structured columns from semi-structured text (Key-Value, JSON, CSV, Regex)"
            onClick={() => actions.setParseDialogOpen(true, stateRef)}
          />
          {expanded && (
            <Button
              className="bp4-minimal filter-size-toggle-btn"
              icon={footerHeight >= 450 ? "minimize" : "maximize"}
              title={
                footerHeight >= 450
                  ? "Restore compact size"
                  : "Maximize filter panel"
              }
              onClick={handleToggleMaximize}
            />
          )}
          <span className="filter-summary" title={filterStr || undefined}>
            {filterStr ? filterStr : " (no active filter)"}
          </span>
        </div>
        <div className="footer-right-block">
          {pagerBlock}
          {rowCountBlock}
          {rightFooterSlot}
        </div>
      </div>
      {editorComponent}
    </div>
  );
};
