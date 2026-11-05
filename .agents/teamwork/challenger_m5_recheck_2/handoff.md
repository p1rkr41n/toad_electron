# Adversarial Recheck Challenge Report: M5 Scheduler VIP Burst Lane & Concurrency Limits

- **Agent**: `challenger_m5_recheck_2` (Squad 5: Queue Scheduling & Concurrency Adversarial Challenger, M5 Gate Recheck)
- **Roles**: Critic, Specialist (Empirical Challenger)
- **Working Directory**: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\challenger_m5_recheck_2`
- **Parent Conversation ID**: `07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d`
- **Target Files Inspected**:
  - `tauri/project/src-tauri/src/ingest/scheduler.rs`
  - `tauri/project/src-tauri/tests/adversarial_scheduler_queue_tests.rs`
- **Jujutsu Commit Under Review**: `40a881d8` (`fix(ingest): remediate scheduler burst lane leak and promote_to_vip identifier matching`)
- **Date**: 2026-11-05T01:08:00Z
- **Verdict**: **`REQUEST_CHANGES`**

---

## Challenge Summary

**Overall risk assessment**: **HIGH**

While commit `40a881d8` correctly resolved the initial 3 defects reported in Iteration 8 (idle burst lane reset, identifier resolution, and direct VIP enqueue activation), empirical stress-testing revealed a critical concurrency permit leak:

Cancelling a queued VIP job that is still in `pending` (`cancel_job`) removes the job from the queue but **never clears `st.burst_lane_active = false`**. Consequently, `st.burst_lane_active` permanently leaks `true`, allowing subsequent normal background jobs to indefinitely bypass the concurrency ceiling (`max_concurrent_files + 1`), violating the dual-bound concurrency contract.

---

## 1. Observation

### 1.1 Empirical Verification of Previous Remediation (Commit `40a881d8`)
Executed the 12 baseline adversarial tests in `adversarial_scheduler_queue_tests.rs`:
```powershell
cargo test --manifest-path tauri/project/src-tauri/Cargo.toml --test adversarial_scheduler_queue_tests -- --nocapture
```
**Output**:
```
running 12 tests
test test_adversarial_dirty_log_timestamp_extractor_stress ... ok
test test_adversarial_sjf_comparator_total_order_and_transitivity ... ok
test test_adversarial_double_cancellation ... ok
test test_adversarial_cancel_pending_job_before_dispatch ... ok
ADVERSARIAL VERIFIED: burst_lane_active after completion is correctly reset: true
test test_adversarial_burst_lane_leak_at_idle ... ok
test test_adversarial_direct_vip_enqueue_activates_burst_lane ... ok
test test_adversarial_exclusive_big_file_mode ... ok
test test_adversarial_promote_to_vip_corner_cases ... ok
test test_adversarial_csv_delimiter_sniffing_and_fallbacks ... ok
test test_adversarial_double_valid_parquet_cache_hit ... ok
test test_adversarial_cancellation_scratch_cleanup ... ok
test test_adversarial_vip_burst_lane_preemption ... ok

test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.57s
```

- **Defect 1 (`burst_lane_active` Reset on Idle Dispatch)**:
  In `scheduler.rs:450-453`, lines added by worker `40a881d8`:
  ```rust
  if active_count == 0 {
      let job = st.pending.remove(0);
      if job.priority == IngestPriority::Vip {
          st.burst_lane_active = false;
      }
      Some(job)
  }
  ```
  Verified: `test_adversarial_burst_lane_leak_at_idle` cleanly passed with `ADVERSARIAL VERIFIED: burst_lane_active after completion is correctly reset: true`.
- **Defect 2 (`promote_to_vip` Identifier Matching)**:
  Verified: `test_adversarial_promote_to_vip_corner_cases` confirmed that `job_id`, `file_id`, and `file_path` all resolve cleanly across pending, active, and completed states.
- **Defect 3 (Direct VIP Enqueue Activation)**:
  Verified: `test_adversarial_direct_vip_enqueue_activates_burst_lane` confirmed direct VIP enqueue arms the burst lane.

---

### 1.2 Empirical Discovery of New Defect: Pending VIP Cancellation Permit Leak
Authored and executed empirical stress test `test_adversarial_cancel_pending_vip_burst_lane_leak` in `tauri/project/src-tauri/tests/adversarial_scheduler_queue_tests.rs`:
```rust
#[tokio::test]
#[should_panic(expected = "Burst lane flag leaked: was not reset when pending VIP job was cancelled")]
async fn test_adversarial_cancel_pending_vip_burst_lane_leak() {
    let test_dir = create_temp_dir("cancel_pending_vip_leak");
    ...
    // 1. Fill concurrency slot with Normal job (active_count = 1)
    // 2. Enqueue VIP job into burst slot (active_count = 2 == max_slots)
    // 3. Enqueue 2nd VIP job (must wait in pending because slots are full)
    // 4. Cancel 2nd VIP job while still pending!
    let cancelled = scheduler.cancel_job(&j3.job_id).await.unwrap();
    assert!(cancelled);

    // 5. Wait for active jobs to finish (idle: active_count == 0, pending_count == 0)
    ...
    // 6. Inspect scheduler state
    let st = scheduler.state.read().await;
    let leaked = st.burst_lane_active;
    eprintln!("ADVERSARIAL PROOF: burst_lane_active after cancel pending VIP: {}", leaked);
    assert!(!st.burst_lane_active, "Burst lane flag leaked: was not reset when pending VIP job was cancelled");
}
```

**Verbatim Execution Output**:
```
ADVERSARIAL PROOF: burst_lane_active after cancel pending VIP: true

thread 'test_adversarial_cancel_pending_vip_burst_lane_leak' (43812) panicked at tests\adversarial_scheduler_queue_tests.rs:908:5:
Burst lane flag leaked: was not reset when pending VIP job was cancelled
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
test test_adversarial_cancel_pending_vip_burst_lane_leak - should panic ... ok
```

All 13 tests in `adversarial_scheduler_queue_tests.rs` ran and passed in 4.41s:
`test result: ok. 13 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.41s`.

---

## 2. Logic Chain

1. **Permit Activation Mechanism**:
   - When a job is promoted to VIP (`promote_to_vip`, `scheduler.rs:348`) or enqueued with `priority == IngestPriority::Vip` (`enqueue_file`, `scheduler.rs:330`), the scheduler sets `st.burst_lane_active = true`.
2. **Current Permit Consumption / Release Mechanism**:
   - Permit release is tied strictly to job *dispatch*:
     - In Exclusive Big File Mode (`active_count == 0`, `scheduler.rs:451`):
       `if job.priority == IngestPriority::Vip { st.burst_lane_active = false; }`
     - In Multi-slot Mode (`active_count < max_slots`, `scheduler.rs:466`):
       `if st.pending[idx].priority == IngestPriority::Vip { st.burst_lane_active = false; }`
3. **The Cancellation Vulnerability**:
   - In `scheduler.rs:377-383`:
     ```rust
     // Check pending
     if let Some(pos) = st.pending.iter().position(|j| j.job_id == job_or_file_id || j.file_id == job_or_file_id) {
         let mut job = st.pending.remove(pos);
         job.status = IngestStatus::Cancelled;
         self.dispatcher.emit_cancelled(&job.file_id, &job.file_path, 0);
         st.completed.insert(job.job_id.clone(), job);
         return Ok(true);
     }
     ```
   - When a pending job has `job.priority == IngestPriority::Vip` and is cancelled via `cancel_job`:
     - It is removed from `st.pending`.
     - It is **never dispatched**, so neither line 452 nor line 467 is ever executed for it.
     - `cancel_job` does NOT check `job.priority` and does NOT reset `st.burst_lane_active`.
4. **Blast Radius & Concurrency Violation**:
   - Because `st.burst_lane_active` remains `true` permanently:
     - `max_slots` continues evaluating to `st.max_concurrent_files + 1` (e.g. 5 instead of 4).
     - Any subsequent normal background jobs can enter the +1 burst slot without being VIP.
     - Because normal jobs have `job.priority == IngestPriority::Normal`, lines 452 and 467 evaluate to `false`, leaving `st.burst_lane_active = true` permanently active in memory.

---

## 3. Challenges

### [High] Challenge 1: Burst Lane Permit Leak upon Cancellation of Queued VIP Job

- **Assumption Challenged**: That resetting `st.burst_lane_active = false` upon job dispatch is sufficient to prevent permit leaks.
- **Attack Scenario**:
  1. Worker slots are saturated with normal jobs.
  2. Caller submits or promotes a job to VIP. `st.burst_lane_active` is set to `true`.
  3. Caller immediately cancels the queued VIP job before any worker slot opens.
  4. The job is removed from `st.pending`.
  5. The queue goes idle or accepts new normal jobs.
- **Blast Radius**:
  `st.burst_lane_active` remains permanently `true`. Normal jobs indefinitely exceed the concurrency limit (`max_concurrent_files + 1`), violating the dual-bound throttling contract.
- **Mitigation**:
  In `scheduler.rs:377-383` (`cancel_job`), if the cancelled pending job was VIP and no remaining jobs in `st.pending` are VIP, reset `st.burst_lane_active = false`:
  ```rust
  if let Some(pos) = st.pending.iter().position(|j| j.job_id == job_or_file_id || j.file_id == job_or_file_id) {
      let mut job = st.pending.remove(pos);
      job.status = IngestStatus::Cancelled;
      if job.priority == IngestPriority::Vip && !st.pending.iter().any(|j| j.priority == IngestPriority::Vip) {
          st.burst_lane_active = false;
      }
      self.dispatcher.emit_cancelled(&job.file_id, &job.file_path, 0);
      st.completed.insert(job.job_id.clone(), job);
      return Ok(true);
  }
  ```

---

## 4. Stress Test Results

| Test Scenario | Expected Result | Actual Result | Status |
|---------------|-----------------|---------------|--------|
| `test_adversarial_burst_lane_leak_at_idle` | `burst_lane_active == false` after idle completion | `burst_lane_active == false` | PASS |
| `test_adversarial_promote_to_vip_corner_cases` | Promotes by `job_id`, `file_id`, and `file_path` | All 3 succeed cleanly | PASS |
| `test_adversarial_direct_vip_enqueue_activates_burst_lane` | Direct VIP enqueue arms burst lane | Arms and resets cleanly | PASS |
| `test_adversarial_vip_burst_lane_preemption` | 5 jobs (40K rows each), slots burst 2 -> 3 | Slot burst verified | PASS |
| `test_adversarial_cancel_pending_vip_burst_lane_leak` | Cancelling pending VIP must reset `burst_lane_active` | Leaked `true` (captured via `#[should_panic]`) | CONFIRMED LEAK |
| Full 13-Test Adversarial Suite | 13/13 tests pass | 13 passed in 4.41s | PASS |
| Ingest Suite (`ingest_tests.rs`) | 15/15 tests pass | 15 passed in 8.35s | PASS |
| Node Master Test Runner | 55/55 tests pass | 55 passed in 1,933ms | PASS |

---

## 5. Caveats

- **Remediation Work Authenticity**: The implementation delivered by `worker_m5_remediation` in commit `40a881d8` is authentic, genuine, and cleanly fixed the 3 originally requested items.
- **Scope of Defect**: The pending VIP cancellation leak occurs specifically when a VIP job is queued in `pending` and cancelled before dispatch. It does not corrupt data or crash the engine, but it does breach concurrency bounds under cancellation edge cases.
- **Other Squad Observations**: Note that peer challenger `challenger_m5_recheck_1` simultaneously identified an EVTX RAM budget overflow (`test_evtx_ram_bounding_and_zero_disk_churn`: 91.38 MB > 30 MB budget). Both findings should be remediated before Milestone 5 is officially closed.

---

## 6. Conclusion

**Verdict: `REQUEST_CHANGES`**

### Required Action Item for Remediation:
In `tauri/project/src-tauri/src/ingest/scheduler.rs:378-382` (`cancel_job`):
When removing a cancelled job from `st.pending`, check if `job.priority == IngestPriority::Vip` and `!st.pending.iter().any(|j| j.priority == IngestPriority::Vip)`, and if so, set `st.burst_lane_active = false`.
Once fixed, remove the `#[should_panic]` annotation from `test_adversarial_cancel_pending_vip_burst_lane_leak` in `tests/adversarial_scheduler_queue_tests.rs`.

---

## 7. Verification Method

To independently reproduce and verify this finding:

```powershell
cd d:\Shared_UserData\Downloads\tad\tauri\project\src-tauri

# 1. Run the empirical 13-test adversarial scheduler suite
cargo test --test adversarial_scheduler_queue_tests -- --nocapture

# 2. Inspect the adversarial proof output for pending VIP cancellation leak:
# Look for line: "ADVERSARIAL PROOF: burst_lane_active after cancel pending VIP: true"
# and "Burst lane flag leaked: was not reset when pending VIP job was cancelled"

# 3. Run the ingest feature suite
cargo test --test ingest_tests -- --nocapture

# 4. Run master Node test runner
& "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" ..\tests\run_all_tests.js
```
