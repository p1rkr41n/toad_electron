param([string]$FilePath)

if (-not (Test-Path $FilePath)) {
    Write-Error "File not found: $FilePath"
    exit 1
}

$bytes = [System.IO.File]::ReadAllBytes($FilePath)
Write-Host "=========================================="
Write-Host "Checking: $FilePath"
Write-Host "File Size: $($bytes.Length) bytes"

# Check DOS header
if ($bytes[0] -ne 0x4D -or $bytes[1] -ne 0x5A) {
    Write-Error "Not a valid DOS executable (missing MZ)"
    exit 1
}

# e_lfanew at 0x3C (4 bytes LE)
$peOffset = [BitConverter]::ToInt32($bytes, 0x3C)
Write-Host "PE Offset: 0x$($peOffset.ToString('X'))"

# Check PE signature "PE\0\0"
if ($bytes[$peOffset] -ne 0x50 -or $bytes[$peOffset+1] -ne 0x45 -or $bytes[$peOffset+2] -ne 0 -or $bytes[$peOffset+3] -ne 0) {
    Write-Error "Invalid PE signature"
    exit 1
}

$numSections = [BitConverter]::ToUInt16($bytes, $peOffset + 6)
$optHeaderSize = [BitConverter]::ToUInt16($bytes, $peOffset + 20)
$optHeaderOffset = $peOffset + 24
$magic = [BitConverter]::ToUInt16($bytes, $optHeaderOffset)
Write-Host "PE Magic: 0x$($magic.ToString('X4')) $(if ($magic -eq 0x20B) {'(PE32+ 64-bit)'} else {'(PE32 32-bit)'})"

$subsystem = [BitConverter]::ToUInt16($bytes, $optHeaderOffset + 68)
Write-Host "Subsystem: $subsystem $(if ($subsystem -eq 2) {'(WINDOWS_GUI)'} elseif ($subsystem -eq 3) {'(WINDOWS_CUI)'} else {'(OTHER)'})"

Write-Host "Number Sections: $numSections"

$sectionTableOffset = $optHeaderOffset + $optHeaderSize
$rsrcFound = $false
for ($i = 0; $i -lt $numSections; $i++) {
    $secOffset = $sectionTableOffset + ($i * 40)
    $nameBytes = $bytes[$secOffset..($secOffset + 7)]
    $name = [System.Text.Encoding]::ASCII.GetString($nameBytes).Trim([char]0)
    $virtSize = [BitConverter]::ToUInt32($bytes, $secOffset + 8)
    $virtAddr = [BitConverter]::ToUInt32($bytes, $secOffset + 12)
    $rawSize = [BitConverter]::ToUInt32($bytes, $secOffset + 16)
    $rawAddr = [BitConverter]::ToUInt32($bytes, $secOffset + 20)
    
    Write-Host ("  Section: {0,-8} VirtSize: 0x{1,-8:X} VirtAddr: 0x{2,-8:X} RawSize: {3,-8} RawAddr: 0x{4,-8:X}" -f $name, $virtSize, $virtAddr, $rawSize, $rawAddr)
    
    if ($name -eq ".rsrc") {
        $rsrcFound = $true
        if ($rawSize -gt 0) {
            Write-Host "  -> [PASS] .rsrc section physically present with RawSize = $rawSize bytes"
        } else {
            Write-Host "  -> [FAIL] .rsrc section has RawSize == 0!"
        }
    }
}

if (-not $rsrcFound) {
    Write-Host "  -> [FAIL] No .rsrc section found in section table!"
}

# Also inspect FileVersionInfo
$fvi = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($FilePath)
Write-Host "FileVersionInfo:"
Write-Host "  CompanyName:     $($fvi.CompanyName)"
Write-Host "  LegalCopyright:  $($fvi.LegalCopyright)"
Write-Host "  ProductVersion:  $($fvi.ProductVersion)"
Write-Host "  FileVersion:     $($fvi.FileVersion)"
Write-Host "  ProductName:     $($fvi.ProductName)"
Write-Host "  FileDescription: $($fvi.FileDescription)"
