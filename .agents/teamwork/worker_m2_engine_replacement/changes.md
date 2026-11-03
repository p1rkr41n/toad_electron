# Milestone 2 Implementation Changes: Dedicated Engine Service & Hybrid Data Protocol

**Subagent**: `worker_m2_engine_replacement`  
**Milestone**: Milestone 2 (M2 - Dedicated Engine Service & Hybrid Data Protocol)  
**Parent Agent**: `531c42c5-3aec-4e19-a1ab-7c1a352f15c4`  
**Date**: 2026-11-04  

---

## 1. Summary of Changes

Milestone 2 establishes the isolated computational backend for TOAD v2.5.0:
1. **Hybrid Data Protocol (`tad-master/packages/reltab/src/remote/hybridProtocol.ts`)**:
   - Zero-copy binary wire format for `TableRep`: Magic bytes `TOAD` (`0x54 0x4F 0x41 0x44`), version uint32, metadata length N, UTF-8 JSON schema header, and zero-copy transferable `ArrayBuffer` data payload.
   - Structured JSON for lightweight commands and metadata (rowCount, getTableSchema, getTableName, project workspace commands).
   - Safe serialization for non-cloneable objects (extracting `schema.toJSON()` and fallback JSON clone guard to prevent `DataCloneError` across MessagePort).

2. **MessagePort Transport & Remote Connection (`tad-master/packages/reltab/src/remote/Connection.ts` & `server.ts`)**:
   - `MessagePortTransport`: Point-to-point asynchronous request/response dispatcher over `MessagePort` (works in Electron MessagePort, DOM MessagePort, and Node.js `worker_threads.MessagePort`).
   - Fixed critical message unwrapping bug: ensured responses with `data` field (e.g. `{ id: 1, ok: true, data: "pong" }`) are not erroneously treated as DOM MessageEvents, preventing request hangs.
   - Extended `RemoteReltabConnection` and `RemoteDataSourceConnection` to route queries (`evalQuery`, `rowCount`, `getTableSchema`, `runSqlQuery`, etc.) directly through `dataPort` when available, with zero-copy `TableRep` reconstitution.
   - Implemented `dispatchEngineCommand` and `handleEngineQueryReq` in `server.ts` to execute DuckDB queries and return hybrid binary packets.

3. **Dedicated Engine Service (`tad-master/packages/toad-app/app/engineService.ts` & `backend/src/engineService.ts`)**:
   - `EngineService`: Singleton service running in `utilityProcess` (and test processes) hosting the DuckDB driver pool, `ToadParquetLedger` WAL, and data ingestion pipeline.
   - Listens on `parentPort` for lifecycle events (`init-data-channel`, `ping`, `replay-views`, `shutdown`).
   - Direct `setupDataPort(port)` attaching incoming `port2` for zero-overhead query execution.
   - `replayLedgerViews()`: Restores all `READY` files in `toad_ledger.parquet` into DuckDB views via `CREATE OR REPLACE VIEW ... AS SELECT * FROM parquet_scan(...)`.
   - Exported `startEngineService()` and `replayLedgerViews()`.
   - Re-exported via `tad-master/packages/backend/src/engineService.ts`.

4. **Build Configuration (`tad-master/packages/reltab/tsconfig.json`)**:
   - Updated `"include": ["./src/**/*"]` to recursively compile `src/remote/*.ts` into `dist/remote/`, aligning output with package exports.

5. **Verification Test Suite (`tests/verify_engine_service.js`)**:
   - 8-step comprehensive automated verification covering module exports, MessageChannel setup, EngineService startup, ping/pong, status check, Parquet ledger init, DuckDB table creation, `rowCount`, `getTableSchema`, `evalQuery` zero-copy binary transfer with magic byte assertion, `RemoteReltabConnection` dispatch, `replayLedgerViews`, and 100-query throughput benchmark (2.18 ms/query).

---

## 2. File Modification Details

### `tad-master/packages/reltab/src/remote/hybridProtocol.ts` (NEW)
- Implements `encodeTableRepBinary`, `decodeTableRepBinary`, `isHybridBinary`.
- Implements `postHybridResponse` and `postHybridError`.
- Handles `toJSON()` conversion and structured clone safety fallback.

### `tad-master/packages/reltab/src/remote/Connection.ts`
- Added `MessagePortTransport` class for bidirectional RPC over `MessagePort`.
- Extended `RemoteDataSourceConnection` with `portTransport` path:
  - `evalQuery`: sends query over MessagePort and receives zero-copy reconstituted `TableRep`.
  - `rowCount`, `getTableSchema`, `getColumnStatsMap`, `getRootNode`, `getChildren`, `getTableName`, `runSqlQuery`.
- Extended `RemoteReltabConnection` with `dataPort` setter and constructor injection.
- Extended `invokeDbFunction` to handle incoming binary `ArrayBuffer` payloads.

### `tad-master/packages/reltab/src/remote/server.ts`
- Re-exports `hybridProtocol`.
- Implemented `dispatchEngineCommand(cmd, payload)` mapping normalized commands to `DataSourceConnection`.
- Implemented `handleEngineQueryReq(req, port)` executing queries and posting hybrid binary responses.

### `tad-master/packages/reltab/tsconfig.json`
- Changed `"include": ["./src/*.ts*", "./test/*.ts*"]` to `"include": ["./src/**/*"]`.

### `tad-master/packages/toad-app/app/engineService.ts` (NEW)
- Implemented `EngineService` class with lifecycle management, DuckDB pool, and WAL replay.
- Implemented `setupDataPort`, `setupParentPort`, `setupProcessIpc`, `handleClientRequest`, `replayLedgerViews`, `shutdown`.
- Exported `startEngineService` and `replayLedgerViews`.

### `tad-master/packages/backend/src/engineService.ts` (NEW)
- Proxy re-exporting `../../toad-app/app/engineService`.

### `tests/verify_engine_service.js` (NEW)
- 8-phase test suite verifying all Milestone 2 deliverables headlessly.

---

## 3. Verification Commands & Results

1. **Reltab TypeScript Compilation**:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe tad-master/node_modules/typescript/bin/tsc -p tad-master/packages/reltab/tsconfig.json
   ```
   *Result*: Code 0. Emitted `dist/reltab.js`, `dist/remote/hybridProtocol.js`, `dist/remote/Connection.js`, `dist/remote/server.js`.

2. **Toad-App TypeScript Compilation**:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe tad-master/node_modules/typescript/bin/tsc -p tad-master/packages/toad-app/tsconfig.json --module CommonJS --outDir tad-master/packages/toad-app/dist
   ```
   *Result*: Code 0. Emitted `dist/app/engineService.js`, `dist/app/engineService.d.ts`.

3. **Milestone 2 Verification Suite (`tests/verify_engine_service.js`)**:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe tests/verify_engine_service.js
   ```
   *Result*: 100% PASS across all 8 checks.
   - Ping/pong: "pong"
   - Status: `{ state: "running", pid: 31240, uptime: 1, queryCount: 2, activeViewsCount: 251 }`
   - Parquet Ledger: `{ success: true }`
   - DuckDB `rowCount`: 3
   - `getTableSchema`: `[id, name, score, flag, note]`
   - `evalQuery`: 3 rows decoded into `TableRep`, magic bytes `'TOAD'` verified, 658-byte ArrayBuffer transferred.
   - `RemoteReltabConnection`: clean dispatch over MessagePort without fallback.
   - 100 queries throughput benchmark: 217.7 ms (avg 2.18 ms/query).

4. **Regression Test Suites**:
   - `tests/smoke_test.js`: PASS 100% (PE Header MZ valid, app.asar valid, zero BigQuery remnants).
   - `tests/legacy_use_cases.js`: PASS 19/19 (100%).
   - `tests/test_preload_3_pages.js`: PASS 10/10 (100%).
   - `tests/test_csv_empirical_challenger.js`: PASS 12/12 (100%).
