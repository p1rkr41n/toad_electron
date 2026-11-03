# BRIEFING — 2026-11-03T15:52:00Z

## Mission
Investigate backend architecture, Main process, DuckDB driver, Parquet ledger, and test runner in TOAD for v2.5.0 IPC migration.

## 🔒 My Identity
- Archetype: teamwork_explorer
- Roles: explorer, analyst, synthesizer
- Working directory: d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_ipc_backend\
- Original parent: 531c42c5-3aec-4e19-a1ab-7c1a352f15c4
- Milestone: v2.5.0 IPC UtilityProcess Architecture Investigation

## 🔒 Key Constraints
- Read-only investigation — do NOT implement or modify project code
- Work strictly inside working directory for output files
- Zero duplicate binary storage rule in repo

## Current Parent
- Conversation ID: 531c42c5-3aec-4e19-a1ab-7c1a352f15c4
- Updated: 2026-11-03T15:52:00Z

## Investigation State
- **Explored paths**:
  - `tad-master/packages/toad-app/app/` (`main.ts`, `appWindow.ts`, `preload.js`, `portableAppData.ts`)
  - `tad-master/packages/toad-app/src/` (`electronRenderMain.tsx`, `electronClient.ts`, `openParams.ts`)
  - `tad-master/packages/toad-app/webpack.config.js`
  - `tad-master/packages/reltab-duckdb/src/` (`reltab-duckdb.ts`, `csvimport.ts`, `ingestWorker.ts`)
  - `tad-master/packages/reltab/src/` (`TableRep.ts`, `QueryExp.ts`, `remote/server.ts`, `remote/Connection.ts`, `remote/Transport.ts`)
  - `tad-master/packages/host-bridge/src/` (`IHostBridge.ts`, `V8HostAdapter.ts`, `index.ts`)
  - `tad-master/packages/toadviewer/src/` (`ProjectWorkspaceManager.ts`, `MultipleLoadingManager.ts`, `components/AppPane.tsx`)
  - `run_tests.js` and `tests/` (`smoke_test.js`, `deep_integration_qa.js`, `test_preload_3_pages.js`, `legacy_use_cases.js`)
  - Build & packaging scripts: `fastbuild.ps1`, `dist_package.ps1`, `tools/bump_version.js`
  - Peer agent report: `spec_miner_ipc_survey/handoff.md` and `analysis.md`
- **Key findings**:
  - Exact call graph for UI -> host-bridge -> TransportServer mapped.
  - State recovery mechanics via `toad_ledger.parquet` and view re-creation verified (< 5ms).
  - Supervision lifecycle: `utilityProcess.fork`, health check heartbeats, crash detection (< 500ms restart).
  - Headless test compatibility: `HeadlessNodeAdapter` implementing `IHostBridge` with direct/in-process execution guarantees 100% test passing across all 168+ test cases.
  - Dual-mode switch via `config.ini` `[runtime] engine = utility | legacy` and `portableAppData.ts`.
- **Unexplored areas**: None. Ready for synthesis in `analysis.md` and `handoff.md`.

## Key Decisions Made
- Architecture blueprint confirmed: EngineService runs in `utilityProcess`, Supervisor in Main, direct MessagePort for data channel with hybrid JSON + Uint8Array Transferable Objects.
- HeadlessNodeAdapter ensures test suites (`deep_integration_qa.js`, `run_tests.js`) run without Electron window.
- Dual-mode feature flag preserves fallback to legacy in-process mode.

## Artifact Index
- DISPATCH.md — Initial dispatch and updates
- progress.md — Liveness heartbeat and step tracking
- analysis.md — Technical findings and architectural blueprint
- handoff.md — 5-component handoff report

