# Minimal COFF .rsrc generator test
import struct

def build_version_info():
    # String entries
    strings = [
        ("CompanyName", "HelloKittyXamKinLung"),
        ("FileDescription", "Toad"),
        ("FileVersion", "2.5.2"),
        ("LegalCopyright", "Copyright © 2026 HelloKittyXamKinLung"),
        ("ProductName", "Toad"),
        ("ProductVersion", "2.5.2"),
    ]
    
    def pad4(b):
        pad = (4 - (len(b) % 4)) % 4
        return b + b'\x00' * pad

    def make_string_entry(key, val):
        key_utf16 = (key + '\0').encode('utf-16le')
        val_utf16 = (val + '\0').encode('utf-16le')
        val_wlen = len(val) + 1  # in UTF-16 characters
        header = struct.pack('<HHH', 0, val_wlen, 1) + key_utf16
        entry = pad4(header) + val_utf16
        entry = pad4(entry)
        entry = struct.pack('<H', len(entry)) + entry[2:]
        return entry

    str_entries_data = b''.join(make_string_entry(k, v) for k, v in strings)
    
    # StringTable "000004b0" (language neutral 0000, codepage 04b0 = 1200 Unicode)
    st_key = "000004b0\0".encode('utf-16le')
    st_header = struct.pack('<HHH', 0, 0, 1) + st_key
    st_data = pad4(st_header) + str_entries_data
    st_data = pad4(st_data)
    st_data = struct.pack('<H', len(st_data)) + st_data[2:]
    
    # StringFileInfo
    sfi_key = "StringFileInfo\0".encode('utf-16le')
    sfi_header = struct.pack('<HHH', 0, 0, 1) + sfi_key
    sfi_data = pad4(sfi_header) + st_data
    sfi_data = pad4(sfi_data)
    sfi_data = struct.pack('<H', len(sfi_data)) + sfi_data[2:]
    
    # VarFileInfo with Translation: 0x0000, 0x04b0
    var_key = "Translation\0".encode('utf-16le')
    var_val = struct.pack('<HH', 0x0000, 0x04B0)
    var_header = struct.pack('<HHH', 0, len(var_val), 0) + var_key
    var_data = pad4(var_header) + var_val
    var_data = pad4(var_data)
    var_data = struct.pack('<H', len(var_data)) + var_data[2:]
    
    vfi_key = "VarFileInfo\0".encode('utf-16le')
    vfi_header = struct.pack('<HHH', 0, 0, 1) + vfi_key
    vfi_data = pad4(vfi_header) + var_data
    vfi_data = pad4(vfi_data)
    vfi_data = struct.pack('<H', len(vfi_data)) + vfi_data[2:]
    
    # VS_FIXEDFILEINFO (52 bytes)
    # major=2, minor=5, patch=2, build=0
    file_ver_ms = (2 << 16) | 5
    file_ver_ls = (2 << 16) | 0
    prod_ver_ms = (2 << 16) | 5
    prod_ver_ls = (2 << 16) | 0
    ffi = struct.pack(
        '<IIIIIIIIIIIII',
        0xFEEF04BD, # dwSignature
        0x00010000, # dwStrucVersion
        file_ver_ms, file_ver_ls,
        prod_ver_ms, prod_ver_ls,
        0x0000003F, # dwFileFlagsMask
        0x00000000, # dwFileFlags
        0x00040004, # dwFileOS (VOS_NT_WINDOWS32)
        0x00000001, # dwFileType (VFT_APP)
        0x00000000, # dwFileSubtype
        0x00000000, # dwFileDateMS
        0x00000000, # dwFileDateLS
    )
    
    # Root VS_VERSIONINFO
    root_key = "VS_VERSION_INFO\0".encode('utf-16le')
    root_header = struct.pack('<HHH', 0, len(ffi), 0) + root_key
    root_data = pad4(root_header) + ffi + sfi_data + vfi_data
    root_data = pad4(root_data)
    root_data = struct.pack('<H', len(root_data)) + root_data[2:]
    return root_data

print("Version info length:", len(build_version_info()))
