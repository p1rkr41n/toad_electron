$files = @(
    "D:\Shared_UserData\Downloads\tad\Toad.exe",
    "D:\Shared_UserData\Downloads\tad\releases\Toad-2.5.2-x64-portable.exe"
)

foreach ($f in $files) {
    Write-Host "=========================================="
    Write-Host "Checking: $f"
    if (-not (Test-Path $f)) {
        Write-Error "File not found: $f"
        continue
    }
    $item = Get-Item $f
    Write-Host "File Size: $($item.Length) bytes"

    # 1. FileVersionInfo
    $vi = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($f)
    Write-Host "CompanyName:     $($vi.CompanyName)"
    Write-Host "LegalCopyright:  $($vi.LegalCopyright)"
    Write-Host "ProductVersion:  $($vi.ProductVersion)"
    Write-Host "FileVersion:     $($vi.FileVersion)"
    Write-Host "ProductName:     $($vi.ProductName)"
    Write-Host "FileDescription: $($vi.FileDescription)"

    # 2. Parse PE Header Sections
    $bytes = [System.IO.File]::ReadAllBytes($f)
    $peOffset = [System.BitConverter]::ToInt32($bytes, 0x3C)
    $magic = [System.BitConverter]::ToUInt16($bytes, $peOffset + 4 + 20)
    $numSections = [System.BitConverter]::ToUInt16($bytes, $peOffset + 4 + 2)
    $optHeaderSize = [System.BitConverter]::ToUInt16($bytes, $peOffset + 4 + 16)
    $subsystem = [System.BitConverter]::ToUInt16($bytes, $peOffset + 4 + 20 + 68)

    Write-Host "PE Offset:       0x$($peOffset.ToString('X'))"
    Write-Host "PE Magic:        0x$($magic.ToString('X4')) ($([string]$(if ($magic -eq 0x020B) {'PE32+ 64-bit'} elseif ($magic -eq 0x010B) {'PE32 32-bit'} else {'Unknown'})))"
    Write-Host "Subsystem:       $subsystem ($([string]$(if ($subsystem -eq 2) {'WINDOWS_GUI'} elseif ($subsystem -eq 3) {'WINDOWS_CUI'} else {'Other'})))"
    Write-Host "Number Sections: $numSections"

    $sectionTableStart = $peOffset + 4 + 20 + $optHeaderSize
    $rsrcFound = $false
    for ($i = 0; $i -lt $numSections; $i++) {
        $secOffset = $sectionTableStart + ($i * 40)
        $secNameBytes = $bytes[$secOffset..($secOffset + 7)] | Where-Object { $_ -ne 0 }
        $secName = [System.Text.Encoding]::ASCII.GetString($secNameBytes)
        $virtSize = [System.BitConverter]::ToUInt32($bytes, $secOffset + 8)
        $virtAddr = [System.BitConverter]::ToUInt32($bytes, $secOffset + 12)
        $rawSize = [System.BitConverter]::ToUInt32($bytes, $secOffset + 16)
        $rawAddr = [System.BitConverter]::ToUInt32($bytes, $secOffset + 20)

        Write-Host ("  Section: {0,-8} VirtSize: 0x{1,-8:X} VirtAddr: 0x{2,-8:X} RawSize: {3,-8} RawAddr: 0x{4,-8:X}" -f $secName, $virtSize, $virtAddr, $rawSize, $rawAddr)
        if ($secName -eq ".rsrc") {
            $rsrcFound = $true
            if ($rawSize -gt 0) {
                Write-Host "  -> [PASS] .rsrc section physically present with RawSize = $rawSize bytes" -ForegroundColor Green
            } else {
                Write-Host "  -> [FAIL] .rsrc section RawSize is 0!" -ForegroundColor Red
            }
        }
    }
    if (-not $rsrcFound) {
        Write-Host "  -> [FAIL] No .rsrc section found!" -ForegroundColor Red
    }
}
