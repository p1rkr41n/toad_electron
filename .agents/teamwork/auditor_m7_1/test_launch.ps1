$p = Start-Process -FilePath "D:\Shared_UserData\Downloads\tad\Toad.exe" -PassThru
Start-Sleep -Seconds 2
$exited = $p.HasExited
$pidVal = $p.Id
Write-Host "Process ID: $pidVal, Exited: $exited"
if (-not $exited) {
    Stop-Process -Id $pidVal -Force
    Write-Host "Process stopped successfully."
}

$dirs = Get-ChildItem -Path "D:\Shared_UserData\Downloads\tad" -Directory -Filter "toadAppData_*" | Sort-Object LastWriteTime -Descending | Select-Object -First 2
foreach ($d in $dirs) {
    Write-Host "Portable AppData Dir: $($d.FullName), LastWriteTime: $($d.LastWriteTime)"
    Get-ChildItem -Path $d.FullName | Select-Object Name, Length | Format-Table -AutoSize | Out-String | Write-Host
}
