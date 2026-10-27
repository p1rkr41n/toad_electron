const duckdb = require('./tad-master/node_modules/duckdb');
const { Database } = require('./tad-master/node_modules/duckdb-async');
const reltabDuckDB = require('./tad-master/packages/reltab-duckdb/dist/reltab-duckdb.js');

async function run() {
  const asyncDb = await Database.create(':memory:');
  const csvPath = 'D:/Shared_UserData/Downloads/tad/data_sample/Windows.EventLogs.Hayabusa_Results.csv';
  try {
    const res = await reltabDuckDB.nativeCSVImport(asyncDb, csvPath);
    console.log('nativeCSVImport returned:', res);
  } catch (err) {
    console.error('CRASH in nativeCSVImport:', err);
  }
}
run();
