/**
 * Dedicated Engine Service for TOAD v2.6.0 (Unified Single-Engine Architecture)
 *
 * Runs inside Electron utilityProcess (and headless Node.js child_process / worker_threads).
 * Acts as the Single Source of Truth for:
 *  - DuckDB interactive UI & background ingestion drivers (`reltab-duckdb` + `reltab-fs`)
 *  - `ToadParquetLedger` append-only JSONL WAL + Parquet compaction + Derived Views (`_rx*`)
 *  - Direct Renderer <-> Engine Hybrid Binary protocol over `MessagePort`
 *  - Main <-> Engine `supervisor-rpc` control channel over `process.parentPort`
 */

import * as path from "path";
import * as fs from "fs";
import * as log from "loglevel";

// Hydrate Portable AppData environment BEFORE importing reltab-duckdb / reltab-fs
if (
  typeof global !== "undefined" &&
  !(global as any).toadPortableEnv &&
  typeof process !== "undefined" &&
  process.env.TOAD_PORTABLE_ENV_JSON
) {
  try {
    (global as any).toadPortableEnv = JSON.parse(process.env.TOAD_PORTABLE_ENV_JSON);
  } catch { }
}

import * as reltab from "reltab";
import * as reltabDuckDB from "reltab-duckdb";
import "reltab-duckdb";
import * as reltabFS from "reltab-fs";
import "reltab-fs";
import {
  EngineQueryReq,
  EngineQueryResp,
  postHybridError,
  handleEngineQueryReq,
  dispatchEngineCommand,
} from "reltab";

export function forwardEngineLogs(entries: any[]): void {
  if (!Array.isArray(entries) || entries.length === 0) return;
  const parent = typeof process !== "undefined" ? (process as any).parentPort : null;
  if (parent && typeof parent.postMessage === "function") {
    try {
      parent.postMessage({ type: "toad:log", entries });
      return;
    } catch { }
  }
  if (typeof process !== "undefined" && typeof process.send === "function") {
    try {
      process.send({ type: "toad:log", entries });
      return;
    } catch { }
  }
  try {
    const ToadLogger = require("./toadLogger").ToadLogger;
    if (ToadLogger && typeof ToadLogger.ingestBatch === "function") {
      ToadLogger.ingestBatch(entries);
      return;
    }
  } catch { }
}

function postToSupervisor(msg: any): void {
  const parent = typeof process !== "undefined" ? (process as any).parentPort : null;
  if (parent && typeof parent.postMessage === "function") {
    try {
      parent.postMessage(msg);
      return;
    } catch { }
  }
  if (typeof process !== "undefined" && typeof process.send === "function") {
    try {
      process.send(msg);
    } catch { }
  }
}

if (typeof global !== "undefined") {
  (global as any).__toadEngineLogEmitter = (entry: any) => {
    forwardEngineLogs([entry]);
  };
}

if (typeof process !== "undefined" && typeof process.on === "function") {
  process.on("uncaughtException", (error: any) => {
    const msg =
      error instanceof Error
        ? `${error.message}\n${error.stack}`
        : String(error);
    forwardEngineLogs([
      {
        processTag: "ENGINE",
        moduleTag: "EngineService",
        level: "error",
        message: `Uncaught exception in Engine Worker: ${msg}`,
        timestamp: Date.now(),
      },
    ]);
    console.error("[EngineService] Uncaught exception:", error);
  });

  process.on("unhandledRejection", (reason: any) => {
    const msg =
      reason instanceof Error
        ? `${reason.message}\n${reason.stack}`
        : String(reason);
    forwardEngineLogs([
      {
        processTag: "ENGINE",
        moduleTag: "EngineService",
        level: "error",
        message: `Unhandled rejection in Engine Worker: ${msg}`,
        timestamp: Date.now(),
      },
    ]);
    console.error("[EngineService] Unhandled rejection:", reason);
  });
}

export interface EngineServiceOptions {
  dataPort?: any;
  parentPort?: any;
  customLedgerPath?: string;
  showQueries?: boolean;
}

export interface EngineServiceStatus {
  state: "running" | "initializing" | "recovering" | "stopped";
  pid: number;
  uptime: number;
  queryCount: number;
  activeViewsCount: number;
}

export function mapLedgerFilesToProjectDto(files: any[], fallbackProjectId?: string): any[] {
  return (files || []).map((f: any) => {
    let folderRoot: string | undefined;
    let folderName: string | undefined;
    let relPath: string | undefined;
    if (f.extra_json) {
      try {
        const ex = JSON.parse(f.extra_json);
        folderRoot = ex.folderRoot;
        folderName = ex.folderName;
        relPath = ex.relPath;
      } catch { }
    }
    return {
      filePath: f.source_path,
      fileName: path.basename(f.source_path || "") || "Unnamed File",
      projectId: f.project_id || fallbackProjectId,
      projectName: f.project_name || "Untitled-1",
      fileSizeBytes: f.source_size,
      rowCount: f.row_count,
      status: f.status,
      parquetPath: f.parquet_path,
      folderRoot,
      folderName,
      relPath,
    };
  });
}

class EngineService {
  private static instance: EngineService | null = null;
  private isInitialized = false;
  private isInitializing = false;
  private initPromise: Promise<void> | null = null;
  private lastInitReplay: { count: number; elapsedMs: number } | null = null;
  private processIpcAttached = false;
  private dataPort: any = null;
  private dataPorts: Set<any> = new Set();
  private parentPort: any = null;
  private startTime = Date.now();
  private queryCount = 0;
  private activeViewsCount = 0;
  private customLedgerPath?: string;
  private unsubscribeLedger: (() => void) | null = null;

  public static getInstance(): EngineService {
    if (!EngineService.instance) {
      EngineService.instance = new EngineService();
    }
    return EngineService.instance;
  }

  public async init(options?: EngineServiceOptions): Promise<void> {
    if (options?.dataPort) {
      this.setupDataPort(options.dataPort);
    }
    if (options?.parentPort) {
      this.setupParentPort(options.parentPort);
    } else if (typeof process !== "undefined" && (process as any).parentPort) {
      this.setupParentPort((process as any).parentPort);
    } else if (typeof process !== "undefined" && typeof process.on === "function") {
      this.setupProcessIpc();
    }

    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;
    this.isInitializing = true;

    this.initPromise = (async () => {
      try {
        if (options?.customLedgerPath) {
          this.customLedgerPath = options.customLedgerPath;
        }
        if (options?.showQueries) {
          log.setLevel(log.levels.INFO);
        }

        const ledger = reltabDuckDB.ToadParquetLedger.getInstance();
        if (this.customLedgerPath) {
          (ledger as any).ledgerPath = this.customLedgerPath;
        }

        let sharedDb: any = undefined;
        try {
          const defaultConn = await reltab.getConnection(
            { providerName: "duckdb", resourceId: "" },
            { hidden: false, forExport: true }
          );
          sharedDb = (defaultConn as any)?.db?.db;
          if (typeof (defaultConn as any).evalQueryArrow === "function") {
            log.info("[EngineService] Vectorized Apache Arrow IPC Stream engine ready.");
          }
        } catch (connErr) {
          log.warn("[EngineService] DuckDB initial connection notice:", connErr);
        }

        await ledger.initLedger(sharedDb);

        if (!this.unsubscribeLedger) {
          this.unsubscribeLedger = ledger.subscribe(() => {
            postToSupervisor({ type: "project:workspaceChanged" });
          });
        }

        const replayRes = await this.replayLedgerViews();
        this.lastInitReplay = replayRes;

        this.isInitialized = true;
        postToSupervisor({ type: "views-replayed", ...replayRes });

        if (
          !options?.customLedgerPath &&
          process.env.TOAD_ENGINE_WORKER === "1" &&
          process.env.TOAD_ENGINE_RECOVERY !== "1" &&
          Boolean(process.env.TOAD_PORTABLE_ENV_JSON)
        ) {
          ledger.performStartupReconciliation().catch((err: any) => {
            log.warn("[EngineService] Startup reconciliation warning:", err);
          });
        }

        log.info(`[EngineService] Engine initialized successfully (PID: ${process.pid})`);
        forwardEngineLogs([
          {
            processTag: "ENGINE",
            moduleTag: "EngineService",
            level: "info",
            message: `Engine worker service initialized successfully (PID: ${process.pid})`,
            timestamp: Date.now(),
          },
        ]);
      } finally {
        this.isInitializing = false;
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  /**
   * Re-registers all active Parquet views AND Derived Views (`_rx*`) from Ledger
   * into both the default DuckDB connection and the interactive `reltab-fs` UI DuckDB driver.
   */
  public async replayLedgerViews(): Promise<{ count: number; elapsedMs: number }> {
    const t0 = performance.now();
    const ledger = reltabDuckDB.ToadParquetLedger.getInstance();
    await ledger.initLedger();

    let restoredCount = 0;
    try {
      const dbConn: any = await reltab.getConnection({ providerName: "duckdb", resourceId: "" });
      const primaryDriver: any = dbConn?.db || dbConn;
      const uiDriver: any =
        typeof (reltabFS as any).peekUIDuckDBDriver === "function"
          ? (reltabFS as any).peekUIDuckDBDriver()
          : null;

      const primaryRawConn = primaryDriver?.connPool
        ? await primaryDriver.connPool.take()
        : null;
      const uiRawConn =
        uiDriver && uiDriver !== primaryDriver && uiDriver.connPool
          ? await uiDriver.connPool.take()
          : null;

      const runDdlOnConn = async (rawConn: any, fallbackRunner: any, sql: string, viewIdent?: string) => {
        const execOnce = async (s: string) => {
          if (rawConn && typeof rawConn.exec === "function") {
            await rawConn.exec(s);
          } else if (fallbackRunner && typeof fallbackRunner.runSqlQuery === "function") {
            await fallbackRunner.runSqlQuery(s);
          }
        };
        try {
          await execOnce(sql);
        } catch (err: any) {
          if (viewIdent && String(err?.message || "").includes("of type Table")) {
            await execOnce(`DROP TABLE IF EXISTS "${viewIdent.replace(/"/g, '""')}"`);
            await execOnce(sql);
          } else {
            throw err;
          }
        }
      };

      try {
        const execOnAllEngines = async (sql: string, viewIdent?: string) => {
          await runDdlOnConn(primaryRawConn, dbConn, sql, viewIdent);
          if (uiRawConn || (uiDriver && uiDriver !== primaryDriver)) {
            try {
              await runDdlOnConn(uiRawConn, uiDriver, sql, viewIdent);
            } catch { }
          }
        };

        const entries = ledger.getAllEntries ? ledger.getAllEntries() : [];
        const preparedViews: Array<{
          viewName: string;
          query: string;
          aliasViewName?: string;
          aliasQuery?: string;
          pPath: string;
          rowCount?: number;
        }> = [];
        const usedViewNames = new Set<string>();

        for (const entry of entries) {
          if (entry.status === "READY" && entry.parquet_path) {
            const pPath = entry.parquet_path;
            if (fs.existsSync(pPath) && reltabDuckDB.isValidParquetFileSync(pPath)) {
              try {
                const safePath = pPath.replace(/\\/g, "/");
                let persistedView = "";
                if (entry.extra_json) {
                  try {
                    const ex = JSON.parse(entry.extra_json);
                    if (ex && typeof ex.view === "string" && ex.view.trim()) {
                      persistedView = ex.view.trim();
                    }
                  } catch { }
                }

                let baseIdent = "";
                if (entry.source_path) {
                  let rawBase = path.basename(entry.source_path);
                  if (rawBase.toLowerCase().endsWith(".gz")) {
                    rawBase = rawBase.slice(0, -3);
                  }
                  const ext = path.extname(rawBase);
                  if (ext) {
                    rawBase = rawBase.slice(0, -ext.length);
                  }
                  baseIdent = rawBase.replace(/[^a-zA-Z0-9_]/g, "_");
                } else {
                  baseIdent = path.basename(pPath, ".parquet").replace(/[^a-zA-Z0-9_]/g, "_");
                }
                if (!baseIdent) {
                  baseIdent = "table_restored";
                }
                if (/^[0-9]/.test(baseIdent)) {
                  baseIdent = `t_${baseIdent}`;
                }

                let viewName = persistedView && !usedViewNames.has(persistedView) ? persistedView : baseIdent;
                if (usedViewNames.has(viewName)) {
                  let suffix = 1;
                  while (usedViewNames.has(`${baseIdent}_${suffix}`)) {
                    suffix++;
                  }
                  viewName = `${baseIdent}_${suffix}`;
                }
                usedViewNames.add(viewName);
                if (typeof (reltabDuckDB as any).registerReservedTableName === "function") {
                  (reltabDuckDB as any).registerReservedTableName(viewName);
                }

                const escapedScanPath = safePath.replace(/'/g, "''");
                const query = `CREATE OR REPLACE VIEW "${viewName.replace(/"/g, '""')}" AS SELECT * FROM parquet_scan('${escapedScanPath}')`;
                let aliasViewName: string | undefined;
                let aliasQuery: string | undefined;
                if (baseIdent && baseIdent !== viewName && !usedViewNames.has(baseIdent)) {
                  usedViewNames.add(baseIdent);
                  aliasViewName = baseIdent;
                  aliasQuery = `CREATE OR REPLACE VIEW "${baseIdent.replace(/"/g, '""')}" AS SELECT * FROM parquet_scan('${escapedScanPath}')`;
                }
                preparedViews.push({
                  viewName,
                  query,
                  aliasViewName,
                  aliasQuery,
                  pPath,
                  rowCount: entry.row_count ? Number(entry.row_count) : undefined,
                });
              } catch (statErr) {
                log.warn(`[EngineService] Failed to inspect Parquet for ${pPath}:`, statErr);
              }
            }
          }
        }

        if (preparedViews.length > 0) {
          const batchSql = preparedViews
            .map((v) => (v.aliasQuery ? `${v.query};\n${v.aliasQuery}` : v.query))
            .join(";\n");
          let batchOk = false;
          if (primaryRawConn && typeof primaryRawConn.exec === "function") {
            try {
              await primaryRawConn.exec(batchSql);
              if (uiRawConn && typeof uiRawConn.exec === "function") {
                try {
                  await uiRawConn.exec(batchSql);
                } catch { }
              }
              batchOk = true;
              restoredCount += preparedViews.length;
              for (const v of preparedViews) {
                if (v.rowCount) {
                  (global as any)._toadTableRowCountCache =
                    (global as any)._toadTableRowCountCache || {};
                  (global as any)._toadTableRowCountCache[v.viewName] = v.rowCount;
                  if (v.aliasViewName) {
                    (global as any)._toadTableRowCountCache[v.aliasViewName] = v.rowCount;
                  }
                }
              }
            } catch (batchErr: any) {
              if (String(batchErr?.message || "").includes("of type Table")) {
                try {
                  const dropAndCreateBatch = preparedViews
                    .map((v) => {
                      const mainPart = `DROP TABLE IF EXISTS "${v.viewName.replace(/"/g, '""')}";\n${v.query}`;
                      if (!v.aliasViewName || !v.aliasQuery) return mainPart;
                      return `${mainPart};\nDROP TABLE IF EXISTS "${v.aliasViewName.replace(/"/g, '""')}";\n${v.aliasQuery}`;
                    })
                    .join(";\n");
                  await primaryRawConn.exec(dropAndCreateBatch);
                  if (uiRawConn && typeof uiRawConn.exec === "function") {
                    try {
                      await uiRawConn.exec(dropAndCreateBatch);
                    } catch { }
                  }
                  batchOk = true;
                  restoredCount += preparedViews.length;
                  for (const v of preparedViews) {
                    if (v.rowCount) {
                      (global as any)._toadTableRowCountCache =
                        (global as any)._toadTableRowCountCache || {};
                      (global as any)._toadTableRowCountCache[v.viewName] = v.rowCount;
                      if (v.aliasViewName) {
                        (global as any)._toadTableRowCountCache[v.aliasViewName] = v.rowCount;
                      }
                    }
                  }
                } catch { }
              }
            }
          }

          if (!batchOk) {
            for (const v of preparedViews) {
              try {
                await execOnAllEngines(v.query, v.viewName);
                if (v.aliasQuery && v.aliasViewName) {
                  await execOnAllEngines(v.aliasQuery, v.aliasViewName);
                }
                restoredCount++;
                if (v.rowCount) {
                  (global as any)._toadTableRowCountCache =
                    (global as any)._toadTableRowCountCache || {};
                  (global as any)._toadTableRowCountCache[v.viewName] = v.rowCount;
                  if (v.aliasViewName) {
                    (global as any)._toadTableRowCountCache[v.aliasViewName] = v.rowCount;
                  }
                }
              } catch (viewErr) {
                log.warn(`[EngineService] Failed to restore view for ${v.pPath}:`, viewErr);
              }
            }
          }
        }

        // Replay persisted Derived Views (`_rx*`) in creation order
        const derivedViews =
          typeof ledger.getDerivedViews === "function" ? ledger.getDerivedViews() : [];
        for (const dv of derivedViews) {
          if (dv && dv.sql) {
            try {
              const safeSql = dv.sql.replace(/^CREATE\s+VIEW\b/i, "CREATE OR REPLACE VIEW");
              await execOnAllEngines(safeSql, dv.viewName);
              restoredCount++;
            } catch (dvErr) {
              log.warn(`[EngineService] Failed to replay derived view ${dv.viewName}:`, dvErr);
            }
          }
        }
      } finally {
        if (primaryRawConn && primaryDriver?.connPool) {
          primaryDriver.connPool.giveBack(primaryRawConn);
        }
        if (uiRawConn && uiDriver?.connPool) {
          uiDriver.connPool.giveBack(uiRawConn);
        }
      }
    } catch (err) {
      log.warn("[EngineService] Error during replayLedgerViews:", err);
    }

    const elapsedMs = performance.now() - t0;
    this.activeViewsCount = restoredCount;
    log.info(`[EngineService] replayLedgerViews restored ${restoredCount} views in ${elapsedMs.toFixed(2)} ms`);
    return { count: restoredCount, elapsedMs };
  }

  public setupDataPort(port: any): void {
    this.dataPort = port;
    if (!port) return;
    if (this.dataPorts.has(port)) return;
    this.dataPorts.add(port);
    if (typeof port.on === "function") {
      port.on("close", () => {
        this.dataPorts.delete(port);
      });
    }

    const handleMessage = async (eventOrData: any) => {
      let req: any = eventOrData;
      if (
        eventOrData &&
        typeof eventOrData === "object" &&
        typeof eventOrData.id !== "number" &&
        eventOrData.data !== undefined &&
        typeof eventOrData.data === "object" &&
        typeof eventOrData.data?.id === "number"
      ) {
        req = eventOrData.data;
      }
      if (!req || typeof req.id !== "number") return;
      this.queryCount++;
      await this.handleClientRequest(port, req);
    };

    if (typeof port.on === "function") {
      port.on("message", handleMessage);
    } else if (typeof port.addEventListener === "function") {
      port.addEventListener("message", handleMessage);
    } else if (port.onmessage !== undefined) {
      port.onmessage = handleMessage;
    }

    if (typeof port.start === "function") {
      port.start();
    }

    log.info("[EngineService] Data MessagePort attached and listening.");
  }

  private async handleSupervisorControlMsg(
    msg: any,
    ports: any[] | undefined,
    replyFn: (resp: any) => void
  ): Promise<void> {
    if (!msg) return;

    if (msg.type === "init-data-channel") {
      if (ports && ports[0]) {
        this.setupDataPort(ports[0]);
        replyFn({ type: "data-channel-ready", pid: process.pid });
      }
      return;
    }

    if (msg.type === "ping" || msg.cmd === "ping") {
      replyFn({
        type: "pong",
        seq: msg.seq,
        timestamp: Date.now(),
        pid: process.pid,
      });
      return;
    }

    if (msg.type === "replay-views" || msg.cmd === "replay-views") {
      if (this.initPromise && !this.isInitialized) {
        await this.initPromise;
        replyFn({
          type: "views-replayed",
          ...(this.lastInitReplay || { count: this.activeViewsCount, elapsedMs: 0 }),
        });
        return;
      }
      const res = await this.replayLedgerViews();
      replyFn({ type: "views-replayed", ...res });
      return;
    }

    if (msg.type === "supervisor-rpc" && msg.rpcId) {
      try {
        if (this.initPromise && !this.isInitialized) {
          await this.initPromise;
        }
        const rawData = await this.executeRpcCommand(msg.cmd, msg.payload);
        let data = rawData;
        if (rawData instanceof reltab.TableRep) {
          data = {
            schema: rawData.schema.toJSON(),
            rowData: rawData.rowData,
          };
        } else if (rawData && typeof rawData.toJSON === "function" && !(rawData instanceof Uint8Array)) {
          data = rawData.toJSON();
        }
        replyFn({ type: "supervisor-rpc-result", rpcId: msg.rpcId, ok: true, data });
      } catch (err: any) {
        replyFn({
          type: "supervisor-rpc-result",
          rpcId: msg.rpcId,
          ok: false,
          error: err?.message || String(err),
        });
      }
      return;
    }

    if (msg.type === "shutdown") {
      await this.shutdown();
      process.exit(0);
    }
  }

  public setupParentPort(parentPort: any): void {
    if (!parentPort || this.parentPort === parentPort) return;
    this.parentPort = parentPort;

    const handleParentMsg = async (eventOrData: any) => {
      let msg: any = eventOrData;
      if (
        eventOrData &&
        typeof eventOrData === "object" &&
        !eventOrData.type &&
        !eventOrData.cmd &&
        eventOrData.data !== undefined &&
        typeof eventOrData.data === "object"
      ) {
        msg = eventOrData.data;
      }
      const ports = eventOrData?.ports || msg?.ports;
      await this.handleSupervisorControlMsg(msg, ports, (resp) =>
        parentPort.postMessage(resp)
      );
    };

    if (typeof parentPort.on === "function") {
      parentPort.on("message", handleParentMsg);
    } else if (typeof parentPort.addEventListener === "function") {
      parentPort.addEventListener("message", handleParentMsg);
    } else if (parentPort.onmessage !== undefined) {
      parentPort.onmessage = handleParentMsg;
    }

    if (typeof parentPort.start === "function") {
      parentPort.start();
    }

    log.info("[EngineService] ParentPort attached and monitoring supervisor signals.");
  }

  private setupProcessIpc(): void {
    if (typeof process.send !== "function" || this.processIpcAttached) return;
    this.processIpcAttached = true;

    process.on("message", async (msg: any, sendHandle: any) => {
      await this.handleSupervisorControlMsg(
        msg,
        sendHandle ? [sendHandle] : undefined,
        (resp) => process.send?.(resp)
      );
    });
  }

  public async executeRpcCommand(cmd: string, payload: any): Promise<any> {
    if (cmd === "ping") {
      return "pong";
    }
    if (cmd === "engine:status" || cmd === "status") {
      const status: EngineServiceStatus = {
        state: "running",
        pid: process.pid,
        uptime: Math.round((Date.now() - this.startTime) / 1000),
        queryCount: this.queryCount,
        activeViewsCount: this.activeViewsCount,
      };
      return status;
    }
    if (cmd === "initLedger") {
      const ledger = reltabDuckDB.ToadParquetLedger.getInstance();
      await ledger.initLedger();
      return { success: true };
    }
    if (cmd === "replayLedgerViews" || cmd === "replayViews") {
      return await this.replayLedgerViews();
    }
    if (cmd === "view:registerDerived") {
      const ledger = reltabDuckDB.ToadParquetLedger.getInstance();
      await ledger.initLedger();
      return await ledger.registerDerivedView(payload || {});
    }
    if (cmd === "view:getDerived") {
      const ledger = reltabDuckDB.ToadParquetLedger.getInstance();
      await ledger.initLedger();
      return ledger.getDerivedViews(payload?.projectId);
    }
    if (cmd === "export:parquet") {
      const appRtc = (reltab.getExportConnection() ||
        (await reltab.getConnection(
          { providerName: "duckdb", resourceId: "" },
          { hidden: false, forExport: true }
        ))) as reltab.DbDataSource;
      const query =
        typeof payload?.queryStr === "string"
          ? reltab.deserializeQueryReq(payload.queryStr)
          : payload?.query;
      const baseQuery = await appRtc.getSqlForQuery(query);
      const safeFile = String(payload?.saveFilename || "")
        .replace(/\\/g, "/")
        .replace(/'/g, "''");
      const safeComp =
        String(payload?.compression || "snappy").replace(/[^a-zA-Z0-9_]/g, "") ||
        "snappy";
      const copyQuery = `COPY (${baseQuery}) TO '${safeFile}' (FORMAT 'parquet', COMPRESSION '${safeComp}')`;
      await appRtc.db.runSqlQuery(copyQuery);
      return { success: true };
    }
    if (cmd === "export:getQuerySchema") {
      const appRtc = (reltab.getExportConnection() ||
        (await reltab.getConnection(
          { providerName: "duckdb", resourceId: "" },
          { hidden: false, forExport: true }
        ))) as reltab.DbDataSource;
      const query =
        typeof payload?.queryStr === "string"
          ? reltab.deserializeQueryReq(payload.queryStr)
          : payload?.query;
      const schema = await appRtc.getSchema(query);
      return schema.toJSON();
    }
    if (cmd.startsWith("project:")) {
      const ledger = reltabDuckDB.ToadParquetLedger.getInstance();
      await ledger.initLedger();
      switch (cmd) {
        case "project:getWorkspace":
          return {
            projects: ledger.getProjects(),
            activeProjectId: ledger.getActiveProjectId(),
          };
        case "project:getFiles":
          return mapLedgerFilesToProjectDto(
            ledger.getProjectFiles(payload?.projectId),
            payload?.projectId
          );
        case "project:create":
          return await ledger.createProject(
            payload?.projectName || "Untitled Project",
            payload?.projectId
          );
        case "project:rename":
          return await ledger.renameProject(payload?.projectId, payload?.newName);
        case "project:delete":
          return await ledger.deleteProjectCascade(payload?.projectId);
        case "project:deleteAll":
          return await ledger.deleteAllProjectsCascade();
        case "project:getCacheSize":
          return ledger.getProjectCacheSize(payload?.projectId);
        case "project:purgeCache":
          return await ledger.purgeProjectCache(payload?.projectId);
        case "project:removeFile":
          return await ledger.removeFileFromProject(payload?.projectId, payload?.filePath);
        case "project:addFiles": {
          const added: any[] = [];
          if (payload?.filePaths && Array.isArray(payload.filePaths)) {
            for (const f of payload.filePaths) {
              const entry = await ledger.addFileToProject(payload.projectId, f);
              added.push(entry);
            }
          }
          return added;
        }
        case "project:addFolder": {
          const entries = await ledger.addFolderToProject(
            payload?.projectId,
            payload?.folderPath
          );
          return entries.map((e) => e.source_path);
        }
        case "project:moveOrphanFiles":
          await ledger.moveOrphanFilesToProject(payload?.targetProjectId);
          return { success: true };
        case "project:setActive":
          ledger.setActiveProjectId(payload?.projectId);
          return { success: true };
        case "project:reconcile":
          return await ledger.performStartupReconciliation();
        default:
          throw new Error(`Unknown project command: ${cmd}`);
      }
    }

    return await dispatchEngineCommand(cmd, payload);
  }

  public async handleClientRequest(port: any, req: EngineQueryReq): Promise<EngineQueryResp> {
    if (this.initPromise && !this.isInitialized) {
      await this.initPromise;
    }
    const { id, cmd, payload } = req;

    if (
      cmd === "ping" ||
      cmd === "engine:status" ||
      cmd === "status" ||
      cmd === "initLedger" ||
      cmd === "replayLedgerViews" ||
      cmd === "replayViews" ||
      cmd === "view:registerDerived" ||
      cmd === "view:getDerived" ||
      cmd.startsWith("export:") ||
      cmd.startsWith("project:")
    ) {
      try {
        const result = await this.executeRpcCommand(cmd, payload);
        const resp: EngineQueryResp = { id, ok: true, data: result };
        port.postMessage(resp);
        return resp;
      } catch (err: any) {
        postHybridError(port, id, err);
        return { id, ok: false, error: err?.message || String(err) };
      }
    }

    return await handleEngineQueryReq(req, port);
  }

  public async shutdown(): Promise<void> {
    log.info("[EngineService] Shutting down DuckDB engine & flushing Ledger WAL...");
    try {
      await reltabDuckDB.ToadParquetLedger.getInstance().flushWal();
    } catch { }
    if (this.unsubscribeLedger) {
      this.unsubscribeLedger();
      this.unsubscribeLedger = null;
    }
    for (const p of Array.from(this.dataPorts)) {
      if (p && typeof p.close === "function") {
        try {
          p.close();
        } catch { }
      }
    }
    this.dataPorts.clear();
    this.dataPort = null;
    this.isInitialized = false;
  }
}

export async function startEngineService(
  options?: EngineServiceOptions
): Promise<EngineService> {
  const service = EngineService.getInstance();
  await service.init(options);
  return service;
}

export async function replayLedgerViews(): Promise<{ count: number; elapsedMs: number }> {
  return await EngineService.getInstance().replayLedgerViews();
}

export { EngineService };

if (
  (typeof process !== "undefined" && (process as any).parentPort) ||
  (typeof require !== "undefined" && (require.main === module || !module.parent))
) {
  startEngineService().catch((err) => {
    console.error("[EngineService] Fatal initialization error:", err);
    process.exit(1);
  });
}
