//! cache_cleaner.rs
//!
//! Cascade Cache Cleaner & Windows EBUSY Avoidance Protocol (Milestone M4 / F16)
//! - Atomically renames target cache directories to `temp/.trash_*` on the same NTFS volume.
//! - Non-blocking async fire-and-forget deletion with exponential retry backoff.
//! - Handles Windows NTFS open handle locks (FILE_SHARE_DELETE) via per-file move fallback.
//! - Protects `toad_ledger.parquet` and `toad_ledger.parquet.bak` from deletion.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Result summary of a cache purge operation
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct PurgeResult {
    pub purged_files: usize,
    pub freed_bytes: u64,
    pub purged_directories: usize,
}

pub struct CacheCleaner;

impl CacheCleaner {
    /// Cascade delete cache for a specific project with Windows EBUSY atomic rename.
    ///
    /// Renames `temp/<project_id>/` to `temp/.trash_<project_id>_<timestamp>/` instantly,
    /// or falls back to moving child files individually if an active reader holds an open handle.
    pub fn purge_project_cache(temp_dir: &Path, project_id: &str) -> std::io::Result<PurgeResult> {
        let prj_dir = temp_dir.join(project_id);
        if !prj_dir.exists() {
            return Ok(PurgeResult::default());
        }

        let mut files = 0;
        let mut bytes = 0u64;
        if let Ok(entries) = fs::read_dir(&prj_dir) {
            for entry in entries.flatten() {
                if let Ok(meta) = entry.metadata() {
                    if meta.is_file() {
                        files += 1;
                        bytes += meta.len();
                    }
                }
            }
        }

        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let trash_dir = temp_dir.join(format!(".trash_{}_{}", project_id, now_ms));

        Self::purge_directory_atomic_or_fallback(&prj_dir, &trash_dir);

        Ok(PurgeResult {
            purged_files: files,
            freed_bytes: bytes,
            purged_directories: 1,
        })
    }

    /// Cascade purge all project caches and temp files upon `project:delete_all`.
    pub fn purge_all_caches(temp_dir: &Path) -> std::io::Result<PurgeResult> {
        if !temp_dir.exists() {
            return Ok(PurgeResult::default());
        }

        let mut total_files = 0;
        let mut total_bytes = 0u64;
        let mut total_dirs = 0;

        if let Ok(entries) = fs::read_dir(temp_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                let meta = match entry.metadata() {
                    Ok(m) => m,
                    Err(_) => continue,
                };

                if meta.is_dir() {
                    let now_ms = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis();
                    let trash_dir = temp_dir.join(format!(".trash_all_{}_{}", name, now_ms));
                    if Self::purge_directory_atomic_or_fallback(&path, &trash_dir) {
                        total_dirs += 1;
                    }
                } else if meta.is_file() {
                    let lower = name.to_lowercase();
                    // Strictly preserve state ledger and lock files
                    if lower != "toad_ledger.parquet"
                        && lower != "toad_ledger.parquet.bak"
                        && !lower.ends_with(".lock")
                    {
                        total_files += 1;
                        total_bytes += meta.len();
                        let _ = fs::remove_file(&path);
                    }
                }
            }
        }

        Ok(PurgeResult {
            purged_files: total_files,
            freed_bytes: total_bytes,
            purged_directories: total_dirs,
        })
    }

    /// Sweep and purge orphan caches (unreferenced in active ledger).
    pub fn purge_orphan_caches(
        temp_dir: &Path,
        active_project_ids: &HashSet<String>,
        known_parquet_paths: &HashSet<PathBuf>,
    ) -> std::io::Result<PurgeResult> {
        if !temp_dir.exists() {
            return Ok(PurgeResult::default());
        }

        let mut total_files = 0;
        let mut total_bytes = 0u64;
        let mut total_dirs = 0;

        if let Ok(entries) = fs::read_dir(temp_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                let meta = match entry.metadata() {
                    Ok(m) => m,
                    Err(_) => continue,
                };

                if meta.is_dir() {
                    if name.starts_with(".trash_") {
                        Self::async_delete_trash(path);
                        total_dirs += 1;
                    } else if !active_project_ids.contains(name) {
                        let now_ms = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis();
                        let trash_dir = temp_dir.join(format!(".trash_orphan_{}_{}", name, now_ms));
                        if Self::purge_directory_atomic_or_fallback(&path, &trash_dir) {
                            total_dirs += 1;
                        }
                    } else {
                        // In an active project directory: inspect child cache files
                        if let Ok(children) = fs::read_dir(&path) {
                            for child in children.flatten() {
                                let c_path = child.path();
                                let c_name = c_path
                                    .file_name()
                                    .and_then(|n| n.to_str())
                                    .unwrap_or("")
                                    .to_lowercase();

                                if c_name.ends_with(".tmp")
                                    || c_name.contains(".tmp_")
                                    || c_name.ends_with(".part")
                                {
                                    if let Ok(m) = child.metadata() {
                                        total_files += 1;
                                        total_bytes += m.len();
                                    }
                                    let _ = fs::remove_file(&c_path);
                                } else if c_name.ends_with(".parquet") {
                                    let canonical = fs::canonicalize(&c_path)
                                        .unwrap_or_else(|_| c_path.clone());
                                    if !known_parquet_paths.contains(&c_path)
                                        && !known_parquet_paths.contains(&canonical)
                                    {
                                        if let Ok(m) = child.metadata() {
                                            total_files += 1;
                                            total_bytes += m.len();
                                        }
                                        let _ = fs::remove_file(&c_path);
                                    }
                                }
                            }
                        }
                    }
                } else if meta.is_file() {
                    let lower = name.to_lowercase();
                    if lower != "toad_ledger.parquet"
                        && lower != "toad_ledger.parquet.bak"
                        && !lower.ends_with(".lock")
                    {
                        if lower.ends_with(".tmp")
                            || lower.contains(".tmp_")
                            || lower.ends_with(".part")
                        {
                            total_files += 1;
                            total_bytes += meta.len();
                            let _ = fs::remove_file(&path);
                        } else if lower.ends_with(".parquet") {
                            let canonical =
                                fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
                            if !known_parquet_paths.contains(&path)
                                && !known_parquet_paths.contains(&canonical)
                            {
                                total_files += 1;
                                total_bytes += meta.len();
                                let _ = fs::remove_file(&path);
                            }
                        }
                    }
                }
            }
        }

        Ok(PurgeResult {
            purged_files: total_files,
            freed_bytes: total_bytes,
            purged_directories: total_dirs,
        })
    }

    /// Atomic directory rename to trash with fallback to moving individual child files
    /// when Windows NTFS open file handles prevent whole-directory rename.
    pub fn purge_directory_atomic_or_fallback(dir_path: &Path, trash_dir: &Path) -> bool {
        // 1. First attempt: atomic whole-directory rename on the same volume (instantaneous)
        if fs::rename(dir_path, trash_dir).is_ok() {
            Self::async_delete_trash(trash_dir.to_path_buf());
            return true;
        }

        // 2. Windows NTFS EBUSY Fallback:
        // When active open handles (e.g. readers with FILE_SHARE_DELETE) prevent
        // directory rename, move child entries individually into trash_dir.
        let _ = fs::create_dir_all(trash_dir);
        let mut lingering = Vec::new();
        let mut moved_any = false;

        if let Ok(entries) = fs::read_dir(dir_path) {
            for entry in entries.flatten() {
                let child_path = entry.path();
                if let Some(file_name) = child_path.file_name() {
                    let target = trash_dir.join(file_name);
                    if fs::rename(&child_path, &target).is_ok() {
                        moved_any = true;
                    } else {
                        lingering.push(child_path);
                    }
                }
            }
        }

        // Try removing the emptied parent directory
        let _ = fs::remove_dir(dir_path);

        // Schedule async deletion of moved files in trash_dir
        if moved_any {
            Self::async_delete_trash(trash_dir.to_path_buf());
        } else {
            let _ = fs::remove_dir(trash_dir);
        }

        // Schedule background retry deletion for any remaining lingering files
        if !lingering.is_empty() {
            Self::async_delete_lingering_files(lingering, dir_path.to_path_buf());
        }

        true
    }

    /// Async fire-and-forget deletion of lingering locked files that could not be moved immediately.
    pub fn async_delete_lingering_files(files: Vec<PathBuf>, parent_dir: PathBuf) {
        let task = move || {
            for attempt in 0..6 {
                let mut all_removed = true;
                for f in &files {
                    if f.exists() {
                        #[cfg(windows)]
                        {
                            if let Ok(meta) = f.metadata() {
                                let mut perm = meta.permissions();
                                if perm.readonly() {
                                    perm.set_readonly(false);
                                    let _ = fs::set_permissions(f, perm);
                                }
                            }
                        }
                        if fs::remove_file(f).is_err() {
                            all_removed = false;
                        }
                    }
                }
                if all_removed {
                    let _ = fs::remove_dir(&parent_dir);
                    return;
                }
                std::thread::sleep(std::time::Duration::from_millis(50 << attempt.min(5)));
            }
            for f in &files {
                let _ = fs::remove_file(f);
            }
            let _ = fs::remove_dir(&parent_dir);
        };

        if tokio::runtime::Handle::try_current().is_ok() {
            tokio::task::spawn_blocking(task);
        } else {
            std::thread::spawn(task);
        }
    }

    /// Async fire-and-forget deletion of `.trash_*` folders with exponential backoff.
    pub fn async_delete_trash(trash_path: PathBuf) {
        let task = move || {
            for attempt in 0..6 {
                if fs::remove_dir_all(&trash_path).is_ok() {
                    return;
                }
                #[cfg(windows)]
                {
                    Self::clear_readonly_recursive(&trash_path);
                }
                std::thread::sleep(std::time::Duration::from_millis(50 << attempt.min(5)));
            }
            let _ = fs::remove_dir_all(&trash_path);
        };

        if tokio::runtime::Handle::try_current().is_ok() {
            tokio::task::spawn_blocking(task);
        } else {
            std::thread::spawn(task);
        }
    }

    #[cfg(windows)]
    fn clear_readonly_recursive(dir: &Path) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Ok(meta) = path.metadata() {
                    let mut perm = meta.permissions();
                    if perm.readonly() {
                        perm.set_readonly(false);
                        let _ = fs::set_permissions(&path, perm);
                    }
                    if meta.is_dir() {
                        Self::clear_readonly_recursive(&path);
                    }
                }
            }
        }
    }
}
