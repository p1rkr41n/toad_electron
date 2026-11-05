import * as React from "react";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { DiscoveredLeafField, InferredDuckDbType } from "../types/NestedJsonContracts";
import {
  calculateLineCount,
  getHeightAndScrollState,
} from "../utils/CellLineCalculator";

export interface NestedFieldsTableProps {
  fields: DiscoveredLeafField[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onToggleField: (dotPath: string, enabled: boolean) => void;
  onToggleAll: (enabled: boolean) => void;
  onInvertSelection: () => void;
  onRenameField: (dotPath: string, newName: string) => void;
  onChangeType: (dotPath: string, newType: InferredDuckDbType) => void;
}

type SortColumn = "enabled" | "name" | "sample" | "type" | "fill";
export type ResizableNestedCol = "name" | "type" | "fill" | "sample";

export const MIN_NESTED_COL_WIDTH = 45;
export const DEFAULT_NESTED_COL_WIDTHS: Record<ResizableNestedCol, number> = {
  name: 190,
  type: 105,
  fill: 110,
  sample: 220,
};

const AVAILABLE_TYPES: InferredDuckDbType[] = [
  "VARCHAR",
  "BIGINT",
  "INTEGER",
  "DOUBLE",
  "BOOLEAN",
  "TIMESTAMP"
];

export const NestedFieldsTable: React.FC<NestedFieldsTableProps> = ({
  fields,
  searchQuery,
  onSearchChange,
  onToggleField,
  onToggleAll,
  onInvertSelection,
  onRenameField,
  onChangeType
}) => {
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");
  const [sortCol, setSortCol] = useState<SortColumn>("name");
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  // Column width state with >= 45px clamping
  const [colWidths, setColWidths] = useState<Record<ResizableNestedCol, number>>(
    DEFAULT_NESTED_COL_WIDTHS
  );
  const draggingRef = useRef<{
    col: ResizableNestedCol;
    startX: number;
    startWidth: number;
  } | null>(null);

  // Dynamic sample value cell expansion state
  const [expandedSamplePath, setExpandedSamplePath] = useState<string | null>(null);
  const tableContainerRef = useRef<HTMLDivElement | null>(null);

  // 4-Way Collapse Lifecycle: Click outside table container & Escape key
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        tableContainerRef.current &&
        !tableContainerRef.current.contains(e.target as Node)
      ) {
        setExpandedSamplePath(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setExpandedSamplePath(null);
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      if (typeof document !== "undefined") {
        document.removeEventListener("mousedown", handleOutsideClick);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("keydown", handleKeyDown);
      }
    };
  }, []);

  // Draggable Column Header Resizing with >= 45px minWidth clamping
  const handleResizeMouseDown = useCallback(
    (col: ResizableNestedCol, e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = colWidths[col];
      draggingRef.current = { col, startX, startWidth };

      if (typeof document !== "undefined") {
        document.body.classList.add("col-resizing");
      }

      const onMouseMove = (moveEvt: MouseEvent) => {
        if (!draggingRef.current) return;
        const rawDelta = moveEvt.clientX - draggingRef.current.startX;
        const delta = Number.isFinite(rawDelta) ? rawDelta : 0;
        const newWidth = Math.max(
          MIN_NESTED_COL_WIDTH,
          draggingRef.current.startWidth + delta
        );
        setColWidths((prev) => ({
          ...prev,
          [draggingRef.current!.col]: newWidth,
        }));
      };

      const cleanup = () => {
        draggingRef.current = null;
        if (typeof document !== "undefined") {
          document.body.classList.remove("col-resizing");
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", cleanup);
          document.removeEventListener("mouseleave", cleanup);
        }
        if (typeof window !== "undefined") {
          window.removeEventListener("blur", cleanup);
        }
      };

      if (typeof document !== "undefined") {
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", cleanup);
        document.addEventListener("mouseleave", cleanup);
      }
      if (typeof window !== "undefined") {
        window.addEventListener("blur", cleanup);
      }
    },
    [colWidths]
  );

  // Double-Click Header Auto-Fit
  const handleAutoFit = useCallback(
    (col: ResizableNestedCol, e?: React.MouseEvent) => {
      if (e) {
        e.stopPropagation();
        e.preventDefault();
      }
      let maxLen = 10;
      if (col === "name") {
        maxLen = "Column / Path".length;
        fields.forEach((f) => {
          const n = (f.customColName || f.dotPath || "").length;
          if (n > maxLen) maxLen = n;
        });
      } else if (col === "type") {
        maxLen = "VARCHAR".length;
      } else if (col === "fill") {
        maxLen = "Fill Rate".length;
      } else if (col === "sample") {
        maxLen = "Sample Value".length;
        fields.forEach((f) => {
          const s = (f.sampleValue || "").length;
          if (s > maxLen) maxLen = s;
        });
      }
      const computedWidth = Math.max(
        MIN_NESTED_COL_WIDTH,
        Math.min(600, Math.round(maxLen * 7.5 + 24))
      );
      setColWidths((prev) => ({
        ...prev,
        [col]: computedWidth,
      }));
    },
    [fields]
  );

  // Filter fields based on search query
  const filteredFields = useMemo(() => {
    if (!searchQuery || !searchQuery.trim()) {
      return fields;
    }
    const q = searchQuery.toLowerCase().trim();
    return fields.filter(
      (f) =>
        f.dotPath.toLowerCase().includes(q) ||
        (f.customColName && f.customColName.toLowerCase().includes(q)) ||
        (f.sampleValue && f.sampleValue.toLowerCase().includes(q)) ||
        f.inferredType.toLowerCase().includes(q)
    );
  }, [fields, searchQuery]);

  // Sort filtered fields
  const sortedFields = useMemo(() => {
    const list = [...filteredFields];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "enabled":
          cmp = (a.enabled === b.enabled ? 0 : a.enabled ? -1 : 1);
          break;
        case "name": {
          const nameA = a.customColName || a.dotPath;
          const nameB = b.customColName || b.dotPath;
          cmp = nameA.localeCompare(nameB);
          break;
        }
        case "sample":
          cmp = (a.sampleValue || "").localeCompare(b.sampleValue || "");
          break;
        case "type":
          cmp = a.inferredType.localeCompare(b.inferredType);
          break;
        case "fill":
          cmp = a.fillRate - b.fillRate;
          break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [filteredFields, sortCol, sortAsc]);

  const enabledCount = useMemo(() => {
    return fields.filter((f) => f.enabled).length;
  }, [fields]);

  const handleHeaderSort = (col: SortColumn) => {
    if (sortCol === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(col);
      setSortAsc(col === "fill" ? false : true);
    }
  };

  const handleStartRename = (field: DiscoveredLeafField) => {
    setEditingPath(field.dotPath);
    setEditingValue(field.customColName || field.dotPath);
  };

  const handleCommitRename = (dotPath: string) => {
    const cleanName = editingValue.trim();
    if (cleanName) {
      onRenameField(dotPath, cleanName);
    }
    setEditingPath(null);
  };

  const handleKeyDownRename = (e: React.KeyboardEvent, dotPath: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCommitRename(dotPath);
    } else if (e.key === "Escape") {
      setEditingPath(null);
    }
  };

  return (
    <div className="nested-fields-table-container" ref={tableContainerRef}>
      {/* Toolbar: Search input, bulk actions, selection summary */}
      <div className="nested-fields-toolbar">
        <div className="nested-search-group">
          <svg className="nested-search-icon" width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z" />
          </svg>
          <input
            type="text"
            id="nested-field-search"
            className="nested-search-input"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Filter fields, paths, values..."
            spellCheck={false}
          />
          {searchQuery && (
            <button
              type="button"
              className="nested-search-clear"
              onClick={() => onSearchChange("")}
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        <div className="nested-bulk-actions">
          <button
            type="button"
            className="bulk-btn"
            id="btn-select-all"
            onClick={() => onToggleAll(true)}
            title="Select all fields"
          >
            All
          </button>
          <button
            type="button"
            className="bulk-btn"
            id="btn-select-none"
            onClick={() => onToggleAll(false)}
            title="Deselect all fields"
          >
            None
          </button>
          <button
            type="button"
            className="bulk-btn"
            id="btn-invert-selection"
            onClick={onInvertSelection}
            title="Invert current field selection"
          >
            Invert
          </button>
          <span className="nested-selected-counter">
            Selected <strong>{enabledCount}</strong> of <strong>{fields.length}</strong>
          </span>
        </div>
      </div>

      {/* Main Table */}
      <div className="nested-table-scroll-wrap">
        <table className="nested-fields-table">
          <thead>
            <tr>
              <th
                className="col-check"
                onClick={() => handleHeaderSort("enabled")}
                title="Sort by selection"
                style={{ width: "32px", minWidth: "32px" }}
              >
                <input
                  type="checkbox"
                  checked={fields.length > 0 && enabledCount === fields.length}
                  onChange={(e) => onToggleAll(e.target.checked)}
                  title="Toggle all fields"
                  onClick={(e) => e.stopPropagation()}
                />
                {sortCol === "enabled" && (
                  <span className="sort-arrow">{sortAsc ? "▲" : "▼"}</span>
                )}
              </th>

              <th
                className="col-name"
                onClick={() => handleHeaderSort("name")}
                title="Click to sort by column name (drag edge to resize, double-click to auto-fit)"
                style={{
                  width: `${colWidths.name}px`,
                  minWidth: `${MIN_NESTED_COL_WIDTH}px`,
                  position: "relative",
                }}
              >
                <span>Column / Path</span>
                {sortCol === "name" && (
                  <span className="sort-arrow">{sortAsc ? "▲" : "▼"}</span>
                )}
                <div
                  className="col-resizer-handle"
                  title="Drag to resize, double-click to auto-fit"
                  onMouseDown={(e) => handleResizeMouseDown("name", e)}
                  onDoubleClick={(e) => handleAutoFit("name", e)}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                  style={{
                    position: "absolute",
                    right: 0,
                    top: 0,
                    bottom: 0,
                    width: "6px",
                    cursor: "col-resize",
                    zIndex: 5,
                    userSelect: "none",
                  }}
                />
              </th>

              <th
                className="col-type"
                onClick={() => handleHeaderSort("type")}
                title="Click to sort by data type (drag edge to resize, double-click to auto-fit)"
                style={{
                  width: `${colWidths.type}px`,
                  minWidth: `${MIN_NESTED_COL_WIDTH}px`,
                  position: "relative",
                }}
              >
                <span>Type</span>
                {sortCol === "type" && (
                  <span className="sort-arrow">{sortAsc ? "▲" : "▼"}</span>
                )}
                <div
                  className="col-resizer-handle"
                  title="Drag to resize, double-click to auto-fit"
                  onMouseDown={(e) => handleResizeMouseDown("type", e)}
                  onDoubleClick={(e) => handleAutoFit("type", e)}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                  style={{
                    position: "absolute",
                    right: 0,
                    top: 0,
                    bottom: 0,
                    width: "6px",
                    cursor: "col-resize",
                    zIndex: 5,
                    userSelect: "none",
                  }}
                />
              </th>

              <th
                className="col-fill"
                onClick={() => handleHeaderSort("fill")}
                title="Click to sort by occurrence fill rate (drag edge to resize, double-click to auto-fit)"
                style={{
                  width: `${colWidths.fill}px`,
                  minWidth: `${MIN_NESTED_COL_WIDTH}px`,
                  position: "relative",
                }}
              >
                <span>Fill Rate</span>
                {sortCol === "fill" && (
                  <span className="sort-arrow">{sortAsc ? "▲" : "▼"}</span>
                )}
                <div
                  className="col-resizer-handle"
                  title="Drag to resize, double-click to auto-fit"
                  onMouseDown={(e) => handleResizeMouseDown("fill", e)}
                  onDoubleClick={(e) => handleAutoFit("fill", e)}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                  style={{
                    position: "absolute",
                    right: 0,
                    top: 0,
                    bottom: 0,
                    width: "6px",
                    cursor: "col-resize",
                    zIndex: 5,
                    userSelect: "none",
                  }}
                />
              </th>

              <th
                className="col-sample"
                onClick={() => handleHeaderSort("sample")}
                title="Click to sort by sample value (drag edge to resize, double-click to auto-fit)"
                style={{
                  width: `${colWidths.sample}px`,
                  minWidth: `${MIN_NESTED_COL_WIDTH}px`,
                  position: "relative",
                }}
              >
                <span>Sample Value</span>
                {sortCol === "sample" && (
                  <span className="sort-arrow">{sortAsc ? "▲" : "▼"}</span>
                )}
                <div
                  className="col-resizer-handle"
                  title="Drag to resize, double-click to auto-fit"
                  onMouseDown={(e) => handleResizeMouseDown("sample", e)}
                  onDoubleClick={(e) => handleAutoFit("sample", e)}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                  style={{
                    position: "absolute",
                    right: 0,
                    top: 0,
                    bottom: 0,
                    width: "6px",
                    cursor: "col-resize",
                    zIndex: 5,
                    userSelect: "none",
                  }}
                />
              </th>
            </tr>
          </thead>

          <tbody>
            {sortedFields.length === 0 ? (
              <tr>
                <td colSpan={5} className="nested-empty-cell">
                  {fields.length === 0
                    ? "No nested JSON fields discovered in sample."
                    : `No fields match filter "${searchQuery}".`}
                </td>
              </tr>
            ) : (
              sortedFields.map((field) => {
                const isEditing = editingPath === field.dotPath;
                const fillPct = Math.round(field.fillRate * 100);
                const hasCustomName =
                  field.customColName && field.customColName !== field.dotPath;

                return (
                  <tr
                    key={field.dotPath}
                    className={`nested-row ${field.enabled ? "row-enabled" : "row-disabled"}`}
                  >
                    {/* Checkbox */}
                    <td className="col-check" style={{ width: "32px" }}>
                      <input
                        type="checkbox"
                        checked={field.enabled}
                        onChange={(e) => onToggleField(field.dotPath, e.target.checked)}
                        title={field.enabled ? "Field enabled for extraction" : "Field disabled"}
                      />
                    </td>

                    {/* Column Name / Dot Path */}
                    <td className="col-name" style={{ width: `${colWidths.name}px` }}>
                      {isEditing ? (
                        <input
                          type="text"
                          className="nested-inline-input"
                          value={editingValue}
                          autoFocus
                          onChange={(e) => setEditingValue(e.target.value)}
                          onBlur={() => handleCommitRename(field.dotPath)}
                          onKeyDown={(e) => handleKeyDownRename(e, field.dotPath)}
                        />
                      ) : (
                        <div
                          className="nested-name-display"
                          onClick={() => handleStartRename(field)}
                          title="Click to rename output column"
                        >
                          <span className="output-name">
                            {field.customColName || field.dotPath}
                          </span>
                          {hasCustomName && (
                            <span className="original-dotpath" title={`Original path: ${field.dotPath}`}>
                              {field.dotPath}
                            </span>
                          )}
                          <svg
                            className="rename-icon"
                            width="10"
                            height="10"
                            viewBox="0 0 16 16"
                            fill="currentColor"
                          >
                            <path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11l.178-.178z" />
                          </svg>
                        </div>
                      )}
                    </td>

                    {/* Inferred Type Dropdown */}
                    <td className="col-type" style={{ width: `${colWidths.type}px` }}>
                      <select
                        className="nested-type-select"
                        value={field.inferredType}
                        onChange={(e) =>
                          onChangeType(field.dotPath, e.target.value as InferredDuckDbType)
                        }
                        title="Inferred DuckDB type (click to change)"
                      >
                        {AVAILABLE_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Fill Rate */}
                    <td className="col-fill" style={{ width: `${colWidths.fill}px` }}>
                      <div className="fill-rate-cell">
                        <div className="fill-meter-track" title={`Fill rate: ${fillPct}%`}>
                          <div
                            className={`fill-meter-value ${
                              field.fillRate >= 0.8
                                ? "fill-high"
                                : field.fillRate >= 0.4
                                ? "fill-med"
                                : "fill-low"
                            }`}
                            style={{ width: `${fillPct}%` }}
                          />
                        </div>
                        <span className="fill-meter-text">{fillPct}%</span>
                      </div>
                    </td>

                    {/* Sample Value with Dynamic Line Expansion via CellLineCalculator */}
                    <td
                      className="col-sample"
                      style={{
                        width: `${colWidths.sample}px`,
                        minWidth: `${MIN_NESTED_COL_WIDTH}px`,
                        verticalAlign: "top",
                      }}
                    >
                      {(() => {
                        const isExpanded = expandedSamplePath === field.dotPath;
                        const rawText =
                          field.sampleValue !== "" ? field.sampleValue : "(null)";
                        const lineCount = calculateLineCount(
                          field.sampleValue,
                          colWidths.sample,
                          { padding: 12 }
                        );
                        const heightState = getHeightAndScrollState(
                          lineCount,
                          17,
                          8,
                          24
                        );

                        if (isExpanded && heightState.shouldExpand) {
                          return (
                            <div
                              className={`sample-val-text is-expanded ${
                                heightState.className || ""
                              }`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedSamplePath(null); // Toggle collapse (Direction 1)
                              }}
                              title="Click to collapse sample value"
                              style={{
                                height: `${heightState.height}px`,
                                maxHeight: `${heightState.height}px`,
                                overflowY: heightState.overflowY,
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-all",
                                cursor: "pointer",
                                lineHeight: "17px",
                                padding: "4px 6px",
                                boxSizing: "border-box",
                                display: "block",
                                borderRadius: "3px",
                                border: "1px solid var(--md-sys-color-primary, #0284c7)",
                                background:
                                  "var(--md-sys-color-surface-container-high, #f1f5f9)",
                                color: "var(--md-sys-color-on-surface, #0f172a)",
                                boxShadow: "0 2px 6px rgba(0, 0, 0, 0.12)",
                              }}
                            >
                              {rawText}
                            </div>
                          );
                        }

                        return (
                          <span
                            className={`sample-val-text ${
                              heightState.className || "cell-flat"
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              // Toggle or expand (Direction 2: switch cell)
                              setExpandedSamplePath(
                                isExpanded ? null : field.dotPath
                              );
                            }}
                            title={field.sampleValue || "(null / empty)"}
                            style={{
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              display: "block",
                              lineHeight: "17px",
                              boxSizing: "border-box",
                              borderRadius: "2px",
                              padding: "2px 4px",
                            }}
                          >
                            {rawText}
                          </span>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
