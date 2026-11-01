# TOAD CHANGELOG & VERSION HISTORY
> Complete chronological release history of Toad.

---

## [2.1.6] - 2026-11-01 (Final Stable Electron Release)
### Performance & Packaging
- **Dead Code Elimination**: Pruned dead BigQuery dependencies (`@google-cloud/bigquery`, `reltab-bigquery`) from `tad-app/package.json` and `main.ts`.
- **Production Sourcemap Elimination**: Disabled production webpack sourcemap generation (`devtool: false`), stripping ~28.4 MB of `.map` files from `app.asar`.
- **Asset De-duplication**: Removed duplicate `toad-core.exe` and `AppIcon1024.png` from packaging source paths.
- **Binary Footprint Optimization**: Reduced portable executable from 96.9 MB to **72.06 MB** (within the < 75 MB target budget).
- **QA Verification**: Achieved 100% pass rate across 133 integration test cases (Suites A through BB).

---

## [2.1.5] - 2026-11-01
- **Packaging Pipeline**: Multi-tier packaging filter rules in `dist_package.ps1`.
- **Addon Dynamic Linking**: Hardened native `duckdb.node` external addon loading via `app.asar.unpacked`.
- **Lodash Preservation**: Ensured critical lodash runtime modules are retained during packaging prune passes.

---

## [2.1.4] - 2026-10-31
- **Delimited Parsing Engine**: Added W3C / IIS log auto-detection for space and tab delimiters.
- **Candidate Discovery**: Dynamic fill-rate measurement without hardcoded column fill percentages.
- **Auto-Pruned Unmatched Columns**: Added `unmatched_raw_event` column pruning when tables match 100% cleanly.

---

## [2.1.3] - 2026-10-31
- **Discovered Fields Indicator**: Added space delimiter symbol indicator (`␣`) in column extraction UI.
- **Positional Extraction**: Positional token extraction in DuckDB without list filter shifting bugs.
- **Sticky Table Header**: Header persistence during horizontal and vertical scrolling in Discovered Fields modal.

---

## [2.1.2] - 2026-10-31
- **Material 3 Slate Theme**: Introduced ergonomic slate dark palette (`#1E222B`, `#161920`, `#2E3440`).
- **Subtle Grid Lines**: Eliminated harsh grid line borders in SlickGrid.
- **Expand Column Synchronization**: Synchronized row chevron `_expand` selection with full row selection state.
- **Theme Isolation**: Isolated default theme from OS `prefers-color-scheme` via `toad-theme-v2` storage key.

---

## [2.1.1] - 2026-10-31
- **Native Dialog Dark Mode**: Full M3 tokenization for `RegexDialog.tsx` and modal footers.
- **WCAG AAA Compliance**: Mathematical contrast verification $\ge 7.0:1$ across all text elements.

---

## [2.1.0] - 2026-10-31
- **Locales Pruning**: Stripped unused Electron chromium locales (`zh-CN`, `ru`, `de`, `es`), saving ~10 MB.
- **Default Light Mode**: Established isolated light mode default baseline.

---

## [2.0.3] - 2026-10-30
- **Vectorized Column Extractor**: Implemented DuckDB CTE `split_log` for multi-format log preambles.
- **Quote Pair Enclosure**: Resilient quote parsing preventing delimiter splitting inside quotes.
- **TRY_CAST Inline Engine**: Safe per-column inline type coercion fallback.

---

## [2.0.2] - 2026-10-29
- **Multi-Format Extractor**: Added Simple and Advanced modes (JSON Object, JSON Array by index, Key-Value pairs, CSV, and Regex).
- **Custom Column Naming**: Vietnamese and UTF-8 custom column naming with collision prevention via `* EXCLUDE`.

---

## [2.0.1] - 2026-10-29
- **RAM First-Page Micro-Cache**: Micro-cache delivering the first 1,000 rows in $< 0.02\text{ ms}$.
- **Libuv Auto-Calculation**: Dynamic calculation of `UV_THREADPOOL_SIZE` bounded in $[8, 128]$.

---

## [2.0.0] - 2026-10-29
- **Dual DuckDB Engine**: Architectural separation into `uiDbc` (interactive) and `ingestDbc` (background).
- **Zero UI Query Blocking**: Achieved p99 query latency $< 50\text{ ms}$ under heavy background COPY loads.

---

## [1.3.8 - 1.3.19] - 2026-10-28
- **Multiple File Ingestion**: In-Canvas progress tracking with Shortest Job First (SJF) queue sorting.
- **VIP User-Click Priority**: Priority jumping for clicked files.
- **Adaptive Memory Guard**: 70% RAM limits and dynamic concurrent file budgeting.
- **Forensic Decoders**: Base64 UTF-16LE, URL decode, and defanger.
- **Omnisearch**: Full-dataset IoC search across all columns.

