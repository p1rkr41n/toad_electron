$fs = [System.IO.File]::OpenRead('D:\Shared_UserData\Downloads\tad\Toad.exe')
$br = New-Object System.IO.BinaryReader($fs)
$fs.Seek(0x3C, [System.IO.SeekOrigin]::Begin) | Out-Null
$peOffset = $br.ReadInt32()
$fs.Seek($peOffset + 4, [System.IO.SeekOrigin]::Begin) | Out-Null
$machine = $br.ReadUInt16()
$numSections = $br.ReadUInt16()
$fs.Seek($peOffset + 20, [System.IO.SeekOrigin]::Begin) | Out-Null
$sizeOptHeader = $br.ReadUInt16()
$fs.Seek($peOffset + 24 + $sizeOptHeader, [System.IO.SeekOrigin]::Begin) | Out-Null

Write-Host "Number of sections: $numSections"
for ($i = 0; $i -lt $numSections; $i++) {
    $secNameBytes = $br.ReadBytes(8)
    $secName = [System.Text.Encoding]::ASCII.GetString($secNameBytes).Trim([char]0)
    $virtSize = $br.ReadUInt32()
    $virtAddr = $br.ReadUInt32()
    $rawSize = $br.ReadUInt32()
    $rawAddr = $br.ReadUInt32()
    $fs.Seek(16, [System.IO.SeekOrigin]::Current) | Out-Null # skip relocs, line nums, flags
    Write-Host "Section: $secName, VirtAddr: 0x$($virtAddr.ToString('X')), RawSize: $rawSize, RawAddr: 0x$($rawAddr.ToString('X'))"
}
$br.Close()
$fs.Close()
