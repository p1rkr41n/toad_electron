# Original User Request

## Initial Request — 2026-11-03T15:48:44Z

Implement TOAD v2.5.0 IPC architectural migration to Electron utilityProcess and Tauri-like host bridge based on the approved plan in c:\Users\huydq\.gemini\antigravity\brain\489b863f-84dc-4fd6-bbfb-142488ba4d23\ke_hoach_chuyen_doi_ipc_utilityprocess.md and d:\Shared_UserData\Downloads\tad\docs\FUTURE_KE_HOACH_CHUYEN_DOI_MO_HINH_IPC_UTILITYPROCESS.md.

Integrity mode: development

Reference material:
- Plan: `c:\Users\huydq\.gemini\antigravity\brain\489b863f-84dc-4fd6-bbfb-142488ba4d23\ke_hoach_chuyen_doi_ipc_utilityprocess.md`
- Architecture: `d:\Shared_UserData\Downloads\tad\docs\FUTURE_KE_HOACH_CHUYEN_DOI_MO_HINH_IPC_UTILITYPROCESS.md`

## Requirements

### R1. Version Bumping & Dual-Mode Rollout
Bump target version to TOAD v2.5.0 (SemVer 3-digit `2.5.0` via `node tools/bump_version.js 2.5.0`). Implement a 3-phase incremental rollout with a dual-mode feature flag (`runtime.engine = "utility" | "legacy"`).

### R2. Host Bridge Abstraction & CLI Test Compatibility
Standardize UI communication via Tauri-like IPC (`window.toadBridge.invoke(command, payload)`), enabling `contextIsolation: true` and `nodeIntegration: false` in Renderer. Implement `HeadlessNodeAdapter` in `packages/host-bridge` implementing `IHostBridge` so that all 168+ CLI test cases continue running seamlessly without an Electron window.

### R3. Dedicated Engine Service & Hybrid Data Protocol
Separate DuckDB Driver, Parquet Ledger, and ingestion pipeline into a dedicated Electron `utilityProcess` (`engineService.ts`). Connect Renderer and `utilityProcess` directly via `MessagePort` using a hybrid data protocol (JSON for metadata/schema/counts and zero-copy transferable `ArrayBuffer` for table data blocks).

### R4. Crash Supervision & Auto-Recovery
Configure Main Process as Supervisor (`engineSupervisor.ts`). When `utilityProcess` exits unexpectedly, auto-restart in < 500ms from Parquet Ledger (`toad_ledger.parquet`), re-register views in < 5ms, and trigger a non-blocking toast notification "Động cơ phân tích vừa được tự động phục hồi" in UI (`AppPane.tsx`).

### R5. Packaging & VCS Conformance
Compile Webpack bundle for `engineService.bundle.js`, pack `duckdb.node` into `app.asar.unpacked`, and maintain `app.asar` size < 45 MB and portable executable < 75 MB. Maintain clean commits via Jujutsu (`jj`), follow zero-duplicate binary storage policy, and exclude intermediate artifacts and binaries from Git.

## Acceptance Criteria

### Test Suites Execution
- [ ] `node run_tests.js --all` passes 100% across all 4 test suites (Smoke Test, Deep Integration QA, Preload 3 Pages, Legacy Use Cases).
- [ ] Headless engine service test (`node tests/test_engine_service.js`) executes 1,000 queries over MessagePort with verified data integrity.
- [ ] Crash resilience test (`node tests/test_engine_crash_recovery.js`) verifies auto-restart within 500ms and state restoration from `toad_ledger.parquet`.

### Build and Packaging Verification
- [ ] `fastbuild.ps1` builds successfully including the engine service bundle.
- [ ] `dist_package.ps1` and `package_release.ps1` produce canonical portable release artifacts in `releases/` without duplicate historical binaries.
- [ ] Dual-mode engine flag toggles correctly between `utility` and `legacy` modes.
