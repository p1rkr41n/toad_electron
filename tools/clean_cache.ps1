Write-Output "=== CLEANUP PHASE 1: Pruning old release binaries and historical folders ==="
$oldBins = @(
    "releases\Toad-2.3.5-x64-portable.exe",
    "releases\Toad-2.3.5-x64-portable.zip",
    "releases\Toad-2.4.8.1-x64-portable.exe",
    "releases\Toad-2.4.8.1-x64-portable.zip"
)
foreach ($b in $oldBins) {
    if (Test-Path $b) {
        Write-Output "Removing old binary: $b"
        Remove-Item -Path $b -Force -ErrorAction SilentlyContinue
    }
}

$oldFolders = Get-ChildItem -Directory -Path releases -Filter "v*" -ErrorAction SilentlyContinue
foreach ($f in $oldFolders) {
    Write-Output "Removing historical release folder: $($f.FullName)"
    Remove-Item -Path $f.FullName -Recurse -Force -ErrorAction SilentlyContinue
}

Get-ChildItem -Directory -Path releases -Filter "toadAppData_*" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Output "Removing temporary test profile folder: $($_.FullName)"
    Remove-Item -Path $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Output "=== CLEANUP PHASE 2: Pruning build/ directory (7.6 GB) ==="
if (Test-Path "build") {
    Get-ChildItem -Path build -Force | ForEach-Object {
        Write-Output "Removing build cache: $($_.FullName)"
        Remove-Item -Path $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Output "=== CLEANUP PHASE 3: Pruning toad-app release/ unpacked cache (350 MB) ==="
if (Test-Path "tad-master\packages\toad-app\release\win-unpacked") {
    Write-Output "Removing toad-app win-unpacked cache..."
    Remove-Item -Path "tad-master\packages\toad-app\release\win-unpacked" -Recurse -Force -ErrorAction SilentlyContinue
}
if (Test-Path "tad-master\packages\toad-app\release\Toad 2.5.1.exe") {
    Write-Output "Removing intermediate toad-app release\Toad 2.5.1.exe..."
    Remove-Item -Path "tad-master\packages\toad-app\release\Toad 2.5.1.exe" -Force -ErrorAction SilentlyContinue
}

Write-Output "=== CLEANUP PHASE 4: Pruning scratch/ temporary test files ==="
if (Test-Path "scratch") {
    Get-ChildItem -Path scratch -Filter "test_*" | Remove-Item -Force -ErrorAction SilentlyContinue
    Get-ChildItem -Path scratch -Filter "*.parquet" | Remove-Item -Force -ErrorAction SilentlyContinue
    Get-ChildItem -Path scratch -Filter "*.js" | Remove-Item -Force -ErrorAction SilentlyContinue
}

Write-Output "=== CLEANUP COMPLETED SUCCESSFULLY ==="
