# BRIEFING — 2026-11-04T18:45:00Z

## Mission
Survey Frontend source (`toadviewer`) and Host Bridge integration (`host-bridge`) for the Toad Tauri v2 porting project.

## 🔒 My Identity
- Archetype: explorer
- Roles: investigation, synthesis
- Working directory: d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_survey_1
- Original parent: 07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d
- Milestone: Phase 0 - Survey

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Inspect tad-master/packages/toadviewer and tad-master/packages/host-bridge
- Map all IPC commands, aliases, data structures, and edge cases
- Write survey_frontend_report.md, handoff.md, progress.md

## Current Parent
- Conversation ID: 07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d
- Updated: 2026-11-04T18:43:35Z

## Investigation State
- **Explored paths**:
  - `tad-master/packages/toadviewer`: `package.json`, `webpack.config.js`, `src/toadviewer.ts`, `DataGrid.tsx`, `slickgrid.scss`, `CellLineCalculator.ts`, `GridOverlayBus.ts`, `RegexDialog.tsx`, `ProjectFilesTable.tsx`, `NestedFieldsTable.tsx`, `FilterEditor.tsx`, `PivotRequester.ts`, `MultipleLoadingManager.ts`, `ProjectWorkspaceManager.ts`
  - `tad-master/packages/host-bridge`: `commandAliases.ts`, `IHostBridge.ts`, `TauriHostAdapter.ts`, `index.ts`
  - `tad-master/packages/reltab`: `QueryExp.ts`, `FilterExp.ts`, `hybridProtocol.ts`, `Connection.ts`, `Transport.ts`
  - `tad-master/packages/toad-app`: `package.json`, `appMain.tsx`
  - `tauri/docs`: `TAURI_V2_AI_COMPACT.md`, `develop/calling-rust.md`, `tauri_v2_full.md`, `guides.md`
- **Key findings**:
  - `toadviewer` is 100% pure TypeScript/React 18 with ZERO native C++ Node dependencies.
  - Reverse mapping collision in `commandAliases.ts`: `reduce` overwrites `toad:eval_query` to `evalQuery`, `toad:row_count` to `rowCount`, etc.
  - Arrow IPC Stream continuation indicator `0xFFFFFFFF` detected by `isArrowIPC` and decoded via `@apache-arrow/es2015-cjs` `tableFromIPC(u8)`.
  - In `TauriHostAdapter.ts`, setting `dataPort: true` activates the `invokeBinary` path in `reltab/Connection.ts`.
  - Vite 5 requires `{ find: /^~/, replacement: '' }` alias to resolve Less/Sass imports (`~slickgrid-es6`, `~@blueprintjs`).
  - Dynamic `require("host-bridge")` in click handlers must be replaced by static ESM imports.
- **Unexplored areas**: None for Phase 0 Frontend & Host Bridge scope.

## Key Decisions Made
- Fully documented all 33 IPC commands and aliases.
- Documented complete 5-component hard handoff.

## Artifact Index
- `survey_frontend_report.md` — Comprehensive survey report
- `handoff.md` — 5-component hard handoff report
- `progress.md` — Liveness heartbeat and status log
- `DISPATCH.md` — Audit log of parent notifications
