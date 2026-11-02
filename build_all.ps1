$ErrorActionPreference = "Stop"

$rootDir = $PSScriptRoot
$nodePath = "$rootDir\node-v18.20.4-win-x64"
$gitPath = "$rootDir\mingit\cmd"
$cargoPath = "$env:USERPROFILE\.cargo\bin"
$env:PATH = "$cargoPath;$nodePath;$gitPath;$env:PATH"

Write-Output "--- Building reltab ---"
Set-Location "$rootDir\tad-master\packages\reltab"
& npm.cmd run build

Write-Output "--- Building reltab-duckdb ---"
Set-Location "$rootDir\tad-master\packages\reltab-duckdb"
& npm.cmd run build

Write-Output "--- Building tadviewer ---"
Set-Location "$rootDir\tad-master\packages\tadviewer"
& npm.cmd run build-prod

Write-Output "--- Building tad-app ---"
Set-Location "$rootDir\tad-master\packages\tad-app"
& npm.cmd run build-prod

Write-Output "ALL PACKAGES BUILT SUCCESSFULLY!"
