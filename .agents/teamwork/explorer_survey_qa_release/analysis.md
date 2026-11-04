# Comprehensive Analysis: QA, Test Runner, Build Scripts, Packaging Pipelines & VCS Status

**Surveyor**: `teamwork_explorer` (Explorer Survey QA & Release)  
**Date**: 2026-11-04T18:01:00Z  
**Workspace**: `d:\Shared_UserData\Downloads\tad`  
**Working Directory**: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_survey_qa_release`

---

## Executive Summary

1. **Test Runner (`run_tests.js`)**: Currently orchestrates **18 test suites** comprising **543 total tests** (exceeding the baseline of 526+). All 18 suites pass cleanly with 100% HEALTHY status in 46.60 seconds when executed via the local Node binary.
2. **New Test Suites Required**:
   - `tests/unit/test_cell_line_calculator.js` (25 tests) — **Does not exist yet**; to be authored by Squad 1 (E04).
   - `tests/unit/test_parse_dialog_nested_dropdown.js` (15 tests) — **Does not exist yet**; to be authored by Squad 4 (E16).
   - `tests/qa/test_modal_cell_glow_suppression.js` (10 tests) — **Does not exist yet**; to be authored by Squad 5 (E17).
   - Registering these 3 new suites in `run_tests.js` will expand total automated tests to **21 suites / 593+ tests** (> 575+ acceptance gate).
3. **Existing Suites Needing Update**:
   - `tests/unit/test_project_files_table_wrap_resize.js` (15 tests): Must be updated from legacy static `180px` max-height to the dynamic contract ($N \le 1 \to 25\text{px}$, $2 \le N \le 5 \to N \times 17 + 8\text{px}$, $N > 5 \to 93\text{px}$ + 4px scrollbar).
   - `tests/unit/test_datagrid_floating_wrap.js` (15 tests): Must be updated from static `180px` max-height to the dynamic contract.
   - `tests/qa/test_grid_wrap_concurrency_stress.js` (10 tests): Must verify 100-cycle switching under dynamic cell heights.
4. **Node Environment**:
   - **CRITICAL**: System PATH does **not** contain `node` or `git`. Invocations of bare `node` fail with `CommandNotFoundException`.
   - Verified local runtime: `d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe` (Node.js v18.20.4) and `npm.cmd`.
   - Verified local Git: `d:\Shared_UserData\Downloads\tad\mingit\cmd\git.exe`.
5. **Packaging & Release Pipeline**:
   - `dist_package.ps1` and `package_release.ps1` enforce strict size gates: `app.asar` $\le 45.0\text{ MB}$ (current ~40 MB) and portable exe $\le 75.0\text{ MB}$ (current ~72.38 MB).
   - **Zero-Duplicate Binary Policy**: Verified compliant. Only `Toad.exe` exists at workspace root (72.38 MB) and only canonical `Toad-2.5.1-x64-portable.exe` (72.38 MB) + `Toad-2.5.1-x64-portable.zip` (72.38 MB) exist in `releases/`. Zero historical duplicate binaries exist.
   - `tools/clean_cache.ps1` correctly removes legacy binary aliases, build caches, and test profiles.
6. **VCS & Identity Standards**:
   - Jujutsu (`jj.exe`): Present at `tools/jj/jj.exe` (v0.46.0) and `C:\Users\huydq\.cargo\bin\jj.exe` (v0.46.0).
   - Git & Jujutsu Repo Config: Strictly configured under author `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`. Zero enterprise/org leaks. English-only commit messages verified in log history.

---

## 1. Test Runner Investigation (`run_tests.js`)

### 1.1 Architecture & Execution Model
- **File**: `d:\Shared_UserData\Downloads\tad\run_tests.js` (146 lines)
- **Mechanism**:
  - Uses `child_process.spawn(process.execPath, [fullPath], { stdio: "inherit", env: { ...process.env, TOAD_ROOT: __dirname } })`.
  - Runs each test suite in an isolated subprocess.
  - Subprocess exit code `0` is marked as `PASS`; non-zero is marked as `FAIL`.
  - Returns exit code `0` only if all executed test suites pass; otherwise `1`.
- **CLI Options**:
  - `node run_tests.js` (default): Runs 12 core suites.
  - `node run_tests.js --all`: Runs all 18 suites (core + legacy + unit).
  - `node run_tests.js --smoke`: Smoke test only (1 test).
  - `node run_tests.js --qa`: QA deep suites (4 suites, 308 tests).
  - `node run_tests.js --legacy`: Legacy suites only (19 tests).
  - `node run_tests.js --fuzz`: Adversarial fuzzing only (40 tests).
  - `node run_tests.js --unit`: Unit test suites (7 suites, 156 tests).

### 1.2 Inventory of Currently Registered Test Suites (18 Suites / 543 Tests)

| # | Suite Name in Runner | Test Script File | Declared Tests | Default Run | `--all` Run | Status (Verified Live) |
|---|---|---|:---:|:---:|:---:|:---:|
| 1 | Smoke Test (v2.5.1) | `tests/smoke_test.js` | 1 | Yes | Yes | **PASS** |
| 2 | Apache Arrow IPC & invokeBinary | `tests/test_arrow_ipc_stream.js` | 15 | Yes | Yes | **PASS** |
| 3 | EVTX Parsing & Schema Validation | `tests/test_evtx_parsing_schema.js` | 6 | Yes | Yes | **PASS** |
| 4 | Nested JSON & Semi-Structured Ingestion | `tests/test_nested_json.js` | 6 | Yes | Yes | **PASS** |
| 5 | Deep Integration QA | `tests/deep_integration_qa.js` | 223 | Yes | Yes | **PASS** |
| 6 | Preload 3 Pages & Dynamic PageSize | `tests/test_preload_3_pages.js` | 10 | Yes | Yes | **PASS** |
| 7 | Real-World Windows EVTX JSON Parity | `tests/qa/test_realworld_evtx_json.js` | 35 | Yes | Yes | **PASS** |
| 8 | Adversarial Robustness & Fuzzing | `tests/qa/test_json_adversarial_fuzz.js` | 40 | Yes | Yes | **PASS** |
| 9 | Parse Columns DataGrid Refresh | `tests/test_parse_columns_datagrid_refresh.js` | 18 | Yes | Yes | **PASS** |
| 10 | Grid Wrap Concurrency Stress | `tests/qa/test_grid_wrap_concurrency_stress.js` | 10 | Yes | Yes | **PASS** |
| 11 | Project Files Table Wrap & Resize Unit | `tests/unit/test_project_files_table_wrap_resize.js` | 15 | Yes | Yes | **PASS** |
| 12 | DataGrid Floating Wrap Unit | `tests/unit/test_datagrid_floating_wrap.js` | 15 | Yes | Yes | **PASS** |
| 13 | Legacy Use Cases | `tests/legacy_use_cases.js` | 19 | No | Yes | **PASS** |
| 14 | Nested Traverser Unit | `tests/unit/test_nested_traverser.js` | 10 | No | Yes | **PASS** |
| 15 | DuckDB JSON Builder Unit | `tests/unit/test_duckdb_json_builder.js` | 10 | No | Yes | **PASS** |
| 16 | JSON Schema Introspect Unit | `tests/unit/test_json_schema_introspect.js` | 50 | No | Yes | **PASS** |
| 17 | JSON Streaming Flattener Unit | `tests/unit/test_json_streaming_flattener.js` | 46 | No | Yes | **PASS** |
| 18 | Sample Scan Worker Unit | `tests/unit/test_sample_scan_worker.js` | 10 | No | Yes | **PASS** |
| **Total** | **18 Suites** | | **543 Tests** | **394** | **543** | **100% HEALTHY (46.60s)** |

### 1.3 Registration Plan for 3 New Test Suites

To satisfy Acceptance Criteria R4 & R5:
1. `tests/unit/test_cell_line_calculator.js` (25 tests)
2. `tests/unit/test_parse_dialog_nested_dropdown.js` (15 tests)
3. `tests/qa/test_modal_cell_glow_suppression.js` (10 tests)

**Recommended Modifications in `run_tests.js`**:
- In `--unit` flag block (around line 50):
  ```js
  testsToRun.push({ name: "Cell Line Calculator Unit (25 Tests)", file: "tests/unit/test_cell_line_calculator.js" });
  testsToRun.push({ name: "Parse Dialog Nested Dropdown Unit (15 Tests)", file: "tests/unit/test_parse_dialog_nested_dropdown.js" });
  ```
- In `--qa` flag block (around line 38):
  ```js
  testsToRun.push({ name: "Modal Cell Glow Suppression QA (10 Tests)", file: "tests/qa/test_modal_cell_glow_suppression.js" });
  ```
- In default / `--all` block (lines 62-64):
  Add all 3 new suites to the default execution list so both `node run_tests.js` and `node run_tests.js --all` execute them automatically:
  ```js
  testsToRun.push({ name: "Cell Line Calculator Unit (25 Tests)", file: "tests/unit/test_cell_line_calculator.js" });
  testsToRun.push({ name: "Parse Dialog Nested Dropdown Unit (15 Tests)", file: "tests/unit/test_parse_dialog_nested_dropdown.js" });
  testsToRun.push({ name: "Modal Cell Glow Suppression QA (10 Tests)", file: "tests/qa/test_modal_cell_glow_suppression.js" });
  ```
- Projected total after registration: **21 Suites / 593+ Tests** (> 575+ requirement).

---

## 2. Test Suites Survey in `tests/`

### 2.1 Existing Suites Requiring Update

#### A. `tests/unit/test_project_files_table_wrap_resize.js` (15 tests)
- **File Owner**: Squad 2 / E08
- **Current Observation**:
  - Line 152: Model defines `containerMaxHeight: "180px"`
  - Line 459 (TEST 1.13): Asserts `style.containerMaxHeight === "180px"`
  - Line 148: Asserts `style.height === "auto"` for all selected rows
- **Required Update**:
  - Integrate `CellLineCalculator` logic:
    - $N \le 1$: `{ height: "25px", overflowY: "hidden", hasScrollbar: false, className: "file-table-row is-selected" }` (flat, no expansion)
    - $2 \le N \le 5$: `{ height: `${N * 17 + 8}px`, overflowY: "hidden", hasScrollbar: false, className: "file-table-row is-selected is-expanded" }`
    - $N > 5$: `{ height: "93px", overflowY: "auto", hasScrollbar: true, className: "file-table-row is-selected is-expanded" }`
  - Update TEST 1.11, 1.12, 1.13 to assert these exact three boundary tiers.

#### B. `tests/unit/test_datagrid_floating_wrap.js` (15 tests)
- **File Owner**: Squad 3 / E12
- **Current Observation**:
  - Line 126: Determines overflow using simple heuristic `textLen > 28 || estTextWidth > col.width`
  - Line 170: Sets static `maxHeight: "180px"`
  - Line 413 (TEST 2.11): Asserts `style.maxHeight === "180px"`
- **Required Update**:
  - Update `setActiveCell` / `tryExpandCell` to use `CellLineCalculator.calculateLineCount` and `getHeightAndScrollState`:
    - If $N \le 1$: Do not expand (`expandedCell = null`, standard 24px cell).
    - If $2 \le N \le 5$: `maxHeight = N * 17 + 8` px, `overflowY: "hidden"`.
    - If $N > 5$: `maxHeight = 93` px, `overflowY: "auto"`.
  - Update TEST 2.6, 2.7, 2.11 accordingly.

#### C. `tests/qa/test_grid_wrap_concurrency_stress.js` (10 tests)
- **File Owner**: Squad 5 / E18
- **Current Observation**:
  - Runs 10 stress tests over a 100K-row virtual view.
  - Line 122: Static `maxHeight: 180`.
  - Line 215: Asserts `grid.activeExpandedCell.maxHeight, 180`.
  - Line 400: Asserts `grid.activeExpandedCell.maxHeight, 180`.
- **Required Update**:
  - Update tests to account for dynamic line count and height calculation under stress.
  - Verify that rapid cell switching across all 3 tables executes within $< 15\text{ms}$ and heap growth remains $< 25\text{MB}$.

### 2.2 Status of New Test Suites (Must Be Created)

| New Test File | Target Suite | Tests | Assigned Engineer | Current Status | Scope & Test Focus |
|---|---|:---:|:---:|:---:|---|
| `tests/unit/test_cell_line_calculator.js` | Unit | 25 | E04 (Squad 1) | **Not Created** | Boundary line calculations: $N \in \{1, 2, 5, 6, 100\}$, column widths $45\text{px} \to 1200\text{px}$, character metric fallback, newlines (`\r\n`), unbroken JSON, Vietnamese unicode, state mapping. |
| `tests/unit/test_parse_dialog_nested_dropdown.js` | Unit | 15 | E16 (Squad 4) | **Not Created** | Header tabs: only `[Visual]` and `[Regex]` present; `#ntab-nested` removed; `#btn-switch-nested` removed; dropdown format contains `nested_json`; auto-scan trigger on select; view mode toggle. |
| `tests/qa/test_modal_cell_glow_suppression.js` | QA | 10 | E17 (Squad 5) | **Not Created** | Modal open triggers `"dismiss-grid-cell-expand"`; floating cells dismissed; `grid.resetActiveCell()` called; `.slick-cell.active` background & border suppressed under `body.bp4-overlay-open`. |

---

## 3. Node Runner Environment Investigation

### 3.1 Environment Check Matrix

| Component | Path / Location | Version | System PATH? | Usable Status |
|---|---|---|:---:|:---:|
| **Node.js Local** | `D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe` | `v18.20.4` | **No** | **Primary & Ready** |
| **Node.js System** | `node` | N/A | **No** (`CommandNotFoundException`) | **Unavailable** |
| **npm.cmd Local** | `D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\npm.cmd` | `10.7.0` | **No** | **Primary & Ready** |
| **Git Local** | `D:\Shared_UserData\Downloads\tad\mingit\cmd\git.exe` | `2.43.0.windows.1` | **No** | **Primary & Ready** |
| **Jujutsu System** | `C:\Users\huydq\.cargo\bin\jj.exe` | `0.46.0` | In User Cargo Bin | **Ready** |
| **Jujutsu Local** | `D:\Shared_UserData\Downloads\tad\tools\jj\jj.exe` | `0.46.0` | In Workspace | **Primary & Ready** |

### 3.2 Operational Directive for Subagents
Any execution of Node, NPM, or Git commands in PowerShell **must** either:
1. Provide the explicit relative or absolute path:
   ```powershell
   & "node-v18.20.4-win-x64\node.exe" run_tests.js --all
   & "node-v18.20.4-win-x64\npm.cmd" run build
   & "mingit\cmd\git.exe" status
   ```
2. Or prepend the tools directories to `$env:PATH`:
   ```powershell
   $env:PATH = "$pwd\node-v18.20.4-win-x64;$pwd\mingit\cmd;$pwd\tools\jj;$env:PATH"
   ```

---

## 4. Packaging Scripts & Release Policies

### 4.1 Script Analysis

#### A. `dist_package.ps1` (Build & Package Pipeline)
- **Path**: `d:\Shared_UserData\Downloads\tad\dist_package.ps1`
- **Execution Order**:
  1. `Set-Location packages/host-bridge && npm.cmd run build`
  2. `Set-Location packages/reltab-duckdb && npm.cmd run build`
  3. `Set-Location packages/toadviewer && npm.cmd run build`
  4. `Set-Location packages/toad-app && npm.cmd run build-prod` (Webpack production, `devtool=false`, zero `.map` files)
  5. `npm.cmd run dist` & `npm.cmd run pack` (Electron Builder)
- **Gate Checks**:
  - `app.asar` footprint $\le 45.0\text{ MB}$ (Current ~40 MB).
  - Native binary `duckdb.node` verified in `app.asar.unpacked`.
  - Dependency verification: `lodash` present, dead SDK `reltab-bigquery` absent, `engineService.bundle.js` present.
  - Portable `.exe` size $\le 75.0\text{ MB}$ (Current ~72.38 MB).
- **Binary Distribution**:
  - Copies output `.exe` to `$releaseDir\Toad-$version-x64-portable.exe`.
  - Copies output `.exe` to `$rootDir\Toad.exe`.
  - Prunes duplicate binaries from root and releases.

#### B. `package_release.ps1` (Release Preparation)
- **Path**: `d:\Shared_UserData\Downloads\tad\package_release.ps1`
- Invokes `.agents\skills\releases\scripts\package_release.ps1`.
- Compresses executable into `Toad-2.5.1-x64-portable.zip`.
- Computes SHA-256 hashes and writes `releases\SHA256SUMS.txt`.
- Generates Winget manifest `releases\HelloKittyXamKinLung.Toad.yaml`.

#### C. `tools/clean_cache.ps1` (Cache Cleaner)
- **Path**: `d:\Shared_UserData\Downloads\tad\tools\clean_cache.ps1`
- Cleans legacy binary versions (`Toad-2.3.5*`, `Toad-2.4.8.1*`), historical release folders (`releases\v*`), temporary test profiles (`toadAppData_*`), intermediate build caches (`build/`, `release/win-unpacked`), and `scratch/` files.

### 4.2 Zero-Duplicate Binary Verification

Inspection of the filesystem confirms compliance with the Zero-Duplicate Binary Policy:
- **Root Directory (`d:\Shared_UserData\Downloads\tad\`)**:
  - Exactly one executable: `Toad.exe` (75,892,176 bytes = 72.38 MB).
  - No alias binaries (`Toad 2.0.x.exe`, `Toad 2.1.x.exe`, etc.).
- **Releases Directory (`d:\Shared_UserData\Downloads\tad\releases\`)**:
  - Exactly one portable executable: `Toad-2.5.1-x64-portable.exe` (75,892,176 bytes = 72.38 MB).
  - Exactly one portable zip: `Toad-2.5.1-x64-portable.zip` (75,897,453 bytes = 72.38 MB).
  - Integrity file: `SHA256SUMS.txt` (matching both files).
  - Winget manifest: `HelloKittyXamKinLung.Toad.yaml`.
  - Release documentation notes.
  - No legacy binaries or old version duplicates.

---

## 5. Version Control System (VCS) Status & Standards

### 5.1 Jujutsu (`jj`) Status
- **Binaries**:
  - `tools\jj\jj.exe` (v0.46.0)
  - `C:\Users\huydq\.cargo\bin\jj.exe` (v0.46.0)
- **Repository Setup**: Initialized with `jj git init --colocate`.
- **Working Copy**:
  - Working copy commit: `@ zzmnykwo 9d9f5285 (no description set)`
  - Parent commit: `@- knnyptrm 7d354b5e main | test(qa): add Round 2 gate verification test suite and complete teamwork milestone`
- **Configured Identity**:
  - `user.name = "HelloKittyXamKinLung"`
  - `user.email = "p1rkr41n@users.noreply.github.com"`
- **Git Config (`mingit\cmd\git.exe`)**:
  - `user.name`: `HelloKittyXamKinLung`
  - `user.email`: `p1rkr41n@users.noreply.github.com`
- **Public Language Policy**:
  - 100% English commit messages, release titles, and notes.
  - Zero non-English text or enterprise credentials in git history.

---

## 6. Actionable Implementation Checklist for Squads

### Squad 1 (Core Mathematical Engine)
- [ ] Implement `calculateLineCount` and `getHeightAndScrollState` in `tad-master/packages/toadviewer/src/utils/CellLineCalculator.ts`.
- [ ] Author `tests/unit/test_cell_line_calculator.js` (25 test cases).
- [ ] Create `GridOverlayBus.ts` for unified cross-table event communication.

### Squad 2 (Sidebar File Management Table)
- [ ] Update `ProjectFilesTable.tsx` and `sidebar.less` to apply dynamic line calculation and 4-way collapse lifecycle.
- [ ] Update `tests/unit/test_project_files_table_wrap_resize.js` to assert dynamic $N \le 1$, $2 \le N \le 5$, and $N > 5$ heights.

### Squad 3 (Main SlickGrid Data Table)
- [ ] Update `DataGrid.tsx` (`tryExpandCell`) to use `CellLineCalculator` and handle outside click / Escape.
- [ ] Update `slickgrid.scss` to remove fixed `max-height: 180px` and add modal overlay suppression rules.
- [ ] Update `tests/unit/test_datagrid_floating_wrap.js` to assert dynamic $N$-line height and virtual coordinate invariance.

### Squad 4 (Parse Columns Dialog)
- [ ] In `RegexDialog.tsx`, remove `#ntab-nested` tab and `#btn-switch-nested`.
- [ ] Add `<option value="nested_json">Nested JSON</option>` to `minFormatSelect` and auto-switch view with auto-scan.
- [ ] Author `tests/unit/test_parse_dialog_nested_dropdown.js` (15 test cases).

### Squad 5 (Systems QA, Packaging & Release)
- [ ] In `RegexDialog.tsx`, add modal open active cell dismissal (`dismiss-grid-cell-expand` & `resetActiveCell()`).
- [ ] Author `tests/qa/test_modal_cell_glow_suppression.js` (10 test cases).
- [ ] Register all 3 new test suites in `run_tests.js`.
- [ ] Execute `& "node-v18.20.4-win-x64\node.exe" run_tests.js --all` and verify all 21 suites (593+ tests) pass 100%.
- [ ] Run `tools/clean_cache.ps1`, `dist_package.ps1`, and `package_release.ps1` to produce single canonical `Toad.exe` and `releases/Toad-2.5.1-x64-portable.*`.
- [ ] Commit via `jj describe -m "..."` under `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`.
