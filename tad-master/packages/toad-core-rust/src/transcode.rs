//! transcode.rs
//!
//! Streaming encoding detection & transcoding to UTF-8 for TOAD Core Engine.
//! Supports UTF-8, UTF-8 BOM, UTF-16LE, UTF-16BE, and Gzip-compressed (.gz) variants
//! with bounded 64KB chunk memory usage and safe cross-chunk surrogate handling.

use flate2::read::MultiGzDecoder;
use std::fs::File;
use std::io::{BufReader, BufWriter, Error, ErrorKind, Read, Result as IoResult, Write};
use std::path::Path;

pub const STREAM_CHUNK_SIZE: usize = 64 * 1024; // 64KB bounded read chunk
const HEADER_INSPECT_SIZE: usize = 8192;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DetectedEncoding {
    Utf8,
    Utf8Bom,
    Utf16Le,
    Utf16Be,
    GzipUtf8,
    GzipUtf16Le,
    GzipUtf16Be,
}

impl DetectedEncoding {
    pub fn as_str(&self) -> &'static str {
        match self {
            DetectedEncoding::Utf8 => "utf-8",
            DetectedEncoding::Utf8Bom => "utf-8-bom",
            DetectedEncoding::Utf16Le => "utf-16le",
            DetectedEncoding::Utf16Be => "utf-16be",
            DetectedEncoding::GzipUtf8 => "gzip+utf-8",
            DetectedEncoding::GzipUtf16Le => "gzip+utf-16le",
            DetectedEncoding::GzipUtf16Be => "gzip+utf-16be",
        }
    }

    pub fn is_gzip(&self) -> bool {
        matches!(
            self,
            DetectedEncoding::GzipUtf8
                | DetectedEncoding::GzipUtf16Le
                | DetectedEncoding::GzipUtf16Be
        )
    }

    pub fn needs_utf8_transcode(&self) -> bool {
        matches!(
            self,
            DetectedEncoding::Utf16Le
                | DetectedEncoding::Utf16Be
                | DetectedEncoding::GzipUtf16Le
                | DetectedEncoding::GzipUtf16Be
        )
    }
}

#[derive(Debug, Clone)]
pub struct TranscodeStats {
    pub encoding: String,
    pub bytes_written: u64,
    pub elapsed_ms: f64,
}

/// Read up to `buf.len()` bytes until EOF or full buffer (handles partial GzDecoder blocks).
pub fn read_up_to<R: Read>(reader: &mut R, buf: &mut [u8]) -> IoResult<usize> {
    let mut total = 0;
    while total < buf.len() {
        match reader.read(&mut buf[total..]) {
            Ok(0) => break,
            Ok(n) => total += n,
            Err(ref e) if e.kind() == ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        }
    }
    Ok(total)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Utf16Endian {
    Little,
    Big,
}

/// Inspects an in-memory header slice (up to 8KB) and determines whether it is valid UTF-16LE or UTF-16BE text.
/// Rejects slices containing NUL code units (0x0000), forbidden C0 control codes, or invalid surrogate sequences.
pub fn detect_utf16_slice(slice: &[u8]) -> Option<(Utf16Endian, bool)> {
    if slice.len() < 2 {
        return None;
    }

    // 1. Explicit BOM check (FF FE = UTF-16LE, FE FF = UTF-16BE)
    if slice[0] == 0xFF && slice[1] == 0xFE {
        let body = &slice[2..];
        if validate_utf16_units(body, Utf16Endian::Little, true) {
            return Some((Utf16Endian::Little, true));
        }
        return None;
    }
    if slice[0] == 0xFE && slice[1] == 0xFF {
        let body = &slice[2..];
        if validate_utf16_units(body, Utf16Endian::Big, true) {
            return Some((Utf16Endian::Big, true));
        }
        return None;
    }

    // 2. BOM-less heuristic: require at least 8 bytes (4 UTF-16 code units)
    if slice.len() < 8 {
        return None;
    }

    if validate_utf16_units(slice, Utf16Endian::Little, false) {
        return Some((Utf16Endian::Little, false));
    }
    if validate_utf16_units(slice, Utf16Endian::Big, false) {
        return Some((Utf16Endian::Big, false));
    }

    None
}

fn validate_utf16_units(bytes: &[u8], endian: Utf16Endian, has_bom: bool) -> bool {
    let even_len = bytes.len() - (bytes.len() % 2);
    if even_len == 0 {
        return has_bom;
    }

    let total_units = even_len / 2;
    let mut ascii_units = 0usize;
    let mut idx = 0usize;

    while idx < even_len {
        let u = match endian {
            Utf16Endian::Little => u16::from_le_bytes([bytes[idx], bytes[idx + 1]]),
            Utf16Endian::Big => u16::from_be_bytes([bytes[idx], bytes[idx + 1]]),
        };

        // Never allow NUL code unit (0x0000) in text logs (also rejects UTF-32LE FF FE 00 00)
        if u == 0x0000 {
            return false;
        }

        // Reject non-whitespace C0 control characters
        if u < 0x0020 && u != 0x0009 && u != 0x000A && u != 0x000D {
            return false;
        }

        // Surrogate validation
        if (0xD800..=0xDBFF).contains(&u) {
            // High surrogate: allow at very end of truncated sample buffer; otherwise require valid low surrogate
            if idx + 2 < even_len {
                let next_u = match endian {
                    Utf16Endian::Little => u16::from_le_bytes([bytes[idx + 2], bytes[idx + 3]]),
                    Utf16Endian::Big => u16::from_be_bytes([bytes[idx + 2], bytes[idx + 3]]),
                };
                if !(0xDC00..=0xDFFF).contains(&next_u) {
                    return false;
                }
                idx += 4;
                continue;
            }
        } else if (0xDC00..=0xDFFF).contains(&u) {
            // Unpaired low surrogate
            return false;
        }

        if u == 0x0009 || u == 0x000A || u == 0x000D || (0x0020..=0x007E).contains(&u) {
            ascii_units += 1;
        }

        idx += 2;
    }

    if has_bom {
        true
    } else {
        // Without BOM, require >= 70% printable ASCII / whitespace code units to avoid false positives
        ascii_units * 10 >= total_units * 7
    }
}

/// Detect the text encoding (including Gzip wrapper) of a file on disk.
pub fn detect_text_encoding(file_path: &Path) -> IoResult<DetectedEncoding> {
    let mut f = File::open(file_path)?;
    let mut header = [0u8; HEADER_INSPECT_SIZE];
    let n = read_up_to(&mut f, &mut header)?;
    let slice = &header[..n];

    if n >= 3 && slice[0] == 0x1F && slice[1] == 0x8B && slice[2] == 0x08 {
        let raw = File::open(file_path)?;
        let mut gz = MultiGzDecoder::new(BufReader::new(raw));
        let mut inner = [0u8; HEADER_INSPECT_SIZE];
        let inner_n = read_up_to(&mut gz, &mut inner).map_err(|e| {
            Error::new(
                ErrorKind::InvalidData,
                format!("Invalid Gzip stream in \"{}\": {}", file_path.display(), e),
            )
        })?;
        let inner_slice = &inner[..inner_n];
        if let Some((endian, _)) = detect_utf16_slice(inner_slice) {
            return Ok(match endian {
                Utf16Endian::Little => DetectedEncoding::GzipUtf16Le,
                Utf16Endian::Big => DetectedEncoding::GzipUtf16Be,
            });
        }
        return Ok(DetectedEncoding::GzipUtf8);
    }

    if let Some((endian, _)) = detect_utf16_slice(slice) {
        return Ok(match endian {
            Utf16Endian::Little => DetectedEncoding::Utf16Le,
            Utf16Endian::Big => DetectedEncoding::Utf16Be,
        });
    }

    if n >= 3 && slice[0] == 0xEF && slice[1] == 0xBB && slice[2] == 0xBF {
        return Ok(DetectedEncoding::Utf8Bom);
    }

    Ok(DetectedEncoding::Utf8)
}

/// Stream-transcode any supported text input (UTF-16LE, UTF-16BE, Gzip+UTF-16, Gzip+UTF-8, UTF-8 BOM)
/// into clean BOM-free UTF-8 using bounded 64KB chunks.
pub fn transcode_to_utf8(input_path: &Path, output_path: &Path) -> IoResult<TranscodeStats> {
    let start = std::time::Instant::now();
    let encoding = detect_text_encoding(input_path)?;

    let out_file = File::create(output_path)?;
    let mut writer = BufWriter::with_capacity(256 * 1024, out_file);

    let bytes_written = match encoding {
        DetectedEncoding::Utf16Le => {
            let mut reader = BufReader::with_capacity(STREAM_CHUNK_SIZE, File::open(input_path)?);
            stream_utf16_to_utf8(&mut reader, &mut writer, Utf16Endian::Little)?
        }
        DetectedEncoding::Utf16Be => {
            let mut reader = BufReader::with_capacity(STREAM_CHUNK_SIZE, File::open(input_path)?);
            stream_utf16_to_utf8(&mut reader, &mut writer, Utf16Endian::Big)?
        }
        DetectedEncoding::GzipUtf16Le => {
            let raw = BufReader::with_capacity(STREAM_CHUNK_SIZE, File::open(input_path)?);
            let mut gz = MultiGzDecoder::new(raw);
            stream_utf16_to_utf8(&mut gz, &mut writer, Utf16Endian::Little)?
        }
        DetectedEncoding::GzipUtf16Be => {
            let raw = BufReader::with_capacity(STREAM_CHUNK_SIZE, File::open(input_path)?);
            let mut gz = MultiGzDecoder::new(raw);
            stream_utf16_to_utf8(&mut gz, &mut writer, Utf16Endian::Big)?
        }
        DetectedEncoding::GzipUtf8 => {
            let raw = BufReader::with_capacity(STREAM_CHUNK_SIZE, File::open(input_path)?);
            let mut gz = MultiGzDecoder::new(raw);
            stream_utf8_strip_bom(&mut gz, &mut writer)?
        }
        DetectedEncoding::Utf8Bom | DetectedEncoding::Utf8 => {
            let mut reader = BufReader::with_capacity(STREAM_CHUNK_SIZE, File::open(input_path)?);
            stream_utf8_strip_bom(&mut reader, &mut writer)?
        }
    };

    writer.flush()?;
    let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;

    Ok(TranscodeStats {
        encoding: encoding.as_str().to_string(),
        bytes_written,
        elapsed_ms,
    })
}

fn stream_utf8_strip_bom<R: Read, W: Write>(reader: &mut R, writer: &mut W) -> IoResult<u64> {
    let mut chunk = vec![0u8; STREAM_CHUNK_SIZE];
    let mut first_chunk = true;
    let mut total_written: u64 = 0;

    loop {
        let n = read_up_to(reader, &mut chunk)?;
        if n == 0 {
            break;
        }
        let mut slice = &chunk[..n];
        if first_chunk {
            first_chunk = false;
            if slice.len() >= 3 && slice[0] == 0xEF && slice[1] == 0xBB && slice[2] == 0xBF {
                slice = &slice[3..];
            }
        }
        if !slice.is_empty() {
            writer.write_all(slice)?;
            total_written += slice.len() as u64;
        }
    }

    Ok(total_written)
}

fn stream_utf16_to_utf8<R: Read, W: Write>(
    reader: &mut R,
    writer: &mut W,
    endian: Utf16Endian,
) -> IoResult<u64> {
    let mut raw_buf = vec![0u8; STREAM_CHUNK_SIZE];
    let mut u16_buf: Vec<u16> = Vec::with_capacity(STREAM_CHUNK_SIZE / 2 + 2);
    let mut out_str = String::with_capacity(STREAM_CHUNK_SIZE);

    let mut carry_byte: Option<u8> = None;
    let mut pending_surrogate: Option<u16> = None;
    let mut first_unit = true;
    let mut total_written: u64 = 0;

    loop {
        let n = match reader.read(&mut raw_buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(ref e) if e.kind() == ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        };

        u16_buf.clear();
        if let Some(prev) = pending_surrogate.take() {
            u16_buf.push(prev);
        }

        let mut offset = 0usize;
        if let Some(b0) = carry_byte.take() {
            let b1 = raw_buf[0];
            offset = 1;
            let unit = match endian {
                Utf16Endian::Little => u16::from_le_bytes([b0, b1]),
                Utf16Endian::Big => u16::from_be_bytes([b0, b1]),
            };
            if !(first_unit && unit == 0xFEFF) {
                u16_buf.push(unit);
            }
            first_unit = false;
        }

        while offset + 1 < n {
            let unit = match endian {
                Utf16Endian::Little => u16::from_le_bytes([raw_buf[offset], raw_buf[offset + 1]]),
                Utf16Endian::Big => u16::from_be_bytes([raw_buf[offset], raw_buf[offset + 1]]),
            };
            if !(first_unit && unit == 0xFEFF) {
                u16_buf.push(unit);
            }
            first_unit = false;
            offset += 2;
        }

        if offset < n {
            carry_byte = Some(raw_buf[offset]);
        }

        // Preserve trailing high surrogate for the next read chunk
        if let Some(&last) = u16_buf.last() {
            if (0xD800..=0xDBFF).contains(&last) {
                pending_surrogate = u16_buf.pop();
            }
        }

        if !u16_buf.is_empty() {
            out_str.clear();
            for ch_res in char::decode_utf16(u16_buf.iter().copied()) {
                let ch = ch_res.unwrap_or(char::REPLACEMENT_CHARACTER);
                out_str.push(ch);
            }
            writer.write_all(out_str.as_bytes())?;
            total_written += out_str.len() as u64;
        }
    }

    if pending_surrogate.is_some() || carry_byte.is_some() {
        let repl = "\u{FFFD}";
        writer.write_all(repl.as_bytes())?;
        total_written += repl.len() as u64;
    }

    Ok(total_written)
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::GzEncoder;
    use flate2::Compression;

    #[test]
    fn test_utf16le_with_bom_and_surrogates() -> IoResult<()> {
        let tmp_in = std::env::temp_dir().join("toad_transcode_utf16le.csv");
        let tmp_out = std::env::temp_dir().join("toad_transcode_utf16le_out.csv");

        let original = "id,message,emoji\n1,Hello Toad,🐸🚀\n2,Tiếng Việt,🔥\n";
        let mut bytes: Vec<u8> = vec![0xFF, 0xFE]; // UTF-16LE BOM
        for u in original.encode_utf16() {
            bytes.extend_from_slice(&u.to_le_bytes());
        }
        std::fs::write(&tmp_in, &bytes)?;

        assert_eq!(detect_text_encoding(&tmp_in)?, DetectedEncoding::Utf16Le);
        let stats = transcode_to_utf8(&tmp_in, &tmp_out)?;
        assert_eq!(stats.encoding, "utf-16le");

        let decoded = std::fs::read_to_string(&tmp_out)?;
        let _ = std::fs::remove_file(&tmp_in);
        let _ = std::fs::remove_file(&tmp_out);

        assert_eq!(decoded, original);
        Ok(())
    }

    #[test]
    fn test_utf16be_with_bom() -> IoResult<()> {
        let tmp_in = std::env::temp_dir().join("toad_transcode_utf16be.tsv");
        let tmp_out = std::env::temp_dir().join("toad_transcode_utf16be_out.tsv");

        let original = "colA\tcolB\nalpha\t100\nbeta\t200\n";
        let mut bytes: Vec<u8> = vec![0xFE, 0xFF]; // UTF-16BE BOM
        for u in original.encode_utf16() {
            bytes.extend_from_slice(&u.to_be_bytes());
        }
        std::fs::write(&tmp_in, &bytes)?;

        assert_eq!(detect_text_encoding(&tmp_in)?, DetectedEncoding::Utf16Be);
        let stats = transcode_to_utf8(&tmp_in, &tmp_out)?;
        assert_eq!(stats.encoding, "utf-16be");

        let decoded = std::fs::read_to_string(&tmp_out)?;
        let _ = std::fs::remove_file(&tmp_in);
        let _ = std::fs::remove_file(&tmp_out);

        assert_eq!(decoded, original);
        Ok(())
    }

    #[test]
    fn test_gzip_utf16le_streaming_cross_chunk() -> IoResult<()> {
        let tmp_in = std::env::temp_dir().join("toad_transcode_large_utf16le.csv.gz");
        let tmp_out = std::env::temp_dir().join("toad_transcode_large_utf16le_out.csv");

        // Build > 150KB of UTF-16LE data with emojis so surrogate pairs cross 64KB chunk boundaries
        let mut expected = String::from("id,host,detail\n");
        for i in 0..3500 {
            expected.push_str(&format!("{},srv-{:04},event_payload_🐸_{}\n", i, i, i * 7));
        }

        let out_gz = File::create(&tmp_in)?;
        let mut encoder = GzEncoder::new(out_gz, Compression::fast());
        encoder.write_all(&[0xFF, 0xFE])?;
        for u in expected.encode_utf16() {
            encoder.write_all(&u.to_le_bytes())?;
        }
        encoder.finish()?;

        assert_eq!(detect_text_encoding(&tmp_in)?, DetectedEncoding::GzipUtf16Le);
        let stats = transcode_to_utf8(&tmp_in, &tmp_out)?;
        assert_eq!(stats.encoding, "gzip+utf-16le");

        let decoded = std::fs::read_to_string(&tmp_out)?;
        let _ = std::fs::remove_file(&tmp_in);
        let _ = std::fs::remove_file(&tmp_out);

        assert_eq!(decoded, expected);
        Ok(())
    }

    #[test]
    fn test_multi_member_concatenated_gzip_transcode() -> IoResult<()> {
        let tmp_in = std::env::temp_dir().join("toad_transcode_multimember.csv.gz");
        let tmp_out = std::env::temp_dir().join("toad_transcode_multimember_out.csv");

        let part1 = "id,val\n1,first\n";
        let part2 = "2,second\n3,third\n";

        let mut combined = Vec::new();
        {
            let mut enc1 = GzEncoder::new(Vec::new(), Compression::default());
            enc1.write_all(&[0xFF, 0xFE])?;
            for u in part1.encode_utf16() {
                enc1.write_all(&u.to_le_bytes())?;
            }
            combined.extend_from_slice(&enc1.finish()?);
        }
        {
            let mut enc2 = GzEncoder::new(Vec::new(), Compression::default());
            for u in part2.encode_utf16() {
                enc2.write_all(&u.to_le_bytes())?;
            }
            combined.extend_from_slice(&enc2.finish()?);
        }

        std::fs::write(&tmp_in, &combined)?;
        let stats = transcode_to_utf8(&tmp_in, &tmp_out)?;
        assert_eq!(stats.encoding, "gzip+utf-16le");

        let decoded = std::fs::read_to_string(&tmp_out)?;
        let _ = std::fs::remove_file(&tmp_in);
        let _ = std::fs::remove_file(&tmp_out);

        assert_eq!(decoded, format!("{}{}", part1, part2));
        Ok(())
    }
}
