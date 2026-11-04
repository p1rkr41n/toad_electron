# Dispatch: Reviewer M2-2 (Architecture & Plugin Lifecycle Reviewer)

## Mission
Perform independent review focusing on plugin registration order, thread safety in AppState, single-instance CLI forwarding, panic handling, and INI config auto-healing:
- Review `lib.rs` (plugin order: single-instance first), `state.rs`, `logger.rs`, `portable.rs`.
- Verify build and tests via `cargo test --manifest-path tauri/project/src-tauri/Cargo.toml`.
- Verify interface conformance with `PROJECT.md` and `ORIGINAL_REQUEST.md`.
- Deliver verdict: APPROVE or REQUEST_CHANGES in `handoff.md`.


## 2026-11-04T20:11:54Z
You are Reviewer M2-2 for Milestone 2 (Rust Core Engine & OS Plugins).
Your working directory: d:\Shared_UserData\Downloads\tad\.agents\teamwork\reviewer_m2_2\

Mandatory inputs to read:
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
- d:\Shared_UserData\Downloads\tad\PROJECT.md
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m2\handoff.md
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\reviewer_m2_2\DISPATCH.md

Focus areas to inspect in `tauri/project/src-tauri/`:
- `src/lib.rs`: Verify native plugins registration order (specifically `single-instance` registered FIRST before other plugins, event forwarding on `toad:single-instance-open`).
- `src/portable.rs`: Verify deterministic `toadAppData_[5chars]` path logic, INI round-trip parser/serializer, config auto-healing on corrupt/missing files, and `clean_temp_dir()` preserving `toad_ledger.parquet`.
- `src/state.rs` & `src/logger.rs`: Verify `AppState` thread safety (`Arc<RwLock<ToadConfig>>`), dual-target tracing subscriber (stdout + file), and global panic hook.
- `src/commands/mod.rs` & `src/commands/system.rs`: Verify command alias mapping and legacy Tad compatibility.

Tasks:
1. Run build and tests:
   `cargo check --manifest-path tauri/project/src-tauri/Cargo.toml`
   `cargo test --manifest-path tauri/project/src-tauri/Cargo.toml`
2. Deliver a self-contained handoff report at `d:\Shared_UserData\Downloads\tad\.agents\teamwork\reviewer_m2_2\handoff.md` with an explicit verdict: APPROVE or REQUEST_CHANGES.
3. Notify parent with your verdict via send_message.
