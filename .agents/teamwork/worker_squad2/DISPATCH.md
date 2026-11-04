# Dispatch: Squad 2 Sidebar File Management Table (E05-E08)
Working directory: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_squad2\
Original request: d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
Project specification: d:\Shared_UserData\Downloads\tad\.agents\teamwork\PROJECT.md
Survey analysis: d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_survey_tables\analysis.md

Owned files:
- tad-master/packages/toadviewer/src/components/ProjectFilesTable.tsx
- tad-master/packages/toadviewer/less/sidebar.less
- tests/unit/test_project_files_table_wrap_resize.js

## 2026-11-04T18:12:54Z
You are teamwork_worker representing Squad 2 (Engineers E05-E08) in a teamwork system.
Your working directory is: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_squad2\
Read your task dispatch file at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_squad2\DISPATCH.md
Read the user's original request verbatim at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
Read the master project specification at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\PROJECT.md
Read the reference technical plan at: C:/Users/huydq/.gemini/antigravity/brain/489b863f-84dc-4fd6-bbfb-142488ba4d23/ke_hoach_trien_khai_20_ki_su_song_song.md
Read the survey analysis at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_survey_tables\analysis.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Write ownership:
You own and have exclusive write permission to ONLY these files:
- `tad-master/packages/toadviewer/src/components/ProjectFilesTable.tsx`
- `tad-master/packages/toadviewer/less/sidebar.less`
- `tests/unit/test_project_files_table_wrap_resize.js`

Tasks (Squad 2: E05-E08):
1. In `tad-master/packages/toadviewer/src/components/ProjectFilesTable.tsx`:
   - Import `calculateLineCount`, `getHeightAndScrollState` from `../utils/CellLineCalculator`.
   - Update row rendering:
     - When a row is selected (`isSelected`):
       - Calculate `nameLines = calculateLineCount(f.fileName, (colWidths.name || 140) - 24)`.
       - Calculate `dirLines = calculateLineCount(f.relDir, (colWidths.dir || 120) - 12)`.
       - `lineCount = Math.max(nameLines, dirLines)`.
       - Call `heightState = getHeightAndScrollState(lineCount, 17, 8, 25)`.
       - If `heightState.shouldExpand`: add `is-expanded` class to `<tr>` and apply inline styles: `style={{ height: heightState.height, overflowY: heightState.overflowY }}`.
       - If not expanding ($N \le 1$): row retains only `is-selected`, stays flat 25px without elevation or scrollbar.
   - Column resize handles: ensure $\ge 45\text{px}$ minWidth clamping and double-click auto-fit.
   - 4-way collapse lifecycle: re-click active row collapses it (`selectedRowPath = null`), click another row switches selection, click outside table collapses it, Escape key collapses it.
2. In `tad-master/packages/toadviewer/less/sidebar.less`:
   - Separate `.file-table-row.is-selected` from `.file-table-row.is-selected.is-expanded`:
     - `.file-table-row.is-selected`: purely blue background (`#0284c7` / dark `#1f385c`), white text, flat 25px height, `white-space: nowrap`, `vertical-align: middle`.
     - `.file-table-row.is-selected.is-expanded`: multi-line wrapping (`white-space: normal`, `word-break: break-all`, `vertical-align: top`).
     - Remove hardcoded `max-height: 180px !important;` and `overflow-y: auto;` from `.file-name-wrap` and `.file-dir-wrap` so inline styles from `CellLineCalculator` govern.
     - Add slim 4px bo-tron scrollbar for `.is-expanded` when overflow-y is auto.
3. In `tests/unit/test_project_files_table_wrap_resize.js`:
   - Update existing test assertions from legacy static 180px to dynamic $N$-line bounds ($25\text{px}$ flat for $N \le 1$, exact fit $N \times 17 + 8$ for $2 \le N \le 5$, 5-line cap $93\text{px}$ for $N > 5$).
   - Run the test suite using:
     `& "node-v18.20.4-win-x64\node.exe" tests/unit/test_project_files_table_wrap_resize.js`
     Verify all 15 test cases pass cleanly with exit code 0.

Write your completion handoff report to:
d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_squad2\handoff.md
Send a concise completion message back to parent via send_message when finished.
