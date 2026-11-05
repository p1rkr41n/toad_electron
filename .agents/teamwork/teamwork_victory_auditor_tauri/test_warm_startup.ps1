$tempBase = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "toad_warm_test_" + [System.Guid]::NewGuid().ToString("N").Substring(0,8))
New-Item -ItemType Directory -Path $tempBase -Force | Out-Null

$zipPath = "d:\Shared_UserData\Downloads\tad\releases\Toad-2.5.2-x64-portable.zip"
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $tempBase)

$exePath = Join-Path $tempBase "Toad.exe"

$latencies = @()

for ($run = 1; $run -le 5; $run++) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $exePath
    $psi.WorkingDirectory = $tempBase
    $psi.UseShellExecute = $false
    $proc = [System.Diagnostics.Process]::Start($psi)

    $done = $false
    for ($i = 0; $i -lt 100; $i++) {
        Start-Sleep -Milliseconds 20
        $subDirs = Get-ChildItem -Path $tempBase -Directory | Where-Object { $_.Name -like "toadAppData_*" }
        if ($subDirs.Count -gt 0) {
            $appDataDir = $subDirs[0].FullName
            $cfg = Join-Path $appDataDir "config.ini"
            $parquet = Join-Path $appDataDir "toad_ledger.parquet"
            if ((Test-Path $cfg) -and (Test-Path $parquet)) {
                $sw.Stop()
                $elapsed = $sw.ElapsedMilliseconds
                $latencies += $elapsed
                Write-Host "Run $run : Init completed in $elapsed ms"
                $done = $true
                break
            }
        }
    }
    
    if (-not $done) {
        Write-Host "Run $run : TIMEOUT waiting for init"
    }

    try {
        if (-not $proc.HasExited) {
            $proc.Kill()
            $proc.WaitForExit(1000)
        }
    } catch {}
}

if ($latencies.Count -gt 0) {
    $avg = ($latencies | Measure-Object -Average).Average
    $min = ($latencies | Measure-Object -Minimum).Minimum
    $max = ($latencies | Measure-Object -Maximum).Maximum
    Write-Host "`nResults across $($latencies.Count) runs:"
    Write-Host "  Average: $avg ms"
    Write-Host "  Min:     $min ms"
    Write-Host "  Max:     $max ms"
    if ($avg -lt 300) {
        Write-Host "[PASS] Average startup time ($avg ms) is well below 300ms threshold!"
    } else {
        Write-Host "[WARN] Average startup time ($avg ms) exceeds 300ms threshold"
    }
}

try {
    Remove-Item -Path $tempBase -Recurse -Force -ErrorAction SilentlyContinue
} catch {}
