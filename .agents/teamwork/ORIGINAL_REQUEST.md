# Original User Request

## Initial Request — 2026-11-03T11:38:14Z

Execute the full rebrand of TAD to TOAD at version v2.4.8, including monorepo package renaming, webpack bundle and HTML updates, backward compatibility for .tad files, build script synchronization, QA regression testing, and portable packaging. User explicitly requested: "triển khai bằng nhiều subagent để triển khai nhanh nhất có thể" (use parallel subagents for fastest execution).

Working directory: d:\Shared_UserData\Downloads\tad
Integrity mode: development

Reference Plan: C:\Users\huydq\.gemini\antigravity\brain\489b863f-84dc-4fd6-bbfb-142488ba4d23\phuong_an_trien_khai_rebrand_toad_v2.4.8.md

## Requirements

### R1. Monorepo Package Renaming & Dependency Updates
Rename packages on disk:
- `tad-master/packages/tad-app` -> `tad-master/packages/toad-app`
- `tad-master/packages/tadviewer` -> `tad-master/packages/toadviewer`
Update package definitions (`package.json`) and all internal TypeScript imports and dependencies across the repository from `tadviewer` to `toadviewer`. Update monorepo references (e.g. `lerna.json` if applicable).

### R2. Webpack Bundle & Asset Synchronization
In `toad-app/webpack.config.js`, change the entry output bundle name to `toadapp.bundle.js`.
In `toad-app/html/index.html` (line 11), update the script tag to `<script src="toadapp.bundle.js"></script>` to ensure the application loads without a blank screen crash.
In `toad-app/package.json` build configuration, update the asar exclusion pattern to `!**/node_modules/toadviewer/**` to maintain the `app.asar` size under 45 MB.

### R3. File Format & Backward Compatibility
Set the default save extension to `.toad` with `toadFileFormatVersion: 2`.
Support transparent backward compatibility to seamlessly open and parse legacy `.tad` workspace files (`tadFileFormatVersion: 1`) without errors, offering to save as `.toad`. Update file type definitions and file filters in file open/save dialogs to prioritize `.toad` while accepting `.tad`.

### R4. Internal SQL Views, UI Classes & Branding
In `packages/reltab-duckdb/src/reltab-duckdb.ts`, update the internal view prefix to `toad_tmpView_${viewCounter++}`.
Update CSS class names and custom events (e.g., `.tad-app-pane` -> `.toad-app-pane`, `tad-query-error` -> `toad-query-error`).
Update titlebar branding to `<File/Project> - TOAD` and About dialog branding to `TOAD - Tabular OLAP Analytics Desktop (v2.4.8)`.

### R5. Build Scripts, Regression Testing & Packaging
Update `fastbuild.ps1`, `dist_package.ps1`, `package_release.ps1`, and `tools/bump_version.js` to reference `toad-app`, `toadviewer`, and `toadapp.bundle.js`.
Bump version to `v2.4.8` following SemVer.
Run all automated regression tests (ensure all 222+ tests pass).
Execute `fastbuild.ps1` to verify build integrity, then package the portable release (`releases/Toad-2.4.8-x64-portable.exe`, `.zip`, `v2.4.8_NOTES.md`, and `SHA256SUMS.txt`), adhering strictly to the Zero-Duplicate Binary Storage policy and Jujutsu (`jj`) VCS.

## Acceptance Criteria

### Package Renaming & Dependencies
- [ ] Directory `tad-master/packages/toad-app` exists and contains the renamed desktop application package.
- [ ] Directory `tad-master/packages/toadviewer` exists and contains the renamed viewer package.
- [ ] No lingering imports of `"tadviewer"` remain in source files; all use `"toadviewer"`.
- [ ] Monorepo package manifests (`package.json`) reflect `toad-app` and `toadviewer`.

### Webpack & HTML Assets
- [ ] Webpack configuration outputs `toadapp.bundle.js`.
- [ ] `toad-app/html/index.html` loads `<script src="toadapp.bundle.js"></script>`.
- [ ] The application starts without blank screen errors caused by missing bundle references.
- [ ] `app.asar` exclusion uses `!**/node_modules/toadviewer/**` and asar archive size remains under 45 MB.

### File Format Compatibility
- [ ] New workspace save operations default to `.toad` format (`toadFileFormatVersion: 2`).
- [ ] Legacy `.tad` files open and display correctly without errors.
- [ ] Open/Save file dialogs list `.toad` as primary and `.tad` as supported format.

### Branding & Internal SQL Views
- [ ] DuckDB internal temporary views are created with `toad_tmpView_` prefix.
- [ ] UI classes and query error events use `toad-` prefixes (`.toad-app-pane`, `toad-query-error`).
- [ ] Titlebar and About dialog display TOAD branding and version `v2.4.8`.

### Build & Release Verification
- [ ] All 222+ test suite cases pass cleanly (`node run_tests.js --all` or `node tests/deep_integration_qa.js`).
- [ ] `fastbuild.ps1` completes successfully with no build or type errors.
- [ ] `dist_package.ps1` and `package_release.ps1` generate `releases/Toad-2.4.8-x64-portable.exe` and `.zip`.
- [ ] `SHA256SUMS.txt` and `v2.4.8_NOTES.md` are updated for v2.4.8.
- [ ] Zero-Duplicate Binary Storage policy in `AGENTS.md` is strictly observed (no duplicate versioned binaries in root or scripts).
- [ ] Changes are tracked cleanly in Jujutsu (`jj`).
