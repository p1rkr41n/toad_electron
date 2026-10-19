# Toad Quick Start Guide (v1.3.6)

> **Toad** is a high-performance, lightweight, and modern desktop application designed for querying, exploring, and analyzing tabular data files of virtually any scale. Powered by **DuckDB** and an embedded **Rust SIMD Core**, Toad delivers instant columnar queries, compound filtering, hierarchical pivot tables, and forensic decoders over millions of records.

---

## 1. Quick Launch & Zero Installation

Toad is packaged as a completely self-contained portable Windows executable—no administrator privileges, installer wizards, or background services required.

- **Primary Portable Executable**: [`Toad.exe`](file:///D:/Shared_UserData/Downloads/tad/Toad.exe) (~92 MB)
- **Versioned Portable Release**: [`releases/toad_v1.3.6_portable.exe`](file:///D:/Shared_UserData/Downloads/tad/releases/toad_v1.3.6_portable.exe)

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
| **Apache Parquet** | `.parquet` | Native columnar scanning with zero conversion overhead |
| **Delimited Text** | `.csv`, `.tsv`, `.txt` | Multi-threaded streaming parser with automatic delimiter detection |
| **DuckDB Database** | `.duckdb` | Full SQL schema tree browsing and instant table views |
| **SQLite Database** | `.sqlite`, `.db` | Embedded relational table inspection |
| **Windows Event Logs** | `.evtx` | Rust-accelerated EVTX decoding into columnar records |
| **Raw Event Logs** | `.log` | Ingests unformatted log lines into a queryable `raw_event` column |
| **JSON / JSON Lines** | `.json`, `.jsonl`, `.ndjson` | Structured and semi-structured streaming ingestion |
| **Toad Workspaces** | `.tad` | Saves and restores entire pivot tables, filters, and layouts |

---

## 2. ArcSight ESM Query & Filter Architecture (New in v1.3.5)

The Filter Builder in Toad v1.3.5 has been redesigned following the enterprise ergonomics of **ArcSight ESM Query Search**, delivering maximum query density, dual view modes, multi-tag pill inputs, and instant performance statistics.

```
+---------------------------------------------------------------------------------------------------------+
| [Tree View | Raw SQL]   [x] Live update  | Selected: Channel  Keys: ↑ / ↓  |  [🗑 Clear] [▶ Apply] [✕ Close] |
+---------------------------------------------------------------------------------------------------------+
| [AND ⌵] Root Filter Block                                                                 [+] [📁]      |
|   |-- ⋮⋮ [ Channel      ] [ =       ] [ Microsoft-Windows-Sysmon/Operational ]                    [×]  |
|   `-- [OR ⌵] Subgroup Level 1                                                             [+] [📁] [×]  |
|         |-- ⋮⋮ [ EventID   ] [ IN (List)] [ [1 ×] [3 ×] [11 ×] + Type...       ]                    [×]  |
|         `-- ⋮⋮ [ RuleName  ] [ contains ] [ Suspicious NetCon                 ]                    [×]  |
+---------------------------------------------------------------------------------------------------------+
| SQL: WHERE "Channel" = '...' AND ("EventID" IN (1, 3, 11))  [Copy] | Matched: 565 / 24,510 | Latency: 1.2ms|
+---------------------------------------------------------------------------------------------------------+
```

### Key Highlights:
1. **Dual View Modes ("Tree View" ⇄ "Raw SQL")**:
   - Toggle seamlessly between the visual block builder and direct raw SQL editing.
   - In **Raw SQL** mode, edit complex `WHERE` predicates directly with DuckDB syntax support.
   - Switching modes preserves and synchronizes active queries bidirectionally.

2. **Multi-Tag Pill Inputs (`IN` / `NOT IN`)**:
   - Selecting `IN` or `NOT IN` activates responsive multi-tag pills.
   - Type or paste values (e.g. `1, 3, 11, 4624`), press `Enter` or `,`, and values instantly format into individual tag badges.
   - Automatic numeric casting ensures integer column queries match DuckDB columnar types without type coercion errors.
   - Press `Backspace` on empty input to quickly delete the preceding pill.

3. **1-Click SQL Copy**:
   - Click the **[Copy]** button directly in the preview bar to copy the exact `WHERE ...` predicate to your clipboard.

4. **Live Query Statistics & Performance Latency**:
   - Real-time matched row count (`Matched: X / Y rows`) and execution latency (`Latency: Z ms`) displayed directly in the filter status bar.

5. **Integrated Group Header Actions & Clean Labels**:
   - `+ Condition` (`+`) and `+ Subgroup` (`📁`) icon buttons are integrated directly into the group header, eliminating wasted vertical space.
   - Concise logical operators (`AND` / `OR`) and clean block labels (`Root Filter Block`, `Subgroup Level N`).
   - Clean subgroup headers with zero lingering arrow buttons.

6. **Sequential Keyboard Navigation (`↑` / `↓`)**:
   - Click any condition row to select it (docked in the top status bar).
   - Use `↑` / `↓` keys to step conditions sequentially through parent and nested groups.
   - Use `Alt+↑` / `Alt+↓` while editing input values.

---

## 3. Dracula Theme & Theme Switcher (New in v1.3.6)

Toad v1.3.6 introduces a built-in **Dracula Theme** designed specifically for prolonged analysis and low-light environments without jarring pitch-black contrast:

- **120° Soft Inversion Palette**: Rather than pure `#000000` pitch black, Toad uses an 88% inversion rotated 120 degrees (`invert(0.88) hue-rotate(120deg) contrast(1.02)`), shifting stark white backgrounds to a soft, eye-friendly Dracula slate (`#24262b`) with emerald/cyan accent highlights (`#50fa7b` / `#8be9fd`).
- **Instant 1-Click Toggle**: Switch between **Light** and **Dracula** modes instantly using the theme toggle button docked at the bottom of the left vertical **Activity Bar** (`[🌙 / ⚡]`).
- **Auto-Persistence**: Your chosen theme preference is automatically remembered across app restarts via local storage.

---

## 4. Fast Right-Click Context Menu & Type-Aware Filter Guard

You don't even have to open the Filter Builder to construct complex queries. Right-click any cell in the main data grid to filter instantly:

- **Exact Match (`=`)**: Right-click &rarr; **Filter this value (`=`)**.
- **Exclude (`!=`)**: Right-click &rarr; **Filter out this value (`!=`)**.
- **Numeric & Timestamp Range (`>`, `<`, `>=`, `<=`)**: Type-aware filters for integers, floats, and dates.
- **Text Pattern Matching (`contains`, `ilike`, `starts with`)**: Case-insensitive substring matching.
- **Time Bracket Filtering (`±5m`, `±15m`, `±1h`)**: Right-click any timestamp to instantly isolate surrounding events during incident investigation.
- **Bidirectional Sync**: Rules created from the right-click context menu automatically appear inside the Filter Builder for reordering and subgroup nesting.

---

## 5. Built-In Forensic Decoders

For DFIR analysts and security engineers examining encoded commands or obfuscated payloads:

1. Right-click any cell containing obfuscated text (e.g. PowerShell Base64 or Hex).
2. Select **Forensic Decoders**:
   - **Base64 Decode (UTF-8)**: Standard Base64 decoding.
   - **Base64 Decode (UTF-16LE / PowerShell)**: Automatically handles Windows PowerShell `-EncodedCommand` Unicode strings.
   - **Hex / ASCII Decode**: Converts raw hexadecimal bytes into readable ASCII text.
   - **URL Decode**: Decodes percent-encoded URLs and web queries.
3. The decoded string appears directly in the preview dialog and can be copied or filtered instantly.

---

## 6. Hierarchical Pivot Tables & Column Management

Toad transforms massive flat datasets into multi-level tree tables in sub-second time:

1. Click the **Pivot Table** icon on the left ActivityBar.
2. Check the box under **Pivot** next to any columns you wish to group by (e.g., `Computer`, then `Channel`, then `EventID`).
3. Under **Aggr**, select aggregate functions (`sum`, `avg`, `min`, `max`, `uniq`, or row counts) for metrics.
4. **Non-Filtering Column Search**: Type in the column search box to jump directly to any column with active highlight—without hiding any other columns!
5. **Multi-Column "Push to Top"**: Click the `↑` icon on column rows to queue them (`↑ 1`, `↑ 2`, `↑ 3`). Click **Play** (`▶`) to place them at the very beginning of the table in your exact clicked sequence.
6. **In-Place Column Renaming**: Double-click any column header to rename it on the fly.

---

## 7. Regex Column Extraction & Row Detail Inspection

- **Regex Column Extraction**: Click **Regex** in the bottom toolbar (or press `Ctrl+R`) to extract structured fields using regular expressions. Named capture groups (e.g. `(?<ip>\d+\.\d+\.\d+\.\d+)`) automatically become new virtual columns appended to your table.
- **Row Event Inspection**: Select any row in the table to view all its fields and multi-line contents in the right-hand **Event Details** sidebar. Right-click any value in Event Details to immediately add it as a filter condition.

---

## 8. Keyboard Shortcuts Cheat Sheet

| Key Combination | Action |
| :--- | :--- |
| `Ctrl + O` | Open data file |
| `Ctrl + F` | Toggle Filter Builder drawer |
| `↑` / `↓` | Move selected filter condition sequentially (jumping into/out of subgroups) |
| `Alt + ↑` / `Alt + ↓` | Move selected condition while focused inside an input |
| `Enter` | Apply filter query to table |
| `Escape` | Deselect active filter condition / Close filter drawer |
| `Ctrl + R` | Open Regex Column Extraction dialog |
| `Ctrl + P` | Toggle Pivot sidebar |

---

*Toad v1.3.6 &bull; Built with DuckDB & Rust SIMD Core &bull; Portable Windows x64*
