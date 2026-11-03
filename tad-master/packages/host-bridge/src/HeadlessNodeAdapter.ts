import { EventEmitter } from "events";
import {
  IHostBridge,
  OpenDialogOptions,
  SaveDialogOptions,
  AppConfigDTO,
  EngineName,
} from "./IHostBridge";

/**
 * Ring 2: Headless Node Adapter
 * Concrete implementation of IHostBridge for pure Node.js CLI testing and automation
 * (e.g., run_tests.js, deep_integration_qa.js, test_preload_3_pages.js).
 * Operates without Electron BrowserWindow, ipcRenderer, or GUI window dependencies.
 */
export class HeadlessNodeAdapter implements IHostBridge {
  readonly engineName: EngineName = "headless";
  private emitter = new EventEmitter();
  private dataPort: any = null;
  private customHandlers: Map<string, (payload: any) => Promise<any>> = new Map();
  private directDispatcher: ((functionName: string, req: any) => Promise<any>) | null = null;
  private clipboardText = "";
  private currentTheme: "light" | "dark" = "light";

  constructor() {}

  /**
   * Register a custom handler for a specific RPC function or command
   */
  public registerHandler(
    command: string,
    handler: (payload: any) => Promise<any>
  ): void {
    this.customHandlers.set(command, handler);
  }

  /**
   * Set a global fallback direct dispatcher for reltab/database functions
   */
  public setDirectDispatcher(
    dispatcher: (functionName: string, req: any) => Promise<any>
  ): void {
    this.directDispatcher = dispatcher;
  }

  /**
   * TransportClient invoke implementation
   */
  async invoke(functionName: string, req: any): Promise<any> {
    const handler = this.customHandlers.get(functionName);
    if (handler) {
      return await handler(req);
    }

    if (this.directDispatcher) {
      return await this.directDispatcher(functionName, req);
    }

    // Built-in standard handlers
    if (functionName === "getToadConfig") {
      return await this.getConfig();
    }

    if (functionName === "dialog:showOpenDialog") {
      return await this.showOpenDialog(req);
    }

    if (functionName === "dialog:showSaveDialog") {
      return await this.showSaveDialog(req);
    }

    if (functionName === "errorDialog") {
      await this.showErrorDialog(req?.title || "Error", req?.message || "", req?.fatal);
      return;
    }

    if (functionName === "newWindowFromDSPath") {
      return await this.openNewWindow(req);
    }

    // Check if global dispatcher was attached by test environment
    if ((global as any).__toadHeadlessDispatcher) {
      return await (global as any).__toadHeadlessDispatcher(functionName, req);
    }

    throw new Error(
      `[HeadlessNodeAdapter] No handler registered for function '${functionName}' in headless environment`
    );
  }

  async invokeCmd<T = any>(command: string, payload?: any): Promise<T> {
    return await this.invoke(command, payload);
  }

  setupDataPort(port: any): void {
    this.dataPort = port;
    if (this.dataPort && typeof this.dataPort.start === "function") {
      this.dataPort.start();
    }
    this.sendEvent("engine:restored", {});
  }

  async getConfig(): Promise<AppConfigDTO> {
    return {
      general: {
        viewer: "toad",
        language: "en",
        page_size: 1000,
        max_concurrent_files: 4,
        max_concurrent_gb: 1.0,
      },
      runtime: {
        engine: "headless",
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

  async showOpenDialog(options: OpenDialogOptions): Promise<string[] | null> {
    return options.defaultPath ? [options.defaultPath] : null;
  }

  async showSaveDialog(options: SaveDialogOptions): Promise<string | null> {
    return options.defaultPath || null;
  }

  async showErrorDialog(title: string, message: string, fatal = false): Promise<void> {
    console.error(`[HeadlessNodeAdapter:ErrorDialog] ${title}: ${message} (fatal=${fatal})`);
  }

  async openExternal(url: string): Promise<void> {
    // In headless test environments, external URL open is a no-op
  }

  copyToClipboard(text: string): void {
    this.clipboardText = text;
  }

  getClipboardText(): string {
    return this.clipboardText;
  }

  async openNewWindow(dsPath: any): Promise<void> {
    // In headless environment, record event or resolve
    this.sendEvent("window:opened", dsPath);
  }

  onEvent<T = any>(channel: string, listener: (data: T) => void): () => void {
    this.emitter.on(channel, listener);
    return () => {
      this.emitter.removeListener(channel, listener);
    };
  }

  sendEvent(channel: string, payload?: any): void {
    this.emitter.emit(channel, payload);
  }

  onEngineCrash(listener: () => void): () => void {
    return this.onEvent("engine:crash", listener);
  }

  onEngineRestored(callback: () => void): () => void {
    return this.onEvent("engine:restored", callback);
  }

  setTheme(theme: "light" | "dark"): void {
    this.currentTheme = theme;
  }

  getTheme(): "light" | "dark" {
    return this.currentTheme;
  }
}
