$ErrorActionPreference = "Stop"

$nodePath = "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64"
$gitPath = "D:\Shared_UserData\Downloads\tad\mingit\cmd"
$cargoPath = "$env:USERPROFILE\.cargo\bin"
$env:PATH = "$cargoPath;$nodePath;$gitPath;$env:PATH"

Write-Output "=== 1. Compile packages ==="
Write-Output "--- Building tadviewer ---"
Set-Location "D:\Shared_UserData\Downloads\tad\tad-master\packages\tadviewer"
& npm.cmd run build-prod

Write-Output "--- Building tad-app ---"
Set-Location "D:\Shared_UserData\Downloads\tad\tad-master\packages\tad-app"
& npm.cmd run build-prod

$srcCore = "D:\Shared_UserData\Downloads\tad\tad-master\packages\toad-core-rust\target\release\toad-core.exe"
if (Test-Path $srcCore) {
    Copy-Item $srcCore "D:\Shared_UserData\Downloads\tad\tad-master\packages\tad-app\dist\toad-core.exe" -Force
    if (-not (Test-Path "D:\Shared_UserData\Downloads\tad\tad-master\packages\tad-app\bin")) {
        New-Item -ItemType Directory -Path "D:\Shared_UserData\Downloads\tad\tad-master\packages\tad-app\bin" -Force | Out-Null
    }
    Copy-Item $srcCore "D:\Shared_UserData\Downloads\tad\tad-master\packages\tad-app\bin\toad-core.exe" -Force
    Write-Output "toad-core.exe synced to dist and bin."
}

Write-Output "=== 2. Package Portable with electron-builder ==="
Remove-Item "D:\Shared_UserData\Downloads\tad\tad-master\packages\tad-app\release\*.exe" -Force -ErrorAction SilentlyContinue
Remove-Item "D:\Shared_UserData\Downloads\tad\tad-master\packages\tad-app\release\*.7z" -Force -ErrorAction SilentlyContinue
& npx.cmd electron-builder --win portable --publish=never
Write-Output "Packaging completed."

Write-Output "=== 3. Copy release executable ==="
$cand = Get-ChildItem "D:\Shared_UserData\Downloads\tad\tad-master\packages\tad-app\release\*.exe" | Where-Object { $_.Name -notlike "*Setup*" } | Select-Object -First 1

if ($cand) {
    $builtExe = $cand.FullName
    Write-Output "Found built executable: $builtExe"
    
    if (-not (Test-Path "D:\Shared_UserData\Downloads\tad\releases")) {
        New-Item -ItemType Directory -Path "D:\Shared_UserData\Downloads\tad\releases" -Force | Out-Null
    }

    # 1. Versioned portable executable
    Copy-Item $builtExe "D:\Shared_UserData\Downloads\tad\releases\toad_v1.3.7.3_portable.exe" -Force
    Copy-Item $builtExe "D:\Shared_UserData\Downloads\tad\toad_v1.3.7.3_portable.exe" -Force
    
    # 2. Toad.exe (primary standalone executable)
    Copy-Item $builtExe "D:\Shared_UserData\Downloads\tad\releases\Toad.exe" -Force
    Copy-Item $builtExe "D:\Shared_UserData\Downloads\tad\Toad.exe" -Force
    
    $size = (Get-Item "D:\Shared_UserData\Downloads\tad\Toad.exe").Length
    $sizeMB = [math]::Round($size / 1MB, 2)
    Write-Output "Success: Copied to Toad.exe and toad_v1.3.7.3_portable.exe ($sizeMB MB)"
} else {
    Write-Error "No built executable found in release folder!"
}
