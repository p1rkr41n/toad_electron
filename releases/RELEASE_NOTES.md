# Toad v2.6.0.5: Laptop Filter Optimization, DuckDB Resource Governance & Event Detail Freeze Fix

**Release Date:** 2026-11-20  
**Publisher:** HelloKittyXamKinLung Standard  
**Binary Output:** `Toad-2.6.0.5-x64-portable.exe` (92.89 MB) / `Toad-2.6.0.5-x64-portable.zip` (92.90 MB)  

---

### Key Highlights & Summary

TOAD v2.6.0.5 eliminates UI freezes when inspecting filtered events on ultra-wide datasets (1,600+ columns, multi-GB scale) and substantially lowers RAM/CPU pressure during interactive filtering on laptops while preserving exact filtered row counts (`COUNT(*)`).

#### 1. Event Detail Freeze Elimination & Fast Payload Inspection
- **Eliminated `fetchFullRow` Re-Query Loop:** Replaced the inline `fetchFullRow` prop in `AppPane` with a stable callback, deterministic `eventDetailFetchKey`, and `lastFetchedKeyRef` guard in `EventDetailSidebar` so layout resizes and viewport updates never re-trigger `SELECT *` full-table scans.
- **20-Row LRU Detail Cache & Direct Record Lookup:** Added an in-memory 20-row LRU cache for instant switching between inspected events and a direct `__lp_record_id` lookup fast path when available.
- **O(1) Text Measurement & Cached Forensic Decoding:** Replaced O(N) per-character `ctx.measureText` loops in `CellLineCalculator` with O(1) bounded line estimation and early exit at 22 lines; memoized `detectForensicCapabilities` per filtered field list and cached `TextDecoder` instances in `ForensicDecoder` (50 KB `raw_log` inspection reduced to `< 3 ms`).

#### 2. DuckDB Interactive UI Engine Resource Governance
- **Laptop-Safe RAM & CPU Budget:** Wired `applyEngineConfig(db, false)` into `duckdbDataSourceProvider.connect()` (`reltab-duckdb`), capping interactive UI DuckDB memory at 25% of system RAM (up to 4 GB), limiting UI threads to `<= 2`, and disabling `preserve_insertion_order` to prevent RAM contention and swapping with Electron/Chromium on laptops.

#### 3. Faster Filtering, Projected `COUNT(*)` & Query Coalescing
- **Projected Exact `COUNT(*)`:** Kept exact `COUNT(*)` for every filter while pushing column projection (`referencedColumns()`) into `fastFilterRowCount` so DuckDB only scans columns referenced in `WHERE` predicates instead of all 1,600+ columns.
- **Deduplicated Queries & Coalescing:** Eliminated duplicate `sendDataRequest` firing in `PivotRequester` and added `querySeq`/`dataSeq` generation counters to discard stale in-flight filter results when modifying filters rapidly.
- **Lightweight Slash Normalization:** Replaced `REGEXP_REPLACE(..., '[\\/]+', '/', 'g')` with `REPLACE(..., '\', '/')` in `FilterExp` for DuckDB, preserving cross-platform `/` and `\` path matching without per-row regex overhead.

#### 4. Virtualized Filter Column Picker & Lazy Value Suggestions
- **Pure-React Virtualized Column Dropdown:** Memoized `colOptions` once in `FilterEditor`, memoized `FilterEditorRow`, and added a virtualized `MenuList` for `react-select` so 1,600+ column dropdowns only mount ~20 visible DOM nodes.
- **Lazy `DISTINCT` Loading & Live Update Debounce:** Deferred `getOrLoadDistinctValues` until the user focuses the Value input (eliminating background `SELECT DISTINCT` I/O spikes when selecting columns) and added a `180 ms` debounce for `Live update` mode in `Footer`.

---

### Integrity & Verification

| Asset | Size | SHA-256 Checksum |
| :--- | :---: | :--- |
| `Toad-2.6.0.5-x64-portable.exe` | 92.89 MB (97,404,193 bytes) | `310888423d2af3a7b6b7d3d1bde40cc284a8ed94307057e9d79ebfb16e6bd248` |
| `Toad-2.6.0.5-x64-portable.zip` | 92.90 MB (97,413,609 bytes) | `9f9aa4d8c25abd5f25c662773803eb2e7e73786ae83ace117d83136ef2593ef9` |
