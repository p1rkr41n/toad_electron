# Progress — Worker M4 Packaging

Last visited: 2026-11-04T00:43:00Z

## Status: COMPLETED

### Completed Steps:
1. Configured Webpack target `engine` in `tad-master/packages/toad-app/webpack.config.js`:
   - `target: "node"`
   - `entry: { engineService: "./app/engineService.ts" }`
   - `externalsPresets: { node: true }`
   - `externals: [nodeExternals(), nodeExternals({ modulesDir: "../../node_modules" })]`
   - `node: { __dirname: false, __filename: false }`
   - Integrated into `configMap` for development and production modes.
2. Verified direct Webpack compilation:
   - `main.bundle.js` (78.5 KiB), `toadapp.bundle.js` (4.97 MiB), and `engineService.bundle.js` (12.6 KiB) compiled cleanly with 0 errors.
   - Verified that production sourcemaps (`.map`) are absent.
3. Updated `fastbuild.ps1`:
   - Added verification asserting `dist\engineService.bundle.js` exists alongside `main.bundle.js` and `toadapp.bundle.js`.
   - Executed `fastbuild.ps1` with 0 errors.
4. Synchronized `dist_package.ps1`:
   - Updated version assertions to `2.5.0`.
   - Added verification for `engineService.bundle.js` on disk and inside `app.asar`.
   - Verified native binary unpacking rule for `duckdb.node` in `app.asar.unpacked/node_modules/duckdb/lib/binding/duckdb.node`.
   - Enforced size limits: `app.asar` footprint 25.54 MB (< 45 MB threshold); portable exe 72.11 MB (< 75 MB threshold).
   - Enforced zero-duplicate binary storage policy: actively prunes non-canonical historical version binaries.
   - Executed `dist_package.ps1` with 0 errors.
5. Synchronized `package_release.ps1`:
   - Updated version assertion to `2.5.0`.
   - Verified `duckdb.node` in `app.asar.unpacked`.
   - Enforced size gates and zero-duplicate binary storage policy.
   - Executed `package_release.ps1` with 0 errors (generated `.zip`, `SHA256SUMS.txt`, Winget manifest).
6. Ran automated regression and verification test suites:
   - `smoke_test.js`: PASS 100% (PE MZ header, ASAR integrity, live process bootstrap).
   - `legacy_use_cases.js`: PASS 19/19 (100%).
   - `test_preload_3_pages.js`: PASS 10/10 (100%).
   - `test_engine_crash_recovery.js`: PASS 7/7 (100%).
7. Documenting changes in `changes.md` and `handoff.md`.
