$ErrorActionPreference = "Stop"

$nodePath = "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64"
$gitPath = "D:\Shared_UserData\Downloads\tad\mingit\cmd"
$cargoPath = "$env:USERPROFILE\.cargo\bin"
$env:PATH = "$cargoPath;$nodePath;$gitPath;$env:PATH"

Write-Output "=== 1. Build tadviewer bundle ==="
Set-Location "D:\Shared_UserData\Downloads\tad\tad-master\packages\tadviewer"
& npm.cmd run build-prod
Write-Output "tadviewer build completed."

Write-Output "=== 2. Build tad-app bundle with v1.3.4 changes ==="
Set-Location "D:\Shared_UserData\Downloads\tad\tad-master\packages\tad-app"
& npm.cmd run build-prod

$srcCore = "D:\Shared_UserData\Downloads\tad\tad-master\packages\toad-core-rust\target\release\toad-core.exe"
if (Test-Path $srcCore) {
    Copy-Item $srcCore "D:\Shared_UserData\Downloads\tad\tad-master\packages\tad-app\dist\toad-core.exe" -Force
    Write-Output "toad-core.exe synced."
}

Write-Output "=== 3. Package Portable with electron-builder ==="
Remove-Item "D:\Shared_UserData\Downloads\tad\tad-master\packages\tad-app\release\*.exe" -Force -ErrorAction SilentlyContinue
Remove-Item "D:\Shared_UserData\Downloads\tad\tad-master\packages\tad-app\release\*.7z" -Force -ErrorAction SilentlyContinue
& npx.cmd electron-builder --win portable --publish=never
Write-Output "Packaging completed."

Write-Output "=== 4. Copy release executable ==="
$cand = Get-ChildItem "D:\Shared_UserData\Downloads\tad\tad-master\packages\tad-app\release\*.exe" | Where-Object { $_.Name -notlike "*Setup*" } | Select-Object -First 1

if ($cand) {
    $builtExe = $cand.FullName
    Write-Output "Found built executable: $builtExe"
    
    # 1. toad_v1.3.4_portable.exe
    Copy-Item $builtExe "D:\Shared_UserData\Downloads\tad\releases\toad_v1.3.4_portable.exe" -Force
    Copy-Item $builtExe "D:\Shared_UserData\Downloads\tad\toad_v1.3.4_portable.exe" -Force
    
    # 2. Toad.exe (primary standalone executable)
    Copy-Item $builtExe "D:\Shared_UserData\Downloads\tad\releases\Toad.exe" -Force
    Copy-Item $builtExe "D:\Shared_UserData\Downloads\tad\Toad.exe" -Force
    
    $size = (Get-Item "D:\Shared_UserData\Downloads\tad\Toad.exe").Length
    Write-Output "Success: Copied to Toad.exe and toad_v1.3.4_portable.exe ($([math]::Round($size / 1MB, 2)) MB)"
} else {
    Write-Error "Built exe not found in release folder!"
}
