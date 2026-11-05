import { IHostBridge } from "./IHostBridge";
import { ElectronHostAdapter } from "./ElectronHostAdapter";
import { TauriHostAdapter } from "./TauriHostAdapter";

let activeBridge: IHostBridge | null = null;

/**
 * Get the active singleton HostBridge instance.
 * Auto-detects Tauri v2 runtime when window.__TAURI__ is present;
 * otherwise defaults to ElectronHostAdapter.
 */
export function getHostBridge(): IHostBridge {
  if (!activeBridge) {
    if (typeof window !== "undefined" && (window as any).__TAURI__) {
      activeBridge = new TauriHostAdapter();
    } else {
      activeBridge = new ElectronHostAdapter();
    }
  }
  return activeBridge;
}

/**
 * Override the active HostBridge (for testing, Tauri shell, Headless CLI, or Web).
 */
export function setHostBridge(customBridge: IHostBridge): void {
  activeBridge = customBridge;
}

export * from "./IHostBridge";
export * from "./commandAliases";
export * from "./V8HostAdapter";
export * from "./ElectronHostAdapter";
export * from "./TauriHostAdapter";
export * from "./HeadlessNodeAdapter";
