//! schema_mapper.rs
//!
//! Schema & Logical Type Mapper for DuckDB to reltab.Schema DTO and Apache Arrow IPC Metadata.

use arrow::datatypes::{DataType, Schema as ArrowSchema};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ============================================================================
// RELTAB SCHEMA DTO (FRONTEND CONTRACT)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SchemaDto {
    pub dialect: String,
    pub columns: Vec<String>,
    #[serde(rename = "columnMetadata")]
    pub column_metadata: HashMap<String, ColumnMetadataDto>,
    #[serde(rename = "columnTypes")]
    pub column_types: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ColumnMetadataDto {
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "columnType")]
    pub column_type: String, // SQL type name (e.g. "VARCHAR", "BIGINT")
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToadSchemaMetadata {
    pub version: u32,
    pub columns: Vec<String>,
    #[serde(rename = "columnMetadata")]
    pub column_metadata: HashMap<String, ColumnMetadataDto>,
}

// ============================================================================
// DUCKDB TYPE NORMALIZATION & ARROW CONVERSION
// ============================================================================

pub struct SchemaMapper;

impl SchemaMapper {
    /// Maps DuckDB SQL Type Name (from DESCRIBE) to Reltab Kind ("integer", "real", "text", "boolean", "timestamp", "blob")
    pub fn duckdb_type_to_kind(sql_type: &str) -> &'static str {
        let up = sql_type.to_uppercase();
        let base = up.split('(').next().unwrap_or(&up).trim();

        match base {
            "BIGINT" | "HUGEINT" | "INTEGER" | "INT" | "INT4" | "INT8" | "INT2" | "INT1"
            | "SMALLINT" | "TINYINT" | "UBIGINT" | "UINTEGER" | "USMALLINT" | "UTINYINT" => "integer",

            "DECIMAL" | "DOUBLE" | "FLOAT" | "REAL" | "FLOAT4" | "FLOAT8" | "NUMERIC" => "real",

            "VARCHAR" | "TEXT" | "CHAR" | "BPCHAR" | "STRING" | "JSON" | "STRUCT" | "MAP" | "LIST" => "text",

            "BOOL" | "BOOLEAN" => "boolean",

            "DATE" | "DATETIME" | "TIME" | "TIME WITH TIME ZONE" | "TIMESTAMP"
            | "TIMESTAMPTZ" | "TIMESTAMP WITH TIME ZONE" | "TIMESTAMP_NS" | "TIMESTAMP_MS" | "TIMESTAMP_S" => "timestamp",

            "BLOB" | "BYTEA" | "BINARY" | "VARBINARY" => "blob",

            _ => "text",
        }
    }

    /// Maps an Arrow DataType to SQL Type Name and Reltab Kind
    pub fn arrow_type_to_sql_and_kind(dt: &DataType) -> (&'static str, &'static str) {
        match dt {
            DataType::Int8 => ("TINYINT", "integer"),
            DataType::Int16 => ("SMALLINT", "integer"),
            DataType::Int32 => ("INTEGER", "integer"),
            DataType::Int64 => ("BIGINT", "integer"),
            DataType::UInt8 => ("UTINYINT", "integer"),
            DataType::UInt16 => ("USMALLINT", "integer"),
            DataType::UInt32 => ("UINTEGER", "integer"),
            DataType::UInt64 => ("UBIGINT", "integer"),
            DataType::Float16 | DataType::Float32 => ("FLOAT", "real"),
            DataType::Float64 => ("DOUBLE", "real"),
            DataType::Decimal128(..) | DataType::Decimal256(..) => ("DECIMAL", "real"),
            DataType::Utf8 | DataType::LargeUtf8 | DataType::Utf8View => ("VARCHAR", "text"),
            DataType::Boolean => ("BOOLEAN", "boolean"),
            DataType::Date32 | DataType::Date64 => ("DATE", "timestamp"),
            DataType::Time32(..) | DataType::Time64(..) => ("TIME", "timestamp"),
            DataType::Timestamp(..) => ("TIMESTAMP", "timestamp"),
            DataType::Binary | DataType::LargeBinary | DataType::BinaryView => ("BLOB", "blob"),
            _ => ("VARCHAR", "text"),
        }
    }

    /// Constructs SchemaDto from an Arrow Schema
    pub fn from_arrow_schema(schema: &ArrowSchema) -> SchemaDto {
        let mut columns = Vec::new();
        let mut column_metadata = HashMap::new();
        let mut column_types = HashMap::new();

        for field in schema.fields() {
            let col_name = field.name().clone();
            let (sql_type, kind) = Self::arrow_type_to_sql_and_kind(field.data_type());

            columns.push(col_name.clone());
            column_metadata.insert(
                col_name.clone(),
                ColumnMetadataDto {
                    display_name: col_name.clone(),
                    column_type: sql_type.to_string(),
                },
            );
            column_types.insert(col_name, kind.to_string());
        }

        SchemaDto {
            dialect: "duckdb".to_string(),
            columns,
            column_metadata,
            column_types,
        }
    }

    /// Constructs SchemaDto from a list of column names and SQL types
    pub fn from_column_types(cols: Vec<(String, String)>) -> SchemaDto {
        let mut columns = Vec::with_capacity(cols.len());
        let mut column_metadata = HashMap::with_capacity(cols.len());
        let mut column_types = HashMap::with_capacity(cols.len());

        for (name, sql_type) in cols {
            let kind = Self::duckdb_type_to_kind(&sql_type);
            columns.push(name.clone());
            column_metadata.insert(
                name.clone(),
                ColumnMetadataDto {
                    display_name: name.clone(),
                    column_type: sql_type.clone(),
                },
            );
            column_types.insert(name, kind.to_string());
        }

        SchemaDto {
            dialect: "duckdb".to_string(),
            columns,
            column_metadata,
            column_types,
        }
    }

    /// Creates toadSchema JSON metadata string for embedding into Arrow Schema metadata
    pub fn to_toad_schema_json(schema: &ArrowSchema) -> String {
        let dto = Self::from_arrow_schema(schema);
        let meta = ToadSchemaMetadata {
            version: 2,
            columns: dto.columns,
            column_metadata: dto.column_metadata,
        };
        serde_json::to_string(&meta).unwrap_or_else(|_| "{}".to_string())
    }

    /// Injects "toadSchema" and "application" metadata into Arrow Schema
    pub fn enrich_arrow_schema(schema: &ArrowSchema) -> ArrowSchema {
        let mut metadata = schema.metadata().clone();
        metadata.insert("toadSchema".to_string(), Self::to_toad_schema_json(schema));
        metadata.insert("application".to_string(), "Toad-Tauri-v2".to_string());

        ArrowSchema::new_with_metadata(schema.fields().clone(), metadata)
    }
}
