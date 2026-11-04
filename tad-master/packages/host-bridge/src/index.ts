import { IHostBridge } from "./IHostBridge";
import { ElectronHostAdapter } from "./ElectronHostAdapter";

let activeBridge: IHostBridge | null = null;

/**
 * Get the active singleton HostBridge instance.
 * Defaults to ElectronHostAdapter.
 */
export function getHostBridge(): IHostBridge {
  if (!activeBridge) {
    activeBridge = new ElectronHostAdapter();
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
