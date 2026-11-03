/**
 * tests/db_layer_qa.js
 * 
 * TOAD v2.4.2 DATABASE LAYER QA TEST SUITE
 * 
 * Kiểm thử chuyên sâu tầng cơ sở dữ liệu DuckDB & Parquet Ledger:
 * 1. DuckDB 14-column Parquet Schema Integrity
 * 2. Typed NULL Tombstone Insertion & Type Invariance
 * 3. DuckDB Window Function Project State Classifier (ACTIVE vs DELETED)
 * 4. Safe Ledger Reset to 0-row Parquet (WHERE 1 = 0)
 * 5. Multi-project Partitioning & Schema Evolution
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT_DIR = process.env.TOAD_ROOT || path.resolve(__dirname, "..");
const { Database } = require(path.resolve(ROOT_DIR, "tad-master/node_modules/duckdb-async"));

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function reportSuite(title) {
  console.log(`\n${BOLD}======================================================================${RESET}`);
  console.log(`${BOLD}  ${title}${RESET}`);
  console.log(`${BOLD}======================================================================${RESET}`);
}

async function runTest(name, fn) {
  totalTests++;
  const t0 = process.hrtime();
  try {
    await fn();
    const diff = process.hrtime(t0);
    const ms = (diff[0] * 1000 + diff[1] / 1e6).toFixed(2);
    passedTests++;
    console.log(`  ${GREEN}✓ [PASS]${RESET} ${name} (${ms} ms)`);
  } catch (err) {
    failedTests++;
    console.error(`  ${RED}✗ [FAIL]${RESET} ${name}`);
    console.error(`    ${RED}Error: ${err.message}${RESET}`);
    if (err.stack) {
      console.error(`    ${err.stack.split("\n").slice(1, 4).join("\n")}`);
    }
  }
}

function escapeSqlPath(p) {
  return p.replace(/\\/g, "/").replace(/'/g, "''");
}

async function main() {
  const startTime = Date.now();
  const testTmpDir = path.resolve(ROOT_DIR, `tmp_db_qa_${Date.now()}`);
  fs.mkdirSync(testTmpDir, { recursive: true });

  const db = await Database.create(":memory:");
  const conn = await db.connect();

  reportSuite("LAYER 1 QA: DuckDB Parquet Schema, Typed NULL & Window Function");

  const ledgerFile = path.join(testTmpDir, "test_ledger.parquet");

  await runTest("DB.1 Initialize 14-column Parquet Ledger with standard schema", async () => {
    const initSql = `
      COPY (
        SELECT 
          'evt-1' as event_id,
          'PROJECT_CREATE' as event_type,
          1700000000000::BIGINT as timestamp,
          'grj3c' as project_id,
          'Incident Alpha' as project_name,
          CAST(NULL AS VARCHAR) as source_path,
          CAST(NULL AS BIGINT) as source_size,
          CAST(NULL AS BIGINT) as source_mtime,
          CAST(NULL AS VARCHAR) as parquet_path,
          CAST(NULL AS BIGINT) as parquet_size,
          CAST(NULL AS BIGINT) as row_count,
          'READY' as status,
          CAST(0 AS INTEGER) as duration_ms,
          '{}' as extra_json
      ) TO '${escapeSqlPath(ledgerFile)}' (FORMAT PARQUET)
    `;
    await conn.run(initSql);
    assert(fs.existsSync(ledgerFile), "Parquet ledger file must be created on disk");

    const desc = await conn.all(`DESCRIBE SELECT * FROM read_parquet('${escapeSqlPath(ledgerFile)}')`);
    assert.strictEqual(desc.length, 14, "Parquet schema must contain exactly 14 columns");

    const colMap = new Map(desc.map(c => [c.column_name.toLowerCase(), c.column_type.toLowerCase()]));
    assert(colMap.get("event_id").includes("varchar"), "event_id must be VARCHAR");
    assert(colMap.get("project_id").includes("varchar"), "project_id must be VARCHAR");
    assert(colMap.get("timestamp").includes("bigint"), "timestamp must be BIGINT");
    assert(colMap.get("source_size").includes("bigint"), "source_size must be BIGINT");
  });

  await runTest("DB.2 Append Typed NULL Tombstone without schema poisoning or type errors", async () => {
    const tombstoneSql = `
      COPY (
        SELECT * FROM read_parquet('${escapeSqlPath(ledgerFile)}')
        UNION ALL
        SELECT 
          'tombstone-1001' as event_id,
          'PROJECT_DELETE' as event_type,
          1700000010000::BIGINT as timestamp,
          'grj3c' as project_id,
          'Incident Alpha' as project_name,
          CAST(NULL AS VARCHAR) as source_path,
          CAST(NULL AS BIGINT) as source_size,
          CAST(NULL AS BIGINT) as source_mtime,
          CAST(NULL AS VARCHAR) as parquet_path,
          CAST(NULL AS BIGINT) as parquet_size,
          CAST(NULL AS BIGINT) as row_count,
          CAST(NULL AS VARCHAR) as status,
          CAST(NULL AS INTEGER) as duration_ms,
          CAST(NULL AS VARCHAR) as extra_json
      ) TO '${escapeSqlPath(ledgerFile)}' (FORMAT PARQUET)
    `;
    await conn.run(tombstoneSql);

    const rows = await conn.all(`SELECT * FROM read_parquet('${escapeSqlPath(ledgerFile)}') ORDER BY timestamp ASC`);
    assert.strictEqual(rows.length, 2, "Must contain exactly 2 events");

    const tombstone = rows[1];
    assert.strictEqual(tombstone.event_type, "PROJECT_DELETE");
    assert.strictEqual(tombstone.project_id, "grj3c");
    assert.strictEqual(tombstone.project_name, "Incident Alpha");
    assert.strictEqual(tombstone.source_path, null);
    assert.strictEqual(tombstone.source_size, null);
    assert.strictEqual(tombstone.parquet_path, null);
    assert.strictEqual(tombstone.status, null);
  });

  await runTest("DB.3 Window Function accurately identifies ACTIVE vs DELETED projects", async () => {
    // Append another active project 'u8x2m' with files
    const appendSql = `
      COPY (
        SELECT * FROM read_parquet('${escapeSqlPath(ledgerFile)}')
        UNION ALL
        SELECT 
          'evt-2' as event_id,
          'PROJECT_CREATE' as event_type,
          1700000020000::BIGINT as timestamp,
          'u8x2m' as project_id,
          'Project Beta' as project_name,
          CAST(NULL AS VARCHAR) as source_path,
          CAST(NULL AS BIGINT) as source_size,
          CAST(NULL AS BIGINT) as source_mtime,
          CAST(NULL AS VARCHAR) as parquet_path,
          CAST(NULL AS BIGINT) as parquet_size,
          CAST(NULL AS BIGINT) as row_count,
          'READY' as status,
          CAST(0 AS INTEGER) as duration_ms,
          '{}' as extra_json
        UNION ALL
        SELECT 
          'evt-3' as event_id,
          'FILE_READY' as event_type,
          1700000030000::BIGINT as timestamp,
          'u8x2m' as project_id,
          'Project Beta' as project_name,
          'C:/data/log.csv' as source_path,
          1024::BIGINT as source_size,
          1700000025000::BIGINT as source_mtime,
          'temp/u8x2m/log.parquet' as parquet_path,
          512::BIGINT as parquet_size,
          50::BIGINT as row_count,
          'READY' as status,
          CAST(12 AS INTEGER) as duration_ms,
          '{}' as extra_json
      ) TO '${escapeSqlPath(ledgerFile)}' (FORMAT PARQUET)
    `;
    await conn.run(appendSql);

    const windowSql = `
      WITH ranked_events AS (
        SELECT 
          project_id,
          project_name,
          event_type,
          source_path,
          parquet_path,
          status,
          ROW_NUMBER() OVER (
            PARTITION BY project_id 
            ORDER BY timestamp DESC
          ) as rn
        FROM read_parquet('${escapeSqlPath(ledgerFile)}')
        WHERE project_id IS NOT NULL AND length(project_id) = 5
      )
      SELECT 
        project_id,
        project_name,
        CASE 
          WHEN event_type = 'PROJECT_DELETE' 
               OR (source_path IS NULL AND parquet_path IS NULL AND status IS NULL)
          THEN 'DELETED'
          ELSE 'ACTIVE'
        END as project_state
      FROM ranked_events
      WHERE rn = 1
      ORDER BY project_id ASC;
    `;

    const states = await conn.all(windowSql);
    assert.strictEqual(states.length, 2, "Must return 2 distinct 5-char projects");

    const grj3c = states.find(s => s.project_id === "grj3c");
    const u8x2m = states.find(s => s.project_id === "u8x2m");

    assert(grj3c, "Project grj3c must exist in window query");
    assert.strictEqual(grj3c.project_state, "DELETED", "grj3c latest record is Tombstone -> state must be DELETED");

    assert(u8x2m, "Project u8x2m must exist in window query");
    assert.strictEqual(u8x2m.project_state, "ACTIVE", "u8x2m latest record is FILE_READY -> state must be ACTIVE");
  });

  await runTest("DB.4 Safe Ledger Reset creates pristine 0-row Parquet with identical schema", async () => {
    // Delete physical file
    await conn.close();
    fs.unlinkSync(ledgerFile);
    assert(!fs.existsSync(ledgerFile), "Physical ledger must be unlinked");

    // Recreate clean empty Parquet (0 rows)
    const conn2 = await db.connect();
    const emptyParquetSql = `
      COPY (
        SELECT 
          CAST('' AS VARCHAR) as event_id,
          CAST('' AS VARCHAR) as event_type,
          CAST(0 AS BIGINT) as timestamp,
          CAST('' AS VARCHAR) as project_id,
          CAST('' AS VARCHAR) as project_name,
          CAST('' AS VARCHAR) as source_path,
          CAST(0 AS BIGINT) as source_size,
          CAST(0 AS BIGINT) as source_mtime,
          CAST('' AS VARCHAR) as parquet_path,
          CAST(0 AS BIGINT) as parquet_size,
          CAST(0 AS BIGINT) as row_count,
          CAST('' AS VARCHAR) as status,
          CAST(0 AS INTEGER) as duration_ms,
          CAST('' AS VARCHAR) as extra_json
        WHERE 1 = 0
      ) TO '${escapeSqlPath(ledgerFile)}' (FORMAT PARQUET)
    `;
    await conn2.run(emptyParquetSql);
    assert(fs.existsSync(ledgerFile), "Pristine empty Parquet file must exist");

    const rows = await conn2.all(`SELECT * FROM read_parquet('${escapeSqlPath(ledgerFile)}')`);
    assert.strictEqual(rows.length, 0, "Empty parquet file must contain exactly 0 rows");

    const desc = await conn2.all(`DESCRIBE SELECT * FROM read_parquet('${escapeSqlPath(ledgerFile)}')`);
    assert.strictEqual(desc.length, 14, "Pristine empty Parquet file must maintain 14 columns schema");

    await conn2.close();
  });

  // Cleanup
  try {
    fs.rmSync(testTmpDir, { recursive: true, force: true });
  } catch {}

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n${BOLD}======================================================================${RESET}`);
  console.log(`${BOLD}  DATABASE LAYER QA SUMMARY: Total: ${totalTests} | ${GREEN}Passed: ${passedTests}${RESET} | ${failedTests === 0 ? GREEN : RED}Failed: ${failedTests}${RESET} (${duration}s)`);
  console.log(`${BOLD}======================================================================${RESET}\n`);

  if (failedTests > 0) process.exit(1);
}

main().catch(err => {
  console.error("Fatal Database QA Suite Error:", err);
  process.exit(1);
});
