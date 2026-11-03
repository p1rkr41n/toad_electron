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
  };
  parquet: {
    compression: "zstd" | "snappy" | "gzip" | "none";
    row_group_size: number;
  };
  system: {
    temp_cleanup: boolean;
    binary_guard: boolean;
    uv_threadpool_size?: number | "auto";
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
  },
  parquet: {
    compression: "snappy",
    row_group_size: 25000,
  },
  system: {
    temp_cleanup: true,
    binary_guard: true,
    uv_threadpool_size: "auto",
  },
};

// =============================================================================
// CONFIG.INI TEMPLATE (English configuration and guidelines)
// =============================================================================

const DEFAULT_CONFIG_INI_TEXT = `# ==============================================================================
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
function parseIni(content: string): IniData {
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
function stringifyConfig(cfg: ToadConfig): string {
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

[parquet]
compression = ${cfg.parquet.compression}
row_group_size = ${cfg.parquet.row_group_size}

[system]
temp_cleanup = ${cfg.system.temp_cleanup}
binary_guard = ${cfg.system.binary_guard}
uv_threadpool_size = ${cfg.system.uv_threadpool_size ?? "auto"}
`;
}

// =============================================================================
// PORTABLE APPDATA DIRECTORY MANAGEMENT
// =============================================================================

/**
 * Quét tìm hoặc tạo mới thư mục toadAppData_[5_chars] cạnh file exe
 */
export function ensurePortableAppDataDir(exeDir: string): string {
  // 1. Quét tìm thư mục toadAppData_* hiện có
  try {
    const entries = fs.readdirSync(exeDir, { withFileTypes: true });
    for (const ent of entries) {
      if (
        ent.isDirectory() &&
        /^toadAppData_[a-z0-9]{5}$/i.test(ent.name)
      ) {
        const found = path.join(exeDir, ent.name);
        log.info(`[PortableAppData] Tai su dung thu muc co san: ${found}`);
        return found;
      }
    }
  } catch (err) {
    log.warn("[PortableAppData] Loi khi quet thu muc exe:", err);
  }

  // 2. Nếu chưa có, sinh mới
  const suffix = genRandomSuffix(5);
  const newDirName = `toadAppData_${suffix}`;
  const fullPath = path.join(exeDir, newDirName);
  fs.mkdirSync(fullPath, { recursive: true });
  log.info(`[PortableAppData] Da tao thu muc moi: ${fullPath}`);
  return fullPath;
}

// =============================================================================
// CONFIG VALIDATION & AUTO-HEAL
// =============================================================================

const VALID_COMPRESSIONS = ["zstd", "snappy", "gzip", "none"];

/**
 * Thẩm định toàn diện file config.ini (4 cấp độ):
 * 1. Existence Check
 * 2. Syntax & Parsing
 * 3. Schema & Key Completeness (Auto-Heal)
 * 4. Value Range & Type Validation
 */
export function validateAndEnsureConfig(configPath: string): ToadConfig {
  // Cấp 1: Existence Check
  if (!fs.existsSync(configPath)) {
    log.info("[ConfigValidation] File config.ini chua ton tai, tao moi tu template");
    try {
      fs.writeFileSync(configPath, DEFAULT_CONFIG_INI_TEXT, "utf8");
    } catch (err) {
      log.error("[ConfigValidation] Khong the ghi file config.ini:", err);
    }
    return { ...DEFAULT_CONFIG };
  }

  // Cấp 2: Syntax & Parsing
  let parsed: IniData;
  try {
    const rawContent = fs.readFileSync(configPath, "utf8");
    parsed = parseIni(rawContent);
  } catch (err) {
    log.warn(
      "[ConfigValidation] File config.ini bi hong cu phap, backup va phuc hoi mac dinh:",
      err
    );
    try {
      const backupName = `${configPath}.corrupt_${Date.now()}`;
      fs.renameSync(configPath, backupName);
      fs.writeFileSync(configPath, DEFAULT_CONFIG_INI_TEXT, "utf8");
      log.info(`[ConfigValidation] Da backup file hong sang: ${backupName}`);
    } catch (backupErr) {
      log.error("[ConfigValidation] Khong the backup file hong:", backupErr);
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
    duckdb: { max_memory, threads, background_threads, add_raw_event },
    parquet: {
      compression: compression as ToadConfig["parquet"]["compression"],
      row_group_size,
    },
    system: { temp_cleanup, binary_guard, uv_threadpool_size },
  };

  // Auto-Heal: Ghi lại file nếu có trường bị thiếu hoặc giá trị đã sửa
  if (needRewrite) {
    log.info("[ConfigValidation] Da phat hien key thieu/sai, tu dong va (Auto-Heal)");
    try {
      fs.writeFileSync(configPath, stringifyConfig(validatedConfig), "utf8");
    } catch (err) {
      log.warn("[ConfigValidation] Khong the ghi lai config.ini:", err);
    }
  }

  log.info("[ConfigValidation] Cau hinh da tham dinh thanh cong:", validatedConfig);
  return validatedConfig;
}

// =============================================================================
// FILTERS PRESET VALIDATION
// =============================================================================

/**
 * Đảm bảo file filters_preset.json tồn tại và hợp lệ
 */
export function validateAndEnsurePresets(presetsPath: string): void {
  if (!fs.existsSync(presetsPath)) {
    log.info("[PresetsValidation] Tao moi filters_preset.json");
    try {
      fs.writeFileSync(
        presetsPath,
        JSON.stringify(DEFAULT_PRESETS_JSON, null, 2),
        "utf8"
      );
    } catch (err) {
      log.warn("[PresetsValidation] Khong the tao file presets:", err);
    }
    return;
  }

  // Validate JSON syntax
  try {
    const raw = fs.readFileSync(presetsPath, "utf8");
    const parsed = JSON.parse(raw);

    // Kiểm tra cấu trúc cơ bản
    if (!parsed.version || !Array.isArray(parsed.presets)) {
      throw new Error("Cau truc filters_preset.json khong hop le");
    }
  } catch (err) {
    log.warn(
      "[PresetsValidation] File filters_preset.json bi hong, backup va phuc hoi:",
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
      log.info(`[PresetsValidation] Da backup va phuc hoi presets`);
    } catch (backupErr) {
      log.warn("[PresetsValidation] Loi khi backup presets:", backupErr);
    }
  }
}

// =============================================================================
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
// TEMP DIRECTORY CLEANUP (với Rust Core & Windows EBUSY Retry)
// =============================================================================

/**
 * Xóa sạch 100% file/thư mục bên trong thư mục temp
 * Ưu tiên gọi toad-core.exe clean-temp (Rust SIMD & retry)
 */
export function cleanTempDir(tempDir: string): void {
  try {
    if (!fs.existsSync(tempDir)) return;

    // TypeScript cleaner với Windows retry loop, bảo vệ tuyệt đối state ledger
    const items = fs.readdirSync(tempDir);
    let cleanedCount = 0;
    let failedCount = 0;

    for (const item of items) {
      if (item === "toad_ledger.parquet" || item.endsWith("_ledger.parquet")) {
        continue; // Bảo tồn state ledger
      }
      const fullPath = path.join(tempDir, item);
      let deleted = false;

      // Retry tối đa 3 lần (xử lý Windows EBUSY file lock)
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
              `[TempCleaner] Khong the xoa: ${item} (${err.code || err.message})`
            );
          }
        }
      }
    }

    if (cleanedCount > 0 || failedCount > 0) {
      log.info(
        `[TempCleaner] Da don dep temp: ${cleanedCount} thanh cong, ${failedCount} that bai`
      );
    }
  } catch (err) {
    log.warn("[TempCleaner] Loi tong quat khi don temp:", err);
  }
}

/**
 * Cập nhật last_directory vào config.ini và memory config khi người dùng mở thư mục
 */
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

    // Cập nhật bộ nhớ config hiện tại nếu có
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
    log.info(`[PortableAppData] Da cap nhat last_directory vao config.ini: ${targetDir}`);
  } catch (err) {
    log.warn("[PortableAppData] Khong the cap nhat last_directory:", err);
  }
}

export const setLastOpenedDirectory = updateLastOpenedDirectory;

/**
 * Quét dọn các file tạm dở dang mồ côi (*.tmp, *.tmp_*.parquet) từ các phiên bị crash trước đó.
 * Được gọi ngay khi khởi động ứng dụng (không phụ thuộc temp_cleanup).
 * Quét đệ quy toàn bộ thư mục con của temp/ (vd: temp/okgrg/, temp/ekm8j/).
 * Tuyệt đối bảo tồn các tệp cache hoàn chỉnh (*_cached_*.parquet) và state ledger (*_ledger.parquet).
 */
export function purgeOrphanTempFiles(tempDir: string): number {
  let purgedCount = 0;
  try {
    if (!fs.existsSync(tempDir)) return 0;

    const walkAndPurge = (dir: string): void => {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (entry === "toad_ledger.parquet" || entry.endsWith("_ledger.parquet")) {
          continue; // Bảo tồn state ledger
        }
        const fullPath = path.join(dir, entry);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            walkAndPurge(fullPath);
            // Don thu muc con neu da rong
            try {
              if (fs.readdirSync(fullPath).length === 0) {
                fs.rmdirSync(fullPath);
              }
            } catch {}
          } else {
            // Nhận diện file rác tạm: đuôi .tmp hoặc chứa .tmp_ (ví dụ sample_40gb_cached_*.tmp_1793626527527.parquet)
            const isOrphan = entry.endsWith(".tmp") || entry.includes(".tmp_");
            if (isOrphan) {
              fs.unlinkSync(fullPath);
              purgedCount++;
              log.info(`[OrphanPurge] Da don file rac mo coi: ${entry}`);
            }
          }
        } catch (err: any) {
          log.warn(`[OrphanPurge] Khong the xoa file mo coi ${entry}:`, err?.message);
        }
      }
    }

    walkAndPurge(tempDir);
  } catch (err: any) {
    log.warn("[OrphanPurge] Loi khi quet thu muc temp:", err?.message);
  }
  return purgedCount;
}

// =============================================================================
// ENTRYPOINT: Khởi tạo toàn bộ Portable Environment
// =============================================================================

/**
 * Hàm chính: Khởi tạo hoàn chỉnh Portable AppData Environment
 * Đảm bảo đọc config.ini TRƯỚC TIÊN để quyết định có dọn dẹp temp hay không
 */
export function initPortableEnvironment(): PortableEnvironment {
  log.info("=== [PortableAppData] Bat dau khoi tao Portable Environment ===");

  // 1. Xác định thư mục exe thật
  const exeDir = getExecutableDir();
  log.info(`[PortableAppData] Thu muc exe: ${exeDir}`);

  // 2. Khởi tạo AppData directory
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

  // ĐỌC VÀ VALIDATE CONFIG TRƯỚC TIÊN
  const config = validateAndEnsureConfig(configPath);
  validateAndEnsurePresets(presetsPath);

  // Quét dọn các file dở dang mồ côi (*.tmp_*.parquet) từ các lần crash trước
  const orphanPurged = purgeOrphanTempFiles(tempDir);
  if (orphanPurged > 0) {
    log.info(`[PortableAppData] Startup Orphan Cleaner da giai phong ${orphanPurged} file rac do dang`);
  }

  // Chỉ dọn dẹp file temp tồn đọng nếu temp_cleanup = true trong config.ini
  if (config.system.temp_cleanup) {
    log.info("[PortableAppData] temp_cleanup = true -> Dang don dep file temp ton dong (Orphan Clean)...");
    cleanTempDir(tempDir);
  } else {
    log.info("[PortableAppData] temp_cleanup = false -> Bao luu toan bo cache Parquet trong temp/");
  }

  log.info("=== [PortableAppData] Khoi tao hoan tat ===");
  log.info(`    AppData    : ${appDataDir}`);
  log.info(`    Temp       : ${tempDir}`);
  log.info(`    Config     : ${configPath}`);
  log.info(`    Presets    : ${presetsPath}`);
  log.info(`    Ledger     : ${ledgerPath}`);
  log.info(`    Electron   : ${electronDataDir}`);
  log.info(`    Logs       : ${logsDir}`);
  log.info(`    Libuv Pool : ${process.env.UV_THREADPOOL_SIZE}`);

  return {
    exeDir,
    appDataDir,
    tempDir,
    electronDataDir,
    logsDir,
    ledgerPath,
    config,
  };
}
