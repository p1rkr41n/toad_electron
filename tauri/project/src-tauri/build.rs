//! Enhanced build.rs for Toad Tauri v2 backend
//!
//! Automatically ensures native libraries (comctl32.dll delay-loading, duckdb.lib search path,
//! and duckdb.dll runtime placement) are properly configured across all build profiles (debug and release).

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    tauri_build::build();

    // Delay-load comctl32.dll so that headless unit tests and CLI runs
    // do not fail with STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139) on Windows GNU toolchain.
    println!("cargo:rustc-link-arg=--delayload=comctl32.dll");

    copy_duckdb_dll();

    // Milestone 7 PE Resource Embedding:
    // Generate authentic COFF .rsrc object file with HelloKittyXamKinLung branding
    // and pass directly to rust-lld / GNU ld.
    embed_pe_resources();
}

/// Automatically locate duckdb.dll and copy it into the target profile directory
/// (e.g., target/debug, target/release) and its deps/ directory (e.g., target/debug/deps, target/release/deps)
/// so that both application binaries and cargo test runners execute cleanly on Windows without
/// STATUS_DLL_NOT_FOUND (0xc0000135).
fn copy_duckdb_dll() {
    // Only execute on Windows targets
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os != "windows" && !cfg!(target_os = "windows") {
        return;
    }

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".into()));
    let out_dir = match env::var("OUT_DIR") {
        Ok(val) => PathBuf::from(val),
        Err(_) => return,
    };

    // Inform cargo to link with native libraries in lib/ directory if present
    let lib_dir = manifest_dir.join("lib");
    if lib_dir.exists() {
        println!("cargo:rustc-link-search=native={}", lib_dir.display());
    }

    // Resolve target profile dir (e.g., target/debug or target/release) from OUT_DIR.
    // OUT_DIR is typically <target-dir>/[<target-triple>/]<profile>/build/<pkg-name>-<hash>/out
    let target_profile_dir = match out_dir
        .ancestors()
        .find(|p| p.file_name().map_or(false, |name| name == "build"))
        .and_then(|build_dir| build_dir.parent())
    {
        Some(dir) => dir.to_path_buf(),
        None => return,
    };

    let target_root = match target_profile_dir.parent() {
        Some(p) => p.to_path_buf(),
        None => return,
    };

    // Locate source duckdb.dll in candidate locations
    let mut candidate_sources: Vec<PathBuf> = Vec::new();

    if let Ok(env_dir) = env::var("DUCKDB_LIB_DIR") {
        candidate_sources.push(PathBuf::from(env_dir).join("duckdb.dll"));
    }

    candidate_sources.push(manifest_dir.join("lib").join("duckdb.dll"));
    candidate_sources.push(manifest_dir.join("duckdb.dll"));

    // Check build directories across profiles
    candidate_sources.push(target_root.join("debug").join("duckdb.dll"));
    candidate_sources.push(target_root.join("debug").join("deps").join("duckdb.dll"));
    candidate_sources.push(target_root.join("release").join("duckdb.dll"));
    candidate_sources.push(target_root.join("release").join("deps").join("duckdb.dll"));

    // Find the first valid existing source file
    let source_dll = candidate_sources.into_iter().find(|p| p.is_file());

    let source_dll = match source_dll {
        Some(src) => src,
        None => {
            println!("cargo:warning=duckdb.dll not found in candidate paths. Windows test executables may fail with STATUS_DLL_NOT_FOUND (0xc0000135).");
            return;
        }
    };

    println!("cargo:rerun-if-changed={}", source_dll.display());
    println!("cargo:rerun-if-env-changed=DUCKDB_LIB_DIR");

    // Collect all target directories where duckdb.dll is required
    let mut dest_dirs: Vec<PathBuf> = Vec::new();

    // 1. Current build profile root and its deps/ directory
    dest_dirs.push(target_profile_dir.clone());
    dest_dirs.push(target_profile_dir.join("deps"));

    // 2. Also populate sibling profiles (debug/release) if their directory exists
    for profile_name in &["debug", "release"] {
        let profile_dir = target_root.join(profile_name);
        if profile_dir.exists() {
            dest_dirs.push(profile_dir.clone());
            dest_dirs.push(profile_dir.join("deps"));
        }
    }

    // Deduplicate destination paths
    dest_dirs.sort();
    dest_dirs.dedup();

    for dest_dir in dest_dirs {
        let dest_file = dest_dir.join("duckdb.dll");
        if let Err(e) = copy_if_different(&source_dll, &dest_file) {
            println!(
                "cargo:warning=Failed to copy duckdb.dll to {}: {}",
                dest_file.display(),
                e
            );
        }
    }
}

/// Copies `from` to `to` only if `to` does not exist or has a different file size.
/// This prevents redundant disk I/O and Windows ERROR_SHARING_VIOLATION / ERROR_ACCESS_DENIED
/// if the DLL is currently loaded by an active process.
fn copy_if_different(from: &Path, to: &Path) -> std::io::Result<()> {
    if from == to {
        return Ok(());
    }

    if to.exists() {
        if let (Ok(src_meta), Ok(dst_meta)) = (from.metadata(), to.metadata()) {
            if src_meta.len() == dst_meta.len() && src_meta.len() > 0 {
                return Ok(());
            }
        }
    }

    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::copy(from, to)?;
    Ok(())
}

/// Generates an authentic AMD64 COFF object file containing .rsrc section with
/// Windows VersionInfo branding (HelloKittyXamKinLung) and instructs the linker to embed it.
fn embed_pe_resources() {
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os != "windows" && !cfg!(target_os = "windows") {
        return;
    }

    let out_dir = match env::var("OUT_DIR") {
        Ok(val) => PathBuf::from(val),
        Err(_) => return,
    };

    let resource_o = out_dir.join("resource.o");
    let libresource_a = out_dir.join("libresource.a");

    if let Err(e) = generate_resource_coff(&resource_o) {
        println!("cargo:warning=Failed to generate PE resource COFF: {}", e);
        return;
    }

    // Also overwrite libresource.a so that embed-resource's cargo:rustc-link-arg-bins links valid COFF
    let _ = fs::copy(&resource_o, &libresource_a);

    // Note: embed-resource in tauri_build already emits `cargo:rustc-link-arg-bins=<out_dir>/libresource.a`.
    // Emitting both would cause rust-lld "duplicate resource: type VERSIONINFO" error.
    // println!("cargo:rustc-link-arg={}", resource_o.display());
}

fn pad4(vec: &mut Vec<u8>) {
    while vec.len() % 4 != 0 {
        vec.push(0);
    }
}

fn make_string_entry(key: &str, val: &str) -> Vec<u8> {
    let key_u16: Vec<u16> = key.encode_utf16().chain(std::iter::once(0)).collect();
    let val_u16: Vec<u16> = val.encode_utf16().chain(std::iter::once(0)).collect();
    let val_wlen = val_u16.len() as u16;

    let mut entry = Vec::new();
    entry.extend_from_slice(&0u16.to_le_bytes()); // wLength placeholder
    entry.extend_from_slice(&val_wlen.to_le_bytes()); // wValueLength
    entry.extend_from_slice(&1u16.to_le_bytes()); // wType = 1 (text)
    for c in key_u16 {
        entry.extend_from_slice(&c.to_le_bytes());
    }
    pad4(&mut entry);
    for c in val_u16 {
        entry.extend_from_slice(&c.to_le_bytes());
    }
    pad4(&mut entry);
    let len = entry.len() as u16;
    entry[0..2].copy_from_slice(&len.to_le_bytes());
    entry
}

fn build_version_info() -> Vec<u8> {
    let strings = [
        ("CompanyName", "HelloKittyXamKinLung"),
        ("FileDescription", "Toad"),
        ("FileVersion", "2.5.2"),
        ("LegalCopyright", "Copyright © 2026 HelloKittyXamKinLung"),
        ("ProductName", "Toad"),
        ("ProductVersion", "2.5.2"),
    ];

    let mut str_entries = Vec::new();
    for (k, v) in &strings {
        str_entries.extend(make_string_entry(k, v));
    }

    // StringTable "000004b0" (language neutral 0000, codepage 04b0 = 1200 Unicode)
    let st_key: Vec<u16> = "000004b0\0".encode_utf16().collect();
    let mut st = Vec::new();
    st.extend_from_slice(&0u16.to_le_bytes()); // wLength
    st.extend_from_slice(&0u16.to_le_bytes()); // wValueLength
    st.extend_from_slice(&1u16.to_le_bytes()); // wType
    for c in st_key {
        st.extend_from_slice(&c.to_le_bytes());
    }
    pad4(&mut st);
    st.extend(str_entries);
    pad4(&mut st);
    let st_len = st.len() as u16;
    st[0..2].copy_from_slice(&st_len.to_le_bytes());

    // StringFileInfo
    let sfi_key: Vec<u16> = "StringFileInfo\0".encode_utf16().collect();
    let mut sfi = Vec::new();
    sfi.extend_from_slice(&0u16.to_le_bytes());
    sfi.extend_from_slice(&0u16.to_le_bytes());
    sfi.extend_from_slice(&1u16.to_le_bytes());
    for c in sfi_key {
        sfi.extend_from_slice(&c.to_le_bytes());
    }
    pad4(&mut sfi);
    sfi.extend(st);
    pad4(&mut sfi);
    let sfi_len = sfi.len() as u16;
    sfi[0..2].copy_from_slice(&sfi_len.to_le_bytes());

    // VarFileInfo
    let var_key: Vec<u16> = "Translation\0".encode_utf16().collect();
    let mut var = Vec::new();
    var.extend_from_slice(&0u16.to_le_bytes());
    var.extend_from_slice(&4u16.to_le_bytes()); // 4 bytes of value
    var.extend_from_slice(&0u16.to_le_bytes()); // wType = 0 (binary)
    for c in var_key {
        var.extend_from_slice(&c.to_le_bytes());
    }
    pad4(&mut var);
    var.extend_from_slice(&0x0000u16.to_le_bytes()); // lang neutral
    var.extend_from_slice(&0x04B0u16.to_le_bytes()); // 1200 Unicode
    pad4(&mut var);
    let var_len = var.len() as u16;
    var[0..2].copy_from_slice(&var_len.to_le_bytes());

    let vfi_key: Vec<u16> = "VarFileInfo\0".encode_utf16().collect();
    let mut vfi = Vec::new();
    vfi.extend_from_slice(&0u16.to_le_bytes());
    vfi.extend_from_slice(&0u16.to_le_bytes());
    vfi.extend_from_slice(&1u16.to_le_bytes());
    for c in vfi_key {
        vfi.extend_from_slice(&c.to_le_bytes());
    }
    pad4(&mut vfi);
    vfi.extend(var);
    pad4(&mut vfi);
    let vfi_len = vfi.len() as u16;
    vfi[0..2].copy_from_slice(&vfi_len.to_le_bytes());

    // VS_FIXEDFILEINFO (52 bytes)
    let file_ver_ms: u32 = (2 << 16) | 5;
    let file_ver_ls: u32 = (2 << 16) | 0;
    let prod_ver_ms: u32 = (2 << 16) | 5;
    let prod_ver_ls: u32 = (2 << 16) | 0;
    let mut ffi = Vec::new();
    ffi.extend_from_slice(&0xFEEF04BDu32.to_le_bytes()); // dwSignature
    ffi.extend_from_slice(&0x00010000u32.to_le_bytes()); // dwStrucVersion
    ffi.extend_from_slice(&file_ver_ms.to_le_bytes());
    ffi.extend_from_slice(&file_ver_ls.to_le_bytes());
    ffi.extend_from_slice(&prod_ver_ms.to_le_bytes());
    ffi.extend_from_slice(&prod_ver_ls.to_le_bytes());
    ffi.extend_from_slice(&0x0000003Fu32.to_le_bytes()); // dwFileFlagsMask
    ffi.extend_from_slice(&0x00000000u32.to_le_bytes()); // dwFileFlags
    ffi.extend_from_slice(&0x00040004u32.to_le_bytes()); // dwFileOS
    ffi.extend_from_slice(&0x00000001u32.to_le_bytes()); // dwFileType = VFT_APP
    ffi.extend_from_slice(&0x00000000u32.to_le_bytes()); // dwFileSubtype
    ffi.extend_from_slice(&0x00000000u32.to_le_bytes()); // dwFileDateMS
    ffi.extend_from_slice(&0x00000000u32.to_le_bytes()); // dwFileDateLS

    // Root VS_VERSIONINFO
    let root_key: Vec<u16> = "VS_VERSION_INFO\0".encode_utf16().collect();
    let mut root = Vec::new();
    root.extend_from_slice(&0u16.to_le_bytes());
    root.extend_from_slice(&(ffi.len() as u16).to_le_bytes());
    root.extend_from_slice(&0u16.to_le_bytes()); // wType = 0
    for c in root_key {
        root.extend_from_slice(&c.to_le_bytes());
    }
    pad4(&mut root);
    root.extend(ffi);
    root.extend(sfi);
    root.extend(vfi);
    pad4(&mut root);
    let root_len = root.len() as u16;
    root[0..2].copy_from_slice(&root_len.to_le_bytes());
    root
}

fn generate_resource_coff(dest_path: &Path) -> std::io::Result<()> {
    let mut raw_data = build_version_info();
    pad4(&mut raw_data);

    let mut rsrc = Vec::new();
    // Root directory: 16 bytes header + 1 entry (8 bytes) = 24 bytes
    rsrc.extend_from_slice(&[0u8; 12]);
    rsrc.extend_from_slice(&0u16.to_le_bytes()); // NamedEntries = 0
    rsrc.extend_from_slice(&1u16.to_le_bytes()); // IdEntries = 1
    // RT_VERSION = 16 (0x10), Subdirectory offset = 24
    rsrc.extend_from_slice(&16u32.to_le_bytes());
    rsrc.extend_from_slice(&(0x80000000u32 | 24).to_le_bytes());

    // Type directory (RT_VERSION): 16 bytes header + 1 entry (8 bytes) = 24 bytes (offset 24)
    rsrc.extend_from_slice(&[0u8; 12]);
    rsrc.extend_from_slice(&0u16.to_le_bytes());
    rsrc.extend_from_slice(&1u16.to_le_bytes());
    // ID 1, Subdirectory offset = 48
    rsrc.extend_from_slice(&1u32.to_le_bytes());
    rsrc.extend_from_slice(&(0x80000000u32 | 48).to_le_bytes());

    // Language directory (0): 16 bytes header + 1 entry (8 bytes) = 24 bytes (offset 48)
    rsrc.extend_from_slice(&[0u8; 12]);
    rsrc.extend_from_slice(&0u16.to_le_bytes());
    rsrc.extend_from_slice(&1u16.to_le_bytes());
    // Lang 0, Data entry offset = 72
    rsrc.extend_from_slice(&0u32.to_le_bytes());
    rsrc.extend_from_slice(&72u32.to_le_bytes());

    // Data entry (16 bytes, offset 72)
    // OffsetToData = 88, Size = raw_data.len(), CodePage = 0, Reserved = 0
    rsrc.extend_from_slice(&88u32.to_le_bytes());
    rsrc.extend_from_slice(&(raw_data.len() as u32).to_le_bytes());
    rsrc.extend_from_slice(&0u32.to_le_bytes());
    rsrc.extend_from_slice(&0u32.to_le_bytes());

    // Raw data (starts at offset 88)
    rsrc.extend(raw_data);
    pad4(&mut rsrc);

    let sec_data_offset: u32 = 60;
    let sec_data_len: u32 = rsrc.len() as u32;
    let reloc_offset: u32 = sec_data_offset + sec_data_len;
    let symtab_offset: u32 = reloc_offset + 10;

    let mut coff = Vec::new();
    // COFF Header (20 bytes)
    coff.extend_from_slice(&0x8664u16.to_le_bytes()); // Machine AMD64
    coff.extend_from_slice(&1u16.to_le_bytes());      // NumberOfSections = 1
    coff.extend_from_slice(&0u32.to_le_bytes());      // TimeDateStamp
    coff.extend_from_slice(&symtab_offset.to_le_bytes()); // PointerToSymbolTable
    coff.extend_from_slice(&1u32.to_le_bytes());      // NumberOfSymbols = 1
    coff.extend_from_slice(&0u16.to_le_bytes());      // SizeOfOptionalHeader = 0
    coff.extend_from_slice(&0u16.to_le_bytes());      // Characteristics = 0

    // Section Header (40 bytes)
    let mut sec_name = [0u8; 8];
    sec_name[..5].copy_from_slice(b".rsrc");
    coff.extend_from_slice(&sec_name);
    coff.extend_from_slice(&0u32.to_le_bytes());      // VirtualSize = 0
    coff.extend_from_slice(&0u32.to_le_bytes());      // VirtualAddress = 0
    coff.extend_from_slice(&sec_data_len.to_le_bytes()); // SizeOfRawData
    coff.extend_from_slice(&sec_data_offset.to_le_bytes()); // PointerToRawData
    coff.extend_from_slice(&reloc_offset.to_le_bytes());    // PointerToRelocations
    coff.extend_from_slice(&0u32.to_le_bytes());      // PointerToLinenumbers
    coff.extend_from_slice(&1u16.to_le_bytes());      // NumberOfRelocations = 1
    coff.extend_from_slice(&0u16.to_le_bytes());      // NumberOfLinenumbers = 0
    coff.extend_from_slice(&0x40000040u32.to_le_bytes()); // Characteristics (INITIALIZED_DATA | READ)

    // Section Data
    coff.extend(rsrc);

    // Relocation (10 bytes)
    // VirtualAddress = 72 (offset to OffsetToData inside .rsrc section)
    // SymbolTableIndex = 0 (.rsrc symbol)
    // Type = 3 (IMAGE_REL_AMD64_ADDR32NB)
    coff.extend_from_slice(&72u32.to_le_bytes());
    coff.extend_from_slice(&0u32.to_le_bytes());
    coff.extend_from_slice(&3u16.to_le_bytes());

    // Symbol Table (18 bytes)
    coff.extend_from_slice(&sec_name);
    coff.extend_from_slice(&0u32.to_le_bytes());      // Value = 0
    coff.extend_from_slice(&1i16.to_le_bytes());      // SectionNumber = 1
    coff.extend_from_slice(&0u16.to_le_bytes());      // Type = 0
    coff.push(3u8);                                   // StorageClass = IMAGE_SYM_CLASS_STATIC
    coff.push(0u8);                                   // NumberOfAuxSymbols = 0

    // String Table Header (4 bytes minimum = size 4)
    coff.extend_from_slice(&4u32.to_le_bytes());

    fs::write(dest_path, coff)?;
    Ok(())
}

