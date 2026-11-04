import * as React from "react";
import { useState, useMemo } from "react";
import { DiscoveredLeafField, InferredDuckDbType } from "../types/NestedJsonContracts";

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
    <div className="nested-fields-table-container">
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
                title="Click to sort by column name"
              >
                <span>Column / Path</span>
                {sortCol === "name" && (
                  <span className="sort-arrow">{sortAsc ? "▲" : "▼"}</span>
                )}
              </th>

              <th
                className="col-type"
                onClick={() => handleHeaderSort("type")}
                title="Click to sort by data type"
              >
                <span>Type</span>
                {sortCol === "type" && (
                  <span className="sort-arrow">{sortAsc ? "▲" : "▼"}</span>
                )}
              </th>

              <th
                className="col-fill"
                onClick={() => handleHeaderSort("fill")}
                title="Click to sort by occurrence fill rate"
              >
                <span>Fill Rate</span>
                {sortCol === "fill" && (
                  <span className="sort-arrow">{sortAsc ? "▲" : "▼"}</span>
                )}
              </th>

              <th
                className="col-sample"
                onClick={() => handleHeaderSort("sample")}
                title="Click to sort by sample value"
              >
                <span>Sample Value</span>
                {sortCol === "sample" && (
                  <span className="sort-arrow">{sortAsc ? "▲" : "▼"}</span>
                )}
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
                    <td className="col-check">
                      <input
                        type="checkbox"
                        checked={field.enabled}
                        onChange={(e) => onToggleField(field.dotPath, e.target.checked)}
                        title={field.enabled ? "Field enabled for extraction" : "Field disabled"}
                      />
                    </td>

                    {/* Column Name / Dot Path */}
                    <td className="col-name">
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
                    <td className="col-type">
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
                    <td className="col-fill">
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

                    {/* Sample Value */}
                    <td className="col-sample">
                      <span
                        className="sample-val-text"
                        title={field.sampleValue || "(null / empty)"}
                      >
                        {field.sampleValue !== "" ? field.sampleValue : "(null)"}
                      </span>
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
