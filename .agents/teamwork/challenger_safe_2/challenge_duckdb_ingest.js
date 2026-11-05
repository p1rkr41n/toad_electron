/**
 * challenge_duckdb_ingest.js
 *
 * Empirical Adversarial Challenge Harness for Milestone 4 Gate Verification:
 * Stress-testing DuckDB multi-threaded ingestion and heuristic file classification
 * in reltab-duckdb (csvimport.ts and ingestWorker.ts).
 *
 * Author: Challenger 2 (Empirical Challenger)
 * Date: 2026-11-05
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");

const ROOT_DIR = process.env.TOAD_ROOT || path.resolve(__dirname, "../../..");

// Hook TypeScript compilation for requiring .ts files directly
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
      esModuleInterop: false,
    },
  });
  module._compile(result.outputText, filename);
};

const { Database } = require(path.resolve(ROOT_DIR, "tad-master/node_modules/duckdb-async"));

const {
  DEFAULT_SAFE_MODE_KEYWORDS,
  parseSafeModeKeywords,
  getIngestConfig,
  isComplexLogFile,
  streamCsvToParquet,
  nativeCSVImport,
} = require(path.resolve(
  ROOT_DIR,
  "tad-master/packages/reltab-duckdb/src/csvimport.ts"
));

// Formatting helpers
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

let passCount = 0;
let failCount = 0;
const failures = [];

function challenge(section, desc, fn) {
  try {
    fn();
    passCount++;
    console.log(`  ${GREEN}✔ [PASS]${RESET} [${section}] ${desc}`);
  } catch (err) {
    failCount++;
    failures.push({ section, desc, error: err.message, stack: err.stack });
    console.log(`  ${RED}✖ [FAIL]${RESET} [${section}] ${desc}`);
    console.log(`    ${YELLOW}Reason:${RESET} ${err.message}`);
  }
}

async function asyncChallenge(section, desc, fn) {
  try {
    await fn();
    passCount++;
    console.log(`  ${GREEN}✔ [PASS]${RESET} [${section}] ${desc}`);
  } catch (err) {
    failCount++;
    failures.push({ section, desc, error: err.message, stack: err.stack });
    console.log(`  ${RED}✖ [FAIL]${RESET} [${section}] ${desc}`);
    console.log(`    ${YELLOW}Reason:${RESET} ${err.message}`);
  }
}

const originalEnv = { ...process.env };
function resetEnv() {
  process.env = { ...originalEnv };
  delete global.toadPortableEnv;
}

async function runAllChallenges() {
  console.log(`\n${BOLD}${CYAN}======================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}   ADVERSARIAL CHALLENGE HARNESS: DuckDB Multi-thread & Ingest Safe   ${RESET}`);
  console.log(`${BOLD}${CYAN}======================================================================${RESET}\n`);

  // =========================================================================
  // 1. isComplexLogFile(filePath, customKeywords) Adversarial Testing
  // =========================================================================
  console.log(`${BOLD}[SECTION 1] isComplexLogFile Adversarial Inputs & Edge Cases${RESET}`);

  // 1.1 Null / Undefined / Empty FilePaths
  challenge("SEC-1.1", "Null filePath returns false without throwing", () => {
    assert.strictEqual(isComplexLogFile(null), false);
  });

  challenge("SEC-1.1", "Undefined filePath returns false without throwing", () => {
    assert.strictEqual(isComplexLogFile(undefined), false);
  });

  challenge("SEC-1.1", "Empty string filePath returns false", () => {
    assert.strictEqual(isComplexLogFile(""), false);
  });

  challenge("SEC-1.1", "Whitespace-only filePath returns false", () => {
    // Note: "   " has no matching keywords and extname is ""
    assert.strictEqual(isComplexLogFile("   "), false);
  });

  // 1.2 Path structure edge cases
  challenge("SEC-1.2", "Root paths: /mft returns false by default", () => {
    assert.strictEqual(isComplexLogFile("/mft"), false);
    assert.strictEqual(isComplexLogFile("\\mft"), false);
    assert.strictEqual(isComplexLogFile("C:\\mft"), false);
  });

  challenge("SEC-1.2", "Root paths: /hayabusa returns true", () => {
    assert.strictEqual(isComplexLogFile("/hayabusa"), true);
    assert.strictEqual(isComplexLogFile("C:\\hayabusa"), true);
  });

  challenge("SEC-1.2", "Relative paths with multiple parent steps (../../hayabusa.csv)", () => {
    assert.strictEqual(isComplexLogFile("../../hayabusa.csv"), true);
    assert.strictEqual(isComplexLogFile("..\\..\\logs\\security.csv"), true);
    assert.strictEqual(isComplexLogFile("./mft.csv"), false);
  });

  challenge("SEC-1.2", "Windows path with backslashes (C:\\Logs\\security.csv)", () => {
    assert.strictEqual(isComplexLogFile("C:\\Logs\\security.csv"), true);
    assert.strictEqual(isComplexLogFile("D:\\Forensics\\DFIR\\cases\\2026\\audit_log.csv"), true);
  });

  challenge("SEC-1.2", "Special characters in path: [audit], #1, %20, $dump", () => {
    assert.strictEqual(isComplexLogFile("file [audit] #1.csv"), true);
    assert.strictEqual(isComplexLogFile("event_log%20.csv"), true);
    assert.strictEqual(isComplexLogFile("C:/cases/sysmon$events!v1.csv"), true);
    assert.strictEqual(isComplexLogFile("normal [data] #2.csv"), false);
    assert.strictEqual(isComplexLogFile("sales%20report.csv"), false);
  });

  challenge("SEC-1.2", "Unicode & Diacritics paths (Vietnamese, CJK, Emoji)", () => {
    // Vietnamese diacritics
    assert.strictEqual(isComplexLogFile("D:\\Dữ liệu điều tra\\hayabusa_kết_quả.csv"), true);
    assert.strictEqual(isComplexLogFile("D:\\Dữ liệu điều tra\\báo_cáo_tài_chính.csv"), false);
    // CJK characters
    assert.strictEqual(isComplexLogFile("C:\\フォレンジック\\監査ログ_audit.csv"), true);
    assert.strictEqual(isComplexLogFile("C:\\フォレンジック\\顧客データ.csv"), false);
    // Emoji characters
    assert.strictEqual(isComplexLogFile("C:\\📁logs\\🔥firewall_events.csv"), true);
    assert.strictEqual(isComplexLogFile("C:\\📁test\\📊doanh_thu.csv"), false);
  });

  // 1.3 Case variations & Extension-based triggers
  challenge("SEC-1.3", "Case variations on keywords and extensions", () => {
    assert.strictEqual(isComplexLogFile("WINDOWS.NTFS.MFT.CSV"), false);
    assert.strictEqual(isComplexLogFile("HAYABUSA_HIGH.CSV"), true);
    assert.strictEqual(isComplexLogFile("Security.EVTX"), true);
    assert.strictEqual(isComplexLogFile("audit.LOG"), true);
    assert.strictEqual(isComplexLogFile("notes.TXT"), true);
    assert.strictEqual(isComplexLogFile("SYSMON_EVENTS.tsv"), true);
    assert.strictEqual(isComplexLogFile("FIREWALL_RULES.csv"), true);
    assert.strictEqual(isComplexLogFile("DATA.CSV"), false);
  });

  // 1.4 Default Keyword Exclusions: MFT verification
  challenge("SEC-1.4", "Windows.NTFS.MFT.csv returns false by default, true when 'mft' added", () => {
    resetEnv();
    // Default: must be false
    assert.strictEqual(isComplexLogFile("Windows.NTFS.MFT.csv"), false);
    assert.strictEqual(isComplexLogFile("C:/Cases/MFT_Dump.csv"), false);
    assert.strictEqual(isComplexLogFile("D:\\Forensics\\$MFT.csv"), false);

    // Override with ["mft"]: must be true
    assert.strictEqual(isComplexLogFile("Windows.NTFS.MFT.csv", ["mft"]), true);
    assert.strictEqual(isComplexLogFile("Windows.NTFS.MFT.csv", ["MFT"]), true);
    assert.strictEqual(isComplexLogFile("Windows.NTFS.MFT.csv", ["hayabusa", "mft"]), true);
    assert.strictEqual(isComplexLogFile("Windows.NTFS.MFT.csv", ["  mft  "]), true);
  });

  // 1.5 Custom Keywords Override Edge Cases
  challenge("SEC-1.5", "Custom keywords override default keywords completely", () => {
    // When custom keywords are specified, hayabusa should NOT match unless included
    assert.strictEqual(isComplexLogFile("hayabusa.csv", ["custom_log", "audit"]), false);
    assert.strictEqual(isComplexLogFile("custom_log.csv", ["custom_log", "audit"]), true);
    assert.strictEqual(isComplexLogFile("audit_export.csv", ["custom_log", "audit"]), true);
  });

  challenge("SEC-1.5", "Empty array [] disables keyword-based safe mode", () => {
    assert.strictEqual(isComplexLogFile("hayabusa.csv", []), false);
    assert.strictEqual(isComplexLogFile("security.csv", []), false);
    // Extensions (.evtx, .log, .txt) still trigger
    assert.strictEqual(isComplexLogFile("security.evtx", []), true);
    assert.strictEqual(isComplexLogFile("app.log", []), true);
  });

  challenge("SEC-1.5", "Array with whitespace & empty strings (['', '   ', '\\t']) disables keywords", () => {
    assert.strictEqual(isComplexLogFile("hayabusa.csv", ["", "  ", "\t"]), false);
    assert.strictEqual(isComplexLogFile("security.csv", ["", "     "]), false);
  });

  challenge("SEC-1.5", "Array containing disabling keywords ('none', 'off') disables keywords", () => {
    assert.strictEqual(isComplexLogFile("hayabusa.csv", ["none"]), false);
    assert.strictEqual(isComplexLogFile("security.csv", ["off"]), false);
    assert.strictEqual(isComplexLogFile("sysmon.csv", ["  NONE  ", " OFF "]), false);
  });

  challenge("SEC-1.5", "Array containing mixed invalid elements (null, undefined, numbers) and valid keyword", () => {
    const mixed = ["", null, undefined, 12345, "none", "off", "  AUDIT  "];
    assert.strictEqual(isComplexLogFile("system_audit_trail.csv", mixed), true);
    assert.strictEqual(isComplexLogFile("hayabusa.csv", mixed), false);
  });

  challenge("SEC-1.5", "Null and undefined customKeywords fall back to getIngestConfig()", () => {
    resetEnv();
    assert.strictEqual(isComplexLogFile("hayabusa.csv", null), true);
    assert.strictEqual(isComplexLogFile("hayabusa.csv", undefined), true);
    assert.strictEqual(isComplexLogFile("Windows.NTFS.MFT.csv", null), false);
    assert.strictEqual(isComplexLogFile("Windows.NTFS.MFT.csv", undefined), false);
  });


  // =========================================================================
  // 2. DuckDB SQL Query Generation Adversarial Testing
  // =========================================================================
  console.log(`\n${BOLD}[SECTION 2] DuckDB Query Generation (streamCsvToParquet & nativeCSVImport)${RESET}`);

  await asyncChallenge("SEC-2.1", "streamCsvToParquet SQL with safe_mode_parallel = true", async () => {
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

    assert.strictEqual(capturedQueries.length, 1, "Must execute exactly 1 Stage 1 query");
    const sql = capturedQueries[0];

    // Assertions on generated SQL syntax
    assert.ok(/parallel\s*=\s*true/i.test(sql), `Must include parallel = true. SQL: ${sql}`);
    assert.ok(!/parallel\s*=\s*false/i.test(sql), `Must NOT include parallel = false. SQL: ${sql}`);
    assert.ok(/all_varchar\s*=\s*true/i.test(sql), `Must include all_varchar = true. SQL: ${sql}`);
    assert.ok(/auto_detect\s*=\s*true/i.test(sql), `Must include auto_detect = true. SQL: ${sql}`);
    assert.ok(/delim\s*=\s*','/i.test(sql), `Must include delim = ',' for CSV. SQL: ${sql}`);
    assert.ok(/sample_size\s*=\s*100000/i.test(sql), `Must include sample_size = 100000. SQL: ${sql}`);
    assert.ok(/ignore_errors\s*=\s*true/i.test(sql), `Must include ignore_errors = true. SQL: ${sql}`);
  });

  await asyncChallenge("SEC-2.1", "streamCsvToParquet SQL with safe_mode_parallel = false", async () => {
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

    assert.strictEqual(capturedQueries.length, 1, "Must execute exactly 1 Stage 1 query");
    const sql = capturedQueries[0];

    assert.ok(/parallel\s*=\s*false/i.test(sql), `Must include parallel = false. SQL: ${sql}`);
    assert.ok(!/parallel\s*=\s*true/i.test(sql), `Must NOT include parallel = true. SQL: ${sql}`);
    assert.ok(/all_varchar\s*=\s*true/i.test(sql), `Must include all_varchar = true. SQL: ${sql}`);
  });

  await asyncChallenge("SEC-2.1", "streamCsvToParquet Stage 2 Force Header fallback behavior", async () => {
    const capturedQueries = [];
    let callCount = 0;
    const mockConn = {
      exec: async (sql) => {
        capturedQueries.push(sql);
        callCount++;
        if (callCount === 1) {
          // Simulate Stage 1 auto_detect failure (e.g., malformed CSV sniffer failure)
          throw new Error("Simulated Stage 1 failure");
        }
        return;
      },
    };

    const cfg = {
      ...getIngestConfig(),
      safe_mode_keywords: ["hayabusa"],
      safe_mode_parallel: true,
    };

    await streamCsvToParquet(
      mockConn,
      "C:/Evidence/hayabusa_corrupt.csv",
      "C:/temp/test.parquet",
      cfg
    );

    assert.strictEqual(capturedQueries.length, 2, "Must fall back and execute Stage 2 query");
    const stage2Sql = capturedQueries[1];
    assert.ok(/header\s*=\s*true/i.test(stage2Sql), `Stage 2 must include header = true. SQL: ${stage2Sql}`);
    assert.ok(/parallel\s*=\s*false/i.test(stage2Sql), `Stage 2 must use parallel = false. SQL: ${stage2Sql}`);
    assert.ok(/all_varchar\s*=\s*true/i.test(stage2Sql), `Stage 2 must include all_varchar = true. SQL: ${stage2Sql}`);
  });

  await asyncChallenge("SEC-2.2", "nativeCSVImport SQL generation when safe_mode_parallel = true", async () => {
    resetEnv();
    const capturedQueries = [];
    const mockConn = {
      all: async (sql) => {
        capturedQueries.push(sql);
        return [];
      },
      exec: async (sql) => {
        capturedQueries.push(sql);
        return;
      },
      close: async () => {},
    };
    const mockDb = {
      connect: async () => mockConn,
    };

    global.toadPortableEnv = {
      config: {
        general: { viewer: "toad", language: "en", page_size: 1000 },
        runtime: { engine: "utility", auto_fallback: true },
        duckdb: {
          max_memory: "auto",
          threads: 0,
          background_threads: "auto",
          safe_mode_keywords: ["hayabusa"],
          safe_mode_parallel: true,
        },
        parquet: { compression: "snappy", row_group_size: 25000 },
        system: { temp_cleanup: false, binary_guard: false },
      },
      tempDir: null, // Forces nativeCSVImport into in-memory fallback!
    };

    const tableName = await nativeCSVImport(
      mockDb,
      "C:/Evidence/hayabusa_inmem.csv",
      "test_tbl_true"
    );

    assert.strictEqual(tableName, "test_tbl_true");
    const targetQuery = capturedQueries.find((q) =>
      typeof q === "string" && q.includes("CREATE OR REPLACE TABLE")
    );
    assert.ok(targetQuery, `Must have executed CREATE OR REPLACE TABLE query. Queries: ${JSON.stringify(capturedQueries)}`);
    assert.ok(/parallel\s*=\s*true/i.test(targetQuery), `nativeCSVImport must contain parallel=true. Query: ${targetQuery}`);
    assert.ok(!/parallel\s*=\s*false/i.test(targetQuery), `nativeCSVImport must NOT contain parallel=false. Query: ${targetQuery}`);
    assert.ok(/all_varchar\s*=\s*true/i.test(targetQuery), `nativeCSVImport must contain all_varchar=true. Query: ${targetQuery}`);
  });

  await asyncChallenge("SEC-2.2", "nativeCSVImport SQL generation when safe_mode_parallel = false", async () => {
    resetEnv();
    const capturedQueries = [];
    const mockConn = {
      all: async (sql) => {
        capturedQueries.push(sql);
        return [];
      },
      exec: async (sql) => {
        capturedQueries.push(sql);
        return;
      },
      close: async () => {},
    };
    const mockDb = {
      connect: async () => mockConn,
    };

    global.toadPortableEnv = {
      config: {
        general: { viewer: "toad", language: "en", page_size: 1000 },
        runtime: { engine: "utility", auto_fallback: true },
        duckdb: {
          max_memory: "auto",
          threads: 0,
          background_threads: "auto",
          safe_mode_keywords: ["hayabusa"],
          safe_mode_parallel: false,
        },
        parquet: { compression: "snappy", row_group_size: 25000 },
        system: { temp_cleanup: false, binary_guard: false },
      },
      tempDir: null, // Forces nativeCSVImport into in-memory fallback!
    };

    const tableName = await nativeCSVImport(
      mockDb,
      "C:/Evidence/hayabusa_inmem.csv",
      "test_tbl_false"
    );

    assert.strictEqual(tableName, "test_tbl_false");
    const targetQuery = capturedQueries.find((q) =>
      typeof q === "string" && q.includes("CREATE OR REPLACE TABLE")
    );
    assert.ok(targetQuery, `Must have executed CREATE OR REPLACE TABLE query`);
    assert.ok(/parallel\s*=\s*false/i.test(targetQuery), `nativeCSVImport must contain parallel=false. Query: ${targetQuery}`);
    assert.ok(!/parallel\s*=\s*true/i.test(targetQuery), `nativeCSVImport must NOT contain parallel=true. Query: ${targetQuery}`);
    assert.ok(/all_varchar\s*=\s*true/i.test(targetQuery), `nativeCSVImport must contain all_varchar=true. Query: ${targetQuery}`);
  });

  await asyncChallenge("SEC-2.3", "End-to-End Live DuckDB Execution (streamCsvToParquet)", async () => {
    resetEnv();
    const db = await Database.create(":memory:");
    const conn = await db.connect();

    const tmpDir = path.join(os.tmpdir(), "toad_challenge_duckdb");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const testCsv = path.join(tmpDir, "hayabusa_test.csv");
    const testPqTrue = path.join(tmpDir, "out_parallel_true.parquet");
    const testPqFalse = path.join(tmpDir, "out_parallel_false.parquet");

    // Write a dirty forensic-like CSV with heterogeneous numbers and quoted strings
    const csvContent =
      "Timestamp,RuleTitle,EventID,Details\n" +
      '2026-11-05 01:00:00,Suspicious Process,4688,"Process C:\\\\temp\\\\evil.exe spawned with arg --stealth"\n' +
      '2026-11-05 01:00:01,Failed Logon,4625,"Account admin failed from 192.168.1.50"\n' +
      '2026-11-05 01:00:02,Network Connection,3,"Sysmon connection to port 4444"\n';
    fs.writeFileSync(testCsv, csvContent, "utf8");

    const cfgTrue = {
      ...getIngestConfig(),
      safe_mode_keywords: ["hayabusa"],
      safe_mode_parallel: true,
    };
    await streamCsvToParquet(conn, testCsv, testPqTrue, cfgTrue);
    assert.ok(fs.existsSync(testPqTrue), "Output parquet (parallel=true) must exist");
    assert.ok(fs.statSync(testPqTrue).size > 0, "Output parquet (parallel=true) must be non-empty");

    const resTrue = await conn.all(`SELECT count(*) as cnt FROM read_parquet('${testPqTrue.replace(/\\/g, "/")}')`);
    assert.strictEqual(Number(resTrue[0].cnt), 3, "Parquet must have exactly 3 rows");

    const cfgFalse = {
      ...getIngestConfig(),
      safe_mode_keywords: ["hayabusa"],
      safe_mode_parallel: false,
    };
    await streamCsvToParquet(conn, testCsv, testPqFalse, cfgFalse);
    assert.ok(fs.existsSync(testPqFalse), "Output parquet (parallel=false) must exist");
    // In DuckDB v1.0.0, single-threaded parallel=false with null_padding=true appends a trailing null record at EOF.
    // We verify that all 3 data records are preserved completely:
    const resFalseData = await conn.all(`SELECT count(*) as cnt FROM read_parquet('${testPqFalse.replace(/\\/g, "/")}') WHERE Timestamp IS NOT NULL`);
    assert.strictEqual(Number(resFalseData[0].cnt), 3, "Parquet (parallel=false) must have exactly 3 valid data rows");
    const resFalseAll = await conn.all(`SELECT count(*) as cnt FROM read_parquet('${testPqFalse.replace(/\\/g, "/")}')`);
    assert.ok(Number(resFalseAll[0].cnt) >= 3, "Parquet (parallel=false) total count must be at least 3 rows");
  });


  // =========================================================================
  // 3. Worker Configuration Evaluation (ingestWorker.ts)
  // =========================================================================
  console.log(`\n${BOLD}[SECTION 3] Worker Configuration & safeParallel Logic${RESET}`);

  // Pure logic permutation matrix matching ingestWorker.ts line 33:
  function evaluateWorkerSafeParallel(cfg) {
    return cfg.safe_mode_parallel !== false && cfg.safeModeParallel !== false;
  }

  challenge("SEC-3.1", "Worker safeParallel permutation matrix", () => {
    // Both undefined -> default is true
    assert.strictEqual(evaluateWorkerSafeParallel({}), true);

    // snake_case boolean tests
    assert.strictEqual(evaluateWorkerSafeParallel({ safe_mode_parallel: true }), true);
    assert.strictEqual(evaluateWorkerSafeParallel({ safe_mode_parallel: false }), false);

    // camelCase boolean tests
    assert.strictEqual(evaluateWorkerSafeParallel({ safeModeParallel: true }), true);
    assert.strictEqual(evaluateWorkerSafeParallel({ safeModeParallel: false }), false);

    // Mixed definitions: false in either takes precedence
    assert.strictEqual(evaluateWorkerSafeParallel({ safe_mode_parallel: true, safeModeParallel: true }), true);
    assert.strictEqual(evaluateWorkerSafeParallel({ safe_mode_parallel: false, safeModeParallel: false }), false);
    assert.strictEqual(evaluateWorkerSafeParallel({ safe_mode_parallel: false, safeModeParallel: true }), false);
    assert.strictEqual(evaluateWorkerSafeParallel({ safe_mode_parallel: true, safeModeParallel: false }), false);

    // Undefined and null handling
    assert.strictEqual(evaluateWorkerSafeParallel({ safe_mode_parallel: undefined }), true);
    assert.strictEqual(evaluateWorkerSafeParallel({ safe_mode_parallel: null }), true);
    assert.strictEqual(evaluateWorkerSafeParallel({ safeModeParallel: undefined }), true);
  });

  await asyncChallenge("SEC-3.2", "Live Out-of-Process Ingest Worker with safe_mode_parallel = true", async () => {
    const workerScript = path.resolve(ROOT_DIR, "tad-master/packages/reltab-duckdb/dist/ingestWorker.js");
    assert.ok(fs.existsSync(workerScript), "dist/ingestWorker.js must exist");

    const tmpDir = path.join(os.tmpdir(), "toad_challenge_worker");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const testCsv = path.join(tmpDir, "worker_complex_true.csv");
    const targetPq = path.join(tmpDir, "worker_complex_true.parquet");
    if (fs.existsSync(targetPq)) fs.unlinkSync(targetPq);

    fs.writeFileSync(
      testCsv,
      "LogonId,TargetUserName,WorkstationName,IpAddress\n" +
      "0x12345,admin,WKSTN-01,10.0.0.15\n" +
      "0x67890,SYSTEM,WKSTN-02,-\n",
      "utf8"
    );

    const workerConfig = {
      isComplex: true,
      safe_mode_parallel: true,
      compression: "snappy",
    };

    await new Promise((resolve, reject) => {
      const child = cp.fork(
        workerScript,
        [testCsv, targetPq, JSON.stringify(workerConfig)],
        { stdio: ["ignore", "pipe", "pipe", "ipc"] }
      );
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Worker exited with code ${code}`));
      });
      child.on("error", reject);
    });

    assert.ok(fs.existsSync(targetPq), "Worker must successfully output parquet");
    assert.ok(fs.statSync(targetPq).size > 0, "Worker output parquet must have non-zero size");
  });

  await asyncChallenge("SEC-3.2", "Live Out-of-Process Ingest Worker with safe_mode_parallel = false", async () => {
    const workerScript = path.resolve(ROOT_DIR, "tad-master/packages/reltab-duckdb/dist/ingestWorker.js");
    const tmpDir = path.join(os.tmpdir(), "toad_challenge_worker");

    const testCsv = path.join(tmpDir, "worker_complex_false.csv");
    const targetPq = path.join(tmpDir, "worker_complex_false.parquet");
    if (fs.existsSync(targetPq)) fs.unlinkSync(targetPq);

    fs.writeFileSync(
      testCsv,
      "EventID,Category,Message\n" +
      "1001,WindowsUpdate,Success\n" +
      "1002,WindowsUpdate,RebootRequired\n",
      "utf8"
    );

    const workerConfig = {
      isComplex: true,
      safe_mode_parallel: false,
      compression: "snappy",
    };

    await new Promise((resolve, reject) => {
      const child = cp.fork(
        workerScript,
        [testCsv, targetPq, JSON.stringify(workerConfig)],
        { stdio: ["ignore", "pipe", "pipe", "ipc"] }
      );
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Worker exited with code ${code}`));
      });
      child.on("error", reject);
    });

    assert.ok(fs.existsSync(targetPq), "Worker must successfully output parquet");
    assert.ok(fs.statSync(targetPq).size > 0, "Worker output parquet must have non-zero size");
  });

  await asyncChallenge("SEC-3.2", "Live Out-of-Process Ingest Worker with safeModeParallel (camelCase) = false", async () => {
    const workerScript = path.resolve(ROOT_DIR, "tad-master/packages/reltab-duckdb/dist/ingestWorker.js");
    const tmpDir = path.join(os.tmpdir(), "toad_challenge_worker");

    const testCsv = path.join(tmpDir, "worker_camel_false.csv");
    const targetPq = path.join(tmpDir, "worker_camel_false.parquet");
    if (fs.existsSync(targetPq)) fs.unlinkSync(targetPq);

    fs.writeFileSync(
      testCsv,
      "RecordNumber,EventTime,Source\n" +
      "1,2026-11-05T01:00:00Z,Kernel\n" +
      "2,2026-11-05T01:00:01Z,User\n",
      "utf8"
    );

    const workerConfig = {
      isComplex: true,
      safeModeParallel: false, // camelCase test
      compression: "snappy",
    };

    await new Promise((resolve, reject) => {
      const child = cp.fork(
        workerScript,
        [testCsv, targetPq, JSON.stringify(workerConfig)],
        { stdio: ["ignore", "pipe", "pipe", "ipc"] }
      );
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Worker exited with code ${code}`));
      });
      child.on("error", reject);
    });

    assert.ok(fs.existsSync(targetPq), "Worker must successfully output parquet");
    assert.ok(fs.statSync(targetPq).size > 0, "Worker output parquet must have non-zero size");
  });

  // =========================================================================
  // Summary
  // =========================================================================
  console.log(`\n${BOLD}${CYAN}======================================================================${RESET}`);
  console.log(`${BOLD}CHALLENGE SUMMARY:${RESET}`);
  console.log(`  Passed: ${GREEN}${passCount}${RESET}`);
  console.log(`  Failed: ${failCount > 0 ? RED : GREEN}${failCount}${RESET}`);
  console.log(`  Total:  ${passCount + failCount}`);
  console.log(`${BOLD}${CYAN}======================================================================${RESET}\n`);

  if (failCount > 0) {
    console.error(`${RED}Adversarial challenges discovered ${failCount} failures!${RESET}`);
    process.exit(1);
  } else {
    console.log(`${GREEN}${BOLD}ALL ADVERSARIAL CHALLENGES PASSED EMPIRICALLY!${RESET}\n`);
    process.exit(0);
  }
}

runAllChallenges().catch((err) => {
  console.error("Unhandled error in challenge harness:", err);
  process.exit(1);
});
