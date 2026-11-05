$dlls = @(
    "D:\Shared_UserData\Downloads\tad\WebView2Loader.dll",
    "D:\Shared_UserData\Downloads\tad\releases\WebView2Loader.dll",
    "D:\Shared_UserData\Downloads\tad\tauri\project\releases\WebView2Loader.dll",
    "D:\Shared_UserData\Downloads\tad\duckdb.dll",
    "D:\Shared_UserData\Downloads\tad\releases\duckdb.dll",
    "D:\Shared_UserData\Downloads\tad\tauri\project\releases\duckdb.dll"
)

foreach ($d in $dlls) {
    if (Test-Path $d) {
        $item = Get-Item $d
        $hash = (Get-FileHash -Path $d -Algorithm SHA256).Hash
        $vi = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($d)
        Write-Host "File: $d"
        Write-Host "  Size: $($item.Length) bytes"
        Write-Host "  SHA256: $hash"
        Write-Host "  FileVersion: $($vi.FileVersion), Product: $($vi.ProductName), Company: $($vi.CompanyName)"
    } else {
        Write-Host "File MISSING: $d"
    }
}
