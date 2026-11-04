# Forensic Audit Report — TOAD v2.5.1 Nested JSON Parser & Auto-Flattening

**Work Product**: TOAD v2.5.1 Nested JSON Parser & Auto-Flattening Implementation
**Profile**: General Project (Development Mode)
**Verdict**: **CLEAN**

---

### Phase Results Summary

| Check Area | Target Scope | Forensic Verdict | Status |
|------------|--------------|:----------------:|:------:|
| **Check 1: Code Authenticity** | `NestedJsonTraverser.ts`, `DuckDbJsonSqlBuilder.ts`, `SampleScanWorker.ts`, `RegexDialog.tsx`, `JsonSchemaIntrospector.ts`, `JsonStreamingFlattener.ts`, `csvimport.ts` | **CLEAN** | PASS |
| **Check 2: Runtime Execution** | Live DuckDB Views, `toad-core.exe evtx-dump`, Parquet Streaming Dynamic Projection | **CLEAN** | PASS |
| **Check 3: Binary & VCS Conformance** | Root `Toad.exe`, `releases/`, `tools/jj/jj.exe log`, `HelloKittyXamKinLung` Identity, English-only | **CLEAN** | PASS |
| **Check 4: Independent Test Execution** | `run_tests.js --all` (14 suites, 486 tests), `test_realworld_evtx_json.js` (35 tests), `test_json_adversarial_fuzz.js` (40 tests) | **CLEAN** | PASS |

---

## 1. Observation

### 1.1 Source Code Authenticity
Inspected all key target source modules for facade implementations, mock shortcuts, or hardcoded answers:
- `tad-master/packages/toadviewer/src/utils/NestedJsonTraverser.ts`: Implements recursive descent down to primitives or stringified JSON arrays. Employs circular reference detection (`visited.has(current)`), safe recursion depth capping (`maxDepth`), type inference (BIGINT, DOUBLE, TIMESTAMP, BOOLEAN, VARCHAR), and bracket/quoted JSONPath generators (`escapeJsonPathSegment`). Zero hardcoded test values.
- `tad-master/packages/toadviewer/src/utils/DuckDbJsonSqlBuilder.ts`: Implements real SQL statement generation for DuckDB `CREATE VIEW` with double-quoted aliases (`escapeIdentifier`), SQL string literal escaping (`escapeSqlStringLiteral`), `* EXCLUDE (...)` column collision handling, and selective `TRY_CAST` wrappers. Zero mock tables.
- `tad-master/packages/toadviewer/src/workers/SampleScanWorker.ts`: Asynchronous chunked scanner (`setTimeout(resolve, 0)`) supporting preview scan (100 rows) and deep scan (1,000 rows). Real fill rate computation and user customization preservation.
- `tad-master/packages/toadviewer/src/components/RegexDialog.tsx`: Full UI integration of segmented mode pill `[Nested JSON]`, wiring `SampleScanController`, `NestedFieldsTable`, and `DuckDbJsonSqlBuilder`.
- `tad-master/packages/reltab-duckdb/src/json/JsonSchemaIntrospector.ts`: Genuine parser for DuckDB `STRUCT(...)` signatures from `DESCRIBE SELECT * FROM read_json_auto(...) LIMIT 0;`, handling nested parentheses and escaped double quotes (`""`).
- `tad-master/packages/reltab-duckdb/src/json/JsonStreamingFlattener.ts`: Implements dynamic unpack projection `COPY (SELECT ... FROM read_json_auto(...)) TO 'dst.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)` with automatic fallbacks (`all_varchar`).
- `tad-master/packages/reltab-duckdb/src/csvimport.ts`: Live integration at lines 3508 and 3515 routing `.json`, `.jsonl`, `.ndjson`, and decoded `.evtx` through `streamJsonToParquet` -> `streamFlattenedJsonToParquet`.
- Scanned all target source files for suspicious test-specific strings (`93937`, `Microsoft Passport Container`, `4E00670063`, `WIN-3MJ9DEQ5B94`, `Service Control Manager`): Zero matches found in implementation code.

### 1.2 Runtime Execution Verification
- `toad-core.exe evtx-dump`: Executed against `D:\Shared_UserData\Downloads\data_sample\System.evtx`. Extracted real event logs in 74.33ms:
  ```json
  {"TimeCreated":"2026-08-23T20:07:02.751165Z","RecordID":36908,"EventID":7036,"Level":"Information","Provider":"Service Control Manager",...}
  ```
- Live DuckDB Query Execution: Unit test `test_duckdb_json_builder.js` executed live against in-memory DuckDB (`:memory:`):
  - View creation latency: avg 2.83ms (budget: <15ms).
  - 100% character immunity verified (#attributes, #text, @xmlns, dots, spaces, slashes, quotes).
- Parquet Streaming Dynamic Projection: Executed live against complex nested EVTX records in `test_json_streaming_flattener.js`. Valid columnar Parquet file written to disk and read back, verifying 11+ leaf columns (`Event.System.EventID.#text`, `Event.EventData.Binary`, etc.).

### 1.3 Binary & VCS Conformance
- Root Directory: Contains only canonical `Toad.exe` (75,884,628 bytes). Zero duplicate historical binaries.
- `releases/` Directory:
  - Canonical release binaries: `Toad-2.5.1-x64-portable.exe` (75,888,518 bytes) and `Toad-2.5.1-x64-portable.zip` (75,893,725 bytes).
  - Computed SHA-256 Hashes:
    - `Toad-2.5.1-x64-portable.exe`: `C01E535B3DFB98063C62C4BF8EF67E71182D18FC0F34812C1CF9F70FF4A54B2A`
    - `Toad-2.5.1-x64-portable.zip`: `90EB0123AF83817DA25993760675ECC4712AE11CE933B2A72EE464D675DC7797`
  - Matches `releases/SHA256SUMS.txt` and `releases/HelloKittyXamKinLung.Toad.yaml` 100% bit-for-bit.
  - Historical binaries (v2.3.5, v2.4.8.1) have distinct hashes; no duplicate binary cloning detected.
- Jujutsu VCS Log (`tools/jj/jj.exe log`):
  - All commits in v2.5.1 cycle authored by: `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`.
  - All commit messages in 100% concise, professional English.
  - Zero corporate / VNCERT leaks in releases, manifests, or commit descriptions.

### 1.4 Independent Test Suite Execution
- `tests/qa/test_realworld_evtx_json.js`:
  - 35/35 PASSED (Exit code: 0).
  - Live extraction of System.evtx in 2212ms, RecordID 93937 leaf parity confirmed.
- `tests/qa/test_json_adversarial_fuzz.js`:
  - 40/40 PASSED (Exit code: 0).
  - Survived SQL injection payloads, 120-level recursion cap, corrupt lines, special characters, unicode emojis, and polymorphic types.
- `run_tests.js --all`:
  - 14/14 Suites PASSED (486 tests total, duration: 45.35s, Exit code: 0):
    1. Smoke Test (v2.5.1) -> PASS
    2. Apache Arrow IPC & invokeBinary (15 Tests) -> PASS
    3. EVTX Parsing & Schema Validation (6 Tests) -> PASS
    4. Nested JSON & Semi-Structured Ingestion (6 Tests) -> PASS
    5. Deep Integration QA (223 Tests) -> PASS
    6. Preload 3 Pages & Dynamic PageSize (10 Tests) -> PASS
    7. Real-World Windows EVTX JSON Parity (35 Tests) -> PASS
    8. Adversarial Robustness & Fuzzing (40 Tests) -> PASS
    9. Legacy Use Cases (19 Tests) -> PASS
    10. Nested Traverser Unit (10 Tests) -> PASS
    11. DuckDB JSON Builder Unit (10 Tests) -> PASS
    12. JSON Schema Introspect Unit (50 Tests) -> PASS
    13. JSON Streaming Flattener Unit (46 Tests) -> PASS
    14. Sample Scan Worker Unit (10 Tests) -> PASS

---

## 2. Logic Chain

1. **Premise 1 (Authenticity)**: If implementation modules contain real recursive traversal, tokenization, type inference, DuckDB SQL generation, and live streaming logic without hardcoded strings or canned returns, the implementation is authentic.
   - *Observation*: Source code analysis confirms full algorithmic logic and zero hardcoded test strings in target files.
2. **Premise 2 (Runtime Reality)**: If DuckDB queries execute and return real data, `toad-core` extracts real EVTX events from disk, and Parquet files are generated and verified on disk, the runtime behavior is genuine.
   - *Observation*: Live execution verified 74.33ms EVTX dump, 2.83ms DuckDB view creation, and valid ZSTD Parquet generation with dot-notated columns.
3. **Premise 3 (VCS & Packaging Compliance)**: If only canonical `Toad.exe` exists in root, `releases/` matches checksum manifests, commits have author `HelloKittyXamKinLung`, and English language policy is respected, VCS and packaging policies are satisfied.
   - *Observation*: Hashes match `SHA256SUMS.txt`, root contains single `Toad.exe`, commits show clean identity and English messages.
4. **Premise 4 (Empirical Test Verification)**: If all test suites execute cleanly with exit code 0 under the local Node.js runtime without errors or regressions, system health is verified.
   - *Observation*: All 14 suites and 486 automated tests passed cleanly in 45.35s with exit code 0.
5. **Deduction**: All four audit categories pass without exception. Therefore, the work product is free from integrity violations.

---

## 3. Caveats

- Tests were executed on Windows x64 host using the bundled Node.js v18.20.4 runtime in headless CLI mode; interactive GUI electron window rendering was tested via the headless bootstrap smoke test rather than interactive human mouse clicks.
- Legacy git history predating v2.5.0 contains historical organizational author references, but all commits, manifests, and documentation for the audited release (v2.5.1) strictly enforce `HelloKittyXamKinLung` and zero corporate leaks.

---

## 4. Conclusion

The work product for **TOAD v2.5.1 Nested JSON Parser & Auto-Flattening** is **AUTHENTIC, ROBUST, AND COMPLIANT**. No integrity violations, shortcuts, or facades were detected.

**Final Verdict**: **CLEAN**

---

## 5. Verification Method

To independently reproduce the forensic audit findings:

```powershell
# 1. Verify EVTX Dump via Rust Toad-Core
& 'tad-master\packages\toad-app\bin\toad-core.exe' evtx-dump 'D:\Shared_UserData\Downloads\data_sample\System.evtx' 'sample.jsonl' 5
Get-Content 'sample.jsonl' -TotalCount 2
Remove-Item 'sample.jsonl'

# 2. Verify Real-World EVTX Parity Suite
.\node-v18.20.4-win-x64\node.exe tests/qa/test_realworld_evtx_json.js

# 3. Verify Adversarial & Fuzzing Suite
.\node-v18.20.4-win-x64\node.exe tests/qa/test_json_adversarial_fuzz.js

# 4. Verify Master Test Suite (14 Suites, 486 Tests)
.\node-v18.20.4-win-x64\node.exe run_tests.js --all

# 5. Verify Jujutsu Commits Identity & English Messages
tools/jj/jj.exe log -r "v2.5.0.5..@" -T "commit_id.short() ++ ' | ' ++ author.name() ++ ' <' ++ author.email() ++ '> | ' ++ description.first_line() ++ '\n'"

# 6. Verify Binary De-duplication & Checksums
Get-FileHash Toad.exe, releases/Toad-2.5.1-x64-portable.exe, releases/Toad-2.5.1-x64-portable.zip
Get-Content releases/SHA256SUMS.txt
```
