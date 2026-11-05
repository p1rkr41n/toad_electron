# Review & Adversarial Challenge Report: Milestone 5 Gate Recheck

- **Agent**: `reviewer_m5_recheck_2` (Squad 5: Interface & Architecture Reviewer)
- **Roles**: Reviewer, Adversarial Critic
- **Working Directory**: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\reviewer_m5_recheck_2`
- **Target Commit**: `40a881d8`
- **Timestamp**: 2026-11-05T01:08:00Z
- **Verdict**: **`REQUEST_CHANGES`**

---

## 1. Observation

### 1.1 IPC Interface & Command Conformance
In `tauri/project/src-tauri/src/commands/ingest.rs` and `tauri/project/src-tauri/src/commands/mod.rs`:
- **Routing & Aliases**:
  - `toad:ingest_file`, `ingestFile`, `ingest_file` route to `CommandAction::IngestFile` -> `handle_ingest_file`.
  - `toad:ingest_cancel`, `cancelIngest`, `ingest_cancel` route to `CommandAction::IngestCancel` -> `handle_ingest_cancel`.
  - `toad:ingest_vip`, `prioritizeIngest`, `ingest_vip` route to `CommandAction::IngestVip` -> `handle_ingest_vip`.
  - `toad:get_ingest_queue`, `getIngestQueue`, `get_ingest_queue` route to `CommandAction::IngestGetQueue` -> `handle_get_ingest_queue`.
- **Parameter Extraction in `handle_ingest_vip`** (`commands/ingest.rs:141-144`):
  ```rust
  let target_id = get_str_param(&payload, "fileId", "file_id")
      .or_else(|| get_str_param(&payload, "filePath", "file_path"))
      .or_else(|| get_str_param(&payload, "jobId", "job_id"))
      .ok_or_else(|| ErrorResponse::invalid_argument("Missing fileId or filePath parameter"))?;
  ```
  Extracts `fileId`, `filePath`, and `jobId` in camelCase and snake_case aliases.
- **Identifier Support in `scheduler.promote_to_vip`** (`scheduler.rs:345, 357, 364`):
  Matches `j.job_id == file_id_or_path || j.file_id == file_id_or_path || j.file_path == file_id_or_path` across `pending`, `active`, and `completed` states.
- **Parameter Extraction in `handle_ingest_cancel`** (`commands/ingest.rs:119-122`):
  Extracts `jobId` or `fileId` and cancels corresponding jobs via `scheduler.cancel_job`.

### 1.2 Multi-Stage Progress Dispatching & Fallback Architecture
- **Event Emissions** (`src/ingest/progress.rs`):
  Emits `toad:ingest-progress` over Tauri WebView IPC with payload serialized to camelCase:
  `fileId`, `filePath`, `stage`, `percentage`, `rowsIngested`, `elapsedMs`, `status`, `errorMessage`.
  - Stage 1: Sniffing (5%, status `"RUNNING"`, stage `"sniffing"`)
  - Stage 2: Parsing (45%, status `"RUNNING"`, stage `"parsing"`, throttled to min 100ms interval)
  - Stage 3: Writing (90%, status `"RUNNING"`, stage `"writing"`)
  - Stage 4: Ready (100%, status `"READY"`, stage `"ready"`) / Failed (0%, status `"FAILED"`, stage `"failed"`) / Cancelled (0%, status `"CANCELLED"`, stage `"cancelled"`).
- **Graceful Error Handling & Fallbacks**:
  - `csv_streamer.rs`: Tier 0 (`read_csv` with `all_varchar = true`, `null_padding = true`, `parallel = false`) -> Tier 1 (`header = true`) -> Tier 2 (`ingest_dirty_log`).
  - `jsonl_streamer.rs`: Dynamic schema introspection via `DESCRIBE` and struct dot-notated unnesting -> plain `read_json_auto` fallback -> `ingest_dirty_log`.
  - `dirty_log.rs`: 3-column Arrow schema (`line_number: BIGINT`, `timestamp: TIMESTAMP_MICROS`, `raw_event: VARCHAR`) streamed with Snappy compression (<30MB RAM).

### 1.3 Verbatim Test Execution Results

1. **Ingest Subsystem Suite**:
   ```powershell
   cargo test --manifest-path tauri/project/src-tauri/Cargo.toml --test ingest_tests -- --nocapture
   ```
   *Result*:
   ```
   running 15 tests
   test test_multi_stage_progress_dispatch ... ok
   test test_dirty_log_timestamp_extractor ... ok
   test test_ingest_command_routing_aliases ... ok
   test test_parse_struct_fields_recursion ... ok
   test test_sjf_strict_priority_comparator ... ok
   test test_evtx_arrow_schema_definition ... ok
   test test_scheduler_enqueue_and_vip_preemption ... ok
   test test_scheduler_cancellation_and_cleanup ... ok
   test test_dirty_log_streaming_ingest ... ok
   test test_delimiter_sniffer_variations ... ok
   test test_ingest_ipc_handlers_roundtrip ... ok
   test test_csv_ingest_tier0_all_varchar_and_null_padding ... ok
   test test_jsonl_dynamic_schema_ingest ... ok
   test test_scheduler_wal_ledger_commit_on_completion ... ok
   EVTX Real Dataset Ingestion: 57030 rows in 8.6095585s (6624 rows/sec), size: 936144 bytes
   test test_evtx_simd_ingest_real_dataset ... ok

   test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 8.65s
   ```

2. **Master Node Test Runner**:
   ```powershell
   & "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tauri/project/tests/run_all_tests.js
   ```
   *Result*:
   ```
   OVERALL STATUS: SUCCESS - 100% of test suites passed cleanly.
   • [PASS] Arrow IPC Binary Protocol Suite (17/17 passed in 339.1ms)
   • [PASS] 100K Rows Grid Virtual Scroll & Stress Suite (16/16 passed in 715.4ms)
   • [PASS] End-to-End Features Suite (Tiers 1, 2, 3) (22/22 passed in 900.9ms)
   Total Execution Time: 1957.40ms
   ```

3. **Full Rust Workspace Suite (`cargo test`)**:
   ```powershell
   cargo test --manifest-path tauri/project/src-tauri/Cargo.toml
   ```
   *Result*: **FAILED**
   ```
   Running tests\adversarial_scheduler_queue_tests.rs
   running 13 tests
   test test_adversarial_dirty_log_timestamp_extractor_stress ... ok
   test test_adversarial_sjf_comparator_total_order_and_transitivity ... ok
   test test_adversarial_double_cancellation ... ok
   test test_adversarial_cancel_pending_job_before_dispatch ... ok
   test test_adversarial_burst_lane_leak_at_idle ... ok
   test test_adversarial_direct_vip_enqueue_activates_burst_lane ... ok
   test test_adversarial_exclusive_big_file_mode ... ok
   test test_adversarial_promote_to_vip_corner_cases ... ok
   test test_adversarial_csv_delimiter_sniffing_and_fallbacks ... ok
   test test_adversarial_double_valid_parquet_cache_hit ... ok
   test test_adversarial_cancellation_scratch_cleanup ... ok
   test test_adversarial_cancel_pending_vip_burst_lane_leak ... FAILED
   test test_adversarial_vip_burst_lane_preemption ... ok

   failures:

   ---- test_adversarial_cancel_pending_vip_burst_lane_leak stdout ----
   ADVERSARIAL PROOF: burst_lane_active after cancel pending VIP: true

   thread 'test_adversarial_cancel_pending_vip_burst_lane_leak' panicked at tests\adversarial_scheduler_queue_tests.rs:939:5:
   Burst lane flag leaked: was not reset when pending VIP job was cancelled
   ```

---

## 2. Logic Chain

1. **Interface Conformance Validation**:
   - `commands/ingest.rs` and `commands/mod.rs` correctly map legacy and namespaced IPC command invocations.
   - CamelCase serialization of `IngestProgressPayload` and `IngestFileResponse` strictly adheres to the frontend contract specified in `PROJECT.md`.
   - `handle_ingest_vip` and `scheduler.promote_to_vip` properly resolve jobs by `jobId`, `fileId`, or `filePath`.

2. **Error Resiliency Validation**:
   - Delimiter sniffing, `all_varchar` assertions, dot-notated unnesting, and fallback to `dirty_log.rs` prevent engine panics and data corruption under malformed input.

3. **Concurrency Defect (Burst Lane Permit Leak on Pending VIP Cancellation)**:
   - *Observation*: In `scheduler.rs:377-383`:
     ```rust
     if let Some(pos) = st.pending.iter().position(|j| j.job_id == job_or_file_id || j.file_id == job_or_file_id) {
         let mut job = st.pending.remove(pos);
         job.status = IngestStatus::Cancelled;
         self.dispatcher.emit_cancelled(&job.file_id, &job.file_path, 0);
         st.completed.insert(job.job_id.clone(), job);
         return Ok(true);
     }
     ```
   - *Logic*:
     - When a VIP job is enqueued (`scheduler.rs:330`) or promoted (`scheduler.rs:349`), `st.burst_lane_active` is set to `true`.
     - If all concurrency slots are currently busy, the VIP job remains in `st.pending`.
     - When a caller cancels this pending VIP job via `scheduler.cancel_job`, `st.pending.remove(pos)` is executed, but `st.burst_lane_active` is **never reset to `false`**.
     - If no other pending jobs have `priority == IngestPriority::Vip`, `st.burst_lane_active` remains stuck at `true`.
     - In `run_dispatch_loop` (`scheduler.rs:442-446`), `max_slots` evaluates to `st.max_concurrent_files + 1`.
     - Consequently, subsequent regular (Normal priority) jobs piggyback on the leaked burst permit, running at `active_count = max_concurrent_files + 1` and violating the dual-bound concurrency contract.
   - *Impact*: Directly reproduces the failure in `test_adversarial_cancel_pending_vip_burst_lane_leak` during full workspace `cargo test`.

---

## 3. Caveats

- Implementation modifications are strictly out of scope for the reviewer role (`Review-only — do NOT modify implementation code`).
- The fix is straightforward and requires a targeted check in `cancel_job`: if the cancelled pending job is `priority == IngestPriority::Vip` and `st.pending.iter().all(|j| j.priority != IngestPriority::Vip)`, then reset `st.burst_lane_active = false`.

---

## 4. Conclusion & Findings

### Findings Summary
- **[Critical/Major] Finding 1**: Burst Lane permit leak when cancelling pending VIP job (`scheduler.rs:377-383`).
  - *Location*: `tauri/project/src-tauri/src/ingest/scheduler.rs:377`
  - *Problem*: `cancel_job` does not reset `st.burst_lane_active = false` when removing a pending VIP job. Normal jobs subsequent to the cancellation breach the concurrency limit.
  - *Remediation Recommendation*:
    ```rust
    if let Some(pos) = st.pending.iter().position(|j| j.job_id == job_or_file_id || j.file_id == job_or_file_id) {
        let mut job = st.pending.remove(pos);
        if job.priority == IngestPriority::Vip && st.pending.iter().all(|j| j.priority != IngestPriority::Vip) {
            st.burst_lane_active = false;
        }
        job.status = IngestStatus::Cancelled;
        self.dispatcher.emit_cancelled(&job.file_id, &job.file_path, 0);
        st.completed.insert(job.job_id.clone(), job);
        return Ok(true);
    }
    ```
- **Integrity Forensics**: **CLEAN**. No hardcoded return values, fake stubs, or mock shortcuts detected. All components genuinely process forensic files.

### Final Verdict
**`REQUEST_CHANGES`** (Milestone 5 Gate cannot pass while `cargo test` in `src-tauri` fails).

---

## 5. Verification Method

To verify this finding:
```powershell
cd d:\Shared_UserData\Downloads\tad\tauri\project\src-tauri

# 1. Run the failing adversarial cancellation test
cargo test --test adversarial_scheduler_queue_tests -- test_adversarial_cancel_pending_vip_burst_lane_leak --nocapture

# 2. Run the full workspace test suite
cargo test
```
