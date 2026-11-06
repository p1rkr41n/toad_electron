<#
.SYNOPSIS
    Dedicated Production Packaging Script for Pulex (Tauri v2)
    Standard: HelloKittyXamKinLung Indie Release Pipeline (Tauri-Isolated Policy)

.DESCRIPTION
    1. Validates and compiles Vite 5 frontend bundle (`npm run build`).
    2. Compiles native Rust backend (`cargo build --release`).
    3. Verifies footprint gate (< 50MB).
    4. Enforces strict isolation policy:
       - Pulex releases output ONLY into `tauri/project/releases/`
       - Strictly zero Pulex binaries in root or shared `releases/`
    5. Packages `Pulex-<version>-x64-portable.exe` and `Pulex-<version>-x64-portable.zip`.
    6. Generates `HelloKittyXamKinLung.Pulex.yaml` and updates `SHA256SUMS.txt`.
#>

param (
    [string]$AppName = "Pulex",
    [string]$Version = "3.0.0-beta",
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
Write-Output "  PULEX DEDICATED TAURI v2 PRODUCTION PACKAGING PIPELINE"
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
$builtExe = if (Test-Path "$targetReleaseDir\pulex.exe") {
    "$targetReleaseDir\pulex.exe"
} elseif (Test-Path "$targetReleaseDir\toad.exe") {
    "$targetReleaseDir\toad.exe"
} else {
    throw "ERROR: Neither pulex.exe nor toad.exe found in $targetReleaseDir!"
}
if (-not (Test-Path "$targetReleaseDir\duckdb.dll")) {
    throw "ERROR: duckdb.dll missing from target/release!"
}
if (-not (Test-Path "$targetReleaseDir\WebView2Loader.dll")) {
    throw "ERROR: WebView2Loader.dll missing from target/release!"
}
Write-Output "           Backend binary ($builtExe) and native DLL dependencies verified."

# 3. Footprint Gate Assertion (< 50MB)
Write-Output "[STEP 3/6] Verifying Footprint Gate (< 50MB)..."
$exeItem = Get-Item $builtExe
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

# 4. Enforce Strict Isolation Policy (Zero Pulex in root or shared releases)
Write-Output "[STEP 4/6] Enforcing Release Isolation & Zero-Duplicate Binary Policy..."
if (-not (Test-Path $tauriReleasesDir)) {
    New-Item -ItemType Directory -Path $tauriReleasesDir -Force | Out-Null
}

# Strictly remove any accidental Pulex in root or root releases
if (Test-Path $rootReleasesDir) {
    $leakedInRootReleases = Get-ChildItem -Path $rootReleasesDir -Filter "*Pulex*" -Recurse:$false -ErrorAction SilentlyContinue
    if ($leakedInRootReleases.Count -gt 0) {
        Write-Warning "Removing leaked Pulex files from root releases: $($leakedInRootReleases.Name)"
        $leakedInRootReleases | Remove-Item -Force
    }
}
$leakedInRoot = Get-ChildItem -Path $projectRoot -Filter "*Pulex*" -Recurse:$false -ErrorAction SilentlyContinue
if ($leakedInRoot.Count -gt 0) {
    Write-Warning "Removing leaked Pulex files from project root: $($leakedInRoot.Name)"
    $leakedInRoot | Remove-Item -Force
}

# 5. Package Pulex Artifacts directly into tauri/project/releases/
Write-Output "[STEP 5/6] Packaging Dedicated Pulex Artifacts..."
$pExeName = "Pulex-$Version-x64-portable.exe"
$pZipName = "Pulex-$Version-x64-portable.zip"
$sDir = Join-Path $env:TEMP "Pulex_package_stage_$Version"
if (Test-Path $sDir) { Remove-Item -Recurse -Force $sDir }
New-Item -ItemType Directory -Path $sDir | Out-Null

Copy-Item $builtExe "$sDir\Pulex.exe"
Copy-Item $builtExe "$sDir\$pExeName"
Copy-Item "$targetReleaseDir\duckdb.dll" "$sDir\duckdb.dll"
Copy-Item "$targetReleaseDir\WebView2Loader.dll" "$sDir\WebView2Loader.dll"

# Zip archive in tauri/project/releases/
$zTauri = Join-Path $tauriReleasesDir $pZipName
Compress-Archive -Path "$sDir\*" -DestinationPath $zTauri -CompressionLevel Optimal -Force

# Standalone exe in tauri/project/releases/
$eTauri = Join-Path $tauriReleasesDir $pExeName
Copy-Item $builtExe $eTauri -Force

# Copy companion DLLs into tauri/project/releases/
Copy-Item "$targetReleaseDir\duckdb.dll" "$tauriReleasesDir\duckdb.dll" -Force
Copy-Item "$targetReleaseDir\WebView2Loader.dll" "$tauriReleasesDir\WebView2Loader.dll" -Force

# Winget manifest
$eHash = (Get-FileHash -Path $eTauri -Algorithm SHA256).Hash.ToUpper()
$wContent = @"
PackageIdentifier: $Publisher.Pulex
PackageVersion: $Version
PackageName: Pulex
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
  - InstallerType: portable
  - InstallerUrl: https://github.com/p1rkr41n/toad_electron/releases/download/v$Version/$pExeName
  - InstallerSha256: $eHash
ManifestType: singleton
ManifestVersion: 1.6.0
"@
$wTauri = Join-Path $tauriReleasesDir "$Publisher.Pulex.yaml"
$wContent | Out-File -FilePath $wTauri -Encoding utf8 -Force

Remove-Item -Recurse -Force $sDir -ErrorAction SilentlyContinue

# Also keep root Toad.exe and companion DLLs synced
if (Test-Path "$projectRoot\Toad.exe") {
    Copy-Item $builtExe "$projectRoot\Toad.exe" -Force
    Copy-Item "$targetReleaseDir\duckdb.dll" "$projectRoot\duckdb.dll" -Force
    Copy-Item "$targetReleaseDir\WebView2Loader.dll" "$projectRoot\WebView2Loader.dll" -Force
}

# 6. Cryptographic SHA256SUMS.txt in tauri/project/releases/
Write-Output "[STEP 6/6] Computing Cryptographic SHA256SUMS.txt..."
$allReleaseFiles = Get-ChildItem -Path $tauriReleasesDir -Filter "*.exe" -File | Where-Object { $_.Name -like "*-portable.exe" }
$allZipFiles = Get-ChildItem -Path $tauriReleasesDir -Filter "*.zip" -File | Where-Object { $_.Name -like "*-portable.zip" }
$targetFiles = @($allReleaseFiles) + @($allZipFiles) | Sort-Object Name

$hashLines = foreach ($f in $targetFiles) {
    $h = (Get-FileHash -Path $f.FullName -Algorithm SHA256).Hash.ToLower()
    "$h  $($f.Name)"
}
$checksumPath = Join-Path $tauriReleasesDir "SHA256SUMS.txt"
$hashLines | Out-File -FilePath $checksumPath -Encoding ascii -Force

Write-Output "======================================================================"
Write-Output "  PULEX RELEASE ARTIFACTS GENERATED SUCCESSFULLY!"
Write-Output "  Artifacts in $($tauriReleasesDir):"
Write-Output "    - $pExeName ($([math]::Round((Get-Item $eTauri).Length / 1MB, 2)) MB)"
Write-Output "    - $pZipName ($([math]::Round((Get-Item $zTauri).Length / 1MB, 2)) MB)"
Write-Output "    - duckdb.dll & WebView2Loader.dll"
Write-Output "    - $Publisher.Pulex.yaml"
Write-Output "    - SHA256SUMS.txt"
Write-Output "======================================================================"
