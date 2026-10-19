const assert = require('assert');
const path = require('path');
const duckdb = require('./tad-master/node_modules/duckdb');
const reltab = require('./tad-master/packages/reltab');
const {
  decodeBase64Utf16LE,
  decodeBase64Utf8,
  decodeUrl,
  defangIoC,
} = require('./tad-master/packages/tadviewer/dist/utils/ForensicDecoder.js');

async function runTestSuite() {
  console.log('================================================================');
  console.log('   QA TEST SUITE: TOAD v1.3.2 FILTER & IPC STABILITY PATCH   ');
  console.log('================================================================\n');

  let totalTests = 0;
  let passedTests = 0;

  function test(name, fn) {
    totalTests++;
    try {
      fn();
      console.log(`  ✅ [PASS] ${name}`);
      passedTests++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
      throw err;
    }
  }

  async function testAsync(name, fn) {
    totalTests++;
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passedTests++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
      throw err;
    }
  }

  console.log('--- TEST GROUP 1: IPC SERIALIZATION & REVIVER (The Bug Fix) ---');

  test('1.1: OmniSearchRelExp deserializes to an instance with .toSqlWhere()', () => {
    const omni = new reltab.OmniSearchRelExp('powershell', ['CommandLine', 'ProcessName']);
    const fe = new reltab.FilterExp('AND', [omni]);
    const q = reltab.tableQuery('t').filter(fe);
    const json = JSON.stringify(q);
    const revived = reltab.deserializeQueryReq(json);
    const revivedOmni = revived._rep.fexp.opArgs[0];

    assert.strictEqual(revivedOmni.expType, 'OmniSearchRelExp');
    assert.ok(revivedOmni instanceof reltab.OmniSearchRelExp, 'Must be instance of OmniSearchRelExp');
    assert.strictEqual(typeof revivedOmni.toSqlWhere, 'function', 'Must have toSqlWhere function');
    const sql = revived._rep.fexp.toSqlWhere(reltab.DuckDBDialect);
    assert.ok(sql.includes("CONCAT_WS(' ', \"CommandLine\"::VARCHAR, \"ProcessName\"::VARCHAR) ILIKE '%powershell%'"), `SQL: ${sql}`);
  });

  test('1.2: Defense-in-depth: Plain object in FilterExp.toSqlWhere is safely recovered', () => {
    const rawPlainObj = { expType: 'OmniSearchRelExp', searchTerm: 'mimikatz', columns: ['ColA', 'ColB'] };
    const feWithPlain = new reltab.FilterExp('AND', [rawPlainObj]);
    // Calling toSqlWhere should NOT throw "subExp.toSqlWhere is not a function"
    const sqlPlain = feWithPlain.toSqlWhere(reltab.DuckDBDialect);
    assert.ok(sqlPlain.includes("CONCAT_WS(' ', \"ColA\"::VARCHAR, \"ColB\"::VARCHAR) ILIKE '%mimikatz%'"), `SQL: ${sqlPlain}`);
  });

  test('1.3: Combined Query: Right-Click Filter + Omnisearch across IPC', () => {
    const rightClickRule = new reltab.BinRelExp('EQ', reltab.col('EventID'), reltab.constVal(4688));
    const omni = new reltab.OmniSearchRelExp('powershell', ['CommandLine', 'ParentProcessName']);
    const combinedFE = new reltab.FilterExp('AND', [rightClickRule, omni]);
    const combinedQuery = reltab.tableQuery('events').filter(combinedFE);

    const json = JSON.stringify(combinedQuery);
    const revived = reltab.deserializeQueryReq(json);
    const sql = revived._rep.fexp.toSqlWhere(reltab.DuckDBDialect);

    assert.ok(sql.includes('"EventID"=4688'), `Should contain EventID rule: ${sql}`);
    assert.ok(sql.includes("CONCAT_WS(' ', \"CommandLine\"::VARCHAR, \"ParentProcessName\"::VARCHAR) ILIKE '%powershell%'"), `Should contain Omnisearch: ${sql}`);
  });

  console.log('\n--- TEST GROUP 2: LIVE DUCKDB EXECUTION (Hayabusa Event Logs) ---');

  await testAsync('2.1: Live execution of Combined Right-Click + Omnisearch query on Hayabusa CSV', async () => {
    const db = new duckdb.Database(':memory:');
    const csvPath = 'D:/Shared_UserData/Downloads/tad/data_sample/Windows.EventLogs.Hayabusa_Results.csv';

    await new Promise((resolve, reject) => {
      db.all(`CREATE TABLE hayabusa AS SELECT * FROM read_csv_auto('${csvPath}');`, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const cols = await new Promise((resolve, reject) => {
      db.all(`PRAGMA table_info('hayabusa');`, (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map(r => r.name));
      });
    });

    // Right-Click Filter on Channel = 'Sec' + Omnisearch for "Sec"
    const rcRule = new reltab.BinRelExp('EQ', reltab.col('Channel'), reltab.constVal('Sec'));
    const omni = new reltab.OmniSearchRelExp('Sec', cols);
    const combinedFE = new reltab.FilterExp('AND', [rcRule, omni]);

    // Simulate full round-trip IPC serialization
    const q = reltab.tableQuery('hayabusa').filter(combinedFE);
    const serialized = JSON.stringify(q);
    const deserialized = reltab.deserializeQueryReq(serialized);

    const whereSql = deserialized._rep.fexp.toSqlWhere(reltab.DuckDBDialect);

    const count = await new Promise((resolve, reject) => {
      db.all(`SELECT COUNT(*) as cnt FROM hayabusa WHERE ${whereSql};`, (err, res) => {
        if (err) reject(err);
        else resolve(res[0].cnt);
      });
    });

    console.log(`     Live DuckDB Query matched ${count} events for Channel='Sec' AND 'Sec'.`);
    assert.ok(Number(count) > 0, 'Should find matching events without error');
  });

  console.log('\n--- TEST GROUP 3: REGRESSION OF PHASE 1 & 2 FEATURES ---');

  test('3.1: Right-Click Exclude (<>) operation on string column', () => {
    const subExp = new reltab.BinRelExp("NEQ", reltab.col("Channel"), reltab.constVal("Security"));
    const fe = new reltab.FilterExp("AND", [subExp]);
    const sql = fe.toSqlWhere(reltab.DuckDBDialect);
    assert.ok(sql.includes('"Channel"<>\'Security\''), `SQL was: ${sql}`);
  });

  test('3.2: Right-Click Time Bracket (±5 mins)', () => {
    const gteExp = new reltab.BinRelExp("GE", reltab.col("Timestamp"), reltab.constVal("2023-04-12 10:00:00"));
    const lteExp = new reltab.BinRelExp("LE", reltab.col("Timestamp"), reltab.constVal("2023-04-12 10:10:00"));
    const fe = new reltab.FilterExp("AND", [gteExp, lteExp]);
    const sql = fe.toSqlWhere(reltab.DuckDBDialect);
    assert.ok(sql.includes('"Timestamp">=\'2023-04-12 10:00:00\' AND "Timestamp"<=\'2023-04-12 10:10:00\''), `SQL: ${sql}`);
  });

  test('3.3: Forensic Decoder: PowerShell UTF-16LE Base64 Decoding', () => {
    // Encoded: "Write-Output 'Antigravity IR'" in UTF-16LE Base64
    const payload = "VwByAGkAdABlAC0ATwB1AHQAcAB1AHQAIAAnAEEAbgB0AGkAZwByAGEAdgBpAHQAeQAgAEkAUgAnAA==";
    const res = decodeBase64Utf16LE(payload);
    assert.strictEqual(res.success, true);
    assert.ok(res.result.includes("Write-Output 'Antigravity IR'"), `Result was: ${res.result}`);
  });

  test('3.4: Forensic Decoder: IoC Defanger for URLs and IPs', () => {
    const resUrl = defangIoC("https://malicious.evil.com/payload.exe");
    assert.strictEqual(resUrl.success, true);
    assert.ok(resUrl.result.includes("hxxps://malicious.evil[.]com"), `Defanged URL was: ${resUrl.result}`);

    const resIp = defangIoC("192.168.1.100");
    assert.strictEqual(resIp.success, true);
    assert.strictEqual(resIp.result, "192[.]168[.]1[.]100");
  });

  console.log(`\n================================================================`);
  console.log(`   TEST RESULTS: ${passedTests}/${totalTests} PASSED (100% SUCCESS)`);
  console.log(`================================================================\n`);
}

runTestSuite().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
