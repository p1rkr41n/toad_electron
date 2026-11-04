# E2E Test Infra: Column Resizing and Active Row Auto-Wrap

## Test Philosophy
- Opaque-box and unit/stress verification derived directly from user requirements (R1–R5).
- Methodology: Category-Partition + Boundary Value Analysis + Stress Concurrency Testing.
- Zero external runtime dependencies; pure Node.js native `assert`.

## Feature Inventory & Test Coverage
| # | Feature | Source (Requirement) | Test Suite | Test Cases | Target |
|---|---------|----------------------|------------|:----------:|--------|
| 1 | File Table Column Resizing | R1, Stream 1 | `test_project_files_table_wrap_resize.js` | 7 | Min width clamp 45px, delta math, handles |
| 2 | File Table Double-Click Auto-Fit | R1, Stream 1 | `test_project_files_table_wrap_resize.js` | 2 | Auto-fit to visible text, bounds |
| 3 | File Table Active Row Auto-Wrap | R1, Stream 2 | `test_project_files_table_wrap_resize.js` | 3 | Dynamic wrap, max-height 180px, single-line unselected |
| 4 | File Table Row Collapse Lifecycle | R1, Stream 2, 6 | `test_project_files_table_wrap_resize.js` | 3 | Toggle click, click-away, Escape key |
| 5 | SlickGrid Double-Click Auto-Fit | R2, Stream 3 | `test_datagrid_floating_wrap.js` | 5 | dblclick event, auto-fit math, clamps 60–500px, setColumns |
| 6 | SlickGrid Floating Active Cell Wrap | R2, Stream 4 | `test_datagrid_floating_wrap.js` | 6 | z-index 20, shadow, max-height 180px, contain none, overflow |
| 7 | SlickGrid Coordinate Invariance | R2, Stream 4 | `test_datagrid_floating_wrap.js` | 1 | row top = i * 24px strictly constant |
| 8 | SlickGrid Dismissal Triggers | R2, Stream 4, 6 | `test_datagrid_floating_wrap.js` | 3 | Scroll event, cell navigate, Escape key |
| 9 | Virtual Scroll Concurrency Stress | R4, Stream 9 | `test_grid_wrap_concurrency_stress.js` | 5 | 100K rows, rapid cell expand, coordinate invariance, memory leak guard |
| 10 | High-Speed Scroll FPS & Load | R4, Stream 9 | `test_grid_wrap_concurrency_stress.js` | 5 | > 55 FPS latency, concurrent resize, multi-col isolation, 50KB payload, 0 errors |

## Real-World Application Scenarios
| # | Scenario | Features Exercised | Target Metrics |
|---|----------|--------------------|----------------|
| 1 | 100K Rows Rapid Cell Expansion | F8, F9, F10 | 100 random cells expanded/collapsed; zero coordinate drift |
| 2 | High-Speed Scroll Under Expansion | F8, F10 | 1,000 scroll jumps; instant dismissal; scroll latency <= 16.6ms (> 55 FPS) |
| 3 | Memory Leak Guard Under 1,000 Cycles | F8, F10 | Heap delta < 25 MB after 1,000 expand/dismiss cycles |
| 4 | Extreme Long Text Wrap (50,000 chars) | F3, F8 | Rendered within 16ms without event loop freeze |
| 5 | Full Test Suite Integration | All | `node run_tests.js --all` passes 100% across all suites |
