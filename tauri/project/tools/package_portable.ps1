<#
.SYNOPSIS
    Production Packaging Script for Toad / Pulex Tauri v2
    Standard: HelloKittyXamKinLung Indie Release Pipeline

.DESCRIPTION
    1. Builds Vite 5 production frontend bundle (`npm run build`).
    2. Compiles optimized Rust core (`cargo build --release`).
    3. Validates footprint gate (< 50MB).
    4. Enforces Zero-Duplicate Binary storage policy (pruning historical binaries and alias duplicates).
    5. Creates dual distribution (`Toad-<version>-x64-portable.exe` + `Toad-<version>-x64-portable.zip` and Pulex compatibility artifacts).
    6. Generates SHA256SUMS.txt cryptographic checksums and Winget manifests.
    7. Deploys single canonical executable strictly to project root `Toad.exe`.
#>

param (
    [string]$AppName = "Toad",
    [string]$Version = "2.5.2.2",
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
$builtExe = if (Test-Path "$targetReleaseDir\toad.exe") {
    "$targetReleaseDir\toad.exe"
} elseif (Test-Path "$targetReleaseDir\pulex.exe") {
    "$targetReleaseDir\pulex.exe"
} else {
    throw "ERROR: Neither toad.exe nor pulex.exe found in $targetReleaseDir!"
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

# 4. Zero-Duplicate Binary Policy Enforcement
Write-Output "[STEP 4/6] Enforcing Zero-Duplicate Binary Storage Policy..."
foreach ($dir in @($tauriReleasesDir, $rootReleasesDir)) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    # Prune historical aliases with spaces
    $duplicates = Get-ChildItem -Path $dir -Include "Toad *.exe", "Pulex *.exe" -Recurse:$false -ErrorAction SilentlyContinue
    if ($duplicates.Count -gt 0) {
        Write-Warning "Pruning duplicate historical binaries from $($dir): $($duplicates.Name)"
        $duplicates | Remove-Item -Force
    }
    # Prune old historical versions (e.g. 2.x Electron builds)
    $historical = Get-ChildItem -Path $dir -Filter "Toad-2.*-x64-portable.exe" -ErrorAction SilentlyContinue
    if ($historical.Count -gt 0) {
        Write-Warning "Pruning outdated historical 2.x binaries from $($dir): $($historical.Name)"
        $historical | Remove-Item -Force
    }
}
# Enforce single canonical Toad.exe in root, pruning all duplicate .exe binaries
$rootDuplicates = Get-ChildItem -Path $projectRoot -Filter "*.exe" -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne "Toad.exe" }
if ($rootDuplicates.Count -gt 0) {
    Write-Warning "Pruning duplicate executable binaries from root: $($rootDuplicates.Name)"
    $rootDuplicates | Remove-Item -Force
}

# 5. Dual Packaging Artifacts Generation
Write-Output "[STEP 5/6] Generating Dual Packaging Artifacts..."

# Staging helper function
function Build-PackageArtifacts([string]$pkgName, [string]$pkgVersion) {
    $pExeName = "$pkgName-$pkgVersion-x64-portable.exe"
    $pZipName = "$pkgName-$pkgVersion-x64-portable.zip"
    $sDir = Join-Path $env:TEMP "${pkgName}_package_stage_$pkgVersion"
    if (Test-Path $sDir) { Remove-Item -Recurse -Force $sDir }
    New-Item -ItemType Directory -Path $sDir | Out-Null

    Copy-Item $builtExe "$sDir\$pkgName.exe"
    Copy-Item $builtExe "$sDir\$pExeName"
    Copy-Item "$targetReleaseDir\duckdb.dll" "$sDir\duckdb.dll"
    Copy-Item "$targetReleaseDir\WebView2Loader.dll" "$sDir\WebView2Loader.dll"

    # Zip archive (Tauri-isolated only)
    $zTauri = Join-Path $tauriReleasesDir $pZipName
    Compress-Archive -Path "$sDir\*" -DestinationPath $zTauri -CompressionLevel Optimal -Force

    # Standalone exe (Tauri-isolated only)
    $eTauri = Join-Path $tauriReleasesDir $pExeName
    try {
        Copy-Item $builtExe $eTauri -Force
        Write-Output "           Updated $pExeName and $pZipName in tauri/project/releases/."
    } catch {
        Write-Warning "Could not copy $eTauri: $_"
    }

    # Winget manifest
    $eHash = (Get-FileHash -Path $eTauri -Algorithm SHA256).Hash.ToUpper()
    $wContent = @"
PackageIdentifier: $Publisher.$pkgName
PackageVersion: $pkgVersion
PackageName: $pkgName
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
  - InstallerUrl: https://github.com/p1rkr41n/toad_electron/releases/download/v$pkgVersion/$pExeName
  - InstallerSha256: $eHash
ManifestType: singleton
ManifestVersion: 1.6.0
"@
    $wTauri = Join-Path $tauriReleasesDir "$Publisher.$pkgName.yaml"
    $wContent | Out-File -FilePath $wTauri -Encoding utf8 -Force

    Remove-Item -Recurse -Force $sDir -ErrorAction SilentlyContinue

    return @{
        ExePathTauri = $eTauri
        ZipPathTauri = $zTauri
        ExeName = $pExeName
        ZipName = $pZipName
    }
}

# Generate both Toad (canonical) and Pulex (backward-compat) packages inside tauri\project\releases ONLY
$toadPkg = Build-PackageArtifacts -pkgName "Toad" -pkgVersion $Version
$pulexPkg = Build-PackageArtifacts -pkgName "Pulex" -pkgVersion $Version

# Copy runtime DLL dependencies to release folder for instant execution
try {
    Copy-Item "$targetReleaseDir\duckdb.dll" "$tauriReleasesDir\duckdb.dll" -Force
    Copy-Item "$targetReleaseDir\WebView2Loader.dll" "$tauriReleasesDir\WebView2Loader.dll" -Force
} catch {
    Write-Warning "Could not overwrite companion DLLs (file locked by active process): $_"
}

# Update canonical project root Toad.exe and companion DLLs
try {
    Copy-Item $builtExe "$projectRoot\Toad.exe" -Force
    Copy-Item "$targetReleaseDir\duckdb.dll" "$projectRoot\duckdb.dll" -Force
    Copy-Item "$targetReleaseDir\WebView2Loader.dll" "$projectRoot\WebView2Loader.dll" -Force
    Write-Output "           Updated canonical root\Toad.exe and native companion DLLs."
} catch {
    Write-Warning "Could not overwrite root\Toad.exe (file locked by active process): $_"
}

# Ensure root has NO duplicate executables
$rootExtras = Get-ChildItem -Path $projectRoot -Filter "*.exe" -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne "Toad.exe" }
if ($rootExtras.Count -gt 0) {
    $rootExtras | Remove-Item -Force
}

# 6. Cryptographic SHA256SUMS.txt
Write-Output "[STEP 6/6] Computing Cryptographic SHA256SUMS.txt & Verifying Footprint..."
$hashFiles = @(
    (Get-Item $pulexPkg.ExePathTauri),
    (Get-Item $pulexPkg.ZipPathTauri),
    (Get-Item $toadPkg.ExePathTauri),
    (Get-Item $toadPkg.ZipPathTauri)
)
$hashLines = foreach ($f in $hashFiles) {
    $h = (Get-FileHash -Path $f.FullName -Algorithm SHA256).Hash.ToLower()
    "$h  $($f.Name)"
}
$checksumPathTauri = Join-Path $tauriReleasesDir "SHA256SUMS.txt"
$hashLines | Out-File -FilePath $checksumPathTauri -Encoding ascii -Force

Write-Output "======================================================================"
Write-Output "  ALL RELEASE ARTIFACTS PACKAGED SUCCESSFULLY (HelloKittyXamKinLung Standard)!"
Write-Output "  Canonical Root Binary:"
Write-Output "    - Toad.exe ($([math]::Round((Get-Item "$projectRoot\Toad.exe").Length / 1MB, 2)) MB)"
Write-Output "  Artifacts isolated in $($tauriReleasesDir):"
Write-Output "    - $($toadPkg.ExeName) ($([math]::Round((Get-Item $toadPkg.ExePathTauri).Length / 1MB, 2)) MB)"
Write-Output "    - $($toadPkg.ZipName) ($([math]::Round((Get-Item $toadPkg.ZipPathTauri).Length / 1MB, 2)) MB)"
Write-Output "    - $($pulexPkg.ExeName) ($([math]::Round((Get-Item $pulexPkg.ExePathTauri).Length / 1MB, 2)) MB)"
Write-Output "    - $($pulexPkg.ZipName) ($([math]::Round((Get-Item $pulexPkg.ZipPathTauri).Length / 1MB, 2)) MB)"
Write-Output "    - SHA256SUMS.txt"
Write-Output "    - HelloKittyXamKinLung.Toad.yaml"
Write-Output "    - HelloKittyXamKinLung.Pulex.yaml"
Write-Output "======================================================================"
