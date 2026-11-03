/**
 * Engine Supervisor for TOAD v2.5.0
 *
 * Supervises the Dedicated Engine Service (Electron utilityProcess) lifecycle:
 * 1. Spawns engineService via Electron utilityProcess.fork() (with fallback in headless environments).
 * 2. Checks dual-mode configuration (runtime.engine = "utility" | "legacy"). If "legacy", falls back
 *    to in-process initialization; otherwise manages the utilityProcess.
 * 3. On spawn, creates MessageChannelMain, forwards port2 to child process, and sends port1 to Renderer.
 * 4. Watches child lifecycle (exit, error). If child exits unexpectedly (code !== 0), auto-restarts
 *    within < 500ms.
 * 5. Upon auto-restart, commands engineService to replay all view states from toad_ledger.parquet
 *    in < 5ms via replayLedgerViews().
 * 6. Sends a fresh MessagePort to Renderer webContents and emits "engine:restored" event.
 */

import * as path from "path";
import * as fs from "fs";
import * as cp from "child_process";
import { EventEmitter } from "events";
import log from "electron-log";
import electron, { BrowserWindow, ipcMain, app } from "electron";
import * as reltabDuckDB from "reltab-duckdb";
import { PortableEnvironment } from "./portableAppData";
import { replayLedgerViews } from "./engineService";

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

  private constructor() {
    super();
  }

  public static getInstance(): EngineSupervisor {
    if (!EngineSupervisor.instance) {
      EngineSupervisor.instance = new EngineSupervisor();
    }
    return EngineSupervisor.instance;
  }

  /**
   * Determine whether runtime configuration specifies "utility" or "legacy".
   */
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

  /**
   * Start engine supervision.
   */
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

    // Auto-attach any windows created in the future
    if (app && typeof app.on === "function") {
      app.on("browser-window-created", (_, win) => {
        if (win) {
          this.attachWindow(win);
        }
      });
    }

    // Register supervisor IPC handlers if running inside Electron main process
    this.registerIpcHandlers();

    if (this.engineMode === "legacy") {
      log.info("[EngineSupervisor] Mode: 'legacy' - initializing DuckDB in-process.");
      try {
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

  /**
   * Spawns child process using Electron utilityProcess.fork (with fallback to cp.fork in headless test mode).
   */
  private async spawnChildProcess(): Promise<void> {
    const scriptPath = this.resolveScriptPath();
    log.info(`[EngineSupervisor] Spawning engine service from: ${scriptPath}`);

    const utilityProcessApi = (electron as any)?.utilityProcess;

    if (utilityProcessApi && typeof utilityProcessApi.fork === "function") {
      const child = utilityProcessApi.fork(scriptPath, [], {
        serviceName: "Toad Engine Service",
        stdio: "inherit",
        env: {
          ...process.env,
          TOAD_ENGINE_WORKER: "1",
        },
      });
      this.childProcess = child;
      this.childPid = child.pid || null;
      this.bindChildEvents(child, "utilityProcess");
    } else {
      // Headless Node.js test environment fallback (child_process.fork)
      log.warn("[EngineSupervisor] Electron utilityProcess not available, falling back to child_process.fork");
      const child = cp.fork(scriptPath, [], {
        stdio: ["ignore", "inherit", "inherit", "ipc"],
        env: {
          ...process.env,
          TOAD_ENGINE_WORKER: "1",
        },
      });
      this.childProcess = child;
      this.childPid = child.pid || null;
      this.bindChildEvents(child, "childProcess");
    }

    log.info(`[EngineSupervisor] Engine child spawned successfully (PID: ${this.childPid})`);

    // Connect MessagePorts to all active windows
    this.connectPortsToAllWindows();
  }

  /**
   * Binds exit, error, and message events on the child process.
   */
  private bindChildEvents(child: any, kind: "utilityProcess" | "childProcess"): void {
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

  /**
   * Handles child process termination and triggers auto-restart if unexpected.
   */
  private handleChildExit(code: number | null, signal?: string): void {
    const exitedPid = this.childPid;
    this.childProcess = null;
    this.childPid = null;

    log.warn(
      `[EngineSupervisor] Child engine exited (PID: ${exitedPid}, code: ${code}, signal: ${signal})`
    );

    if (this.isShuttingDown) {
      log.info("[EngineSupervisor] Intentional shutdown in progress. Skipping auto-restart.");
      return;
    }

    // Flap guard: avoid infinite rapid restart loops (> 5 crashes in 10s)
    const now = Date.now();
    this.restartTimestamps = this.restartTimestamps.filter((t) => now - t < 10000);
    this.restartTimestamps.push(now);

    if (this.restartTimestamps.length > 5) {
      log.error("[EngineSupervisor] Flap guard triggered (>5 crashes in 10s). Stopping auto-restart.");
      this.emit("engine:crash-loop", {
        crashCount: this.restartTimestamps.length,
        code,
        signal,
      });
      return;
    }

    this.emit("engine:crash", { code, signal, pid: exitedPid });

    // Auto-restart within < 500ms SLA (immediate recovery loop)
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

  /**
   * Auto-recovers the engine process:
   * 1. Respawns child process in < 500ms
   * 2. Commands engineService to replay all view states from toad_ledger.parquet in < 5ms
   * 3. Establishes fresh MessagePort pairing
   * 4. Emits "engine:restored" event to Renderer window
   */
  public async autoRecover(reason = "unexpected-exit"): Promise<EngineRestoredEvent> {
    const t0 = performance.now();
    this.restartCount++;
    this.lastRestartReason = reason;
    log.info(`[EngineSupervisor] Auto-recovery initiated (attempt #${this.restartCount}, reason: ${reason})...`);

    // 1. Respawn child process
    await this.spawnChildProcess();

    // 2. Command engineService to replay views from toad_ledger.parquet
    let restoredViewsCount = 0;
    try {
      const replayRes = await this.triggerReplayViews();
      restoredViewsCount = replayRes.count;
    } catch (replayErr) {
      log.warn("[EngineSupervisor] Warning during view replay:", replayErr);
    }

    // 3. Connect fresh MessagePorts to Renderer
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

    // Mark restart finished so status reflects running state
    this.isRestarting = false;

    // 4. Notify Renderers and Supervisor listeners
    this.notifyWindowsEngineRestored(eventPayload);
    this.emit("engine:restored", eventPayload);

    return eventPayload;
  }

  /**
   * Commands the engine service to replay all views from toad_ledger.parquet.
   */
  public async triggerReplayViews(): Promise<{ count: number; elapsedMs: number }> {
    const postFn = typeof this.childProcess?.postMessage === "function"
      ? (msg: any) => this.childProcess.postMessage(msg)
      : typeof this.childProcess?.send === "function"
      ? (msg: any) => this.childProcess.send(msg)
      : null;

    if (postFn) {
      return new Promise<{ count: number; elapsedMs: number }>((resolve) => {
        const timeout = setTimeout(async () => {
          // Fallback if child process doesn't acknowledge in time
          try {
            const fallback = await replayLedgerViews();
            resolve(fallback);
          } catch {
            resolve({ count: 0, elapsedMs: 0 });
          }
        }, 250);

        this.pendingReplayResolvers.push((res) => {
          clearTimeout(timeout);
          resolve(res);
        });

        try {
          postFn({ type: "replay-views" });
        } catch {
          clearTimeout(timeout);
          resolve({ count: 0, elapsedMs: 0 });
        }
      });
    }

    // Fallback: direct in-process replay
    return await replayLedgerViews();
  }

  /**
   * Attach a BrowserWindow and establish its direct MessagePort channel.
   */
  public attachWindow(win: BrowserWindow): void {
    if (!win || win.isDestroyed()) return;
    this.registeredWindows.add(win);

    win.on("closed", () => {
      this.registeredWindows.delete(win);
    });

    if (this.engineMode === "legacy") return;

    this.sendDataPortToWindow(win);
  }

  /**
   * Connects fresh MessagePort channel to an individual window.
   */
  private sendDataPortToWindow(win: BrowserWindow): void {
    if (!win || win.isDestroyed()) return;
    if (!this.childProcess) return;

    const MessageChannelMainClass = (electron as any)?.MessageChannelMain;
    if (MessageChannelMainClass && typeof MessageChannelMainClass === "function") {
      try {
        const channel = new MessageChannelMainClass();
        const { port1, port2 } = channel;

        // Forward port2 to engine utilityProcess
        if (typeof this.childProcess.postMessage === "function") {
          this.childProcess.postMessage({ type: "init-data-channel" }, [port2]);
        }

        // Send port1 to Renderer webContents
        if (win.webContents && !win.webContents.isDestroyed()) {
          win.webContents.postMessage("toad-engine-port", null, [port1]);
        }
        log.info(`[EngineSupervisor] Forwarded MessagePort pair to window ID ${win.id}`);
      } catch (err) {
        log.error("[EngineSupervisor] Error creating/transferring MessageChannelMain:", err);
      }
    }
  }

  /**
   * Connects fresh MessagePorts to all registered and active browser windows.
   */
  public connectPortsToAllWindows(): void {
    const windows = this.getAllActiveWindows();
    for (const win of windows) {
      this.sendDataPortToWindow(win);
    }
  }

  /**
   * Broadcasts "engine:restored" event to all active windows.
   */
  private notifyWindowsEngineRestored(payload: EngineRestoredEvent): void {
    const windows = this.getAllActiveWindows();
    for (const win of windows) {
      try {
        if (!win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
          win.webContents.send("engine:restored", payload);
        }
      } catch (err) {
        log.warn("[EngineSupervisor] Error notifying window of engine:restored:", err);
      }
    }
  }

  /**
   * Returns list of all currently active (non-destroyed) BrowserWindow instances.
   */
  private getAllActiveWindows(): BrowserWindow[] {
    const result: BrowserWindow[] = [];
    const all = BrowserWindow && typeof BrowserWindow.getAllWindows === "function"
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

  /**
   * Resolves the on-disk bundle or JavaScript file for engineService.
   */
  private resolveScriptPath(): string {
    const candidates = [
      path.join(__dirname, "engineService.bundle.js"),
      path.join(__dirname, "engineService.js"),
      path.join(__dirname, "../dist/engineService.bundle.js"),
      path.join(__dirname, "../dist/app/engineService.js"),
      path.join(__dirname, "dist/app/engineService.js"),
      path.resolve(__dirname, "../../toad-app/dist/app/engineService.js"),
      path.resolve(__dirname, "../toad-app/dist/app/engineService.js"),
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

  /**
   * Registers supervisor IPC handlers in the Electron main process.
   */
  private registerIpcHandlers(): void {
    if (!ipcMain || typeof ipcMain.handle !== "function") return;

    try {
      ipcMain.handle("engine:status", async () => this.getStatus());
      ipcMain.handle("engine:restart", async (_, payload?: any) => {
        const reason = payload?.reason || "user-requested";
        return await this.restart(reason);
      });
      ipcMain.on("engine:request-port", (event) => {
        const win = BrowserWindow && typeof BrowserWindow.fromWebContents === "function"
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

  /**
   * Returns health and supervision status.
   */
  public getStatus(): EngineSupervisorStatus {
    const uptime = this.startTime > 0 ? Math.round((Date.now() - this.startTime) / 1000) : 0;
    const state = this.engineMode === "legacy"
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

  /**
   * Manually restart the engine process.
   */
  public async restart(reason = "manual-restart"): Promise<boolean> {
    log.info(`[EngineSupervisor] Restart requested (${reason})...`);
    if (this.engineMode === "legacy") {
      await replayLedgerViews();
      return true;
    }

    if (this.childProcess) {
      try {
        if (typeof this.childProcess.postMessage === "function") {
          this.childProcess.postMessage({ type: "shutdown" });
        }
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

  /**
   * Stops the supervisor and gracefully terminates the child process.
   */
  public async stop(): Promise<void> {
    log.info("[EngineSupervisor] Stopping supervisor...");
    this.isShuttingDown = true;

    if (this.childProcess) {
      const child = this.childProcess;
      this.childProcess = null;
      this.childPid = null;
      try {
        if (typeof child.postMessage === "function") {
          child.postMessage({ type: "shutdown" });
        }
      } catch {}
      try {
        if (typeof child.kill === "function") {
          child.kill("SIGKILL");
        }
      } catch {}
    }

    this.isStarted = false;
    log.info("[EngineSupervisor] Supervisor stopped.");
  }

  /**
   * Testing helper: kills child process with specified signal to test crash recovery.
   */
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
