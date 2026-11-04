//! state.rs
//!
//! Shared Concurrency AppState for Toad Desktop (Tauri v2)
//! - Thread-safe access via Arc<RwLock<...>> on Tokio async runtime.
//! - Hosts configuration, portable environment paths, and engine stubs ready for M3-M5.

use crate::portable::{save_config, ToadConfig};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Placeholder for DuckDB engine connection pool (Milestone M3)
#[derive(Debug, Default, Clone)]
pub struct DuckDbEnginePlaceholder {
    pub initialized: bool,
    pub active_queries: usize,
}

/// Placeholder for Parquet Double-Valid State Ledger WAL (Milestone M4)
#[derive(Debug, Default, Clone)]
pub struct ParquetLedgerPlaceholder {
    pub initialized: bool,
    pub active_project_id: Option<String>,
}

/// Placeholder for Ingestion Queue & Forensics Scheduler (Milestone M5)
#[derive(Debug, Default, Clone)]
pub struct IngestionQueuePlaceholder {
    pub active_jobs: usize,
    pub pending_jobs: usize,
}

/// Core thread-safe application state managed by Tauri runtime
pub struct AppState {
    pub portable_dir: PathBuf,
    pub config_path: PathBuf,
    pub config: Arc<RwLock<ToadConfig>>,
    pub duckdb_engine: Arc<RwLock<DuckDbEnginePlaceholder>>,
    pub parquet_ledger: Arc<RwLock<ParquetLedgerPlaceholder>>,
    pub ingest_queue: Arc<RwLock<IngestionQueuePlaceholder>>,
}

impl AppState {
    /// Construct AppState from portable directory and initial config
    pub fn new(portable_dir: PathBuf, config: ToadConfig) -> Self {
        let config_path = portable_dir.join("config.ini");
        Self {
            portable_dir,
            config_path,
            config: Arc::new(RwLock::new(config)),
            duckdb_engine: Arc::new(RwLock::new(DuckDbEnginePlaceholder::default())),
            parquet_ledger: Arc::new(RwLock::new(ParquetLedgerPlaceholder::default())),
            ingest_queue: Arc::new(RwLock::new(IngestionQueuePlaceholder::default())),
        }
    }

    /// Read a clone of the current configuration snapshot
    pub async fn get_config(&self) -> ToadConfig {
        self.config.read().await.clone()
    }

    /// Update configuration in memory and persist to config.ini on disk
    pub async fn update_config<F>(&self, update_fn: F) -> std::io::Result<ToadConfig>
    where
        F: FnOnce(&mut ToadConfig),
    {
        let mut cfg = self.config.write().await;
        update_fn(&mut cfg);
        let snapshot = cfg.clone();
        save_config(&self.config_path, &snapshot)?;
        Ok(snapshot)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_app_state_concurrency() {
        let temp_dir = std::env::temp_dir().join("toad_test_state");
        let _ = std::fs::create_dir_all(&temp_dir);

        let initial_cfg = ToadConfig::default();
        let state = AppState::new(temp_dir.clone(), initial_cfg);

        // Read snapshot
        let cfg = state.get_config().await;
        assert_eq!(cfg.general.viewer, "toad");

        // Mutate and persist
        let updated = state
            .update_config(|c| {
                c.general.page_size = 2000;
                c.duckdb.threads = 4;
            })
            .await
            .unwrap();

        assert_eq!(updated.general.page_size, 2000);
        assert_eq!(updated.duckdb.threads, 4);

        let reread = state.get_config().await;
        assert_eq!(reread.general.page_size, 2000);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
