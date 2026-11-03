# Handoff Report: Architecture Mapping & Technical Implementation Plan (Toad v2.4.3)

**Author:** `explorer_survey_2` (Teamwork Explorer)  
**Target Milestone:** Toad v2.4.3 — Interactive File Table, Fast Search & Double-Click Rename  
**Authority Reference:** `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`  
**Reference Specification:** `C:\Users\huydq\.gemini\antigravity\brain\489b863f-84dc-4fd6-bbfb-142488ba4d23\phuong_an_chi_tiet_file_table_search_va_project_rename_v2.4.3.md`

---

## 1. Observation

Direct observations from the exploration across `tad-master/` and workspace tools:

### Observation 1.1: Native Menu Items (`tad-master/packages/tad-app/app/appMenu.ts`)
- **Location:** Lines 42–55 in `createMenu()`
- **Verbatim Code:**
  ```typescript
  42:     {
  43:       label: "Open File...",
  44:       accelerator: "CmdOrCtrl+O",
  45:       click: (item: MenuItem, focusedWindow: BrowserWindow | undefined) => {
  46:         appWindow.openDialog("openFile", focusedWindow);
  47:       },
  48:     },
  49:     {
  50:       label: "Open Directory...",
  51:       accelerator: "CmdOrCtrl+O",
  52:       click: (item: MenuItem, focusedWindow: BrowserWindow | undefined) => {
  53:         appWindow.openDialog("openDirectory", focusedWindow);
  54:       },
  55:     },
  ```
- **Context:** Both items conflict with each other by sharing `CmdOrCtrl+O` accelerator. They invoke `appWindow.openDialog`, which creates a single-file/single-directory window or replaces the view outside of the Multi-Project Workspace Ledger.
- **IPC Dispatch Pattern in same file:** Lines 57–64 demonstrate how window menu items communicate with renderer:
  ```typescript
  57:     {
  58:       label: "Reopen / Reload Current File",
  59:       accelerator: "CmdOrCtrl+R",
  60:       click: (item: MenuItem, focusedWindow: BrowserWindow | undefined) => {
  61:         if (focusedWindow) {
  62:           focusedWindow.webContents.send("reopen-current-file");
  63:         }
  64:       },
  65:     },
  ```
- **Renderer IPC Receiver (`tad-master/packages/tad-app/src/electronRenderMain.tsx`):**
  Lines 276–279:
  ```typescript
  276:     ipcRenderer.on("reopen-current-file", async () => {
  277:       log.info("electronRenderMain: received reopen-current-file IPC");
  278:       await actions.reopenCurrentView(stateRef);
  279:     });
  ```

---

### Observation 1.2: Component Layout & Current Architecture in `tadviewer`
- **Location:** `tad-master/packages/tadviewer/src/components/DataSourceSidebar.tsx` (1,430 lines)
- **Component Inventory:**
  - `ProjectSidebar.tsx`, `ProjectSidebarContainer.tsx`, and `ProjectNode.tsx` do **NOT** currently exist as separate standalone files in `tadviewer/src/`.
  - All sidebar view components are co-located in `DataSourceSidebar.tsx`:
    - `FileTreeItemLabel`: Lines 112–284 (renders tooltip hover card, file badge, row count, percent).
    - `ProjectNodeLabel`: Lines 286–404 (renders project row with title, active badge, orphan badge, file count/size pill, and hover action buttons).
    - `DataSourceSidebar`: Lines 439–1355 (renders sidebar container, project header, search input, Blueprint `Tree`, and modal confirmation dialogs).
- **Mounted In:** `tad-master/packages/tadviewer/src/components/AppPane.tsx`:
  - Line 6: `import { DataSourceSidebar } from "./DataSourceSidebar";`
  - Line 654: `<DataSourceSidebar expanded={dataSourceExpanded} stateRef={stateRef} />`

---

### Observation 1.3: Search Filter Logic & the `projMatches` Bug
- **Location:** `tad-master/packages/tadviewer/src/components/DataSourceSidebar.tsx`
- **Lines 539–545:**
  ```typescript
  539:         const q = searchQuery.toLowerCase().trim();
  540: 
  541:         for (const proj of ws.projects) {
  542:           const files = await pwManager.getProjectFiles(proj.projectId);
  543:           const isExpanded = pwManager.isProjectExpanded(proj.projectId);
  544:           const projMatches = q ? proj.projectName.toLowerCase().includes(q) : false;
  ```
- **Lines 602–605:**
  ```typescript
  602:           const renderFileNode = (f: ProjectWorkspaceFile): DSTreeNodeInfo | null => {
  603:             if (q && !projMatches && !f.fileName.toLowerCase().includes(q)) {
  604:               return null;
  605:             }
  ```
- **Line 661:**
  ```typescript
  661:           if (q && !projMatches && childFileNodes.length === 0) {
  662:             continue;
  663:           }
  ```
- **Direct Cause of Bug:** When `q` matches a substring of `proj.projectName` (e.g. typing `u`, `1`, `unt` for `Untitled-1`), `projMatches` becomes `true`. As a result, `!projMatches` is `false`, so line 603 condition `q && !projMatches && !f.fileName...` evaluates to `false`. `renderFileNode` **never filters out non-matching files**, rendering every single file in the project!
- **Refresh Latency:** Refresh is wrapped in `throttle(..., 150)` and performs async ledger IPC on every keystroke (`await pwManager.getProjectFiles(proj.projectId)` inside loop), causing noticeable keystroke latency.

---

### Observation 1.4: Project Rename & Ledger Store State
- **Parquet Ledger Backend (`tad-master/packages/reltab-duckdb/src/csvimport.ts`):**
  Lines 693–725:
  ```typescript
  693:   public async renameProject(
  694:     projectId: string,
  695:     newName: string
  696:   ): Promise<boolean> {
  697:     if (!projectId || projectId === "orphan_prj") return false;
  698:     const name = (newName || "").trim();
  699:     if (!name) return false;
  700:     const proj = this.projects.get(projectId);
  701:     if (!proj) return false;
  702: 
  703:     proj.projectName = name;
  704:     // Zero-Cost Rename: Chỉ cập nhật metadata trong Parquet Ledger
  705:     await this.recordEvent({
  706:       event_id: `prj-ren-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  707:       event_type: "PROJECT_CREATE",
  ...
  724:     return true;
  725:   }
  ```
- **Main IPC Handler (`tad-master/packages/tad-app/app/main.ts`):**
  Lines 329–331:
  ```typescript
  329:   ipcMain.handle("project:rename", async (event, req) => {
  330:     return await ledger.renameProject(req?.projectId, req?.newName);
  331:   });
  ```
- **ProjectWorkspaceManager Store (`tad-master/packages/tadviewer/src/ProjectWorkspaceManager.ts`):**
  Lines 242–260:
  ```typescript
  242:   public async renameProject(projectId: string, newName: string): Promise<boolean> {
  243:     if (!projectId || projectId === "orphan_prj" || !newName.trim()) return false;
  244:     const bridge = getBridge();
  ...
  247:         const res = await bridge.invoke("project:rename", { projectId, newName: newName.trim() });
  248:         this.notify();
  249:         return !!res;
  ...
  260:   }
  ```
- **Existing Rename UI (`DataSourceSidebar.tsx`):**
  Lines 320–322:
  ```tsx
  <span className="project-title-text" title={project.projectName}>
    {project.projectName}
  </span>
  ```
  Currently renaming is only accessible via right-click Context Menu (line 1093) triggering modal Dialog (lines 1244–1286). Double-click inline editing does not yet exist.

---

### Observation 1.5: Sidebar Styles (`tad-master/packages/tadviewer/less/sidebar.less`)
- **Structure:**
  - Lines 1–68: `.sidebar` basic layout and dark mode color variables (`--md-sys-color-surface-container-low`, `--md-sys-color-on-surface`, `--md-sys-color-primary`).
  - Lines 368–403: `.bp4-tree-node-content` constrained to `height: 30px !important`, `line-height: 30px !important`, `overflow: hidden`.
  - Lines 409–465: `.project-workspace-header` styling with top row and `.project-search-input`.
  - Lines 468–612: `.project-node-row` with active state (`.is-active`), orphan state (`.is-orphan`), title group, and hover actions (`.project-hover-actions`).
  - Lines 618–720: `.file-node-row` with status dots (`.status-dot-ready`, `.status-dot-pending`, `.status-badge-modified`, etc.).
  - Lines 812–905: Comprehensive dark mode overrides for `.sidebar`, `.project-workspace-header`, `.project-node-row`, and `.file-node-row`.

---

### Observation 1.6: QA Test Harness & Version Packaging
- **QA Suite (`tests/deep_integration_qa.js`):**
  - Total lines: 4,693 lines.
  - Tests SUITE A through SUITE II.
  - Line 4632: `II.12 Toad v2.4.2 System-Wide Version Synchronization`.
- **Packaging Pipeline:**
  - `dist_package.ps1`: Builds host-bridge, reltab-duckdb, tadviewer, tad-app, checks bundle content, runs `electron-builder`, verifies `app.asar` footprint <= 45 MB and exe <= 75 MB.
  - `package_release.ps1`: Calls `.agents/skills/releases/scripts/package_release.ps1` to produce `-x64-portable.exe` and `-x64-portable.zip` with SHA-256 checksums and release notes.
  - `tools/bump_version.js`: Synchronizes version across `tad-app/package.json`, `host-bridge/package.json`, `reltab-duckdb/package.json`, `tadviewer/package.json`, `RegexDialog.tsx`, `dist_package.ps1`, `package_release.ps1`, `README.md`, and `releases/HelloKittyXamKinLung.Toad.yaml`.

---

## 2. Logic Chain

From the observations above, the implementation logic chain is established step-by-step:

### Step 2.1: Native Menu Cleanup (R1)
1. **Premise:** Toad has transitioned entirely from a single-file viewer to a Multi-Project Workspace Ledger architecture.
2. **From Observation 1.1:** `Open File...` and `Open Directory...` in `appMenu.ts` call `appWindow.openDialog(...)` which bypasses the active project ledger. Both compete for `CmdOrCtrl+O`.
3. **Reasoning:**
   - Removing `Open File...` and `Open Directory...` eliminates obsolete legacy single-window behavior.
   - Replacing them with `Add Files to Active Project...` (`CmdOrCtrl+O`) and `Add Folder to Active Project...` (`CmdOrCtrl+Shift+O`) restores familiar shortcuts while routing actions into the active project.
   - When clicked, `focusedWindow.webContents.send("project-add-files")` and `focusedWindow.webContents.send("project-add-folder")` dispatch IPC to the active renderer window.
   - In renderer (`electronRenderMain.tsx` or `DataSourceSidebar.tsx`), listeners receive these events, trigger `getHostBridge().showOpenDialog(...)`, and invoke `ProjectWorkspaceManager.getInstance().addFilesToProject` or `addFolderToProject`.

### Step 2.2: Double-Click Inline Rename (R2)
1. **From Observation 1.4:** The ledger (`csvimport.ts`) and workspace manager (`ProjectWorkspaceManager.ts`) already support zero-cost project renaming (`renameProject(projectId, newName)`) without altering `projectId` or cache.
2. **From Observation 1.4:** In `DataSourceSidebar.tsx`, `ProjectNodeLabel` renders `.project-title-text` as a static span.
3. **Reasoning:**
   - Add state `isEditingName: boolean` (default `false`) and `tempName: string` to `ProjectNodeLabel` (or manage in `DataSourceSidebar`).
   - On double-click of the title text: set `isEditingName = true`, populate `tempName = project.projectName`.
   - In editing mode: render `<input className="project-title-inline-input" ... autoFocus />`.
   - Prevent event bubbling on click/double-click so the project accordion doesn't toggle.
   - On `Enter` or `onBlur`: validate `tempName.trim()`. If non-empty and changed, await `pwManager.renameProject(project.projectId, tempName.trim())`. Then exit editing mode.
   - On `Escape`: revert `tempName` to `project.projectName` and exit editing mode without calling the API.

### Step 2.3: Zero-Latency Strict File Name Search (R3)
1. **From Observation 1.3:** The current filter bug occurs because `projMatches = proj.projectName.toLowerCase().includes(q)` causes non-matching files to be rendered if the project name matches `q`.
2. **From Observation 1.3:** Keystrokes are throttled to 150ms and issue asynchronous IPC ledger queries during the loop.
3. **Reasoning:**
   - Delete `projMatches` completely. A query string `q` must **only** match `f.fileName.toLowerCase().includes(q)`.
   - Implement **in-memory reactive filtering**:
     Store all project files in a React state/memo `allProjectFilesMap: Map<string, ProjectWorkspaceFile[]>` populated when workspace changes or files are loaded.
     When `searchQuery` updates, use a pure synchronous `useMemo` to filter in memory:
     - Match calculation takes < 1ms across hundreds of files.
     - For each project:
       - If `q` is active: `matchingFiles = files.filter(f => f.fileName.toLowerCase().includes(q))`.
       - If `q` is active and `matchingFiles.length === 0`: `shouldShow = false` (hide project).
       - If `q` is active and `matchingFiles.length > 0`: `shouldShow = true`, `isExpanded = true` (auto-expand).
       - If `q` is empty: show all projects with their saved expand state from `pwManager.isProjectExpanded(proj.projectId)`.

### Step 2.4: Interactive Data Table Layout & Relative Parent Directory (R4)
1. **From Observation 1.2 & 1.5:** The current file list is rendered using BlueprintJS `Tree` where each node has fixed `height: 30px !important`.
2. **From Reference Plan:** The user requested an interactive 4-column data table for each project:
   - **Col 1 (Tên file):** Icon + display name + hover tooltip with full details.
   - **Col 2 (Thư mục cha):** Calculated via `getRelativeParentDir(filePath, folderRoot)`.
   - **Col 3 (Kích thước):** Formatted size in B/KB/MB/GB.
   - **Col 4 (Trạng thái):** 🟢 VALID / 🔴 MODIFIED / ◌ PENDING / ! ERROR.
3. **Table Header Interactions:**
   - Click column header -> opens column filter input.
   - Click sort button (`▲` / `▼` / `⇅`) -> sorts rows by that column (A-Z, Z-A, or numeric for size).
4. **Integration Architecture Choice:**
   - Instead of trying to force a `<table>` inside Blueprint `Tree` `<li>` nodes (which would conflict with Blueprint CSS), render each project as an accordion container:
     - Header: Caret icon + ProjectNodeLabel (with inline rename, badges, action buttons).
     - Expanded Body: Dedicated `<ProjectFilesTable files={files} ... />` component.
   - Clicking a table row triggers `handleOpenFile(file)`, reusing the existing `actions.openDataSourcePath(dsPath, stateRef)` and `MultipleLoadingManager` prioritization logic.
5. **Algorithm for `getRelativeParentDir`:**
   ```typescript
   export function getRelativeParentDir(filePath: string, folderRoot?: string): string {
     const normFile = filePath.replace(/\\/g, "/");
     const fileDir = normFile.substring(0, normFile.lastIndexOf("/"));
     
     if (folderRoot) {
       const normRoot = folderRoot.replace(/\\/g, "/").replace(/\/+$/, "");
       if (fileDir.toLowerCase().startsWith(normRoot.toLowerCase())) {
         const rel = fileDir.substring(normRoot.length).replace(/^\/+/, "");
         return rel ? `${rel}/` : "./";
       }
     }
     
     const parts = fileDir.split("/").filter(Boolean);
     return parts.length > 0 ? `${parts[parts.length - 1]}/` : "./";
   }
   ```

### Step 2.5: Stylesheet Enhancements (`sidebar.less`)
1. **From Observation 1.5:** `.sidebar` supports both light and dark mode (`.bp4-dark, .toad-dark`).
2. **Reasoning:**
   - Add `.project-title-inline-input`: compact, high-contrast border in light/dark.
   - Add `.project-files-table`:
     - Clean, data-dense table (`border-collapse: collapse`, row height 24–26px).
     - Column widths: Name (38%), Dir (30%), Size (18%), Status (14%).
     - Sticky or clean header with `.th-content`, `.sort-btn`, and `.col-filter-input`.
     - Text ellipsis on name and directory cells.
     - Hover background and active/selected background matching the app's accent theme.
     - Full dark mode theme matching Material Design 3 variables already established in `sidebar.less`.

### Step 2.6: Verification & Packaging (R5)
1. **From Observation 1.6:** `tests/deep_integration_qa.js` is the authoritative QA harness.
2. **Reasoning:**
   - Append `SUITE JJ: Project File Table, Fast Search & Double-Click Rename` with tests JJ.1 through JJ.7.
   - Bump version from `2.4.2` to `2.4.3` across all package files using `tools/bump_version.js 2.4.3`.
   - Run tests to confirm 100% PASS.
   - Run `package_release.ps1 -Version "2.4.3"` to produce portable `.exe` and `.zip`.

---

## 3. Caveats

1. **Standalone Component Files vs Co-location:**
   The dispatch prompt inquired about `ProjectSidebar.tsx`, `ProjectSidebarContainer.tsx`, `ProjectNode.tsx`. As verified in Observation 1.2, these components were previously designed directly within `DataSourceSidebar.tsx`. The implementer can either keep the new `ProjectFilesTable` co-located in `DataSourceSidebar.tsx` or extract it into `ProjectFilesTable.tsx` within `tadviewer/src/components/`. Extracting `ProjectFilesTable.tsx` is recommended for clean separation of concerns and maintainability.
2. **Folder Collapse vs Flat Table:**
   As decided in the approved plan (`phuong_an_chi_tiet_file_table_search_va_project_rename_v2.4.3.md`), the Flat Table layout is preferred over nested folder groups. Flat Table allows multi-column sorting (e.g. sorting all files in the project by size or status) across the entire project while clearly showing each file's relative parent folder via `getRelativeParentDir`.
3. **Search In-Memory Cache Sync:**
   Because projects and files can be added, deleted, or updated via background loading or IPC, the in-memory map must update whenever `pwManager.subscribe` or `MultipleLoadingManager` triggers an event.

---

## 4. Conclusion & Detailed Technical Implementation Plan

### 4.1 Target File Mapping & Change Matrix

| Component | Target File | Nature of Change | Key Changes |
|-----------|-------------|------------------|-------------|
| **Native Menu** | `tad-master/packages/tad-app/app/appMenu.ts` | [MODIFY] | Remove `Open File...` and `Open Directory...`. Add `Add Files to Active Project...` (`CmdOrCtrl+O`) and `Add Folder to Active Project...` (`CmdOrCtrl+Shift+O`). |
| **Renderer IPC** | `tad-master/packages/tad-app/src/electronRenderMain.tsx` | [MODIFY] | Add listeners for `project-add-files` and `project-add-folder` to trigger file/folder open dialog for active project. |
| **Parent Dir Logic** | `tad-master/packages/tadviewer/src/ProjectWorkspaceManager.ts` (or `DataSourceSidebar.tsx`) | [ADD] | Export `getRelativeParentDir(filePath: string, folderRoot?: string): string`. |
| **File Table Component** | `tad-master/packages/tadviewer/src/components/ProjectFilesTable.tsx` (or inside `DataSourceSidebar.tsx`) | [NEW / ADD] | 4-column data table: Name, Dir, Size, Status. Column filtering, column sorting (`▲`/`▼`/`⇅`), row click open. |
| **Double-Click Rename** | `tad-master/packages/tadviewer/src/components/DataSourceSidebar.tsx` | [MODIFY] | In `ProjectNodeLabel`, double-click toggles inline input. Enter/blur commits `renameProject`, Esc cancels. |
| **Fast Search Filter** | `tad-master/packages/tadviewer/src/components/DataSourceSidebar.tsx` | [MODIFY] | Remove `projMatches`. Filter strictly 100% on file name. Auto-expand matching projects, hide non-matching projects. |
| **Styling** | `tad-master/packages/tadviewer/less/sidebar.less` | [MODIFY] | Add styles for `.project-title-inline-input`, `.project-files-table`, header sorting, column filter inputs, row density, and dark mode overrides. |
| **QA Test Suite** | `tests/deep_integration_qa.js` | [MODIFY] | Add SUITE JJ (JJ.1 to JJ.7) verifying menu cleanup, `getRelativeParentDir`, search filter, sorting, column filtering, rename. |
| **Version & Packaging** | `tools/bump_version.js` & packaging scripts | [MODIFY / EXEC] | Bump to v2.4.3, build bundles, run tests, package portable release. |

---

### 4.2 Concrete Implementation Blueprint

#### A. Menu Item Updates (`appMenu.ts`)
```typescript
// Replace lines 42-55 in tad-master/packages/tad-app/app/appMenu.ts:
    {
      label: "Add Files to Active Project...",
      accelerator: "CmdOrCtrl+O",
      click: (item: MenuItem, focusedWindow: BrowserWindow | undefined) => {
        if (focusedWindow) {
          focusedWindow.webContents.send("project-add-files");
        }
      },
    },
    {
      label: "Add Folder to Active Project...",
      accelerator: "CmdOrCtrl+Shift+O",
      click: (item: MenuItem, focusedWindow: BrowserWindow | undefined) => {
        if (focusedWindow) {
          focusedWindow.webContents.send("project-add-folder");
        }
      },
    },
```

#### B. Renderer Menu IPC Receivers (`electronRenderMain.tsx`)
```typescript
// Add to electronRenderMain.tsx init() alongside reopen-current-file:
    ipcRenderer.on("project-add-files", async () => {
      try {
        const { getHostBridge } = require("host-bridge");
        const bridge = getHostBridge();
        const chosen = await bridge.showOpenDialog({
          title: "Add Files to Active Project",
          multiple: true,
        });
        if (chosen && chosen.length > 0) {
          const { ProjectWorkspaceManager } = require("tadviewer");
          const pwManager = ProjectWorkspaceManager.getInstance();
          const ws = await pwManager.getWorkspace();
          const activeId = ws.activeProjectId || "prj_untitled_1";
          await pwManager.addFilesToProject(activeId, chosen);
        }
      } catch (err) {
        log.error("Error adding files from menu:", err);
      }
    });

    ipcRenderer.on("project-add-folder", async () => {
      try {
        const { getHostBridge } = require("host-bridge");
        const bridge = getHostBridge();
        const chosen = await bridge.showOpenDialog({
          title: "Add Folder to Active Project",
          directory: true,
        });
        if (chosen && chosen.length > 0) {
          const { ProjectWorkspaceManager } = require("tadviewer");
          const pwManager = ProjectWorkspaceManager.getInstance();
          const ws = await pwManager.getWorkspace();
          const activeId = ws.activeProjectId || "prj_untitled_1";
          await pwManager.addFolderToProject(activeId, chosen[0]);
        }
      } catch (err) {
        log.error("Error adding folder from menu:", err);
      }
    });
```

#### C. `getRelativeParentDir` Implementation
```typescript
export function getRelativeParentDir(filePath: string, folderRoot?: string): string {
  const normFile = filePath.replace(/\\/g, "/");
  const fileDir = normFile.substring(0, normFile.lastIndexOf("/"));
  
  if (folderRoot) {
    const normRoot = folderRoot.replace(/\\/g, "/").replace(/\/+$/, "");
    if (fileDir.toLowerCase().startsWith(normRoot.toLowerCase())) {
      const rel = fileDir.substring(normRoot.length).replace(/^\/+/, "");
      return rel ? `${rel}/` : "./";
    }
  }
  
  // Standalone file: 1 direct parent directory level
  const parts = fileDir.split("/").filter(Boolean);
  return parts.length > 0 ? `${parts[parts.length - 1]}/` : "./";
}
```

#### D. Double-Click Inline Rename (`ProjectNodeLabel`)
```tsx
export const ProjectNodeLabel: React.FC<{
  project: ProjectWorkspaceProject;
  isActive: boolean;
  onRenameCommit?: (newName: string) => void;
  // ... other props
}> = ({ project, isActive, onRenameCommit, ... }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(project.projectName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditName(project.projectName);
  }, [project.projectName]);

  const commitRename = () => {
    setIsEditing(false);
    const trimmed = editName.trim();
    if (trimmed && trimmed !== project.projectName && onRenameCommit) {
      onRenameCommit(trimmed);
    } else {
      setEditName(project.projectName);
    }
  };

  const cancelRename = () => {
    setIsEditing(false);
    setEditName(project.projectName);
  };

  return (
    <div className={`project-node-row ${isActive ? "is-active" : ""}`}>
      <div className="project-node-title-group">
        {isEditing ? (
          <input
            ref={inputRef}
            className="project-title-inline-input"
            value={editName}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") cancelRename();
            }}
            onBlur={commitRename}
          />
        ) : (
          <span
            className="project-title-text"
            title="Double-click to rename"
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (!project.isOrphan) {
                setIsEditing(true);
              }
            }}
          >
            {project.projectName}
          </span>
        )}
        {/* ... badges and hover actions */}
      </div>
    </div>
  );
};
```

#### E. Strict File Name Search Filter (In-Memory Reactive)
```typescript
// Replace throttledRefresh search logic with in-memory memoization:
const q = searchQuery.toLowerCase().trim();

const filteredProjects = useMemo(() => {
  return workspaceProjects.map((proj) => {
    const files = projectFilesMap.get(proj.projectId) || [];
    // Strictly filter by file name ONLY; never match against project name
    const matchingFiles = q
      ? files.filter((f) => f.fileName.toLowerCase().includes(q))
      : files;

    return {
      project: proj,
      files: matchingFiles,
      shouldShow: !q || matchingFiles.length > 0,
      isExpanded: q ? matchingFiles.length > 0 : pwManager.isProjectExpanded(proj.projectId),
    };
  }).filter((p) => p.shouldShow);
}, [workspaceProjects, projectFilesMap, searchQuery]);
```

#### F. Interactive Table Layout (`ProjectFilesTable`)
```tsx
export interface ProjectFilesTableProps {
  files: ProjectWorkspaceFile[];
  activeFilePath?: string;
  onOpenFile: (file: ProjectWorkspaceFile) => void;
  stateRef: StateRef<AppState>;
}

export const ProjectFilesTable: React.FC<ProjectFilesTableProps> = ({
  files,
  activeFilePath,
  onOpenFile,
  stateRef,
}) => {
  type SortCol = "name" | "dir" | "size" | "status";
  const [sortCol, setSortCol] = useState<SortCol>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filterOpenCol, setFilterOpenCol] = useState<SortCol | null>(null);
  const [filters, setFilters] = useState<{ [K in SortCol]?: string }>({});

  const handleSort = (col: SortCol, e: React.MouseEvent) => {
    e.stopPropagation();
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  const processedFiles = useMemo(() => {
    let result = files.map((f) => ({
      ...f,
      relDir: getRelativeParentDir(f.filePath, f.folderRoot),
    }));

    // Column Filters
    if (filters.name) {
      const q = filters.name.toLowerCase();
      result = result.filter((f) => f.fileName.toLowerCase().includes(q));
    }
    if (filters.dir) {
      const q = filters.dir.toLowerCase();
      result = result.filter((f) => f.relDir.toLowerCase().includes(q));
    }
    if (filters.size) {
      const q = filters.size.toLowerCase();
      result = result.filter((f) => formatFileBytes(f.fileSizeBytes).toLowerCase().includes(q));
    }
    if (filters.status) {
      const q = filters.status.toLowerCase();
      result = result.filter((f) => (f.status || "").toLowerCase().includes(q));
    }

    // Sort
    result.sort((a, b) => {
      let cmp = 0;
      if (sortCol === "name") {
        cmp = a.fileName.localeCompare(b.fileName);
      } else if (sortCol === "dir") {
        cmp = a.relDir.localeCompare(b.relDir);
      } else if (sortCol === "size") {
        cmp = (a.fileSizeBytes || 0) - (b.fileSizeBytes || 0);
      } else if (sortCol === "status") {
        cmp = (a.status || "").localeCompare(b.status || "");
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [files, sortCol, sortDir, filters]);

  // Render <table> with 4 columns
  return (
    <div className="project-table-container">
      <table className="project-files-table">
        <thead>
          <tr>
            <th className="col-name" onClick={() => setFilterOpenCol(filterOpenCol === "name" ? null : "name")}>
              <div className="th-content">
                <span>Tên file</span>
                <button className="sort-btn" onClick={(e) => handleSort("name", e)}>
                  {sortCol === "name" ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
                </button>
              </div>
              {filterOpenCol === "name" && (
                <input
                  className="col-filter-input"
                  placeholder="Lọc tên..."
                  value={filters.name || ""}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setFilters({ ...filters, name: e.target.value })}
                />
              )}
            </th>
            <th className="col-dir" onClick={() => setFilterOpenCol(filterOpenCol === "dir" ? null : "dir")}>
              <div className="th-content">
                <span>Thư mục cha</span>
                <button className="sort-btn" onClick={(e) => handleSort("dir", e)}>
                  {sortCol === "dir" ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
                </button>
              </div>
              {filterOpenCol === "dir" && (
                <input
                  className="col-filter-input"
                  placeholder="Lọc thư mục..."
                  value={filters.dir || ""}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setFilters({ ...filters, dir: e.target.value })}
                />
              )}
            </th>
            <th className="col-size" onClick={() => setFilterOpenCol(filterOpenCol === "size" ? null : "size")}>
              <div className="th-content">
                <span>Kích thước</span>
                <button className="sort-btn" onClick={(e) => handleSort("size", e)}>
                  {sortCol === "size" ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
                </button>
              </div>
              {filterOpenCol === "size" && (
                <input
                  className="col-filter-input"
                  placeholder="Lọc size..."
                  value={filters.size || ""}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setFilters({ ...filters, size: e.target.value })}
                />
              )}
            </th>
            <th className="col-status" onClick={() => setFilterOpenCol(filterOpenCol === "status" ? null : "status")}>
              <div className="th-content">
                <span>Trạng thái</span>
                <button className="sort-btn" onClick={(e) => handleSort("status", e)}>
                  {sortCol === "status" ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
                </button>
              </div>
              {filterOpenCol === "status" && (
                <input
                  className="col-filter-input"
                  placeholder="Lọc trạng thái..."
                  value={filters.status || ""}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                />
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {processedFiles.length === 0 ? (
            <tr className="empty-row">
              <td colSpan={4}>Không có tệp phù hợp</td>
            </tr>
          ) : (
            processedFiles.map((f) => (
              <tr
                key={f.filePath}
                className={`file-table-row ${activeFilePath === f.filePath ? "is-selected" : ""}`}
                onClick={() => onOpenFile(f)}
              >
                <td className="cell-name">
                  {getFileFormatIcon(f.fileName)}
                  <span className="file-name-text" title={f.fileName}>{f.fileName}</span>
                </td>
                <td className="cell-dir" title={f.relDir}>{f.relDir}</td>
                <td className="cell-size">{formatFileBytes(f.fileSizeBytes)}</td>
                <td className="cell-status">
                  <span className={`status-indicator status-${(f.status || "").toLowerCase()}`}>
                    {f.status === "READY" ? "🟢" : f.status === "MODIFIED" ? "🔴" : "◌"}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};
```

#### G. CSS Rules (`sidebar.less`)
```less
/* ==========================================================================
   Project Title Inline Input (v2.4.3 Double-Click Rename)
   ========================================================================== */
.project-title-inline-input {
  height: 20px;
  font-size: 12px;
  font-weight: 600;
  padding: 0 4px;
  border: 1px solid #0284c7;
  border-radius: 3px;
  outline: none;
  background: #ffffff;
  color: #0f172a;
  max-width: 140px;
}

/* ==========================================================================
   Interactive Project Files Table (v2.4.3 Data-Dense 4-Column Table)
   ========================================================================== */
.project-table-container {
  width: 100%;
  overflow-x: auto;
  padding: 2px 0 6px;
}

.project-files-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  table-layout: fixed;

  thead th {
    padding: 3px 6px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #64748b;
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
    background: rgba(0, 0, 0, 0.02);
    user-select: none;
    cursor: pointer;

    .th-content {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 2px;
    }

    .sort-btn {
      background: transparent;
      border: none;
      cursor: pointer;
      font-size: 10px;
      padding: 0 2px;
      color: #94a3b8;
      &:hover { color: #0284c7; }
    }

    .col-filter-input {
      width: 100%;
      height: 18px;
      margin-top: 2px;
      font-size: 10px;
      padding: 0 3px;
      border: 1px solid #cbd5e1;
      border-radius: 2px;
      outline: none;
    }
  }

  /* Column widths */
  .col-name { width: 38%; }
  .col-dir { width: 32%; }
  .col-size { width: 17%; text-align: right; }
  .col-status { width: 13%; text-align: center; }

  tbody tr.file-table-row {
    height: 24px;
    cursor: pointer;
    border-bottom: 1px solid rgba(0, 0, 0, 0.03);
    transition: background-color 0.1s ease;

    &:hover {
      background-color: rgba(0, 0, 0, 0.04);
    }

    &.is-selected {
      background-color: #0284c7 !important;
      color: #ffffff !important;

      .file-name-text, .cell-dir, .cell-size {
        color: #ffffff !important;
      }
    }
  }

  td {
    padding: 2px 6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cell-name {
    display: flex;
    align-items: center;
    line-height: 20px;
    .file-name-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 500;
    }
  }

  .cell-dir {
    color: #64748b;
    font-size: 10px;
  }

  .cell-size {
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-size: 10px;
    color: #64748b;
  }

  .cell-status {
    text-align: center;
    font-size: 9px;
  }

  .empty-row td {
    text-align: center;
    color: #94a3b8;
    padding: 12px;
    font-style: italic;
  }
}

// Dark Mode Overrides (v2.4.3)
.bp4-dark,
.toad-dark {
  .project-title-inline-input {
    background: #1e293b;
    color: #ffffff;
    border-color: #38bdf8;
  }

  .project-files-table {
    thead th {
      color: #94a3b8;
      border-bottom-color: rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.02);

      .sort-btn {
        color: #64748b;
        &:hover { color: #38bdf8; }
      }

      .col-filter-input {
        background: #1e293b;
        color: #ffffff;
        border-color: #475569;
      }
    }

    tbody tr.file-table-row {
      border-bottom-color: rgba(255, 255, 255, 0.04);

      &:hover {
        background-color: rgba(255, 255, 255, 0.05);
      }

      &.is-selected {
        background-color: var(--md-sys-color-primary-container, #1f385c) !important;
        color: #ffffff !important;
      }
    }

    .cell-dir, .cell-size {
      color: #94a3b8;
    }
  }
}
```

---

## 5. Verification Method

To independently verify the implementation, execute the following commands and check the specified assertions:

### 5.1 Verification Commands
```powershell
# 1. Run the comprehensive integration QA suite (must yield 100% PASS across 200+ assertions including SUITE JJ)
& "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tests\deep_integration_qa.js

# 2. Compile tadviewer and tad-app
cd "D:\Shared_UserData\Downloads\tad\tad-master\packages\tadviewer"
& npm.cmd run build

cd "D:\Shared_UserData\Downloads\tad\tad-master\packages\tad-app"
& npm.cmd run build-prod

# 3. Build & Package Toad v2.4.3 release
cd "D:\Shared_UserData\Downloads\tad"
& powershell -ExecutionPolicy Bypass -File .\dist_package.ps1
& powershell -ExecutionPolicy Bypass -File .\package_release.ps1 -Version "2.4.3"
```

### 5.2 Specific Assertions to Verify
1. **Menu Cleanup Verification (JJ.1):**
   `appMenu.ts` source contains `"Add Files to Active Project..."` and `"Add Folder to Active Project..."`, but does **not** contain `"Open File..."` or `"Open Directory..."`.
2. **Parent Directory Calculation (JJ.2):**
   - File inside subfolder of folderRoot: `getRelativeParentDir("C:/data/repo/sub/log.csv", "C:/data/repo") === "sub/"`.
   - File directly in folderRoot: `getRelativeParentDir("C:/data/repo/log.csv", "C:/data/repo") === "./"`.
   - Standalone file: `getRelativeParentDir("D:/downloads/log.csv") === "downloads/"`.
3. **Search In-Memory Filter (JJ.3 & JJ.4):**
   - Querying `"Untitled"` does not match any file in a project named `"Untitled-1"` if files are named `data.csv`.
   - Querying `"data"` matches `data.csv`, leaves `shouldShow: true`, and marks `isExpanded: true`.
   - Project with zero matching files is marked `shouldShow: false`.
4. **Table Sort & Column Filter (JJ.5 & JJ.6):**
   - Sorting by Name, Dir, Size (numeric comparison), and Status orders files accurately in ascending and descending directions.
   - Column filter correctly filters rows matching the column substring.
5. **Double-Click Rename (JJ.7):**
   - Calling `pwManager.renameProject(projectId, "Incident-Alpha")` updates `projectName` in ledger, preserves original `projectId`, and emits workspace change event.
6. **Binary Artifact Integrity:**
   - Single canonical release binaries generated: `releases/Toad-2.4.3-x64-portable.exe` and `releases/Toad-2.4.3-x64-portable.zip`.
   - `Toad.exe` in root updated. Zero duplicate version binaries stored.
