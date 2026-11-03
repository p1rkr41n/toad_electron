## 2026-11-03T11:39:20Z
Execute the full rebrand of TAD to TOAD at version v2.4.8, including monorepo package renaming, webpack bundle and HTML updates, backward compatibility for .tad files, build script synchronization, QA regression testing, and portable packaging. User explicitly requested: "triển khai bằng nhiều subagent để triển khai nhanh nhất có thể" (use parallel subagents for fastest execution).

Working directory: d:\Shared_UserData\Downloads\tad
Integrity mode: development

Reference Plan: C:\Users\huydq\.gemini\antigravity\brain\489b863f-84dc-4fd6-bbfb-142488ba4d23\phuong_an_trien_khai_rebrand_toad_v2.4.8.md

## Requirements
- R1. Monorepo Package Renaming & Dependency Updates
- R2. Webpack Bundle & Asset Synchronization
- R3. File Format & Backward Compatibility
- R4. Internal SQL Views, UI Classes & Branding
- R5. Build Scripts, Regression Testing & Packaging


## 2026-11-03T15:49:44Z
Implement TOAD v2.5.0 IPC architectural migration to Electron utilityProcess and Tauri-like host bridge based on the approved plan in c:\Users\huydq\.gemini\antigravity\brain\489b863f-84dc-4fd6-bbfb-142488ba4d23\ke_hoach_chuyen_doi_ipc_utilityprocess.md and d:\Shared_UserData\Downloads\tad\docs\FUTURE_KE_HOACH_CHUYEN_DOI_MO_HINH_IPC_UTILITYPROCESS.md.

Integrity mode: development

Requirements:
- R1. Version Bumping & Dual-Mode Rollout (v2.5.0, dual-mode feature flag runtime.engine = "utility" | "legacy")
- R2. Host Bridge Abstraction & CLI Test Compatibility (window.toadBridge.invoke, HeadlessNodeAdapter in packages/host-bridge, all 168+ CLI test cases continue running)
- R3. Dedicated Engine Service & Hybrid Data Protocol (utilityProcess engineService.ts, MessagePort, hybrid JSON/ArrayBuffer protocol)
- R4. Crash Supervision & Auto-Recovery (engineSupervisor.ts, auto-restart < 500ms, Parquet ledger restoration, toast in AppPane.tsx)
- R5. Packaging & VCS Conformance (engineService.bundle.js, duckdb.node in app.asar.unpacked, app.asar < 45 MB, portable exe < 75 MB, jj commits)

Acceptance Criteria:
- node run_tests.js --all passes 100% across all 4 test suites
- node tests/test_engine_service.js (1,000 queries over MessagePort)
- node tests/test_engine_crash_recovery.js (auto-restart < 500ms)
- fastbuild.ps1, dist_package.ps1, package_release.ps1 succeed cleanly without duplicate binaries
- Dual-mode engine flag toggles correctly
