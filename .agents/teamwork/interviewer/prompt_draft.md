Use a team of 50 engineers across 7 squads to port and rebuild the Toad application for Windows on Tauri v2 at `D:\Shared_UserData\Downloads\tad\tauri\project`, reference Tauri v2 documentation at `D:\Shared_UserData\Downloads\tad\tauri\docs/`, and package a portable release at `D:\Shared_UserData\Downloads\tad\tauri\project\releases/`.

Working directory: D:\Shared_UserData\Downloads\tad
Integrity mode: development

Reference material:
- Approved plan: `C:\Users\huydq\.gemini\antigravity\brain\4cd78c02-c356-4448-bdfe-f2930e55fb29\ke_hoach_trien_khai_50_subagents_tauri_v2.md`
- Tauri v2 documentation: `D:\Shared_UserData\Downloads\tad\tauri\docs/`
- Existing Frontend source: `tad-master/packages/toadviewer`
- IPC Command aliases: `packages/host-bridge/src/commandAliases.ts`
- Host Adapter: `packages/host-bridge/src/TauriHostAdapter.ts`

## Requirements

### R1. Scaffolding, Toolchain & Jujutsu Version Control
Set up the Tauri v2 project structure at `tauri/project` with Vite 5 and React 18. Update the root `.gitignore` to track `tauri/project/` while strictly excluding build artifacts (`tauri/project/src-tauri/target/`, `node_modules/`, `dist/`). Manage local version control using Jujutsu (`jj`), recording commits under identity `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>` with professional English commit messages. Strictly perform local builds only (never call `git push` or GitHub Release API).

### R2. Native Rust Core, DuckDB Engine & Forensics Ingestion
Implement a 100% Native Rust backend in `src-tauri` using In-Process Tokio Async:
- DuckDB 1.0 connection pool with dual-engine driver (UI query connection and ingestion worker connections).
- QueryExp AST compiler to generate optimized DuckDB SQL.
- Streaming tabular query results to WebView as binary Apache Arrow IPC Stream (`0xFFFFFFFF` marker) via `tauri::ipc::Response`.
- Ingestion pipelines for RFC-4180 CSV/TSV, JSONL/NDJSON, and binary Windows Event Logs (`.evtx`) decoded via Rust SIMD `evtx` crate.
- Write-Ahead Log Parquet state ledger (`toad_ledger.parquet`) and portable environment creating `toadAppData_[5chars]` adjacent to the executable.

### R3. Frontend Porting & Host Bridge Integration
Port and bundle the frontend into `tauri/project/dist/` using Vite 5, reusing React 18, virtualized SlickGrid, pivot table, and ArcSight ESM filter from `tad-master/packages/toadviewer`. Connect the UI via `packages/host-bridge/src/TauriHostAdapter.ts` adhering strictly to IPC command aliases in `packages/host-bridge/src/commandAliases.ts`. Support zero-copy Arrow IPC decoding via `@apache-arrow/es2015-cjs` directly into SlickGrid models. Preserve dark theme and dynamic column wrap/resizing.

### R4. Automated Testing & Verification
Implement and execute automated test suites as planned for Squad 1 and Squad 7:
- Rust Core Unit & Command Tests (`cargo test --verbose` in `src-tauri`).
- Frontend production build verification (`npm run build`).
- Arrow IPC roundtrip integration tests (`node tests/test_tauri_arrow_ipc.js`).
- 100K rows virtual scroll concurrency and memory stress tests (`node tests/test_grid_scroll_stress.js`).

### R5. Production Portable Packaging & Release Audit
Build packaging automation script `tauri/project/tools/package_portable.ps1`:
- Compile optimized binary `Toad-2.5.1-x64-portable.exe` (< 50MB) and compressed archive `Toad-2.5.1-x64-portable.zip` into `tauri/project/releases/`.
- Generate `SHA256SUMS.txt` and verify PE header metadata.
- Strictly adhere to Zero-Duplicate Binary storage policy (no intermediate historical version duplicates).

## Acceptance Criteria

### Automated Test Verification
- [ ] Rust Core unit tests pass with 100% success (`cargo test` in `src-tauri`).
- [ ] Vite frontend build completes without errors (`npm run build`).
- [ ] Arrow IPC binary stream integration test passes with 100% roundtrip accuracy.
- [ ] 100K rows scroll stress test passes (FPS > 55, stable RAM delta < 25MB).

### Functional & Packaging Verification
- [ ] Portable executable `Toad-2.5.1-x64-portable.exe` (< 50MB), archive `Toad-2.5.1-x64-portable.zip`, and `SHA256SUMS.txt` are created in `tauri/project/releases/`.
- [ ] Launching `Toad-2.5.1-x64-portable.exe` opens window in < 300ms and creates portable `toadAppData_[id]` folder adjacent to the executable.
- [ ] Drag-and-drop loading of CSV, Parquet, and EVTX files correctly renders table data in virtualized SlickGrid.
- [ ] Jujutsu repository tracks clean commit history locally under author `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>` without remote git push or GitHub API interactions.
