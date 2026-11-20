# Toad v2.6.0.4: Ultra-Wide CSV Performance, Persistent LRU Cache & General Tab Freeze Fix

**Release Date:** 2026-11-20  
**Publisher:** HelloKittyXamKinLung Standard  
**Binary Output:** `Toad-2.6.0.4-x64-portable.exe` (92.91 MB) / `Toad-2.6.0.4-x64-portable.zip` (92.92 MB)  

---

### Key Highlights & Summary

TOAD v2.6.0.4 resolves major performance bottlenecks and UI freeze conditions when analyzing ultra-wide, sparse CSV/log datasets (1,600+ columns, multi-GB scale) while keeping 100% lossless column fidelity and hardened v2.6.0 security posture.

#### 1. Fast Ultra-Wide CSV Ingestion, UTF-8 BOM Fix & Persistent 10 GB LRU Cache
- **Persistent Parquet Cache with 10 GB LRU Cap:** Changed default `temp_cleanup` from `true` to `false` and added `max_cache_gb = 10` in `config.ini` so converted Parquet caches persist across restarts instead of being deleted on exit. Automatic LRU eviction cleans up the oldest cached `.parquet` files when the cap is exceeded while protecting active files and ledger metadata.
- **Adaptive Ultra-Wide Parquet Tuning:** Added a sub-millisecond 64 KB CSV header probe to detect wide schemas (`> 200` columns) and UTF-8 BOM headers, dynamically tuning `ROW_GROUP_SIZE` (`>= 122880`) and `sample_size` (`2048`) while fixing DuckDB `Binder Error` fallback loops in header-detection tiers.
- **UTF-8 BOM Column Name Stripping:** `createViewFromParquet()` now detects and strips leading `\uFEFF` BOM bytes from column 0 via SQL projection, fixing `undefined` display on first columns such as `__lp_rule`.

#### 2. SQL Projection Pushdown & Conditional Auto-Sort
- **SQL Projection Pushdown:** Non-pivoted grid queries and RAM first-page pre-warming now push `.project(...)` down to DuckDB so only active `displayColumns` (~100 columns) and sort keys are scanned instead of `SELECT *` across all 1,600+ columns.
- **Conditional Auto-Sort (`<= 360` Columns):** Implicit descending timestamp auto-sort is skipped on ultra-wide tables (`> 360` columns) to prevent full-table sort stalls, while remaining enabled for standard tables (`<= 360` columns).

#### 3. IPC Resilience & 100-Row Freeze Recovery
- **Fixed `DataCloneError` in Engine RPC:** Converted `reltab.TableRep` instances to plain structured-cloneable DTOs in `engineService.ts` before `parentPort.postMessage`.
- **Timeout & Duplicate Query Storm Prevention:** Raised `MessagePort` binary query timeout from `30s` to `120s` and eliminated redundant IPC fallback queries on `MessagePort timeout`.
- **Automatic Recovery & Retry Toast:** `PivotRequester` now resets `pendingDataRequest`, `pendingOffset`, and `pendingLimit` on query errors and surfaces a warning Toast with a **Retry** action instead of freezing at row 100.

#### 4. UI Virtualization & On-Demand Event Detail
- **Virtualized Column Manager:** Replaced O(N×M) array lookups with `Set`/`Map` structures and added pure-React table row windowing (`> 120` columns) in `ColumnSelector`, memoized `SingleColumnSelect`, lazy-mounted `PivotSidebar` tabs, and scoped `DataGrid` width measurement to displayed columns only.
- **On-Demand Single-Row Event Detail:** `EventDetailSidebar` now fetches all columns on demand for the single selected row (`LIMIT 1 OFFSET N`) and hides empty/NULL fields by default on wide schemas (`> 50` columns) with a toggle to show all fields.

---

### Integrity & Verification

| Asset | Size | SHA-256 Checksum |
| :--- | :---: | :--- |
| `Toad-2.6.0.4-x64-portable.exe` | 92.91 MB (97,423,277 bytes) | `2fa49a41e60538382a0f5ea2e72b01ab1f7c9e90e9fcef38605fe308432023df` |
| `Toad-2.6.0.4-x64-portable.zip` | 92.92 MB (97,432,626 bytes) | `6351ceafb9448ebe9f06e136708d46b0fec74ee8caaa70e4a5e05850c155b5af` |
