# Handoff Report: TauriHostAdapter, Command Aliases & Arrow IPC Stream Exploration (Milestone M6)

**Agent**: `explorer_m6_bridge` (Squad 6: Host Bridge & IPC Protocol Explorer)  
**Date**: 2026-11-05T01:47:00Z  
**Working Directory**: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m6_bridge`  
**Target Consumer**: `worker_m6_frontend` & Lead Orchestrator (`07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d`)

---

## 1. Observation

### 1.1 Tauri IPC Invocation Architecture
- **Global Tauri Injection**:
  - `tauri/project/src-tauri/tauri.conf.json:14`:
    `"withGlobalTauri": true` is explicitly configured. This ensures the WebView2 runtime injects `window.__TAURI__` with `core.invoke` and `event.listen`/`event.emit`.
  - `tad-master/packages/host-bridge/src/TauriHostAdapter.ts:37-42`:
    ```typescript
    private getTauri(): any {
      if (typeof window !== "undefined") {
        return (window as any).__TAURI__ || null;
      }
      return null;
    }
    ```
  - `TauriHostAdapter.ts:44-57`:
    `invoke<T = any>(cmd, args)` resolves the command alias via `resolveTauriCommand(cmd)` and dispatches to `tauri.core.invoke(tauriCmd, args || {})`.
  - `TauriHostAdapter.ts:59-72`:
    `invokeBinary(cmd, args)` dispatches to `tauri.core.invoke(tauriCmd, args || {})` and normalizes the return value (`Uint8Array`, `ArrayBuffer`, or byte array) into a clean `Uint8Array`.

### 1.2 Binary Arrow IPC Stream Generation & Marker (Rust Backend)
- **Arrow IPC Stream Serialization**:
  - `tauri/project/src-tauri/src/engine/arrow_encoder.rs:57-78`:
    Uses `arrow::ipc::writer::StreamWriter` to encode `RecordBatch`es.
  - Verbatim code at `arrow_encoder.rs:72-78`:
    ```rust
    // 4. Verification assertion: Must start with 0xFFFFFFFF continuation marker
    if buffer.len() >= 4 {
        debug_assert_eq!(
            &buffer[0..4],
            &[0xFF, 0xFF, 0xFF, 0xFF],
            "Arrow IPC stream must begin with 0xFFFFFFFF continuation marker"
        );
    }
    ```
  - Schema metadata injection (`arrow_encoder.rs:42-45`):
    ```rust
    meta.insert("toadSchema".to_string(), schema_json);
    meta.insert("application".to_string(), "Toad-Tauri-v2".to_string());
    let enriched_schema = Arc::new(schema.as_ref().clone().with_metadata(meta));
    ```
  - Response delivery (`arrow_encoder.rs:27`):
    Wraps bytes into `tauri::ipc::Response::new(bytes)`.

### 1.3 Arrow IPC Stream Decoding in Frontend (`hybridProtocol.ts`)
- **Detection of `0xFFFFFFFF` continuation marker**:
  - `tad-master/packages/reltab/src/remote/hybridProtocol.ts:63-81`:
    ```typescript
    export function isArrowIPC(input: any): boolean {
      ...
      if (u8.byteLength < 4) return false;
      return (
        u8[0] === 0xff &&
        u8[1] === 0xff &&
        u8[2] === 0xff &&
        u8[3] === 0xff
      );
    }
    ```
- **Parsing via `@apache-arrow/es2015-cjs` (`tableFromIPC`)**:
  - `hybridProtocol.ts:233-288` (`arrowIPCToTableRep`):
    - `const arrowTable = tableFromIPC(u8);`
    - Metadata extraction (`lines 240-254`):
      ```typescript
      const rawMeta = arrowTable.schema.metadata;
      const toadSchemaStr =
        rawMeta instanceof Map ? rawMeta.get("toadSchema") : (rawMeta as any)?.toadSchema;

      if (toadSchemaStr) {
        try {
          const parsedJson = JSON.parse(toadSchemaStr);
          schema = Schema.fromJSON(parsedJson);
        } catch {
          schema = createSchemaFromArrowFields(fields);
        }
      } else {
        schema = createSchemaFromArrowFields(fields);
      }
      ```
    - Formats columnar data (including decimal scaling and time formatting) into `Row[]`.
    - Returns `TableRep(schema, rows)` with attached `(tableRep as any).arrowTable = arrowTable`.

### 1.4 The `dataPort = true` Activation Gate
- **Client Query Routing**:
  - `tad-master/packages/reltab/src/remote/Connection.ts:259-272` (`RemoteDataSourceConnection.evalQuery`):
    ```typescript
    if (
      this.tconn &&
      typeof (this.tconn as any).invokeBinary === "function" &&
      (this.tconn as any).dataPort
    ) {
      try {
        const u8 = await (this.tconn as any).invokeBinary("evalQuery", payload);
        if (u8 && u8.byteLength > 0) {
          return decodeTableRepBinary(u8);
        }
      } catch (err) {
        console.warn("[RemoteConnection] invokeBinary evalQuery failed, falling back:", err);
      }
    }
    ```
  - **Critical Gap Observed**:
    In `tad-master/packages/host-bridge/src/TauriHostAdapter.ts:16-21`, `TauriHostAdapter` does NOT define `dataPort`.
    Because `(this.tconn as any).dataPort` is `undefined` (falsy), `evalQuery` skips `invokeBinary` and falls back to legacy `invokeDbFunction` with stringified JSON, losing zero-copy binary streaming!

### 1.5 Command Aliases Audit & Missing Handlers
- **Rust Command Router** (`tauri/project/src-tauri/src/commands/mod.rs:72-177`):
  Supports 4 main categories of commands:
  1. System: `toad:init_main`, `toad:get_config`, `toad:open_file_dialog`, `toad:write_clipboard`, `toad:open_url`, `toad:new_window`, `toad:get_setup_info`, `toad:open_example`.
  2. Query & Engine: `toad:eval_query` (`evalQuery`, `DataSourceConnection.evalQuery`), `toad:row_count` (`rowCount`), `toad:schema` (`getTableSchema`), `toad:run_sql_arrow`, `toad:get_table_name`.
  3. Workspace (`project:*`): 14 CRUD commands (`project:get_workspace`, `get_files`, `add_files`, `add_folder`, `delete`, `rename`, `create`, `set_active`, `reconcile`, `delete_all`, `get_cache_size`, `purge_cache`, `remove_file`, `move_orphan_files`).
  4. Forensics / Ingestion: `toad:ingest_file` (`ingestFile`), `toad:ingest_cancel` (`cancelIngest`), `toad:ingest_vip` (`prioritizeIngest`), `toad:get_ingest_queue` (`getIngestQueue`).
- **`commandAliases.ts:5-51` Audit**:
  - Missing all 4 ingestion commands: `toad:ingest_file`, `toad:ingest_cancel`, `toad:ingest_vip`, `toad:get_ingest_queue`.
  - While Rust handles `ingestFile` through fallthrough match clauses, omitting them from `COMMAND_ALIAS_MAP` breaks reverse-lookup consistency in `resolveLegacyCommand` and `resolveTauriCommand`.

### 1.6 HostBridge Default Factory (`index.ts`)
- In `tad-master/packages/host-bridge/src/index.ts:10-15`:
  ```typescript
  export function getHostBridge(): IHostBridge {
    if (!activeBridge) {
      activeBridge = new ElectronHostAdapter();
    }
    return activeBridge;
  }
  ```
  `getHostBridge()` defaults unconditionally to `ElectronHostAdapter()`. In Tauri v2, `window.electron` does not exist, causing unhandled runtime errors if not explicitly overridden via `setHostBridge`.

### 1.7 Verification Test Suite Execution
- Ran `d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe tauri/project/tests/test_tauri_arrow_ipc.js`:
  - 17/17 tests PASS (0 failures, roundtrip execution time 1.50ms).
- Ran `d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe tauri/project/tests/test_grid_scroll_stress.js`:
  - 16/16 tests PASS (0 failures, 100K virtual rows, 0.017ms average latency, > 58,000 equivalent FPS).

---

## 2. Logic Chain

1. **Premise 1 (Arrow Protocol)**:
   DuckDB query results in Tauri v2 are serialized via Arrow `StreamWriter` with leading `[0xFF, 0xFF, 0xFF, 0xFF]` marker and embedded `toadSchema` metadata, returned as `tauri::ipc::Response`.
   *(Supported by Observation 1.2: `arrow_encoder.rs:57-78`)*.

2. **Premise 2 (Zero-Copy Activation Gate)**:
   In `RemoteDataSourceConnection.evalQuery`, line 262 explicitly checks `(this.tconn as any).dataPort`. If truthy and `invokeBinary` is available, it invokes `this.tconn.invokeBinary("evalQuery", payload)` and decodes via `decodeTableRepBinary`. If falsy, it falls back to legacy JSON strings.
   *(Supported by Observation 1.4: `Connection.ts:259-272`)*.

3. **Premise 3 (Tauri Host Adapter Role)**:
   `TauriHostAdapter` is the concrete implementation of `IHostBridge` for Tauri v2. Currently, it does not declare `dataPort: boolean = true`, nor does it normalize stringified `EngineReq` payloads.
   *(Supported by Observation 1.4: `TauriHostAdapter.ts:16-21`)*.

4. **Premise 4 (Automatic Bridge Detection)**:
   Because `getHostBridge()` defaults to `ElectronHostAdapter`, launching the application in Tauri v2 without calling `setHostBridge(new TauriHostAdapter())` or adding auto-detection causes the UI to attempt connecting to non-existent Electron IPC channels.
   *(Supported by Observation 1.6: `index.ts:10-15`)*.

5. **Deduction & Strategy for `worker_m6_frontend`**:
   To successfully port the frontend to Tauri v2 and activate zero-copy Arrow IPC:
   - `TauriHostAdapter` must expose `public readonly dataPort: boolean = true`.
   - `TauriHostAdapter.invoke` and `invokeBinary` must normalize incoming arguments (auto-parsing JSON string arguments and extracting `{ ...parsed, ...parsed.req }`).
   - `commandAliases.ts` must be extended with the 4 missing ingestion aliases.
   - `packages/host-bridge/src/index.ts` should auto-detect `(window as any).__TAURI__`.
   - `tauri/project/src/main.tsx` must be ported from `toad-app/src/appMain.tsx`, initializing `TauriHostAdapter`, binding `RemoteReltabConnection`, configuring `MultipleLoadingManager` and `ProjectWorkspaceManager`, and mounting `AppPane`.

---

## 3. Caveats

- **No Caveats for Protocol**: The Arrow IPC binary stream protocol and 0xFFFFFFFF marker are fully verified and passing in automated unit tests.
- **Assumptions on Frontend Mount**: Assumes Vite 5 bundle in `tauri/project` will build against `tad-master/packages/toadviewer/src` via the existing path aliases in `vite.config.ts`.
- **Backend Readiness**: Rust command router (`commands/mod.rs`), DuckDB engine pool (`duckdb_pool.rs`), Arrow encoder (`arrow_encoder.rs`), Parquet ledger (`workspace.rs`), and Ingestion scheduler (`ingest.rs`) are already fully implemented and verified in Milestones M1-M5.

---

## 4. Conclusion & Concrete Implementation Strategy

### 4.1 Interface Mapping & Contract Summary

| Operation | Canonical Tauri Cmd | Legacy Frontend Channel | Method / DTO | Response Type |
|---|---|---|---|---|
| Query Evaluation | `toad:eval_query` | `evalQuery` / `DataSourceConnection.evalQuery` | `invokeBinary` | Binary Arrow IPC (`0xFFFFFFFF`) |
| Row Count | `toad:row_count` | `rowCount` / `DataSourceConnection.rowCount` | `invoke` | `{ rowCount: number }` |
| Table Schema | `toad:schema` | `getTableSchema` / `DataSourceConnection.getTableSchema` | `invoke` | `reltab.Schema` DTO |
| Run Arbitrary SQL | `toad:run_sql_arrow` | `DataSourceConnection.runSqlQueryArrow` | `invokeBinary` | Binary Arrow IPC (`0xFFFFFFFF`) |
| Active Table Name | `toad:get_table_name` | `DataSourceConnection.getTableName` | `invoke` | `"main_table"` |
| Workspace Tree | `project:get_workspace`| `project:getWorkspace` | `invoke` | `{ activeProjectId, projects }` |
| Project Files | `project:get_files` | `project:getFiles` | `invoke` | `{ projectId, files: [...] }` |
| Add Files | `project:add_files` | `project:addFiles` | `invoke` | `{ addedFiles, success }` |
| Add Folder | `project:add_folder` | `project:addFolder` | `invoke` | `{ addedFiles, count, success }`|
| Delete Project | `project:delete` | `project:delete` | `invoke` | `{ deletedFiles, freedBytes }` |
| Rename Project | `project:rename` | `project:rename` | `invoke` | `{ success: boolean }` |
| Create Project | `project:create` | `project:create` | `invoke` | `{ projectId, name, success }` |
| Set Active Project| `project:set_active` | `project:setActive` | `invoke` | `{ success: boolean }` |
| Ledger Reconcile | `project:reconcile` | `project:reconcile` | `invoke` | `{ reconciledFiles, scenario }` |
| Ingest File | `toad:ingest_file` | `ingestFile` | `invoke` | `{ jobId, fileId, status, ... }` |
| Cancel Ingest | `toad:ingest_cancel` | `cancelIngest` | `invoke` | `{ success, message }` |
| VIP Prioritize | `toad:ingest_vip` | `prioritizeIngest` | `invoke` | `{ success, newQueuePosition }` |
| Ingest Queue | `toad:get_ingest_queue`| `getIngestQueue` | `invoke` | `IngestQueueSnapshot` |

---

### 4.2 Proposed Code Modifications for `worker_m6_frontend`

#### 1. In `tad-master/packages/host-bridge/src/TauriHostAdapter.ts`:
Add `dataPort = true`, argument normalization, and direct helper methods:
```typescript
export class TauriHostAdapter implements IHostBridge {
  readonly engineName: EngineName = "tauri";
  public readonly dataPort: boolean = true; // ACTIVATION GATE FOR ZERO-COPY ARROW IPC
  private clipboardText = "";
  private currentTheme: "light" | "dark" = "light";

  constructor() {}

  public setupDataPort(port: any): void {
    // Tauri uses in-process binary IPC via core.invoke, port is implicitly active
  }

  private normalizeArgs(args?: any): any {
    if (!args) return {};
    if (typeof args === "string") {
      try {
        const parsed = JSON.parse(args);
        if (parsed && typeof parsed === "object" && parsed.req && typeof parsed.req === "object") {
          return { ...parsed, ...parsed.req };
        }
        return parsed;
      } catch {
        return { raw: args };
      }
    }
    if (typeof args === "object" && args.req && typeof args.req === "object") {
      return { ...args, ...args.req };
    }
    return args;
  }

  async invoke<T = any>(cmd: string, args?: Record<string, unknown> | any): Promise<T> {
    const tauriCmd = this.resolveTauriCommand(cmd);
    const tauri = this.getTauri();
    const cleanArgs = this.normalizeArgs(args);
    if (tauri?.core?.invoke) {
      return await tauri.core.invoke(tauriCmd, cleanArgs);
    }
    if ((global as any).__tauriMockInvoke) {
      return await (global as any).__tauriMockInvoke(tauriCmd, cleanArgs);
    }
    throw new Error(
      `[TauriHostAdapter] Tauri runtime not detected for invoking '${cmd}' (mapped to '${tauriCmd}')`
    );
  }

  async invokeBinary(cmd: string, args?: Record<string, unknown> | any): Promise<Uint8Array> {
    const tauriCmd = this.resolveTauriCommand(cmd);
    const tauri = this.getTauri();
    const cleanArgs = this.normalizeArgs(args);
    if (tauri?.core?.invoke) {
      const res = await tauri.core.invoke(tauriCmd, cleanArgs);
      if (res instanceof Uint8Array) return res;
      if (res instanceof ArrayBuffer) return new Uint8Array(res);
      if (typeof Buffer !== "undefined" && Buffer.isBuffer(res)) {
        return new Uint8Array(res.buffer, res.byteOffset, res.byteLength);
      }
      return new Uint8Array(res);
    }
    return new Uint8Array();
  }
  ...
}
```

#### 2. In `tad-master/packages/host-bridge/src/commandAliases.ts`:
Add the missing ingestion commands:
```typescript
  // Forensics & Ingestion Commands
  "toad:ingest_file": "ingestFile",
  "toad:ingest_cancel": "cancelIngest",
  "toad:ingest_vip": "prioritizeIngest",
  "toad:get_ingest_queue": "getIngestQueue",
```

#### 3. In `tad-master/packages/host-bridge/src/index.ts`:
Add automatic environment detection:
```typescript
export function getHostBridge(): IHostBridge {
  if (!activeBridge) {
    if (typeof window !== "undefined" && (window as any).__TAURI__) {
      activeBridge = new TauriHostAdapter();
    } else {
      activeBridge = new ElectronHostAdapter();
    }
  }
  return activeBridge;
}
```

#### 4. In `tauri/project/src/main.tsx`:
Port the application bootstrap from `tad-master/packages/toad-app/src/appMain.tsx`:
1. Ensure BigInt JSON serialization polyfill is loaded.
2. Initialize `TauriHostAdapter`:
   ```typescript
   import { TauriHostAdapter, setHostBridge, getHostBridge } from 'host-bridge';
   const bridge = new TauriHostAdapter();
   setHostBridge(bridge);
   ```
3. Initialize `RemoteReltabConnection(bridge)`.
4. Call `initAppState(rtc, stateRef)`.
5. Listen for `toad:ingest-progress` / `toad-ingest-progress` and forward to `MultipleLoadingManager.getInstance().handleIngestProgress(payload, stateRef)`.
6. Listen for `project:workspaceChanged` and notify `ProjectWorkspaceManager.getInstance()`.
7. Mount `<AppPane>` into `document.getElementById('app')`.

---

## 5. Verification Method

To independently verify all findings and validate the host bridge integration:

1. **Verify Arrow IPC Streaming Roundtrip**:
   ```powershell
   d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe tauri/project/tests/test_tauri_arrow_ipc.js
   ```
   *Expected Result*: 17 Passed, 0 Failed. Confirms `0xFFFFFFFF` marker parsing, `toadSchema` extraction, and simulated `invokeBinary` handoff.

2. **Verify 100K Rows Virtual Scroll & Dynamic Wrap**:
   ```powershell
   d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe tauri/project/tests/test_grid_scroll_stress.js
   ```
   *Expected Result*: 16 Passed, 0 Failed. Confirms virtual viewport linearity, 4-way collapse lifecycle, and memory stability delta < 25MB.

3. **Verify Rust Core Unit & Command Tests**:
   ```powershell
   cd tauri/project/src-tauri
   cargo test --lib
   ```
   *Expected Result*: 100% passing tests across `query_compiler`, `arrow_encoder`, `schema_mapper`, `workspace`, and `ingest`.

4. **Verify Frontend Vite Build**:
   ```powershell
   cd tauri/project
   d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe ..\..\tad-master\node_modules\vite\bin\vite.js build
   ```
   *Expected Result*: Clean build output in `tauri/project/dist/` without unresolved imports.

5. **Invalidation Conditions**:
   - If `(this.tconn as any).dataPort` remains falsy, `evalQuery` will bypass `invokeBinary` and invoke `invokeDbFunction`, triggering legacy text fallback.
   - If `toadSchema` JSON lacks dialect and `Schema.fromJSON` throws without being caught by `createSchemaFromArrowFields`, table rendering will fail.
