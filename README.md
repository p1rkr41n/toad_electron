# Toad (v2.5.1) - High-Performance Tabular Data & Security Log Analyzer

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Engine](https://img.shields.io/badge/Engine-DuckDB%201.0.0%20%7C%20Rust%20SIMD%20%7C%20Parquet%20Native-green.svg)](https://duckdb.org/)
[![Version](https://img.shields.io/badge/Version-2.5.1-brightgreen.svg)](https://github.com/p1rkr41n/toad_electron/releases)
[![Platform](https://img.shields.io/badge/Platform-Windows%20x64%20(Portable)-orange.svg)](https://github.com/p1rkr41n/toad_electron/releases)
[![Tests](https://img.shields.io/badge/QA%20Tests-PASS%20(138%2F138)-success.svg)](tests/run_tests.js)

> [!NOTE]
> **Project Origin & Attribution**:
> **Toad** is an enterprise-grade, high-performance fork of [Tad](https://github.com/antonycourtney/tad) (tadviewer), originally created by [Antony Courtney](https://github.com/antonycourtney). While Tad pioneered the concept of an elegant tabular data viewer, **Toad** fundamentally re-architects the system into an ultra-high-throughput Big Data log analyzer and Digital Forensics & Incident Response (DFIR) platform. Major enhancements include native DuckDB 1.0.0 vectorized engines, isolated dual-engine drivers (UI vs Ingestion), in-place multi-format column extractors (JSON, CSV, KV, Regex, W3C Web Logs), native Windows Event Log (`.evtx`) parsing via Rust SIMD, decoupled `host-bridge` UI architecture, instant RAM First-Page Micro-Cache, Double-Valid Parquet State Ledger (`toad_ledger.parquet`), Multi-Project Workspace Navigator, FastBuild rapid deployment pipeline, and Ergonomic Slate Dark Mode.

> **Toad** is a blazing-fast, lightweight, and modern desktop application designed for querying, exploring, and analyzing tabular data files of virtually any scale (including **Big Data 40GB+ / 60,000,000+ rows**). Powered by **DuckDB 1.0.0**, native **Apache Parquet**, and an embedded **Rust SIMD Core**, Toad delivers sub-second pivot tables, compound filtering with ArcSight ESM query ergonomics, background **Multiple Loading Ingestion Queue**, visual in-situ progress tracking, $O(1)$ instant row counting, automatic chronological time sorting, background distinct filter caching, Ergonomic Slate dark theme, instant **Smart Expand 1-click triage**, and a flexible **pagination engine (default 1,000 rows with zero arbitrary upper limit)**.

---

## 1. Quick Download & Portable Distribution

Toad is packaged as a completely self-contained portable Windows executable—no administrator privileges, background daemons, or installation wizards required.

| Executable / Release | Size | Description |
| :--- | :--- | :--- |
| **[`Toad 2.4.6 (Latest Release)`](https://github.com/p1rkr41n/toad_electron/releases/tag/v2.4.6)** | ~72 MB | RFC-4180 strict CSV delimiter enforcement, C++ assertion crash prevention (`vector.cpp:1859`), auto-eviction of corrupt caches, and FastBuild packaging |
| **[`Toad 2.4.4 (Portable)`](https://github.com/p1rkr41n/toad_electron/releases/tag/v2.4.4)** | ~72 MB | English UI standardization, FullPath Tooltip, and Delete All Projects with confirm modal |
| **[`Toad 2.4.3 (Portable)`](https://github.com/p1rkr41n/toad_electron/releases/tag/v2.4.3)** | ~72 MB | Real-time File/Table search, in-place Project Rename, and auto-sync ledger |
| **[`Toad 2.4.2 (Portable)`](https://github.com/p1rkr41n/toad_electron/releases/tag/v2.4.2)** | ~72 MB | Project Isolation & Tombstone Ledger, Startup Reconciliation, and Single Trust Ledger |
| **[`Toad 2.4.1 (Portable)`](https://github.com/p1rkr41n/toad_electron/releases/tag/v2.4.1)** | ~72 MB | Data-Dense Dashboard Sidebar, Zero Collision Tree, Hover Actions & Rich Tooltips |
| **[`Toad 2.4.0 (Portable)`](https://github.com/p1rkr41n/toad_electron/releases/tag/v2.4.0)** | ~72 MB | Multi-Project Workspace Navigator, Cascade Cache Cleanup & Parquet State Ledger v2 |
| **[`Toad 2.3.5 (Portable)`](https://github.com/p1rkr41n/toad_electron/releases/tag/v2.3.5)** | ~72 MB | Session Auto-Restore, Modified Red Status Badge & Orphan Temp Purge |
| **[`All GitHub Releases`](https://github.com/p1rkr41n/toad_electron/releases)** | - | Full catalogue of versioned portable binaries and release packages |
| **[`releases/RELEASE_NOTES.md`](releases/RELEASE_NOTES.md)** | - | Full Version Changelog & Technical Specifications |
| **[`QUICK_START.md`](QUICK_START.md)** | - | Complete Quick Start & Practical Usage Guide |

### Non-Polluting Portable Architecture
Toad strictly obeys the zero-footprint portable application philosophy:
- **No Registry Changes**: Never registers COM components, file associations, or uninstall strings.
- **No AppData Pollution**: Does not write to `C:\Users\<user>\AppData\Roaming`.
- **Encapsulated Local Data**: All configuration (`config.ini`), query filters (`filters_preset.json`), state ledger (`toad_ledger.parquet`), logs, and transient Parquet caches are strictly encapsulated within a local folder named `toadAppData_[id]` created alongside the executable.

---

## 2. Comprehensive Feature Matrix

### 2.1 Workspace & Multi-Project Management
* **2-Tier Project Hierarchy**:
  - Top level: Projects (User-defined workspaces, default `Untitled-1`, and legacy `orphan_prj`).
  - Child level: File tables with live status badges (`[READY]`, `[MODIFIED]`, `[PROCESSING]`, `[PENDING]`, `[ERROR]`).
* **In-Place Project Rename**: Double-click or click the edit icon on any project header to rename it directly. Changes immediately sync to the Parquet State Ledger.
* **Batch & Folder Ingestion**: Add individual files, multiple files via multi-select dialog, or drag-and-drop entire directory trees into specific projects.
* **Cascade Cache Cleanup**: Deleting a project triggers cascading disk cleanup, purging all associated intermediate Parquet caches (`*_cached_*.parquet`) and orphaned temp chunks while strictly safeguarding raw source files.
* **Project Isolation & Tombstone Ledger**: Ensures deleted files and projects never resurrect as "ghost files" across restarts using immutable tombstone rows in the append-only WAL.
* **Startup Reconciliation & Single Trust Ledger**: On startup, DuckDB queries the State Ledger snapshot in `<5ms` to verify file existence and freshness, restoring the exact state of all projects and files.
* **Automatic `Untitled-1` Auto-Recovery**: If all projects are deleted, a 500ms debouncer automatically initializes a clean `Untitled-1` project so the workspace is never left in an invalid empty state.
* **Delete All Projects Action**: Clean slate in one click with a clear confirmation dialog calculating total reclaimed disk space.
* **Real-Time Search & Filtering**: Instant search box in the sidebar to filter files by filename or directory path (`data_sample/`).
* **Rich Tooltips & Hover Actions**: Hovering over any file shows its complete system path, size, modification date, and ingestion status.

### 2.2 Dual-Engine Big Data Architecture (40GB+ / 60M+ Rows)
* **Isolated Dual DuckDB Engine Singletons**:
  - **UI Driver**: Dedicated solely to low-latency user queries, pagination, sorting, and pivot operations. Never blocked by file loading.
  - **Ingest Engine**: Multi-worker background pipeline that streams raw CSV, JSONL, and EVTX files into columnar Parquet.
* **RAM First-Page Micro-Cache**: Caches the initial 1,000 rows in memory immediately upon ingestion completion. Clicking a ready file opens the grid in **< 2ms with zero disk I/O**.
* **Instant $O(1)$ Metadata Row Count**: For multi-gigabyte datasets, row counts are resolved in **~25ms** directly from Apache Parquet metadata headers (`SELECT SUM(row_group_num_rows) FROM parquet_metadata(...)`), eliminating prolonged 30s table scans.
* **Smart Bounded Ingestion Queue**:
  - Automatically limits background ingestion concurrency (maximum 8 files pre-warming concurrently).
  - Background 1s scheduler prevents CPU starvation and disk I/O thrashing.
  - **VIP Jump Queue Preemption**: Clicking any pending file immediately promotes it to priority #1 for instant loading.
* **Dynamic Libuv Threadpool Budgeting**: Configurable in `config.ini` with auto-tuning bounded within `[8, 128]` threads based on host CPU topology.

### 2.3 Resilient Multi-Tier CSV & Delimited Text Ingestion
* **RFC-4180 Strict Delimiter Enforcement**:
  - Explicitly enforces `delim = ','` for `.csv` files and `delim = '\t'` for `.tsv` files.
  - Eliminates parser delimiter confusion caused by quoted commas inside log payloads (e.g. JSON fields or command-line strings).
* **Native C++ Crash Prevention (`vector.cpp:1859`)**:
  - Fixed the native DuckDB assertion crash where `RemoveEscape` was invoked on numeric physical vectors.
  - Complex DFIR logs automatically activate `all_varchar = true`, guaranteeing 100% physical `PhysicalType::VARCHAR` vectors and mathematically preventing assertion failure while preserving full table structure.
* **Automatic Corrupted Cache Eviction (Auto-Eviction)**:
  - If an older cache exists where columns were mistakenly merged into a single composite column (e.g. `Timestamp,EventTime,...`), Toad automatically detects the delimiter anomaly, deletes the damaged Parquet cache, and re-ingests cleanly.
* **3-Tier Streaming Fallback**:
  - **Tier 0**: High-speed RFC-4180 multi-threaded stream with header auto-detection.
  - **Tier 1**: Single-threaded serial streaming for boundary-sensitive files.
  - **Tier 2**: Robust `all_varchar = true` ingest for dirty and irregular forensic logs.
  - **Tier 2b**: Force Header fallback for unstructured CSV exports without header quotes.

### 2.4 Windows Event Log (`.evtx`) Forensic Engine
* **Embedded Rust SIMD Decoder**:
  - Powered by native `toad-core-rust` binary module.
  - High-throughput binary XML decoding into structured columnar records.
* **Non-Blocking Asynchronous Processing**:
  - Runs in a background worker without freezing the Electron UI event loop.
  - Multi-stage progress tracking:
    - **5% – 45%**: Rust SIMD binary EVTX decoding to JSONL stream.
    - **45% – 90%**: DuckDB streaming from JSONL to compressed Parquet.
    - **90% – 100%**: Parquet metadata indexing and instant View registration.

### 2.5 Dynamic In-Place Column Extractor
Extract, structure, and rename embedded semi-structured log fields on the fly:
* **Supported Extraction Dialects**:
  - **JSON Object & Array**: Extract keys by path (`$.user.name`) or array index (`$[0]`).
  - **Key-Value Pairs**: Parse `key=value` or `key: "value"` with custom delimiters.
  - **Delimited & CSV**: Custom delimiter (`|`, `,`, `\t`, space) with quote enclosure resilience.
  - **Regular Expressions**: Capture groups with automatic `$X_{max}` collision-free resuming column index.
  - **W3C / IIS Web Logs**: Auto-detects space-delimited access logs with sticky headers.
* **Header Prefix CTE**: Preserves original log headers cleanly via DuckDB Common Table Expressions.
* **Inline `TRY_CAST`**: Live type selector defaulting to robust error-suppressed conversion.
* **Universal Unmatched Column Engine**: Automatically isolates unparsed text into an `unmatched_raw_event` column and measures empirical fill rates.

### 2.6 Exploration, Filtering & Pivot Analytics
* **ArcSight ESM Compound Query Engine**:
  - Dual View Modes: Visual condition tree editor or direct raw SQL query editing.
  - Multi-Tag Pill Inputs: Paste comma/newline-separated lists into `IN` / `NOT IN` clauses.
  - Live Matched Row Counter: Displays matched rows and query latency live on every keystroke.
  - Drag-and-Drop Rule Nesting: Reorder and nest conditions across logical `AND` / `OR` groups.
* **Hierarchical Pivot Tables**:
  - Multi-level group by across arbitrary pivot columns with sub-second response times.
  - Aggregate metrics: `sum`, `avg`, `min`, `max`, `uniq`, row counts.
  - Interactive drill-down and drill-up into nested branches.
* **Event Details Inspector (Master-Detail Drawer)**:
  - Click the chevron (`›`) on any row to open the secondary **Event Details** inspection panel.
  - Monospace payload wrapping with data type badges (`str`, `int`, `time`, `bool`).
  - Smooth keyboard navigation with arrow keys (<kbd>&uarr;</kbd> / <kbd>&darr;</kbd>).
  - One-click JSON export and individual field value clipboard copy.
* **Smart Expand 1-Click Triage**: Instant row preview and formatted payload inspection.
* **Flexible Pagination Engine**: Default 1,000 rows with dynamic sliding window and zero arbitrary row cap.

### 2.7 UI/UX & Visual Ergonomics
* **English UI Standardization**: Clean, professional internationalized English interface across all menus, tooltips, dialogs, and status badges.
* **Ergonomic Slate Dark Mode & Material 3 Styling**:
  - WCAG AAA-compliant dark palette (`#1E1E24`, `#2D2D39`) designed specifically for dark SOC environments and long DFIR investigation shifts.
  - ActivityBar Sun/Moon switch to seamlessly toggle between Light and Dark themes with persistent local storage.
  - Subtle SlickGrid border dividers and full-row selection highlighting.

---

## 3. Supported Data Formats

| Format | Extension | Capabilities |
| :--- | :--- | :--- |
| **Delimited Text** | `.csv`, `.tsv`, `.txt` | Ultra-fast multi-threaded streaming with RFC-4180 strict delimiter enforcement and 3-tier fallback |
| **Apache Parquet** | `.parquet` | 100% Native columnar scanning with zero conversion overhead |
| **DuckDB Database** | `.duckdb` | Full SQL schema tree browsing and instant table views |
| **SQLite Database** | `.sqlite`, `.db` | Embedded relational database inspection |
| **JSON / JSON Lines** | `.json`, `.jsonl`, `.ndjson` | Structured and semi-structured streaming ingestion |
| **Windows Event Logs** | `.evtx` | Rust-accelerated EVTX decoding into columnar Parquet records |
| **Raw Event Logs** | `.log` | Ingests unformatted log lines directly into a `raw_event` column |
| **Toad Workspaces** | `.tad` | Saves and restores entire pivot tables, filters, and layouts |

---

## 4. Rapid Packaging & Build Pipeline

Toad provides dual build pipelines optimized for both everyday development/QA testing and production distribution:

```
                            [MÃ NGUỒN TOAD]
                                   │
                 ┌─────────────────┴─────────────────┐
                 ▼                                   ▼
        [1. FASTBUILD PIPELINE]             [2. PRODUCTION PIPELINE]
        (fastbuild.ps1)                     (dist_package.ps1 + package_release.ps1)
        - Thời gian: ~70 - 120 giây         - Thời gian: ~255 - 265 giây
        - Không nén 7-Zip LZMA nặng         - Nén tối đa tạo 1 file .exe duy nhất
        - Đóng gói thành thư mục:           - Tạo: releases/Toad-<v>-x64-portable.exe
          build/Toad-<version>/Toad.exe            releases/Toad-<v>-x64-portable.zip
        - Tạo junction: build/latest        - Tạo mã băm SHA-256 chính thức
        - Chạy thử & nghiệm thu ngay!       - Đưa lên GitHub Releases
```

### 4.1 FastBuild Pipeline (`fastbuild.ps1`)
Built specifically to drastically cut turnaround time during debugging, feature development, and QA testing:
```powershell
# FastBuild tiêu chuẩn (tạo build/Toad-<version>/Toad.exe trong ~120s):
powershell -ExecutionPolicy Bypass -File fastbuild.ps1

# FastBuild siêu tốc (bỏ qua tsc nếu chỉ sửa JavaScript/HTML/CSS, ~70s):
powershell -ExecutionPolicy Bypass -File fastbuild.ps1 -SkipTsc

# FastBuild và tự động khởi chạy ứng dụng ngay sau khi build:
powershell -ExecutionPolicy Bypass -File fastbuild.ps1 -Launch
```

### 4.2 Production Release Pipeline
```powershell
# 1. Đóng gói binary portable chính thức
powershell -ExecutionPolicy Bypass -File dist_package.ps1

# 2. Tạo file ZIP phân phối và mã băm SHA-256
powershell -ExecutionPolicy Bypass -File package_release.ps1
```

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

## 6. Repository Structure

```
tad/
├── build_all.ps1                  # Root build script
├── config.ini                     # Runtime configuration router
├── dist_package.ps1               # Production portable packaging script
├── fastbuild.ps1                  # Rapid unpacked deployment script
├── package_release.ps1            # Release ZIP and SHA-256 generator
├── run_tests.js                   # Unified test runner (138 tests)
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

---

## 7. License & Attribution

- **License**: [MIT License](LICENSE)
- **Upstream Attribution**: Forked from [Tad (tadviewer)](https://github.com/antonycourtney/tad) by [Antony Courtney](https://github.com/antonycourtney).
- **Core Technology Stack**: [DuckDB](https://duckdb.org/), [Apache Arrow](https://arrow.apache.org/), [Apache Parquet](https://parquet.apache.org/), [Electron](https://www.electronjs.org/), [BlueprintJS](https://blueprintjs.com/), [SlickGrid](https://github.com/mleibman/SlickGrid), [React](https://react.dev/), [Rust](https://www.rust-lang.org/).
