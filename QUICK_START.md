# Toad Quick Start Guide (v1.3.7.1)

> **Toad** is a high-performance, lightweight, and modern desktop application designed for querying, exploring, and analyzing tabular data and log files of virtually any scale (including **Big Data 40GB+ / 60,000,000+ records**). Powered by **DuckDB 1.0.0**, native **Apache Parquet**, and an embedded **Rust SIMD Core**, Toad delivers sub-second pivot tables, compound filtering with ArcSight ESM ergonomics, visual streaming ingestion progress, $O(1)$ instant row counting, automatic chronological time sorting, background distinct filter caching, Dracula dark mode, and a deterministic **1,000-row pagination engine with a 5-page sliding buffer**.

---

## 1. Quick Launch & Zero Installation

Toad is packaged as a completely self-contained portable Windows executable—no administrator privileges, installer wizards, or background services required.

- **Primary Portable Executable**: [`Toad.exe`](file:///D:/Shared_UserData/Downloads/tad/Toad.exe) (~92 MB)
- **Versioned Portable Release**: [`releases/toad_v1.3.7.1_portable.exe`](file:///D:/Shared_UserData/Downloads/tad/releases/toad_v1.3.7.1_portable.exe)

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

## 2. Big Data 40GB+ Ingestion & Instant $O(1)$ Row Count (New in v1.3.7)

Opening large files (such as 40GB CSVs with 60+ million rows) in traditional viewers causes out-of-memory crashes and freezes. Toad v1.3.7 introduces a dedicated Big Data subsystem:

### 2.1 100% Parquet Native Engine & Visual Ingestion Progress Dialog
- **Zero Raw CSV Rendering**: Toad streams all raw CSV and JSON files directly into compressed Snappy Parquet files on disk inside the portable temporary workspace (`toadAppData_*`).
- **Live Progress Dialog**: When loading large files, Toad presents a non-blocking modal dialog showing:
  - **Live Conversion Percentage** (`%`)
  - **Streaming Throughput Speed** (`MB/s`)
  - **Estimated Time Remaining (ETA)**
  - **Cancel Button**: Safely stops ingestion immediately without leaving lingering background processes.

### 2.2 Instant $O(1)$ Parquet Metadata Row Count (~25ms)
- **The Problem**: Executing `SELECT count(*)` on a 40GB dataset takes 15 to 30 seconds of pure table scanning before anything can render.
- **The Toad Solution**: Toad v1.3.7 extracts row counts directly from the Apache Parquet file metadata (`SELECT SUM(row_group_num_rows) FROM parquet_metadata(...)`).
- **Result**: Row count completes in **~25 milliseconds** ($O(1)$ constant time), cached in `_toadTableRowCountCache` for instant UI initialization.

---

## 3. Deterministic 1,000-Row Pagination Engine & 5-Page Sliding Buffer (New in v1.3.7)

Toad v1.3.7 replaces unbounded infinite scrolling with a predictable, high-performance pagination engine designed specifically for massive datasets:

```
+---------------------------------------------------------------------------------------------------------+
| [|< First]  [< Prev]   Page [ 1 ] of 60,000   [Next >]  [Last >|]    Showing 1 - 1,000 of 60,000,000 rows |
+---------------------------------------------------------------------------------------------------------+
```

### 3.1 Strict 1,000 Rows Per Page
- Renders exactly 1,000 rows per page view in the SlickGrid viewport.
- Eliminates browser stutter, DOM thrashing, and viewport jumping during rapid scrolling.

### 3.2 5-Page Sliding Buffer ($[P-2 .. P+2]$, Max 5,000 Rows in RAM)
- When viewing Page $P$, Toad maintains a sliding memory window from Page $[P-2]$ to Page $[P+2]$ (5 pages = 5,000 rows max).
- **Instant 0ms Page Flipping**: Clicking `Next` or `Prev` switches pages immediately from RAM without dispatching a new DuckDB query.
- Strict memory capping guarantees Toad never consumes excessive memory, even on 100-million-row datasets.

### 3.3 Bottom Pagination Toolbar & Direct Jump
- **Direct Page Jump**: Type any page number into the `Page [ n ]` box and press `Enter` to jump instantly.
- **Navigation Buttons**: `[|< First]`, `[< Prev]`, `[Next >]`, `[Last >|]`.
- **Status Summary**: `Showing 1 - 1,000 of 60,000,000 rows (Page 1 of 60,000)`.

---

## 4. Intelligent Auto Time-Column Sort & Fallback (New in v1.3.7)

In security and operational log analysis, chronological ordering is essential:

- **Automatic Time Column Detection**: Toad automatically scans the dataset schema and prioritizes the closest timestamp column in this order:
  $$\text{EventTime} \succ \text{Timestamp} \succ \text{TimeCreated} \succ \text{Time} \succ \text{Date}$$
- **Default DESC Order**: The detected time column is sorted descending (`DESC`) automatically, ensuring the most recent events appear first.
- **Resource-Saving Fallback**: If **no time column exists** in the dataset, Toad **completely skips sorting** to conserve CPU and RAM.

---

## 5. Enterprise ArcSight ESM Query Builder & Search Accuracy (Enhanced in v1.3.7)

The Filter Builder delivers enterprise query ergonomics, dual view modes, multi-tag pill inputs, and bulletproof character escaping:

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

### 5.1 Bulletproof Search Escaping (Windows Paths & Wildcards)
- In v1.3.7, all string operators (`contains`, `not_contains`, `starts_with`, `ends_with`, `equals`) automatically escape Windows backslashes `\`, percent signs `%`, and underscores `_` with explicit `ESCAPE '\'` SQL clauses.
- Searching paths like `C:\Windows\System32\cmd.exe` or patterns with `_` and `%` now yields 100% accurate results.

### 5.2 Background Distinct Cache Autocomplete (Chunk 50k & Early Cutoff $\ge 1,024$)
- Dropdown value suggestions are populated in the background in chunks of 50,000 rows.
- **Cardinality Protection**: If the accumulated distinct values reach or exceed **1,024 values**, scanning terminates immediately to prevent RAM exhaustion on high-cardinality fields (hashes, GUIDs, full paths).

### 5.3 Dual View Modes ("Tree View" ⇄ "Raw SQL")
- Toggle between visual nested block building and direct raw DuckDB SQL `WHERE` expressions.

### 5.4 Multi-Tag Pill Inputs (`IN` / `NOT IN`)
- Type or paste values (e.g. `1, 3, 11, 4624`), press `Enter` or `,`, and values format into individual tag badges with automatic numeric casting.

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

## 10. Regex Column Extraction & Row Event Inspection

- **Regex Column Extraction (`Ctrl+R`)**: Extract structured fields into new virtual columns using named regex groups (e.g. `(?<ip>\d+\.\d+\.\d+\.\d+)`).
- **Row Event Inspection**: Click any row to inspect all fields and multi-line message payloads in the right-hand **Event Details** sidebar.

---

## 11. Keyboard Shortcuts Cheat Sheet

| Key Combination | Action |
| :--- | :--- |
| `Ctrl + O` | Open data file |
| `Ctrl + F` | Toggle Filter Builder drawer |
| `↑` / `↓` | Move selected filter condition sequentially across subgroups |
| `Alt + ↑` / `Alt + ↓` | Move selected condition while focused inside an input |
| `Enter` | Apply filter query to table |
| `Escape` | Deselect active condition / Close filter drawer |
| `Ctrl + R` | Open Regex Column Extraction dialog |
| `Ctrl + P` | Toggle Pivot sidebar |

---

*Toad v1.3.7 &bull; Built with DuckDB 1.0.0, Apache Parquet & Rust SIMD Core &bull; Portable Windows x64*
