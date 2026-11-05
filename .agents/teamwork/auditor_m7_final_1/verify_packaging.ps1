# Verification of Packaging, Companion DLLs, and SHA256SUMS

Write-Host "=== 1. Checking Releases Directory ==="
$releasesDir = "D:\Shared_UserData\Downloads\tad\releases"
Get-ChildItem $releasesDir | ForEach-Object {
    Write-Host ("  {0,-35} Size: {1,12:N0} bytes" -f $_.Name, $_.Length)
}

Write-Host "`n=== 2. Checking Canonical Executables and DLLs ==="
$filesToCheck = @(
    "D:\Shared_UserData\Downloads\tad\Toad.exe",
    "D:\Shared_UserData\Downloads\tad\duckdb.dll",
    "D:\Shared_UserData\Downloads\tad\WebView2Loader.dll",
    "D:\Shared_UserData\Downloads\tad\releases\Toad-2.5.2-x64-portable.exe",
    "D:\Shared_UserData\Downloads\tad\releases\Toad-2.5.2-x64-portable.zip"
)

foreach ($f in $filesToCheck) {
    if (Test-Path $f) {
        $item = Get-Item $f
        $hash = (Get-FileHash -Algorithm SHA256 $f).Hash.ToLower()
        Write-Host ("  {0,-40} Size: {1,10:N0} B  SHA256: {2}" -f $item.Name, $item.Length, $hash)
    } else {
        Write-Host "  MISSING: $f" -ForegroundColor Red
    }
}

Write-Host "`n=== 3. Checking SHA256SUMS.txt Content ==="
$sumsFile = "D:\Shared_UserData\Downloads\tad\releases\SHA256SUMS.txt"
if (Test-Path $sumsFile) {
    Get-Content $sumsFile | ForEach-Object { Write-Host "  $_" }
}

Write-Host "`n=== 4. Checking Duplicate Historical Binaries ==="
$dups = Get-ChildItem -Path "D:\Shared_UserData\Downloads\tad" -Recurse -Filter "*.exe" | Where-Object {
    $_.FullName -notmatch "node-v18" -and
    $_.FullName -notmatch "target" -and
    $_.FullName -notmatch "tools\\jj" -and
    $_.FullName -notmatch "\\Toad\.exe$" -and
    $_.FullName -notmatch "releases\\Toad-2\.5\.2-x64-portable\.exe$"
}
if ($dups.Count -eq 0) {
    Write-Host "  [PASS] Zero duplicate historical binaries found across entire workspace!" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] Found duplicate binaries:" -ForegroundColor Red
    $dups | ForEach-Object { Write-Host "    $($_.FullName)" }
}
