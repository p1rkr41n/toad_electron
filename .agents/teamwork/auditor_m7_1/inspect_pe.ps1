function Inspect-PE([string]$filePath) {
    $vi = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($filePath)
    
    $fs = [System.IO.File]::OpenRead($filePath)
    $br = New-Object System.IO.BinaryReader($fs)
    $fs.Seek(0x3C, [System.IO.SeekOrigin]::Begin) | Out-Null
    $peOffset = $br.ReadInt32()
    $fs.Seek($peOffset, [System.IO.SeekOrigin]::Begin) | Out-Null
    $peSig = $br.ReadUInt32() # 0x00004550 'PE\0\0'
    $machine = $br.ReadUInt16()
    $numSections = $br.ReadUInt16()
    $timeDateStamp = $br.ReadUInt32()
    $ptrSymTable = $br.ReadUInt32()
    $numSymbols = $br.ReadUInt32()
    $sizeOptHeader = $br.ReadUInt16()
    $characteristics = $br.ReadUInt16()
    
    # Optional Header
    $magic = $br.ReadUInt16() # 0x020B for PE32+ (x64) or 0x010B for PE32
    # For PE32+ (64-bit), Subsystem is at offset 68 in Optional Header
    $fs.Seek($peOffset + 24 + 68, [System.IO.SeekOrigin]::Begin) | Out-Null
    $subsystem = $br.ReadUInt16()
    $br.Close()
    $fs.Close()
    
    [PSCustomObject]@{
        Path = $filePath
        FileDescription = $vi.FileDescription
        ProductName = $vi.ProductName
        ProductVersion = $vi.ProductVersion
        FileVersion = $vi.FileVersion
        CompanyName = $vi.CompanyName
        LegalCopyright = $vi.LegalCopyright
        PE_Magic = '0x{0:X4}' -f $magic
        Subsystem = $subsystem
        SubsystemName = switch ($subsystem) { 1 {'NATIVE'} 2 {'WINDOWS_GUI'} 3 {'WINDOWS_CUI'} default {'UNKNOWN'} }
    }
}

Inspect-PE 'D:\Shared_UserData\Downloads\tad\Toad.exe' | Format-List
Inspect-PE 'D:\Shared_UserData\Downloads\tad\releases\Toad-2.5.2-x64-portable.exe' | Format-List
Inspect-PE 'D:\Shared_UserData\Downloads\tad\tauri\project\releases\Toad-2.5.2-x64-portable.exe' | Format-List
Inspect-PE 'D:\Shared_UserData\Downloads\tad\tauri\project\src-tauri\target\release\toad.exe' | Format-List

$bytes = [System.IO.File]::ReadAllBytes('D:\Shared_UserData\Downloads\tad\Toad.exe')
$textUtf8 = [System.Text.Encoding]::UTF8.GetString($bytes)
$idxUtf8 = $textUtf8.IndexOf('HelloKittyXamKinLung')
Write-Host "UTF-8 index: $idxUtf8"

$textUni = [System.Text.Encoding]::Unicode.GetString($bytes)
$idxUni = $textUni.IndexOf('HelloKittyXamKinLung')
Write-Host "Unicode index: $idxUni"
