/*
 * main module for render process (Platform Agnostic UI Entry)
 */
if (typeof BigInt !== "undefined" && !(BigInt.prototype as any).toJSON) {
  (BigInt.prototype as any).toJSON = function () {
    const num = Number(this);
    return Number.isSafeInteger(num) ? num : this.toString();
  };
}

import { getHostBridge } from "host-bridge";

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

import * as React from "react";
import * as ReactDOM from "react-dom/client";
import OneRef, { mkRef, refContainer, mutableGet, StateRef } from "oneref";
import {
  AppPane,
  AppPaneBaseProps,
  ExportFormat,
  ParquetExportOptions,
  MultipleLoadingManager,
  ProjectWorkspaceManager,
} from "toadviewer";
import { PivotRequester } from "toadviewer";
import { AppState } from "toadviewer";
import { ViewParams, actions } from "toadviewer";
import { initAppState } from "toadviewer";
import * as reltab from "reltab";
import log from "loglevel";
import { DataSourcePath, DataSourceId, RemoteReltabConnection } from "reltab";
import { OpenParams } from "./openParams";
import "./app.css";

const bridge = getHostBridge();

const initMainProcess = () => bridge.invokeCmd("initMain");
const getToadConfig = () => bridge.invokeCmd("getToadConfig");
const remoteErrorDialog = (title: string, msg: string, fatal = false) => {
  return bridge.showErrorDialog(title, msg, fatal);
};
const newWindowFromDSPath = (
  dsPath: DataSourcePath,
  stateRef: StateRef<AppState>
) => bridge.openNewWindow(dsPath);

type InitInfo = {
  connKey: DataSourceId;
};

let delay = (ms: number) => {
  if (ms > 0) {
    log.log("injecting delay of ", ms, " ms");
  }

  return new Promise((resolve) => setTimeout(resolve, ms));
};

function openParamsDSPath(
  openParams: OpenParams
): [DataSourcePath | null, ViewParams | null] {
  let targetDSPath: DataSourcePath | null = null;
  let viewParams: ViewParams | null = null;
  switch (openParams.openType) {
    case "fspath":
      const connKey: DataSourceId = {
        providerName: "localfs",
        resourceId: openParams.path,
      };
      targetDSPath = { sourceId: connKey, path: ["."] };
      break;
    case "dspath":
      targetDSPath = openParams.dsPath;
      break;
    case "toad":
    case "tad":
      const parsedFileState = JSON.parse(openParams.fileContents!);
      const savedFileState = parsedFileState.contents;
      // attempt to migrate from legacy version 1 format (or if targetPath is present without dsPath):
      if (
        parsedFileState.tadFileFormatVersion === 1 ||
        Boolean(savedFileState?.targetPath && !savedFileState?.dsPath)
      ) {
        const rawTargetPath = savedFileState.targetPath;
        log.info("Found legacy tad file format, targetPath: ", rawTargetPath);
        const connKey: DataSourceId = {
          providerName: "localfs",
          resourceId: rawTargetPath,
        };
        targetDSPath = { sourceId: connKey, path: ["."] };
      } else {
        targetDSPath = savedFileState.dsPath;
      }
      viewParams = ViewParams.deserialize(savedFileState.viewParams);
      break;
    case "empty":
      targetDSPath = null;
  }
  return [targetDSPath, viewParams];
}

async function openFromOpenParams(
  openParams: OpenParams | undefined,
  stateRef: StateRef<AppState>
) {
  let targetDSPath: DataSourcePath | null = null;
  let viewParams: ViewParams | null = null;

  if (openParams) {
    [targetDSPath, viewParams] = openParamsDSPath(openParams);
    if (targetDSPath !== null) {
      await actions.openDataSourcePath(
        targetDSPath,
        stateRef,
        viewParams ?? undefined
      );
    }
  }
}
// TODO: figure out how to initialize based on saved views or different file / table names
const init = async () => {
  const tStart = performance.now();
  log.setLevel(log.levels.INFO); // debug for more verbosity
  const appState = new AppState();
  const stateRef = mkRef(appState);
  const [App, listenerId] = refContainer<AppState, AppPaneBaseProps>(
    stateRef,
    AppPane
  );

  try {
    await initMainProcess();
    try {
      const cfg = await getToadConfig();
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
    const tconn = getHostBridge();

    const rtc = new RemoteReltabConnection(tconn);

    var pivotRequester: PivotRequester | undefined | null = null;

    await initAppState(rtc, stateRef);

    const openURL = (url: string) => {
      bridge.openExternal(url);
    };

    const appClipboard = {
      writeText: (text: string) => bridge.copyToClipboard(text),
    };

    const root = ReactDOM.createRoot(document.getElementById("app")!);

    root.render(
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
    );
    const tRender = performance.now();
    log.debug("Time to initial render: ", (tRender - tStart) / 1000, " sec");
    pivotRequester = new PivotRequester(stateRef);

    const openParams = (window as any).openParams as OpenParams | undefined;
    await openFromOpenParams(openParams, stateRef);

    bridge.onEvent("request-serialize-app-state", (req: any) => {
      const { requestId } = req;
      const curState = mutableGet(stateRef);
      const viewState = curState.viewState;
      const { dsPath } = viewState;
      const viewParamsJS = (viewState.viewParams as any).toJS(); // weird typing issue with immmutable
      const serState = {
        dsPath,
        viewParams: viewParamsJS,
      };
      bridge.sendEvent("response-serialize-app-state", {
        requestId,
        contents: serState,
      });
    });
    bridge.onEvent("set-show-hidden-cols", (val: boolean) => {
      actions.setShowHiddenCols(val, stateRef);
    });
    bridge.onEvent("request-serialize-filter-query", (req: any) => {
      // console.log("got request-serialize-filter-query: ", req);
      const { requestId } = req;
      const curState = mutableGet(stateRef);
      const baseQuery = curState.viewState.baseQuery;
      const viewParams = curState.viewState.viewParams;
      const filterRowCount = curState.viewState.queryView!.filterRowCount;
      const queryObj = {
        query: baseQuery.filter(viewParams.filterExp),
        filterRowCount,
      };
      const contents = JSON.stringify(queryObj, null, 2);
      bridge.sendEvent("response-serialize-filter-query", {
        requestId,
        contents,
      });
    });
    bridge.onEvent("open-export-begin-dialog", (req: any) => {
      const { openState, saveFilename } = req;
      actions.setExportBeginDialogOpen(openState, stateRef);
    });
    bridge.onEvent("open-export-progress-dialog", (req: any) => {
      const { openState, exportPathBaseName } = req;
      actions.setExportProgressDialogOpen(
        openState,
        exportPathBaseName,
        stateRef
      );
    });
    bridge.onEvent("close-export-progress-dialog", () => {
      actions.setExportProgressDialogOpen(false, "", stateRef);
    });
    bridge.onEvent("set-export-path", (req: any) => {
      const { exportPath } = req;
      actions.setExportPath(exportPath, stateRef);
    });
    bridge.onEvent("export-progress", (req: any) => {
      const { percentComplete } = req;
      actions.setExportProgress(percentComplete, stateRef);
    });
    bridge.onEvent("toad-ingest-progress", (req: any) => {
      actions.setIngestProgress(req, stateRef);
      MultipleLoadingManager.getInstance().handleIngestProgress(req, stateRef);
    });
    bridge.onEvent("open-file", (req: any) => {
      const { openParams } = req;
      openFromOpenParams(openParams, stateRef);
    });

    bridge.onEvent("reopen-current-file", async () => {
      log.info("appMain: received reopen-current-file IPC");
      await actions.reopenCurrentView(stateRef);
    });

    bridge.onEvent("engine:restored", async (details: any) => {
      log.info("appMain: received engine:restored IPC", details);
      if ((bridge as any)?.dataPort) {
        rtc.setDataPort((bridge as any).dataPort);
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("engine:restored", { detail: details })
        );
      }
    });

    bridge.onEvent("project-add-files", async () => {
      try {
        log.info("appMain: received project-add-files IPC");
        const chosen = await bridge.showOpenDialog({
          title: "Add Files to Active Project",
          multiple: true,
        });
        if (chosen && chosen.length > 0) {
          const pwManager = ProjectWorkspaceManager.getInstance();
          const ws = await pwManager.getWorkspace();
          const activeId =
            ws.activeProjectId ||
            (ws.projects && ws.projects[0]?.projectId) ||
            "prj_untitled_1";
          await pwManager.addFilesToProject(activeId, chosen);
        }
      } catch (err) {
        log.error("Error adding files to project from menu:", err);
      }
    });

    bridge.onEvent("project-add-folder", async () => {
      try {
        log.info("appMain: received project-add-folder IPC");
        const chosen = await bridge.showOpenDialog({
          title: "Add Folder to Active Project",
          directory: true,
        });
        if (chosen && chosen.length > 0 && chosen[0]) {
          const pwManager = ProjectWorkspaceManager.getInstance();
          const ws = await pwManager.getWorkspace();
          const activeId =
            ws.activeProjectId ||
            (ws.projects && ws.projects[0]?.projectId) ||
            "prj_untitled_1";
          await pwManager.addFolderToProject(activeId, chosen[0]);
        }
      } catch (err) {
        log.error("Error adding folder to project from menu:", err);
      }
    });

    document.addEventListener("copy", function (e) { });

    bridge.sendEvent("render-init-complete");
  } catch (e) {
    const err = e as any;
    console.error(
      "renderMain: caught error during initialization: ",
      err.message,
      err.stack
    );
    remoteErrorDialog("Error initializing TOAD", err.message, true);
  }
};
init();
