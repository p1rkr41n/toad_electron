# Dispatch: Worker M5 Forensics & Ingestion Remediation (Squad 5)

## 2026-11-05T07:45:00Z
**Mission**: Remediate the concurrency and parameter matching findings identified by `challenger_m5_2` during Milestone 5 Gate verification.

**Target Files**:
- `tauri/project/src-tauri/src/ingest/scheduler.rs`
- `tauri/project/src-tauri/tests/adversarial_scheduler_queue_tests.rs`

**Reference Documents**:
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md` (MANDATORY: read first)
- `d:\Shared_UserData\Downloads\tad\PROJECT.md`
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\challenger_m5_2\handoff.md` (FULL EVIDENCE: read all finding details)

**Required Remediation Actions**:
1. **Fix `burst_lane_active` Permit Leak on Idle Dispatch (`scheduler.rs:445-448`)**:
   In `dispatch_next_job`:
   When popping from `st.pending` while `active_count == 0` (Exclusive Big File Mode), check if the popped job was VIP:
   ```rust
   if active_count == 0 {
       let job = st.pending.remove(0);
       if job.priority == IngestPriority::Vip {
           st.burst_lane_active = false;
       }
       Some(job)
   }
   ```
2. **Fix `promote_to_vip` Identifier Matching (`scheduler.rs:342, 354, 361`)**:
   Update `promote_to_vip` to match `j.job_id == file_id_or_path || j.file_id == file_id_or_path || j.file_path == file_id_or_path` across `st.pending`, `st.active`, and `st.completed`.
3. **Fix Direct VIP Enqueue Burst Lane Activation (`scheduler.rs:331`)**:
   In `enqueue_file`, if `priority == IngestPriority::Vip`, set `st.burst_lane_active = true`.
4. **Update `tests/adversarial_scheduler_queue_tests.rs`**:
   Ensure `test_adversarial_burst_lane_leak_at_idle` no longer panics and passes cleanly.

**MANDATORY INTEGRITY WARNING**:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

**Verification Commands Required**:
- `cargo check --manifest-path tauri/project/src-tauri/Cargo.toml`
- `cargo test --manifest-path tauri/project/src-tauri/Cargo.toml --test adversarial_scheduler_queue_tests -- --nocapture`
- `cargo test --manifest-path tauri/project/src-tauri/Cargo.toml --test ingest_tests -- --nocapture`
- Full `cargo test --manifest-path tauri/project/src-tauri/Cargo.toml`
- Node runner: `& "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tauri/project/tests/run_all_tests.js`

**VCS Rules**:
Record clean Jujutsu commit: author strictly `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`. Strictly local commit — NO remote git push.

Deliver hard handoff report to:
`d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m5_remediation\handoff.md`
Notify parent via `send_message`.
