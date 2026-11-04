# Adversarial Analysis — Sidebar File Table Column Resizing & Active Row Auto-Wrap

**Agent Archetype**: EMPIRICAL CHALLENGER (critic, specialist)  
**Target Codebase**: `tad-master/packages/toadviewer/src/components/ProjectFilesTable.tsx`, `sidebar.less`, `tests/unit/test_project_files_table_wrap_resize.js`  
**Harness Executed**: `tests/qa/test_challenger_sidebar_stress.js` (24 test cases)  
**Overall Verdict**: **REQUEST_CHANGES**  

---

## 1. Executive Summary

As Teamwork Challenger 2, an empirical stress harness (`tests/qa/test_challenger_sidebar_stress.js`) was engineered and executed against the Sidebar File Table column resizing, boundary clamping, auto-fit calculation, 50-row auto-wrap lifecycle, and DOM event propagation models.

Out of 24 adversarial challenge test cases:
- **21 PASSED** (87.5%): 0-file and extreme payload auto-fit clamping within $[45, 400]\text{px}$, 50-row selection state invariance across 10,000 Monte Carlo fuzzing interactions, toggle click collapse, cross-platform path slash normalization, and resizer `mousedown`/`dblclick` propagation stopping.
- **3 FAILED** (12.5%):
  1. **NaN / Non-Finite Coordinate Corrupts Column Width**: Drag resizing calculations in `ProjectFilesTable.tsx:353-358` compute `Math.max(MIN_COL_WIDTH, draggingRef.current.startWidth + delta)`. When `moveEvt.clientX` is `NaN` or `undefined`, `Math.max(45, NaN)` evaluates to `NaN`. In JavaScript, `!(NaN >= 45)`, which violates the `>= 45px` clamping boundary and injects `NaN` into React style attributes (`<col style={{ width: NaN }} />`), breaking table column geometry.
  2. **Undefined clientX Coordinate Evaluates to NaN**: Bypasses the lower clamp boundary and corrupts state.
  3. **Event Isolation Leak on Resizer Handles (`col-resizer-handle`)**: In `ProjectFilesTable.tsx` (lines 500-504, 540-544, 580-584, 620-624), `.col-resizer-handle` hooks `onMouseDown` and `onDoubleClick` with `stopPropagation()`, but **completely lacks an `onClick` handler**. Consequently, when a user clicks the handle, double-clicks to auto-fit, or finishes a drag resize with mouseup over the handle, the browser dispatches a `click` event that **bubbles directly to the parent `th.onClick`**, inadvertently executing `toggleColumnFilter(col, e)` and popping open the column filter input (`<input className="col-filter-input" ... autoFocus />`).

---

## 2. Challenge 1: Column Resizing & Clamping Boundaries

### 2.1 Empirical Observations
In `ProjectFilesTable.tsx` (lines 353-358):
```typescript
const onMouseMove = (moveEvt: MouseEvent) => {
  if (!draggingRef.current) return;
  const delta = moveEvt.clientX - draggingRef.current.startX;
  const newWidth = Math.max(MIN_COL_WIDTH, draggingRef.current.startWidth + delta);
  setColWidths((prev) => ({
    ...prev,
    [draggingRef.current!.col]: newWidth,
  }));
};
```

| Input Vector | Computed Delta | Computed Width | Invariant (`width >= 45px`) | Status |
|---|---|---|---|---|
| `clientX = -49800` (Start 200) | $\Delta x = -50,000\text{px}$ | `45px` | Satisfied ($45 \ge 45$) | PASS |
| `clientX = -99800` (Start 200) | $\Delta x = -100,000\text{px}$ | `45px` | Satisfied ($45 \ge 45$) | PASS |
| `clientX = 50200` (Start 200) | $\Delta x = +50,000\text{px}$ | `50,140px` | Satisfied ($50140 \ge 45$) | PASS |
| `clientX = NaN` | $\Delta x = \text{NaN}$ | `NaN` | **VIOLATED** (`!(NaN >= 45)`) | **FAIL** |
| `clientX = undefined` | $\Delta x = \text{NaN}$ | `NaN` | **VIOLATED** (`!(NaN >= 45)`) | **FAIL** |
| `clientX = -Infinity` | $\Delta x = -\infty$ | `45px` | Satisfied ($45 \ge 45$) | PASS |
| `clientX = +Infinity` | $\Delta x = +\infty$ | `Infinity` | Numeric $\ge 45$, but non-finite CSS | WARNING |

### 2.2 Root Cause Analysis
In JavaScript IEEE-754 arithmetic:
- `Math.max(45, NaN) === NaN`
- `NaN >= 45 === false`
If a browser, synthetic test harness, touch event wrapper, or headless runner dispatches a `mousemove` with an undefined or NaN `clientX`, the column width state becomes `NaN`. When React renders:
```tsx
<colgroup>
  <col style={{ width: colWidths.name }} />
  ...
</colgroup>
```
React 18 generates an inline style with `width: NaN` or omits the style attribute, causing the browser table layout engine to collapse the column to 0px or auto-expand uncontrollably.

### 2.3 Required Mitigation
Guard `delta` with `Number.isFinite`:
```typescript
const rawDelta = moveEvt.clientX - draggingRef.current.startX;
const delta = Number.isFinite(rawDelta) ? rawDelta : 0;
const newWidth = Math.max(MIN_COL_WIDTH, draggingRef.current.startWidth + delta);
```

---

## 3. Challenge 2: Auto-Fit Calculation & Boundary Clamping

### 3.1 Empirical Observations
In `ProjectFilesTable.tsx` (lines 119-121, 376-407):
```typescript
export const calculateAutoFitWidth = (maxLen: number): number => {
  return Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, Math.round(maxLen * 7.0 + 24)));
};
```

| Edge Case Test Vector | Input Parameters | Formula Result | Clamped Result | Clamped [45, 400]px? |
|---|---|---|---|---|
| Empty File List (0 files) | `Name` header (len 4) | $4 \times 7 + 24 = 52$ | 52px | PASS |
| Empty File List (0 files) | `DirPath` header (len 7) | $7 \times 7 + 24 = 73$ | 73px | PASS |
| Empty File List (0 files) | `Size` header (len 4) | $4 \times 7 + 24 = 52$ | 52px | PASS |
| Empty File List (0 files) | `Status` header (len 6) | $6 \times 7 + 24 = 66$ | 66px | PASS |
| 1-character file | `maxLen = 1` | $1 \times 7 + 24 = 31$ | 45px | PASS |
| 0-length text | `maxLen = 0` | $0 \times 7 + 24 = 24$ | 45px | PASS |
| 1,000-char unbroken base64 | `maxLen = 1000` | $1000 \times 7 + 24 = 7024$ | 400px | PASS |
| Unicode emojis (`🔥🚀💎📁🎉📊`) | Surrogate pairs (len 32) | $32 \times 7 + 24 = 248$ | 248px | PASS |
| CJK Script (Japanese) | `データ分析レポート...` (len 28) | $28 \times 7 + 24 = 220$ | 220px | PASS |
| Arabic RTL Script | `تقرير_مراجعة_الحسابات...` (len 35) | $35 \times 7 + 24 = 269$ | 269px | PASS |
| Corrupted File Attributes | `null`, `undefined`, `NaN` | Handled via fallbacks | [45, 400]px | PASS |
| 10,000 Random Lengths Fuzzing | Random $L \in [-5000, 45000]$ | Clamped | All $\in [45, 400]$ | PASS |

### 3.2 Assessment
The auto-fit calculation is exceptionally robust against empty lists, multi-byte Unicode strings, surrogate pairs, and 1,000-character unbroken base64 strings. It adheres strictly to the $[45, 400]\text{px}$ contract.

---

## 4. Challenge 3: 50-Row Selection & Auto-Wrap Lifecycle Fuzzing

### 4.1 Empirical Observations
Tested across a dataset of 50 heterogeneous files (`.csv`, `.json`, `.parquet`, `.evtx`, `.log`):

1. **Single Click Expand**: Row transitions to `.is-selected`, height becomes `auto`, text wraps (`white-space: normal; word-break: break-all; overflow-wrap: anywhere;`), max-height capped at 180px with auto scrollbars.
2. **Toggle Click Collapse**: Clicking the already-selected row deselects it (`selectedRowPath = null`), restoring 25px single-line height (`white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`).
3. **Rapid Double-Click**: Click 1 expands, Click 2 immediately collapses. State returns to `null`.
4. **Sequential Traversal Sweep (0 -> 49)**: Traversed all 50 rows in sequence. Invariant maintained: exactly 1 row selected at any time, 0 orphaned selections.
5. **Escape Key Dismissal**: Validated across rows 0, 15, 33, 49. Selection immediately resets to `null`.
6. **Click Outside Container**: Clicks outside `.project-table-container` reset selection to `null`. Clicks inside the container (e.g. table header or body background) preserve active selection.
7. **Windows Path Normalization**: `normPath()` normalizes `C:\path\file.csv` and `c:/path/file.csv`, guaranteeing toggle click works regardless of slash direction or casing.
8. **10,000-Step Monte Carlo Fuzzing**: Randomly dispatched `CLICK_ROW`, `TOGGLE_CURRENT`, `ESCAPE`, `CLICK_OUTSIDE`, and `CLICK_INSIDE`. **Zero invariant violations observed across all 10,000 steps.**

---

## 5. Challenge 4: Event Isolation on Divider Resizer Handles

### 5.1 Empirical Observations
In `ProjectFilesTable.tsx` (lines 483-504, 523-544, 563-584, 603-624):
```tsx
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
  ...
```

### 5.2 Defect Trace: Click Event Leakage
1. When a user drags a column resizer, or double-clicks it to auto-fit, or simply clicks the divider:
   - `mousedown` on `.col-resizer-handle` fires `handleResizeMouseDown`, which invokes `e.stopPropagation()` and `e.preventDefault()`. (Isolated from header mousedown).
   - `mouseup` fires on document.
   - **The browser dispatches a `click` event on `.col-resizer-handle`**.
2. `.col-resizer-handle` **registers NO `onClick` handler**.
3. The `click` event bubbles up the DOM tree to `th.col-name`.
4. `th.col-name` has:
   `onClick={(e) => toggleColumnFilter("name", e)}`.
5. `toggleColumnFilter` toggles `filterOpenCol`:
   `setFilterOpenCol((prev) => (prev === col ? null : col))`.
6. **Symptom in UI**:
   - Double-clicking the divider to auto-fit pops open the column filter input box (`<input className="col-filter-input" ... autoFocus />`), stealing keyboard focus.
   - Dragging a column divider and releasing mouseup over the handle unexpectedly opens the filter input box.
   - Clicking near the column divider divider handle opens the filter popup.

In contrast, `.sort-btn` correctly implements:
```tsx
<button
  type="button"
  className="sort-btn"
  onClick={(e) => handleSort("name", e)} // handleSort executes e.stopPropagation()
>
```
The developer remembered to isolate the sort button click, but missed `.col-resizer-handle`!

### 5.3 Required Mitigation
Add `onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}` to `.col-resizer-handle` across all four column definitions:
```tsx
<div
  className="col-resizer-handle"
  title="Drag to resize, double-click to auto-fit"
  onMouseDown={(e) => handleResizeMouseDown("name", e)}
  onDoubleClick={(e) => handleAutoFit("name", e)}
  onClick={(e) => {
    e.stopPropagation();
    e.preventDefault();
  }}
/>
```

---

## 6. Verification and Reproduction

To independently reproduce the failures:
```powershell
.\node-v18.20.4-win-x64\node.exe tests/qa/test_challenger_sidebar_stress.js
```
Expected output:
- `TEST 1.4` FAILS with `Current code yields NaN (isFinite: false). NaN corrupts React style width!`
- `TEST 1.6` FAILS with `Undefined clientX yields NaN (NaN)`
- `TEST 4.4` FAILS with `Clicking the resizer handle leaks click event to parent th.onClick, inadvertently popping open toggleColumnFilter!`

---

## 7. Conclusion & Gate Recommendation

**Verdict**: **REQUEST_CHANGES**  
The implementation exhibits high quality in auto-fit text measurement, Unicode support, and 50-row lifecycle management. However, two high-impact defects must be resolved:
1. `ProjectFilesTable.tsx`: Guard drag resize delta against `NaN` and `undefined` with `Number.isFinite`.
2. `ProjectFilesTable.tsx`: Shield `.col-resizer-handle` with `onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}` on all 4 headers (`name`, `dir`, `size`, `status`) to prevent unwanted column filter popups.
