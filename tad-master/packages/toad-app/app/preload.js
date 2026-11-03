/* preload script for renderer process - TOAD v2.5.0 Secure Host Bridge */
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

// 1. Parse openParams from process.argv
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

// 2. Listen for "toad-engine-port" from Main and forward to Renderer via window.postMessage
if (ipcRenderer && typeof ipcRenderer.on === "function") {
  ipcRenderer.on("toad-engine-port", (event) => {
    const port = event.ports && event.ports[0];
    if (port && typeof window !== "undefined") {
      window.postMessage({ type: "toad-engine-port-handshake" }, "*", [port]);
    }
  });
}

// 3. Define the secure toadBridge API
const toadBridge = {
  invoke: (command, payload) => {
    if (ipcRenderer && typeof ipcRenderer.invoke === "function") {
      return ipcRenderer.invoke(command, payload);
    }
    return Promise.reject(new Error("[toadBridge] ipcRenderer is not available for invoke"));
  },
  send: (channel, payload) => {
    if (ipcRenderer && typeof ipcRenderer.send === "function") {
      ipcRenderer.send(channel, payload);
    }
  },
  on: (channel, listener) => {
    if (ipcRenderer && typeof ipcRenderer.on === "function") {
      const handler = (event, ...args) => listener(...args);
      ipcRenderer.on(channel, handler);
      return () => {
        if (ipcRenderer && typeof ipcRenderer.removeListener === "function") {
          ipcRenderer.removeListener(channel, handler);
        }
      };
    }
    return () => { };
  },
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
};

// 4. Safely expose into Main World
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
