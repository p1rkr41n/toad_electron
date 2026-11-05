# Progress: Worker M5 Forensics & Ingestion Remediation

- **Last visited**: 2026-11-05T07:52:00Z
- **Current phase**: Complete
- **Status**: COMPLETED

## Steps Completed
- [x] Read DISPATCH.md, ORIGINAL_REQUEST.md, PROJECT.md, and challenger_m5_2/handoff.md
- [x] Inspected target code in `scheduler.rs` and `adversarial_scheduler_queue_tests.rs`
- [x] Initialized BRIEFING.md and progress.md
- [x] Implemented remediation changes in `tauri/project/src-tauri/src/ingest/scheduler.rs`:
  - Reset `burst_lane_active` when dispatching VIP jobs at `active_count == 0` (Exclusive Big File Mode)
  - Added `job_id` matching to `promote_to_vip` across pending, active, and completed maps
  - Set `burst_lane_active = true` on direct `enqueue_file` with `IngestPriority::Vip`
- [x] Updated `tauri/project/src-tauri/tests/adversarial_scheduler_queue_tests.rs`:
  - Removed `#[should_panic]` so `test_adversarial_burst_lane_leak_at_idle` passes cleanly
  - Added `job_id` promotion verification to `test_adversarial_promote_to_vip_corner_cases`
  - Added `test_adversarial_direct_vip_enqueue_activates_burst_lane`
- [x] Ran verification commands:
  - `cargo check`: PASSED (0 errors, 0 warnings)
  - `cargo test --test adversarial_scheduler_queue_tests`: PASSED (12/12 passed)
  - `cargo test --test ingest_tests`: PASSED (15/15 passed)
  - Full `cargo test`: PASSED (127/127 passed across 13 test suites)
  - Node runner: PASSED (3/3 suites, 55/55 passed)
- [x] Recorded clean Jujutsu commit `40a881d8` under author `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`
- [ ] Write handoff report and notify parent
