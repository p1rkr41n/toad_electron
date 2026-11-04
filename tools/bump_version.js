/**
 * tools/bump_version.js
 * 
 * Version Bumper & Synchronizer for Toad
 * Updates version strings across all project files:
 * - tad-master/package.json
 * - tad-master/packages/toad-app/package.json (or tad-app)
 * - tad-master/packages/host-bridge/package.json
 * - tad-master/packages/reltab-duckdb/package.json
 * - tad-master/packages/toadviewer/package.json (or tadviewer)
 * - tad-master/packages/toadviewer/src/components/RegexDialog.tsx (or tadviewer)
 * - dist_package.ps1
 * - package_release.ps1
 * - README.md
 * - releases/HelloKittyXamKinLung.Toad.yaml
 * - tests/deep_integration_qa.js
 * - run_tests.js
 * - tests/smoke_test.js
 * 
 * Usage:
 *   node tools/bump_version.js 2.5.1
 *   node tools/bump_version.js patch
 */

const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");

function getTargetVersion() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: node tools/bump_version.js <new_version|patch>");
    process.exit(1);
  }

  let pkgAppPath = path.join(ROOT_DIR, "tad-master/packages/toad-app/package.json");
  if (!fs.existsSync(pkgAppPath)) {
    pkgAppPath = path.join(ROOT_DIR, "tad-master/packages/tad-app/package.json");
  }
  const currentVersion = JSON.parse(fs.readFileSync(pkgAppPath, "utf8")).version;

  if (arg === "patch") {
    const parts = currentVersion.split(".");
    if (parts.length === 3) {
      return `${parts[0]}.${parts[1]}.${parseInt(parts[2], 10) + 1}`;
    } else if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.${parseInt(parts[3], 10) + 1}`;
    }
    return `${currentVersion}.1`;
  }
  return arg;
}

function updateFile(relPath, fn) {
  const absPath = path.join(ROOT_DIR, relPath);
  if (!fs.existsSync(absPath)) {
    console.warn(`[Skip] File not found: ${relPath}`);
    return;
  }
  const oldContent = fs.readFileSync(absPath, "utf8");
  const newContent = fn(oldContent);
  if (oldContent !== newContent) {
    fs.writeFileSync(absPath, newContent, "utf8");
    console.log(`[Updated] ${relPath}`);
  } else {
    console.log(`[Unchanged] ${relPath}`);
  }
}

function updatePackageJson(relPath, newVersion) {
  updateFile(relPath, (content) => {
    const pkg = JSON.parse(content);
    pkg.version = newVersion;
    return JSON.stringify(pkg, null, 2) + "\n";
  });
}

function main() {
  const targetVersion = getTargetVersion();
  console.log(`Bumping Toad version to: ${targetVersion}`);

  // 1. package.json files
  if (fs.existsSync(path.join(ROOT_DIR, "tad-master/package.json"))) {
    updatePackageJson("tad-master/package.json", targetVersion);
  }
  if (fs.existsSync(path.join(ROOT_DIR, "package.json"))) {
    updatePackageJson("package.json", targetVersion);
  }
  const appRel = fs.existsSync(path.join(ROOT_DIR, "tad-master/packages/toad-app/package.json"))
    ? "tad-master/packages/toad-app/package.json"
    : "tad-master/packages/tad-app/package.json";
  updatePackageJson(appRel, targetVersion);
  updatePackageJson("tad-master/packages/host-bridge/package.json", targetVersion);
  if (fs.existsSync(path.join(ROOT_DIR, "tad-master/packages/reltab-duckdb/package.json"))) {
    updatePackageJson("tad-master/packages/reltab-duckdb/package.json", targetVersion);
  }
  const viewerRel = fs.existsSync(path.join(ROOT_DIR, "tad-master/packages/toadviewer/package.json"))
    ? "tad-master/packages/toadviewer/package.json"
    : "tad-master/packages/tadviewer/package.json";
  if (fs.existsSync(path.join(ROOT_DIR, viewerRel))) {
    updatePackageJson(viewerRel, targetVersion);
  }

  // 2. RegexDialog.tsx
  const regexDialogRel = fs.existsSync(path.join(ROOT_DIR, "tad-master/packages/toadviewer/src/components/RegexDialog.tsx"))
    ? "tad-master/packages/toadviewer/src/components/RegexDialog.tsx"
    : "tad-master/packages/tadviewer/src/components/RegexDialog.tsx";
  updateFile(regexDialogRel, (content) => {
    return content.replace(/v\d+\.\d+\.\d+(?:\.\d+)?/g, `v${targetVersion}`);
  });

  // 3. dist_package.ps1
  updateFile("dist_package.ps1", (content) => {
    let res = content.replace(/Toad-\d+\.\d+\.\d+(?:\.\d+)?-x64-portable\.exe/g, `Toad-${targetVersion}-x64-portable.exe`);
    if (!res.includes(`v${targetVersion}`)) {
      res = res.replace(
        /(\$bundleContent\.Contains\("v[\d\.]+"\))/,
        `$bundleContent.Contains("v${targetVersion}") -or $1`
      );
    }
    return res;
  });

  // 4. package_release.ps1
  updateFile("package_release.ps1", (content) => {
    let res = content.replace(/\[string\]\$Version = "[^"]+"/, `[string]$Version = "${targetVersion}"`);
    res = res.replace(/if \(\$Version -ne "[^"]+"\)/, `if ($Version -ne "${targetVersion}")`);
    res = res.replace(/Standard target for Milestone 4 is '[^']+'/, `Standard target for Milestone 4 is '${targetVersion}'`);
    return res;
  });

  // 5. README.md
  updateFile("README.md", (content) => {
    return content
      .replace(/Toad \(v\d+\.\d+\.\d+(?:\.\d+)?\)/g, `Toad (v${targetVersion})`)
      .replace(/badge\/Version-[\d\.]+-/g, `badge/Version-${targetVersion}-`);
  });

  // 6. releases/HelloKittyXamKinLung.Toad.yaml
  updateFile("releases/HelloKittyXamKinLung.Toad.yaml", (content) => {
    return content
      .replace(/PackageVersion: [\d\.]+/g, `PackageVersion: ${targetVersion}`)
      .replace(/download\/v[\d\.]+\//g, `download/v${targetVersion}/`)
      .replace(/Toad-[\d\.]+-x64-portable\.exe/g, `Toad-${targetVersion}-x64-portable.exe`);
  });

  // 7. tests/deep_integration_qa.js
  updateFile("tests/deep_integration_qa.js", (content) => {
    let res = content;
    if (!res.includes(`"${targetVersion}"`)) {
      res = res.replace(/(pkgApp\.version === "2\.5\.0\.5")/g, `$1 || pkgApp.version === "${targetVersion}"`);
      res = res.replace(/(pkgBridge\.version === "2\.5\.0\.5")/g, `$1 || pkgBridge.version === "${targetVersion}"`);
      res = res.replace(/(pkgDuck\.version === "2\.5\.0\.5")/g, `$1 || pkgDuck.version === "${targetVersion}"`);
      res = res.replace(/(pkgViewer\.version === "2\.5\.0\.5")/g, `$1 || pkgViewer.version === "${targetVersion}"`);
      res = res.replace(/(dialogSrc\.includes\("v2\.5\.0\.5"\))/g, `$1 || dialogSrc.includes("v${targetVersion}")`);
      res = res.replace(/(dialogContent\.includes\("v2\.5\.0\.5"\))/g, `$1 || dialogContent.includes("v${targetVersion}")`);
      res = res.replace(/(includes\("v2\.5\.0\.4"\)\.replace\("v2\.5\.0\.4", "v2\.5\.0\.5"\))/g, `$1 || includes("v2.5.0.4").replace("v2.5.0.4", "v${targetVersion}")`);
      res = res.replace(/(v === "2\.5\.0\.4")/g, `$1 || v === "${targetVersion}"`);
      res = res.replace(/(v === "2\.5\.0\.5")/g, `$1 || v === "${targetVersion}"`);
      res = res.replace(/(distPs1\.includes\("Toad-2\.5\.0\.5-x64-portable\.exe"\))/g, `$1 || distPs1.includes("Toad-${targetVersion}-x64-portable.exe")`);
      res = res.replace(/(pkgPs1\.includes\('"2\.5\.0\.5"'\))/g, `$1 || pkgPs1.includes('"${targetVersion}"')`);
      res = res.replace(/(readmeSrc\.includes\("Toad \(v2\.5\.0\.5\)"\))/g, `$1 || readmeSrc.includes("Toad (v${targetVersion})")`);
      res = res.replace(/(readmeSrc\.includes\("Version-2\.5\.0"\))/g, `$1 || readmeSrc.includes("Version-${targetVersion}")`);
      res = res.replace(/(wingetYaml\.includes\("PackageVersion: 2\.5\.0\.5"\))/g, `$1 || wingetYaml.includes("PackageVersion: ${targetVersion}")`);
    }
    return res;
  });

  // 8. run_tests.js
  updateFile("run_tests.js", (content) => {
    return content.replace(/Smoke Test \(v[\d\.]+\)/g, `Smoke Test (v${targetVersion})`);
  });

  // 9. tests/smoke_test.js
  updateFile("tests/smoke_test.js", (content) => {
    return content.replace(/SMOKE TEST: TOAD v[\d\.]+ RUNTIME INTEGRITY/g, `SMOKE TEST: TOAD v${targetVersion} RUNTIME INTEGRITY`);
  });

  console.log(`Version bump to ${targetVersion} completed successfully!`);
}

main();
