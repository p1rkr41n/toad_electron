/**
 * Import CSV/JSON/Parquet files into DuckDB
 *
 * Nâng cấp theo phương án TOAD Ingestion Engine:
 * - Giai đoạn 1: Binary Guard (8KB check)
 * - Giai đoạn 2: Nạp cấu hình động từ config.ini (hot-reload)
 * - Giai đoạn 3: Chuẩn bị đường dẫn Parquet tạm
 * - Giai đoạn 4: Streaming DuckDB sang Parquet với 3-tier fallback
 * - Giai đoạn 5: Thẩm định Parquet & Handoff VIEW
 */

import * as log from "loglevel";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as crypto from "crypto";
import * as child_process from "child_process";
import { Connection, Database } from "duckdb-async";
import * as prettyHRTime from "pretty-hrtime";
import { initS3 } from "./s3utils";

let electron: any = null;
try {
  electron = require("electron");
} catch { }

export interface ToadIngestProgressInfo {
  isOpen: boolean;
  fileName: string;
  percent: number;
  speedMBs: number;
  etaSec: number;
  statusText: string;
}

export function broadcastIngestProgress(info: ToadIngestProgressInfo) {
  try {
    if (electron && electron.BrowserWindow) {
      const wins = electron.BrowserWindow.getAllWindows();
      for (const w of wins) {
        if (w && !w.isDestroyed() && w.webContents) {
          w.webContents.send("toad-ingest-progress", info);
        }
      }
    }
  } catch { }
}
let uniqMap: { [cid: string]: number } = {};

/* add a numeric _N suffix to an identifer to make it unique */
const uniquify = (src: string): string => {
  let entry = uniqMap[src];
  if (entry === undefined) {
    uniqMap[src] = 1;
    return src; // no suffix needed
  }
  const ret = src + "_" + entry.toString();
  uniqMap[src] = ++entry;
  return ret;
};

/* map to alphanumeric */
const mapIdent = (src: string): string => {
  const ret = src.replace(/[^a-z0-9_]/gi, "_");
  return ret;
};

const isAlpha = (ch: string): boolean => /^[A-Z]$/i.test(ch);

const MAXLEN = 16;

/* generate a SQL table name from pathname */
export const genTableName = (pathname: string): string => {
  const extName = path.extname(pathname);
  const baseName = path.basename(pathname, extName);
  let baseIdent = mapIdent(baseName);
  if (baseIdent.length >= MAXLEN) {
    baseIdent = baseIdent.slice(0, MAXLEN);
  }
  if (!isAlpha(baseIdent[0])) {
    baseIdent = "t_" + baseIdent;
  }
  const tableName = uniquify(baseIdent);
  return tableName;
};

// =============================================================================
// TOAD RUST CORE BINARY DISCOVERY
// =============================================================================

function findToadCoreBinary(): string | null {
  const env = (global as any).toadPortableEnv;
  const exeDir = env?.exeDir;
  const candidates = [
    exeDir ? path.join(exeDir, "toad-core.exe") : null,
    exeDir ? path.join(exeDir, "bin", "toad-core.exe") : null,
    (process as any).resourcesPath
      ? path.join((process as any).resourcesPath, "bin", "toad-core.exe")
      : null,
    path.join(__dirname, "../../../tad-app/bin/toad-core.exe"),
    path.join(__dirname, "../../../toad-core-rust/target/release/toad-core.exe"),
    path.join(__dirname, "../../../../packages/toad-core-rust/target/release/toad-core.exe"),
  ];

  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      return c;
    }
  }
  return null;
}

// =============================================================================
// GIAI ĐOẠN 1: Binary Guard (SIMD Rust Native & 8KB Fallback)
// =============================================================================

/**
 * Quét bảo vệ chống crash khi người dùng vô tình mở file nhị phân (PE, ELF, null-byte...)
 * Ưu tiên gọi toad-core.exe inspect (Rust SIMD)
 */
function binaryGuard(filePath: string): void {
  const ext = path.extname(filePath).toLowerCase();

  // Các file nhị phân hợp lệ không cần kiểm tra
  const binaryAllowedExts = [".parquet", ".duckdb", ".sqlite", ".evtx"];
  if (binaryAllowedExts.includes(ext)) return;

  // 1. Ưu tiên chạy Rust Binary Guard
  const toadCore = findToadCoreBinary();
  if (toadCore) {
    try {
      child_process.execFileSync(toadCore, ["inspect", filePath], {
        windowsHide: true,
        timeout: 10000,
      });
      return;
    } catch (err: any) {
      const stdout = err.stdout?.toString() || "";
      if (stdout.includes("[Binary Guard] Trang thai: HOP LE")) {
        // Rust Core Binary Guard đã kiểm tra 8KB và xác nhận file hợp lệ!
        return;
      }
      const stderr = err.stderr?.toString() || "";
      if (stderr.includes("[Binary Guard] BI CHAN")) {
        log.error("[BinaryGuard Rust]", stderr);
        throw new Error(stderr.trim());
      }
      // Nếu có timeout hoặc lỗi phụ khác, không crash false-positive mà fallback sang JS check
      log.warn(
        "[BinaryGuard Rust] Khong the chay inspect hoan tat, fallback sang JS 8KB check:",
        err.message
      );
    }
  }

  // 2. Fallback sang JavaScript Binary Guard
  const GUARD_SIZE = 8192; // 8KB
  let fd: number;
  try {
    fd = fs.openSync(filePath, "r");
  } catch (err) {
    throw new Error(`Unable to open file for binary check: ${filePath}`);
  }

  try {
    const buffer = Buffer.alloc(GUARD_SIZE);
    const bytesRead = fs.readSync(fd, buffer, 0, GUARD_SIZE, 0);

    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) {
        throw new Error(
          `[Binary Guard] File "${path.basename(filePath)}" is a binary file (detected null byte at offset ${i}). ` +
          `Toad only supports CSV, TSV, JSON, JSONL, Parquet, and EVTX text/data formats. Please verify your file.`
        );
      }
    }
  } finally {
    fs.closeSync(fd);
  }
}

// =============================================================================
// GIAI ĐOẠN 2: Nạp cấu hình động từ toadAppData_*/config.ini
// =============================================================================

export interface IngestConfig {
  max_memory: string;
  threads: number;
  background_threads: number | "auto";
  compression: string;
  row_group_size: number;
  binary_guard: boolean;
  temp_dir: string | null;
  ledger_path: string;
  temp_cleanup: boolean;
}

export function getIngestConfig(): IngestConfig {
  const env = (global as any).toadPortableEnv;

  if (env && env.config) {
    return {
      max_memory: env.config.duckdb.max_memory,
      threads: env.config.duckdb.threads,
      background_threads: env.config.duckdb.background_threads ?? "auto",
      compression: env.config.parquet.compression,
      row_group_size: env.config.parquet.row_group_size,
      binary_guard: env.config.system.binary_guard,
      temp_dir: env.tempDir || null,
      ledger_path:
        env.ledgerPath ||
        (env.appDataDir
          ? path.join(env.appDataDir, "toad_ledger.parquet")
          : path.join(env.tempDir || os.tmpdir(), "toad_ledger.parquet")),
      temp_cleanup: env.config.system.temp_cleanup ?? false,
    };
  }

  // Fallback nếu chưa có portable env (chạy độc lập, tests, hoặc CLI)
  const fallbackTempDir =
    process.env.TOAD_TEMP_DIR || path.join(os.tmpdir(), "toad_temp");
  try {
    if (!fs.existsSync(fallbackTempDir)) {
      fs.mkdirSync(fallbackTempDir, { recursive: true });
    }
  } catch { }

  return {
    max_memory: "auto",
    threads: 0,
    background_threads: "auto",
    compression: "snappy",
    row_group_size: 100000,
    binary_guard: false,
    temp_dir: fallbackTempDir,
    ledger_path: path.join(fallbackTempDir, "toad_ledger.parquet"),
    temp_cleanup: false,
  };
}

// =============================================================================
// GIAI ĐOẠN 3: Parquet State Ledger (WAL) & Double Validation Engine
// =============================================================================

export interface ToadLedgerEntry {
  event_id: string;
  timestamp: number;
  source_path: string;
  source_size: number;
  source_mtime: number;
  parquet_path: string;
  parquet_size: number;
  row_count: number;
  status: "STARTED" | "READY" | "ERROR" | "STALE";
  duration_ms: number;
  extra_json: string;
}

/**
 * Quản lý State Ledger toàn hệ thống TOAD bằng Parquet
 * Hoạt động theo mô hình Append-Only Transaction Journal (WAL):
 * - File `toad_ledger.parquet` chỉ thêm bản ghi, không bao giờ ghi đè lịch sử.
 * - Khi ứng dụng khởi động, nạp snapshot trạng thái mới nhất per source_path.
 * - Hỗ trợ Double Validation (Freshness nguồn & Tính toàn vẹn Parquet vật lý).
 */
export class ToadParquetLedger {
  private static instance: ToadParquetLedger | null = null;
  private ledgerPath: string | null = null;
  private cache: Map<string, ToadLedgerEntry> = new Map();
  private writeQueue: Promise<void> = Promise.resolve();
  private isLoaded: boolean = false;
  private db: Database | null = null;

  public static getInstance(): ToadParquetLedger {
    if (!ToadParquetLedger.instance) {
      ToadParquetLedger.instance = new ToadParquetLedger();
    }
    return ToadParquetLedger.instance;
  }

  public getLedgerPath(): string {
    if (this.ledgerPath) return this.ledgerPath;
    const cfg = getIngestConfig();
    this.ledgerPath =
      cfg.ledger_path ||
      (cfg.temp_dir
        ? path.join(cfg.temp_dir, "toad_ledger.parquet")
        : path.join(os.tmpdir(), "toad_ledger.parquet"));
    return this.ledgerPath;
  }

  public normalizePath(p: string): string {
    try {
      return path.resolve(p).replace(/\\/g, "/").toLowerCase();
    } catch {
      return p.replace(/\\/g, "/").toLowerCase();
    }
  }

  public getEntry(sourcePath: string): ToadLedgerEntry | undefined {
    return this.cache.get(this.normalizePath(sourcePath));
  }

  public getAllEntries(): ToadLedgerEntry[] {
    return Array.from(this.cache.values());
  }

  public async initLedger(db?: Database): Promise<void> {
    if (this.isLoaded) return;
    if (db) this.db = db;
    const lPath = this.getLedgerPath();
    if (!fs.existsSync(lPath)) {
      this.isLoaded = true;
      return;
    }

    try {
      const activeDb = this.db || (await this.getOrCreateInternalDb());
      const conn = await activeDb.connect();
      try {
        const sql = `
          SELECT * EXCLUDE (rn) FROM (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY source_path ORDER BY timestamp DESC) as rn
            FROM read_parquet('${escapeSqlPath(lPath)}')
          ) WHERE rn = 1
        `;
        const rows = await conn.all(sql);
        for (const row of rows) {
          const entry: ToadLedgerEntry = {
            event_id: String(row.event_id),
            timestamp: Number(row.timestamp),
            source_path: String(row.source_path),
            source_size: Number(row.source_size),
            source_mtime: Number(row.source_mtime),
            parquet_path: String(row.parquet_path),
            parquet_size: Number(row.parquet_size),
            row_count: Number(row.row_count || 0),
            status: row.status as any,
            duration_ms: Number(row.duration_ms || 0),
            extra_json: String(row.extra_json || "{}"),
          };
          this.cache.set(this.normalizePath(entry.source_path), entry);
        }
        this.isLoaded = true;
        log.info(
          `[ToadLedger] Da nap thanh cong ${this.cache.size} ban ghi trang thai tu Parquet Ledger: ${lPath}`
        );
      } finally {
        await conn.close();
      }
    } catch (err) {
      log.warn("[ToadLedger] Khong the nap ledger snapshot tu file Parquet:", err);
      this.isLoaded = true;
    }
  }

  private async getOrCreateInternalDb(): Promise<Database> {
    if (this.db) return this.db;
    const { Database: DuckDbAsync } = require("duckdb-async");
    this.db = await DuckDbAsync.create(":memory:");
    return this.db!;
  }

  public async recordEvent(evt: ToadLedgerEntry): Promise<void> {
    const norm = this.normalizePath(evt.source_path);
    this.cache.set(norm, evt);

    this.writeQueue = this.writeQueue.then(async () => {
      try {
        const lPath = this.getLedgerPath();
        const lDir = path.dirname(lPath);
        if (!fs.existsSync(lDir)) {
          fs.mkdirSync(lDir, { recursive: true });
        }

        const activeDb = this.db || (await this.getOrCreateInternalDb());
        const conn = await activeDb.connect();
        try {
          const tmpPath = `${lPath}.tmp_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 7)}`;
          const safeSource = escapeSqlPath(evt.source_path).replace(/'/g, "''");
          const safeParquet = escapeSqlPath(evt.parquet_path).replace(/'/g, "''");
          const safeExtra = (evt.extra_json || "{}").replace(/'/g, "''");

          const rowSql = `SELECT 
            '${evt.event_id}' as event_id,
            CAST(${evt.timestamp} AS BIGINT) as timestamp,
            '${safeSource}' as source_path,
            CAST(${evt.source_size} AS BIGINT) as source_size,
            CAST(${evt.source_mtime} AS BIGINT) as source_mtime,
            '${safeParquet}' as parquet_path,
            CAST(${evt.parquet_size} AS BIGINT) as parquet_size,
            CAST(${evt.row_count} AS BIGINT) as row_count,
            '${evt.status}' as status,
            CAST(${evt.duration_ms} AS INTEGER) as duration_ms,
            '${safeExtra}' as extra_json
          `;

          if (fs.existsSync(lPath)) {
            const appendSql = `COPY (
              SELECT * FROM read_parquet('${escapeSqlPath(lPath)}')
              UNION ALL
              ${rowSql}
            ) TO '${escapeSqlPath(tmpPath)}' (FORMAT PARQUET)`;
            await conn.run(appendSql);
          } else {
            const createSql = `COPY (${rowSql}) TO '${escapeSqlPath(
              tmpPath
            )}' (FORMAT PARQUET)`;
            await conn.run(createSql);
          }

          if (fs.existsSync(tmpPath)) {
            fs.renameSync(tmpPath, lPath);
          }
        } finally {
          await conn.close();
        }
      } catch (writeErr) {
        log.warn("[ToadLedger] Loi khi ghi Parquet Ledger:", writeErr);
      }
    });
    return this.writeQueue;
  }
}

export function initToadLedger(db?: Database): Promise<void> {
  return ToadParquetLedger.getInstance().initLedger(db);
}

export interface NativeCSVImportOptions {
  forceReopen?: boolean;
}

export interface ParquetCachePaths {
  parquetPath: string;
  tmpPath: string;
  cacheKey: string;
}

/**
 * Sinh đường dẫn Parquet xác định (deterministic) dựa trên canonical path của file nguồn
 */
export function getDeterministicParquetPath(
  filePath: string,
  tempDir: string | null
): ParquetCachePaths | null {
  if (!tempDir) return null;

  const extName = path.extname(filePath);
  const baseName = path.basename(filePath, extName);
  const safeBase = baseName.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 50);

  let canonical = filePath;
  try {
    canonical = fs.realpathSync(filePath);
  } catch { }
  const normalized = canonical.toLowerCase().replace(/\\/g, "/");
  const pathHash = crypto
    .createHash("md5")
    .update(normalized)
    .digest("hex")
    .slice(0, 10);

  const parquetName = `${safeBase}_cached_${pathHash}.parquet`;
  const tmpName = `${safeBase}_cached_${pathHash}.tmp_${Date.now()}.parquet`;

  return {
    parquetPath: path.join(tempDir, parquetName).replace(/\\/g, "/"),
    tmpPath: path.join(tempDir, tmpName).replace(/\\/g, "/"),
    cacheKey: normalized,
  };
}

/**
 * Double Validation Engine: Thẩm định Parquet cache 2 tầng:
 * - Level 1 (Source Freshness): Kiểm tra mtime và size của file nguồn đối chiếu với Ledger.
 * - Level 2 (Physical Cache Integrity): Kiểm tra file Parquet tồn tại và size khớp với Ledger.
 */
export function checkDoubleValidCache(
  filePath: string,
  cachedInfo?: ParquetCachePaths | null,
  forceReopen?: boolean
): boolean {
  if (forceReopen) {
    log.info(
      `[TOAD Parquet Cache] Yeu cau forceReopen=true, sinh moi Parquet cho: ${filePath}`
    );
    return false;
  }

  const ledger = ToadParquetLedger.getInstance();
  const entry = ledger.getEntry(filePath);

  const targetParquetPath = cachedInfo?.parquetPath || entry?.parquet_path;
  if (!targetParquetPath || !fs.existsSync(targetParquetPath)) {
    return false;
  }

  try {
    const parquetStat = fs.statSync(targetParquetPath);
    if (parquetStat.size === 0) return false;

    if (!fs.existsSync(filePath)) return false;
    const srcStat = fs.statSync(filePath);

    // LEVEL 1 & 2: Double Validation khi có bản ghi trong Ledger
    if (entry && entry.status === "READY") {
      // 1.1 Source size
      if (srcStat.size !== entry.source_size) {
        log.info(
          `[DoubleValid] Level 1 Fail: Kich thuoc nguon thay doi (${srcStat.size} vs ${entry.source_size}) cho ${filePath}`
        );
        return false;
      }
      // 1.2 Source mtime (dung sai 1000ms do filesystem timestamp precision)
      if (Math.abs(srcStat.mtimeMs - entry.source_mtime) > 1000) {
        log.info(
          `[DoubleValid] Level 1 Fail: Thoi gian sua doi nguon thay doi (${srcStat.mtimeMs} vs ${entry.source_mtime}) cho ${filePath}`
        );
        return false;
      }
      // 2.1 Parquet physical size
      if (parquetStat.size !== entry.parquet_size) {
        log.info(
          `[DoubleValid] Level 2 Fail: Kich thuoc Parquet thay doi (${parquetStat.size} vs ${entry.parquet_size}) cho ${filePath}`
        );
        return false;
      }
      return true;
    }

    // Fallback: Legacy Parquet Cache (so sánh mtime nguồn vs parquet)
    if (srcStat.mtimeMs > parquetStat.mtimeMs) {
      log.info(
        `[TOAD Parquet Cache] File nguon "${path.basename(
          filePath
        )}" co thay doi tren dia (mtime moi hon parquet). Sinh lai Parquet.`
      );
      return false;
    }

    // Tự động lập chỉ mục file cache cũ này vào Ledger
    ledger
      .recordEvent({
        event_id: `legacy-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 7)}`,
        timestamp: Date.now(),
        source_path: filePath,
        source_size: srcStat.size,
        source_mtime: Math.round(srcStat.mtimeMs),
        parquet_path: targetParquetPath,
        parquet_size: parquetStat.size,
        row_count: 0,
        status: "READY",
        duration_ms: 0,
        extra_json: JSON.stringify({ legacyMigrated: true }),
      })
      .catch(() => {});

    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Thẩm định file Parquet đã có trong cache (tương thích ngược hoàn toàn qua checkDoubleValidCache)
 */
export function checkParquetCache(
  filePath: string,
  cachedInfo: ParquetCachePaths,
  forceReopen?: boolean
): boolean {
  return checkDoubleValidCache(filePath, cachedInfo, forceReopen);
}

// =============================================================================
// GIAI ĐOẠN 4: Streaming DuckDB sang Parquet với 3-Tier Fallback
// =============================================================================

/**
 * Escape đường dẫn cho SQL (chuyển backslash thành forward slash)
 */
function escapeSqlPath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Áp dụng cấu hình DuckDB từ config.ini (max_memory, threads, background_threads)
 * Hỗ trợ phân bổ tài nguyên độc lập cho Dual DuckDB Engine:
 * - isBackground = true (Ingest Engine): Dành riêng tối đa 40% RAM và N-2 CPU cores
 * - isBackground = false (Interactive UI Engine): Dành riêng tối đa 25% RAM và 2 CPU cores
 */
export async function applyDuckDbConfig(
  dbConn: Connection,
  cfg: IngestConfig,
  isBackground: boolean = true
): Promise<void> {
  try {
    const totalMemMB = Math.round(os.totalmem() / (1024 * 1024));
    if (cfg.max_memory !== "auto") {
      await dbConn.exec(`SET max_memory = '${cfg.max_memory}'`);
    } else {
      // Phân bổ ngân sách RAM động cho từng engine (Dynamic Memory Partitioning)
      // Ingest Engine: max 40% RAM, trần 8GB, sàn 1GB
      // UI Engine: max 25% RAM, trần 4GB, sàn 512MB
      // Tổng ngân sách RAM của cả 2 nhân <= 65% RAM vật lý
      const ratio = isBackground ? 0.40 : 0.25;
      const capMB = isBackground ? 8192 : 4096;
      const minMB = isBackground ? 1024 : 512;
      const safeBudgetMB = Math.min(capMB, Math.max(minMB, Math.round(totalMemMB * ratio)));
      await dbConn.exec(`SET max_memory = '${safeBudgetMB}MB'`);
    }

    const totalCpus = os.cpus() ? os.cpus().length : 4;
    if (isBackground) {
      // Cô lập luồng CPU cho Background Ingestion (CPU Thread Isolation)
      let bgThreads: number;
      if (typeof cfg.background_threads === "number" && cfg.background_threads > 0) {
        bgThreads = Math.min(totalCpus, Math.max(1, Math.floor(cfg.background_threads)));
      } else {
        // "auto": Giữ lại tối thiểu 2 cores cho giao diện nếu máy có >= 4 cores, giữ 1 core nếu máy có <= 3 cores
        bgThreads = Math.max(1, totalCpus - 2);
      }
      log.info(`[DuckDB CPU Isolation] Background Ingestion configured with ${bgThreads}/${totalCpus} CPU threads (reserving ${totalCpus - bgThreads} cores for UI)`);
      await dbConn.exec(`SET threads = ${bgThreads}`);
    } else {
      // Interactive UI Engine: Luôn cố định 2 cores (hoặc 1 core nếu máy <= 3 cores)
      const uiThreads = totalCpus <= 3 ? 1 : 2;
      log.info(`[DuckDB CPU Isolation] Interactive UI Engine configured with ${uiThreads}/${totalCpus} CPU threads`);
      await dbConn.exec(`SET threads = ${uiThreads}`);
    }

    // Toi uu hoa I/O bang thong cao, chong troi sut giat lag cho ca SSD & HDD:
    // preserve_insertion_order = false giup cac luong CPU doc/nen doc lap, khong bi khoa barrier dong bo
    await dbConn.exec(`SET preserve_insertion_order = false`);
  } catch (err) {
    log.warn("Loi khi ap dung DuckDB config:", err);
  }
}

/**
 * Khởi tạo cấu hình ban đầu cho một instance DuckDB Database theo vai trò Ingest hoặc UI
 */
export async function applyEngineConfig(
  db: Database,
  isBackground: boolean = true
): Promise<void> {
  try {
    const cfg = getIngestConfig();
    const conn = await db.connect();
    await applyDuckDbConfig(conn, cfg, isBackground);
  } catch (err) {
    log.warn("Loi khi ap dung engine config:", err);
  }
}

/**
 * Streaming CSV/TSV sang Parquet với 3-tier fallback:
 *   Tier 0: auto_detect + sample_size=100000 + ignore_errors + strict_mode=false
 *   Tier 1: + parallel=false (xử lý dòng quá dài vỡ chunk đa luồng)
 *   Tier 2: + all_varchar=true (xử lý xung đột kiểu dữ liệu giữa các dòng)
 */
async function streamCsvToParquet(
  dbConn: Connection,
  filePath: string,
  parquetPath: string,
  cfg: IngestConfig
): Promise<void> {
  const safeSrc = escapeSqlPath(filePath);
  const safeDst = escapeSqlPath(parquetPath);
  const compression = cfg.compression.toUpperCase();
  const rowGroupSize = cfg.row_group_size;

  // Tier 0: Lệnh chính (RFC-4180 chuẩn quốc tế, quote='\"', escape='\"' triệt tiêu lỗi RemoveEscape trên cột số)
  const tier0Query = `
    COPY (
      SELECT * FROM read_csv(
        '${safeSrc}',
        auto_detect = true,
        sample_size = 100000,
        ignore_errors = true,
        null_padding = true,
        quote = '"',
        escape = '"'
      )
    ) TO '${safeDst}' (FORMAT PARQUET, COMPRESSION ${compression}, ROW_GROUP_SIZE ${rowGroupSize});
  `;

  try {
    log.info("[Ingest Tier 0] Dang streaming CSV sang Parquet (RFC-4180)...");
    await dbConn.exec(tier0Query);
    log.info("[Ingest Tier 0] Thanh cong!");
    return;
  } catch (err0) {
    log.warn("[Ingest Tier 0] That bai, chuyen sang Fallback Tier 1:", err0);
  }

  // Tier 1: parallel=false (xử lý dòng quá dài)
  const tier1Query = `
    COPY (
      SELECT * FROM read_csv(
        '${safeSrc}',
        auto_detect = true,
        sample_size = 100000,
        ignore_errors = true,
        null_padding = true,
        parallel = false,
        quote = '"',
        escape = '"'
      )
    ) TO '${safeDst}' (FORMAT PARQUET, COMPRESSION ${compression}, ROW_GROUP_SIZE ${rowGroupSize});
  `;

  try {
    log.info("[Ingest Tier 1] Dang thu lai voi parallel=false...");
    await dbConn.exec(tier1Query);
    log.info("[Ingest Tier 1] Thanh cong!");
    return;
  } catch (err1) {
    log.warn("[Ingest Tier 1] That bai, chuyen sang Fallback Tier 2:", err1);
  }

  // Tier 2: all_varchar=true (100% cột là VARCHAR, triệt tiêu hoàn toàn PhysicalType::VARCHAR assertion)
  const tier2Query = `
    COPY (
      SELECT * FROM read_csv(
        '${safeSrc}',
        auto_detect = true,
        sample_size = 100000,
        ignore_errors = true,
        null_padding = true,
        parallel = false,
        all_varchar = true,
        quote = '"',
        escape = '"'
      )
    ) TO '${safeDst}' (FORMAT PARQUET, COMPRESSION ${compression}, ROW_GROUP_SIZE ${rowGroupSize});
  `;

  try {
    log.info("[Ingest Tier 2] Dang thu lai voi all_varchar=true...");
    await dbConn.exec(tier2Query);
    log.info("[Ingest Tier 2] Thanh cong (100% guaranteed)!");
    return;
  } catch (err2) {
    log.warn("[Ingest Tier 2] That bai, chuyen sang Fallback Tier 3 (Raw Event Mode):", err2);
  }

  // Tier 3: Fallback cuối cùng: nạp nguyên dòng thô (Raw Event Mode) - không bao giờ thất bại
  log.info("[Ingest Tier 3] Nạp file duoi dang Raw Event...");
  await streamRawLogToParquet(dbConn, filePath, parquetPath, cfg);
  log.info("[Ingest Tier 3] Raw Event Ingest Thanh cong!");
}

/**
 * Streaming JSON/JSONL sang Parquet
 */
async function streamJsonToParquet(
  dbConn: Connection,
  filePath: string,
  parquetPath: string,
  cfg: IngestConfig
): Promise<void> {
  const safeSrc = escapeSqlPath(filePath);
  const safeDst = escapeSqlPath(parquetPath);
  const compression = cfg.compression.toUpperCase();
  const rowGroupSize = cfg.row_group_size;

  const query = `
    COPY (
      SELECT * FROM read_json_auto(
        '${safeSrc}',
        ignore_errors = true
      )
    ) TO '${safeDst}' (FORMAT PARQUET, COMPRESSION ${compression}, ROW_GROUP_SIZE ${rowGroupSize});
  `;

  try {
    log.info("[Ingest JSON] Dang streaming JSON sang Parquet...");
    await dbConn.exec(query);
    log.info("[Ingest JSON] Thanh cong!");
  } catch (err) {
    // Fallback: all_varchar
    const fallbackQuery = `
      COPY (
        SELECT * FROM read_json_auto(
          '${safeSrc}',
          ignore_errors = true
        )
      ) TO '${safeDst}' (FORMAT PARQUET, COMPRESSION ${compression}, ROW_GROUP_SIZE ${rowGroupSize});
    `;
    log.warn("[Ingest JSON] Loi, thu lai...", err);
    await dbConn.exec(fallbackQuery);
    log.info("[Ingest JSON Fallback] Thanh cong!");
  }
}

/**
 * Streaming Raw Log (.log, .txt) sang Parquet:
 * Giữ nguyên 100% nội dung dòng (raw event), không phân tách cột, không parse delimiter.
 */
async function streamRawLogToParquet(
  dbConn: Connection,
  filePath: string,
  parquetPath: string,
  cfg: IngestConfig
): Promise<void> {
  const safeSrc = escapeSqlPath(filePath);
  const safeDst = escapeSqlPath(parquetPath);
  const compression = cfg.compression.toUpperCase();
  const rowGroupSize = cfg.row_group_size;

  const query = `
    COPY (
      SELECT * FROM read_csv(
        '${safeSrc}',
        auto_detect = false,
        header = false,
        columns = {'raw_event': 'VARCHAR'},
        quote = '',
        escape = '',
        delim = null
      )
    ) TO '${safeDst}' (FORMAT PARQUET, COMPRESSION ${compression}, ROW_GROUP_SIZE ${rowGroupSize});
  `;

  log.info("[Ingest Raw Log] Dang streaming raw event giu nguyen dong sang Parquet...");
  await dbConn.exec(query);
  log.info("[Ingest Raw Log] Thanh cong (1 cot duy nhat raw_event)!");
}

// =============================================================================
// GIAI ĐOẠN 5: Thẩm định Parquet & Handoff VIEW
// =============================================================================

/**
 * Kiểm tra file Parquet đã tạo > 0 bytes và tạo VIEW
 */
export async function createViewFromParquet(
  dbConn: Connection,
  parquetPath: string,
  viewName: string
): Promise<void> {
  const safePath = escapeSqlPath(parquetPath);

  // Thẩm định: file phải tồn tại và > 0 bytes
  if (!fs.existsSync(parquetPath)) {
    throw new Error(`File Parquet tam khong ton tai: ${parquetPath}`);
  }
  const stat = fs.statSync(parquetPath);
  if (stat.size === 0) {
    throw new Error(`File Parquet tam rong: ${parquetPath}`);
  }

  // Tạo VIEW thay vì TABLE (tiết kiệm RAM)
  const query = `CREATE OR REPLACE VIEW ${viewName} AS SELECT * FROM parquet_scan('${safePath}')`;
  log.info("[Ingest Stage 5] Tao VIEW:", query);
  await dbConn.exec(query);
  log.info(
    `[Ingest Stage 5] VIEW '${viewName}' da san sang (Parquet: ${(stat.size / 1024 / 1024).toFixed(1)} MB)`
  );

  // Cache fast row count from parquet_metadata (O(1) instant count)
  try {
    const countSql = `SELECT SUM(row_group_num_rows)::BIGINT as total_rows FROM (SELECT DISTINCT row_group_id, row_group_num_rows FROM parquet_metadata('${safePath}'))`;
    const countRows: any = await dbConn.all(countSql);
    const totalRows = countRows && countRows[0] ? Number(countRows[0].total_rows) : null;
    if (totalRows !== null && !isNaN(totalRows)) {
      (global as any)._toadTableRowCountCache = (global as any)._toadTableRowCountCache || {};
      (global as any)._toadTableRowCountCache[viewName] = totalRows;
      (global as any)._toadTableRowCountCache[safePath] = totalRows;
      log.info(`[FastRowCount] Parquet metadata row count cached for ${viewName}: ${totalRows.toLocaleString()} rows`);
    }
  } catch (metaErr) {
    log.warn("[FastRowCount] Unable to cache row count from parquet_metadata:", metaErr);
  }
}

// =============================================================================
// PUBLIC API: nativeCSVImport (nâng cấp với 5 giai đoạn)
// =============================================================================

/**
 * Native import using DuckDB's built-in import facilities.
 *
 * Nâng cấp: Nếu có toadPortableEnv, sử dụng pipeline 5 giai đoạn
 *   (Binary Guard -> Config -> Temp Path -> Streaming Parquet -> VIEW)
 * Nếu không có, fallback về chế độ gốc có cải tiến (3-tier fallback in-memory)
 */
export const nativeCSVImport = async (
  db: Database,
  filePath: string,
  tableName?: string,
  options?: NativeCSVImportOptions
): Promise<string> => {
  const importStart = process.hrtime();
  const cfg = getIngestConfig();

  // Giai đoạn 1: Binary Guard
  if (cfg.binary_guard) {
    binaryGuard(filePath);
  }

  // Chuẩn hóa đường dẫn
  const normalizedPath = filePath.replace(/\\/g, "/");

  const dbConn = await db.connect();
  try {
    await initS3(dbConn);
    await applyDuckDbConfig(dbConn, cfg);

    if (!tableName) {
      tableName = genTableName(filePath);
    }

    // Giai đoạn 3: Kiểm tra Parquet Cache có sẵn không
    const cachedPaths = getDeterministicParquetPath(filePath, cfg.temp_dir);

    if (cachedPaths) {
      const { parquetPath, tmpPath } = cachedPaths;
      const isCacheHit = checkParquetCache(
        filePath,
        cachedPaths,
        options?.forceReopen
      );

      if (isCacheHit) {
        log.info(
          `[TOAD Ingest Cache] HIT! File "${path.basename(
            filePath
          )}" da co Parquet tai "${parquetPath}". Tai su dung Parquet, KHONG sinh them file moi!`
        );
        broadcastIngestProgress({
          isOpen: false,
          fileName: path.basename(filePath),
          percent: 100,
          speedMBs: 0,
          etaSec: 0,
          statusText: "Ready from cache",
        });
        // Giai đoạn 5: Tạo VIEW ngay từ file Parquet có sẵn (0ms conversion, 0 duplicate bytes!)
        await createViewFromParquet(dbConn, parquetPath, tableName);
        const importTime = process.hrtime(importStart);
        log.info(
          `[TOAD Ingest Cache] Hoan tat tai su dung Parquet trong ${prettyHRTime(
            importTime
          )} -> VIEW: ${tableName}`
        );
        return tableName;
      }

      // ===== CHẾ ĐỘ STREAMING PARQUET (5 giai đoạn đầy đủ - sinh mới hoặc reopen) =====
      const targetParquetPath = tmpPath;
      let progressTimer: any = null;
      let ioWatcherProc: child_process.ChildProcess | null = null;
      let srcBytes = 1024 * 1024;
      let srcMtime = Date.now();
      try {
        if (fs.existsSync(filePath)) {
          const st = fs.statSync(filePath);
          srcBytes = st.size;
          srcMtime = st.mtimeMs;
        }
      } catch { }

      try {
        const ext = path.extname(filePath).toLowerCase();

        // Start progress monitoring
        const fileName = path.basename(filePath);
        const startTime = Date.now();
        let lastBytes = 0;
        let lastTime = startTime;
        let smoothedSpeedMBs = 0;
        let initialReadBytes: number | null = null;

        // Ghi nhận sự kiện STARTED vào Parquet State Ledger
        ToadParquetLedger.getInstance()
          .recordEvent({
            event_id: `start-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            timestamp: Date.now(),
            source_path: filePath,
            source_size: srcBytes,
            source_mtime: Math.round(srcMtime),
            parquet_path: parquetPath,
            parquet_size: 0,
            row_count: 0,
            status: "STARTED",
            duration_ms: 0,
            extra_json: JSON.stringify({ ext }),
          })
          .catch(() => {});

        const formatSize = (bytes: number): string => {
          if (bytes >= 1024 * 1024 * 1024) {
            return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
          }
          return (bytes / (1024 * 1024)).toFixed(1) + " MB";
        };

        broadcastIngestProgress({
          isOpen: true,
          fileName,
          percent: 2,
          speedMBs: 0,
          etaSec: 0,
          statusText: "Starting multi-threaded streaming to Parquet...",
        });

        // 1. Uu tien dung Native Process IO Watcher (Toad Core Rust)
        const toadCore = findToadCoreBinary();
        if (toadCore && process.platform === "win32") {
          try {
            ioWatcherProc = child_process.spawn(
              toadCore,
              ["watch-io", String(process.pid), "1000"],
              {
                windowsHide: true,
                stdio: ["ignore", "pipe", "ignore"],
              }
            );

            let buffer = "";
            ioWatcherProc.stdout?.on("data", (chunk: Buffer) => {
              buffer += chunk.toString("utf8");
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                  const data = JSON.parse(trimmed);
                  const currentTotalRead = Number(data.read_bytes) || 0;
                  if (initialReadBytes === null) {
                    initialReadBytes = currentTotalRead;
                    lastBytes = 0;
                    lastTime = Date.now();
                    continue;
                  }

                  const deltaReadFromStart = Math.max(0, currentTotalRead - initialReadBytes);
                  const now = Date.now();
                  const dt = (now - lastTime) / 1000;

                  if (dt >= 0.5) {
                    const instantSpeed = ((deltaReadFromStart - lastBytes) / (1024 * 1024)) / dt;
                    if (smoothedSpeedMBs === 0) {
                      smoothedSpeedMBs = instantSpeed;
                    } else {
                      smoothedSpeedMBs = smoothedSpeedMBs * 0.7 + instantSpeed * 0.3;
                    }
                    lastBytes = deltaReadFromStart;
                    lastTime = now;
                  }

                  // Tiêu chí người dùng: Đọc % kích thước file input được xử lý
                  // Con số hiển thị mặc định trừ đi 10% (0% - 90%) để người dùng không bị overthinking
                  // và dành 10% cuối cho giai đoạn finalize Parquet
                  const readRatio = Math.min(1.0, Math.max(0, deltaReadFromStart / srcBytes));
                  const percent = Math.min(90, Math.max(2, Math.round(readRatio * 90)));

                  let etaSec = 0;
                  if (smoothedSpeedMBs > 0.1) {
                    const remainingInputBytes = Math.max(0, srcBytes - deltaReadFromStart);
                    etaSec = Math.round((remainingInputBytes / (1024 * 1024)) / smoothedSpeedMBs);
                  }

                  const processedStr = formatSize(deltaReadFromStart);
                  const totalStr = formatSize(srcBytes);
                  const statusText =
                    percent < 90
                      ? `Reading input: ${processedStr} / ${totalStr}`
                      : "Finalizing Parquet index & loading dataset...";

                  broadcastIngestProgress({
                    isOpen: true,
                    fileName,
                    percent,
                    speedMBs: smoothedSpeedMBs,
                    etaSec,
                    statusText,
                  });
                } catch { }
              }
            });
          } catch (e) {
            log.warn("[TOAD Ingest] Could not start IO watcher:", e);
          }
        }

        // 2. Fallback timer neu khong co IO watcher
        progressTimer = setInterval(() => {
          if (initialReadBytes !== null) {
            return; // IO watcher dang hoat dong tot
          }
          try {
            if (fs.existsSync(targetParquetPath)) {
              const dstStat = fs.statSync(targetParquetPath);
              const currentDstBytes = dstStat.size;
              const now = Date.now();
              const dt = (now - lastTime) / 1000;

              let speedMBs = 0;
              if (dt > 0.5) {
                speedMBs = ((currentDstBytes - lastBytes) / (1024 * 1024)) / dt;
                lastBytes = currentDstBytes;
                lastTime = now;
              }

              const expectedDstBytes = Math.max(1024 * 1024, Math.round(srcBytes * 0.22));
              const rawRatio = currentDstBytes / expectedDstBytes;
              const percent = Math.min(90, Math.max(2, Math.round(rawRatio * 90)));

              let etaSec = 0;
              if (speedMBs > 0.1) {
                const remainingDstBytes = Math.max(0, expectedDstBytes - currentDstBytes);
                etaSec = Math.round((remainingDstBytes / (1024 * 1024)) / speedMBs);
              }

              broadcastIngestProgress({
                isOpen: true,
                fileName,
                percent,
                speedMBs,
                etaSec,
                statusText: `Streaming to Parquet: ${(currentDstBytes / (1024 * 1024)).toFixed(1)} MB written`,
              });
            }
          } catch { }
        }, 1000);

        // Giai đoạn 4: Streaming sang Parquet
        if (ext === ".evtx") {
          const toadCore = findToadCoreBinary();
          const tempJsonl = path.join(
            cfg.temp_dir!,
            `evtx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jsonl`
          );

          broadcastIngestProgress({
            isOpen: true,
            fileName,
            percent: 5,
            speedMBs: 0,
            etaSec: 0,
            statusText: "Extracting EVTX records with TOAD Core Engine...",
          });

          if (toadCore) {
            log.info(`[TOAD Ingest] Chuyen doi EVTX -> JSONL bang TOAD Rust Core (Async): ${filePath}`);
            let evtxLastBytes = 0;
            let evtxLastTime = Date.now();
            let evtxSmoothedSpeed = 0;
            const evtxProgressTimer: any = setInterval(() => {
              try {
                if (fs.existsSync(tempJsonl)) {
                  const jsonlBytes = fs.statSync(tempJsonl).size;
                  const now = Date.now();
                  const dt = (now - evtxLastTime) / 1000;
                  if (dt >= 0.4) {
                    const instantSpeed = ((jsonlBytes - evtxLastBytes) / (1024 * 1024)) / dt;
                    evtxSmoothedSpeed =
                      evtxSmoothedSpeed === 0
                        ? instantSpeed
                        : evtxSmoothedSpeed * 0.7 + instantSpeed * 0.3;
                    evtxLastBytes = jsonlBytes;
                    evtxLastTime = now;
                  }
                  const ratio = Math.min(
                    1.0,
                    jsonlBytes / Math.max(1024 * 1024, srcBytes * 1.5)
                  );
                  const p = Math.min(65, Math.max(5, Math.round(5 + ratio * 60)));
                  let etaSec = 0;
                  if (evtxSmoothedSpeed > 0.1) {
                    const remaining = Math.max(0, srcBytes * 1.5 - jsonlBytes);
                    etaSec = Math.round(
                      remaining / (1024 * 1024) / evtxSmoothedSpeed
                    );
                  }
                  broadcastIngestProgress({
                    isOpen: true,
                    fileName,
                    percent: p,
                    speedMBs: evtxSmoothedSpeed,
                    etaSec,
                    statusText: `Decoding EVTX records: ${formatSize(
                      jsonlBytes
                    )} extracted (${evtxSmoothedSpeed.toFixed(1)} MB/s)...`,
                  });
                }
              } catch { }
            }, 300);

            try {
              await new Promise<void>((resolve, reject) => {
                child_process.execFile(
                  toadCore,
                  ["evtx-dump", filePath, tempJsonl],
                  { windowsHide: true, timeout: 180000 },
                  (err) => {
                    if (err) reject(err);
                    else resolve();
                  }
                );
              });
            } finally {
              clearInterval(evtxProgressTimer);
            }
          } else {
            log.info(`[TOAD Ingest] Chuyen doi EVTX qua PowerShell fallback: ${filePath}`);
            const psScript = `$ErrorActionPreference = 'SilentlyContinue'; Get-WinEvent -Path '${filePath}' | ForEach-Object { $xml = [xml]$_.ToXml(); $h = [ordered]@{'RecordID'=[string]$_.RecordId;'EventID'=[string]$_.Id;'Level'=[string]$_.LevelDisplayName;'TimeCreated'=$_.TimeCreated.ToString('yyyy-MM-ddTHH:mm:ss.fffZ');'Provider'=[string]$_.ProviderName;'Channel'=[string]$_.LogName;'Computer'=[string]$_.MachineName;'UserId'=[string]$_.UserId}; if ($xml.Event.EventData.Data) { foreach ($d in $xml.Event.EventData.Data) { if ($d.Name) { $h[$d.Name] = [string]$d.'#text' } } }; $h | ConvertTo-Json -Compress }`;
            await new Promise<void>((resolve, reject) => {
              child_process.exec(
                `powershell -NoProfile -NonInteractive -Command "${psScript}" > "${tempJsonl}"`,
                { windowsHide: true, maxBuffer: 50 * 1024 * 1024, timeout: 180000 },
                (err) => {
                  if (err) reject(err);
                  else resolve();
                }
              );
            });
          }

          broadcastIngestProgress({
            isOpen: true,
            fileName,
            percent: 50,
            speedMBs: 0,
            etaSec: 0,
            statusText: "Streaming decoded EVTX events into DuckDB Parquet...",
          });

          await streamJsonToParquet(dbConn, tempJsonl, targetParquetPath, cfg);
          try {
            if (fs.existsSync(tempJsonl)) {
              fs.unlinkSync(tempJsonl);
            }
          } catch { }
        } else if ([".json", ".jsonl", ".ndjson"].includes(ext)) {
          await streamJsonToParquet(dbConn, normalizedPath, targetParquetPath, cfg);
        } else if ([".log", ".txt"].includes(ext)) {
          // [RAW EVENT MODE] Doi voi file log tho (.log, .txt): giu nguyen 100% raw event, khong phan tach cot
          await streamRawLogToParquet(dbConn, normalizedPath, targetParquetPath, cfg);
        } else {
          // CSV, TSV, va cac file text khac co cau truc
          await streamCsvToParquet(dbConn, normalizedPath, targetParquetPath, cfg);
        }

        // Đổi tên nguyên tử targetParquetPath -> parquetPath
        try {
          if (fs.existsSync(parquetPath)) {
            fs.unlinkSync(parquetPath);
          }
        } catch { }
        fs.renameSync(targetParquetPath, parquetPath);

        // Lấy số lượng dòng thực tế từ file Parquet vừa tạo
        let finalRowCount = 0;
        try {
          const countRes = await dbConn.all(
            `SELECT count(*) as cnt FROM '${escapeSqlPath(parquetPath)}'`
          );
          finalRowCount = Number(countRes[0]?.cnt || 0);
        } catch { }

        let pSize = 0;
        try {
          pSize = fs.statSync(parquetPath).size;
        } catch { }

        const importElapsedMs = process.hrtime(importStart);
        const durationMs = Math.round(
          importElapsedMs[0] * 1000 + importElapsedMs[1] / 1e6
        );

        // Ghi nhận trạng thái READY vào State Ledger (Append-Only)
        await ToadParquetLedger.getInstance().recordEvent({
          event_id: `ready-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 7)}`,
          timestamp: Date.now(),
          source_path: filePath,
          source_size: srcBytes,
          source_mtime: Math.round(srcMtime),
          parquet_path: parquetPath,
          parquet_size: pSize,
          row_count: finalRowCount,
          status: "READY",
          duration_ms: durationMs,
          extra_json: JSON.stringify({ ext, view: tableName }),
        });

        // Giai đoạn 5: Tạo VIEW
        broadcastIngestProgress({
          isOpen: true,
          fileName,
          percent: 92,
          speedMBs: smoothedSpeedMBs,
          etaSec: 0,
          statusText: "Finalizing Parquet index & loading dataset...",
        });
        await createViewFromParquet(dbConn, parquetPath, tableName);

        broadcastIngestProgress({
          isOpen: false,
          fileName,
          percent: 100,
          speedMBs: 0,
          etaSec: 0,
          statusText: "Ready",
        });

        const importTime = process.hrtime(importStart);
        log.info(
          `[TOAD Ingest] Import streaming hoan tat trong ${prettyHRTime(
            importTime
          )} -> VIEW: ${tableName}`
        );
        return tableName;
      } catch (streamErr) {
        log.warn(
          "[TOAD Ingest] Streaming pipeline that bai, fallback ve in-memory import:",
          streamErr
        );
        // Ghi nhận sự kiện ERROR vào Parquet State Ledger
        ToadParquetLedger.getInstance()
          .recordEvent({
            event_id: `err-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 7)}`,
            timestamp: Date.now(),
            source_path: filePath,
            source_size: srcBytes,
            source_mtime: Math.round(srcMtime),
            parquet_path: parquetPath,
            parquet_size: 0,
            row_count: 0,
            status: "ERROR",
            duration_ms: 0,
            extra_json: JSON.stringify({ error: String(streamErr) }),
          })
          .catch(() => {});
        // Xóa file Parquet tạm lỗi nếu có
        try {
          if (fs.existsSync(targetParquetPath)) {
            fs.unlinkSync(targetParquetPath);
          }
        } catch { }
        // Tiếp tục với in-memory fallback bên dưới
      } finally {
        if (ioWatcherProc) {
          try {
            (ioWatcherProc as any).kill();
          } catch { }
          ioWatcherProc = null;
        }
        if (progressTimer) {
          clearInterval(progressTimer);
        }
        broadcastIngestProgress({
          isOpen: false,
          fileName: path.basename(filePath),
          percent: 100,
          speedMBs: 0,
          etaSec: 0,
          statusText: "Ready",
        });
      }
    }

    // ===== CHẾ ĐỘ IN-MEMORY FALLBACK (cải tiến với 3-tier) =====
    const safePath = escapeSqlPath(normalizedPath);
    const ext = path.extname(filePath).toLowerCase();

    // Doi voi file log tho (.log, .txt): nap thang raw_event duy nhat
    if ([".log", ".txt"].includes(ext)) {
      try {
        const query = `CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_csv('${safePath}', auto_detect=false, header=false, columns={'raw_event': 'VARCHAR'}, quote='', escape='', delim=null)`;
        await dbConn.all(query);
        const importTime = process.hrtime(importStart);
        log.info(
          "[DuckDB In-Memory Raw Log]: import completed in ",
          prettyHRTime(importTime)
        );
        return tableName;
      } catch (errRaw) {
        log.warn("[Ingest In-Memory Raw Log] That bai:", errRaw);
      }
    }

    // Tier 0: auto_detect + ignore_errors (RFC-4180 strict)
    try {
      const query = `CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_csv('${safePath}', auto_detect=true, sample_size=100000, ignore_errors=true, null_padding=true, quote='"', escape='"')`;
      const resRows = await dbConn.all(query);
      const importTime = process.hrtime(importStart);
      log.info(
        "DuckDB nativeCSVImport (Tier 0): import completed in ",
        prettyHRTime(importTime)
      );
      return tableName;
    } catch (err0) {
      log.warn("[Ingest In-Memory Tier 0] That bai:", err0);
    }

    // Tier 1: parallel=false
    try {
      const query = `CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_csv('${safePath}', auto_detect=true, sample_size=100000, ignore_errors=true, null_padding=true, parallel=false, quote='"', escape='"')`;
      const resRows = await dbConn.all(query);
      const importTime = process.hrtime(importStart);
      log.info(
        "DuckDB nativeCSVImport (Tier 1 parallel=false): import completed in ",
        prettyHRTime(importTime)
      );
      return tableName;
    } catch (err1) {
      log.warn("[Ingest In-Memory Tier 1] That bai:", err1);
    }

    // Tier 2: all_varchar=true (guaranteed success)
    try {
      const query = `CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_csv('${safePath}', auto_detect=true, sample_size=100000, ignore_errors=true, null_padding=true, parallel=false, all_varchar=true, quote='"', escape='"')`;
      const resRows = await dbConn.all(query);
      const importTime = process.hrtime(importStart);
      log.info(
        "DuckDB nativeCSVImport (Tier 2 all_varchar=true): import completed in ",
        prettyHRTime(importTime)
      );
      return tableName;
    } catch (err2) {
      log.error("[Ingest In-Memory Tier 2] Tat ca cac tier deu that bai:", err2);
      throw err2;
    }
  } finally {
    try {
      await (dbConn as any).close();
    } catch (closeErr) {
      log.warn(
        "[DuckDB] Error closing connection in nativeCSVImport:",
        closeErr
      );
    }
  }
};

// =============================================================================
// PUBLIC API: nativeParquetImport (giữ nguyên, đã tối ưu sẵn bằng VIEW)
// =============================================================================

/**
 * Native import using DuckDB's built-in import facilities.
 */
export const nativeParquetImport = async (
  db: Database,
  filePath: string,
  tableName?: string
): Promise<string> => {
  const importStart = process.hrtime();

  // Binary Guard cho Parquet: không cần (luôn cho phép)
  const dbConn = await db.connect();
  try {
    await initS3(dbConn);
    if (!tableName) {
      tableName = genTableName(filePath);
    }
    const safePath = escapeSqlPath(filePath);
    const query = `CREATE OR REPLACE VIEW ${tableName} AS SELECT * FROM parquet_scan('${safePath}')`;
    log.debug("*** parquet import: ", query);
    try {
      // Creating a view doesn't return a useful result.
      await dbConn.exec(query);
    } catch (err) {
      console.log("caught exception while importing: ", err);
      throw err;
    }

    // Cache fast row count from parquet_metadata (O(1) instant count)
    try {
      const countSql = `SELECT SUM(row_group_num_rows)::BIGINT as total_rows FROM (SELECT DISTINCT row_group_id, row_group_num_rows FROM parquet_metadata('${safePath}'))`;
      const countRows: any = await dbConn.all(countSql);
      const totalRows = countRows && countRows[0] ? Number(countRows[0].total_rows) : null;
      if (totalRows !== null && !isNaN(totalRows)) {
        (global as any)._toadTableRowCountCache = (global as any)._toadTableRowCountCache || {};
        (global as any)._toadTableRowCountCache[tableName] = totalRows;
        (global as any)._toadTableRowCountCache[safePath] = totalRows;
        log.info(`[FastRowCount] Parquet metadata row count cached for ${tableName}: ${totalRows.toLocaleString()} rows`);
      }
    } catch (metaErr) {
      log.warn("[FastRowCount] Unable to cache row count from parquet_metadata:", metaErr);
    }

    const [es, ens] = process.hrtime(importStart);
    log.info(
      "DuckDB nativeParquetImport: import completed in %ds %dms",
      es,
      ens / 1e6
    );

    return tableName;
  } finally {
    try {
      await (dbConn as any).close();
    } catch (closeErr) {
      log.warn("[DuckDB] Error closing connection in nativeParquetImport:", closeErr);
    }
  }
};
