## 2026-11-03T17:25:56Z

You are worker_m4_packaging, a teamwork_worker subagent.
Your working directory is: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m4_packaging\

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

MANDATORY INPUTS (READ BEFORE STARTING WORK):
1. `ORIGINAL_REQUEST.md`: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md` (READ THIS FIRST)
2. `PROJECT.md`: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\PROJECT.md`
3. Frontend Explorer Analysis: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_ipc_frontend\analysis.md`
4. Milestone 3 Handoff: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m3_supervisor\handoff.md`

YOUR EXCLUSIVE WRITE OWNERSHIP:
You own these files exclusively. Concurrent workers will not touch them:
- `tad-master/packages/toad-app/webpack.config.js`
- `package.json` & `tad-master/packages/toad-app/package.json`
- `fastbuild.ps1`, `dist_package.ps1`, `package_release.ps1`

TASK DESCRIPTION — MILESTONE 4:
1. Webpack Compilation for `engineService.bundle.js`:
   - In `tad-master/packages/toad-app/webpack.config.js`, configure a webpack target compiling `app/engineService.ts` -> `dist/engineService.bundle.js`.
   - IMPORTANT: Use `target: "node"`, `externalsPresets: { node: true }`, and `externals: [nodeExternals()]` (do NOT use `electron-utility` as Webpack 5.112.0 does not support it).
   - Test webpack compilation: ensure `main.bundle.js`, `toadapp.bundle.js`, and `engineService.bundle.js` compile cleanly with 0 errors.
2. Build & Packaging Scripts Synchronization:
   - In `fastbuild.ps1`: Add check verifying `dist\engineService.bundle.js` is generated alongside `main.bundle.js` and `toadapp.bundle.js`.
   - In `dist_package.ps1` and `package_release.ps1`:
     - Synchronize version string assertions to `2.5.0`.
     - Verify native binary rule: `duckdb.node` unpacked into `app.asar.unpacked/node_modules/duckdb/lib/binding/duckdb.node`.
     - Enforce size limits: `app.asar` < 45 MB, portable exe < 75 MB.
     - Enforce zero-duplicate binary policy: no duplicate historical version binaries in root or `releases/`.
3. Verification:
   - Run `powershell -ExecutionPolicy Bypass -File fastbuild.ps1` using PowerShell.
   - Run `.\node-v18.20.4-win-x64\node.exe tests/smoke_test.js`.
   - Run `.\node-v18.20.4-win-x64\node.exe tests/legacy_use_cases.js`.
4. Reporting:
   - Write your implementation details to `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m4_packaging\changes.md`.
   - Write a complete handoff report to `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m4_packaging\handoff.md`.
   - Send completion message to orchestrator.
