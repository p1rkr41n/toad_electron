import {
  IHostBridge,
  OpenDialogOptions,
  SaveDialogOptions,
  AppConfigDTO,
  EngineName,
  UnlistenFn,
} from "./IHostBridge";

/**
 * Ring 2: V8 Host Adapter
 * Concrete base implementation of IHostBridge for Electron / Node.js V8 Runtime.
 * Prioritizes window.toadBridge (contextIsolation: true), falling back gracefully
 * to window.require("electron") in legacy mode (contextIsolation: false).
 */
export class V8HostAdapter implements IHostBridge {
  protected toadBridge: any = null;
  protected ipc: any = null;
  protected clipboard: any = null;
  protected shell: any = null;
  protected dataPort: any = null;

  constructor() {
    this.initAPIs();
    this.initPortListener();
  }

  public get engineName(): EngineName {
    return this.toadBridge ? "utility" : "v8";
  }

  protected initAPIs(): void {
    if (typeof window !== "undefined") {
      // 1. Prioritize secure toadBridge exposed by preload.js
      if ((window as any).toadBridge) {
        this.toadBridge = (window as any).toadBridge;
      }
      // 2. Legacy fallback if running in legacy mode
      try {
        const electron = (window as any).electron || (window as any).require?.("electron");
        if (electron) {
          this.ipc = electron.ipcRenderer;
          this.clipboard = electron.clipboard;
          this.shell = electron.shell;
        }
      } catch (err) {
        // Non-electron or test environment
      }
    }
  }

  protected initPortListener(): void {
    if (typeof window !== "undefined") {
      window.addEventListener("message", (event: MessageEvent) => {
        if (event.data?.type === "toad-engine-port-handshake" && event.ports?.[0]) {
          this.setupDataPort(event.ports[0]);
        }
      });
    }
  }

  public setupDataPort(port: any): void {
    this.dataPort = port;
    if (this.dataPort && typeof this.dataPort.start === "function") {
      this.dataPort.start();
    }
    this.sendEvent("engine:restored", {});
  }

  // TransportClient implementation for reltab
  async invoke<T = any>(functionName: string, req?: any): Promise<T> {
    if (!this.toadBridge && !this.ipc) {
      this.initAPIs();
    }
    if (this.toadBridge && typeof this.toadBridge.invoke === "function") {
      return await this.toadBridge.invoke(functionName, req);
    }
    if (this.ipc && typeof this.ipc.invoke === "function") {
      return await this.ipc.invoke(functionName, req);
    }
    throw new Error(`[V8HostAdapter] Neither toadBridge nor ipcRenderer is available for invoking '${functionName}'`);
  }

  async invokeBinary(cmd: string, args?: Record<string, unknown> | any): Promise<Uint8Array> {
    const res = await this.invoke(cmd, args);
    if (res instanceof Uint8Array) {
      return res;
    }
    if (res instanceof ArrayBuffer) {
      return new Uint8Array(res);
    }
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(res)) {
      return new Uint8Array(res.buffer, res.byteOffset, res.byteLength);
    }
    if (typeof res === "string") {
      return new TextEncoder().encode(res);
    }
    return new Uint8Array();
  }

  listen<T = any>(event: string, handler: (payload: T) => void): UnlistenFn {
    if (!this.toadBridge && !this.ipc) {
      this.initAPIs();
    }
    if (this.toadBridge) {
      if (typeof this.toadBridge.listen === "function") {
        return this.toadBridge.listen(event, handler);
      }
      if (typeof this.toadBridge.on === "function") {
        return this.toadBridge.on(event, handler);
      }
    }
    if (this.ipc && typeof this.ipc.on === "function") {
      const wrappedHandler = (_: any, data: T) => handler(data);
      this.ipc.on(event, wrappedHandler);
      return () => {
        if (this.ipc) {
          this.ipc.removeListener(event, wrappedHandler);
        }
      };
    }
    return () => {};
  }

  emit(event: string, payload?: unknown): void {
    if (!this.toadBridge && !this.ipc) {
      this.initAPIs();
    }
    if (this.toadBridge) {
      if (typeof this.toadBridge.emit === "function") {
        this.toadBridge.emit(event, payload);
        return;
      }
      if (typeof this.toadBridge.send === "function") {
        this.toadBridge.send(event, payload);
        return;
      }
    }
    if (this.ipc && typeof this.ipc.send === "function") {
      this.ipc.send(event, payload);
    }
  }

  async invokeCmd<T = any>(command: string, payload?: any): Promise<T> {
    return await this.invoke<T>(command, payload);
  }

  async getConfig(): Promise<AppConfigDTO> {
    try {
      return await this.invoke("getToadConfig", {});
    } catch {
      return {
        general: {
          viewer: "toad",
          language: "en",
          page_size: 1000,
          max_concurrent_files: 4,
          max_concurrent_gb: 1.0,
        },
        runtime: {
          engine: "utility",
          auto_fallback: true,
        },
        duckdb: {
          max_memory: "auto",
          threads: 0,
          background_threads: "auto",
          add_raw_event: false,
        },
        parquet: {
          compression: "snappy",
          row_group_size: 25000,
        },
        system: {
          temp_cleanup: true,
          binary_guard: true,
        },
      };
    }
  }

  async showOpenDialog(options: OpenDialogOptions): Promise<string[] | null> {
    return await this.invoke("dialog:showOpenDialog", options);
  }

  async showSaveDialog(options: SaveDialogOptions): Promise<string | null> {
    return await this.invoke("dialog:showSaveDialog", options);
  }

  async showErrorDialog(title: string, message: string, fatal = false): Promise<void> {
    try {
      await this.invoke("errorDialog", { title, message, fatal });
    } catch {
      console.error(`[ErrorDialog] ${title}: ${message}`);
    }
  }

  async openExternal(url: string): Promise<void> {
    if (!this.toadBridge && !this.shell) {
      this.initAPIs();
    }
    if (this.toadBridge && typeof this.toadBridge.openExternal === "function") {
      return await this.toadBridge.openExternal(url);
    }
    if (this.shell) {
      await this.shell.openExternal(url);
    } else if (typeof window !== "undefined") {
      window.open(url, "_blank");
    }
  }

  copyToClipboard(text: string): void {
    if (!this.toadBridge && !this.clipboard) {
      this.initAPIs();
    }
    if (this.toadBridge?.clipboard && typeof this.toadBridge.clipboard.writeText === "function") {
      this.toadBridge.clipboard.writeText(text);
    } else if (this.clipboard) {
      this.clipboard.writeText(text);
    } else if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }

  async openNewWindow(dsPath: any): Promise<void> {
    return await this.invoke("newWindowFromDSPath", dsPath);
  }

  onEvent<T = any>(channel: string, listener: (data: T) => void): () => void {
    return this.listen<T>(channel, listener);
  }

  sendEvent(channel: string, payload?: any): void {
    this.emit(channel, payload);
  }

  onEngineCrash(listener: () => void): () => void {
    return this.onEvent("engine:crash", listener);
  }

  onEngineRestored(callback: () => void): () => void {
    return this.onEvent("engine:restored", callback);
  }

  setTheme(theme: "light" | "dark"): void {
    if (typeof document !== "undefined") {
      document.documentElement.className = `theme-${theme}`;
      localStorage.setItem("toad-theme-v2", theme);
    }
  }

  getTheme(): "light" | "dark" {
    if (typeof localStorage !== "undefined") {
      return (localStorage.getItem("toad-theme-v2") as "light" | "dark") || "light";
    }
    return "light";
  }
}
