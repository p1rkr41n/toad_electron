## 2026-11-04T19:23:25Z
You are Worker M2 (Squad 2: Rust Core Engine & OS Plugins) for the Toad Tauri v2 migration project.
Your working directory is: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m2`

MANDATORY INPUTS (You MUST read before starting work):
- `ORIGINAL_REQUEST.md`: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`
- `PROJECT.md`: `d:\Shared_UserData\Downloads\tad\PROJECT.md`
- Approved Plan: `C:\Users\huydq\.gemini\antigravity\brain\4cd78c02-c356-4448-bdfe-f2930e55fb29\ke_hoach_trien_khai_50_subagents_tauri_v2.md`
- Mined Spec: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\specminer_survey_2\tauri_spec_report.md`
- Reviewer 1 & 2 Handoffs:
  - `d:\Shared_UserData\Downloads\tad\.agents\teamwork\reviewer_m1_1\handoff.md`
  - `d:\Shared_UserData\Downloads\tad\.agents\teamwork\reviewer_m1_2\handoff.md`
  - `d:\Shared_UserData\Downloads\tad\.agents\teamwork\challenger_m1_1\handoff.md`

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

EXCLUSIVE WRITE OWNERSHIP:
You own exclusively:
- `tauri/project/src-tauri/Cargo.toml`
- `tauri/project/src-tauri/build.rs`
- `tauri/project/src-tauri/icons/`
- `tauri/project/src-tauri/src/portable.rs`
- `tauri/project/src-tauri/src/state.rs`
- `tauri/project/src-tauri/src/logger.rs`
- `tauri/project/src-tauri/src/commands/mod.rs`
- `tauri/project/src-tauri/src/commands/system.rs`
- `tauri/project/src-tauri/src/lib.rs`
- `tauri/project/src-tauri/src/main.rs`

TASK OBJECTIVES (Features F03, F04, F05, F06):
1. Build script & Assets:
   - Add `[build-dependencies]` with `tauri-build = { version = "2", features = [] }` to `Cargo.toml`.
   - Create `src-tauri/build.rs` calling `tauri_build::build()`.
   - Copy or ensure `src-tauri/icons/icon.ico` (from `tad-master/resources/toad.ico` or create standard 32x32/16x16 icon) so Tauri's Windows resource compiler succeeds.
2. Portable Environment & Config (`src-tauri/src/portable.rs`):
   - Determine executable directory using `std::env::current_exe()`.
   - Detect or generate `toadAppData_[5chars]` (e.g. hash of machine or path).
   - Create subdirectories: `temp/`, `logs/`.
   - Load and parse `config.ini` (with default settings: threads, memory limit, log level).
   - Implement `clean_temp_dir()` to clean up dangling temporary parquet caches on startup.
3. Concurrency AppState & Panic Guard (`src-tauri/src/state.rs` & `logger.rs`):
   - Implement `AppState`:
     ```rust
     pub struct AppState {
         pub portable_dir: std::path::PathBuf,
         pub config: std::sync::Arc<tokio::sync::RwLock<ToadConfig>>,
         // Stubs/placeholders ready for DuckDB, Ledger, and IngestQueue in M3-M5
     }
     ```
   - Set up `logger.rs` using `tracing-subscriber` logging to both stdout and `toadAppData/logs/toad.log`.
   - Implement structured error response DTOs (`ErrorResponse { code, message, details }`).
4. Native Plugins Registration (`src-tauri/src/lib.rs`):
   - Register `tauri_plugin_single_instance::init` FIRST on `tauri::Builder` (forwarding CLI args via event `toad:single-instance-open`).
   - Register `tauri_plugin_window_state::Builder::default().build()`.
   - Register `tauri_plugin_dialog::init()`.
   - Register `tauri_plugin_opener::init()`.
   - Register `tauri_plugin_clipboard_manager::init()`.
   - Register `tauri_plugin_fs::init()`.
5. Command Dispatcher & Aliases (`src-tauri/src/commands/mod.rs` & `system.rs`):
   - Register handlers for:
     - `toad:init_main`
     - `toad:get_config`
     - `toad:open_file_dialog` / `plugin:dialog|open`
     - `toad:write_clipboard` / `plugin:clipboard|write_text`
     - `toad:open_url` / `plugin:opener|open_url`
     - Query and project stubs responding with clear typed DTOs until M3/M4 hook them up.
   - Support both namespaced (`toad:eval_query`) and direct aliases (`evalQuery`).
6. Verification & Version Control:
   - Run `cargo test --manifest-path tauri/project/src-tauri/Cargo.toml` and verify 100% pass.
   - Run `cargo check --manifest-path tauri/project/src-tauri/Cargo.toml`.
   - Check status and commit via `C:\Users\huydq\.cargo\bin\jj.exe commit -m "feat(core): implement AppState, portable environment, and Tauri command router"` under author `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`.

OUTPUT:
Write your completion handoff report to `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m2\handoff.md`.
Update `progress.md` after each step.
Notify orchestrator when complete.

## 2026-11-04T19:44:01Z
**Context**: Milestone 2 Unit Test Verification Support
**Content**: Checking in on your verification progress. If running unit tests on the full Tauri builder requires a live GUI window or WebView runtime, remember that:
1. `portable::ensure_portable_environment` and config parsing can be tested in standard headless unit tests.
2. Command dispatching and JSON serialization can be tested via pure unit tests on handlers.
3. `cargo check` and headless unit tests verify 100% of the Rust core logic.
**Action**: Please update progress.md with your current status or finalize your handoff.
