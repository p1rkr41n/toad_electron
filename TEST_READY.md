# TOAD v2.5.1 E2E Test Suite Ready

## Test Runners & Commands
- **Master Unified Test Runner**: `.\node-v18.20.4-win-x64\node.exe run_tests.js --all`
- **Real-World EVTX Parity QA Suite**: `.\node-v18.20.4-win-x64\node.exe tests/qa/test_realworld_evtx_json.js`
- **Adversarial & Fuzzing QA Suite**: `.\node-v18.20.4-win-x64\node.exe tests/qa/test_json_adversarial_fuzz.js`
- **Unit Test Suites**: `.\node-v18.20.4-win-x64\node.exe run_tests.js --unit`
- **Deep Integration QA**: `.\node-v18.20.4-win-x64\node.exe run_tests.js --qa`
- **Smoke Test**: `.\node-v18.20.4-win-x64\node.exe run_tests.js --smoke`
- **FastBuild Verification**: `powershell -ExecutionPolicy Bypass -File fastbuild.ps1 -SkipTsc`
- **Expected Outcome**: All 14 suites PASS cleanly with exit code 0 (100% HEALTHY).

## Coverage Summary
| Tier | Test Suite | Count | Description |
|------|------------|------:|-------------|
| **Tier 1 (Functional Unit)** | `tests/unit/test_nested_traverser.js` | 10 | Recursive leaf extraction, type inference, bracket & quoted dot paths |
| | `tests/unit/test_duckdb_json_builder.js` | 10 | Safe CREATE VIEW generation, alias quoting, TRY_CAST, <15ms latency |
| | `tests/unit/test_json_schema_introspect.js` | 50 | DuckDB DESCRIBE struct parsing, token splitting, leaf projections |
| | `tests/unit/test_json_streaming_flattener.js` | 46 | Streaming unpack projection COPY TO Parquet (ZSTD), special char immunity |
| | `tests/unit/test_sample_scan_worker.js` | 10 | Timesliced 100-row preview & 1,000-row deep scan without UI freeze |
| **Tier 2 (Boundary & Corner)** | `tests/legacy_use_cases.js` | 19 | Big files, SJF queue, path deduplication, dual DuckDB mount |
| **Tier 3 (Cross-Feature & IPC)** | `tests/test_arrow_ipc_stream.js` | 15 | Apache Arrow IPC continuation, dictionary encoding, invokeBinary |
| | `tests/test_evtx_parsing_schema.js` | 6 | Toad-Core evtx-dump, ISO UTC RFC3339, DuckDB read_json_auto |
| | `tests/test_nested_json.js` | 6 | DuckDB STRUCT ingestion and semi-structured schema evolution |
| | `tests/test_preload_3_pages.js` | 10 | Dynamic page size allocation and 3-page preloading |
| | `tests/smoke_test.js` | 6 | Process bootstrap, ASAR limits (<45MB), portable exe (<75MB) |
| **Tier 4 (Real-World EVTX Parity)** | `tests/qa/test_realworld_evtx_json.js` | 35 | Live extraction of RecordID 93937 from System.evtx, 100% leaf parity |
| **Tier 5 (Adversarial Security)** | `tests/qa/test_json_adversarial_fuzz.js` | 40 | SQL injection keys, deep recursion (120 levels), polymorphic types, unicode |
| **Tier 6 (Deep Integration QA)** | `tests/deep_integration_qa.js` | 223 | End-to-end full system regression covering 39 feature suites |
| **Total Automated Tests** | **14 Test Suites** | **486** | **100% PASS (Zero Regressions across all suites)** |

## Real-World EVTX RecordID 93937 Parity Matrix
Verified directly against `D:\Shared_UserData\Downloads\data_sample\System.evtx`:

| Leaf Field Path | Inferred DuckDB Type | Verified Value | Status |
|-----------------|----------------------|----------------|:------:|
| `Event.System.EventID.#text` | `BIGINT` | `7036` | **100% PARITY** |
| `Event.System.EventID.#attributes.Qualifiers` | `BIGINT` | `16384` | **100% PARITY** |
| `Event.EventData.param1` | `VARCHAR` | `"Microsoft Passport Container"` | **100% PARITY** |
| `Event.EventData.param2` | `VARCHAR` | `"stopped"` | **100% PARITY** |
| `Event.EventData.Data.param1` | `VARCHAR` | `"Microsoft Passport Container"` | **100% PARITY** |
| `Event.EventData.Data.param2` | `VARCHAR` | `"stopped"` | **100% PARITY** |
| `Event.EventData.Binary` | `VARCHAR` | `"4E0067006300430074006E0072005300760063002F0031000000"` | **100% PARITY** |
| `Event.System.TimeCreated.#attributes.SystemTime` | `TIMESTAMP` | `"2026-10-27T14:44:08.819818Z"` | **100% PARITY** |
| `Event.System.Provider.#attributes.Name` | `VARCHAR` | `"Service Control Manager"` | **100% PARITY** |
| `Event.System.Computer` | `VARCHAR` | `"WIN-3MJ9DEQ5B94"` | **100% PARITY** |

## Adversarial & Security Robustness Gate
- **SQL Injection Payload Keys**: Keys like `' OR 1=1; DROP TABLE sensitive_data; --` and `"; DROP TABLE sensitive_data; --` are safely escaped via double quotes; sensitive tables remain intact.
- **Deep Nesting (>100 levels)**: 120-level nested JSON processed safely without stack overflow (`RangeError: Maximum call stack size exceeded`). Safety cap `maxDepth=50` truncates gracefully.
- **Corrupted & Truncated Lines**: Truncated brackets, unquoted syntax, and binary garbage safely return NULL or empty array without crashing DuckDB or Node.js runtime.
- **Special Characters**: Double quotes (`"`), single quotes (`'`), backslashes (`\`), forward slashes (`/`), dots (`.`), and emojis (`🚀`, `🔥`) are preserved 1:1 in DuckDB views and Parquet output.
- **Polymorphic Field Types**: Columns flapping between integers, floats, strings, booleans, objects, arrays, and nulls are cleanly handled via `TRY_CAST` without SQL binder errors.
- **Extreme Numeric Bounds**: `MAX_SAFE_INTEGER` (`9007199254740991`) and extreme floating point values preserved with exact numeric fidelity.
