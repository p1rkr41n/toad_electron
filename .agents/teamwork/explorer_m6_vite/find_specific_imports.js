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

const queries = ['electron', 'events', 'path', 'jquery', 'pretty-hrtime', 'typescript', 'slickgrid', 'url-regex'];

for (const dir of targetDirs) {
  if (!fs.existsSync(dir)) continue;
  for (const file of walk(dir)) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      for (const q of queries) {
        const regex = new RegExp(`['"]${q}['"]`);
        if (regex.test(line)) {
          console.log(`${file}:${idx + 1} -> ${line.trim()}`);
        }
      }
    });
  }
}
