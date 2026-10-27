# Toad Quick Start Guide (v1.3.9.1)

> **Toad** is a high-performance, lightweight, and modern desktop application designed for querying, exploring, and analyzing tabular data and log files of virtually any scale (including **Big Data 40GB+ / 60,000,000+ records**). Powered by **DuckDB 1.0.0**, native **Apache Parquet**, and an embedded **Rust SIMD Core**, Toad delivers sub-second pivot tables, compound filtering with ArcSight ESM ergonomics, visual streaming ingestion progress, $O(1)$ instant row counting, automatic chronological time sorting, background distinct filter caching, Dracula dark mode, instant **Smart Expand 1-click triage**, and a flexible **pagination engine (default 1,000 rows with no arbitrary upper limit)**.

---

## 1. Quick Launch & Zero Installation

Toad is packaged as a completely self-contained portable Windows executable—no administrator privileges, installer wizards, or background services required.

- **Primary Portable Executable**: [`Toad.exe`](file:///D:/Shared_UserData/Downloads/tad/Toad.exe) (~92 MB)
- **Versioned Portable Release**: [`releases/toad_v1.3.9.1_portable.exe`](file:///D:/Shared_UserData/Downloads/tad/releases/toad_v1.3.9.1_portable.exe)

### Three Easy Ways to Open Data:
1. **Direct Launch**: Double-click `Toad.exe`. Click **File &rarr; Open** (or press `Ctrl+O`) to select any supported data file.
2. **Drag & Drop**: Simply drag and drop any data file directly into the Toad window.
3. **Command Line Interface (CLI)**:
   ```powershell
   # Basic open
   .\Toad.exe telemetry_log.parquet

   # Open with console SQL query tracing enabled
   .\Toad.exe -f --show-queries security_events.csv
   ```

### Supported File Formats:
| Format | Extension | Key Capabilities |
| :--- | :--- | :--- |
| **Apache Parquet** | `.parquet` | 100% Native columnar scanning with zero conversion overhead |
| **Delimited Text** | `.csv`, `.tsv`, `.txt` | Multi-threaded streaming parser converting to Parquet with live progress dialog |
| **DuckDB Database** | `.duckdb` | Full SQL schema tree browsing and instant table views |
| **SQLite Database** | `.sqlite`, `.db` | Embedded relational table inspection |
| **Windows Event Logs** | `.evtx` | Rust-accelerated EVTX decoding into columnar records |
| **Raw Event Logs** | `.log` | Ingests unformatted log lines into a queryable `raw_event` column |
| **JSON / JSON Lines** | `.json`, `.jsonl`, `.ndjson` | Structured and semi-structured streaming ingestion |
| **Toad Workspaces** | `.tad` | Saves and restores entire pivot tables, filters, and layouts |

---

## 2. Big Data 40GB+ Ingestion & Instant $O(1)$ Row Count (Enhanced in v1.3.8 & v1.3.9)

Opening large files (such as 40GB CSVs with 60+ million rows) in traditional viewers causes out-of-memory crashes and freezes. Toad introduces a dedicated Big Data subsystem:

### 2.1 100% Parquet Native Engine & Visual Ingestion Progress Dialog
- **Zero Raw CSV Rendering**: Toad streams all raw CSV and JSON files directly into compressed Snappy Parquet files on disk inside the portable temporary workspace (`toadAppData_*`).
- **Live Progress Dialog**: When loading large files, Toad presents a non-blocking modal dialog showing:
  - **Live Conversion Percentage** (`%`)
  - **Streaming Throughput Speed** (`MB/s`)
  - **Estimated Time Remaining (ETA)**
  - **Cancel Button**: Safely stops ingestion immediately without leaving lingering background processes.

### 2.2 Instant $O(1)$ Parquet Metadata Row Count (~25ms)
- **The Problem**: Executing `SELECT count(*)` on a 40GB dataset takes 15 to 30 seconds of pure table scanning before anything can render.
- **The Toad Solution**: Toad extracts row counts directly from the Apache Parquet file metadata (`SELECT SUM(row_group_num_rows) FROM parquet_metadata(...)`).
- **Result**: Row count completes in **~25 milliseconds** ($O(1)$ constant time), cached in `_toadTableRowCountCache` for instant UI initialization.

---

## 3. Flexible Pagination Engine & Dynamic Sliding Buffer (New in v1.3.9)

Toad v1.3.9 replaces rigid page limits with a flexible, high-performance pagination engine:

```
+---------------------------------------------------------------------------------------------------------------------------------+
| [|< First]  [< Prev]   Page [ 1 ] of 60,000   [Next >]  [Last >|]    Page Size: [ 1,000 ⌵ ]  Showing 1 - 1,000 of 60,000,000 rows |
+---------------------------------------------------------------------------------------------------------------------------------+
```

### 3.1 Default 1,000 Rows & On-the-Fly Footer Selector
- Default page size is **1,000 rows per page**.
- Directly switch page size anytime from the dropdown selector in the footer: **500**, **1,000**, **2,500**, **5,000**, **10,000**, or custom sizes.
- Changes take effect instantaneously without reloading the data file.

### 3.2 Persistent `config.ini` & Zero Upper Bound Constraint
- Customize the startup page size via `config.ini` located alongside `Toad.exe`:
  ```ini
  [general]
  duckdb_threads = auto
  max_memory = auto
  row_group_size = 100000
  page_size = 1000
  ```
- **No Maximum Limit ("User Discretion")**: Toad enforces strictly **no arbitrary maximum limit** on `page_size`. Users on high-end workstations can set 20,000, 50,000, or any preferred size.

### 3.3 5-Page Sliding Buffer ($[P-2 .. P+2]$)
- Toad maintains a sliding memory window from Page $[P-2]$ to Page $[P+2]$ (5 pages in memory).
- **Instant 0ms Page Flipping**: Clicking `Next` or `Prev` switches pages immediately from RAM without dispatching a new DuckDB query.

---

## 4. Intelligent Auto Time-Column Sort & Fallback

In security and operational log analysis, chronological ordering is essential:

- **Automatic Time Column Detection**: Toad automatically scans the dataset schema and prioritizes the closest timestamp column in this order:
  $$\text{EventTime} \succ \text{Timestamp} \succ \text{TimeCreated} \succ \text{Time} \succ \text{Date}$$
- **Default DESC Order**: The detected time column is sorted descending (`DESC`) automatically, ensuring the most recent events appear first.
- **Resource-Saving Fallback**: If **no time column exists** in the dataset, Toad **completely skips sorting** to conserve CPU and RAM.

---

## 5. Enterprise ArcSight ESM Query Builder & Single Filter Dropdown (Enhanced in v1.3.9)

The Filter Builder delivers enterprise query ergonomics, dual view modes, multi-tag pill inputs, and clean single-menu autocomplete:

```
+---------------------------------------------------------------------------------------------------------+
| [Tree View | Raw SQL]   [x] Live update  | Selected: Channel  Keys: ↑ / ↓  |  [🗑 Clear] [▶ Apply] [✕ Close] |
+---------------------------------------------------------------------------------------------------------+
| [AND ⌵] Root Filter Block                                                                 [+] [📁]      |
|   |-- ⋮⋮ [ Channel      ] [ =       ] [ Microsoft-Windows-Sysmon/Operational ]                    [×]  |
|   `-- [OR ⌵] Subgroup Level 1                                                             [+] [📁] [×]  |
|         |-- ⋮⋮ [ EventID   ] [ IN (List)] [ [1 ×] [3 ×] [11 ×] + Type...       ]                    [×]  |
|         `-- ⋮⋮ [ ImagePath ] [ contains ] [ C:\Windows\System32\svchost.exe   ]                    [×]  |
+---------------------------------------------------------------------------------------------------------+
| SQL: WHERE "Channel" = '...' AND ("EventID" IN (1, 3, 11))  [Copy] | Matched: 565 / 24,510 | Latency: 1.2ms|
+---------------------------------------------------------------------------------------------------------+
```

### 5.1 Clean Single Suggestion Dropdown (v1.3.9)
- Removed redundant HTML5 `<datalist>` native browser popups.
- Autocomplete displays exclusively as a styled, dark/light theme aware React dropdown underneath the input with full keyboard navigation and click-to-fill support.

### 5.2 Bulletproof Search Escaping (Windows Paths & Wildcards)
- All string operators (`contains`, `not_contains`, `starts_with`, `ends_with`, `equals`) automatically escape Windows backslashes `\`, percent signs `%`, and underscores `_` with explicit single-character `ESCAPE '\'` SQL clauses.

---

## 6. Dracula Theme & Theme Switcher

Toad features a built-in **Dracula Theme** designed for prolonged analysis in low-light environments:

- **120° Soft Inversion Palette**: Replaces harsh pitch-black with soft Dracula slate (`#24262b`) and vibrant emerald/cyan accents (`#50fa7b` / `#8be9fd`).
- **Instant 1-Click Toggle**: Switch between **Light** and **Dracula** modes using the theme toggle icon at the bottom of the left vertical **Activity Bar** (`[🌙 / ⚡]`).
- **Auto-Persistence**: Theme preference is automatically saved across sessions.

---

## 7. Fast Right-Click Context Menu & Type-Aware Filter Guard

Right-click any cell in the data grid to filter instantly without opening the drawer:

- **Exact Match (`=`)**: Right-click &rarr; **Filter this value (`=`)**.
- **Exclude (`!=`)**: Right-click &rarr; **Filter out this value (`!=`)**.
- **Numeric & Timestamp Range (`>`, `<`, `>=`, `<=`)**: Type-aware filters for numbers and dates.
- **Time Bracket Filtering (`±5m`, `±15m`, `±1h`)**: Right-click any timestamp to isolate surrounding events during incident investigation.

---

## 8. Built-In Forensic Decoders

For DFIR analysts and security engineers examining encoded commands:

1. Right-click any cell containing obfuscated text.
2. Select **Forensic Decoders**:
   - **Base64 Decode (UTF-8)**: Standard Base64 decoding.
   - **Base64 Decode (UTF-16LE / PowerShell)**: Decodes Windows PowerShell `-EncodedCommand` strings.
   - **Hex / ASCII Decode**: Converts raw hexadecimal bytes into readable text.
   - **URL Decode**: Decodes percent-encoded URLs and web queries.
3. The decoded result displays in a preview modal and can be copied or filtered directly.

---

## 9. Hierarchical Pivot Tables & Column Management

- **Hierarchical Pivoting**: Group by multiple columns (e.g. `Computer` &rarr; `Channel` &rarr; `EventID`) with sub-second aggregations (`sum`, `avg`, `min`, `max`, `uniq`, count).
- **Non-Filtering Column Search**: Search columns by name with active highlighting without hiding unselected columns.
- **Multi-Column "Push to Top"**: Queue columns with `↑` (`↑ 1`, `↑ 2`, `↑ 3`) and click `▶` to push them to the leftmost columns of the grid.

---

## 10. Instant Smart Expand & Master-Detail Keyboard Triage (v1.3.9.1)

- **Instant 1-Click & Focus Expand**: Clicking or focusing on Column 0 (the `_expand` column) immediately opens the Event Details side inspector without requiring an extra <kbd>Enter</kbd> keystroke.
- **Strict Dismissal Rule**: Event Details only closes when you click the `✕` close button or press <kbd>Esc</kbd>. Selecting or re-clicking the same row maintains the detail panel safely open.
- **Continuous Arrow Key Triage (<kbd>&uarr;</kbd> / <kbd>&darr;</kbd>)**: When the Event Details inspector is open, pressing the Up or Down arrow keys smoothly updates the side inspector to display the details of the active row in real time without collapsing or closing the panel.
- **1-Click Filter Injection (`+` Button)**: In Event Details, click the `+` button on any field to append `col == value` directly into the active filter expression.

---

## 11. Keyboard Shortcuts Cheat Sheet

| Key Combination | Action |
| :--- | :--- |
| `Ctrl + O` | Open data file |
| `Ctrl + F` | Toggle Filter Builder drawer |
| `↑` / `↓` | Move selected row / Navigate Master-Detail event details |
| `Alt + ↑` / `Alt + ↓` | Move selected condition while focused inside an input |
| `Enter` | Apply filter query to table / Open Event Details |
| `Escape` | Close Event Details / Deselect condition / Close filter drawer |
| `Ctrl + R` | Open Regex Column Extraction dialog |
| `Ctrl + P` | Toggle Pivot sidebar |

---

*Toad v1.3.9.1 &bull; Built with DuckDB 1.0.0, Apache Parquet & Rust SIMD Core &bull; Portable Windows x64*
