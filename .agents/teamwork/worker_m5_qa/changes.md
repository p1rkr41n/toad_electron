# Milestone 5 Changes & QA Execution Ledger

**Worker**: `worker_m5_qa`  
**Milestone**: Milestone 5 (Comprehensive Verification & Dual-Track E2E QA)  
**Date**: 2026-11-04  
**Commit**: `feat: TOAD v2.5.0 IPC architectural migration to Electron utilityProcess`  

---

## 1. Files Modified & Created

### 1.1 `tests/deep_integration_qa.js` (Modified)
- **Objective**: Whitelist version `2.5.0` across 28 assertion gates while retaining historical version whitelists (`2.0.7` through `2.4.8`).
- **Changes**:
  - Whitelisted `2.5.0` for `pkgApp.version`, `pkgBridge.version`, `pkgDuck.version`, `pkgViewer.version`.
  - Whitelisted `v2.5.0` for `dialogContent` and `dialogSrc` assertions (`RegexDialog.tsx`).
  - Whitelisted `Toad-2.5.0-x64-portable.exe` and `v2.5.0` across packaging assertions (`distPs1`, `pkgPs1`, `readmeSrc`, `wingetYaml`).
  - Updated Gates JJ.8, KK.7, LL.6, MM.5 (`is248 || is250`, `isPost244`, `isPost245`, `is24x`).

### 1.2 `tests/test_engine_service.js` (New)
- **Objective**: Headless dedicated EngineService 1,000-query test suite.
- **Features Implemented**:
  - `MessageChannel` initialization (port1 for client, port2 for `EngineService`).
  - Bootstrap with `startEngineService({ dataPort: port2 })`.
  - Ping / Pong handshake and engine status verification (`state=running`, active child PID).
  - Write-Ahead Ledger initialization (`initLedger`).
  - Ingestion of 100-row fixture table with diverse data types.
  - Wire format binary packet inspection (`ok=true`, `binary=true`, magic bytes `0x54 0x4F 0x41 0x44` / `'TOAD'`).
  - Deserialization and cell content verification via `decodeTableRepBinary` and `TableRep`.
  - Rapid execution loop of 1,000 mixed queries over `MessagePort` (`evalQuery`, offset/limit slices, `rowCount`, `getTableSchema`).
  - Latency profiling: Total elapsed time, average latency, p50, p90, p95, p99, and max latency.
  - Memory stability measurement (`process.memoryUsage()` heap and RSS delta).
  - Graceful port teardown and `engine.shutdown()`.

### 1.3 `run_tests.js` (Modified)
- **Objective**: Updated test suite labels and descriptions:
  - Updated label to `Smoke Test (v2.5.0)`.
  - Updated label to `Deep Integration QA (222 Tests)`.

---

## 2. Test Execution Results

### 2.1 Headless Engine Service Test (`tests/test_engine_service.js`)
- **Command**: `.\node-v18.20.4-win-x64\node.exe tests/test_engine_service.js`
- **Result**: `100% PASS` (Code 0)
- **Metrics Profile (1,000 queries)**:
  - Total Elapsed Time : 2,373.70 ms
  - Average Latency    : 2.37 ms / query
  - Median (p50)       : 2.51 ms
  - p90                : 4.00 ms
  - p95                : 4.90 ms
  - p99                : 6.07 ms
  - Max Latency        : 14.57 ms
  - Heap Used Delta    : +4.86 MB (baseline: 16.0 MB, final: 20.9 MB)
  - RSS Delta          : +12.21 MB
  - Data Integrity     : 1,000 / 1,000 verified with zero corruption.

### 2.2 Crash Resilience & Recovery Test (`tests/test_engine_crash_recovery.js`)
- **Command**: `.\node-v18.20.4-win-x64\node.exe tests/test_engine_crash_recovery.js`
- **Result**: `100% PASS` (Code 0)
- **Metrics**:
  - Replay Ledger Views SLA : 2.08 ms (enforced < 5.0 ms)
  - Crash Auto-Restart SLA : 265.25 ms (enforced < 500.0 ms)
  - Recovery Notification   : Received in 275.30 ms
  - Dual-mode In-process Fallback : Verified

### 2.3 Unified Acceptance Suite (`run_tests.js --all`)
- **Command**: `.\node-v18.20.4-win-x64\node.exe run_tests.js --all`
- **Result**: `100% HEALTHY` (Code 0)
  1. `Smoke Test (v2.5.0)`: PASS
  2. `Deep Integration QA (222 Tests)`: PASS (222 / 222)
  3. `Preload 3 Pages & Dynamic PageSize (10 Tests)`: PASS (10 / 10)
  4. `Legacy Use Cases (19 Tests)`: PASS (19 / 19)
- **Total Duration**: 29.10s

### 2.4 Dual-Mode Engine Toggle Verification
- **Verified**:
  - `runtime.engine = "utility"`: Spawns child engine, status state=`running`, active child PID.
  - `runtime.engine = "legacy"`: Gracefully initializes DuckDB in-process, state=`legacy`, child PID `null`.
  - Re-toggling from `legacy` back to `utility`: Spawns new child process with clean MessagePort attachment.

### 2.5 Jujutsu VCS & Packaging Deduplication
- **Commit Description**: `jj describe -m "feat: TOAD v2.5.0 IPC architectural migration to Electron utilityProcess"`
- **Commit ID**: `osxolpnr a3b353c7`
- **Root Directory**: Strictly single development executable `Toad.exe` (75.6 MB).
- **Releases Directory**: Strictly canonical version artifacts `Toad-2.5.0-x64-portable.exe` and `Toad-2.5.0-x64-portable.zip` with zero historical alias duplicates.
