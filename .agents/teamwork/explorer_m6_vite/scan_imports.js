const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) results = results.concat(walk(full));
    else if (/\.(ts|tsx|js|jsx)$/.test(f)) results.push(full);
  }
  return results;
}

const targetDirs = [
  'd:/Shared_UserData/Downloads/tad/tad-master/packages/toadviewer/src',
  'd:/Shared_UserData/Downloads/tad/tad-master/packages/reltab/src',
  'd:/Shared_UserData/Downloads/tad/tad-master/packages/aggtree/src',
  'd:/Shared_UserData/Downloads/tad/tad-master/packages/host-bridge/src',
  'd:/Shared_UserData/Downloads/tad/tad-master/packages/toad-app/src'
];

const externalPackages = new Set();
const internalAliases = new Set(['toadviewer', 'tadviewer', 'reltab', 'aggtree', 'host-bridge']);

for (const dir of targetDirs) {
  if (!fs.existsSync(dir)) continue;
  const files = walk(dir);
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    // Match import ... from 'pkg' and import 'pkg' and require('pkg')
    const regex = /(?:from\s+['"]([^'".\\][^'"]*)['"]|import\s+['"]([^'".\\][^'"]*)['"]|require\(\s*['"]([^'".\\][^'"]*)['"]\s*\))/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const pkg = match[1] || match[2] || match[3];
      if (pkg) {
        externalPackages.add(pkg);
      }
    }
  }
}

console.log(JSON.stringify(Array.from(externalPackages).sort(), null, 2));
