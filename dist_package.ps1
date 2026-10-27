$ErrorActionPreference = "Stop"

$nodePath = "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64"
$gitPath = "D:\Shared_UserData\Downloads\tad\mingit\cmd"
$cargoPath = "$env:USERPROFILE\.cargo\bin"
$env:PATH = "$cargoPath;$nodePath;$gitPath;$env:PATH"

Write-Output "--- Packaging Toad with electron-builder ---"
Set-Location "D:\Shared_UserData\Downloads\tad\tad-master\packages\tad-app"
& npm.cmd run dist

Write-Output "--- Packaging Complete! ---"
