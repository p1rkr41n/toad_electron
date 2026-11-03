## 2026-11-03T03:14:09Z
You are a teamwork_worker. Your identity is worker_m1.
Your working directory is: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m1\
You MUST read the authoritative request file at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
Also review:
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\PROJECT.md
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\spec_miner_survey_1\handoff.md
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_survey_2\handoff.md

FILE OWNERSHIP BOUNDARY:
You EXCLUSIVELY own:
- tad-master/packages/tad-app/app/appMenu.ts
- tad-master/packages/tad-app/src/electronRenderMain.tsx
DO NOT modify any other files.

TASK: Implement Requirement R1 (Menu Cleanup & Workspace Action Integration):
1. In tad-master/packages/tad-app/app/appMenu.ts:
   - Completely remove the legacy "Open File..." and "Open Directory..." menu items (lines 42-55).
   - Add "Add Files to Active Project..." with accelerator "CmdOrCtrl+O". When clicked, if focusedWindow exists, send IPC "project-add-files".
   - Add "Add Folder to Active Project..." with accelerator "CmdOrCtrl+Shift+O". When clicked, if focusedWindow exists, send IPC "project-add-folder".
2. In tad-master/packages/tad-app/src/electronRenderMain.tsx:
   - Add IPC listeners for "project-add-files" and "project-add-folder".
   - For "project-add-files": show native open file dialog via bridge.showOpenDialog({ title: "Add Files to Active Project", multiple: true }) and call ProjectWorkspaceManager.getInstance().addFilesToProject(activeProjectId, chosenFiles).
   - For "project-add-folder": show native open dialog via bridge.showOpenDialog({ title: "Add Folder to Active Project", directory: true }) and call ProjectWorkspaceManager.getInstance().addFolderToProject(activeProjectId, chosenFolder).
   - Guard against cancelled dialogs or null windows.
3. Build & verify:
   Run the build/typecheck command in tad-app (e.g. npm run compile or npm run build) to ensure no compilation errors.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Document your changes, build results, and verification in d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m1\handoff.md.
Maintain progress.md with timestamped heartbeats. When done, send a completion message to the orchestrator.
