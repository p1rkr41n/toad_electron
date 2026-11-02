//! binary_guard.rs
//!
//! Module kiểm tra file nhị phân (Binary Guard - 8KB Check) viết bằng Rust siêu tốc.
//! Quét 8KB đầu tiên tìm null byte ('\0') và nhận diện magic bytes.
//! Chặn các file binary trái phép (exe, dll, bin...) để bảo vệ Electron và DuckDB.

use std::fs::File;
use std::io::{Error, ErrorKind, Read, Result as IoResult};
use std::path::Path;

pub const GUARD_BUFFER_SIZE: usize = 8192; // 8KB

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileFormatCategory {
    DelimitedText,   // CSV, TSV, TXT, LOG
    JsonText,        // JSON, JSONL, NDJSON
    Parquet,         // .parquet (Cho phép)
    Sqlite,          // .sqlite (Cho phép)
    DuckDb,          // .duckdb (Cho phép)
    Evtx,            // .evtx (Cho phép qua bộ parse riêng)
    ForbiddenBinary, // .exe, .dll, .bin, .zip... (CHẶN)
}

/// Kiểm tra an toàn cho file trước khi nạp vào hệ thống
pub fn inspect_file(file_path: &Path) -> IoResult<FileFormatCategory> {
    if !file_path.exists() {
        return Err(Error::new(
            ErrorKind::NotFound,
            format!("File không tồn tại: {}", file_path.display()),
        ));
    }

    let ext = file_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    // 1. Nhận diện các định dạng hợp lệ theo đuôi file
    match ext.as_str() {
        "parquet" => return Ok(FileFormatCategory::Parquet),
        "sqlite" => return Ok(FileFormatCategory::Sqlite),
        "duckdb" => return Ok(FileFormatCategory::DuckDb),
        "evtx" => return Ok(FileFormatCategory::Evtx),
        _ => {}
    }

    // 2. Mở file và đọc 8KB đầu tiên
    let mut file = File::open(file_path)?;
    let mut buffer = [0u8; GUARD_BUFFER_SIZE];
    let bytes_read = file.read(&mut buffer)?;

    if bytes_read == 0 {
        // File rỗng
        return Ok(FileFormatCategory::DelimitedText);
    }

    let slice = &buffer[..bytes_read];

    // 3. Kiểm tra Magic Bytes nhị phân phổ biến
    // Windows PE Executable (MZ)
    if bytes_read >= 2 && slice[0] == 0x4D && slice[1] == 0x5A {
        return Err(Error::new(
            ErrorKind::InvalidData,
            format!(
                "[Binary Guard] File \"{}\" là file thực thi Windows (PE/EXE/DLL). Toad từ chối mở file nhị phân này.",
                file_path.file_name().unwrap_or_default().to_string_lossy()
            ),
        ));
    }

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

    // 4. Quét tìm null byte ('\0') trong dữ liệu text
    for (idx, &b) in slice.iter().enumerate() {
        if b == 0x00 {
            return Err(Error::new(
                ErrorKind::InvalidData,
                format!(
                    "[Binary Guard] File \"{}\" là file nhị phân (phát hiện null byte '\\0' tại vị trí byte {}). \
                    Toad chỉ hỗ trợ file CSV, TSV, JSON, JSONL, Parquet và EVTX.",
                    file_path.file_name().unwrap_or_default().to_string_lossy(),
                    idx
                ),
            ));
        }
    }

    // 5. Phân loại Text (JSON vs Delimited)
    let sample_text = String::from_utf8_lossy(slice);
    let trimmed = sample_text.trim_start();
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        Ok(FileFormatCategory::JsonText)
    } else {
        Ok(FileFormatCategory::DelimitedText)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
}
