/**
 * toadLogger.ts
 *
 * Centralized Multi-Process Logger for Toad:
 * - Single writer wrapping electron-log v4
 * - Custom 'trace' level registration
 * - Standard unified format: [YYYY-MM-DD HH:mm:ss.SSS] [LEVEL] [MAIN|UI|ENGINE] [Module] (+elapsed ms, RSS: MB) message
 * - Size-based rotation: 20 MB per file, rolling up to 5 files (toad.log, toad.1.log .. toad.4.log)
 * - Hard disk cap enforcement: 100 MB total log directory size
 * - Multi-process log ingestion for Main, UI (IPC toad:log), and Engine (parentPort)
 */

import * as path from "path";
import * as fs from "fs";
import * as util from "util";
import log from "electron-log";

export type ProcessTag = "MAIN" | "UI" | "ENGINE";
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export interface LogEntryOptions {
  elapsedMs?: number;
  rssMB?: number;
  timestamp?: number;
}

export interface IngestLogEntry {
  processTag: ProcessTag;
  moduleTag: string;
  level: LogLevel;
  message: string;
  elapsedMs?: number;
  rssMB?: number;
  timestamp?: number;
}

export interface ToadLoggerOptions {
  logsDir: string;
  level: LogLevel;
  maxSize?: number; // default: 20 * 1024 * 1024 (20 MB)
  maxRollingFiles?: number; // default: 5 (active toad.log + 4 rolling archives: toad.1.log .. toad.4.log)
  maxTotalMB?: number; // default: 100 MB
}

// Dynamically register custom level 'trace' if not present in electron-log v4
if (!log.levels.includes("trace")) {
  log.levels.add("trace");
}

export class ToadLogger {
  private static isConfigured = false;
  private static logsDir = "";
  private static effectiveLevel: LogLevel = "info";
  private static maxSize = 20 * 1024 * 1024; // 20 MB
  private static maxRollingArchives = 4; // up to 5 rolling files: active + 4 archives
  private static maxTotalBytes = 100 * 1024 * 1024; // 100 MB
  private static instances: Map<string, ToadLogger> = new Map();
  private static appStartTime = Date.now();

  public readonly processTag: ProcessTag;
  public readonly moduleTag: string;

  private constructor(processTag: ProcessTag, moduleTag: string) {
    this.processTag = processTag;
    this.moduleTag = moduleTag;
  }

  /**
   * Get or create a ToadLogger instance for a specific process and module
   */
  public static get(processTag: ProcessTag, moduleTag: string): ToadLogger {
    const key = `${processTag}:${moduleTag}`;
    let instance = this.instances.get(key);
    if (!instance) {
      instance = new ToadLogger(processTag, moduleTag);
      this.instances.set(key, instance);
    }
    return instance;
  }

  /**
   * Configure centralized electron-log transport, size rotation, and formatting
   */
  public static configure(options: ToadLoggerOptions): void {
    this.logsDir = options.logsDir;
    this.effectiveLevel = options.level;
    this.maxSize = options.maxSize ?? 20 * 1024 * 1024;
    const totalFiles = options.maxRollingFiles ?? 5;
    this.maxRollingArchives = Math.max(1, totalFiles - 1);
    this.maxTotalBytes = (options.maxTotalMB ?? 100) * 1024 * 1024;

    if (!fs.existsSync(this.logsDir)) {
      try {
        fs.mkdirSync(this.logsDir, { recursive: true });
      } catch (err) {
        console.error(`[ToadLogger] Failed to create logsDir: ${this.logsDir}`, err);
      }
    }

    if (!log.levels.includes("trace")) {
      log.levels.add("trace");
    }

    const activeLogPath = path.join(this.logsDir, "toad.log");
    log.transports.file.resolvePath = () => activeLogPath;
    log.transports.file.maxSize = this.maxSize;
    log.transports.file.level = this.effectiveLevel as any;
    log.transports.file.sync = true;

    // Rolling rotation: toad.log -> toad.1.log -> toad.2.log -> toad.3.log -> toad.4.log
    const maxArchives = this.maxRollingArchives;
    const maxTotal = this.maxTotalBytes;

    log.transports.file.archiveLog = (file: any) => {
      const activePath = file.path || (file.toString ? file.toString() : String(file));
      const dir = path.dirname(activePath);
      const ext = path.extname(activePath);
      const base = path.basename(activePath, ext);

      try {
        // 1. Delete oldest file beyond maxRollingArchives (e.g. toad.4.log)
        const oldest = path.join(dir, `${base}.${maxArchives}${ext}`);
        if (fs.existsSync(oldest)) {
          try {
            fs.unlinkSync(oldest);
          } catch {}
        }

        // 2. Shift existing rolling files (e.g. 3 -> 4, 2 -> 3, 1 -> 2)
        for (let i = maxArchives - 1; i >= 1; i--) {
          const src = path.join(dir, `${base}.${i}${ext}`);
          const dst = path.join(dir, `${base}.${i + 1}${ext}`);
          if (fs.existsSync(src)) {
            try {
              fs.renameSync(src, dst);
            } catch {
              try {
                fs.copyFileSync(src, dst);
                fs.unlinkSync(src);
              } catch {}
            }
          }
        }

        // 3. Shift active file to .1
        const target1 = path.join(dir, `${base}.1${ext}`);
        if (fs.existsSync(activePath)) {
          try {
            fs.renameSync(activePath, target1);
          } catch {
            try {
              fs.copyFileSync(activePath, target1);
              fs.unlinkSync(activePath);
            } catch {}
          }
        }

        // 4. Enforce disk cap across all toad*.log files
        ToadLogger.enforceDiskCap(dir, base, ext, maxTotal);
      } catch (err) {
        // Safe fallback for Windows file lock
        try {
          const fallback = path.join(dir, `${base}.old_${Date.now()}${ext}`);
          if (fs.existsSync(activePath)) {
            fs.renameSync(activePath, fallback);
          }
        } catch {}
      }
    };

    // Formatter
    const customFormat = ToadLogger.formatLogMessage.bind(ToadLogger);
    log.transports.file.format = customFormat;
    if (log.transports.console) {
      log.transports.console.format = customFormat;
      log.transports.console.level = this.effectiveLevel as any;
    }

    this.isConfigured = true;
  }

  /**
   * Unified log message formatter:
   * [YYYY-MM-DD HH:mm:ss.SSS] [LEVEL] [MAIN|UI|ENGINE] [Module] (+elapsed ms, RSS: MB) message
   */
  public static formatLogMessage(msg: any): string {
    const meta = (msg.variables && msg.variables.__toadMeta) || {};
    const d = meta.timestamp ? new Date(meta.timestamp) : (msg.date || new Date());
    const pad = (n: number, z = 2) => String(n).padStart(z, "0");
    const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
    const lvl = (msg.level || "info").toUpperCase();

    const proc = meta.processTag || "MAIN";
    let mod = meta.moduleTag || "General";
    const elapsedRaw = meta.elapsedMs !== undefined ? meta.elapsedMs : (Date.now() - ToadLogger.appStartTime);
    const elapsed = typeof elapsedRaw === "number" && !Number.isInteger(elapsedRaw) ? Number(elapsedRaw.toFixed(2)) : elapsedRaw;
    const rss = meta.rssMB !== undefined
      ? meta.rssMB
      : (typeof process !== "undefined" && process.memoryUsage ? Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(1)) : 0.0);

    let text = (msg.data || []).map((arg: any) => {
      if (arg instanceof Error) return arg.stack || arg.message;
      if (typeof arg === "object" && arg !== null) {
        try {
          return util.inspect(arg, { depth: 4, compact: true });
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(" ");

    // Strip redundant leading [PROCESS] and [Module] tags from text if present
    const doubleTagMatch = text.match(/^\[(MAIN|UI|ENGINE)\]\s*\[([^\]]+)\]\s*(.*)$/i);
    if (doubleTagMatch) {
      if (!meta.moduleTag || meta.moduleTag === "General") {
        mod = doubleTagMatch[2];
      }
      text = doubleTagMatch[3];
    } else {
      const singleProcessMatch = text.match(/^\[(MAIN|UI|ENGINE)\]\s*(.*)$/i);
      if (singleProcessMatch) {
        text = singleProcessMatch[2];
      }
      const leadingTagMatch = text.match(/^\[([a-zA-Z0-9_\-\.]+)\]\s*(.*)$/);
      if (leadingTagMatch && leadingTagMatch[1] === mod) {
        text = leadingTagMatch[2];
      } else if (leadingTagMatch && (!meta.moduleTag || meta.moduleTag === "General")) {
        mod = leadingTagMatch[1];
        text = leadingTagMatch[2];
      }
    }

    return `[${ts}] [${lvl}] [${proc}] [${mod}] (+${elapsed}ms, RSS: ${rss}MB) ${text}`;
  }

  /**
   * Enforce disk cap across all rolling log files
   */
  public static enforceDiskCap(dir: string, base: string, ext: string, maxBytes: number): void {
    try {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir)
        .filter(f => f.startsWith(base) && f.endsWith(ext))
        .map(f => {
          const p = path.join(dir, f);
          try {
            return { name: f, path: p, size: fs.statSync(p).size };
          } catch {
            return { name: f, path: p, size: 0 };
          }
        });

      let total = entries.reduce((acc, e) => acc + e.size, 0);
      if (total > maxBytes) {
        const archives = entries
          .filter(e => e.name !== `${base}${ext}`)
          .sort((a, b) => {
            const numA = parseInt(a.name.replace(`${base}.`, "").replace(ext, ""), 10) || 0;
            const numB = parseInt(b.name.replace(`${base}.`, "").replace(ext, ""), 10) || 0;
            return numB - numA; // highest number first (oldest)
          });

        for (const arch of archives) {
          if (total <= maxBytes) break;
          try {
            fs.unlinkSync(arch.path);
            total -= arch.size;
          } catch {}
        }
      }
    } catch {}
  }

  /**
   * Log with structured metadata attached to electron-log
   */
  public logWithMeta(level: LogLevel, args: any[], meta?: LogEntryOptions): void {
    if (!ToadLogger.isConfigured) {
      if (!log.levels.includes("trace")) {
        log.levels.add("trace");
      }
      const customFormat = ToadLogger.formatLogMessage.bind(ToadLogger);
      log.transports.file.format = customFormat;
      if (log.transports.console) {
        log.transports.console.format = customFormat;
      }
    }

    const elapsed = meta?.elapsedMs ?? (Date.now() - ToadLogger.appStartTime);
    const rss = meta?.rssMB ?? (
      typeof process !== "undefined" && process.memoryUsage
        ? Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(1))
        : 0.0
    );

    const prevMeta = (log as any).variables?.__toadMeta;
    (log as any).variables = Object.assign({}, (log as any).variables, {
      __toadMeta: {
        processTag: this.processTag,
        moduleTag: this.moduleTag,
        elapsedMs: elapsed,
        rssMB: rss,
        timestamp: meta?.timestamp,
      },
    });

    try {
      if (typeof (log as any)[level] === "function") {
        (log as any)[level](...args);
      } else {
        log.info(...args);
      }
    } finally {
      if (prevMeta !== undefined) {
        (log as any).variables.__toadMeta = prevMeta;
      } else if ((log as any).variables) {
        delete (log as any).variables.__toadMeta;
      }
    }
  }

  public trace(...args: any[]): void { this.logWithMeta("trace", args); }
  public debug(...args: any[]): void { this.logWithMeta("debug", args); }
  public info(...args: any[]): void { this.logWithMeta("info", args); }
  public warn(...args: any[]): void { this.logWithMeta("warn", args); }
  public error(...args: any[]): void { this.logWithMeta("error", args); }

  /**
   * Synchronously profile an operation and emit duration & RSS delta at TRACE level
   */
  public profile<T>(operation: string, fn: () => T): T {
    const start = performance.now();
    const startRss = (typeof process !== "undefined" && process.memoryUsage) ? process.memoryUsage().rss : 0;
    try {
      const res = fn();
      const elapsed = (performance.now() - start).toFixed(2);
      const deltaRss = (typeof process !== "undefined" && process.memoryUsage)
        ? ((process.memoryUsage().rss - startRss) / (1024 * 1024)).toFixed(2)
        : "0.0";
      this.trace(`[PROFILE] ${operation} completed in ${elapsed}ms (RSS delta: ${deltaRss}MB)`);
      return res;
    } catch (err: any) {
      const elapsed = (performance.now() - start).toFixed(2);
      this.error(`[PROFILE] ${operation} failed after ${elapsed}ms: ${err?.message}`);
      throw err;
    }
  }

  /**
   * Asynchronously profile an operation and emit duration & RSS delta at TRACE level
   */
  public async profileAsync<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    const startRss = (typeof process !== "undefined" && process.memoryUsage) ? process.memoryUsage().rss : 0;
    try {
      const res = await fn();
      const elapsed = (performance.now() - start).toFixed(2);
      const deltaRss = (typeof process !== "undefined" && process.memoryUsage)
        ? ((process.memoryUsage().rss - startRss) / (1024 * 1024)).toFixed(2)
        : "0.0";
      this.trace(`[PROFILE] ${operation} completed in ${elapsed}ms (RSS delta: ${deltaRss}MB)`);
      return res;
    } catch (err: any) {
      const elapsed = (performance.now() - start).toFixed(2);
      this.error(`[PROFILE] ${operation} failed after ${elapsed}ms: ${err?.message}`);
      throw err;
    }
  }

  /**
   * Multi-process log entry ingestion (e.g. from UI IPC or Engine worker)
   */
  public static ingest(entry: IngestLogEntry): void {
    if (!entry) return;
    const logger = ToadLogger.get(entry.processTag || "MAIN", entry.moduleTag || "General");
    logger.logWithMeta(
      entry.level || "info",
      [entry.message],
      {
        elapsedMs: entry.elapsedMs,
        rssMB: entry.rssMB,
        timestamp: entry.timestamp,
      }
    );
  }

  /**
   * Multi-process batched log entry ingestion
   */
  public static ingestBatch(entries: IngestLogEntry[]): void {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      ToadLogger.ingest(entry);
    }
  }

  public static getEffectiveLevel(): LogLevel {
    return this.effectiveLevel;
  }

  public static setLogLevel(level: LogLevel): void {
    this.effectiveLevel = level;
    if (log.transports.file) {
      log.transports.file.level = level as any;
    }
    if (log.transports.console) {
      log.transports.console.level = level as any;
    }
  }

  public static getLogsDir(): string {
    return this.logsDir;
  }

  public static getStartTime(): number {
    return this.appStartTime;
  }

  public static resetForTesting(): void {
    this.isConfigured = false;
    this.instances.clear();
  }
}

export default ToadLogger;
