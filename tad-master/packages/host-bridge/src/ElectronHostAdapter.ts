import { IHostBridge } from "./IHostBridge";
import { V8HostAdapter } from "./V8HostAdapter";
import {
  COMMAND_ALIAS_MAP,
  REVERSE_COMMAND_ALIAS_MAP,
} from "./commandAliases";

export { COMMAND_ALIAS_MAP, REVERSE_COMMAND_ALIAS_MAP };

/**
 * Ring 2: Electron Host Adapter
 * Concrete implementation of IHostBridge for Electron runtime.
 * Inherits and modernizes V8HostAdapter with two-way command alias normalization.
 */
export class ElectronHostAdapter extends V8HostAdapter {
  /**
   * Normalize input command (Tauri-style or Legacy Electron channel)
   * to the concrete Electron IPC channel name.
   */
  public resolveCommand(cmd: string): string {
    return COMMAND_ALIAS_MAP[cmd] || cmd;
  }

  /**
   * Convert a legacy IPC channel to its canonical Tauri v2 namespaced name.
   */
  public resolveCanonicalCommand(cmd: string): string {
    return REVERSE_COMMAND_ALIAS_MAP[cmd] || cmd;
  }

  private binaryReqId = 10000;
  private pendingBinaryReqs = new Map<
    number,
    { resolve: (val: Uint8Array) => void; reject: (err: any) => void }
  >();
  private attachedPort: any = null;

  public setupDataPort(port: any): void {
    super.setupDataPort(port);
    this.attachDataPortListener(port);
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
      const pending = this.pendingBinaryReqs.get(msg.id);
      if (!pending) return;
      this.pendingBinaryReqs.delete(msg.id);

      if (msg.ok) {
        const raw = msg.buffer || msg.data;
        let u8: Uint8Array;
        if (raw instanceof Uint8Array) {
          u8 = raw;
        } else if (raw instanceof ArrayBuffer) {
          u8 = new Uint8Array(raw);
        } else if (typeof Buffer !== "undefined" && Buffer.isBuffer(raw)) {
          u8 = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
        } else if (typeof raw === "string") {
          u8 = new TextEncoder().encode(raw);
        } else {
          u8 = new Uint8Array(0);
        }
        pending.resolve(u8);
      } else {
        const errMessage = msg.error || msg.errorObj?.message || "invokeBinary failed";
        pending.reject(new Error(errMessage));
      }
    };

    if (typeof port.addEventListener === "function") {
      port.addEventListener("message", onMessage);
    } else if (typeof port.on === "function") {
      port.on("message", onMessage);
    } else if (port.onmessage !== undefined) {
      port.onmessage = onMessage;
    }
  }

  /**
   * Unified command invocation with alias mapping support
   */
  async invoke<T = any>(cmd: string, args?: any): Promise<T> {
    const targetCmd = this.resolveCommand(cmd);
    return await super.invoke<T>(targetCmd, args);
  }

  /**
   * Binary execution over MessagePort (Port 1) Request-Response channel.
   * Resolves binary Uint8Array payload directly with automatic requestId management.
   * Gracefully falls back to IPC invoke if dataPort is not connected.
   */
  async invokeBinary(cmd: string, args?: any): Promise<Uint8Array> {
    const targetCmd = this.resolveCommand(cmd);
    if (this.dataPort) {
      this.attachDataPortListener(this.dataPort);
      const id = ++this.binaryReqId;
      return new Promise<Uint8Array>((resolve, reject) => {
        this.pendingBinaryReqs.set(id, { resolve, reject });
        try {
          this.dataPort.postMessage({
            id,
            cmd: targetCmd,
            payload: args,
            binary: true,
          });
        } catch (sendErr) {
          this.pendingBinaryReqs.delete(id);
          reject(sendErr);
        }
      });
    }
    return await super.invokeBinary(targetCmd, args);
  }
}

let activeBridge: IHostBridge | null = null;

/**
 * Get the active singleton HostBridge instance.
 * Defaults to ElectronHostAdapter.
 */
export function getHostBridge(): IHostBridge {
  if (!activeBridge) {
    activeBridge = new ElectronHostAdapter();
  }
  return activeBridge;
}

/**
 * Override the active HostBridge (for testing, Tauri shell, Headless CLI, or Web).
 */
export function setHostBridge(customBridge: IHostBridge): void {
  activeBridge = customBridge;
}

export { V8HostAdapter } from "./V8HostAdapter";
export * from "./IHostBridge";
