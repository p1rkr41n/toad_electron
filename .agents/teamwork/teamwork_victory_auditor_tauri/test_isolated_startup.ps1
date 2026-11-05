$tempBase = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "toad_audit_" + [System.Guid]::NewGuid().ToString("N").Substring(0,8))
New-Item -ItemType Directory -Path $tempBase -Force | Out-Null
Write-Host "Created isolated test directory: $tempBase"

$zipPath = "d:\Shared_UserData\Downloads\tad\releases\Toad-2.5.2-x64-portable.zip"
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $tempBase)
Write-Host "Extracted zip to $tempBase"

$extractedFiles = Get-ChildItem -Path $tempBase
foreach ($f in $extractedFiles) {
    Write-Host " - $($f.Name) ($($f.Length) bytes)"
}

$exePath = Join-Path $tempBase "Toad.exe"
if (-not (Test-Path $exePath)) {
    Write-Error "Toad.exe not found in extracted directory!"
    exit 1
}

Write-Host "Launching isolated Toad.exe..."
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $exePath
$psi.WorkingDirectory = $tempBase
$psi.UseShellExecute = $false
$proc = [System.Diagnostics.Process]::Start($psi)

$created = $false
$appDataDir = $null
$startupMs = 0

for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 50
    $subDirs = Get-ChildItem -Path $tempBase -Directory | Where-Object { $_.Name -like "toadAppData_*" }
    if ($subDirs.Count -gt 0) {
        $appDataDir = $subDirs[0].FullName
        $cfg = Join-Path $appDataDir "config.ini"
        $parquet = Join-Path $appDataDir "toad_ledger.parquet"
        if ((Test-Path $cfg) -and (Test-Path $parquet)) {
            $sw.Stop()
            $startupMs = $sw.ElapsedMilliseconds
            $created = $true
            break
        }
    }
}

Write-Host "Startup & environment creation took: $startupMs ms"

if ($created) {
    Write-Host "[PASS] Successfully created adjacent portable folder: $appDataDir"
    Write-Host " - config.ini size: $((Get-Item (Join-Path $appDataDir 'config.ini')).Length) bytes"
    Write-Host " - toad_ledger.parquet size: $((Get-Item (Join-Path $appDataDir 'toad_ledger.parquet')).Length) bytes"
    if ($startupMs -lt 300) {
        Write-Host "[PASS] Startup time $startupMs ms is << 300ms threshold!"
    } else {
        Write-Host "[WARN] Startup time $startupMs ms exceeded 300ms"
    }
} else {
    Write-Host "[FAIL] Portable appData and ledger were NOT created within timeout!"
}

# Cleanup process
try {
    if (-not $proc.HasExited) {
        $proc.Kill()
        $proc.WaitForExit(2000)
    }
} catch {}

# Cleanup temp dir
try {
    Start-Sleep -Milliseconds 500
    Remove-Item -Path $tempBase -Recurse -Force -ErrorAction SilentlyContinue
} catch {}
