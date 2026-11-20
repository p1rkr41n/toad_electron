import { IHostBridge } from "./IHostBridge";
import { V8HostAdapter } from "./V8HostAdapter";
import {
  COMMAND_ALIAS_MAP,
  REVERSE_COMMAND_ALIAS_MAP,
} from "./commandAliases";

export { COMMAND_ALIAS_MAP, REVERSE_COMMAND_ALIAS_MAP };

interface PendingPortRequest {
  expectBinary: boolean;
  resolve: (val: any) => void;
  reject: (err: any) => void;
}

const DIRECT_ENGINE_PORT_COMMANDS = new Set<string>([
  "getDataSources",
  "DataSourceConnection.evalQuery",
  "DataSourceConnection.rowCount",
  "DataSourceConnection.getTableSchema",
  "DataSourceConnection.getTableName",
  "DataSourceConnection.getColumnStatsMap",
  "DataSourceConnection.getRootNode",
  "DataSourceConnection.getChildren",
  "DataSourceConnection.runSqlQuery",
  "DataSourceConnection.runSqlQueryArrow",
  "view:registerDerived",
  "view:getDerived",
  "project:getWorkspace",
  "project:getFiles",
  "project:create",
  "project:rename",
  "project:delete",
  "project:deleteAll",
  "project:getCacheSize",
  "project:purgeCache",
  "project:removeFile",
  "project:moveOrphanFiles",
  "project:setActive",
  "project:reconcile",
]);

/**
 * Ring 2: Electron Host Adapter
 * Concrete implementation of IHostBridge for Electron runtime.
 * Routes both binary Arrow/Hybrid queries and direct Engine RPCs over `MessagePort`
 * with automatic fallback to Main IPC when `dataPort` is unavailable.
 */
export class ElectronHostAdapter extends V8HostAdapter {
  public resolveCommand(cmd: string): string {
    return COMMAND_ALIAS_MAP[cmd] || cmd;
  }

  public resolveCanonicalCommand(cmd: string): string {
    return REVERSE_COMMAND_ALIAS_MAP[cmd] || cmd;
  }

  private portReqId = 10000;
  private pendingPortReqs = new Map<number, PendingPortRequest>();
  private attachedPort: any = null;
  private boundListener: any = null;

  public setupDataPort(port: any): void {
    if (this.attachedPort && this.attachedPort !== port) {
      for (const [id, pending] of this.pendingPortReqs) {
        pending.reject(
          new Error(`[ElectronHostAdapter] Port reset while request ${id} was pending`)
        );
      }
      this.pendingPortReqs.clear();
      this.detachDataPortListener(this.attachedPort);
    }
    super.setupDataPort(port);
    this.attachDataPortListener(port);
  }

  private detachDataPortListener(port: any): void {
    if (!port || !this.boundListener) return;
    if (typeof port.removeEventListener === "function") {
      port.removeEventListener("message", this.boundListener);
    } else if (typeof port.off === "function") {
      port.off("message", this.boundListener);
    } else if (port.onmessage === this.boundListener) {
      port.onmessage = null;
    }
    this.attachedPort = null;
    this.boundListener = null;
  }

  private attachDataPortListener(port: any): void {
    if (!port || this.attachedPort === port) return;
    this.attachedPort = port;

    const onMessage = (eventOrData: any) => {
      let msg: any = eventOrData;
      if (
        eventOrData &&
        typeof eventOrData === "object" &&
        typeof eventOrData.id !== "number" &&
        eventOrData.data !== undefined &&
        typeof eventOrData.data === "object" &&
        typeof eventOrData.data?.id === "number"
      ) {
        msg = eventOrData.data;
      }
      if (!msg || typeof msg.id !== "number") return;
      const pending = this.pendingPortReqs.get(msg.id);
      if (!pending) return;
      this.pendingPortReqs.delete(msg.id);

      if (msg.ok) {
        if (pending.expectBinary) {
          const raw = msg.buffer ?? msg.data;
          let u8: Uint8Array;
          if (raw instanceof Uint8Array) {
            u8 = raw;
          } else if (raw instanceof ArrayBuffer) {
            u8 = new Uint8Array(raw);
          } else if (typeof Buffer !== "undefined" && Buffer.isBuffer(raw)) {
            u8 = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
          } else if (typeof raw === "string") {
            u8 = new TextEncoder().encode(raw);
          } else if (raw !== undefined) {
            u8 = new TextEncoder().encode(JSON.stringify(raw));
          } else {
            u8 = new Uint8Array(0);
          }
          pending.resolve(u8);
        } else if (msg.binary && (msg.buffer || msg.data)) {
          pending.resolve({ binary: true, buffer: msg.buffer || msg.data, metadata: msg.metadata });
        } else {
          pending.resolve(msg.data);
        }
      } else {
        const errMessage = msg.error || msg.errorObj?.message || "Engine MessagePort request failed";
        const appErr: any = new Error(errMessage);
        appErr.isEngineApplicationError = true;
        pending.reject(appErr);
      }
    };

    this.boundListener = onMessage;
    if (typeof port.addEventListener === "function") {
      port.addEventListener("message", onMessage);
    } else if (typeof port.on === "function") {
      port.on("message", onMessage);
    } else if (port.onmessage !== undefined) {
      port.onmessage = onMessage;
    }
  }

  private canRouteOverDataPort(targetCmd: string, args: any): boolean {
    if (!this.dataPort || typeof this.dataPort.postMessage !== "function") {
      return false;
    }
    if (DIRECT_ENGINE_PORT_COMMANDS.has(targetCmd)) {
      return true;
    }
    // `project:addFiles` / `project:addFolder` require Main's native OS file picker only when paths are omitted
    if (targetCmd === "project:addFiles" && args && Array.isArray(args.filePaths)) {
      return true;
    }
    if (
      targetCmd === "project:addFolder" &&
      args &&
      typeof args.folderPath === "string" &&
      args.folderPath.length > 0
    ) {
      return true;
    }
    return false;
  }

  private normalizePortPayload(targetCmd: string, rawArgs: any): any {
    let parsed = rawArgs;
    if (typeof rawArgs === "string" && rawArgs.trim().startsWith("{")) {
      try {
        parsed = JSON.parse(rawArgs);
      } catch {
        parsed = rawArgs;
      }
    }
    if (
      targetCmd.startsWith("DataSourceConnection.") &&
      parsed &&
      typeof parsed === "object" &&
      "engine" in parsed &&
      "req" in parsed &&
      typeof parsed.req === "object" &&
      parsed.req !== null
    ) {
      return { engine: parsed.engine, ...parsed.req };
    }
    return parsed;
  }

  private sendOverDataPort<T>(
    targetCmd: string,
    payload: any,
    expectBinary: boolean,
    timeoutMs = 120000
  ): Promise<T> {
    this.attachDataPortListener(this.dataPort);
    const id = ++this.portReqId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingPortReqs.has(id)) {
          this.pendingPortReqs.delete(id);
          reject(
            new Error(
              `[ElectronHostAdapter] MessagePort timeout for '${targetCmd}' (reqId: ${id})`
            )
          );
        }
      }, timeoutMs);

      this.pendingPortReqs.set(id, {
        expectBinary,
        resolve: (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      try {
        this.dataPort.postMessage({
          id,
          cmd: targetCmd,
          payload,
          binary: expectBinary || undefined,
        });
      } catch (sendErr) {
        clearTimeout(timer);
        this.pendingPortReqs.delete(id);
        reject(sendErr);
      }
    });
  }

  private hasIpcFallback(): boolean {
    if (!this.toadBridge && !this.ipc) {
      this.initAPIs();
    }
    return Boolean(this.toadBridge || this.ipc);
  }

  async invoke<T = any>(cmd: string, args?: any): Promise<T> {
    const targetCmd = this.resolveCommand(cmd);
    if (this.canRouteOverDataPort(targetCmd, args)) {
      try {
        const payload = this.normalizePortPayload(targetCmd, args);
        return await this.sendOverDataPort<T>(targetCmd, payload, false);
      } catch (portErr: any) {
        if (
          !this.hasIpcFallback() ||
          portErr?.isEngineApplicationError ||
          String(portErr?.message || "").includes("Port reset")
        ) {
          throw portErr;
        }
        console.warn(
          `[ElectronHostAdapter] Direct dataPort invoke('${targetCmd}') failed, falling back to IPC:`,
          portErr
        );
      }
    }
    return await super.invoke<T>(targetCmd, args);
  }

  async invokeBinary(cmd: string, args?: any): Promise<Uint8Array> {
    const targetCmd = this.resolveCommand(cmd);
    if (this.dataPort && typeof this.dataPort.postMessage === "function") {
      try {
        const payload = this.normalizePortPayload(targetCmd, args);
        return await this.sendOverDataPort<Uint8Array>(targetCmd, payload, true, 120000);
      } catch (portErr: any) {
        const errMsg = String(portErr?.message || "");
        const isQueryTimeout =
          targetCmd === "DataSourceConnection.evalQuery" &&
          errMsg.includes("MessagePort timeout");
        if (
          !this.hasIpcFallback() ||
          portErr?.isEngineApplicationError ||
          errMsg.includes("Port reset") ||
          isQueryTimeout
        ) {
          throw portErr;
        }
        console.warn(
          `[ElectronHostAdapter] Direct dataPort invokeBinary('${targetCmd}') failed, falling back to IPC:`,
          portErr
        );
      }
    }
    const res = await super.invoke<any>(targetCmd, args);
    if (res instanceof Uint8Array) return res;
    if (res instanceof ArrayBuffer) return new Uint8Array(res);
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(res)) {
      return new Uint8Array(res.buffer, res.byteOffset, res.byteLength);
    }
    if (typeof res === "string") return new TextEncoder().encode(res);
    return new Uint8Array();
  }
}

let activeBridge: IHostBridge | null = null;

export function getHostBridge(): IHostBridge {
  if (!activeBridge) {
    activeBridge = new ElectronHostAdapter();
  }
  return activeBridge;
}

export function setHostBridge(customBridge: IHostBridge): void {
  activeBridge = customBridge;
}

export { V8HostAdapter } from "./V8HostAdapter";
export * from "./IHostBridge";
