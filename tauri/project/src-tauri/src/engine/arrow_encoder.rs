//! arrow_encoder.rs
//!
//! Vectorized Apache Arrow IPC Stream Encoder for Toad Tauri v2:
//! - Streams RecordBatches directly to byte buffer starting with 0xFFFFFFFF continuation marker.
//! - Embeds `toadSchema` JSON string into Arrow Schema metadata for seamless frontend hydration.
//! - Wraps buffer into `tauri::ipc::Response`.

use arrow::datatypes::SchemaRef;
use arrow::ipc::writer::StreamWriter;
use arrow::record_batch::RecordBatch;
use duckdb::Connection;
use std::sync::Arc;
use tauri::ipc::Response;

use crate::engine::schema_mapper::SchemaMapper;

pub struct ArrowIpcEncoder;

impl ArrowIpcEncoder {
    /// Encode a slice of RecordBatches to binary Arrow IPC Stream response
    pub fn encode_stream(
        batches: &[RecordBatch],
        schema: &SchemaRef,
        toad_schema_json: Option<&str>,
    ) -> Result<Response, String> {
        let bytes = Self::encode_to_vec(batches, schema, toad_schema_json)?;
        Ok(Response::new(bytes))
    }

    /// Encode RecordBatches to a raw byte vector
    pub fn encode_to_vec(
        batches: &[RecordBatch],
        schema: &SchemaRef,
        toad_schema_json: Option<&str>,
    ) -> Result<Vec<u8>, String> {
        // 1. Enrich schema metadata with toadSchema and application branding
        let mut meta = schema.metadata().clone();
        let schema_json = match toad_schema_json {
            Some(s) => s.to_string(),
            None => SchemaMapper::to_toad_schema_json(schema),
        };
        meta.insert("toadSchema".to_string(), schema_json);
        meta.insert("application".to_string(), "Toad-Tauri-v2".to_string());

        let enriched_schema = Arc::new(schema.as_ref().clone().with_metadata(meta));

        // 2. Pre-allocate buffer for high-throughput serialization
        let estimated_size = batches
            .iter()
            .map(|b| b.get_array_memory_size())
            .sum::<usize>()
            + 4096;
        let mut buffer = Vec::with_capacity(estimated_size);

        // 3. Serialize through StreamWriter (generates 0xFFFFFFFF continuation indicator)
        {
            let mut writer = StreamWriter::try_new(&mut buffer, &enriched_schema)
                .map_err(|e| format!("StreamWriter init error: {}", e))?;

            for batch in batches {
                writer
                    .write(batch)
                    .map_err(|e| format!("Write batch error: {}", e))?;
            }

            writer
                .finish()
                .map_err(|e| format!("Finish stream error: {}", e))?;
        }

        // 4. Verification assertion: Must start with 0xFFFFFFFF continuation marker
        if buffer.len() >= 4 {
            debug_assert_eq!(
                &buffer[0..4],
                &[0xFF, 0xFF, 0xFF, 0xFF],
                "Arrow IPC stream must begin with 0xFFFFFFFF continuation marker"
            );
        }

        Ok(buffer)
    }

    /// Encode an empty table response (0 rows) preserving schema metadata
    pub fn encode_empty(
        schema: &SchemaRef,
        toad_schema_json: Option<&str>,
    ) -> Result<Response, String> {
        Self::encode_stream(&[], schema, toad_schema_json)
    }

    /// Execute SQL query directly on DuckDB connection and stream output as Arrow IPC
    pub fn query_to_arrow_ipc(conn: &Connection, sql: &str) -> Result<Response, String> {
        let mut stmt = conn
            .prepare(sql)
            .map_err(|e| format!("DuckDB SQL Prepare error [{}]: {}", sql, e))?;

        let arrow = stmt
            .query_arrow([])
            .map_err(|e| format!("DuckDB Query Arrow error [{}]: {}", sql, e))?;

        let schema = arrow.get_schema();
        let batches: Vec<RecordBatch> = arrow.collect();

        Self::encode_stream(&batches, &schema, None)
    }
}
