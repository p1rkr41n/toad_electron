// Global BigInt serialization polyfill for Arrow / DuckDB query payload serialization
if (typeof BigInt !== "undefined" && !(BigInt.prototype as any).toJSON) {
  (BigInt.prototype as any).toJSON = function () {
    const num = Number(this);
    return Number.isSafeInteger(num) ? num : this.toString();
  };
}

// Global Console Interceptor & Hybrid Buffer for comprehensive Toad diagnostics
interface QueuedLogEntry {
  level: string;
  message: string;
  details?: string | null;
  timestamp: number;
}

const rawConsoleLog = typeof console !== "undefined" ? console.log : () => {};
const rawConsoleWarn = typeof console !== "undefined" ? console.warn : () => {};
const rawConsoleError = typeof console !== "undefined" ? console.error : () => {};
const rawConsoleInfo = typeof console !== "undefined" ? console.info : () => {};
const rawConsoleDebug = typeof console !== "undefined" ? console.debug : () => {};

let isForwarding = false;
const logBuffer: QueuedLogEntry[] = [];
let bufferTimer: any = null;

function flushLogBuffer() {
  if (bufferTimer) {
    clearTimeout(bufferTimer);
    bufferTimer = null;
  }
  if (logBuffer.length === 0) return;
  const entriesToSend = logBuffer.splice(0, logBuffer.length);
  if (typeof window !== "undefined" && (window as any).__TAURI__?.core?.invoke) {
    isForwarding = true;
    (window as any).__TAURI__.core
      .invoke("toad:log", { entries: entriesToSend })
      .catch(() => {})
      .finally(() => {
        isForwarding = false;
      });
  }
}

function forwardLogToBackend(level: string, message: string, details?: any) {
  if (isForwarding) return;
  try {
    const strDetails = details
      ? typeof details === "string"
        ? details
        : JSON.stringify(details)
      : null;

    const entry: QueuedLogEntry = {
      level,
      message,
      details: strDetails,
      timestamp: Date.now(),
    };

    if (level === "error" || level === "warn") {
      // Instant flush for errors and warnings to prevent log loss
      if (typeof window !== "undefined" && (window as any).__TAURI__?.core?.invoke) {
        isForwarding = true;
        (window as any).__TAURI__.core
          .invoke("toad:log", {
            level,
            message,
            details: strDetails,
            timestamp: entry.timestamp,
          })
          .catch(() => {})
          .finally(() => {
            isForwarding = false;
          });
      }
    } else {
      // 50ms batching buffer for high-frequency logs to protect UI 60 FPS
      logBuffer.push(entry);
      if (logBuffer.length >= 25) {
        flushLogBuffer();
      } else if (!bufferTimer) {
        bufferTimer = setTimeout(flushLogBuffer, 50);
      }
    }
  } catch {}
}

function formatConsoleArgs(args: any[]): { message: string; details?: any } {
  if (!args || args.length === 0) return { message: "" };
  const parts: string[] = [];
  let details: any = null;
  for (const arg of args) {
    if (arg instanceof Error) {
      parts.push(arg.message || String(arg));
      details = { stack: arg.stack, ...(details || {}) };
    } else if (typeof arg === "object" && arg !== null) {
      try {
        parts.push(JSON.stringify(arg));
      } catch {
        parts.push(String(arg));
      }
    } else {
      parts.push(String(arg));
    }
  }
  return { message: parts.join(" "), details };
}

if (typeof console !== "undefined") {
  console.log = function (...args: any[]) {
    rawConsoleLog.apply(console, args);
    if (!isForwarding) {
      const { message, details } = formatConsoleArgs(args);
      forwardLogToBackend("info", message, details);
    }
  };
  console.info = function (...args: any[]) {
    rawConsoleInfo.apply(console, args);
    if (!isForwarding) {
      const { message, details } = formatConsoleArgs(args);
      forwardLogToBackend("info", message, details);
    }
  };
  console.warn = function (...args: any[]) {
    rawConsoleWarn.apply(console, args);
    if (!isForwarding) {
      const { message, details } = formatConsoleArgs(args);
      forwardLogToBackend("warn", message, details);
    }
  };
  console.error = function (...args: any[]) {
    rawConsoleError.apply(console, args);
    if (!isForwarding) {
      const { message, details } = formatConsoleArgs(args);
      forwardLogToBackend("error", message, details);
    }
  };
  console.debug = function (...args: any[]) {
    rawConsoleDebug.apply(console, args);
    if (!isForwarding) {
      const { message, details } = formatConsoleArgs(args);
      forwardLogToBackend("debug", message, details);
    }
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("error", (e) => {
    rawConsoleError("[UNCAUGHT-WINDOW-ERROR]", e.message, e.error?.stack);
    forwardLogToBackend("error", `[UNCAUGHT-WINDOW-ERROR] ${e.message}`, {
      stack: e.error?.stack,
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
    });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const msg = e.reason?.message || String(e.reason);
    rawConsoleError("[UNCAUGHT-PROMISE-REJECTION]", msg, e.reason?.stack);
    forwardLogToBackend("error", `[UNCAUGHT-PROMISE-REJECTION] ${msg}`, {
      stack: e.reason?.stack,
    });
  });
}

import React from "react";
import ReactDOM from "react-dom/client";
import OneRef, { mkRef, refContainer, mutableGet, StateRef } from "oneref";
import * as reltab from "reltab";
import log from "loglevel";
import { DataSourcePath, DataSourceId, RemoteReltabConnection } from "reltab";
import { getHostBridge, setHostBridge, TauriHostAdapter } from "host-bridge";

import "./toadviewer";
import {
  AppPane,
  AppPaneBaseProps,
  ExportFormat,
  ParquetExportOptions,
  MultipleLoadingManager,
  ProjectWorkspaceManager,
  PivotRequester,
  AppState,
  ViewParams,
  actions,
  initAppState,
} from "./toadviewer";

async function bootstrap() {
  log.setLevel(log.levels.TRACE);
  forwardLogToBackend("info", "Toad Desktop Frontend bootstrap started with TRACE log level");

  const bridge =
    typeof window !== "undefined" && (window as any).__TAURI__
      ? new TauriHostAdapter()
      : getHostBridge();
  setHostBridge(bridge);

  const appState = new AppState();
  const stateRef = mkRef(appState);
  const [App] = refContainer<AppState, AppPaneBaseProps>(stateRef, AppPane);

  try {
    await bridge.invoke("toad:init_main").catch(() => {});
    try {
      const cfg = await bridge.getConfig();
      if (cfg && cfg.general) {
        if (cfg.general.page_size) {
          actions.setDefaultPageSize(Number(cfg.general.page_size));
        }
        MultipleLoadingManager.getInstance().setConfig({
          maxConcurrentFiles: cfg.general.max_concurrent_files,
          maxConcurrentGB: cfg.general.max_concurrent_gb,
        });
      }
    } catch (e) {
      log.warn("Could not load toad config in renderer:", e);
    }

    const rtc = new RemoteReltabConnection(bridge);
    await initAppState(rtc, stateRef);
    const pivotRequester = new PivotRequester(stateRef);

    const openURL = (url: string) => {
      bridge.openExternal(url);
    };

    const appClipboard = {
      writeText: (text: string) => bridge.copyToClipboard(text),
    };

    const newWindowFromDSPath = (
      dsPath: DataSourcePath,
      sRef: StateRef<AppState>
    ) => bridge.openNewWindow(dsPath);

    // Event bridges for forensics & workspace
    bridge.onEvent("toad:ingest-progress", (payload: any) => {
      MultipleLoadingManager.getInstance().handleIngestProgress(payload, stateRef);
    });
    bridge.onEvent("toad-ingest-progress", (payload: any) => {
      MultipleLoadingManager.getInstance().handleIngestProgress(payload, stateRef);
    });
    bridge.onEvent("project:workspaceChanged", () => {
      ProjectWorkspaceManager.getInstance().notify();
    });

    // =========================================================================
    // Native Drag-and-Drop Ingestion for Tauri v2 (Requirement R3)
    // =========================================================================
    const handleNativeFileDrop = async (rawPaths: string[]) => {
      if (!rawPaths || !Array.isArray(rawPaths) || rawPaths.length === 0) return;

      const supportedExts = new Set([".csv", ".tsv", ".parquet", ".json", ".evtx"]);
      const validPaths = rawPaths.filter((p) => {
        if (!p || typeof p !== "string") return false;
        const lastDot = p.lastIndexOf(".");
        if (lastDot === -1) return false;
        const ext = p.substring(lastDot).toLowerCase();
        return supportedExts.has(ext);
      });

      if (validPaths.length === 0) return;

      try {
        const pwManager = ProjectWorkspaceManager.getInstance();
        const ws = await pwManager.getWorkspace();
        let activeProjectId = ws.activeProjectId || (ws.projects && ws.projects[0]?.projectId);
        if (!activeProjectId) {
          activeProjectId = await pwManager.createProject("Untitled-1");
        }

        // 1. Add files to active project catalog
        await pwManager.addFilesToProject(activeProjectId, validPaths);

        // 2. Trigger background ingestion
        for (const p of validPaths) {
          try {
            if (bridge && typeof bridge.invoke === "function") {
              bridge.invoke("toad:ingest_file", { filePath: p, projectId: activeProjectId }).catch(() => {});
            }
          } catch {}
        }

        // 3. Automatically open the first dropped file in Main DataGrid
        const firstFile = validPaths[0];
        const dsPath: DataSourcePath = {
          sourceId: { providerName: "localfs", resourceId: firstFile },
          path: ["."],
        };
        await actions.openDataSourcePath(dsPath, stateRef);
      } catch (dropErr) {
        console.error("[main.tsx] Error handling native dropped files:", dropErr);
      }
    };

    const onDropPayload = (payload: any) => {
      let paths: string[] = [];
      if (Array.isArray(payload)) {
        paths = payload;
      } else if (payload && Array.isArray(payload.paths)) {
        paths = payload.paths;
      } else if (payload && payload.type === "drop" && Array.isArray(payload.paths)) {
        paths = payload.paths;
      }
      if (paths.length > 0) {
        handleNativeFileDrop(paths);
      }
    };

    // Register Tauri v2 native drag-drop listeners
    try {
      bridge.onEvent("tauri://drag-drop", (payload: any) => {
        onDropPayload(payload);
      });
    } catch {}

    if (typeof window !== "undefined") {
      window.addEventListener("dragover", (e) => e.preventDefault(), false);
      window.addEventListener("drop", (e) => e.preventDefault(), false);

      if ((window as any).__TAURI__) {
        try {
          import("@tauri-apps/api/webviewWindow").then(({ getCurrentWebviewWindow }) => {
            const win = getCurrentWebviewWindow();
            if (win && typeof win.onDragDropEvent === "function") {
              win.onDragDropEvent((event) => {
                if (event.payload.type === "drop") {
                  onDropPayload(event.payload.paths);
                }
              });
            }
          }).catch(() => {});
        } catch {}

        try {
          import("@tauri-apps/api/event").then(({ listen }) => {
            listen("tauri://drag-drop", (event: any) => {
              onDropPayload(event.payload);
            });
          }).catch(() => {});
        } catch {}
      }
    }

    const container = document.getElementById("app") || document.getElementById("root");
    if (container) {
      const root = ReactDOM.createRoot(container);
      root.render(
        <React.StrictMode>
          <App
            newWindow={newWindowFromDSPath}
            clipboard={appClipboard}
            openURL={openURL}
            embedded={false}
            onBrowseExportPath={(exportFormat: ExportFormat) =>
              bridge.sendEvent("browse-export-path", { exportFormat })
            }
            onExportFile={(
              exportFormat: ExportFormat,
              exportPath: string,
              parquetExportOptions: ParquetExportOptions
            ) =>
              bridge.sendEvent("export-file", {
                exportFormat,
                exportPath,
                parquetExportOptions,
              })
            }
          />
        </React.StrictMode>
      );
    }
  } catch (err: any) {
    console.error("[BOOTSTRAP ERROR]", err);
  }
}

bootstrap();

export default bootstrap;
