import {
  IHostBridge,
  OpenDialogOptions,
  SaveDialogOptions,
  AppConfigDTO,
  EngineName,
  UnlistenFn,
} from "./IHostBridge";
import { REVERSE_COMMAND_ALIAS_MAP, COMMAND_ALIAS_MAP } from "./commandAliases";

/**
 * Ring 2: Tauri Host Adapter
 * Concrete implementation of IHostBridge for Tauri v2 Runtime (Rust backend).
 * Communicates via window.__TAURI__.core.invoke and window.__TAURI__.event.
 */
export class TauriHostAdapter implements IHostBridge {
  readonly engineName: EngineName = "tauri";
  private clipboardText = "";
  private currentTheme: "light" | "dark" = "light";

  constructor() {}

  /**
   * Resolve a command to its canonical Tauri namespace
   */
  public resolveTauriCommand(cmd: string): string {
    return REVERSE_COMMAND_ALIAS_MAP[cmd] || cmd;
  }

  /**
   * Resolve a Tauri canonical command back to legacy IPC channel
   */
  public resolveLegacyCommand(cmd: string): string {
    return COMMAND_ALIAS_MAP[cmd] || cmd;
  }

  private getTauri(): any {
    if (typeof window !== "undefined") {
      return (window as any).__TAURI__ || null;
    }
    return null;
  }

  async invoke<T = any>(cmd: string, args?: Record<string, unknown> | any): Promise<T> {
    const tauriCmd = this.resolveTauriCommand(cmd);
    const tauri = this.getTauri();
    if (tauri?.core?.invoke) {
      return await tauri.core.invoke(tauriCmd, args || {});
    }
    // Fallback for mock/test environments
    if ((global as any).__tauriMockInvoke) {
      return await (global as any).__tauriMockInvoke(tauriCmd, args);
    }
    throw new Error(
      `[TauriHostAdapter] Tauri runtime not detected for invoking '${cmd}' (mapped to '${tauriCmd}')`
    );
  }

  async invokeBinary(cmd: string, args?: Record<string, unknown> | any): Promise<Uint8Array> {
    const tauriCmd = this.resolveTauriCommand(cmd);
    const tauri = this.getTauri();
    if (tauri?.core?.invoke) {
      const res = await tauri.core.invoke(tauriCmd, args || {});
      if (res instanceof Uint8Array) return res;
      if (res instanceof ArrayBuffer) return new Uint8Array(res);
      if (typeof Buffer !== "undefined" && Buffer.isBuffer(res)) {
        return new Uint8Array(res.buffer, res.byteOffset, res.byteLength);
      }
      return new Uint8Array(res);
    }
    return new Uint8Array();
  }

  listen<T = any>(event: string, handler: (payload: T) => void): UnlistenFn {
    const tauri = this.getTauri();
    if (tauri?.event?.listen) {
      let active = true;
      tauri.event
        .listen(event, (evt: any) => {
          if (active) handler(evt.payload);
        })
        .then((unlisten: any) => {
          if (!active && typeof unlisten === "function") {
            unlisten();
          }
        });
      return () => {
        active = false;
      };
    }
    return () => {};
  }

  emit(event: string, payload?: unknown): void {
    const tauri = this.getTauri();
    if (tauri?.event?.emit) {
      tauri.event.emit(event, payload);
    }
  }

  async invokeCmd<T = any>(command: string, payload?: any): Promise<T> {
    return await this.invoke<T>(command, payload);
  }

  async getConfig(): Promise<AppConfigDTO> {
    try {
      return await this.invoke("toad:get_config");
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
          engine: "tauri",
          auto_fallback: false,
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
    return await this.invoke("plugin:dialog|open", options);
  }

  async showSaveDialog(options: SaveDialogOptions): Promise<string | null> {
    return await this.invoke("plugin:dialog|save", options);
  }

  async showErrorDialog(title: string, message: string, fatal = false): Promise<void> {
    try {
      await this.invoke("plugin:dialog|error", { title, message, fatal });
    } catch {
      console.error(`[TauriHostAdapter:ErrorDialog] ${title}: ${message}`);
    }
  }

  async openExternal(url: string): Promise<void> {
    try {
      await this.invoke("plugin:opener|open_url", { url });
    } catch {
      if (typeof window !== "undefined") {
        window.open(url, "_blank");
      }
    }
  }

  copyToClipboard(text: string): void {
    this.clipboardText = text;
    this.invoke("plugin:clipboard|write_text", { text }).catch(() => {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        navigator.clipboard.writeText(text).catch(() => {});
      }
    });
  }

  getClipboardText(): string {
    return this.clipboardText;
  }

  async openNewWindow(dsPath: any): Promise<void> {
    return await this.invoke("toad:new_window", dsPath);
  }

  onEvent<T = any>(channel: string, listener: (data: T) => void): () => void {
    return this.listen<T>(channel, listener);
  }

  sendEvent(channel: string, payload?: any): void {
    this.emit(channel, payload);
  }

  setTheme(theme: "light" | "dark"): void {
    this.currentTheme = theme;
    if (typeof document !== "undefined") {
      document.documentElement.className = `theme-${theme}`;
      localStorage.setItem("toad-theme-v2", theme);
    }
  }

  getTheme(): "light" | "dark" {
    if (typeof localStorage !== "undefined") {
      return (localStorage.getItem("toad-theme-v2") as "light" | "dark") || "light";
    }
    return this.currentTheme;
  }
}
