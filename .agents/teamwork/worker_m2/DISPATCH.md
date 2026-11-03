## 2026-11-03T03:14:19Z
You are a teamwork_worker. Your identity is worker_m2.
Your working directory is: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m2\
You MUST read the authoritative request file at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
Also review:
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\PROJECT.md
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\spec_miner_survey_1\handoff.md
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_survey_2\handoff.md

FILE OWNERSHIP BOUNDARY:
You EXCLUSIVELY own:
- tad-master/packages/tadviewer/src/components/ProjectFilesTable.tsx (new file)
- tad-master/packages/tadviewer/src/components/DataSourceSidebar.tsx
- tad-master/packages/tadviewer/less/sidebar.less
DO NOT modify any other files.

TASK: Implement Requirements R2, R3, R4 (Sidebar Workspace Overhaul):
1. Parent Directory Engine:
   Implement and export function getRelativeParentDir(filePath: string, folderRoot?: string): string.
   Handles: nested subdirs ("logs/2026/"), root files in folderRoot ("./"), standalone files (1 parent level e.g. "Security/"), root drive files ("./"), Windows backslashes normalization.
2. Requirement R2 (Double-Click Project Rename):
   In ProjectNodeLabel (DataSourceSidebar.tsx), double-clicking the project title text enters inline editing mode with an input (.project-title-inline-input).
   - Stop propagation so the project accordion does not expand/collapse.
   - On Enter or onBlur: commit rename if non-empty via pwManager.renameProject(project.projectId, trimmedName).
   - On Escape: cancel editing and restore previous project name.
   - ProjectId and parquet cache remain untouched (zero disk I/O).
3. Requirement R3 (Strict 100% File-Name Fast Search):
   - In DataSourceSidebar.tsx, completely remove projMatches logic.
   - Filter strictly 100% on f.fileName.toLowerCase().includes(q). Never match project name.
   - Implement in-memory reactive filtering via useMemo (0ms latency).
   - When search query is active: auto-expand projects containing matching files; hide projects with 0 matching files.
   - When search query is cleared: restore persisted expand/collapse states from pwManager.isProjectExpanded(proj.projectId).
4. Requirement R4 (Interactive 4-Column File Table Layout):
   Create ProjectFilesTable.tsx (or integrate into DataSourceSidebar.tsx) rendering a data-dense table with 4 columns:
   - Col 1: Tên file with format icon (getFileFormatIcon), title tooltip, text ellipsis.
   - Col 2: Thư mục cha using getRelativeParentDir.
   - Col 3: Kích thước using formatFileBytes (B/KB/MB/GB).
   - Col 4: Trạng thái (🟢 VALID/READY / 🔴 MODIFIED / ◌ PENDING / ! ERROR).
   - Table Header interactions:
     - Click column header toggles column filter input (.col-filter-input).
     - Sort button (▲/▼/⇅) sorts by column: Name (string localeCompare), Dir (string), Size (strictly numeric on fileSizeBytes), Status.
   - Clicking a table row triggers opening the file in the main view (reusing handleOpenFile / MultipleLoadingManager / openDataSourcePath).
5. Styling in tadviewer/less/sidebar.less:
   - .project-title-inline-input styling.
   - .project-files-table and .project-table-container with data-dense 24-26px row heights, text ellipsis.
   - Full support for both Light and Dark themes (.bp4-dark, .toad-dark) using Material Design 3 variables.
6. Compile tadviewer:
   Run build/typecheck command in tadviewer (e.g. npm run compile or tsc) to ensure no compilation errors.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Document your changes, build results, and verification in d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m2\handoff.md.
Maintain progress.md with timestamped heartbeats. When done, send a completion message to the orchestrator.
