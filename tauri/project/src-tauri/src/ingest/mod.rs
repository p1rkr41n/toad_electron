//! mod.rs
//!
//! Forensics & Ingestion Subsystem for Toad Desktop (Milestone M5 / Features F18-F22)
//!
//! Exposes:
//! - RFC-4180 CSV/TSV Delimiter Sniffer & Streaming Ingest (F18)
//! - EVTX Rust SIMD Binary Decoder (F19)
//! - JSONL / NDJSON Dynamic Schema Streamer (F20)
//! - Shortest-Job-First (SJF) Ingestion Scheduler & VIP Preemption (F21)
//! - Multi-Stage Progress Dispatcher (F22)
//! - Dirty Log Fallback Engine

pub mod csv_streamer;
pub mod dirty_log;
pub mod evtx_parser;
pub mod jsonl_streamer;
pub mod progress;
pub mod scheduler;

pub use csv_streamer::{ingest_csv_file, sniff_delimiter, CsvIngestResult};
pub use dirty_log::{ingest_dirty_log, DirtyLogResult};
pub use evtx_parser::{create_evtx_arrow_schema, ingest_evtx_file, EvtxIngestResult};
pub use jsonl_streamer::{ingest_jsonl_file, JsonlIngestResult};
pub use progress::{IngestProgressPayload, ProgressDispatcher};
pub use scheduler::{
    CancellationToken, IngestJob, IngestPriority, IngestQueueSnapshot, IngestStatus,
    IngestionScheduler,
};
