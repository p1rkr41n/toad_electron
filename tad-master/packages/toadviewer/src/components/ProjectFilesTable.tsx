import * as React from "react";
import { useState, useMemo, useEffect, useReducer, useRef } from "react";
import { Icon, IconName, Tooltip, Position, Spinner, Intent } from "@blueprintjs/core";
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

/**
 * Extracts the full absolute parent directory of a file path.
 * Normalizes backslashes for Windows paths.
 */
export function getFullParentDir(filePath: string): string {
  if (!filePath) return "";
  const norm = filePath.replace(/\\/g, "/").replace(/\/+/g, "/");
  const lastSlash = norm.lastIndexOf("/");
  if (lastSlash === -1) return filePath;
  const dir = norm.substring(0, lastSlash);
  return filePath.includes("\\") ? dir.replace(/\//g, "\\") : dir;
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

export interface ColWidths {
  name: number;
  dir: number;
  size: number;
  status: number;
}

export const DEFAULT_COL_WIDTHS: ColWidths = {
  name: 140,
  dir: 120,
  size: 70,
  status: 60,
};

export const MIN_COL_WIDTH = 45;
export const MAX_COL_WIDTH = 400;

export const calculateAutoFitWidth = (maxLen: number): number => {
  return Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, Math.round(maxLen * 7.0 + 24)));
};

export interface ProjectTableFileItem extends ProjectWorkspaceFile {
  relDir: string;
  effectiveStatus: string;
  loadingPercent?: number;
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
      if (cmp === 0 && a.effectiveStatus === "PROCESSING") {
        cmp = (a.loadingPercent || 0) - (b.loadingPercent || 0);
      }
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
  const [colWidths, setColWidths] = useState<ColWidths>(DEFAULT_COL_WIDTHS);
  const [selectedRowPath, setSelectedRowPath] = useState<string | null>(
    activeFilePath || null
  );
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<{
    col: TableSortCol;
    startX: number;
    startWidth: number;
  } | null>(null);

  const [sortCol, setSortCol] = useState<TableSortCol | null>(null);
  const [sortDir, setSortDir] = useState<TableSortDir>("asc");
  const [filterOpenCol, setFilterOpenCol] = useState<TableSortCol | null>(null);
  const [colFilters, setColFilters] = useState<{ [K in TableSortCol]?: string }>({});
  const [updateTick, forceUpdate] = useReducer((x) => x + 1, 0);

  // Sync selectedRowPath if activeFilePath prop changes externally
  useEffect(() => {
    if (activeFilePath) {
      setSelectedRowPath(activeFilePath);
    }
  }, [activeFilePath]);

  // Click-away listener (outside .project-table-container) & Escape key listener
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        tableContainerRef.current &&
        !tableContainerRef.current.contains(e.target as Node)
      ) {
        setSelectedRowPath(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedRowPath(null);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.classList.remove("col-resizing");
    };
  }, []);

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

  const getEffectiveStatus = (
    f: ProjectWorkspaceFile
  ): { status: string; percent?: number } => {
    const dsPath: DataSourcePath = {
      sourceId: { providerName: "localfs", resourceId: f.filePath },
      path: ["."],
    };
    const key = JSON.stringify(dsPath);
    const canonical = getCanonicalPathFromDSPath(dsPath);
    const manager = MultipleLoadingManager.getInstance();
    const item = manager.getItem(key) || manager.getItemByCanonical(canonical);

    if (item) {
      if (item.status === "processing") {
        return { status: "PROCESSING", percent: item.percent };
      }
      if (item.status === "ready") return { status: "READY" };
      if (item.status === "modified") return { status: "MODIFIED" };
      if (item.status === "error") return { status: "ERROR" };
      if (item.status === "pending") return { status: "PENDING" };
    }

    if (stateRef) {
      const appState = mutableGet(stateRef);
      if (appState.viewState?.dsPath) {
        const curCanon = getCanonicalPathFromDSPath(appState.viewState.dsPath);
        if (curCanon === canonical) {
          return { status: "READY" };
        }
      }
    }

    const rawStatus = (f.status || "READY").toUpperCase();
    if (rawStatus === "STARTED" || rawStatus === "PROCESSING") {
      return { status: "PROCESSING", percent: item?.percent ?? 0 };
    }

    return { status: rawStatus };
  };

  const normPath = (p?: string): string => {
    return (p || "").replace(/\\/g, "/").toLowerCase();
  };

  const tableItems: ProjectTableFileItem[] = useMemo(() => {
    return files.map((f) => {
      const eff = getEffectiveStatus(f);
      return {
        ...f,
        relDir: getRelativeParentDir(f.filePath, f.folderRoot),
        effectiveStatus: eff.status,
        loadingPercent: eff.percent,
      };
    });
  }, [files, updateTick]);

  const displayedFiles = useMemo(() => {
    const filtered = filterFiles(tableItems, colFilters);
    return sortFiles(filtered, sortCol, sortDir);
  }, [tableItems, colFilters, sortCol, sortDir]);

  const handleResizeMouseDown = (col: TableSortCol, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = colWidths[col];
    draggingRef.current = { col, startX, startWidth };
    document.body.classList.add("col-resizing");

    const onMouseMove = (moveEvt: MouseEvent) => {
      if (!draggingRef.current) return;
      const delta = moveEvt.clientX - draggingRef.current.startX;
      const newWidth = Math.max(MIN_COL_WIDTH, draggingRef.current.startWidth + delta);
      setColWidths((prev) => ({
        ...prev,
        [draggingRef.current!.col]: newWidth,
      }));
    };

    const cleanup = () => {
      draggingRef.current = null;
      document.body.classList.remove("col-resizing");
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", cleanup);
      window.removeEventListener("blur", cleanup);
      document.removeEventListener("mouseleave", cleanup);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", cleanup);
    window.addEventListener("blur", cleanup);
    document.addEventListener("mouseleave", cleanup);
  };

  const handleAutoFit = (col: TableSortCol, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    let maxLen = 0;
    if (col === "name") {
      maxLen = "Name".length;
      displayedFiles.forEach((f) => {
        if (f.fileName && f.fileName.length > maxLen) maxLen = f.fileName.length;
      });
    } else if (col === "dir") {
      maxLen = "DirPath".length;
      displayedFiles.forEach((f) => {
        if (f.relDir && f.relDir.length > maxLen) maxLen = f.relDir.length;
      });
    } else if (col === "size") {
      maxLen = "Size".length;
      displayedFiles.forEach((f) => {
        const s = formatFileBytes(f.fileSizeBytes);
        if (s.length > maxLen) maxLen = s.length;
      });
    } else if (col === "status") {
      maxLen = "Status".length;
      displayedFiles.forEach((f) => {
        const st = f.effectiveStatus || "";
        if (st.length > maxLen) maxLen = st.length;
      });
    }
    const fitWidth = calculateAutoFitWidth(maxLen);
    setColWidths((prev) => ({ ...prev, [col]: fitWidth }));
  };

  const handleRowClick = (f: ProjectWorkspaceFile) => {
    if (selectedRowPath && normPath(selectedRowPath) === normPath(f.filePath)) {
      setSelectedRowPath(null); // toggle collapse
    } else {
      setSelectedRowPath(f.filePath);
      onOpenFile(f);
    }
  };

  const renderStatus = (status: string, percent?: number) => {
    const s = status.toUpperCase();
    if (s === "PROCESSING") {
      const pct = Math.round(percent ?? 0);
      return (
        <span
          className="status-indicator status-processing"
          title={`Loading ${pct}%`}
          style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
        >
          <Spinner size={11} intent={Intent.PRIMARY} />
          <span style={{ fontSize: "11px", color: "var(--md-sys-color-primary, #0284c7)", fontWeight: 500 }}>
            {pct}%
          </span>
        </span>
      );
    }
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
        <span
          className="status-indicator status-error"
          title="ERROR"
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
        >
          <Icon icon="error" size={12} style={{ color: "#ef4444" }} />
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
    <div className="project-table-container" ref={tableContainerRef}>
      <table className="project-files-table">
        <colgroup>
          <col style={{ width: colWidths.name }} />
          <col style={{ width: colWidths.dir }} />
          <col style={{ width: colWidths.size }} />
          <col style={{ width: colWidths.status }} />
        </colgroup>
        <thead>
          <tr>
            <th
              className="col-name"
              style={{ width: colWidths.name }}
              onClick={(e) => toggleColumnFilter("name", e)}
            >
              <div className="th-content">
                <span>Name</span>
                <button
                  type="button"
                  className="sort-btn"
                  title="Sort by Name"
                  onClick={(e) => handleSort("name", e)}
                >
                  {getSortIcon("name")}
                </button>
              </div>
              <div
                className="col-resizer-handle"
                title="Drag to resize, double-click to auto-fit"
                onMouseDown={(e) => handleResizeMouseDown("name", e)}
                onDoubleClick={(e) => handleAutoFit("name", e)}
              />
              {filterOpenCol === "name" && (
                <input
                  className="col-filter-input"
                  placeholder="Filter name..."
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

            <th
              className="col-dir"
              style={{ width: colWidths.dir }}
              onClick={(e) => toggleColumnFilter("dir", e)}
            >
              <div className="th-content">
                <span>DirPath</span>
                <button
                  type="button"
                  className="sort-btn"
                  title="Sort by DirPath"
                  onClick={(e) => handleSort("dir", e)}
                >
                  {getSortIcon("dir")}
                </button>
              </div>
              <div
                className="col-resizer-handle"
                title="Drag to resize, double-click to auto-fit"
                onMouseDown={(e) => handleResizeMouseDown("dir", e)}
                onDoubleClick={(e) => handleAutoFit("dir", e)}
              />
              {filterOpenCol === "dir" && (
                <input
                  className="col-filter-input"
                  placeholder="Filter dir..."
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

            <th
              className="col-size"
              style={{ width: colWidths.size }}
              onClick={(e) => toggleColumnFilter("size", e)}
            >
              <div className="th-content">
                <span>Size</span>
                <button
                  type="button"
                  className="sort-btn"
                  title="Sort by Size"
                  onClick={(e) => handleSort("size", e)}
                >
                  {getSortIcon("size")}
                </button>
              </div>
              <div
                className="col-resizer-handle"
                title="Drag to resize, double-click to auto-fit"
                onMouseDown={(e) => handleResizeMouseDown("size", e)}
                onDoubleClick={(e) => handleAutoFit("size", e)}
              />
              {filterOpenCol === "size" && (
                <input
                  className="col-filter-input"
                  placeholder="Filter size..."
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

            <th
              className="col-status"
              style={{ width: colWidths.status }}
              onClick={(e) => toggleColumnFilter("status", e)}
            >
              <div className="th-content">
                <span>Status</span>
                <button
                  type="button"
                  className="sort-btn"
                  title="Sort by Status"
                  onClick={(e) => handleSort("status", e)}
                >
                  {getSortIcon("status")}
                </button>
              </div>
              <div
                className="col-resizer-handle"
                title="Drag to resize, double-click to auto-fit"
                onMouseDown={(e) => handleResizeMouseDown("status", e)}
                onDoubleClick={(e) => handleAutoFit("status", e)}
              />
              {filterOpenCol === "status" && (
                <input
                  className="col-filter-input"
                  placeholder="Filter status..."
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
              <td colSpan={4}>No files matching filter</td>
            </tr>
          ) : (
            displayedFiles.map((f) => {
              const isSelected = selectedRowPath
                ? normPath(selectedRowPath) === normPath(f.filePath)
                : false;
              const parentDir = getFullParentDir(f.filePath);
              return (
                <tr
                  key={f.filePath}
                  className={`file-table-row ${isSelected ? "is-selected" : ""}`}
                  onClick={() => handleRowClick(f)}
                  title={f.filePath}
                >
                  <td className="cell-name" title={f.filePath}>
                    {getFileFormatIcon(f.fileName)}
                    <Tooltip
                      content={
                        <div className="file-hover-card">
                          <div className="file-hover-name">{f.fileName}</div>
                          <div className="file-hover-row">
                            <span className="file-hover-label">Full Path:</span>
                            <span
                              className="file-hover-val"
                              style={{ fontFamily: "monospace", fontSize: "10px" }}
                              title={f.filePath}
                            >
                              {f.filePath}
                            </span>
                          </div>
                          {f.fileSizeBytes != null && f.fileSizeBytes > 0 && (
                            <div className="file-hover-row">
                              <span className="file-hover-label">Original Size:</span>
                              <span className="file-hover-val">
                                {formatFileBytes(f.fileSizeBytes)} ({(f.fileSizeBytes || 0).toLocaleString()} bytes)
                              </span>
                            </div>
                          )}
                          {f.rowCount != null && f.rowCount > 0 && (
                            <div className="file-hover-row">
                              <span className="file-hover-label">Total Rows:</span>
                              <span className="file-hover-val">{f.rowCount.toLocaleString()} rows</span>
                            </div>
                          )}
                          <div className="file-hover-row">
                            <span className="file-hover-label">Status:</span>
                            <span
                              className={`file-hover-val ${
                                f.effectiveStatus === "READY"
                                  ? "text-success"
                                  : f.effectiveStatus === "MODIFIED"
                                  ? "text-danger"
                                  : ""
                              }`}
                            >
                              {f.effectiveStatus === "PROCESSING"
                                ? `PROCESSING (${Math.round(f.loadingPercent || 0)}%)`
                                : f.effectiveStatus}
                            </span>
                          </div>
                        </div>
                      }
                      position={Position.RIGHT}
                      boundary="window"
                      hoverOpenDelay={350}
                      popoverClassName="file-node-tooltip-popover"
                    >
                      <div className="file-name-wrap">
                        <span className="file-name-text" title={f.filePath}>
                          {f.fileName}
                        </span>
                      </div>
                    </Tooltip>
                  </td>
                  <td className="cell-dir" title={parentDir}>
                    <Tooltip
                      content={
                        <div className="file-hover-card" style={{ maxWidth: "420px" }}>
                          <div className="file-hover-row">
                            <span className="file-hover-label">Full DirPath:</span>
                            <span
                              className="file-hover-val"
                              style={{ fontFamily: "monospace", fontSize: "10px" }}
                              title={parentDir}
                            >
                              {parentDir}
                            </span>
                          </div>
                        </div>
                      }
                      position={Position.RIGHT}
                      boundary="window"
                      hoverOpenDelay={350}
                      popoverClassName="file-node-tooltip-popover"
                    >
                      <div className="file-dir-wrap">
                        <span className="file-dir-text" title={parentDir}>
                          {f.relDir}
                        </span>
                      </div>
                    </Tooltip>
                  </td>
                  <td className="cell-size" title={`${formatFileBytes(f.fileSizeBytes)} (${(f.fileSizeBytes || 0).toLocaleString()} bytes)`}>
                    {formatFileBytes(f.fileSizeBytes)}
                  </td>
                  <td className="cell-status" title={f.effectiveStatus === "PROCESSING" ? `Loading ${Math.round(f.loadingPercent || 0)}%` : f.effectiveStatus}>
                    {renderStatus(f.effectiveStatus, f.loadingPercent)}
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
