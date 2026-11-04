# DISPATCH — Worker Milestone 2: Main DataGrid Auto-Fit & Floating Cell Wrap

Read `ORIGINAL_REQUEST.md` at:
`d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`
Read the architecture and contracts in:
`d:\Shared_UserData\Downloads\tad\.agents\teamwork\PROJECT.md`
Read the survey handoffs at:
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_ui_table\handoff.md` (Sections 1.3, 1.4, 4.3, 4.4, 4.5)
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\spec_miner_survey\handoff.md` (Streams 3, 4, 5, 6)

## MANDATORY INTEGRITY WARNING
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Write Ownership
You EXCLUSIVELY own and modify:
- `d:\Shared_UserData\Downloads\tad\tad-master\packages\toadviewer\src\components\DataGrid.tsx`
- `d:\Shared_UserData\Downloads\tad\tad-master\packages\toadviewer\src\slickgrid.scss`
DO NOT touch any other files.

## Detailed Requirements
1. **Double-Click Auto-Fit Column Width (Stream 3)**:
   - Intercept `dblclick` on `.slick-resizable-handle` in the header container (`containerElem`).
   - Find target column from `closest(".slick-header-column")`.
   - Read visible viewport rows (`grid.getViewport()`), measure longest formatted string using `getColumnFormatter(schema, colId)`.
   - Calculate width: $w_{\text{fit}} = \text{clamp}(60, 500, \text{round}(\text{maxLen} \times 7.5 + 24))$.
   - Apply `grid.setColumns(updatedCols)` and update `tadProps._gridState.colWidthsMap[colId]`.
2. **Floating In-Place Active Cell Wrap (Stream 4)**:
   - Critical Caveat: `.slick-cell` has `contain: strict;`. You MUST override with `contain: none !important;`!
   - In `grid.onActiveCellChanged`: check if active cell text overflows (`scrollWidth > clientWidth || textLen > 28`).
   - If overflowing: attach `.slick-cell-active-expanded` to cell and `.slick-row-has-expanded` to parent row.
   - CSS rules in `slickgrid.scss`:
     ```scss
     .slick-row.slick-row-has-expanded {
       overflow: visible !important;
       z-index: 25 !important;
     }
     .slick-cell.slick-cell-active-expanded {
       position: absolute !important;
       z-index: 20 !important;
       contain: none !important;
       height: auto !important;
       min-height: 24px !important;
       max-height: 180px !important;
       overflow-y: auto !important;
       white-space: normal !important;
       word-break: break-word !important;
       box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15) !important;
     }
     ```
   - Coordinate Preservation: Row top positions remain strictly invariant (`top = i * 24px`).
   - Dismissal: Subscribe to `grid.onScroll`, `grid.onViewportChanged`, active cell change, and `Escape` key to immediately remove `.slick-cell-active-expanded`.
3. **CSS Design System & Themes (Stream 5)**:
   - Resizer handle hover/drag line: `rgba(2, 132, 199, 0.75)` in Light theme; `rgba(56, 189, 248, 0.85)` in Dark theme.
   - Custom slim scrollbars (4px, 2px radius) on expanded cells.
4. **Event Isolation & Cleanup (Stream 6)**:
   - Ensure header resizer dblclick does not trigger sort.
   - `Escape` key dismisses floating active cell.

## Verification
- Compile TypeScript / verify no syntax errors (`npx tsc --noEmit` in `packages/toadviewer`).
- Write complete implementation handoff to `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m2\handoff.md`.


## 2026-11-04T15:37:32Z
You are the teamwork_worker for Milestone 2 (Main DataGrid Auto-Fit & Floating Cell Wrap).
Your working directory is: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m2
Read your task dispatch file at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m2\DISPATCH.md
Read the authoritative user request at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
Read the project master plan at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\PROJECT.md
Read the detailed survey blueprints at:
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_ui_table\handoff.md
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\spec_miner_survey\handoff.md

Implement Streams 3, 4, 5, 6 for the Main DataGrid in:
- tad-master/packages/toadviewer/src/components/DataGrid.tsx
- tad-master/packages/toadviewer/src/slickgrid.scss

Pay special attention to overriding `contain: strict;` on `.slick-cell-active-expanded` with `contain: none !important;` and ensuring virtual row coordinate invariance.
Follow all instructions in DISPATCH.md strictly. Ensure genuine implementation and verify type safety.
Write your complete handoff report to: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m2\handoff.md
When finished, notify me using send_message.
