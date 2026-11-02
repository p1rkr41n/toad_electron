import * as React from "react";
import { Sidebar } from "./Sidebar";
import { StateRef, mutableGet } from "oneref";
import { AppState } from "../AppState";
import * as reltab from "reltab";
import * as log from "loglevel";
import _, { throttle } from "lodash";

import {
  Button,
  Classes,
  Dialog,
  Icon,
  IconName,
  InputGroup,
  Intent,
  Menu,
  MenuItem,
  MenuDivider,
  Position,
  Spinner,
  Tooltip,
  Tree,
  TreeNodeInfo,
} from "@blueprintjs/core";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  DataSourceConnection,
  DataSourceId,
  DataSourceKind,
  DataSourceNode,
  DataSourcePath,
} from "reltab";
import { actions } from "../tadviewer";
import {
  FileIngestStatus,
  MultipleLoadingManager,
  getCanonicalPathFromDSPath,
} from "../MultipleLoadingManager";
import {
  ProjectWorkspaceFile,
  ProjectWorkspaceManager,
  ProjectWorkspaceProject,
} from "../ProjectWorkspaceManager";

export interface DataSourceSidebarProps {
  expanded: boolean;
  stateRef: StateRef<AppState>;
}

const dataKindIcon = (dsKind: DataSourceKind): IconName => {
  switch (dsKind) {
    case "Database":
      return "database";
    case "Dataset":
      return "folder-open";
    case "Table":
      return "th";
    case "File":
      return "document";
    case "Directory":
      return "folder-close";
    default:
      throw new Error("dataKindIcon: unknown kind '" + dsKind + "'");
  }
};

type DSTreeNodeData = {
  dsc: DataSourceConnection;
  dsPath: DataSourcePath;
  dsNode: DataSourceNode;
  isProject?: boolean;
  projectId?: string;
};

type DSTreeNodeInfo = TreeNodeInfo<DSTreeNodeData>;

const getFileFormatIcon = (fileName: string): React.ReactElement => {
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
  return <Icon icon={iconName} size={13} style={{ color, marginRight: 5, flexShrink: 0 }} />;
};

const formatRowCountCompact = (count: number): string => {
  if (count == null || isNaN(count)) return "";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return `${count}`;
};

const formatFileBytes = (b: number): string => {
  if (b >= 1024 * 1024 * 1024) return (b / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(2) + " MB";
  if (b >= 1024) return (b / 1024).toFixed(1) + " KB";
  return b + " B";
};

export const FileTreeItemLabel: React.FC<{
  dsNode: DataSourceNode;
  dsPath: DataSourcePath;
  stateRef: StateRef<AppState>;
}> = ({ dsNode, dsPath, stateRef }) => {
  const key = useMemo(() => JSON.stringify(dsPath), [dsPath]);
  const canonicalPath = useMemo(() => getCanonicalPathFromDSPath(dsPath), [dsPath]);
  const manager = MultipleLoadingManager.getInstance();
  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  useEffect(() => {
    const unsub = manager.subscribe(() => {
      forceUpdate();
    });
    return unsub;
  }, [manager]);

  const item = manager.getItem(key) || manager.getItemByCanonical(canonicalPath);

  const appState = mutableGet(stateRef);
  const isCurrentActiveView = useMemo(() => {
    if (!appState.viewState?.dsPath) return false;
    const activeKey = JSON.stringify(appState.viewState.dsPath);
    if (activeKey === key) return true;
    const activeCanonical = getCanonicalPathFromDSPath(appState.viewState.dsPath);
    return activeCanonical === canonicalPath;
  }, [appState.viewState?.dsPath, key, canonicalPath]);

  const nodeStatus = (dsNode as any).initialStatus;
  const isReady =
    isCurrentActiveView ||
    (item ? item.status === "ready" : nodeStatus === "READY");
  const isModified =
    !isReady && (item ? item.status === "modified" : nodeStatus === "MODIFIED");
  const isProcessing = !isReady && !isModified && (item ? item.status === "processing" : false);
  const isError = !isReady && !isModified && (item ? item.status === "error" : false);
  const isPending = !isReady && !isModified && !isProcessing && !isError && (item ? item.status === "pending" : false);
  const percent = item ? item.percent : 0;

  const rawRowCount = (dsNode as any).rawRowCount;
  const rowCountText =
    rawRowCount != null && rawRowCount !== "" && !isNaN(Number(rawRowCount))
      ? formatRowCountCompact(Number(rawRowCount))
      : undefined;
  const fileSizeBytes = dsNode.fileSizeBytes;

  const statusTitle = isModified
    ? "File nguồn đã bị sửa đổi! Nhấp để nạp lại bản mới nhất"
    : isError
    ? `Lỗi: ${item?.error || "Không thể nạp tệp"}`
    : isReady
    ? `${dsNode.displayName} (Sẵn sàng • Parquet Cache Hit)`
    : isProcessing
    ? `${dsNode.displayName} - Đang nạp ${Math.round(percent)}%`
    : isPending
    ? `${dsNode.displayName} - Đang chờ nạp ngầm`
    : `${dsNode.displayName} (Nhấp để mở tức thì)`;

  const hoverCard = (
    <div className="file-hover-card">
      <div className="file-hover-name">{dsNode.displayName}</div>
      <div className="file-hover-row">
        <span className="file-hover-label">Đường dẫn:</span>
        <span className="file-hover-val" title={canonicalPath}>
          {canonicalPath}
        </span>
      </div>
      {fileSizeBytes != null && fileSizeBytes > 0 && (
        <div className="file-hover-row">
          <span className="file-hover-label">Kích thước gốc:</span>
          <span className="file-hover-val">{formatFileBytes(fileSizeBytes)}</span>
        </div>
      )}
      {rawRowCount != null && rawRowCount !== "" && !isNaN(Number(rawRowCount)) && (
        <div className="file-hover-row">
          <span className="file-hover-label">Tổng số dòng:</span>
          <span className="file-hover-val">{Number(rawRowCount).toLocaleString()} dòng</span>
        </div>
      )}
      <div className="file-hover-row">
        <span className="file-hover-label">Trạng thái:</span>
        <span
          className={`file-hover-val ${
            isReady ? "text-success" : isModified ? "text-danger" : ""
          }`}
        >
          {isReady
            ? "VALID (Parquet Cache Ready)"
            : isModified
            ? "MODIFIED (Nguồn thay đổi)"
            : isProcessing
            ? `PROCESSING (${Math.round(percent)}%)`
            : "IDLE"}
        </span>
      </div>
    </div>
  );

  return (
    <Tooltip
      content={hoverCard}
      position={Position.RIGHT}
      boundary="window"
      hoverOpenDelay={350}
      popoverClassName="file-node-tooltip-popover"
      className="file-node-tooltip-wrapper"
    >
      <div className="file-node-row">
        <span
          className={`file-node-title ds-file-node-title ${
            isReady
              ? "status-ready ds-status-ready"
              : isModified
              ? "status-modified ds-status-modified"
              : isProcessing
              ? "status-processing ds-status-processing"
              : isError
              ? "status-error ds-status-error"
              : isPending
              ? "status-pending ds-status-pending"
              : "status-idle ds-status-idle"
          }`}
          title={statusTitle}
        >
          {dsNode.displayName}
        </span>

        <div className="file-node-meta">
          {isProcessing ? (
            <span className="file-node-rowcount file-node-percent">{Math.round(percent)}%</span>
          ) : rowCountText ? (
            <span className="file-node-rowcount">{rowCountText}</span>
          ) : null}

          {isReady && (
            <span className="status-dot status-dot-ready" title="Ready (Cache hit)">
              ●
            </span>
          )}
          {isModified && (
            <span
              className="status-badge-modified ds-file-node-modified-badge"
              title="File nguồn đã bị sửa đổi! Nhấp để reload"
            >
              MODIFIED
            </span>
          )}
          {isProcessing && (
            <span
              className="status-spinner-wrapper ds-file-node-percent"
              title={`Đang nạp ${Math.round(percent)}%`}
            >
              <Spinner size={11} intent={Intent.PRIMARY} />
            </span>
          )}
          {isPending && (
            <span className="status-dot status-dot-pending" title="Đang chờ nạp ngầm">
              ◌
            </span>
          )}
          {isError && (
            <span
              className="status-dot status-dot-error ds-file-node-error-badge"
              title={item?.error || "Lỗi khi nạp file"}
            >
              !
            </span>
          )}
        </div>
      </div>
    </Tooltip>
  );
};

export const ProjectNodeLabel: React.FC<{
  project: ProjectWorkspaceProject;
  isActive: boolean;
  onAddFile: (e: React.MouseEvent) => void;
  onAddFolder: (e: React.MouseEvent) => void;
  onPurge: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
  onMoveOrphan?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}> = ({
  project,
  isActive,
  onAddFile,
  onAddFolder,
  onPurge,
  onDelete,
  onMoveOrphan,
  onContextMenu,
}) => {
  const isOrphan = project.isOrphan === true;
  const formattedSize = useMemo(() => {
    const b = Number(project.totalBytes) || 0;
    if (b >= 1024 * 1024 * 1024) return (b / (1024 * 1024 * 1024)).toFixed(1) + " GB";
    if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + " MB";
    if (b >= 1024) return (b / 1024).toFixed(0) + " KB";
    return b + " B";
  }, [project.totalBytes]);

  return (
    <div
      className={`project-node-row ${isActive ? "is-active" : ""} ${isOrphan ? "is-orphan" : ""}`}
      onContextMenu={onContextMenu}
    >
      <div className="project-node-title-group">
        <span className="project-title-text" title={project.projectName}>
          {project.projectName}
        </span>
        {isActive && !isOrphan && (
          <span className="project-active-badge" title="Active Project">
            ACTIVE
          </span>
        )}
        {isOrphan && (
          <span className="orphan-badge" title="Legacy Migrated Files">
            Legacy
          </span>
        )}
      </div>

      <div className="project-node-right">
        {!isOrphan ? (
          <>
            <span className="project-meta-pill">
              {project.fileCount} {project.fileCount === 1 ? "file" : "files"}
              {project.totalBytes > 0 && ` • ${formattedSize}`}
            </span>

            <div className="project-hover-actions" onClick={(e) => e.stopPropagation()}>
              <Tooltip content="Add Files to Project" position={Position.TOP} hoverOpenDelay={400}>
                <Button
                  className="project-hover-btn"
                  icon="plus"
                  minimal={true}
                  small={true}
                  onClick={onAddFile}
                />
              </Tooltip>
              <Tooltip content="Add Folder to Project" position={Position.TOP} hoverOpenDelay={400}>
                <Button
                  className="project-hover-btn"
                  icon="folder-open"
                  minimal={true}
                  small={true}
                  onClick={onAddFolder}
                />
              </Tooltip>
              <Tooltip content="Purge Parquet Cache" position={Position.TOP} hoverOpenDelay={400}>
                <Button
                  className="project-hover-btn"
                  icon="clean"
                  minimal={true}
                  small={true}
                  onClick={onPurge}
                />
              </Tooltip>
              <Tooltip content="Delete Project & Cascade Cache" position={Position.TOP} hoverOpenDelay={400}>
                <Button
                  className="project-hover-btn"
                  icon="trash"
                  intent={Intent.DANGER}
                  minimal={true}
                  small={true}
                  onClick={onDelete}
                />
              </Tooltip>
            </div>
          </>
        ) : (
          <div className="project-orphan-actions" onClick={(e) => e.stopPropagation()}>
            <span className="project-meta-pill orphan-pill">
              {project.fileCount} {project.fileCount === 1 ? "file" : "files"}
              {project.totalBytes > 0 && ` • ${formattedSize}`}
            </span>
            <Button
              className="project-orphan-move-btn"
              icon="inheritance"
              intent={Intent.WARNING}
              minimal={true}
              small={true}
              text="Move all"
              title="Move all legacy files to Untitled-1"
              onClick={onMoveOrphan}
            />
          </div>
        )}
      </div>
    </div>
  );
};

const dsNodeTreeNode = (
  dsc: DataSourceConnection,
  dsPath: DataSourcePath,
  dsNode: DataSourceNode,
  stateRef: StateRef<AppState>
): DSTreeNodeInfo => {
  const isFile = dsNode.kind === "File";

  const ret: DSTreeNodeInfo = {
    icon: isFile ? getFileFormatIcon(dsNode.displayName) : dataKindIcon(dsNode.kind),
    id: JSON.stringify(dsPath),
    label: isFile ? (
      <FileTreeItemLabel dsNode={dsNode} dsPath={dsPath} stateRef={stateRef} />
    ) : (
      dsNode.displayName
    ),
    nodeData: { dsc, dsPath, dsNode },
    hasCaret: dsNode.isContainer,
  };
  return ret;
};

const formatRowCount = (count: number): string => {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M rows`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K rows`;
  return `${count} rows`;
};

const extendDSPath = (basePath: DataSourcePath, item: string) => ({
  ...basePath,
  path: basePath.path.concat([item]),
});

export const DataSourceSidebar: React.FC<DataSourceSidebarProps> = ({
  expanded,
  stateRef,
}) => {
  const [treeState, setTreeState] = useState<DSTreeNodeInfo[]>([]);
  const [selectedNode, setSelectedNode] = useState<DSTreeNodeInfo | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [renameTarget, setRenameTarget] = useState<{
    projectId: string;
    currentName: string;
  } | null>(null);
  const [renameNewName, setRenameNewName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{
    projectId: string;
    projectName: string;
    formattedSize: string;
  } | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<{
    projectId: string;
    projectName: string;
  } | null>(null);
  const [purgeAllOpen, setPurgeAllOpen] = useState(false);
  const [projectContextMenu, setProjectContextMenu] = useState<{
    x: number;
    y: number;
    project: ProjectWorkspaceProject;
  } | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const [, forceUpdate] = useReducer((x) => x + 1, 0);
  const clickSeqRef = useRef(0);
  const pwManager = ProjectWorkspaceManager.getInstance();

  useEffect(() => {
    MultipleLoadingManager.getInstance().setStateRef(stateRef);
    const unMLM = MultipleLoadingManager.getInstance().subscribe(() => forceUpdate());
    const unPWM = pwManager.subscribe(() => {
      throttledRefresh.current();
    });
    return () => {
      unMLM();
      unPWM();
    };
  }, [stateRef]);

  // Context menu dismissal listeners (click, contextmenu, Escape, and scroll/wheel)
  useEffect(() => {
    const handleCloseMenu = () => setProjectContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setProjectContextMenu(null);
    };
    if (projectContextMenu) {
      window.addEventListener("click", handleCloseMenu);
      window.addEventListener("contextmenu", handleCloseMenu);
      window.addEventListener("keydown", handleKeyDown);
      window.addEventListener("wheel", handleCloseMenu, { passive: true });
      window.addEventListener("scroll", handleCloseMenu, { passive: true, capture: true });
      return () => {
        window.removeEventListener("click", handleCloseMenu);
        window.removeEventListener("contextmenu", handleCloseMenu);
        window.removeEventListener("keydown", handleKeyDown);
        window.removeEventListener("wheel", handleCloseMenu);
        window.removeEventListener("scroll", handleCloseMenu, { capture: true });
      };
    }
  }, [projectContextMenu]);

  const handleProjectContextMenu = (
    project: ProjectWorkspaceProject,
    e: React.MouseEvent
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setProjectContextMenu({
      x: e.clientX,
      y: e.clientY,
      project,
    });
  };

  const normPath = (p: string) => {
    try {
      const pathModule = require("path");
      return pathModule.resolve(p).replace(/\\/g, "/").toLowerCase();
    } catch {
      return (p || "").replace(/\\/g, "/").toLowerCase();
    }
  };

  const throttledRefresh = useRef(
    throttle(async function refreshDataSources(): Promise<void> {
      const appState = mutableGet(stateRef);
      const rtc = appState.rtc;
      try {
        const ws = await pwManager.getWorkspace();
        const activeProjectId = ws.activeProjectId || "prj_untitled_1";
        const projectTreeNodes: DSTreeNodeInfo[] = [];

        const q = searchQuery.toLowerCase().trim();

        for (const proj of ws.projects) {
          const files = await pwManager.getProjectFiles(proj.projectId);
          const isExpanded = pwManager.isProjectExpanded(proj.projectId);
          const projMatches = q ? proj.projectName.toLowerCase().includes(q) : false;

          const fileItemsForMLM: any[] = [];
          const fileDscMap = new Map<string, any>();

          for (const f of files) {
            let fileDsc: any = null;
            if (rtc) {
              try {
                fileDsc = await rtc.connect({ providerName: "localfs", resourceId: f.filePath });
              } catch {}
            }
            if (!fileDsc) {
              fileDsc = {
                getChildren: async () => [],
                getTableName: async (dsPath: DataSourcePath) => getCanonicalPathFromDSPath(dsPath),
                isCacheReady: () => f.status === "READY",
                getCacheStatus: () =>
                  f.status === "READY"
                    ? "VALID"
                    : f.status === "MODIFIED"
                    ? "MODIFIED"
                    : "UNPROCESSED",
              };
            }
            fileDscMap.set(f.filePath, fileDsc);

            const dsPath: DataSourcePath = {
              sourceId: { providerName: "localfs", resourceId: f.filePath },
              path: ["."],
            };

            fileItemsForMLM.push({
              dsPath,
              dsc: fileDsc,
              fileName: f.fileName,
              fileSizeBytes: f.fileSizeBytes,
            });
          }

          if (fileItemsForMLM.length > 0) {
            MultipleLoadingManager.getInstance().registerFiles(fileItemsForMLM, stateRef);
          }

          const childFileNodes: DSTreeNodeInfo[] = [];
          const topLevelFiles: ProjectWorkspaceFile[] = [];
          const folderGroups: Map<string, ProjectWorkspaceFile[]> = new Map();

          for (const f of files) {
            if (f.folderName) {
              const list = folderGroups.get(f.folderName) || [];
              list.push(f);
              folderGroups.set(f.folderName, list);
            } else {
              topLevelFiles.push(f);
            }
          }

          const renderFileNode = (f: ProjectWorkspaceFile): DSTreeNodeInfo | null => {
            if (q && !projMatches && !f.fileName.toLowerCase().includes(q)) {
              return null;
            }
            const fileDsc = fileDscMap.get(f.filePath);
            const dsPath: DataSourcePath = {
              sourceId: { providerName: "localfs", resourceId: f.filePath },
              path: ["."],
            };
            const dsNode: DataSourceNode = {
              id: f.fileName,
              kind: "File",
              displayName: f.fileName,
              isContainer: false,
              fileSizeBytes: f.fileSizeBytes,
            };
            (dsNode as any).initialStatus = f.status;
            (dsNode as any).rawRowCount = f.rowCount;
            return dsNodeTreeNode(fileDsc, dsPath, dsNode, stateRef);
          };

          for (const f of topLevelFiles) {
            const node = renderFileNode(f);
            if (node) childFileNodes.push(node);
          }

          for (const [fName, fList] of folderGroups.entries()) {
            const folderChildNodes: DSTreeNodeInfo[] = [];
            for (const f of fList) {
              const node = renderFileNode(f);
              if (node) folderChildNodes.push(node);
            }
            if (folderChildNodes.length > 0) {
              const folderKey = `proj_${proj.projectId}_folder_${fName}`;
              const isFolderExp = q ? true : expandedFolders.has(folderKey);
              childFileNodes.push({
                id: folderKey,
                icon: isFolderExp ? "folder-open" : "folder-close",
                hasCaret: true,
                isExpanded: isFolderExp,
                label: (
                  <span style={{ fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {fName}/
                    <span style={{ fontSize: "10px", color: "#64748b", fontWeight: 400 }}>
                      ({fList.length} files)
                    </span>
                  </span>
                ),
                childNodes: folderChildNodes,
                nodeData: {
                  isProject: false,
                  dsc: null as any,
                  dsPath: { sourceId: { providerName: "localfs", resourceId: "" }, path: [] },
                  dsNode: { id: fName, kind: "Directory", displayName: fName, isContainer: true },
                },
              });
            }
          }

          if (q && !projMatches && childFileNodes.length === 0) {
            continue;
          }

          const projNode: DSTreeNodeInfo = {
            id: `project_${proj.projectId}`,
            icon: proj.isOrphan ? "archive" : "projects",
            hasCaret: true,
            isExpanded: q ? true : isExpanded,
            label: (
              <ProjectNodeLabel
                project={proj}
                isActive={proj.projectId === activeProjectId}
                onAddFile={async (e) => {
                  e.stopPropagation();
                  try {
                    const { getHostBridge } = require("host-bridge");
                    const bridge = getHostBridge();
                    const chosen = await bridge.showOpenDialog({
                      title: `Add Files to ${proj.projectName}`,
                      multiple: true,
                    });
                    if (chosen && chosen.length > 0) {
                      await pwManager.addFilesToProject(proj.projectId, chosen);
                      throttledRefresh.current();
                    }
                  } catch (err) {
                    console.error("Error adding files:", err);
                  }
                }}
                onAddFolder={async (e) => {
                  e.stopPropagation();
                  try {
                    const { getHostBridge } = require("host-bridge");
                    const bridge = getHostBridge();
                    const chosen = await bridge.showOpenDialog({
                      title: `Add Folder to ${proj.projectName}`,
                      directory: true,
                    });
                    if (chosen && chosen.length > 0) {
                      await pwManager.addFolderToProject(proj.projectId, chosen[0]);
                      throttledRefresh.current();
                    }
                  } catch (err) {
                    console.error("Error adding folder:", err);
                  }
                }}
                onPurge={(e) => {
                  e.stopPropagation();
                  setPurgeTarget({
                    projectId: proj.projectId,
                    projectName: proj.projectName,
                  });
                }}
                onDelete={async (e) => {
                  e.stopPropagation();
                  const cacheInfo = await pwManager.getCacheSize(proj.projectId);
                  setDeleteTarget({
                    projectId: proj.projectId,
                    projectName: proj.projectName,
                    formattedSize: cacheInfo.formattedSize,
                  });
                }}
                onMoveOrphan={async (e) => {
                  e.stopPropagation();
                  await pwManager.moveOrphanFilesToProject("prj_untitled_1");
                  throttledRefresh.current();
                }}
                onContextMenu={(e) => handleProjectContextMenu(proj, e)}
              />
            ),
            childNodes: childFileNodes,
            nodeData: {
              isProject: true,
              projectId: proj.projectId,
              dsc: null as any,
              dsPath: { sourceId: { providerName: "localfs", resourceId: "" }, path: [] },
              dsNode: { id: proj.projectId, kind: "Dataset", displayName: proj.projectName, isContainer: true },
            },
          };

          projectTreeNodes.push(projNode);
        }

        // Eliminate Legacy Root Redundancy: All files strictly belong to projects
        setTreeState(projectTreeNodes);
      } catch (err) {
        console.error("error refreshing data sources: ", err);
      }
    }, 150)
  );

  useEffect(() => {
    throttledRefresh.current();
  });

  const handleNodeCollapse = (treeNode: DSTreeNodeInfo) => {
    if (treeNode.nodeData && (treeNode.nodeData as any).isProject) {
      pwManager.setProjectExpanded((treeNode.nodeData as any).projectId, false);
    } else if (treeNode.nodeData?.dsNode?.kind === "Directory") {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        next.delete(String(treeNode.id));
        return next;
      });
    }
    treeNode.isExpanded = false;
    forceUpdate();
  };

  const handleNodeExpand = async (treeNode: DSTreeNodeInfo) => {
    if (treeNode.nodeData && (treeNode.nodeData as any).isProject) {
      pwManager.setProjectExpanded((treeNode.nodeData as any).projectId, true);
      treeNode.isExpanded = true;
      forceUpdate();
      return;
    }

    if (treeNode.nodeData?.dsNode?.kind === "Directory" && !treeNode.nodeData.dsc) {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        next.add(String(treeNode.id));
        return next;
      });
      treeNode.isExpanded = true;
      forceUpdate();
      return;
    }

    const { dsPath, dsc, dsNode } = treeNode.nodeData!;
    if (!dsc || typeof dsc.getChildren !== "function") return;

    const childNodes = await dsc.getChildren(dsPath);

    const fileItems = childNodes
      .filter((n) => n.kind === "File")
      .map((n) => ({
        dsPath: extendDSPath(dsPath, n.id),
        dsc,
        fileName: n.displayName,
        fileSizeBytes: n.fileSizeBytes,
      }));
    if (fileItems.length > 0) {
      MultipleLoadingManager.getInstance().registerFiles(fileItems, stateRef);
    }

    treeNode.childNodes = childNodes.map((childNode) => {
      const childPath = extendDSPath(dsPath, childNode.id);
      return dsNodeTreeNode(dsc, childPath, childNode, stateRef);
    });
    treeNode.isExpanded = true;
    forceUpdate();
  };

  const handleNodeClick = async (
    treeNode: DSTreeNodeInfo,
    _nodePath: any[],
    e: React.MouseEvent<HTMLElement>
  ) => {
    if (treeNode.nodeData && (treeNode.nodeData as any).isProject) {
      const projId = (treeNode.nodeData as any).projectId;
      pwManager.toggleProjectExpanded(projId);
      pwManager.setActiveProject(projId);
      treeNode.isExpanded = !treeNode.isExpanded;
      forceUpdate();
      return;
    }

    if (treeNode.nodeData?.dsNode?.kind === "Directory" && !treeNode.nodeData.dsc) {
      const folderKey = String(treeNode.id);
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        if (next.has(folderKey)) {
          next.delete(folderKey);
        } else {
          next.add(folderKey);
        }
        return next;
      });
      return;
    }

    const { dsPath, dsNode } = treeNode.nodeData!;

    if (selectedNode != null) {
      selectedNode.isSelected = false;
    }
    treeNode.isSelected = true;
    setSelectedNode(treeNode);
    forceUpdate();

    if (dsNode.kind === "Table" || dsNode.kind === "File") {
      const clickSeq = ++clickSeqRef.current;
      const key = JSON.stringify(dsPath);
      const canonicalPath = getCanonicalPathFromDSPath(dsPath);
      const manager = MultipleLoadingManager.getInstance();
      const item = manager.getItem(key) || manager.getItemByCanonical(canonicalPath);

      if (item && item.status === "ready") {
        manager.clearPendingActiveOpen();
        actions.setActiveLoadingFile(
          {
            isLoading: true,
            fileName: dsNode.displayName,
            dsPath,
            percent: 100,
            statusText: "Opening table view...",
          },
          stateRef
        );
        try {
          await actions.openDataSourcePath(dsPath, stateRef);
        } finally {
          if (clickSeq === clickSeqRef.current) {
            actions.setActiveLoadingFile(null, stateRef);
          }
        }
      } else {
        manager.prioritize(key, stateRef);
        actions.setActiveLoadingFile(
          {
            isLoading: true,
            fileName: dsNode.displayName,
            dsPath,
            percent: item ? item.percent : 0,
            speedMBs: item?.speedMBs,
            etaSec: item?.etaSec,
            statusText: item?.statusText || "Prioritizing loading...",
          },
          stateRef
        );
      }
    }
  };

  const handleCreateProjectSubmit = async () => {
    if (!newProjectName.trim()) return;
    try {
      await pwManager.createProject(newProjectName.trim());
      setNewProjectOpen(false);
      setNewProjectName("");
      throttledRefresh.current();
    } catch (err) {
      console.error("Error creating project:", err);
    }
  };

  const handleExecuteDeleteProject = async () => {
    if (!deleteTarget) return;
    try {
      const curState = mutableGet(stateRef);
      if (curState.viewState?.dsPath) {
        const curCanon = getCanonicalPathFromDSPath(curState.viewState.dsPath);
        const deletedFiles = await pwManager.getProjectFiles(deleteTarget.projectId);
        const isCurFileDeleted = deletedFiles.some(
          (f) => f.filePath && normPath(f.filePath) === normPath(curCanon)
        );
        if (isCurFileDeleted) {
          const { awaitableUpdate_ } = require("oneref");
          await awaitableUpdate_(stateRef, (st: AppState) => st.set("viewState", null) as AppState);
        }
      }
      await pwManager.deleteProject(deleteTarget.projectId);
      setDeleteTarget(null);
      throttledRefresh.current();
    } catch (err) {
      console.error("Error deleting project:", err);
    }
  };

  const handleExecutePurgeCache = async () => {
    if (!purgeTarget) return;
    try {
      await pwManager.purgeProjectCache(purgeTarget.projectId);
      setPurgeTarget(null);
      throttledRefresh.current();
    } catch (err) {
      console.error("Error purging project cache:", err);
    }
  };

  const handleRenameProjectSubmit = async () => {
    if (!renameTarget || !renameNewName.trim()) return;
    try {
      await pwManager.renameProject(renameTarget.projectId, renameNewName.trim());
      setRenameTarget(null);
      setRenameNewName("");
      throttledRefresh.current();
    } catch (err) {
      console.error("Error renaming project:", err);
    }
  };

  const handleExecutePurgeAllCache = async () => {
    try {
      const ws = await pwManager.getWorkspace();
      for (const proj of ws.projects) {
        await pwManager.purgeProjectCache(proj.projectId);
      }
      setPurgeAllOpen(false);
      throttledRefresh.current();
    } catch (err) {
      console.error("Error purging all project caches:", err);
    }
  };

  return (
    <Sidebar expanded={expanded}>
      <div className="project-workspace-header">
        <div className="project-header-top-row">
          <span className="project-header-title">Projects</span>
          <div className="project-header-actions">
            <Tooltip content="New Project (Create new analysis project)" position={Position.BOTTOM} hoverOpenDelay={300}>
              <Button
                className="project-toolbar-btn"
                icon="plus"
                minimal={true}
                small={true}
                onClick={() => setNewProjectOpen(true)}
              />
            </Tooltip>
            <Tooltip content="Refresh Workspace (Sync Ledger state)" position={Position.BOTTOM} hoverOpenDelay={300}>
              <Button
                className="project-toolbar-btn"
                icon="refresh"
                minimal={true}
                small={true}
                onClick={() => throttledRefresh.current()}
              />
            </Tooltip>
            <Tooltip content="Clear All Cache (Purge parquet caches across all projects)" position={Position.BOTTOM} hoverOpenDelay={300}>
              <Button
                className="project-toolbar-btn"
                icon="clean"
                minimal={true}
                small={true}
                onClick={() => setPurgeAllOpen(true)}
              />
            </Tooltip>
          </div>
        </div>

        <InputGroup
          className="project-search-input"
          leftIcon="search"
          small={true}
          placeholder="Filter files or projects..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          rightElement={
            searchQuery ? (
              <Button
                icon="cross"
                minimal={true}
                small={true}
                title="Clear search"
                onClick={() => setSearchQuery("")}
              />
            ) : undefined
          }
        />
      </div>

      <Tree
        contents={treeState}
        onNodeCollapse={handleNodeCollapse}
        onNodeExpand={handleNodeExpand}
        onNodeClick={handleNodeClick}
      />

      {/* Right-click Project Context Menu */}
      {projectContextMenu && (
        <div
          className="toad-project-context-menu"
          style={{
            position: "fixed",
            left: Math.max(10, Math.min(projectContextMenu.x, window.innerWidth - 230)),
            top: Math.max(10, Math.min(projectContextMenu.y, window.innerHeight - 260)),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <Menu className="bp4-elevation-3">
            <li className="toad-context-menu-header">
              {projectContextMenu.project.projectName}
            </li>
            {!projectContextMenu.project.isOrphan ? (
              <>
                <MenuItem
                  icon="plus"
                  text="Add Files to Project..."
                  onClick={async () => {
                    const proj = projectContextMenu.project;
                    setProjectContextMenu(null);
                    try {
                      const { getHostBridge } = require("host-bridge");
                      const bridge = getHostBridge();
                      const chosen = await bridge.showOpenDialog({
                        title: `Add Files to ${proj.projectName}`,
                        multiple: true,
                      });
                      if (chosen && chosen.length > 0) {
                        await pwManager.addFilesToProject(proj.projectId, chosen);
                        throttledRefresh.current();
                      }
                    } catch (err) {
                      console.error("Error adding files:", err);
                    }
                  }}
                />
                <MenuItem
                  icon="folder-open"
                  text="Add Folder to Project..."
                  onClick={async () => {
                    const proj = projectContextMenu.project;
                    setProjectContextMenu(null);
                    try {
                      const { getHostBridge } = require("host-bridge");
                      const bridge = getHostBridge();
                      const chosen = await bridge.showOpenDialog({
                        title: `Add Folder to ${proj.projectName}`,
                        directory: true,
                      });
                      if (chosen && chosen.length > 0) {
                        await pwManager.addFolderToProject(proj.projectId, chosen[0]);
                        throttledRefresh.current();
                      }
                    } catch (err) {
                      console.error("Error adding folder:", err);
                    }
                  }}
                />
                <MenuItem
                  icon="edit"
                  text="Rename Project..."
                  onClick={() => {
                    const proj = projectContextMenu.project;
                    setProjectContextMenu(null);
                    setRenameTarget({
                      projectId: proj.projectId,
                      currentName: proj.projectName,
                    });
                    setRenameNewName(proj.projectName);
                  }}
                />
                <MenuItem
                  icon="clean"
                  text="Purge Parquet Cache"
                  onClick={() => {
                    const proj = projectContextMenu.project;
                    setProjectContextMenu(null);
                    setPurgeTarget({
                      projectId: proj.projectId,
                      projectName: proj.projectName,
                    });
                  }}
                />
                <MenuDivider />
                <MenuItem
                  icon="trash"
                  intent={Intent.DANGER}
                  text="Delete Project & Cache"
                  onClick={async () => {
                    const proj = projectContextMenu.project;
                    setProjectContextMenu(null);
                    const cacheInfo = await pwManager.getCacheSize(proj.projectId);
                    setDeleteTarget({
                      projectId: proj.projectId,
                      projectName: proj.projectName,
                      formattedSize: cacheInfo.formattedSize,
                    });
                  }}
                />
              </>
            ) : (
              <>
                <MenuItem
                  icon="inheritance"
                  intent={Intent.WARNING}
                  text="Move all to Untitled-1"
                  onClick={async () => {
                    setProjectContextMenu(null);
                    await pwManager.moveOrphanFilesToProject("prj_untitled_1");
                    throttledRefresh.current();
                  }}
                />
                <MenuItem
                  icon="clean"
                  text="Purge Parquet Cache"
                  onClick={() => {
                    const proj = projectContextMenu.project;
                    setProjectContextMenu(null);
                    setPurgeTarget({
                      projectId: proj.projectId,
                      projectName: proj.projectName,
                    });
                  }}
                />
                <MenuDivider />
                <MenuItem
                  icon="trash"
                  intent={Intent.DANGER}
                  text="Delete Orphan Project"
                  onClick={() => {
                    const proj = projectContextMenu.project;
                    setProjectContextMenu(null);
                    setDeleteTarget({
                      projectId: proj.projectId,
                      projectName: proj.projectName,
                      formattedSize: "0 MB",
                    });
                  }}
                />
              </>
            )}
          </Menu>
        </div>
      )}

      {/* Confirm Purge All Cache Dialog */}
      <Dialog
        isOpen={purgeAllOpen}
        onClose={() => setPurgeAllOpen(false)}
        title="Clear All Parquet Cache"
        icon="clean"
        style={{ width: "420px" }}
      >
        <div className={Classes.DIALOG_BODY}>
          <p style={{ fontSize: "13px", color: "var(--md-sys-color-on-surface, #334155)" }}>
            Bạn có chắc chắn muốn giải phóng toàn bộ cache Parquet cho <strong>tất cả các project</strong>?
          </p>
          <p style={{ fontSize: "12px", color: "#64748b", marginTop: "8px" }}>
            Hành động này sẽ dọn sạch các file đệm trong thư mục temp và đặt lại trạng thái nạp. File dữ liệu gốc không bị thay đổi.
          </p>
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button onClick={() => setPurgeAllOpen(false)}>Cancel</Button>
            <Button intent={Intent.WARNING} onClick={handleExecutePurgeAllCache}>
              Clear All Cache
            </Button>
          </div>
        </div>
      </Dialog>

      {/* New Project Dialog */}
      <Dialog
        isOpen={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        title="Create New Project"
        icon="projects"
        style={{ width: "380px" }}
      >
        <div className={Classes.DIALOG_BODY}>
          <p style={{ fontSize: "13px", color: "var(--md-sys-color-on-surface, #334155)", marginBottom: "8px" }}>
            Enter a name for the new analysis project:
          </p>
          <InputGroup
            autoFocus={true}
            placeholder="e.g. Incident-2026, Threat-Hunting"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newProjectName.trim()) {
                handleCreateProjectSubmit();
              }
            }}
          />
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button onClick={() => setNewProjectOpen(false)}>Cancel</Button>
            <Button
              intent={Intent.PRIMARY}
              disabled={!newProjectName.trim()}
              onClick={handleCreateProjectSubmit}
            >
              Create Project
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Rename Project Dialog */}
      <Dialog
        isOpen={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
        title="Rename Project"
        icon="edit"
        style={{ width: "380px" }}
      >
        <div className={Classes.DIALOG_BODY}>
          <p style={{ fontSize: "13px", color: "var(--md-sys-color-on-surface, #334155)", marginBottom: "8px" }}>
            Enter a new name for project <strong>{renameTarget?.currentName}</strong>:
          </p>
          <InputGroup
            autoFocus={true}
            placeholder="e.g. Incident-2026, Threat-Hunting"
            value={renameNewName}
            onChange={(e) => setRenameNewName(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                renameNewName.trim() &&
                renameNewName.trim() !== renameTarget?.currentName
              ) {
                handleRenameProjectSubmit();
              }
            }}
          />
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button onClick={() => setRenameTarget(null)}>Cancel</Button>
            <Button
              intent={Intent.PRIMARY}
              disabled={
                !renameNewName.trim() ||
                renameNewName.trim() === renameTarget?.currentName
              }
              onClick={handleRenameProjectSubmit}
            >
              Rename
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Confirm Delete Project Dialog */}
      <Dialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete Project & Cascade Cache Cleanup"
        icon="trash"
        style={{ width: "420px" }}
      >
        <div className={Classes.DIALOG_BODY}>
          <p style={{ fontSize: "13px", color: "var(--md-sys-color-on-surface, #334155)" }}>
            Bạn có chắc chắn muốn xóa project <strong>{deleteTarget?.projectName}</strong>?
          </p>
          <div
            style={{
              background: "rgba(239, 68, 68, 0.08)",
              border: "1px solid rgba(239, 68, 68, 0.25)",
              borderRadius: "6px",
              padding: "10px",
              marginTop: "10px",
            }}
          >
            <p style={{ margin: 0, color: "#ef4444", fontWeight: 600, fontSize: "12px" }}>
              ⚠️ Cascade Cache Cleanup:
            </p>
            <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#64748b" }}>
              Xóa project này sẽ giải phóng toàn bộ cache Parquet liên quan (ước tính:{" "}
              <strong>{deleteTarget?.formattedSize || "0 MB"}</strong>). Các file nguồn gốc trên đĩa không bị ảnh hưởng.
            </p>
          </div>
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button intent={Intent.DANGER} onClick={handleExecuteDeleteProject}>
              Delete Project
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Confirm Purge Cache Dialog */}
      <Dialog
        isOpen={purgeTarget !== null}
        onClose={() => setPurgeTarget(null)}
        title="Purge Project Parquet Cache"
        icon="clean"
        style={{ width: "420px" }}
      >
        <div className={Classes.DIALOG_BODY}>
          <p style={{ fontSize: "13px", color: "var(--md-sys-color-on-surface, #334155)" }}>
            Bạn có chắc chắn muốn giải phóng toàn bộ cache Parquet cho project <strong>{purgeTarget?.projectName}</strong>?
          </p>
          <p style={{ fontSize: "12px", color: "#64748b", marginTop: "8px" }}>
            Hành động này sẽ xóa các file đệm trong thư mục temp và đặt lại trạng thái nạp. Dữ liệu gốc trên đĩa không bị thay đổi.
          </p>
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button onClick={() => setPurgeTarget(null)}>Cancel</Button>
            <Button intent={Intent.WARNING} onClick={handleExecutePurgeCache}>
              Purge Cache
            </Button>
          </div>
        </div>
      </Dialog>
    </Sidebar>
  );
};

const INITIAL_STATE: DSTreeNodeInfo[] = [
  {
    id: 0,
    hasCaret: true,
    icon: "folder-close",
    label: "Folder 0",
  },
  {
    id: 1,
    icon: "folder-close",
    isExpanded: true,
    label: (
      <Tooltip content="I'm a folder <3" position={Position.RIGHT}>
        Folder 1
      </Tooltip>
    ),
    childNodes: [
      {
        id: 2,
        icon: "document",
        label: "Item 0",
        secondaryLabel: (
          <Tooltip content="An eye!">
            <Icon icon="eye-open" />
          </Tooltip>
        ),
      },
      {
        id: 3,
        icon: (
          <Icon
            icon="tag"
            intent={Intent.PRIMARY}
            className={Classes.TREE_NODE_ICON}
          />
        ),
        label:
          "Organic meditation gluten-free, sriracha VHS drinking vinegar beard man.",
      },
      {
        id: 4,
        hasCaret: true,
        icon: "folder-close",
        label: (
          <Tooltip content="foo" position={Position.RIGHT}>
            Folder 2
          </Tooltip>
        ),
        childNodes: [
          { id: 5, label: "No-Icon Item" },
          { id: 6, icon: "tag", label: "Item 1" },
          {
            id: 7,
            hasCaret: true,
            icon: "folder-close",
            label: "Folder 3",
            childNodes: [
              { id: 8, icon: "document", label: "Item 0" },
              { id: 9, icon: "tag", label: "Item 1" },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 2,
    hasCaret: true,
    icon: "folder-close",
    label: "Super secret files",
    disabled: true,
  },
];
