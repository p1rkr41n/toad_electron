# Dispatch: Squad 3 Main SlickGrid Data Table (E09-E12)
Working directory: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_squad3\
Original request: d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
Project specification: d:\Shared_UserData\Downloads\tad\.agents\teamwork\PROJECT.md
Survey analysis: d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_survey_tables\analysis.md

Owned files:
- tad-master/packages/toadviewer/src/components/DataGrid.tsx
- tad-master/packages/toadviewer/src/slickgrid.scss
- tests/unit/test_datagrid_floating_wrap.js

## 2026-11-04T18:13:07Z
You are teamwork_worker representing Squad 3 (Engineers E09-E12) in a teamwork system.
Your working directory is: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_squad3\
Read your task dispatch file at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_squad3\DISPATCH.md
Read the user's original request verbatim at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
Read the master project specification at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\PROJECT.md
Read the reference technical plan at: C:/Users/huydq/.gemini/antigravity/brain/489b863f-84dc-4fd6-bbfb-142488ba4d23/ke_hoach_trien_khai_20_ki_su_song_song.md
Read the survey analysis at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_survey_tables\analysis.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Write ownership:
You own and have exclusive write permission to ONLY these files:
- `tad-master/packages/toadviewer/src/components/DataGrid.tsx`
- `tad-master/packages/toadviewer/src/slickgrid.scss`
- `tests/unit/test_datagrid_floating_wrap.js`

Tasks (Squad 3: E09-E12):
1. In `tad-master/packages/toadviewer/src/components/DataGrid.tsx`:
   - Import `calculateLineCount`, `getHeightAndScrollState` from `../utils/CellLineCalculator`.
   - Import `onDismissGridCellExpand` from `../utils/GridOverlayBus`.
   - In `tryExpandCell(row, cell)`:
     - Get textContent from cellNode and column width.
     - Calculate $N = \text{calculateLineCount}(textContent, colWidth - 16)$.
     - Call `heightState = getHeightAndScrollState(N, 17, 8, 24)`.
     - Contract Rule 1 ($N \le 1$): return immediately! Do NOT add `.slick-cell-active-expanded`, do NOT float the cell, stays flat 24px.
     - Contract Rule 2 ($2 \le N \le 5$): add `.slick-cell-active-expanded` to cellNode and `.slick-row-has-expanded` to rowNode. Set inline `cellNode.style.height = heightState.height + "px"` and `cellNode.style.overflowY = heightState.overflowY` ("hidden").
     - Contract Rule 3 ($N > 5$): add `.slick-cell-active-expanded` to cellNode and `.slick-row-has-expanded` to rowNode. Set inline `cellNode.style.height = heightState.height + "px"` (93px) and `cellNode.style.overflowY = heightState.overflowY` ("auto").
   - 4-way collapse lifecycle:
     - Re-click active cell: if clicking the cell that is currently expanded, toggle collapse (`dismissFloatingCell()`).
     - Click another cell: dismisses previous and expands new cell if applicable.
     - Click outside grid: attach `document.addEventListener("mousedown", handleGridOutsideClick)`.
     - Press `Escape`: dismiss floating cell.
     - Virtual scroll / viewport changed: dismiss floating cell.
   - Event bus integration:
     - Listen for `onDismissGridCellExpand(dismissFloatingCell)`.
     - In `grid.destroy`: cleanly remove all event listeners (`mousedown`, `keydown`, event bus unsubscription) to prevent memory leaks.
2. In `tad-master/packages/toadviewer/src/slickgrid.scss`:
   - Remove hardcoded `max-height: 180px !important;` and `overflow-y: auto !important;` from `.slick-cell.slick-cell-active-expanded` so that inline styles from `CellLineCalculator` govern.
   - Add modal overlay suppression rules for `body.bp4-overlay-open`:
     ```scss
     body.bp4-overlay-open {
       .slick-cell.active,
       .slick-row.active,
       .slick-cell.selected {
         background: transparent !important;
         box-shadow: none !important;
         outline: none !important;
         border-color: transparent !important;
       }
       .slick-cell-active-expanded,
       .slick-row-has-expanded,
       .slick-row-active-expanded {
         display: none !important;
       }
     }
     ```
3. In `tests/unit/test_datagrid_floating_wrap.js`:
   - Update existing test assertions from legacy static 180px to dynamic $N$-line bounds ($24\text{px}$ flat for $N \le 1$, exact fit $N \times 17 + 8$ for $2 \le N \le 5$, 5-line cap $93\text{px}$ for $N > 5$).
   - Run the test suite using:
     `& "node-v18.20.4-win-x64\node.exe" tests/unit/test_datagrid_floating_wrap.js`
     Verify all 15 test cases pass cleanly with exit code 0.

Write your completion handoff report to:
d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_squad3\handoff.md
Send a concise completion message back to parent via send_message when finished.
