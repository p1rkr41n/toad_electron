const fs = require('fs');

const checks = [
  { file: 'tad-master/package.json', check: c => JSON.parse(c).version === '2.5.1' },
  { file: 'tad-master/packages/toad-app/package.json', check: c => JSON.parse(c).version === '2.5.1' },
  { file: 'tad-master/packages/host-bridge/package.json', check: c => JSON.parse(c).version === '2.5.1' },
  { file: 'tad-master/packages/reltab-duckdb/package.json', check: c => JSON.parse(c).version === '2.5.1' },
  { file: 'tad-master/packages/toadviewer/package.json', check: c => JSON.parse(c).version === '2.5.1' },
  { file: 'tad-master/packages/toadviewer/src/components/RegexDialog.tsx', check: c => c.includes('v2.5.1') && !c.includes('v2.5.0.5') },
  { file: 'dist_package.ps1', check: c => c.includes('Toad-2.5.1-x64-portable.exe') && c.includes('v2.5.1') },
  { file: 'package_release.ps1', check: c => c.includes('2.5.1') },
  { file: 'README.md', check: c => c.includes('Toad (v2.5.1)') && c.includes('Version-2.5.1') },
  { file: 'releases/HelloKittyXamKinLung.Toad.yaml', check: c => c.includes('PackageVersion: 2.5.1') && c.includes('download/v2.5.1/') && c.includes('Toad-2.5.1-x64-portable.exe') }
];

let allPassed = true;
for (const item of checks) {
  const content = fs.readFileSync(item.file, 'utf8');
  const ok = item.check(content);
  console.log((ok ? '[PASS]' : '[FAIL]') + ' ' + item.file);
  if (!ok) allPassed = false;
}
if (!allPassed) {
  console.error('FAIL: Not all metadata files verified 2.5.1!');
  process.exit(1);
}
console.log('ALL METADATA FILES VERIFIED 2.5.1 CLEANLY!');
