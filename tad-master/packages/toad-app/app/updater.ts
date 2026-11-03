/**
 * updater.js
 *
 * Based on code snippet from electron-builder docs found here:
 * https://github.com/electron-userland/electron-builder/blob/master/docs/encapsulated%20manual%20update%20via%20menu.js
 */
import { dialog, BrowserWindow, MenuItem } from "electron";

let updater: MenuItem | null = null;
let autoUpdaterInstance: any = null;
let initAttempted = false;

function getAutoUpdater() {
  if (initAttempted) {
    return autoUpdaterInstance;
  }
  initAttempted = true;
  try {
    const { autoUpdater } = require("electron-updater");
    autoUpdater.autoDownload = false;
    autoUpdater.on("error", (event: any, error: any) => {
      dialog.showErrorBox(
        "Error: ",
        error == null ? "unknown" : (error.stack || error).toString()
      );
    });
    autoUpdater.on("update-available", () => {
      const buttonIndex = dialog.showMessageBoxSync({
        type: "info",
        title: "Found Updates",
        message: "A new release of Tad is available. Do you want to update now?",
        buttons: ["Yes", "No"],
      });
      if (buttonIndex === 0) {
        autoUpdater.downloadUpdate();
      } else {
        if (updater) updater.enabled = true;
        updater = null;
      }
    });
    autoUpdater.on("update-not-available", () => {
      dialog.showMessageBox({
        title: "No Updates",
        message: "Current version is up-to-date.",
      });
      if (updater) updater.enabled = true;
      updater = null;
    });
    autoUpdater.on("update-downloaded", () => {
      dialog.showMessageBoxSync({
        title: "Install Updates",
        message: "Update downloaded, will update...",
      });
      autoUpdater.quitAndInstall();
    });
    autoUpdaterInstance = autoUpdater;
  } catch (err: any) {
    console.warn("AutoUpdater is not available or version format is non-standard:", err);
    autoUpdaterInstance = null;
  }
  return autoUpdaterInstance;
}

// export this to MenuItem click callback
export function checkForUpdates(
  menuItem: MenuItem,
  focusedWindow: BrowserWindow
) {
  console.log("updater.checkForUpdates");
  updater = menuItem;
  updater.enabled = false;
  try {
    const autoUpdater = getAutoUpdater();
    if (autoUpdater) {
      autoUpdater.checkForUpdates();
    } else {
      dialog.showMessageBox({
        title: "Check for Updates",
        message: "Current version is up-to-date (offline portable build).",
      });
      menuItem.enabled = true;
      updater = null;
    }
  } catch (err: any) {
    dialog.showMessageBox({
      title: "Check for Updates",
      message: "Current version is up-to-date (offline portable build).",
    });
    menuItem.enabled = true;
    updater = null;
  }
}
