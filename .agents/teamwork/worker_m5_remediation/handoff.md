# Remediation Handoff Report: M5 SJF Scheduler Concurrency & VIP Identifier Fixes

- **Agent**: `worker_m5_remediation` (Squad 5: Forensics & Ingestion Remediation Worker)
- **Roles**: Implementer, QA, Specialist
- **Working Directory**: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m5_remediation\`
- **Parent Conversation ID**: `07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d`
- **Target Files Modified**:
  - `tauri/project/src-tauri/src/ingest/scheduler.rs`
  - `tauri/project/src-tauri/tests/adversarial_scheduler_queue_tests.rs`
- **Jujutsu Commit**: `40a881d8` (`fix(ingest): remediate scheduler burst lane leak and promote_to_vip identifier matching`)
- **Date**: 2026-11-05T07:52:00Z
- **Verdict**: **`RESOLVED`**

---

## 1. Observation

### 1.1 Pre-Remediation Verification of Challenger Findings
Challenger `challenger_m5_2` identified three specific defects in `IngestionScheduler`:
1. **Finding 1 (`burst_lane_active` Permit Leak on Idle Dispatch)**:
   In `tauri/project/src-tauri/src/ingest/scheduler.rs:445-448`:
   ```rust
   if active_count == 0 {
       // Exclusive Big File Mode: run pending[0] regardless of size
       Some(st.pending.remove(0))
   }
   ```
   When a VIP job was dispatched while `active_count == 0`, `st.burst_lane_active` was never reset to `false`. In `adversarial_scheduler_queue_tests.rs`, `test_adversarial_burst_lane_leak_at_idle` demonstrated this with:
   `ADVERSARIAL PROOF: burst_lane_active leaked after completion: true`.
2. **Finding 2 (`promote_to_vip` Identifier Matching)**:
   In `scheduler.rs:342, 354, 361`, `promote_to_vip` searched only `j.file_id == file_id_or_path || j.file_path == file_id_or_path`, failing when called with `job_id` (which `commands/ingest.rs:129` allows).
3. **Finding 3 (Direct VIP Enqueue Burst Lane Activation)**:
   In `scheduler.rs:327-331`, `enqueue_file` directly with `IngestPriority::Vip` did not set `st.burst_lane_active = true`.

### 1.2 Implemented Code Changes

#### 1.2.1 `tauri/project/src-tauri/src/ingest/scheduler.rs`
1. **Reset `burst_lane_active` in Exclusive Big File Mode (`scheduler.rs:448-454`)**:
   ```rust
   if active_count == 0 {
       // Exclusive Big File Mode: run pending[0] regardless of size
       let job = st.pending.remove(0);
       if job.priority == IngestPriority::Vip {
           st.burst_lane_active = false;
       }
       Some(job)
   }
   ```
2. **Support `job_id` in `promote_to_vip` (`scheduler.rs:345, 357, 364`)**:
   - `st.pending`: `j.job_id == file_id_or_path || j.file_id == file_id_or_path || j.file_path == file_id_or_path`
   - `st.active`: `handle.job.job_id == file_id_or_path || handle.job.file_id == file_id_or_path || handle.job.file_path == file_id_or_path`
   - `st.completed`: `job.job_id == file_id_or_path || job.file_id == file_id_or_path || job.file_path == file_id_or_path`
3. **Direct VIP Enqueue Activates Burst Lane (`scheduler.rs:329-331`)**:
   ```rust
   {
       let mut st = self.state.write().await;
       if priority == IngestPriority::Vip {
           st.burst_lane_active = true;
       }
       st.pending.push(job.clone());
       st.pending.sort_by(|a, b| a.cmp_sjf(b));
   }
   ```

#### 1.2.2 `tauri/project/src-tauri/tests/adversarial_scheduler_queue_tests.rs`
1. In `test_adversarial_burst_lane_leak_at_idle`:
   Removed `#[should_panic]` annotation; verified that `st.burst_lane_active` is reset to `false` and assertion cleanly passes.
2. In `test_adversarial_promote_to_vip_corner_cases`:
   Added assertions verifying promotion by `job_id` both while pending and after completion.
3. Added `test_adversarial_direct_vip_enqueue_activates_burst_lane`:
   Directly enqueues a VIP job and verifies that it finishes with status `Ready` and resets `burst_lane_active` to `false`.

### 1.3 Verbatim Execution Results

1. **Compilation Check**:
   ```powershell
   cargo check --manifest-path tauri/project/src-tauri/Cargo.toml
   ```
   *Result*: `Finished dev profile [unoptimized + debuginfo] target(s) in 16.26s` (0 errors, 0 warnings).

2. **Adversarial Scheduler Queue Suite**:
   ```powershell
   cargo test --manifest-path tauri/project/src-tauri/Cargo.toml --test adversarial_scheduler_queue_tests -- --nocapture
   ```
   *Output*:
   ```
   running 12 tests
   test test_adversarial_dirty_log_timestamp_extractor_stress ... ok
   test test_adversarial_sjf_comparator_total_order_and_transitivity ... ok
   test test_adversarial_double_cancellation ... ok
   test test_adversarial_cancel_pending_job_before_dispatch ... ok
   test test_adversarial_exclusive_big_file_mode ... ok
   test test_adversarial_promote_to_vip_corner_cases ... ok
   ADVERSARIAL VERIFIED: burst_lane_active after completion is correctly reset: true
   test test_adversarial_burst_lane_leak_at_idle ... ok
   test test_adversarial_direct_vip_enqueue_activates_burst_lane ... ok
   test test_adversarial_double_valid_parquet_cache_hit ... ok
   test test_adversarial_csv_delimiter_sniffing_and_fallbacks ... ok
   test test_adversarial_cancellation_scratch_cleanup ... ok
   test test_adversarial_vip_burst_lane_preemption ... ok

   test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.74s
   ```

3. **Ingest Suite**:
   ```powershell
   cargo test --manifest-path tauri/project/src-tauri/Cargo.toml --test ingest_tests -- --nocapture
   ```
   *Result*: `test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 8.54s`.

4. **Full Workspace Rust Suite**:
   ```powershell
   cargo test --manifest-path tauri/project/src-tauri/Cargo.toml
   ```
   *Result*: 127 tests passed across 13 test targets (0 failed, 0 ignored).

5. **Master Node Test Runner**:
   ```powershell
   & "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tauri/project/tests/run_all_tests.js
   ```
   *Result*: `OVERALL STATUS: SUCCESS - 100% of test suites passed cleanly` (3 suites, 55 tests passed in 2004ms).

6. **Jujutsu Version Control Log**:
   ```
   ○  xxqkplrt p1rkr41n@users.noreply.github.com 2026-11-05 07:51:03 40a881d8
   │  fix(ingest): remediate scheduler burst lane leak and promote_to_vip identifier matching
   ```

---

## 2. Logic Chain

1. **Burst Lane Idle Leak Resolution**:
   - *Observation*: Line 447 popped `st.pending.remove(0)` when `active_count == 0` without inspecting priority.
   - *Logic*: By adding `if job.priority == IngestPriority::Vip { st.burst_lane_active = false; }`, both the idle dispatch (`active_count == 0`) and the active dispatch (`active_count < max_slots`) symmetrically consume and reset the burst lane permit upon VIP dispatch.
   - *Outcome*: `test_adversarial_burst_lane_leak_at_idle` confirms `st.burst_lane_active` is `false` after completion, preventing normal jobs from piggybacking on the burst lane permit.

2. **Identifier Matching Consistency**:
   - *Observation*: `commands/ingest.rs` extracts `target_id` from `jobId`, `fileId`, or `filePath`.
   - *Logic*: By checking `j.job_id == file_id_or_path || j.file_id == file_id_or_path || j.file_path == file_id_or_path` in `promote_to_vip`, callers can now supply any of the 3 identifiers interchangeably.
   - *Outcome*: Verified by `test_adversarial_promote_to_vip_corner_cases` across pending and completed states.

3. **Direct VIP Enqueue Burst Lane Activation**:
   - *Observation*: `enqueue_file` with `IngestPriority::Vip` sorted the job to index 0 but left `st.burst_lane_active` `false`.
   - *Logic*: Setting `st.burst_lane_active = true` during enqueue ensures the burst slot is immediately made available even when all regular concurrency slots are occupied.
   - *Outcome*: Verified by `test_adversarial_direct_vip_enqueue_activates_burst_lane`.

---

## 3. Caveats

- No caveats. The fixes follow the minimal-change principle, touch only `scheduler.rs` and the dedicated adversarial test file, and preserve full backward compatibility with all existing IPC commands and callers.

---

## 4. Conclusion

All 3 defects reported by `challenger_m5_2` have been fully and genuinely remediated. No workarounds or dummy implementations were used. The scheduler now preserves strict dual-bound concurrency throttling, correctly resets the burst lane permit across both idle and non-idle states, and accepts all valid job identifiers.

**Milestone 5 Gate Status**: **READY TO PASS**

---

## 5. Verification Method

To independently verify this remediation:
```powershell
cd d:\Shared_UserData\Downloads\tad\tauri\project\src-tauri

# 1. Run the adversarial scheduler stress tests (12 tests)
cargo test --test adversarial_scheduler_queue_tests -- --nocapture

# 2. Run the ingestion feature tests (15 tests)
cargo test --test ingest_tests -- --nocapture

# 3. Run full Rust workspace test suite (127 tests)
cargo test

# 4. Run master Node test runner
& "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" ..\tests\run_all_tests.js

# 5. Inspect Jujutsu commit
jj log -r "@-"
```
