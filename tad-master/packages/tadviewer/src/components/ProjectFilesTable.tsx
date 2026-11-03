import * as React from "react";
import { useState, useMemo, useEffect, useReducer } from "react";
import { Icon, IconName, Tooltip, Position } from "@blueprintjs/core";
import { StateRef, mutableGet } from "oneref";
import { AppState } from "../AppState";
import { DataSourcePath } from "reltab";
import { ProjectWorkspaceFile } from "../ProjectWorkspaceManager";
import {
  MultipleLoadingManager,
  getCanonicalPathFromDSPath,
} from "../MultipleLoadingManager";

/**
 * Calculates the relative parent directory for a file:
 * - If folderRoot is provided and filePath is within folderRoot: calculates relative path from folderRoot.
 *   - Nested subdirs -> "logs/2026/"
 *   - Root files in folderRoot -> "./"
 * - If folderRoot is not provided or file is standalone:
 *   - 1 parent directory level -> "Security/"
 *   - Root drive files (e.g. "C:/sample.csv") -> "./"
 * - Normalizes Windows backslashes and case-insensitive paths.
 */
export function getRelativeParentDir(filePath: string, folderRoot?: string): string {
  if (!filePath) return "./";
  const normFile = filePath.replace(/\\/g, "/").replace(/\/+/g, "/");
  const lastSlashIdx = normFile.lastIndexOf("/");
  if (lastSlashIdx === -1) return "./";
  const fileDir = normFile.substring(0, lastSlashIdx);

  if (folderRoot) {
    const normRoot = folderRoot.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/+$/, "");
    if (fileDir.toLowerCase() === normRoot.toLowerCase()) {
      return "./";
    }
    if (fileDir.toLowerCase().startsWith(normRoot.toLowerCase() + "/")) {
      const rel = fileDir.substring(normRoot.length).replace(/^\/+/, "").replace(/\/+$/, "");
      return rel ? `${rel}/` : "./";
    }
  }

  // Standalone file: 1 direct parent directory level
  const parts = fileDir.split("/").filter(Boolean);
  if (parts.length === 0) return "./";
  const lastPart = parts[parts.length - 1];
  // Root drive on Windows (e.g. "C:")
  if (/^[a-zA-Z]:$/.test(lastPart)) {
    return "./";
  }
  return `${lastPart}/`;
}

export function formatFileBytes(b: number): string {
  if (b == null || isNaN(b) || b <= 0) return "0 B";
  if (b >= 1024 * 1024 * 1024) return (b / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(2) + " MB";
  if (b >= 1024) return (b / 1024).toFixed(1) + " KB";
  return b + " B";
}

export const getFileFormatIcon = (fileName: string): React.ReactElement => {
  const ext = (fileName.split(".").pop() || "").toLowerCase();
  let color = "#94a3b8";
  let iconName: IconName = "document";
  if (ext === "csv" || ext === "tsv") {
    color = "#22c55e"; // Emerald green
    iconName = "th";
  } else if (ext === "json" || ext === "jsonl" || ext === "ndjson") {
    color = "#f59e0b"; // Amber orange
    iconName = "code";
  } else if (ext === "parquet") {
    color = "#06b6d4"; // Cyan blue
    iconName = "database";
  } else if (ext === "evtx" || ext === "log") {
    color = "#a855f7"; // Purple
    iconName = "history";
  }
  return (
    <Icon
      icon={iconName}
      size={13}
      style={{ color, marginRight: 5, flexShrink: 0 }}
    />
  );
};

export type TableSortCol = "name" | "dir" | "size" | "status";
export type TableSortDir = "asc" | "desc";

export interface ProjectTableFileItem extends ProjectWorkspaceFile {
  relDir: string;
  effectiveStatus: string;
}

export function sortFiles(
  files: ProjectTableFileItem[],
  sortCol: TableSortCol | null,
  sortDir: TableSortDir
): ProjectTableFileItem[] {
  if (!sortCol) return files;
  const sorted = [...files];
  sorted.sort((a, b) => {
    let cmp = 0;
    if (sortCol === "name") {
      cmp = a.fileName.localeCompare(b.fileName);
    } else if (sortCol === "dir") {
      cmp = a.relDir.localeCompare(b.relDir);
    } else if (sortCol === "size") {
      cmp = (a.fileSizeBytes || 0) - (b.fileSizeBytes || 0);
    } else if (sortCol === "status") {
      cmp = a.effectiveStatus.localeCompare(b.effectiveStatus);
    }
    return sortDir === "asc" ? cmp : -cmp;
  });
  return sorted;
}

export function filterFiles(
  files: ProjectTableFileItem[],
  filters: { [K in TableSortCol]?: string }
): ProjectTableFileItem[] {
  let result = files;
  const qName = (filters.name || "").toLowerCase().trim();
  if (qName) {
    result = result.filter((f) => f.fileName.toLowerCase().includes(qName));
  }
  const qDir = (filters.dir || "").toLowerCase().trim();
  if (qDir) {
    result = result.filter((f) => f.relDir.toLowerCase().includes(qDir));
  }
  const qSize = (filters.size || "").toLowerCase().trim();
  if (qSize) {
    result = result.filter(
      (f) =>
        formatFileBytes(f.fileSizeBytes).toLowerCase().includes(qSize) ||
        String(f.fileSizeBytes).includes(qSize)
    );
  }
  const qStatus = (filters.status || "").toLowerCase().trim();
  if (qStatus) {
    result = result.filter((f) =>
      f.effectiveStatus.toLowerCase().includes(qStatus)
    );
  }
  return result;
}

export interface ProjectFilesTableProps {
  files: ProjectWorkspaceFile[];
  activeFilePath?: string;
  onOpenFile: (file: ProjectWorkspaceFile) => void;
  stateRef?: StateRef<AppState>;
}

export const ProjectFilesTable: React.FC<ProjectFilesTableProps> = ({
  files,
  activeFilePath,
  onOpenFile,
  stateRef,
}) => {
  const [sortCol, setSortCol] = useState<TableSortCol | null>(null);
  const [sortDir, setSortDir] = useState<TableSortDir>("asc");
  const [filterOpenCol, setFilterOpenCol] = useState<TableSortCol | null>(null);
  const [colFilters, setColFilters] = useState<{ [K in TableSortCol]?: string }>({});
  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  // Subscribe to live status updates from MultipleLoadingManager
  useEffect(() => {
    const manager = MultipleLoadingManager.getInstance();
    const unsub = manager.subscribe(() => {
      forceUpdate();
    });
    return unsub;
  }, []);

  const handleSort = (col: TableSortCol, e: React.MouseEvent) => {
    e.stopPropagation();
    if (sortCol === col) {
      if (sortDir === "asc") {
        setSortDir("desc");
      } else {
        // Toggle back to asc or unsorted
        setSortDir("asc");
      }
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  const toggleColumnFilter = (col: TableSortCol, e: React.MouseEvent) => {
    e.stopPropagation();
    setFilterOpenCol((prev) => (prev === col ? null : col));
  };

  const handleFilterChange = (col: TableSortCol, value: string) => {
    setColFilters((prev) => ({
      ...prev,
      [col]: value,
    }));
  };

  const getEffectiveStatus = (f: ProjectWorkspaceFile): string => {
    const dsPath: DataSourcePath = {
      sourceId: { providerName: "localfs", resourceId: f.filePath },
      path: ["."],
    };
    const key = JSON.stringify(dsPath);
    const canonical = getCanonicalPathFromDSPath(dsPath);
    const manager = MultipleLoadingManager.getInstance();
    const item = manager.getItem(key) || manager.getItemByCanonical(canonical);

    if (stateRef) {
      const appState = mutableGet(stateRef);
      if (appState.viewState?.dsPath) {
        const curCanon = getCanonicalPathFromDSPath(appState.viewState.dsPath);
        if (curCanon === canonical) {
          return "READY";
        }
      }
    }

    if (item) {
      if (item.status === "ready") return "READY";
      if (item.status === "modified") return "MODIFIED";
      if (item.status === "error") return "ERROR";
      if (item.status === "processing" || item.status === "pending") return "PENDING";
    }

    return (f.status || "READY").toUpperCase();
  };

  const normPath = (p?: string): string => {
    return (p || "").replace(/\\/g, "/").toLowerCase();
  };

  const tableItems: ProjectTableFileItem[] = useMemo(() => {
    return files.map((f) => ({
      ...f,
      relDir: getRelativeParentDir(f.filePath, f.folderRoot),
      effectiveStatus: getEffectiveStatus(f),
    }));
  }, [files]);

  const displayedFiles = useMemo(() => {
    const filtered = filterFiles(tableItems, colFilters);
    return sortFiles(filtered, sortCol, sortDir);
  }, [tableItems, colFilters, sortCol, sortDir]);

  const renderStatus = (status: string) => {
    const s = status.toUpperCase();
    if (s === "READY" || s === "VALID") {
      return (
        <span className="status-indicator status-ready" title="READY / VALID">
          🟢
        </span>
      );
    }
    if (s === "MODIFIED") {
      return (
        <span className="status-indicator status-modified" title="MODIFIED">
          🔴
        </span>
      );
    }
    if (s === "ERROR") {
      return (
        <span className="status-indicator status-error" title="ERROR">
          !
        </span>
      );
    }
    return (
      <span className="status-indicator status-pending" title="PENDING">
        ◌
      </span>
    );
  };

  const getSortIcon = (col: TableSortCol) => {
    if (sortCol !== col) return "⇅";
    return sortDir === "asc" ? "▲" : "▼";
  };

  return (
    <div className="project-table-container">
      <table className="project-files-table">
        <thead>
          <tr>
            <th className="col-name" onClick={(e) => toggleColumnFilter("name", e)}>
              <div className="th-content">
                <span>Tên file</span>
                <button
                  type="button"
                  className="sort-btn"
                  title="Sắp xếp theo Tên file"
                  onClick={(e) => handleSort("name", e)}
                >
                  {getSortIcon("name")}
                </button>
              </div>
              {filterOpenCol === "name" && (
                <input
                  className="col-filter-input"
                  placeholder="Lọc tên file..."
                  value={colFilters.name || ""}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => handleFilterChange("name", e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setFilterOpenCol(null);
                    }
                  }}
                />
              )}
            </th>

            <th className="col-dir" onClick={(e) => toggleColumnFilter("dir", e)}>
              <div className="th-content">
                <span>Thư mục cha</span>
                <button
                  type="button"
                  className="sort-btn"
                  title="Sắp xếp theo Thư mục cha"
                  onClick={(e) => handleSort("dir", e)}
                >
                  {getSortIcon("dir")}
                </button>
              </div>
              {filterOpenCol === "dir" && (
                <input
                  className="col-filter-input"
                  placeholder="Lọc thư mục..."
                  value={colFilters.dir || ""}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => handleFilterChange("dir", e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setFilterOpenCol(null);
                    }
                  }}
                />
              )}
            </th>

            <th className="col-size" onClick={(e) => toggleColumnFilter("size", e)}>
              <div className="th-content">
                <span>Kích thước</span>
                <button
                  type="button"
                  className="sort-btn"
                  title="Sắp xếp theo Kích thước"
                  onClick={(e) => handleSort("size", e)}
                >
                  {getSortIcon("size")}
                </button>
              </div>
              {filterOpenCol === "size" && (
                <input
                  className="col-filter-input"
                  placeholder="Lọc kích thước..."
                  value={colFilters.size || ""}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => handleFilterChange("size", e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setFilterOpenCol(null);
                    }
                  }}
                />
              )}
            </th>

            <th className="col-status" onClick={(e) => toggleColumnFilter("status", e)}>
              <div className="th-content">
                <span>Trạng thái</span>
                <button
                  type="button"
                  className="sort-btn"
                  title="Sắp xếp theo Trạng thái"
                  onClick={(e) => handleSort("status", e)}
                >
                  {getSortIcon("status")}
                </button>
              </div>
              {filterOpenCol === "status" && (
                <input
                  className="col-filter-input"
                  placeholder="Lọc trạng thái..."
                  value={colFilters.status || ""}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => handleFilterChange("status", e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setFilterOpenCol(null);
                    }
                  }}
                />
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {displayedFiles.length === 0 ? (
            <tr className="empty-row">
              <td colSpan={4}>Không có tệp phù hợp</td>
            </tr>
          ) : (
            displayedFiles.map((f) => {
              const isSelected =
                activeFilePath && normPath(activeFilePath) === normPath(f.filePath);
              return (
                <tr
                  key={f.filePath}
                  className={`file-table-row ${isSelected ? "is-selected" : ""}`}
                  onClick={() => onOpenFile(f)}
                >
                  <td className="cell-name">
                    {getFileFormatIcon(f.fileName)}
                    <span className="file-name-text" title={f.fileName}>
                      {f.fileName}
                    </span>
                  </td>
                  <td className="cell-dir" title={f.relDir}>
                    {f.relDir}
                  </td>
                  <td className="cell-size" title={formatFileBytes(f.fileSizeBytes)}>
                    {formatFileBytes(f.fileSizeBytes)}
                  </td>
                  <td className="cell-status">
                    {renderStatus(f.effectiveStatus)}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};
