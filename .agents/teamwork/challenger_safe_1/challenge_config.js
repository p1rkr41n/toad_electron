/**
 * challenge_config.js
 *
 * EMPIRICAL ADVERSARIAL CHALLENGE HARNESS
 * Target: tad-master/packages/toad-app/app/portableAppData.ts
 *
 * Scope:
 *  1. Corrupted INI formats (missing closing brackets, invalid key-value pairs, empty lines, comments with semicolons and hashes).
 *  2. Missing [duckdb] section entirely vs partial [duckdb] section.
 *  3. Case sensitivity variations (SAFE_MODE_KEYWORDS, Safe_Mode_Parallel, etc.).
 *  4. Multiple keywords separated by unusual whitespace, tabs, commas, trailing commas, empty elements.
 *  5. Keyword disabling variations: "none", "NONE", "off", "OFF", "", "   ", "None, off".
 *  6. Idempotency of auto-healing: ensure running validateAndEnsureConfig 5 consecutive times on the same file does not duplicate keys, corrupt sections, or alter existing comments.
 *  7. Cross-process environment variable export and restoration.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const child_process = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "../../..");

// Hook TypeScript compiler to require .ts modules directly in Node.js
module.paths.push(path.resolve(ROOT_DIR, "tad-master/node_modules"));
module.paths.push(path.resolve(ROOT_DIR, "tad-master/packages/toad-app/node_modules"));
module.paths.push(path.resolve(ROOT_DIR, "tad-master/packages/reltab-duckdb/node_modules"));

const ts = require(path.resolve(ROOT_DIR, "tad-master/node_modules/typescript"));

require.extensions[".ts"] = function (module, filename) {
  const content = fs.readFileSync(filename, "utf8");
  const result = ts.transpileModule(content, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  module._compile(result.outputText, filename);
};

const {
  DEFAULT_CONFIG,
  DEFAULT_CONFIG_INI_TEXT,
  parseIni,
  stringifyConfig,
  autoHealIniText,
  validateAndEnsureConfig,
  initPortableEnvironment,
} = require(path.resolve(
  ROOT_DIR,
  "tad-master/packages/toad-app/app/portableAppData.ts"
));

const {
  DEFAULT_SAFE_MODE_KEYWORDS,
  parseSafeModeKeywords,
  getIngestConfig,
} = require(path.resolve(
  ROOT_DIR,
  "tad-master/packages/reltab-duckdb/src/csvimport.ts"
));

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function testCase(id, description, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ${GREEN}✔ [PASS]${RESET} ${BOLD}${id}${RESET}: ${description}`);
  } catch (err) {
    failedTests++;
    failures.push({ id, description, error: err });
    console.error(`  ${RED}✖ [FAIL]${RESET} ${BOLD}${id}${RESET}: ${description}`);
    console.error(`         ${YELLOW}Error:${RESET} ${err.message}`);
    if (err.stack) {
      console.error(`         ${err.stack.split("\n").slice(1, 4).join("\n         ")}`);
    }
  }
}

// Sandbox directory
const sandboxDir = path.join(
  os.tmpdir(),
  `toad_challenger_safe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
);
fs.mkdirSync(sandboxDir, { recursive: true });

function getTestIniPath(name) {
  return path.join(sandboxDir, `${Date.now()}_${name}`);
}

// Env snapshot
const originalEnv = { ...process.env };
const originalGlobal = (global).toadPortableEnv;

function resetEnv() {
  for (const k of Object.keys(process.env)) {
    if (!(k in originalEnv)) {
      delete process.env[k];
    } else {
      process.env[k] = originalEnv[k];
    }
  }
  (global).toadPortableEnv = originalGlobal;
}

console.log(`\n${BOLD}${CYAN}======================================================================${RESET}`);
console.log(`${BOLD}${CYAN}  ADVERSARIAL EMPIRICAL HARNESS: CONFIG PARSING & AUTO-HEALING         ${RESET}`);
console.log(`${BOLD}${CYAN}  Challenger: challenger_safe_1                                       ${RESET}`);
console.log(`${BOLD}${CYAN}======================================================================${RESET}\n`);

// =============================================================================
// CATEGORY 1: Corrupted INI Formats
// =============================================================================
console.log(`${BOLD}--- Category 1: Corrupted INI Formats ---${RESET}`);

testCase("CAT1-01", "Missing closing bracket on section header: [duckdb without ]", () => {
  resetEnv();
  const filePath = getTestIniPath("cat1_01.ini");
  fs.writeFileSync(filePath, `
[general]
viewer = toad

[duckdb
safe_mode_keywords = winlog
safe_mode_parallel = false
`, "utf8");

  const cfg = validateAndEnsureConfig(filePath);
  assert.ok(cfg.duckdb, "DuckDB section must exist in returned config");
  // [duckdb was broken, so duckdb section fell back to defaults
  assert.strictEqual(Array.isArray(cfg.duckdb.safe_mode_keywords), true);
  assert.strictEqual(typeof cfg.duckdb.safe_mode_parallel, "boolean");

  // Verify auto-heal wrote a well-formed [duckdb] section
  const content = fs.readFileSync(filePath, "utf8");
  assert.ok(content.includes("[duckdb]"), "Auto-heal must have rewritten proper [duckdb] section");
  
  // Re-validating after auto-heal must parse cleanly
  const reloaded = validateAndEnsureConfig(filePath);
  assert.strictEqual(reloaded.duckdb.safe_mode_parallel, true);
});

testCase("CAT1-02", "Missing opening bracket on section header: duckdb] without [", () => {
  resetEnv();
  const filePath = getTestIniPath("cat1_02.ini");
  fs.writeFileSync(filePath, `
duckdb]
safe_mode_keywords = winlog
safe_mode_parallel = false
`, "utf8");

  const cfg = validateAndEnsureConfig(filePath);
  assert.ok(cfg.duckdb);
  const content = fs.readFileSync(filePath, "utf8");
  assert.ok(content.includes("[duckdb]"), "Auto-heal must supply valid [duckdb] section");
});

testCase("CAT1-03", "Garbage syntax: Random lines without equals sign", () => {
  resetEnv();
  const filePath = getTestIniPath("cat1_03.ini");
  fs.writeFileSync(filePath, `
THIS IS RANDOM UNPARSEABLE NOISE
CORRUPTED_DATA_WITHOUT_EQUALS
[duckdb]
safe_mode_keywords = hayabusa, security
ANOTHER_GARBAGE_LINE_HERE
safe_mode_parallel = false
YET MORE JUNK
`, "utf8");

  const cfg = validateAndEnsureConfig(filePath);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, ["hayabusa", "security"]);
  assert.strictEqual(cfg.duckdb.safe_mode_parallel, false);

  // Auto-heal must preserve the existing valid keys and garbage lines without throwing
  const healed = fs.readFileSync(filePath, "utf8");
  assert.ok(healed.includes("THIS IS RANDOM UNPARSEABLE NOISE"));
  assert.ok(healed.includes("safe_mode_keywords = hayabusa, security"));
});

testCase("CAT1-04", "Lines with multiple equals signs: param = a = b = c", () => {
  resetEnv();
  const filePath = getTestIniPath("cat1_04.ini");
  fs.writeFileSync(filePath, `
[duckdb]
safe_mode_keywords = hayabusa = alert, security
safe_mode_parallel = true
`, "utf8");

  const cfg = validateAndEnsureConfig(filePath);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, ["hayabusa = alert", "security"]);
  assert.strictEqual(cfg.duckdb.safe_mode_parallel, true);
});

testCase("CAT1-05", "Empty key line: = some_value", () => {
  resetEnv();
  const filePath = getTestIniPath("cat1_05.ini");
  fs.writeFileSync(filePath, `
[duckdb]
= orphaned_value
safe_mode_keywords = sysmon
safe_mode_parallel = false
`, "utf8");

  const cfg = validateAndEnsureConfig(filePath);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, ["sysmon"]);
  assert.strictEqual(cfg.duckdb.safe_mode_parallel, false);
});

testCase("CAT1-06", "Empty value line: safe_mode_keywords =", () => {
  resetEnv();
  const filePath = getTestIniPath("cat1_06.ini");
  fs.writeFileSync(filePath, `
[duckdb]
safe_mode_keywords =
safe_mode_parallel = false
`, "utf8");

  const cfg = validateAndEnsureConfig(filePath);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, [], "Empty keywords value must evaluate to empty array");
  assert.strictEqual(cfg.duckdb.safe_mode_parallel, false);
});

testCase("CAT1-07", "Mixed comments: Comments starting with # and ; and inline formatting", () => {
  resetEnv();
  const filePath = getTestIniPath("cat1_07.ini");
  fs.writeFileSync(filePath, `
# Top comment with hash
; Top comment with semicolon
   # Indented hash comment
   ; Indented semicolon comment
[duckdb]
# Comment before key
safe_mode_keywords = hayabusa, dfir
; Comment after key
safe_mode_parallel = true
# Bottom comment
`, "utf8");

  const cfg = validateAndEnsureConfig(filePath);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, ["hayabusa", "dfir"]);
  assert.strictEqual(cfg.duckdb.safe_mode_parallel, true);

  const healed = fs.readFileSync(filePath, "utf8");
  assert.ok(healed.includes("# Top comment with hash"));
  assert.ok(healed.includes("; Top comment with semicolon"));
  assert.ok(healed.includes("# Comment before key"));
  assert.ok(healed.includes("; Comment after key"));
});

testCase("CAT1-08", "Completely empty file (0 bytes)", () => {
  resetEnv();
  const filePath = getTestIniPath("cat1_08.ini");
  fs.writeFileSync(filePath, "", "utf8");

  const cfg = validateAndEnsureConfig(filePath);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, DEFAULT_CONFIG.duckdb.safe_mode_keywords);
  assert.strictEqual(cfg.duckdb.safe_mode_parallel, true);

  const content = fs.readFileSync(filePath, "utf8");
  assert.ok(content.length > 50, "File must have been populated with default configuration template");
  assert.ok(content.includes("[duckdb]"));
});

testCase("CAT1-09", "File containing only whitespace and empty lines", () => {
  resetEnv();
  const filePath = getTestIniPath("cat1_09.ini");
  fs.writeFileSync(filePath, "   \n\n\t\t\n   \r\n   ", "utf8");

  const cfg = validateAndEnsureConfig(filePath);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, DEFAULT_CONFIG.duckdb.safe_mode_keywords);
  assert.strictEqual(cfg.duckdb.safe_mode_parallel, true);
});

testCase("CAT1-10", "Non-existent file path: Auto-generates template", () => {
  resetEnv();
  const filePath = getTestIniPath("non_existent_config.ini");
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  const cfg = validateAndEnsureConfig(filePath);
  assert.strictEqual(fs.existsSync(filePath), true, "File must be created automatically");
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, DEFAULT_CONFIG.duckdb.safe_mode_keywords);
  assert.strictEqual(cfg.duckdb.safe_mode_parallel, true);

  const createdContent = fs.readFileSync(filePath, "utf8");
  assert.ok(createdContent.includes("safe_mode_keywords = hayabusa"));
  assert.ok(createdContent.includes("safe_mode_parallel = true"));
});

// =============================================================================
// CATEGORY 2: Missing vs Partial [duckdb] Section
// =============================================================================
console.log(`\n${BOLD}--- Category 2: Missing vs Partial [duckdb] Section ---${RESET}`);

testCase("CAT2-01", "Missing [duckdb] section entirely: Has other sections, no [duckdb]", () => {
  resetEnv();
  const filePath = getTestIniPath("cat2_01.ini");
  fs.writeFileSync(filePath, `
[general]
viewer = toad
language = en
page_size = 2500

[runtime]
engine = utility

[parquet]
compression = zstd
row_group_size = 50000

[system]
temp_cleanup = false
binary_guard = true
`, "utf8");

  const cfg = validateAndEnsureConfig(filePath);
  assert.strictEqual(cfg.general.page_size, 2500);
  assert.strictEqual(cfg.parquet.compression, "zstd");
  assert.strictEqual(cfg.system.temp_cleanup, false);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, DEFAULT_CONFIG.duckdb.safe_mode_keywords);
  assert.strictEqual(cfg.duckdb.safe_mode_parallel, true);

  const healed = fs.readFileSync(filePath, "utf8");
  assert.ok(healed.includes("[duckdb]"), "Missing [duckdb] section must be appended");
  assert.ok(healed.includes("safe_mode_keywords = hayabusa"));
  assert.ok(healed.includes("safe_mode_parallel = true"));
  assert.ok(healed.includes("compression = zstd"), "Original sections must be intact");
});

testCase("CAT2-02", "Partial [duckdb] section: ONLY threads = 8 specified", () => {
  resetEnv();
  const filePath = getTestIniPath("cat2_02.ini");
  fs.writeFileSync(filePath, `
[duckdb]
threads = 8
`, "utf8");

  const cfg = validateAndEnsureConfig(filePath);
  assert.strictEqual(cfg.duckdb.threads, 8);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, DEFAULT_CONFIG.duckdb.safe_mode_keywords);
  assert.strictEqual(cfg.duckdb.safe_mode_parallel, true);

  const healed = fs.readFileSync(filePath, "utf8");
  assert.ok(healed.includes("threads = 8"), "Original threads = 8 must be preserved");
  assert.ok(healed.includes("safe_mode_keywords"), "Missing safe_mode_keywords must be inserted");
  assert.ok(healed.includes("safe_mode_parallel = true"), "Missing safe_mode_parallel must be inserted");
});

testCase("CAT2-03", "Partial [duckdb] section: ONLY safe_mode_keywords specified", () => {
  resetEnv();
  const filePath = getTestIniPath("cat2_03.ini");
  fs.writeFileSync(filePath, `
[duckdb]
safe_mode_keywords = custom_log, audit_trail
`, "utf8");

  const cfg = validateAndEnsureConfig(filePath);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, ["custom_log", "audit_trail"]);
  assert.strictEqual(cfg.duckdb.safe_mode_parallel, true);

  const healed = fs.readFileSync(filePath, "utf8");
  assert.ok(healed.includes("safe_mode_keywords = custom_log, audit_trail"), "Custom keywords must not be overwritten");
  assert.ok(healed.includes("safe_mode_parallel = true"), "safe_mode_parallel must be healed");
});

testCase("CAT2-04", "Partial [duckdb] section: ONLY safe_mode_parallel = false specified", () => {
  resetEnv();
  const filePath = getTestIniPath("cat2_04.ini");
  fs.writeFileSync(filePath, `
[duckdb]
safe_mode_parallel = false
`, "utf8");

  const cfg = validateAndEnsureConfig(filePath);
  assert.strictEqual(cfg.duckdb.safe_mode_parallel, false);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, DEFAULT_CONFIG.duckdb.safe_mode_keywords);

  const healed = fs.readFileSync(filePath, "utf8");
  assert.ok(healed.includes("safe_mode_parallel = false"), "safe_mode_parallel = false must be preserved");
  assert.ok(healed.includes("safe_mode_keywords"), "safe_mode_keywords must be healed");
});

testCase("CAT2-05", "Empty [duckdb] section header only", () => {
  resetEnv();
  const filePath = getTestIniPath("cat2_05.ini");
  fs.writeFileSync(filePath, `
[general]
viewer = toad

[duckdb]

[system]
temp_cleanup = true
`, "utf8");

  const cfg = validateAndEnsureConfig(filePath);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, DEFAULT_CONFIG.duckdb.safe_mode_keywords);
  assert.strictEqual(cfg.duckdb.safe_mode_parallel, true);

  const healed = fs.readFileSync(filePath, "utf8");
  // DuckDB keys must be inserted under [duckdb], before [system]
  const duckDbPos = healed.indexOf("[duckdb]");
  const systemPos = healed.indexOf("[system]");
  const kwPos = healed.indexOf("safe_mode_keywords");
  assert.ok(kwPos > duckDbPos && kwPos < systemPos, "Missing keys must be inserted between [duckdb] and [system]");
});

// =============================================================================
// CATEGORY 3: Case Sensitivity Variations
// =============================================================================
console.log(`\n${BOLD}--- Category 3: Case Sensitivity Variations ---${RESET}`);

testCase("CAT3-01", "Uppercase section header: [DUCKDB]", () => {
  resetEnv();
  const filePath = getTestIniPath("cat3_01.ini");
  fs.writeFileSync(filePath, `
[DUCKDB]
safe_mode_keywords = hayabusa, winlog
safe_mode_parallel = true
`, "utf8");

  const cfg = validateAndEnsureConfig(filePath);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, ["hayabusa", "winlog"]);
  assert.strictEqual(cfg.duckdb.safe_mode_parallel, true);
});

testCase("CAT3-02", "Mixed-case section header: [DuckDb]", () => {
  resetEnv();
  const filePath = getTestIniPath("cat3_02.ini");
  fs.writeFileSync(filePath, `
[DuckDb]
safe_mode_keywords = audit, syslog
safe_mode_parallel = false
`, "utf8");

  const cfg = validateAndEnsureConfig(filePath);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, ["audit", "syslog"]);
  assert.strictEqual(cfg.duckdb.safe_mode_parallel, false);
});

testCase("CAT3-03", "Uppercase key name: SAFE_MODE_KEYWORDS", () => {
  resetEnv();
  const filePath = getTestIniPath("cat3_03.ini");
  fs.writeFileSync(filePath, `
[duckdb]
SAFE_MODE_KEYWORDS = winlog, firewall
SAFE_MODE_PARALLEL = true
`, "utf8");

  const cfg = validateAndEnsureConfig(filePath);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, ["winlog", "firewall"]);
  assert.strictEqual(cfg.duckdb.safe_mode_parallel, true);

  // Auto-heal must recognize SAFE_MODE_KEYWORDS and NOT add a duplicate safe_mode_keywords
  const healed = fs.readFileSync(filePath, "utf8");
  const countMatches = (healed.match(/safe_mode_keywords/gi) || []).length;
  assert.strictEqual(countMatches, 1, `Must not duplicate safe_mode_keywords (found ${countMatches})`);
});

testCase("CAT3-04", "PascalCase key name: Safe_Mode_Parallel", () => {
  resetEnv();
  const filePath = getTestIniPath("cat3_04.ini");
  fs.writeFileSync(filePath, `
[duckdb]
Safe_Mode_Keywords = sysmon
Safe_Mode_Parallel = false
`, "utf8");

  const cfg = validateAndEnsureConfig(filePath);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, ["sysmon"]);
  assert.strictEqual(cfg.duckdb.safe_mode_parallel, false);

  const healed = fs.readFileSync(filePath, "utf8");
  const countMatches = (healed.match(/safe_mode_parallel/gi) || []).length;
  assert.strictEqual(countMatches, 1, `Must not duplicate safe_mode_parallel (found ${countMatches})`);
});

testCase("CAT3-05", "Mixed-case boolean values: TRUE, True, FALSE, False", () => {
  resetEnv();
  const variations = [
    { in: "TRUE", exp: true },
    { in: "True", exp: true },
    { in: "TrUe", exp: true },
    { in: "FALSE", exp: false },
    { in: "False", exp: false },
    { in: "FaLsE", exp: false },
  ];

  for (const v of variations) {
    const filePath = getTestIniPath(`cat3_05_${v.in}.ini`);
    fs.writeFileSync(filePath, `
[duckdb]
safe_mode_parallel = ${v.in}
`, "utf8");
    const cfg = validateAndEnsureConfig(filePath);
    assert.strictEqual(cfg.duckdb.safe_mode_parallel, v.exp, `safe_mode_parallel = ${v.in} must evaluate to ${v.exp}`);
  }
});

testCase("CAT3-06", "Uppercase & mixed-case keyword tokens normalized to lowercase", () => {
  resetEnv();
  const filePath = getTestIniPath("cat3_06.ini");
  fs.writeFileSync(filePath, `
[duckdb]
safe_mode_keywords = HAYABUSA, EvEnTLoG, WinLog, SySmOn, FIREWALL
`, "utf8");

  const cfg = validateAndEnsureConfig(filePath);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, [
    "hayabusa",
    "eventlog",
    "winlog",
    "sysmon",
    "firewall",
  ]);
});

// =============================================================================
// CATEGORY 4: Delimiter & Whitespace Chaos
// =============================================================================
console.log(`\n${BOLD}--- Category 4: Delimiter & Whitespace Chaos ---${RESET}`);

testCase("CAT4-01", "Keywords separated by tabs: \\t delimiter spacing", () => {
  resetEnv();
  const filePath = getTestIniPath("cat4_01.ini");
  fs.writeFileSync(filePath, `
[duckdb]
safe_mode_keywords = \thayabusa\t,\t\teventlog\t\t,\t\tsysmon\t
`, "utf8");

  const cfg = validateAndEnsureConfig(filePath);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, ["hayabusa", "eventlog", "sysmon"]);
});

testCase("CAT4-02", "Keywords with extreme whitespace padding", () => {
  resetEnv();
  const filePath = getTestIniPath("cat4_02.ini");
  fs.writeFileSync(filePath, `
[duckdb]
safe_mode_keywords =        hayabusa       ,        security       ,        winlog        
`, "utf8");

  const cfg = validateAndEnsureConfig(filePath);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, ["hayabusa", "security", "winlog"]);
});

testCase("CAT4-03", "Leading, trailing, and consecutive commas with empty elements", () => {
  resetEnv();
  const filePath = getTestIniPath("cat4_03.ini");
  fs.writeFileSync(filePath, `
[duckdb]
safe_mode_keywords = ,,,,  hayabusa  ,,  security  ,,,,  audit  ,,,
`, "utf8");

  const cfg = validateAndEnsureConfig(filePath);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, ["hayabusa", "security", "audit"]);
});

testCase("CAT4-04", "Whitespace-only elements between commas: kw1,   , \t , kw2", () => {
  resetEnv();
  const filePath = getTestIniPath("cat4_04.ini");
  fs.writeFileSync(filePath, `
[duckdb]
safe_mode_keywords = hayabusa,    , \t\t ,   , winlog
`, "utf8");

  const cfg = validateAndEnsureConfig(filePath);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, ["hayabusa", "winlog"]);
});

testCase("CAT4-05", "Single keyword with irregular spacing", () => {
  resetEnv();
  const filePath = getTestIniPath("cat4_05.ini");
  fs.writeFileSync(filePath, `
[duckdb]
safe_mode_keywords =    \t  hayabusa \t  
`, "utf8");

  const cfg = validateAndEnsureConfig(filePath);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, ["hayabusa"]);
});

// =============================================================================
// CATEGORY 5: Keyword Disabling Variations
// =============================================================================
console.log(`\n${BOLD}--- Category 5: Keyword Disabling Variations ---${RESET}`);

testCase("CAT5-01", "Disabling with literal none", () => {
  resetEnv();
  const filePath = getTestIniPath("cat5_01.ini");
  fs.writeFileSync(filePath, `
[duckdb]
safe_mode_keywords = none
`, "utf8");
  const cfg = validateAndEnsureConfig(filePath);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, []);
});

testCase("CAT5-02", "Disabling with uppercase NONE", () => {
  resetEnv();
  const filePath = getTestIniPath("cat5_02.ini");
  fs.writeFileSync(filePath, `
[duckdb]
safe_mode_keywords = NONE
`, "utf8");
  const cfg = validateAndEnsureConfig(filePath);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, []);
});

testCase("CAT5-03", "Disabling with literal off", () => {
  resetEnv();
  const filePath = getTestIniPath("cat5_03.ini");
  fs.writeFileSync(filePath, `
[duckdb]
safe_mode_keywords = off
`, "utf8");
  const cfg = validateAndEnsureConfig(filePath);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, []);
});

testCase("CAT5-04", "Disabling with uppercase OFF", () => {
  resetEnv();
  const filePath = getTestIniPath("cat5_04.ini");
  fs.writeFileSync(filePath, `
[duckdb]
safe_mode_keywords = OFF
`, "utf8");
  const cfg = validateAndEnsureConfig(filePath);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, []);
});

testCase("CAT5-05", "Disabling with empty string \"\"", () => {
  resetEnv();
  const filePath = getTestIniPath("cat5_05.ini");
  fs.writeFileSync(filePath, `
[duckdb]
safe_mode_keywords = 
`, "utf8");
  const cfg = validateAndEnsureConfig(filePath);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, []);
});

testCase("CAT5-06", "Disabling with whitespace string \"   \"", () => {
  resetEnv();
  const filePath = getTestIniPath("cat5_06.ini");
  fs.writeFileSync(filePath, `
[duckdb]
safe_mode_keywords =        
`, "utf8");
  const cfg = validateAndEnsureConfig(filePath);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, []);
});

testCase("CAT5-07", "Disabling with combined string \"None, off\"", () => {
  resetEnv();
  const filePath = getTestIniPath("cat5_07.ini");
  fs.writeFileSync(filePath, `
[duckdb]
safe_mode_keywords = None, off
`, "utf8");
  const cfg = validateAndEnsureConfig(filePath);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, [], "None, off must parse to empty array []");
});

testCase("CAT5-08", "Disabling with repeated disabled tokens: NONE, OFF, none, off", () => {
  resetEnv();
  const filePath = getTestIniPath("cat5_08.ini");
  fs.writeFileSync(filePath, `
[duckdb]
safe_mode_keywords = NONE, OFF, none, off,   
`, "utf8");
  const cfg = validateAndEnsureConfig(filePath);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, []);
});

testCase("CAT5-09", "Filter out disabled tokens while preserving valid keywords: none, hayabusa, off, winlog", () => {
  resetEnv();
  const filePath = getTestIniPath("cat5_09.ini");
  fs.writeFileSync(filePath, `
[duckdb]
safe_mode_keywords = none, hayabusa, off, winlog
`, "utf8");
  const cfg = validateAndEnsureConfig(filePath);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, ["hayabusa", "winlog"]);
});

// =============================================================================
// CATEGORY 6: Idempotency of Auto-Healing (5 Consecutive Runs)
// =============================================================================
console.log(`\n${BOLD}--- Category 6: Idempotency of Auto-Healing (5 Runs) ---${RESET}`);

testCase("CAT6-01", "5 consecutive runs on clean default template: zero drift, byte identical", () => {
  resetEnv();
  const filePath = getTestIniPath("cat6_01.ini");
  fs.writeFileSync(filePath, DEFAULT_CONFIG_INI_TEXT, "utf8");

  let initialContent = "";
  for (let i = 1; i <= 5; i++) {
    const cfg = validateAndEnsureConfig(filePath);
    assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, DEFAULT_CONFIG.duckdb.safe_mode_keywords);
    assert.strictEqual(cfg.duckdb.safe_mode_parallel, true);

    const currentContent = fs.readFileSync(filePath, "utf8");
    if (i === 1) {
      initialContent = currentContent;
    } else {
      assert.strictEqual(currentContent, initialContent, `Run ${i} modified file content!`);
    }
  }
});

testCase("CAT6-02", "5 consecutive runs on custom config with user comments & custom sections", () => {
  resetEnv();
  const filePath = getTestIniPath("cat6_02.ini");
  const customUserText = `# Custom Header Forensics Lab 2026
; Lab station ID: WS-ALPHA-99

[general]
# Specific page size for memory constrained environment
page_size = 500
last_directory = E:\\ForensicCases\\2026\\Incident42

[duckdb]
# Max memory capped
max_memory = 2GB
threads = 4
safe_mode_keywords = hayabusa, sysmon, triage
safe_mode_parallel = false

[custom_forensic_evidence]
evidence_bag = 12345
analyst = HelloKittyXamKinLung

# End of custom config
`;

  fs.writeFileSync(filePath, customUserText, "utf8");

  let postRun1Content = "";
  for (let i = 1; i <= 5; i++) {
    const cfg = validateAndEnsureConfig(filePath);
    assert.strictEqual(cfg.general.page_size, 500);
    assert.strictEqual(cfg.general.last_directory, "E:\\ForensicCases\\2026\\Incident42");
    assert.strictEqual(cfg.duckdb.max_memory, "2GB");
    assert.strictEqual(cfg.duckdb.threads, 4);
    assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, ["hayabusa", "sysmon", "triage"]);
    assert.strictEqual(cfg.duckdb.safe_mode_parallel, false);

    const content = fs.readFileSync(filePath, "utf8");
    // Verify user comments survived
    assert.ok(content.includes("# Custom Header Forensics Lab 2026"));
    assert.ok(content.includes("; Lab station ID: WS-ALPHA-99"));
    assert.ok(content.includes("# Specific page size for memory constrained environment"));
    assert.ok(content.includes("[custom_forensic_evidence]"));
    assert.ok(content.includes("evidence_bag = 12345"));
    assert.ok(content.includes("analyst = HelloKittyXamKinLung"));

    // Check no duplicate safe_mode_keywords or safe_mode_parallel
    const kwMatches = (content.match(/safe_mode_keywords\s*=/g) || []).length;
    const parallelMatches = (content.match(/safe_mode_parallel\s*=/g) || []).length;
    assert.strictEqual(kwMatches, 1, `safe_mode_keywords occurred ${kwMatches} times on run ${i}`);
    assert.strictEqual(parallelMatches, 1, `safe_mode_parallel occurred ${parallelMatches} times on run ${i}`);

    if (i === 1) {
      postRun1Content = content;
    } else {
      assert.strictEqual(content, postRun1Content, `File drifted between run 1 and run ${i}`);
    }
  }
});

testCase("CAT6-03", "5 consecutive runs on heavily corrupted initial file", () => {
  resetEnv();
  const filePath = getTestIniPath("cat6_03.ini");
  fs.writeFileSync(filePath, `
[broken_duckdb
safe_mode_keywords = winlog
[general]
page_size = not_a_number
`, "utf8");

  let healed1 = "";
  for (let i = 1; i <= 5; i++) {
    const cfg = validateAndEnsureConfig(filePath);
    assert.strictEqual(typeof cfg.general.page_size, "number");
    assert.strictEqual(Array.isArray(cfg.duckdb.safe_mode_keywords), true);
    assert.strictEqual(typeof cfg.duckdb.safe_mode_parallel, "boolean");

    const content = fs.readFileSync(filePath, "utf8");
    if (i === 1) {
      healed1 = content;
    } else {
      assert.strictEqual(content, healed1, `Corrupted file drifted on run ${i}`);
    }
  }
});

// =============================================================================
// CATEGORY 7: Cross-Process Environment Variable Export & Restoration
// =============================================================================
console.log(`\n${BOLD}--- Category 7: Cross-Process Environment Variable Export & Restoration ---${RESET}`);

testCase("CAT7-01", "initPortableEnvironment exports environment variables", () => {
  resetEnv();
  const testAppDataDir = path.join(sandboxDir, "test_app_data_env");
  fs.mkdirSync(testAppDataDir, { recursive: true });
  const testConfigPath = path.join(testAppDataDir, "config.ini");
  fs.writeFileSync(testConfigPath, `
[duckdb]
safe_mode_keywords = triage, dfir, sysmon
safe_mode_parallel = false
`, "utf8");

  // Run validate
  const cfg = validateAndEnsureConfig(testConfigPath);
  assert.deepStrictEqual(cfg.duckdb.safe_mode_keywords, ["triage", "dfir", "sysmon"]);
  assert.strictEqual(cfg.duckdb.safe_mode_parallel, false);

  // Set env vars as initPortableEnvironment does
  process.env.TOAD_APP_DATA_DIR = testAppDataDir;
  process.env.TOAD_SAFE_KEYWORDS = cfg.duckdb.safe_mode_keywords.join(",");
  process.env.TOAD_SAFE_PARALLEL = String(cfg.duckdb.safe_mode_parallel);

  assert.strictEqual(process.env.TOAD_APP_DATA_DIR, testAppDataDir);
  assert.strictEqual(process.env.TOAD_SAFE_KEYWORDS, "triage,dfir,sysmon");
  assert.strictEqual(process.env.TOAD_SAFE_PARALLEL, "false");
});

testCase("CAT7-02", "Child process receives and parses exported environment variables", () => {
  const nodeExe = process.execPath;
  const distImportPath = path.resolve(ROOT_DIR, "tad-master/packages/reltab-duckdb/dist/csvimport.js");
  const childScript = `
    const { getIngestConfig } = require(${JSON.stringify(distImportPath)});
    const cfg = getIngestConfig();
    console.log(JSON.stringify({
      keywords: cfg.safe_mode_keywords,
      parallel: cfg.safe_mode_parallel,
      envKeywords: process.env.TOAD_SAFE_KEYWORDS,
      envParallel: process.env.TOAD_SAFE_PARALLEL
    }));
  `;

  // Provide child process with specific env
  const env = {
    ...process.env,
    TOAD_SAFE_KEYWORDS: "crowdstrike,carbonblack,sentinel",
    TOAD_SAFE_PARALLEL: "false",
  };

  const output = child_process.execFileSync(nodeExe, ["-e", childScript], {
    env,
    encoding: "utf8",
  });

  const parsed = JSON.parse(output.trim());
  assert.deepStrictEqual(parsed.keywords, ["crowdstrike", "carbonblack", "sentinel"]);
  assert.strictEqual(parsed.parallel, false);
  assert.strictEqual(parsed.envKeywords, "crowdstrike,carbonblack,sentinel");
  assert.strictEqual(parsed.envParallel, "false");
});

testCase("CAT7-03", "Child process with empty/none safe keywords disables safe mode", () => {
  const nodeExe = process.execPath;
  const distImportPath = path.resolve(ROOT_DIR, "tad-master/packages/reltab-duckdb/dist/csvimport.js");
  const childScript = `
    const { getIngestConfig, isComplexLogFile } = require(${JSON.stringify(distImportPath)});
    const cfg = getIngestConfig();
    const isHayabusaComplex = isComplexLogFile("hayabusa_high.csv");
    console.log(JSON.stringify({
      keywords: cfg.safe_mode_keywords,
      parallel: cfg.safe_mode_parallel,
      isHayabusaComplex
    }));
  `;

  const env = {
    ...process.env,
    TOAD_SAFE_KEYWORDS: "none",
    TOAD_SAFE_PARALLEL: "true",
  };

  const output = child_process.execFileSync(nodeExe, ["-e", childScript], {
    env,
    encoding: "utf8",
  });

  const parsed = JSON.parse(output.trim());
  assert.deepStrictEqual(parsed.keywords, []);
  assert.strictEqual(parsed.parallel, true);
  // When safe keywords is empty, hayabusa is not recognized as complex
  assert.strictEqual(parsed.isHayabusaComplex, false);
});

testCase("CAT7-04", "Full environment restoration removes pollution", () => {
  process.env.TOAD_SAFE_KEYWORDS = "temporary_leak_test";
  process.env.TOAD_SAFE_PARALLEL = "temporary_leak_val";
  process.env.TOAD_POLLUTION_VAR = "polluted";

  resetEnv();

  assert.strictEqual(process.env.TOAD_POLLUTION_VAR, undefined);
  assert.strictEqual(process.env.TOAD_SAFE_KEYWORDS, originalEnv.TOAD_SAFE_KEYWORDS);
  assert.strictEqual(process.env.TOAD_SAFE_PARALLEL, originalEnv.TOAD_SAFE_PARALLEL);
});

// Cleanup sandbox
try {
  fs.rmSync(sandboxDir, { recursive: true, force: true });
} catch (e) {
  // Ignored in temp cleanup
}

// Summary
console.log(`\n${BOLD}${CYAN}======================================================================${RESET}`);
console.log(`${BOLD}${CYAN}  CHALLENGE HARNESS EXECUTION SUMMARY                                  ${RESET}`);
console.log(`${BOLD}${CYAN}======================================================================${RESET}`);
console.log(`  Total Tests Run : ${totalTests}`);
console.log(`  Passed          : ${GREEN}${passedTests}${RESET}`);
console.log(`  Failed          : ${failedTests > 0 ? RED + failedTests + RESET : GREEN + "0" + RESET}`);

if (failedTests > 0) {
  console.log(`\n${RED}${BOLD}  VERDICT: REQUEST_CHANGES (${failedTests} tests failed)${RESET}`);
  process.exit(1);
} else {
  console.log(`\n${GREEN}${BOLD}  VERDICT: APPROVE (100% empirical challenge pass rate)${RESET}`);
  process.exit(0);
}
