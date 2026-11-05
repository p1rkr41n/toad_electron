$nodeExe = "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe"
$ipcTest = "D:\Shared_UserData\Downloads\tad\tauri\project\tests\test_tauri_arrow_ipc.js"
$runAll = "D:\Shared_UserData\Downloads\tad\tauri\project\tests\run_all_tests.js"

Write-Host "=== Running 3 Cold Invocations of test_tauri_arrow_ipc.js ==="
for ($i = 1; $i -le 3; $i++) {
    Write-Host "`n--- Iteration $i ---"
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    & $nodeExe $ipcTest
    $sw.Stop()
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Test failed with exit code $LASTEXITCODE"
        exit 1
    }
    Write-Host "Iteration $i completed cleanly in $($sw.ElapsedMilliseconds) ms with exit code 0"
}

Write-Host "`n=== Running Master Test Orchestrator (run_all_tests.js) ==="
& $nodeExe $runAll
if ($LASTEXITCODE -ne 0) {
    Write-Error "run_all_tests.js failed with exit code $LASTEXITCODE"
    exit 1
}
Write-Host "`n=== All Node Test Suites Verified Successfully ==="
