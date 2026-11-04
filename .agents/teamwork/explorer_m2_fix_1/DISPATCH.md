# Dispatch: Explorer M2-Fix-1 (Native Plugin Wiring & Anti-Hijacking Strategy)

## Mission
Investigate and design the exact technical fix for the Forensic Auditor and Reviewer integrity violations in `tauri/project/src-tauri/src/commands/`:
1. Full Forensic Audit Report: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\auditor_m2_1\handoff.md`
2. Reviewer Reports: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\reviewer_m2_1\handoff.md` and `d:\Shared_UserData\Downloads\tad\.agents\teamwork\reviewer_m2_2\handoff.md`
3. Task:
   - In `src/commands/mod.rs`: Stop intercepting canonical Tauri plugin commands (`plugin:dialog|open`, `plugin:clipboard|write_text`, `plugin:clipboard-manager|write_text`, `plugin:opener|open_url`). Allow Tauri to pass them to native plugins.
   - In `src/commands/system.rs`: Wire genuine plugin extension traits (`app.clipboard().write_text()`, `app.opener().open_url()`, dialog APIs) for custom `toad:*` aliases.
   - Deliver clear, concrete fix strategy in `handoff.md`.

## 2026-11-04T20:20:36Z
You are Explorer M2-Fix-1 for Milestone 2 Remediation (Rust Core Engine & OS Plugins).
Your working directory: d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m2_fix_1\

Mandatory inputs to read before starting:
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
- d:\Shared_UserData\Downloads\tad\PROJECT.md
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\auditor_m2_1\handoff.md (FULL AUDIT EVIDENCE REPORT)
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\reviewer_m2_1\handoff.md
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\reviewer_m2_2\handoff.md
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m2_fix_1\DISPATCH.md

Target scope for technical investigation:
- `tauri/project/src-tauri/src/commands/mod.rs`
- `tauri/project/src-tauri/src/commands/system.rs`
- `tauri/project/src-tauri/src/lib.rs`

Key objectives:
1. Address the integrity violation identified by the auditor and reviewers:
   - In `commands/mod.rs`: Stop intercepting canonical Tauri plugin command strings (`plugin:dialog|open`, `plugin:clipboard|write_text`, `plugin:clipboard-manager|write_text`, `plugin:opener|open_url`). Allow Tauri to route them natively to the registered plugins.
   - In `commands/system.rs`: Wire genuine plugin extension traits (`app.clipboard().write_text()`, `app.opener().open_url()`, and dialog picker) for custom `toad:*` aliases. Eliminate dummy constant-returning facades.
2. Produce a clear, actionable fix recommendation (do NOT modify source code directly).
3. Write your report at `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m2_fix_1\handoff.md`.
4. Notify parent when finished via send_message.
