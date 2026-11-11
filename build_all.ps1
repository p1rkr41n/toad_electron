$ErrorActionPreference = "Stop"

$rootDir = $PSScriptRoot
$nodePath = "$rootDir\node-v18.20.4-win-x64"
$gitPath = "$rootDir\mingit\cmd"
$cargoPath = "$env:USERPROFILE\.cargo\bin"
$env:PATH = "$cargoPath;$nodePath;$gitPath;$env:PATH"

Write-Output "--- Building reltab ---"
Set-Location "$rootDir\tad-master\packages\reltab"
& npm.cmd run build

Write-Output "--- Building host-bridge ---"
Set-Location "$rootDir\tad-master\packages\host-bridge"
& npm.cmd run build

Write-Output "--- Building reltab-duckdb ---"
Set-Location "$rootDir\tad-master\packages\reltab-duckdb"
& npm.cmd run build

Write-Output "--- Building reltab-fs ---"
Set-Location "$rootDir\tad-master\packages\reltab-fs"
& npm.cmd run build

$viewerDir = "$rootDir\tad-master\packages\toadviewer"
if (-not (Test-Path $viewerDir)) {
    $viewerDir = "$rootDir\tad-master\packages\tadviewer"
}
$viewerName = Split-Path $viewerDir -Leaf
Write-Output "--- Building $viewerName ---"
Set-Location $viewerDir
& npm.cmd run build-prod

$appDir = "$rootDir\tad-master\packages\toad-app"
if (-not (Test-Path $appDir)) {
    $appDir = "$rootDir\tad-master\packages\tad-app"
}
$appName = Split-Path $appDir -Leaf
Write-Output "--- Building $appName ---"
Set-Location $appDir
& npm.cmd run build-prod

Write-Output "ALL PACKAGES BUILT SUCCESSFULLY!"
