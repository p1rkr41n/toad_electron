//! parquet_ledger.rs
//!
//! Parquet State Ledger WAL & In-Memory Projection Engine (Milestone M4 / F13, F14, F17)
//! - Manages `toad_ledger.parquet` and `toad_ledger.parquet.bak` via Copy-on-Append WAL.
//! - Strongly typed 16-column schema with automatic backward compatibility for legacy columns.
//! - In-memory projection in `Arc<RwLock<LedgerState>>` for sub-millisecond query responses.
//! - Zero-cost project rename (preserves physical `temp/<project_id>/` directories).
//! - Cancellable 500ms debounced auto-recovery creating `Untitled-1` when all projects are deleted.

use arrow::array::{Array, Int32Array, Int64Array, LargeStringArray, StringArray};
use arrow::record_batch::RecordBatch;
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::{Mutex, RwLock};

use crate::engine::fast_count::FastCounter;
use crate::ledger::cache_cleaner::CacheCleaner;
use crate::ledger::tombstone::{
    create_file_deleted_event, create_project_deleted_event, create_project_renamed_event,
};
pub use crate::ledger::tombstone::current_time_ms;

/// Generate an RFC 4122 compliant UUID v4 string with zero external crate dependencies.
pub fn generate_uuid_v4() -> String {
    let mut bytes = [0u8; 16];
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let pid = std::process::id() as u128;
    let mut state = now ^ (pid << 48) ^ 0x243F6A8885A308D3;
    for chunk in bytes.chunks_mut(8) {
        state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        let b = state.to_le_bytes();
        chunk.copy_from_slice(&b[..chunk.len()]);
    }
    // Set version 4: bits 12-15 of time_hi_and_version to 0100
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    // Set variant: bits 6-7 of clock_seq_hi_and_reserved to 10
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5],
        bytes[6], bytes[7],
        bytes[8], bytes[9],
        bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
    )
}

/// Generate a 5-character lowercase alphanumeric project ID (`[a-z0-9]{5}`).
pub fn generate_project_id() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let pid = std::process::id() as u128;
    let seed = (now ^ (pid << 32) ^ 0x9E3779B97F4A7C15) as u64;

    const CHARSET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut suffix = String::with_capacity(5);
    let mut val = seed;
    for _ in 0..5 {
        let idx = (val % CHARSET.len() as u64) as usize;
        suffix.push(CHARSET[idx] as char);
        val /= CHARSET.len() as u64;
        val ^= (val << 13) | 0x5a5a5a5a;
    }
    suffix
}

/// Normalize path for consistent map lookup: lowercase with forward slashes
#[inline]
pub fn normalize_path(path: &str) -> String {
    path.replace('\\', "/").to_lowercase()
}

/// Parse metadata JSON for folder fields
fn parse_metadata_json(json_str: Option<&str>) -> (Option<String>, Option<String>, Option<String>) {
    if let Some(s) = json_str {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(s) {
            let root = val
                .get("folderRoot")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let name = val
                .get("folderName")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let rel = val
                .get("relPath")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            return (root, name, rel);
        }
    }
    (None, None, None)
}

/// 16-field strongly typed Parquet WAL Event Record
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LedgerEvent {
    pub event_id: String,
    pub event_type: String, // "PROJECT_CREATED", "PROJECT_RENAMED", "PROJECT_DELETED", "FILE_ADDED", "FILE_MODIFIED", "FILE_DELETED", "SNAPSHOT"
    pub timestamp: i64,
    pub project_id: String,
    pub project_name: Option<String>,
    pub file_id: Option<String>,
    pub file_path: Option<String>,
    pub file_size: Option<i64>,
    pub file_type: Option<String>,
    pub source_mtime: Option<i64>,
    pub parquet_path: Option<String>,
    pub parquet_size: Option<i64>,
    pub row_count: Option<i64>,
    pub status: Option<String>,
    pub duration_ms: Option<i64>,
    pub metadata_json: Option<String>,
}

/// In-memory project summary
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub project_id: String,
    pub project_name: String,
    pub status: String,
    pub created_at: i64,
    pub is_orphan: bool,
}

/// In-memory file descriptor
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub file_id: String,
    pub file_path: String,
    pub file_name: String,
    pub project_id: String,
    pub project_name: String,
    pub file_size: i64,
    pub row_count: i64,
    pub status: String,
    pub parquet_path: String,
    pub source_mtime: i64,
    pub folder_root: Option<String>,
    pub folder_name: Option<String>,
    pub rel_path: Option<String>,
}

/// In-memory state projection
#[derive(Debug, Default, Clone)]
pub struct LedgerState {
    pub active_project_id: String,
    pub projects: HashMap<String, ProjectInfo>, // Key: project_id
    pub files: HashMap<String, FileInfo>,       // Key: normalized file_path
}

/// Core Parquet State Ledger Manager
pub struct ParquetLedger {
    pub initialized: bool,
    pub active_project_id: Option<String>,
    pub ledger_path: PathBuf,
    pub backup_path: PathBuf,
    pub temp_dir: PathBuf,
    pub logs_dir: PathBuf,
    pub state: Arc<RwLock<LedgerState>>,
    write_lock: Arc<Mutex<()>>,
    debounce_cancel: Arc<std::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>>,
}

impl Default for ParquetLedger {
    fn default() -> Self {
        let default_dir = std::env::temp_dir().join("toad_default_appdata");
        Self {
            initialized: false,
            active_project_id: None,
            ledger_path: default_dir.join("toad_ledger.parquet"),
            backup_path: default_dir.join("toad_ledger.parquet.bak"),
            temp_dir: default_dir.join("temp"),
            logs_dir: default_dir.join("logs"),
            state: Arc::new(RwLock::new(LedgerState::default())),
            write_lock: Arc::new(Mutex::new(())),
            debounce_cancel: Arc::new(std::sync::Mutex::new(None)),
        }
    }
}

impl ParquetLedger {
    /// Construct a new ParquetLedger targeting the specified app data directory and load existing state
    pub fn new(app_data_dir: PathBuf) -> Self {
        let ledger_path = app_data_dir.join("toad_ledger.parquet");
        let backup_path = app_data_dir.join("toad_ledger.parquet.bak");
        let temp_dir = app_data_dir.join("temp");
        let logs_dir = app_data_dir.join("logs");

        let mut st = LedgerState::default();
        if ledger_path.exists() {
            if let Ok(events) = read_all_events_from_parquet(&ledger_path) {
                apply_events_to_state(&events, &mut st);
            }
        }
        let active_id = if st.active_project_id.is_empty() {
            st.projects.keys().next().cloned()
        } else {
            Some(st.active_project_id.clone())
        };

        Self {
            initialized: true,
            active_project_id: active_id,
            ledger_path,
            backup_path,
            temp_dir,
            logs_dir,
            state: Arc::new(RwLock::new(st)),
            write_lock: Arc::new(Mutex::new(())),
            debounce_cancel: Arc::new(std::sync::Mutex::new(None)),
        }
    }

    /// Reconfigure paths if initialized via default
    pub fn configure_paths(&mut self, app_data_dir: &Path) {
        self.ledger_path = app_data_dir.join("toad_ledger.parquet");
        self.backup_path = app_data_dir.join("toad_ledger.parquet.bak");
        self.temp_dir = app_data_dir.join("temp");
        self.logs_dir = app_data_dir.join("logs");
    }

    /// Read an in-memory snapshot of the workspace
    pub async fn get_workspace(&self) -> (String, Vec<ProjectWorkspaceProjectDto>) {
        let state = self.state.read().await;
        let mut projects = Vec::new();

        for (pid, prj) in &state.projects {
            // Calculate file count and total bytes for this project
            let mut file_count = 0;
            let mut total_bytes = 0u64;
            for f in state.files.values() {
                if &f.project_id == pid && f.status != "DELETED" {
                    file_count += 1;
                    total_bytes += f.file_size.max(0) as u64;
                }
            }

            projects.push(ProjectWorkspaceProjectDto {
                project_id: pid.clone(),
                project_name: prj.project_name.clone(),
                status: prj.status.clone(),
                created_at: prj.created_at,
                is_orphan: Some(prj.is_orphan),
                file_count,
                total_bytes,
                id: Some(pid.clone()),
                name: Some(prj.project_name.clone()),
                files_count: Some(file_count),
            });
        }

        // Sort projects by createdAt ascending
        projects.sort_by_key(|p| p.created_at);

        let active_id = if state.projects.contains_key(&state.active_project_id) {
            state.active_project_id.clone()
        } else {
            projects
                .first()
                .map(|p| p.project_id.clone())
                .unwrap_or_else(|| "default".to_string())
        };

        (active_id, projects)
    }

    /// Read active files for a specific project
    pub async fn get_project_files(&self, project_id: &str) -> Vec<ProjectWorkspaceFileDto> {
        let state = self.state.read().await;
        let mut files = Vec::new();

        for f in state.files.values() {
            if f.project_id == project_id && f.status != "DELETED" {
                files.push(ProjectWorkspaceFileDto {
                    file_path: f.file_path.clone(),
                    file_name: f.file_name.clone(),
                    project_id: f.project_id.clone(),
                    project_name: f.project_name.clone(),
                    file_size_bytes: f.file_size,
                    row_count: f.row_count,
                    status: f.status.clone(),
                    parquet_path: f.parquet_path.clone(),
                    folder_root: f.folder_root.clone(),
                    folder_name: f.folder_name.clone(),
                    rel_path: f.rel_path.clone(),
                });
            }
        }

        files.sort_by(|a, b| a.file_name.cmp(&b.file_name));
        files
    }

    /// Create a new project with 5-character ID or custom ID
    pub async fn create_project(
        &self,
        project_name: &str,
        custom_id: Option<String>,
    ) -> Result<String, String> {
        // Cancel any pending 500ms debounce auto-recovery
        self.cancel_debounce_recovery();

        let pid = custom_id.unwrap_or_else(generate_project_id);
        let now_ms = current_time_ms();
        let name = if project_name.trim().is_empty() {
            "Untitled-1"
        } else {
            project_name.trim()
        };

        let ev = LedgerEvent {
            event_id: generate_uuid_v4(),
            event_type: "PROJECT_CREATED".to_string(),
            timestamp: now_ms,
            project_id: pid.clone(),
            project_name: Some(name.to_string()),
            file_id: None,
            file_path: None,
            file_size: None,
            file_type: None,
            source_mtime: None,
            parquet_path: None,
            parquet_size: None,
            row_count: None,
            status: Some("READY".to_string()),
            duration_ms: None,
            metadata_json: Some("{}".to_string()),
        };

        // Create physical temp partition
        let prj_dir = self.temp_dir.join(&pid);
        let _ = fs::create_dir_all(&prj_dir);

        // Commit to disk first
        self.append_events(&[ev.clone()]).await?;

        // Update memory
        {
            let mut state = self.state.write().await;
            state.projects.insert(
                pid.clone(),
                ProjectInfo {
                    project_id: pid.clone(),
                    project_name: name.to_string(),
                    status: "READY".to_string(),
                    created_at: now_ms,
                    is_orphan: pid == "orphan_prj",
                },
            );
            state.active_project_id = pid.clone();
        }

        Ok(pid)
    }

    /// Zero-cost in-place metadata rename (physical directory untouched)
    pub async fn rename_project(&self, project_id: &str, new_name: &str) -> Result<bool, String> {
        if project_id == "orphan_prj" || new_name.trim().is_empty() {
            return Err("Cannot rename orphan project or use empty name".to_string());
        }

        let ev = create_project_renamed_event(project_id, new_name.trim());
        self.append_events(&[ev]).await?;

        {
            let mut state = self.state.write().await;
            if let Some(p) = state.projects.get_mut(project_id) {
                p.project_name = new_name.trim().to_string();
            }
            // Update project_name for all associated files in memory
            for f in state.files.values_mut() {
                if f.project_id == project_id {
                    f.project_name = new_name.trim().to_string();
                }
            }
        }

        Ok(true)
    }

    /// Delete project with cascade cache cleanup and typed NULL tombstone
    pub async fn delete_project(&self, project_id: &str) -> Result<(usize, u64), String> {
        let (project_name, file_tombstones, file_count, freed_bytes) = {
            let state = self.state.read().await;
            let prj = state
                .projects
                .get(project_id)
                .ok_or_else(|| format!("Project '{}' not found", project_id))?;
            let prj_name = prj.project_name.clone();

            let mut tombstones = Vec::new();
            let mut count = 0;
            let mut bytes = 0u64;

            for f in state.files.values() {
                if f.project_id == project_id && f.status != "DELETED" {
                    tombstones.push(create_file_deleted_event(
                        project_id,
                        &f.file_id,
                        &f.file_path,
                    ));
                    count += 1;
                    bytes += f.file_size.max(0) as u64;
                }
            }
            (prj_name, tombstones, count, bytes)
        };

        // Create PROJECT_DELETED tombstone
        let prj_tombstone = create_project_deleted_event(project_id, Some(&project_name));

        let mut events_to_write = file_tombstones;
        events_to_write.push(prj_tombstone);

        // Commit tombstones to disk WAL
        self.append_events(&events_to_write).await?;

        // Update in-memory state
        let remaining_count = {
            let mut state = self.state.write().await;
            state.projects.remove(project_id);
            state.files.retain(|_, f| f.project_id != project_id);
            if state.active_project_id == project_id {
                state.active_project_id =
                    state.projects.keys().next().cloned().unwrap_or_default();
            }
            state.projects.len()
        };

        // Cascade purge cache files for project off-lock
        let temp_dir = self.temp_dir.clone();
        let pid = project_id.to_string();
        tokio::task::spawn_blocking(move || {
            let _ = CacheCleaner::purge_project_cache(&temp_dir, &pid);
        });

        // If 0 active projects remain, trigger 500ms debounce auto-recovery
        if remaining_count == 0 {
            self.schedule_debounce_recovery();
        }

        Ok((file_count, freed_bytes))
    }

    /// Delete all projects and compact/reset ledger to 0 rows
    pub async fn delete_all_projects(&self) -> Result<(usize, u64), String> {
        let (project_count, total_bytes) = {
            let state = self.state.read().await;
            let count = state.projects.len();
            let bytes = state
                .files
                .values()
                .map(|f| f.file_size.max(0) as u64)
                .sum::<u64>();
            (count, bytes)
        };

        // Purge all physical cache partitions
        let temp_dir = self.temp_dir.clone();
        tokio::task::spawn_blocking(move || {
            let _ = CacheCleaner::purge_all_caches(&temp_dir);
        });

        // Compact reset ledger WAL to a clean 0-row Parquet file
        self.compact_reset_ledger().await?;

        // Clear in-memory projection
        {
            let mut state = self.state.write().await;
            state.projects.clear();
            state.files.clear();
            state.active_project_id.clear();
        }

        // Schedule 500ms debounce auto-recovery to regenerate Untitled-1
        self.schedule_debounce_recovery();

        Ok((project_count, total_bytes))
    }

    /// Add files to project and register them in the ledger
    pub async fn add_files_to_project(
        &self,
        project_id: &str,
        file_paths: Vec<String>,
    ) -> Result<Vec<ProjectWorkspaceFileDto>, String> {
        let prj_name = {
            let state = self.state.read().await;
            state
                .projects
                .get(project_id)
                .map(|p| p.project_name.clone())
                .unwrap_or_else(|| "Untitled-1".to_string())
        };

        let now_ms = current_time_ms();
        let mut new_events = Vec::new();
        let mut result_dtos = Vec::new();

        for fp in file_paths {
            let path = Path::new(&fp);
            let meta = fs::metadata(path).ok();
            let size = meta.as_ref().map(|m| m.len() as i64).unwrap_or(0);
            let mtime = meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(now_ms);

            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("file");

            // Compute row count if it's already a Parquet file
            let row_count = if ext == "parquet" && path.exists() {
                FastCounter::count_parquet_rows(path).unwrap_or(0)
            } else {
                0
            };

            let path_hash = (mtime ^ (size << 16) ^ 0x5a5a5a5a) as u32;
            let cache_name = format!("{}_cached_{:08x}.parquet", stem, path_hash);
            let parquet_path = self.temp_dir.join(project_id).join(&cache_name);
            let parquet_path_str = parquet_path.to_string_lossy().to_string();

            let file_id = generate_uuid_v4();
            let file_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            let ev = LedgerEvent {
                event_id: generate_uuid_v4(),
                event_type: "FILE_ADDED".to_string(),
                timestamp: now_ms,
                project_id: project_id.to_string(),
                project_name: Some(prj_name.clone()),
                file_id: Some(file_id.clone()),
                file_path: Some(fp.clone()),
                file_size: Some(size),
                file_type: Some(ext),
                source_mtime: Some(mtime),
                parquet_path: Some(parquet_path_str.clone()),
                parquet_size: Some(0),
                row_count: Some(row_count),
                status: Some("READY".to_string()),
                duration_ms: Some(0),
                metadata_json: Some("{}".to_string()),
            };

            result_dtos.push(ProjectWorkspaceFileDto {
                file_path: fp.clone(),
                file_name: file_name.clone(),
                project_id: project_id.to_string(),
                project_name: prj_name.clone(),
                file_size_bytes: size,
                row_count,
                status: "READY".to_string(),
                parquet_path: parquet_path_str.clone(),
                folder_root: None,
                folder_name: None,
                rel_path: None,
            });

            new_events.push(ev);
        }

        // Commit to disk first
        self.append_events(&new_events).await?;

        // Update in-memory state
        {
            let mut state = self.state.write().await;
            apply_events_to_state(&new_events, &mut state);
        }

        Ok(result_dtos)
    }

    /// Add folder recursively to project
    pub async fn add_folder_to_project(
        &self,
        project_id: &str,
        folder_path: &str,
    ) -> Result<Vec<ProjectWorkspaceFileDto>, String> {
        let root = Path::new(folder_path);
        if !root.exists() || !root.is_dir() {
            return Err(format!("Folder '{}' does not exist or is not a directory", folder_path));
        }

        let folder_name = root
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        let mut discovered = Vec::new();
        let supported_exts: HashSet<&'static str> =
            ["csv", "tsv", "parquet", "evtx", "jsonl", "ndjson"]
                .into_iter()
                .collect();

        fn scan_dir(dir: &Path, root: &Path, exts: &HashSet<&'static str>, out: &mut Vec<(PathBuf, String)>) {
            if let Ok(entries) = fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.is_dir() {
                        scan_dir(&p, root, exts, out);
                    } else if p.is_file() {
                        if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                            if exts.contains(ext.to_lowercase().as_str()) {
                                let rel = p
                                    .strip_prefix(root)
                                    .ok()
                                    .map(|r| r.to_string_lossy().to_string())
                                    .unwrap_or_default();
                                out.push((p, rel));
                            }
                        }
                    }
                }
            }
        }

        scan_dir(root, root, &supported_exts, &mut discovered);

        let prj_name = {
            let state = self.state.read().await;
            state
                .projects
                .get(project_id)
                .map(|p| p.project_name.clone())
                .unwrap_or_else(|| "Untitled-1".to_string())
        };

        let now_ms = current_time_ms();
        let mut new_events = Vec::new();
        let mut result_dtos = Vec::new();

        for (p, rel) in discovered {
            let fp = p.to_string_lossy().to_string();
            let meta = fs::metadata(&p).ok();
            let size = meta.as_ref().map(|m| m.len() as i64).unwrap_or(0);
            let mtime = meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(now_ms);

            let ext = p
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            let stem = p
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("file");

            let row_count = if ext == "parquet" && p.exists() {
                FastCounter::count_parquet_rows(&p).unwrap_or(0)
            } else {
                0
            };

            let path_hash = (mtime ^ (size << 16) ^ 0x5a5a5a5a) as u32;
            let cache_name = format!("{}_cached_{:08x}.parquet", stem, path_hash);
            let parquet_path = self.temp_dir.join(project_id).join(&cache_name);
            let parquet_path_str = parquet_path.to_string_lossy().to_string();

            let file_id = generate_uuid_v4();
            let file_name = p
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            let meta_json = serde_json::json!({
                "folderRoot": folder_path,
                "folderName": folder_name,
                "relPath": rel
            })
            .to_string();

            let ev = LedgerEvent {
                event_id: generate_uuid_v4(),
                event_type: "FILE_ADDED".to_string(),
                timestamp: now_ms,
                project_id: project_id.to_string(),
                project_name: Some(prj_name.clone()),
                file_id: Some(file_id.clone()),
                file_path: Some(fp.clone()),
                file_size: Some(size),
                file_type: Some(ext),
                source_mtime: Some(mtime),
                parquet_path: Some(parquet_path_str.clone()),
                parquet_size: Some(0),
                row_count: Some(row_count),
                status: Some("READY".to_string()),
                duration_ms: Some(0),
                metadata_json: Some(meta_json),
            };

            result_dtos.push(ProjectWorkspaceFileDto {
                file_path: fp.clone(),
                file_name,
                project_id: project_id.to_string(),
                project_name: prj_name.clone(),
                file_size_bytes: size,
                row_count,
                status: "READY".to_string(),
                parquet_path: parquet_path_str,
                folder_root: Some(folder_path.to_string()),
                folder_name: Some(folder_name.clone()),
                rel_path: Some(rel),
            });

            new_events.push(ev);
        }

        // Commit to disk first
        self.append_events(&new_events).await?;

        // Update in-memory state
        {
            let mut state = self.state.write().await;
            apply_events_to_state(&new_events, &mut state);
        }

        Ok(result_dtos)
    }

    /// Remove single file from project catalog
    pub async fn remove_file_from_project(
        &self,
        project_id: &str,
        file_path: &str,
    ) -> Result<u64, String> {
        let norm = normalize_path(file_path);
        let (file_id, file_size, parquet_path) = {
            let state = self.state.read().await;
            let f = state
                .files
                .get(&norm)
                .ok_or_else(|| format!("File '{}' not found in workspace", file_path))?;
            (f.file_id.clone(), f.file_size.max(0) as u64, f.parquet_path.clone())
        };

        let ev = create_file_deleted_event(project_id, &file_id, file_path);
        self.append_events(&[ev]).await?;

        {
            let mut state = self.state.write().await;
            state.files.remove(&norm);
        }

        // Delete cached parquet if exists
        if !parquet_path.is_empty() {
            let path = PathBuf::from(parquet_path);
            if path.exists() {
                tokio::task::spawn_blocking(move || {
                    let _ = fs::remove_file(path);
                });
            }
        }

        Ok(file_size)
    }

    /// Set active project
    pub async fn set_active_project(&self, project_id: &str) -> Result<(), String> {
        let mut state = self.state.write().await;
        if !state.projects.contains_key(project_id) && project_id != "default" {
            return Err(format!("Project '{}' does not exist", project_id));
        }
        state.active_project_id = project_id.to_string();
        Ok(())
    }

    /// Move orphan files to target project
    pub async fn move_orphan_files(
        &self,
        target_project_id: Option<String>,
    ) -> Result<usize, String> {
        let target_pid = {
            let state = self.state.read().await;
            target_project_id
                .or_else(|| Some(state.active_project_id.clone()))
                .filter(|id| !id.is_empty())
                .unwrap_or_else(|| "default".to_string())
        };

        let now_ms = current_time_ms();
        let mut move_events = Vec::new();

        {
            let state = self.state.read().await;
            for f in state.files.values() {
                if f.project_id == "orphan_prj" {
                    let ev = LedgerEvent {
                        event_id: generate_uuid_v4(),
                        event_type: "FILE_MODIFIED".to_string(),
                        timestamp: now_ms,
                        project_id: target_pid.clone(),
                        project_name: None,
                        file_id: Some(f.file_id.clone()),
                        file_path: Some(f.file_path.clone()),
                        file_size: Some(f.file_size),
                        file_type: None,
                        source_mtime: Some(f.source_mtime),
                        parquet_path: Some(f.parquet_path.clone()),
                        parquet_size: None,
                        row_count: Some(f.row_count),
                        status: Some("READY".to_string()),
                        duration_ms: None,
                        metadata_json: None,
                    };
                    move_events.push(ev);
                }
            }
        }

        let moved_count = move_events.len();
        if moved_count > 0 {
            self.append_events(&move_events).await?;
            let mut state = self.state.write().await;
            apply_events_to_state(&move_events, &mut state);
        }

        Ok(moved_count)
    }

    /// Get total cache size and count for project
    pub async fn get_cache_size(&self, project_id: &str) -> (usize, u64, String) {
        let prj_dir = self.temp_dir.join(project_id);
        if !prj_dir.exists() {
            return (0, 0, "0 B".to_string());
        }

        let mut count = 0;
        let mut bytes = 0u64;

        if let Ok(entries) = fs::read_dir(&prj_dir) {
            for entry in entries.flatten() {
                if let Ok(meta) = entry.metadata() {
                    if meta.is_file() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if name.ends_with(".parquet") {
                            count += 1;
                            bytes += meta.len();
                        }
                    }
                }
            }
        }

        let formatted = format_byte_size(bytes);
        (count, bytes, formatted)
    }

    /// Purge cache files for project (retaining source file registrations in ledger)
    pub async fn purge_cache(&self, project_id: &str) -> Result<(usize, u64), String> {
        let res = CacheCleaner::purge_project_cache(&self.temp_dir, project_id)
            .map_err(|e| format!("Purge cache error: {}", e))?;

        // Mark files as MODIFIED or PENDING in ledger to indicate cache was wiped
        let now_ms = current_time_ms();
        let mut mod_events = Vec::new();
        {
            let state = self.state.read().await;
            for f in state.files.values() {
                if f.project_id == project_id && f.status != "DELETED" {
                    let ev = LedgerEvent {
                        event_id: generate_uuid_v4(),
                        event_type: "FILE_MODIFIED".to_string(),
                        timestamp: now_ms,
                        project_id: project_id.to_string(),
                        project_name: None,
                        file_id: Some(f.file_id.clone()),
                        file_path: Some(f.file_path.clone()),
                        file_size: Some(f.file_size),
                        file_type: None,
                        source_mtime: Some(f.source_mtime),
                        parquet_path: Some(String::new()),
                        parquet_size: Some(0),
                        row_count: Some(f.row_count),
                        status: Some("MODIFIED".to_string()),
                        duration_ms: None,
                        metadata_json: None,
                    };
                    mod_events.push(ev);
                }
            }
        }

        if !mod_events.is_empty() {
            self.append_events(&mod_events).await?;
            let mut state = self.state.write().await;
            apply_events_to_state(&mod_events, &mut state);
        }

        Ok((res.purged_files, res.freed_bytes))
    }

    /// Append events to Parquet WAL via Copy-on-Append with atomic rename
    pub async fn append_events(&self, events: &[LedgerEvent]) -> Result<(), String> {
        if events.is_empty() {
            return Ok(());
        }

        let _lock = self.write_lock.lock().await;
        let ledger_path = self.ledger_path.clone();
        let backup_path = self.backup_path.clone();
        let evs = events.to_vec();

        tokio::task::spawn_blocking(move || {
            write_events_to_parquet(&ledger_path, &backup_path, &evs)
        })
        .await
        .map_err(|e| format!("Join error during WAL append: {}", e))?
    }

    /// Reset ledger WAL to a 0-row clean Parquet file
    pub async fn compact_reset_ledger(&self) -> Result<(), String> {
        let _lock = self.write_lock.lock().await;
        let ledger_path = self.ledger_path.clone();
        let backup_path = self.backup_path.clone();

        tokio::task::spawn_blocking(move || {
            let conn = duckdb::Connection::open_in_memory()
                .map_err(|e| format!("DuckDB open error: {}", e))?;

            conn.execute(
                "CREATE TABLE empty_ledger (
                    event_id VARCHAR,
                    event_type VARCHAR,
                    timestamp BIGINT,
                    project_id VARCHAR,
                    project_name VARCHAR,
                    file_id VARCHAR,
                    file_path VARCHAR,
                    file_size BIGINT,
                    file_type VARCHAR,
                    source_mtime BIGINT,
                    parquet_path VARCHAR,
                    parquet_size BIGINT,
                    row_count BIGINT,
                    status VARCHAR,
                    duration_ms BIGINT,
                    metadata_json VARCHAR
                );",
                [],
            )
            .map_err(|e| format!("Create empty table error: {}", e))?;

            let tmp_path = ledger_path
                .parent()
                .unwrap_or(Path::new("."))
                .join(format!("toad_ledger.parquet.tmp_reset_{}", current_time_ms()));
            let tmp_str = tmp_path
                .to_str()
                .ok_or("Invalid path")?
                .replace('\\', "/")
                .replace('\'', "''");

            conn.execute(
                &format!(
                    "COPY (SELECT * FROM empty_ledger) TO '{}' (FORMAT PARQUET, COMPRESSION 'SNAPPY');",
                    tmp_str
                ),
                [],
            )
            .map_err(|e| format!("COPY empty error: {}", e))?;

            fs::rename(&tmp_path, &ledger_path)
                .or_else(|_| fs::copy(&tmp_path, &ledger_path).map(|_| ()))
                .map_err(|e| format!("Replace ledger error: {}", e))?;

            let _ = fs::remove_file(&tmp_path);
            let _ = fs::copy(&ledger_path, &backup_path);

            Ok(())
        })
        .await
        .map_err(|e| format!("Join error: {}", e))?
    }

    /// Cancel any pending 500ms debounce auto-recovery task
    fn cancel_debounce_recovery(&self) {
        if let Ok(mut slot) = self.debounce_cancel.lock() {
            if let Some(tx) = slot.take() {
                let _ = tx.send(());
            }
        }
    }

    /// Schedule 500ms debounced auto-recovery task
    fn schedule_debounce_recovery(&self) {
        let (tx, rx) = tokio::sync::oneshot::channel();
        if let Ok(mut slot) = self.debounce_cancel.lock() {
            if let Some(old_tx) = slot.take() {
                let _ = old_tx.send(());
            }
            *slot = Some(tx);
        }

        let state_arc = self.state.clone();
        let ledger_path = self.ledger_path.clone();
        let backup_path = self.backup_path.clone();
        let temp_dir = self.temp_dir.clone();

        tokio::spawn(async move {
            tokio::select! {
                _ = tokio::time::sleep(tokio::time::Duration::from_millis(500)) => {
                    let mut state = state_arc.write().await;
                    if state.projects.is_empty() {
                        let new_id = generate_project_id();
                        let now_ms = current_time_ms();
                        let ev = LedgerEvent {
                            event_id: generate_uuid_v4(),
                            event_type: "PROJECT_CREATED".to_string(),
                            timestamp: now_ms,
                            project_id: new_id.clone(),
                            project_name: Some("Untitled-1".to_string()),
                            file_id: None,
                            file_path: None,
                            file_size: None,
                            file_type: None,
                            source_mtime: None,
                            parquet_path: None,
                            parquet_size: None,
                            row_count: None,
                            status: Some("READY".to_string()),
                            duration_ms: None,
                            metadata_json: Some("{}".to_string()),
                        };
                        let prj_dir = temp_dir.join(&new_id);
                        let _ = fs::create_dir_all(&prj_dir);

                        let lp = ledger_path.clone();
                        let bp = backup_path.clone();
                        let ev_clone = ev.clone();
                        let _ = tokio::task::spawn_blocking(move || {
                            write_events_to_parquet(&lp, &bp, &[ev_clone])
                        }).await;

                        state.projects.insert(
                            new_id.clone(),
                            ProjectInfo {
                                project_id: new_id.clone(),
                                project_name: "Untitled-1".to_string(),
                                status: "READY".to_string(),
                                created_at: now_ms,
                                is_orphan: false,
                            },
                        );
                        state.active_project_id = new_id;
                    }
                }
                _ = rx => {
                    // Cancelled: a new project was created within 500ms
                }
            }
        });
    }
}

/// Helper to write events to Parquet WAL via DuckDB
pub fn write_events_to_parquet(
    ledger_path: &Path,
    backup_path: &Path,
    events: &[LedgerEvent],
) -> Result<(), String> {
    if let Some(parent) = ledger_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let conn = duckdb::Connection::open_in_memory()
        .map_err(|e| format!("DuckDB open error: {}", e))?;

    // Create table with 16 strongly typed columns
    conn.execute(
        "CREATE TABLE new_events (
            event_id VARCHAR,
            event_type VARCHAR,
            timestamp BIGINT,
            project_id VARCHAR,
            project_name VARCHAR,
            file_id VARCHAR,
            file_path VARCHAR,
            file_size BIGINT,
            file_type VARCHAR,
            source_mtime BIGINT,
            parquet_path VARCHAR,
            parquet_size BIGINT,
            row_count BIGINT,
            status VARCHAR,
            duration_ms BIGINT,
            metadata_json VARCHAR
        );",
        [],
    )
    .map_err(|e| format!("Create table error: {}", e))?;

    let mut stmt = conn
        .prepare("INSERT INTO new_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);")
        .map_err(|e| format!("Prepare insert error: {}", e))?;

    for ev in events {
        stmt.execute(duckdb::params![
            ev.event_id,
            ev.event_type,
            ev.timestamp,
            ev.project_id,
            ev.project_name,
            ev.file_id,
            ev.file_path,
            ev.file_size,
            ev.file_type,
            ev.source_mtime,
            ev.parquet_path,
            ev.parquet_size,
            ev.row_count,
            ev.status,
            ev.duration_ms,
            ev.metadata_json,
        ])
        .map_err(|e| format!("Execute insert error: {}", e))?;
    }

    let tmp_name = format!(
        "toad_ledger.parquet.tmp_{}_{}",
        current_time_ms(),
        generate_project_id()
    );
    let tmp_path = ledger_path
        .parent()
        .unwrap_or(Path::new("."))
        .join(&tmp_name);
    let tmp_str = tmp_path
        .to_str()
        .ok_or("Invalid tmp path")?
        .replace('\\', "/")
        .replace('\'', "''");

    if ledger_path.exists()
        && fs::metadata(ledger_path)
            .map(|m| m.len() > 0)
            .unwrap_or(false)
    {
        let ledger_str = ledger_path
            .to_str()
            .ok_or("Invalid ledger path")?
            .replace('\\', "/")
            .replace('\'', "''");

        // Dynamically inspect existing column names for backward compatibility
        let describe_sql = format!(
            "DESCRIBE SELECT * FROM read_parquet('{}') LIMIT 0;",
            ledger_str
        );
        let mut d_stmt = conn
            .prepare(&describe_sql)
            .map_err(|e| format!("Describe error: {}", e))?;
        let mut d_rows = d_stmt
            .query([])
            .map_err(|e| format!("Describe query error: {}", e))?;

        let mut cols = HashSet::new();
        while let Ok(Some(row)) = d_rows.next() {
            let col: String = row.get(0).unwrap_or_default();
            cols.insert(col.to_lowercase());
        }

        let file_path_sel = if cols.contains("file_path") {
            "file_path"
        } else if cols.contains("source_path") {
            "source_path AS file_path"
        } else {
            "CAST(NULL AS VARCHAR) AS file_path"
        };

        let file_size_sel = if cols.contains("file_size") {
            "file_size"
        } else if cols.contains("source_size") {
            "source_size AS file_size"
        } else {
            "CAST(NULL AS BIGINT) AS file_size"
        };

        let meta_sel = if cols.contains("metadata_json") {
            "metadata_json"
        } else if cols.contains("extra_json") {
            "extra_json AS metadata_json"
        } else {
            "CAST(NULL AS VARCHAR) AS metadata_json"
        };

        let copy_sql = format!(
            "COPY (
                SELECT
                    event_id,
                    event_type,
                    timestamp,
                    project_id,
                    project_name,
                    file_id,
                    {},
                    {},
                    file_type,
                    source_mtime,
                    parquet_path,
                    parquet_size,
                    row_count,
                    status,
                    duration_ms,
                    {}
                FROM read_parquet('{}')
                UNION ALL
                SELECT * FROM new_events
            ) TO '{}' (FORMAT PARQUET, COMPRESSION 'SNAPPY');",
            file_path_sel, file_size_sel, meta_sel, ledger_str, tmp_str
        );

        conn.execute(&copy_sql, [])
            .map_err(|e| format!("COPY union error: {}", e))?;
    } else {
        let copy_sql = format!(
            "COPY (SELECT * FROM new_events) TO '{}' (FORMAT PARQUET, COMPRESSION 'SNAPPY');",
            tmp_str
        );
        conn.execute(&copy_sql, [])
            .map_err(|e| format!("COPY fresh error: {}", e))?;
    }

    // Atomic rename with backoff retries for Windows file locking
    let mut renamed = false;
    for attempt in 0..4 {
        if fs::rename(&tmp_path, ledger_path).is_ok() {
            renamed = true;
            break;
        }
        if attempt < 3 {
            std::thread::sleep(std::time::Duration::from_millis(25 << attempt));
        }
    }

    if !renamed {
        fs::copy(&tmp_path, ledger_path).map_err(|e| format!("Fallback copy error: {}", e))?;
        let _ = fs::remove_file(&tmp_path);
    }

    // Mirror to dual-valid backup
    let _ = fs::copy(ledger_path, backup_path);

    Ok(())
}

enum CachedStringCol<'a> {
    Utf8(&'a StringArray),
    LargeUtf8(&'a LargeStringArray),
}

impl<'a> CachedStringCol<'a> {
    #[inline]
    fn get(&self, row: usize) -> Option<String> {
        match self {
            Self::Utf8(arr) => {
                if arr.is_null(row) {
                    None
                } else {
                    Some(arr.value(row).to_string())
                }
            }
            Self::LargeUtf8(arr) => {
                if arr.is_null(row) {
                    None
                } else {
                    Some(arr.value(row).to_string())
                }
            }
        }
    }
}

enum CachedI64Col<'a> {
    I64(&'a Int64Array),
    I32(&'a Int32Array),
}

impl<'a> CachedI64Col<'a> {
    #[inline]
    fn get(&self, row: usize) -> Option<i64> {
        match self {
            Self::I64(arr) => {
                if arr.is_null(row) {
                    None
                } else {
                    Some(arr.value(row))
                }
            }
            Self::I32(arr) => {
                if arr.is_null(row) {
                    None
                } else {
                    Some(arr.value(row) as i64)
                }
            }
        }
    }
}

#[inline]
fn get_string_array<'a>(batch: &'a RecordBatch, col_idx: Option<usize>) -> Option<CachedStringCol<'a>> {
    let idx = col_idx?;
    if idx >= batch.num_columns() {
        return None;
    }
    let col = batch.column(idx);
    if let Some(arr) = col.as_any().downcast_ref::<StringArray>() {
        Some(CachedStringCol::Utf8(arr))
    } else if let Some(arr) = col.as_any().downcast_ref::<LargeStringArray>() {
        Some(CachedStringCol::LargeUtf8(arr))
    } else {
        None
    }
}

#[inline]
fn get_i64_array<'a>(batch: &'a RecordBatch, col_idx: Option<usize>) -> Option<CachedI64Col<'a>> {
    let idx = col_idx?;
    if idx >= batch.num_columns() {
        return None;
    }
    let col = batch.column(idx);
    if let Some(arr) = col.as_any().downcast_ref::<Int64Array>() {
        Some(CachedI64Col::I64(arr))
    } else if let Some(arr) = col.as_any().downcast_ref::<Int32Array>() {
        Some(CachedI64Col::I32(arr))
    } else {
        None
    }
}

/// Read all events from Parquet WAL via native Rust Parquet / Arrow reader (< 0.5ms)
pub fn read_all_events_from_parquet(ledger_path: &Path) -> Result<Vec<LedgerEvent>, String> {
    if !ledger_path.exists()
        || fs::metadata(ledger_path)
            .map(|m| m.len() == 0)
            .unwrap_or(true)
    {
        return Ok(Vec::new());
    }

    let file = fs::File::open(ledger_path)
        .map_err(|e| format!("Failed to open ledger file: {}", e))?;

    let builder = ParquetRecordBatchReaderBuilder::try_new(file)
        .map_err(|e| format!("ParquetRecordBatchReaderBuilder error: {}", e))?;

    let schema = builder.schema();
    let mut col_map: HashMap<String, usize> = HashMap::with_capacity(schema.fields().len());
    for (idx, field) in schema.fields().iter().enumerate() {
        col_map.insert(field.name().to_lowercase(), idx);
    }

    let col_event_id = col_map.get("event_id").copied();
    let col_event_type = col_map.get("event_type").copied();
    let col_timestamp = col_map.get("timestamp").copied();
    let col_project_id = col_map.get("project_id").copied();
    let col_project_name = col_map.get("project_name").copied();
    let col_file_id = col_map.get("file_id").copied();
    let col_file_path = col_map
        .get("file_path")
        .or_else(|| col_map.get("source_path"))
        .copied();
    let col_file_size = col_map
        .get("file_size")
        .or_else(|| col_map.get("source_size"))
        .copied();
    let col_file_type = col_map.get("file_type").copied();
    let col_source_mtime = col_map.get("source_mtime").copied();
    let col_parquet_path = col_map.get("parquet_path").copied();
    let col_parquet_size = col_map.get("parquet_size").copied();
    let col_row_count = col_map.get("row_count").copied();
    let col_status = col_map.get("status").copied();
    let col_duration_ms = col_map.get("duration_ms").copied();
    let col_metadata_json = col_map
        .get("metadata_json")
        .or_else(|| col_map.get("extra_json"))
        .copied();

    let reader = builder
        .build()
        .map_err(|e| format!("Failed to build Parquet reader: {}", e))?;

    let mut events = Vec::new();

    for batch_res in reader {
        let batch = batch_res.map_err(|e| format!("Parquet record batch read error: {}", e))?;
        let num_rows = batch.num_rows();
        if num_rows == 0 {
            continue;
        }

        let arr_event_id = get_string_array(&batch, col_event_id);
        let arr_event_type = get_string_array(&batch, col_event_type);
        let arr_timestamp = get_i64_array(&batch, col_timestamp);
        let arr_project_id = get_string_array(&batch, col_project_id);
        let arr_project_name = get_string_array(&batch, col_project_name);
        let arr_file_id = get_string_array(&batch, col_file_id);
        let arr_file_path = get_string_array(&batch, col_file_path);
        let arr_file_size = get_i64_array(&batch, col_file_size);
        let arr_file_type = get_string_array(&batch, col_file_type);
        let arr_source_mtime = get_i64_array(&batch, col_source_mtime);
        let arr_parquet_path = get_string_array(&batch, col_parquet_path);
        let arr_parquet_size = get_i64_array(&batch, col_parquet_size);
        let arr_row_count = get_i64_array(&batch, col_row_count);
        let arr_status = get_string_array(&batch, col_status);
        let arr_duration_ms = get_i64_array(&batch, col_duration_ms);
        let arr_metadata_json = get_string_array(&batch, col_metadata_json);

        for row in 0..num_rows {
            let ev = LedgerEvent {
                event_id: arr_event_id
                    .as_ref()
                    .and_then(|a| a.get(row))
                    .unwrap_or_default(),
                event_type: arr_event_type
                    .as_ref()
                    .and_then(|a| a.get(row))
                    .unwrap_or_else(|| "FILE_ADDED".to_string()),
                timestamp: arr_timestamp
                    .as_ref()
                    .and_then(|a| a.get(row))
                    .unwrap_or(0),
                project_id: arr_project_id
                    .as_ref()
                    .and_then(|a| a.get(row))
                    .unwrap_or_else(|| "orphan_prj".to_string()),
                project_name: arr_project_name.as_ref().and_then(|a| a.get(row)),
                file_id: arr_file_id.as_ref().and_then(|a| a.get(row)),
                file_path: arr_file_path.as_ref().and_then(|a| a.get(row)),
                file_size: arr_file_size.as_ref().and_then(|a| a.get(row)),
                file_type: arr_file_type.as_ref().and_then(|a| a.get(row)),
                source_mtime: arr_source_mtime.as_ref().and_then(|a| a.get(row)),
                parquet_path: arr_parquet_path.as_ref().and_then(|a| a.get(row)),
                parquet_size: arr_parquet_size.as_ref().and_then(|a| a.get(row)),
                row_count: arr_row_count.as_ref().and_then(|a| a.get(row)),
                status: Some(
                    arr_status
                        .as_ref()
                        .and_then(|a| a.get(row))
                        .unwrap_or_else(|| "READY".to_string()),
                ),
                duration_ms: arr_duration_ms.as_ref().and_then(|a| a.get(row)),
                metadata_json: arr_metadata_json.as_ref().and_then(|a| a.get(row)),
            };
            events.push(ev);
        }
    }

    events.sort_by_key(|e| e.timestamp);
    Ok(events)
}

/// Apply a sequence of WAL events in chronological order to mutate LedgerState
pub fn apply_events_to_state(events: &[LedgerEvent], state: &mut LedgerState) {
    for ev in events {
        match ev.event_type.as_str() {
            "PROJECT_CREATED" => {
                let name = ev
                    .project_name
                    .clone()
                    .unwrap_or_else(|| "Untitled-1".to_string());
                let info = ProjectInfo {
                    project_id: ev.project_id.clone(),
                    project_name: name,
                    status: ev.status.clone().unwrap_or_else(|| "READY".to_string()),
                    created_at: ev.timestamp,
                    is_orphan: ev.project_id == "orphan_prj",
                };
                state.projects.insert(ev.project_id.clone(), info);
                state.active_project_id = ev.project_id.clone();
            }
            "PROJECT_RENAMED" => {
                if let Some(p) = state.projects.get_mut(&ev.project_id) {
                    if let Some(ref new_name) = ev.project_name {
                        p.project_name = new_name.clone();
                    }
                }
                for f in state.files.values_mut() {
                    if f.project_id == ev.project_id {
                        if let Some(ref new_name) = ev.project_name {
                            f.project_name = new_name.clone();
                        }
                    }
                }
            }
            "PROJECT_DELETED" => {
                state.projects.remove(&ev.project_id);
                // Purge all files belonging to deleted project
                state.files.retain(|_, f| f.project_id != ev.project_id);
                if state.active_project_id == ev.project_id {
                    state.active_project_id =
                        state.projects.keys().next().cloned().unwrap_or_default();
                }
            }
            "FILE_ADDED" | "FILE_MODIFIED" => {
                if let Some(ref fp) = ev.file_path {
                    let norm = normalize_path(fp);
                    let prj_name = state
                        .projects
                        .get(&ev.project_id)
                        .map(|p| p.project_name.clone())
                        .unwrap_or_default();
                    let file_name = Path::new(fp)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("")
                        .to_string();
                    let (folder_root, folder_name, rel_path) =
                        parse_metadata_json(ev.metadata_json.as_deref());

                    let info = FileInfo {
                        file_id: ev.file_id.clone().unwrap_or_else(|| ev.event_id.clone()),
                        file_path: fp.clone(),
                        file_name,
                        project_id: ev.project_id.clone(),
                        project_name: prj_name,
                        file_size: ev.file_size.unwrap_or(0),
                        row_count: ev.row_count.unwrap_or(0),
                        status: ev.status.clone().unwrap_or_else(|| "READY".to_string()),
                        parquet_path: ev.parquet_path.clone().unwrap_or_default(),
                        source_mtime: ev.source_mtime.unwrap_or(0),
                        folder_root,
                        folder_name,
                        rel_path,
                    };
                    state.files.insert(norm, info);
                }
            }
            "FILE_DELETED" => {
                if let Some(ref fp) = ev.file_path {
                    let norm = normalize_path(fp);
                    state.files.remove(&norm);
                }
            }
            _ => {}
        }
    }
}

/// Format bytes into human-readable string
pub fn format_byte_size(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{} B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else if bytes < 1024 * 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    } else {
        format!("{:.2} GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
    }
}

// -----------------------------------------------------------------------------
// DTOs for Workspace Interoperability
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWorkspaceProjectDto {
    pub project_id: String,
    pub project_name: String,
    pub status: String,
    pub created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_orphan: Option<bool>,
    pub file_count: usize,
    pub total_bytes: u64,

    // Backward compatibility aliases
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_count: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWorkspaceFileDto {
    pub file_path: String,
    pub file_name: String,
    pub project_id: String,
    pub project_name: String,
    pub file_size_bytes: i64,
    pub row_count: i64,
    pub status: String,
    pub parquet_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rel_path: Option<String>,
}
