$testDir = Join-Path $env:TEMP "toad_test_exec_$(Get-Random)"
New-Item -ItemType Directory -Path $testDir | Out-Null
Copy-Item "D:\Shared_UserData\Downloads\tad\releases\Toad-2.5.2-x64-portable.exe" "$testDir\Toad-2.5.2-x64-portable.exe"
Copy-Item "D:\Shared_UserData\Downloads\tad\releases\duckdb.dll" "$testDir\duckdb.dll"
Copy-Item "D:\Shared_UserData\Downloads\tad\releases\WebView2Loader.dll" "$testDir\WebView2Loader.dll"

$p = Start-Process -FilePath "$testDir\Toad-2.5.2-x64-portable.exe" -WorkingDirectory $testDir -PassThru
Start-Sleep -Seconds 2
$exited = $p.HasExited
$pidVal = $p.Id
Write-Host "Isolated launch Process ID: $pidVal, Exited: $exited"
if (-not $exited) {
    Stop-Process -Id $pidVal -Force
    Write-Host "Process stopped successfully."
}

$createdDirs = Get-ChildItem -Path $testDir -Directory -Filter "toadAppData_*"
Write-Host "Created portable AppData dir: $($createdDirs.Name)"

Remove-Item -Recurse -Force $testDir -ErrorAction SilentlyContinue
