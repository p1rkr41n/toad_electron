# BRIEFING — 2026-11-04T23:23:45Z

## Mission
Design technical fix in `tauri/project/src-tauri/build.rs` to automatically copy `duckdb.dll` to `target/release/` and `target/release/deps/` alongside `target/debug/` and `target/debug/deps/` preventing `STATUS_DLL_NOT_FOUND (0xc0000135)` on `--release` test runs.

## 🔒 My Identity
- Archetype: explorer
- Roles: read-only investigation, problem analysis, technical synthesis, structured reporting
- Working directory: d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m4_fix_3
- Original parent: 07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d
- Milestone: Milestone 4 Remediation (Squad 4)

## 🔒 Key Constraints
- Read-only investigation — do NOT implement in product code
- Communicate proposed changes via handoff report with exact snippets and rationale
- Follow 5-component handoff protocol (Observation, Logic Chain, Caveats, Conclusion, Verification Method)
- Provide liveness heartbeat via progress.md

## Current Parent
- Conversation ID: 07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d
- Updated: 2026-11-04T23:23:45Z

## Investigation State
- **Explored paths**:
  - `ORIGINAL_REQUEST.md`
  - `challenger_m4_1/handoff.md` (§1.5)
  - `explorer_m4_fix_3/DISPATCH.md`
  - `tauri/project/src-tauri/build.rs`
  - `tauri/project/src-tauri/Cargo.toml`
  - `tauri-build-2.7.3/src/lib.rs` (reference implementation for target directory resolution)
  - `tauri/project/src-tauri/target/debug/` and `tauri/project/src-tauri/target/release/`
- **Key findings**:
  - `build.rs` had no logic for copying runtime dynamic libraries (`duckdb.dll`).
  - `duckdb.dll` was manually placed in `target/debug/` and `target/debug/deps/` during Milestone 3, leaving `target/release/` and `target/release/deps/` unpopulated.
  - Reproducing the failure: `cargo test --release --test adversarial_challenger_m4_tests` crashed with exit code `0xc0000135 (STATUS_DLL_NOT_FOUND)`.
  - Empirically verified: copying `duckdb.dll` to `target/release/` and `target/release/deps/` immediately resolves the issue, and tests pass in 0.30s.
  - Designed automated resolution in `build.rs` using `target_profile_dir_from_out_dir` and candidate discovery logic with size-matching caching to prevent Windows sharing violations.
- **Unexplored areas**:
  - None. Full investigation and verified design completed.

## Key Decisions Made
- Use `out_dir.ancestors().find(|p| p.file_name() == Some("build")).and_then(|b| b.parent())` to robustly determine profile directory and target root across standard and cross-compilation builds.
- Check candidates in prioritized order: `DUCKDB_LIB_DIR` -> `manifest_dir/lib/duckdb.dll` -> `manifest_dir/duckdb.dll` -> `target_root/debug/` -> `target_root/release/`.
- Copy to current profile root (`target/{profile}/`) and test binary directory (`target/{profile}/deps/`), plus sibling profiles if present.
- Skip copying when file sizes match to eliminate redundant disk I/O and avoid Windows file sharing violations on active processes.
- Do NOT write into source tree directories (`lib/`) from `build.rs` during build to maintain VCS hygiene and prevent infinite rebuild loops.

## Artifact Index
- `DISPATCH.md` — Inbound tasks and parent instructions
- `BRIEFING.md` — Persistent working memory
- `progress.md` — Liveness heartbeat
- `proposed_build.rs` — Standalone replacement build script
- `duckdb_dll_copy.patch` — Unified diff patch for `tauri/project/src-tauri/build.rs`
- `handoff.md` — 5-component final assessment and proposed fix
