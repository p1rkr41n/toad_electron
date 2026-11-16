/**
 * Engine Supervisor for TOAD v2.6.0
 *
 * Supervises the Dedicated Engine Service (Electron utilityProcess) lifecycle:
 * 1. Spawns engineService via Electron utilityProcess.fork() (with fallback in headless environments),
 *    passing Portable AppData environment so EngineService is the Single Source of Truth.
 * 2. Establishes race-free MessageChannelMain channels between EngineService and all BrowserWindows.
 * 3. Provides `invokeEngine(cmd, payload)` RPC proxy for Main-originated or pre-port fallback requests.
 * 4. Forwards `toad-ingest-progress`, `cache:invalidate`, and `project:workspaceChanged` events to UI windows.
 * 5. Supervises isolated ingest workers requested by EngineService without `ELECTRON_RUN_AS_NODE`.
 * 6. Auto-restarts crashed EngineService within < 500ms and replays Parquet + Derived (`_rx*`) views.
 */

import * as path from "path";
import * as fs from "fs";
import * as cp from "child_process";
import { EventEmitter } from "events";
import log from "electron-log";
import electron, { BrowserWindow, ipcMain, app } from "electron";
import { PortableEnvironment } from "./portableAppData";
import ToadLogger from "./toadLogger";

function loadLegacyReltabDuckDB(): typeof import("reltab-duckdb") {
  return require("reltab-duckdb");
}

function loadLegacyEngineService(): typeof import("./engineService") {
  return require("./engineService");
}

export type EngineMode = "utility" | "legacy";

export interface EngineSupervisorStatus {
  state: "running" | "restarting" | "stopped" | "legacy";
  engineMode: EngineMode;
  pid: number | null;
  uptime: number;
  restartCount: number;
  activeWindowsCount: number;
  lastRestartReason?: string;
  lastRecoveryElapsedMs?: number;
}

export interface EngineRestoredEvent {
  timestamp: number;
  restoredViewsCount: number;
  elapsedMs: number;
  pid: number | null;
}

export class EngineSupervisor extends EventEmitter {
  private static instance: EngineSupervisor | null = null;

  private childProcess: any = null;
  private childPid: number | null = null;
  private engineMode: EngineMode = "utility";
  private isStarted = false;
  private isShuttingDown = false;
  private isRestarting = false;
  private startTime = 0;
  private restartCount = 0;
  private restartTimestamps: number[] = [];
  private lastRestartReason?: string;
  private lastRecoveryElapsedMs?: number;
  private registeredWindows: Set<BrowserWindow> = new Set();
  private pendingReplayResolvers: Array<(res: { count: number; elapsedMs: number }) => void> = [];
  private rpcSeq = 1;
  private pendingSupervisorRpcs: Map<
    string,
    { resolve: (val: any) => void; reject: (err: any) => void; timer: NodeJS.Timeout }
  > = new Map();
  private ipcHandlersRegistered = false;

  private constructor() {
    super();
  }

  public static getInstance(): EngineSupervisor {
    if (!EngineSupervisor.instance) {
      EngineSupervisor.instance = new EngineSupervisor();
    }
    return EngineSupervisor.instance;
  }

  public resolveEngineMode(): EngineMode {
    if (process.env.TOAD_ENGINE_MODE === "legacy") {
      return "legacy";
    }
    const env = (global as any).toadPortableEnv as PortableEnvironment | undefined;
    const configuredMode = (env?.config as any)?.runtime?.engine;
    if (configuredMode === "legacy") {
      return "legacy";
    }
    return "utility";
  }

  public async start(mainWindow?: BrowserWindow): Promise<void> {
    if (this.isStarted) {
      if (mainWindow) {
        this.attachWindow(mainWindow);
      }
      return;
    }

    this.engineMode = this.resolveEngineMode();
    this.isShuttingDown = false;
    this.startTime = Date.now();

    if (mainWindow) {
      this.attachWindow(mainWindow);
    }

    if (app && typeof app.on === "function") {
      app.on("browser-window-created", (_, win) => {
        if (win) {
          this.attachWindow(win);
        }
      });
    }

    this.registerIpcHandlers();

    if (this.engineMode === "legacy") {
      log.info("[EngineSupervisor] Mode: 'legacy' - initializing DuckDB in-process.");
      try {
        const reltabDuckDB = loadLegacyReltabDuckDB();
        await reltabDuckDB.initToadLedger();
        const ledger = reltabDuckDB.ToadParquetLedger.getInstance();
        await ledger.initLedger();
        await ledger.performStartupReconciliation();
      } catch (err) {
        log.warn("[EngineSupervisor] In-process legacy initialization error:", err);
      }
      this.isStarted = true;
      return;
    }

    log.info("[EngineSupervisor] Mode: 'utility' - spawning dedicated engine utilityProcess.");
    await this.spawnChildProcess();
    this.isStarted = true;
  }

  private buildChildEnv(isRecovery = false): NodeJS.ProcessEnv {
    const cleanEnv: NodeJS.ProcessEnv = {
      ...process.env,
      TOAD_ENGINE_WORKER: "1",
    };
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    if (isRecovery) {
      cleanEnv.TOAD_ENGINE_RECOVERY = "1";
    } else {
      delete cleanEnv.TOAD_ENGINE_RECOVERY;
    }
    if ((global as any).toadPortableEnv) {
      try {
        cleanEnv.TOAD_PORTABLE_ENV_JSON = JSON.stringify((global as any).toadPortableEnv);
      } catch {}
    }
    return cleanEnv;
  }

  private async spawnChildProcess(connectPorts = true, isRecovery = false): Promise<void> {
    const scriptPath = this.resolveScriptPath();
    log.info(`[EngineSupervisor] Spawning engine service from: ${scriptPath}`);

    const utilityProcessApi = (electron as any)?.utilityProcess;
    const childEnv = this.buildChildEnv(isRecovery);

    if (utilityProcessApi && typeof utilityProcessApi.fork === "function") {
      const child = utilityProcessApi.fork(scriptPath, [], {
        serviceName: "Toad Engine Service",
        stdio: "inherit",
        env: childEnv,
      });
      this.childProcess = child;
      this.childPid = child.pid || null;
      this.bindChildEvents(child);
    } else {
      log.warn("[EngineSupervisor] Electron utilityProcess not available, falling back to child_process.fork");
      const child = cp.fork(scriptPath, [], {
        stdio: ["ignore", "inherit", "inherit", "ipc"],
        env: childEnv,
      });
      this.childProcess = child;
      this.childPid = child.pid || null;
      this.bindChildEvents(child);
    }

    log.info(`[EngineSupervisor] Engine child spawned successfully (PID: ${this.childPid})`);
    if (connectPorts) {
      this.connectPortsToAllWindows();
    }
  }

  private postToChild(msg: any, transferables?: any[]): boolean {
    if (!this.childProcess) return false;
    if (typeof this.childProcess.postMessage === "function") {
      if (transferables && transferables.length > 0) {
        this.childProcess.postMessage(msg, transferables);
      } else {
        this.childProcess.postMessage(msg);
      }
      return true;
    }
    if (typeof this.childProcess.send === "function") {
      this.childProcess.send(msg);
      return true;
    }
    return false;
  }

  public async invokeEngine<T = any>(
    cmd: string,
    payload?: any,
    timeoutMs = 120000
  ): Promise<T> {
    if (this.engineMode === "legacy") {
      const { EngineService } = loadLegacyEngineService();
      return (await EngineService.getInstance().executeRpcCommand(cmd, payload)) as T;
    }

    if (!this.isStarted) {
      await this.start();
    }

    // Wait briefly if child is mid-recovery
    for (let waitIdx = 0; waitIdx < 20 && !this.childProcess && this.isRestarting; waitIdx++) {
      await new Promise((r) => setTimeout(r, 50));
    }

    if (!this.childProcess) {
      throw new Error(`[EngineSupervisor] Cannot invoke '${cmd}': Engine child process is not running.`);
    }

    const rpcId = `sup-rpc-${Date.now()}-${this.rpcSeq++}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingSupervisorRpcs.delete(rpcId);
        reject(new Error(`[EngineSupervisor] invokeEngine('${cmd}') timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingSupervisorRpcs.set(rpcId, { resolve, reject, timer });

      try {
        const sent = this.postToChild({
          type: "supervisor-rpc",
          rpcId,
          cmd,
          payload,
        });
        if (!sent) {
          clearTimeout(timer);
          this.pendingSupervisorRpcs.delete(rpcId);
          reject(new Error(`[EngineSupervisor] Engine child has no IPC channel for '${cmd}'`));
        }
      } catch (err) {
        clearTimeout(timer);
        this.pendingSupervisorRpcs.delete(rpcId);
        reject(err);
      }
    });
  }

  private broadcastToWindows(channel: string, payload?: any): void {
    const windows = this.getAllActiveWindows();
    for (const win of windows) {
      try {
        if (!win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
          win.webContents.send(channel, payload);
        }
      } catch {}
    }
  }

  private spawnSupervisedIngestWorker(
    child: any,
    reqId: string,
    workerScript: string,
    args: string[]
  ): void {
    const reply = (resp: any) => {
      try {
        if (typeof child.postMessage === "function") {
          child.postMessage(resp);
        } else if (typeof child.send === "function") {
          child.send(resp);
        }
      } catch {}
    };

    const utilityProcessApi = (electron as any)?.utilityProcess;
    const cleanEnv = this.buildChildEnv();

    if (utilityProcessApi && typeof utilityProcessApi.fork === "function") {
      try {
        const up = utilityProcessApi.fork(workerScript, args || [], {
          serviceName: "Toad Ingest Worker",
          stdio: "pipe",
          env: cleanEnv,
        });
        let stderr = "";
        if (up.stderr) {
          up.stderr.on("data", (chunk: any) => {
            stderr += chunk.toString();
          });
        }
        up.on("exit", (code: number) => {
          reply({
            type: "spawn-ingest-worker-result",
            reqId,
            ok: code === 0,
            code,
            error: code === 0 ? undefined : `[Worker Guard] Exit ${code}: ${stderr.trim()}`,
          });
        });
        return;
      } catch (err: any) {
        reply({
          type: "spawn-ingest-worker-result",
          reqId,
          ok: false,
          code: -1,
          error: err?.message || String(err),
        });
        return;
      }
    }

    try {
      const sub = cp.fork(workerScript, args || [], {
        env: cleanEnv,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      let stderr = "";
      if (sub.stderr) {
        sub.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });
      }
      sub.on("exit", (code) => {
        reply({
          type: "spawn-ingest-worker-result",
          reqId,
          ok: code === 0,
          code,
          error: code === 0 ? undefined : `[Worker Guard] Exit ${code}: ${stderr.trim()}`,
        });
      });
      sub.on("error", (err) => {
        reply({
          type: "spawn-ingest-worker-result",
          reqId,
          ok: false,
          code: -1,
          error: err.message,
        });
      });
    } catch (err: any) {
      reply({
        type: "spawn-ingest-worker-result",
        reqId,
        ok: false,
        code: -1,
        error: err?.message || String(err),
      });
    }
  }

  private bindChildEvents(child: any): void {
    child.on("exit", (code: number | null, signal?: string) => {
      if (child !== this.childProcess) {
        log.info(`[EngineSupervisor] Stale child process exited (PID: ${child.pid}). Ignored.`);
        return;
      }
      this.handleChildExit(code, signal);
    });

    child.on("error", (err: Error) => {
      log.error("[EngineSupervisor] Child engine error:", err);
      this.emit("engine:error", err);
    });

    const messageHandler = (eventOrData: any) => {
      let msg: any = eventOrData;
      if (
        eventOrData &&
        typeof eventOrData === "object" &&
        eventOrData.data !== undefined &&
        typeof eventOrData.data === "object" &&
        (eventOrData.data.type || eventOrData.data.cmd)
      ) {
        msg = eventOrData.data;
      }
      if (!msg) return;

      if (msg.type === "supervisor-rpc-result" && msg.rpcId) {
        const pending = this.pendingSupervisorRpcs.get(msg.rpcId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingSupervisorRpcs.delete(msg.rpcId);
          if (msg.ok) {
            pending.resolve(msg.data);
          } else {
            pending.reject(new Error(msg.error || "Engine RPC error"));
          }
        }
        return;
      }

      if (msg.type === "toad-ingest-progress" && msg.info) {
        this.broadcastToWindows("toad-ingest-progress", msg.info);
        return;
      }

      if (msg.type === "cache:invalidate") {
        this.broadcastToWindows("cache:invalidate", msg.payload || {});
        return;
      }

      if (msg.type === "project:workspaceChanged") {
        this.broadcastToWindows("project:workspaceChanged");
        return;
      }

      if (msg.type === "spawn-ingest-worker" && msg.reqId && msg.workerScript) {
        this.spawnSupervisedIngestWorker(child, msg.reqId, msg.workerScript, msg.args || []);
        return;
      }

      if (msg.type === "toad:log") {
        const raw = msg.entries || msg.payload || [];
        const entries = (Array.isArray(raw) ? raw : [raw])
          .filter(Boolean)
          .map((e: any) => {
            let msgText =
              typeof e.message === "string"
                ? e.message
                : e.message?.message || String(e.message || "");
            let proc = e.processTag || "ENGINE";
            let mod = e.moduleTag || e.module || "General";
            const prefixMatch = msgText.match(
              /^\[(MAIN|UI|ENGINE)\]\s*\[([^\]]+)\]\s*(.*)$/i
            );
            if (prefixMatch) {
              proc = prefixMatch[1].toUpperCase() as any;
              mod = prefixMatch[2];
              msgText = prefixMatch[3];
            } else {
              const singleMatch = msgText.match(/^\[(MAIN|UI|ENGINE)\]\s*(.*)$/i);
              if (singleMatch) {
                proc = singleMatch[1].toUpperCase() as any;
                msgText = singleMatch[2];
              }
            }
            return {
              ...e,
              processTag: proc,
              moduleTag: mod,
              message: msgText,
            };
          });
        ToadLogger.ingestBatch(entries);
        return;
      }

      if (msg.type === "views-replayed") {
        const count = typeof msg.count === "number" ? msg.count : 0;
        const elapsedMs = typeof msg.elapsedMs === "number" ? msg.elapsedMs : 0;
        while (this.pendingReplayResolvers.length > 0) {
          const resolver = this.pendingReplayResolvers.shift();
          resolver?.({ count, elapsedMs });
        }
      }
    };

    if (typeof child.on === "function") {
      child.on("message", messageHandler);
    }
  }

  private rejectPendingSupervisorRpcs(reason: string): void {
    for (const [id, pending] of this.pendingSupervisorRpcs) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      this.pendingSupervisorRpcs.delete(id);
    }
  }

  private handleChildExit(code: number | null, signal?: string): void {
    const exitedPid = this.childPid;
    this.childProcess = null;
    this.childPid = null;
    this.rejectPendingSupervisorRpcs(
      `[EngineSupervisor] Engine child exited (PID: ${exitedPid}, code: ${code}, signal: ${signal})`
    );

    log.warn(
      `[EngineSupervisor] Child engine exited (PID: ${exitedPid}, code: ${code}, signal: ${signal})`
    );

    if (this.isShuttingDown) {
      log.info("[EngineSupervisor] Intentional shutdown in progress. Skipping auto-restart.");
      return;
    }

    const now = Date.now();
    this.restartTimestamps = this.restartTimestamps.filter((t) => now - t < 10000);
    this.restartTimestamps.push(now);

    if (this.restartTimestamps.length > 5) {
      this.isStarted = false;
      log.error("[EngineSupervisor] Flap guard triggered (>5 crashes in 10s). Stopping auto-restart.");
      this.emit("engine:crash-loop", {
        crashCount: this.restartTimestamps.length,
        code,
        signal,
      });
      return;
    }

    this.emit("engine:crash", { code, signal, pid: exitedPid });

    this.isRestarting = true;
    setImmediate(async () => {
      try {
        await this.autoRecover(code !== null ? `exit-code-${code}` : `signal-${signal}`);
      } catch (err) {
        log.error("[EngineSupervisor] Auto-recovery failed:", err);
      } finally {
        this.isRestarting = false;
      }
    });
  }

  public async autoRecover(reason = "unexpected-exit"): Promise<EngineRestoredEvent> {
    const t0 = performance.now();
    this.restartCount++;
    this.lastRestartReason = reason;
    log.info(`[EngineSupervisor] Auto-recovery initiated (attempt #${this.restartCount}, reason: ${reason})...`);

    const waitReplay = new Promise<{ count: number; elapsedMs: number }>((resolve) => {
      let settled = false;
      const finish = (res: { count: number; elapsedMs: number }) => {
        if (!settled) {
          settled = true;
          resolve(res);
        }
      };
      const timeout = setTimeout(() => {
        finish({ count: 0, elapsedMs: 0 });
      }, 5000);
      this.pendingReplayResolvers.push((res) => {
        clearTimeout(timeout);
        finish(res);
      });
    });

    await this.spawnChildProcess(false, true);

    let restoredViewsCount = 0;
    try {
      const replayRes = await waitReplay;
      restoredViewsCount = replayRes.count;
    } catch (replayErr) {
      log.warn("[EngineSupervisor] Warning during view replay:", replayErr);
    }

    this.connectPortsToAllWindows();

    const elapsedMs = performance.now() - t0;
    this.lastRecoveryElapsedMs = elapsedMs;

    const eventPayload: EngineRestoredEvent = {
      timestamp: Date.now(),
      restoredViewsCount,
      elapsedMs,
      pid: this.childPid,
    };

    log.info(
      `[EngineSupervisor] Auto-recovery complete in ${elapsedMs.toFixed(2)} ms. Restored ${restoredViewsCount} views.`
    );

    this.isRestarting = false;
    this.notifyWindowsEngineRestored(eventPayload);
    this.emit("engine:restored", eventPayload);

    return eventPayload;
  }

  public async triggerReplayViews(): Promise<{ count: number; elapsedMs: number }> {
    if (this.childProcess) {
      return new Promise<{ count: number; elapsedMs: number }>((resolve) => {
        const timeout = setTimeout(() => {
          resolve({ count: 0, elapsedMs: 0 });
        }, 5000);

        this.pendingReplayResolvers.push((res) => {
          clearTimeout(timeout);
          resolve(res);
        });

        if (!this.postToChild({ type: "replay-views" })) {
          clearTimeout(timeout);
          resolve({ count: 0, elapsedMs: 0 });
        }
      });
    }

    if (this.engineMode === "legacy") {
      return await loadLegacyEngineService().replayLedgerViews();
    }
    return { count: 0, elapsedMs: 0 };
  }

  public attachWindow(win: BrowserWindow): void {
    if (!win || win.isDestroyed()) return;
    const alreadyRegistered = this.registeredWindows.has(win);
    this.registeredWindows.add(win);

    if (!alreadyRegistered) {
      win.on("closed", () => {
        this.registeredWindows.delete(win);
      });
      if (win.webContents && typeof win.webContents.on === "function") {
        win.webContents.on("did-finish-load", () => {
          if (this.engineMode !== "legacy") {
            this.sendDataPortToWindow(win);
          }
        });
      }
    }

    if (this.engineMode === "legacy") return;

    if (win.webContents && typeof win.webContents.isLoading === "function" && win.webContents.isLoading()) {
      return;
    }
    this.sendDataPortToWindow(win);
  }

  public sendDataPortToWindow(win: BrowserWindow): void {
    if (!win || win.isDestroyed()) return;
    if (!this.childProcess) return;

    const MessageChannelMainClass = (electron as any)?.MessageChannelMain;
    if (MessageChannelMainClass && typeof MessageChannelMainClass === "function") {
      try {
        const channel = new MessageChannelMainClass();
        const { port1, port2 } = channel;

        if (typeof this.childProcess.postMessage === "function") {
          this.childProcess.postMessage({ type: "init-data-channel" }, [port2]);
        }

        if (win.webContents && !win.webContents.isDestroyed()) {
          win.webContents.postMessage("toad-engine-port", null, [port1]);
        }
        log.info(`[EngineSupervisor] Forwarded MessagePort pair to window ID ${win.id}`);
      } catch (err) {
        log.error("[EngineSupervisor] Error creating/transferring MessageChannelMain:", err);
      }
    }
  }

  public connectPortsToAllWindows(): void {
    const windows = this.getAllActiveWindows();
    for (const win of windows) {
      this.sendDataPortToWindow(win);
    }
  }

  private notifyWindowsEngineRestored(payload: EngineRestoredEvent): void {
    this.broadcastToWindows("engine:restored", payload);
  }

  private getAllActiveWindows(): BrowserWindow[] {
    const result: BrowserWindow[] = [];
    const all =
      BrowserWindow && typeof BrowserWindow.getAllWindows === "function"
        ? BrowserWindow.getAllWindows()
        : [];
    for (const w of all) {
      if (w && !w.isDestroyed()) {
        result.push(w);
      }
    }
    for (const w of this.registeredWindows) {
      if (w && !w.isDestroyed() && !result.includes(w)) {
        result.push(w);
      }
    }
    return result;
  }

  private resolveScriptPath(): string {
    const candidates = [
      path.join(__dirname, "engineService.bundle.js"),
      path.join(__dirname, "../engineService.bundle.js"),
      path.join(__dirname, "engineService.js"),
      path.join(__dirname, "../dist/engineService.bundle.js"),
      path.join(__dirname, "../dist/app/engineService.js"),
      path.join(__dirname, "dist/app/engineService.js"),
      path.resolve(__dirname, "../../toad-app/dist/engineService.bundle.js"),
      path.resolve(__dirname, "../../toad-app/dist/app/engineService.js"),
      path.resolve(__dirname, "../toad-app/dist/app/engineService.js"),
      path.resolve(process.cwd(), "tad-master/packages/toad-app/dist/engineService.bundle.js"),
      path.resolve(process.cwd(), "tad-master/packages/toad-app/dist/app/engineService.js"),
      path.resolve(process.cwd(), "tad-master/packages/toad-app/app/engineService.js"),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return path.join(__dirname, "engineService.js");
  }

  private registerIpcHandlers(): void {
    if (this.ipcHandlersRegistered) return;
    if (!ipcMain || typeof ipcMain.handle !== "function") return;
    this.ipcHandlersRegistered = true;

    try {
      ipcMain.handle("engine:status", async () => this.getStatus());
      ipcMain.handle("engine:restart", async (_, payload?: any) => {
        const reason = payload?.reason || "user-requested";
        return await this.restart(reason);
      });
      ipcMain.handle("engine:request-port", async (event) => {
        const win =
          BrowserWindow && typeof BrowserWindow.fromWebContents === "function"
            ? BrowserWindow.fromWebContents(event.sender)
            : null;
        if (win) {
          this.sendDataPortToWindow(win);
        }
        return { ok: true };
      });
      ipcMain.on("engine:request-port", (event) => {
        const win =
          BrowserWindow && typeof BrowserWindow.fromWebContents === "function"
            ? BrowserWindow.fromWebContents(event.sender)
            : null;
        if (win) {
          this.sendDataPortToWindow(win);
        }
      });
    } catch (err) {
      log.warn("[EngineSupervisor] Note: IPC handlers already registered or failed:", err);
    }
  }

  public getStatus(): EngineSupervisorStatus {
    const uptime = this.startTime > 0 ? Math.round((Date.now() - this.startTime) / 1000) : 0;
    const state =
      this.engineMode === "legacy"
        ? "legacy"
        : this.isRestarting
        ? "restarting"
        : this.childProcess
        ? "running"
        : "stopped";

    return {
      state,
      engineMode: this.engineMode,
      pid: this.childPid,
      uptime,
      restartCount: this.restartCount,
      activeWindowsCount: this.getAllActiveWindows().length,
      lastRestartReason: this.lastRestartReason,
      lastRecoveryElapsedMs: this.lastRecoveryElapsedMs,
    };
  }

  public async restart(reason = "manual-restart"): Promise<boolean> {
    log.info(`[EngineSupervisor] Restart requested (${reason})...`);
    if (this.engineMode === "legacy") {
      await loadLegacyEngineService().replayLedgerViews();
      return true;
    }

    if (this.childProcess) {
      try {
        this.postToChild({ type: "shutdown" });
      } catch {}

      try {
        if (typeof (this.childProcess as any).kill === "function") {
          (this.childProcess as any).kill();
        }
      } catch {}
    }

    await this.autoRecover(reason);
    return true;
  }

  public async stop(): Promise<void> {
    log.info("[EngineSupervisor] Stopping supervisor...");
    this.isShuttingDown = true;
    this.rejectPendingSupervisorRpcs("[EngineSupervisor] Supervisor shutting down.");

    if (this.childProcess) {
      const child = this.childProcess;
      this.childProcess = null;
      this.childPid = null;
      try {
        if (typeof child.postMessage === "function") {
          child.postMessage({ type: "shutdown" });
        } else if (typeof child.send === "function") {
          child.send({ type: "shutdown" });
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 80));
      try {
        if (typeof child.kill === "function") {
          child.kill("SIGKILL");
        }
      } catch {}
    }

    this.isStarted = false;
    log.info("[EngineSupervisor] Supervisor stopped.");
  }

  public killChildForTest(signal: NodeJS.Signals = "SIGKILL"): void {
    if (this.childProcess) {
      log.warn(`[EngineSupervisor] killChildForTest: Sending ${signal} to PID ${this.childPid}`);
      if (typeof (this.childProcess as any).kill === "function") {
        (this.childProcess as any).kill(signal);
      }
    }
  }

  public getChildPid(): number | null {
    return this.childPid;
  }

  public isLegacyMode(): boolean {
    return this.engineMode === "legacy";
  }
}
