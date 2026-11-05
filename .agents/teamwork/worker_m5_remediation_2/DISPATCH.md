# Dispatch: worker_m5_remediation_2

## Context & Objectives
You are `worker_m5_remediation_2` (Squad 5: Forensics & Ingestion Remediation Worker 2).
Your task is to implement the exact fix for the Burst Lane permit leak when cancelling a pending VIP job in `scheduler.rs`, and update the adversarial test suite to verify the fix.

## Mandatory Reading
- Original User Request: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`
- Project Master Plan: `d:\Shared_UserData\Downloads\tad\PROJECT.md`
- Reviewer 1 Findings: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\reviewer_m5_recheck_1\handoff.md`
- Reviewer 2 Findings: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\reviewer_m5_recheck_2\handoff.md`
- Challenger 2 Findings: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\challenger_m5_recheck_2\handoff.md`

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Code Changes Required
1. `tauri/project/src-tauri/src/ingest/scheduler.rs`:
   In `pub async fn cancel_job(&self, job_or_file_id: &str) -> Result<bool, String>`:
   Around line 377-385:
   ```rust
   // Check pending
   if let Some(pos) = st.pending.iter().position(|j| j.job_id == job_or_file_id || j.file_id == job_or_file_id) {
       let mut job = st.pending.remove(pos);
       if job.priority == IngestPriority::Vip && !st.pending.iter().any(|j| j.priority == IngestPriority::Vip) {
           st.burst_lane_active = false;
       }
       job.status = IngestStatus::Cancelled;
       self.dispatcher.emit_cancelled(&job.file_id, &job.file_path, 0);
       st.completed.insert(job.job_id.clone(), job);
       return Ok(true);
   }
   ```
2. `tauri/project/src-tauri/tests/adversarial_scheduler_queue_tests.rs`:
   In `test_adversarial_cancel_pending_vip_burst_lane_leak`:
   Remove the `#[should_panic]` attribute.
   Ensure the test verifies that after cancelling the pending VIP job and letting active jobs finish, `assert!(!st.burst_lane_active)` cleanly passes.

## Verification Commands
1. `cargo check --manifest-path tauri/project/src-tauri/Cargo.toml`
2. `cargo test --manifest-path tauri/project/src-tauri/Cargo.toml --test adversarial_scheduler_queue_tests -- --nocapture` (all 13 tests must pass cleanly, 0 panics)
3. `cargo test --manifest-path tauri/project/src-tauri/Cargo.toml --test ingest_tests -- --nocapture` (all 15 tests pass)
4. Full workspace: `cargo test --manifest-path tauri/project/src-tauri/Cargo.toml`
5. Master Node test runner: `& "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tauri/project/tests/run_all_tests.js`

## Version Control Invariant
Record a clean Jujutsu commit:
`tools/jj/jj.exe describe -m "fix(ingest): reset burst lane permit on pending VIP job cancellation"`
Author MUST strictly be `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`. Zero remote push.

## Output Requirements
Write your detailed implementation report to `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m5_remediation_2\handoff.md`.
Report completion back to caller via `send_message`.


## 2026-11-05T01:14:45Z
Apply the fix in scheduler.rs:377-385, update adversarial_scheduler_queue_tests.rs (remove #[should_panic]), run all tests, record the Jujutsu commit under HelloKittyXamKinLung, and deliver your handoff.md report.
Use send_message to report completion to your parent.
