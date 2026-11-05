$nodeExe = "d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe"
$ipcTest = "d:\Shared_UserData\Downloads\tad\tauri\project\tests\test_tauri_arrow_ipc.js"

Write-Host "=== VERIFYING 5 CONSECUTIVE COLD INVOCATIONS OF ARROW IPC TEST 5.2 ==="
for ($i = 1; $i -le 5; $i++) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $out = & $nodeExe $ipcTest
    $sw.Stop()
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Run $i failed with exit code $LASTEXITCODE"
        exit 1
    }
    
    $benchLine = ($out -split "\r?\n") | Where-Object { $_ -match 'Benchmark performance' }
    Write-Host "Cold run $($i): $($sw.ElapsedMilliseconds) ms process time | $benchLine"
}
