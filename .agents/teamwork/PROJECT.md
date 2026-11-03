# Project: Toad v2.4.3 Project Management & File Table Overhaul

## Architecture
Toad v2.4.3 overhauls project workspace ergonomics and file interaction through 3 modular architectural milestones:
1. **Milestone 1 (Menu Modernization - R1)**: Deprecate legacy single-file/dir menu triggers in `appMenu.ts` and dispatch `project-add-files` / `project-add-folder` IPC to route directly into the active project workspace in `electronRenderMain.tsx`.
2. **Milestone 2 (Sidebar Workspace Overhaul - R2, R3, R4)**:
   - *In-Place Project Rename (R2)*: Double-click on `ProjectNodeLabel` in `DataSourceSidebar.tsx` to switch to inline `<input>`. Commits via `ProjectWorkspaceManager.renameProject` into the DuckDB Parquet Ledger (`csvimport.ts`), preserving `projectId` with 0 disk I/O.
   - *Strict 100% File-Name Fast Search (R3)*: Eradicate `projMatches` in `DataSourceSidebar.tsx`. Match exclusively against `f.fileName.toLowerCase()`. Instant 0ms in-memory reactive filtering via `useMemo`. Auto-expand matching projects and collapse/hide non-matching projects during search; restore previous expansion state on clear.
   - *Interactive 4-Column File Table Layout (R4)*: Replace nested tree file listing with a modular, data-dense `ProjectFilesTable` component (Name with icon/tooltip, Relative Parent Dir via `getRelativeParentDir`, Size formatted B/KB/MB/GB, Status indicator). Interactive header sorting (▲/▼/⇅) and column-level filters. Styled via `sidebar.less` supporting both Light and Dark modes.
3. **Milestone 3 (E2E Integration QA & Portable Release Packaging - R5)**: Automated test suite `SUITE JJ` (sub-suites JJ.1 to JJ.8) in `tests/deep_integration_qa.js` verifying all new features and reaching 200+ assertions passing 100%. Version bumped to `2.4.3` across all 10 files and packaged into portable single-binary releases (`Toad-2.4.3-x64-portable.exe` and `.zip`).

---

## Feature Inventory

Every feature discovered in the Survey phase is mapped to its architectural milestone:

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Menu Item Removal | Remove `Open File...` and `Open Directory...` from `appMenu.ts` | M1 | Survey |
| 2 | Add Files Menu Item | Add `Add Files to Active Project...` (`CmdOrCtrl+O`, IPC `project-add-files`) | M1 | Survey |
| 3 | Add Folder Menu Item | Add `Add Folder to Active Project...` (`CmdOrCtrl+Shift+O`, IPC `project-add-folder`) | M1 | Survey |
| 4 | Renderer Menu IPC Handlers | Listeners in `electronRenderMain.tsx` to prompt picker and add to active project | M1 | Survey |
| 5 | Double-Click Inline Rename Activation | Double-clicking `project-title-text` activates inline input in `ProjectNodeLabel` | M2 | Survey |
| 6 | Inline Project Rename Commit on Enter | Pressing Enter commits new name to Ledger via `pwManager.renameProject` | M2 | Survey |
| 7 | Inline Project Rename Commit on Blur | Blurring input commits new name to Ledger | M2 | Survey |
| 8 | Inline Project Rename Cancel on Escape | Pressing Escape discards changes and restores previous project name | M2 | Survey |
| 9 | Zero-Cost Ledger Rename Immutability | Preserves `projectId` and parquet cache intact, only updates metadata event | M2 | Survey |
| 10 | 100% File-Name Filter (Zero Collision) | Eliminate `projMatches`; search query strictly matches `f.fileName` | M2 | Survey |
| 11 | 0ms In-Memory Reactive Filter | Synchronous `useMemo` filtering over project files cache with 0ms latency | M2 | Survey |
| 12 | Search Auto-Expand Matching Projects | Auto-expand projects with matching files; hide non-matching projects | M2 | Survey |
| 13 | Search State Restoration on Clear | Clearing query restores saved expand/collapse states | M2 | Survey |
| 14 | Interactive 4-Column File Table | Data-dense table component (`ProjectFilesTable`) with 4 columns | M2 | Survey |
| 15 | File Name Column with Icon & Tooltip | File format icon, file name with text ellipsis, hover details tooltip | M2 | Survey |
| 16 | Relative Parent Directory Algorithm | `getRelativeParentDir(filePath, folderRoot)` calculation engine | M2 | Survey |
| 17 | File Size Column with Byte Formatting | Formatted size string (B/KB/MB/GB) | M2 | Survey |
| 18 | File Status Indicator Column | 🟢 VALID / 🔴 MODIFIED / ◌ PENDING / ! ERROR indicator | M2 | Survey |
| 19 | Table Header Column Filter Inputs | Clickable header toggling column filter text input | M2 | Survey |
| 20 | Table Header Sort Toggles (▲/▼/⇅) | Sort buttons for Name, Dir, Size (numeric), Status | M2 | Survey |
| 21 | Table Row Click File View Activation | Clicking table row opens file via `MultipleLoadingManager` & `openDataSourcePath` | M2 | Survey |
| 22 | Data-Dense Sidebar Styling (Light & Dark) | CSS rules in `sidebar.less` for table, inline input, 24-26px row height, themes | M2 | Survey |
| 23 | Integration QA Suite JJ | Tests JJ.1 through JJ.8 in `tests/deep_integration_qa.js` (200+ passing tests) | M3 | Survey |
| 24 | Version Bumping to v2.4.3 | Synchronize 10 target files to version 2.4.3 via `tools/bump_version.js` | M3 | Survey |
| 25 | Release Artifact Packaging v2.4.3 | Portable exe & zip packaging satisfying <=45MB asar and <=75MB exe gates | M3 | Survey |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Menu Modernization (R1) | Clean up `appMenu.ts`, add Add Files/Folder items & shortcuts, add renderer IPC handlers in `electronRenderMain.tsx` | none | DONE |
| M2 | Sidebar Workspace Overhaul (R2, R3, R4) | Double-click inline rename, strict 100% file search, `ProjectFilesTable.tsx`, `getRelativeParentDir`, LESS styles | none | DONE |
| M3 | E2E Integration QA Suite JJ & Packaging (R5) | Add SUITE JJ (JJ.1-JJ.8) to `tests/deep_integration_qa.js`, bump to 2.4.3, build & package portable release | M1, M2 | DONE |

---

## Code Layout & File Boundaries

To prevent concurrent write conflicts:
- **Milestone 1 Files (exclusively owned by M1)**:
  - `tad-master/packages/tad-app/app/appMenu.ts`
  - `tad-master/packages/tad-app/src/electronRenderMain.tsx`
- **Milestone 2 Files (exclusively owned by M2)**:
  - `tad-master/packages/tadviewer/src/components/ProjectFilesTable.tsx` (new component)
  - `tad-master/packages/tadviewer/src/components/DataSourceSidebar.tsx`
  - `tad-master/packages/tadviewer/less/sidebar.less`
- **Milestone 3 Files (exclusively owned by M3)**:
  - `tests/deep_integration_qa.js`
  - `tools/bump_version.js`, `dist_package.ps1`, `package_release.ps1`

---

## Interface Contracts

### 1. Menu IPC Contract (`appMenu.ts` -> `electronRenderMain.tsx`)
- Channel: `"project-add-files"` (no payload). Action: Prompts multi-file open dialog and calls `pwManager.addFilesToProject(activeProjectId, chosenPaths)`.
- Channel: `"project-add-folder"` (no payload). Action: Prompts folder open dialog and calls `pwManager.addFolderToProject(activeProjectId, chosenFolder)`.

### 2. Parent Directory Engine Contract (`getRelativeParentDir`)
```typescript
export function getRelativeParentDir(filePath: string, folderRoot?: string): string;
```
- Input: `filePath` (full normalized or raw path), `folderRoot` (optional root directory path).
- Output: normalized relative path ending with `"/"` (e.g. `"logs/2026/"`, `"./"` if root or direct parent).

### 3. File Table Component Contract (`ProjectFilesTable`)
```typescript
export interface ProjectFilesTableProps {
  files: ProjectWorkspaceFile[];
  activeFilePath?: string;
  onOpenFile: (file: ProjectWorkspaceFile) => void;
  stateRef: StateRef<AppState>;
}
```

### 4. Project Inline Rename Contract
```typescript
onRenameCommit: (newName: string) => Promise<boolean>;
```
- Invokes `pwManager.renameProject(project.projectId, newName)`.
- Reverts to `project.projectName` on error or empty string.
