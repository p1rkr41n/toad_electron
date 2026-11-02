//! csv_engine.rs
//!
//! Động cơ phân tích và chuẩn hóa CSV/TSV/Log bằng Pure Rust:
//! - Sniffer tự động nhận diện dấu phân cách (Delimiter Sniffer: ',', '\t', ';', '|')
//! - Chuẩn hóa dòng dữ liệu bẩn (Dirty rows normalization)
//! - Thống kê số lượng dòng và schema cột siêu tốc

use std::fs::File;
use std::io::{BufRead, BufReader, BufWriter, Result as IoResult, Write};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CsvMetadata {
    pub delimiter: char,
    pub has_header: bool,
    pub column_count: usize,
    pub headers: Vec<String>,
    pub estimated_rows: u64,
}

const CANDIDATE_DELIMITERS: &[char] = &[',', '\t', ';', '|'];

/// Tự động nhận diện dấu phân cách của file
pub fn sniff_delimiter(file_path: &Path) -> IoResult<char> {
    let file = File::open(file_path)?;
    let reader = BufReader::new(file);

    let mut scores: [usize; 4] = [0; 4];
    let sample_lines: Vec<String> = reader.lines().take(20).flatten().collect();

    if sample_lines.is_empty() {
        return Ok(','); // Mặc định
    }

    for (d_idx, &delim) in CANDIDATE_DELIMITERS.iter().enumerate() {
        let mut line_counts = Vec::new();
        for line in &sample_lines {
            let count = line.chars().filter(|&c| c == delim).count();
            line_counts.push(count);
        }
        if let Some(&first) = line_counts.first() {
            if first > 0 && line_counts.iter().all(|&c| c == first) {
                scores[d_idx] += first * 10;
            } else {
                scores[d_idx] += line_counts.iter().sum::<usize>();
            }
        }
    }

    let mut best_idx = 0;
    let mut best_score = 0;
    for (i, &score) in scores.iter().enumerate() {
        if score > best_score {
            best_score = score;
            best_idx = i;
        }
    }

    Ok(CANDIDATE_DELIMITERS[best_idx])
}

/// Tách dòng CSV có tính đến cặp ngoặc kép
pub fn parse_csv_line(line: &str, delimiter: char) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let chars: Vec<char> = line.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];
        if c == '"' {
            if in_quotes && i + 1 < chars.len() && chars[i + 1] == '"' {
                current.push('"');
                i += 1; // Bỏ qua escape quote
            } else {
                in_quotes = !in_quotes;
            }
        } else if c == delimiter && !in_quotes {
            fields.push(current.trim().to_string());
            current = String::new();
        } else {
            current.push(c);
        }
        i += 1;
    }
    fields.push(current.trim().to_string());
    fields
}

/// Đọc metadata của file CSV (lấy mẫu nhanh O(1) để không làm nghẽn file lớn 40GB+)
pub fn inspect_csv(file_path: &Path) -> IoResult<CsvMetadata> {
    let delim = sniff_delimiter(file_path)?;
    let file = File::open(file_path)?;
    let file_size = file.metadata()?.len();
    let mut reader = BufReader::new(file);

    let mut first_line = String::new();
    let _ = reader.read_line(&mut first_line);
    let headers = parse_csv_line(first_line.trim_end(), delim);
    let col_count = headers.len();

    // Lấy mẫu tối đa 1.000 dòng để ước lượng nhanh số dòng (chỉ tốn < 1ms thay vì quét toàn bộ 40GB)
    let mut sample_bytes = first_line.len() as u64;
    let mut sample_rows = 0u64;
    let mut line_buf = String::new();
    while sample_rows < 1000 && reader.read_line(&mut line_buf)? > 0 {
        sample_bytes += line_buf.len() as u64;
        if !line_buf.trim().is_empty() {
            sample_rows += 1;
        }
        line_buf.clear();
    }

    let estimated_rows = if sample_rows > 0 && sample_bytes > 0 {
        let avg_line_bytes = sample_bytes as f64 / (sample_rows + 1) as f64;
        (file_size as f64 / avg_line_bytes).round() as u64
    } else {
        sample_rows
    };

    Ok(CsvMetadata {
        delimiter: delim,
        has_header: !headers.is_empty(),
        column_count: col_count,
        headers,
        estimated_rows,
    })
}

/// Chuẩn hóa file CSV bẩn thành CSV sạch với số lượng cột cố định
pub fn normalize_dirty_csv(
    input_path: &Path,
    output_path: &Path,
    target_delimiter: char,
) -> IoResult<u64> {
    let src_delim = sniff_delimiter(input_path)?;
    let in_file = File::open(input_path)?;
    let in_reader = BufReader::new(in_file);

    let out_file = File::create(output_path)?;
    let mut out_writer = BufWriter::new(out_file);

    let mut lines = in_reader.lines();
    let header_line = match lines.next() {
        Some(Ok(l)) => l,
        _ => return Ok(0),
    };

    let headers = parse_csv_line(&header_line, src_delim);
    let num_cols = headers.len();

    // Ghi header
    let escaped_headers: Vec<String> = headers
        .iter()
        .map(|h| format!("\"{}\"", h.replace('"', "\"\"")))
        .collect();
    writeln!(out_writer, "{}", escaped_headers.join(&target_delimiter.to_string()))?;

    let mut processed_rows = 0;

    for line_res in lines {
        let line = line_res?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let mut fields = parse_csv_line(trimmed, src_delim);

        // Chuẩn hóa độ dài
        if fields.len() < num_cols {
            while fields.len() < num_cols {
                fields.push(String::new());
            }
        } else if fields.len() > num_cols {
            fields.truncate(num_cols);
        }

        let escaped_fields: Vec<String> = fields
            .iter()
            .map(|f| format!("\"{}\"", f.replace('"', "\"\"")))
            .collect();
        writeln!(out_writer, "{}", escaped_fields.join(&target_delimiter.to_string()))?;
        processed_rows += 1;
    }

    out_writer.flush()?;
    Ok(processed_rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_csv_line() {
        let line = "1,\"Alice, Dev\",1000";
        let fields = parse_csv_line(line, ',');
        assert_eq!(fields, vec!["1", "Alice, Dev", "1000"]);
    }

    #[test]
    fn test_sniff_delimiter() -> IoResult<()> {
        let tmp_path = std::env::temp_dir().join("test_sniff.tsv");
        std::fs::write(&tmp_path, "col1\tcol2\tcol3\n1\t2\t3\n")?;
        let d = sniff_delimiter(&tmp_path)?;
        let _ = std::fs::remove_file(&tmp_path);
        assert_eq!(d, '\t');
        Ok(())
    }
}
