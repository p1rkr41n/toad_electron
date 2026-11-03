# Milestone 4 Implementation Changes: Packaging, Webpack Bundling & Release Synchronization

## 1. Overview
Milestone 4 integrates `engineService.ts` into the build and distribution pipeline by:
- Creating a Webpack compilation target producing `dist/engineService.bundle.js` with `target: "node"`.
- Synchronizing `fastbuild.ps1` to assert `dist\engineService.bundle.js`.
- Updating `dist_package.ps1` and `package_release.ps1` to assert `v2.5.0`, verify `duckdb.node` in `app.asar.unpacked`, verify `engineService.bundle.js` presence inside `app.asar`, enforce strict size gates (`app.asar` < 45 MB, portable exe < 75 MB), and enforce the zero-duplicate binary storage policy.

---

## 2. File Modifications

### 2.1 `tad-master/packages/toad-app/webpack.config.js`
- **Target `engine` Added**:
  ```javascript
  var engine = {
    target: "node",
    entry: {
      engineService: "./app/engineService.ts",
    },
    externalsPresets: { node: true },
    externals: [
      nodeExternals(),
      nodeExternals({ modulesDir: "../../node_modules" }),
    ],
    node: {
      __dirname: false,
      __filename: false,
    },
  };
  ```
- **Configuration Map Updated**:
  Both `development` and `production` configurations now merge `engine` alongside `app` and `render`:
  ```javascript
  const configMap = {
    development: [
      merge(app, development()),
      merge(render, development()),
      merge(engine, development()),
    ],
    production: [
      merge(app, production()),
      merge(render, production()),
      merge(engine, production()),
    ],
  };
  ```
- **Rationale**: Webpack 5.112.0 does not recognize `electron-utility`. Because Electron `utilityProcess` runs a standard Node.js V8 execution environment with `process.parentPort` and native `.node` addon compatibility, compiling with `target: "node"` and `nodeExternals` ensures all external dependencies (e.g. `duckdb`, `reltab`, `loglevel`) are loaded dynamically from the runtime `node_modules` and `app.asar.unpacked`.

### 2.2 `fastbuild.ps1`
- Added bundle verification assertion in Step 2:
  ```powershell
  if (-not (Test-Path "$appDir\dist\engineService.bundle.js")) {
      throw "ERROR: dist\engineService.bundle.js was not generated!"
  }
  ```
- **Rationale**: Guarantees that unpacked fast builds always contain the dedicated engine bundle alongside `main.bundle.js` and `toadapp.bundle.js`.

### 2.3 `dist_package.ps1`
- **Bundle & Version Assertions (Step 3)**:
  - Added assertion checking `$appDir\dist\engineService.bundle.js` exists.
  - Synchronized version check to recognize `v2.5.0`.
  - Added check confirming absence of `.map` sourcemap files for `engineService.bundle.js` and `main.bundle.js`.
- **ASAR Contents Verification (Step 4.1)**:
  - Added assertion checking `engineService.bundle.js` is present in `app.asar`:
    ```powershell
    if (!list.some(f => f.includes('engineService.bundle.js'))) {
        console.error('ERROR: engineService.bundle.js is missing from app.asar!');
        process.exit(1);
    }
    ```
- **Zero-Duplicate Binary Storage Policy (Step 5.1)**:
  - Added active pruning of historical duplicate binaries matching `Toad *.exe` from both repository root and `releases/`.

### 2.4 `package_release.ps1`
- Synchronized version to `2.5.0`.
- Verified native binary unpacking rule: asserts `duckdb.node` in `app.asar.unpacked/node_modules/duckdb/lib/binding/duckdb.node`.
- Verified size limits:
  - `app.asar` footprint < 45 MB.
  - portable exe < 75 MB.
- Enforced zero-duplicate binary policy in root and `releases/`.

---

## 3. Verification & Execution Results
1. **Webpack Compilation**:
   - `main.bundle.js`: 78.5 KiB (0 errors)
   - `toadapp.bundle.js`: 4.97 MiB (0 errors)
   - `engineService.bundle.js`: 12.6 KiB (0 errors)
2. **Fastbuild Execution (`fastbuild.ps1`)**:
   - Completed in 74.9s with 0 errors.
   - Deployed runnable build to `build/Toad-2.5.0/Toad.exe` (271.6 MB unpacked directory).
3. **Distribution Packaging (`dist_package.ps1`)**:
   - `app.asar` footprint: 25.54 MB (< 45 MB budget).
   - Portable executable: `Toad-2.5.0-x64-portable.exe` at 72.11 MB (< 75 MB budget).
   - `duckdb.node` verified in `app.asar.unpacked`.
   - `engineService.bundle.js` verified present inside `app.asar`.
4. **Release Packaging (`package_release.ps1`)**:
   - Packaged `Toad-2.5.0-x64-portable.zip` (72.12 MB).
   - Computed SHA-256 integrity ledger in `releases/SHA256SUMS.txt`.
   - Generated Winget Manifest: `releases/HelloKittyXamKinLung.Toad.yaml`.
5. **Regression Test Suites**:
   - `tests/smoke_test.js`: PASS 100% (PE MZ valid, ASAR valid, live process bootstrap clean).
   - `tests/legacy_use_cases.js`: PASS 19/19 (100%).
   - `tests/test_preload_3_pages.js`: PASS 10/10 (100%).
   - `tests/test_engine_crash_recovery.js`: PASS 7/7 (100%).
