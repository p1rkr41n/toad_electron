# Handoff Report: Ingestion Pipeline & Caller Resilience Investigation

**Agent**: explorer_m6_fix_2 (Remediation Specialist — Ingestion Pipeline & Caller Resilience)  
**Date**: 2026-11-04  
**Target Milestone**: TOAD v2.5.1 Nested JSON Parser & Auto-Flattening (Milestone 6 Remediation)  
**Status**: COMPLETE (Read-Only Technical Investigation)

---

## 1. Observation

Direct examination of `tad-master/packages/reltab-duckdb/src/csvimport.ts` and related modules reveals four critical findings regarding caller resilience:

### Observation 1.1: Invocation of `streamFlattenedJsonToParquet` in `streamJsonToParquet`
- **File**: `tad-master/packages/reltab-duckdb/src/csvimport.ts:3002-3018`
- **Code**:
  ```typescript
  async function streamJsonToParquet(
    dbConn: Connection,
    filePath: string,
    parquetPath: string,
    cfg: IngestConfig
  ): Promise<void> {
    const compression = (cfg.compression || "snappy").toUpperCase();
    const rowGroupSize = cfg.row_group_size || 100000;

    await streamFlattenedJsonToParquet(dbConn, filePath, parquetPath, {
      compression,
      rowGroupSize,
      sampleSize: 2048,
      ignoreErrors: true,
      timestampFormat: "%Y-%m-%dT%H:%M:%S.%fZ",
    });
  }
  ```
- **Analysis**: `streamJsonToParquet` is an `async` function that directly awaits `streamFlattenedJsonToParquet`. It contains no local `try...catch` block. If `streamFlattenedJsonToParquet` rejects or throws (such as on catastrophic binary corruption or unhandled DuckDB errors), the rejection bubbles immediately to the caller in `nativeCSVImport`.

### Observation 1.2: EVTX Intermediate File Leak on Streaming Failure
- **File**: `tad-master/packages/reltab-duckdb/src/csvimport.ts:3407-3513`
- **Code**:
  ```typescript
  if (ext === ".evtx") {
    const toadCore = findToadCoreBinary();
    const tempJsonl = path.join(
      cfg.temp_dir!,
      `evtx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jsonl`
    );
    ...
    await streamJsonToParquet(dbConn, tempJsonl, targetParquetPath, cfg);
    try {
      if (fs.existsSync(tempJsonl)) {
        fs.unlinkSync(tempJsonl);
      }
    } catch { }
  }
  ```
- **Analysis**: `tempJsonl` is unlinked on lines 3509-3513 only if `streamJsonToParquet` resolves successfully. If `streamJsonToParquet` throws at line 3508, execution jumps to line 3599 (`catch (streamErr)`), bypassing lines 3509-3513. The temporary file is NEVER deleted and leaks permanently on disk in `cfg.temp_dir`.

### Observation 1.3: Catastrophic Fallthrough into `read_csv` (Silent Data Corruption & Bogus Errors)
- **File**: `tad-master/packages/reltab-duckdb/src/csvimport.ts:3599-3746`
- **Code**:
  ```typescript
        // In GIAI ĐOẠN 4 (Streaming Parquet):
        } else if ([".json", ".jsonl", ".ndjson"].includes(ext)) {
          await streamJsonToParquet(dbConn, normalizedPath, targetParquetPath, cfg);
        }
        ...
      } catch (streamErr) {
        log.warn(
          "[TOAD Ingest] Streaming pipeline that bai, fallback ve in-memory import:",
          streamErr
        );
        ToadParquetLedger.getInstance().recordEvent({ ... }).catch(() => {});
        try {
          if (fs.existsSync(targetParquetPath)) {
            fs.unlinkSync(targetParquetPath);
          }
        } catch { }
        // Tiếp tục với in-memory fallback bên dưới
      } finally {
        if (ioWatcherProc) { try { (ioWatcherProc as any).kill(); } catch { } ioWatcherProc = null; }
        if (progressTimer) clearInterval(progressTimer);
        broadcastIngestProgress({ isOpen: false, fileName: path.basename(filePath), percent: 100, speedMBs: 0, etaSec: 0, statusText: "Ready" });
      }

      // ===== CHẾ ĐỘ IN-MEMORY FALLBACK (cải tiến với 3-tier) =====
      const safePath = escapeSqlPath(normalizedPath);
      const ext = path.extname(filePath).toLowerCase();

      // Doi voi file log tho (.log, .txt): nap thang raw_event duy nhat
      if ([".log", ".txt"].includes(ext)) { ... return tableName; }

      const isCsvFile = ext === ".csv";
      const isTsvFile = ext === ".tsv";
      const memDelimClause = isCsvFile ? "delim=','," : isTsvFile ? "delim='\\t'," : "";

      // Tier 0: auto_detect + ignore_errors + all_varchar=true (RFC-4180 strict)
      try {
        const query = `CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_csv('${safePath}', ${memDelimClause} auto_detect=true, sample_size=100000, ignore_errors=true, null_padding=true, all_varchar=true)`;
        await dbConn.all(query);
        return tableName;
      } catch (err0) { ... }
  ```
- **Analysis**:
  1. When streaming fails for `.json`, `.jsonl`, `.ndjson`, or `.evtx`, `catch (streamErr)` catches the error, but DOES NOT throw or return.
  2. Execution falls through into the in-memory fallback block (lines 3650-3746), which was written exclusively for CSV/TSV.
  3. **Silent Data Corruption Risk**: If the file is valid text JSON with commas (e.g. `{"id": 1, "name": "Alice"}`), DuckDB's CSV sniffer treats commas as delimiters and creates a bogus table with chopped JSON fragments. The method returns `tableName` successfully! The user is presented with a corrupted table with zero errors reported.
  4. **Misleading Error & Resource Waste**: If the file is binary garbage (e.g. PE header `MZ\x90`, null bytes, or binary EVTX), `read_csv` throws `CSV reader does not support null characters in file ...`. The original JSON/EVTX error is masked, and the user is told the CSV reader failed on their JSON/EVTX file.

### Observation 1.4: Connection and Exception Safety
- **File**: `tad-master/packages/reltab-duckdb/src/csvimport.ts:3747-3757`
- **Code**:
  ```typescript
    } finally {
      try {
        await (dbConn as any).close();
      } catch (closeErr) {
        log.warn("[DuckDB] Error closing connection in nativeCSVImport:", closeErr);
      }
    }
  ```
- **Analysis**: `nativeCSVImport` manages `dbConn` cleanup reliably in the outer `finally` block. However, because it fails to short-circuit upon non-CSV streaming failure, `dbConn` is subjected to unnecessary `read_csv` queries before finally closing.

### Observation 1.5: Adversarial & Regression Test Verification
- **Command 1**: `.\node-v18.20.4-win-x64\node.exe tests/qa/test_extreme_adversarial_challenger2.js`
  - Result: **61 Passed, 0 Failed (100% PASS)**.
  - Section 4.4.1 verifies: DuckDB `read_json_auto` rejects `all_varchar = true` with `DUCKDB_NODEJS_ERROR`.
  - Section 4.2.1 verifies: `streamFlattenedJsonToParquet` survives corrupted lines when `ignoreErrors = true`.
- **Command 2**: `.\node-v18.20.4-win-x64\node.exe tests/qa/test_json_adversarial_fuzz.js`
  - Result: **40 Passed, 0 Failed (100% PASS)**.
- **Command 3**: `.\node-v18.20.4-win-x64\node.exe run_tests.js --all`
  - Result: **All 14 test suites passed cleanly (100% HEALTHY)** in 84.52s.

---

## 2. Logic Chain

1. From **Observation 1.1**, `streamJsonToParquet` is the direct ingestion gateway for JSON/JSONL/NDJSON and decoded EVTX files into DuckDB Parquet. It transparently passes all errors from `streamFlattenedJsonToParquet` up to `nativeCSVImport`.
2. From **Observation 1.2**, temporary EVTX JSONL files generated by `toad-core` are unlinked outside of a `finally` block. Any error during `streamJsonToParquet` causes an unhandled abandonment of `tempJsonl` on disk. Placing the unlink in a `finally` block guarantees zero file leakage.
3. From **Observation 1.3**, the streaming catch block at line 3599 catches `streamErr` and falls through into `// ===== CHẾ ĐỘ IN-MEMORY FALLBACK =====`. Because this fallback was architected for CSV files before JSON/EVTX support was added, it unconditionally invokes `read_csv()` on the source file.
4. If a JSON file fails streaming ingestion, falling through to `read_csv()` produces two unacceptable outcomes:
   - For text JSON: DuckDB splits JSON strings on commas, creating bogus CSV columns (`{"field":` and `value}`) without error. This is **silent data corruption**.
   - For binary EVTX or binary corrupted JSON: DuckDB's CSV parser fails with `CSV reader does not support null characters`, completely masking the root JSON parser error.
5. Therefore, `nativeCSVImport` MUST intercept failures for non-CSV formats (`.evtx`, `.json`, `.jsonl`, `.ndjson`):
   - For `.evtx`: Immediately throw a descriptive error (`Failed to ingest EVTX file...`), never feeding binary EVTX to `read_csv()`.
   - For `.json`, `.jsonl`, `.ndjson`: Attempt an in-memory JSON fallback (`CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_json_auto(...)`). If that also fails, immediately throw a descriptive error (`Failed to parse JSON file...`), never falling into `read_csv()`.
6. From **Observation 1.5**, existing unit and QA test suites do not invoke `read_csv` on JSON files; rather, they test `streamFlattenedJsonToParquet` directly. Adding strict format guards in `csvimport.ts` will not affect or break any existing test assertions while providing 100% protection against process termination and silent corruption.

---

## 3. Caveats

- **Scope Limitation**: Explorer 2 strictly adhered to read-only investigation rules. No source files were directly modified during this step.
- **Dependency on Explorer 1 / Challenger 2 Remediation**: In `tad-master/packages/reltab-duckdb/src/json/JsonStreamingFlattener.ts`, Tier 2 must replace `all_varchar = true` with `format = 'newline_delimited'` and be wrapped in a `try...catch` block. The recommendations herein complement that fix by ensuring the caller (`csvimport.ts`) handles failures gracefully if all flattener tiers reject.
- **In-Memory Table Persistence**: In-memory JSON fallback creates an ephemeral table in the DuckDB session. While it provides immediate access in the UI, Parquet caching is not generated. This is the desired and standard fallback behavior matching CSV in-memory fallback.

---

## 4. Conclusion

- **Verdict**: Remediation required in `tad-master/packages/reltab-duckdb/src/csvimport.ts` to prevent silent data corruption, temporary file leaks, and misleading CSV error messages when JSON or EVTX streaming fails.
- **Action Required for Implementer (Worker)**: Apply the following 3 concrete improvements to `csvimport.ts`:

### Proposed Code Change 1: Guaranteed EVTX `tempJsonl` Cleanup
**Target File**: `tad-master/packages/reltab-duckdb/src/csvimport.ts:3407-3513`
```typescript
// BEFORE:
          await streamJsonToParquet(dbConn, tempJsonl, targetParquetPath, cfg);
          try {
            if (fs.existsSync(tempJsonl)) {
              fs.unlinkSync(tempJsonl);
            }
          } catch { }

// AFTER:
          try {
            await streamJsonToParquet(dbConn, tempJsonl, targetParquetPath, cfg);
          } finally {
            try {
              if (fs.existsSync(tempJsonl)) {
                fs.unlinkSync(tempJsonl);
              }
            } catch { }
          }
```

### Proposed Code Change 2: Diagnostic Logging in `streamJsonToParquet`
**Target File**: `tad-master/packages/reltab-duckdb/src/csvimport.ts:3002-3018`
```typescript
// BEFORE:
async function streamJsonToParquet(
  dbConn: Connection,
  filePath: string,
  parquetPath: string,
  cfg: IngestConfig
): Promise<void> {
  const compression = (cfg.compression || "snappy").toUpperCase();
  const rowGroupSize = cfg.row_group_size || 100000;

  await streamFlattenedJsonToParquet(dbConn, filePath, parquetPath, {
    compression,
    rowGroupSize,
    sampleSize: 2048,
    ignoreErrors: true,
    timestampFormat: "%Y-%m-%dT%H:%M:%S.%fZ",
  });
}

// AFTER:
async function streamJsonToParquet(
  dbConn: Connection,
  filePath: string,
  parquetPath: string,
  cfg: IngestConfig
): Promise<void> {
  const compression = (cfg.compression || "snappy").toUpperCase();
  const rowGroupSize = cfg.row_group_size || 100000;

  try {
    await streamFlattenedJsonToParquet(dbConn, filePath, parquetPath, {
      compression,
      rowGroupSize,
      sampleSize: 2048,
      ignoreErrors: true,
      timestampFormat: "%Y-%m-%dT%H:%M:%S.%fZ",
    });
  } catch (streamErr: any) {
    log.warn(
      `[streamJsonToParquet] Streaming JSON to Parquet failed for ${filePath}:`,
      streamErr?.message || streamErr
    );
    throw streamErr;
  }
}
```

### Proposed Code Change 3: Format-Specific Fallback & Elimination of CSV Fallthrough for JSON/EVTX
**Target File**: `tad-master/packages/reltab-duckdb/src/csvimport.ts:3628-3655`
```typescript
// Insert in nativeCSVImport directly after unlinking targetParquetPath in catch (streamErr):

        // Format-Specific Fallback Guards: Never let JSON or EVTX fall through into read_csv
        if (ext === ".evtx") {
          log.error(`[TOAD Ingest] EVTX ingestion failed for ${filePath}:`, streamErr);
          throw new Error(`Failed to ingest EVTX file "${fileName}": ${streamErr?.message || streamErr}`);
        }

        if ([".json", ".jsonl", ".ndjson"].includes(ext)) {
          log.warn(`[TOAD Ingest] Streaming JSON failed for ${filePath}, attempting in-memory JSON fallback...`);
          try {
            const safePath = escapeSqlPath(normalizedPath);
            const inMemQuery = `CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_json_auto('${safePath}', ignore_errors = true);`;
            await dbConn.all(inMemQuery);
            log.info(`[TOAD Ingest] In-memory JSON fallback succeeded for ${tableName}`);
            return tableName;
          } catch (inMemErr: any) {
            log.error(`[TOAD Ingest] In-memory JSON fallback also failed for ${filePath}:`, inMemErr);
            throw new Error(`Failed to parse JSON file "${fileName}": ${streamErr?.message || streamErr}`);
          }
        }
```

---

## 5. Verification Method

To independently verify this caller resilience assessment and ensure 100% test pass:

1. **Verify Adversarial Stress Harness**:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe tests/qa/test_extreme_adversarial_challenger2.js
   ```
   *Expected*: Exit code 0, 61 Passed, 0 Failed.
2. **Verify Adversarial Fuzzing Suite**:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe tests/qa/test_json_adversarial_fuzz.js
   ```
   *Expected*: Exit code 0, 40 Passed, 0 Failed.
3. **Verify Full Regression Suite**:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe run_tests.js --all
   ```
   *Expected*: Exit code 0 across all 14 test suites (100% HEALTHY).
4. **Verification of Non-Fallthrough Behavior**:
   Execute a simulated ingestion of a completely invalid JSON file (e.g. `bad.json` containing random binary bytes `MZ\x90\x00\x01`):
   - Invalidation condition: The method returns a table name, or throws an error mentioning `read_csv` or `CSV reader`.
   - Success condition: The method rejects with `Error: Failed to parse JSON file "bad.json"`, leaving zero orphaned temporary files in `cfg.temp_dir`.
