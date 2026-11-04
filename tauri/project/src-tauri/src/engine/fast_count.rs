//! fast_count.rs
//!
//! O(1) Parquet Metadata Footer Row Counter:
//! - Directly reads Parquet file metadata footer (num_rows) in < 1ms without table scanning.
//! - Fallback to DuckDB SQL COUNT(*) for views or virtual tables.

use duckdb::Connection;
use parquet::file::reader::{FileReader, SerializedFileReader};
use std::fs::File;
use std::path::Path;

pub struct FastCounter;

impl FastCounter {
    /// Read exact row count from Parquet metadata footer in O(1) time
    pub fn count_parquet_rows(file_path: &Path) -> Result<i64, String> {
        let file = File::open(file_path)
            .map_err(|e| format!("Failed to open file {:?}: {}", file_path, e))?;

        // SerializedFileReader reads 4-byte footer length from end of file, then parses thrift footer
        let reader = SerializedFileReader::new(file)
            .map_err(|e| format!("Failed to read Parquet metadata from {:?}: {}", file_path, e))?;

        let num_rows = reader.metadata().file_metadata().num_rows();
        Ok(num_rows)
    }

    /// Smart row counter: Uses O(1) Parquet footer if file exists on disk,
    /// otherwise executes fast COUNT(*) on DuckDB connection.
    pub fn count_rows_smart(
        conn: &Connection,
        source: &str,
    ) -> Result<i64, String> {
        let path = Path::new(source);
        if path.exists() && path.extension().map_or(false, |ext| ext.eq_ignore_ascii_case("parquet")) {
            if let Ok(count) = Self::count_parquet_rows(path) {
                return Ok(count);
            }
        }

        // Fallback: DuckDB SQL query execution
        let mut stmt = conn
            .prepare(&format!("SELECT COUNT(*)::BIGINT FROM {}", source))
            .map_err(|e| format!("Prepare count error: {}", e))?;

        let count: i64 = stmt
            .query_row([], |row| row.get(0))
            .map_err(|e| format!("Execute count error: {}", e))?;

        Ok(count)
    }
}
