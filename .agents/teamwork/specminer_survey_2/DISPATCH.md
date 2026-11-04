## 2026-11-04T18:34:15Z
You are a Spec Miner subagent in Phase 0 (Survey) of the Toad Tauri v2 porting project.
Your working directory is: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\specminer_survey_2`

MANDATORY INPUT:
Read `ORIGINAL_REQUEST.md` at:
`d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`
Also reference the approved implementation plan at:
`C:\Users\huydq\.gemini\antigravity\brain\4cd78c02-c356-4448-bdfe-f2930e55fb29\ke_hoach_trien_khai_50_subagents_tauri_v2.md`

OBJECTIVE & SCOPE:
Investigate Tauri v2 specifications and native plugins from the documentation at:
`d:\Shared_UserData\Downloads\tad\tauri\docs/`
1. Mine exact specifications for Tauri v2 configuration (`tauri.conf.json` format, schema, windows options, CSP, security).
2. Mine exact specifications for Tauri v2 capabilities and permissions (`src-tauri/capabilities/default.json`). What permissions are required for:
   - `core:default`
   - `dialog` plugin (open, save)
   - `fs` plugin
   - `opener` plugin (`plugin:opener|open_url`)
   - `clipboard` plugin (`plugin:clipboard|write_text`)
   - `single-instance` plugin
   - `window-state` plugin
   - Custom commands: `toad:*` and `project:*` namespaces.
3. Mine Tauri v2 Rust IPC patterns:
   - `tauri::ipc::Response` for returning binary raw buffers (for Apache Arrow IPC Stream starting with `0xFFFFFFFF`).
   - `tauri::ipc::Channel` for streaming progress updates to frontend.
   - Command registration via `tauri::generate_handler!`.
   - Single-instance plugin setup on Windows.

OUTPUT:
Write your comprehensive specification report to `d:\Shared_UserData\Downloads\tad\.agents\teamwork\specminer_survey_2\tauri_spec_report.md`.
Write your completion handoff report to `d:\Shared_UserData\Downloads\tad\.agents\teamwork\specminer_survey_2\handoff.md`.
Update `d:\Shared_UserData\Downloads\tad\.agents\teamwork\specminer_survey_2\progress.md` with your progress and timestamp.
When finished, send a message to orchestrator with context, content, and report paths.
