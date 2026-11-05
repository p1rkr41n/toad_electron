import * as React from "react";
import { Sidebar } from "./Sidebar";
import { StateRef, mutableGet, awaitableUpdate_ } from "oneref";
import { getHostBridge } from "host-bridge";
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
} from "@blueprintjs/core";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  DataSourceConnection,
  DataSourceId,
  DataSourceKind,
  DataSourceNode,
  DataSourcePath,
} from "reltab";
import { actions } from "../toadviewer";
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
import {
  ProjectFilesTable,
  getRelativeParentDir,
  formatFileBytes,
  getFileFormatIcon,
} from "./ProjectFilesTable";

export { getRelativeParentDir, formatFileBytes, getFileFormatIcon };

export interface DataSourceSidebarProps {
  expanded: boolean;
  stateRef: StateRef<AppState>;
}

export const formatRowCountCompact = (count: number): string => {
  if (count == null || isNaN(count)) return "";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return `${count}`;
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
  const isProcessing =
    (item ? item.status === "processing" : false) ||
    nodeStatus === "PROCESSING" ||
    nodeStatus === "STARTED";
  const isError = !isProcessing && (item ? item.status === "error" : nodeStatus === "ERROR");
  const isModified =
    !isProcessing && !isError && (item ? item.status === "modified" : nodeStatus === "MODIFIED");
  const isReady =
    !isProcessing &&
    !isError &&
    !isModified &&
    (isCurrentActiveView ||
      (item ? item.status === "ready" : nodeStatus === "READY"));
  const isPending =
    !isProcessing &&
    !isError &&
    !isModified &&
    !isReady &&
    (item ? item.status === "pending" : nodeStatus === "PENDING");
  const percent = item ? item.percent : 0;

  const rawRowCount = (dsNode as any).rawRowCount;
  const rowCountText =
    rawRowCount != null && rawRowCount !== "" && !isNaN(Number(rawRowCount))
      ? formatRowCountCompact(Number(rawRowCount))
      : undefined;
  const fileSizeBytes = dsNode.fileSizeBytes;

  const statusTitle = isProcessing
    ? `${dsNode.displayName} - Loading ${Math.round(percent)}%`
    : isModified
    ? "Source file modified! Click to reload"
    : isError
    ? `Error: ${item?.error || "Failed to load file"}`
    : isReady
    ? `${dsNode.displayName} (Ready • Parquet Cache Hit)`
    : isPending
    ? `${dsNode.displayName} - Waiting for background ingest`
    : `${dsNode.displayName} (Click to open immediately)`;

  const hoverCard = (
    <div className="file-hover-card">
      <div className="file-hover-name">{dsNode.displayName}</div>
      <div className="file-hover-row">
        <span className="file-hover-label">Full Path:</span>
        <span className="file-hover-val" title={canonicalPath}>
          {canonicalPath}
        </span>
      </div>
      {fileSizeBytes != null && fileSizeBytes > 0 && (
        <div className="file-hover-row">
          <span className="file-hover-label">Original Size:</span>
          <span className="file-hover-val">{formatFileBytes(fileSizeBytes)}</span>
        </div>
      )}
      {rawRowCount != null && rawRowCount !== "" && !isNaN(Number(rawRowCount)) && (
        <div className="file-hover-row">
          <span className="file-hover-label">Total Rows:</span>
          <span className="file-hover-val">{Number(rawRowCount).toLocaleString()} rows</span>
        </div>
      )}
      <div className="file-hover-row">
        <span className="file-hover-label">Status:</span>
        <span
          className={`file-hover-val ${
            isReady
              ? "text-success"
              : isModified
              ? "text-danger"
              : isProcessing
              ? "text-primary"
              : ""
          }`}
        >
          {isProcessing
            ? `PROCESSING (${Math.round(percent)}%)`
            : isReady
            ? "VALID (Parquet Cache Ready)"
            : isModified
            ? "MODIFIED (Source Changed)"
            : isError
            ? "ERROR"
            : isPending
            ? "PENDING"
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
              title="Source file modified! Click to reload"
            >
              MODIFIED
            </span>
          )}
          {isProcessing && (
            <span
              className="status-spinner-wrapper ds-file-node-percent"
              title={`Loading ${Math.round(percent)}%`}
            >
              <Spinner size={11} intent={Intent.PRIMARY} />
            </span>
          )}
          {isPending && (
            <span className="status-dot status-dot-pending" title="Waiting for background ingest">
              ◌
            </span>
          )}
          {isError && (
            <span
              className="status-dot status-dot-error ds-file-node-error-badge"
              title={item?.error || "Error loading file"}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
            >
              <Icon icon="error" size={12} style={{ color: "#ef4444" }} />
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
  onRenameCommit?: (newName: string) => Promise<boolean | void> | void;
}> = ({
  project,
  isActive,
  onAddFile,
  onAddFolder,
  onPurge,
  onDelete,
  onMoveOrphan,
  onContextMenu,
  onRenameCommit,
}) => {
  const isOrphan = project.isOrphan === true;
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(project.projectName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTempName(project.projectName);
  }, [project.projectName]);

  useEffect(() => {
    if (isEditingName && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditingName]);

  const handleCommitRename = async () => {
    if (!isEditingName) return;
    setIsEditingName(false);
    const trimmed = tempName.trim();
    if (trimmed && trimmed !== project.projectName) {
      if (onRenameCommit) {
        await onRenameCommit(trimmed);
      } else {
        const pwManager = ProjectWorkspaceManager.getInstance();
        await pwManager.renameProject(project.projectId, trimmed);
      }
    } else {
      setTempName(project.projectName);
    }
  };

  const handleCancelRename = () => {
    setIsEditingName(false);
    setTempName(project.projectName);
  };

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
        {isEditingName ? (
          <input
            ref={inputRef}
            className="project-title-inline-input"
            value={tempName}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onChange={(e) => setTempName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation();
                handleCommitRename();
              } else if (e.key === "Escape") {
                e.stopPropagation();
                handleCancelRename();
              }
            }}
            onBlur={handleCommitRename}
          />
        ) : (
          <span
            className="project-title-text"
            title={isOrphan ? project.projectName : "Double-click to rename"}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (!isOrphan) {
                setIsEditingName(true);
              }
            }}
          >
            {project.projectName}
          </span>
        )}
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
              title="Move all legacy files to active project"
              onClick={onMoveOrphan}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export const DataSourceSidebar: React.FC<DataSourceSidebarProps> = ({
  expanded,
  stateRef,
}) => {
  const pwManager = ProjectWorkspaceManager.getInstance();
  const [projects, setProjects] = useState<ProjectWorkspaceProject[]>([]);
  const [projectFilesMap, setProjectFilesMap] = useState<Map<string, ProjectWorkspaceFile[]>>(new Map());
  const [activeProjectId, setActiveProjectId] = useState<string>("prj_untitled_1");
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
    formattedSize?: string;
  } | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<{
    projectId: string;
    projectName: string;
  } | null>(null);
  const [purgeAllOpen, setPurgeAllOpen] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [, setTreeState] = useState<any[]>([]);

  const [projectContextMenu, setProjectContextMenu] = useState<{
    x: number;
    y: number;
    project: ProjectWorkspaceProject;
  } | null>(null);

  const clickSeqRef = useRef<number>(0);
  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  const appState = mutableGet(stateRef);
  const activeFilePath = useMemo(() => {
    if (!appState.viewState?.dsPath) return undefined;
    return getCanonicalPathFromDSPath(appState.viewState.dsPath);
  }, [appState.viewState?.dsPath]);

  const normPath = (p: string) => {
    return (p || "").replace(/\\/g, "/").toLowerCase();
  };

  const refreshWorkspaceData = async () => {
    try {
      const ws = await pwManager.getWorkspace();
      setActiveProjectId(ws.activeProjectId || "prj_untitled_1");
      const newFilesMap = new Map<string, ProjectWorkspaceFile[]>();
      const fileItemsForMLM: any[] = [];
      const curAppState = mutableGet(stateRef);
      const rtc = curAppState.rtc;

      for (const proj of ws.projects) {
        const files = await pwManager.getProjectFiles(proj.projectId);
        newFilesMap.set(proj.projectId, files);

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
      }

      if (fileItemsForMLM.length > 0) {
        MultipleLoadingManager.getInstance().registerFiles(fileItemsForMLM, stateRef);
      }

      setProjects(ws.projects);
      setProjectFilesMap(newFilesMap);

      // Eliminate Legacy Root Redundancy: All files strictly belong to projects
      const projectTreeNodes: any[] = ws.projects;
      setTreeState(projectTreeNodes);
    } catch (err) {
      console.error("error loading workspace data: ", err);
    }
  };

  const throttledRefresh = useRef(
    throttle(async function refreshDataSources(): Promise<void> {
      await refreshWorkspaceData();
    }, 150)
  );

  useEffect(() => {
    refreshWorkspaceData();
    const unsubPW = pwManager.subscribe(() => {
      refreshWorkspaceData();
    });
    const unsubMLM = MultipleLoadingManager.getInstance().subscribe(() => {
      forceUpdate();
    });
    return () => {
      unsubPW();
      unsubMLM();
    };
  }, []);

  // Context menu dismissal listeners
  useEffect(() => {
    if (projectContextMenu) {
      const handleCloseMenu = () => setProjectContextMenu(null);
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") setProjectContextMenu(null);
      };
      window.addEventListener("click", handleCloseMenu);
      window.addEventListener("contextmenu", handleCloseMenu);
      window.addEventListener("keydown", handleKeyDown);
      window.addEventListener("wheel", handleCloseMenu);
      window.addEventListener("scroll", handleCloseMenu, { capture: true });
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

  // Requirement R3: Strict 100% File-Name In-Memory Reactive Filtering
  const q = searchQuery.toLowerCase().trim();

  const filteredProjects = useMemo(() => {
    return projects
      .map((proj) => {
        const pFiles = projectFilesMap.get(proj.projectId) || [];
        // Strictly filter 100% on file name; NEVER match project name!
        const matchingFiles = q
          ? pFiles.filter((f) => f.fileName.toLowerCase().includes(q))
          : pFiles;

        const hasMatches = matchingFiles.length > 0;
        const shouldShow = !q || hasMatches;
        const isExpanded = pwManager.isProjectExpanded(proj.projectId);

        return {
          project: proj,
          files: matchingFiles,
          totalFileCount: pFiles.length,
          shouldShow,
          isExpanded: q ? true : isExpanded,
        };
      })
      .filter((p) => p.shouldShow);
  }, [projects, projectFilesMap, searchQuery]);

  const handleToggleProject = (projectId: string) => {
    pwManager.toggleProjectExpanded(projectId);
    pwManager.setActiveProject(projectId);
    forceUpdate();
  };

  const handleOpenFile = async (file: ProjectWorkspaceFile) => {
    try {
      const dsPath: DataSourcePath = {
        sourceId: { providerName: "localfs", resourceId: file.filePath },
        path: ["."],
      };
      pwManager.setActiveProject(file.projectId);
      const clickSeq = ++clickSeqRef.current;
      const key = JSON.stringify(dsPath);
      const canonicalPath = getCanonicalPathFromDSPath(dsPath);
      const manager = MultipleLoadingManager.getInstance();
      const item = manager.getItem(key) || manager.getItemByCanonical(canonicalPath);
      const ramCache = manager.getFirstPageCache(canonicalPath) || manager.getFirstPageCache(key);

      if (ramCache) {
        manager.clearPendingActiveOpen();
        const prevCursor = document.body.style.cursor;
        document.body.style.cursor = "wait";
        try {
          await actions.openDataSourcePath(dsPath, stateRef);
        } catch (err: any) {
          console.error(`[handleOpenFile] Error opening cached file ${file.fileName}:`, err?.stack || err);
        } finally {
          document.body.style.cursor = prevCursor || "default";
        }
        return;
      }

      if (item && item.status === "ready") {
        manager.clearPendingActiveOpen();
        actions.setActiveLoadingFile(
          {
            isLoading: true,
            fileName: file.fileName,
            dsPath,
            percent: 100,
            statusText: "Opening table view...",
          },
          stateRef
        );
        try {
          await actions.openDataSourcePath(dsPath, stateRef);
        } catch (err: any) {
          console.error(`[handleOpenFile] Error opening ready file ${file.fileName}:`, err?.stack || err);
        } finally {
          if (clickSeq === clickSeqRef.current) {
            const cur = mutableGet(stateRef).activeLoadingFile;
            if (!cur?.error) {
              actions.setActiveLoadingFile(null, stateRef);
            }
          }
        }
      } else {
        manager.prioritize(key, stateRef);
        actions.setActiveLoadingFile(
          {
            isLoading: true,
            fileName: file.fileName,
            dsPath,
            percent: item ? item.percent : 0,
            speedMBs: item?.speedMBs,
            etaSec: item?.etaSec,
            statusText: item?.statusText || "Prioritizing loading...",
          },
          stateRef
        );
      }
    } catch (err: any) {
      console.error(`[handleOpenFile] Error handling open file ${file?.fileName}:`, err?.stack || err);
    }
  };

  const handleCreateProjectSubmit = async () => {
    if (!newProjectName.trim()) return;
    try {
      await pwManager.createProject(newProjectName.trim());
      setNewProjectOpen(false);
      setNewProjectName("");
      refreshWorkspaceData();
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
          await awaitableUpdate_(stateRef, (st: AppState) => st.set("viewState", null) as AppState);
        }
      }
      await pwManager.deleteProject(deleteTarget.projectId);
      setDeleteTarget(null);
      refreshWorkspaceData();
    } catch (err) {
      console.error("Error deleting project:", err);
    }
  };

  const handleExecutePurgeCache = async () => {
    if (!purgeTarget) return;
    try {
      await pwManager.purgeProjectCache(purgeTarget.projectId);
      setPurgeTarget(null);
      refreshWorkspaceData();
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
      refreshWorkspaceData();
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
      refreshWorkspaceData();
    } catch (err) {
      console.error("Error purging all project caches:", err);
    }
  };

  const handleExecuteDeleteAllProjects = async () => {
    try {
      const curState = mutableGet(stateRef);
      if (curState.viewState) {
        await awaitableUpdate_(stateRef, (st: AppState) => st.set("viewState", null) as AppState);
      }
      await pwManager.deleteAllProjects();
      setDeleteAllOpen(false);
      refreshWorkspaceData();
    } catch (err) {
      console.error("Error deleting all projects:", err);
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
                onClick={() => refreshWorkspaceData()}
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
            <Tooltip content="Delete All Projects (Reset ledger and purge temp cache)" position={Position.BOTTOM} hoverOpenDelay={300}>
              <Button
                className="project-toolbar-btn project-toolbar-danger-btn"
                icon="trash"
                intent={Intent.DANGER}
                minimal={true}
                small={true}
                onClick={() => setDeleteAllOpen(true)}
              />
            </Tooltip>
          </div>
        </div>

        <InputGroup
          className="project-search-input"
          leftIcon="search"
          small={true}
          placeholder="Filter files..."
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

      <div className="project-workspace-body">
        {filteredProjects.length === 0 ? (
          <div className="project-search-empty">
            {q ? `No files matching "${searchQuery}"` : "No projects available"}
          </div>
        ) : (
          filteredProjects.map(({ project, files, isExpanded }) => {
            const isActive = project.projectId === (activeProjectId || "prj_untitled_1");
            return (
              <div
                key={project.projectId}
                className={`project-accordion-section ${isExpanded ? "is-expanded" : "is-collapsed"}`}
              >
                <div
                  className="project-accordion-header"
                  onClick={() => handleToggleProject(project.projectId)}
                >
                  <span className="project-caret-wrapper">
                    <Icon
                      icon={isExpanded ? "chevron-down" : "chevron-right"}
                      size={14}
                      className="project-caret-icon"
                    />
                  </span>
                  <Icon
                    icon={project.isOrphan ? "archive" : "projects"}
                    size={14}
                    className="project-kind-icon"
                    style={{
                      color: project.isOrphan ? "#f59e0b" : "#0284c7",
                      marginRight: 6,
                      flexShrink: 0,
                    }}
                  />
                  <ProjectNodeLabel
                    project={project}
                    isActive={isActive}
                    onRenameCommit={async (newName) => {
                      await pwManager.renameProject(project.projectId, newName);
                      refreshWorkspaceData();
                    }}
                    onAddFile={async (e) => {
                      e.stopPropagation();
                      try {
                        const bridge = getHostBridge();
                        const chosen = await bridge.showOpenDialog({
                          title: `Add Files to ${project.projectName}`,
                          multiple: true,
                        });
                        if (chosen && chosen.length > 0) {
                          await pwManager.addFilesToProject(project.projectId, chosen);
                          refreshWorkspaceData();
                        }
                      } catch (err) {
                        console.error("Error adding files:", err);
                      }
                    }}
                    onAddFolder={async (e) => {
                      e.stopPropagation();
                      try {
                        const bridge = getHostBridge();
                        const chosen = await bridge.showOpenDialog({
                          title: `Add Folder to ${project.projectName}`,
                          directory: true,
                        });
                        if (chosen && chosen.length > 0) {
                          await pwManager.addFolderToProject(project.projectId, chosen[0]);
                          refreshWorkspaceData();
                        }
                      } catch (err) {
                        console.error("Error adding folder:", err);
                      }
                    }}
                    onPurge={(e) => {
                      e.stopPropagation();
                      setPurgeTarget({
                        projectId: project.projectId,
                        projectName: project.projectName,
                      });
                    }}
                    onDelete={async (e) => {
                      e.stopPropagation();
                      const cacheInfo = await pwManager.getCacheSize(project.projectId);
                      setDeleteTarget({
                        projectId: project.projectId,
                        projectName: project.projectName,
                        formattedSize: cacheInfo.formattedSize,
                      });
                    }}
                    onMoveOrphan={async (e) => {
                      e.stopPropagation();
                      await pwManager.moveOrphanFilesToProject(activeProjectId);
                      refreshWorkspaceData();
                    }}
                    onContextMenu={(e) => handleProjectContextMenu(project, e)}
                  />
                </div>

                {isExpanded && (
                  <div className="project-accordion-content">
                    <ProjectFilesTable
                      files={files}
                      activeFilePath={activeFilePath}
                      onOpenFile={handleOpenFile}
                      stateRef={stateRef}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

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
                      const bridge = getHostBridge();
                      const chosen = await bridge.showOpenDialog({
                        title: `Add Files to ${proj.projectName}`,
                        multiple: true,
                      });
                      if (chosen && chosen.length > 0) {
                        await pwManager.addFilesToProject(proj.projectId, chosen);
                        refreshWorkspaceData();
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
                      const bridge = getHostBridge();
                      const chosen = await bridge.showOpenDialog({
                        title: `Add Folder to ${proj.projectName}`,
                        directory: true,
                      });
                      if (chosen && chosen.length > 0) {
                        await pwManager.addFolderToProject(proj.projectId, chosen[0]);
                        refreshWorkspaceData();
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
                  text="Move all to Active Project"
                  onClick={async () => {
                    setProjectContextMenu(null);
                    await pwManager.moveOrphanFilesToProject(activeProjectId);
                    refreshWorkspaceData();
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

      {/* Confirm Delete All Projects Dialog */}
      <Dialog
        isOpen={deleteAllOpen}
        onClose={() => setDeleteAllOpen(false)}
        title="Delete All Projects"
        icon="trash"
        style={{ width: "440px" }}
      >
        <div className={Classes.DIALOG_BODY}>
          <p style={{ fontSize: "13px", color: "var(--md-sys-color-on-surface, #334155)" }}>
            Are you sure you want to delete all projects? This will reset the Parquet Ledger to 0 rows, permanently purge all temporary cache directories, and recreate a clean Untitled-1 default project.
          </p>
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button onClick={() => setDeleteAllOpen(false)}>Cancel</Button>
            <Button
              intent={Intent.DANGER}
              onClick={handleExecuteDeleteAllProjects}
            >
              Delete All Projects
            </Button>
          </div>
        </div>
      </Dialog>

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
            Are you sure you want to clear all Parquet cache for <strong>all projects</strong>?
          </p>
          <p style={{ fontSize: "12px", color: "#64748b", marginTop: "8px" }}>
            This will purge temporary files in the temp directory and reset ingestion states. Original source files will not be changed.
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
            Are you sure you want to delete project <strong>{deleteTarget?.projectName}</strong>?
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
              Deleting this project will permanently purge all associated Parquet cache (estimated:{" "}
              <strong>{deleteTarget?.formattedSize || "0 MB"}</strong>). Original source files on disk will not be affected.
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
            Are you sure you want to clear Parquet cache for project <strong>{purgeTarget?.projectName}</strong>?
          </p>
          <p style={{ fontSize: "12px", color: "#64748b", marginTop: "8px" }}>
            This will remove temporary cache files and reset ingestion states. Original data on disk will not be changed.
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
