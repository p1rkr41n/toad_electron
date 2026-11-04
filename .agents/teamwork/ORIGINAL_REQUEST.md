# Original User Request

## Initial Request — 2026-11-04T17:53:36Z

Use a team of 20 engineers across 5 squads to implement intelligent line calculation & auto-wrap across all three tables, refactor the Parse Columns dialog, and suppress background active cell highlights behind modal overlays in ToadViewer.

Integrity mode: development

Reference material:
- Plan: `C:/Users/huydq/.gemini/antigravity/brain/489b863f-84dc-4fd6-bbfb-142488ba4d23/ke_hoach_trien_khai_20_ki_su_song_song.md`

## Requirements

### R1. Intelligent Line Calculation & Dynamic Auto-Wrap across All 3 Tables
Implement pure mathematical and heuristic line calculation in `tad-master/packages/toadviewer/src/utils/CellLineCalculator.ts` and dynamic auto-wrap across:
- Table 1 (Sidebar Files Table): `ProjectFilesTable.tsx`, `less/sidebar.less`
- Table 2 (Main DataGrid): `DataGrid.tsx`, `src/slickgrid.scss`
- Table 3 (Parse Columns Table): `RegexDialog.tsx`, `NestedFieldsTable.tsx`, `less/nested-dialog.less`

Contract specifications:
- N <= 1 line: Flat single-line, NO expansion, NO elevation, default height (24px-25px), no scrollbar.
- 2 <= N <= 5 lines: Expand to fit exactly N lines (height = N * 17px + 8px), NO scrollbar (`overflow-y: hidden`).
- N > 5 lines: Capped height at exactly 5 lines (approx 93-95px), enable slim 4px vertical scrollbar (`overflow-y: auto`).
- 4-way collapse lifecycle: re-click active cell, click another cell, click outside, or press `Escape`.

### R2. Parse Columns Header & Format Dropdown Refactor
In `RegexDialog.tsx`:
- Remove `#ntab-nested` from header mode switcher. Top tabs strictly only: `[Visual]` and `[Regex]`.
- In `minFormatSelect` dropdown (`using [Format ▾]`): add `<option value="nested_json">Nested JSON</option>`.
- Remove redundant button `#btn-switch-nested` (`Auto-Flatten Available ➔`).
- When `nested_json` is selected: trigger scan `triggerNestedScan(100)` if empty, and switch dialog body to the Nested JSON view (`SampleScanController`, `NestedFieldsTable`, live DuckDB SQL Preview).
- When other formats are selected: switch back to the Visual sample and rule mapping view.
- Update `handleApply` to support both `formatType === "nested_json"` and `mode === "nested_json"`.

### R3. Active Cell Highlight Suppression behind Modal Overlays
In `RegexDialog.tsx` and `slickgrid.scss`:
- When dialog opens (`isOpen === true`), dispatch `"dismiss-grid-cell-expand"`, dismiss floating cell nodes (`.slick-cell-active-expanded`, `.slick-row-has-expanded`, `.slick-row-active-expanded`), and call `grid.resetActiveCell()`.
- When `body.bp4-overlay-open` is active, suppress `.slick-cell.active`, `.slick-row.active`, `.slick-cell.selected` (background transparent, box-shadow none, outline none, border transparent) so no cell glows white or blue behind modal overlays.
- Coordinate cross-component overlay events via `tad-master/packages/toadviewer/src/utils/GridOverlayBus.ts`.

### R4. Automated Unit & Stress Test Suites
Implement new test suites:
- `tests/unit/test_cell_line_calculator.js`: 25 test cases for boundary line counts (N = 1, 2, 5, 6, 100), column widths (45px to 1200px), special characters, and nested JSON.
- `tests/unit/test_parse_dialog_nested_dropdown.js`: 15 test cases verifying tab switcher, format dropdown switching, and auto-scan trigger.
- `tests/qa/test_modal_cell_glow_suppression.js`: 10 test cases verifying grid active cell reset and highlight suppression on modal open.
Update existing test suites (`test_project_files_table_wrap_resize.js`, `test_datagrid_floating_wrap.js`, `test_grid_wrap_concurrency_stress.js`) and register all suites in `run_tests.js`.

### R5. Systems QA, Packaging & Release Standards
Enforce workspace standards:
- Commit and release author strictly `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`.
- Public language strictly 100% professional English for commits, tags, and PRs.
- Zero-Duplicate Binary Policy: only `Toad.exe` at root, and canonical `v2.5.1` pair (`Toad-2.5.1-x64-portable.exe` & `Toad-2.5.1-x64-portable.zip`) in `releases/`.
- Maintain clean build cache via `tools/clean_cache.ps1` and execute packaging via `dist_package.ps1` and `package_release.ps1`.

## Acceptance Criteria

### Automated Test Verification
- [ ] `node tests/unit/test_cell_line_calculator.js` passes all 25 test cases.
- [ ] `node tests/unit/test_parse_dialog_nested_dropdown.js` passes all 15 test cases.
- [ ] `node tests/qa/test_modal_cell_glow_suppression.js` passes all 10 test cases.
- [ ] `node run_tests.js --all` passes 100% of all registered test suites (575+ tests).

### Functional & Visual Acceptance Criteria
- [ ] Cells with <= 1 line render flat at default height without elevation or scrollbar.
- [ ] Cells with 2 <= N <= 5 lines expand to exactly N lines with `overflow-y: hidden` (no scrollbar).
- [ ] Cells with > 5 lines cap height at 5 lines with a slim 4px vertical scrollbar (`overflow-y: auto`).
- [ ] Expanded rows/cells collapse upon re-clicking, clicking another cell/row, clicking outside, or pressing `Escape`.
- [ ] Parse Columns dialog header displays strictly `[Visual]` and `[Regex]` modes; format dropdown contains `Nested JSON` which switches view and triggers auto-scan; `#btn-switch-nested` is removed.
- [ ] Opening Parse Columns dialog dismisses active floating cells and eliminates cell glow/border in the grid behind the overlay.

### Build and Release Verification
- [ ] TypeScript compilation and Webpack production build complete with zero errors.
- [ ] `dist_package.ps1` and `package_release.ps1` generate `Toad.exe` and `releases/Toad-2.5.1-x64-portable.*` without duplicate historical binaries.
- [ ] Version control commits recorded using `jj` under author `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>` with professional English messages.


## Approved Task Prompt — 2026-11-04T18:31:22Z

Use a team of 50 engineers across 7 squads to port and rebuild the Toad application for Windows on Tauri v2 at `D:\Shared_UserData\Downloads\tad\tauri\project`, reference Tauri v2 documentation at `D:\Shared_UserData\Downloads\tad\tauri\docs/`, and package a portable release at `D:\Shared_UserData\Downloads\tad\tauri\project\releases/`.

Working directory: D:\Shared_UserData\Downloads\tad
Integrity mode: development

Reference material:
- Approved plan: `C:\Users\huydq\.gemini\antigravity\brain\4cd78c02-c356-4448-bdfe-f2930e55fb29\ke_hoach_trien_khai_50_subagents_tauri_v2.md`
- Tauri v2 documentation: `D:\Shared_UserData\Downloads\tad\tauri\docs/`
- Existing Frontend source: `tad-master/packages/toadviewer`
- IPC Command aliases: `packages/host-bridge/src/commandAliases.ts`
- Host Adapter: `packages/host-bridge/src/TauriHostAdapter.ts`

## Requirements

### R1. Scaffolding, Toolchain & Jujutsu Version Control
Set up the Tauri v2 project structure at `tauri/project` with Vite 5 and React 18. Update the root `.gitignore` to track `tauri/project/` while strictly excluding build artifacts (`tauri/project/src-tauri/target/`, `node_modules/`, `dist/`). Manage local version control using Jujutsu (`jj`), recording commits under identity `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>` with professional English commit messages. Strictly perform local builds only (never call `git push` or GitHub Release API).

### R2. Native Rust Core, DuckDB Engine & Forensics Ingestion
Implement a 100% Native Rust backend in `src-tauri` using In-Process Tokio Async:
- DuckDB 1.0 connection pool with dual-engine driver (UI query connection and ingestion worker connections).
- QueryExp AST compiler to generate optimized DuckDB SQL.
- Streaming tabular query results to WebView as binary Apache Arrow IPC Stream (`0xFFFFFFFF` marker) via `tauri::ipc::Response`.
- Ingestion pipelines for RFC-4180 CSV/TSV, JSONL/NDJSON, and binary Windows Event Logs (`.evtx`) decoded via Rust SIMD `evtx` crate.
- Write-Ahead Log Parquet state ledger (`toad_ledger.parquet`) and portable environment creating `toadAppData_[5chars]` adjacent to the executable.

### R3. Frontend Porting & Host Bridge Integration
Port and bundle the frontend into `tauri/project/dist/` using Vite 5, reusing React 18, virtualized SlickGrid, pivot table, and ArcSight ESM filter from `tad-master/packages/toadviewer`. Connect the UI via `packages/host-bridge/src/TauriHostAdapter.ts` adhering strictly to IPC command aliases in `packages/host-bridge/src/commandAliases.ts`. Support zero-copy Arrow IPC decoding via `@apache-arrow/es2015-cjs` directly into SlickGrid models. Preserve dark theme and dynamic column wrap/resizing.

### R4. Automated Testing & Verification
Implement and execute automated test suites as planned for Squad 1 and Squad 7:
- Rust Core Unit & Command Tests (`cargo test --verbose` in `src-tauri`).
- Frontend production build verification (`npm run build`).
- Arrow IPC roundtrip integration tests (`node tests/test_tauri_arrow_ipc.js`).
- 100K rows virtual scroll concurrency and memory stress tests (`node tests/test_grid_scroll_stress.js`).

### R5. Production Portable Packaging & Release Audit
Build packaging automation script `tauri/project/tools/package_portable.ps1`:
- Compile optimized binary `Toad-2.5.1-x64-portable.exe` (< 50MB) and compressed archive `Toad-2.5.1-x64-portable.zip` into `tauri/project/releases/`.
- Generate `SHA256SUMS.txt` and verify PE header metadata.
- Strictly adhere to Zero-Duplicate Binary storage policy (no intermediate historical version duplicates).

## Acceptance Criteria

### Automated Test Verification
- [ ] Rust Core unit tests pass with 100% success (`cargo test` in `src-tauri`).
- [ ] Vite frontend build completes without errors (`npm run build`).
- [ ] Arrow IPC binary stream integration test passes with 100% roundtrip accuracy.
- [ ] 100K rows scroll stress test passes (FPS > 55, stable RAM delta < 25MB).

### Functional & Packaging Verification
- [ ] Portable executable `Toad-2.5.1-x64-portable.exe` (< 50MB), archive `Toad-2.5.1-x64-portable.zip`, and `SHA256SUMS.txt` are created in `tauri/project/releases/`.
- [ ] Launching `Toad-2.5.1-x64-portable.exe` opens window in < 300ms and creates portable `toadAppData_[id]` folder adjacent to the executable.
- [ ] Drag-and-drop loading of CSV, Parquet, and EVTX files correctly renders table data in virtualized SlickGrid.
- [ ] Jujutsu repository tracks clean commit history locally under author `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>` without remote git push or GitHub API interactions.
