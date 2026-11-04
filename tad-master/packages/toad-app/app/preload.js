/* preload script for renderer process - TOAD v2.5.0 Secure Host Bridge (Tauri-like Parity) */
let contextBridge = null;
let ipcRenderer = null;
let electronClipboard = null;
let electronShell = null;
try {
  const electron = require("electron");
  contextBridge = electron.contextBridge;
  ipcRenderer = electron.ipcRenderer;
  electronClipboard = electron.clipboard;
  electronShell = electron.shell;
} catch (e) {
  // Graceful fallback for non-Electron / headless test environments
}

// 1. Strict Capabilities Whitelist (Tauri v2 Parity Security Gate)
const STRICT_CAPABILITIES_WHITELIST = Object.freeze([
  // Core Toad Commands
  "initMain",
  "toad:init_main",
  "getToadConfig",
  "toad:get_config",
  "newWindowFromDSPath",
  "toad:new_window",
  "errorDialog",
  "plugin:dialog|error",

  // Dialog & Shell & Clipboard Plugins
  "dialog:showOpenDialog",
  "plugin:dialog|open",
  "dialog:showSaveDialog",
  "plugin:dialog|save",
  "clipboard:writeText",
  "plugin:clipboard|write_text",
  "shell:openExternal",
  "plugin:opener|open_url",

  // Project Workspace Commands
  "project:getWorkspace",
  "project:get_workspace",
  "project:addFiles",
  "project:add_files",
  "project:addFolder",
  "project:add_folder",
  "project:delete",
  "project:rename",
  "project:create",
  "project:setActive",
  "project:set_active",
  "project:reconcile",
  "project:getFiles",
  "project:get_files",
  "project:deleteAll",
  "project:delete_all",
  "project:getCacheSize",
  "project:get_cache_size",
  "project:purgeCache",
  "project:purge_cache",
  "project:removeFile",
  "project:remove_file",
  "project:moveOrphanFiles",
  "project:move_orphan_files",

  // Engine & Supervisor Commands
  "engine:status",
  "engine:get_status",
  "engine:restart",
  "engine:do_restart",
  "engine:request-port",
  "engine:restored",
  "toad-engine-port",
  "getSetupInfo",
  "toad:get_setup_info",
  "openExample",
  "toad:open_example",

  // Reltab DuckDB RPC Commands
  "open",
  "openFormat",
  "getDataSources",
  "getTableName",
  "getTableSchema",
  "schema",
  "toad:schema",
  "toad:get_table_schema",
  "evalQuery",
  "toad:eval_query",
  "toad:query",
  "rowCount",
  "toad:row_count",
  "runSqlQuery",
  "runSqlQueryArrow",
  "toad:run_sql_arrow",
  "dispose",
  "realPath",
  "toad:get_table_name",

  // Reltab Database Connection Methods
  "DataSourceConnection.getTableName",
  "DataSourceConnection.evalQuery",
  "DataSourceConnection.rowCount",
  "DataSourceConnection.getTableSchema",
  "DataSourceConnection.getColumnStatsMap",
  "DataSourceConnection.getRootNode",
  "DataSourceConnection.getChildren",
  "DataSourceConnection.runSqlQuery",
  "DataSourceConnection.runSqlQueryArrow",
  "DataSourceConnection.dispose",

  // Export & Filter Queries
  "browse-export-path",
  "export-file",
  "response-serialize-app-state",
  "response-serialize-filter-query",
  "render-init-complete",
]);

// 2. Dual-Mode Command Alias Map in Preload
const COMMAND_ALIAS_MAP = Object.freeze({
  "toad:init_main": "initMain",
  "toad:get_config": "getToadConfig",
  "toad:new_window": "newWindowFromDSPath",
  "plugin:dialog|open": "dialog:showOpenDialog",
  "plugin:dialog|save": "dialog:showSaveDialog",
  "plugin:dialog|error": "errorDialog",
  "plugin:clipboard|write_text": "clipboard:writeText",
  "plugin:opener|open_url": "shell:openExternal",
  "project:get_workspace": "project:getWorkspace",
  "project:add_files": "project:addFiles",
  "project:add_folder": "project:addFolder",
  "project:delete": "project:delete",
  "project:rename": "project:rename",
  "project:create": "project:create",
  "project:set_active": "project:setActive",
  "project:reconcile": "project:reconcile",
  "project:get_files": "project:getFiles",
  "project:delete_all": "project:deleteAll",
  "project:get_cache_size": "project:getCacheSize",
  "project:purge_cache": "project:purgeCache",
  "project:remove_file": "project:removeFile",
  "project:move_orphan_files": "project:moveOrphanFiles",
  "engine:get_status": "engine:status",
  "engine:do_restart": "engine:restart",
  "toad:get_setup_info": "getSetupInfo",
  "toad:open_example": "openExample",
  "toad:eval_query": "DataSourceConnection.evalQuery",
  "toad:query": "DataSourceConnection.evalQuery",
  "evalQuery": "DataSourceConnection.evalQuery",
  "toad:row_count": "DataSourceConnection.rowCount",
  "rowCount": "DataSourceConnection.rowCount",
  "toad:schema": "DataSourceConnection.getTableSchema",
  "toad:get_table_schema": "DataSourceConnection.getTableSchema",
  "schema": "DataSourceConnection.getTableSchema",
  "getTableSchema": "DataSourceConnection.getTableSchema",
  "toad:run_sql_arrow": "DataSourceConnection.runSqlQueryArrow",
  "toad:get_table_name": "DataSourceConnection.getTableName",
  "getTableName": "DataSourceConnection.getTableName",
});

function assertCapability(cmd) {
  const normalized = typeof cmd === "string" ? cmd.trim() : "";
  if (!normalized || !STRICT_CAPABILITIES_WHITELIST.includes(normalized)) {
    throw new Error(
      `[SecurityError: Capability Denied] Command '${cmd}' is not permitted by preload whitelist policy.`
    );
  }
}

// 3. Parse openParams from process.argv
const argPrefixToad = '--toadOpenParams=';
const argPrefixTad = '--tadOpenParams=';
let openParams = null;

if (typeof process !== "undefined" && Array.isArray(process.argv)) {
  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith(argPrefixToad)) {
      try {
        openParams = JSON.parse(arg.slice(argPrefixToad.length));
      } catch { }
      break;
    }
  }

  if (!openParams) {
    for (let i = 0; i < process.argv.length; i++) {
      const arg = process.argv[i];
      if (arg.startsWith(argPrefixTad)) {
        try {
          openParams = JSON.parse(arg.slice(argPrefixTad.length));
        } catch { }
        break;
      }
    }
  }
}

// 4. Listen for "toad-engine-port" from Main and forward to Renderer via window.postMessage
if (ipcRenderer && typeof ipcRenderer.on === "function") {
  ipcRenderer.on("toad-engine-port", (event) => {
    const port = event.ports && event.ports[0];
    if (port && typeof window !== "undefined") {
      window.postMessage({ type: "toad-engine-port-handshake" }, "*", [port]);
    }
  });
}

// 5. Define the standardized toadBridge API (Tauri-like invoke + listen core)
const toadBridge = {
  // Core unified command invocation with Strict Capabilities check & alias resolution
  invoke: (command, payload) => {
    assertCapability(command);
    const normalized = typeof command === "string" ? command.trim() : command;
    const resolved = COMMAND_ALIAS_MAP[normalized] || normalized;

    // Handle local clipboard capabilities directly in preload if available
    if (resolved === "clipboard:writeText") {
      const text = typeof payload === "string" ? payload : payload?.text;
      if (electronClipboard && typeof electronClipboard.writeText === "function") {
        electronClipboard.writeText(text);
        return Promise.resolve();
      }
    }

    // Handle local shell openExternal capabilities directly in preload if available
    if (resolved === "shell:openExternal") {
      const url = typeof payload === "string" ? payload : payload?.url;
      if (electronShell && typeof electronShell.openExternal === "function") {
        return electronShell.openExternal(url);
      }
    }

    if (ipcRenderer && typeof ipcRenderer.invoke === "function") {
      return ipcRenderer.invoke(resolved, payload);
    }
    return Promise.reject(new Error("[toadBridge] ipcRenderer is not available for invoke"));
  },

  // Binary execution (returns Promise<Uint8Array>)
  invokeBinary: async (command, payload) => {
    assertCapability(command);
    const normalized = typeof command === "string" ? command.trim() : command;
    const resolved = COMMAND_ALIAS_MAP[normalized] || normalized;
    if (ipcRenderer && typeof ipcRenderer.invoke === "function") {
      const res = await ipcRenderer.invoke(resolved, payload);
      if (res instanceof Uint8Array) return res;
      if (res instanceof ArrayBuffer) return new Uint8Array(res);
      if (typeof Buffer !== "undefined" && Buffer.isBuffer(res)) {
        return new Uint8Array(res.buffer, res.byteOffset, res.byteLength);
      }
      return new Uint8Array(res || 0);
    }
    return Promise.reject(new Error("[toadBridge] ipcRenderer is not available for invokeBinary"));
  },

  // Core event listening (Tauri v2 listen parity)
  listen: (event, callback) => {
    if (ipcRenderer && typeof ipcRenderer.on === "function") {
      const handler = (_evt, ...args) => callback(...args);
      ipcRenderer.on(event, handler);
      return () => {
        if (ipcRenderer && typeof ipcRenderer.removeListener === "function") {
          ipcRenderer.removeListener(event, handler);
        }
      };
    }
    return () => { };
  },

  // Backward-compatibility event listeners and senders
  on: (channel, listener) => toadBridge.listen(channel, listener),
  send: (channel, payload) => {
    assertCapability(channel);
    const normalized = typeof channel === "string" ? channel.trim() : channel;
    const resolved = COMMAND_ALIAS_MAP[normalized] || normalized;
    if (ipcRenderer && typeof ipcRenderer.send === "function") {
      ipcRenderer.send(resolved, payload);
    }
  },
  emit: (channel, payload) => toadBridge.send(channel, payload),

  // Fallback utility wrappers
  clipboard: {
    writeText: (text) => {
      if (electronClipboard && typeof electronClipboard.writeText === "function") {
        electronClipboard.writeText(text);
      } else if (ipcRenderer && typeof ipcRenderer.send === "function") {
        ipcRenderer.send("clipboard:writeText", text);
      }
    },
  },
  openExternal: (url) => {
    if (electronShell && typeof electronShell.openExternal === "function") {
      return electronShell.openExternal(url);
    }
    if (ipcRenderer && typeof ipcRenderer.invoke === "function") {
      return ipcRenderer.invoke("shell:openExternal", url);
    }
    return Promise.resolve();
  },

  openParams: openParams,
  assertCapability: assertCapability,
  WHITELIST: STRICT_CAPABILITIES_WHITELIST,
  COMMAND_ALIAS_MAP: COMMAND_ALIAS_MAP,
};

// 6. Safely expose into Main World
let exposedViaContextBridge = false;
if (contextBridge && typeof contextBridge.exposeInMainWorld === "function") {
  try {
    contextBridge.exposeInMainWorld("toadBridge", toadBridge);
    contextBridge.exposeInMainWorld("openParams", openParams);
    exposedViaContextBridge = true;
  } catch (err) {
    exposedViaContextBridge = false;
  }
}

if (!exposedViaContextBridge && typeof window !== "undefined") {
  window.toadBridge = toadBridge;
  window.openParams = openParams;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    toadBridge,
    assertCapability,
    STRICT_CAPABILITIES_WHITELIST,
    COMMAND_ALIAS_MAP,
  };
}
