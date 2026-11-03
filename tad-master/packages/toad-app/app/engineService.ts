/**
 * Dedicated Engine Service for TOAD / Tad
 *
 * Runs inside Electron utilityProcess (and headless Node.js child_process / worker_threads).
 * Hosts the DuckDB connection pool, Ingest pipeline, and ToadParquetLedger WAL.
 * Communicates directly with Renderer across a MessagePort using the Hybrid Data Protocol:
 *  - Small metadata & control: JSON
 *  - Tabular query blocks: Zero-copy Transferable ArrayBuffer
 */

import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as log from "loglevel";
import * as reltab from "reltab";
import * as reltabDuckDB from "reltab-duckdb";
import {
  TableRep,
  Schema,
  Row,
  EngineQueryReq,
  EngineQueryResp,
  encodeTableRepBinary,
  postHybridResponse,
  postHybridError,
  handleEngineQueryReq,
  dispatchEngineCommand,
} from "reltab";

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

class EngineService {
  private static instance: EngineService | null = null;
  private isInitialized = false;
  private isInitializing = false;
  private dataPort: any = null;
  private parentPort: any = null;
  private startTime = Date.now();
  private queryCount = 0;
  private activeViewsCount = 0;
  private customLedgerPath?: string;

  public static getInstance(): EngineService {
    if (!EngineService.instance) {
      EngineService.instance = new EngineService();
    }
    return EngineService.instance;
  }

  public async init(options?: EngineServiceOptions): Promise<void> {
    if (this.isInitialized) return;
    if (this.isInitializing) return;
    this.isInitializing = true;

    try {
      if (options?.customLedgerPath) {
        this.customLedgerPath = options.customLedgerPath;
      }
      if (options?.showQueries) {
        log.setLevel(log.levels.INFO);
      }

      // 1. Initialize DuckDB Driver and default DuckDB connection
      await reltabDuckDB.initToadLedger();
      // Ensure DuckDB provider is initialized in reltab instance cache
      try {
        await reltab.getConnection({ providerName: "duckdb", resourceId: "" });
      } catch (connErr) {
        log.warn("[EngineService] DuckDB initial connection notice:", connErr);
      }

      // 2. Initialize ToadParquetLedger
      const ledger = reltabDuckDB.ToadParquetLedger.getInstance();
      if (this.customLedgerPath) {
        (ledger as any).ledgerPath = this.customLedgerPath;
      }
      await ledger.initLedger();

      // 3. Replay active ledger views into DuckDB
      await this.replayLedgerViews();

      // 4. Attach dataPort if provided
      if (options?.dataPort) {
        this.setupDataPort(options.dataPort);
      }

      // 5. Attach parentPort if provided or from environment
      if (options?.parentPort) {
        this.setupParentPort(options.parentPort);
      } else if (typeof process !== "undefined" && (process as any).parentPort) {
        this.setupParentPort((process as any).parentPort);
      } else if (typeof process !== "undefined" && typeof process.on === "function") {
        this.setupProcessIpc();
      }

      this.isInitialized = true;
      log.info(`[EngineService] Engine initialized successfully (PID: ${process.pid})`);
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Re-registers all active views from toad_ledger.parquet into DuckDB in < 5ms.
   */
  public async replayLedgerViews(): Promise<{ count: number; elapsedMs: number }> {
    const t0 = performance.now();
    const ledger = reltabDuckDB.ToadParquetLedger.getInstance();
    await ledger.initLedger();

    let restoredCount = 0;
    try {
      const dbConn = await reltab.getConnection({ providerName: "duckdb", resourceId: "" });
      const entries = ledger.getAllEntries ? ledger.getAllEntries() : [];

      for (const entry of entries) {
        if (entry.status === "READY" && entry.parquet_path) {
          const pPath = entry.parquet_path;
          if (fs.existsSync(pPath)) {
            try {
              const stat = fs.statSync(pPath);
              if (stat.size > 0) {
                const safePath = pPath.replace(/\\/g, "/");
                const viewName = entry.source_path
                  ? reltabDuckDB.genTableName(entry.source_path)
                  : path.basename(pPath, ".parquet").replace(/[^a-zA-Z0-9_]/g, "_");

                const query = `CREATE OR REPLACE VIEW "${viewName}" AS SELECT * FROM parquet_scan('${safePath}')`;
                await dbConn.runSqlQuery(query);
                restoredCount++;

                if (entry.row_count) {
                  (global as any)._toadTableRowCountCache =
                    (global as any)._toadTableRowCountCache || {};
                  (global as any)._toadTableRowCountCache[viewName] = Number(entry.row_count);
                }
              }
            } catch (viewErr) {
              log.warn(`[EngineService] Failed to restore view for ${pPath}:`, viewErr);
            }
          }
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

  /**
   * Mounts incoming data MessagePort directly from supervisor or handshake.
   */
  public setupDataPort(port: any): void {
    this.dataPort = port;
    if (!port) return;

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

  /**
   * Mounts supervisor control channel (Electron process.parentPort).
   */
  public setupParentPort(parentPort: any): void {
    this.parentPort = parentPort;
    if (!parentPort) return;

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
      if (!msg) return;

      // MessagePort transfer from supervisor
      if (msg.type === "init-data-channel") {
        const ports = eventOrData?.ports || msg.ports;
        if (ports && ports[0]) {
          this.setupDataPort(ports[0]);
          parentPort.postMessage({ type: "data-channel-ready", pid: process.pid });
        }
      } else if (msg.type === "ping" || msg.cmd === "ping") {
        parentPort.postMessage({
          type: "pong",
          seq: msg.seq,
          timestamp: Date.now(),
          pid: process.pid,
        });
      } else if (msg.type === "replay-views" || msg.cmd === "replay-views") {
        const res = await this.replayLedgerViews();
        parentPort.postMessage({ type: "views-replayed", ...res });
      } else if (msg.type === "shutdown") {
        await this.shutdown();
        process.exit(0);
      }
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

  /**
   * Setup Node.js process message channel (for child_process.fork in tests).
   */
  private setupProcessIpc(): void {
    if (typeof process.send !== "function") return;

    process.on("message", async (msg: any, sendHandle: any) => {
      if (!msg) return;
      if (msg.type === "init-data-channel" && sendHandle) {
        this.setupDataPort(sendHandle);
        process.send?.({ type: "data-channel-ready", pid: process.pid });
      } else if (msg.type === "ping") {
        process.send?.({ type: "pong", seq: msg.seq, timestamp: Date.now() });
      } else if (msg.type === "shutdown") {
        await this.shutdown();
        process.exit(0);
      }
    });
  }

  /**
   * Dispatches client requests received over MessagePort.
   */
  public async handleClientRequest(port: any, req: EngineQueryReq): Promise<EngineQueryResp> {
    const { id, cmd, payload } = req;

    // 1. Liveness heartbeat ping
    if (cmd === "ping") {
      const resp: EngineQueryResp = {
        id,
        ok: true,
        data: "pong",
      };
      port.postMessage(resp);
      return resp;
    }

    // 2. Engine status check
    if (cmd === "engine:status" || cmd === "status") {
      const status: EngineServiceStatus = {
        state: "running",
        pid: process.pid,
        uptime: Math.round((Date.now() - this.startTime) / 1000),
        queryCount: this.queryCount,
        activeViewsCount: this.activeViewsCount,
      };
      const resp: EngineQueryResp = { id, ok: true, data: status };
      port.postMessage(resp);
      return resp;
    }

    // 3. Ledger initialization & replay
    if (cmd === "initLedger") {
      try {
        const ledger = reltabDuckDB.ToadParquetLedger.getInstance();
        await ledger.initLedger();
        const resp: EngineQueryResp = { id, ok: true, data: { success: true } };
        port.postMessage(resp);
        return resp;
      } catch (err: any) {
        postHybridError(port, id, err);
        return { id, ok: false, error: err.message };
      }
    }

    if (cmd === "replayLedgerViews" || cmd === "replayViews") {
      try {
        const res = await this.replayLedgerViews();
        const resp: EngineQueryResp = { id, ok: true, data: res };
        port.postMessage(resp);
        return resp;
      } catch (err: any) {
        postHybridError(port, id, err);
        return { id, ok: false, error: err.message };
      }
    }

    // 4. Project Workspace Ledger Commands
    if (cmd.startsWith("project:")) {
      try {
        const ledger = reltabDuckDB.ToadParquetLedger.getInstance();
        await ledger.initLedger();
        let result: any;
        switch (cmd) {
          case "project:getWorkspace":
            result = {
              projects: ledger.getProjects(),
              activeProjectId: ledger.getActiveProjectId(),
            };
            break;
          case "project:getFiles":
            result = ledger.getProjectFiles(payload?.projectId);
            break;
          case "project:create":
            result = await ledger.createProject(
              payload?.projectName || "Untitled Project",
              payload?.projectId
            );
            break;
          case "project:rename":
            result = await ledger.renameProject(payload?.projectId, payload?.newName);
            break;
          case "project:delete":
            result = await ledger.deleteProjectCascade(payload?.projectId);
            break;
          case "project:deleteAll":
            result = await ledger.deleteAllProjectsCascade();
            break;
          case "project:getCacheSize":
            result = ledger.getProjectCacheSize(payload?.projectId);
            break;
          case "project:purgeCache":
            result = await ledger.purgeProjectCache(payload?.projectId);
            break;
          case "project:removeFile":
            result = await ledger.removeFileFromProject(payload?.projectId, payload?.filePath);
            break;
          case "project:addFiles":
            result = [];
            if (payload?.filePaths && Array.isArray(payload.filePaths)) {
              for (const f of payload.filePaths) {
                const entry = await ledger.addFileToProject(payload.projectId, f);
                result.push(entry);
              }
            }
            break;
          case "project:addFolder":
            result = await ledger.addFolderToProject(payload?.projectId, payload?.folderPath);
            break;
          case "project:moveOrphanFiles":
            await ledger.moveOrphanFilesToProject(payload?.targetProjectId);
            result = { success: true };
            break;
          case "project:setActive":
            ledger.setActiveProjectId(payload?.projectId);
            result = { success: true };
            break;
          case "project:reconcile":
            result = await ledger.performStartupReconciliation();
            break;
          default:
            throw new Error(`Unknown project command: ${cmd}`);
        }
        const resp: EngineQueryResp = { id, ok: true, data: result };
        port.postMessage(resp);
        return resp;
      } catch (err: any) {
        postHybridError(port, id, err);
        return { id, ok: false, error: err.message };
      }
    }

    // 5. Standard Relational Data Commands (evalQuery, rowCount, getTableSchema, runSqlQuery, etc.)
    return await handleEngineQueryReq(req, port);
  }

  public async shutdown(): Promise<void> {
    log.info("[EngineService] Shutting down DuckDB engine...");
    if (this.dataPort && typeof this.dataPort.close === "function") {
      try {
        this.dataPort.close();
      } catch {}
    }
    this.isInitialized = false;
  }
}

/**
 * Programmatic bootstrap entrypoint for tests and supervisor.
 */
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

// Auto-run if executed as standalone process (Electron utilityProcess or Node CLI)
if (typeof require !== "undefined" && require.main === module) {
  startEngineService().catch((err) => {
    console.error("[EngineService] Fatal initialization error:", err);
    process.exit(1);
  });
}
