const path = require("path");
const { Database } = require(path.resolve(__dirname, "../tad-master/node_modules/duckdb-async"));

async function test() {
  const db = await Database.create(":memory:");
  const countTest = await db.all(`
    CREATE TABLE t (details VARCHAR);
    INSERT INTO t VALUES ('User: a ¦ Type: 1'), ('STANDALONE ¦ User: b');
    SELECT
      CAST(COUNT(list_extract(list_filter(str_split(details, '¦'), x -> trim(x) NOT LIKE '%:%'), 1)) AS INTEGER) as cnt_raw,
      CAST(COUNT(NULLIF(TRIM(list_extract(list_filter(str_split(details, '¦'), x -> trim(x) NOT LIKE '%:%'), 1)), '')) AS INTEGER) as cnt_nullif
    FROM t;
  `);
  console.log('Counts:', countTest);
}

test().catch(console.error);

