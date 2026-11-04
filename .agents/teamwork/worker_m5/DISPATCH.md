# Dispatch: Milestone 5 — Real-world EVTX Parity & Adversarial Fuzzing Test Suite

## Objective
Implement comprehensive E2E QA test suites:
1. `tests/qa/test_realworld_evtx_json.js` for Windows EVTX JSON parity (RecordID 93937).
2. `tests/qa/test_json_adversarial_fuzz.js` for deep nesting, corruption, and special character injection stress tests.
3. Execute the full master test suite (`node run_tests.js --all`) across all suites and ensure 100% PASS with 0 regressions.
4. Publish `TEST_READY.md`.

## Context & Inputs
- Original Request: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`
- Master Plan: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\PROJECT.md`
- Test Infrastructure: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\TEST_INFRA.md`
- EVTX Sample: `D:\Shared_UserData\Downloads\data_sample\System.evtx`
- Node runtime: `node-v18.20.4-win-x64\node.exe`

## Detailed Tasks
1. **Implement `tests/qa/test_realworld_evtx_json.js`**:
   - Extract RecordID 93937 from `D:\Shared_UserData\Downloads\data_sample\System.evtx` (or its decoded JSON representation).
   - Verify 100% extraction of leaf fields:
     - `Event.System.EventID.#text`: 7036
     - `Event.System.EventID.#attributes.Qualifiers`: 16384
     - `Event.EventData.Data.param1`: "Microsoft Passport Container"
     - `Event.EventData.Data.param2`: "stopped"
     - `Event.EventData.Binary`: (string or hex)
   - Verify DuckDB path extraction runs cleanly without SQL binder or escaping errors.

2. **Implement `tests/qa/test_json_adversarial_fuzz.js`**:
   - Test Fuzzing & Boundaries:
     - Truncated and malformed JSON lines (must not crash the parser or DuckDB ingestion).
     - Deep recursion: JSON objects nested 100+ levels deep (must not throw RangeError: Maximum call stack size exceeded).
     - Special character stress: keys containing `#attributes`, `#text`, `@xmlns`, periods (`foo.bar.baz`), spaces, quotes (`"key"`, `'key'`), slashes (`/`, `\`), and emojis (`🚀`, `🔥`).
     - Polymorphic types: same field is integer in row 1, string in row 2, object in row 3.
     - SQL injection payload keys: `' OR 1=1; DROP TABLE users; --` (must be safely quoted as column aliases without SQL execution).

3. **Run Master Regression Test Suite**:
   - Run `node-v18.20.4-win-x64\node.exe run_tests.js --all`.
   - Verify all test suites pass with 100% success rate (Smoke tests, Deep Integration QA, Preload 3 Pages, Legacy Use Cases).
   - Verify 0 regressions.

4. **Publish `TEST_READY.md`**:
   - Write `TEST_READY.md` to project root summarizing test tiers, total test cases, execution commands, and pass rates.

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Output Requirements
Write your final report to `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m5\handoff.md` and notify the parent orchestrator via `send_message`.


## 2026-11-04T08:50:56Z
Received from orchestrator (aad28923-4697-407e-9b0b-76e49e020103):
You are worker_m5, the E2E QA & Fuzzing Worker for TOAD v2.5.1.
Your working directory is d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m5.
Read your dispatch instructions in:
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m5\DISPATCH.md
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\PROJECT.md
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\TEST_INFRA.md

Your tasks:
1. Verify and run `node-v18.20.4-win-x64\node.exe tests/qa/test_realworld_evtx_json.js`:
   - Validate 100% leaf field extraction parity for RecordID 93937 from real-world `D:\Shared_UserData\Downloads\data_sample\System.evtx`.
   - Verify leaf fields: `Event.System.EventID.#text`, `Event.System.EventID.#attributes.Qualifiers`, `Event.EventData.Data.param1`, `Event.EventData.Data.param2`, `Event.EventData.Binary`.
   - Ensure DuckDB path extraction runs cleanly without syntax or escaping errors.
2. Verify and run `node-v18.20.4-win-x64\node.exe tests/qa/test_json_adversarial_fuzz.js`:
   - Test corrupted/truncated JSON lines, deep recursion (>100 levels), quotes, slashes, unicode/emojis, polymorphic field types, and SQL injection syntax payload keys (`' OR 1=1; DROP TABLE users; --`).
3. Run the full master test suite across all suites:
   - `node-v18.20.4-win-x64\node.exe run_tests.js --all`
   - Ensure 100% PASS with 0 regressions.
4. Update `TEST_READY.md` at the project root for TOAD v2.5.1 summarizing all test tiers, test counts, execution commands, and verified parity.
