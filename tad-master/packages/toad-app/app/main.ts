if (typeof BigInt !== "undefined" && !(BigInt.prototype as any).toJSON) {
  (BigInt.prototype as any).toJSON = function () {
    const num = Number(this);
    return Number.isSafeInteger(num) ? num : this.toString();
  };
}

// Auto-configure UV_THREADPOOL_SIZE early before libuv threads are spawned
{
  const os = require("os");
  const hostCpus = os.cpus() ? os.cpus().length : 4;
  if (!process.env.UV_THREADPOOL_SIZE) {
    try {
      const fs = require("fs");
      const path = require("path");
      const exeDir = path.dirname(process.execPath || process.argv[0]);
      let targetIni: string | null = null;
      const directIni = path.join(exeDir, "config.ini");
      if (fs.existsSync(directIni)) {
        targetIni = directIni;
      } else {
        const entries = fs.readdirSync(exeDir, { withFileTypes: true });
        for (const ent of entries) {
          if (ent.isDirectory() && /^toadAppData_[a-z0-9]{5}$/i.test(ent.name)) {
            const subIni = path.join(exeDir, ent.name, "config.ini");
            if (fs.existsSync(subIni)) {
              targetIni = subIni;
              break;
            }
          }
        }
      }
      if (targetIni) {
        const iniText = fs.readFileSync(targetIni, "utf8");
        const match = iniText.match(/^\s*uv_threadpool_size\s*=\s*(\S+)/m);
        if (match && match[1]) {
          const val = match[1].trim().toLowerCase();
          if (val !== "auto") {
            const num = parseInt(val, 10);
            if (!isNaN(num) && num >= 4 && num <= 128) {
              process.env.UV_THREADPOOL_SIZE = String(num);
            }
          }
        }
      }
    } catch {}

    if (!process.env.UV_THREADPOOL_SIZE) {
      process.env.UV_THREADPOOL_SIZE = String(
        Math.min(128, Math.max(8, hostCpus * 2))
      );
    }
  }
}

import "source-map-support/register";
import commandLineArgs, {
  CommandLineOptions,
  ParseOptions,
} from "command-line-args";
import getUsage from "command-line-usage";
import log from "electron-log";
import * as logLevel from "loglevel";
import * as reltab from "reltab";
import * as reltabDuckDB from "reltab-duckdb";
import "reltab-duckdb";
import * as reltabFS from "reltab-fs";
import "reltab-fs";
import * as setup from "./setup";
import * as quickStart from "./quickStart";
import * as appMenu from "./appMenu";
import * as appWindow from "./appWindow";
import electron, { BrowserWindow, contextBridge, ipcMain } from "electron";
import { EngineSupervisor } from "./engineSupervisor";
import fs from "fs";
import {
  initPortableEnvironment,
  cleanTempDir,
  PortableEnvironment,
} from "./portableAppData";

const dialog = electron.dialog;
const app = electron.app;

import path from "path";

import pkgInfo from "../package.json";
import {
  DataSourceId,
  EvalQueryOptions,
  TransportServer,
  serverInit,
  DataSourcePath,
  DbDataSource,
} from "reltab";
import { isIPFSPath } from "reltab-fs";

require("console.table"); // Can insert delay in promise chain by:
// delay(amount).then(() => ...)

let delay = (ms: number) => {
  if (ms > 0) {
    log.log("injecting delay of ", ms, " ms");
  }

  return new Promise((resolve) => setTimeout(resolve, ms));
};


class ElectronTransportServer implements TransportServer {
  registerInvokeHandler(
    functionName: string,
    handler: (req: any) => Promise<any>
  ): void {
    // TODO: catch exceptions and map into a serializable failure
    ipcMain.handle(functionName, async (event, req) => handler(req));

    // Register short and legacy aliases for seamless Tauri-like & fallback compatibility
    if (functionName.startsWith("DataSourceConnection.")) {
      const shortName = functionName.slice("DataSourceConnection.".length);
      try {
        ipcMain.handle(shortName, async (event, req) => handler(req));
      } catch {}
      if (shortName === "getTableSchema") {
        try {
          ipcMain.handle("schema", async (event, req) => handler(req));
        } catch {}
      }
    }
  }
}

/*
 * main process initialization
 *
 * invoked via electron remote
 *
 */

let mainInitialized = false;

const initMainAsync = async (options: any): Promise<void> => {
  if (mainInitialized) {
    return;
  }
  let rtOptions: any = {};

  if (options["show-queries"]) {
    rtOptions.showQueries = true;
    logLevel.setLevel(logLevel.levels.INFO);
    log.info("initMainAsync -- showQueries enabled, set log level to INFO");
  }
  log.debug("initMainAsync: ", options);


  /*
  let rtc: reltabSqlite.SqliteContext;
  let connKey: DataSourceId;

  connKey = {
    providerName: "sqlite",
    resourceId: ":memory:",
  };
  rtc = (await getConnection(connKey)) as reltabSqlite.SqliteContext;
  */
  let connKey: DataSourceId;

  /*
  connKey = {
    providerName: "duckdb",
    resourceId: ":memory:",
  };
  */

  /*
  connKey = {
    providerName: "localfs",
    resourceId: "",
  };
  const rtc = await getConnection(connKey);

  (global as any).appRtc = rtc;
  */
  const ts = new ElectronTransportServer();
  serverInit(ts);

  mainInitialized = true;
};

const newWindowFromDSPath = async (path: DataSourcePath) => {
  await appWindow.createFromDSPath(path);
};

const remotableNewWindowFromDSPath = (
  dsPathStr: string,
  cb: (res: any, err: any) => void
) => {
  const dsPath: DataSourcePath = JSON.parse(dsPathStr) as DataSourcePath;
  newWindowFromDSPath(dsPath)
    .then(() => cb(null, null))
    .catch((err) => cb(err, null));
};

const appInit = (options: any) => {
  // log.log('appInit: ', options)
  ipcMain.handle("initMain", async (event) => initMainAsync(options));
  ipcMain.handle("errorDialog", (event, arg1, arg2, arg3) =>
    errorDialog(arg1, arg2, arg3)
  );
  ipcMain.handle("newWindowFromDSPath", (event, dsPath) =>
    newWindowFromDSPath(dsPath)
  );
  ipcMain.handle("getToadConfig", async () => {
    return (global as any).toadPortableEnv?.config || null;
  });

  ipcMain.handle("dialog:showOpenDialog", async (event, options) => {
    const win =
      BrowserWindow.fromWebContents(event.sender) ||
      BrowserWindow.getFocusedWindow();
    const properties: any[] = [];
    if (options?.directory) {
      properties.push("openDirectory");
    } else {
      properties.push("openFile");
      if (options?.multiple) {
        properties.push("multiSelections");
      }
    }
    const res = await dialog.showOpenDialog(win!, {
      title:
        options?.title ||
        (options?.directory
          ? "Select Folder to Add to Project"
          : "Select Data Files to Add to Project"),
      defaultPath: options?.defaultPath,
      filters: options?.filters || [
        {
          name: "All Supported Data Files",
          extensions: reltabFS.dataFileExtensions.concat([
            "toad",
            "tad",
            "sqlite",
            "duckdb",
          ]),
        },
        {
          name: "CSV / TSV / Log Files (*.csv, *.tsv, *.log, *.txt)",
          extensions: ["csv", "tsv", "log", "txt", "csv.gz", "tsv.gz"],
        },
        {
          name: "JSON / JSONL Files (*.json, *.jsonl, *.ndjson)",
          extensions: ["json", "jsonl", "ndjson"],
        },
        {
          name: "Windows Event Logs (*.evtx)",
          extensions: ["evtx"],
        },
        {
          name: "Parquet Files (*.parquet)",
          extensions: ["parquet"],
        },
        {
          name: "Database Files (*.duckdb, *.sqlite)",
          extensions: ["duckdb", "sqlite"],
        },
        {
          name: "All Files (*.*)",
          extensions: ["*"],
        },
      ],
      properties,
    });
    if (res.canceled || !res.filePaths) {
      return null;
    }
    return res.filePaths;
  });

  ipcMain.handle("dialog:showSaveDialog", async (event, options) => {
    const win =
      BrowserWindow.fromWebContents(event.sender) ||
      BrowserWindow.getFocusedWindow();
    const res = await dialog.showSaveDialog(win!, {
      title: options?.title,
      defaultPath: options?.defaultPath,
      filters: options?.filters,
    });
    if (res.canceled || !res.filePath) {
      return null;
    }
    return res.filePath;
  });

  ipcMain.handle("project:getWorkspace", async () => {
    const ledger = reltabDuckDB.ToadParquetLedger.getInstance();
    await ledger.initLedger();
    return {
      projects: ledger.getProjects(),
      activeProjectId: ledger.getActiveProjectId(),
    };
  });

  ipcMain.handle("project:getFiles", async (event, req) => {
    const ledger = reltabDuckDB.ToadParquetLedger.getInstance();
    await ledger.initLedger();
    const files = ledger.getProjectFiles(req?.projectId);
    return files.map((f: any) => {
      let folderRoot: string | undefined;
      let folderName: string | undefined;
      let relPath: string | undefined;
      if (f.extra_json) {
        try {
          const ex = JSON.parse(f.extra_json);
          folderRoot = ex.folderRoot;
          folderName = ex.folderName;
          relPath = ex.relPath;
        } catch {}
      }
      return {
        filePath: f.source_path,
        fileName: path.basename(f.source_path || "") || "Unnamed File",
        projectId: f.project_id || req?.projectId,
        projectName: f.project_name || "Untitled-1",
        fileSizeBytes: f.source_size,
        rowCount: f.row_count,
        status: f.status,
        parquetPath: f.parquet_path,
        folderRoot,
        folderName,
        relPath,
      };
    });
  });

  ipcMain.handle("project:create", async (event, req) => {
    const ledger = reltabDuckDB.ToadParquetLedger.getInstance();
    await ledger.initLedger();
    return await ledger.createProject(req?.projectName || "Untitled Project", req?.projectId);
  });

  ipcMain.handle("project:rename", async (event, req) => {
    const ledger = reltabDuckDB.ToadParquetLedger.getInstance();
    await ledger.initLedger();
    return await ledger.renameProject(req?.projectId, req?.newName);
  });

  ipcMain.handle("project:delete", async (event, req) => {
    const ledger = reltabDuckDB.ToadParquetLedger.getInstance();
    await ledger.initLedger();
    return await ledger.deleteProjectCascade(req?.projectId);
  });

  ipcMain.handle("project:deleteAll", async () => {
    const ledger = reltabDuckDB.ToadParquetLedger.getInstance();
    await ledger.initLedger();
    return await ledger.deleteAllProjectsCascade();
  });

  ipcMain.handle("project:getCacheSize", async (event, req) => {
    const ledger = reltabDuckDB.ToadParquetLedger.getInstance();
    await ledger.initLedger();
    return ledger.getProjectCacheSize(req?.projectId);
  });

  ipcMain.handle("project:purgeCache", async (event, req) => {
    const ledger = reltabDuckDB.ToadParquetLedger.getInstance();
    await ledger.initLedger();
    return await ledger.purgeProjectCache(req?.projectId);
  });

  ipcMain.handle("project:removeFile", async (event, req) => {
    const ledger = reltabDuckDB.ToadParquetLedger.getInstance();
    await ledger.initLedger();
    return await ledger.removeFileFromProject(req?.projectId, req?.filePath);
  });

  ipcMain.handle("project:addFiles", async (event, req) => {
    const ledger = reltabDuckDB.ToadParquetLedger.getInstance();
    await ledger.initLedger();
    const results = [];
    if (req?.filePaths && Array.isArray(req.filePaths)) {
      for (const f of req.filePaths) {
        const e = await ledger.addFileToProject(req.projectId, f);
        results.push(e);
      }
    }
    return results;
  });

  ipcMain.handle("project:addFolder", async (event, req) => {
    const ledger = reltabDuckDB.ToadParquetLedger.getInstance();
    await ledger.initLedger();
    const entries = await ledger.addFolderToProject(req?.projectId, req?.folderPath);
    return entries.map((e) => e.source_path);
  });

  ipcMain.handle("project:moveOrphanFiles", async (event, req) => {
    const ledger = reltabDuckDB.ToadParquetLedger.getInstance();
    await ledger.initLedger();
    await ledger.moveOrphanFilesToProject(req?.targetProjectId);
    return { success: true };
  });

  ipcMain.handle("project:setActive", async (event, req) => {
    const ledger = reltabDuckDB.ToadParquetLedger.getInstance();
    ledger.setActiveProjectId(req?.projectId);
    return { success: true };
  });

  ipcMain.handle("project:reconcile", async () => {
    const ledger = reltabDuckDB.ToadParquetLedger.getInstance();
    await ledger.initLedger();
    return await ledger.performStartupReconciliation();
  });

  if (app.setAboutPanelOptions) {
    app.setAboutPanelOptions({
      applicationName: "TOAD",
      applicationVersion: "2.4.8",
      version: "v2.4.8",
      copyright: "TOAD - Tabular OLAP Analytics Desktop (v2.4.8)",
      credits: "TOAD Team & Open Source Contributors",
    });
  }

  appMenu.createMenu(); // log.log('appInit: done')
};

const optionDefinitions = [
  {
    name: "srcfile",
    type: String,
    multiple: true,
    defaultOption: true,
    typeLabel:
      "{underline file}.toad or {underline file}.tad or {underline file}.csv or sqlite://{underline file}/{underline table}",
    description:
      "TOAD workspace (.toad) file, legacy TAD (.tad) file, CSV file, Parquet file or sqlite file to view",
  },
  {
    name: "executed-from",
    type: String,
    description: "pathname to working directory",
  },
  {
    name: "foreground",
    alias: "f",
    type: Boolean,
    description: "keep in foreground",
  },
  {
    name: "help",
    alias: "h",
    type: Boolean,
    description: "Show usage information",
  },
  {
    name: "hidden-cols",
    type: Boolean,
    description: "Show hidden columns (for debugging)",
  },
  {
    name: "show-queries",
    type: Boolean,
    description: "Show generated SQL queries on console when in foreground",
  },
  {
    name: "version",
    alias: "v",
    type: Boolean,
    description: "Print version number and exit",
  },
];
const usageInfo = [
  {
    header: "Toad",
    content: "A viewer for tabular data.",
  },
  {
    header: "Synopsis",
    content: [
      "$ toad [{italic options}] {underline file}.toad",
      "$ toad [{italic options}] {underline file}.tad",
      "$ toad [{italic options}] {underline file}.csv",
      "$ toad [{italic options}] {underline file}.csv.gz",
      "$ toad [{italic options}] {underline file}.duckdb",
      "$ toad [{italic options}] {underline file}.parquet",
      "$ toad [{italic options}] {underline file}.tsv",
      "$ toad [{italic options}] {underline directory}",
    ],
  },
  {
    header: "Options",
    optionList: optionDefinitions.filter((opt) => opt.name !== "srcfile"),
  },
];

const showVersion = () => {
  const version = pkgInfo.version;
  console.log(version);
};

const showUsage = () => {
  const usage = getUsage(usageInfo);
  console.log(usage);
};

const reportFatalError = (msg: string) => {
  dialog.showErrorBox("Error starting TOAD", msg);
  app.quit();
};

const errorDialog = async (
  arg1: any,
  arg2?: any,
  arg3?: any
): Promise<void> => {
  let title = "Error";
  let msg = "";
  let fatal = false;

  if (arg1 && typeof arg1 === "object") {
    title = arg1.title || "Error";
    msg = arg1.message || arg1.msg || "";
    fatal = !!arg1.fatal;
  } else {
    title = typeof arg1 === "string" ? arg1 : String(arg1 || "Error");
    msg = typeof arg2 === "string" ? arg2 : String(arg2 || "");
    fatal = !!arg3;
  }

  // Non-blocking: record error trace into log (toad.log)
  log.error(`[errorDialog] [fatal=${fatal}] ${title}: ${msg}`);

  // Suppress modal dialog unless fatal
  if (fatal) {
    dialog.showErrorBox(title, msg);
    app.quit();
  }
};

// construct targetPath based on options:
const getTargetPath = (options: any, filePath: string): string => {
  let targetPath = undefined;
  let srcDir = options["executed-from"];

  if (
    srcDir &&
    filePath &&
    !path.isAbsolute(filePath) &&
    !filePath.startsWith("/") &&
    !filePath.startsWith("\\") &&
    !isIPFSPath(filePath)
  ) {
    if (srcDir === ".") {
      srcDir = process.cwd();
    }
    // relative path -- prepend executed-from
    targetPath = path.join(srcDir, filePath);
    log.debug("relative path: ", srcDir, filePath, "--->", targetPath);
  } else {
    // absolute pathname or no srcDir:
    targetPath = filePath;
  }
  return targetPath;
};

async function openSrcFiles(options: commandLineArgs.CommandLineOptions) {
  // TODO: we may need to re-think this for e.g., url open events
  let win: BrowserWindow | null = null;
  for (const srcfile of options.srcfile) {
    const targetPath = getTargetPath(options, srcfile);
    if (win == null) {
      win = await appWindow.createFromFile(targetPath);
    } else {
      appWindow.runPostInit(win, () => {
        const openParams = appWindow.fileOpenParams(targetPath);
        win!.webContents.send("open-file", {
          openParams,
        });
      });
    }
  }
}

let openFilePath: string | null = null;

// callback for app.makeSingleInstance:
const initApp =
  (firstInstance: any) =>
  async (instanceArgv: string[], workingDirectory: string | null) => {
    try {
      let argv = instanceArgv.slice(1);
      let awaitingOpenEvent = false;
      // macOS OpenWith peculiarity
      // Using context menu on Windows results in invoking .exe with
      // just the filename as argument, no directory passed in and
      // no shell wrapper, hence the check for argv.length > 1 here.
      // deal with weird difference between starting from npm and starting
      // from packaged shell wrapper:
      // Update (5/28/17): See also:
      // https://github.com/electron/electron/issues/4690
      //
      // argv && (argv.length > 1) && !(argv[0].startsWith('--executed-from'))

      if (process.defaultApp) {
        // npm / electron start -- passes '.' as first argument
        log.debug("*** defaultApp: injecting --executed-from");
        // Find the index of the last non-option argument:
        let lastNonOptionIndex = argv.length - 1;
        while (
          !argv[lastNonOptionIndex].startsWith("-") &&
          lastNonOptionIndex > 0
        ) {
          lastNonOptionIndex--;
        }
        if (argv[lastNonOptionIndex].startsWith("-")) {
          lastNonOptionIndex++;
        }
        argv.splice(lastNonOptionIndex, 0, "--executed-from");
        log.debug("*** after argument processing: ", argv);
      } // macOS insanity:  If we're started via Open With..., we get invoked
      // with -psn_0_XXXXX argument; let's just kill it:

      if (
        process.platform === "darwin" &&
        argv &&
        argv.length > 0 &&
        argv[0].startsWith("-psn_")
      ) {
        argv = argv.slice(1);
        awaitingOpenEvent = true;
      }

      let options: CommandLineOptions;
      const argOptions: ParseOptions = { argv };
      if (!firstInstance) {
        argOptions.partial = true;
      }
      try {
        options = commandLineArgs(optionDefinitions, argOptions);
      } catch (e) {
        const argErr = e as any;
        console.error("Error parsing command line arguments: ", argErr.message);
        options = { help: true };
      }
      let quickExit = false;

      if (options.help) {
        showUsage();
        quickExit = true;
      }

      if (options.version) {
        showVersion();
        quickExit = true;
      }

      if (quickExit) {
        app.quit();
      } else {
        log.debug("*** options.srcfile: ", options.srcfile);
        const noSrcFile =
          options.srcfile == null || options.srcfile.length == 0;
        // Set in "ready" event handler:
        let isReady = false;

        if (firstInstance) {
          const handleOpen = async (
            event: electron.Event,
            filePath: string
          ) => {
            log.log("handleOpen called!");
            log.warn("got open-file event for: ", filePath);
            log.warn("handOpen: options: ", options);
            event.preventDefault();
            const targetPath = getTargetPath(options, filePath);

            if (isReady) {
              log.warn("open-file: app is ready, opening in new window");
              await appWindow.createFromFile(targetPath);
            } else {
              openFilePath = targetPath ?? null;
              log.warn("open-file: set openFilePath " + targetPath);
            }
          };

          app.on("open-file", handleOpen);
          app.on("open-url", (event, url) => {
            log.warn("got open-url: ", event, url);
            handleOpen(event, url);
          });
          const firstRun = setup.postInstallCheck();
          // Toad v2.0.5: Disable auto-spawning QuickStart on launch to ensure instant clean startup (< 350ms).
          // QuickStart is readily accessible anytime via Help -> Quick Start Guide (F1).
          const showQuickStart = false;

          process.on("uncaughtException", function (error) {
            log.error(error.message);
            log.error(error.stack);
            reportFatalError(error.message);
          }); // Quit when all windows are closed.

          app.on("window-all-closed", function () {
            // On OS X it is common for applications and their menu bar
            // to stay active until the user quits explicitly with Cmd + Q
            if (process.platform !== "darwin") {
              app.quit();
            }
          });
          app.on("activate", function () {
            // On OS X it's common to re-create a window in the app when the
            // dock icon is clicked and there are no other windows open.
          });

          // This method will be called when Electron has finished
          // initialization and is ready to create browser windows.
          // Some APIs can only be used after this event occurs.
          app.on("ready", async () => {
            // const startMsg = `pid ${process.pid}: Tad started, version: ${app.getVersion()}`
            // log.log(startMsg)
            // dialog.showMessageBox({ message: startMsg })
            appInit(options);
            try {
              await reltabDuckDB.initToadLedger();
              reltabDuckDB.ToadParquetLedger.getInstance().subscribe(() => {
                try {
                  const wins = BrowserWindow.getAllWindows();
                  for (const w of wins) {
                    if (w && !w.isDestroyed() && w.webContents) {
                      w.webContents.send("project:workspaceChanged");
                    }
                  }
                } catch {}
              });
              // Three-Way Startup Reconciliation Engine (SSOT = Parquet Ledger)
              reltabDuckDB.ToadParquetLedger.getInstance()
                .performStartupReconciliation()
                .catch((err: any) => {
                  log.warn("[StartupReconciliation] Error during startup reconciliation:", err);
                });
            } catch (err) {
              log.warn("Error initializing ToadLedger in main process:", err);
            }

            if (!noSrcFile) {
              openSrcFiles(options);
            }

            if (showQuickStart) {
              quickStart.showQuickStart();
            }

            let mainWindow: BrowserWindow | null = null;
            if (openFilePath) {
              const openMsg = `pid ${process.pid}: Got open-file for ${openFilePath}`;
              log.warn(openMsg);
              mainWindow = await appWindow.createFromFile(openFilePath); // dialog.showMessageBox({ message: openMsg })
            } else {
              if (noSrcFile && !awaitingOpenEvent) {
                const env = (global as any).toadPortableEnv as PortableEnvironment | undefined;
                const cfg = env?.config;
                if (
                  cfg?.general.auto_restore_last_directory &&
                  cfg.general.last_directory &&
                  fs.existsSync(cfg.general.last_directory)
                ) {
                  log.info(
                    `[SessionRestore] Tu dong phuc hoi thu muc: ${cfg.general.last_directory}`
                  );
                  mainWindow = await appWindow.createFromFile(cfg.general.last_directory);
                } else {
                  app.focus();
                  // Toad v2.0.5: Open clean MainWindow without blocking main thread with modal Windows Shell File Dialog.
                  // MainWindow is immediately ready for Drag & Drop or user-initiated Open (Ctrl+O).
                  mainWindow = await appWindow.newWindow();
                }
              }
            }

            try {
              await EngineSupervisor.getInstance().start(mainWindow || undefined);
            } catch (supErr) {
              log.error("[EngineSupervisor] Error starting EngineSupervisor:", supErr);
            }

            isReady = true;
          });
        } else {
          log.debug(
            "*** initApp: handling second-instance event: options: ",
            options
          );
          if (!noSrcFile) {
            openSrcFiles(options);
          } else {
            log.warn("initApp called with no targetPath");
            app.focus();
          }
        }
      }
    } catch (e) {
      const err = e as any;
      reportFatalError(err.message);
      log.error("Error: ", err.message);
      log.error(err.stack);
      showUsage();
      app.quit();
    }
  };

const main = () => {
  // turn off console logging on win32:
  if (process.platform === "win32") {
    log.transports.file.level = false;
  }

  // ===================================================================
  // [TOAD] Khởi tạo Portable AppData Environment TRƯỚC MỌI THỨ
  // ===================================================================
  let portableEnv: PortableEnvironment;
  try {
    portableEnv = initPortableEnvironment();
    log.warn(`[TOAD] Portable AppData: ${portableEnv.appDataDir}`);

    // Chuyển hướng toàn bộ Electron UserData sang thư mục cục bộ
    // => Không ghi bất kỳ dữ liệu nào vào C:\Users\<user>\AppData\Roaming
    app.setPath("userData", portableEnv.electronDataDir);
    app.setPath("temp", portableEnv.tempDir);
    app.setPath("crashDumps", portableEnv.logsDir);

    // Kích hoạt ghi log vào thư mục logs của toadAppData
    try {
      log.transports.file.resolvePath = () =>
        path.join(portableEnv.logsDir, "toad.log");
      log.transports.file.level = "info";
    } catch (e) {}

    // Lưu reference toàn cục để các module khác truy cập
    (global as any).toadPortableEnv = portableEnv;
  } catch (err) {
    log.error("[TOAD] LOI NGHIEM TRONG: Khong the khoi tao Portable AppData:", err);
    // Fallback: tiếp tục chạy bình thường nếu portable init thất bại
  }

  const firstInstance = app.requestSingleInstanceLock();
  if (!firstInstance) {
    app.quit();
  } else {
    // first instance:
    log.warn("firstInstance. argv: ", process.argv);

    app.on(
      "second-instance",
      (event, commandLine, workingDirectory, additionalData) => {
        console.log(
          "*** got secondInstance event: ",
          commandLine,
          workingDirectory,
          event,
          additionalData
        );
        initApp(false)(commandLine, workingDirectory);
      }
    );

    // ===================================================================
    // [TOAD] Đăng ký hook dọn dẹp temp khi thoát ứng dụng
    // ===================================================================
    let isQuitting = false;
    app.on("before-quit", (event) => {
      if (isQuitting) return;
      try {
        EngineSupervisor.getInstance().stop();
      } catch (e) {}
      if (portableEnv && portableEnv.config.system.temp_cleanup) {
        isQuitting = true;
        event.preventDefault(); // Tạm hoãn thoát để giải phóng file lock

        log.warn("[TOAD] Dang don dep temp truoc khi thoat...");

        // Chờ 150ms cho Windows giải phóng file handles sau khi DuckDB đóng
        setTimeout(() => {
          cleanTempDir(portableEnv.tempDir);
          log.warn("[TOAD] Da don dep temp thanh cong. Thoat ung dung.");
          app.exit(0);
        }, 150);
      }
    });

    app.setName("Toad");
    initApp(firstInstance)(process.argv, null);
  }
};

main();
