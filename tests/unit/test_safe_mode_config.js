/**
 * test_safe_mode_config.js
 *
 * Comprehensive Unit Test Suite for Configurable Safe Mode Keywords & DuckDB Multi-threaded Ingestion:
 * - TC-01: Parsing keywords array from config.ini
 * - TC-02: Parsing extra whitespace and uppercase strings
 * - TC-03: Disabling safe mode with "none", "off", "" resulting in empty array []
 * - TC-04: Auto-healing missing keys without altering existing sections or comments
 * - TC-05: isComplexLogFile("Windows.NTFS.MFT.csv") returning false by default
 * - TC-06: Adding "mft" to keywords causing isComplexLogFile("Windows.NTFS.MFT.csv") to return true
 * - TC-07: isComplexLogFile("hayabusa_high.csv") returning true
 * - TC-08: isComplexLogFile("Security.evtx") returning true
 * - TC-09: isComplexLogFile("application.log") returning true
 * - TC-10: Boolean parsing for safe_mode_parallel (true and false)
 * - TC-11: getIngestConfig fallback from process.env.TOAD_SAFE_KEYWORDS
 * - TC-12: Roundtrip serialization and parsing (stringifyConfig -> validateAndEnsureConfig)
 * - TC-13: DuckDB query generation containing parallel = true when safe_mode_parallel = true
 * - TC-14: DuckDB query generation containing parallel = false when safe_mode_parallel = false
 * - TC-15: Unicode and space file path handling (e.g. paths with diacritics, spaces, CJK)
 * - TC-16: Default config.ini template containing clear bilingual comments
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT_DIR = process.env.TOAD_ROOT || path.resolve(__dirname, "../..");

// Hook TypeScript compiler to require .ts modules directly in Node.js
module.paths.push(path.resolve(ROOT_DIR, "tad-master/node_modules"));
module.paths.push(path.resolve(ROOT_DIR, "tad-master/packages/toad-app/node_modules"));
module.paths.push(path.resolve(ROOT_DIR, "tad-master/packages/reltab-duckdb/node_modules"));

const ts = require(path.resolve(ROOT_DIR, "tad-master/node_modules/typescript"));

require.extensions[".ts"] = function (module, filename) {
  const content = fs.readFileSync(filename, "utf8");
  const result = ts.transpileModule(content, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  module._compile(result.outputText, filename);
};

const {
  DEFAULT_CONFIG,
  DEFAULT_CONFIG_INI_TEXT,
  stringifyConfig,
  validateAndEnsureConfig,
} = require(path.resolve(
  ROOT_DIR,
  "tad-master/packages/toad-app/app/portableAppData.ts"
));

const {
  DEFAULT_SAFE_MODE_KEYWORDS,
  parseSafeModeKeywords,
  getIngestConfig,
  isComplexLogFile,
  streamCsvToParquet,
} = require(path.resolve(
  ROOT_DIR,
  "tad-master/packages/reltab-duckdb/src/csvimport.ts"
));

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

let passCount = 0;
let failCount = 0;

function report(testId, name, pass, detail) {
  if (pass) {
    passCount++;
    console.log(
      `  ${GREEN}✔ [PASS]${RESET} [${testId}] ${name}${detail ? ` - ${detail}` : ""}`
    );
  } else {
    failCount++;
    console.error(
      `  ${RED}✖ [FAIL]${RESET} [${testId}] ${name}${detail ? ` - ${detail}` : ""}`
    );
  }
}

// Environment snapshot & restoration
const origEnv = {
  TOAD_SAFE_KEYWORDS: process.env.TOAD_SAFE_KEYWORDS,
  TOAD_SAFE_PARALLEL: process.env.TOAD_SAFE_PARALLEL,
  TOAD_APP_DATA_DIR: process.env.TOAD_APP_DATA_DIR,
  TOAD_TEMP_DIR: process.env.TOAD_TEMP_DIR,
};
const origGlobalEnv = global.toadPortableEnv;

function restoreEnvironment() {
  for (const [k, v] of Object.entries(origEnv)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  if (origGlobalEnv === undefined) {
    delete global.toadPortableEnv;
  } else {
    global.toadPortableEnv = origGlobalEnv;
  }
}

const tempDir = path.join(
  os.tmpdir(),
  `toad_test_safe_mode_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
);
fs.mkdirSync(tempDir, { recursive: true });

function getTempIniPath(name = "config.ini") {
  return path.join(
    tempDir,
    `${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${name}`
  );
}

async function runTestSuite() {
  console.log(
    `\n${BOLD}${CYAN}======================================================================${RESET}`
  );
  console.log(
    `${BOLD}${CYAN}   UNIT TEST SUITE: Safe Mode Config & Ingestion (16 Tests)           ${RESET}`
  );
  console.log(
    `${BOLD}${CYAN}======================================================================${RESET}\n`
  );

  try {
    // -------------------------------------------------------------------------
    // TC-01: Parsing keywords array from config.ini
    // -------------------------------------------------------------------------
    try {
      restoreEnvironment();
      const iniPath = getTempIniPath("tc01.ini");
      const iniContent = `
[general]
viewer = toad
language = en
page_size = 1000

[duckdb]
max_memory = auto
threads = 0
safe_mode_keywords = hayabusa, security, custom_tag, winlog
safe_mode_parallel = true
`;
      fs.writeFileSync(iniPath, iniContent, "utf8");
      const cfg = validateAndEnsureConfig(iniPath);
      assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, [
        "hayabusa",
        "security",
        "custom_tag",
        "winlog",
      ]);
      report("TC-01", "Parsing keywords array from config.ini", true);
    } catch (err) {
      report("TC-01", "Parsing keywords array from config.ini", false, err.message);
    } finally {
      restoreEnvironment();
    }

    // -------------------------------------------------------------------------
    // TC-02: Parsing extra whitespace and uppercase strings
    // -------------------------------------------------------------------------
    try {
      restoreEnvironment();
      const iniPath = getTempIniPath("tc02.ini");
      const iniContent = `
[general]
viewer = toad

[duckdb]
safe_mode_keywords =   HAYABUSA  ,  SECURITY , EvEnT_LoG   ,   AuDiT 
safe_mode_parallel = true
`;
      fs.writeFileSync(iniPath, iniContent, "utf8");
      const cfg = validateAndEnsureConfig(iniPath);
      assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, [
        "hayabusa",
        "security",
        "event_log",
        "audit",
      ]);
      report("TC-02", "Parsing extra whitespace and uppercase strings", true);
    } catch (err) {
      report(
        "TC-02",
        "Parsing extra whitespace and uppercase strings",
        false,
        err.message
      );
    } finally {
      restoreEnvironment();
    }

    // -------------------------------------------------------------------------
    // TC-03: Disabling safe mode with "none", "off", "" resulting in empty array []
    // -------------------------------------------------------------------------
    try {
      restoreEnvironment();
      const testValues = ["none", "NONE", "off", "OFF", "", "   "];
      for (const val of testValues) {
        const iniPath = getTempIniPath("tc03.ini");
        const iniContent = `
[general]
viewer = toad
[duckdb]
safe_mode_keywords = ${val}
safe_mode_parallel = true
`;
        fs.writeFileSync(iniPath, iniContent, "utf8");
        const cfg = validateAndEnsureConfig(iniPath);
        assert.deepStrictEqual(
          cfg.duckdb.safe_mode_keywords,
          [],
          `safe_mode_keywords = '${val}' must result in empty array []`
        );
      }
      // Also verify helper function parseSafeModeKeywords
      assert.deepStrictEqual(parseSafeModeKeywords("none"), []);
      assert.deepStrictEqual(parseSafeModeKeywords("off"), []);
      assert.deepStrictEqual(parseSafeModeKeywords(""), []);
      assert.deepStrictEqual(parseSafeModeKeywords(null), []);
      assert.deepStrictEqual(parseSafeModeKeywords(undefined), []);
      report(
        "TC-03",
        'Disabling safe mode with "none", "off", "" resulting in empty array []',
        true
      );
    } catch (err) {
      report(
        "TC-03",
        'Disabling safe mode with "none", "off", "" resulting in empty array []',
        false,
        err.message
      );
    } finally {
      restoreEnvironment();
    }

    // -------------------------------------------------------------------------
    // TC-04: Auto-healing missing keys without altering existing sections or comments
    // -------------------------------------------------------------------------
    try {
      restoreEnvironment();
      const iniPath = getTempIniPath("tc04.ini");
      const originalContent = `# User custom header comment
[general]
# Page size comment
page_size = 7890
last_directory = D:\\Forensics\\Case99

[duckdb]
# Max memory custom
max_memory = 4GB
threads = 6

[custom_user_section]
case_id = 998877
`;
      fs.writeFileSync(iniPath, originalContent, "utf8");
      const cfg = validateAndEnsureConfig(iniPath);

      assert.strictEqual(cfg.general.page_size, 7890);
      assert.strictEqual(cfg.general.last_directory, "D:\\Forensics\\Case99");
      assert.strictEqual(cfg.duckdb.max_memory, "4GB");
      assert.strictEqual(cfg.duckdb.threads, 6);
      assert.strictEqual(cfg.duckdb.safe_mode_parallel, true);
      assert.deepStrictEqual(
        cfg.duckdb.safe_mode_keywords,
        DEFAULT_CONFIG.duckdb.safe_mode_keywords
      );
      assert.strictEqual(cfg.duckdb.safe_mode_keywords.includes("mft"), false);

      const healedContent = fs.readFileSync(iniPath, "utf8");
      assert.ok(
        healedContent.includes("# User custom header comment"),
        "Custom header comment must be preserved"
      );
      assert.ok(
        healedContent.includes("# Page size comment"),
        "Page size comment must be preserved"
      );
      assert.ok(
        healedContent.includes("page_size = 7890"),
        "page_size = 7890 must be preserved"
      );
      assert.ok(
        healedContent.includes("threads = 6"),
        "threads = 6 must be preserved"
      );
      assert.ok(
        healedContent.includes("[custom_user_section]"),
        "Custom section must be preserved"
      );
      assert.ok(
        healedContent.includes("case_id = 998877"),
        "Custom section keys must be preserved"
      );
      assert.ok(
        healedContent.includes("safe_mode_keywords"),
        "safe_mode_keywords must be auto-healed in file"
      );
      assert.ok(
        healedContent.includes("safe_mode_parallel = true"),
        "safe_mode_parallel must be auto-healed in file"
      );

      report(
        "TC-04",
        "Auto-healing missing keys without altering existing sections or comments",
        true
      );
    } catch (err) {
      report(
        "TC-04",
        "Auto-healing missing keys without altering existing sections or comments",
        false,
        err.message
      );
    } finally {
      restoreEnvironment();
    }

    // -------------------------------------------------------------------------
    // TC-05: isComplexLogFile("Windows.NTFS.MFT.csv") returning false by default
    // -------------------------------------------------------------------------
    try {
      restoreEnvironment();
      delete process.env.TOAD_SAFE_KEYWORDS;
      delete global.toadPortableEnv;

      assert.strictEqual(
        isComplexLogFile("Windows.NTFS.MFT.csv"),
        false,
        "Windows.NTFS.MFT.csv must return false by default"
      );
      assert.strictEqual(
        isComplexLogFile("C:/Evidence/MFT_Export.csv"),
        false,
        "MFT_Export.csv must return false by default"
      );
      assert.strictEqual(
        isComplexLogFile("D:\\Cases\\mft_records.csv"),
        false,
        "mft_records.csv must return false by default"
      );
      assert.strictEqual(
        isComplexLogFile("c:/forensics/$MFT.csv"),
        false,
        "$MFT.csv must return false by default"
      );

      report(
        "TC-05",
        'isComplexLogFile("Windows.NTFS.MFT.csv") returning false by default',
        true
      );
    } catch (err) {
      report(
        "TC-05",
        'isComplexLogFile("Windows.NTFS.MFT.csv") returning false by default',
        false,
        err.message
      );
    } finally {
      restoreEnvironment();
    }

    // -------------------------------------------------------------------------
    // TC-06: Adding "mft" to keywords causing isComplexLogFile("Windows.NTFS.MFT.csv") to return true
    // -------------------------------------------------------------------------
    try {
      restoreEnvironment();
      delete process.env.TOAD_SAFE_KEYWORDS;
      delete global.toadPortableEnv;

      // Subcase 6a: customKeywords parameter
      assert.strictEqual(
        isComplexLogFile("Windows.NTFS.MFT.csv", ["mft"]),
        true,
        "customKeywords ['mft'] must trigger complex log"
      );
      assert.strictEqual(
        isComplexLogFile("D:\\Cases\\mft_records.csv", ["hayabusa", "mft"]),
        true,
        "customKeywords array containing 'mft' must trigger complex log"
      );

      // Subcase 6b: process.env.TOAD_SAFE_KEYWORDS
      process.env.TOAD_SAFE_KEYWORDS = "mft, hayabusa";
      assert.strictEqual(
        isComplexLogFile("Windows.NTFS.MFT.csv"),
        true,
        "process.env.TOAD_SAFE_KEYWORDS containing 'mft' must trigger complex log"
      );
      delete process.env.TOAD_SAFE_KEYWORDS;

      // Subcase 6c: global.toadPortableEnv
      global.toadPortableEnv = {
        config: {
          ...DEFAULT_CONFIG,
          duckdb: {
            ...DEFAULT_CONFIG.duckdb,
            safe_mode_keywords: ["mft", "security"],
            safe_mode_parallel: true,
          },
        },
      };
      assert.strictEqual(
        isComplexLogFile("Windows.NTFS.MFT.csv"),
        true,
        "global.toadPortableEnv safe_mode_keywords containing 'mft' must trigger complex log"
      );
      delete global.toadPortableEnv;

      report(
        "TC-06",
        'Adding "mft" to keywords causing isComplexLogFile("Windows.NTFS.MFT.csv") to return true',
        true
      );
    } catch (err) {
      report(
        "TC-06",
        'Adding "mft" to keywords causing isComplexLogFile("Windows.NTFS.MFT.csv") to return true',
        false,
        err.message
      );
    } finally {
      restoreEnvironment();
    }

    // -------------------------------------------------------------------------
    // TC-07: isComplexLogFile("hayabusa_high.csv") returning true
    // -------------------------------------------------------------------------
    try {
      restoreEnvironment();
      delete process.env.TOAD_SAFE_KEYWORDS;
      delete global.toadPortableEnv;

      assert.strictEqual(isComplexLogFile("hayabusa_high.csv"), true);
      assert.strictEqual(isComplexLogFile("C:/Logs/Hayabusa_Output.csv"), true);
      assert.strictEqual(
        isComplexLogFile("Windows.EventLogs.Hayabusa%2Foutput.csv"),
        true
      );
      assert.strictEqual(isComplexLogFile("hayabusa.tsv"), true);

      report("TC-07", 'isComplexLogFile("hayabusa_high.csv") returning true', true);
    } catch (err) {
      report(
        "TC-07",
        'isComplexLogFile("hayabusa_high.csv") returning true',
        false,
        err.message
      );
    } finally {
      restoreEnvironment();
    }

    // -------------------------------------------------------------------------
    // TC-08: isComplexLogFile("Security.evtx") returning true
    // -------------------------------------------------------------------------
    try {
      restoreEnvironment();
      delete process.env.TOAD_SAFE_KEYWORDS;
      delete global.toadPortableEnv;

      assert.strictEqual(isComplexLogFile("Security.evtx"), true);
      assert.strictEqual(
        isComplexLogFile("C:\\Windows\\System32\\Winevt\\Logs\\Security.evtx"),
        true
      );
      assert.strictEqual(isComplexLogFile("/var/log/winevt/System.evtx"), true);

      report("TC-08", 'isComplexLogFile("Security.evtx") returning true', true);
    } catch (err) {
      report(
        "TC-08",
        'isComplexLogFile("Security.evtx") returning true',
        false,
        err.message
      );
    } finally {
      restoreEnvironment();
    }

    // -------------------------------------------------------------------------
    // TC-09: isComplexLogFile("application.log") returning true
    // -------------------------------------------------------------------------
    try {
      restoreEnvironment();
      delete process.env.TOAD_SAFE_KEYWORDS;
      delete global.toadPortableEnv;

      assert.strictEqual(isComplexLogFile("application.log"), true);
      assert.strictEqual(isComplexLogFile("/var/log/syslog.log"), true);
      assert.strictEqual(isComplexLogFile("C:\\temp\\audit_trail.txt"), true);
      assert.strictEqual(isComplexLogFile("debug_dump.txt"), true);

      report("TC-09", 'isComplexLogFile("application.log") returning true', true);
    } catch (err) {
      report(
        "TC-09",
        'isComplexLogFile("application.log") returning true',
        false,
        err.message
      );
    } finally {
      restoreEnvironment();
    }

    // -------------------------------------------------------------------------
    // TC-10: Boolean parsing for safe_mode_parallel (true and false)
    // -------------------------------------------------------------------------
    try {
      restoreEnvironment();
      const testCases = [
        { val: "true", expected: true },
        { val: "True", expected: true },
        { val: "TRUE", expected: true },
        { val: "false", expected: false },
        { val: "False", expected: false },
        { val: "FALSE", expected: false },
        { val: "invalid_string", expected: true },
        { val: "123", expected: true },
      ];
      for (const tc of testCases) {
        const iniPath = getTempIniPath("tc10.ini");
        const content = `
[general]
viewer = toad
[duckdb]
safe_mode_parallel = ${tc.val}
`;
        fs.writeFileSync(iniPath, content, "utf8");
        const parsed = validateAndEnsureConfig(iniPath);
        assert.strictEqual(
          parsed.duckdb.safe_mode_parallel,
          tc.expected,
          `safe_mode_parallel = '${tc.val}' must parse to ${tc.expected}`
        );
      }
      report(
        "TC-10",
        "Boolean parsing for safe_mode_parallel (true and false)",
        true
      );
    } catch (err) {
      report(
        "TC-10",
        "Boolean parsing for safe_mode_parallel (true and false)",
        false,
        err.message
      );
    } finally {
      restoreEnvironment();
    }

    // -------------------------------------------------------------------------
    // TC-11: getIngestConfig fallback from process.env.TOAD_SAFE_KEYWORDS
    // -------------------------------------------------------------------------
    try {
      restoreEnvironment();
      delete global.toadPortableEnv;
      process.env.TOAD_SAFE_KEYWORDS = "crowdstrike, carbonblack, sentinel";
      process.env.TOAD_SAFE_PARALLEL = "false";

      const cfg = getIngestConfig();
      assert.deepStrictEqual(cfg.safe_mode_keywords, [
        "crowdstrike",
        "carbonblack",
        "sentinel",
      ]);
      assert.strictEqual(cfg.safe_mode_parallel, false);

      report(
        "TC-11",
        "getIngestConfig fallback from process.env.TOAD_SAFE_KEYWORDS",
        true
      );
    } catch (err) {
      report(
        "TC-11",
        "getIngestConfig fallback from process.env.TOAD_SAFE_KEYWORDS",
        false,
        err.message
      );
    } finally {
      restoreEnvironment();
    }

    // -------------------------------------------------------------------------
    // TC-12: Roundtrip serialization and parsing (stringifyConfig -> validateAndEnsureConfig)
    // -------------------------------------------------------------------------
    try {
      restoreEnvironment();
      const customConfig = {
        ...DEFAULT_CONFIG,
        duckdb: {
          ...DEFAULT_CONFIG.duckdb,
          safe_mode_keywords: ["hayabusa", "sysmon", "timeline"],
          safe_mode_parallel: false,
        },
      };

      const serialized = stringifyConfig(customConfig);
      assert.ok(
        serialized.includes("safe_mode_keywords = hayabusa, sysmon, timeline"),
        "Serialized INI must include custom safe_mode_keywords"
      );
      assert.ok(
        serialized.includes("safe_mode_parallel = false"),
        "Serialized INI must include safe_mode_parallel = false"
      );

      const iniPath = getTempIniPath("tc12.ini");
      fs.writeFileSync(iniPath, serialized, "utf8");
      const parsed = validateAndEnsureConfig(iniPath);

      assert.deepStrictEqual(parsed.duckdb.safe_mode_keywords, [
        "hayabusa",
        "sysmon",
        "timeline",
      ]);
      assert.strictEqual(parsed.duckdb.safe_mode_parallel, false);

      report("TC-12", "Roundtrip serialization and parsing", true);
    } catch (err) {
      report("TC-12", "Roundtrip serialization and parsing", false, err.message);
    } finally {
      restoreEnvironment();
    }

    // -------------------------------------------------------------------------
    // TC-13: DuckDB query generation containing parallel = true when safe_mode_parallel = true
    // -------------------------------------------------------------------------
    try {
      restoreEnvironment();
      const capturedQueries = [];
      const mockConn = {
        exec: async (sql) => {
          capturedQueries.push(sql);
          return;
        },
      };

      const cfgTrue = {
        ...getIngestConfig(),
        safe_mode_keywords: ["hayabusa"],
        safe_mode_parallel: true,
      };

      await streamCsvToParquet(
        mockConn,
        "C:/Evidence/hayabusa_high.csv",
        "C:/temp/test.parquet",
        cfgTrue
      );

      assert.strictEqual(capturedQueries.length > 0, true, "Must have executed SQL");
      const sql = capturedQueries[0];
      assert.ok(
        /parallel\s*=\s*true/i.test(sql),
        `Generated SQL must include parallel = true. SQL: ${sql}`
      );
      assert.ok(
        !/parallel\s*=\s*false/i.test(sql),
        `Generated SQL must NOT contain parallel = false. SQL: ${sql}`
      );

      report(
        "TC-13",
        "DuckDB query generation containing parallel = true when safe_mode_parallel = true",
        true
      );
    } catch (err) {
      report(
        "TC-13",
        "DuckDB query generation containing parallel = true when safe_mode_parallel = true",
        false,
        err.message
      );
    } finally {
      restoreEnvironment();
    }

    // -------------------------------------------------------------------------
    // TC-14: DuckDB query generation containing parallel = false when safe_mode_parallel = false
    // -------------------------------------------------------------------------
    try {
      restoreEnvironment();
      const capturedQueries = [];
      const mockConn = {
        exec: async (sql) => {
          capturedQueries.push(sql);
          return;
        },
      };

      const cfgFalse = {
        ...getIngestConfig(),
        safe_mode_keywords: ["hayabusa"],
        safe_mode_parallel: false,
      };

      await streamCsvToParquet(
        mockConn,
        "C:/Evidence/hayabusa_high.csv",
        "C:/temp/test.parquet",
        cfgFalse
      );

      assert.strictEqual(capturedQueries.length > 0, true, "Must have executed SQL");
      const sql = capturedQueries[0];
      assert.ok(
        /parallel\s*=\s*false/i.test(sql),
        `Generated SQL must include parallel = false. SQL: ${sql}`
      );
      assert.ok(
        !/parallel\s*=\s*true/i.test(sql),
        `Generated SQL must NOT contain parallel = true. SQL: ${sql}`
      );

      report(
        "TC-14",
        "DuckDB query generation containing parallel = false when safe_mode_parallel = false",
        true
      );
    } catch (err) {
      report(
        "TC-14",
        "DuckDB query generation containing parallel = false when safe_mode_parallel = false",
        false,
        err.message
      );
    } finally {
      restoreEnvironment();
    }

    // -------------------------------------------------------------------------
    // TC-15: Unicode and space file path handling (e.g. paths with diacritics, spaces, CJK)
    // -------------------------------------------------------------------------
    try {
      restoreEnvironment();
      delete process.env.TOAD_SAFE_KEYWORDS;
      delete global.toadPortableEnv;

      // Complex log heuristic classification with unicode / spaces
      assert.strictEqual(
        isComplexLogFile("C:/Evidence/DFIR Case 2026/Windows Security Events.csv"),
        true
      );
      assert.strictEqual(
        isComplexLogFile("D:/Điều Tra Số/案件_2026/отчет_hayabusa.csv"),
        true
      );
      assert.strictEqual(
        isComplexLogFile("C:\\Evidence Folder\\Normal Table Data.csv"),
        false
      );
      assert.strictEqual(
        isComplexLogFile("C:\\Evidence Folder\\Windows.NTFS.MFT.csv"),
        false
      );
      assert.strictEqual(
        isComplexLogFile("D:\\Forensics\\案件\\application.log"),
        true
      );

      // SQL Path handling with unicode, spaces, and backslashes
      const captured = [];
      const mockConn = {
        exec: async (sql) => {
          captured.push(sql);
        },
      };
      const unicodePath = "D:/Điều Tra Số/案件 2026/отчет_hayabusa.csv";
      const parquetPath = "D:/Điều Tra Số/案件 2026/out.parquet";
      await streamCsvToParquet(
        mockConn,
        unicodePath,
        parquetPath,
        getIngestConfig()
      );

      assert.strictEqual(captured.length > 0, true, "Must have generated query");
      assert.ok(
        captured[0].includes("отчет_hayabusa.csv"),
        "Cyrillic filename in path must be preserved"
      );
      assert.ok(
        captured[0].includes("Điều Tra Số"),
        "Vietnamese characters in path must be preserved"
      );
      assert.ok(
        captured[0].includes("案件 2026"),
        "CJK characters and spaces in path must be preserved"
      );

      report(
        "TC-15",
        "Unicode and space file path handling (diacritics, spaces, CJK)",
        true
      );
    } catch (err) {
      report(
        "TC-15",
        "Unicode and space file path handling (diacritics, spaces, CJK)",
        false,
        err.message
      );
    } finally {
      restoreEnvironment();
    }

    // -------------------------------------------------------------------------
    // TC-16: Default config.ini template containing clear bilingual comments
    // -------------------------------------------------------------------------
    try {
      restoreEnvironment();
      assert.ok(
        DEFAULT_CONFIG_INI_TEXT.includes("safe_mode_keywords"),
        "Must contain safe_mode_keywords in template"
      );
      assert.ok(
        DEFAULT_CONFIG_INI_TEXT.includes("safe_mode_parallel"),
        "Must contain safe_mode_parallel in template"
      );

      // English comments verification
      assert.ok(
        DEFAULT_CONFIG_INI_TEXT.toLowerCase().includes("safe mode keywords") ||
          DEFAULT_CONFIG_INI_TEXT.includes("safe_mode_keywords"),
        "Must explain safe mode keywords"
      );
      assert.ok(
        DEFAULT_CONFIG_INI_TEXT.includes("none") &&
          DEFAULT_CONFIG_INI_TEXT.includes("off"),
        "Must document none/off disabling syntax"
      );
      assert.ok(
        DEFAULT_CONFIG_INI_TEXT.includes("parallel") ||
          DEFAULT_CONFIG_INI_TEXT.includes("Multi-threaded"),
        "Must document multi-threaded parallel ingestion"
      );

      // Vietnamese comments verification
      assert.ok(
        DEFAULT_CONFIG_INI_TEXT.includes("Tu khoa che do an toan") ||
          DEFAULT_CONFIG_INI_TEXT.includes("an toan"),
        "Must contain Vietnamese comments for safe mode keywords"
      );
      assert.ok(
        DEFAULT_CONFIG_INI_TEXT.includes("da luong") ||
          DEFAULT_CONFIG_INI_TEXT.includes("Doc da luong"),
        "Must contain Vietnamese comments for safe_mode_parallel"
      );

      report(
        "TC-16",
        "Default config.ini template containing clear bilingual comments",
        true
      );
    } catch (err) {
      report(
        "TC-16",
        "Default config.ini template containing clear bilingual comments",
        false,
        err.message
      );
    } finally {
      restoreEnvironment();
    }
  } finally {
    // Cleanup temporary directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }

  console.log(
    `\n${BOLD}Test Summary: ${GREEN}${passCount} passed${RESET}, ${failCount > 0 ? RED : GREEN}${failCount} failed${RESET} (16 total)\n`
  );

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTestSuite().catch((err) => {
  console.error("Unhandled test suite error:", err);
  process.exit(1);
});
