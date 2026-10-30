const path = require("path");
const { Database } = require(path.resolve(__dirname, "../tad-master/node_modules/duckdb-async"));

async function test() {
  const db = await Database.create(":memory:");
  await db.run(`
    CREATE OR REPLACE TABLE large_heterogeneous AS
    SELECT
      range AS id,
      CASE
        WHEN range % 3 = 0 THEN 'User: user_' || (range % 500) || ' ¦ LID: 0x' || range || ' ¦ Type: ' || (range % 10)
        WHEN range % 3 = 1 THEN 'TgtUser: tgt_' || (range % 500) || ' ¦ SrcUser: src_' || (range % 100) || ' ¦ SrcIP: 10.0.0.' || (range % 255) || ' ¦ Proc: proc_' || (range % 50) || '.exe'
        ELSE 'STANDALONE_EVENT_' || range || ' ¦ Provider: Prov_' || (range % 20) || ' ¦ Result: 0x0'
      END AS "Details"
    FROM range(100);
  `);

  const delim = "¦";
  const assign = ":";
  const pattern = (k) => `(?:^|[\\s${delim},;|])${k}\\s*${assign}\\s*(?:"([^"]*)"|([^\\s${delim},;\\r\\n|]+))`;

  const rows = await db.all(`
    SELECT
      id,
      "Details",
      COALESCE(
        NULLIF(regexp_extract("Details", '${pattern("User")}', 1), ''),
        NULLIF(regexp_extract("Details", '${pattern("User")}', 2), ''),
        NULLIF(regexp_extract("Details", '${pattern("TgtUser")}', 1), ''),
        NULLIF(regexp_extract("Details", '${pattern("TgtUser")}', 2), '')
      ) AS "Unified_User",
      NULLIF(COALESCE(NULLIF(regexp_extract("Details", '${pattern("Proc")}', 1), ''), regexp_extract("Details", '${pattern("Proc")}', 2)), '') AS "Proc",
      NULLIF(TRIM(list_extract(list_filter(str_split("Details", '¦'), x -> trim(x) NOT LIKE '%:%'), 1)), '') AS "str1"
    FROM large_heterogeneous
    LIMIT 6;
  `);

  console.log('Sample rows:', rows);

  const counts = await db.all(`
    SELECT
      CAST(COUNT(*) AS INTEGER) AS total,
      CAST(COUNT("Unified_User") AS INTEGER) AS user_cnt,
      CAST(COUNT("Proc") AS INTEGER) AS proc_cnt,
      CAST(COUNT("str1") AS INTEGER) AS str1_cnt
    FROM (
      SELECT
        id,
        COALESCE(
          NULLIF(regexp_extract("Details", '${pattern("User")}', 1), ''),
          NULLIF(regexp_extract("Details", '${pattern("User")}', 2), ''),
          NULLIF(regexp_extract("Details", '${pattern("TgtUser")}', 1), ''),
          NULLIF(regexp_extract("Details", '${pattern("TgtUser")}', 2), '')
        ) AS "Unified_User",
        NULLIF(COALESCE(NULLIF(regexp_extract("Details", '${pattern("Proc")}', 1), ''), regexp_extract("Details", '${pattern("Proc")}', 2)), '') AS "Proc",
        NULLIF(TRIM(list_extract(list_filter(str_split("Details", '¦'), x -> trim(x) NOT LIKE '%:%'), 1)), '') AS "str1"
      FROM large_heterogeneous
    );
  `);
  console.log('Counts:', counts);
}

test().catch(console.error);

