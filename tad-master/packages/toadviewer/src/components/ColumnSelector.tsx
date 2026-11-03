import * as React from "react";
import { useState, useEffect, useCallback, useMemo } from "react";
import * as actions from "../actions";
import { IndeterminateCheckbox } from "./IndeterminateCheckbox";
import { ViewParams } from "../ViewParams";
import * as reltab from "reltab";
import { StateRef } from "oneref";
import { AppState } from "../AppState";

export interface ColumnSelectorProps {
  schema: reltab.Schema;
  viewParams: ViewParams;
  onColumnClick?: (cid: string) => void;
  stateRef: StateRef<AppState>;
  resetSignal?: any;
}

const shortenTypeName = (tn: string): string => {
  return tn === "integer" ? "int" : tn;
};

export const ColumnSelector: React.FC<ColumnSelectorProps> = ({
  schema,
  viewParams,
  onColumnClick,
  stateRef,
  resetSignal,
}) => {
  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");
  const [sortAlphabetical, setSortAlphabetical] = useState<boolean>(false);

  // Realtime mode toggle: if true, all column actions apply immediately to the table
  const [isRealtime, setIsRealtime] = useState<boolean>(false);

  // Search & jump to column state (jump & select, NOT filter)
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedTargetCol, setSelectedTargetCol] = useState<string | null>(null);
  const [currentMatchIdx, setCurrentMatchIdx] = useState<number>(0);

  // Staged / Draft state: not synced with main table until Play is clicked (when !isRealtime)
  const [stagedDisplayColumns, setStagedDisplayColumns] = useState<string[]>(
    viewParams.displayColumns
  );
  const [stagedVpivots, setStagedVpivots] = useState<string[]>(
    viewParams.vpivots
  );
  const [stagedSortKey, setStagedSortKey] = useState<[string, boolean][]>(
    viewParams.sortKey
  );
  const [stagedTopCols, setStagedTopCols] = useState<string[]>([]);
  const [isDirty, setIsDirty] = useState<boolean>(false);

  // Synchronize column list with table:
  // 1. Get all columns displayed in the main table in exact visual order
  const columnIds = useMemo(() => {
    const allKnownSet = new Set<string>();
    const ids: string[] = [];
    for (const cid of viewParams.displayColumns) {
      if (!allKnownSet.has(cid)) {
        allKnownSet.add(cid);
        ids.push(cid);
      }
    }
    for (const cid of schema.columns) {
      if (!allKnownSet.has(cid)) {
        allKnownSet.add(cid);
        ids.push(cid);
      }
    }
    if (sortAlphabetical) {
      ids.sort((cid1, cid2) =>
        schema.displayName(cid1).localeCompare(schema.displayName(cid2))
      );
    }
    return ids;
  }, [viewParams.displayColumns, schema, sortAlphabetical]);

  // Compute matching columns for search (Jump & Select, does NOT filter out columns)
  const matchingCols = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return columnIds.filter((cid) => {
      const dName = schema.displayName(cid).toLowerCase();
      return dName.includes(q) || cid.toLowerCase().includes(q);
    });
  }, [searchQuery, columnIds, schema]);

  const scrollToTarget = useCallback((cid: string) => {
    setSelectedTargetCol(cid);
    requestAnimationFrame(() => {
      const el = document.getElementById("col-row-" + cid);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
  }, []);

  useEffect(() => {
    if (matchingCols.length > 0) {
      const targetCid = matchingCols[0];
      setCurrentMatchIdx(0);
      scrollToTarget(targetCid);
    } else {
      setCurrentMatchIdx(0);
      if (searchQuery.trim()) {
        setSelectedTargetCol(null);
      }
    }
  }, [matchingCols, searchQuery, scrollToTarget]);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (matchingCols.length > 1) {
        const nextIdx = (currentMatchIdx + 1) % matchingCols.length;
        setCurrentMatchIdx(nextIdx);
        scrollToTarget(matchingCols[nextIdx]);
      }
    } else if (e.key === "Escape") {
      setSearchQuery("");
      setSelectedTargetCol(null);
    }
  };

  const handleClearSearch = () => {
    setSearchQuery("");
    setSelectedTargetCol(null);
  };

  // Revert staged state back to actual viewParams
  const handleRevert = useCallback(() => {
    setStagedDisplayColumns(viewParams.displayColumns);
    setStagedVpivots(viewParams.vpivots);
    setStagedSortKey(viewParams.sortKey);
    setStagedTopCols([]);
    setIsDirty(false);
  }, [viewParams.displayColumns, viewParams.vpivots, viewParams.sortKey]);

  // When viewParams or resetSignal (e.g. clicking another tab) changes, revert to table state
  useEffect(() => {
    if (!isRealtime) {
      handleRevert();
    } else {
      setStagedDisplayColumns(viewParams.displayColumns);
      setStagedVpivots(viewParams.vpivots);
      setStagedSortKey(viewParams.sortKey);
      setStagedTopCols([]);
      setIsDirty(false);
    }
  }, [
    viewParams.displayColumns,
    viewParams.vpivots,
    viewParams.sortKey,
    resetSignal,
    handleRevert,
    isRealtime,
  ]);

  const handleRowClick = (cid: string) => {
    if (editingColId === cid) return;
    setSelectedTargetCol(cid);
    if (onColumnClick) {
      onColumnClick(cid);
    }
  };

  const handleStartRename = (cid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingColId(cid);
    setEditingValue(schema.displayName(cid));
  };

  const handleCommitRename = (cid: string) => {
    const trimmed = editingValue.trim();
    setEditingColId(null);
    if (trimmed && trimmed !== schema.displayName(cid)) {
      actions.setColumnDisplayName(cid, trimmed, stateRef);
    }
  };

  // Toggle Realtime sync
  const handleToggleRealtime = () => {
    if (!isRealtime) {
      // Switching to Realtime ON: apply any pending staged changes
      if (isDirty) {
        handleApply();
      }
      setIsRealtime(true);
    } else {
      // Switching to Realtime OFF (Staged mode)
      setIsRealtime(false);
    }
  };

  // Toggle Show
  const handleToggleShown = (cid: string) => {
    if (isRealtime) {
      actions.toggleShown(cid, stateRef);
      return;
    }
    const next = stagedDisplayColumns.includes(cid)
      ? stagedDisplayColumns.filter((c) => c !== cid)
      : [...stagedDisplayColumns, cid];
    setStagedDisplayColumns(next);
    setIsDirty(true);
  };

  // Toggle Show All
  const handleToggleAllShown = () => {
    if (isRealtime) {
      actions.toggleAllShown(stateRef);
      return;
    }
    const allShown = schema.columns.length === stagedDisplayColumns.length;
    const next = allShown ? [] : [...schema.columns];
    setStagedDisplayColumns(next);
    setIsDirty(true);
  };

  // Toggle Pivot
  const handleTogglePivot = (cid: string) => {
    if (isRealtime) {
      actions.togglePivot(cid, stateRef);
      return;
    }
    const next = stagedVpivots.includes(cid)
      ? stagedVpivots.filter((c) => c !== cid)
      : [...stagedVpivots, cid];
    setStagedVpivots(next);
    setIsDirty(true);
  };

  // Toggle Sort
  const handleToggleSort = (cid: string) => {
    if (isRealtime) {
      actions.toggleSort(cid, stateRef);
      return;
    }
    const idx = stagedSortKey.findIndex((entry) => entry[0] === cid);
    let next: [string, boolean][];
    if (idx !== -1) {
      next = stagedSortKey.filter((entry) => entry[0] !== cid);
    } else {
      next = [...stagedSortKey, [cid, true]];
    }
    setStagedSortKey(next);
    setIsDirty(true);
  };

  // Toggle Push to Top for a column
  const handleToggleTop = (cid: string) => {
    if (isRealtime) {
      // In realtime mode, immediately push cid to index 0 of displayColumns
      const nextDisplay = [
        cid,
        ...viewParams.displayColumns.filter((c) => c !== cid),
      ];
      actions.applyColumnsChanges(
        nextDisplay,
        viewParams.vpivots,
        viewParams.sortKey,
        stateRef
      );
      return;
    }

    // Staged mode: queue in stagedTopCols in selection order
    const existingIdx = stagedTopCols.indexOf(cid);
    let nextTopCols: string[];
    if (existingIdx !== -1) {
      nextTopCols = stagedTopCols.filter((c) => c !== cid);
    } else {
      nextTopCols = [...stagedTopCols, cid];
    }
    setStagedTopCols(nextTopCols);

    const isColumnsOrderModified = nextTopCols.length > 0;
    const isDisplayModified =
      JSON.stringify(stagedDisplayColumns) !==
      JSON.stringify(viewParams.displayColumns);
    const isPivotModified =
      JSON.stringify(stagedVpivots) !== JSON.stringify(viewParams.vpivots);
    const isSortModified =
      JSON.stringify(stagedSortKey) !== JSON.stringify(viewParams.sortKey);

    setIsDirty(
      isColumnsOrderModified ||
        isDisplayModified ||
        isPivotModified ||
        isSortModified
    );
  };

  // Commit all staged changes to the main table when Play icon is clicked
  const handleApply = () => {
    let finalDisplay = stagedDisplayColumns;
    if (stagedTopCols.length > 0) {
      // Remaining columns: all columns currently in stagedDisplayColumns that are not in stagedTopCols
      const remainingCols = stagedDisplayColumns.filter(
        (c) => !stagedTopCols.includes(c)
      );
      // Push stagedTopCols to the very beginning in exact selection order
      finalDisplay = [...stagedTopCols, ...remainingCols];
    }
    actions.applyColumnsChanges(
      finalDisplay,
      stagedVpivots,
      stagedSortKey,
      stateRef
    );
    setStagedDisplayColumns(finalDisplay);
    setStagedTopCols([]);
    setIsDirty(false);
  };

  const renderColumnRow = (cid: string) => {
    const displayName = schema.displayName(cid);
    let colTypeName = "val";
    try {
      colTypeName = shortenTypeName(schema.columnType(cid).sqlTypeName);
    } catch {
      colTypeName = "val";
    }

    const isShown = isRealtime
      ? viewParams.displayColumns.includes(cid)
      : stagedDisplayColumns.includes(cid);
    const isPivot = isRealtime
      ? viewParams.vpivots.includes(cid)
      : stagedVpivots.includes(cid);
    const isSort = isRealtime
      ? viewParams.sortKey.findIndex((entry) => entry[0] === cid) !== -1
      : stagedSortKey.findIndex((entry) => entry[0] === cid) !== -1;

    const isEditing = editingColId === cid;
    const topIndex = stagedTopCols.indexOf(cid);
    const isTop = !isRealtime && topIndex !== -1;
    const topRank = isTop ? topIndex + 1 : null;
    const isTarget = selectedTargetCol === cid;

    const rowClasses = [
      isTop ? "row-staged-top" : "",
      isTarget ? "is-search-target" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <tr
        key={cid}
        id={"col-row-" + cid}
        className={rowClasses || undefined}
      >
        <td
          className="col-colName"
          onClick={() => handleRowClick(cid)}
          style={{ position: "relative" }}
        >
          {isEditing ? (
            <input
              className="bp4-input bp4-small col-rename-input"
              autoFocus
              value={editingValue}
              onChange={(e) => setEditingValue(e.target.value)}
              onBlur={() => handleCommitRename(cid)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleCommitRename(cid);
                } else if (e.key === "Escape") {
                  setEditingColId(null);
                }
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              title="Double-click to rename column"
              onDoubleClick={(e) => handleStartRename(cid, e)}
              style={{
                cursor: "pointer",
                userSelect: "none",
                display: "inline-block",
                width: "100%",
              }}
            >
              {displayName}
            </span>
          )}
        </td>
        <td className="col-colType">{colTypeName}</td>
        <td className="col-top">
          <button
            type="button"
            className={`colSel-top-btn ${isTop ? "is-active" : ""}`}
            title={
              isRealtime
                ? `Push '${displayName}' to top immediately (Realtime)`
                : isTop
                ? `Column '${displayName}' is queued as #${topRank} to push to top. Click to remove.`
                : `Queue '${displayName}' to push to top in selection order (Applied on Play)`
            }
            onClick={(e) => {
              e.stopPropagation();
              handleToggleTop(cid);
            }}
          >
            <span className="bp4-icon bp4-icon-arrow-up" />
            {isTop && <span className="top-badge-rank">{topRank}</span>}
          </button>
        </td>
        <td className="col-check">
          <input
            className="colSel-check"
            type="checkbox"
            title={isRealtime ? "Show column" : "Show column (Applied on Play)"}
            onChange={() => handleToggleShown(cid)}
            checked={isShown}
          />
        </td>
        <td className="col-check">
          <input
            className="colSel-check"
            type="checkbox"
            title={isRealtime ? "Pivot by column" : "Pivot by column (Applied on Play)"}
            onChange={() => handleTogglePivot(cid)}
            checked={isPivot}
          />
        </td>
        <td className="col-check">
          <input
            className="colSel-check"
            type="checkbox"
            title={isRealtime ? "Sort by column" : "Sort by column (Applied on Play)"}
            onChange={() => handleToggleSort(cid)}
            checked={isSort}
          />
        </td>
      </tr>
    );
  };

  // render row with checkboxes to select / deselect all items:
  const renderAllRow = () => {
    const currentCols = isRealtime
      ? viewParams.displayColumns
      : stagedDisplayColumns;
    const allShown =
      columnIds.length > 0 &&
      columnIds.every((cid) => currentCols.includes(cid));
    const someShown =
      currentCols.length > 0 && !allShown;

    return (
      <tr className="all-row">
        <td
          className="col-colName-all"
          title="Click to toggle sorting order (Table Order / Alphabetical A-Z)"
          onClick={() => setSortAlphabetical(!sortAlphabetical)}
          style={{ cursor: "pointer" }}
        >
          All Columns{" "}
          <span
            style={{
              fontSize: "10px",
              color: "#8a9ba8",
              fontWeight: "normal",
              marginLeft: "4px",
            }}
          >
            {sortAlphabetical ? "(A-Z)" : "(Table Order)"}
          </span>
        </td>
        <td className="col-colType" />
        <td className="col-top" />
        <td className="col-check">
          <IndeterminateCheckbox
            className="colSel-check"
            type="checkbox"
            title={isRealtime ? "Show all columns" : "Show all columns (Applied on Play)"}
            onChange={() => handleToggleAllShown()}
            checked={allShown}
            indeterminate={someShown}
          />
        </td>
        <td className="col-check" />
        <td className="col-check" />
      </tr>
    );
  };

  const allRow = renderAllRow();
  const columnRows = columnIds.map((cid) => renderColumnRow(cid));

  return (
    <div className="column-selector-wrapper">
      <div className="column-selector-toolbar">
        <div className="col-search-wrapper">
          <span className="bp4-icon bp4-icon-search col-search-icon" />
          <input
            type="text"
            className="col-search-input"
            placeholder="Jump to column (Enter ↵)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            title="Search column name and jump to select (does not filter list)"
          />
          {searchQuery.trim() && (
            <div className="col-search-actions">
              <span
                className={`col-search-count ${
                  matchingCols.length === 0 ? "none" : ""
                }`}
                title={
                  matchingCols.length > 0
                    ? `Match ${currentMatchIdx + 1} of ${matchingCols.length} (Press Enter for next)`
                    : "No matching column found"
                }
              >
                {matchingCols.length > 0
                  ? `${currentMatchIdx + 1}/${matchingCols.length}`
                  : "0"}
              </span>
              <button
                type="button"
                className="col-search-clear-btn"
                onClick={handleClearSearch}
                title="Clear search"
              >
                ×
              </button>
            </div>
          )}
        </div>

        <div className="column-selector-toolbar-right">
          <button
            type="button"
            className={`col-btn-icon col-btn-realtime ${
              isRealtime ? "is-active" : ""
            }`}
            onClick={handleToggleRealtime}
            title={
              isRealtime
                ? "Realtime Sync: ON (All actions apply immediately). Click to switch to Staged mode."
                : "Realtime Sync: OFF (Staged mode, click Play to apply). Click to enable Realtime mode."
            }
          >
            <span className="bp4-icon bp4-icon-lightning" />
          </button>
          <button
            type="button"
            className="col-btn-icon col-btn-revert"
            disabled={!isDirty || isRealtime}
            onClick={handleRevert}
            title="Revert staged changes (Undo)"
          >
            <span className="bp4-icon bp4-icon-undo" />
          </button>
          <button
            type="button"
            className={`col-btn-icon col-btn-play ${
              isDirty && !isRealtime ? "is-dirty" : ""
            }`}
            disabled={!isDirty || isRealtime}
            onClick={handleApply}
            title="Apply staged changes to table (Play)"
          >
            <span className="bp4-icon bp4-icon-play" />
          </button>
        </div>
      </div>

      <div className="column-selector">
        <div className="column-selector-header">
          <table className="table table-condensed bp4-interactive column-selector-table">
            <thead>
              <tr>
                <th
                  className="column-selector-th col-colName"
                  title="Click to toggle order: Table Order or Alphabetical A-Z"
                  onClick={() => setSortAlphabetical(!sortAlphabetical)}
                  style={{ cursor: "pointer" }}
                >
                  Column {sortAlphabetical ? "▲" : "▼"}
                </th>
                <th className="column-selector-th col-colType" />
                <th
                  className="column-selector-th col-top"
                  title={
                    isRealtime
                      ? "Push to Top immediately"
                      : "Push to Top in selection order (Applied on Play)"
                  }
                >
                  Top
                </th>
                <th className="column-selector-th col-check">Show</th>
                <th className="column-selector-th col-check">Pivot</th>
                <th className="column-selector-th col-check">Sort</th>
              </tr>
            </thead>
            <tbody>{allRow}</tbody>
          </table>
        </div>
        <div className="column-selector-body">
          <table className="table table-condensed table-hover column-selector-table">
            <tbody>{columnRows}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
