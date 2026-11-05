// Global BigInt serialization polyfill for Arrow / DuckDB query payload serialization
if (typeof BigInt !== "undefined" && !(BigInt.prototype as any).toJSON) {
  (BigInt.prototype as any).toJSON = function () {
    const num = Number(this);
    return Number.isSafeInteger(num) ? num : this.toString();
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("error", (e) => {
    console.error("[UNCAUGHT-WINDOW-ERROR]", e.message, e.error?.stack);
  });
  window.addEventListener("unhandledrejection", (e) => {
    console.error(
      "[UNCAUGHT-PROMISE-REJECTION]",
      e.reason?.message || String(e.reason),
      e.reason?.stack
    );
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
  log.setLevel(log.levels.INFO);

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
