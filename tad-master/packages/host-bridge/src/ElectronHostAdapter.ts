import { IHostBridge } from "./IHostBridge";
import { V8HostAdapter } from "./V8HostAdapter";
import {
  COMMAND_ALIAS_MAP,
  REVERSE_COMMAND_ALIAS_MAP,
} from "./commandAliases";

export { COMMAND_ALIAS_MAP, REVERSE_COMMAND_ALIAS_MAP };

/**
 * Ring 2: Electron Host Adapter
 * Concrete implementation of IHostBridge for Electron runtime.
 * Inherits and modernizes V8HostAdapter with two-way command alias normalization.
 */
export class ElectronHostAdapter extends V8HostAdapter {
  /**
   * Normalize input command (Tauri-style or Legacy Electron channel)
   * to the concrete Electron IPC channel name.
   */
  public resolveCommand(cmd: string): string {
    return COMMAND_ALIAS_MAP[cmd] || cmd;
  }

  /**
   * Convert a legacy IPC channel to its canonical Tauri v2 namespaced name.
   */
  public resolveCanonicalCommand(cmd: string): string {
    return REVERSE_COMMAND_ALIAS_MAP[cmd] || cmd;
  }

  /**
   * Unified command invocation with alias mapping support
   */
  async invoke<T = any>(cmd: string, args?: any): Promise<T> {
    const targetCmd = this.resolveCommand(cmd);
    return await super.invoke<T>(targetCmd, args);
  }
}

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

export { V8HostAdapter } from "./V8HostAdapter";
export * from "./IHostBridge";
