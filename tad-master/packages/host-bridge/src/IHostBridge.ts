import { TransportClient } from "reltab";

export type EngineName = "utility" | "legacy" | "v8" | "headless" | "tauri";

export type UnlistenFn = () => void;

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface OpenDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: FileFilter[];
  directory?: boolean;
  multiple?: boolean;
}

export interface SaveDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: FileFilter[];
}

export interface AppConfigDTO {
  general: {
    viewer: string;
    language: string;
    page_size: number;
    max_concurrent_files: number;
    max_concurrent_gb: number;
  };
  runtime?: {
    engine: "utility" | "legacy" | "v8" | "tauri" | "headless" | "auto";
    auto_fallback: boolean;
  };
  duckdb: {
    max_memory: string;
    threads: number;
    background_threads: string | number;
    add_raw_event: boolean;
  };
  parquet: {
    compression: string;
    row_group_size: number;
  };
  system: {
    temp_cleanup: boolean;
    binary_guard: boolean;
  };
}

/**
 * Ring 2: Host Bridge Abstraction Interface
 * Bridges the UI Canvas (Ring 3) to the Native OS / Runtime Shell (Ring 3 Hosts)
 * Extends TransportClient from reltab so all DuckDB queries flow through it naturally.
 */
export interface IHostBridge extends TransportClient {
  readonly engineName: EngineName;

  // 1. Unified Command Execution (Tauri v2 invoke)
  invoke<T = any>(cmd: string, args?: Record<string, unknown> | any): Promise<T>;

  // 2. Binary Execution (Tauri raw binary response)
  invokeBinary(cmd: string, args?: Record<string, unknown> | any): Promise<Uint8Array>;

  // 3. Event System (Tauri v2 listen & emit)
  listen<T = any>(event: string, handler: (payload: T) => void): UnlistenFn;
  emit(event: string, payload?: unknown): void;

  // Tauri-standard asynchronous invocation signature
  invokeCmd<T = any>(command: string, payload?: any): Promise<T>;

  // Configuration management
  getConfig(): Promise<AppConfigDTO>;

  // Native OS Dialogs
  showOpenDialog(options: OpenDialogOptions): Promise<string[] | null>;
  showSaveDialog(options: SaveDialogOptions): Promise<string | null>;
  showErrorDialog(title: string, message: string, fatal?: boolean): Promise<void>;

  // Window, External Links & Clipboard
  openExternal(url: string): Promise<void>;
  copyToClipboard(text: string): void;
  openNewWindow(dsPath: any): Promise<void>;

  // High-speed Data Port setup (MessagePort)
  setupDataPort?(port: any): void;

  // Engine Lifecycle Supervision Listeners
  onEngineCrash?(listener: () => void): () => void;
  onEngineRestored?(callback: () => void): () => void;

  // Pub/Sub Events between Host Shell and UI Canvas
  onEvent<T = any>(channel: string, listener: (data: T) => void): () => void;
  sendEvent(channel: string, payload?: any): void;

  // Theme Management
  setTheme(theme: "light" | "dark"): void;
  getTheme(): "light" | "dark";
}
