const fs = require('fs');

const targetVersion = process.argv[2] || '2.6.0.1';

const checks = [
  { file: 'tad-master/package.json', check: c => JSON.parse(c).version === targetVersion },
  { file: 'tad-master/packages/toad-app/package.json', check: c => JSON.parse(c).version === targetVersion },
  { file: 'tad-master/packages/host-bridge/package.json', check: c => JSON.parse(c).version === targetVersion },
  { file: 'tad-master/packages/reltab-duckdb/package.json', check: c => JSON.parse(c).version === targetVersion },
  { file: 'tad-master/packages/toadviewer/package.json', check: c => JSON.parse(c).version === targetVersion },
  { file: 'tad-master/packages/toadviewer/src/components/RegexDialog.tsx', check: c => c.includes(`v${targetVersion}`) },
  { file: 'dist_package.ps1', check: c => c.includes(`Toad-${targetVersion}-x64-portable.exe`) && c.includes(`v${targetVersion}`) },
  { file: 'package_release.ps1', check: c => c.includes(targetVersion) },
  { file: 'README.md', check: c => c.includes(`Toad (v${targetVersion})`) && c.includes(`Version-${targetVersion}`) },
  { file: 'releases/HelloKittyXamKinLung.Toad.yaml', check: c => c.includes(`PackageVersion: ${targetVersion}`) && c.includes(`download/v${targetVersion}/`) && c.includes(`Toad-${targetVersion}-x64-portable.exe`) }
];

let allPassed = true;
for (const item of checks) {
  const content = fs.readFileSync(item.file, 'utf8');
  const ok = item.check(content);
  console.log((ok ? '[PASS]' : '[FAIL]') + ' ' + item.file);
  if (!ok) allPassed = false;
}
if (!allPassed) {
  console.error(`FAIL: Not all metadata files verified ${targetVersion}!`);
  process.exit(1);
}
console.log(`ALL METADATA FILES VERIFIED ${targetVersion} CLEANLY!`);
