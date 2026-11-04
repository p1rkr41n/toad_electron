param (
    [string]$AppName = "Toad",
    [string]$Version = "2.5.0.3",
    [string]$Publisher = "HelloKittyXamKinLung",
    [string]$ReleaseDir = "releases"
)

$ErrorActionPreference = "Stop"

Write-Output "=== Toad Release Packager v$Version ==="

# 1. Version assertion to 2.5.0
if ($Version -ne "2.5.0") {
    Write-Warning "Target version is '$Version'. Standard target for Milestone 4 is '2.5.0'."
}

# 2. Verify native binary rule: duckdb.node in app.asar.unpacked
$appDir = Join-Path $PSScriptRoot "tad-master\packages\toad-app"
$duckDbUnpacked = "$appDir\release\win-unpacked\resources\app.asar.unpacked\node_modules\duckdb\lib\binding\duckdb.node"
if (Test-Path "$appDir\release\win-unpacked") {
    if (-not (Test-Path $duckDbUnpacked)) {
        throw "ASSERTION ERROR: duckdb.node not found in app.asar.unpacked at $duckDbUnpacked!"
    }
    Write-Output ">>> duckdb.node native binding verified in app.asar.unpacked."
}

# 3. Enforce size limits: app.asar < 45 MB, portable exe < 75 MB
$asarPath = "$appDir\release\win-unpacked\resources\app.asar"
if (Test-Path $asarPath) {
    $asarSizeMB = [math]::Round((Get-Item $asarPath).Length / 1MB, 2)
    Write-Output ">>> app.asar footprint: $asarSizeMB MB"
    if ($asarSizeMB -gt 45.0) {
        throw "FOOTPRINT GATE ERROR: app.asar size ($asarSizeMB MB) exceeds 45.0 MB threshold!"
    }
}

# 4. Enforce zero-duplicate binary policy
Write-Output "=== Enforcing Zero-Duplicate Binary Policy ==="
$duplicateRoot = Get-ChildItem -Path $PSScriptRoot -Filter "Toad *.exe" -ErrorAction SilentlyContinue
if ($duplicateRoot.Count -gt 0) {
    Write-Warning "Pruning duplicate historical binaries from root: $($duplicateRoot.Name)"
    $duplicateRoot | Remove-Item -Force
}
$fullReleaseDir = Join-Path $PSScriptRoot $ReleaseDir
if (Test-Path $fullReleaseDir) {
    $duplicateReleases = Get-ChildItem -Path $fullReleaseDir -Filter "Toad *.exe" -ErrorAction SilentlyContinue
    if ($duplicateReleases.Count -gt 0) {
        Write-Warning "Pruning duplicate historical alias binaries from releases: $($duplicateReleases.Name)"
        $duplicateReleases | Remove-Item -Force
    }
}

$scriptPath = Join-Path $PSScriptRoot ".agents\skills\releases\scripts\package_release.ps1"
& powershell -ExecutionPolicy Bypass -File $scriptPath -AppName $AppName -Version $Version -Publisher $Publisher -ReleaseDir $ReleaseDir

# 5. Check packaged portable executable size < 75 MB
$canonicalExe = Join-Path $fullReleaseDir "$AppName-$Version-x64-portable.exe"
if (-not (Test-Path $canonicalExe)) {
    $canonicalExe = Join-Path $fullReleaseDir "Toad.exe"
}
if (Test-Path $canonicalExe) {
    $exeSizeMB = [math]::Round((Get-Item $canonicalExe).Length / 1MB, 2)
    Write-Output ">>> Packaged portable executable size: $exeSizeMB MB"
    if ($exeSizeMB -gt 75.0) {
        throw "FOOTPRINT GATE ERROR: Portable exe ($exeSizeMB MB) exceeds 75.0 MB threshold!"
    }
}
