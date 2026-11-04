# Dispatch: Explorer M2-Fix-2 (Genuine Command Routing Test Design)

## Mission
Investigate and design the technical fix for the tautological test in `tauri/project/src-tauri/src/main.rs`:
1. Full Forensic Audit Report: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\auditor_m2_1\handoff.md`
2. Task:
   - In `src/main.rs:258-277`: Replace `test_command_alias_routing_coverage` with genuine test logic.
   - Design a test that validates command alias normalization and routing behavior against application logic (e.g., exposing `normalize_command(cmd: &str) -> &'static str` or testing the router mapping function).
   - Ensure zero tautological assertions (`assert!(!str.is_empty())`).
   - Deliver clear, concrete fix strategy in `handoff.md`.


## 2026-11-04T20:20:42Z
From: 07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d
Content:
You are Explorer M2-Fix-2 for Milestone 2 Remediation (Rust Core Engine & OS Plugins).
Your working directory: d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m2_fix_2\

Mandatory inputs to read before starting:
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
- d:\Shared_UserData\Downloads\tad\PROJECT.md
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\auditor_m2_1\handoff.md (FULL AUDIT EVIDENCE REPORT)
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m2_fix_2\DISPATCH.md

Target scope for technical investigation:
- `tauri/project/src-tauri/src/main.rs` (Lines 258-277)
- `tauri/project/src-tauri/src/commands/mod.rs`

Key objectives:
1. Address the integrity violation identified by the auditor:
   - `test_command_alias_routing_coverage` in `src/main.rs` was flagged as a tautological test asserting `assert!(!canonical.is_empty())` without exercising application code.
   - Design a genuine test strategy that tests command normalization / routing logic directly against application functions or mapping tables.
2. Ensure the proposed test adheres to zero-cheating principles and executes genuine assertions.
3. Produce a clear, actionable fix recommendation (do NOT modify source code directly).
4. Write your report at `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m2_fix_2\handoff.md`.
5. Notify parent when finished via send_message.
