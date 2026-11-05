import struct
from test_version_info import build_version_info

def generate_resource_coff(output_path):
    raw_data = build_version_info()
    
    # Pad raw data to 4 bytes
    pad = (4 - (len(raw_data) % 4)) % 4
    raw_data += b'\x00' * pad
    
    # 3-level resource directory:
    # Root dir: 16 bytes + 1 entry (8 bytes) = 24 bytes
    # Type dir (RT_VERSION): 16 bytes + 1 entry (8 bytes) = 24 bytes (offset 24)
    # Lang dir (0): 16 bytes + 1 entry (8 bytes) = 24 bytes (offset 48)
    # Data entry: 16 bytes (offset 72)
    # Raw data starts at offset 88
    
    root_dir = struct.pack('<IIHHHH', 0, 0, 0, 0, 0, 1)
    # RT_VERSION = 16 (0x0010). Subdirectory at offset 24
    root_entry = struct.pack('<II', 16, 0x80000000 | 24)
    
    type_dir = struct.pack('<IIHHHH', 0, 0, 0, 0, 0, 1)
    # Resource ID 1. Subdirectory at offset 48
    type_entry = struct.pack('<II', 1, 0x80000000 | 48)
    
    lang_dir = struct.pack('<IIHHHH', 0, 0, 0, 0, 0, 1)
    # Language 0. Data entry at offset 72
    lang_entry = struct.pack('<II', 0, 72)
    
    # Data entry at offset 72:
    # OffsetToData = 88 (relocated to .rsrc section start + 88)
    data_entry = struct.pack('<IIII', 88, len(raw_data), 0, 0)
    
    rsrc_section_data = root_dir + root_entry + type_dir + type_entry + lang_dir + lang_entry + data_entry + raw_data
    
    # Pad section data to 4 bytes
    pad_sec = (4 - (len(rsrc_section_data) % 4)) % 4
    rsrc_section_data += b'\x00' * pad_sec
    
    sec_data_offset = 60
    sec_data_len = len(rsrc_section_data)
    reloc_offset = sec_data_offset + sec_data_len
    symtab_offset = reloc_offset + 10
    
    # COFF Header (20 bytes)
    # Machine = 0x8664 (AMD64), NumberOfSections = 1, TimeDateStamp = 0
    # PointerToSymbolTable = symtab_offset, NumberOfSymbols = 1, SizeOfOptionalHeader = 0, Characteristics = 0
    coff_header = struct.pack('<HHIIIHH', 0x8664, 1, 0, symtab_offset, 1, 0, 0)
    
    # Section Header (40 bytes)
    # Name = .rsrc (8 bytes)
    # Characteristics = 0x40000040 (IMAGE_SCN_CNT_INITIALIZED_DATA | IMAGE_SCN_MEM_READ)
    sec_header = struct.pack(
        '<8sIIIIIIHHI',
        b'.rsrc\x00\x00\x00',
        0, 0, sec_data_len,
        sec_data_offset, reloc_offset, 0,
        1, 0,
        0x40000040
    )
    
    # Relocation (10 bytes)
    # VirtualAddress = 72 (offset to OffsetToData inside .rsrc section)
    # SymbolTableIndex = 0 (points to .rsrc symbol)
    # Type = 3 (IMAGE_REL_AMD64_ADDR32NB = 32-bit RVA without base)
    reloc = struct.pack('<IIH', 72, 0, 3)
    
    # Symbol Table (18 bytes)
    # Name = .rsrc (8 bytes)
    # Value = 0, SectionNumber = 1, Type = 0, StorageClass = 3 (IMAGE_SYM_CLASS_STATIC), NumberOfAuxSymbols = 0
    sym = struct.pack('<8sIhHBB', b'.rsrc\x00\x00\x00', 0, 1, 0, 3, 0)
    
    # String Table Header (4 bytes minimum = size 4 if no long symbol names)
    strtab = struct.pack('<I', 4)
    
    full_coff = coff_header + sec_header + rsrc_section_data + reloc + sym + strtab
    with open(output_path, 'wb') as f:
        f.write(full_coff)
    print(f"Generated {output_path}: {len(full_coff)} bytes")

generate_resource_coff(r"D:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m7_fix_1\test_resource.o")
