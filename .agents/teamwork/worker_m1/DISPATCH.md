# DISPATCH — Worker Milestone 1: Sidebar File Table Resizing & Auto-Wrap

Read `ORIGINAL_REQUEST.md` at:
`d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`
Read the architecture and contracts in:
`d:\Shared_UserData\Downloads\tad\.agents\teamwork\PROJECT.md`
Read the survey handoffs at:
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_ui_table\handoff.md` (Sections 1.1, 1.2, 4.1, 4.2, 4.5)
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\spec_miner_survey\handoff.md` (Streams 1, 2, 5, 6)

## MANDATORY INTEGRITY WARNING
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Write Ownership
You EXCLUSIVELY own and modify:
- `d:\Shared_UserData\Downloads\tad\tad-master\packages\toadviewer\src\components\ProjectFilesTable.tsx`
- `d:\Shared_UserData\Downloads\tad\tad-master\packages\toadviewer\less\sidebar.less`
DO NOT touch any other files.

## Detailed Requirements
1. **Column Resizing (Stream 1)**:
   - State `colWidths: ColWidths = { name: 140, dir: 120, size: 70, status: 60 }`.
   - `<div className="col-resizer-handle" ... />` at the right edge of each `<th>` (`name`, `dir`, `size`, `status`).
   - Dragging on `document` with minWidth clamping strictly at `MIN_COL_WIDTH = 45px`.
   - Add `document.body.classList.add("col-resizing")` during drag, remove on mouseup.
   - Double-click on resizer handle auto-fits column width based on longest text among visible files: $\text{clamp}(45, 400, \text{round}(\text{maxLen} \times 7.0 + 24))$.
2. **Active Row Auto-Wrap (Stream 2)**:
   - `selectedRowPath: string | null` state.
   - When a row is clicked: if already selected -> collapse back to 1 line (`selectedRowPath = null`); otherwise -> expand row (`selectedRowPath = f.filePath`) and call `onOpenFile(f)`.
   - Click-away (outside `.project-table-container`) or pressing `Escape` collapses selected row back to 1 line.
   - Wrapped row (`.is-selected`): `white-space: normal; word-break: break-all; overflow-wrap: anywhere;` with `.file-name-wrap` and `.file-dir-wrap` having `max-height: 180px; overflow-y: auto;`.
   - Unselected rows remain compact single-line (25px) with `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`.
3. **CSS Design System & Scrollbars (Stream 5)**:
   - In `sidebar.less`: Light & Dark theme support.
   - Resizer handle hover/drag divider line: `rgba(2, 132, 199, 0.75)` in Light theme; `rgba(56, 189, 248, 0.85)` in Dark theme.
   - Custom slim scrollbars (4px width, 2px border-radius) for `.file-name-wrap` and `.file-dir-wrap`.
   - Cursor management: `body.col-resizing, body.col-resizing * { cursor: col-resize !important; user-select: none !important; }`.
4. **Event Isolation & Cleanup (Stream 6)**:
   - `e.stopPropagation()` and `e.preventDefault()` on resizer handle `onMouseDown` and `onDoubleClick` to avoid triggering filter inputs or table sort.
   - Cleanup on `window.onblur` and `document.mouseleave` to abort unfinished drag.

## Verification
- Compile TypeScript / verify no syntax errors (`npx tsc --noEmit` in `packages/toadviewer`).
- Write complete implementation handoff to `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m1\handoff.md`.

## 2026-11-04T15:37:24Z
You are the teamwork_worker for Milestone 1 (Sidebar File Table Resizing & Auto-Wrap).
Your working directory is: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m1
Read your task dispatch file at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m1\DISPATCH.md
Read the authoritative user request at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
Read the project master plan at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\PROJECT.md
Read the detailed survey blueprints at:
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_ui_table\handoff.md
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\spec_miner_survey\handoff.md

Implement Streams 1, 2, 5, 6 for the Sidebar Table in:
- tad-master/packages/toadviewer/src/components/ProjectFilesTable.tsx
- tad-master/packages/toadviewer/less/sidebar.less

Follow all instructions in DISPATCH.md strictly. Ensure genuine implementation and verify type safety.
Write your complete handoff report to: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m1\handoff.md
When finished, notify me using send_message.
