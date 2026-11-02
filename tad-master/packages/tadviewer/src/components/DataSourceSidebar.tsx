import * as React from "react";
import { Sidebar } from "./Sidebar";
import { StateRef, mutableGet } from "oneref";
import { AppState } from "../AppState";
import * as reltab from "reltab";
import * as log from "loglevel";
import _, { throttle } from "lodash";

import {
  Classes,
  Icon,
  Intent,
  TreeNodeInfo,
  Position,
  Tooltip,
  Tree,
  IconName,
} from "@blueprintjs/core";
import { useState, useReducer, useRef, useEffect, useMemo } from "react";
import {
  DataSourceKind,
  DataSourceNode,
  DataSourcePath,
  DataSourceId,
  DataSourceConnection,
} from "reltab";
import { actions } from "../tadviewer";

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

import {
  MultipleLoadingManager,
  FileIngestStatus,
  getCanonicalPathFromDSPath,
} from "../MultipleLoadingManager";

type DSTreeNodeData = {
  dsc: DataSourceConnection;
  dsPath: DataSourcePath;
  dsNode: DataSourceNode;
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

  const isReady = isCurrentActiveView || (item ? item.status === "ready" : false);
  const isProcessing = !isReady && (item ? item.status === "processing" : false);
  const isError = !isReady && (item ? item.status === "error" : false);
  const isPending = !isReady && !isProcessing && !isError && (item ? item.status === "pending" : false);
  const isIdle = !isReady && !isProcessing && !isError && (!item || item.status === "idle");
  const percent = item ? item.percent : 0;

  return (
    <div className="ds-file-node-wrapper">
      <div className="ds-file-node-header">
        <span
          className={`ds-file-node-title ${
            isReady
              ? "ds-status-ready"
              : isProcessing
              ? "ds-status-processing"
              : isError
              ? "ds-status-error"
              : isPending
              ? "ds-status-pending"
              : "ds-status-idle"
          }`}
          title={
            isError
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
        <Icon icon="eye-open" />
      </Tooltip>
    );
  }
  return ret;
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
  const [initialized, setInitialized] = useState(false);
  const [treeState, setTreeState] = useState<DSTreeNodeInfo[]>([]);
  const [rootNodeMap, setRootNodeMap] = useState<RootNodeMap>({});
  const [selectedNode, setSelectedNode] = useState<DSTreeNodeInfo | null>(null);
  const [, forceUpdate] = useReducer((x) => x + 1, 0);
  const clickSeqRef = useRef(0);

  useEffect(() => {
    MultipleLoadingManager.getInstance().setStateRef(stateRef);
    const unsubscribe = MultipleLoadingManager.getInstance().subscribe(() => {
      forceUpdate();
    });
    return unsubscribe;
  }, [stateRef]);

  const throttledRefresh = useRef(
    throttle(async function refreshDataSources(): Promise<void> {
      const appState = mutableGet(stateRef);
      const rtc = appState.rtc;
      let dirty = false;
      let newContainers: DSTreeNodeInfo[] = [];
      try {
        const nextNodeMap = Object.assign(rootNodeMap) as RootNodeMap;
        const rootSources = await rtc.getDataSources();
        const rootNodes = await Promise.all(
          rootSources.map(async (sourceId) => {
            const sourceIdStr = JSON.stringify(sourceId);
            let rootTreeNode = nextNodeMap[sourceIdStr];
            if (!rootTreeNode) {
              const dsc = await rtc.connect(sourceId);
              const rootNode = await dsc.getRootNode();
              const rootPath: DataSourcePath = {
                sourceId,
                path: ["."],
              };
              rootTreeNode = dsNodeTreeNode(dsc, rootPath, rootNode, stateRef);
              nextNodeMap[sourceIdStr] = rootTreeNode;
              if (rootNode.isContainer) {
                newContainers.push(rootTreeNode);
              }
              dirty = true;
            }
            return rootTreeNode;
          })
        );
        if (dirty) {
          setTreeState(rootNodes);
          setRootNodeMap(nextNodeMap);
          for (const cNode of newContainers) {
            handleNodeExpand(cNode);
          }
        }
      } catch (err) {
        console.error("error refreshing data sources: ", err);
      }
    }, 500)
  );

  useEffect(() => {
    throttledRefresh.current();
  });

  const handleNodeCollapse = (treeNode: DSTreeNodeInfo) => {
    treeNode.isExpanded = false;
    forceUpdate();
  };

  const handleNodeExpand = async (treeNode: DSTreeNodeInfo) => {
    const { dsPath, dsc, dsNode } = treeNode.nodeData!;
    const appState = mutableGet(stateRef);
    const childNodes = await dsc.getChildren(dsPath);

    // Register all child files into MultipleLoadingManager for background processing
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
    const { dsPath, dsNode } = treeNode.nodeData!;

    // Phản hồi giao diện tức thì: đánh dấu chọn dòng ngay lập tức
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
        // File đã nạp xong: lập tức hiển thị trạng thái mở bảng dữ liệu
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
        // File chưa nạp hoặc đang nạp: Cướp quyền ưu tiên lên đầu hàng đợi và chuyển màn hình sang Loading
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

  return (
    <Sidebar expanded={expanded}>
      <Tree
        contents={treeState}
        onNodeCollapse={handleNodeCollapse}
        onNodeExpand={handleNodeExpand}
        onNodeClick={handleNodeClick}
      />
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
