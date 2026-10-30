const path = require("path");
const { Database } = require(path.resolve(__dirname, "../tad-master/node_modules/duckdb-async"));

async function testPerformance() {
  const db = await Database.create(":memory:");
  console.log("Creating 1,000,000 rows test dataset in DuckDB...");
  
  // Case A: 1,000,000 rows, 100% matched (no unmatched rows)
  await db.run(`
    CREATE TABLE logs_perfect AS
    SELECT 
      range AS id, 
      'TargetDomainName: DOMAIN_' || (range % 100) || ' ¦ TargetUserSid: S-1-' || range AS "Details"
    FROM range(1000000);
  `);

  // Case B: 1,000,000 rows, 98.4% matched, 1.6% unmatched
  await db.run(`
    CREATE TABLE logs_mixed AS
    SELECT 
      range AS id, 
      CASE 
        WHEN range % 100 < 98 THEN 'TargetDomainName: DOMAIN_' || (range % 100) || ' ¦ TargetUserSid: S-1-' || range
        ELSE '--- SYSTEM REBOOT INITIATED BY KERNEL ---'
      END AS "Details"
    FROM range(1000000);
  `);

  console.log("Measuring check cost on 1,000,000 rows...\n");

  // Benchmark Case B (Mixed, has unmatched lines -> Short-circuit with LIMIT 1)
  const t0 = process.hrtime();
  const resMixed = await db.all(`
    SELECT "Details" AS unmatched_sample
    FROM logs_mixed
    WHERE NOT contains("Details", '¦')
    LIMIT 1;
  `);
  const diffB = process.hrtime(t0);
  const msB = (diffB[0] * 1000 + diffB[1] / 1e6).toFixed(3);
  console.log(`Case B (Has Unmatched - Short Circuit): found in ${msB} ms. Result:`, resMixed);

  // Benchmark Case A (100% Perfect, scans entire 1,000,000 rows with fast scan)
  const t1 = process.hrtime();
  const resPerfect = await db.all(`
    SELECT EXISTS(
      SELECT 1 FROM logs_perfect
      WHERE NOT contains("Details", '¦')
      LIMIT 1
    ) AS has_unmatched;
  `);
  const diffA = process.hrtime(t1);
  const msA = (diffA[0] * 1000 + diffA[1] / 1e6).toFixed(3);
  console.log(`Case A (100% Perfect - Scanned 1M rows): completed in ${msA} ms. Result:`, resPerfect);
}

testPerformance().catch(console.error);

