## 2026-11-03T09:45:58Z
You are a worker implementer agent. Your identity:
- Working directory: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_ui_error_m2\
- Role: UI Error & Status Engineer

MANDATORY FIRST STEP:
Read ORIGINAL_REQUEST.md at:
d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md

Read PROJECT.md at:
d:\Shared_UserData\Downloads\tad\.agents\teamwork\PROJECT.md

Read survey analysis reports:
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_error_ui\analysis.md
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\spec_miner_csv\analysis.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

EXCLUSIVE FILE OWNERSHIP:
You exclusively own and may modify:
- packages/tad-app/app/main.ts
- packages/tad-app/src/electronRenderMain.tsx
- packages/tadviewer/src/actions.ts
- packages/tadviewer/src/components/ProjectFilesTable.tsx
- packages/tadviewer/src/components/DataSourceSidebar.tsx
Do NOT modify any backend files owned by Milestone 1 (reltab-fs, csvimport, ingestWorker, portableAppData).

YOUR TASK: Implement Milestone 2 (R4):
1. Suppress Intrusive Modal Error Dialogs:
   - In `packages/tad-app/app/main.ts:errorDialog`: Suppress `dialog.showErrorBox()` unless `fatal === true`. For non-fatal errors, log to `log.error` instead of showing a blocking modal popup window.
   - In `packages/tad-app/src/electronRenderMain.tsx:14–33`: In `unhandledrejection` and `error` event listeners, replace `getHostBridge().showErrorDialog()` with `console.error()`.
2. Non-blocking Ingestion Error Handling & Logger Trace:
   - In `packages/tadviewer/src/actions.ts:openDataSourcePath`: Wrap `replaceCurrentView(path, stateRef, viewParams)` in `try ... catch`. On error:
     a) Log the full error trace via `console.error` (e.g. `console.error("[openDataSourcePath] Ingestion failed:", err);`), which `appWindow.ts:135` automatically forwards to `toad.log`.
     b) Mark the file status in `MultipleLoadingManager` as `"error"`.
     c) Call `setActiveLoadingFile({ isLoading: false, fileName, dsPath, percent: 0, error: err?.message || String(err) }, stateRef)` so that `AppPane.tsx:542-554` immediately displays the existing in-app center error card (`<Icon icon="error" ... />`) without freezing or blocking the sidebar.
   - In `packages/tadviewer/src/components/DataSourceSidebar.tsx:handleOpenFile`: Ensure any error during file opening is caught gracefully and does not throw an uncaught promise rejection.
3. Sidebar Exclamation Mark Circle Icon Badging:
   - In `packages/tadviewer/src/components/ProjectFilesTable.tsx:311–316`: For file status `"ERROR"`, render the exclamation mark circle icon using BlueprintJS `<Icon icon="error" size={12} style={{ color: "#ef4444" }} />` inside `<span className="status-indicator status-error" title="ERROR">`.
4. Compilation & Verification:
   - Run compilation check: `npm run build` or webpack check in `packages/tadviewer` and `packages/tad-app`.
   - Verify that non-blocking error handling works, file status badging renders, and no modal dialog pops up on ingestion failure.
