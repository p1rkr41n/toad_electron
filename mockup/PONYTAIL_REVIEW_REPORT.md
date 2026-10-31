# Ponytail Code Review Report: Toad v2.0.11

> **Review Scope**: Full repository codebase review with emphasis on recent changes: `Sidebar.tsx`, `sidebar.less`, `EventDetailSidebar.tsx`, `Footer.tsx`, `DataGrid.tsx`, `actions.ts`, and `RegexDialog.tsx`.  
> **Standards applied**: Ponytail Review Guidelines (Correctness > Safety > Load > Tests > Speed > Lean).  
> **Expected load**: Desktop application handling tabular datasets up to 100M rows with DuckDB engine, multiple simultaneous file extractions, and rapid UI panel interactions.

---

### What this change does:
The recent updates introduced Toad v2.0.11, fixing the sticky blue bar on the primary Sidebar resizer through a triple safety guard (`blur`, `mouseleave`, unmount cleanup), adding a 1px idle border with a slim 2px Blueprint indicator, and providing a double-click reset width capability. This review inspects the entire connected codebase to uncover any remaining event leaks, memory leaks, uncaught edge cases, or bloat across all UI resizers and data extraction pipelines.

---

## Must fix (Bắt buộc phải sửa)

### 1. `Footer.tsx` Resizer Mouse Event Leak (`packages/tadviewer/src/components/Footer.tsx:L167-187`)
* **What this is**: The horizontal drag handle (`.footer-resizer-bar`) that allows users to resize the bottom filter and SQL query pane.
* **Problem**: When a user drags the footer handle upward or downward and releases the mouse outside the window or switches applications with `Alt+Tab`, the `window.mouseup` event is never triggered. `isResizing` stays `true` indefinitely, locking `.footer-resizer-bar` into a permanent bright blue state (`#2b95d6 !important`) and keeping `user-select: none` enabled across the entire window.
* **Fix**: Register `window.addEventListener("blur", handleMouseUp)` and `document.addEventListener("mouseleave", handleMouseUp)` inside the resizing `useEffect` in `Footer.tsx`, and clean them up on release.
* **If we skip it**: Users dragging the bottom bar will regularly find it stuck in bright blue with disabled text selection until they click the bar a second time.

### 2. `EventDetailSidebar.tsx` Resizer Mouse Event & Unmount Leak (`packages/tadviewer/src/components/EventDetailSidebar.tsx:L138-166`)
* **What this is**: The left-edge draggable resizer for the Event Details inspector panel that opens when viewing deep row properties.
* **Problem**: `handleMouseDown` does not call `e.preventDefault()` or `e.stopPropagation()`, causing accidental text selection during drags. Even worse, if dragging is interrupted by a window blur or if the user presses `Escape` to close the panel while the mouse is down, `isDraggingRef` stays `true`, `mousemove`/`mouseup` listeners leak on `window`, and `document.body.style.cursor` remains frozen at `"col-resize"`.
* **Fix**: Add `e.preventDefault()`, attach `blur` and `mouseleave` listeners to trigger release, and add a `useEffect` cleanup hook that resets `document.body.style.cursor = ""` if the component unmounts mid-drag.
* **If we skip it**: Closing the event details sidebar while dragging locks the mouse pointer into a double-ended arrow across the entire application.

---

## Should fix (Nên sửa sớm)

### 3. `DataGrid.tsx` Leaking Document Copy Event Listeners (`packages/tadviewer/src/components/DataGrid.tsx:L518-526`)
* **What this is**: A global document clipboard listener enabling the native Electron copy menu item for selected SlickGrid cells.
* **Problem**: In `createGrid()`, `document.addEventListener("copy", ...)` registers an anonymous listener without ever calling `removeEventListener`. Every time a user opens a new file, re-orders columns, or switches views, another copy listener is added to `document`, causing duplicate clipboard operations and preventing garbage collection of destroyed grid instances.
* **Fix**: Store the listener reference on the grid instance and remove it in the grid teardown routine, or attach the listener to the container element instead of `document`.
* **If we skip it**: Navigating between many tables gradually leaks memory and triggers multiple duplicate copy handler executions per keystroke.

### 4. Uncaught SyntaxError on Invalid Regex Patterns in `actions.ts` (`packages/tadviewer/src/actions.ts:L1396-1397`)
* **What this is**: Helper logic in `applyRegexExtraction` that counts regex capture groups to generate output column schemas.
* **Problem**: `new RegExp(regexPattern + "|").exec("")` throws an uncaught JavaScript `SyntaxError` if the user enters an invalid regex (e.g. an unclosed parenthesis `([a-z]+` or unescaped bracket `[`). This uncaught error breaks the async execution chain and leaves the dialog without an actionable error message.
* **Fix**: Wrap `new RegExp` in a `try...catch` block falling back to `captureGroupCount = 0`, matching the resilient error handling used elsewhere in `RegexDialog.tsx`.
* **If we skip it**: Any malformed regex input immediately crashes the extraction action instead of displaying a helpful validation message.

---

## Nice to have (Tối ưu hóa gia tăng)

### 5. Endless Suffix Compounding on Chained View Extractions (`packages/tadviewer/src/actions.ts:L1073`)
* **What this is**: The automatic naming convention for DuckDB extraction views (`${currentTableName}_rx${regexViewSeq++}`).
* **Problem**: Chaining multiple extractions on the same dataset produces bloated table names like `logs_rx1_rx2_rx3_rx4`, which clutter the SQL preview query and the active table list.
* **Fix**: Strip existing `_rx\d+$` suffixes before appending the new sequence number: `${currentTableName.replace(/_rx\d+$/, "")}_rx${regexViewSeq++}`.
* **If we skip it**: View names become awkwardly long when repeatedly parsing complex semi-structured logs.

### 6. Double Render Cycle in Footer Filter Synchronization (`packages/tadviewer/src/components/Footer.tsx:L46-54`)
* **What this is**: Synchronization effect keeping local `appliedFE` and `activeFE` in sync with `appState.viewState.viewParams.filterExp`.
* **Problem**: When switching views, `useEffect` calls `setAppliedFE` and `setActiveFE` in sequence, causing two back-to-back render passes for the footer and filter editor.
* **Fix**: Check `currentAppFE.equals(appliedFE)` before triggering state updates to short-circuit redundant renders.
* **If we skip it**: The footer renders an extra unnecessary frame during table navigation.

---

### Verdict:
**Fix 1 and 2 first.** (Both `Footer.tsx` and `EventDetailSidebar.tsx` still possess the exact same mouse event leak and stuck blue bar defects that we just eliminated from `Sidebar.tsx`).

### Lean:
`-18 lines possible` by sharing the resizer safety hook across all three panels (`Sidebar`, `Footer`, `EventDetailSidebar`).

### Not checked:
Native C++ DuckDB SIMD extensions on Linux/macOS architectures (testing was performed on Windows x64 build environment).

