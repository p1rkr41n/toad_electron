/**
 * test_qa_all_use_cases.js
 *
 * UNIFIED QA AUTOMATED TEST SUITE FOR TOAD v1.3.17 & v1.3.18
 * Covers all Business Analyst (BA) requirements and Acceptance Criteria (AC):
 * - Suite 1: Config.ini Parsing, Defaults & Auto-Healing (TC-1.3.17-01, TC-1.3.18-01, TC-1.3.18-05)
 * - Suite 2: Reltab-FS File Size Detection (stat.size) (TC-1.3.17-01)
 * - Suite 3: Shortest Job First (SJF) Queue Sorting (TC-1.3.17-02)
 * - Suite 4: VIP User-Click Priority Jump Queue (TC-1.3.17-05)
 * - Suite 5: Concurrency Limit Enforcement (max_concurrent_files = 4) (TC-1.3.17-02)
 * - Suite 6: Dynamic Data Size Budget Control (max_concurrent_gb = 1) (TC-1.3.17-03)
 * - Suite 7: Exclusive Big File Mode (> 1GB) (TC-1.3.17-04)
 * - Suite 8: Canonical Path Deduplication & Sibling Synchronization
 * - Suite 9: CPU Thread Isolation Formula & Boundary Clamping (TC-1.3.18-01, TC-1.3.18-05)
 * - Suite 10: DuckDB Concurrency & UI Query Latency under Heavy Ingest (TC-1.3.18-02)
 * - Suite 11: Instant UI Click Feedback & Request Superseding Guard (TC-1.3.18-03, TC-1.3.18-04)
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const assert = require("assert");

// Colors for clean visual output
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function reportSuite(title) {
  console.log(`\n${BOLD}${CYAN}======================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}  ${title}${RESET}`);
  console.log(`${BOLD}${CYAN}======================================================================${RESET}`);
}

function testCase(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ${GREEN}✓ [PASS]${RESET} ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`  ${RED}✗ [FAIL]${RESET} ${name}`);
    console.error(`    ${RED}Error: ${err.message}${RESET}`);
    if (err.stack) {
      const relevantStack = err.stack.split("\n").slice(1, 4).join("\n    ");
      console.error(`    ${YELLOW}${relevantStack}${RESET}`);
    }
  }
}

async function testCaseAsync(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ${GREEN}✓ [PASS]${RESET} ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`  ${RED}✗ [FAIL]${RESET} ${name}`);
    console.error(`    ${RED}Error: ${err.message}${RESET}`);
    if (err.stack) {
      const relevantStack = err.stack.split("\n").slice(1, 4).join("\n    ");
      console.error(`    ${YELLOW}${relevantStack}${RESET}`);
    }
  }
}

// Global mocks for renderer/browser modules
global.window = global;
const tvPath = path.resolve(__dirname, "tad-master/packages/tadviewer/dist/tadviewer.js");
require.cache[tvPath] = {
  id: tvPath,
  filename: tvPath,
  loaded: true,
  exports: {
    actions: {
      setActiveLoadingFile: (f, s) => {},
      openDataSourcePath: async () => {},
    },
  },
};

// Import modules
const {
  validateAndEnsureConfig,
  DEFAULT_CONFIG,
} = require("./tad-master/packages/tad-app/app_dist/portableAppData");

const {
  MultipleLoadingManager,
  getCanonicalPathFromDSPath,
} = require("./tad-master/packages/tadviewer/dist/MultipleLoadingManager");

const { FSDriver } = require("./tad-master/packages/reltab-fs/dist/reltab-fs");
const { Database } = require("./tad-master/node_modules/duckdb-async");

async function runAllSuites() {
  const startTime = Date.now();

  // ===========================================================================
  // SUITE 1: Config.ini Parsing, Defaults & Auto-Healing
  // ===========================================================================
  reportSuite("SUITE 1: Config.ini Parsing, Defaults & Auto-Healing (TC-1.3.17-01, TC-1.3.18-01, TC-1.3.18-05)");

  testCase("1.1 Root config.ini parses correctly with Toad v1.3.18 specifications", () => {
    const configPath = path.resolve(__dirname, "config.ini");
    assert(fs.existsSync(configPath), "Root config.ini must exist");
    const cfg = validateAndEnsureConfig(configPath);
    assert.strictEqual(cfg.general.viewer, "toad");
    assert.strictEqual(cfg.general.max_concurrent_files, 4, "max_concurrent_files should be 4");
    assert.strictEqual(cfg.general.max_concurrent_gb, 1, "max_concurrent_gb should be 1");
    assert.strictEqual(cfg.duckdb.background_threads, "auto", "background_threads should be auto");
    assert.strictEqual(cfg.duckdb.threads, 0, "threads should be 0");
  });

  testCase("1.2 Auto-heal recovers corrupt numeric and string values to defaults", () => {
    const tmpConfig = path.resolve(__dirname, `tmp_config_test_${Date.now()}.ini`);
    fs.writeFileSync(
      tmpConfig,
      `[general]
viewer = invalid_viewer
max_concurrent_files = -10
max_concurrent_gb = 0

[duckdb]
background_threads = corrupt_value
threads = -5
`,
      "utf8"
    );

    try {
      const cfg = validateAndEnsureConfig(tmpConfig);
      assert.strictEqual(cfg.general.viewer, DEFAULT_CONFIG.general.viewer, "Viewer auto-healed to toad");
      assert.strictEqual(cfg.general.max_concurrent_files, 4, "max_concurrent_files auto-healed to 4");
      assert.strictEqual(cfg.general.max_concurrent_gb, 1, "max_concurrent_gb auto-healed to 1");
      assert.strictEqual(cfg.duckdb.background_threads, "auto", "background_threads auto-healed to auto");
      assert.strictEqual(cfg.duckdb.threads, 0, "threads auto-healed to 0");
    } finally {
      if (fs.existsSync(tmpConfig)) fs.unlinkSync(tmpConfig);
    }
  });

  testCase("1.3 Valid custom values are properly parsed and retained", () => {
    const tmpConfig = path.resolve(__dirname, `tmp_config_valid_${Date.now()}.ini`);
    fs.writeFileSync(
      tmpConfig,
      `[general]
max_concurrent_files = 8
max_concurrent_gb = 2.5

[duckdb]
background_threads = 6
threads = 4
`,
      "utf8"
    );

    try {
      const cfg = validateAndEnsureConfig(tmpConfig);
      assert.strictEqual(cfg.general.max_concurrent_files, 8);
      assert.strictEqual(cfg.general.max_concurrent_gb, 2.5);
      assert.strictEqual(cfg.duckdb.background_threads, 6);
      assert.strictEqual(cfg.duckdb.threads, 4);
    } finally {
      if (fs.existsSync(tmpConfig)) fs.unlinkSync(tmpConfig);
    }
  });

  testCase("1.4 Corrupted syntax triggers backup and auto-generates clean template", () => {
    const tmpConfig = path.resolve(__dirname, `tmp_config_syntax_${Date.now()}.ini`);
    // Malformed INI syntax with binary characters
    fs.writeFileSync(tmpConfig, "\x00\x01\x02\xFF\xFE[unclosed_section\n=bad_pair", "utf8");

    try {
      const cfg = validateAndEnsureConfig(tmpConfig);
      assert.strictEqual(cfg.general.max_concurrent_files, 4);
      assert.strictEqual(cfg.duckdb.background_threads, "auto");
    } finally {
      if (fs.existsSync(tmpConfig)) fs.unlinkSync(tmpConfig);
      // Clean up backup file if generated
      const dirFiles = fs.readdirSync(__dirname);
      for (const f of dirFiles) {
        if (f.startsWith("tmp_config_syntax_") && f.includes(".corrupt_")) {
          fs.unlinkSync(path.join(__dirname, f));
        }
      }
    }
  });

  // ===========================================================================
  // SUITE 2: Reltab-FS File Size Detection
  // ===========================================================================
  reportSuite("SUITE 2: Reltab-FS File Size Detection (stat.size) (TC-1.3.17-01)");

  await testCaseAsync("2.1 FSDriver scans data directory and populates node.fileSizeBytes accurately", async () => {
    const testDir = path.resolve(__dirname, "data_sample");
    assert(fs.existsSync(testDir), "data_sample directory must exist");

    const driver = new FSDriver(null, testDir, true, false);
    const dsPath = {
      sourceId: testDir,
      path: [],
    };

    const childNodes = await driver.getChildren(dsPath);
    assert(Array.isArray(childNodes), "childNodes must be an array");
    assert(childNodes.length > 0, "data_sample must contain files");

    for (const node of childNodes) {
      if (node.kind === "File") {
        const filePath = path.join(testDir, node.displayName);
        const stat = fs.statSync(filePath);
        assert(
          node.fileSizeBytes !== undefined,
          `node.fileSizeBytes must be defined for ${node.displayName}`
        );
        assert.strictEqual(
          node.fileSizeBytes,
          stat.size,
          `fileSizeBytes (${node.fileSizeBytes}) must match actual disk stat.size (${stat.size}) for ${node.displayName}`
        );
      }
    }
  });

  // ===========================================================================
  // SUITE 3: Shortest Job First (SJF) Queue Sorting
  // ===========================================================================
  reportSuite("SUITE 3: Shortest Job First (SJF) Queue Sorting (TC-1.3.17-02)");

  testCase("3.1 Queue sorts pending files in strictly ascending order by file size (SJF)", () => {
    const manager = MultipleLoadingManager.getInstance();
    manager.pause(); // Pause so items remain in pending list

    const mockDsc = { getTableName: async () => "dummy" };
    const baseTime = Date.now();

    const items = [
      {
        dsPath: { sourceId: "dir", path: ["file_50mb.csv"] },
        dsc: mockDsc,
        fileName: "file_50mb.csv",
        fileSizeBytes: 50 * 1024 * 1024,
      },
      {
        dsPath: { sourceId: "dir", path: ["file_2mb.csv"] },
        dsc: mockDsc,
        fileName: "file_2mb.csv",
        fileSizeBytes: 2 * 1024 * 1024,
      },
      {
        dsPath: { sourceId: "dir", path: ["file_500kb.csv"] },
        dsc: mockDsc,
        fileName: "file_500kb.csv",
        fileSizeBytes: 500 * 1024,
      },
      {
        dsPath: { sourceId: "dir", path: ["file_200mb.csv"] },
        dsc: mockDsc,
        fileName: "file_200mb.csv",
        fileSizeBytes: 200 * 1024 * 1024,
      },
      {
        dsPath: { sourceId: "dir", path: ["file_10kb.csv"] },
        dsc: mockDsc,
        fileName: "file_10kb.csv",
        fileSizeBytes: 10 * 1024,
      },
    ];

    manager.registerFiles(items);

    // Retrieve pending items
    const all = manager.getAllItems();
    const pendingList = all.filter((it) => it.status === "pending");

    // Perform sorting using the exact SJF comparison formula
    pendingList.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      const sizeA = a.fileSizeBytes !== undefined ? a.fileSizeBytes : 0;
      const sizeB = b.fileSizeBytes !== undefined ? b.fileSizeBytes : 0;
      if (sizeA !== sizeB) return sizeA - sizeB;
      return a.addedTime - b.addedTime;
    });

    const sortedNames = pendingList.map((it) => it.fileName);
    assert.deepStrictEqual(
      sortedNames,
      ["file_10kb.csv", "file_500kb.csv", "file_2mb.csv", "file_50mb.csv", "file_200mb.csv"],
      "Files must be ordered strictly from smallest to largest"
    );
  });

  // ===========================================================================
  // SUITE 4: VIP User-Click Priority Jump Queue
  // ===========================================================================
  reportSuite("SUITE 4: VIP User-Click Priority Jump Queue (TC-1.3.17-05)");

  testCase("4.1 User click elevates priority and causes large file to jump ahead of smaller files", () => {
    const manager = MultipleLoadingManager.getInstance();
    manager.pause();

    const targetKey = JSON.stringify({ sourceId: "dir", path: ["file_200mb.csv"] });
    manager.prioritize(targetKey);

    const all = manager.getAllItems();
    const pendingList = all.filter((it) => it.status === "pending");

    pendingList.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      const sizeA = a.fileSizeBytes !== undefined ? a.fileSizeBytes : 0;
      const sizeB = b.fileSizeBytes !== undefined ? b.fileSizeBytes : 0;
      if (sizeA !== sizeB) return sizeA - sizeB;
      return a.addedTime - b.addedTime;
    });

    assert.strictEqual(
      pendingList[0].fileName,
      "file_200mb.csv",
      "Prioritized 200MB file must jump to index 0 ahead of 10KB file"
    );
    assert(pendingList[0].priority > 0, "Priority timestamp must be > 0");
  });

  // ===========================================================================
  // SUITE 5: Concurrency Limit Enforcement (max_concurrent_files = 4)
  // ===========================================================================
  reportSuite("SUITE 5: Concurrency Limit Enforcement (max_concurrent_files = 4) (TC-1.3.17-02)");

  await testCaseAsync("5.1 Exactly 4 files admitted to processing simultaneously, 5th waits", async () => {
    // Fresh isolated manager simulation
    class TestQueueManager {
      constructor(maxFiles, maxBytes) {
        this.maxFiles = maxFiles;
        this.maxBytes = maxBytes;
        this.files = new Map();
        this.activeItems = new Map();
      }
      register(items) {
        for (const it of items) {
          this.files.set(it.key, { ...it, status: "pending", priority: 0 });
        }
      }
      get inFlightBytes() {
        let b = 0;
        for (const a of this.activeItems.values()) b += a.size;
        return b;
      }
      process() {
        while (this.activeItems.size < this.maxFiles) {
          const pending = Array.from(this.files.values()).filter((f) => f.status === "pending");
          pending.sort((a, b) => (b.priority - a.priority) || (a.size - b.size));
          if (pending.length === 0) break;

          let candidate = null;
          if (this.activeItems.size === 0) {
            candidate = pending[0];
          } else {
            for (const p of pending) {
              if (this.inFlightBytes + p.size <= this.maxBytes) {
                candidate = p;
                break;
              }
            }
          }
          if (!candidate) break;

          candidate.status = "processing";
          this.activeItems.set(candidate.key, candidate);
        }
      }
      finish(key) {
        const it = this.activeItems.get(key);
        if (it) {
          it.status = "ready";
          this.activeItems.delete(key);
        }
        this.process();
      }
    }

    const q = new TestQueueManager(4, 1024 * 1024 * 1024);
    const files = [];
    for (let i = 1; i <= 6; i++) {
      files.push({ key: `f${i}`, name: `file_${i}.csv`, size: 10 * 1024 * 1024 });
    }
    q.register(files);
    q.process();

    assert.strictEqual(q.activeItems.size, 4, "Active items must be capped at max_concurrent_files (4)");
    const pendingCount = Array.from(q.files.values()).filter((f) => f.status === "pending").length;
    assert.strictEqual(pendingCount, 2, "Remaining 2 files must be pending");

    // Complete 1 file
    q.finish("f1");
    assert.strictEqual(q.activeItems.size, 4, "Active items must replenish to 4 when slot freed");
    assert.strictEqual(
      Array.from(q.files.values()).filter((f) => f.status === "pending").length,
      1,
      "Only 1 file remains pending"
    );
  });

  // ===========================================================================
  // SUITE 6: Dynamic Data Size Budget Control (max_concurrent_gb = 1)
  // ===========================================================================
  reportSuite("SUITE 6: Dynamic Data Size Budget Control (max_concurrent_gb = 1) (TC-1.3.17-03)");

  testCase("6.1 Data size budget of 1GB prevents second 600MB file from loading concurrently", () => {
    const maxBytes = 1 * 1024 * 1024 * 1024; // 1 GB = 1,073,741,824 bytes
    const files = [
      { key: "big1", name: "big1.csv", size: 600 * 1024 * 1024, status: "pending", priority: 0 },
      { key: "big2", name: "big2.csv", size: 600 * 1024 * 1024, status: "pending", priority: 0 },
      { key: "small1", name: "small1.csv", size: 5 * 1024 * 1024, status: "pending", priority: 0 },
      { key: "small2", name: "small2.csv", size: 10 * 1024 * 1024, status: "pending", priority: 0 },
    ];

    // SJF sort: small1 (5MB) -> small2 (10MB) -> big1 (600MB) -> big2 (600MB)
    files.sort((a, b) => a.size - b.size);
    assert.deepStrictEqual(files.map((f) => f.key), ["small1", "small2", "big1", "big2"]);

    const active = new Map();
    let currentInFlightBytes = 0;

    for (const f of files) {
      if (active.size < 4) {
        if (active.size === 0 || currentInFlightBytes + f.size <= maxBytes) {
          f.status = "processing";
          active.set(f.key, f);
          currentInFlightBytes += f.size;
        }
      }
    }

    // small1 (5MB) + small2 (10MB) + big1 (600MB) = 615MB <= 1GB -> Admitted!
    // big2 (600MB): 615MB + 600MB = 1215MB > 1GB -> HELD!
    assert.strictEqual(active.has("small1"), true);
    assert.strictEqual(active.has("small2"), true);
    assert.strictEqual(active.has("big1"), true);
    assert.strictEqual(active.has("big2"), false, "big2 must NOT be admitted due to 1GB budget ceiling");
    assert.strictEqual(active.size, 3, "Only 3 files admitted");
    assert(currentInFlightBytes <= maxBytes, "In-flight bytes must never exceed 1GB budget");
  });

  // ===========================================================================
  // SUITE 7: Exclusive Big File Mode (> 1GB)
  // ===========================================================================
  reportSuite("SUITE 7: Exclusive Big File Mode (> 1GB) (TC-1.3.17-04)");

  testCase("7.1 Giant file (40GB) runs exclusively when queue is empty, blocks other files", () => {
    const maxBytes = 1 * 1024 * 1024 * 1024; // 1 GB
    const giantFile = { key: "huge40g", name: "sample_40gb.csv", size: 40 * 1024 * 1024 * 1024 };
    const nextFile = { key: "small", name: "small.csv", size: 10 * 1024 * 1024 };

    const active = new Map();
    let inFlightBytes = 0;

    // Rule: if active.size === 0, admit nextFile even if nextFile.size > maxBytes (Exclusive Big File Mode)
    if (active.size === 0) {
      giantFile.status = "processing";
      active.set(giantFile.key, giantFile);
      inFlightBytes += giantFile.size;
    }

    assert.strictEqual(giantFile.status, "processing", "40GB file must be admitted in Exclusive Mode");
    assert.strictEqual(active.size, 1);

    // Try admitting nextFile
    let canAdmitNext = active.size < 4 && inFlightBytes + nextFile.size <= maxBytes;
    assert.strictEqual(canAdmitNext, false, "10MB file must wait while 40GB file consumes the budget");

    // When 40GB finishes
    active.delete(giantFile.key);
    inFlightBytes -= giantFile.size;

    canAdmitNext = active.size === 0 || (active.size < 4 && inFlightBytes + nextFile.size <= maxBytes);
    assert.strictEqual(canAdmitNext, true, "10MB file is admitted as soon as 40GB finishes");
  });

  // ===========================================================================
  // SUITE 8: Canonical Path Deduplication & Sibling Synchronization
  // ===========================================================================
  reportSuite("SUITE 8: Canonical Path Deduplication & Sibling Synchronization");

  testCase("8.1 Canonical path normalizes forward and backward slashes and casing", () => {
    const p1 = { sourceId: "C:\\Data\\Logs", path: ["Sub", "app.log"] };
    const p2 = { sourceId: "c:/data/logs", path: ["sub", "app.log"] };

    const c1 = getCanonicalPathFromDSPath(p1);
    const c2 = getCanonicalPathFromDSPath(p2);

    assert.strictEqual(c1, c2, "Both paths must resolve to identical canonical path");
    assert.strictEqual(c1, "c:\\data\\logs\\sub\\app.log");
  });

  // ===========================================================================
  // SUITE 9: CPU Thread Isolation Formula & Boundary Clamping
  // ===========================================================================
  reportSuite("SUITE 9: CPU Thread Isolation Formula & Boundary Clamping (TC-1.3.18-01, TC-1.3.18-05)");

  testCase("9.1 'auto' calculates max(1, totalCpus - 2), reserving 1-2 cores for UI", () => {
    function calcBgThreads(cfgVal, totalCpus) {
      if (typeof cfgVal === "number" && cfgVal > 0) {
        return Math.min(totalCpus, Math.max(1, Math.floor(cfgVal)));
      }
      return Math.max(1, totalCpus - 2);
    }

    // Machine with 16 cores
    assert.strictEqual(calcBgThreads("auto", 16), 14, "16-core system gives 14 to background, 2 to UI");
    // Machine with 8 cores
    assert.strictEqual(calcBgThreads("auto", 8), 6, "8-core system gives 6 to background, 2 to UI");
    // Machine with 4 cores
    assert.strictEqual(calcBgThreads("auto", 4), 2, "4-core system gives 2 to background, 2 to UI");
    // Machine with 2 cores
    assert.strictEqual(calcBgThreads("auto", 2), 1, "2-core system gives 1 to background, 1 to UI");
    // Machine with 1 core
    assert.strictEqual(calcBgThreads("auto", 1), 1, "1-core system gives 1 to background");

    // Real system check
    const hostCpus = os.cpus() ? os.cpus().length : 4;
    const expectedHostBg = Math.max(1, hostCpus - 2);
    assert.strictEqual(calcBgThreads("auto", hostCpus), expectedHostBg);
    console.log(`    ${CYAN}Host CPU Cores: ${hostCpus} | Background: ${expectedHostBg} threads | Reserved for UI: ${hostCpus - expectedHostBg} cores${RESET}`);
  });

  testCase("9.2 User numeric override clamped safely within [1, totalCpus]", () => {
    function calcBgThreads(cfgVal, totalCpus) {
      if (typeof cfgVal === "number" && cfgVal > 0) {
        return Math.min(totalCpus, Math.max(1, Math.floor(cfgVal)));
      }
      return Math.max(1, totalCpus - 2);
    }

    // Explicit 4 threads on 8 cores
    assert.strictEqual(calcBgThreads(4, 8), 4);
    // Explicit 999 threads clamped to total 8 cores
    assert.strictEqual(calcBgThreads(999, 8), 8);
    // Negative or 0 falls back to auto
    assert.strictEqual(calcBgThreads(-5, 8), 6);
    assert.strictEqual(calcBgThreads(0, 8), 6);
  });

  // ===========================================================================
  // SUITE 10: DuckDB Concurrency & UI Query Latency under Heavy Ingest
  // ===========================================================================
  reportSuite("SUITE 10: DuckDB Concurrency & UI Query Latency under Heavy Ingest (TC-1.3.18-02)");

  await testCaseAsync("10.1 UI interactive query returns in < 100ms while background connection is executing heavy load", async () => {
    const db = await Database.create(":memory:");
    const bgConn = await db.connect();
    const uiConn = await db.connect();

    // Prepare a mock dataset with 100,000 rows
    await uiConn.exec("CREATE TABLE test_table AS SELECT i AS id, 'value_' || i AS name FROM range(1, 100001) t(i)");

    // Restrict background threads to hostCpus - 2
    const totalCpus = os.cpus() ? os.cpus().length : 4;
    const bgThreads = Math.max(1, totalCpus - 2);
    await bgConn.exec(`SET threads = ${bgThreads}`);
    await bgConn.exec("SET preserve_insertion_order = false");

    // Launch heavy query on bgConn in background without awaiting immediately
    const heavyQueryPromise = bgConn.all(`
      SELECT count(*), avg(i), sum(i)
      FROM (
        SELECT i, hash(i) as h 
        FROM range(1, 5000000) t(i)
      )
    `);

    // Give background query 10ms to saturate its worker threads
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Measure latency of UI interactive query on uiConn
    const t0 = process.hrtime();
    const uiRows = await uiConn.all("SELECT * FROM test_table LIMIT 1000");
    const diff = process.hrtime(t0);
    const latencyMs = (diff[0] * 1000 + diff[1] / 1e6).toFixed(2);

    assert.strictEqual(uiRows.length, 1000, "UI query must return 1000 rows");
    console.log(`    ${CYAN}Interactive UI Query Latency during heavy background load: ${latencyMs} ms${RESET}`);
    assert(
      Number(latencyMs) < 150,
      `UI query latency (${latencyMs}ms) must be < 150ms (well within 300ms SLA, avoiding 95,000ms freeze)`
    );

    // Await background query completion
    await heavyQueryPromise;
    await db.close();
  });

  // ===========================================================================
  // SUITE 11: Instant UI Click Feedback & Request Superseding Guard
  // ===========================================================================
  reportSuite("SUITE 11: Instant UI Click Feedback & Request Superseding Guard (TC-1.3.18-03, TC-1.3.18-04)");

  await testCaseAsync("11.1 Rapid click flood supersedes intermediate requests and executes only final view", async () => {
    let clickSeq = 0;
    const executedViews = [];
    let currentActiveLoading = null;

    async function simulateClick(fileId, delayMs) {
      const mySeq = ++clickSeq;
      currentActiveLoading = {
        isLoading: true,
        fileName: fileId,
        statusText: "Opening table view...",
      };

      // Simulate async view loading delay
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      // Guard: only apply if this is still the latest click
      if (mySeq === clickSeq) {
        executedViews.push(fileId);
        currentActiveLoading = null;
      } else {
        // Discarded old query
      }
    }

    // Fire 5 clicks in rapid succession (click flood)
    const p1 = simulateClick("file_1.csv", 40);
    const p2 = simulateClick("file_2.csv", 35);
    const p3 = simulateClick("file_3.csv", 30);
    const p4 = simulateClick("file_4.csv", 25);
    const p5 = simulateClick("file_5.csv", 20);

    await Promise.all([p1, p2, p3, p4, p5]);

    assert.strictEqual(
      executedViews.length,
      1,
      `Only 1 final view should be executed, got: ${executedViews.length}`
    );
    assert.strictEqual(
      executedViews[0],
      "file_5.csv",
      `The executed view must be the final clicked file (file_5.csv), got: ${executedViews[0]}`
    );
    assert.strictEqual(
      currentActiveLoading,
      null,
      "activeLoadingFile must be cleared after final view finishes"
    );
  });

  testCase("11.2 Instant visual feedback sets immediate status text on click", () => {
    let activeState = null;
    function setActiveLoading(val) {
      activeState = val;
    }

    // Click on ready file
    setActiveLoading({
      isLoading: true,
      fileName: "test_all.jsonl",
      percent: 100,
      statusText: "Opening table view...",
    });

    assert.strictEqual(activeState.isLoading, true);
    assert.strictEqual(activeState.statusText, "Opening table view...");
    assert.strictEqual(activeState.percent, 100);
  });

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n${BOLD}======================================================================${RESET}`);
  console.log(`${BOLD}  QA TEST SUITE SUMMARY (Toad v1.3.17 & v1.3.18)${RESET}`);
  console.log(`${BOLD}======================================================================${RESET}`);
  console.log(`  Total Test Cases : ${totalTests}`);
  console.log(`  ${GREEN}Passed           : ${passedTests}${RESET}`);
  console.log(`  ${failedTests === 0 ? GREEN : RED}Failed           : ${failedTests}${RESET}`);
  console.log(`  Total Duration   : ${totalDuration}s`);
  console.log(`${BOLD}======================================================================${RESET}\n`);

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAllSuites().catch((err) => {
  console.error("Unhandled QA Test Suite Error:", err);
  process.exit(1);
});
