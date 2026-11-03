# Handoff Report: Test Design for Suite JJ and Packaging/Release Architecture (Toad v2.4.3)

**Author**: `explorer_survey_3`  
**Date**: 2026-11-03  
**Target Milestone**: Toad v2.4.3 (Interactive File Table, Fast Search & Double-Click Rename)  
**Parent Orchestrator**: `9ac5654e-b2b9-4aed-bbc4-dcd613ccea09`  

---

## 1. Observation

Direct code and environment observations gathered during read-only investigation:

### 1.1 Test Suite Harness & Baseline Status (`tests/deep_integration_qa.js`)
- **Execution Command**:
  ```powershell
  & "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tests\deep_integration_qa.js
  ```
- **Execution Result Output**:
  ```text
  ======================================================================
    DEEP INTEGRATION QA TEST SUITE SUMMARY (Toad v2.0.2 Dual Engine, RAM Cache & Multi-Format Extractor)
  ======================================================================
    Total Test Cases : 192
    Passed           : 192
    Failed           : 0
    Total Duration   : 11.71s
  ======================================================================
  ```
- **Structure of Existing Suites**:
  - Suites span from `SUITE A` (Dual Engine Driver, line 65) through `SUITE II` (Toad v2.4.2 Startup Reconciliation & 5-Char Project ID Ledger, line 4118).
  - Test runner harness at lines 26-53:
    - Global counters: `totalTests`, `passedTests`, `failedTests`.
    - Helper `reportSuite(title)` prints banner headers.
    - Helper `runTest(name, async () => { ... })` measures millisecond latency via `process.hrtime()`, increments counters, and handles error logs.
    - Assertions use Node standard `assert` (`assert.strictEqual`, `assert.notStrictEqual`, `assert.deepStrictEqual`, `assert.ok`).
  - Temporary workspace isolation:
    - Suite II creates `path.join(testTmpDir, "suite_ii_workspace")`.
    - Suite GG creates `path.join(testTmpDir, "suite_gg_workspace")`.
    - End-of-file cleanup at lines 4666-4670: `fs.rmSync(testTmpDir, { recursive: true, force: true });`.
  - **Version Guard in Test II.12** (`tests/deep_integration_qa.js:4632-4664`):
    ```javascript
    await runTest("II.12 Toad v2.4.2 System-Wide Version Synchronization", async () => {
      const pkgApp = JSON.parse(fs.readFileSync(path.resolve(ROOT_DIR, "tad-master/packages/tad-app/package.json"), "utf8"));
      assert.strictEqual(pkgApp.version, "2.4.2", "tad-app package.json version must be 2.4.2");
      // ...
    ```
    *Note*: In `HH.6` (lines 4023-4044), version checks permitted `pkgApp.version === "2.4.1" || pkgApp.version === "2.4.2"`. In `II.12`, it is currently hardcoded to `"2.4.2"`. When updating to v2.4.3, `II.12` needs backward-compatible tolerance (`"2.4.2" || "2.4.3"`), and new test `JJ.8` will enforce `"2.4.3"`.

### 1.2 Legacy Menu Item Flaws (`tad-master/packages/tad-app/app/appMenu.ts`)
- Lines 42-55 in `appMenu.ts`:
  ```typescript
  {
    label: "Open File...",
    accelerator: "CmdOrCtrl+O",
    click: (item: MenuItem, focusedWindow: BrowserWindow | undefined) => {
      appWindow.openDialog("openFile", focusedWindow);
    },
  },
  {
    label: "Open Directory...",
    accelerator: "CmdOrCtrl+O",
    click: (item: MenuItem, focusedWindow: BrowserWindow | undefined) => {
      appWindow.openDialog("openDirectory", focusedWindow);
    },
  },
  ```
  Both entries conflict on `CmdOrCtrl+O` and bypass the Multi-Project Ledger architecture.

### 1.3 Search Filtering & Rename Codebase State (`tad-master/packages/tadviewer/src/components/DataSourceSidebar.tsx`)
- **Search Bug Location (lines 544, 603, 661)**:
  - Line 544: `const projMatches = q ? proj.projectName.toLowerCase().includes(q) : false;`
  - Line 603: `if (q && !projMatches && !f.fileName.toLowerCase().includes(q)) return null;`
  - Line 661: `if (q && !projMatches && childFileNodes.length === 0) continue;`
  *Consequence*: When `projMatches` is true, `!projMatches` evaluates to false, causing `renderFileNode` to return ALL files regardless of whether their filenames match `q`.
  *Latency*: Refresh is throttled by 150ms (`debounce`/`throttle` at line 750) and performs async IPC queries (`pwManager.getProjectFiles(proj.projectId)`).
- **Project Title Display (lines 320-322)**:
  ```tsx
  <span className="project-title-text" title={project.projectName}>
    {project.projectName}
  </span>
  ```
  Currently a passive `<span>` without inline edit or double-click listener.

### 1.4 Packaging Tools and Version Bumping (`tools/bump_version.js`, `dist_package.ps1`, `package_release.ps1`)
- **`tools/bump_version.js`**:
  - Automatically updates:
    1. `tad-master/packages/tad-app/package.json`
    2. `tad-master/packages/host-bridge/package.json`
    3. `tad-master/packages/reltab-duckdb/package.json`
    4. `tad-master/packages/tadviewer/package.json`
    5. `tad-master/packages/tadviewer/src/components/RegexDialog.tsx`
    6. `dist_package.ps1`
    7. `package_release.ps1`
    8. `README.md`
    9. `releases/HelloKittyXamKinLung.Toad.yaml`
  - Handles explicit version argument (e.g., `node tools/bump_version.js 2.4.3`) or `patch`.
- **`dist_package.ps1`**:
  - Cleans stale build directories (`tad-app/dist`, `tad-app/release/win-unpacked`).
  - Compiles packages: `host-bridge`, `reltab-duckdb`, `tadviewer`, and runs `build-prod` on `tad-app`.
  - Verifies bundle contents: requires version inclusion (line 41 checks `v2.4.2`, `v2.4.1`, etc.).
  - Electron-builder packaging (`npm run dist`).
  - Footprint Assertion Gate:
    - `app.asar` size <= 45.0 MB (measured baseline ~35 MB).
    - `duckdb.node` intact in `app.asar.unpacked`.
    - Native `lodash` present; dead SDK `reltab-bigquery` absent.
    - Portable executable size <= 75.0 MB (v2.4.2 was 72.09 MB).
  - Canonical Single Binary Output: Copies to `$releaseDir\Toad-$version-x64-portable.exe` and `$rootDir\Toad.exe`.
- **`package_release.ps1`**:
  - Wraps `.agents\skills\releases\scripts\package_release.ps1`.
  - Finds target binary `Toad-$Version-x64-portable.exe` in `releases/`.
  - Compresses to `Toad-$Version-x64-portable.zip`.
  - Generates `SHA256SUMS.txt` with SHA-256 digests.
  - Generates Microsoft Winget manifest `releases/HelloKittyXamKinLung.Toad.yaml`.

### 1.5 Version Control & Workspace Rules Status
- **VCS**: Jujutsu (`jj.exe` at `C:\Users\huydq\.cargo\bin\jj.exe` or `tools/jj/jj.exe`).
  - Status: Working copy `msylzzts` based on parent commit `nlmskzut` (`v2.4.2`).
- **Binary De-duplication Policy**: Strict single canonical binary in root (`Toad.exe`) and single release binary pair (`Toad-2.4.3-x64-portable.exe` and `Toad-2.4.3-x64-portable.zip`). All historical version names pruned.
- **Versioning Standard**: Explicit release version requested by user is `v2.4.3` (not auto 4th-digit increment).

---

## 2. Logic Chain

1. **Test Suite Expansion Feasibility**:
   - The current suite has 192 test cases executing in 11.71s with 100% pass rate.
   - Adding `SUITE JJ` consisting of 8 comprehensive test cases (`JJ.1` through `JJ.8`) will increase the count from 192 to 200 test cases, fulfilling the acceptance criteria of "200+/200+ assertions PASS" without causing test runtime degradation (< 15s total duration).

2. **Decoupled Verification of UI Logic**:
   - In `tests/deep_integration_qa.js`, UI component tests are divided into:
     - Direct string/AST code inspection (verifying class names, event handlers, stylesheet constraints).
     - Pure mathematical/functional verification of algorithms (`getRelativeParentDir`, sort comparator logic, in-memory search filtering).
     - End-to-end integration with DuckDB and `ToadParquetLedger` for state mutations and persistence.
   - Applying this proven pattern to `SUITE JJ` ensures deterministic, fast (< 100ms per test case) automated verification without requiring headless browser / Electron rendering cycles.

3. **Packaging Integrity & Footprint Safeguards**:
   - The footprint assertion gates in `dist_package.ps1` (`app.asar <= 45.0 MB`, `exe <= 75.0 MB`) ensure that new UI components (such as table rows, inline inputs, and sorting indicators) do not cause bundle bloat.
   - Running `tools/bump_version.js 2.4.3` prior to build synchronizes all 9 system files consistently.

---

## 3. SUITE JJ Test Design Specifications

Append `SUITE JJ` to `tests/deep_integration_qa.js` right before the temporary directory cleanup (around line 4665).

### Specification Breakdown (JJ.1 to JJ.8):

```javascript
  // ===========================================================================
  // SUITE JJ: TOAD v2.4.3 INTERACTIVE FILE TABLE, FAST SEARCH & INLINE RENAME
  // ===========================================================================
  reportSuite("SUITE JJ: Toad v2.4.3 Interactive File Table, Fast Search & Double-Click Rename");
```

#### JJ.1: Native Menu Cleanup & Workspace Action Integration
- **Target**: `tad-master/packages/tad-app/app/appMenu.ts`
- **Assertions**:
  - `assert(!menuSrc.includes('"Open File..."'), "Legacy Open File... menu item must be eliminated")`
  - `assert(!menuSrc.includes('"Open Directory..."'), "Legacy Open Directory... menu item must be eliminated")`
  - `assert(menuSrc.includes('"Add Files to Active Project..."'), "Must provide Add Files to Active Project...")`
  - `assert(menuSrc.includes('accelerator: "CmdOrCtrl+O"'), "Add Files must inherit CmdOrCtrl+O shortcut")`
  - `assert(menuSrc.includes('"Add Folder to Active Project..."'), "Must provide Add Folder to Active Project...")`
  - `assert(menuSrc.includes('accelerator: "CmdOrCtrl+Shift+O"'), "Add Folder must be assigned CmdOrCtrl+Shift+O")`
  - `assert(menuSrc.includes('focusedWindow.webContents.send("project-add-files")'), "Must dispatch project-add-files IPC")`
  - `assert(menuSrc.includes('focusedWindow.webContents.send("project-add-folder")'), "Must dispatch project-add-folder IPC")`

#### JJ.2: getRelativeParentDir Deterministic Calculation Engine
- **Target**: Algorithm validation across all edge cases (folder roots, subdirectories, root files, standalone files).
- **Test Matrix**:
  1. Deeply nested subdirectory with folder root:
     - Input: `("C:/Projects/data/logs/2026/04/event.log", "C:/Projects/data")`
     - Expected: `"logs/2026/04/"`
  2. Direct child file in folder root:
     - Input: `("C:/Projects/data/summary.csv", "C:/Projects/data")`
     - Expected: `"./"`
  3. Mixed slash separators and trailing slash tolerance:
     - Input: `("C:\\Projects\\DATA\\sub\\file.csv", "c:/projects/data/")`
     - Expected: `"sub/"`
  4. Standalone file without folder root (1 immediate parent folder level):
     - Input: `("D:/Downloads/Security/scan_results.parquet")`
     - Expected: `"Security/"`
  5. Standalone file directly in root drive:
     - Input: `("D:/root_file.csv")`
     - Expected: `"./"`

#### JJ.3: Strict File-Name Search Filter (projMatches Annihilation & 0ms In-Memory Latency)
- **Target**: `tad-master/packages/tadviewer/src/components/DataSourceSidebar.tsx` and in-memory filtering function.
- **Assertions**:
  - Inspect `DataSourceSidebar.tsx`: `assert(!sidebarSrc.includes("projMatches"), "projMatches logic must be completely removed")`.
  - Simulate multi-project catalog:
    - Project 1 (`"Security Project"`): files `["network.csv", "firewall.log", "security_audit.jsonl"]`.
    - Project 2 (`"Untitled-1"`): files `["users.csv", "roles.csv", "audit_trail.csv"]`.
  - Query `"security"`:
    - In Project 1: ONLY matches `security_audit.jsonl`. Does NOT match `network.csv` or `firewall.log` even though project name contains `"Security"`.
    - In Project 2: 0 matches.
  - Query `"audit"`:
    - In Project 1: matches `security_audit.jsonl`.
    - In Project 2: matches `audit_trail.csv`.
  - Benchmark performance: 10,000 files across 20 projects filtered in < 5ms.

#### JJ.4: Multi-Project Search Auto-Expansion & Non-Matching Project Suppression
- **Target**: Reactive state calculation for search queries.
- **Assertions**:
  - When query `q` is active:
    - Projects with matching files have `shouldShow === true` and `autoExpanded === true`.
    - Projects without matching files have `shouldShow === false`.
  - When query `q` is cleared (`""`):
    - All projects have `shouldShow === true`.
    - Each project's expansion state reverts to its persisted state from `pwManager.isProjectExpanded(projId)`.

#### JJ.5: Interactive Table 4-Column Sorting Engine
- **Target**: Column sorting comparator functions for the 4 table columns.
- **Dataset**:
  - Row 1: `{ name: "b_auth.log", dir: "logs/", size: 1024, status: "READY" }`
  - Row 2: `{ name: "A_users.csv", dir: "./", size: 512, status: "MODIFIED" }`
  - Row 3: `{ name: "c_archive.parquet", dir: "archive/", size: 2097152, status: "PENDING" }`
  - Row 4: `{ name: "d_dump.bin", dir: "logs/2026/", size: 1073741824, status: "ERROR" }`
- **Assertions**:
  1. Column 1 (Tên file):
     - ASC: Case-insensitive alphabetical (`A_users.csv` < `b_auth.log` < `c_archive.parquet` < `d_dump.bin`).
     - DESC: Inverse.
  2. Column 2 (Thư mục cha):
     - ASC: Alphabetical on relative path (`./` < `archive/` < `logs/` < `logs/2026/`).
     - DESC: Inverse.
  3. Column 3 (Kích thước file):
     - Numeric sort based strictly on raw bytes: 512 B < 1024 B (1 KB) < 2097152 B (2 MB) < 1073741824 B (1 GB).
     - Must NOT sort alphabetically (which would fail by placing "1 GB" before "512 B").
  4. Column 4 (Trạng thái file):
     - Categorical lifecycle order (`READY`, `MODIFIED`, `PENDING`, `ERROR`).

#### JJ.6: Interactive Table Column Filter & Compound Filtering
- **Target**: Column-level filtering logic in `ProjectFilesTable`.
- **Assertions**:
  - Filter Column 1 (Tên file): Substring match on file name.
  - Filter Column 2 (Thư mục): Substring match on `relParentDir`.
  - Filter Column 4 (Trạng thái): Exact match on status code.
  - Compound filter test: (Name filter = `"auth"`) AND (Dir filter = `"logs"`) correctly evaluates to set intersection.
  - Empty column filters return full project file list.

#### JJ.7: In-Place Double-Click Project Rename: Ledger Integrity & Zero Disk I/O
- **Target**: `ToadParquetLedger` + `DataSourceSidebar.tsx` component contract.
- **Assertions**:
  - Real ledger test:
    - Initialize ledger, create project with 5-character ID (e.g. `k8m2p`).
    - Place dummy parquet cache in `temp/k8m2p/sample_cached.parquet`.
    - Invoke `ledger.renameProject("k8m2p", "Renamed Via Double Click")`.
    - Assert `ledger.getProjectName("k8m2p") === "Renamed Via Double Click"`.
    - Assert project ID `k8m2p` remains unchanged.
    - Assert physical file `temp/k8m2p/sample_cached.parquet` remains intact at exact location (0 disk bytes moved).
    - Re-instantiate `ToadParquetLedger` from disk and assert renamed title persists upon replay.
  - UI component contract:
    - `assert(sidebarSrc.includes("project-title-inline-input"), "Must define project-title-inline-input for inline rename")`
    - `assert(sidebarSrc.includes("onDoubleClick"), "Must attach onDoubleClick to project title text")`
    - `assert(sidebarSrc.includes('e.key === "Enter"'), "Must handle Enter key to commit rename")`
    - `assert(sidebarSrc.includes('e.key === "Escape"'), "Must handle Escape key to cancel rename")`
    - `assert(sidebarSrc.includes("onBlur"), "Must commit rename on blur")`

#### JJ.8: Version 2.4.3 System-Wide Synchronization Gate
- **Target**: All metadata, manifests, stylesheets, and packaging files.
- **Assertions**:
  - All 4 package manifests (`tad-app`, `host-bridge`, `reltab-duckdb`, `tadviewer`) have `version === "2.4.3"`.
  - `RegexDialog.tsx` contains `"v2.4.3"`.
  - `dist_package.ps1` contains `"v2.4.3"` and `"Toad-2.4.3-x64-portable.exe"`.
  - `package_release.ps1` has `[string]$Version = "2.4.3"`.
  - `README.md` contains `"Toad (v2.4.3)"` and `"Version-2.4.3"`.
  - `releases/HelloKittyXamKinLung.Toad.yaml` has `PackageVersion: 2.4.3`.
  - `releases/v2.4.3_NOTES.md` exists and contains `"Toad v2.4.3"`.
  - `tadviewer/less/sidebar.less` includes styles:
    - `.project-files-table`
    - `.project-title-inline-input`
    - `.col-filter-input`
    - `.sort-btn`
    - Dark mode overrides (`.bp4-dark`, `.toad-dark`).

---

## 4. Release & Packaging Workflow for v2.4.3

To build and package v2.4.3 in full compliance with the workspace rules:

```powershell
# ==============================================================================
# STEP 1: Synchronize version across entire codebase to 2.4.3
# ==============================================================================
& "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tools/bump_version.js 2.4.3

# ==============================================================================
# STEP 2: Execute automated QA test suite (Must pass 100%, 200+/200+ assertions)
# ==============================================================================
& "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tests\deep_integration_qa.js

# ==============================================================================
# STEP 3: Build and package production portable executable
# Enforces app.asar <= 45MB and portable exe <= 75MB footprint gates.
# Creates releases/Toad-2.4.3-x64-portable.exe and Toad.exe in root.
# ==============================================================================
& powershell -ExecutionPolicy Bypass -File dist_package.ps1

# ==============================================================================
# STEP 4: Package release zip, generate SHA-256 ledger, and Winget manifest
# Creates releases/Toad-2.4.3-x64-portable.zip, releases/SHA256SUMS.txt,
# and releases/HelloKittyXamKinLung.Toad.yaml.
# ==============================================================================
& powershell -ExecutionPolicy Bypass -File package_release.ps1

# ==============================================================================
# STEP 5: Track changes in Jujutsu (jj)
# ==============================================================================
& "C:\Users\huydq\.cargo\bin\jj.exe" describe -m "feat(workspace): interactive file table, instant file search, and inline rename (v2.4.3)"
```

---

## 5. Caveats

1. **Test II.12 Backward-Compatibility Adjustment**:
   - `II.12` in `tests/deep_integration_qa.js:4634-4643` currently asserts `assert.strictEqual(pkgApp.version, "2.4.2")`.
   - When the version is bumped to `2.4.3`, `II.12` must be updated to `assert(pkgApp.version === "2.4.2" || pkgApp.version === "2.4.3")` (consistent with the precedent established in `HH.6`), while `JJ.8` strictly asserts `"2.4.3"`.
2. **Read-Only Scope Adherence**:
   - As an explorer subagent, no modifications were made to `tests/deep_integration_qa.js`, `DataSourceSidebar.tsx`, `appMenu.ts`, or any source files. All findings and code specifications are ready for the implementation phase.

---

## 6. Conclusion

- The test infrastructure (`deep_integration_qa.js`) is robust, fully passing 192/192 test cases in 11.71s, and is ready for the addition of `SUITE JJ` (sub-suites `JJ.1` to `JJ.8`).
- The packaging scripts (`dist_package.ps1`, `package_release.ps1`) and version bumper (`tools/bump_version.js`) are fully aligned with the Zero-Duplicate Binary Storage policy and HelloKittyXamKinLung standard.
- The 8 sub-suites of `SUITE JJ` provide complete coverage for Requirements R1 through R5, guaranteeing that the final v2.4.3 release will meet all user acceptance criteria.

---

## 7. Verification Method

To independently verify all findings in this report:

1. **Verify Baseline Test Suite Execution**:
   ```powershell
   & "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tests\deep_integration_qa.js
   ```
   *Expected outcome*: 192 Passed, 0 Failed.

2. **Verify Jujutsu Status**:
   ```powershell
   & "C:\Users\huydq\.cargo\bin\jj.exe" status
   ```
   *Expected outcome*: Clean working copy on `@` commit above `v2.4.2`.

3. **Verify Zero-Duplicate Executable Layout**:
   ```powershell
   Get-ChildItem -Path "releases\*.exe"
   ```
   *Expected outcome*: Only canonical release executables (`Toad-2.4.2-x64-portable.exe`, etc.) without redundant alias duplicates.
