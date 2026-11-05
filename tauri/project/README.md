# Toad (Tauri v2 Edition) — High-Performance Forensic Data Explorer

Toad v2.5.2 is a lightweight, high-performance tabular data and security forensic log viewer for Windows, ported from Electron to **Tauri v2**. It couples an in-process **DuckDB 1.0** query engine with **Apache Arrow IPC** streaming binary transfer and a high-speed virtualized canvas grid.

---

## 1. Architectural Highlights

- **Frontend (`src/`)**:
  - React 18, TypeScript, and Vite 5 bundling with BlueprintJS components.
  - Virtualized **SlickGrid** table renderer with dynamic N-line cell wrapping ($N \le 1$: 24px, $2 \le N \le 5$: $N \times 17\text{px}+8\text{px}$, $N > 5$: capped at 93px with slim scrollbar).
  - Modal cell glow and background highlight suppression via `GridOverlayBus` and `.bp4-overlay-open` CSS rules.
  - Advanced forensic tools: ArcSight ESM filter condition editor, nested JSON column flattener, and pivot aggregation panels.

- **IPC & Transport Layer (`packages/host-bridge` & `src-tauri/src/commands/`)**:
  - Native Tauri v2 commands bound via `window.__TAURI__.core.invoke`.
  - Zero-copy binary tabular transfer via `invokeBinary`, returning streaming **Apache Arrow IPC** RecordBatches prefixed with the standard `0xFFFFFFFF` continuation indicator.
  - Embedded schema metadata (`toadSchema`) preserving column types and logical formatting.

- **Backend Core Engine (`src-tauri/`)**:
  - **In-Process DuckDB 1.0**: Tokio asynchronous connection pool separating UI exploration queries from background ingestion workers.
  - **Vectorized Query Compiler**: Translates frontend JSON AST (`QueryExp`) directly into optimized SQL queries.
  - **Parquet State Ledger WAL (`toad_ledger.parquet`)**: Transactional append-only state ledger with 6-scenario startup reconciliation (< 5ms) and cascade temporary cache reclamation.
  - **Forensic Ingestion Pipelines**:
    - **EVTX SIMD Parser**: Rust SIMD `evtx` binary decoder streaming into Parquet (< 20MB RAM, zero disk churn).
    - **RFC-4180 CSV/TSV Sniffer**: 3-tier fallback matrix with `all_varchar = true` guard against type inference failures.
    - **JSONL/NDJSON Streamer**: Dynamic 2-phase schema unnesting.
  - **SJF Ingestion Scheduler**: Shortest-Job-First queue with dual concurrency bounding (file count + RAM limit) and VIP burst lane preemption.

- **Portable Profile Isolation**:
  - Self-contained portable deployment detecting adjacent `toadAppData_[5chars]` containing `config.ini`, `toad_ledger.parquet`, `logs/`, and `temp/`.
  - Windows registry and user profile isolation.

---

## 2. Directory Structure

```
tauri/project/
├── package.json              # Frontend dependencies (React 18, Vite 5, BlueprintJS)
├── vite.config.ts            # Vite bundler configuration with '~' Less/SCSS resolver
├── tsconfig.json             # TypeScript configuration
├── index.html                # Single-page application entry point
├── less/                     # Component stylesheets
├── src/                      # Frontend source code
│   ├── main.tsx              # React mounting root
│   ├── toadviewer.ts         # Main viewer state and event coordination
│   ├── PagedDataView.ts      # Arrow IPC virtual viewport manager
│   ├── components/           # DataGrid, Sidebar, FilterEditor, Pivot, etc.
│   └── utils/                # CellLineCalculator, GridOverlayBus, ForensicDecoder
├── src-tauri/                # Native Rust backend
│   ├── Cargo.toml            # Rust dependencies (tauri v2, duckdb, arrow, evtx)
│   ├── tauri.conf.json       # Tauri v2 application configuration and capabilities
│   ├── src/
│   │   ├── main.rs           # Entry point and Windows GUI Subsystem
│   │   ├── lib.rs            # Application builder and plugin initialization
│   │   ├── portable.rs       # toadAppData detection and config management
│   │   ├── engine/           # DuckDB pool, query compiler, arrow encoder
│   │   ├── ledger/           # Parquet WAL ledger, reconciliation, tombstones
│   │   ├── ingest/           # CSV, EVTX, JSONL parsers & SJF scheduler
│   │   └── commands/         # IPC command routing and aliases
│   └── tests/                # 15 integration and adversarial stress test suites
├── tests/                    # Node test orchestrator, Arrow IPC, and 100K scroll stress
├── tools/
│   └── package_portable.ps1  # Automated release packaging script (< 50MB gate)
└── releases/                 # Canonical internal release artifacts
    ├── Toad-2.5.2-x64-portable.exe
    ├── Toad-2.5.2-x64-portable.zip
    ├── duckdb.dll
    ├── WebView2Loader.dll
    └── SHA256SUMS.txt
```

---

## 3. Toolchain & Prerequisites

- **Operating System**: Windows 10 / 11 (x64)
- **Rust Toolchain**: `stable-x86_64-pc-windows-gnu` (MinGW)
- **Node.js**: v18+ (tested on Node v18.20.4)
- **Companion DLLs**:
  - `duckdb.dll` (DuckDB 1.0 C++ shared library)
  - `WebView2Loader.dll` (Required by `webview2-com-sys` on GNU toolchain targets)

---

## 4. Development Workflow

### Frontend Development
```powershell
# From tauri/project
npm install
npm run build     # Production Vite bundle into dist/
```

### Backend Compilation & Testing
```powershell
# Run Rust unit and adversarial integration tests
cd src-tauri
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cargo test --quiet
```

### Full Test Suite Execution
```powershell
# Run the master Node test orchestrator (Arrow IPC, virtual scroll, E2E features)
node tests/run_all_tests.js
```

---

## 5. Release Packaging (Zero-Duplicate Binary Standard)

To build and package a standalone portable release:
```powershell
powershell -ExecutionPolicy Bypass -File tools/package_portable.ps1
```

### Packaging Outputs:
1. **Workspace Root**: Canonical test binary `Toad.exe` co-located with `duckdb.dll` and `WebView2Loader.dll`.
2. **Release Directories**: `releases/` and `tauri/project/releases/` containing:
   - `Toad-2.5.2-x64-portable.exe` (~12.4 MB)
   - `Toad-2.5.2-x64-portable.zip` (~18.8 MB, bundled with companion DLLs)
   - `SHA256SUMS.txt` (cryptographic integrity hashes)
   - `HelloKittyXamKinLung.Toad.yaml` (WinGet manifest)

---

## 6. Version Control Policy

This project strictly utilizes **Jujutsu (`jj`)** colocated with Git:
- **Author Identity**: `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`
- **Internal Builds Only**: No remote `git push` operations to public repositories.
- **Large File Policy**: All intermediate `target/`, `dist/`, `node_modules/`, and `*.dll` files are excluded from VCS commits.
