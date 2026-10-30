$ErrorActionPreference = "Stop"

$nodePath = "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64"
$gitPath = "D:\Shared_UserData\Downloads\tad\mingit\cmd"
$cargoPath = "$env:USERPROFILE\.cargo\bin"
$env:PATH = "$cargoPath;$nodePath;$gitPath;$env:PATH"

Write-Output "--- Packaging Toad with electron-builder ---"
Set-Location "D:\Shared_UserData\Downloads\tad\tad-master\packages\tad-app"
& npm.cmd run dist

$releaseDir = "D:\Shared_UserData\Downloads\tad\releases"
$rootDir = "D:\Shared_UserData\Downloads\tad"
$latestExe = Get-ChildItem -Path "D:\Shared_UserData\Downloads\tad\tad-master\packages\tad-app\release\*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1

if ($latestExe) {
    Write-Output "Copying $($latestExe.Name) to releases and root..."
    Copy-Item $latestExe.FullName -Destination "$rootDir\Toad.exe" -Force
    Copy-Item $latestExe.FullName -Destination "$rootDir\Toad 2.0.7.exe" -Force
    Copy-Item $latestExe.FullName -Destination "$rootDir\$($latestExe.Name)" -Force
    Copy-Item $latestExe.FullName -Destination "$releaseDir\$($latestExe.Name)" -Force
    Copy-Item $latestExe.FullName -Destination "$releaseDir\Toad 2.0.7.exe" -Force
    Copy-Item $latestExe.FullName -Destination "$releaseDir\toad_v2.0.7_portable.exe" -Force
    Copy-Item $latestExe.FullName -Destination "$releaseDir\Toad.exe" -Force
}

Write-Output "--- Packaging Complete! ---"
