//! stats_cache.rs
//!
//! In-memory Column Cardinality & Summary Statistics Cache.
//! Caches column min/max, distinct count, and null percentage to accelerate UI rendering.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

// ============================================================================
// COLUMN STATS DTO
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "statsType")]
pub enum ColumnStatsDto {
    #[serde(rename = "numeric")]
    Numeric {
        min: Option<f64>,
        max: Option<f64>,
        #[serde(rename = "approxUnique")]
        approx_unique: Option<i64>,
        count: i64,
        #[serde(rename = "pctNull")]
        pct_null: Option<f64>,
    },
    #[serde(rename = "text")]
    Text {
        min: Option<f64>,
        max: Option<f64>,
        #[serde(rename = "approxUnique")]
        approx_unique: Option<i64>,
        count: i64,
        #[serde(rename = "pctNull")]
        pct_null: Option<f64>,
    },
}

pub type ColumnStatsMap = HashMap<String, ColumnStatsDto>;

#[derive(Debug, Clone)]
struct CacheEntry {
    stats: ColumnStatsMap,
    row_count: Option<i64>,
    created_at: Instant,
    last_accessed: Instant,
}

pub struct StatsCache {
    entries: RwLock<HashMap<String, CacheEntry>>,
    ttl: Duration,
    max_entries: usize,
}

impl StatsCache {
    pub fn new(ttl: Duration, max_entries: usize) -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
            ttl,
            max_entries,
        }
    }

    pub fn default_cache() -> Self {
        Self::new(Duration::from_secs(600), 256) // 10 min TTL, 256 entries
    }

    /// Retrieve cached statistics for a given table or query fingerprint
    pub async fn get(&self, key: &str) -> Option<ColumnStatsMap> {
        let mut map = self.entries.write().await;
        if let Some(entry) = map.get_mut(key) {
            if entry.created_at.elapsed() < self.ttl {
                entry.last_accessed = Instant::now();
                return Some(entry.stats.clone());
            } else {
                map.remove(key);
            }
        }
        None
    }

    /// Retrieve cached row count if available
    pub async fn get_row_count(&self, key: &str) -> Option<i64> {
        let mut map = self.entries.write().await;
        if let Some(entry) = map.get_mut(key) {
            if entry.created_at.elapsed() < self.ttl {
                entry.last_accessed = Instant::now();
                return entry.row_count;
            } else {
                map.remove(key);
            }
        }
        None
    }

    /// Store computed statistics in the cache
    pub async fn insert(&self, key: String, stats: ColumnStatsMap, row_count: Option<i64>) {
        let mut map = self.entries.write().await;
        if map.len() >= self.max_entries && !map.contains_key(&key) {
            // Evict oldest accessed entry
            if let Some(oldest_key) = map
                .iter()
                .min_by_key(|(_, v)| v.last_accessed)
                .map(|(k, _)| k.clone())
            {
                map.remove(&oldest_key);
            }
        }
        let now = Instant::now();
        map.insert(
            key,
            CacheEntry {
                stats,
                row_count,
                created_at: now,
                last_accessed: now,
            },
        );
    }

    /// Invalidate a specific cache entry
    pub async fn invalidate(&self, key: &str) {
        let mut map = self.entries.write().await;
        map.remove(key);
    }

    /// Clear all entries
    pub async fn clear(&self) {
        let mut map = self.entries.write().await;
        map.clear();
    }

    /// Current number of items in cache
    pub async fn len(&self) -> usize {
        self.entries.read().await.len()
    }

    /// Check if cache is empty
    pub async fn is_empty(&self) -> bool {
        self.entries.read().await.is_empty()
    }
}
