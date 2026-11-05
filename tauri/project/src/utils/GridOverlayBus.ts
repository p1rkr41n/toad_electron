/**
 * GridOverlayBus.ts
 *
 * Squad 1 (Engineer E03): Cross-Table Event Bus Coordinator
 *
 * Standardized cross-component event bus for coordinating overlay dismissal,
 * modal dialog open/close states, and cell floating expansions between
 * DataGrid, ProjectFilesTable, RegexDialog, and NestedFieldsTable.
 * Supports both browser window CustomEvent dispatch and headless Node.js testing.
 */

export const EVENT_DISMISS_GRID_CELL_EXPAND = "dismiss-grid-cell-expand";
export const EVENT_PARSE_DIALOG_OPENED = "parse-dialog-opened";
export const EVENT_PARSE_DIALOG_CLOSED = "parse-dialog-closed";

export const GRID_OVERLAY_EVENTS = {
  DISMISS_CELL_EXPAND: EVENT_DISMISS_GRID_CELL_EXPAND,
  PARSE_DIALOG_OPENED: EVENT_PARSE_DIALOG_OPENED,
  PARSE_DIALOG_CLOSED: EVENT_PARSE_DIALOG_CLOSED,
  MODAL_OPENED: EVENT_PARSE_DIALOG_OPENED,
  MODAL_CLOSED: EVENT_PARSE_DIALOG_CLOSED,
} as const;

export type GridOverlayEventType =
  | typeof EVENT_DISMISS_GRID_CELL_EXPAND
  | typeof EVENT_PARSE_DIALOG_OPENED
  | typeof EVENT_PARSE_DIALOG_CLOSED;

type ListenerCallback = () => void;

// In-memory fallback listener registry for Node.js / headless environments
const inMemoryListeners = new Map<string, Set<ListenerCallback>>();

function addInMemoryListener(event: string, callback: ListenerCallback): () => void {
  let listeners = inMemoryListeners.get(event);
  if (!listeners) {
    listeners = new Set<ListenerCallback>();
    inMemoryListeners.set(event, listeners);
  }
  listeners.add(callback);
  return () => {
    listeners?.delete(callback);
  };
}

function emitInMemory(event: string): void {
  const listeners = inMemoryListeners.get(event);
  if (listeners && listeners.size > 0) {
    // Clone to prevent mutation issues during emission
    Array.from(listeners).forEach((cb) => {
      try {
        cb();
      } catch (err) {
        console.error(`[GridOverlayBus] Error executing listener for "${event}":`, err);
      }
    });
  }
}

/**
 * Dispatches an event across the bus.
 * Uses window.dispatchEvent with CustomEvent in browser DOM,
 * falls back to in-memory event registry in Node.js environments.
 */
export function emitBusEvent(eventName: string): void {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      window.dispatchEvent(new CustomEvent(eventName));
      return;
    } catch {
      // In case of CustomEvent constructor issues, fall back
    }
  }
  emitInMemory(eventName);
}

/**
 * Subscribes to an event on the bus.
 * Returns an unsubscription cleanup function.
 */
export function onBusEvent(eventName: string, callback: ListenerCallback): () => void {
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    const handler = () => callback();
    window.addEventListener(eventName, handler);
    return () => {
      window.removeEventListener(eventName, handler);
    };
  }
  return addInMemoryListener(eventName, callback);
}

// Typed Helpers for EVENT_DISMISS_GRID_CELL_EXPAND

export function emitDismissGridCellExpand(): void {
  emitBusEvent(EVENT_DISMISS_GRID_CELL_EXPAND);
}

export function onDismissGridCellExpand(callback: ListenerCallback): () => void {
  return onBusEvent(EVENT_DISMISS_GRID_CELL_EXPAND, callback);
}

export const dispatchDismissCellExpand = emitDismissGridCellExpand;
export const subscribeDismissCellExpand = onDismissGridCellExpand;

// Typed Helpers for EVENT_PARSE_DIALOG_OPENED

export function emitParseDialogOpened(): void {
  emitBusEvent(EVENT_PARSE_DIALOG_OPENED);
}

export function onParseDialogOpened(callback: ListenerCallback): () => void {
  return onBusEvent(EVENT_PARSE_DIALOG_OPENED, callback);
}

// Typed Helpers for EVENT_PARSE_DIALOG_CLOSED

export function emitParseDialogClosed(): void {
  emitBusEvent(EVENT_PARSE_DIALOG_CLOSED);
}

export function onParseDialogClosed(callback: ListenerCallback): () => void {
  return onBusEvent(EVENT_PARSE_DIALOG_CLOSED, callback);
}

/**
 * Resets all in-memory listeners (useful for test isolation).
 */
export function resetBusForTesting(): void {
  inMemoryListeners.clear();
}

/**
 * GridOverlayBus class wrapper for static OOP-style usage.
 */
export class GridOverlayBus {
  static readonly EVENTS = GRID_OVERLAY_EVENTS;

  static emitDismissGridCellExpand = emitDismissGridCellExpand;
  static onDismissGridCellExpand = onDismissGridCellExpand;
  static dispatchDismissCellExpand = dispatchDismissCellExpand;
  static subscribeDismissCellExpand = subscribeDismissCellExpand;

  static emitParseDialogOpened = emitParseDialogOpened;
  static onParseDialogOpened = onParseDialogOpened;

  static emitParseDialogClosed = emitParseDialogClosed;
  static onParseDialogClosed = onParseDialogClosed;

  static resetForTesting = resetBusForTesting;
}

export default GridOverlayBus;
