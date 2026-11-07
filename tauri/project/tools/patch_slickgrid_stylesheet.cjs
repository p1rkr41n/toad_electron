#!/usr/bin/env node
/**
 * patch_slickgrid_stylesheet.cjs
 * 
 * Patches slickgrid-es6 dist to fix:
 * 1. "Cannot find stylesheet." and missing column CSS rules in Chromium/WebView2:
 *    - Replaces ALL occurrences of getColumnCssRules in both FrozenGrid and standard SlickGrid.
 *    - Uses `$style[0].sheet || $style[0].styleSheet` directly.
 *    - Falls back to scanning `document.styleSheets`.
 *    - If rules are missing for column `e`, dynamically injects `.l{e} { }` and `.r{e} { }` rules into CSSOM!
 * 2. applyColumnWidths:
 *    - Replaces ALL occurrences in both FrozenGrid and standard SlickGrid.
 *    - Robust guards and guaranteed `.left.style.left` population so columns never collapse to left: 0.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const slickPath = path.join(
  __dirname,
  "..",
  "node_modules",
  "slickgrid-es6",
  "dist",
  "slick.es6.min.js"
);

const pristineBackupPath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "tad-master",
  "node_modules",
  "slickgrid-es6",
  "dist",
  "slick.es6.min.js"
);

if (!fs.existsSync(slickPath)) {
  console.error("[patch_slickgrid_stylesheet] slick.es6.min.js not found at:", slickPath);
  process.exit(0); // non-fatal during install
}

// Always start from pristine copy if available to prevent patch accretion/corruption
let content;
if (fs.existsSync(pristineBackupPath)) {
  content = fs.readFileSync(pristineBackupPath, "utf8");
} else {
  content = fs.readFileSync(slickPath, "utf8");
}

// Guard: if already patched and no pristine copy to refresh from
if (!content.includes("Cannot find stylesheet.") && content.includes("insertRule('.'+uid+' .l'+e")) {
  console.log("[patch_slickgrid_stylesheet] slick.es6.min.js is already fully patched. Skipping.");
  process.exit(0);
}

const originalLength = content.length;

const newGetCss =
  "function getColumnCssRules(e){" +
  "if(!stylesheet){" +
    "stylesheet=($style&&$style[0]&&($style[0].sheet||$style[0].styleSheet))||null;" +
    "if(!stylesheet&&typeof document!=='undefined'){" +
      "var _sheets=document.styleSheets||[];" +
      "for(var _si=0;_si<_sheets.length;_si++){" +
        "if((_sheets[_si].ownerNode||_sheets[_si].owningElement)===$style[0]){stylesheet=_sheets[_si];break;}" +
      "}" +
    "}" +
  "}" +
  "if(stylesheet&&(!columnCssRulesL||!columnCssRulesL.length)){" +
    "columnCssRulesL=[];columnCssRulesR=[];" +
    "var _rules=stylesheet.cssRules||stylesheet.rules||[];" +
    "for(var _n,_r,_i=0;_i<_rules.length;_i++){" +
      "var _st=_rules[_i].selectorText;" +
      "if(_st){" +
        "if(_n=/\\.l\\d+/.exec(_st)){_r=parseInt(_n[0].substr(2),10);columnCssRulesL[_r]=_rules[_i];}" +
        "else if(_n=/\\.r\\d+/.exec(_st)){_r=parseInt(_n[0].substr(2),10);columnCssRulesR[_r]=_rules[_i];}" +
      "}" +
    "}" +
  "}" +
  "if(stylesheet&&(!columnCssRulesL||!columnCssRulesL[e])){" +
    "try{" +
      "columnCssRulesL=columnCssRulesL||[];columnCssRulesR=columnCssRulesR||[];" +
      "var _il=stylesheet.insertRule('.'+uid+' .l'+e+' { left: 0px; }',stylesheet.cssRules.length);" +
      "columnCssRulesL[e]=stylesheet.cssRules[_il];" +
      "var _ir=stylesheet.insertRule('.'+uid+' .r'+e+' { right: 0px; }',stylesheet.cssRules.length);" +
      "columnCssRulesR[e]=stylesheet.cssRules[_ir];" +
    "}catch(_err){}" +
  "}" +
  "return{" +
    "left:(columnCssRulesL&&columnCssRulesL[e])||null," +
    "right:(columnCssRulesR&&columnCssRulesR[e])||null" +
  "};" +
  "}";

const newApplyUniversal =
  "function applyColumnWidths(){" +
    "for(var e,t,o=0,n=0;n<columns.length;n++){" +
      "e=columns[n].width;" +
      "t=getColumnCssRules(n);" +
      "if(t&&t.left&&t.left.style)t.left.style.left=o+'px';" +
      "if(t&&t.right&&t.right.style){" +
        "var _rw=(typeof options!=='undefined'&&options.frozenColumn!=-1&&n>options.frozenColumn)?canvasWidthR:(typeof canvasWidthL!=='undefined'?canvasWidthL:canvasWidth);" +
        "t.right.style.right=_rw-o-e+'px';" +
      "}" +
      "if(typeof options!=='undefined'&&options.frozenColumn==n){o=0;}else{o+=columns[n].width;}" +
    "}" +
  "}";

// Patch ALL occurrences of getColumnCssRules
let getCssCount = 0;
let pos = 0;
while (true) {
  const getCssStart = content.indexOf("function getColumnCssRules(e){", pos);
  if (getCssStart === -1) break;
  const getCssEnd = content.indexOf("function removeCssRules(){", getCssStart);
  if (getCssEnd === -1) break;
  content = content.slice(0, getCssStart) + newGetCss + content.slice(getCssEnd);
  pos = getCssStart + newGetCss.length;
  getCssCount++;
}
console.log(`[patch_slickgrid_stylesheet] Patched ${getCssCount} getColumnCssRules occurrence(s).`);

// Patch ALL occurrences of applyColumnWidths
let applyCount = 0;
pos = 0;
while (true) {
  const applyStart = content.indexOf("function applyColumnWidths(){", pos);
  if (applyStart === -1) break;
  const applyEnd = content.indexOf("function setSortColumn(", applyStart);
  if (applyEnd === -1) break;
  content = content.slice(0, applyStart) + newApplyUniversal + content.slice(applyEnd);
  pos = applyStart + newApplyUniversal.length;
  applyCount++;
}
console.log(`[patch_slickgrid_stylesheet] Patched ${applyCount} applyColumnWidths occurrence(s).`);

// Assert zero remaining unpatched stylesheets
if (content.includes("Cannot find stylesheet.")) {
  console.error("[patch_slickgrid_stylesheet] ERROR: 'Cannot find stylesheet.' still present after patching!");
  process.exit(1);
}

// Validate syntax
try {
  new vm.Script(content);
  console.log("[patch_slickgrid_stylesheet] JavaScript syntax validation passed.");
} catch (err) {
  console.error("[patch_slickgrid_stylesheet] FATAL: Syntax error in patched file:", err.message);
  process.exit(1);
}

// Integrity guard
if (Math.abs(content.length - originalLength) > 5000) {
  console.error(`[patch_slickgrid_stylesheet] FATAL: File length discrepancy too large (original: ${originalLength}, new: ${content.length}). Aborting.`);
  process.exit(1);
}

fs.writeFileSync(slickPath, content, "utf8");
console.log(`[patch_slickgrid_stylesheet] slick.es6.min.js successfully patched and saved (${content.length} bytes).`);
