Write-Host "=== VERIFYING RELEASE ARTIFACTS AND SHA256 ==="

$exePath = "d:\Shared_UserData\Downloads\tad\releases\Toad-2.5.2-x64-portable.exe"
$zipPath = "d:\Shared_UserData\Downloads\tad\releases\Toad-2.5.2-x64-portable.zip"
$rootExe = "d:\Shared_UserData\Downloads\tad\Toad.exe"

$exeHash = (Get-FileHash -Algorithm SHA256 $exePath).Hash.ToLower()
$zipHash = (Get-FileHash -Algorithm SHA256 $zipPath).Hash.ToLower()
$rootHash = (Get-FileHash -Algorithm SHA256 $rootExe).Hash.ToLower()

Write-Host "releases/Toad-2.5.2-x64-portable.exe SHA256: $exeHash (Size: $((Get-Item $exePath).Length) bytes)"
Write-Host "releases/Toad-2.5.2-x64-portable.zip SHA256: $zipHash (Size: $((Get-Item $zipPath).Length) bytes)"
Write-Host "root Toad.exe SHA256:                         $rootHash (Size: $((Get-Item $rootExe).Length) bytes)"

$expectedExeHash = "e31dd642fd5cbac737a4517e7b66e365c2c38673a9792ca31f0ddd730090162a"
$expectedZipHash = "d675f3e00b4dbbde55696adcbe11711d0a4cd1f5776f5633dab3397959c091ba"

if ($exeHash -eq $expectedExeHash) {
    Write-Host "[PASS] Exe SHA256 matches SHA256SUMS.txt"
} else {
    Write-Host "[FAIL] Exe SHA256 does NOT match!"
}

if ($zipHash -eq $expectedZipHash) {
    Write-Host "[PASS] Zip SHA256 matches SHA256SUMS.txt"
} else {
    Write-Host "[FAIL] Zip SHA256 does NOT match!"
}

if ($rootHash -eq $exeHash) {
    Write-Host "[PASS] Root Toad.exe is identical to portable release exe"
} else {
    Write-Host "[FAIL] Root Toad.exe differs from portable release exe!"
}

Write-Host "`n=== INSPECTING ZIP ARCHIVE CONTENTS ==="
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$entries = $zip.Entries | Select-Object -ExpandProperty FullName
Write-Host "Files in zip:"
foreach ($e in $entries) {
    Write-Host " - $e"
}
$zip.Dispose()

$required = @("Toad.exe", "Toad-2.5.2-x64-portable.exe", "duckdb.dll", "WebView2Loader.dll")
foreach ($r in $required) {
    if ($entries -contains $r) {
        Write-Host "[PASS] Zip contains $r"
    } else {
        Write-Host "[FAIL] Zip missing required file: $r"
    }
}

Write-Host "`n=== SCANNING FOR DUPLICATE HISTORICAL BINARIES ==="
$allExes = Get-ChildItem -Path "d:\Shared_UserData\Downloads\tad" -Recurse -Filter "*.exe" -File -ErrorAction SilentlyContinue |
    Where-Object { 
        $_.FullName -notmatch '\\(target|node_modules|\.git|\.jj|\.gemini)\\' -and
        $_.FullName -notmatch '\\node-v18' -and
        $_.FullName -notmatch '\\tools\\jj\\'
    }

Write-Host "Found executable files:"
foreach ($x in $allExes) {
    Write-Host " - $($x.FullName) ($($x.Length) bytes)"
}

$historical = $allExes | Where-Object { $_.Name -match 'Toad\s*2\.[0-4]\..*\.exe' -or $_.Name -match 'Toad-2\.[0-4]\..*\.exe' }
if ($historical.Count -eq 0) {
    Write-Host "[PASS] Zero duplicate historical version binaries found!"
} else {
    Write-Host "[FAIL] Found historical version binaries: $($historical.Count)"
}
