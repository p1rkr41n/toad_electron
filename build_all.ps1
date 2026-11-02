$ErrorActionPreference = "Stop"

$nodePath = "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64"
$gitPath = "D:\Shared_UserData\Downloads\tad\mingit\cmd"
$cargoPath = "$env:USERPROFILE\.cargo\bin"
$env:PATH = "$cargoPath;$nodePath;$gitPath;$env:PATH"

Write-Output "--- Building reltab ---"
Set-Location "D:\Shared_UserData\Downloads\tad\tad-master\packages\reltab"
& npm.cmd run build

Write-Output "--- Building host-bridge ---"
Set-Location "D:\Shared_UserData\Downloads\tad\tad-master\packages\host-bridge"
& npm.cmd run build

Write-Output "--- Building reltab-duckdb ---"
Set-Location "D:\Shared_UserData\Downloads\tad\tad-master\packages\reltab-duckdb"
& npm.cmd run build

Write-Output "--- Building reltab-fs ---"
Set-Location "D:\Shared_UserData\Downloads\tad\tad-master\packages\reltab-fs"
& npm.cmd run build

Write-Output "--- Building tadviewer ---"
Set-Location "D:\Shared_UserData\Downloads\tad\tad-master\packages\tadviewer"
& npm.cmd run build-prod

Write-Output "--- Building tad-app ---"
Set-Location "D:\Shared_UserData\Downloads\tad\tad-master\packages\tad-app"
& npm.cmd run build-prod

Write-Output "ALL PACKAGES BUILT SUCCESSFULLY!"
