const fs = require('fs');
const path = require('path');

function checkFile(relPath) {
  const fullPath = path.join(__dirname, '..', relPath);
  if (!fs.existsSync(fullPath)) return;
  const content = fs.readFileSync(fullPath, 'utf8');
  const lines = content.split('\n');
  const issues = [];
  lines.forEach((line, idx) => {
    // Check for hardcoded colors not using var(--md-sys...)
    const hasHex = /#[0-9a-fA-F]{3,6}/.test(line);
    const hasVar = /var\(--md-sys-color-/.test(line);
    const hasImportant = /!important/.test(line);
    if (hasHex && !hasVar) {
      if (/color:\s*#[0-9a-fA-F]+/i.test(line) || /background(-color)?:\s*#[0-9a-fA-F]+/i.test(line)) {
        issues.push({ line: idx + 1, text: line.trim() });
      }
    }
  });
  console.log(`=== ${relPath} (${issues.length} hardcoded color lines) ===`);
  issues.slice(0, 15).forEach(iss => console.log(`  L${iss.line}: ${iss.text}`));
  if (issues.length > 15) console.log(`  ... and ${issues.length - 15} more`);
}

const files = [
  'tad-master/packages/tadviewer/less/sidebar.less',
  'tad-master/packages/tadviewer/less/eventDetailSidebar.less',
  'tad-master/packages/tadviewer/less/columnSelector.less',
  'tad-master/packages/tadviewer/less/tadviewer.less',
  'tad-master/packages/tadviewer/less/activityBar.less',
  'tad-master/packages/tadviewer/less/footer.less',
  'tad-master/packages/tadviewer/src/slickgrid.scss',
  'tad-master/packages/tadviewer/src/components/RegexDialog.tsx',
  'tad-master/packages/tadviewer/src/components/DataSourceSidebar.tsx',
];

files.forEach(checkFile);

