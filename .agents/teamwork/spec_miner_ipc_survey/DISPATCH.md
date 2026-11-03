## 2026-11-03T15:51:47Z
You are spec_miner_ipc_survey, a teamwork_spec_miner subagent.
Your working directory is: d:\Shared_UserData\Downloads\tad\.agents\teamwork\spec_miner_ipc_survey\

Task Objective:
Exhaustively mine specifications, requirements, architecture, schemas, and protocols for the TOAD v2.5.0 IPC architectural migration.

Authoritative Reference Documents:
1. ORIGINAL_REQUEST: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md` (READ THIS FIRST)
2. Plan: `c:\Users\huydq\.gemini\antigravity\brain\489b863f-84dc-4fd6-bbfb-142488ba4d23\ke_hoach_chuyen_doi_ipc_utilityprocess.md`
3. Architecture: `d:\Shared_UserData\Downloads\tad\docs\FUTURE_KE_HOACH_CHUYEN_DOI_MO_HINH_IPC_UTILITYPROCESS.md`

Your Mission:
1. Read the reference documents thoroughly.
2. Extract the complete requirements specification for:
   - R1: Version Bumping (2.5.0) & Dual-mode rollout (`runtime.engine = "utility" | "legacy"`).
   - R2: Host Bridge Abstraction (`IHostBridge`, `window.toadBridge.invoke(command, payload)`, `HeadlessNodeAdapter` for 168+ CLI tests).
   - R3: Engine Service (`engineService.ts` in Electron `utilityProcess`) & Hybrid Data Protocol (JSON metadata/schema + zero-copy ArrayBuffer table data blocks over MessagePort).
   - R4: Engine Supervisor (`engineSupervisor.ts`, crash supervision, auto-restart < 500ms, Parquet ledger replay < 5ms, non-blocking toast "Động cơ phân tích vừa được tự động phục hồi" in `AppPane.tsx`).
   - R5: Webpack bundling for `engineService.bundle.js`, `duckdb.node` in `app.asar.unpacked`, file size limits (<45MB asar, <75MB portable exe), Jujutsu (`jj`) VCS conformance.
3. Detail all required IPC command names, payloads, return structures, and error codes.
4. Write your exhaustive findings to `d:\Shared_UserData\Downloads\tad\.agents\teamwork\spec_miner_ipc_survey\analysis.md`.
5. Write a complete handoff report to `d:\Shared_UserData\Downloads\tad\.agents\teamwork\spec_miner_ipc_survey\handoff.md` and send a completion message with the path to the orchestrator.
