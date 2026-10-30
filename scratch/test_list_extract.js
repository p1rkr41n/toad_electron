const duckdb = require('./tad-master/node_modules/duckdb');
const db = new duckdb.Database(':memory:');

db.all(`
  SELECT
    list_extract(list_filter(str_split('User: foo ¦ Type: 1', '¦'), x -> trim(x) NOT LIKE '%:%'), 1) as res1,
    list_extract(list_filter(str_split('STANDALONE ¦ User: foo', '¦'), x -> trim(x) NOT LIKE '%:%'), 1) as res2,
    NULLIF(TRIM(list_extract(list_filter(str_split('User: foo ¦ Type: 1', '¦'), x -> trim(x) NOT LIKE '%:%'), 1)), '') as res3
`, (err, res) => {
  if (err) console.error(err);
  console.log('Result:', JSON.stringify(res, null, 2));
});

