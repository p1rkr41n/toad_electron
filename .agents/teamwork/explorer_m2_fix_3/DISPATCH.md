# Dispatch: Explorer M2-Fix-3 (AppState Atomic Update & Full Regression Safety)

## Mission
Investigate and design the technical fix for `AppState::update_config` atomicity and overall regression safety:
1. Full Forensic Audit Report: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\auditor_m2_1\handoff.md`
2. Reviewer Report Finding 3: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\reviewer_m2_1\handoff.md`
3. Task:
   - In `src/state.rs`: Fix non-atomic mutation where `*cfg` is modified before disk write succeeds. Ensure candidate clone is saved first, and in-memory lock is only updated upon successful I/O.
   - Verify that changes across `commands/mod.rs`, `commands/system.rs`, `main.rs`, and `state.rs` do not break existing 31 tests in `core_tests.rs` and `adversarial_m2_tests.rs`.
   - Deliver clear, concrete fix strategy in `handoff.md`.


## 2026-11-04T20:20:48Z
You are Explorer M2-Fix-3 for Milestone 2 Remediation (Rust Core Engine & OS Plugins).
Your working directory: d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m2_fix_3\

Mandatory inputs to read before starting:
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
- d:\Shared_UserData\Downloads\tad\PROJECT.md
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\auditor_m2_1\handoff.md (FULL AUDIT EVIDENCE REPORT)
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\reviewer_m2_1\handoff.md
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m2_fix_3\DISPATCH.md

Target scope for technical investigation:
- `tauri/project/src-tauri/src/state.rs` (Lines 63-72)
- Overall regression safety across `tauri/project/src-tauri/tests/`

Key objectives:
1. Address the atomicity issue in `AppState::update_config`:
   - Design a safe update mechanism where candidate configuration is saved to disk first, and in-memory lock is only updated upon successful I/O.
2. Verify regression safety:
   - Ensure the fixes designed for `commands/mod.rs`, `commands/system.rs`, and `main.rs` do not break existing tests in `core_tests.rs` or `adversarial_m2_tests.rs`.
3. Produce a clear, actionable fix recommendation (do NOT modify source code directly).
4. Write your report at `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m2_fix_3\handoff.md`.
5. Notify parent when finished via send_message.
