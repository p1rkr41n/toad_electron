param (
    [string]$AppName = "Toad",
    [string]$Version = "2.3.5",
    [string]$Publisher = "HelloKittyXamKinLung",
    [string]$ReleaseDir = "releases"
)

$ErrorActionPreference = "Stop"

Write-Output "======================================================================"
Write-Output "  WINDOWS INDIE RELEASE PIPELINE (Standard: $Publisher)"
Write-Output "  App: $AppName | Version: $Version | Cost: $0 USD"
Write-Output "======================================================================"

if (-not (Test-Path $ReleaseDir)) {
    New-Item -ItemType Directory -Path $ReleaseDir -Force | Out-Null
}

$exePattern = "$ReleaseDir\*$Version*.exe"
$exeFile = Get-Item -Path $exePattern -ErrorAction SilentlyContinue | Select-Object -First 1

if (-not $exeFile) {
    Write-Warning "No executable found matching $exePattern in $ReleaseDir. Searching for Toad.exe..."
    $exeFile = Get-Item -Path "$ReleaseDir\Toad.exe" -ErrorAction SilentlyContinue
}

if (-not $exeFile) {
    throw "ERROR: Cannot find release executable in $ReleaseDir!"
}

Write-Output "[STEP 1] Found Target Binary: $($exeFile.Name) ($([math]::Round($exeFile.Length / 1MB, 2)) MB)"

# 1. Create .zip distribution
$zipName = "$AppName-$Version-x64-portable.zip"
$zipPath = Join-Path $ReleaseDir $zipName
Write-Output "[STEP 2] Compressing to $zipName for zero-friction browser download..."
Compress-Archive -Path $exeFile.FullName -DestinationPath $zipPath -CompressionLevel Optimal -Force
Write-Output "         Created: $zipPath ($([math]::Round((Get-Item $zipPath).Length / 1MB, 2)) MB)"

# 2. Compute SHA-256 Checksums
Write-Output "[STEP 3] Generating SHA256SUMS.txt integrity ledger..."
$filesToHash = @($exeFile, (Get-Item $zipPath))
$hashLines = foreach ($f in $filesToHash) {
    $h = (Get-FileHash -Path $f.FullName -Algorithm SHA256).Hash.ToLower()
    "$h  $($f.Name)"
}
$checksumPath = Join-Path $ReleaseDir "SHA256SUMS.txt"
$hashLines | Out-File -FilePath $checksumPath -Encoding ascii -Force
Write-Output "         Checksums written to: $checksumPath"
foreach ($line in $hashLines) {
    Write-Output "         -> $line"
}

# 3. Generate Winget Manifest
$exeHash = (Get-FileHash -Path $exeFile.FullName -Algorithm SHA256).Hash.ToUpper()
$wingetManifest = @"
# Created using Antigravity Skill: releases (HelloKittyXamKinLung Standard)
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
    InstallerUrl: https://github.com/p1rkr41n/toad_electron/releases/download/v$Version/$($exeFile.Name)
    InstallerSha256: $exeHash
ManifestType: singleton
ManifestVersion: 1.6.0
"@

$wingetPath = Join-Path $ReleaseDir "$Publisher.$AppName.yaml"
$wingetManifest | Out-File -FilePath $wingetPath -Encoding utf8 -Force
Write-Output "[STEP 4] Created Winget Manifest Template: $wingetPath"

Write-Output "======================================================================"
Write-Output "  ALL RELEASE ARTIFACTS PREPARED SUCCESSFULLY (100% FREE & CLEAN)!"
Write-Output "  Ready to publish to GitHub Releases and Microsoft Winget."
Write-Output "======================================================================"

