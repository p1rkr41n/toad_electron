# Toad Desktop (Tauri v2) - End-to-End Test Infrastructure Specification

> **Project:** Toad Tauri v2 Migration (`TOAD-TAURI-V2`)  
> **Author:** E2E Test Writer (`test_writer_e2e`)  
> **Author Identity:** `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`  
> **Test Harness Location:** `tauri/project/tests/`  
> **Execution Runtime:** Embedded Node.js v18.20.4 (`d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe`)  
> **Date:** 2026-11-04  

---

## 1. Test Philosophy & Principles

The testing framework for Toad Tauri v2 adheres to rigorous enterprise quality assurance standards:

1. **Opaque-Box Contract Verification**:
   - Tests interact exclusively through documented system boundaries, protocols, and interface contracts:
     - Tauri v2 IPC commands and binary stream serialization (`tauri::ipc::Response`).
     - Apache Arrow IPC Stream protocol (`0xFFFFFFFF` continuation indicator).
     - Parquet State Ledger WAL schemas and reconciliation invariants (`toad_ledger.parquet`).
     - Cell line mathematics and virtual viewport coordinate transforms.
   - Internal private helper states are never patched or inspected; contracts are tested against their specified observable behaviors.

2. **Requirement-Driven Expected Outputs**:
   - Every single test case derives its expected output from an authoritative specification:
     - `PROJECT.md` feature specifications (F01 - F33).
     - `ORIGINAL_REQUEST.md` contract specifications (R1 - R5).
     - Tauri v2 official runtime specifications and `packages/host-bridge` command aliases.
   - Zero-facade tests: All assertions execute real mathematical transformations, binary parsing, and invariant validations.

3. **Progressive Testability & Isolation**:
   - Test suites are 100% self-contained and run isolated.
   - Tests do not require a live display server, running window manager, or external network connection.
   - Tests set up their own in-memory states, fixtures, or buffers, and clean up afterwards.
   - Each suite can be executed independently or collectively via `run_all_tests.js`.

4. **Adversarial Verification**:
   - **Encoding & Escaping Integrity**: Control characters, multi-byte UTF-8, escape sequences, JSON metacharacters, and SQL injection strings.
   - **Boundary & Resource Stress**: 0-row empty tables, 100,000-row coordinate grids, extreme column widths (45px to 1200px), 50KB single-cell payloads, and memory delta audits.
   - **Invalid Combinations**: Corrupted Arrow magic headers, non-contiguous buffers, conflicting tombstone rows, and unexpected IPC namespaces.

---

## 2. Feature Inventory Mapping to Test Tiers

The 33 features defined in `PROJECT.md` are mapped across three progressive test tiers:

- **Tier 1 (Feature Coverage / Primary Behavior)**: Validates functional contracts, happy paths, schema shapes, and core command routing.
- **Tier 2 (Boundary & Corner Cases)**: Validates boundary values, empty collections, extreme payloads, type limits, and error guards.
- **Tier 3 (Cross-Feature Pairwise Scenarios & Stress)**: Validates subsystem interactions, state reconciliation under churn, and 100K-row concurrency stress.

| Feature ID | Feature Name | Tier 1 (Primary) | Tier 2 (Boundary / Corner) | Tier 3 (Cross-Feature & Stress) |
|---|---|:---:|:---:|:---:|
| **F01** | Toolchain & .gitignore Un-ignore | `test_e2e_features.js` (T1.1) | `test_e2e_features.js` (T2.1) | `run_all_tests.js` |
| **F02** | Tauri v2 Scaffolding & Manifests | `test_e2e_features.js` (T1.2) | `test_e2e_features.js` (T2.2) | `test_e2e_features.js` (T3.1) |
| **F03** | Portable Directory & Config Manager | `test_e2e_features.js` (T1.3) | `test_e2e_features.js` (T2.3) | `test_e2e_features.js` (T3.2) |
| **F04** | Concurrency AppState & Panic Guard | `test_e2e_features.js` (T1.4) | `test_e2e_features.js` (T2.4) | `test_grid_scroll_stress.js` |
| **F05** | Native Tauri Plugins Integration | `test_e2e_features.js` (T1.5) | `test_e2e_features.js` (T2.5) | `test_e2e_features.js` (T3.1) |
| **F06** | IPC Command Router & Aliases | `test_e2e_features.js` (T1.6) | `test_e2e_features.js` (T2.6) | `test_tauri_arrow_ipc.js` |
| **F07** | DuckDB 1.0 Connection Pool | `test_e2e_features.js` (T1.7) | `test_e2e_features.js` (T2.7) | `test_tauri_arrow_ipc.js` |
| **F08** | QueryExp AST to SQL Compiler | `test_e2e_features.js` (T1.8) | `test_e2e_features.js` (T2.8) | `test_e2e_features.js` (T3.3) |
| **F09** | Binary Arrow IPC Streaming Encoder | `test_tauri_arrow_ipc.js` (1.1-2.4) | `test_tauri_arrow_ipc.js` (3.1-4.3) | `test_tauri_arrow_ipc.js` (5.1-5.5) |
| **F10** | O(1) Parquet Metadata Row Counter | `test_e2e_features.js` (T1.9) | `test_e2e_features.js` (T2.9) | `test_e2e_features.js` (T3.3) |
| **F11** | Schema & Logical Type Mapper | `test_tauri_arrow_ipc.js` (2.1) | `test_tauri_arrow_ipc.js` (3.2) | `test_tauri_arrow_ipc.js` (5.2) |
| **F12** | Stats Cache & Dynamic Resources | `test_e2e_features.js` (T1.10) | `test_e2e_features.js` (T2.10) | `test_grid_scroll_stress.js` |
| **F13** | Double-Valid Parquet Ledger WAL | `test_e2e_features.js` (T1.11) | `test_e2e_features.js` (T2.11) | `test_e2e_features.js` (T3.2) |
| **F14** | Tombstone Rows & Purge Engine | `test_e2e_features.js` (T1.12) | `test_e2e_features.js` (T2.12) | `test_e2e_features.js` (T3.2) |
| **F15** | Startup Reconciliation & Recovery | `test_e2e_features.js` (T1.13) | `test_e2e_features.js` (T2.13) | `test_e2e_features.js` (T3.2) |
| **F16** | Cascade Cache Purge Engine | `test_e2e_features.js` (T1.14) | `test_e2e_features.js` (T2.14) | `test_e2e_features.js` (T3.2) |
| **F17** | Multi-Project CRUD & Rename | `test_e2e_features.js` (T1.15) | `test_e2e_features.js` (T2.15) | `test_e2e_features.js` (T3.2) |
| **F18** | RFC-4180 CSV/TSV Ingest | `test_e2e_features.js` (T1.16) | `test_e2e_features.js` (T2.16) | `test_e2e_features.js` (T3.4) |
| **F19** | EVTX Rust SIMD Binary Decoder | `test_e2e_features.js` (T1.17) | `test_e2e_features.js` (T2.17) | `test_e2e_features.js` (T3.4) |
| **F20** | JSONL/NDJSON Stream Ingestion | `test_e2e_features.js` (T1.18) | `test_e2e_features.js` (T2.18) | `test_e2e_features.js` (T3.4) |
| **F21** | SJF Queue & VIP Preemption | `test_e2e_features.js` (T1.19) | `test_e2e_features.js` (T2.19) | `test_e2e_features.js` (T3.4) |
| **F22** | Multi-Stage Progress Channel | `test_e2e_features.js` (T1.20) | `test_e2e_features.js` (T2.20) | `test_e2e_features.js` (T3.4) |
| **F23** | Frontend Porting & Vite 5 Bundling | `test_e2e_features.js` (T1.21) | `test_e2e_features.js` (T2.21) | `test_grid_scroll_stress.js` |
| **F24** | Host Bridge (`dataPort = true`) | `test_tauri_arrow_ipc.js` (5.1) | `test_tauri_arrow_ipc.js` (5.4) | `test_e2e_features.js` (T3.1) |
| **F25** | Zero-Copy Arrow IPC Decoder | `test_tauri_arrow_ipc.js` (1.2) | `test_tauri_arrow_ipc.js` (3.3) | `test_grid_scroll_stress.js` |
| **F26** | UI Ergonomics & Dynamic Auto-Wrap | `test_grid_scroll_stress.js` (3.3) | `test_grid_scroll_stress.js` (3.8) | `test_e2e_features.js` (T3.5) |
| **F27** | Active Cell Glow Suppression | `test_e2e_features.js` (T1.22) | `test_e2e_features.js` (T2.22) | `test_e2e_features.js` (T3.5) |
| **F28** | ArcSight ESM Filter & Pivot UI | `test_e2e_features.js` (T1.23) | `test_e2e_features.js` (T2.23) | `test_e2e_features.js` (T3.3) |
| **F29** | Rust Core Unit & Command Tests | `test_e2e_features.js` (T1.24) | `test_e2e_features.js` (T2.24) | `run_all_tests.js` |
| **F30** | Arrow IPC Stream QA Suite | `test_tauri_arrow_ipc.js` | `test_tauri_arrow_ipc.js` | `test_tauri_arrow_ipc.js` |
| **F31** | 100K Rows Concurrency & Stress | `test_grid_scroll_stress.js` | `test_grid_scroll_stress.js` | `test_grid_scroll_stress.js` |
| **F32** | Portable Packaging Script | `test_e2e_features.js` (T1.25) | `test_e2e_features.js` (T2.25) | `test_e2e_features.js` (T3.6) |
| **F33** | Release Verification & SHA256SUMS | `test_e2e_features.js` (T1.26) | `test_e2e_features.js` (T2.26) | `test_e2e_features.js` (T3.6) |

---

## 3. Test Architecture & Directory Layout

All tests are located in `tauri/project/tests/`:

```
tauri/project/tests/
├── run_all_tests.js            # Master test orchestrator & exit code coordinator
├── test_tauri_arrow_ipc.js     # Apache Arrow IPC stream binary & schema verification
├── test_grid_scroll_stress.js  # 100K virtual rows scroll, coordinate & memory stress
└── test_e2e_features.js        # Comprehensive Tier 1, 2, and 3 feature verification
```

### Module Responsibilities:

1. **`test_tauri_arrow_ipc.js`**:
   - Bit-level verification of the Apache Arrow IPC stream continuation marker: `[0xFF, 0xFF, 0xFF, 0xFF]`.
   - Streaming reader/writer roundtrip through `@apache-arrow/es2015-cjs`.
   - Custom `toadSchema` JSON metadata embedding and extraction.
   - Comprehensive column types: Int8/16/32/64, Float32/64, Utf8, Boolean, Date/Timestamp, and Nulls.
   - 0-row empty record batch edge case handling.
   - Zero-copy IPC buffer handoff matching `tauri::ipc::Response` and `TauriHostAdapter.invokeBinary`.

2. **`test_grid_scroll_stress.js`**:
   - High-performance headless `Virtual100KDataView` simulating 100,000 table rows.
   - Strict invariant: Coordinate linearity `top = row_index * 24px` across 100K rows without degradation.
   - N-line dynamic auto-wrap contract ($N \le 1 \rightarrow 24\text{px}$, $2 \le N \le 5 \rightarrow N \times 17\text{px}+8\text{px}$, $N > 5 \rightarrow \text{cap } 93\text{px}$).
   - 1,000 rapid scroll viewport jumps while active cell is expanded.
   - Viewport scrolling benchmark verifying > 55 FPS performance equivalent (frame render latency < 18ms).
   - Memory leak guard: Verifies heap memory delta remains strictly < 25MB across 1,000 cycles.
   - 50,000-character extreme JSON payload cell wrapping performance (< 16ms).

3. **`test_e2e_features.js`**:
   - **Tier 1 (Feature Coverage)**: Validates IPC command aliases (`COMMAND_ALIAS_MAP`), QueryExp compiler AST rules, Parquet State Ledger schema, portable directory isolation, and Ingestion format sniffers.
   - **Tier 2 (Boundary & Corner Cases)**: Empty files, Unicode/special characters, duplicate keys in reverse alias maps, negative scroll indices, and tombstone reconciliation conflicts.
   - **Tier 3 (Cross-Feature Pairwise Scenarios)**: Ingestion $\rightarrow$ Ledger $\rightarrow$ IPC Query roundtrips; Overlay open $\rightarrow$ Active cell glow suppression $\rightarrow$ Modal lifecycle; Project rename $\rightarrow$ Cache purge cascade.

4. **`run_all_tests.js`**:
   - Dispatches each test suite in an isolated child process or structured execution block.
   - Collects per-suite execution metrics: duration, passed assertions, failed assertions.
   - Exits with `code 0` if and only if 100% of test suites and assertions pass.

---

## 4. Execution Commands

All tests must be executed using the local workspace Node.js runtime:

```powershell
# Set local node path
$NODE = "d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe"

# 1. Run all test suites through the master runner
& $NODE d:\Shared_UserData\Downloads\tad\tauri\project\tests\run_all_tests.js

# 2. Run Arrow IPC binary stream test suite individually
& $NODE d:\Shared_UserData\Downloads\tad\tauri\project\tests\test_tauri_arrow_ipc.js

# 3. Run 100K rows virtual scroll concurrency & stress test individually
& $NODE d:\Shared_UserData\Downloads\tad\tauri\project\tests\test_grid_scroll_stress.js

# 4. Run comprehensive E2E features suite (Tiers 1, 2, 3) individually
& $NODE d:\Shared_UserData\Downloads\tad\tauri\project\tests\test_e2e_features.js
```

---

## 5. Verification Gate & Certification

The test suite enforces zero tolerance for test failures:
- Exit code must be `0`.
- All assertion counters must match expectations with 0 errors.
- Any regression or contract violation immediately fails the suite and generates a structured error trace.
