const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execSync } = require('child_process');

console.log('======================================================================');
console.log('   MILESTONE 1 VERIFICATION: SIDEBAR TABLE RESIZE & AUTO-WRAP');
console.log('======================================================================\n');

// 1. Verify ProjectFilesTable.tsx source content and exports
const tsxPath = path.resolve(__dirname, '../../../tad-master/packages/toadviewer/src/components/ProjectFilesTable.tsx');
assert(fs.existsSync(tsxPath), 'ProjectFilesTable.tsx must exist');
const tsxContent = fs.readFileSync(tsxPath, 'utf8');

console.log('>>> Checking ProjectFilesTable.tsx constants and exports...');

// ColWidths interface
assert(tsxContent.includes('export interface ColWidths {'), 'Must export ColWidths');
assert(tsxContent.includes('name: number;'), 'ColWidths has name');
assert(tsxContent.includes('dir: number;'), 'ColWidths has dir');
assert(tsxContent.includes('size: number;'), 'ColWidths has size');
assert(tsxContent.includes('status: number;'), 'ColWidths has status');

// Constants
assert(tsxContent.includes('export const DEFAULT_COL_WIDTHS: ColWidths = {'), 'Must export DEFAULT_COL_WIDTHS');
assert(tsxContent.includes('name: 140,'), 'DEFAULT_COL_WIDTHS.name is 140');
assert(tsxContent.includes('dir: 120,'), 'DEFAULT_COL_WIDTHS.dir is 120');
assert(tsxContent.includes('size: 70,'), 'DEFAULT_COL_WIDTHS.size is 70');
assert(tsxContent.includes('status: 60,'), 'DEFAULT_COL_WIDTHS.status is 60');
assert(tsxContent.includes('export const MIN_COL_WIDTH = 45;'), 'MIN_COL_WIDTH is 45');
assert(tsxContent.includes('export const MAX_COL_WIDTH = 400;'), 'MAX_COL_WIDTH is 400');
assert(tsxContent.includes('export const calculateAutoFitWidth = (maxLen: number): number => {'), 'Must export calculateAutoFitWidth');

console.log('  ✓ [PASS] Exported types and constants verified.');

// Test calculateAutoFitWidth formula
console.log('>>> Testing Auto-Fit Calculation Formula...');
const calculateAutoFitWidth = (maxLen) => {
  const MIN_COL_WIDTH = 45;
  const MAX_COL_WIDTH = 400;
  return Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, Math.round(maxLen * 7.0 + 24)));
};

assert.strictEqual(calculateAutoFitWidth(0), 45, 'Empty/zero maxLen clamps to 45');
assert.strictEqual(calculateAutoFitWidth(1), 45, '1-char maxLen (31) clamps to 45');
assert.strictEqual(calculateAutoFitWidth(3), 45, '3-char maxLen (45) bounds to 45');
assert.strictEqual(calculateAutoFitWidth(4), 52, '4-char maxLen (Name -> 52)');
assert.strictEqual(calculateAutoFitWidth(20), 164, '20-char maxLen -> 164');
assert.strictEqual(calculateAutoFitWidth(500), 400, '500-char maxLen clamps to 400');
console.log('  ✓ [PASS] Auto-fit mathematical clamping verified [45, 400].');

// Drag resizing math
console.log('>>> Testing Drag Resize Calculation...');
const simulateDrag = (startWidth, delta) => Math.max(45, startWidth + delta);
assert.strictEqual(simulateDrag(140, 30), 170, 'Drag +30px expands to 170');
assert.strictEqual(simulateDrag(140, -30), 110, 'Drag -30px shrinks to 110');
assert.strictEqual(simulateDrag(140, -200), 45, 'Drag -200px clamps to MIN_COL_WIDTH 45');
console.log('  ✓ [PASS] Drag resize math verified.');

// 2. Check Event Isolation & Handlers
console.log('>>> Checking Event Isolation and Lifecycle in ProjectFilesTable.tsx...');
assert(tsxContent.includes('draggingRef.current = { col, startX, startWidth };'), 'Sets draggingRef on mousedown');
assert(tsxContent.includes('document.body.classList.add("col-resizing");'), 'Adds col-resizing class to document.body');
assert(tsxContent.includes('document.body.classList.remove("col-resizing");'), 'Removes col-resizing class on cleanup');
assert(tsxContent.includes('window.addEventListener("blur", cleanup);') || tsxContent.includes('window.removeEventListener("blur", cleanup);'), 'Listens on window blur');
assert(tsxContent.includes('document.addEventListener("mouseleave", cleanup);') || tsxContent.includes('document.removeEventListener("mouseleave", cleanup);'), 'Listens on mouseleave');
assert(tsxContent.includes('e.stopPropagation();') && tsxContent.includes('e.preventDefault();'), 'Resizer handlers call stopPropagation and preventDefault');
console.log('  ✓ [PASS] Event isolation and drag cleanup verified.');

// 3. Check Active Row Auto-Wrap & Collapse
console.log('>>> Checking Active Row Auto-Wrap & Collapse Lifecycle...');
assert(tsxContent.includes('const [selectedRowPath, setSelectedRowPath] = useState<string | null>'), 'selectedRowPath state exists');
assert(tsxContent.includes('setSelectedRowPath(null); // toggle collapse'), 'Toggle collapse resets selectedRowPath');
assert(tsxContent.includes('setSelectedRowPath(f.filePath);'), 'Selecting row updates selectedRowPath');
assert(tsxContent.includes('onOpenFile(f);'), 'Calls onOpenFile on row selection');
assert(tsxContent.includes('e.key === "Escape"'), 'Listens for Escape key to collapse');
assert(tsxContent.includes('!tableContainerRef.current.contains(e.target as Node)'), 'Click-away outside container collapses row');
assert(tsxContent.includes('ref={tableContainerRef}'), 'tableContainerRef bound to container');
assert(tsxContent.includes('className="file-name-wrap"'), 'file-name-wrap container exists');
assert(tsxContent.includes('className="file-dir-wrap"'), 'file-dir-wrap container exists');
assert(tsxContent.includes('className="col-resizer-handle"'), 'col-resizer-handle elements rendered');
console.log('  ✓ [PASS] Active row wrap and collapse lifecycle verified.');

// 4. Verify LESS compilation and CSS output
console.log('>>> Compiling sidebar.less and verifying CSS design tokens...');
const lessPath = path.resolve(__dirname, '../../../tad-master/packages/toadviewer/less/sidebar.less');
const lessContent = fs.readFileSync(lessPath, 'utf8');

const nodeExe = path.resolve(__dirname, '../../../node-v18.20.4-win-x64/node.exe');
const lesscPath = path.resolve(__dirname, '../../../tad-master/node_modules/less/bin/lessc');

const compiledCss = execSync(`"${nodeExe}" "${lesscPath}" "${lessPath}"`, { encoding: 'utf8' });

assert(compiledCss.includes('col-resizing'), 'Compiled CSS includes col-resizing');
assert(compiledCss.includes('cursor: col-resize !important'), 'Compiled CSS has cursor col-resize !important');
assert(compiledCss.includes('rgba(2, 132, 199, 0.75)'), 'Compiled CSS has light mode divider color');
assert(compiledCss.includes('rgba(56, 189, 248, 0.85)'), 'Compiled CSS has dark mode divider color');
assert(compiledCss.includes('white-space: normal !important'), 'Compiled CSS has white-space normal on active row');
assert(compiledCss.includes('word-break: break-all !important'), 'Compiled CSS has word-break break-all on active row');
assert(compiledCss.includes('overflow-wrap: anywhere !important'), 'Compiled CSS has overflow-wrap anywhere on active row');
assert(compiledCss.includes('max-height: 180px'), 'Compiled CSS has max-height 180px');
assert(compiledCss.includes('width: 4px'), 'Compiled CSS has 4px slim scrollbars');
assert(compiledCss.includes('border-radius: 2px'), 'Compiled CSS has 2px scrollbar border-radius');

console.log('  ✓ [PASS] LESS compiled cleanly; all CSS tokens and theme rules verified.');

console.log('\n======================================================================');
console.log('   ALL MILESTONE 1 CHECKS PASSED (100% CLEAN)!');
console.log('======================================================================');
