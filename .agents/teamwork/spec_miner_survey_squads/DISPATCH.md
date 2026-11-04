# Dispatch: Spec Miner Survey Squads
Working directory: d:\Shared_UserData\Downloads\tad\.agents\teamwork\spec_miner_survey_squads\
Task: Extract exact contract specifications, interface types, and boundary conditions from ORIGINAL_REQUEST.md and the 20-engineer technical plan.

## 2026-11-04T17:56:50Z
You are teamwork_spec_miner in a teamwork system.
Your working directory is: d:\Shared_UserData\Downloads\tad\.agents\teamwork\spec_miner_survey_squads\
Read your task dispatch file at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\spec_miner_survey_squads\DISPATCH.md
Read the user's original request verbatim at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
Read the reference technical plan at: C:/Users/huydq/.gemini/antigravity/brain/489b863f-84dc-4fd6-bbfb-142488ba4d23/ke_hoach_trien_khai_20_ki_su_song_song.md

Your role is strictly READ-ONLY exploration and specification mining. Do NOT modify source code or run builds.
Tasks:
1. Extract and document all specifications, formulas, height contracts, and boundary conditions:
   - N <= 1 line: Flat single-line, NO expansion, NO elevation, default height (24px-25px), no scrollbar.
   - 2 <= N <= 5 lines: Expand to fit exactly N lines (height = N * 17px + 8px), NO scrollbar (overflow-y: hidden).
   - N > 5 lines: Capped height at exactly 5 lines (approx 93-95px), enable slim 4px vertical scrollbar (overflow-y: auto).
   - 4-way collapse lifecycle: re-click active cell, click another cell, click outside, or press Escape.
2. Extract exact Parse Columns header & format refactor requirements:
   - Header tabs: strictly [Visual] and [Regex] (remove #ntab-nested).
   - minFormatSelect dropdown: add <option value="nested_json">Nested JSON</option>.
   - Remove redundant button #btn-switch-nested.
   - When nested_json selected: trigger scan triggerNestedScan(100) if empty, switch view to Nested JSON.
   - Handle apply support for nested_json.
3. Extract exact Modal active cell highlight suppression requirements:
   - When isOpen === true: dispatch "dismiss-grid-cell-expand", dismiss floating cell nodes, call grid.resetActiveCell().
   - When body.bp4-overlay-open is active: suppress .slick-cell.active, .slick-row.active, .slick-cell.selected (transparent background, no shadow, no outline, transparent border).
   - Custom event bus: GridOverlayBus.ts.
4. Extract test suite requirements:
   - tests/unit/test_cell_line_calculator.js: 25 test cases.
   - tests/unit/test_parse_dialog_nested_dropdown.js: 15 test cases.
   - tests/qa/test_modal_cell_glow_suppression.js: 10 test cases.
   - Existing test suite updates & registration in run_tests.js.
5. Extract the 5 Squad assignments (E01-E20), file boundaries, and no-conflict partitioning rules.

Write your comprehensive findings to:
d:\Shared_UserData\Downloads\tad\.agents\teamwork\spec_miner_survey_squads\analysis.md
Write your completion handoff report to:
d:\Shared_UserData\Downloads\tad\.agents\teamwork\spec_miner_survey_squads\handoff.md
Send a concise completion message back to parent via send_message when finished.
