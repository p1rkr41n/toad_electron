import * as React from "react";
import * as reltab from "reltab";
import { AppState } from "../AppState";
import { Button, Spinner, Intent } from "@blueprintjs/core";
import { FilterEditorRow } from "./FilterEditorRow";
import { StateRef } from "oneref";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { FilterExp, SubExp, RawSqlRelExp, getDefaultDialect } from "reltab";

export interface FilterEditorProps {
  appState: AppState;
  stateRef: StateRef<AppState>;
  schema: reltab.Schema;
  filterExp: reltab.FilterExp | null;
  liveUpdate: boolean;
  onToggleLiveUpdate: (live: boolean) => void;
  onQueryChange: (fe: reltab.FilterExp) => void;
  onCancel: () => void;
  onApply: (fe: reltab.FilterExp) => void;
  onDone: () => void;
}

let nextNodeId = 1;
export const genNodeId = () => "fn-" + nextNodeId++;

export interface FilterRuleNode {
  id: string;
  type: "rule";
  relExp: reltab.RelExp | null;
}

export interface FilterGroupNode {
  id: string;
  type: "group";
  op: reltab.BoolOp;
  children: Array<FilterRuleNode | FilterGroupNode>;
}

export type FilterNode = FilterRuleNode | FilterGroupNode;

export const filterExpToTree = (fe: FilterExp | null): FilterGroupNode => {
  if (fe == null || !fe.opArgs || fe.opArgs.length === 0) {
    return {
      id: genNodeId(),
      type: "group",
      op: fe ? fe.op : "AND",
      children: [
        {
          id: genNodeId(),
          type: "rule",
          relExp: null,
        },
      ],
    };
  }

  const children: FilterNode[] = fe.opArgs.map((arg) => {
    if (arg && arg.expType === "FilterExp") {
      return filterExpToTree(arg);
    } else {
      return {
        id: genNodeId(),
        type: "rule",
        relExp: (arg as reltab.RelExp) || null,
      };
    }
  });

  return {
    id: genNodeId(),
    type: "group",
    op: fe.op,
    children:
      children.length > 0
        ? children
        : [
            {
              id: genNodeId(),
              type: "rule",
              relExp: null,
            },
          ],
  };
};

export const treeToFilterExp = (group: FilterGroupNode): FilterExp => {
  const opArgs: SubExp[] = [];
  for (const child of group.children) {
    if (child.type === "rule") {
      if (child.relExp != null) {
        opArgs.push(child.relExp);
      }
    } else if (child.type === "group") {
      const subFE = treeToFilterExp(child);
      if (subFE.opArgs && subFE.opArgs.length > 0) {
        opArgs.push(subFE);
      }
    }
  }
  return new FilterExp(group.op, opArgs);
};

// Check if potentialChildId is inside node's subtree
export function isDescendant(node: FilterNode, potentialChildId: string): boolean {
  if (node.id === potentialChildId) return true;
  if (node.type === "group") {
    for (const child of node.children) {
      if (isDescendant(child, potentialChildId)) return true;
    }
  }
  return false;
}

// Find parent group and index of child
export function findParentOfNode(
  group: FilterGroupNode,
  targetId: string
): { parentGroup: FilterGroupNode; index: number } | null {
  for (let i = 0; i < group.children.length; i++) {
    const child = group.children[i];
    if (child.id === targetId) {
      return { parentGroup: group, index: i };
    }
    if (child.type === "group") {
      const res = findParentOfNode(child, targetId);
      if (res) return res;
    }
  }
  return null;
}

// Remove node from tree by ID, returns [newGroup, removedNode]
export function removeNodeFromTree(
  group: FilterGroupNode,
  targetId: string
): { newGroup: FilterGroupNode; removedNode: FilterNode | null } {
  let removed: FilterNode | null = null;
  const newChildren: FilterNode[] = [];

  for (const child of group.children) {
    if (child.id === targetId) {
      removed = child;
      continue;
    }
    if (child.type === "group") {
      const res = removeNodeFromTree(child, targetId);
      newChildren.push(res.newGroup);
      if (res.removedNode) {
        removed = res.removedNode;
      }
    } else {
      newChildren.push(child);
    }
  }

  return {
    newGroup: {
      ...group,
      children: newChildren,
    },
    removedNode: removed,
  };
}

// Insert node into a specific group by groupId at index
export function insertNodeIntoGroup(
  group: FilterGroupNode,
  targetGroupId: string,
  targetIndex: number,
  nodeToInsert: FilterNode
): FilterGroupNode {
  if (group.id === targetGroupId) {
    const nextChildren = [...group.children];
    const idx = Math.max(0, Math.min(nextChildren.length, targetIndex));
    nextChildren.splice(idx, 0, nodeToInsert);
    return {
      ...group,
      children: nextChildren,
    };
  }

  return {
    ...group,
    children: group.children.map((child) => {
      if (child.type === "group") {
        return insertNodeIntoGroup(
          child,
          targetGroupId,
          targetIndex,
          nodeToInsert
        );
      }
      return child;
    }),
  };
}

// Move node from anywhere to target group at targetIndex
export function moveNodeInTree(
  root: FilterGroupNode,
  sourceId: string,
  targetGroupId: string,
  targetIndex: number
): FilterGroupNode {
  if (sourceId === targetGroupId) return root;

  const { newGroup: prunedRoot, removedNode } = removeNodeFromTree(
    root,
    sourceId
  );
  if (!removedNode) return root;

  // Prevent moving group into its own descendant
  if (removedNode.type === "group" && isDescendant(removedNode, targetGroupId)) {
    return root;
  }

  return insertNodeIntoGroup(
    prunedRoot,
    targetGroupId,
    targetIndex,
    removedNode
  );
}

// Move node sequentially through the tree (stepping into child groups, stepping out of groups)
export function moveNodeSequentially(
  root: FilterGroupNode,
  nodeId: string,
  direction: "up" | "down"
): FilterGroupNode {
  const parentInfo = findParentOfNode(root, nodeId);
  if (!parentInfo) return root;

  const { parentGroup, index } = parentInfo;

  if (direction === "down") {
    if (index < parentGroup.children.length - 1) {
      const nextSibling = parentGroup.children[index + 1];
      if (nextSibling.type === "group") {
        // Next sibling is a group -> Jump INTO group as first child
        return moveNodeInTree(root, nodeId, nextSibling.id, 0);
      } else {
        // Next sibling is a rule -> swap / move after it in same parent
        return moveNodeInTree(root, nodeId, parentGroup.id, index + 1);
      }
    } else {
      // At bottom of current group -> Jump OUT to grandparent after current parent group
      if (parentGroup.id === root.id) {
        // At bottom of root, nowhere to go
        return root;
      }
      const grandParentInfo = findParentOfNode(root, parentGroup.id);
      if (!grandParentInfo) return root;
      return moveNodeInTree(
        root,
        nodeId,
        grandParentInfo.parentGroup.id,
        grandParentInfo.index + 1
      );
    }
  } else {
    // direction === "up"
    if (index > 0) {
      const prevSibling = parentGroup.children[index - 1];
      if (prevSibling.type === "group") {
        // Prev sibling is a group -> Jump INTO group as last child
        return moveNodeInTree(
          root,
          nodeId,
          prevSibling.id,
          prevSibling.children.length
        );
      } else {
        // Prev sibling is a rule -> swap / move before it in same parent
        return moveNodeInTree(root, nodeId, parentGroup.id, index - 1);
      }
    } else {
      // At top of current group -> Jump OUT to grandparent before current parent group
      if (parentGroup.id === root.id) {
        // At top of root, nowhere to go
        return root;
      }
      const grandParentInfo = findParentOfNode(root, parentGroup.id);
      if (!grandParentInfo) return root;
      return moveNodeInTree(
        root,
        nodeId,
        grandParentInfo.parentGroup.id,
        grandParentInfo.index
      );
    }
  }
}

// Find a node anywhere in the tree
export function findNodeInTree(
  group: FilterGroupNode,
  targetId: string
): FilterNode | null {
  if (group.id === targetId) return group;
  for (const child of group.children) {
    if (child.id === targetId) return child;
    if (child.type === "group") {
      const found = findNodeInTree(child, targetId);
      if (found) return found;
    }
  }
  return null;
}

interface FilterGroupEditorProps {
  appState: AppState;
  stateRef: StateRef<AppState>;
  schema: reltab.Schema;
  group: FilterGroupNode;
  depth: number;
  onUpdateGroup: (nextGroup: FilterGroupNode) => void;
  onDeleteGroup?: () => void;
  // Drag and drop & reordering
  onMoveNode: (sourceId: string, targetGroupId: string, targetIndex: number) => void;
  onMoveSibling: (nodeId: string, direction: "up" | "down") => void;
  onMoveOut: (nodeId: string) => void;
  draggedId: string | null;
  setDraggedId: (id: string | null) => void;
  canMoveUpGroup?: boolean;
  canMoveDownGroup?: boolean;
  onMoveUpGroup?: () => void;
  onMoveDownGroup?: () => void;
  selectedId: string | null;
  onSelectNode: (id: string) => void;
}

export const FilterGroupEditor: React.FunctionComponent<FilterGroupEditorProps> = ({
  appState,
  stateRef,
  schema,
  group,
  depth,
  onUpdateGroup,
  onDeleteGroup,
  onMoveNode,
  onMoveSibling,
  onMoveOut,
  draggedId,
  setDraggedId,
  canMoveUpGroup,
  canMoveDownGroup,
  onMoveUpGroup,
  onMoveDownGroup,
  selectedId,
  onSelectNode,
}) => {
  const [dropTarget, setDropTarget] = useState<{
    targetId: string;
    position: "above" | "below";
  } | null>(null);
  const [isOverGroup, setIsOverGroup] = useState<boolean>(false);

  const handleOpChange = (nextOp: reltab.BoolOp) => {
    onUpdateGroup({
      ...group,
      op: nextOp,
    });
  };

  const handleAddRule = () => {
    const newRule: FilterRuleNode = {
      id: genNodeId(),
      type: "rule",
      relExp: null,
    };
    onUpdateGroup({
      ...group,
      children: group.children.concat(newRule),
    });
    onSelectNode(newRule.id);
  };

  const handleAddGroup = () => {
    const nextSubOp: reltab.BoolOp = group.op === "AND" ? "OR" : "AND";
    const firstRuleId = genNodeId();
    const newSubGroup: FilterGroupNode = {
      id: genNodeId(),
      type: "group",
      op: nextSubOp,
      children: [
        {
          id: firstRuleId,
          type: "rule",
          relExp: null,
        },
      ],
    };
    onUpdateGroup({
      ...group,
      children: group.children.concat(newSubGroup),
    });
    onSelectNode(firstRuleId);
  };

  const handleDeleteChild = (childId: string) => {
    if (selectedId === childId) {
      onSelectNode("");
    }
    onUpdateGroup({
      ...group,
      children: group.children.filter((c) => c.id !== childId),
    });
  };

  const handleUpdateChild = (childId: string, updated: FilterNode) => {
    onUpdateGroup({
      ...group,
      children: group.children.map((c) => (c.id === childId ? updated : c)),
    });
  };

  // Drag start for child rule or sub-group
  const handleDragStartChild = (e: React.DragEvent, childId: string) => {
    e.stopPropagation();
    e.dataTransfer.setData("application/toad-filter-node", childId);
    e.dataTransfer.effectAllowed = "move";
    setDraggedId(childId);
  };

  const handleDragEndChild = (e: React.DragEvent) => {
    e.stopPropagation();
    setDraggedId(null);
    setDropTarget(null);
    setIsOverGroup(false);
  };

  // Drag over child to determine above or below insertion
  const handleChildDragOver = (
    e: React.DragEvent,
    childId: string,
    childIndex: number
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedId || draggedId === childId) return;
    e.dataTransfer.dropEffect = "move";

    const rect = e.currentTarget.getBoundingClientRect();
    const isTop = e.clientY < rect.top + rect.height / 2;
    setDropTarget({
      targetId: childId,
      position: isTop ? "above" : "below",
    });
  };

  const handleChildDragLeave = (e: React.DragEvent) => {
    e.stopPropagation();
    setDropTarget(null);
  };

  const handleChildDrop = (
    e: React.DragEvent,
    childId: string,
    childIndex: number
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedId && draggedId !== childId) {
      const rect = e.currentTarget.getBoundingClientRect();
      const isTop = e.clientY < rect.top + rect.height / 2;
      const targetIdx = isTop ? childIndex : childIndex + 1;
      onMoveNode(draggedId, group.id, targetIdx);
    }
    setDraggedId(null);
    setDropTarget(null);
    setIsOverGroup(false);
  };

  // Drag over the group container itself (drag into this group)
  const handleContainerDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (
      draggedId &&
      draggedId !== group.id &&
      !isDescendant(group, draggedId)
    ) {
      e.dataTransfer.dropEffect = "move";
      setIsOverGroup(true);
    }
  };

  const handleContainerDragLeave = (e: React.DragEvent) => {
    // Only leave if leaving to outside the group element
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsOverGroup(false);
    }
  };

  const handleContainerDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOverGroup(false);
    if (
      draggedId &&
      draggedId !== group.id &&
      !isDescendant(group, draggedId)
    ) {
      // Append to this group
      onMoveNode(draggedId, group.id, group.children.length);
    }
    setDraggedId(null);
    setDropTarget(null);
  };

  const isRoot = depth === 0;
  const levelClass =
    depth === 0
      ? "filter-level-0"
      : depth === 1
      ? "filter-level-1"
      : depth === 2
      ? "filter-level-2"
      : "filter-level-deep";

  let groupContainerClasses =
    (isRoot ? "filter-editor-root-group " : "filter-editor-nested-group ") +
    levelClass;
  if (isOverGroup) {
    groupContainerClasses += " group-drag-over";
  }

  return (
    <div
      className={groupContainerClasses}
      onDragOver={handleContainerDragOver}
      onDragLeave={handleContainerDragLeave}
      onDrop={handleContainerDrop}
      data-group-id={group.id}
    >
      <div className="filter-editor-group-header">
        <div className="filter-editor-select-row">
          {!isRoot && (
            <div
              className="filter-drag-handle filter-group-drag-handle"
              draggable={true}
              onDragStart={(e) => handleDragStartChild(e, group.id)}
              onDragEnd={handleDragEndChild}
              title="Drag to reorder this group or move into another group"
            >
              <span className="bp4-icon bp4-icon-drag-handle-vertical" />
            </div>
          )}
          <div className="bp4-select bp4-minimal filter-op-selector">
            <select
              value={group.op}
              onChange={(e) => handleOpChange(e.target.value as reltab.BoolOp)}
            >
              <option value="AND">AND</option>
              <option value="OR">OR</option>
            </select>
          </div>
          <span className="filter-group-title-label">
            {isRoot ? "Root Filter Block" : `Subgroup Level ${depth}`}
          </span>
        </div>

        <div className="filter-group-header-actions">
          <Button
            className="bp4-minimal filter-btn-header-add"
            icon="add"
            small
            title="Add condition to this group"
            onClick={handleAddRule}
          />
          <Button
            className="bp4-minimal filter-btn-header-add"
            icon="folder-new"
            small
            title="Add subgroup inside this group"
            onClick={handleAddGroup}
          />
          {!isRoot && onDeleteGroup && (
            <Button
              className="bp4-minimal filter-btn-delete"
              icon="cross"
              small
              intent="danger"
              title="Delete this subgroup"
              onClick={onDeleteGroup}
            />
          )}
        </div>
      </div>

      <div className="filter-editor-group-children">
        {group.children.length === 0 ? (
          <div className="filter-group-empty-dropzone">
            <span>
              Drop conditions here or click "+" on header above
            </span>
          </div>
        ) : (
          group.children.map((child, index) => {
            const isTargetAbove =
              dropTarget &&
              dropTarget.targetId === child.id &&
              dropTarget.position === "above";
            const isTargetBelow =
              dropTarget &&
              dropTarget.targetId === child.id &&
              dropTarget.position === "below";

            if (child.type === "rule") {
              return (
                <FilterEditorRow
                  appState={appState}
                  stateRef={stateRef}
                  key={child.id}
                  rowId={child.id}
                  schema={schema}
                  relExp={child.relExp as any}
                  onDeleteRow={() => handleDeleteChild(child.id)}
                  onUpdate={(re) =>
                    handleUpdateChild(child.id, {
                      ...child,
                      relExp: re,
                    })
                  }
                  isSelected={selectedId === child.id}
                  onSelectRow={() => onSelectNode(child.id)}
                  isDragging={draggedId === child.id}
                  dropPosition={
                    isTargetAbove ? "above" : isTargetBelow ? "below" : null
                  }
                  onDragStart={(e) => handleDragStartChild(e, child.id)}
                  onDragEnd={handleDragEndChild}
                  onDragOver={(e) => handleChildDragOver(e, child.id, index)}
                  onDragLeave={handleChildDragLeave}
                  onDrop={(e) => handleChildDrop(e, child.id, index)}
                />
              );
            } else {
              let childGroupWrapperClass = "filter-group-child-wrapper";
              if (isTargetAbove)
                childGroupWrapperClass += " drop-target-above";
              if (isTargetBelow)
                childGroupWrapperClass += " drop-target-below";

              return (
                <div
                  key={child.id}
                  className={childGroupWrapperClass}
                  onDragOver={(e) => handleChildDragOver(e, child.id, index)}
                  onDragLeave={handleChildDragLeave}
                  onDrop={(e) => handleChildDrop(e, child.id, index)}
                >
                  <FilterGroupEditor
                    appState={appState}
                    stateRef={stateRef}
                    schema={schema}
                    group={child}
                    depth={depth + 1}
                    onUpdateGroup={(nextSub) =>
                      handleUpdateChild(child.id, nextSub)
                    }
                    onDeleteGroup={() => handleDeleteChild(child.id)}
                    onMoveNode={onMoveNode}
                    onMoveSibling={onMoveSibling}
                    onMoveOut={onMoveOut}
                    draggedId={draggedId}
                    setDraggedId={setDraggedId}
                    canMoveUpGroup={index > 0}
                    canMoveDownGroup={index < group.children.length - 1}
                    onMoveUpGroup={() => onMoveSibling(child.id, "up")}
                    onMoveDownGroup={() => onMoveSibling(child.id, "down")}
                    selectedId={selectedId}
                    onSelectNode={onSelectNode}
                  />
                </div>
              );
            }
          })
        )}
      </div>
    </div>
  );
};

const countIncompleteRules = (group: FilterGroupNode): number => {
  let count = 0;
  for (const child of group.children) {
    if (child.type === "rule") {
      if (child.relExp == null) {
        count++;
      }
    } else if (child.type === "group") {
      count += countIncompleteRules(child);
    }
  }
  return count;
};

export type FilterApplyState = "idle" | "applying" | "applied";

export const FilterEditor: React.FunctionComponent<FilterEditorProps> = ({
  appState,
  stateRef,
  schema,
  filterExp,
  liveUpdate,
  onToggleLiveUpdate,
  onQueryChange,
  onCancel,
  onApply,
  onDone,
}) => {
  const [rootGroup, setRootGroup] = useState<FilterGroupNode>(() =>
    filterExpToTree(filterExp)
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [applyState, setApplyState] = useState<FilterApplyState>("idle");
  const isWaitingForQueryRef = useRef<boolean>(false);
  const appliedSqlRef = useRef<string | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"tree" | "raw">("tree");
  const [rawSqlText, setRawSqlText] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);
  const queryStartRef = useRef<number>(performance.now());
  const [latency, setLatency] = useState<number>(1.2);

  const queryView = appState.viewState.queryView;
  const totalRows = queryView?.baseRowCount ?? 0;
  const matchedRows = queryView?.filterRowCount ?? queryView?.rowCount ?? 0;

  useEffect(() => {
    try {
      appliedSqlRef.current = (filterExp || new FilterExp()).toSqlWhere(getDefaultDialect());
    } catch {
      appliedSqlRef.current = null;
    }
  }, []);



  // Auto-select first available condition if none selected
  useEffect(() => {
    if (selectedId) {
      const found = findNodeInTree(rootGroup, selectedId);
      if (!found) {
        setSelectedId(null);
      }
    } else if (rootGroup.children.length > 0) {
      const first = rootGroup.children[0];
      if (first.type === "rule") {
        setSelectedId(first.id);
      } else if (first.type === "group" && first.children.length > 0) {
        setSelectedId(first.children[0].id);
      }
    }
  }, [rootGroup, selectedId]);

  // Listen for query errors dispatched from PivotRequester or reltab
  useEffect(() => {
    const handleError = (e: any) => {
      const msg = e?.detail?.message || "DuckDB query error";
      isWaitingForQueryRef.current = false;
      setApplyState("idle");
      setQueryError(msg);
      setTimeout(() => setQueryError(null), 8000);
    };
    window.addEventListener("toad-query-error", handleError);
    window.addEventListener("tad-query-error", handleError);
    return () => {
      window.removeEventListener("toad-query-error", handleError);
      window.removeEventListener("tad-query-error", handleError);
    };
  }, []);

  // Synchronize rootGroup whenever filterExp changes from outside (e.g. Add Rule from Event Details or cell context menu)
  useEffect(() => {
    try {
      const currentSql = treeToFilterExp(rootGroup).toSqlWhere(getDefaultDialect());
      const incomingSql = (filterExp || new FilterExp()).toSqlWhere(getDefaultDialect());
      if (currentSql !== incomingSql) {
        setRootGroup(filterExpToTree(filterExp));
      }
    } catch (err) {
      console.warn("FilterEditor: failed to compare or sync filterExp:", err);
      setRootGroup(filterExpToTree(filterExp));
    }
  }, [filterExp]);

  const currentFE = useMemo(() => treeToFilterExp(rootGroup), [rootGroup]);
  const incompleteCount = useMemo(() => countIncompleteRules(rootGroup), [rootGroup]);

  const selectedNode = useMemo(
    () => (selectedId ? findNodeInTree(rootGroup, selectedId) : null),
    [rootGroup, selectedId]
  );

  const selectedDesc = useMemo(() => {
    if (!selectedNode) return null;
    if (selectedNode.type === "rule") {
      if (selectedNode.relExp) {
        try {
          return selectedNode.relExp.toSqlWhere(getDefaultDialect());
        } catch {
          return "Condition";
        }
      }
      return "Condition (Empty)";
    } else if (selectedNode.type === "group") {
      return `Group (${selectedNode.op})`;
    }
    return null;
  }, [selectedNode]);

  const previewSql = useMemo(() => {
    try {
      const sql = currentFE.toSqlWhere(getDefaultDialect());
      return sql && sql.trim().length > 0 ? sql : null;
    } catch (err) {
      return null;
    }
  }, [currentFE]);

  const displaySql = useMemo(() => {
    if (viewMode === "raw") {
      return rawSqlText.trim().length > 0 ? rawSqlText.trim() : null;
    }
    return previewSql;
  }, [viewMode, rawSqlText, previewSql]);

  useEffect(() => {
    if (queryView) {
      const elapsed = Math.max(
        0.4,
        Number((performance.now() - queryStartRef.current).toFixed(1))
      );
      setLatency(elapsed);

      // ONLY WHEN DUCKDB QUERY COMPLETES AND WE WERE WAITING FOR IT:
      if (isWaitingForQueryRef.current) {
        isWaitingForQueryRef.current = false;
        appliedSqlRef.current = displaySql;
        setApplyState("applied");
        const timer = setTimeout(() => {
          setApplyState("idle");
        }, 1800);
        return () => clearTimeout(timer);
      }
    }
  }, [queryView, displaySql]);

  const handleCopySql = () => {
    if (displaySql) {
      navigator.clipboard.writeText(`WHERE ${displaySql}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const handleApply = useCallback(() => {
    setQueryError(null);
    const targetSql = displaySql;
    // Fast-path: If this filter is already applied and no query is currently running
    if (
      appliedSqlRef.current === targetSql &&
      !appState.viewState?.loadingTimer?.running
    ) {
      setApplyState("applied");
      const timer = setTimeout(() => {
        setApplyState("idle");
      }, 1800);
      return;
    }

    queryStartRef.current = performance.now();
    isWaitingForQueryRef.current = true;
    setApplyState("applying");

    if (viewMode === "raw") {
      const rawFE = new FilterExp("AND", [new RawSqlRelExp(rawSqlText)]);
      onApply(rawFE);
    } else {
      onApply(currentFE);
    }
  }, [viewMode, rawSqlText, currentFE, displaySql, onApply, appState.viewState]);

  // Synchronize query: Every action on rootGroup immediately notifies onQueryChange
  const handleUpdateRoot = (nextRoot: FilterGroupNode) => {
    setRootGroup(nextRoot);
    const nextFE = treeToFilterExp(nextRoot);
    queryStartRef.current = performance.now();
    onQueryChange(nextFE);
  };

  // Move node anywhere in the tree (drag & drop)
  const handleMoveNode = useCallback(
    (sourceId: string, targetGroupId: string, targetIndex: number) => {
      setRootGroup((currentRoot) => {
        const next = moveNodeInTree(
          currentRoot,
          sourceId,
          targetGroupId,
          targetIndex
        );
        const nextFE = treeToFilterExp(next);
        onQueryChange(nextFE);
        return next;
      });
    },
    [onQueryChange]
  );

  // Sequential Move (jumping into subgroups / jumping out to parent)
  const handleSequentialMove = useCallback(
    (direction: "up" | "down") => {
      if (!selectedId) return;
      setRootGroup((currentRoot) => {
        const next = moveNodeSequentially(currentRoot, selectedId, direction);
        const nextFE = treeToFilterExp(next);
        onQueryChange(nextFE);
        return next;
      });
      setTimeout(() => {
        const el = document.querySelector(`[data-rule-id="${selectedId}"]`);
        if (el && typeof el.scrollIntoView === "function") {
          el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }, 50);
    },
    [selectedId, onQueryChange]
  );

  // Move sibling up or down within parent
  const handleMoveSibling = useCallback(
    (nodeId: string, direction: "up" | "down") => {
      setRootGroup((currentRoot) => {
        const parentInfo = findParentOfNode(currentRoot, nodeId);
        if (!parentInfo) return currentRoot;
        const { parentGroup, index } = parentInfo;
        const targetIndex = direction === "up" ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= parentGroup.children.length) {
          return currentRoot;
        }
        const next = moveNodeInTree(currentRoot, nodeId, parentGroup.id, targetIndex);
        const nextFE = treeToFilterExp(next);
        onQueryChange(nextFE);
        return next;
      });
    },
    [onQueryChange]
  );

  // Move out of current group into parent group
  const handleMoveOut = useCallback(
    (nodeId: string) => {
      setRootGroup((currentRoot) => {
        const parentInfo = findParentOfNode(currentRoot, nodeId);
        if (!parentInfo) return currentRoot;
        const { parentGroup } = parentInfo;

        const grandParentInfo = findParentOfNode(currentRoot, parentGroup.id);
        if (!grandParentInfo) return currentRoot;
        const { parentGroup: grandParent, index: parentIndexInGrandParent } =
          grandParentInfo;

        // Move into grandParent right after parentGroup
        const next = moveNodeInTree(
          currentRoot,
          nodeId,
          grandParent.id,
          parentIndexInGrandParent + 1
        );
        const nextFE = treeToFilterExp(next);
        onQueryChange(nextFE);
        return next;
      });
    },
    [onQueryChange]
  );

  const handleDone = () => {
    handleApply();
    onDone();
  };

  const handleClearAll = () => {
    queryStartRef.current = performance.now();
    if (viewMode === "raw") {
      setRawSqlText("");
      onQueryChange(new FilterExp());
      return;
    }
    const emptyRuleId = genNodeId();
    const emptyGroup: FilterGroupNode = {
      id: genNodeId(),
      type: "group",
      op: "AND",
      children: [
        {
          id: emptyRuleId,
          type: "rule",
          relExp: null,
        },
      ],
    };
    setRootGroup(emptyGroup);
    setSelectedId(emptyRuleId);
    onQueryChange(new FilterExp());
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleApply();
  };

  // Keyboard navigation & Escape key listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selectedId) {
          setSelectedId(null);
        } else {
          onCancel();
        }
        return;
      }

      if (!selectedId || viewMode === "raw") return;

      const activeEl = document.activeElement;
      const isInput =
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.tagName === "SELECT");

      if (e.key === "ArrowDown") {
        if (!isInput || e.altKey) {
          e.preventDefault();
          handleSequentialMove("down");
        }
      } else if (e.key === "ArrowUp") {
        if (!isInput || e.altKey) {
          e.preventDefault();
          handleSequentialMove("up");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId, viewMode, handleSequentialMove, onCancel]);

  return (
    <form className="filter-editor" onSubmit={handleFormSubmit}>
      {/* Top action bar: Pure UX ~32px */}
      <div className="filter-editor-top-toolbar">
        <div className="filter-toolbar-left">
          {/* View Mode Switcher: Tree View ⇄ Raw SQL */}
          <div className="bp4-button-group bp4-minimal filter-view-mode-group">
            <Button
              type="button"
              className={`filter-btn-mode ${
                viewMode === "tree" ? "bp4-active" : ""
              }`}
              small
              text="Tree View"
              onClick={() => setViewMode("tree")}
            />
            <Button
              type="button"
              className={`filter-btn-mode ${
                viewMode === "raw" ? "bp4-active" : ""
              }`}
              small
              text="Raw SQL"
              onClick={() => {
                if (!rawSqlText) {
                  const sql = currentFE.toSqlWhere(getDefaultDialect());
                  setRawSqlText(sql || "");
                }
                setViewMode("raw");
              }}
            />
          </div>

          <label
            className="bp4-control bp4-checkbox filter-realtime-checkbox"
            title="When checked, filters query and updates the main table immediately in real-time."
          >
            <input
              type="checkbox"
              checked={liveUpdate}
              onChange={(e) => onToggleLiveUpdate(e.target.checked)}
            />
            <span className="bp4-control-indicator" />
            <span className="filter-checkbox-label">Live update</span>
          </label>

          {incompleteCount > 0 && viewMode === "tree" && (
            <span
              className="filter-incomplete-warning"
              title={`${incompleteCount} rule(s) are incomplete and ignored until filled`}
            >
              ⚠ {incompleteCount} incomplete rule{incompleteCount > 1 ? "s" : ""}
            </span>
          )}

          {/* Grayscale Selected Row Dock in Toolbar (only in tree view) */}
          {viewMode === "tree" && selectedId && selectedDesc && (
            <div
              className="filter-selected-dock"
              title="Selected condition: use ↑ / ↓ arrow keys to step into subgroups or reorder"
            >
              <span className="dock-label">Selected:</span>
              <span className="dock-title">{selectedDesc}</span>
              <span className="dock-hint">
                Keys: <strong>↑ / ↓</strong>
              </span>
              <div className="dock-actions">
                <Button
                  type="button"
                  className="bp4-minimal filter-btn-dock"
                  icon="arrow-up"
                  small
                  title="Move condition up / jump into previous subgroup (Arrow Up)"
                  onClick={() => handleSequentialMove("up")}
                />
                <Button
                  type="button"
                  className="bp4-minimal filter-btn-dock"
                  icon="arrow-down"
                  small
                  title="Move condition down / jump into next subgroup (Arrow Down)"
                  onClick={() => handleSequentialMove("down")}
                />
              </div>
            </div>
          )}
        </div>

        {/* Toolbar right: Clear, Apply, Close aligned right */}
        <div className="filter-toolbar-right">
          <Button
            type="button"
            className="bp4-minimal filter-btn-clear"
            icon="trash"
            text="Clear"
            title="Reset and clear all conditions"
            onClick={handleClearAll}
          />
          <Button
            type="button"
            className={`filter-btn-apply ${
              applyState === "applied"
                ? "bp4-intent-success is-applied"
                : applyState === "applying"
                ? "bp4-intent-primary is-applying"
                : "bp4-intent-primary"
            }`}
            icon={
              applyState === "applied" ? (
                "tick"
              ) : applyState === "applying" ? (
                <Spinner size={12} intent={Intent.PRIMARY} />
              ) : (
                "play"
              )
            }
            text={
              applyState === "applied"
                ? "Applied! ✓"
                : applyState === "applying"
                ? "Applying..."
                : "Apply"
            }
            disabled={liveUpdate || applyState === "applying"}
            title={
              liveUpdate
                ? "Live update is enabled (table updates automatically)"
                : applyState === "applying"
                ? "Executing DuckDB query..."
                : "Apply filter to main table (or press Enter)"
            }
            onClick={handleApply}
          />
          <Button
            type="button"
            className="bp4-minimal filter-btn-close"
            icon="cross"
            title="Close filter panel (or press Esc to cancel)"
            onClick={handleDone}
          />
        </div>
      </div>

      {queryError && (
        <div className="filter-editor-error-banner">
          <span>
            <strong>Query Error:</strong> {queryError}
          </span>
          <Button
            type="button"
            className="bp4-minimal bp4-small"
            icon="cross"
            onClick={() => setQueryError(null)}
          />
        </div>
      )}

      {/* Main View Area: Either Raw SQL textarea pane or Tree View scroll pane */}
      {viewMode === "raw" ? (
        <div className="filter-raw-sql-pane">
          <textarea
            className="filter-raw-sql-textarea"
            value={rawSqlText}
            placeholder="Enter raw SQL WHERE predicate (e.g. Channel = 'Microsoft-Windows-Sysmon/Operational' AND EventID IN (1, 3, 11))..."
            onChange={(e) => {
              const val = e.target.value;
              setRawSqlText(val);
              if (liveUpdate) {
                queryStartRef.current = performance.now();
                const rawFE = new FilterExp("AND", [new RawSqlRelExp(val)]);
                onQueryChange(rawFE);
              }
            }}
          />
        </div>
      ) : (
        <div className="filter-editor-scroll-pane">
          <FilterGroupEditor
            appState={appState}
            stateRef={stateRef}
            schema={schema}
            group={rootGroup}
            depth={0}
            onUpdateGroup={handleUpdateRoot}
            onMoveNode={handleMoveNode}
            onMoveSibling={handleMoveSibling}
            onMoveOut={handleMoveOut}
            draggedId={draggedId}
            setDraggedId={setDraggedId}
            selectedId={selectedId}
            onSelectNode={setSelectedId}
          />
        </div>
      )}

      {/* Bottom Footer: SQL Preview + 1-Click Copy + Matched Rows & Query Latency */}
      <div className="filter-editor-footer">
        <div className="sql-preview-wrap">
          <span className="filter-preview-label">SQL:</span>
          <code
            className="filter-preview-code"
            title={displaySql || "No active filter"}
          >
            {displaySql ? `WHERE ${displaySql}` : "No active filter"}
          </code>
          {displaySql && (
            <Button
              type="button"
              className="bp4-minimal filter-btn-copy-sql"
              small
              icon={copied ? "tick" : "clipboard"}
              text={copied ? "Copied!" : "Copy"}
              title="Copy SQL WHERE clause to clipboard"
              onClick={handleCopySql}
            />
          )}
        </div>
        <div className="filter-stats">
          <span>
            Matched:{" "}
            <strong className="stat-matched">
              {matchedRows.toLocaleString()}
            </strong>{" "}
            / {totalRows.toLocaleString()} rows
          </span>
          <span className="stat-latency-divider">|</span>
          <span>
            Latency: <strong>{latency}ms</strong>
          </span>
        </div>
      </div>
    </form>
  );
};
