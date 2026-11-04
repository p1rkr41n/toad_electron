# Dispatch: Squad 5 Systems QA, Packaging & Release Pipeline (E17-E20)
Working directory: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_squad5\
Original request: d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
Project specification: d:\Shared_UserData\Downloads\tad\.agents\teamwork\PROJECT.md
Survey analysis: d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_survey_qa_release\analysis.md

Owned files:
- tests/qa/test_modal_cell_glow_suppression.js
- tests/qa/test_grid_wrap_concurrency_stress.js
- run_tests.js
- dist_package.ps1
- package_release.ps1
- tools/clean_cache.ps1


## 2026-11-04T18:30:27Z
You are teamwork_worker representing Squad 5 (Engineers E17-E20) in a teamwork system.
Your working directory is: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_squad5\
Read your task dispatch file at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_squad5\DISPATCH.md
Read the user's original request verbatim at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
Read the master project specification at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\PROJECT.md
Read the reference technical plan at: C:/Users/huydq/.gemini/antigravity/brain/489b863f-84dc-4fd6-bbfb-142488ba4d23/ke_hoach_trien_khai_20_ki_su_song_song.md
Read the survey analysis at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_survey_qa_release\analysis.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Write ownership:
You own and have exclusive write permission to ONLY these files:
- `tests/qa/test_modal_cell_glow_suppression.js`
- `tests/qa/test_grid_wrap_concurrency_stress.js`
- `run_tests.js`
- `dist_package.ps1`
- `package_release.ps1`
- `tools/clean_cache.ps1`

Tasks (Squad 5: E17-E20):
1. Create `tests/qa/test_modal_cell_glow_suppression.js`:
   - Implement 10 comprehensive QA test cases:
     - Test 1: Dialog open dispatches "dismiss-grid-cell-expand" event via GridOverlayBus.
     - Test 2: Active cell highlight suppression rules in slickgrid.scss under body.bp4-overlay-open (.slick-cell.active has transparent background & border).
     - Test 3: Active row highlight suppression under body.bp4-overlay-open (.slick-row.active has transparent background & no shadow).
     - Test 4: Selected cell highlight suppression under body.bp4-overlay-open.
     - Test 5: Floating expanded cell nodes (.slick-cell-active-expanded) are set to display: none under body.bp4-overlay-open.
     - Test 6: Expanded row containers (.slick-row-has-expanded) are set to display: none or normalized under body.bp4-overlay-open.
     - Test 7: Grid active cell reset: verify grid.resetActiveCell() is invoked on dialog open.
     - Test 8: Multiple modal open/close cycles: verify clean restoration of grid interaction upon dialog close.
     - Test 9: Zero visual glow / high-contrast bleed-through behind modal backdrop.
     - Test 10: Event teardown: unsubscription on component unmount prevents memory leaks.
   - Run: `& "node-v18.20.4-win-x64\node.exe" tests/qa/test_modal_cell_glow_suppression.js` (Verify 10/10 PASS).
2. Update `tests/qa/test_grid_wrap_concurrency_stress.js`:
   - Update assertions from legacy static 180px to dynamic $N$-line bounds ($24\text{px}$ flat for $N \le 1$, exact fit $N \times 17 + 8$ for $2 \le N \le 5$, 5-line cap $93\text{px}$ for $N > 5$).
   - Run: `& "node-v18.20.4-win-x64\node.exe" tests/qa/test_grid_wrap_concurrency_stress.js` (Verify 10/10 PASS).
3. Update `run_tests.js`:
   - Register all 3 new test suites:
     - `tests/unit/test_cell_line_calculator.js` (25 tests)
     - `tests/unit/test_parse_dialog_nested_dropdown.js` (15 tests)
     - `tests/qa/test_modal_cell_glow_suppression.js` (10 tests)
   - Execute the entire test runner:
     `& "node-v18.20.4-win-x64\node.exe" run_tests.js --all`
     Verify 100% PASS across all 21 registered test suites (593+ tests total).
4. Packaging & Release Pipeline:
   - Clean cache: run `powershell -ExecutionPolicy Bypass -File tools/clean_cache.ps1`.
   - Build production bundle & package: run `powershell -ExecutionPolicy Bypass -File dist_package.ps1` and `powershell -ExecutionPolicy Bypass -File package_release.ps1`.
   - Strictly enforce Zero-Duplicate Binary Policy:
     - Root directory must have ONLY `Toad.exe` (no historical duplicates like Toad 2.0.x.exe).
     - `releases/` directory must contain ONLY the canonical pair: `Toad-2.5.1-x64-portable.exe` and `Toad-2.5.1-x64-portable.zip`, along with `SHA256SUMS.txt`.
     - Executable size must be < 75 MB.
5. Jujutsu VCS & Release Identity:
   - Verify config author: `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`.
   - Commit all changes using `tools/jj/jj.exe commit -m "..."` with professional English commit messages.
