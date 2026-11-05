<#
.SYNOPSIS
    Production Packaging Script for Toad Tauri v2 (Milestone 7)
    Standard: HelloKittyXamKinLung Indie Release Pipeline

.DESCRIPTION
    1. Builds Vite 5 production frontend bundle (`npm run build`).
    2. Compiles optimized Rust core (`cargo build --release`).
    3. Validates footprint gate (< 50MB).
    4. Creates dual distribution (`Toad-2.5.2-x64-portable.exe` + `Toad-2.5.2-x64-portable.zip`).
    5. Enforces Zero-Duplicate Binary storage policy.
    6. Generates SHA256SUMS.txt cryptographic checksums and Winget manifest.
    7. Deploys canonical executable to project root `Toad.exe`.
#>

param (
    [string]$AppName = "Toad",
    [string]$Version = "2.5.2",
    [string]$Publisher = "HelloKittyXamKinLung"
)

$ErrorActionPreference = "Stop"

# Setup toolchain PATH
$nodePath = "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64"
$gitPath = "D:\Shared_UserData\Downloads\tad\mingit\cmd"
$cargoPath = "$env:USERPROFILE\.cargo\bin"
$env:PATH = "$cargoPath;$nodePath;$gitPath;$env:PATH"

$projectRoot = "D:\Shared_UserData\Downloads\tad"
$tauriProjectDir = "$projectRoot\tauri\project"
$srcTauriDir = "$tauriProjectDir\src-tauri"
$targetReleaseDir = "$srcTauriDir\target\release"
$tauriReleasesDir = "$tauriProjectDir\releases"
$rootReleasesDir = "$projectRoot\releases"

Write-Output "======================================================================"
Write-Output "  TOAD TAURI v2 PRODUCTION PORTABLE PACKAGING PIPELINE"
Write-Output "  App: $AppName | Version: $Version | Publisher: $Publisher"
Write-Output "======================================================================"

# 1. Build Vite 5 Frontend Production Bundle
Write-Output "[STEP 1/6] Building Vite 5 Frontend Production Bundle..."
Set-Location $tauriProjectDir
& npm.cmd run build
if (-not (Test-Path "$tauriProjectDir\dist\index.html")) {
    throw "ERROR: Frontend dist/index.html was not generated!"
}
Write-Output "           Frontend bundle verified in dist/"

# 2. Compile Native Rust Backend
Write-Output "[STEP 2/6] Compiling Native Rust Core with cargo build --release..."
Set-Location $srcTauriDir
& cargo build --release
if (-not (Test-Path "$targetReleaseDir\toad.exe")) {
    throw "ERROR: Target release toad.exe not found!"
}
if (-not (Test-Path "$targetReleaseDir\duckdb.dll")) {
    throw "ERROR: duckdb.dll missing from target/release!"
}
if (-not (Test-Path "$targetReleaseDir\WebView2Loader.dll")) {
    throw "ERROR: WebView2Loader.dll missing from target/release!"
}
Write-Output "           Backend binary and native DLL dependencies verified."

# 3. Footprint Gate Assertion (< 50MB)
Write-Output "[STEP 3/6] Verifying Footprint Gate (< 50MB)..."
$exeItem = Get-Item "$targetReleaseDir\toad.exe"
$duckdbItem = Get-Item "$targetReleaseDir\duckdb.dll"
$webviewItem = Get-Item "$targetReleaseDir\WebView2Loader.dll"
$totalMB = [math]::Round(($exeItem.Length + $duckdbItem.Length + $webviewItem.Length) / 1MB, 2)
Write-Output "           Binary size: $([math]::Round($exeItem.Length / 1MB, 2)) MB"
Write-Output "           DuckDB DLL:  $([math]::Round($duckdbItem.Length / 1MB, 2)) MB"
Write-Output "           WebView2:    $([math]::Round($webviewItem.Length / 1MB, 2)) MB"
Write-Output "           Total package footprint: $totalMB MB"
if ($totalMB -ge 50.0) {
    throw "FOOTPRINT GATE ERROR: Total package footprint ($totalMB MB) exceeds 50.0 MB threshold!"
}
Write-Output "           Footprint gate PASSED ($totalMB MB < 50.0 MB)."

# 4. Zero-Duplicate Binary Policy Enforcement
Write-Output "[STEP 4/6] Enforcing Zero-Duplicate Binary Storage Policy..."
foreach ($dir in @($tauriReleasesDir, $rootReleasesDir)) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $duplicates = Get-ChildItem -Path $dir -Filter "Toad *.exe" -ErrorAction SilentlyContinue
    if ($duplicates.Count -gt 0) {
        Write-Warning "Pruning duplicate historical binaries from $($dir): $($duplicates.Name)"
        $duplicates | Remove-Item -Force
    }
}
$rootDuplicates = Get-ChildItem -Path $projectRoot -Filter "Toad *.exe" -ErrorAction SilentlyContinue
if ($rootDuplicates.Count -gt 0) {
    Write-Warning "Pruning duplicate historical binaries from root: $($rootDuplicates.Name)"
    $rootDuplicates | Remove-Item -Force
}

# 5. Dual Packaging Artifacts Generation
Write-Output "[STEP 5/6] Generating Dual Packaging Artifacts..."
$portableExeName = "$AppName-$Version-x64-portable.exe"
$portableZipName = "$AppName-$Version-x64-portable.zip"

# Create a clean temporary staging directory for zip archive packaging
$stageDir = Join-Path $env:TEMP "toad_package_stage_$Version"
if (Test-Path $stageDir) { Remove-Item -Recurse -Force $stageDir }
New-Item -ItemType Directory -Path $stageDir | Out-Null

Copy-Item "$targetReleaseDir\toad.exe" "$stageDir\Toad.exe"
Copy-Item "$targetReleaseDir\toad.exe" "$stageDir\$portableExeName"
Copy-Item "$targetReleaseDir\duckdb.dll" "$stageDir\duckdb.dll"
Copy-Item "$targetReleaseDir\WebView2Loader.dll" "$stageDir\WebView2Loader.dll"

# Package portable ZIP archive
$zipDestTauri = Join-Path $tauriReleasesDir $portableZipName
$zipDestRoot = Join-Path $rootReleasesDir $portableZipName
Compress-Archive -Path "$stageDir\*" -DestinationPath $zipDestTauri -CompressionLevel Optimal -Force
Copy-Item $zipDestTauri $zipDestRoot -Force

# Package portable standalone EXE and companion DLLs in releases
$exeDestTauri = Join-Path $tauriReleasesDir $portableExeName
$exeDestRoot = Join-Path $rootReleasesDir $portableExeName
Copy-Item "$targetReleaseDir\toad.exe" $exeDestTauri -Force
Copy-Item $exeDestTauri $exeDestRoot -Force

# Copy runtime DLL dependencies to release folders for instant execution
Copy-Item "$targetReleaseDir\duckdb.dll" "$tauriReleasesDir\duckdb.dll" -Force
Copy-Item "$targetReleaseDir\duckdb.dll" "$rootReleasesDir\duckdb.dll" -Force
Copy-Item "$targetReleaseDir\WebView2Loader.dll" "$tauriReleasesDir\WebView2Loader.dll" -Force
Copy-Item "$targetReleaseDir\WebView2Loader.dll" "$rootReleasesDir\WebView2Loader.dll" -Force

# Update canonical project root Toad.exe and companion DLLs
try {
    Copy-Item "$targetReleaseDir\toad.exe" "$projectRoot\Toad.exe" -Force
    Copy-Item "$targetReleaseDir\duckdb.dll" "$projectRoot\duckdb.dll" -Force
    Copy-Item "$targetReleaseDir\WebView2Loader.dll" "$projectRoot\WebView2Loader.dll" -Force
    Write-Output "           Updated canonical root\Toad.exe and native DLLs."
} catch {
    Write-Warning "Could not overwrite root\Toad.exe (file locked by active process): $_"
}

Remove-Item -Recurse -Force $stageDir -ErrorAction SilentlyContinue

# 6. Cryptographic SHA256SUMS.txt & Winget Manifest
Write-Output "[STEP 6/6] Computing Cryptographic SHA256SUMS.txt & Winget Manifest..."
$hashFiles = @(
    (Get-Item $exeDestTauri),
    (Get-Item $zipDestTauri)
)
$hashLines = foreach ($f in $hashFiles) {
    $h = (Get-FileHash -Path $f.FullName -Algorithm SHA256).Hash.ToLower()
    "$h  $($f.Name)"
}
$checksumPathTauri = Join-Path $tauriReleasesDir "SHA256SUMS.txt"
$checksumPathRoot = Join-Path $rootReleasesDir "SHA256SUMS.txt"
$hashLines | Out-File -FilePath $checksumPathTauri -Encoding ascii -Force
Copy-Item $checksumPathTauri $checksumPathRoot -Force

$exeHash = (Get-FileHash -Path $exeDestTauri -Algorithm SHA256).Hash.ToUpper()
$wingetContent = @"
PackageIdentifier: $Publisher.$AppName
PackageVersion: $Version
PackageName: $AppName
Publisher: $Publisher
License: MIT
ShortDescription: High-Performance Tabular Data & Security Log Analyzer
Tags:
  - csv
  - parquet
  - duckdb
  - security
  - forensic
Installers:
  - Architecture: x64
    InstallerType: portable
    InstallerUrl: https://github.com/p1rkr41n/toad_electron/releases/download/v$Version/$portableExeName
    InstallerSha256: $exeHash
ManifestType: singleton
ManifestVersion: 1.6.0
"@
$wingetPathTauri = Join-Path $tauriReleasesDir "$Publisher.$AppName.yaml"
$wingetPathRoot = Join-Path $rootReleasesDir "$Publisher.$AppName.yaml"
$wingetContent | Out-File -FilePath $wingetPathTauri -Encoding utf8 -Force
Copy-Item $wingetPathTauri $wingetPathRoot -Force

Write-Output "======================================================================"
Write-Output "  ALL RELEASE ARTIFACTS PACKAGED SUCCESSFULLY (HelloKittyXamKinLung Standard)!"
Write-Output "  Artifacts in $($tauriReleasesDir) and $($rootReleasesDir):"
Write-Output "    - $portableExeName ($([math]::Round((Get-Item $exeDestTauri).Length / 1MB, 2)) MB)"
Write-Output "    - $portableZipName ($([math]::Round((Get-Item $zipDestTauri).Length / 1MB, 2)) MB)"
Write-Output "    - SHA256SUMS.txt"
Write-Output "    - $Publisher.$AppName.yaml"
Write-Output "======================================================================"
