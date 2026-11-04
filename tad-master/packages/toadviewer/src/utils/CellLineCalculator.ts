/**
 * CellLineCalculator.ts
 *
 * Squad 1 (Engineers E01-E02): Core Mathematical Engine & Foundation
 *
 * Pure mathematical and heuristic line calculation and height/scroll state mapping.
 * Provides accurate text measurement via HTML5 Canvas 2D in browser environments,
 * and deterministic character-width heuristics in headless / Node.js test environments.
 */

export interface LineCalculationOptions {
  /** Character width in px for monospace / fallback calculation. Default: 7.5 */
  charWidth?: number;
  /** Alias for charWidth */
  fallbackCharWidth?: number;
  /** Total horizontal padding (left + right) in px. Default: 12 */
  padding?: number;
  /** Alias for padding */
  paddingX?: number;
  /** CSS font shorthand string (e.g. "12px sans-serif") for Canvas measurement */
  font?: string;
  /** Font family for Canvas measurement. Default: "Inter, sans-serif" */
  fontFamily?: string;
  /** Font size in px. Default: 12 */
  fontSize?: number;
  /** Font weight (e.g. 400 or "normal"). Default: 400 */
  fontWeight?: string | number;
}

export type CellLineCalcOptions = LineCalculationOptions;

export interface CellHeightState {
  /** True when N >= 2 lines (cell should elevate and expand) */
  shouldExpand: boolean;
  /** Calculated line count N */
  lineCount: number;
  /** Computed pixel height */
  height: number;
  /** Overflow property: "hidden" for N <= 5, "auto" for N > 5 */
  overflowY: "hidden" | "auto";
  /** True when N > 5 lines (slim vertical scrollbar enabled) */
  hasScrollbar: boolean;
  /** Optional CSS class hint */
  className?: string;
}

export type CellHeightScrollState = CellHeightState;

let cachedCanvas: HTMLCanvasElement | null = null;
let cachedCtx: CanvasRenderingContext2D | null = null;

function getCanvasContext(): CanvasRenderingContext2D | null {
  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    if (!cachedCanvas) {
      try {
        cachedCanvas = document.createElement("canvas");
        cachedCtx = cachedCanvas.getContext ? (cachedCanvas.getContext("2d") as CanvasRenderingContext2D) : null;
      } catch {
        cachedCtx = null;
      }
    }
    return cachedCtx;
  }
  return null;
}

/**
 * Calculates visual line count N for a given cell content and column width.
 *
 * @param text The cell value (string, number, boolean, null, undefined)
 * @param colWidth Outer column width in px
 * @param options Custom calculation options
 * @returns Visual line count (integer >= 1)
 */
export function calculateLineCount(
  text: any,
  colWidth: number,
  options?: LineCalculationOptions
): number {
  // Edge case: null, undefined, empty string
  if (text === null || text === undefined || text === "") {
    return 1;
  }

  const rawStr = typeof text === "string" ? text : String(text);
  if (rawStr.length === 0) {
    return 1;
  }

  // Calculate effective width available for text content: colWidth - padding, clamped to min 20px
  const padding = options?.padding !== undefined
    ? options.padding
    : (options?.paddingX !== undefined ? options.paddingX : 12);
  const effectiveWidth = Math.max(20, (Number.isFinite(colWidth) ? colWidth : 100) - padding);

  // Split by explicit hard newlines (\r\n, \r, \n)
  const segments = rawStr.split(/\r\n|\r|\n/);
  let totalLines = 0;

  const ctx = getCanvasContext();
  if (ctx) {
    // Browser Canvas 2D measurement mode
    const fontStr = options?.font || `${options?.fontWeight || 400} ${options?.fontSize || 12}px ${
      options?.fontFamily || "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    }`;
    try {
      ctx.font = fontStr;
    } catch {
      // Fall through to heuristic if invalid font string
    }

    for (const segment of segments) {
      if (segment.length === 0) {
        totalLines += 1;
        continue;
      }
      totalLines += measureSegmentCanvas(ctx, segment, effectiveWidth);
    }
  } else {
    // Headless / Node.js deterministic fallback mode
    const charWidth = options?.charWidth !== undefined
      ? options.charWidth
      : (options?.fallbackCharWidth !== undefined ? options.fallbackCharWidth : 7.5);
    const maxCharsPerLine = Math.max(1, Math.floor(effectiveWidth / Math.max(1, charWidth)));

    for (const segment of segments) {
      if (segment.length === 0) {
        totalLines += 1;
        continue;
      }
      totalLines += measureSegmentNode(segment, maxCharsPerLine);
    }
  }

  return Math.max(1, Math.floor(totalLines));
}

function measureSegmentCanvas(
  ctx: CanvasRenderingContext2D,
  segment: string,
  maxWidth: number
): number {
  const totalWidth = ctx.measureText(segment).width;
  if (totalWidth <= maxWidth) {
    return 1;
  }

  // Segment exceeds single line width - simulate word wrapping
  const words = segment.split(/(\s+)/);
  let currentLineWidth = 0;
  let lines = 1;

  for (const word of words) {
    if (!word) continue;
    const wordWidth = ctx.measureText(word).width;

    if (wordWidth > maxWidth) {
      // Long unbroken token: break character by character
      for (let i = 0; i < word.length; i++) {
        const charWidth = ctx.measureText(word[i]).width;
        if (currentLineWidth + charWidth > maxWidth && currentLineWidth > 0) {
          lines++;
          currentLineWidth = charWidth;
        } else {
          currentLineWidth += charWidth;
        }
      }
    } else {
      if (currentLineWidth + wordWidth > maxWidth && currentLineWidth > 0) {
        lines++;
        currentLineWidth = word.trim() ? wordWidth : 0;
      } else {
        currentLineWidth += wordWidth;
      }
    }
  }

  return lines;
}

function measureSegmentNode(segment: string, maxCharsPerLine: number): number {
  if (segment.length <= maxCharsPerLine) {
    return 1;
  }

  // If no whitespace present, break unbroken token directly
  if (!/\s/.test(segment)) {
    return Math.ceil(segment.length / maxCharsPerLine);
  }

  // Tokenize preserving whitespace
  const words = segment.split(/(\s+)/);
  let currentLineChars = 0;
  let lines = 1;

  for (const word of words) {
    if (!word) continue;
    const wordLen = word.length;

    if (wordLen > maxCharsPerLine) {
      // Unbroken word exceeding line capacity
      for (let i = 0; i < wordLen; i++) {
        if (currentLineChars + 1 > maxCharsPerLine && currentLineChars > 0) {
          lines++;
          currentLineChars = 1;
        } else {
          currentLineChars++;
        }
      }
    } else {
      if (currentLineChars + wordLen > maxCharsPerLine && currentLineChars > 0) {
        lines++;
        currentLineChars = word.trim() ? wordLen : 0;
      } else {
        currentLineChars += wordLen;
      }
    }
  }

  return lines;
}

/**
 * Maps calculated visual line count N to exact height and scroll state
 * following the N-line contract:
 * - N <= 1: Flat, defaultHeight (24/25px), overflowY: "hidden", hasScrollbar: false, shouldExpand: false
 * - 2 <= N <= 5: Exact fit (N * lineHeight + vertPadding), overflowY: "hidden", hasScrollbar: false, shouldExpand: true
 * - N > 5: Capped at 5 lines (5 * lineHeight + vertPadding), overflowY: "auto", hasScrollbar: true, shouldExpand: true
 *
 * @param lineCount Calculated line count N
 * @param lineHeight Line height in px (default: 17)
 * @param vertPadding Total vertical padding in px (default: 8)
 * @param defaultHeight Default compact cell height in px (default: 24)
 * @returns CellHeightState
 */
export function getHeightAndScrollState(
  lineCount: number,
  lineHeight: number = 17,
  vertPadding: number = 8,
  defaultHeight: number = 24
): CellHeightState {
  const safeCount = Number.isFinite(lineCount) && lineCount > 0 ? Math.floor(lineCount) : 1;

  if (safeCount <= 1) {
    return {
      shouldExpand: false,
      lineCount: safeCount,
      height: defaultHeight,
      overflowY: "hidden",
      hasScrollbar: false,
      className: "cell-flat",
    };
  }

  if (safeCount <= 5) {
    return {
      shouldExpand: true,
      lineCount: safeCount,
      height: safeCount * lineHeight + vertPadding,
      overflowY: "hidden",
      hasScrollbar: false,
      className: "cell-expanded-fit",
    };
  }

  return {
    shouldExpand: true,
    lineCount: safeCount,
    height: 5 * lineHeight + vertPadding,
    overflowY: "auto",
    hasScrollbar: true,
    className: "cell-expanded-scroll",
  };
}

export class CellLineCalculator {
  static calculateLineCount = calculateLineCount;
  static getHeightAndScrollState = getHeightAndScrollState;
}

export default CellLineCalculator;
