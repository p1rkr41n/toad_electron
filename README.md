# Toad (v2.3.4) - High-Performance Tabular Data & Security Log Analyzer

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Engine](https://img.shields.io/badge/Engine-DuckDB%201.0.0%20%7C%20Rust%20SIMD%20%7C%20Parquet%20Native-green.svg)](https://duckdb.org/)
[![Version](https://img.shields.io/badge/Version-2.3.4-brightgreen.svg)](https://github.com/p1rkr41n/toad_electron/releases)
[![Platform](https://img.shields.io/badge/Platform-Windows%20x64%20(Portable)-orange.svg)](https://github.com/p1rkr41n/toad_electron/releases)
[![Tests](https://img.shields.io/badge/QA%20Tests-144%2F144%20PASS-success.svg)](tests/run_tests.js)

> [!NOTE]
> **Project Origin & Attribution**:
> **Toad** is an enterprise-grade, high-performance fork of [Tad](https://github.com/antonycourtney/tad) (tadviewer), originally created by [Antony Courtney](https://github.com/antonycourtney). While Tad pioneered the concept of an elegant tabular data viewer, **Toad** fundamentally re-architects the system into an ultra-high-throughput Big Data log analyzer and Digital Forensics & Incident Response (DFIR) platform. Major enhancements include native DuckDB 1.0.0 vectorized engines, isolated dual-engine drivers (UI vs Ingestion), in-place multi-format column extractors (JSON, CSV, KV, Regex, W3C Web Logs), native Windows Event Log (`.evtx`) parsing, decoupled `host-bridge` UI architecture, instant RAM First-Page Micro-Cache, Double-Valid Parquet State Ledger (`toad_ledger.parquet`), and Ergonomic Slate Dark Mode.

> **Toad** is a blazing-fast, lightweight, and modern desktop application designed for querying, exploring, and analyzing tabular data files of virtually any scale (including **Big Data 40GB+ / 60,000,000+ rows**). Powered by **DuckDB 1.0.0**, native **Apache Parquet**, and an embedded **Rust SIMD Core**, Toad delivers sub-second pivot tables, compound filtering with ArcSight ESM query ergonomics, background **Multiple Loading Ingestion Queue**, visual in-situ progress tracking, $O(1)$ instant row counting, automatic chronological time sorting, background distinct filter caching, Ergonomic Slate dark theme, instant **Smart Expand 1-click triage**, and a flexible **pagination engine (default 1,000 rows with zero arbitrary upper limit)**.

---

## 1. Quick Download & Portable Distribution

Toad is packaged as a completely self-contained portable Windows executable—no administrator privileges, background daemons, or installation wizards required.

| Executable / Release | Size | Description |
| :--- | :--- | :--- |
| **[`Toad 2.3.4 (Latest Portable)`](https://github.com/p1rkr41n/toad_electron/releases/tag/v2.3.4)** | ~72 MB | Enterprise release: ASAR Sealing & Zero-Crash Resilience (eliminates ENOENT crash loops) |
| **[`Toad 2.3.3 (Portable)`](https://github.com/p1rkr41n/toad_electron/releases/tag/v2.3.3)** | ~72 MB | Double-Valid Parquet State Ledger (`toad_ledger.parquet`) & Persistent Cache |
| **[`Toad 2.3.2 (Portable)`](https://github.com/p1rkr41n/toad_electron/releases/tag/v2.3.2)** | ~72 MB | Dark Mode Contrast Fix across all panes & Ergonomic ActivityBar |
| **[`Toad 2.3.1 (Portable)`](https://github.com/p1rkr41n/toad_electron/releases/tag/v2.3.1)** | ~72 MB | DuckDB assertion fix (`vector.cpp:1859`), Smart Bounded Ingestion Queue |
| **[`Toad 2.3.0 (Portable)`](https://github.com/p1rkr41n/toad_electron/releases/tag/v2.3.0)** | ~75 MB | Standalone portable executable with Host-Bridge modularization & DuckDB 1.0.0 |
| **[`All GitHub Releases`](https://github.com/p1rkr41n/toad_electron/releases)** | - | Full catalogue of versioned portable binaries and release packages |
| **[`releases/RELEASE_NOTES.md`](releases/RELEASE_NOTES.md)** | - | Full Version Changelog & Technical Specifications |
| **[`QUICK_START.md`](QUICK_START.md)** | - | Complete Quick Start & Feature Guide |

### Non-Polluting Portable Architecture
Toad does not write into `C:\Users\<user>\AppData\Roaming`. Instead, all configuration (`config.ini`), query filters (`filters_preset.json`), state ledger (`toad_ledger.parquet`), logs, and transient Parquet caches are encapsulated within a local folder named `toadAppData_[id]` created right alongside the executable.

---

## 2. Key Capabilities & Architectural Innovations

### 2.1 What's New in v2.3.4 (ASAR Sealing & Zero-Crash Resilience)
* **ASAR Sealing (`asarUnpack` Isolation)**:
  - Pruned `**/*reltab*` from `asarUnpack`. All core JavaScript application files (`reltab`, `reltab-duckdb`, `reltab-fs`) are now safely sealed 100% inside `app.asar`.
  - Completely eliminates the `ENOENT: no such file or directory... reltab-duckdb.js` crash loop caused by NSIS partial temp deletions or Windows sharing violations.
  - Strictly unpacks only native C++ binary addons (`**/*.node` for `duckdb.node`).
* **Shutdown File Handle Buffer**:
  - Extended graceful shutdown release window to 150ms in `before-quit` to ensure Windows kernel memory mappings and active DuckDB streams fully detach before portable NSIS wrapper triggers directory cleanup.

### 2.2 What's New in v2.3.3 (Double-Valid Parquet State Ledger & Persistent Cache)
* **Double-Valid Parquet State Ledger (`toad_ledger.parquet`)**:
  - Implements an **Append-Only Write-Ahead Log (WAL)** in Apache Parquet format inside `toadAppData`.
  - Never deletes or rewrites history; each event (`STARTED`, `READY`, `ERROR`, `STALE`) is an immutable appended transaction row.
  - Acts as the bootstrap source of truth for the entire system upon startup via DuckDB vectorized window queries:
    $$\text{Latest Snapshot} = \text{ROW\_NUMBER}() \text{ OVER } (\text{PARTITION BY } \text{source\_path} \text{ ORDER BY } \text{timestamp DESC}) = 1$$
* **Two-Tier Double Validation Engine**:
  - **Level 1 (Source Freshness)**: Compares physical file size and filesystem `mtimeMs` against recorded values. If the source file was edited or touched, Level 1 triggers a re-conversion.
  - **Level 2 (Physical Cache Integrity)**: Verifies that the `.parquet` cache exists on disk, matches `parquet_size`, and is structurally sound.
  - Files passing Double Validation are immediately marked `status: "ready"` (100% loaded) upon directory scan, completely bypassing background worker queues and progress bars (e.g., 40GB CSV files open in $< 1\text{ ms}$ on subsequent sessions!).
* **Fix Startup Cache Wiping (`temp_cleanup = false` Persistence)**:
  - Fixed an issue where `cleanTempDir` was invoked unconditionally at startup before `config.ini` was evaluated.
  - `config.ini` is now parsed first; when `temp_cleanup = false`, all cached Parquet files in `temp/` are preserved indefinitely across sessions.
  - Safety guard: `cleanTempDir` never removes `toad_ledger.parquet`.
* **Zero-Cost Indie Developer Release Pipeline (HelloKittyXamKinLung Standard)**:
  - Formatted PE metadata branding, portable `.exe` and `.zip` packaging, SHA-256 checksums, and SmartScreen frictionless distribution guidelines.

### 2.2 What's New in v2.3.2 (Dark Mode Parity & UI Standardization)
* **Complete Dark Mode Contrast Resolution across All Panes**:
  - **Sidebar File Tree**: Fixed invisible black-on-black file names (`.ds-status-ready`) by introducing first-class Material 3 Dark tokens (`var(--md-sys-color-on-surface, #e3e3e8)`), boosting contrast to > 11:1.
  - **Full Status Color Spectrum**: Distinct and accessible colors for all ingestion states in both Light and Dark mode (`ready`, `processing`, `pending`, `idle`, `error`).
  - **Tree Node Selection & Hover**: Harmonized selected rows with M3 Primary Container (`#1f385c`) and bright white title text (`#ffffff`).
  - **Event Details Sidebar (`eventDetailSidebar.less`)**: Built comprehensive Material 3 Dark support across headers, badges, search bar, table rows, forensic decoders, and code preview containers—eliminating the previous solid-white panel glare.
  - **Center Loading & Empty Workspace Cards**: Styled center loading progress cards, empty workspaces, and error cards with gentle ergonomic slate containers (`#25262c`).
  - **Column Selector Badges & Grid Borders**: Adapted column search match badges and SlickGrid divider lines to dark mode.
* **Ergonomic ActivityBar Streamlining**:
  - Removed the standalone bottom feedback icon button to keep the ActivityBar uncluttered and focused purely on data navigation and the theme toggle.
  - Preserved the Defender-safe GitHub feedback feature within the native application menu under `Help -> Send Feedback / Bug Reports (GitHub)`.

### 2.2 What's New in v2.3.1 (Reliability & Usability Release)
* **DuckDB C++ Assertion Resolution (`vector.cpp:1859`)**:
  - Eliminated the native crash bug caused by DuckDB 1.0.0's CSV scanner attempting to unescape string quotes (`RemoveEscape`) into non-VARCHAR physical vectors.
  - Enforced RFC-4180 strict dialect (`quote = '"', escape = '"'`) across all streaming and in-memory queries, null-padding resilience, and automatic 3-tier fallback to `all_varchar = true` and Raw Event mode for malformed datasets.
* **Smart Bounded Queue & Lazy Pre-loading**:
  - Re-engineered `MultipleLoadingManager` to pre-warm the initial 8 files concurrently upon opening a directory, gracefully keeping larger batches in `idle` on-demand state to prevent disk thrashing and memory exhaustion.
  - Instant VIP Jump Queue: clicking any file immediately elevates it to the highest priority for instant loading.
* **Integrated "Send Feedback & Bug Reports"**:
  - One-click GitHub Issue Reporter added directly to the Activity Bar and Help Menu.
  - Skilfully engineered using native Windows Shell integration (`shell.openExternal`) via `host-bridge`—opening the default web browser seamlessly without spawning `cmd.exe` or `powershell.exe`, guaranteeing zero false-positive alerts from Windows Defender or heuristic endpoint protection agents.

### 2.2 Decoupled Host-Bridge Architecture (v2.3.0)
Toad v2.3.0 introduces a modularized runtime boundary between the presentation layer and the native host runtime:
- **Zero-Electron UI Layer**: The entire [`tadviewer`](packages/tadviewer/) package contains zero direct references to Electron APIs, isolating view logic completely.
- **`host-bridge` Interface Abstraction**: [`packages/host-bridge`](packages/host-bridge/) defines `IHostBridge` and `V8HostAdapter`, allowing the user interface to communicate cleanly across desktop backends (Electron, future Web / Tauri / Native).
- **Runtime Configuration Router**: [`config.ini`](config.ini) dynamically controls runtime behavior:
  ```ini
  [runtime]
  engine = v8
  auto_fallback = true
  ```

### 2.2 Dual-Engine DuckDB & RAM Micro-Cache
- **Isolated Engine Singletons**: Toad segregates DuckDB operations into two independent pools:
  - **UI Driver**: Dedicated to low-latency user queries, grid paging, and pivot calculations.
  - **Ingest Engine**: Multi-worker background ingestion pipeline that converts raw CSV, JSON, and EVTX files into columnar Parquet without blocking user navigation.
- **RAM First-Page Micro-Cache**: Caches the initial 1,000 rows in memory immediately upon ingestion completion, resolving first-page table mounts in **< 2ms with zero disk I/O**.
- **Libuv Thread Budgeting**: Automatically calculates thread pools bounded within `[8, 128]` based on host CPU topology.

### 2.3 Dynamic In-Place Column Extractor
Extract, structure, and rename embedded semi-structured log fields on the fly:
- **Supported Encodings**:
  - **JSON Object & Array**: Extract keys by path (`$.user.name`) or array index (`$[0]`).
  - **Key-Value Pairs**: Parse `key=value` or `key: "value"` with custom delimiters.
  - **Delimited & CSV**: Custom delimiter (`|`, `,`, `\t`, space) with quote enclosure resilience.
  - **Regular Expressions**: Capture groups with automatic `$X_{max}` collision-free resuming column index.
  - **W3C / IIS Web Logs**: Auto-detects space-delimited access logs with sticky headers.
- **Header Prefix CTE**: Preserves original log headers cleanly via DuckDB Common Table Expressions.
- **Inline TRY_CAST**: Live type selector defaulting to robust error-suppressed conversion.
- **Universal Unmatched Column Engine**: Automatically isolates unparsed text into an `unmatched_raw_event` column and measures empirical fill rates.

### 2.4 Ergonomic Slate Dark Theme & Material 3 Styling
- **WCAG-Compliant Dark Mode**: Carefully calibrated slate palette (`#1E1E24`, `#2D2D39`) designed specifically for dark SOC environments and long DFIR investigation shifts.
- **ActivityBar Sun/Moon Switcher**: Seamlessly toggle between Light and Dark themes with persistent local configuration.
- **Subtle DataGrid Borders**: Replaced harsh borders with gentle grid lines and full-row selection highlighting.

---

## 3. Supported Data Formats

| Format | Extension | Capabilities |
| :--- | :--- | :--- |
| **Delimited Text** | `.csv`, `.tsv`, `.txt` | Ultra-fast multi-threaded streaming with 3-tier fallback parser |
| **Apache Parquet** | `.parquet` | Native columnar scanning with zero conversion overhead |
| **DuckDB Database** | `.duckdb` | Full SQL schema tree browsing and instant table views |
| **SQLite Database** | `.sqlite`, `.db` | Embedded relational database inspection |
| **JSON / JSON Lines** | `.json`, `.jsonl`, `.ndjson` | Structured and semi-structured streaming ingestion |
| **Windows Event Logs** | `.evtx` | Rust-accelerated EVTX decoding into columnar records |
| **Raw Event Logs** | `.log` | Ingests unformatted log lines directly into a `raw_event` column |
| **Toad Workspaces** | `.tad` | Saves and restores entire pivot tables, filters, and layouts |

---

## 4. Exploration & Query Ergonomics

### 4.1 Hierarchical Pivot Tables
Transforms flat tables into interactive multi-level tree tables:
- Group rows across arbitrary pivot columns with sub-second response times.
- Compute aggregations (`sum`, `avg`, `min`, `max`, `uniq`, row counts).
- Instant drill-down and drill-up into nested branches.

### 4.2 ArcSight ESM Query Search & Compound Filtering
Enterprise-grade compound query engine modeled after ArcSight ESM:
- **Dual View Modes**: Switch between graphical tree view and direct Raw SQL editing.
- **Multi-Tag Pill Inputs**: Paste comma/newline-separated lists into `IN` / `NOT IN` clauses.
- **Real-Time Row Counters**: Shows matched count and execution latency live on every keystroke.
- **Drag-and-Drop Rule Nesting**: Reorder and nest conditions across logical `AND` / `OR` groups.

### 4.3 Event Details Inspector (Master-Detail View)
- Click the chevron (`›`) on any row to open the secondary **Event Details** inspection panel.
- Monospace payload wrapping with data type badges (`str`, `int`, `time`, `bool`).
- Smooth keyboard navigation with arrow keys (<kbd>&uarr;</kbd> / <kbd>&darr;</kbd>).
- One-click JSON export and individual field value clipboard copy.

---

## 5. Automated Verification & Testing Suite

Toad maintains an enterprise-grade automated test runner validating the full stack from backend DuckDB drivers to frontend UI components:

```powershell
# Run the complete QA test suite (138 deep integration tests)
node run_tests.js --qa

# Run the complete test suite across all suites
node run_tests.js --all
```

**Test Coverage Summary**:
- **Suite A**: Dual Engine Driver & Connection Pool Verification
- **Suite B**: FSDriver Ingestion & Instant UI Mount
- **Suite C**: High Concurrency Stress Test & UI Latency Profiling
- **Suite D**: Memory Limits, Thread Budgeting & Fast Row Count
- **Suite E**: Dual Engine IPC & RAM First-Page Micro-Cache
- **Suite F**: Multi-Format Column Extractor Acceptance Tests
- **Suite G**: Header Prefix CTE, Quote Pairs & Inline Cast
- **Suite H-U**: Regression, Filter, Navigation, and Pivot Coverage
- **Suite V-X**: Slate Dark Theme, WCAG Contrast & Grid Borders
- **Suite Y-Z**: Delimited Web Log Parsing & Unmatched Column Engine
- **Suite AA-BB**: Full-System Footprint Optimization & Dead Code Elimination
- **Suite CC**: Host Bridge Package, Zero-Electron Isolation & Version Synchronization
- **Result**: **138 / 138 test cases passing cleanly (100% HEALTHY)**.

---

## 6. Development & Build Instructions

### Prerequisites
- Windows 10/11 x64
- Node.js v18.20+ & npm
- Rust toolchain (optional, for compiling `toad-core-rust`)

### Repository Structure
```
tad/
├── build_all.ps1                  # Root build script
├── config.ini                     # Runtime configuration router
├── dist_package.ps1               # Portable packaging script
├── run_tests.js                   # Unified test runner
├── docs/                          # Architecture & BA documentation
├── releases/                      # Release notes & QA reports
└── tad-master/                    # Core monorepo
    ├── packages/
    │   ├── host-bridge/           # UI host abstraction layer
    │   ├── reltab/                # Core relational table query model
    │   ├── reltab-duckdb/         # DuckDB 1.0.0 driver & SQL dialect
    │   ├── reltab-fs/             # Filesystem & ingestion driver
    │   ├── tadviewer/             # Decoupled React + SlickGrid UI
    │   ├── tad-app/               # Electron application shell & packaging
    │   └── toad-core-rust/        # Rust SIMD binary guard & EVTX engine
```

### Building from Source
```powershell
# 1. Bootstrap monorepo dependencies
cd tad-master
npx lerna bootstrap --ci --hoist --force-local

# 2. Build backend packages and UI
cd packages/host-bridge; npm run build
cd ../reltab; npm run build
cd ../reltab-duckdb; npm run build
cd ../reltab-fs; npm run build
cd ../tadviewer; npm run build

# 3. Build & package desktop executable
cd ../tad-app; npm run build-prod
npx electron-builder --win portable --publish=never
```

---

## 7. License & Attribution

- **License**: [MIT License](LICENSE)
- **Upstream Attribution**: Forked from [Tad (tadviewer)](https://github.com/antonycourtney/tad) by [Antony Courtney](https://github.com/antonycourtney).
- **Core Technology Stack**: [DuckDB](https://duckdb.org/), [Apache Arrow](https://arrow.apache.org/), [Apache Parquet](https://parquet.apache.org/), [Electron](https://www.electronjs.org/), [BlueprintJS](https://blueprintjs.com/), [SlickGrid](https://github.com/mleibman/SlickGrid), [React](https://react.dev/), [Rust](https://www.rust-lang.org/).
