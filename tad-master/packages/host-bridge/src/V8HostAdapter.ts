import { IHostBridge, OpenDialogOptions, SaveDialogOptions, AppConfigDTO } from "./IHostBridge";

/**
 * Ring 2: V8 Host Adapter
 * Concrete implementation of IHostBridge for Electron / Node.js V8 Runtime.
 * Interacts with main process via ipcRenderer, shell, and clipboard.
 */
export class V8HostAdapter implements IHostBridge {
  readonly engineName = "v8" as const;
  private ipc: any = null;
  private clipboard: any = null;
  private shell: any = null;

  constructor() {
    this.initElectronAPIs();
  }

  private initElectronAPIs() {
    if (typeof window !== "undefined") {
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

  // TransportClient implementation for reltab
  async invoke(functionName: string, req: any): Promise<any> {
    if (!this.ipc) {
      this.initElectronAPIs();
    }
    if (this.ipc) {
      return await this.ipc.invoke(functionName, req);
    }
    throw new Error(`[V8HostAdapter] ipcRenderer not available for invoking '${functionName}'`);
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
          engine: "v8",
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
    if (!this.shell) {
      this.initElectronAPIs();
    }
    if (this.shell) {
      await this.shell.openExternal(url);
    } else if (typeof window !== "undefined") {
      window.open(url, "_blank");
    }
  }

  copyToClipboard(text: string): void {
    if (!this.clipboard) {
      this.initElectronAPIs();
    }
    if (this.clipboard) {
      this.clipboard.writeText(text);
    } else if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }

  async openNewWindow(dsPath: any): Promise<void> {
    return await this.invoke("newWindowFromDSPath", dsPath);
  }

  onEvent<T = any>(channel: string, listener: (data: T) => void): () => void {
    if (!this.ipc) {
      this.initElectronAPIs();
    }
    if (!this.ipc) return () => {};
    const wrappedHandler = (_: any, data: T) => listener(data);
    this.ipc.on(channel, wrappedHandler);
    return () => {
      if (this.ipc) {
        this.ipc.removeListener(channel, wrappedHandler);
      }
    };
  }

  sendEvent(channel: string, payload?: any): void {
    if (!this.ipc) {
      this.initElectronAPIs();
    }
    if (this.ipc) {
      this.ipc.send(channel, payload);
    }
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
