//! binary_guard.rs
//!
//! High-speed 8KB Binary Guard for TOAD Core Engine.
//! Inspects file magic bytes, Gzip compressed streams (.gz), UTF-16LE/BE text headers,
//! and rejects unauthorized binary executables/archives (PE, ELF, ZIP, null-byte blobs).

use crate::transcode::{detect_utf16_slice, read_up_to};
use flate2::read::MultiGzDecoder;
use std::fs::File;
use std::io::{BufReader, Error, ErrorKind, Read, Result as IoResult};
use std::path::Path;

pub const GUARD_BUFFER_SIZE: usize = 8192; // 8KB

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileFormatCategory {
    DelimitedText,   // CSV, TSV, TXT, LOG (UTF-8)
    JsonText,        // JSON, JSONL, NDJSON (UTF-8)
    GzipText,        // Gzip-compressed text (.csv.gz, .tsv.gz, .jsonl.gz, .log.gz)
    Utf16Text,       // UTF-16LE / UTF-16BE text
    Parquet,         // .parquet
    Sqlite,          // .sqlite
    DuckDb,          // .duckdb
    Evtx,            // .evtx
    ForbiddenBinary, // .exe, .dll, .bin, .zip... (BLOCKED)
}

impl FileFormatCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            FileFormatCategory::DelimitedText => "DelimitedText",
            FileFormatCategory::JsonText => "JsonText",
            FileFormatCategory::GzipText => "GzipText",
            FileFormatCategory::Utf16Text => "Utf16Text",
            FileFormatCategory::Parquet => "Parquet",
            FileFormatCategory::Sqlite => "Sqlite",
            FileFormatCategory::DuckDb => "DuckDb",
            FileFormatCategory::Evtx => "Evtx",
            FileFormatCategory::ForbiddenBinary => "ForbiddenBinary",
        }
    }
}

fn check_forbidden_magic(slice: &[u8], file_label: &str) -> IoResult<()> {
    // Windows PE Executable (MZ)
    if slice.len() >= 2 && slice[0] == 0x4D && slice[1] == 0x5A {
        return Err(Error::new(
            ErrorKind::InvalidData,
            format!(
                "[Binary Guard] File \"{}\" is a Windows PE executable (EXE/DLL). Toad refuses to open binary executables.",
                file_label
            ),
        ));
    }

    // Linux/Unix ELF Executable (\x7FELF)
    if slice.len() >= 4
        && slice[0] == 0x7F
        && slice[1] == b'E'
        && slice[2] == b'L'
        && slice[3] == b'F'
    {
        return Err(Error::new(
            ErrorKind::InvalidData,
            format!(
                "[Binary Guard] File \"{}\" is an ELF binary executable. Toad refuses to open binary executables.",
                file_label
            ),
        ));
    }

    // ZIP / Office / JAR container (PK\x03\x04)
    if slice.len() >= 4
        && slice[0] == 0x50
        && slice[1] == 0x4B
        && slice[2] == 0x03
        && slice[3] == 0x04
    {
        return Err(Error::new(
            ErrorKind::InvalidData,
            format!(
                "[Binary Guard] File \"{}\" is a ZIP/Office container archive (PK header). Please extract supported CSV/JSON/Parquet/EVTX files first.",
                file_label
            ),
        ));
    }

    Ok(())
}

/// Inspects a file before ingestion to prevent binary files from crashing DuckDB or the UI.
pub fn inspect_file(file_path: &Path) -> IoResult<FileFormatCategory> {
    if !file_path.exists() {
        return Err(Error::new(
            ErrorKind::NotFound,
            format!("File not found: {}", file_path.display()),
        ));
    }

    let ext = file_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    // 1. Known structured binary data formats handled natively
    match ext.as_str() {
        "parquet" => return Ok(FileFormatCategory::Parquet),
        "sqlite" => return Ok(FileFormatCategory::Sqlite),
        "duckdb" => return Ok(FileFormatCategory::DuckDb),
        "evtx" => return Ok(FileFormatCategory::Evtx),
        _ => {}
    }

    // 2. Read the first 8KB
    let mut file = File::open(file_path)?;
    let mut buffer = [0u8; GUARD_BUFFER_SIZE];
    let bytes_read = file.read(&mut buffer)?;

    if bytes_read == 0 {
        return Ok(FileFormatCategory::DelimitedText);
    }

    let slice = &buffer[..bytes_read];
    let file_label = file_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // 3. Check forbidden binary signatures
    check_forbidden_magic(slice, &file_label)?;

    // Windows EVTX (ElfFile\0)
    if bytes_read >= 8 && &slice[0..7] == b"ElfFile" && slice[7] == 0x00 {
        return Ok(FileFormatCategory::Evtx);
    }

    // Parquet magic bytes (PAR1)
    if bytes_read >= 4 && &slice[0..4] == b"PAR1" {
        return Ok(FileFormatCategory::Parquet);
    }

    // SQLite magic bytes (SQLite format 3\0)
    if bytes_read >= 16 && &slice[0..15] == b"SQLite format 3" {
        return Ok(FileFormatCategory::Sqlite);
    }

    // 4. Gzip compressed stream (1F 8B 08): inspect first 8KB of decompressed payload across members
    if bytes_read >= 3 && slice[0] == 0x1F && slice[1] == 0x8B && slice[2] == 0x08 {
        let raw_file = File::open(file_path)?;
        let mut gz = MultiGzDecoder::new(BufReader::new(raw_file));
        let mut inner_buf = [0u8; GUARD_BUFFER_SIZE];
        let inner_read = read_up_to(&mut gz, &mut inner_buf).map_err(|e| {
            Error::new(
                ErrorKind::InvalidData,
                format!(
                    "[Binary Guard] File \"{}\" has a corrupted Gzip stream: {}",
                    file_label, e
                ),
            )
        })?;

        if inner_read == 0 {
            return Ok(FileFormatCategory::GzipText);
        }

        let inner_slice = &inner_buf[..inner_read];
        check_forbidden_magic(inner_slice, &file_label)?;

        if detect_utf16_slice(inner_slice).is_some() {
            return Ok(FileFormatCategory::GzipText);
        }

        for (idx, &b) in inner_slice.iter().enumerate() {
            if b == 0x00 {
                return Err(Error::new(
                    ErrorKind::InvalidData,
                    format!(
                        "[Binary Guard] Gzip file \"{}\" wraps binary payload (detected null byte '\\0' at decompressed offset {}). Toad only supports compressed text logs (.csv.gz, .tsv.gz, .jsonl.gz).",
                        file_label, idx
                    ),
                ));
            }
        }

        return Ok(FileFormatCategory::GzipText);
    }

    // 5. UTF-16LE / UTF-16BE text check (with BOM or strict alternating ASCII text heuristic)
    if detect_utf16_slice(slice).is_some() {
        return Ok(FileFormatCategory::Utf16Text);
    }

    // 6. Null-byte scan for plain UTF-8 / ASCII text
    for (idx, &b) in slice.iter().enumerate() {
        if b == 0x00 {
            return Err(Error::new(
                ErrorKind::InvalidData,
                format!(
                    "[Binary Guard] File \"{}\" is a binary file (detected null byte '\\0' at offset {}). Toad only supports CSV, TSV, JSON, JSONL, Gzip text (.gz), UTF-16 text, Parquet, and EVTX.",
                    file_label, idx
                ),
            ));
        }
    }

    // 7. Classify plain text (JSON vs Delimited)
    let sample_text = String::from_utf8_lossy(slice);
    let trimmed = sample_text.trim_start_matches('\u{FEFF}').trim_start();
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        Ok(FileFormatCategory::JsonText)
    } else {
        Ok(FileFormatCategory::DelimitedText)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::io::Write;

    #[test]
    fn test_valid_csv() -> IoResult<()> {
        let tmp_path = std::env::temp_dir().join("toad_test_valid.csv");
        let mut f = File::create(&tmp_path)?;
        writeln!(f, "id,name,role\n1,Alice,Engineer\n2,Bob,Analyst")?;
        f.flush()?;
        let cat = inspect_file(&tmp_path)?;
        let _ = std::fs::remove_file(&tmp_path);
        assert_eq!(cat, FileFormatCategory::DelimitedText);
        Ok(())
    }

    #[test]
    fn test_binary_block_null_byte() -> IoResult<()> {
        let tmp_path = std::env::temp_dir().join("toad_test_malicious.csv");
        let mut f = File::create(&tmp_path)?;
        f.write_all(b"Hello\x00World")?;
        f.flush()?;
        let res = inspect_file(&tmp_path);
        let _ = std::fs::remove_file(&tmp_path);
        assert!(res.is_err());
        assert!(res.unwrap_err().to_string().contains("[Binary Guard]"));
        Ok(())
    }

    #[test]
    fn test_valid_gzip_csv() -> IoResult<()> {
        let tmp_path = std::env::temp_dir().join("toad_test_valid.csv.gz");
        {
            let f = File::create(&tmp_path)?;
            let mut gz = GzEncoder::new(f, Compression::default());
            gz.write_all(b"timestamp,level,msg\n2026-01-01T00:00:00Z,INFO,ok\n")?;
            gz.finish()?;
        }
        let cat = inspect_file(&tmp_path)?;
        let _ = std::fs::remove_file(&tmp_path);
        assert_eq!(cat, FileFormatCategory::GzipText);
        Ok(())
    }

    #[test]
    fn test_block_gzip_wrapping_pe_executable() -> IoResult<()> {
        let tmp_path = std::env::temp_dir().join("toad_test_pe_inside.csv.gz");
        {
            let f = File::create(&tmp_path)?;
            let mut gz = GzEncoder::new(f, Compression::default());
            gz.write_all(b"MZ\x90\x00\x03\x00\x00\x00FakePEHeader")?;
            gz.finish()?;
        }
        let res = inspect_file(&tmp_path);
        let _ = std::fs::remove_file(&tmp_path);
        assert!(res.is_err());
        assert!(res.unwrap_err().to_string().contains("PE executable"));
        Ok(())
    }

    #[test]
    fn test_valid_utf16le_and_utf16be() -> IoResult<()> {
        let tmp_le = std::env::temp_dir().join("toad_test_utf16le.csv");
        let tmp_be = std::env::temp_dir().join("toad_test_utf16be.csv");

        let text = "id,user,event\n1,admin,login\n";
        let mut le_bytes = vec![0xFF, 0xFE];
        let mut be_bytes = vec![0xFE, 0xFF];
        for u in text.encode_utf16() {
            le_bytes.extend_from_slice(&u.to_le_bytes());
            be_bytes.extend_from_slice(&u.to_be_bytes());
        }
        std::fs::write(&tmp_le, &le_bytes)?;
        std::fs::write(&tmp_be, &be_bytes)?;

        let cat_le = inspect_file(&tmp_le)?;
        let cat_be = inspect_file(&tmp_be)?;
        let _ = std::fs::remove_file(&tmp_le);
        let _ = std::fs::remove_file(&tmp_be);

        assert_eq!(cat_le, FileFormatCategory::Utf16Text);
        assert_eq!(cat_be, FileFormatCategory::Utf16Text);
        Ok(())
    }

    #[test]
    fn test_block_multimember_gzip_hiding_pe_in_second_stream() -> IoResult<()> {
        let tmp_path = std::env::temp_dir().join("toad_test_multimember_pe.csv.gz");
        let mut combined = Vec::new();
        {
            // Empty first gzip member followed by PE executable in second gzip member
            let enc1 = GzEncoder::new(Vec::new(), Compression::default());
            combined.extend_from_slice(&enc1.finish()?);
        }
        {
            let mut enc2 = GzEncoder::new(Vec::new(), Compression::default());
            enc2.write_all(b"MZ\x90\x00\x03\x00\x00\x00HiddenPE")?;
            combined.extend_from_slice(&enc2.finish()?);
        }
        std::fs::write(&tmp_path, &combined)?;
        let res = inspect_file(&tmp_path);
        let _ = std::fs::remove_file(&tmp_path);
        assert!(res.is_err());
        assert!(res.unwrap_err().to_string().contains("PE executable"));
        Ok(())
    }
}
