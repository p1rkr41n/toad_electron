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
  Position,
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
  const isIdle = !isReady && !isModified && !isProcessing && !isError && (!item || item.status === "idle");
  const percent = item ? item.percent : 0;

  return (
    <div className="ds-file-node-wrapper">
      <div className="ds-file-node-header">
        <span
          className={`ds-file-node-title ${
            isReady
              ? "ds-status-ready"
              : isModified
              ? "ds-status-modified"
              : isProcessing
              ? "ds-status-processing"
              : isError
              ? "ds-status-error"
              : isPending
              ? "ds-status-pending"
              : "ds-status-idle"
          }`}
          title={
            isModified
              ? "File nguồn đã bị sửa đổi! Nhấp để nạp lại bản mới nhất"
              : isError
              ? `Lỗi: ${item?.error || "Không thể nạp tệp"}`
              : isReady
              ? `${dsNode.displayName} (Sẵn sàng)`
              : isProcessing
              ? `${dsNode.displayName} - Đang nạp ${Math.round(percent)}%`
              : isPending
              ? `${dsNode.displayName} - Đang chờ nạp ngầm`
              : `${dsNode.displayName} (Nhấp để mở tức thì)`
          }
        >
          {dsNode.displayName}
        </span>
        {isReady && (
          <span className="ds-file-node-ready-badge">[READY]</span>
        )}
        {isModified && (
          <span className="ds-file-node-modified-badge">[MODIFIED]</span>
        )}
        {isProcessing && (
          <span className="ds-file-node-percent">{Math.round(percent)}%</span>
        )}
        {isError && (
          <span
            className="ds-file-node-error-badge"
            title={item?.error || "Lỗi khi nạp file"}
          >
            !
          </span>
        )}
      </div>
      {isProcessing && (
        <div className="ds-file-progress-track">
          <div
            className="ds-file-progress-fill"
            style={{ width: `${Math.max(5, Math.min(100, percent))}%` }}
          />
        </div>
      )}
    </div>
  );
};

export const ProjectNodeLabel: React.FC<{
  project: ProjectWorkspaceProject;
  isActive: boolean;
  onAddFile: (e: React.MouseEvent) => void;
  onAddFolder: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
  onMoveOrphan?: (e: React.MouseEvent) => void;
}> = ({ project, isActive, onAddFile, onAddFolder, onDelete, onMoveOrphan }) => {
  const isOrphan = project.isOrphan === true;
  const formattedSize = useMemo(() => {
    const b = Number(project.totalBytes) || 0;
    if (b >= 1024 * 1024 * 1024) return (b / (1024 * 1024 * 1024)).toFixed(1) + " GB";
    return (b / (1024 * 1024)).toFixed(1) + " MB";
  }, [project.totalBytes]);

  return (
    <div className="project-node-label-wrapper" onClick={(e) => e.stopPropagation()}>
      <div className="project-node-header">
        <span className={`project-title ${isActive ? "is-active" : ""}`}>
          <Icon icon={isOrphan ? "archive" : "projects"} size={13} style={{ marginRight: 4 }} />
          {project.projectName}
          {isOrphan && <span className="orphan-badge">Legacy Migrated Files</span>}
          {isActive && !isOrphan && (
            <span
              style={{
                fontSize: "9px",
                background: "rgba(2, 132, 199, 0.12)",
                color: "#0284c7",
                border: "1px solid rgba(2, 132, 199, 0.3)",
                borderRadius: "3px",
                padding: "0 4px",
                fontWeight: 700,
                marginLeft: 4,
              }}
            >
              ACTIVE
            </span>
          )}
        </span>
        <span className="project-meta-badge">
          {project.fileCount} {project.fileCount === 1 ? "file" : "files"} | {formattedSize}
        </span>
      </div>
      <div className="project-actions-row">
        {!isOrphan ? (
          <>
            <Button
              className="project-action-btn"
              icon="document"
              small={true}
              minimal={true}
              text="Add File"
              onClick={onAddFile}
            />
            <Button
              className="project-action-btn"
              icon="folder-open"
              small={true}
              minimal={true}
              text="Add Folder"
              onClick={onAddFolder}
            />
            <Button
              className="project-action-btn"
              icon="trash"
              intent={Intent.DANGER}
              small={true}
              minimal={true}
              title="Delete Project & Cascade Cache Cleanup"
              onClick={onDelete}
            />
          </>
        ) : (
          <Button
            className="project-action-btn"
            icon="inheritance"
            intent={Intent.WARNING}
            small={true}
            minimal={true}
            text="Move all to Untitled-1"
            onClick={onMoveOrphan}
          />
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
    icon: dataKindIcon(dsNode.kind),
    id: JSON.stringify(dsPath),
    label: isFile ? (
      <FileTreeItemLabel dsNode={dsNode} dsPath={dsPath} stateRef={stateRef} />
    ) : (
      dsNode.displayName
    ),
    nodeData: { dsc, dsPath, dsNode },
    hasCaret: dsNode.isContainer,
  };
  if (dsNode.description) {
    ret.secondaryLabel = (
      <Tooltip usePortal={true} boundary="window" content={dsNode.description}>
        <span style={{ fontSize: "11px", color: "#64748b", marginLeft: "4px" }}>
          ({dsNode.description})
        </span>
      </Tooltip>
    );
  }
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

type RootNodeMap = { [resourceId: string]: DSTreeNodeInfo };

export const DataSourceSidebar: React.FC<DataSourceSidebarProps> = ({
  expanded,
  stateRef,
}) => {
  const [treeState, setTreeState] = useState<DSTreeNodeInfo[]>([]);
  const [rootNodeMap, setRootNodeMap] = useState<RootNodeMap>({});
  const [selectedNode, setSelectedNode] = useState<DSTreeNodeInfo | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{
    projectId: string;
    projectName: string;
    formattedSize: string;
  } | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<{
    projectId: string;
    projectName: string;
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

        const allProjectFilePaths = new Set<string>();

        for (const proj of ws.projects) {
          const files = await pwManager.getProjectFiles(proj.projectId);
          const isExpanded = pwManager.isProjectExpanded(proj.projectId);

          const fileItemsForMLM: any[] = [];
          const fileDscMap = new Map<string, any>();

          for (const f of files) {
            if (f.filePath) {
              allProjectFilePaths.add(normPath(f.filePath));
            }

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
            if (searchQuery && !f.fileName.toLowerCase().includes(searchQuery.toLowerCase())) {
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
              description: f.rowCount ? formatRowCount(Number(f.rowCount)) : undefined,
            };
            (dsNode as any).initialStatus = f.status;
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
              const isFolderExp = expandedFolders.has(folderKey);
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

          const projNode: DSTreeNodeInfo = {
            id: `project_${proj.projectId}`,
            icon: proj.isOrphan ? "archive" : "projects",
            hasCaret: true,
            isExpanded,
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

        const nextNodeMap = Object.assign({}, rootNodeMap) as RootNodeMap;
        const rootSources = await rtc.getDataSources();
        const legacyRootNodes: DSTreeNodeInfo[] = [];
        for (const sourceId of rootSources) {
          const resId = normPath(String((sourceId as any).resourceId || ""));
          if (resId && allProjectFilePaths.has(resId)) {
            continue;
          }
          const sourceIdStr = JSON.stringify(sourceId);
          let rootTreeNode = nextNodeMap[sourceIdStr];
          if (!rootTreeNode) {
            try {
              const dsc = await rtc.connect(sourceId);
              const rootNode = await dsc.getRootNode();
              const rootPath: DataSourcePath = {
                sourceId,
                path: ["."],
              };
              rootTreeNode = dsNodeTreeNode(dsc, rootPath, rootNode, stateRef);
              nextNodeMap[sourceIdStr] = rootTreeNode;
              if (rootNode.isContainer) {
                handleNodeExpand(rootTreeNode);
              }
            } catch {}
          }
          if (rootTreeNode) {
            legacyRootNodes.push(rootTreeNode);
          }
        }
        setRootNodeMap(nextNodeMap);

        setTreeState(projectTreeNodes.concat(legacyRootNodes));
      } catch (err) {
        console.error("error refreshing data sources: ", err);
      }
    }, 500)
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

  return (
    <Sidebar expanded={expanded}>
      <div className="project-workspace-header">
        <div className="project-workspace-toolbar">
          <Button
            className="new-project-btn"
            icon="plus"
            intent={Intent.PRIMARY}
            text="New Project"
            small={true}
            onClick={() => setNewProjectOpen(true)}
          />
          <Button
            icon="document"
            minimal={true}
            small={true}
            title="Add Files to Active Project"
            onClick={async () => {
              try {
                const { getHostBridge } = require("host-bridge");
                const bridge = getHostBridge();
                const chosen = await bridge.showOpenDialog({
                  title: "Add Files to Active Project",
                  multiple: true,
                });
                if (chosen && chosen.length > 0) {
                  const ws = await pwManager.getWorkspace();
                  await pwManager.addFilesToProject(ws.activeProjectId, chosen);
                  throttledRefresh.current();
                }
              } catch (err) {
                console.error("Error adding files:", err);
              }
            }}
          />
          <Button
            icon="folder-open"
            minimal={true}
            small={true}
            title="Add Folder to Active Project"
            onClick={async () => {
              try {
                const { getHostBridge } = require("host-bridge");
                const bridge = getHostBridge();
                const chosen = await bridge.showOpenDialog({
                  title: "Add Folder to Active Project",
                  directory: true,
                });
                if (chosen && chosen.length > 0) {
                  const ws = await pwManager.getWorkspace();
                  await pwManager.addFolderToProject(ws.activeProjectId, chosen[0]);
                  throttledRefresh.current();
                }
              } catch (err) {
                console.error("Error adding folder:", err);
              }
            }}
          />
          <Button
            icon="clean"
            minimal={true}
            small={true}
            title="Purge Active Project Cache"
            onClick={async () => {
              const ws = await pwManager.getWorkspace();
              const activeProj = ws.projects.find((p) => p.projectId === ws.activeProjectId);
              if (activeProj) {
                setPurgeTarget({
                  projectId: activeProj.projectId,
                  projectName: activeProj.projectName,
                });
              }
            }}
          />
          <Button
            icon="refresh"
            minimal={true}
            small={true}
            title="Refresh Workspace"
            onClick={() => throttledRefresh.current()}
          />
        </div>
        <InputGroup
          className="project-search-input"
          leftIcon="search"
          small={true}
          placeholder="Filter Files..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <Tree
        contents={treeState}
        onNodeCollapse={handleNodeCollapse}
        onNodeExpand={handleNodeExpand}
        onNodeClick={handleNodeClick}
      />

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
