const path = require("path");
const { Database } = require(path.resolve(__dirname, "../tad-master/node_modules/duckdb-async"));

async function testCTE() {
  const db = await Database.create(":memory:");
  await db.run(`
    CREATE TABLE test_dirty_table AS
    SELECT
      range AS id,
      CASE
        WHEN range % 100 < 98 THEN 'User: user_' || range || ' ¦ Role: member'
        ELSE 'SYSTEM_PING_HEARTBEAT_' || range
      END AS "Details"
    FROM range(1000);
  `);

  const extCols = `
    NULLIF(regexp_extract("Details", 'User:\\s*([^\\s¦]+)', 1), '') AS "User",
    NULLIF(regexp_extract("Details", 'Role:\\s*([^\\s¦]+)', 1), '') AS "Role"
  `;
  const nullCond = `"User" IS NULL AND "Role" IS NULL`;

  const baseExtractSql = `SELECT *, ${extCols} FROM test_dirty_table`;
  const viewSql = `
    CREATE VIEW v_dirty_with_fallback AS
    SELECT *,
      CASE WHEN (${nullCond}) THEN "Details" ELSE NULL END AS "unmatched_Details"
    FROM (${baseExtractSql}) _sub_extract;
  `;
  await db.run(viewSql);

  const sample = await db.all(`
    SELECT
      COUNT(*) AS total,
      COUNT("User") AS user_cnt,
      COUNT("unmatched_Details") AS unmatched_cnt
    FROM v_dirty_with_fallback;
  `);

  console.log("Result with subquery wrapper:", sample);
}

testCTE().catch(console.error);

