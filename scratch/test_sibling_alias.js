const path = require("path");
const { Database } = require(path.resolve(__dirname, "../tad-master/node_modules/duckdb-async"));

async function test() {
  const db = await Database.create(":memory:");
  await db.run(`
    CREATE TABLE t (d VARCHAR);
    INSERT INTO t VALUES ('User: a'), ('NO_USER');
  `);
  const res1 = await db.all(`
    SELECT
      NULLIF(regexp_extract(d, 'User:\\s*(.*)', 1), '') AS "User",
      "User" IS NULL AS is_null,
      typeof("User") AS type_user
    FROM t;
  `);
  console.log("res1:", res1);

  const res2 = await db.all(`
    SELECT
      *,
      CASE WHEN "User" IS NULL THEN d ELSE NULL END AS "unmatched"
    FROM (
      SELECT
        d,
        NULLIF(regexp_extract(d, 'User:\\s*(.*)', 1), '') AS "User"
      FROM t
    );
  `);
  console.log("res2 (with subquery):", res2);
}

test().catch(console.error);

