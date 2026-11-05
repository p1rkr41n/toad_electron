$bytes = [System.IO.File]::ReadAllBytes('D:\Shared_UserData\Downloads\tad\Toad.exe')
$idx = 12178359
$text = [System.Text.Encoding]::UTF8.GetString($bytes)
Write-Host "Substring exactly at idx:"
Write-Host "'$($text.Substring($idx, 40))'"
