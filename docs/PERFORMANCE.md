# TOAD PERFORMANCE & OPTIMIZATION GUIDE
> **Product:** Toad - Log & Forensic Data Analysis Platform  
> **Target Release:** v2.1.6  
> **Status:** Production Benchmark & Engineering Reference  

---

## 1. Footprint & Packaging Optimization

Between Toad v2.1.4 and v2.1.6, a systematic footprint reduction campaign reduced the portable distribution executable by **~22%** and purged over **21,000 redundant files** from the distribution archive without impacting runtime functionality.

### 1.1. Benchmark Metrics

| Metric | v2.1.4 Baseline | v2.1.6 Release | Net Improvement |
| :--- | :---: | :---: | :---: |
| **Portable Binary (`Toad.exe`)** | 96.9 MB | **72.06 MB** | **-24.84 MB (-25.6%)** |
| **Packaged Files (`app.asar`)** | 27,005 files | **6,016 files** | **-20,989 files (-77.7%)** |
| **Source Maps (`.map`)** | ~28.4 MB | **0 MB (Eliminated)** | **-100%** |
| **BigQuery Dependency Remnants** | Present | **Purged** | **Zero dead weight** |
| **Cold Start Startup Time** | 2.2 - 2.8s | **~1.3 - 1.5s** | **~40% faster** |

### 1.2. Optimization Levers Applied
1. **Dead Code Elimination (DCE)**: Completely pruned `@google-cloud/bigquery` and `reltab-bigquery` from runtime dependencies.
2. **Production Sourcemap Stripping**: Configured `webpack.config.js` with `devtool: false` in production mode to eliminate `.js.map` bloat.
3. **Packaging Whitelist Filters**: Refined `electron-builder` configuration in `tad-app/package.json` to filter out build artifacts, documentation, test fixtures, and duplicate icon assets (`AppIcon1024.png`).
4. **Binary De-duplication**: Eliminated duplicate copies of `toad-core.exe` across development paths, retaining only the single canonical binary in `bin/`.

---

## 2. Runtime Concurrency & Thread Budgeting

Toad runs on machines ranging from 4-core laptops to 64-core SOC analysis workstations. Threading and memory are budgeted dynamically.

### 2.1. CPU Thread Allocation Formula
The thread allocation dynamically reserves dedicated CPU capacity for UI responsiveness:
$$\text{Threads}_{\text{Ingest}} = \max\left(1, \text{totalCpus} - 2\right)$$
$$\text{Threads}_{\text{UI}} = 2$$

- **Automatic Thread Isolation**: When `duckdb.background_threads = auto` in `config.ini`, the background ingestion worker is clamped so at least 1-2 physical cores are always dedicated to the UI event loop and renderer.
- **Libuv Worker Pool**: `UV_THREADPOOL_SIZE` is automatically set to $\min(128, \max(8, \text{totalCpus} \times 2))$ to prevent Node.js file system operations from stalling under heavy multi-file concurrency.

### 2.2. Memory Budgeting & Adaptive Guard
- In `config.ini`, `max_memory = auto` queries available system RAM and clamps DuckDB's internal buffer pool to $70\%$ of available physical RAM.
- **Dynamic File Budget**: `max_concurrent_gb = 1.0` and `max_concurrent_files = 4` prevent concurrent ingestion jobs from causing OOM crashes when processing large log dumps.
- **Exclusive Large File Mode**: Files larger than $1.0\text{ GB}$ automatically claim exclusive ingestion priority to prevent heap thrashing.

---

## 3. Micro-Cache & Latency Benchmarks

### 3.1. RAM First-Page Micro-Cache
For newly opened views, the first 1,000 rows are immediately retained in an in-memory ring cache:
- **Cache Hit Latency**: $\approx 0.015\text{ ms}$ (zero disk I/O).
- **Parquet Cache Hit UI Mount**: $< 15\text{ ms}$ (Branch 1 instant mount).

### 3.2. Concurrency Under Heavy Ingest (Suite C Benchmark)
During stress tests running 4 concurrent ingestion workers streaming CSV/JSONL:
- **p50 UI Query Latency**: $38.10\text{ ms}$
- **p95 UI Query Latency**: $47.33\text{ ms}$
- **p99 UI Query Latency**: $47.33\text{ ms}$ (well within the $\le 50\text{ ms}$ SLA).
- **ConnectionPool Leaks**: Zero detected across 10,000 repeated query cycles.

---

## 4. Key Engineering Lessons Learned (Post-Mortem Reference)

1. **Never read `getLength` on null models during state transitions**:
   - *Problem*: In v1.3.12, rapid clicks on loading views caused `DataGrid.tsx` to call `.getLength()` on a view that had not finished mounting, triggering a fatal renderer crash.
   - *Fix*: Implemented strict null-guarding and state superseding in `MultipleLoadingManager`.
2. **Prevent 0% In-Canvas Loading Stalls on Completed Files**:
   - *Problem*: Clicking a file that had already completed background conversion displayed a frozen "Loading... 0%" overlay because the completion event was not synchronized with the active view pointer.
   - *Fix*: Created dual-branch resolution: If `isCacheReady(path)` is true, immediately mount the view without triggering a loading state.
3. **DuckDB Dynamic Linking Integrity**:
   - `duckdb.node` must remain unpacked outside `app.asar` in `app.asar.unpacked` to ensure the OS native dynamic linker (`LoadLibraryA`) can load DuckDB native symbols without extraction errors.
