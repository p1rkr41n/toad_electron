import struct
from test_version_info import build_version_info

def generate_res_file(output_path):
    # Empty initial entry (32 bytes)
    empty_header = struct.pack('<IIHH', 0, 32, 0xFFFF, 0) + b'\x00' * 20
    
    raw_data = build_version_info()
    data_size = len(raw_data)
    
    # RT_VERSION = 16 (0x0010), ID = 1
    type_bytes = struct.pack('<HH', 0xFFFF, 16)
    name_bytes = struct.pack('<HH', 0xFFFF, 1)
    
    # Header fields after Type and Name:
    # DataVersion (4), MemoryFlags (2), LanguageId (2), Version (4), Characteristics (4) = 16 bytes
    header_fields = struct.pack('<IHHI', 0, 0x0030, 0, 0) + struct.pack('<I', 0)
    
    header_size = 8 + len(type_bytes) + len(name_bytes) + len(header_fields)
    header = struct.pack('<II', data_size, header_size) + type_bytes + name_bytes + header_fields
    
    # Pad data to 4 bytes
    pad = (4 - (data_size % 4)) % 4
    padded_data = raw_data + b'\x00' * pad
    
    res_bytes = empty_header + header + padded_data
    with open(output_path, 'wb') as f:
        f.write(res_bytes)
    print(f"Generated {output_path}: {len(res_bytes)} bytes")

generate_res_file(r"D:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m7_fix_1\test_version.res")
