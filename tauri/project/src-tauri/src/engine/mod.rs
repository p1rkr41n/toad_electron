//! engine/mod.rs
//!
//! Native DuckDB Core Engine & Apache Arrow IPC Protocol for Toad Desktop
//!
//! Features:
//! - F07: In-process Tokio async DuckDB connection pool with dual-engine driver isolation
//! - F08: QueryExp Serde AST and recursive SQL generator
//! - F09: Vectorized Arrow IPC stream encoder (0xFFFFFFFF continuation marker)
//! - F10: Fast O(1) Parquet metadata footer row counter
//! - F11: reltab.Schema DTO and DuckDB type mappings
//! - F12: Column cardinality and summary statistics cache (TTL + LRU)

pub mod arrow_encoder;
pub mod duckdb_pool;
pub mod fast_count;
pub mod query_compiler;
pub mod schema_mapper;
pub mod stats_cache;

pub use arrow_encoder::ArrowIpcEncoder;
pub use duckdb_pool::DuckDbEnginePool;
pub use fast_count::FastCounter;
pub use query_compiler::{QueryExpCompiler, QueryRep};
pub use schema_mapper::{ColumnMetadataDto, SchemaDto, SchemaMapper, ToadSchemaMetadata};
pub use stats_cache::{ColumnStatsDto, ColumnStatsMap, StatsCache};
