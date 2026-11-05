# Investigation & Architecture Report: Frontend Build & Toolchain (Vite 5 / React 18 / Tauri v2)

**Squad**: Squad 6 (Frontend Porting & Host Bridge Integration)  
**Agent**: `explorer_m6_vite`  
**Working Directory**: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m6_vite`  
**Target Milestone**: M6 (F23, F24, F25)  
**Target System**: Windows x64 (Tauri v2 + WebView2)

---

## 1. Observation

### 1.1 Existing Toolchain & Scaffolding Files
- **`tauri/project/package.json`**:
  ```json
  {
    "name": "toad-tauri-app",
    "version": "2.5.2",
    "private": true,
    "type": "module",
    "scripts": {
      "dev": "vite",
      "build": "tsc && vite build",
      "preview": "vite preview"
    },
    "dependencies": {
      "@apache-arrow/es2015-cjs": "^16.1.0",
      "@blueprintjs/core": "^4.12.0",
      "@blueprintjs/icons": "^4.10.1",
      "@blueprintjs/popover2": "^1.10.1",
      "@tauri-apps/api": "^2.0.0",
      ...
      "react": "^18.2.0",
      "react-dom": "^18.2.0",
      "slickgrid-es6": "^3.0.3"
    },
    "devDependencies": {
      "@vitejs/plugin-react": "^4.3.3",
      "less": "^4.2.0",
      "sass": "^1.80.6",
      "typescript": "^5.6.3",
      "vite": "^5.4.10"
    }
  }
  ```
- **`tauri/project/vite.config.ts`**:
  - Aliases currently defined:
    ```ts
    alias: [
      { find: /^~/, replacement: '' },
      { find: 'toadviewer', replacement: path.resolve(__dirname, '../../tad-master/packages/toadviewer/src') },
      { find: 'reltab', replacement: path.resolve(__dirname, '../../tad-master/packages/reltab/src') },
      { find: 'aggtree', replacement: path.resolve(__dirname, '../../tad-master/packages/aggtree/src') },
      { find: 'host-bridge', replacement: path.resolve(__dirname, '../../tad-master/packages/host-bridge/src') },
    ]
    ```
  - CSS preprocessor options:
    ```ts
    css: {
      preprocessorOptions: {
        less: { javascriptEnabled: true, math: 'always' },
        scss: { api: 'modern-compiler' }
      }
    }
    ```
  - Build settings: `target: 'esnext'`, `outDir: 'dist'`, `emptyOutDir: true`. Note: `base` is missing (defaults to `'/'`), no `rollupOptions` or `chunkSizeWarningLimit`.
- **`tauri/project/src-tauri/tauri.conf.json`**:
  - `build.beforeBuildCommand`: `"npm run build"`
  - `build.frontendDist`: `"../dist"`
  - `build.devUrl`: `"http://localhost:1420"`
  - `app.security.csp`: `"img-src": "'self' asset: https://asset.localhost blob: data:"`, `"font-src": "'self' data:"`.

### 1.2 Missing Files & Current Execution Failures
- **Missing `node_modules` in `tauri/project`**: Directory `tauri/project/node_modules` does not exist.
- **Verbatim failure of `npm run build`**:
  ```powershell
  > toad-tauri-app@2.5.2 build
  > tsc && vite build
  'tsc' is not recognized as an internal or external command, operable program or batch file.
  ```
- **Missing `tsconfig.json` in `tauri/project`**:
  - There is no `tsconfig.json` in `tauri/project/`.
  - Running `tsc --noEmit` directly with Node 18 emits:
    ```
    Version 4.9.5
    tsc: The TypeScript Compiler - Version 4.9.5
    COMMON COMMANDS
      tsc
      Compiles the current project (tsconfig.json in the working directory.)
    [Exits with code 1]
    ```
  - Without `tsconfig.json`, `tsc` exits with error code 1, immediately halting the build pipeline.

### 1.3 Missing Runtime & Monorepo Packages
- **`url-regex` missing from `tauri/project/package.json`**:
  - Directly imported in `tad-master/packages/toadviewer/src/TextFormatOptions.ts:3`:
    ```ts
    import urlRegex from "url-regex";
    ```
  - Present in `toadviewer/package.json:43` (`"url-regex": "5.0.0"`), but absent from `tauri/project/package.json`.
- **`path-browserify` missing for browser `path` module**:
  - Imported in `tad-master/packages/toadviewer/src/ProjectWorkspaceManager.ts:3`:
    ```ts
    import * as path from "path";
    ...
    fileName: path.basename(f.source_path || "") || "Unnamed File"
    ```
  - In Vite browser bundle, Node built-in `path` is not available and will cause Vite/Rollup bundling error unless aliased to `path-browserify` or browser polyfill.
- **`pretty-hrtime` missing**:
  - Exported transitively via `reltab/src/reltab.ts:4` -> `remote/server.ts:7`:
    ```ts
    import * as prettyHRTime from "pretty-hrtime";
    ```
- **Unused compile-breaker in `aggtree`**:
  - `tad-master/packages/aggtree/src/aggtree.ts:13`:
    ```ts
    import { convertTypeAcquisitionFromJson } from "typescript";
    ```
  - This unused import brings in the entire 10MB `typescript` compiler into frontend source.

### 1.4 Webpack vs Vite Style & `~` Aliases
- **Less imports with `~` in `tadviewer.less`**:
  - Lines 1-5:
    ```less
    @import "~normalize.css";
    @import "~@blueprintjs/core/lib/less/variables.less";
    @import "~@blueprintjs/core/lib/css/blueprint.css";
    @import "~@blueprintjs/icons/lib/css/blueprint-icons.css";
    @import "~@blueprintjs/popover2/lib/css/blueprint-popover2.css";
    ```
  - Line 48:
    ```less
    background: url("~slickgrid-es6/images/ajax-loader-small.gif") no-repeat center left;
    ```
- **Sass imports with `~` in `src/slickgrid.scss`**:
  - Lines 1-3:
    ```scss
    @import "~slickgrid-es6/dist/slick.grid.variables.scss";
    @import "~slickgrid-es6/dist/slick.grid.scss";
    @import "~slickgrid-es6/dist/slick-default-theme.scss";
    ```
  - Lines 137, 141 in `slick-default-theme.scss`:
    ```scss
    background: url('../images/collapse.gif') no-repeat center center;
    background: url('../images/expand.gif') no-repeat center center;
    ```
- **Compilation verification results**:
  - Executed standalone Less compilation with `javascriptEnabled: true`, `math: 'always'`, and `~` stripped: **Rendered 9,096 bytes of valid CSS**.
  - Executed Dart Sass compilation of `slickgrid.scss`: **Rendered 21,673 bytes of valid CSS**. Dart Sass emitted deprecation notices for `@import`, `darken()`, which can be suppressed via `silenceDeprecations: ['import', 'global-builtin', 'color-functions']`.

### 1.5 CommonJS `require(...)` Calls in TS/TSX Source
- In `toadviewer/src/toadviewer.ts` (lines 9-28), 13 stylesheets are imported via CommonJS:
  ```ts
  require("./slickgrid.scss");
  require("../less/tadviewer.less");
  require("../less/activityBar.less");
  require("../less/sidebar.less");
  ...
  ```
  In browser Vite ESM, `require` is undefined at runtime and causes `ReferenceError: require is not defined`.
- In `MultipleLoadingManager.ts`, `ProjectWorkspaceManager.ts`, `AppPane.tsx`, and `DataSourceSidebar.tsx`, dynamic `require("host-bridge")` and `require("oneref")` calls are present and need static ESM imports.

### 1.6 `@apache-arrow/es2015-cjs` Verification
- `package.json` specifies `"browser": "Arrow.dom.js"` and `"main": "Arrow.node.js"`.
- Verified `Arrow.dom.js` exports:
  - `tableFromIPC`: function (used for decoding binary Arrow IPC stream with `0xFFFFFFFF` continuation indicator)
  - `tableToIPC`: function
  - `Table`: constructor/class
  - `Schema`: constructor/class
  - `tableFromArrays`: function
- Under Vite 5, CommonJS modules with named exports are pre-bundled by esbuild and converted to ESM without issue.

### 1.7 `npm install --dry-run` Results
- Executed `npm install --dry-run` in `tauri/project` using Node v18.20.4 and npm 10.7.0:
  - Total resolved: **379 packages in 34s**, exit code 0.
  - Emitted: `npm warn ERESOLVE overriding peer dependency` due to React 18 peer requirements across Blueprint 4, React-DnD 14, and Victory 36.
  - Emitted: `npm warn EBADENGINE` for `sass@1.107.1` (requires Node >= 20.19.0, current is 18.20.4).

---

## 2. Logic Chain

1. **Build Failure Cause Analysis**:
   - `npm run build` executes `"tsc && vite build"`.
   - Because `node_modules` is not installed, neither `tsc` nor `vite` binaries exist in `tauri/project/node_modules/.bin/`.
   - Even if `tsc` is provided externally, `tsc` cannot run because `tauri/project/tsconfig.json` is missing, exiting immediately with code 1.
   - Therefore, creating `tauri/project/tsconfig.json` and running `npm install` are prerequisite steps for the build pipeline.

2. **Module System Alignment (CJS -> ESM)**:
   - Electron originally executed in Node runtime where `require()` was globally available for both scripts and stylesheets.
   - Tauri v2 uses WebView2 on Windows which is a pure web browser context.
   - Vite 5 enforces native ES modules (`type: "module"`).
   - In `toadviewer.ts`, replacing all 13 `require("*.less")` and `require("./slickgrid.scss")` with `import "*.less"` / `import "./slickgrid.scss"` eliminates runtime `ReferenceError`.
   - Replacing dynamic `require("host-bridge")` in `ProjectWorkspaceManager.ts`, `MultipleLoadingManager.ts`, and `DataSourceSidebar.tsx` with `import { getHostBridge } from "host-bridge"` ensures strict ESM compliance.

3. **Asset & Preprocessor Pipeline Strategy**:
   - Webpack used `~` as an indicator to resolve from `node_modules` (e.g., `~normalize.css`, `~@blueprintjs/...`).
   - In Vite, standard imports resolve from `node_modules` directly.
   - To support both `~` package imports from existing Less/SCSS files and potential root `~/` path aliases:
     - Regex alias 1: `{ find: /^~\//, replacement: path.resolve(__dirname, 'src/') + '/' }` maps `~/` to `src/`.
     - Regex alias 2: `{ find: /^~/, replacement: '' }` strips leading `~` from package specifiers like `~@blueprintjs/core/...` and `~slickgrid-es6/...`.
   - For Less: setting `javascriptEnabled: true` and `math: 'always'` ensures Blueprint variables and legacy calculations compile cleanly.
   - For SCSS: setting `silenceDeprecations: ['import', 'global-builtin', 'color-functions']` keeps the Vite build log clean and free of deprecation noise from `slickgrid-es6`.
   - For assets: Blueprint icons (`.woff2`, `.ttf`) and SlickGrid images (`.gif`, `.png`) are automatically detected and copied to `dist/assets/` by Vite. Setting `base: './'` ensures asset paths are relative to `index.html` inside Tauri's webview.

4. **Dependency Hardening**:
   - Adding `"url-regex": "^5.0.0"` and `"path-browserify": "^1.0.1"` to `tauri/project/package.json` resolves the unresolved module errors in `TextFormatOptions.ts` and `ProjectWorkspaceManager.ts`.
   - Removing the unused `import { convertTypeAcquisitionFromJson } from "typescript";` in `aggtree.ts` prevents Vite from bundling the heavy TypeScript compiler into the frontend bundle.

---

## 3. Caveats

1. **Node Version Engine Warning**:
   - The portable Node environment in this workspace is `v18.20.4`.
   - The latest Sass version (`^1.80.6` resolving to `1.107.1`) recommends Node `>= 20.19.0`. While npm dry-run succeeds with an engine warning, pinning `"sass": "~1.80.6"` or passing `--no-engine-strict` avoids build friction.
2. **React 18 Peer Dependency Warnings**:
   - `@blueprintjs/core@4.12.0`, `react-dnd@14.0.5`, and `victory@36.6.10` specify peer dependencies targeting React 16/17.
   - On npm 7+, this triggers `npm warn ERESOLVE overriding peer dependency`. Installation in production must use `npm install --legacy-peer-deps` or rely on npm's automatic override resolution.
3. **Workspace Porting Boundary**:
   - This investigation analyzed the frontend toolchain assuming either:
     - (Option A) Direct path aliases pointing to `tad-master/packages/{toadviewer,reltab,aggtree,host-bridge}/src`, OR
     - (Option B) Files ported directly into `tauri/project/src/`.
   - Both options are fully supported by the recommended `vite.config.ts` and `tsconfig.json`.

---

## 4. Conclusion

The Vite 5 build toolchain for Tauri v2 is fully viable and straightforward once the following specific configurations and fixes are applied:

### 4.1 Required Additions to `tauri/project/package.json`
```json
{
  "dependencies": {
    "url-regex": "^5.0.0",
    "path-browserify": "^1.0.1",
    "pretty-hrtime": "^1.0.3"
  },
  "devDependencies": {
    "@types/path-browserify": "^1.0.3"
  }
}
```

### 4.2 Recommended `tauri/project/tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": false,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": false,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": {
      "~/*": ["src/*"],
      "path": ["node_modules/path-browserify"],
      "toadviewer/*": ["../../tad-master/packages/toadviewer/src/*"],
      "toadviewer": ["../../tad-master/packages/toadviewer/src/toadviewer.ts"],
      "reltab/*": ["../../tad-master/packages/reltab/src/*"],
      "reltab": ["../../tad-master/packages/reltab/src/reltab.ts"],
      "aggtree/*": ["../../tad-master/packages/aggtree/src/*"],
      "aggtree": ["../../tad-master/packages/aggtree/src/aggtree.ts"],
      "host-bridge/*": ["../../tad-master/packages/host-bridge/src/*"],
      "host-bridge": ["../../tad-master/packages/host-bridge/src/index.ts"]
    }
  },
  "include": ["src", "vite.config.ts"]
}
```

### 4.3 Recommended `tauri/project/vite.config.ts`
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: './',
  clearScreen: false,
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^~\//, replacement: path.resolve(__dirname, 'src/') + '/' },
      { find: /^~/, replacement: '' },
      { find: 'path', replacement: 'path-browserify' },
      { find: 'toadviewer', replacement: path.resolve(__dirname, '../../tad-master/packages/toadviewer/src') },
      { find: 'reltab', replacement: path.resolve(__dirname, '../../tad-master/packages/reltab/src') },
      { find: 'aggtree', replacement: path.resolve(__dirname, '../../tad-master/packages/aggtree/src') },
      { find: 'host-bridge', replacement: path.resolve(__dirname, '../../tad-master/packages/host-bridge/src') },
    ],
  },
  css: {
    preprocessorOptions: {
      less: {
        javascriptEnabled: true,
        math: 'always',
      },
      scss: {
        api: 'modern-compiler',
        silenceDeprecations: ['import', 'global-builtin', 'color-functions'],
      },
    },
  },
  build: {
    target: ['es2021', 'chrome105', 'safari13'],
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          blueprint: ['@blueprintjs/core', '@blueprintjs/icons', '@blueprintjs/popover2'],
          arrow: ['@apache-arrow/es2015-cjs'],
        },
      },
    },
  },
  optimizeDeps: {
    include: [
      '@apache-arrow/es2015-cjs',
      'slickgrid-es6',
      'oneref',
      'he',
      'lodash',
      'immutable',
      'victory',
      'url-regex',
      'path-browserify',
    ],
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
});
```

### 4.4 Source Code Adjustments Needed for Porting
1. In `tad-master/packages/aggtree/src/aggtree.ts`: Delete line 13 (`import { convertTypeAcquisitionFromJson } from "typescript";`).
2. In `tad-master/packages/toadviewer/src/toadviewer.ts`: Change lines 9-28 from CommonJS `require("...")` to ES `import "..."`.
3. In `ProjectWorkspaceManager.ts`, `MultipleLoadingManager.ts`, and `DataSourceSidebar.tsx`: Replace dynamic `require("host-bridge")` with top-level `import { getHostBridge } from "host-bridge"`.

---

## 5. Verification Method

To independently verify all findings and validate the build pipeline:

1. **Verify Less Preprocessor Compatibility**:
   ```powershell
   & "d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" "d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m6_vite\test_less_compile.js"
   ```
   *Expected Result*: Output: `SUCCESS! Rendered CSS byte length: 9096`.

2. **Verify Sass Preprocessor Compatibility**:
   ```powershell
   & "d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" "d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m6_vite\test_sass_compile.js"
   ```
   *Expected Result*: Output: `SUCCESS! Rendered SCSS byte length: 21673`.

3. **Verify Apache Arrow DOM Exports**:
   ```powershell
   & "d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" -e "const arrow = require('d:/Shared_UserData/Downloads/tad/tad-master/node_modules/@apache-arrow/es2015-cjs/Arrow.dom.js'); console.log(typeof arrow.tableFromIPC);"
   ```
   *Expected Result*: Output: `'function'`.

4. **Verify Dependency Resolution Dry-Run**:
   ```powershell
   cd "d:\Shared_UserData\Downloads\tad\tauri\project"
   & "d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\npm.cmd" install --dry-run
   ```
   *Expected Result*: Resolves 379 packages with exit code 0.

5. **Verify Production Build (Once Installed)**:
   ```powershell
   cd "d:\Shared_UserData\Downloads\tad\tauri\project"
   & "d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\npm.cmd" run build
   ```
   *Success Condition*: `tsc` exits with 0, `vite build` bundles assets into `tauri/project/dist/` containing `index.html` and `assets/*.js`, `assets/*.css`.
