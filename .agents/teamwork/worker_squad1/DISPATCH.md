# Dispatch: Squad 1 Core Mathematical Engine & Foundation (E01-E04)
Working directory: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_squad1\
Original request: d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
Project specification: d:\Shared_UserData\Downloads\tad\.agents\teamwork\PROJECT.md
Reference plan: C:/Users/huydq/.gemini/antigravity/brain/489b863f-84dc-4fd6-bbfb-142488ba4d23/ke_hoach_trien_khai_20_ki_su_song_song.md
Survey analysis: d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_survey_tables\analysis.md
Spec miner analysis: d:\Shared_UserData\Downloads\tad\.agents\teamwork\spec_miner_survey_squads\analysis.md

Owned files:
- tad-master/packages/toadviewer/src/utils/CellLineCalculator.ts
- tad-master/packages/toadviewer/src/utils/GridOverlayBus.ts
- tests/unit/test_cell_line_calculator.js
## 2026-11-04T18:06:45Z
You are teamwork_worker representing Squad 1 (Engineers E01-E04) in a teamwork system.
Your working directory is: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_squad1\
Read your task dispatch file at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_squad1\DISPATCH.md
Read the user's original request verbatim at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
Read the master project specification at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\PROJECT.md
Read the reference technical plan at: C:/Users/huydq/.gemini/antigravity/brain/489b863f-84dc-4fd6-bbfb-142488ba4d23/ke_hoach_trien_khai_20_ki_su_song_song.md
Read the survey analyses at:
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_survey_tables\analysis.md
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\spec_miner_survey_squads\analysis.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Write ownership:
You own and have exclusive write permission to ONLY these files:
- `tad-master/packages/toadviewer/src/utils/CellLineCalculator.ts`
- `tad-master/packages/toadviewer/src/utils/GridOverlayBus.ts`
- `tests/unit/test_cell_line_calculator.js`

Tasks (Squad 1: E01-E04):
1. Implement `tad-master/packages/toadviewer/src/utils/CellLineCalculator.ts`:
   - `calculateLineCount(text: any, colWidth: number, options?: LineCalculationOptions): number`
     - Measure accurately with Canvas 2D `ctx.measureText` when available in browser.
     - Deterministic fallback for Node.js / headless testing: character width $C_w \approx 7.5\text{px}$ (or $7.0\text{px}$).
     - Handle null, undefined, empty string ($N=1$), numbers, timestamps, boolean.
     - Handle explicit newlines (`\r\n|\r|\n`), calculating wrapped lines per segment.
     - Handle unbroken long strings (hashes, JSON tokens) without infinite loops.
     - Effective column width: `Math.max(20, colWidth - padding)`.
   - `getHeightAndScrollState(lineCount: number, lineHeight: number = 17, vertPadding: number = 8, defaultHeight: number = 24): CellHeightState`
     - $N \le 1$: `{ shouldExpand: false, lineCount, height: defaultHeight, overflowY: "hidden", hasScrollbar: false }`
     - $2 \le N \le 5$: `{ shouldExpand: true, lineCount, height: N * lineHeight + vertPadding, overflowY: "hidden", hasScrollbar: false }`
     - $N > 5$: `{ shouldExpand: true, lineCount, height: 5 * lineHeight + vertPadding, overflowY: "auto", hasScrollbar: true }`
   - Export both functions and their TypeScript interfaces.
2. Implement `tad-master/packages/toadviewer/src/utils/GridOverlayBus.ts`:
   - Define custom event constants:
     - `EVENT_DISMISS_GRID_CELL_EXPAND = "dismiss-grid-cell-expand"`
     - `EVENT_PARSE_DIALOG_OPENED = "parse-dialog-opened"`
     - `EVENT_PARSE_DIALOG_CLOSED = "parse-dialog-closed"`
   - Implement typed dispatch and subscription helpers (`emitDismissGridCellExpand`, `onDismissGridCellExpand`, `emitParseDialogOpened`, `onParseDialogOpened`, `emitParseDialogClosed`, `onParseDialogClosed`).
   - Support safe execution both in browser (window.dispatchEvent) and in Node.js headless tests.
3. Implement `tests/unit/test_cell_line_calculator.js`:
   - Write 25 comprehensive test cases using Node's native `assert`:
     - Test boundary line counts ($N = 1, 2, 5, 6, 100$).
     - Test column widths from narrow ($45\text{px}$) to wide ($1200\text{px}`).
     - Test edge cases: empty string, null, undefined, numbers, timestamps.
     - Test multiline strings (`\n`, `\r\n`).
     - Test nested JSON strings and long uninterrupted strings.
     - Test `getHeightAndScrollState` contract: verify $N \le 1$ flat/hidden/false, $2 \le N \le 5$ exact fit/hidden/false, $N > 5$ 93px/auto/true.
   - Run the test suite using:
     `& "node-v18.20.4-win-x64\node.exe" tests/unit/test_cell_line_calculator.js`
     Verify all 25 test cases pass cleanly with exit code 0.

Write your completion handoff report to:
d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_squad1\handoff.md
Send a concise completion message back to parent via send_message when finished.
