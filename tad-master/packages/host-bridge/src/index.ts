import { IHostBridge } from "./IHostBridge";
import { V8HostAdapter } from "./V8HostAdapter";
import { HeadlessNodeAdapter } from "./HeadlessNodeAdapter";

let activeBridge: IHostBridge | null = null;

/**
 * Get the active singleton HostBridge instance.
 * Defaults to V8HostAdapter.
 */
export function getHostBridge(): IHostBridge {
  if (!activeBridge) {
    activeBridge = new V8HostAdapter();
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
export * from "./V8HostAdapter";
export * from "./HeadlessNodeAdapter";
