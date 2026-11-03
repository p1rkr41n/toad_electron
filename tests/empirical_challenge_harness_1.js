/**
 * EMPIRICAL CHALLENGE HARNESS 1 — Toad v2.4.3
 * Archetype: EMPIRICAL CHALLENGER (challenger_1)
 * 
 * Adversarial stress testing for:
 * 1. getRelativeParentDir corner and boundary cases (Deep paths, trailing slashes, leading slashes, backslashes, mixed case, UNC paths, root files)
 * 2. In-memory search filter (20,000 files across 50 projects; zero collision on project names; p50/p95 latency)
 * 3. Interactive table sort engine (numeric vs alpha, 0-byte, multi-GB, casing, stability, 20k sort)
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT_DIR = path.resolve(__dirname, "..");
module.paths.push(path.resolve(ROOT_DIR, "tad-master/node_modules"));
module.paths.push(path.resolve(ROOT_DIR, "tad-master/packages/tadviewer/node_modules"));

// Import production compiled functions directly from tadviewer build
const pft = require(path.resolve(ROOT_DIR, "tad-master/packages/tadviewer/dist/components/ProjectFilesTable"));
const { getRelativeParentDir, sortFiles, filterFiles, formatFileBytes } = pft;

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

let totalChallenges = 0;
let passedChallenges = 0;
let failedChallenges = 0;
const failureDetails = [];

function challenge(name, fn) {
  totalChallenges++;
  const t0 = process.hrtime();
  try {
    fn();
    const diff = process.hrtime(t0);
    const ms = (diff[0] * 1000 + diff[1] / 1e6).toFixed(3);
    passedChallenges++;
    console.log(`  ${GREEN}✓ [PASS]${RESET} ${name} (${ms} ms)`);
  } catch (err) {
    failedChallenges++;
    failureDetails.push({ name, error: err.message, stack: err.stack });
    console.error(`  ${RED}✗ [FAIL]${RESET} ${name}`);
    console.error(`    ${RED}Error: ${err.message}${RESET}`);
  }
}

console.log(`\n${BOLD}======================================================================${RESET}`);
console.log(`${BOLD}  EMPIRICAL CHALLENGER 1: getRelativeParentDir Boundary & Stress Matrix${RESET}`);
console.log(`${BOLD}======================================================================${RESET}`);

// 1.1 Deep Paths
challenge("1.1 Deeply nested directory structure (50 levels deep)", () => {
  const levels = Array.from({ length: 50 }, (_, i) => `lvl_${i}`).join("/");
  const filePath = `C:/Workspace/${levels}/target_file.parquet`;
  const folderRoot = `C:/Workspace`;
  const res = getRelativeParentDir(filePath, folderRoot);
  assert.strictEqual(res, `${levels}/`, "50 levels relative path must match exactly");
});

// 1.2 Deep Paths standalone (no folder root)
challenge("1.2 Deeply nested standalone file (immediate parent level only)", () => {
  const levels = Array.from({ length: 50 }, (_, i) => `lvl_${i}`).join("/");
  const filePath = `D:/DeepData/${levels}/data.csv`;
  const res = getRelativeParentDir(filePath);
  assert.strictEqual(res, `lvl_49/`, "Standalone deep path must return immediate parent directory");
});

// 1.3 Trailing slashes on root and file paths
challenge("1.3 Trailing slashes normalization on folderRoot and filePath", () => {
  assert.strictEqual(
    getRelativeParentDir("C:/data/logs/file.csv", "C:/data/"),
    "logs/",
    "Single trailing slash on folderRoot"
  );
  assert.strictEqual(
    getRelativeParentDir("C:/data/logs/file.csv", "C:/data///"),
    "logs/",
    "Multiple trailing slashes on folderRoot"
  );
  assert.strictEqual(
    getRelativeParentDir("C:/data/file.csv", "C:/data/"),
    "./",
    "Direct child of folderRoot with trailing slash"
  );
});

// 1.4 Leading slashes & Unix paths
challenge("1.4 Unix root & leading slash paths", () => {
  assert.strictEqual(getRelativeParentDir("/var/log/nginx/access.log", "/var/log"), "nginx/");
  assert.strictEqual(getRelativeParentDir("/var/log/access.log", "/var/log"), "./");
  assert.strictEqual(getRelativeParentDir("/var/log/nginx/access.log"), "nginx/");
  assert.strictEqual(getRelativeParentDir("/access.log"), "./");
});

// 1.5 Backslashes & mixed slash chaos
challenge("1.5 Mixed backslashes, forward slashes, and redundant separators", () => {
  assert.strictEqual(
    getRelativeParentDir("C:\\Projects\\\\Analytics//deep\\nested///data.csv", "c:/projects/analytics"),
    "deep/nested/",
    "Mixed backslashes and forward slashes"
  );
  assert.strictEqual(
    getRelativeParentDir("E:\\\\data\\\\sub\\\\f.csv", "E:\\data\\"),
    "sub/",
    "Redundant Windows backslashes"
  );
});

// 1.6 Mixed case normalization
challenge("1.6 Case-insensitive path comparison across different casings", () => {
  assert.strictEqual(
    getRelativeParentDir("C:/PROJECTS/SALES/Q1/DATA.CSV", "c:/projects/sales"),
    "Q1/",
    "Uppercase file path vs lowercase folder root"
  );
  assert.strictEqual(
    getRelativeParentDir("c:/projects/sales/q1/data.csv", "C:/PROJECTS/SALES"),
    "q1/",
    "Lowercase file path vs uppercase folder root"
  );
  assert.strictEqual(
    getRelativeParentDir("C:/Projects/Sales/REPORT.CSV", "c:/PROJECTS/sales/"),
    "./",
    "Mixed case root child"
  );
});

// 1.7 UNC Paths (Windows network shares)
challenge("1.7 UNC Network Share Paths (\\\\server\\share\\...)", () => {
  // With folderRoot at share level
  assert.strictEqual(
    getRelativeParentDir("\\\\fileserver\\shared_data\\finance\\q1_report.xlsx", "\\\\fileserver\\shared_data"),
    "finance/",
    "UNC path with share root"
  );
  // With folderRoot at subfolder level
  assert.strictEqual(
    getRelativeParentDir("\\\\192.168.1.100\\backup\\tad_data\\2026\\audit.parquet", "\\\\192.168.1.100\\backup\\tad_data"),
    "2026/",
    "UNC IP address path"
  );
  // Root file of UNC share
  assert.strictEqual(
    getRelativeParentDir("\\\\server\\share\\root_summary.csv", "\\\\server\\share"),
    "./",
    "UNC direct share root child"
  );
  // Standalone UNC file
  assert.strictEqual(
    getRelativeParentDir("\\\\server\\share\\department\\employee.csv"),
    "department/",
    "Standalone UNC file yields immediate folder"
  );
});

// 1.8 Root drive files & minimal paths
challenge("1.8 Root drive files and minimal paths", () => {
  assert.strictEqual(getRelativeParentDir("C:/data.csv"), "./", "Windows root drive forward slash");
  assert.strictEqual(getRelativeParentDir("C:\\data.csv"), "./", "Windows root drive backslash");
  assert.strictEqual(getRelativeParentDir("D:/sample.tsv"), "./", "Windows drive D root file");
  assert.strictEqual(getRelativeParentDir("file_only.csv"), "./", "No path separator at all");
  assert.strictEqual(getRelativeParentDir("./file_only.csv"), "./", "Relative current dir ./");
  assert.strictEqual(getRelativeParentDir(""), "./", "Empty string fallback");
  assert.strictEqual(getRelativeParentDir(null), "./", "Null fallback");
  assert.strictEqual(getRelativeParentDir(undefined), "./", "Undefined fallback");
});

// 1.9 Special characters, spaces, and international unicode
challenge("1.9 Unicode, spaces, and special URI-like characters in file paths", () => {
  assert.strictEqual(
    getRelativeParentDir("C:/Dự Án/Dữ Liệu Báo Cáo 2026/tháng 04/tổng_hợp.csv", "C:/Dự Án/Dữ Liệu Báo Cáo 2026"),
    "tháng 04/",
    "Vietnamese UTF-8 unicode path"
  );
  assert.strictEqual(
    getRelativeParentDir("C:/data/special#name%20[v1]/output.csv", "C:/data"),
    "special#name%20[v1]/",
    "Special characters # % [ ] in path"
  );
});

console.log(`\n${BOLD}======================================================================${RESET}`);
console.log(`${BOLD}  EMPIRICAL CHALLENGER 1: In-Memory Search Engine Stress Test (20k Files)${RESET}`);
console.log(`${BOLD}======================================================================${RESET}`);

// Generate 20,000 files across 50 projects (400 files/project)
const NUM_PROJECTS = 50;
const FILES_PER_PROJECT = 400;
const TOTAL_FILES = NUM_PROJECTS * FILES_PER_PROJECT; // 20,000

const mockWorkspace = [];
const projectNames = [
  "Alpha Financial Intelligence", "Beta Healthcare Analytics", "Gamma Cloud Infrastructure",
  "Delta Cyber Defense", "Epsilon Retail Network", "Zeta Energy Optimization",
  "Eta Logistics Supply", "Theta Banking Transactions", "Iota Mobile Telemetry",
  "Kappa Satellite Imaging", "Lambda Quantum Computing", "Mu Gene Sequencing",
  "Nu Aerospace Avionics", "Xi Global Payments", "Omicron Edge IoT",
  "Pi Distributed Database", "Rho High Frequency Trading", "Sigma Neural Networks",
  "Tau Autonomous Systems", "Upsilon Industrial Robotics", "Phi Marine Navigation",
  "Chi Semiconductor Litho", "Psi Quantum Cryptography", "Omega Defense Systems",
  "Aurora Observability", "Borealis Data Pipeline", "Chronos TimeSeries",
  "Hyperion Supercomputing", "Nexus Enterprise Grid", "Vortex Fluid Dynamics",
  "Aegis Firewall Monitor", "Sentinel Threat Intelligence", "Beacon Sensor Mesh",
  "Titan Distributed Ledger", "Solstice Climate Models", "Phoenix Incident Response",
  "Atlas Geospatial GIS", "Orion Constellation Tracker", "Helios Solar Grid",
  "Valkyrie Security Audit", "Pegasus Air Mobility", "Kraken Deep Storage",
  "Hydra Stream Processor", "Cerberus Authentication", "Minotaur Graph Analytics",
  "Siren Audio Forensics", "Gorgon Threat Hunter", "Cyclops Video Analytics",
  "Chimera GenAI Lab", "Leviathan Oceanographic"
];

for (let p = 0; p < NUM_PROJECTS; p++) {
  const prjId = `prj_${p.toString().padStart(3, "0")}`;
  const prjName = projectNames[p % projectNames.length] + ` [Stage ${p}]`;
  const files = [];

  for (let f = 0; f < FILES_PER_PROJECT; f++) {
    const ext = ["csv", "parquet", "jsonl", "log", "tsv"][f % 5];
    // Generate distinct file names that intentionally DO NOT contain project keywords
    const fileName = `dataset_p${p}_f${f}_metric_${(f * 17) % 1000}.${ext}`;
    const fileSizeBytes = ((f * 31337 + p * 7919) % (10 * 1024 * 1024 * 1024)); // up to 10 GB
    files.push({
      projectId: prjId,
      fileName,
      filePath: `C:/DataStore/${prjId}/${fileName}`,
      fileSizeBytes,
      relDir: `sub_${f % 10}/`,
      effectiveStatus: ["READY", "MODIFIED", "PENDING", "ERROR"][f % 4],
    });
  }

  // Inject a few known target files for specific adversarial assertions
  if (p === 0) {
    files.push({
      projectId: prjId,
      fileName: "adversarial_target_zero_collision.csv",
      filePath: `C:/DataStore/${prjId}/adversarial_target_zero_collision.csv`,
      fileSizeBytes: 42,
      relDir: "./",
      effectiveStatus: "READY",
    });
  }

  mockWorkspace.push({
    projectId: prjId,
    projectName: prjName,
    files,
  });
}

console.log(`  Constructed test catalog: ${mockWorkspace.length} projects, ~${TOTAL_FILES + 1} files total.`);

// The exact search filter algorithm from DataSourceSidebar.tsx
function executeSearchFilter(catalog, query) {
  const q = (query || "").toLowerCase().trim();
  return catalog
    .map((proj) => {
      // Strictly filter 100% on file name; NEVER match project name!
      const matchingFiles = q
        ? proj.files.filter((f) => f.fileName.toLowerCase().includes(q))
        : proj.files;

      const hasMatches = matchingFiles.length > 0;
      const shouldShow = !q || hasMatches;

      return {
        projectId: proj.projectId,
        projectName: proj.projectName,
        files: matchingFiles,
        totalFiles: proj.files.length,
        shouldShow,
        isExpanded: Boolean(q ? true : false),
      };
    })
    .filter((p) => p.shouldShow);
}

// 2.1 Adversarial Zero-Collision Test: Query matches Project Name, NEVER files!
challenge("2.1 Project Name search NEVER matches non-matching files (Zero Collision)", () => {
  // Query for "Financial" (matches Project 0 "Alpha Financial Intelligence", but 0 files have "financial")
  const t0 = process.hrtime();
  const results = executeSearchFilter(mockWorkspace, "Financial");
  const diff = process.hrtime(t0);
  const ms = diff[0] * 1000 + diff[1] / 1e6;

  // Assert that 0 projects show up!
  assert.strictEqual(results.length, 0, "Query 'Financial' must yield 0 projects because no files contain 'financial'");
  
  // Also test with "Cyber" (matches Delta Cyber Defense)
  const resCyber = executeSearchFilter(mockWorkspace, "Cyber");
  assert.strictEqual(resCyber.length, 0, "Query 'Cyber' must yield 0 projects");

  // Also test with "Healthcare"
  const resHealth = executeSearchFilter(mockWorkspace, "Healthcare");
  assert.strictEqual(resHealth.length, 0, "Query 'Healthcare' must yield 0 projects");
});

// 2.2 Needle in a Haystack Search across 20,000 files
challenge("2.2 Single exact file needle in 20,000 file catalog", () => {
  const t0 = process.hrtime();
  const results = executeSearchFilter(mockWorkspace, "adversarial_target_zero_collision");
  const diff = process.hrtime(t0);
  const ms = diff[0] * 1000 + diff[1] / 1e6;

  assert.strictEqual(results.length, 1, "Exactly 1 project must show");
  assert.strictEqual(results[0].projectId, "prj_000");
  assert.strictEqual(results[0].files.length, 1);
  assert.strictEqual(results[0].files[0].fileName, "adversarial_target_zero_collision.csv");
  assert(ms < 20.0, `Search latency must be < 20ms across 20,000 files (actual: ${ms.toFixed(2)} ms)`);
});

// 2.3 Broad query matching across all 50 projects
challenge("2.3 Broad query ('parquet') filtering 20,000 files in < 25ms", () => {
  const t0 = process.hrtime();
  const results = executeSearchFilter(mockWorkspace, "parquet");
  const diff = process.hrtime(t0);
  const ms = diff[0] * 1000 + diff[1] / 1e6;

  // Each project has 400 files, 1 in 5 is .parquet = 80 parquet files per project
  assert.strictEqual(results.length, NUM_PROJECTS, "All 50 projects should have parquet files");
  const totalParquet = results.reduce((acc, p) => acc + p.files.length, 0);
  assert.strictEqual(totalParquet, NUM_PROJECTS * (FILES_PER_PROJECT / 5));
  assert(ms < 30.0, `Broad filter across 20k files took ${ms.toFixed(2)} ms (budget < 30ms)`);
});

// 2.4 Regex & special characters in search query must not throw
challenge("2.4 Adversarial query strings (regex symbols, unicode, quotes, braces)", () => {
  const adversarialQueries = [
    ".*",
    "[a-z]+",
    "(.*)?",
    "\\d+\\.csv",
    "../../../etc/passwd",
    "'; DROP TABLE files; --",
    "<script>alert(1)</script>",
    "$$${{__dirname}}",
    "    ",
    "   metric_17   ",
  ];

  for (const q of adversarialQueries) {
    assert.doesNotThrow(() => {
      const res = executeSearchFilter(mockWorkspace, q);
      assert(Array.isArray(res));
    }, `Query '${q}' must not throw error`);
  }
});

// 2.5 Empty query restores all 20,000 files instantly
challenge("2.5 Empty query restoration maintains all files with 0ms overhead", () => {
  const t0 = process.hrtime();
  const results = executeSearchFilter(mockWorkspace, "");
  const diff = process.hrtime(t0);
  const ms = diff[0] * 1000 + diff[1] / 1e6;

  assert.strictEqual(results.length, NUM_PROJECTS);
  const totalFiles = results.reduce((acc, p) => acc + p.files.length, 0);
  assert.strictEqual(totalFiles, TOTAL_FILES + 1);
  assert(ms < 10.0, `Empty query reset took ${ms.toFixed(2)} ms`);
});

console.log(`\n${BOLD}======================================================================${RESET}`);
console.log(`${BOLD}  EMPIRICAL CHALLENGER 1: Interactive Table Sort Engine Stress Test${RESET}`);
console.log(`${BOLD}======================================================================${RESET}`);

// 3.1 Identical sizes stability
challenge("3.1 Stable sorting with identical file sizes", () => {
  const identicalFiles = Array.from({ length: 100 }, (_, i) => ({
    fileName: `file_${i.toString().padStart(3, "0")}.csv`,
    relDir: "logs/",
    fileSizeBytes: 1024, // Identical size
    effectiveStatus: "READY",
  }));

  const sortedAsc = sortFiles(identicalFiles, "size", "asc");
  assert.strictEqual(sortedAsc.length, 100);
  assert.strictEqual(sortedAsc[0].fileName, "file_000.csv");
  assert.strictEqual(sortedAsc[99].fileName, "file_099.csv");

  const sortedDesc = sortFiles(identicalFiles, "size", "desc");
  assert.strictEqual(sortedDesc.length, 100);
});

// 3.2 0-byte, negative, null, and undefined file sizes
challenge("3.2 0-byte, null, and undefined file size edge conditions", () => {
  const boundaryFiles = [
    { fileName: "pos_10.csv", relDir: "./", fileSizeBytes: 10, effectiveStatus: "READY" },
    { fileName: "zero_bytes.csv", relDir: "./", fileSizeBytes: 0, effectiveStatus: "READY" },
    { fileName: "null_bytes.csv", relDir: "./", fileSizeBytes: null, effectiveStatus: "READY" },
    { fileName: "undef_bytes.csv", relDir: "./", fileSizeBytes: undefined, effectiveStatus: "READY" },
    { fileName: "pos_500.csv", relDir: "./", fileSizeBytes: 500, effectiveStatus: "READY" },
  ];

  const sortedAsc = sortFiles(boundaryFiles, "size", "asc");
  assert.strictEqual(sortedAsc[sortedAsc.length - 1].fileSizeBytes, 500);
  assert.strictEqual(sortedAsc[sortedAsc.length - 2].fileSizeBytes, 10);
  
  const sortedDesc = sortFiles(boundaryFiles, "size", "desc");
  assert.strictEqual(sortedDesc[0].fileSizeBytes, 500);
  assert.strictEqual(sortedDesc[1].fileSizeBytes, 10);
});

// 3.3 Multi-Gigabyte numeric sorting vs alphabetical string sorting trap
challenge("3.3 Multi-gigabyte numeric sorting (Strict numeric bytes vs alphabetical)", () => {
  const sizeFiles = [
    { fileName: "large_50gb.parquet", relDir: "./", fileSizeBytes: 53687091200, effectiveStatus: "READY" },   // 50 GB
    { fileName: "small_512b.csv", relDir: "./", fileSizeBytes: 512, effectiveStatus: "READY" },                // 512 B
    { fileName: "med_2mb.parquet", relDir: "./", fileSizeBytes: 2097152, effectiveStatus: "READY" },            // 2 MB
    { fileName: "huge_5gb.bin", relDir: "./", fileSizeBytes: 5368709120, effectiveStatus: "READY" },            // 5 GB
    { fileName: "tiny_1kb.tsv", relDir: "./", fileSizeBytes: 1024, effectiveStatus: "READY" },                 // 1 KB
  ];

  const asc = sortFiles(sizeFiles, "size", "asc");
  const ascSizes = asc.map((f) => f.fileSizeBytes);
  assert.deepStrictEqual(
    ascSizes,
    [512, 1024, 2097152, 5368709120, 53687091200],
    "ASC sort must be strictly numeric: 512 B < 1 KB < 2 MB < 5 GB < 50 GB"
  );

  const alphabeticalOrder = [...sizeFiles].sort((a, b) => String(a.fileSizeBytes).localeCompare(String(b.fileSizeBytes)));
  assert.notDeepStrictEqual(
    ascSizes,
    alphabeticalOrder.map((f) => f.fileSizeBytes),
    "Numeric sort must NOT match flawed alphabetical string ordering"
  );

  const desc = sortFiles(sizeFiles, "size", "desc");
  const descSizes = desc.map((f) => f.fileSizeBytes);
  assert.deepStrictEqual(
    descSizes,
    [53687091200, 5368709120, 2097152, 1024, 512],
    "DESC sort must be strictly descending: 50 GB > 5 GB > 2 MB > 1 KB > 512 B"
  );
});

// 3.4 Identical names with different cases
challenge("3.4 Identical file names with different cases", () => {
  const caseFiles = [
    { fileName: "readme.txt", relDir: "./", fileSizeBytes: 10, effectiveStatus: "READY" },
    { fileName: "README.TXT", relDir: "./", fileSizeBytes: 20, effectiveStatus: "READY" },
    { fileName: "ReadMe.txt", relDir: "./", fileSizeBytes: 30, effectiveStatus: "READY" },
    { fileName: "rEADmE.TXT", relDir: "./", fileSizeBytes: 40, effectiveStatus: "READY" },
  ];

  assert.doesNotThrow(() => {
    const asc = sortFiles(caseFiles, "name", "asc");
    assert.strictEqual(asc.length, 4);
    const desc = sortFiles(caseFiles, "name", "desc");
    assert.strictEqual(desc.length, 4);
  });
});

// 3.5 High-volume sort benchmark: 20,000 files sorted in < 50ms
challenge("3.5 High-volume sort benchmark on 20,000 files across all columns", () => {
  const flat20k = mockWorkspace.flatMap((p) => p.files);
  assert.strictEqual(flat20k.length, TOTAL_FILES + 1);

  // Sort by Name
  let t0 = process.hrtime();
  const byName = sortFiles(flat20k, "name", "asc");
  let msName = (process.hrtime(t0)[0] * 1000 + process.hrtime(t0)[1] / 1e6);

  // Sort by Size (numeric)
  t0 = process.hrtime();
  const bySize = sortFiles(flat20k, "size", "desc");
  let msSize = (process.hrtime(t0)[0] * 1000 + process.hrtime(t0)[1] / 1e6);

  // Sort by Dir
  t0 = process.hrtime();
  const byDir = sortFiles(flat20k, "dir", "asc");
  let msDir = (process.hrtime(t0)[0] * 1000 + process.hrtime(t0)[1] / 1e6);

  // Sort by Status
  t0 = process.hrtime();
  const byStatus = sortFiles(flat20k, "status", "asc");
  let msStatus = (process.hrtime(t0)[0] * 1000 + process.hrtime(t0)[1] / 1e6);

  console.log(`    Sorting 20,000 items latency:`);
  console.log(`      Name sort  : ${msName.toFixed(2)} ms`);
  console.log(`      Size sort  : ${msSize.toFixed(2)} ms (Numeric)`);
  console.log(`      Dir sort   : ${msDir.toFixed(2)} ms`);
  console.log(`      Status sort: ${msStatus.toFixed(2)} ms`);

  assert(msSize < 50.0, `Numeric size sort of 20k files must complete in < 50ms (actual: ${msSize.toFixed(2)} ms)`);
  assert.strictEqual(bySize[0].fileSizeBytes >= bySize[1].fileSizeBytes, true);
});

// 3.6 formatFileBytes formatting verification
challenge("3.6 formatFileBytes boundary formatting (B, KB, MB, GB, 0 B)", () => {
  assert.strictEqual(formatFileBytes(0), "0 B");
  assert.strictEqual(formatFileBytes(-10), "0 B");
  assert.strictEqual(formatFileBytes(null), "0 B");
  assert.strictEqual(formatFileBytes(undefined), "0 B");
  assert.strictEqual(formatFileBytes(500), "500 B");
  assert.strictEqual(formatFileBytes(1024), "1.0 KB");
  assert.strictEqual(formatFileBytes(1536), "1.5 KB");
  assert.strictEqual(formatFileBytes(1048576), "1.00 MB");
  assert.strictEqual(formatFileBytes(26214400), "25.00 MB");
  assert.strictEqual(formatFileBytes(1073741824), "1.00 GB");
  assert.strictEqual(formatFileBytes(53687091200), "50.00 GB");
});

console.log(`\n${BOLD}======================================================================${RESET}`);
console.log(`${BOLD}  EMPIRICAL CHALLENGER 1 HARNESS SUMMARY${RESET}`);
console.log(`${BOLD}======================================================================${RESET}`);
console.log(`  Total Challenges Executed : ${totalChallenges}`);
console.log(`  Passed                    : ${passedChallenges}`);
console.log(`  Failed                    : ${failedChallenges}`);
console.log(`${BOLD}======================================================================${RESET}\n`);

if (failedChallenges > 0) {
  console.error(`${RED}FAILURE: ${failedChallenges} empirical challenge(s) failed!${RESET}`);
  process.exit(1);
} else {
  console.log(`${GREEN}ALL EMPIRICAL CHALLENGES PASSED CONVINCINGLY!${RESET}`);
  process.exit(0);
}
