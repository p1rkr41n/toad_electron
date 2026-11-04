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
