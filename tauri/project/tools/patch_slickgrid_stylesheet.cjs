#!/usr/bin/env node
/**
 * patch_slickgrid_stylesheet.cjs
 * 
 * Patches slickgrid-es6 dist to fix:
 * 1. "Cannot find stylesheet." and missing column CSS rules in Chromium/WebView2:
 *    - Uses `$style[0].sheet || $style[0].styleSheet` directly.
 *    - Falls back to scanning `document.styleSheets`.
 *    - If rules are missing for column `e`, dynamically injects `.l{e} { }` and `.r{e} { }` rules into CSSOM!
 * 2. applyColumnWidths:
 *    - Robust guards and guaranteed `.left.style.left` population so columns never collapse to left: 0.
 */

const fs = require("fs");
const path = require("path");

const slickPath = path.join(
  __dirname,
  "..",
  "node_modules",
  "slickgrid-es6",
  "dist",
  "slick.es6.min.js"
);

if (!fs.existsSync(slickPath)) {
  console.error("[patch_slickgrid_stylesheet] slick.es6.min.js not found at:", slickPath);
  process.exit(0); // non-fatal during install
}

let content = fs.readFileSync(slickPath, "utf8");
const originalLength = content.length;
let changed = false;

// Guard against multiple patch runs on already patched file
if (content.includes("insertRule('.'+uid+' .l'+e")) {
  console.log("[patch_slickgrid_stylesheet] slick.es6.min.js is already patched. Skipping.");
  process.exit(0);
}

// Patch 1: getColumnCssRules
const getCssStart = content.indexOf("function getColumnCssRules(e){");
const getCssEnd = content.indexOf("function removeCssRules(){", getCssStart);

if (getCssStart !== -1 && getCssEnd !== -1) {
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

  content = content.slice(0, getCssStart) + newGetCss + content.slice(getCssEnd);
  changed = true;
  console.log("[patch_slickgrid_stylesheet] Patch 1 applied: getColumnCssRules direct sheet + dynamic rule insertion");
} else {
  console.warn("[patch_slickgrid_stylesheet] WARNING: getColumnCssRules boundary not found");
}

// Patch 2: applyColumnWidths
const applyStart = content.indexOf("function applyColumnWidths(){");
const applyEnd = content.indexOf("function setSortColumn(", applyStart);

if (applyStart !== -1 && applyEnd !== -1) {
  const newApply =
    "function applyColumnWidths(){" +
      "for(var e,t,o=0,n=0;n<columns.length;n++){" +
        "e=columns[n].width;" +
        "t=getColumnCssRules(n);" +
        "if(t&&t.left&&t.left.style)t.left.style.left=o+'px';" +
        "if(t&&t.right&&t.right.style)t.right.style.right=(options.frozenColumn!=-1&&n>options.frozenColumn?canvasWidthR:canvasWidthL)-o-e+'px';" +
        "options.frozenColumn==n?o=0:o+=columns[n].width;" +
      "}" +
    "}";

  content = content.slice(0, applyStart) + newApply + content.slice(applyEnd);
  changed = true;
  console.log("[patch_slickgrid_stylesheet] Patch 2 applied: applyColumnWidths robust assignment");
} else {
  console.warn("[patch_slickgrid_stylesheet] WARNING: applyColumnWidths boundary not found");
}

// Integrity guard: File size must never deviate by more than 5KB from original 251KB
if (Math.abs(content.length - originalLength) > 5000) {
  console.error(`[patch_slickgrid_stylesheet] FATAL: File length discrepancy too large (original: ${originalLength}, new: ${content.length}). Aborting.`);
  process.exit(1);
}

if (changed) {
  fs.writeFileSync(slickPath, content, "utf8");
  console.log(`[patch_slickgrid_stylesheet] slick.es6.min.js successfully patched and saved (${content.length} bytes, original: ${originalLength} bytes).`);
} else {
  console.log("[patch_slickgrid_stylesheet] No changes needed.");
}
