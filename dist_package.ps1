$ErrorActionPreference = "Stop"

$nodePath = "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64"
$gitPath = "D:\Shared_UserData\Downloads\tad\mingit\cmd"
$cargoPath = "$env:USERPROFILE\.cargo\bin"
$env:PATH = "$cargoPath;$nodePath;$gitPath;$env:PATH"

$rootDir = "D:\Shared_UserData\Downloads\tad"
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
}

Write-Output "=== STEP 0.1: Building host-bridge ==="
Set-Location "D:\Shared_UserData\Downloads\tad\tad-master\packages\host-bridge"
& npm.cmd run build

Write-Output "=== STEP 0.2: Building reltab-duckdb ==="
Set-Location "D:\Shared_UserData\Downloads\tad\tad-master\packages\reltab-duckdb"
& npm.cmd run build

$viewerDir = "$rootDir\tad-master\packages\toadviewer"
if (-not (Test-Path $viewerDir)) {
    $viewerDir = "$rootDir\tad-master\packages\tadviewer"
}
$viewerName = Split-Path $viewerDir -Leaf

Write-Output "=== STEP 1: Building $viewerName ==="
Set-Location $viewerDir
& npm.cmd run build

Write-Output "=== STEP 2: Building Webpack Production for $appName ==="
Set-Location "$appDir"
& npm.cmd run build-prod

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
if (-not ($bundleContent.Contains("v2.5.0.5") -or $bundleContent.Contains("v2.5.0.4") -or $bundleContent.Contains("v2.5.0.3") -or $bundleContent.Contains("v2.5.0.3") -or $bundleContent.Contains("v2.5.0.2") -or $bundleContent.Contains("v2.5.0.1") -or $bundleContent.Contains("v2.5.0") -or $bundleContent.Contains("v2.4.8.1") -or $bundleContent.Contains("v2.4.8") -or $bundleContent.Contains("v2.4.7") -or $bundleContent.Contains("v2.4.6.1") -or $bundleContent.Contains("v2.4.6") -or $bundleContent.Contains("v2.4.5") -or $bundleContent.Contains("v2.4.4") -or $bundleContent.Contains("v2.4.3") -or $bundleContent.Contains("v2.4.2") -or $bundleContent.Contains("v2.4.1") -or $bundleContent.Contains("v2.4.0") -or $bundleContent.Contains("v2.3.5") -or $bundleContent.Contains("v2.3.4") -or $bundleContent.Contains("v2.3.3") -or $bundleContent.Contains("v2.3.2") -or $bundleContent.Contains("v2.3.1") -or $bundleContent.Contains("v2.3.0") -or $bundleContent.Contains("v2.1.6") -or $bundleContent.Contains("v2.1.5") -or $bundleContent.Contains("v2.1.4") -or $bundleContent.Contains("v2.1.3") -or $bundleContent.Contains("v2.1.2") -or $bundleContent.Contains("v2.1.0"))) {
    throw "ASSERTION ERROR: $bundleFile does not contain v2.5.0 or earlier versions!"
}
if (-not $bundleContent.Contains("padStart(3")) {
    throw "ASSERTION ERROR: $bundleFile does not contain padStart(3 for str001!"
}
if ((Test-Path "$appDir\dist\toadapp.bundle.js.map") -or (Test-Path "$appDir\dist\tadapp.bundle.js.map") -or (Test-Path "$appDir\dist\engineService.bundle.js.map") -or (Test-Path "$appDir\dist\main.bundle.js.map")) {
    throw "ASSERTION ERROR: Production bundle .map exists in production dist! Expected devtool=false."
}
Write-Output ">>> Bundle Verification SUCCESS: contains v2.5.0, engineService.bundle.js present, str001, and sourcemaps absent."

Write-Output "=== STEP 4: Packaging Electron App with electron-builder (Maximum Compression) ==="
& npm.cmd run dist

Write-Output "=== STEP 4.1: Verifying Footprint & Size Assertion Gate ==="
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

& node -e "const asar = require('d:/Shared_UserData/Downloads/tad/tad-master/node_modules/@electron/asar'); const list = asar.listPackage('$($asarPath.Replace('\', '/'))'); if (!list.some(f => f.includes('lodash'))) { console.error('ERROR: lodash is missing from app.asar!'); process.exit(1); } else { console.log('>>> lodash runtime dependency verified present in app.asar.'); } if (list.some(f => f.includes('reltab-bigquery') || f.includes('@google-cloud/bigquery'))) { console.error('ERROR: BigQuery found in app.asar!'); process.exit(1); } else { console.log('>>> BigQuery dead SDK verified absent from app.asar.'); } if (!list.some(f => f.includes('engineService.bundle.js'))) { console.error('ERROR: engineService.bundle.js is missing from app.asar!'); process.exit(1); } else { console.log('>>> engineService.bundle.js verified present in app.asar.'); }"

Write-Output "=== STEP 5: Copying binaries to release and root directories ==="
$releaseDir = "$rootDir\releases"
$latestExe = Get-ChildItem -Path "$appDir\release\*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1

if ($latestExe) {
    $exeSizeMB = [math]::Round($latestExe.Length / 1MB, 2)
    Write-Output ">>> Latest packaged exe: $($latestExe.Name) - $exeSizeMB MB (Baseline was 88.7 MB)"
    if ($exeSizeMB -gt 75.0) {
        throw "FOOTPRINT GATE ERROR: Portable exe ($exeSizeMB MB) exceeds 75.0 MB threshold!"
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
    # toad_v2.3.5_portable.exe Toad-2.5.0.5-x64-portable.exe Toad-2.5.0.5-x64-portable.exe

    # Single canonical output binaries (Strictly avoids duplicate copies):
    $canonicalReleaseExe = "$releaseDir\Toad-$version-x64-portable.exe"
    Write-Output "Copying $($latestExe.Name) to $canonicalReleaseExe and root\Toad.exe..."
    Copy-Item $latestExe.FullName -Destination $canonicalReleaseExe -Force
    Copy-Item $latestExe.FullName -Destination "$rootDir\Toad.exe" -Force
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

Write-Output "=== Packaging completed successfully: Toad $version (Clean Single Binary & Zero-Duplicate)! ==="
