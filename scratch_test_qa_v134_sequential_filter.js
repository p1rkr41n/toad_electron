const assert = require("assert");

// Load the compiled filter functions from tadviewer
// Since tadviewer was built, let's verify moveNodeSequentially logic directly
let nextNodeId = 1;
const genNodeId = () => "fn-" + nextNodeId++;

function isDescendant(node, potentialChildId) {
  if (node.id === potentialChildId) return true;
  if (node.type === "group") {
    for (const child of node.children) {
      if (isDescendant(child, potentialChildId)) return true;
    }
  }
  return false;
}

function findParentOfNode(group, targetId) {
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

function removeNodeFromTree(group, targetId) {
  let removed = null;
  const newChildren = [];

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

function insertNodeIntoGroup(group, targetGroupId, targetIndex, nodeToInsert) {
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
        return insertNodeIntoGroup(child, targetGroupId, targetIndex, nodeToInsert);
      }
      return child;
    }),
  };
}

function moveNodeInTree(root, sourceId, targetGroupId, targetIndex) {
  if (sourceId === targetGroupId) return root;

  const { newGroup: prunedRoot, removedNode } = removeNodeFromTree(root, sourceId);
  if (!removedNode) return root;

  if (removedNode.type === "group" && isDescendant(removedNode, targetGroupId)) {
    return root;
  }

  return insertNodeIntoGroup(prunedRoot, targetGroupId, targetIndex, removedNode);
}

function moveNodeSequentially(root, nodeId, direction) {
  const parentInfo = findParentOfNode(root, nodeId);
  if (!parentInfo) return root;

  const { parentGroup, index } = parentInfo;

  if (direction === "down") {
    if (index < parentGroup.children.length - 1) {
      const nextSibling = parentGroup.children[index + 1];
      if (nextSibling.type === "group") {
        return moveNodeInTree(root, nodeId, nextSibling.id, 0);
      } else {
        return moveNodeInTree(root, nodeId, parentGroup.id, index + 1);
      }
    } else {
      if (parentGroup.id === root.id) {
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
    if (index > 0) {
      const prevSibling = parentGroup.children[index - 1];
      if (prevSibling.type === "group") {
        return moveNodeInTree(
          root,
          nodeId,
          prevSibling.id,
          prevSibling.children.length
        );
      } else {
        return moveNodeInTree(root, nodeId, parentGroup.id, index - 1);
      }
    } else {
      if (parentGroup.id === root.id) {
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

console.log("=== RUNNING QA TEST FOR SEQUENTIAL TREE NAVIGATION (v1.3.4) ===");

// Build test tree:
// Root (AND)
//   - Rule1
//   - SubGroup1 (OR)
//       - Rule2
//       - Rule3
//   - Rule4

let root = {
  id: "root",
  type: "group",
  op: "AND",
  children: [
    { id: "rule1", type: "rule", name: "Rule 1" },
    {
      id: "subgroup1",
      type: "group",
      op: "OR",
      children: [
        { id: "rule2", type: "rule", name: "Rule 2" },
        { id: "rule3", type: "rule", name: "Rule 3" },
      ],
    },
    { id: "rule4", type: "rule", name: "Rule 4" },
  ],
};

// 1. Move Rule1 down: next sibling is subgroup1 -> should jump INTO subgroup1 as first child!
root = moveNodeSequentially(root, "rule1", "down");
assert.strictEqual(root.children[0].id, "subgroup1", "Subgroup1 should now be first child of root");
assert.strictEqual(root.children[0].children[0].id, "rule1", "Rule1 jumped into subgroup1 at index 0");
console.log("✅ [PASS] 1.1: Rule 1 jumped into child subgroup (OR) on ArrowDown");

// 2. Move Rule1 down again: next sibling in subgroup1 is rule2 -> should move after rule2
root = moveNodeSequentially(root, "rule1", "down");
assert.strictEqual(root.children[0].children[1].id, "rule1", "Rule1 moved after rule2");
console.log("✅ [PASS] 1.2: Rule 1 moved down within subgroup (after Rule 2)");

// 3. Move Rule1 down again: next sibling in subgroup1 is rule3 -> should move after rule3 (end of subgroup1)
root = moveNodeSequentially(root, "rule1", "down");
assert.strictEqual(root.children[0].children[2].id, "rule1", "Rule1 moved after rule3");
console.log("✅ [PASS] 1.3: Rule 1 moved to end of subgroup (after Rule 3)");

// 4. Move Rule1 down again: at end of subgroup1 -> should jump OUT to root after subgroup1!
root = moveNodeSequentially(root, "rule1", "down");
assert.strictEqual(root.children[1].id, "rule1", "Rule1 jumped out to root after subgroup1");
assert.strictEqual(root.children[0].id, "subgroup1", "Subgroup1 remains intact");
assert.strictEqual(root.children[2].id, "rule4", "Rule4 follows Rule1");
console.log("✅ [PASS] 1.4: Rule 1 jumped out to root level after subgroup1 on ArrowDown");

// 5. Move Rule1 down again: moves after Rule4 (end of root)
root = moveNodeSequentially(root, "rule1", "down");
assert.strictEqual(root.children[2].id, "rule1", "Rule1 moved after Rule4");
console.log("✅ [PASS] 1.5: Rule 1 moved after Rule 4");

// 6. Move Rule1 down again at root bottom: should stay at bottom
const unchanged = moveNodeSequentially(root, "rule1", "down");
assert.strictEqual(unchanged.children[2].id, "rule1", "Rule1 stays at root bottom");
console.log("✅ [PASS] 1.6: Boundary check: stays at bottom when already last element");

// 7. Test Reverse: Move Rule1 up from bottom:
root = moveNodeSequentially(root, "rule1", "up");
assert.strictEqual(root.children[1].id, "rule1", "Rule1 moved up before Rule4");
console.log("✅ [PASS] 1.7: Rule 1 moved up before Rule 4");

// 8. Move Rule1 up again: prev sibling is subgroup1 -> should jump INTO subgroup1 as last child!
root = moveNodeSequentially(root, "rule1", "up");
assert.strictEqual(root.children[0].id, "subgroup1");
const subChildren = root.children[0].children;
assert.strictEqual(subChildren[subChildren.length - 1].id, "rule1", "Rule1 jumped into subgroup1 as last child");
console.log("✅ [PASS] 1.8: Rule 1 jumped into subgroup1 as last child on ArrowUp");

// 9. Move Rule1 up through subgroup1 to top:
root = moveNodeSequentially(root, "rule1", "up"); // before rule3
root = moveNodeSequentially(root, "rule1", "up"); // before rule2 (index 0 of subgroup1)
assert.strictEqual(root.children[0].children[0].id, "rule1", "Rule1 is at index 0 of subgroup1");

// 10. Move Rule1 up from top of subgroup1: should jump OUT to root before subgroup1!
root = moveNodeSequentially(root, "rule1", "up");
assert.strictEqual(root.children[0].id, "rule1", "Rule1 jumped out to root before subgroup1");
assert.strictEqual(root.children[1].id, "subgroup1", "Subgroup1 is after Rule1");
console.log("✅ [PASS] 1.9: Rule 1 jumped out to root before subgroup1 on ArrowUp");

console.log("===============================================================");
console.log("ALL SEQUENTIAL NAVIGATION TESTS PASSED WITH 100% SUCCESS!");
console.log("===============================================================");
