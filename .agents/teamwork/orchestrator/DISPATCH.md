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

## 2026-11-04T15:22:33Z
Use a full team of subagents to implement Column Resizing and Active Row Auto-Wrap across both the File Management Table and Main Data Grid in ToadViewer based on the approved 11-stream plan.

Integrity mode: development

Reference material:
- Plan: `C:/Users/huydq/.gemini/antigravity/brain/489b863f-84dc-4fd6-bbfb-142488ba4d23/ke_hoach_trien_khai_auto_wrap_va_keo_dan_cot_song_song.md`
- Design Spec: `C:/Users/huydq/.gemini/antigravity/brain/489b863f-84dc-4fd6-bbfb-142488ba4d23/thiet_ke_tinh_nang_auto_wrap_va_keo_dan_cot.md`

## Requirements

### R1. File Management Table Column Resizing & Active Row Auto-Wrap
Implement draggable column header divider resizers (`col-resizer-handle`) between headers (`Name`, `DirPath`, `Size`, `Status`) in `ProjectFilesTable.tsx` with minWidth clamping (45px) and double-click auto-fit based on longest visible text. Implement active row auto-wrap on click (`is-selected`) expanding dynamically (`white-space: normal; word-break: break-all; overflow-wrap: anywhere; max-height: 180px; overflow-y: auto;`) while unselected rows stay compact single-line. Collapse on clicking another row, toggle clicking selected row, clicking outside table, or pressing `Escape`.

### R2. Main Data Grid Double-Click Auto-Fit & Floating In-Place Active Cell Wrap
In `DataGrid.tsx` (SlickGrid), implement double-click on header resizer handles to calculate max string length on visible rows and auto-fit column width. Implement Floating In-Place Wrap on active/selected cell/row (`.slick-cell-active-expanded`, `z-index: 20`, light border, soft shadow `0 4px 14px rgba(0, 0, 0, 0.15)`, `max-height: 180px; overflow-y: auto; white-space: normal; word-break: break-word;`) without distorting SlickGrid virtual scroll coordinates. Dismiss expanded cell on grid scroll or pressing `Escape`.

### R3. CSS Design System, Blueprint Theme & Keyboard Accessibility
Standardize visual styling in `sidebar.less` and `slickgrid.scss` for Light and Dark themes, including custom slim scrollbars (4px, `border-radius: 2px`), subtle divider line on hover/drag (`rgba(2, 132, 199, 0.75)`), and `.col-resizing` cursor management. Isolate events to prevent row selection when dragging column dividers (`e.stopPropagation()`), handle `window.onblur`/`mouseleave` to cancel unfinished dragging, and support `Escape` key to collapse wrapped rows/cells.

### R4. Automated Unit, Stress Test Suites & Runner Integration
Create automated test suites:
- `tests/unit/test_project_files_table_wrap_resize.js` (15 test cases covering column width initialization, drag resize, minWidth clamping, double-click auto-fit, selection wrap, and collapse).
- `tests/unit/test_datagrid_floating_wrap.js` (15 test cases covering SlickGrid double-click auto-fit, floating active cell expansion, z-index/shadow isolation, and scroll/Escape dismissal).
- `tests/qa/test_grid_wrap_concurrency_stress.js` (10 test cases verifying 100K+ rows virtual scrolling concurrency, memory stability, > 55 scroll FPS, and coordinate preservation).
Register all new test suites into `run_tests.js` so that `node run_tests.js --all` passes 100%.

### R5. Release Packaging, VCS & Workspace Standards
Enforce workspace standards: commit using Jujutsu (`jj`), author strictly `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`, zero enterprise/organization credential leaks, and English-only public text. Compile TypeScript, run Webpack production build, execute packaging via `dist_package.ps1` and `package_release.ps1`, maintaining zero duplicate binaries and executable size < 75 MB.

## Acceptance Criteria

### Unit and Stress Testing
- [ ] `node tests/unit/test_project_files_table_wrap_resize.js` passes all 15 test cases.
- [ ] `node tests/unit/test_datagrid_floating_wrap.js` passes all 15 test cases.
- [ ] `node tests/qa/test_grid_wrap_concurrency_stress.js` passes all 10 stress test cases.
- [ ] `node run_tests.js --all` executes all registered suites with 100% PASS.

### Functional & Interaction Criteria
- [ ] Dragging header resizers in `ProjectFilesTable` resizes columns smoothly with minimum 45px width, and double-clicking auto-fits to content.
- [ ] Clicking a row in `ProjectFilesTable` wraps text up to 180px with a scrollbar; clicking again, outside, or pressing `Escape` collapses it.
- [ ] Double-clicking SlickGrid column header resizers auto-fits column width based on visible rows.
- [ ] Selected active cells in `DataGrid` with overflowing text display floating expanded in-place without altering virtual scroll row coordinates, and dismiss on scroll or `Escape`.

### Build & Release Verification
- [ ] TypeScript compilation and Webpack production build succeed without errors.
- [ ] `dist_package.ps1` and `package_release.ps1` produce canonical portable artifacts in `releases/` adhering to the zero-duplicate binary policy.
- [ ] All commits are recorded with `jj` under author `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`.
