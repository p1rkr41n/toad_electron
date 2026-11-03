# E2E Test Infra: TOAD v2.5.0 IPC Architectural Migration

## Test Philosophy
- Opaque-box, requirement-driven test verification derived directly from `ORIGINAL_REQUEST.md`.
- Methodology: Category-Partition + Boundary Value Analysis + Pairwise + Real-World Workload Testing.
- Non-blocking headless execution via Node.js v18 CLI runner.

## Feature Inventory Coverage Matrix
| # | Feature | Requirement | Tier 1 (Functional) | Tier 2 (Boundary) | Tier 3 (Integration) | Tier 4 (Workload/Resilience) |
|---|---------|-------------|:-------------------:|:-----------------:|:--------------------:|:----------------------------:|
| 1 | Version Bump & Manifest Sync (2.5.0) | R1 | Version equals 2.5.0 across 9 files | Negative: past version rejection | Multi-package Lerna consistency | Release script assertions |
| 2 | Dual-Mode Engine Configuration | R1 | `runtime.engine = "utility"` vs `"legacy"` | Missing config fallback to utility | Toggling config.ini | Seamless GUI launch in both modes |
| 3 | Host Bridge & HeadlessNodeAdapter | R2 | `IHostBridge` invoke dispatch | Empty/null payload handling | All 168+ CLI test cases pass | Zero Electron window requirement |
| 4 | Engine Service in utilityProcess | R3 | `engineService.ts` execution | 1,000 rapid sequential queries | MessagePort handshake & port transfer | Zero-copy `ArrayBuffer` transferables |
| 5 | Engine Supervisor Crash Recovery | R4 | Child process crash detection | Sudden SIGKILL / exit code != 0 | Auto-restart in < 500ms | View replay from `toad_ledger.parquet` in < 5ms |
| 6 | Webpack & Packaging Conformance | R5 | `engineService.bundle.js` target: node | `app.asar` size < 45 MB | `duckdb.node` in `app.asar.unpacked` | Portable `.exe` < 75 MB, zero duplicate binaries |

## Acceptance Verification Test Suites
1. **Unified Test Suite**: `node run_tests.js --all`
   - Smoke Test (`tests/smoke_test.js`)
   - Deep Integration QA (`tests/deep_integration_qa.js`)
   - Preload 3 Pages (`tests/test_preload_3_pages.js`)
   - Legacy Use Cases (`tests/legacy_use_cases.js`)
2. **Headless Engine Service Test**: `node tests/test_engine_service.js`
   - 1,000 queries over MessagePort verifying hybrid JSON and binary data integrity.
3. **Crash Resilience Test**: `node tests/test_engine_crash_recovery.js`
   - Kill engine process with SIGKILL, verify auto-restart in < 500ms and state restoration from `toad_ledger.parquet`.
4. **Build & Release Packaging Verification**:
   - `fastbuild.ps1`
   - `dist_package.ps1`
   - Zero-duplicate binary check across `releases/`.
