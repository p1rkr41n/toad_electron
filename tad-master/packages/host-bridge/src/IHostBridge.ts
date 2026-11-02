import { TransportClient } from "reltab";

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
    engine: "v8" | "tauri" | "auto";
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
  readonly engineName: "v8" | "tauri";

  // Low-level RPC invocation (TransportClient compatible)
  invoke(functionName: string, req: any): Promise<any>;

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

  // Pub/Sub Events between Host Shell and UI Canvas
  onEvent<T = any>(channel: string, listener: (data: T) => void): () => void;
  sendEvent(channel: string, payload?: any): void;

  // Theme Management
  setTheme(theme: "light" | "dark"): void;
  getTheme(): "light" | "dark";
}
