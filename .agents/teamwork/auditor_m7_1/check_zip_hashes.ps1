Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead('D:\Shared_UserData\Downloads\tad\releases\Toad-2.5.2-x64-portable.zip')
$sha = [System.Security.Cryptography.SHA256]::Create()
foreach ($entry in $zip.Entries) {
    $s = $entry.Open()
    $hashBytes = $sha.ComputeHash($s)
    $s.Close()
    $h = [BitConverter]::ToString($hashBytes).Replace('-', '')
    Write-Host "Zip entry: $($entry.FullName), Size: $($entry.Length), SHA256: $h"
}
$zip.Dispose()
