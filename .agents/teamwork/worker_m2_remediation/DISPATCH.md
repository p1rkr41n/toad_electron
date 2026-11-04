# Dispatch: Worker M2 Remediation (Rust Core Engine & OS Plugins Remediation)

## Mission
Apply the comprehensive technical fixes designed by Explorers M2-Fix-1, M2-Fix-2, and M2-Fix-3 to resolve all Forensic Audit integrity violations and Reviewer findings:
1. Eliminate plugin command hijacking in `src/commands/mod.rs` and decouple routing into `route_command(cmd: &str) -> CommandAction` (or `normalize_command`). Ensure canonical plugin commands (`plugin:dialog|open`, `plugin:clipboard|write_text`, `plugin:clipboard-manager|write_text`, `plugin:opener|open_url`) evaluate to `PluginPassthrough` returning `false` from `dispatch_invoke()`.
2. Wire genuine native plugin extension traits (`ClipboardExt`, `OpenerExt`, `DialogExt`) in `src/commands/system.rs` for `toad:*` aliases. Eliminate dummy/constant returns.
3. Replace the tautological test in `src/main.rs:258-277` with genuine assertions exercising application routing logic without tautologies.
4. Implement candidate-first atomic rollback for `AppState::update_config` in `src/state.rs:63-72`, ensuring `*cfg` is only committed in-memory if disk write succeeds.
5. In `src/portable.rs`, strip trailing inline comments (`#` or `;`) in `parse_ini`.
6. Update `tests/adversarial_m2_tests.rs` to validate `route_command` and atomicity rollback on I/O failure.
7. Verify build and tests via `cargo check` and `cargo test`.
8. Record commit via `jj` under `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`. Zero remote push.
9. Deliver report in `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m2_remediation\handoff.md`.
## 2026-11-04T20:30:42Z
You are Worker M2-Remediation for Milestone 2 (Rust Core Engine & OS Plugins Remediation).
Your working directory: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m2_remediation\

Mandatory inputs to read before starting:
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
- d:\Shared_UserData\Downloads\tad\PROJECT.md
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\auditor_m2_1\handoff.md (FULL AUDIT EVIDENCE REPORT)
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m2_fix_1\handoff.md
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m2_fix_1\proposed_commands_mod.rs
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m2_fix_1\proposed_commands_system.rs
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m2_fix_1\proposed_main.rs
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m2_fix_1\adversarial_test_remediation.patch
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m2_fix_1\state_and_portable_remediation.patch
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m2_fix_2\handoff.md
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m2_fix_3\handoff.md
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m2_remediation\DISPATCH.md
