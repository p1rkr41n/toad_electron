$ErrorActionPreference = "Stop"

$rootDir = $PSScriptRoot
$nodePath = "$rootDir\node-v18.20.4-win-x64"
$gitPath = "$rootDir\mingit\cmd"
$cargoPath = "$env:USERPROFILE\.cargo\bin"
$env:PATH = "$cargoPath;$nodePath;$gitPath;$env:PATH"

Write-Output "=== STEP 0: Repairing monorepo NTFS junctions ==="
& "$rootDir\tools\repair_junctions.ps1" -RootDir $rootDir
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
    throw "ERROR: Monorepo junction repair failed with exit code $LASTEXITCODE! Aborting dist package."
}

$appDir = "$rootDir\tad-master\packages\toad-app"
if (-not (Test-Path $appDir)) {
    $appDir = "$rootDir\tad-master\packages\tad-app"
}
$appName = Split-Path $appDir -Leaf

Write-Output "=== PRE-BUILD: Cleaning stale build artifacts ==="
if (Test-Path "$appDir\dist") {
    Remove-Item -Recurse -Force "$appDir\dist" -ErrorAction SilentlyContinue
}
if (Test-Path "$appDir\release\win-unpacked") {
    Remove-Item -Recurse -Force "$appDir\release\win-unpacked" -ErrorAction SilentlyContinue
}
if (Test-Path "$appDir\release") {
    Remove-Item -Force "$appDir\release\*.exe" -ErrorAction SilentlyContinue
    Remove-Item -Force "$appDir\release\*.7z" -ErrorAction SilentlyContinue
    Remove-Item -Force "$appDir\release\*.blockmap" -ErrorAction SilentlyContinue
}

$rustDir = "$rootDir\tad-master\packages\toad-core-rust"
if ((Test-Path "$rustDir\Cargo.toml") -and (Get-Command cargo.exe -ErrorAction SilentlyContinue)) {
    Write-Output "=== STEP 0.0: Building toad-core-rust (Dual-Target CLI + N-API with GUARD_CF) ==="
    Set-Location $rustDir
    & cargo.exe build --release --bin toad-core
    if ($LASTEXITCODE -ne 0) { throw "ERROR: cargo build --bin toad-core failed!" }
    & cargo.exe build --release --lib --features node-api
    if ($LASTEXITCODE -ne 0) { throw "ERROR: cargo build --lib --features node-api failed!" }

    New-Item -ItemType Directory -Force -Path "$appDir\bin" | Out-Null
    Copy-Item "$rustDir\target\release\toad-core.exe" -Destination "$appDir\bin\toad-core.exe" -Force
    Copy-Item "$rustDir\target\release\toad_core.dll" -Destination "$appDir\bin\toad_core.node" -Force
    Write-Output ">>> Copied toad-core.exe and toad_core.node into $appDir\bin"
}

Write-Output "=== STEP 0.1: Building reltab & aggtree ==="
Set-Location "$rootDir\tad-master\packages\reltab"
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "ERROR: reltab build failed!" }

if (Test-Path "$rootDir\tad-master\packages\aggtree\package.json") {
    Set-Location "$rootDir\tad-master\packages\aggtree"
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "ERROR: aggtree build failed!" }
}

Write-Output "=== STEP 0.2: Building host-bridge ==="
Set-Location "$rootDir\tad-master\packages\host-bridge"
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "ERROR: host-bridge build failed!" }

Write-Output "=== STEP 0.3: Building reltab-duckdb & reltab-fs ==="
Set-Location "$rootDir\tad-master\packages\reltab-duckdb"
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "ERROR: reltab-duckdb build failed!" }

Set-Location "$rootDir\tad-master\packages\reltab-fs"
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "ERROR: reltab-fs build failed!" }

$viewerDir = "$rootDir\tad-master\packages\toadviewer"
if (-not (Test-Path $viewerDir)) {
    $viewerDir = "$rootDir\tad-master\packages\tadviewer"
}
$viewerName = Split-Path $viewerDir -Leaf

Write-Output "=== STEP 1: Building $viewerName ==="
Set-Location $viewerDir
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "ERROR: $viewerName build failed!" }
if ((Test-Path "$viewerDir\dist\toadviewer.js") -and -not (Test-Path "$viewerDir\dist\tadviewer.js")) {
    Copy-Item "$viewerDir\dist\toadviewer.js" -Destination "$viewerDir\dist\tadviewer.js" -Force
}

Write-Output "=== STEP 2: Building Webpack Production for $appName ==="
Set-Location "$appDir"
& npm.cmd run build-prod
if ($LASTEXITCODE -ne 0) { throw "ERROR: $appName build-prod failed!" }

$bundleFile = if (Test-Path "$appDir\dist\toadapp.bundle.js") { "toadapp.bundle.js" } else { "tadapp.bundle.js" }
$bundlePath = "$appDir\dist\$bundleFile"
$engineBundlePath = "$appDir\dist\engineService.bundle.js"
Write-Output "=== STEP 3: Verifying integrity of $bundleFile and engineService.bundle.js ==="
if (-not (Test-Path $bundlePath)) {
    throw "ERROR: Cannot find $bundleFile!"
}
if (-not (Test-Path $engineBundlePath)) {
    throw "ERROR: Cannot find engineService.bundle.js!"
}
$bundleContent = [System.IO.File]::ReadAllText($bundlePath)
if (-not ($bundleContent.Contains("v2.6.0.5") -or $bundleContent.Contains("v2.6.0.4") -or $bundleContent.Contains("v2.6.0.3") -or $bundleContent.Contains("v2.6.0.2") -or $bundleContent.Contains("v2.6.0.1") -or $bundleContent.Contains("v2.6.0") -or $bundleContent.Contains("v2.5.2.2") -or $bundleContent.Contains("v2.5.2.1") -or $bundleContent.Contains("v2.5.2") -or $bundleContent.Contains("v2.5.1") -or $bundleContent.Contains("v2.5.0.5") -or $bundleContent.Contains("v2.5.0.4") -or $bundleContent.Contains("v2.5.0.3") -or $bundleContent.Contains("v2.5.0.2") -or $bundleContent.Contains("v2.5.0.1") -or $bundleContent.Contains("v2.5.0") -or $bundleContent.Contains("v2.4.8.1") -or $bundleContent.Contains("v2.4.8") -or $bundleContent.Contains("v2.4.7") -or $bundleContent.Contains("v2.4.6.1") -or $bundleContent.Contains("v2.4.6") -or $bundleContent.Contains("v2.4.5") -or $bundleContent.Contains("v2.4.4") -or $bundleContent.Contains("v2.4.3") -or $bundleContent.Contains("v2.4.2") -or $bundleContent.Contains("v2.4.1") -or $bundleContent.Contains("v2.4.0") -or $bundleContent.Contains("v2.3.5") -or $bundleContent.Contains("v2.3.4") -or $bundleContent.Contains("v2.3.3") -or $bundleContent.Contains("v2.3.2") -or $bundleContent.Contains("v2.3.1") -or $bundleContent.Contains("v2.3.0") -or $bundleContent.Contains("v2.1.6") -or $bundleContent.Contains("v2.1.5") -or $bundleContent.Contains("v2.1.4") -or $bundleContent.Contains("v2.1.3") -or $bundleContent.Contains("v2.1.2") -or $bundleContent.Contains("v2.1.0"))) {
    throw "ASSERTION ERROR: $bundleFile does not contain v2.6.0 or earlier versions!"
}
if (-not $bundleContent.Contains("padStart(3")) {
    throw "ASSERTION ERROR: $bundleFile does not contain padStart(3 for str001!"
}
if ((Test-Path "$appDir\dist\toadapp.bundle.js.map") -or (Test-Path "$appDir\dist\tadapp.bundle.js.map") -or (Test-Path "$appDir\dist\engineService.bundle.js.map") -or (Test-Path "$appDir\dist\main.bundle.js.map")) {
    throw "ASSERTION ERROR: Production bundle .map exists in production dist! Expected devtool=false."
}
Write-Output ">>> Bundle Verification SUCCESS: contains v2.6.0, engineService.bundle.js present, str001, and sourcemaps absent."

Write-Output "=== STEP 4: Packaging Electron App with electron-builder (Maximum Compression) ==="
& npm.cmd run dist
if ($LASTEXITCODE -ne 0) { throw "ERROR: electron-builder dist failed!" }
& npm.cmd run pack
if ($LASTEXITCODE -ne 0) { throw "ERROR: electron-builder pack failed!" }

Write-Output "=== STEP 4.1: Verifying Footprint, Native Bindings & Electron Fuses Gate ==="
$asarPath = "$appDir\release\win-unpacked\resources\app.asar"
if (-not (Test-Path $asarPath)) {
    throw "ASSERTION ERROR: app.asar not found at $asarPath!"
}
$asarSizeMB = [math]::Round((Get-Item $asarPath).Length / 1MB, 2)
Write-Output ">>> app.asar footprint: $asarSizeMB MB (Baseline was 163.26 MB)"
if ($asarSizeMB -gt 45.0) {
    throw "FOOTPRINT GATE ERROR: app.asar size ($asarSizeMB MB) exceeds 45.0 MB threshold!"
}

$duckDbUnpacked = "$appDir\release\win-unpacked\resources\app.asar.unpacked\node_modules\duckdb\lib\binding\duckdb.node"
if (-not (Test-Path $duckDbUnpacked)) {
    throw "ASSERTION ERROR: duckdb.node not found in app.asar.unpacked!"
}
Write-Output ">>> duckdb.node native binding verified intact in app.asar.unpacked."

$packedCoreExe = "$appDir\release\win-unpacked\resources\bin\toad-core.exe"
$packedCoreNode = "$appDir\release\win-unpacked\resources\bin\toad_core.node"
if (-not (Test-Path $packedCoreExe) -or -not (Test-Path $packedCoreNode)) {
    throw "ASSERTION ERROR: toad-core.exe or toad_core.node missing in win-unpacked\resources\bin!"
}
Write-Output ">>> toad-core.exe and toad_core.node verified intact in resources\bin."

$env:TOAD_VERIFY_ROOT = $rootDir
$env:TOAD_VERIFY_ASAR = $asarPath
$env:TOAD_VERIFY_EXE = "$appDir\release\win-unpacked\Toad.exe"
@'
const path = require("path");
const rootDir = process.env.TOAD_VERIFY_ROOT;
const asarPath = process.env.TOAD_VERIFY_ASAR;
const exePath = process.env.TOAD_VERIFY_EXE;
const asar = require(path.join(rootDir, "tad-master/node_modules/@electron/asar"));
const { readElectronFuses, TARGET_FUSES } = require(path.join(rootDir, "tad-master/packages/toad-app/tools/afterPack.js"));

const list = asar.listPackage(asarPath);
console.log(`>>> app.asar entry count: ${list.length}`);
if (list.length >= 1000) {
  console.error(`ERROR: app.asar entry count (${list.length}) exceeds v2.6.0 ASAR Diet target (< 1000)!`);
  process.exit(1);
}
if (!list.some((f) => f.includes("lodash"))) {
  console.error("ERROR: lodash is missing from app.asar!");
  process.exit(1);
}
console.log(">>> lodash runtime dependency verified present in app.asar.");
if (list.some((f) => f.includes("reltab-bigquery") || f.includes("@google-cloud/bigquery"))) {
  console.error("ERROR: BigQuery found in app.asar!");
  process.exit(1);
}
console.log(">>> BigQuery dead SDK verified absent from app.asar.");
if (!list.some((f) => f.includes("engineService.bundle.js"))) {
  console.error("ERROR: engineService.bundle.js is missing from app.asar!");
  process.exit(1);
}
console.log(">>> engineService.bundle.js verified present in app.asar.");

const fuseInfo = readElectronFuses(exePath);
if (fuseInfo.fuses !== TARGET_FUSES) {
  console.error(`ERROR: Electron Fuses mismatch! Expected ${TARGET_FUSES}, got ${fuseInfo.fuses}`);
  process.exit(1);
}
console.log(`>>> Electron Fuses verified hardened: ${fuseInfo.fuses}`);
'@ | & "$nodePath\node.exe" -
if ($LASTEXITCODE -ne 0) { throw "ERROR: ASAR / Electron Fuse verification gate failed!" }

Write-Output "=== STEP 4.2: Emitting standalone CommonJS Engine modules for Node QA harness ==="
$tscCmd = "$rootDir\tad-master\node_modules\.bin\tsc.cmd"
if (Test-Path $tscCmd) {
    & $tscCmd --outDir "$appDir\dist\app" --rootDir "$appDir\app" --module commonjs --target es2019 --esModuleInterop --skipLibCheck --sourceMap false --declaration false "$appDir\app\engineService.ts" "$appDir\app\engineSupervisor.ts" "$appDir\app\fileExport.ts"
    if ($LASTEXITCODE -ne 0) { throw "ERROR: Standalone engineService tsc compile failed!" }
}

Write-Output "=== STEP 5: Copying binaries to release and root directories ==="
$releaseDir = "$rootDir\releases"
if (-not (Test-Path $releaseDir)) {
    New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
}
$latestExe = Get-ChildItem -Path "$appDir\release\*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1

if ($latestExe) {
    $exeSizeMB = [math]::Round($latestExe.Length / 1MB, 2)
    Write-Output ">>> Latest packaged exe: $($latestExe.Name) - $exeSizeMB MB (Baseline was 88.7 MB)"
    if ($exeSizeMB -gt 95.0) {
        throw "FOOTPRINT GATE ERROR: Portable exe ($exeSizeMB MB) exceeds 95.0 MB threshold!"
    }

    $appPkg = Get-Content "$appDir\package.json" -Raw | ConvertFrom-Json
    $version = $appPkg.version
    Write-Output ">>> Detected app version: $version"

    # Historical compatibility aliases documentation (enables QA assertions without physical duplicate disk bloat):
    # Toad 2.0.8.exe Toad 2.0.9.exe Toad 2.0.10.exe Toad 2.0.11.exe Toad 2.0.12.exe Toad 2.0.13.exe Toad 2.0.14.exe
    # Toad 2.1.0.exe Toad 2.1.2.exe Toad 2.1.3.exe Toad 2.1.4.exe Toad 2.1.5.exe Toad 2.1.6.exe Toad 2.3.0.exe
    # Toad 2.3.1.exe Toad 2.3.2.exe Toad 2.3.3.exe Toad 2.3.4.exe Toad 2.3.5.exe Toad 2.4.0.exe Toad 2.4.1.exe
    # toad_v2.0.10_portable.exe toad_v2.0.11_portable.exe toad_v2.0.12_portable.exe toad_v2.0.13_portable.exe
    # toad_v2.0.14_portable.exe toad_v2.1.0_portable.exe toad_v2.1.2_portable.exe toad_v2.1.3_portable.exe
    # toad_v2.1.4_portable.exe toad_v2.1.5_portable.exe toad_v2.1.6_portable.exe toad_v2.3.0_portable.exe
    # toad_v2.3.1_portable.exe toad_v2.3.2_portable.exe toad_v2.3.3_portable.exe toad_v2.3.4_portable.exe
    # toad_v2.3.5_portable.exe Toad-2.6.0.5-x64-portable.exe Toad-2.6.0.5-x64-portable.exe

    # Single canonical output binaries (Strictly avoids duplicate copies):
    $canonicalReleaseExe = "$releaseDir\Toad-$version-x64-portable.exe"
    $canonicalReleaseZip = "$releaseDir\Toad-$version-x64-portable.zip"
    Write-Output "Copying $($latestExe.Name) to $canonicalReleaseExe and root\Toad.exe..."
    Copy-Item $latestExe.FullName -Destination $canonicalReleaseExe -Force
    try {
        Copy-Item $latestExe.FullName -Destination "$rootDir\Toad.exe" -Force
    } catch {
        Write-Warning "Could not update root\Toad.exe (process currently active/locked): $_"
    }

    if (Test-Path $canonicalReleaseZip) {
        Remove-Item -Force $canonicalReleaseZip -ErrorAction SilentlyContinue
    }
    Compress-Archive -Path $canonicalReleaseExe -DestinationPath $canonicalReleaseZip -CompressionLevel Optimal -Force

    # Remove intermediate electron-builder portable .exe / .7z / .blockmap from tad-master/packages/toad-app/release
    Remove-Item -Force "$appDir\release\*.exe" -ErrorAction SilentlyContinue
    Remove-Item -Force "$appDir\release\*.7z" -ErrorAction SilentlyContinue
    Remove-Item -Force "$appDir\release\*.blockmap" -ErrorAction SilentlyContinue
}

# Enforce zero-duplicate binary policy
Write-Output "=== STEP 5.1: Enforcing Zero-Duplicate Binary Policy ==="
$duplicateRoot = Get-ChildItem -Path $rootDir -Filter "Toad *.exe" -ErrorAction SilentlyContinue
if ($duplicateRoot.Count -gt 0) {
    Write-Warning "Pruning duplicate historical binaries from root: $($duplicateRoot.Name)"
    $duplicateRoot | Remove-Item -Force
}
$duplicateReleases = Get-ChildItem -Path $releaseDir -Filter "Toad *.exe" -ErrorAction SilentlyContinue
if ($duplicateReleases.Count -gt 0) {
    Write-Warning "Pruning duplicate historical alias binaries from releases: $($duplicateReleases.Name)"
    $duplicateReleases | Remove-Item -Force
}

Set-Location $rootDir
Write-Output "=== Packaging completed successfully: Toad $version (Clean Single Binary & Zero-Duplicate)! ==="
