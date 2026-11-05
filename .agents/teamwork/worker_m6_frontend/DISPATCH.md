# DISPATCH: Milestone 6 (M6) Implementation Worker (Squad 6)

## Mission
Implement Milestone 6: Frontend Porting & Host Bridge Integration for Toad Tauri v2 at `d:\Shared_UserData\Downloads\tad\tauri\project`.
Port `toadviewer` into `tauri/project/src/`, configure Vite 5 bundling with dual `~` alias resolution, update `TauriHostAdapter` with `dataPort = true` and `commandAliases.ts` with ingestion aliases, ensure zero-copy Arrow IPC streaming into virtualized SlickGrid, implement dynamic auto-wrap height formula across all 3 tables, enforce active cell glow suppression behind modals via `GridOverlayBus` and `body.bp4-overlay-open`, and verify ArcSight ESM filter condition tree and pivot table UI.

## Working Directory
`.agents/teamwork/worker_m6_frontend/`

## Request Reference
`d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`

## Architecture & Scope
`d:\Shared_UserData\Downloads\tad\PROJECT.md` (Features F23, F24, F25, F26, F27, F28)

## Explorer Findings to Build Upon
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m6_vite\handoff.md`
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m6_bridge\handoff.md`
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m6_grid\handoff.md`

## Specific Instructions & Owned Files

### 1. File Ownership
You exclusively own:
- `tauri/project/package.json`
- `tauri/project/vite.config.ts`
- `tauri/project/tsconfig.json`
- `tauri/project/index.html`
- `tauri/project/src/**` (port from `tad-master/packages/toadviewer/src/**`)
- `packages/host-bridge/src/TauriHostAdapter.ts`
- `packages/host-bridge/src/commandAliases.ts`
- `packages/host-bridge/src/index.ts`
- `PROJECT.md` (status update for M6: IN_PROGRESS -> DONE upon completion)

### 2. Implementation Tasks
1. **Dependencies (`tauri/project/package.json`)**:
   - Ensure all runtime dependencies from `tad-master/packages/toadviewer/package.json` and missing runtime packages (`url-regex`, `path-browserify`, `pretty-hrtime`, `@apache-arrow/es2015-cjs`, `@blueprintjs/core`, `react`, `react-dom`, etc.) are properly present and installed.
2. **TypeScript & Bundler Config (`tauri/project/tsconfig.json`, `tauri/project/vite.config.ts`)**:
   - In `vite.config.ts`:
     * Set `base: './'`
     * Configure dual `~` regex resolvers:
       `{ find: /^~\//, replacement: path.resolve(__dirname, 'src/') + '/' }`
       `{ find: /^~/, replacement: '' }`
     * Configure alias for `path`: `path: 'path-browserify'`
     * Configure Less and SCSS preprocessor options (`api: 'modern-compiler'`, etc.)
     * Configure `optimizeDeps` for `@apache-arrow/es2015-cjs`, `react`, `react-dom`, `@blueprintjs/core`.
   - In `tsconfig.json`:
     * Target `ES2020`, Module `ESNext`, ModuleResolution `bundler`, JSX `react-jsx`, allowJs `true`, skipLibCheck `true`.
3. **Host Bridge Integration (`packages/host-bridge/src/`)**:
   - In `TauriHostAdapter.ts`:
     * Declare `public readonly dataPort: boolean = true;` on `TauriHostAdapter` class.
     * Ensure `evalQuery` uses `invokeBinary` and routes to `toad:eval_query`.
     * In `invokeBinary`, verify incoming payload unpacks `Uint8Array` from `tauri::ipc::Response`.
   - In `commandAliases.ts`:
     * Add missing ingestion command mappings:
       `toad:ingest_file`: `ingest_file`
       `toad:ingest_cancel`: `ingest_cancel`
       `toad:ingest_vip`: `ingest_vip`
       `toad:get_ingest_queue`: `get_ingest_queue`
   - In `packages/host-bridge/src/index.ts`:
     * Ensure auto-detection of `(window as any).__TAURI__`.
4. **Frontend Source Porting (`tauri/project/src/`)**:
   - Port all source files from `tad-master/packages/toadviewer/src/` into `tauri/project/src/`.
   - In `toadviewer.ts`: convert all CommonJS `require(...)` calls (especially CSS/Less/SCSS stylesheets) to standard static `import "..."` statements.
   - Wire `main.tsx` and `index.html` as the Tauri v2 entrypoint.
   - Verify dynamic auto-wrap height formula in `CellLineCalculator.ts` and integration across all three tables (`ProjectFilesTable`, `DataGrid`, `NestedFieldsTable`):
     * $N \le 1$: flat 24px (`cell-flat`, no scrollbar)
     * $2 \le N \le 5$: $N \times 17\text{px} + 8\text{px}$ (`cell-expanded-fit`, overflow-y: hidden)
     * $N > 5$: 93px capped (`cell-expanded-scroll`, overflow-y: auto with 4px slim scrollbar)
     * 4-way collapse lifecycle: re-click, click another cell, click outside, Escape, plus scroll/viewport dismissal.
   - Verify `GridOverlayBus` and `body.bp4-overlay-open` in `slickgrid.scss` active cell glow suppression.
   - Verify ArcSight ESM filter condition tree and `aggtree.vpivot`.
5. **Build & Automated Verification**:
   - Run `npm run build` in `tauri/project/` to confirm production dist files are generated without error.
   - Run all Node.js test suites:
     * `node tests/test_tauri_arrow_ipc.js`
     * `node tests/test_grid_scroll_stress.js`
     * `node tests/unit/test_cell_line_calculator.js`
     * `node tests/qa/test_modal_cell_glow_suppression.js`
     * `node tests/unit/test_parse_dialog_nested_dropdown.js`
     * `node tests/unit/test_datagrid_floating_wrap.js`
     * `node tests/unit/test_filter_editor_apply_lifecycle.js`
     * `node tests/qa/test_grid_wrap_concurrency_stress.js`
     * `node tests/run_all_tests.js` (E2E master suite, all 55 tests)
   - Run `cargo test` in `tauri/project/src-tauri` (ensure all 135 Rust tests remain 100% passing).
6. **VCS Record**:
   - Record clean Jujutsu (`jj`) commit:
     `jj describe -m "feat(frontend): port toadviewer to Tauri v2, enable zero-copy Arrow IPC and host bridge"`
     under author `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`.

## MANDATORY INTEGRITY WARNING
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Deliverable
Write a comprehensive handoff report to `.agents/teamwork/worker_m6_frontend/handoff.md` following the Handoff Protocol (Observation, Logic Chain, Caveats, Conclusion, Verification Method with command outputs and Jujutsu commit hash).


## 2026-11-05T01:49:40Z
You are worker_m6_frontend, the Milestone 6 Frontend Implementation Worker (Squad 6).

Working Directory: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m6_frontend\

Please read:
- User Request: d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
- Project Architecture & Scope: d:\Shared_UserData\Downloads\tad\PROJECT.md (Features F23, F24, F25, F26, F27, F28)
- Your Dispatch Assignment: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m6_frontend\DISPATCH.md
- Explorer 1 (Vite & Bundling): d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m6_vite\handoff.md
- Explorer 2 (Host Bridge): d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m6_bridge\handoff.md
- Explorer 3 (Grid & Filter UI): d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m6_grid\handoff.md
