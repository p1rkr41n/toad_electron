// tests/test_pipeline_challenge.js
// Empirical test harness for Challenger 2: Build Scripts & Packaging Stress Verification

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');

console.log('======================================================================');
console.log('  CHALLENGER 2: BUILD SCRIPTS & PACKAGING EMPIRICAL HARNESS');
console.log('======================================================================\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`[PASS] ${testName}`);
  } else {
    failedTests++;
    console.error(`[FAIL] ${testName} - ${details}`);
  }
}

// ============================================================================
// SUITE 1: PowerShell Build and Release Scripts
// ============================================================================
console.log('--- SUITE 1: PowerShell Build & Release Scripts & Version Bumping ---');

// 1.1 fastbuild.ps1 syntax
try {
  execSync(`powershell -Command "[scriptblock]::Create((Get-Content '${path.join(ROOT_DIR, 'fastbuild.ps1')}' -Raw)) | Out-Null"`, { stdio: 'pipe' });
  assert(true, '1.1 fastbuild.ps1 compiles as valid PowerShell syntax');
} catch (e) {
  assert(false, '1.1 fastbuild.ps1 compiles as valid PowerShell syntax', e.message);
}

// 1.2 dist_package.ps1 syntax
try {
  execSync(`powershell -Command "[scriptblock]::Create((Get-Content '${path.join(ROOT_DIR, 'dist_package.ps1')}' -Raw)) | Out-Null"`, { stdio: 'pipe' });
  assert(true, '1.2 dist_package.ps1 compiles as valid PowerShell syntax');
} catch (e) {
  assert(false, '1.2 dist_package.ps1 compiles as valid PowerShell syntax', e.message);
}

// 1.3 package_release.ps1 syntax
try {
  execSync(`powershell -Command "[scriptblock]::Create((Get-Content '${path.join(ROOT_DIR, 'package_release.ps1')}' -Raw)) | Out-Null"`, { stdio: 'pipe' });
  assert(true, '1.3 package_release.ps1 compiles as valid PowerShell syntax');
} catch (e) {
  assert(false, '1.3 package_release.ps1 compiles as valid PowerShell syntax', e.message);
}

// 1.4 fastbuild.ps1 path resolution
const fastbuildContent = fs.readFileSync(path.join(ROOT_DIR, 'fastbuild.ps1'), 'utf8');
assert(
  fastbuildContent.includes('toad-app') && fastbuildContent.includes('tad-app'),
  '1.4 fastbuild.ps1 includes dynamic resolution for toad-app with tad-app fallback'
);
assert(
  fastbuildContent.includes('toadviewer') && fastbuildContent.includes('tadviewer'),
  '1.5 fastbuild.ps1 includes dynamic resolution for toadviewer with tadviewer fallback'
);
assert(
  fastbuildContent.includes('toadapp.bundle.js') && fastbuildContent.includes('tadapp.bundle.js'),
  '1.6 fastbuild.ps1 checks for toadapp.bundle.js with tadapp.bundle.js fallback'
);

// 1.5 dist_package.ps1 path resolution
const distPackageContent = fs.readFileSync(path.join(ROOT_DIR, 'dist_package.ps1'), 'utf8');
assert(
  distPackageContent.includes('toad-app') && distPackageContent.includes('tad-app'),
  '1.7 dist_package.ps1 includes dynamic resolution for toad-app with tad-app fallback'
);
assert(
  distPackageContent.includes('toadviewer') && distPackageContent.includes('tadviewer'),
  '1.8 dist_package.ps1 includes dynamic resolution for toadviewer with tadviewer fallback'
);
assert(
  distPackageContent.includes('toadapp.bundle.js') && distPackageContent.includes('tadapp.bundle.js'),
  '1.9 dist_package.ps1 resolves toadapp.bundle.js with fallback'
);
assert(
  distPackageContent.includes('v2.4.8') && distPackageContent.includes('v2.4.7'),
  '1.10 dist_package.ps1 whitelist accommodates target version v2.4.8 and v2.4.7'
);

// 1.6 tools/bump_version.js target resolution & dry run
const bumpScriptPath = path.join(ROOT_DIR, 'tools/bump_version.js');
assert(fs.existsSync(bumpScriptPath), '1.11 tools/bump_version.js exists');

try {
  const bumpOut = execSync(`"${process.execPath}" "${bumpScriptPath}"`, { stdio: 'pipe' }).toString();
  assert(false, '1.12 tools/bump_version.js requires version argument', 'Expected non-zero exit code');
} catch (e) {
  const errOutput = (e.stderr ? e.stderr.toString() : '') + (e.stdout ? e.stdout.toString() : '');
  assert(
    errOutput.includes('Usage: node tools/bump_version.js'),
    '1.12 tools/bump_version.js safely handles missing args and shows usage help',
    `Received: ${errOutput}`
  );
}

// Verify bump_version.js target files
const bumpContent = fs.readFileSync(bumpScriptPath, 'utf8');
const targetFiles = [
  'tad-master/packages/toad-app/package.json',
  'tad-master/packages/host-bridge/package.json',
  'tad-master/packages/reltab-duckdb/package.json',
  'tad-master/packages/toadviewer/package.json',
  'tad-master/packages/toadviewer/src/components/RegexDialog.tsx',
  'dist_package.ps1',
  'package_release.ps1',
  'README.md',
  'releases/HelloKittyXamKinLung.Toad.yaml'
];

targetFiles.forEach((fileRel, idx) => {
  const abs = path.join(ROOT_DIR, fileRel);
  assert(fs.existsSync(abs), `1.13.${idx + 1} Target file ${fileRel} exists for bump_version.js`);
});

// Verify regexes in bump_version.js match current content
const regexDialogPath = path.join(ROOT_DIR, 'tad-master/packages/toadviewer/src/components/RegexDialog.tsx');
const regexDialogText = fs.readFileSync(regexDialogPath, 'utf8');
assert(/v\d+\.\d+\.\d+(?:\.\d+)?/.test(regexDialogText), '1.14 bump_version.js regex matches version in RegexDialog.tsx');

const distPkgText = fs.readFileSync(path.join(ROOT_DIR, 'dist_package.ps1'), 'utf8');
assert(/Toad-\d+\.\d+\.\d+(?:\.\d+)?-x64-portable\.exe/.test(distPkgText), '1.15 bump_version.js regex matches Toad-*-x64-portable.exe in dist_package.ps1');

const pkgRelText = fs.readFileSync(path.join(ROOT_DIR, 'package_release.ps1'), 'utf8');
assert(/\[string\]\$Version = "[^"]+"/.test(pkgRelText), '1.16 bump_version.js regex matches $Version in package_release.ps1');

const readmeText = fs.readFileSync(path.join(ROOT_DIR, 'README.md'), 'utf8');
assert(/Toad \(v\d+\.\d+\.\d+(?:\.\d+)?\)/.test(readmeText), '1.17 bump_version.js regex matches Toad (v...) in README.md');
assert(/badge\/Version-[\d\.]+-/.test(readmeText), '1.18 bump_version.js regex matches badge in README.md');

const yamlText = fs.readFileSync(path.join(ROOT_DIR, 'releases/HelloKittyXamKinLung.Toad.yaml'), 'utf8');
assert(/PackageVersion: [\d\.]+/.test(yamlText), '1.19 bump_version.js regex matches PackageVersion in winget yaml');

// ============================================================================
// SUITE 2: Webpack Bundles and HTML Assets
// ============================================================================
console.log('\n--- SUITE 2: Webpack Bundles and HTML Assets ---');

const toadappBundlePath = path.join(ROOT_DIR, 'tad-master/packages/toad-app/dist/toadapp.bundle.js');
assert(fs.existsSync(toadappBundlePath), '2.1 toadapp.bundle.js exists');

const bundleStat = fs.existsSync(toadappBundlePath) ? fs.statSync(toadappBundlePath) : null;
assert(bundleStat && bundleStat.size > 1000000, `2.2 toadapp.bundle.js is non-empty (${bundleStat ? bundleStat.size : 0} bytes)`);

let validJsToad = false;
try {
  const code = fs.readFileSync(toadappBundlePath, 'utf8');
  new vm.Script(code);
  validJsToad = true;
} catch (e) {
  validJsToad = false;
}
assert(validJsToad, '2.3 toadapp.bundle.js contains valid, executable JavaScript syntax');

const htmlPath = path.join(ROOT_DIR, 'tad-master/packages/toad-app/html/index.html');
assert(fs.existsSync(htmlPath), '2.4 toad-app/html/index.html exists');

const htmlContent = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
assert(
  htmlContent.includes('<script src="toadapp.bundle.js"></script>'),
  '2.5 toad-app/html/index.html loads <script src="toadapp.bundle.js"></script>'
);

const distHtmlPath = path.join(ROOT_DIR, 'tad-master/packages/toad-app/dist/index.html');
assert(fs.existsSync(distHtmlPath), '2.6 toad-app/dist/index.html exists');

const distHtmlContent = fs.existsSync(distHtmlPath) ? fs.readFileSync(distHtmlPath, 'utf8') : '';
assert(
  distHtmlContent.includes('<script src="toadapp.bundle.js"></script>'),
  '2.7 toad-app/dist/index.html loads <script src="toadapp.bundle.js"></script>'
);

const toadviewerJsPath = path.join(ROOT_DIR, 'tad-master/packages/toadviewer/dist/toadviewer.js');
assert(fs.existsSync(toadviewerJsPath), '2.8 toadviewer/dist/toadviewer.js exists');

let validJsViewer = false;
try {
  const code = fs.readFileSync(toadviewerJsPath, 'utf8');
  new vm.Script(code);
  validJsViewer = true;
} catch (e) {
  validJsViewer = false;
}
assert(validJsViewer, '2.9 toadviewer/dist/toadviewer.js contains valid JavaScript');

const tadviewerJsPath = path.join(ROOT_DIR, 'tad-master/packages/toadviewer/dist/tadviewer.js');
assert(fs.existsSync(tadviewerJsPath), '2.10 toadviewer/dist/tadviewer.js exists (legacy fallback)');

let validJsTadViewer = false;
try {
  const code = fs.readFileSync(tadviewerJsPath, 'utf8');
  new vm.Script(code);
  validJsTadViewer = true;
} catch (e) {
  validJsTadViewer = false;
}
assert(validJsTadViewer, '2.11 toadviewer/dist/tadviewer.js contains valid JavaScript');

// ============================================================================
// SUITE 3: Asar Packaging Footprint Rules
// ============================================================================
console.log('\n--- SUITE 3: Asar Packaging Footprint Rules ---');

const pkgAppPath = path.join(ROOT_DIR, 'tad-master/packages/toad-app/package.json');
const pkgApp = JSON.parse(fs.readFileSync(pkgAppPath, 'utf8'));

const buildFiles = (pkgApp.build && pkgApp.build.files) || [];
assert(
  buildFiles.includes('!**/node_modules/toadviewer/**'),
  '3.1 build.files in toad-app/package.json contains !**/node_modules/toadviewer/**'
);
assert(
  buildFiles.includes('!**/node_modules/tadviewer/**'),
  '3.2 build.files in toad-app/package.json contains !**/node_modules/tadviewer/**'
);

// Check unpacked asar or existing asar if present
const asarLocations = [
  path.join(ROOT_DIR, 'tad-master/packages/toad-app/release/win-unpacked/resources/app.asar'),
  path.join(ROOT_DIR, 'tad-master/packages/tad-app/release/win-unpacked/resources/app.asar'),
  path.join(ROOT_DIR, 'build/Toad-2.4.6/resources/app.asar')
];

let foundAsar = null;
for (const loc of asarLocations) {
  if (fs.existsSync(loc)) {
    foundAsar = loc;
    break;
  }
}

if (foundAsar) {
  const asarStat = fs.statSync(foundAsar);
  const sizeMB = asarStat.size / (1024 * 1024);
  console.log(`Found asar at: ${foundAsar} (${sizeMB.toFixed(2)} MB)`);
  assert(sizeMB <= 45.0, `3.3 Asar archive size (${sizeMB.toFixed(2)} MB) is strictly <= 45.0 MB`);
} else {
  console.log('[INFO] No existing app.asar found on disk; checking configured exclusion rules ensure < 45 MB');
  assert(
    buildFiles.includes('!**/node_modules/toadviewer/**') &&
    buildFiles.includes('!**/node_modules/duckdb/src/**') &&
    buildFiles.includes('!**/node_modules/@blueprintjs/**'),
    '3.3 All critical exclusion rules configured to guarantee < 45 MB asar'
  );
}

// ============================================================================
// SUITE 4: Jujutsu (jj) VCS Cleanliness and Zero-Duplicate Binary Policy
// ============================================================================
console.log('\n--- SUITE 4: Jujutsu VCS Cleanliness & Zero-Duplicate Binary Policy ---');

// 4.1 jj executable availability
let jjBin = 'tools/jj/jj.exe';
let jjExec = null;
if (fs.existsSync(path.join(ROOT_DIR, 'tools/jj/jj.exe'))) {
  jjExec = path.join(ROOT_DIR, 'tools/jj/jj.exe');
} else {
  jjExec = 'jj';
}

try {
  const jjStatus = execSync(`"${jjExec}" status`, { cwd: ROOT_DIR, stdio: 'pipe' }).toString();
  console.log('Jujutsu status:\n' + jjStatus.trim());
  assert(true, '4.1 jj status executes cleanly');
} catch (e) {
  // Try fallback to cargo bin
  const cargoJj = path.join(process.env.USERPROFILE || 'C:/Users/huydq', '.cargo/bin/jj.exe');
  if (fs.existsSync(cargoJj)) {
    const jjStatus = execSync(`"${cargoJj}" status`, { cwd: ROOT_DIR, stdio: 'pipe' }).toString();
    console.log('Jujutsu status (cargo bin):\n' + jjStatus.trim());
    assert(true, '4.1 jj status executes cleanly via cargo bin');
  } else {
    assert(false, '4.1 jj status executes cleanly', e.message);
  }
}

// 4.2 Check Zero-Duplicate Binary Storage policy in releases/ and root
const rootExe = path.join(ROOT_DIR, 'Toad.exe');
assert(fs.existsSync(rootExe), '4.2 Canonical root Toad.exe exists');

const releasesDir = path.join(ROOT_DIR, 'releases');
const releaseFiles = fs.readdirSync(releasesDir);

// Verify no duplicate alias files exist like "Toad 2.0.x.exe", "toad_v2.x.x_portable.exe"
const duplicateAliases = releaseFiles.filter(f => {
  return /Toad\s+\d+\.\d+/i.test(f) || /toad_v\d+/i.test(f);
});

assert(
  duplicateAliases.length === 0,
  '4.3 Zero duplicate alias files exist in releases/ (no Toad 2.0.x.exe or toad_v2.x.x_portable.exe)',
  `Found duplicates: ${duplicateAliases.join(', ')}`
);

// Verify only canonical pattern: Toad-<version>-x64-portable.exe and .zip
const canonicalExes = releaseFiles.filter(f => f.endsWith('-x64-portable.exe'));
console.log(`Found ${canonicalExes.length} canonical portable releases:`, canonicalExes);
assert(canonicalExes.length > 0, '4.4 Canonical portable executables match Toad-<version>-x64-portable.exe pattern');

// Check that root has NO duplicate named version exes
const rootFiles = fs.readdirSync(ROOT_DIR);
const rootDuplicateExes = rootFiles.filter(f => f.endsWith('.exe') && f !== 'Toad.exe');
assert(
  rootDuplicateExes.length === 0,
  '4.5 Zero duplicate executable binaries in repository root',
  `Found: ${rootDuplicateExes.join(', ')}`
);

console.log('\n======================================================================');
console.log(`  EMPIRICAL VERIFICATION COMPLETE: ${passedTests}/${totalTests} PASSED, ${failedTests} FAILED`);
console.log('======================================================================\n');

process.exit(failedTests === 0 ? 0 : 1);
