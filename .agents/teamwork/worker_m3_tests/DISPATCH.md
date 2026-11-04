# DISPATCH — Test Writer Milestone 3: Automated Test Suites & Runner Integration

Read `ORIGINAL_REQUEST.md` at:
`d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`
Read the architecture and contracts in:
`d:\Shared_UserData\Downloads\tad\.agents\teamwork\PROJECT.md`
`d:\Shared_UserData\Downloads\tad\.agents\teamwork\TEST_INFRA.md`
Read the survey handoffs at:
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_qa_packaging\handoff.md` (Sections 1.1, 1.2, 2.1, 2.2, 2.3, 2.4)
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\spec_miner_survey\handoff.md` (Streams 7, 8, 9, 10)

## MANDATORY INTEGRITY WARNING
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Write Ownership
You EXCLUSIVELY own and modify:
- `d:\Shared_UserData\Downloads\tad\tests\unit\test_project_files_table_wrap_resize.js` (NEW)
- `d:\Shared_UserData\Downloads\tad\tests\unit\test_datagrid_floating_wrap.js` (NEW)
- `d:\Shared_UserData\Downloads\tad\tests\qa\test_grid_wrap_concurrency_stress.js` (NEW)
- `d:\Shared_UserData\Downloads\tad\run_tests.js`
- `d:\Shared_UserData\Downloads\tad\TEST_READY.md` (to publish when complete)
DO NOT touch any other files.

## Detailed Requirements
1. **`tests/unit/test_project_files_table_wrap_resize.js` (15 Test Cases)**:
   - TEST 1.1: Column Width State Initialization (defaults `{ name: 140, dir: 120, size: 70, status: 60 }`).
   - TEST 1.2: Resizer Handle DOM Presence (`.col-resizer-handle` on `th.col-name`, `th.col-dir`, etc.).
   - TEST 1.3: MouseDown Drag Initiation.
   - TEST 1.4: Drag Expansion Calculation (+50px delta).
   - TEST 1.5: Drag Contraction Calculation (-30px delta).
   - TEST 1.6: Minimum Width Clamping (45px strictly enforced).
   - TEST 1.7: Event Propagation Isolation on Resizer (`e.stopPropagation()` & `e.preventDefault()`).
   - TEST 1.8: Window Blur / MouseLeave Cleanup.
   - TEST 1.9: Double-Click Auto-Fit Calculation from visible text.
   - TEST 1.10: Double-Click Auto-Fit Min Clamping (45px on short text).
   - TEST 1.11: Active Row Selection Wrap Trigger (`.is-selected` with `white-space: normal`, etc.).
   - TEST 1.12: Compact Single-Line Preservation for Unselected Rows (`white-space: nowrap`, 25px).
   - TEST 1.13: Max-Height Capping & Scrollability (180px, `overflow-y: auto`).
   - TEST 1.14: Toggle Click Collapse.
   - TEST 1.15: Escape Key / Outside Click Dismissal.

2. **`tests/unit/test_datagrid_floating_wrap.js` (15 Test Cases)**:
   - TEST 2.1: SlickGrid Resizer Handle Double-Click Binding.
   - TEST 2.2: Auto-Fit Column Width Math from visible viewport.
   - TEST 2.3: Header Title Width Protection.
   - TEST 2.4: Lower Bound Clamping (MINCOLWIDTH = 60px).
   - TEST 2.5: Upper Bound Clamping (MAXCOLWIDTH = 500px or 330px).
   - TEST 2.6: Floating Active Cell Expansion Trigger (`.slick-cell-active-expanded`).
   - TEST 2.7: Non-Overflowing Cell Clean Selection (no expanded class on short text).
   - TEST 2.8: Layer Isolation (`z-index: 20`).
   - TEST 2.9: Visual Prominence & Blueprint Theme (border & shadow `0 4px 14px rgba(0,0,0,0.15)`).
   - TEST 2.10: Dynamic Text Wrap Formatting (`white-space: normal`, `word-break: break-word`).
   - TEST 2.11: Max-Height (180px) & Scrollability (`overflow-y: auto`).
   - TEST 2.12: Virtual Scroll Coordinate Invariance (`top = rowIndex * 24px` invariant).
   - TEST 2.13: Grid Scroll Dismissal (`grid.onScroll` collapses floating cell).
   - TEST 2.14: Escape Key Dismissal.
   - TEST 2.15: Active Cell Navigation Dismissal.

3. **`tests/qa/test_grid_wrap_concurrency_stress.js` (10 Test Cases)**:
   - TEST 3.1: 100K Rows In-Memory Virtual Viewport stability.
   - TEST 3.2: Absolute Coordinate Grid Invariance (`top = i * 24px` across 100K rows).
   - TEST 3.3: Rapid Random Cell Expansion Stress (100 random cells).
   - TEST 3.4: Viewport High-Speed Scroll Under Active Expansion (1,000 scroll jumps).
   - TEST 3.5: Virtual Scroll Latency & FPS Target Benchmark (> 55 FPS).
   - TEST 3.6: Concurrent Column Resizing During Active Virtual Scroll.
   - TEST 3.7: Memory Leak Guard (< 25 MB heap delta).
   - TEST 3.8: Multi-Column Long Text Isolation.
   - TEST 3.9: Extreme Payload Cell Wrap Stress (50KB payload < 16ms).
   - TEST 3.10: Zero Unhandled Exceptions Audit across all operations.

4. **`run_tests.js` Integration**:
   - Register all 3 suites under `--unit`, `--qa`, `--all`, and default execution.

5. **Publish `TEST_READY.md`**:
   - Create `d:\Shared_UserData\Downloads\tad\TEST_READY.md` with coverage breakdown and runner commands.

## Verification
- Run:
  `node tests/unit/test_project_files_table_wrap_resize.js`
  `node tests/unit/test_datagrid_floating_wrap.js`
  `node tests/qa/test_grid_wrap_concurrency_stress.js`
  `node run_tests.js --unit`
  `node run_tests.js --qa`
- Write handoff to `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m3_tests\handoff.md`.


## 2026-11-04T15:37:41Z
You are the teamwork_test_writer for Milestone 3 (Automated Test Suites & Runner Integration).
Your working directory is: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m3_tests
Read your task dispatch file at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m3_tests\DISPATCH.md
Read the authoritative user request at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
Read the project master plan at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\PROJECT.md
Read the test infrastructure specification at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\TEST_INFRA.md
Read the survey handoffs at:
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_qa_packaging\handoff.md
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\spec_miner_survey\handoff.md

Implement the complete automated test suites:
1. tests/unit/test_project_files_table_wrap_resize.js (15 test cases)
2. tests/unit/test_datagrid_floating_wrap.js (15 test cases)
3. tests/qa/test_grid_wrap_concurrency_stress.js (10 test cases)
4. Update run_tests.js to register these 3 new suites under --unit, --qa, --all, and default modes.
5. Publish d:\Shared_UserData\Downloads\tad\TEST_READY.md when tests are complete.

Follow all instructions in DISPATCH.md strictly. Ensure all 40 test cases execute with 100% PASS.
Write your complete handoff report to: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m3_tests\handoff.md
When finished, notify me using send_message.
