<#
.SYNOPSIS
    FastBuild script for Toad - Packages each version into a standalone runnable folder.
    Bypasses expensive 7-Zip LZMA portable compression (~150s savings).

.DESCRIPTION
    Builds Toad into an unpacked, immediately runnable directory:
      build/Toad-<version>/Toad.exe
    Can be executed and debugged instantly.

.PARAMETER OutDir
    Custom output directory. Defaults to "build/Toad-<version>".

.PARAMETER SkipTsc
    Skip building TypeScript dependencies (host-bridge, reltab-duckdb) if already built.

.PARAMETER Dev
    Use development Webpack mode for even faster compilation (~2x faster bundle).

.PARAMETER Launch
    Automatically launch the built application upon completion.

.EXAMPLE
    .\fastbuild.ps1
    .\fastbuild.ps1 -Launch
    .\fastbuild.ps1 -Dev -Launch
    .\fastbuild.ps1 -SkipTsc
#>
[CmdletBinding()]
param(
    [string]$OutDir = "",
    [switch]$SkipTsc,
    [switch]$Dev,
    [switch]$Launch
)

$ErrorActionPreference = "Stop"

$nodePath = "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64"
$gitPath = "D:\Shared_UserData\Downloads\tad\mingit\cmd"
$cargoPath = "$env:USERPROFILE\.cargo\bin"
$env:PATH = "$cargoPath;$nodePath;$gitPath;$env:PATH"

$rootDir = "D:\Shared_UserData\Downloads\tad"
$appDir = "$rootDir\tad-master\packages\tad-app"

$totalStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$stageTimes = @{}

# Read version
$appPkg = Get-Content "$appDir\package.json" -Raw | ConvertFrom-Json
$version = $appPkg.version

if (-not $OutDir) {
    $OutDir = "$rootDir\build\Toad-$version"
}

Write-Output "================================================================="
Write-Output "  TOAD FASTBUILD ENGINE v$version"
Write-Output "  Target directory: $OutDir"
Write-Output "  Mode: $(if ($Dev) { 'Development (Fast)' } else { 'Production (Optimized)' })"
Write-Output "================================================================="

# --- STEP 1: Build TypeScript Libraries (Unless -SkipTsc) ---
if (-not $SkipTsc) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Write-Output "`n>>> [STEP 1.1] Building host-bridge (TypeScript)..."
    Set-Location "$rootDir\tad-master\packages\host-bridge"
    & npm.cmd run build

    Write-Output ">>> [STEP 1.2] Building reltab-duckdb (TypeScript)..."
    Set-Location "$rootDir\tad-master\packages\reltab-duckdb"
    & npm.cmd run build

    Write-Output ">>> [STEP 1.3] Building tadviewer..."
    Set-Location "$rootDir\tad-master\packages\tadviewer"
    if ($Dev) {
        & npm.cmd run build-dev
    } else {
        & npm.cmd run build-prod
    }
    $sw.Stop()
    $stageTimes["TypeScript & Tadviewer"] = [math]::Round($sw.Elapsed.TotalSeconds, 1)
} else {
    Write-Output "`n>>> [STEP 1] Skipping TypeScript dependencies (-SkipTsc active)..."
    $stageTimes["TypeScript & Tadviewer"] = 0
}

# --- STEP 2: Build tad-app Webpack Bundles ---
$sw = [System.Diagnostics.Stopwatch]::StartNew()
Write-Output "`n>>> [STEP 2] Building Webpack bundles for tad-app..."
Set-Location "$appDir"
if ($Dev) {
    & npm.cmd run build-dev
} else {
    & npm.cmd run build-prod
}
$sw.Stop()
$stageTimes["Webpack tad-app"] = [math]::Round($sw.Elapsed.TotalSeconds, 1)

# Verify main.bundle.js and tadapp.bundle.js
if (-not (Test-Path "$appDir\dist\main.bundle.js")) {
    throw "ERROR: dist\main.bundle.js was not generated!"
}
if (-not (Test-Path "$appDir\dist\tadapp.bundle.js")) {
    throw "ERROR: dist\tadapp.bundle.js was not generated!"
}

# --- STEP 3: Electron-Builder Unpacked Packaging (--dir) ---
$sw = [System.Diagnostics.Stopwatch]::StartNew()
Write-Output "`n>>> [STEP 3] Fast packaging Electron directory (--dir, no 7z compression)..."
Set-Location "$appDir"

# Clean stale win-unpacked
if (Test-Path "$appDir\release\win-unpacked") {
    Remove-Item -Recurse -Force "$appDir\release\win-unpacked" -ErrorAction SilentlyContinue
}

# Run electron-builder --dir (pack script)
& npm.cmd run pack
$sw.Stop()
$stageTimes["Electron Directory Packaging"] = [math]::Round($sw.Elapsed.TotalSeconds, 1)

# Verify win-unpacked exists
$winUnpacked = "$appDir\release\win-unpacked"
if (-not (Test-Path "$winUnpacked\Toad.exe")) {
    throw "ERROR: Toad.exe was not found in win-unpacked!"
}

# --- STEP 4: Output Version Directory ---
$sw = [System.Diagnostics.Stopwatch]::StartNew()
Write-Output "`n>>> [STEP 4] Deploying to version directory: $OutDir..."

# Stop any running instances in OutDir that lock files
Get-CimInstance Win32_Process -Filter "Name like 'Toad%'" -ErrorAction SilentlyContinue | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($OutDir, [System.StringComparison]::OrdinalIgnoreCase)
} | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 200

if (Test-Path "$OutDir") {
    Write-Output "    Cleaning existing destination directory..."
    Remove-Item -Recurse -Force "$OutDir" -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Force -Path "$OutDir" | Out-Null

# Robocopy or Copy-Item for ultra fast directory copy
robocopy "$winUnpacked" "$OutDir" /E /NFL /NDL /NJH /NJS /nc /ns /np /R:1 /W:1 | Out-Null
if (-not (Test-Path "$OutDir\Toad.exe")) {
    # Fallback to Copy-Item
    Copy-Item -Recurse -Force "$winUnpacked\*" "$OutDir\"
}

# Also update a convenient shortcut pointer in build\latest
$latestDir = "$rootDir\build\latest"
if (Test-Path "$latestDir") {
    Remove-Item -Recurse -Force "$latestDir" -ErrorAction SilentlyContinue
}
try {
    New-Item -ItemType Junction -Path "$latestDir" -Target "$OutDir" | Out-Null
} catch {
    # Ignore junction error if not supported
}

$sw.Stop()
$stageTimes["Directory Deployment"] = [math]::Round($sw.Elapsed.TotalSeconds, 1)

$totalStopwatch.Stop()
$totalSec = [math]::Round($totalStopwatch.Elapsed.TotalSeconds, 1)

# Calculate directory size
$dirBytes = (Get-ChildItem -Path "$OutDir" -Recurse | Measure-Object -Property Length -Sum).Sum
$dirSizeMB = [math]::Round($dirBytes / 1MB, 1)

Write-Output "`n================================================================="
Write-Output "  FASTBUILD SUCCESSFUL - TOAD v$version"
Write-Output "================================================================="
Write-Output "  Executable Path : $OutDir\Toad.exe"
Write-Output "  Folder Footprint: $dirSizeMB MB"
Write-Output "-----------------------------------------------------------------"
Write-Output "  TIMING BREAKDOWN:"
foreach ($k in $stageTimes.Keys) {
    Write-Output ("    {0,-30} : {1,6} s" -f $k, $stageTimes[$k])
}
Write-Output "-----------------------------------------------------------------"
Write-Output ("    {0,-30} : {1,6} s" -f "TOTAL FASTBUILD TIME", $totalSec)
Write-Output "================================================================="

if ($Launch) {
    Write-Output "`n>>> Launching $OutDir\Toad.exe..."
    Start-Process "$OutDir\Toad.exe"
}

