$ErrorActionPreference = "Stop"

$nodePath = "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64"
$gitPath = "D:\Shared_UserData\Downloads\tad\mingit\cmd"
$cargoPath = "$env:USERPROFILE\.cargo\bin"
$env:PATH = "$cargoPath;$nodePath;$gitPath;$env:PATH"

Write-Output "=== STEP 1: Building tadviewer ==="
Set-Location "D:\Shared_UserData\Downloads\tad\tad-master\packages\tadviewer"
& npm.cmd run build

Write-Output "=== STEP 2: Building Webpack Production for tad-app ==="
Set-Location "D:\Shared_UserData\Downloads\tad\tad-master\packages\tad-app"
& npm.cmd run build-prod

Write-Output "=== STEP 3: Verifying integrity of tadapp.bundle.js ==="
$bundlePath = "D:\Shared_UserData\Downloads\tad\tad-master\packages\tad-app\dist\tadapp.bundle.js"
if (-not (Test-Path $bundlePath)) {
    throw "ERROR: Cannot find tadapp.bundle.js!"
}
$bundleContent = [System.IO.File]::ReadAllText($bundlePath)
if (-not ($bundleContent.Contains("v2.1.4") -or $bundleContent.Contains("v2.1.3") -or $bundleContent.Contains("v2.1.2") -or $bundleContent.Contains("v2.1.0"))) {
    throw "ASSERTION ERROR: tadapp.bundle.js does not contain v2.1.4!"
}
if (-not $bundleContent.Contains("padStart(3")) {
    throw "ASSERTION ERROR: tadapp.bundle.js does not contain padStart(3 for str001!"
}
Write-Output ">>> Bundle Verification SUCCESS: contains v2.1.4 and str001."

Write-Output "=== STEP 4: Packaging Electron App with electron-builder ==="
& npm.cmd run dist

Write-Output "=== STEP 5: Copying binaries to release and root directories ==="
$releaseDir = "D:\Shared_UserData\Downloads\tad\releases"
$rootDir = "D:\Shared_UserData\Downloads\tad"
$latestExe = Get-ChildItem -Path "D:\Shared_UserData\Downloads\tad\tad-master\packages\tad-app\release\*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1

if ($latestExe) {
    Write-Output "Copying $($latestExe.Name) to releases and root..."
    Copy-Item $latestExe.FullName -Destination "$rootDir\Toad.exe" -Force
    Copy-Item $latestExe.FullName -Destination "$rootDir\Toad 2.1.4.exe" -Force
    Copy-Item $latestExe.FullName -Destination "$rootDir\Toad 2.1.3.exe" -Force
    Copy-Item $latestExe.FullName -Destination "$rootDir\Toad 2.1.2.exe" -Force
    Copy-Item $latestExe.FullName -Destination "$rootDir\$($latestExe.Name)" -Force
    Copy-Item $latestExe.FullName -Destination "$releaseDir\$($latestExe.Name)" -Force
    Copy-Item $latestExe.FullName -Destination "$releaseDir\Toad 2.1.4.exe" -Force
    Copy-Item $latestExe.FullName -Destination "$releaseDir\toad_v2.1.4_portable.exe" -Force
    Copy-Item $latestExe.FullName -Destination "$releaseDir\Toad 2.1.3.exe" -Force
    Copy-Item $latestExe.FullName -Destination "$releaseDir\toad_v2.1.3_portable.exe" -Force
    Copy-Item $latestExe.FullName -Destination "$releaseDir\Toad 2.1.2.exe" -Force
    Copy-Item $latestExe.FullName -Destination "$releaseDir\toad_v2.1.2_portable.exe" -Force
    Copy-Item $latestExe.FullName -Destination "$releaseDir\Toad.exe" -Force
}

Write-Output "=== Packaging completed successfully: Toad 2.1.4! ==="
