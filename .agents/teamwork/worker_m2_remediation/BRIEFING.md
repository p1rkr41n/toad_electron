# BRIEFING — 2026-11-04T20:30:42Z

## Mission
Remediate Milestone 2 (Rust Core Engine & OS Plugins): remove plugin command hijacking, decouple command routing via route_command, wire genuine OS plugin handlers, implement candidate-first atomic state rollback, strip inline comments in INI parser, replace tautological tests, update adversarial tests, and verify 100% clean test passes.

## 🔒 My Identity
- Archetype: worker
- Roles: implementer, qa, specialist
- Working directory: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m2_remediation
- Original parent: 07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d
- Milestone: Milestone 2 (Remediation)

## 🔒 Key Constraints
- Follow minimal change principle and integrity mandate (no dummy/facade implementations, no hardcoding, genuine logic).
- Use Jujutsu (`jj`) for VCS commits under author `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`. Strictly local, no remote push.
- Zero duplicate binary storage.
- English-only public language policy.
- Exclusively own and modify:
  - `tauri/project/src-tauri/src/commands/mod.rs`
  - `tauri/project/src-tauri/src/commands/system.rs`
  - `tauri/project/src-tauri/src/state.rs`
  - `tauri/project/src-tauri/src/portable.rs`
  - `tauri/project/src-tauri/src/main.rs`
  - `tauri/project/src-tauri/tests/adversarial_m2_tests.rs`

## Current Parent
- Conversation ID: 07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d
- Updated: 2026-11-04T20:30:42Z

## Task Summary
- **What to build**:
  1. Decoupled command routing with `route_command(cmd: &str) -> CommandAction` in `commands/mod.rs` with `PluginPassthrough` returning `false` from `dispatch_invoke()` so Tauri native plugin handlers aren't hijacked.
  2. Genuine handlers in `commands/system.rs` using `ClipboardExt`, `OpenerExt`, `DialogExt`.
  3. Candidate-first atomic rollback in `AppState::update_config` (`state.rs`).
  4. INI inline comment stripping (`#` and `;`) in `portable.rs`.
  5. Replacement of tautological routing test in `main.rs` with genuine tests + atomic rollback unit test.
  6. Update adversarial test suite in `tests/adversarial_m2_tests.rs`.
- **Success criteria**:
  - `cargo check --manifest-path tauri/project/src-tauri/Cargo.toml` passes with 0 errors and 0 warnings.
  - `cargo test --manifest-path tauri/project/src-tauri/Cargo.toml` passes with 0 errors and 0 warnings.
  - Jujutsu commit recorded cleanly.
- **Interface contracts**: `PROJECT.md`, `auditor_m2_1/handoff.md`, `explorer_m2_fix_1/handoff.md`.
- **Code layout**: `tauri/project/src-tauri/`

## Key Decisions Made
- Adopting architecture from Explorer M2-Fix-1 and M2-Fix-2: pure `route_command` router mapping command names to `CommandAction`, keeping `dispatch_invoke` as a lightweight dispatch returning `false` for pass-through commands.

## Change Tracker
- **Files modified**: None yet
- **Build status**: Untested
- **Pending issues**: None

## Quality Status
- **Build/test result**: Not yet run
- **Lint status**: Clean (pending verification)
- **Tests added/modified**: Pending

## Loaded Skills
- None specified in task dispatch.

## Artifact Index
- `DISPATCH.md` — Task dispatch instructions
- `progress.md` — Liveness and progress heartbeat
- `handoff.md` — Final handoff report (to be written)
