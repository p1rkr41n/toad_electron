/**
 * portableAppData.ts
 *
 * Quản lý thư mục Portable AppData cho Toad Viewer:
 *   - Tự động sinh/tái sử dụng thư mục toadAppData_[5_random_chars] ngay cạnh file .exe
 *   - Thẩm định (Validation) & Tự động phục hồi (Auto-Heal) file config.ini
 *   - Khởi tạo filters_preset.json với các mẫu bộ lọc DFIR
 *   - Dọn sạch thư mục temp/ khi thoát ứng dụng (với retry cho Windows file lock)
 *   - Startup Orphan Cleaner: Dọn rác mồ côi từ phiên trước
 */

import * as fs from "fs";
import * as path from "path";
import * as child_process from "child_process";
import log from "electron-log";

// =============================================================================
// INTERFACES & TYPES
// =============================================================================

export interface ToadConfig {
  general: {
    viewer: string;
    language: string;
    page_size: number;
    max_concurrent_files: number;
    max_concurrent_gb: number;
    auto_restore_last_directory: boolean;
    last_directory: string;
  };
  runtime: {
    engine: "utility" | "legacy" | "v8" | "tauri";
    auto_fallback?: boolean;
  };
  duckdb: {
    max_memory: string;
    threads: number;
    background_threads: number | "auto";
    add_raw_event: boolean;
    safe_mode_keywords: string[];
    safe_mode_parallel: boolean;
  };
  parquet: {
    compression: "zstd" | "snappy" | "gzip" | "none";
    row_group_size: number;
  };
  system: {
    temp_cleanup: boolean;
    binary_guard: boolean;
    uv_threadpool_size?: number | "auto";
    log_level: "info" | "trace" | "debug" | "warn" | "error";
  };
}

export interface PortableEnvironment {
  exeDir: string;
  appDataDir: string;
  tempDir: string;
  electronDataDir: string;
  logsDir: string;
  ledgerPath: string;
  config: ToadConfig;
}

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

export const DEFAULT_CONFIG: ToadConfig = {
  general: {
    viewer: "toad",
    language: "en",
    page_size: 1000,
    max_concurrent_files: 4,
    max_concurrent_gb: 1,
    auto_restore_last_directory: true,
    last_directory: "",
  },
  runtime: {
    engine: "utility",
    auto_fallback: true,
  },
  duckdb: {
    max_memory: "auto",
    threads: 0,
    background_threads: "auto",
    add_raw_event: false,
    safe_mode_keywords: [
      "hayabusa",
      "eventlog",
      "event_log",
      "security",
      "audit",
      "sysmon",
      "timeline",
      "dfir",
      "winlog",
      "firewall",
      "auth",
      "syslog",
    ],
    safe_mode_parallel: true,
  },
  parquet: {
    compression: "snappy",
    row_group_size: 25000,
  },
  system: {
    temp_cleanup: true,
    binary_guard: true,
    uv_threadpool_size: "auto",
    log_level: "info",
  },
};

// =============================================================================
// CONFIG.INI TEMPLATE (English configuration and guidelines)
// =============================================================================

export const DEFAULT_CONFIG_INI_TEXT = `# ==============================================================================
#                      TOAD VIEWER SYSTEM CONFIGURATION (CONFIG.INI)
# ==============================================================================
# This file is automatically validated and read before each file ingestion.
# You can modify values directly and save (Ctrl+S) at any time.

[general]
# Viewer mode: toad (default)
viewer = toad
# Interface language: en
language = en
# Default number of rows per page: 1000 (no upper limit enforced)
page_size = 1000
# Maximum number of files processed concurrently in background queue (default: 4)
max_concurrent_files = 4
# Maximum concurrent data processing budget in GB (default: 1, unit is GB)
max_concurrent_gb = 1
# Automatically restore last opened directory on startup (true/false)
auto_restore_last_directory = true
# Last opened directory path
last_directory = 

[runtime]
# Execution engine mode:
#   - utility : (RECOMMENDED) Isolated Electron utilityProcess for DuckDB & Parquet WAL
#   - legacy  : In-process legacy execution model
engine = utility

# Automatically fall back to legacy engine if utility process fails:
#   - true  : (RECOMMENDED) Preserves 100% backward compatibility
#   - false : Fail fast
auto_fallback = true

[duckdb]
# Maximum RAM allocated for DuckDB engine:
#   - auto : Automatically balances with available system RAM (recommended)
#   - Or: 512MB, 1GB, 2GB, 4GB, 8GB...
max_memory = auto

# Maximum CPU threads used for parallel processing:
#   - 0 : Utilize all available CPU cores/threads (default)
#   - Or: 1, 2, 4, 8...
threads = 0

# CPU threads dedicated for background file ingestion ('auto' or integer >= 1):
#   - auto : Automatically reserves 2 CPU cores for UI/query responsiveness (RECOMMENDED)
#   - Or: 1, 2, 4, 8...
background_threads = auto

# Automatically synthesize a consolidated [raw_event] column:
#   - false : (RECOMMENDED) Preserves lightning-fast columnar analytics
#   - true  : Concatenates all row values into a raw text string
add_raw_event = false

# Safe mode keywords (comma-separated, case-insensitive). Triggers safe all_varchar ingestion for large complex logs.
# Set to none or off or empty to disable safe mode heuristics.
# Tu khoa che do an toan (ngan cach bang dau phay). Dat thanh none hoac off de tat.
safe_mode_keywords = hayabusa, eventlog, event_log, security, audit, sysmon, timeline, dfir, winlog, firewall, auth, syslog

# Multi-threaded ingestion for safe mode (true = fast parallel scan, false = single-threaded fallback)
# Doc da luong cho che do an toan (true = quet da luong nhanh, false = don luong)
safe_mode_parallel = true

[parquet]
# Temporary Parquet cache compression algorithm:
#   - snappy : (RECOMMENDED) Fastest compression, 4x-5x faster ingestion
#   - zstd   : Highest compression ratio
#   - gzip   : Standard gzip compression
#   - none   : Uncompressed
compression = snappy

# Row group size (rows per data chunk):
#   - Enables block skipping during query filters. Default: 25000
row_group_size = 25000

[system]
# Automatically clean up temporary Parquet files on exit:
#   - true  : Clean temp folder on exit (RECOMMENDED)
#   - false : Keep Parquet files for persistent caching
temp_cleanup = true

# Protect against accidental binary file ingestion (Binary Guard):
#   - true  : Scans first 8KB, rejects binary files (RECOMMENDED)
#   - false : Skip binary check
binary_guard = true

# Libuv threadpool size for Node.js async operations (auto or integer 8-128):
#   - auto : Automatically calculates host CPU cores * 2 (clamped between 8 and 128)
#   - Or: 8, 16, 32, 64, 128
uv_threadpool_size = auto

# Logging level across processes:
#   - trace : Deep query, Arrow IPC, scanner profiling & diagnostics
#   - debug : Detailed operational debugging
#   - info  : Standard operational messages (DEFAULT)
#   - warn  : Warnings only
#   - error : Errors only
log_level = info
`;

// =============================================================================
// FILTERS PRESET TEMPLATE
// =============================================================================

const DEFAULT_PRESETS_JSON = {
  version: "1.0",
  presets: [
    {
      name: "Hayabusa Critical & High",
      description: "Filter security events with Critical and High severity",
      filter: {
        op: "OR",
        clauses: [
          { field: "Level", op: "EQ", value: "critical" },
          { field: "Level", op: "EQ", value: "high" },
        ],
      },
    },
    {
      name: "Suspicious PowerShell Execution",
      description: "Filter powershell processes with encoded command or execution bypass flags",
      filter: {
        op: "AND",
        clauses: [
          { field: "Image", op: "CONTAINS", value: "powershell" },
          {
            op: "OR",
            clauses: [
              { field: "CommandLine", op: "CONTAINS", value: "-enc" },
              { field: "CommandLine", op: "CONTAINS", value: "bypass" },
            ],
          },
        ],
      },
    },
  ],
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Sinh chuỗi ngẫu nhiên 5 ký tự an toàn (không gây nhầm lẫn thị giác)
 * Loại bỏ: 0/O, 1/l/I
 */
export function genRandomSuffix(len = 5): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let result = "";
  for (let i = 0; i < len; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Xác định chính xác thư mục chứa file .exe thật sự
 * - Portable single-file: process.env.PORTABLE_EXECUTABLE_DIR
 * - Unpacked folder: path.dirname(process.execPath)
 */
export function getExecutableDir(): string {
  // 1. Kiểm tra biến môi trường do NSIS Portable Wrapper cung cấp
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDir && fs.existsSync(portableDir)) {
    log.info(`[PortableAppData] Phat hien PORTABLE_EXECUTABLE_DIR: ${portableDir}`);
    return portableDir;
  }

  const portableFile = process.env.PORTABLE_EXECUTABLE_FILE;
  if (portableFile) {
    const dirFromFile = path.dirname(portableFile);
    if (fs.existsSync(dirFromFile)) {
      log.info(`[PortableAppData] Phat hien tu PORTABLE_EXECUTABLE_FILE: ${dirFromFile}`);
      return dirFromFile;
    }
  }

  // 2. Chế độ chạy thư mục giải nén (Unpacked Folder)
  const execDir = path.dirname(process.execPath);
  log.info(`[PortableAppData] Su dung dirname(process.execPath): ${execDir}`);
  return execDir;
}

// =============================================================================
// INI PARSER & STRINGIFIER (Không phụ thuộc thư viện ngoài)
// =============================================================================

type IniData = Record<string, Record<string, string>>;

/**
 * Parse nội dung file INI thành object { section: { key: value } }
 */
export function parseIni(content: string): IniData {
  const result: IniData = {};
  let currentSection = "__root__";
  result[currentSection] = {};

  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Bỏ qua dòng trống hoặc comment
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;

    // Phát hiện section [name]
    if (line.startsWith("[") && line.endsWith("]")) {
      currentSection = line.substring(1, line.length - 1).trim().toLowerCase();
      if (!result[currentSection]) result[currentSection] = {};
      continue;
    }

    // Phát hiện key = value
    const eqIdx = line.indexOf("=");
    if (eqIdx !== -1) {
      const key = line.substring(0, eqIdx).trim().toLowerCase();
      const val = line.substring(eqIdx + 1).trim();
      result[currentSection][key] = val;
    }
  }

  return result;
}

/**
 * Stringify ToadConfig thành nội dung INI có comment hướng dẫn
 */
export function stringifyConfig(cfg: ToadConfig): string {
  const safeKeywords = (cfg.duckdb?.safe_mode_keywords || []).join(", ");
  const safeParallel = cfg.duckdb?.safe_mode_parallel ?? true;

  return `# ==============================================================================
#                      TOAD VIEWER SYSTEM CONFIGURATION (CONFIG.INI)
# ==============================================================================

[general]
viewer = ${cfg.general.viewer}
language = ${cfg.general.language}
page_size = ${cfg.general.page_size}
max_concurrent_files = ${cfg.general.max_concurrent_files}
max_concurrent_gb = ${cfg.general.max_concurrent_gb}
auto_restore_last_directory = ${cfg.general.auto_restore_last_directory}
last_directory = ${cfg.general.last_directory}

[runtime]
engine = ${cfg.runtime?.engine ?? "utility"}
auto_fallback = ${cfg.runtime?.auto_fallback ?? true}

[duckdb]
max_memory = ${cfg.duckdb.max_memory}
threads = ${cfg.duckdb.threads}
background_threads = ${cfg.duckdb.background_threads}
add_raw_event = ${cfg.duckdb.add_raw_event}
safe_mode_keywords = ${safeKeywords}
safe_mode_parallel = ${safeParallel}

[parquet]
compression = ${cfg.parquet.compression}
row_group_size = ${cfg.parquet.row_group_size}

[system]
temp_cleanup = ${cfg.system.temp_cleanup}
binary_guard = ${cfg.system.binary_guard}
uv_threadpool_size = ${cfg.system.uv_threadpool_size ?? "auto"}
log_level = ${cfg.system.log_level ?? "info"}
`;
}

/**
 * Tự động vá nội dung file INI: bảo toàn tối đa các dòng comment, section tùy biến của người dùng
 * và chỉ chèn/bổ sung các section/key còn thiếu.
 */
export function autoHealIniText(rawContent: string, cfg: ToadConfig): string {
  if (!rawContent || !rawContent.trim()) {
    return stringifyConfig(cfg);
  }

  const lines = rawContent.split(/\r?\n/);
  const sectionLines: { [section: string]: { start: number; end: number; keys: Record<string, number> } } = {};
  let currentSection = "__root__";
  sectionLines[currentSection] = { start: 0, end: 0, keys: {} };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      if (currentSection && sectionLines[currentSection]) {
        sectionLines[currentSection].end = i;
      }
      currentSection = trimmed.substring(1, trimmed.length - 1).trim().toLowerCase();
      if (!sectionLines[currentSection]) {
        sectionLines[currentSection] = { start: i, end: lines.length, keys: {} };
      }
      continue;
    }
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1 && !trimmed.startsWith("#") && !trimmed.startsWith(";")) {
      const key = trimmed.substring(0, eqIdx).trim().toLowerCase();
      if (currentSection && sectionLines[currentSection]) {
        sectionLines[currentSection].keys[key] = i;
      }
    }
  }
  if (currentSection && sectionLines[currentSection]) {
    sectionLines[currentSection].end = lines.length;
  }

  const requiredKeys: Record<string, Record<string, string>> = {
    duckdb: {
      max_memory: String(cfg.duckdb.max_memory),
      threads: String(cfg.duckdb.threads),
      background_threads: String(cfg.duckdb.background_threads),
      add_raw_event: String(cfg.duckdb.add_raw_event),
      safe_mode_keywords: (cfg.duckdb.safe_mode_keywords || []).join(", "),
      safe_mode_parallel: String(cfg.duckdb.safe_mode_parallel ?? true),
    },
    general: {
      viewer: cfg.general.viewer,
      language: cfg.general.language,
      page_size: String(cfg.general.page_size),
      max_concurrent_files: String(cfg.general.max_concurrent_files),
      max_concurrent_gb: String(cfg.general.max_concurrent_gb),
      auto_restore_last_directory: String(cfg.general.auto_restore_last_directory),
      last_directory: cfg.general.last_directory,
    },
    runtime: {
      engine: cfg.runtime?.engine ?? "utility",
      auto_fallback: String(cfg.runtime?.auto_fallback ?? true),
    },
    parquet: {
      compression: cfg.parquet.compression,
      row_group_size: String(cfg.parquet.row_group_size),
    },
    system: {
      temp_cleanup: String(cfg.system.temp_cleanup),
      binary_guard: String(cfg.system.binary_guard),
      uv_threadpool_size: String(cfg.system.uv_threadpool_size ?? "auto"),
      log_level: String(cfg.system.log_level ?? "info"),
    },
  };

  const modifiedLines = [...lines];
  const sectionsInReverse = Object.keys(sectionLines).sort(
    (a, b) => (sectionLines[b]?.start ?? 0) - (sectionLines[a]?.start ?? 0)
  );

  for (const sec of sectionsInReverse) {
    if (!requiredKeys[sec]) continue;
    const secInfo = sectionLines[sec];
    const missingInSec: string[] = [];

    for (const [k, v] of Object.entries(requiredKeys[sec])) {
      if (secInfo.keys[k] === undefined) {
        missingInSec.push(`${k} = ${v}`);
      } else if (k === "safe_mode_parallel") {
        const lineIdx = secInfo.keys[k];
        if (!/^\s*safe_mode_parallel\s*=\s*(true|false)\s*$/i.test(modifiedLines[lineIdx])) {
          modifiedLines[lineIdx] = `safe_mode_parallel = ${v}`;
        }
      } else if (k === "log_level") {
        const lineIdx = secInfo.keys[k];
        if (!/^\s*log_level\s*=\s*(info|trace|debug|warn|error)\s*$/i.test(modifiedLines[lineIdx])) {
          modifiedLines[lineIdx] = `log_level = ${v}`;
        }
      }
    }

    if (missingInSec.length > 0) {
      const insertIdx = secInfo.end;
      modifiedLines.splice(insertIdx, 0, ...missingInSec);
    }
  }

  for (const [sec, keysObj] of Object.entries(requiredKeys)) {
    if (!sectionLines[sec]) {
      const newSecLines = [`\n[${sec}]`];
      for (const [k, v] of Object.entries(keysObj)) {
        newSecLines.push(`${k} = ${v}`);
      }
      modifiedLines.push(...newSecLines);
    }
  }

  return modifiedLines.join("\n");
}

// =============================================================================
// PORTABLE APPDATA DIRECTORY MANAGEMENT
// =============================================================================

/**
 * Quét tìm hoặc tạo mới thư mục toadAppData_[5_chars] cạnh file exe
 */
export function ensurePortableAppDataDir(exeDir: string): string {
  const directAppData = path.join(exeDir, "toadAppData");
  try {
    if (fs.existsSync(directAppData) && fs.statSync(directAppData).isDirectory()) {
      log.info(`[PortableAppData] Using direct toadAppData directory: ${directAppData}`);
      return directAppData;
    }
  } catch (err) {
    log.warn("[PortableAppData] Error checking direct toadAppData directory:", err);
  }

  try {
    const entries = fs.readdirSync(exeDir, { withFileTypes: true });
    for (const ent of entries) {
      if (
        ent.isDirectory() &&
        /^toadAppData_[a-z0-9]{5}$/i.test(ent.name)
      ) {
        const found = path.join(exeDir, ent.name);
        log.info(`[PortableAppData] Reusing existing directory: ${found}`);
        return found;
      }
    }
  } catch (err) {
    log.warn("[PortableAppData] Error scanning executable directory:", err);
  }

  const suffix = genRandomSuffix(5);
  const newDirName = `toadAppData_${suffix}`;
  const fullPath = path.join(exeDir, newDirName);
  fs.mkdirSync(fullPath, { recursive: true });
  log.info(`[PortableAppData] Created new directory: ${fullPath}`);
  return fullPath;
}

// =============================================================================
// CONFIG VALIDATION & AUTO-HEAL
// =============================================================================

const VALID_COMPRESSIONS = ["zstd", "snappy", "gzip", "none"];

export function validateAndEnsureConfig(configPath: string): ToadConfig {
  if (!fs.existsSync(configPath)) {
    log.info("[ConfigValidation] config.ini not found; creating from default template");
    try {
      fs.writeFileSync(configPath, DEFAULT_CONFIG_INI_TEXT, "utf8");
    } catch (err) {
      log.error("[ConfigValidation] Failed to write config.ini:", err);
    }
    return { ...DEFAULT_CONFIG };
  }

  let parsed: IniData;
  try {
    const rawContent = fs.readFileSync(configPath, "utf8");
    parsed = parseIni(rawContent);
  } catch (err) {
    log.warn(
      "[ConfigValidation] Corrupted config.ini syntax; backing up and restoring defaults:",
      err
    );
    try {
      const backupName = `${configPath}.corrupt_${Date.now()}`;
      fs.renameSync(configPath, backupName);
      fs.writeFileSync(configPath, DEFAULT_CONFIG_INI_TEXT, "utf8");
      log.info(`[ConfigValidation] Backed up corrupted config.ini to: ${backupName}`);
    } catch (backupErr) {
      log.error("[ConfigValidation] Failed to back up corrupted config.ini:", backupErr);
    }
    return { ...DEFAULT_CONFIG };
  }

  // Cấp 3 & 4: Schema Validation + Value Range Check + Auto-Heal
  let needRewrite = false;

  // [general]
  const viewer =
    parsed.general?.viewer && ["toad", "tad"].includes(parsed.general.viewer)
      ? parsed.general.viewer
      : (() => {
          needRewrite = true;
          return DEFAULT_CONFIG.general.viewer;
        })();

  const language =
    parsed.general?.language && ["vi", "en"].includes(parsed.general.language)
      ? parsed.general.language
      : (() => {
          needRewrite = true;
          return DEFAULT_CONFIG.general.language;
        })();

  let page_size = Number(
    parsed.general?.page_size ?? DEFAULT_CONFIG.general.page_size
  );
  if (isNaN(page_size) || page_size < 1) {
    page_size = DEFAULT_CONFIG.general.page_size;
    needRewrite = true;
  }

  let max_concurrent_files = Number(
    parsed.general?.max_concurrent_files ??
    parsed.queue?.max_concurrent_files ??
    DEFAULT_CONFIG.general.max_concurrent_files
  );
  if (isNaN(max_concurrent_files) || max_concurrent_files < 1) {
    max_concurrent_files = DEFAULT_CONFIG.general.max_concurrent_files;
    needRewrite = true;
  }

  let max_concurrent_gb = Number(
    parsed.general?.max_concurrent_gb ??
    parsed.queue?.max_concurrent_gb ??
    DEFAULT_CONFIG.general.max_concurrent_gb
  );
  if (isNaN(max_concurrent_gb) || max_concurrent_gb <= 0) {
    max_concurrent_gb = DEFAULT_CONFIG.general.max_concurrent_gb;
    needRewrite = true;
  }

  const auto_restore_last_directory =
    parsed.general?.auto_restore_last_directory !== undefined
      ? String(parsed.general.auto_restore_last_directory).toLowerCase() === "true"
      : (() => {
          needRewrite = true;
          return DEFAULT_CONFIG.general.auto_restore_last_directory;
        })();

  const last_directory =
    parsed.general?.last_directory !== undefined
      ? String(parsed.general.last_directory).trim()
      : (() => {
          needRewrite = true;
          return DEFAULT_CONFIG.general.last_directory;
        })();

  // [runtime]
  const VALID_ENGINES = ["utility", "legacy", "v8", "tauri"];
  const rawEngine = (parsed.runtime?.engine || "").trim().toLowerCase();
  const engine = VALID_ENGINES.includes(rawEngine)
    ? (rawEngine as ToadConfig["runtime"]["engine"])
    : (() => {
        needRewrite = true;
        return DEFAULT_CONFIG.runtime.engine;
      })();

  const auto_fallback =
    parsed.runtime?.auto_fallback !== undefined
      ? String(parsed.runtime.auto_fallback).toLowerCase() === "true"
      : (() => {
          needRewrite = true;
          return DEFAULT_CONFIG.runtime.auto_fallback ?? true;
        })();

  // [duckdb]
  let max_memory =
    parsed.duckdb?.max_memory || DEFAULT_CONFIG.duckdb.max_memory;
  if (max_memory !== "auto" && !/^\d+(MB|GB|TB)$/i.test(max_memory)) {
    max_memory = DEFAULT_CONFIG.duckdb.max_memory;
    needRewrite = true;
  }

  let threads = Number(
    parsed.duckdb?.threads ?? DEFAULT_CONFIG.duckdb.threads
  );
  if (isNaN(threads) || threads < 0) {
    threads = DEFAULT_CONFIG.duckdb.threads;
    needRewrite = true;
  }

  let background_threads: number | "auto" = DEFAULT_CONFIG.duckdb.background_threads;
  const rawBgThreads = parsed.duckdb?.background_threads;
  if (rawBgThreads !== undefined && rawBgThreads !== null) {
    if (String(rawBgThreads).trim().toLowerCase() === "auto") {
      background_threads = "auto";
    } else {
      const parsedNum = Number(rawBgThreads);
      if (!isNaN(parsedNum) && parsedNum > 0) {
        background_threads = Math.floor(parsedNum);
      } else {
        background_threads = "auto";
        needRewrite = true;
      }
    }
  } else {
    background_threads = "auto";
    needRewrite = true;
  }

  const add_raw_event =
    parsed.duckdb?.add_raw_event !== undefined
      ? String(parsed.duckdb.add_raw_event).toLowerCase() === "true"
      : DEFAULT_CONFIG.duckdb.add_raw_event;

  // safe_mode_keywords
  let safe_mode_keywords: string[];
  if (parsed.duckdb?.safe_mode_keywords !== undefined) {
    const rawKw = String(parsed.duckdb.safe_mode_keywords).trim();
    const rawKwLower = rawKw.toLowerCase();
    if (rawKwLower === "" || rawKwLower === "none" || rawKwLower === "off") {
      safe_mode_keywords = [];
    } else {
      safe_mode_keywords = rawKw
        .split(",")
        .map((k) => k.trim().toLowerCase())
        .filter((k) => k.length > 0 && k !== "none" && k !== "off");
    }
  } else {
    safe_mode_keywords = [...DEFAULT_CONFIG.duckdb.safe_mode_keywords];
    needRewrite = true;
  }

  // safe_mode_parallel
  let safe_mode_parallel: boolean;
  if (parsed.duckdb?.safe_mode_parallel !== undefined) {
    const rawParallel = String(parsed.duckdb.safe_mode_parallel).trim().toLowerCase();
    if (rawParallel === "true") {
      safe_mode_parallel = true;
    } else if (rawParallel === "false") {
      safe_mode_parallel = false;
    } else {
      safe_mode_parallel = DEFAULT_CONFIG.duckdb.safe_mode_parallel;
      needRewrite = true;
    }
  } else {
    safe_mode_parallel = DEFAULT_CONFIG.duckdb.safe_mode_parallel;
    needRewrite = true;
  }

  // [parquet]
  let compression = (
    parsed.parquet?.compression || DEFAULT_CONFIG.parquet.compression
  ).toLowerCase();
  if (!VALID_COMPRESSIONS.includes(compression)) {
    compression = DEFAULT_CONFIG.parquet.compression;
    needRewrite = true;
  }

  let row_group_size = Number(
    parsed.parquet?.row_group_size || DEFAULT_CONFIG.parquet.row_group_size
  );
  if (isNaN(row_group_size) || row_group_size < 1000 || row_group_size > 10000000) {
    row_group_size = DEFAULT_CONFIG.parquet.row_group_size;
    needRewrite = true;
  }

  // [system]
  const temp_cleanup =
    parsed.system?.temp_cleanup !== undefined
      ? String(parsed.system.temp_cleanup).toLowerCase() === "true"
      : DEFAULT_CONFIG.system.temp_cleanup;

  const binary_guard =
    parsed.system?.binary_guard !== undefined
      ? String(parsed.system.binary_guard).toLowerCase() === "true"
      : DEFAULT_CONFIG.system.binary_guard;

  let uv_threadpool_size: number | "auto" =
    DEFAULT_CONFIG.system.uv_threadpool_size ?? "auto";
  const rawUvPool = parsed.system?.uv_threadpool_size;
  if (rawUvPool !== undefined && rawUvPool !== null) {
    if (String(rawUvPool).trim().toLowerCase() === "auto") {
      uv_threadpool_size = "auto";
    } else {
      const parsedNum = Number(rawUvPool);
      if (!isNaN(parsedNum) && parsedNum >= 4 && parsedNum <= 128) {
        uv_threadpool_size = Math.floor(parsedNum);
      } else {
        uv_threadpool_size = "auto";
        needRewrite = true;
      }
    }
  } else {
    uv_threadpool_size = "auto";
    needRewrite = true;
  }

  const VALID_LOG_LEVELS = ["info", "trace", "debug", "warn", "error"];
  let log_level: ToadConfig["system"]["log_level"] = DEFAULT_CONFIG.system.log_level;
  const rawLogLevel = parsed.system?.log_level ? String(parsed.system.log_level).trim().toLowerCase() : "";
  if (VALID_LOG_LEVELS.includes(rawLogLevel)) {
    log_level = rawLogLevel as ToadConfig["system"]["log_level"];
  } else {
    needRewrite = true;
  }

  // Kiểm tra xem có thiếu section nào không
  if (!parsed.general || !parsed.runtime || !parsed.duckdb || !parsed.parquet || !parsed.system) {
    needRewrite = true;
  }

  const validatedConfig: ToadConfig = {
    general: {
      viewer,
      language,
      page_size,
      max_concurrent_files,
      max_concurrent_gb,
      auto_restore_last_directory,
      last_directory,
    },
    runtime: { engine, auto_fallback },
    duckdb: {
      max_memory,
      threads,
      background_threads,
      add_raw_event,
      safe_mode_keywords,
      safe_mode_parallel,
    },
    parquet: {
      compression: compression as ToadConfig["parquet"]["compression"],
      row_group_size,
    },
    system: { temp_cleanup, binary_guard, uv_threadpool_size, log_level },
  };

  // Auto-Heal: rewrite config if missing keys or invalid values were repaired
  if (needRewrite) {
    log.info("[ConfigValidation] Missing or invalid keys detected; auto-healing config.ini");
    try {
      let healedContent: string | null = null;
      try {
        if (fs.existsSync(configPath)) {
          const currentText = fs.readFileSync(configPath, "utf8");
          if (currentText.trim().length > 0) {
            healedContent = autoHealIniText(currentText, validatedConfig);
          }
        }
      } catch (patchErr) {
        log.warn("[ConfigValidation] In-place INI patch failed; falling back to stringifyConfig:", patchErr);
      }

      if (!healedContent) {
        healedContent = stringifyConfig(validatedConfig);
      }

      fs.writeFileSync(configPath, healedContent, "utf8");
    } catch (err) {
      log.warn("[ConfigValidation] Failed to write healed config.ini:", err);
    }
  }

  log.info("[ConfigValidation] Configuration validated successfully:", validatedConfig);
  return validatedConfig;
}

// =============================================================================
// LOG LEVEL RESOLUTION & ACTIVATION
// =============================================================================

/**
 * Resolves the effective log level across CLI arguments, environment variable, and config.ini.
 * Strict priority order:
 *   1. --trace in cliArgv -> "trace"
 *   2. envLogLevel (or process.env.TOAD_LOG_LEVEL) if valid
 *   3. iniLogLevel (or config.system.log_level) if valid
 *   4. fallback -> "info"
 */
export function resolveEffectiveLogLevel(
  cliArgv?: string[],
  envLogLevel?: string,
  iniLogLevel?: string
): "info" | "trace" | "debug" | "warn" | "error" {
  const argv =
    cliArgv !== undefined
      ? cliArgv
      : typeof process !== "undefined" && Array.isArray(process.argv)
      ? process.argv
      : [];
  if (Array.isArray(argv) && argv.includes("--trace")) {
    return "trace";
  }

  const validLevels: Array<"info" | "trace" | "debug" | "warn" | "error"> = [
    "trace",
    "debug",
    "info",
    "warn",
    "error",
  ];

  const env =
    envLogLevel !== undefined
      ? envLogLevel
      : typeof process !== "undefined"
      ? process.env.TOAD_LOG_LEVEL
      : undefined;
  if (env && typeof env === "string") {
    const normalized = env.trim().toLowerCase();
    if (validLevels.includes(normalized as any)) {
      return normalized as "info" | "trace" | "debug" | "warn" | "error";
    }
  }

  if (iniLogLevel && typeof iniLogLevel === "string") {
    const normalized = iniLogLevel.trim().toLowerCase();
    if (validLevels.includes(normalized as any)) {
      return normalized as "info" | "trace" | "debug" | "warn" | "error";
    }
  }

  return "info";
}

// =============================================================================
// FILTERS PRESET VALIDATION
// =============================================================================

/**
 * Ensure filters_preset.json exists and conforms to expected schema.
 */
export function validateAndEnsurePresets(presetsPath: string): void {
  if (!fs.existsSync(presetsPath)) {
    log.info("[PresetsValidation] Creating default filters_preset.json");
    try {
      fs.writeFileSync(
        presetsPath,
        JSON.stringify(DEFAULT_PRESETS_JSON, null, 2),
        "utf8"
      );
    } catch (err) {
      log.warn("[PresetsValidation] Failed to create filters_preset.json:", err);
    }
    return;
  }

  // Validate JSON syntax
  try {
    const raw = fs.readFileSync(presetsPath, "utf8");
    const parsed = JSON.parse(raw);

    if (!parsed.version || !Array.isArray(parsed.presets)) {
      throw new Error("Invalid filters_preset.json schema");
    }
  } catch (err) {
    log.warn(
      "[PresetsValidation] Corrupted filters_preset.json detected; backing up and restoring defaults:",
      err
    );
    try {
      const backupName = `${presetsPath}.corrupt_${Date.now()}`;
      fs.renameSync(presetsPath, backupName);
      fs.writeFileSync(
        presetsPath,
        JSON.stringify(DEFAULT_PRESETS_JSON, null, 2),
        "utf8"
      );
      log.info("[PresetsValidation] Backed up and restored filters_preset.json");
    } catch (backupErr) {
      log.warn("[PresetsValidation] Failed to back up corrupted presets:", backupErr);
    }
  }
}

// =============================================================================
// TOAD RUST CORE BINARY DISCOVERY
// =============================================================================

export function findToadCoreBinary(): string | null {
  const exeDir = getExecutableDir();
  const candidates = [
    // Next to executable in portable mode
    path.join(exeDir, "toad-core.exe"),
    path.join(exeDir, "bin", "toad-core.exe"),
    // In resources directory (packaged Electron app)
    (process as any).resourcesPath
      ? path.join((process as any).resourcesPath, "bin", "toad-core.exe")
      : null,
    // Development directories
    path.join(__dirname, "../bin/toad-core.exe"),
    path.join(__dirname, "../../toad-core-rust/target/release/toad-core.exe"),
    path.join(__dirname, "../../../toad-core-rust/target/release/toad-core.exe"),
  ];

  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      return c;
    }
  }
  return null;
}

// =============================================================================
// TEMP DIRECTORY CLEANUP (Windows EBUSY Retry & Ledger/WAL Preservation)
// =============================================================================

export function cleanTempDir(tempDir: string): void {
  try {
    if (!fs.existsSync(tempDir)) return;

    const items = fs.readdirSync(tempDir);
    let cleanedCount = 0;
    let failedCount = 0;

    for (const item of items) {
      if (
        item === "toad_ledger.parquet" ||
        item.endsWith("_ledger.parquet") ||
        item.endsWith(".wal.jsonl")
      ) {
        continue;
      }
      const fullPath = path.join(tempDir, item);
      let deleted = false;

      for (let attempt = 0; attempt < 3 && !deleted; attempt++) {
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            fs.rmSync(fullPath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(fullPath);
          }
          deleted = true;
          cleanedCount++;
        } catch (err: any) {
          if (attempt < 2 && (err.code === "EBUSY" || err.code === "EPERM")) {
            const waitEnd = Date.now() + 50;
            while (Date.now() < waitEnd) {
              // busy wait
            }
          } else if (attempt >= 2) {
            failedCount++;
            log.warn(
              `[TempCleaner] Failed to remove: ${item} (${err.code || err.message})`
            );
          }
        }
      }
    }

    if (cleanedCount > 0 || failedCount > 0) {
      log.info(
        `[TempCleaner] Temp cleanup complete: ${cleanedCount} removed, ${failedCount} failed`
      );
    }
  } catch (err) {
    log.warn("[TempCleaner] Unexpected error during temp cleanup:", err);
  }
}

export function updateLastOpenedDirectory(appDataDir: string, dirPath: string): void {
  try {
    if (!dirPath) return;
    let targetDir = dirPath;
    if (fs.existsSync(dirPath)) {
      const stat = fs.statSync(dirPath);
      if (!stat.isDirectory()) {
        targetDir = path.dirname(dirPath);
      }
    }
    const configPath = path.join(appDataDir, "config.ini");
    if (!fs.existsSync(configPath)) return;

    const env = (global as any).toadPortableEnv;
    if (env && env.config && env.config.general) {
      env.config.general.last_directory = targetDir;
    }

    let content = fs.readFileSync(configPath, "utf8");
    if (/^\s*last_directory\s*=/m.test(content)) {
      content = content.replace(/^\s*last_directory\s*=.*$/m, `last_directory = ${targetDir}`);
    } else {
      content = content.replace(/\[general\]/i, `[general]\nlast_directory = ${targetDir}`);
    }
    fs.writeFileSync(configPath, content, "utf8");
    log.info(`[PortableAppData] Updated last_directory in config.ini: ${targetDir}`);
  } catch (err) {
    log.warn("[PortableAppData] Failed to update last_directory:", err);
  }
}

export const setLastOpenedDirectory = updateLastOpenedDirectory;

/**
 * Purges orphan partial temporary files (*.tmp, *.tmp_*.parquet) left behind by interrupted sessions.
 * Preserves valid Parquet caches (*_cached_*.parquet) and state ledgers (*_ledger.parquet, *.wal.jsonl).
 */
export function purgeOrphanTempFiles(tempDir: string): number {
  let purgedCount = 0;
  try {
    if (!fs.existsSync(tempDir)) return 0;

    const walkAndPurge = (dir: string): void => {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (
          entry === "toad_ledger.parquet" ||
          entry.endsWith("_ledger.parquet") ||
          entry.endsWith(".wal.jsonl")
        ) {
          continue;
        }
        const fullPath = path.join(dir, entry);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            walkAndPurge(fullPath);
            try {
              if (fs.readdirSync(fullPath).length === 0) {
                fs.rmdirSync(fullPath);
              }
            } catch {}
          } else {
            const isOrphan = entry.endsWith(".tmp") || entry.includes(".tmp_");
            if (isOrphan) {
              fs.unlinkSync(fullPath);
              purgedCount++;
              log.info(`[OrphanPurge] Purged orphan temp file: ${entry}`);
            }
          }
        } catch (err: any) {
          log.warn(`[OrphanPurge] Could not remove orphan file ${entry}:`, err?.message);
        }
      }
    };

    walkAndPurge(tempDir);
  } catch (err: any) {
    log.warn("[OrphanPurge] Error scanning temp directory:", err?.message);
  }
  return purgedCount;
}

// =============================================================================
// ENTRYPOINT: Portable Environment Bootstrap
// =============================================================================

export function initPortableEnvironment(): PortableEnvironment {
  log.info("=== [PortableAppData] Initializing Portable Environment ===");

  const exeDir = getExecutableDir();
  log.info(`[PortableAppData] Executable dir: ${exeDir}`);

  const appDataDir = ensurePortableAppDataDir(exeDir);
  log.info(`[PortableAppData] AppData dir: ${appDataDir}`);

  const tempDir = path.join(appDataDir, "temp");
  const electronDataDir = path.join(appDataDir, "electron_data");
  const logsDir = path.join(appDataDir, "logs");
  const ledgerPath = path.join(appDataDir, "toad_ledger.parquet");

  fs.mkdirSync(tempDir, { recursive: true });
  fs.mkdirSync(electronDataDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });

  const configPath = path.join(appDataDir, "config.ini");
  const presetsPath = path.join(appDataDir, "filters_preset.json");

  const config = validateAndEnsureConfig(configPath);
  validateAndEnsurePresets(presetsPath);

  const orphanPurged = purgeOrphanTempFiles(tempDir);
  if (orphanPurged > 0) {
    log.info(`[PortableAppData] Startup Orphan Cleaner removed ${orphanPurged} incomplete temp files`);
  }

  if (config.system.temp_cleanup) {
    log.info("[PortableAppData] temp_cleanup = true -> Cleaning residual temp cache...");
    cleanTempDir(tempDir);
  } else {
    log.info("[PortableAppData] temp_cleanup = false -> Preserving Parquet cache in temp/");
  }

  // Export environment variables for IPC and child processes
  process.env.TOAD_APP_DATA_DIR = appDataDir;
  process.env.TOAD_SAFE_KEYWORDS = config.duckdb.safe_mode_keywords.join(",");
  process.env.TOAD_SAFE_PARALLEL = String(config.duckdb.safe_mode_parallel);
  const effectiveLogLevel = resolveEffectiveLogLevel(
    process.argv,
    process.env.TOAD_LOG_LEVEL,
    config.system.log_level
  );
  process.env.TOAD_LOG_LEVEL = effectiveLogLevel;

  const envResult: PortableEnvironment = {
    exeDir,
    appDataDir,
    tempDir,
    electronDataDir,
    logsDir,
    ledgerPath,
    config,
  };
  (global as any).toadPortableEnv = envResult;

  log.info("=== [PortableAppData] Initialization complete ===");
  log.info(`    AppData    : ${appDataDir}`);
  log.info(`    Temp       : ${tempDir}`);
  log.info(`    Config     : ${configPath}`);
  log.info(`    Presets    : ${presetsPath}`);
  log.info(`    Ledger     : ${ledgerPath}`);
  log.info(`    Electron   : ${electronDataDir}`);
  log.info(`    Logs       : ${logsDir}`);
  log.info(`    Libuv Pool : ${process.env.UV_THREADPOOL_SIZE}`);
  log.info(`    Safe Keys  : ${process.env.TOAD_SAFE_KEYWORDS}`);
  log.info(`    Safe Paral : ${process.env.TOAD_SAFE_PARALLEL}`);
  log.info(`    Log Level  : ${effectiveLogLevel} (ini: ${config.system.log_level})`);

  return envResult;
}
