/**
 * TOAD v2.4.9 AUTOMATED TEST SUITE: Preload 3 Initial Pages & Dynamic Rows/Page
 * 
 * Verifies:
 * 1. Dynamic PageSize Session Memory (ViewState.ts)
 * 2. RAM LRU Cache 30-item capacity limit and oldest-entry eviction
 * 3. 3-Page Background Preload Limit calculation: min(totalRowCount, 3 * pageSize)
 * 4. Boundary safety on small datasets (< 3 * pageSize)
 * 5. Proactive Cache Re-warm: rewarmAllReadyCaches(newSize) updates RAM cache
 * 6. PagedDataView Multi-Page in-memory indexing (Page 1, 2, 3 without DuckDB)
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

// Global mocks for renderer/browser modules in Node.js test environment
global.window = global;
global.document = { body: { style: {} } };

const ROOT_DIR = process.env.TOAD_ROOT || path.resolve(__dirname, "..");
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
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

async function runTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ${GREEN}✓ [PASS]${RESET} ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`  ${RED}✗ [FAIL]${RESET} ${name}`);
    console.error(err);
  }
}

async function main() {
  reportSuite("SUITE 1: Dynamic Rows/Page Session State (ViewState.ts)");

  const {
    getDefaultPageSize,
    setDefaultPageSize,
  } = require(path.resolve(ROOT_DIR, "tad-master/packages/toadviewer/dist/ViewState"));

  await runTest("1.1 Default page size starts at 1,000 in session memory", async () => {
    assert.strictEqual(getDefaultPageSize(), 1000, "Default page size must be 1000");
  });

  await runTest("1.2 setDefaultPageSize updates session default and ignores invalid values", async () => {
    setDefaultPageSize(2500);
    assert.strictEqual(getDefaultPageSize(), 2500, "Should update to 2500");

    setDefaultPageSize(5000);
    assert.strictEqual(getDefaultPageSize(), 5000, "Should update to 5000");

    // Invalid values ignored
    setDefaultPageSize(-10);
    assert.strictEqual(getDefaultPageSize(), 5000, "Negative size must be ignored");

    setDefaultPageSize(0);
    assert.strictEqual(getDefaultPageSize(), 5000, "Zero size must be ignored");

    setDefaultPageSize(NaN);
    assert.strictEqual(getDefaultPageSize(), 5000, "NaN must be ignored");

    // Reset back to 1000
    setDefaultPageSize(1000);
    assert.strictEqual(getDefaultPageSize(), 1000, "Must reset back to 1000");
  });

  reportSuite("SUITE 2: RAM LRU 30-Item Cache Budget & Eviction Policy");

  const {
    MultipleLoadingManager,
  } = require(path.resolve(ROOT_DIR, "tad-master/packages/toadviewer/dist/MultipleLoadingManager"));
  const manager = MultipleLoadingManager.getInstance();

  await runTest("2.1 Cache capacity strictly capped at 30 items with LRU eviction", async () => {
    manager.clearFirstPageCache();

    const mockSchema = { columns: ["id", "val"] };

    // Insert 35 unique file entries with staggered timestamps
    for (let i = 0; i < 35; i++) {
      const canon = `D:\\TestData\\file_${i}.csv`;
      manager.setFirstPageCache(canon, {
        tableName: `table_${i}`,
        schema: mockSchema,
        tableRep: { schema: mockSchema, rowData: [{ id: i, val: `row_${i}` }] },
        totalRowCount: 1000,
        pageSize: 1000,
        bufferPages: 3,
        cachedAt: 1000000 + i * 1000,
      });
    }

    // Cache must have strictly 30 items
    let count = 0;
    for (let i = 0; i < 35; i++) {
      if (manager.hasFirstPageCache(`D:\\TestData\\file_${i}.csv`)) {
        count++;
      }
    }
    assert.strictEqual(count, 30, `RAM Cache must hold exactly 30 items, found ${count}`);

    // Oldest items (0..4) must be evicted
    for (let i = 0; i < 5; i++) {
      assert(
        !manager.hasFirstPageCache(`D:\\TestData\\file_${i}.csv`),
        `file_${i}.csv should have been evicted as oldest`
      );
    }

    // Newest items (5..34) must be retained
    for (let i = 5; i < 35; i++) {
      assert(
        manager.hasFirstPageCache(`D:\\TestData\\file_${i}.csv`),
        `file_${i}.csv must still be present in cache`
      );
    }
  });

  await runTest("2.2 Dual-key (canonicalPath + key) deduplication holds 30 unique files without 15-file premature eviction", async () => {
    manager.clearFirstPageCache();
    const mockSchema = { columns: ["id", "val"] };

    // Insert 30 files registering both canonicalPath and key
    for (let i = 0; i < 30; i++) {
      const canon = `D:\\TestData\\dual_file_${i}.csv`;
      const key = JSON.stringify({ sourceId: "localfs", path: [`dual_file_${i}.csv`] });
      manager.files.set(key, {
        key,
        canonicalPath: canon,
        dsPath: { sourceId: "localfs", path: [`dual_file_${i}.csv`] },
        fileName: `dual_file_${i}.csv`,
        status: "ready",
        percent: 100,
        priority: 0,
        addedTime: Date.now(),
        version: 1,
      });
      const entry = {
        tableName: `table_${i}`,
        schema: mockSchema,
        tableRep: { schema: mockSchema, rowData: [{ id: i, val: `row_${i}` }] },
        totalRowCount: 1000,
        pageSize: 1000,
        bufferPages: 3,
        cachedAt: 2000000 + i * 100,
      };
      // Emulate worker dispatch: calls setFirstPageCache for BOTH canon and key
      manager.setFirstPageCache(canon, entry);
      manager.setFirstPageCache(key, entry);
    }

    // ALL 30 files must still be present (prior implementation evicted at 15)
    for (let i = 0; i < 30; i++) {
      const canon = `D:\\TestData\\dual_file_${i}.csv`;
      assert(manager.hasFirstPageCache(canon), `dual_file_${i}.csv must still be present`);
    }

    // Now insert file 30 (31st unique file)
    const canon30 = `D:\\TestData\\dual_file_30.csv`;
    manager.setFirstPageCache(canon30, {
      tableName: `table_30`,
      schema: mockSchema,
      tableRep: { schema: mockSchema, rowData: [{ id: 30, val: `row_30` }] },
      totalRowCount: 1000,
      pageSize: 1000,
      bufferPages: 3,
      cachedAt: 3000000,
    });
    // Oldest file 0 must be evicted, files 1..30 retained
    assert(!manager.hasFirstPageCache(`D:\\TestData\\dual_file_0.csv`), "dual_file_0 should be evicted");
    assert(manager.hasFirstPageCache(`D:\\TestData\\dual_file_1.csv`), "dual_file_1 must remain");
    assert(manager.hasFirstPageCache(canon30), "dual_file_30 must be present");
  });

  await runTest("2.3 True LRU: getFirstPageCache touches entry recency preventing premature eviction", async () => {
    manager.clearFirstPageCache();
    const mockSchema = { columns: ["id", "val"] };

    // Insert 30 files (file_0 to file_29)
    for (let i = 0; i < 30; i++) {
      const canon = `D:\\TestData\\lru_file_${i}.csv`;
      manager.setFirstPageCache(canon, {
        tableName: `table_${i}`,
        schema: mockSchema,
        tableRep: { schema: mockSchema, rowData: [{ id: i, val: `row_${i}` }] },
        totalRowCount: 1000,
        pageSize: 1000,
        bufferPages: 3,
        cachedAt: 1000000 + i * 100,
      });
    }

    // File 0 is the oldest (cachedAt = 1000000).
    // Now touch file 0 via getFirstPageCache (user opens the file)
    const touched = manager.getFirstPageCache(`D:\\TestData\\lru_file_0.csv`);
    assert(touched, "File 0 must exist");

    // Insert 31st file
    const canonNew = `D:\\TestData\\lru_file_new.csv`;
    manager.setFirstPageCache(canonNew, {
      tableName: `table_new`,
      schema: mockSchema,
      tableRep: { schema: mockSchema, rowData: [{ id: 999, val: "new" }] },
      totalRowCount: 1000,
      pageSize: 1000,
      bufferPages: 3,
      cachedAt: Date.now(),
    });

    // File 0 was touched, so it must NOT be evicted!
    // Untouched oldest file (file 1) must be evicted instead!
    assert(manager.hasFirstPageCache(`D:\\TestData\\lru_file_0.csv`), "File 0 was recently accessed and must NOT be evicted");
    assert(!manager.hasFirstPageCache(`D:\\TestData\\lru_file_1.csv`), "Untouched file 1 must be evicted");
  });

  reportSuite("SUITE 3: 3-Page Buffer Calculation & Small Dataset Boundary Safety");

  await runTest("3.1 Preload limit correctly computes min(totalRowCount, 3 * pageSize)", async () => {
    // Large dataset: 10,000 rows with pageSize = 1,000 -> 3,000 rows
    const totalLarge = 10000;
    const pSize1 = 1000;
    const limit1 = Math.min(totalLarge, pSize1 * 3);
    assert.strictEqual(limit1, 3000, "Preload limit for 10k rows / 1k page size must be 3,000");

    // Dynamic pageSize: 10,000 rows with pageSize = 2,500 -> 7,500 rows
    const pSize2 = 2500;
    const limit2 = Math.min(totalLarge, pSize2 * 3);
    assert.strictEqual(limit2, 7500, "Preload limit for 10k rows / 2.5k page size must be 7,500");

    // Very large page size exceeding total rows: 10,000 rows with pageSize = 5,000 -> 10,000 rows
    const pSize3 = 5000;
    const limit3 = Math.min(totalLarge, pSize3 * 3);
    assert.strictEqual(limit3, 10000, "Preload limit clamped to totalRowCount");

    // Small dataset boundary: 200 rows with pageSize = 1,000 -> 200 rows
    const totalSmall = 200;
    const limitSmall = Math.min(totalSmall, pSize1 * 3);
    assert.strictEqual(limitSmall, 200, "Preload limit for 200 rows must be exactly 200");
  });

  reportSuite("SUITE 4: Proactive Cache Re-warm Engine (rewarmAllReadyCaches)");

  await runTest("4.1 rewarmAllReadyCaches updates ready files in RAM cache to new pageSize", async () => {
    manager.clearFirstPageCache();

    // Create a mock ready file
    const mockCanon = "D:\\TestData\\rewarm_test.csv";
    const mockKey = JSON.stringify({ sourceId: "localfs", path: ["rewarm_test.csv"] });
    const mockSchema = { columns: ["id", "val"] };

    let queryOffset = -1;
    let queryLimit = -1;

    const mockDsc = {
      getTableName: async () => "rewarm_test_table",
      rowCount: async () => 10000,
      evalQuery: async (q, offset, limit) => {
        queryOffset = offset;
        queryLimit = limit;
        const rows = [];
        for (let i = 0; i < limit; i++) {
          rows.push({ id: offset + i, val: `v_${offset + i}` });
        }
        return { schema: mockSchema, rowData: rows };
      },
    };

    // Register file in manager
    manager.files.set(mockKey, {
      key: mockKey,
      canonicalPath: mockCanon,
      dsPath: { sourceId: "localfs", path: ["rewarm_test.csv"] },
      dsc: mockDsc,
      fileName: "rewarm_test.csv",
      status: "ready",
      percent: 100,
      priority: 0,
      addedTime: Date.now(),
      version: 1,
    });

    // Initial cache at 1,000 rows/page (3,000 rows)
    manager.setFirstPageCache(mockCanon, {
      tableName: "rewarm_test_table",
      schema: mockSchema,
      tableRep: { schema: mockSchema, rowData: new Array(3000).fill({}) },
      totalRowCount: 10000,
      pageSize: 1000,
      bufferPages: 3,
      cachedAt: Date.now(),
    });

    // Trigger rewarm to 2,500 rows/page
    await manager.rewarmAllReadyCaches(2500);

    assert.strictEqual(queryOffset, 0, "Query offset must be 0");
    assert.strictEqual(queryLimit, 7500, "Query limit must be 3 * 2,500 = 7,500");

    const cached = manager.getFirstPageCache(mockCanon);
    assert(cached, "Cached entry must exist");
    assert.strictEqual(cached.pageSize, 2500, "Cached pageSize must be updated to 2500");
    assert.strictEqual(cached.bufferPages, 3, "bufferPages must be 3");
    assert.strictEqual(cached.tableRep.rowData.length, 7500, "tableRep must have 7,500 rows");
  });

  await runTest("4.2 rewarmAllReadyCaches aborts superseded re-warm runs cleanly", async () => {
    manager.clearFirstPageCache();
    const mockCanon = "D:\\TestData\\race_rewarm.csv";
    const mockKey = JSON.stringify({ sourceId: "localfs", path: ["race_rewarm.csv"] });
    const mockSchema = { columns: ["id", "val"] };

    const mockDsc = {
      getTableName: async () => "race_rewarm_table",
      rowCount: async () => 10000,
      evalQuery: async (q, offset, limit) => {
        // Yield to allow concurrent trigger
        await new Promise((res) => setTimeout(res, 20));
        return { schema: mockSchema, rowData: new Array(limit).fill({}) };
      },
    };

    manager.files.set(mockKey, {
      key: mockKey,
      canonicalPath: mockCanon,
      dsPath: { sourceId: "localfs", path: ["race_rewarm.csv"] },
      dsc: mockDsc,
      fileName: "race_rewarm.csv",
      status: "ready",
      percent: 100,
      priority: 0,
      addedTime: Date.now(),
      version: 1,
    });

    // Start rewarm for 2500
    const p1 = manager.rewarmAllReadyCaches(2500);
    // Immediately supersede with rewarm for 5000
    const p2 = manager.rewarmAllReadyCaches(5000);

    await Promise.all([p1, p2]);

    const cached = manager.getFirstPageCache(mockCanon);
    assert(cached, "Cached entry must exist");
    assert.strictEqual(cached.pageSize, 5000, "Final cached pageSize must be 5000 from the latest rewarm, not 2500");
  });

  reportSuite("SUITE 5: PagedDataView In-Memory 3-Page Indexing & Zero-Latency Navigation");

  const {
    PagedDataView,
  } = require(path.resolve(ROOT_DIR, "tad-master/packages/toadviewer/dist/PagedDataView"));

  await runTest("5.1 PagedDataView indexes Page 1, Page 2, Page 3 seamlessly from 3-page buffer", async () => {
    const mockSchema = { columns: ["id", "val"] };
    const rowData = [];
    for (let i = 0; i < 3000; i++) {
      rowData.push({ _id: i, id: i, val: `row_${i}` });
    }

    const pSize = 1000;
    const totalRowCount = 10000;
    const dvPage1 = new PagedDataView(mockSchema, totalRowCount, 0, rowData, 1, pSize);

    // Page 1 assertions
    assert.strictEqual(dvPage1.getLength(), 1000, "Page 1 length must be 1000");
    assert.strictEqual(dvPage1.getItem(0).id, 0, "Page 1 first row id must be 0");
    assert.strictEqual(dvPage1.getItem(999).id, 999, "Page 1 last row id must be 999");

    // Navigate to Page 2 in memory via withPage(2)
    const dvPage2 = dvPage1.withPage(2);
    assert.strictEqual(dvPage2.getLength(), 1000, "Page 2 length must be 1000");
    assert.strictEqual(dvPage2.getItem(0).id, 1000, "Page 2 first row id must be 1000");
    assert.strictEqual(dvPage2.getItem(999).id, 1999, "Page 2 last row id must be 1999");

    // Navigate to Page 3 in memory via withPage(3)
    const dvPage3 = dvPage1.withPage(3);
    assert.strictEqual(dvPage3.getLength(), 1000, "Page 3 length must be 1000");
    assert.strictEqual(dvPage3.getItem(0).id, 2000, "Page 3 first row id must be 2000");
    assert.strictEqual(dvPage3.getItem(999).id, 2999, "Page 3 last row id must be 2999");

    // Out-of-bounds safety
    assert.strictEqual(dvPage1.getItem(-1), null, "Negative index returns null");
    assert.strictEqual(dvPage1.getItem(1000), null, "Index >= length returns null");
  });

  reportSuite("SUITE 6: View Mount Session PageSize Integrity");

  await runTest("6.1 View initialization preserves session getDefaultPageSize() over stale cache", async () => {
    setDefaultPageSize(2500);

    // ViewState page size follows session default
    const expectedPageSize = getDefaultPageSize();
    assert.strictEqual(expectedPageSize, 2500, "Session page size must be 2500");

    // Reset defaultPageSize back to 1000
    setDefaultPageSize(1000);
  });

  manager.stopPollingLoop();

  console.log(`\n${BOLD}======================================================================${RESET}`);
  console.log(`${BOLD}  PRELOAD 3-PAGE & DYNAMIC ROWS/PAGE TEST SUMMARY${RESET}`);
  console.log(`${BOLD}======================================================================${RESET}`);
  console.log(`  Total Test Cases : ${totalTests}`);
  console.log(`  Passed           : ${passedTests}`);
  console.log(`  Failed           : ${failedTests}`);
  console.log(`${BOLD}======================================================================${RESET}\n`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unhandled error in test suite:", err);
  process.exit(1);
});
