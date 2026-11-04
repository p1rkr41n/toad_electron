//! commands/workspace.rs
//!
//! Workspace CRUD Command Handlers (Milestone M4 / F17)
//! Implements all 14 `project:*` IPC command handlers for ProjectWorkspaceManager.ts and TauriHostAdapter.ts:
//! - project:get_workspace
//! - project:get_files
//! - project:add_files
//! - project:add_folder
//! - project:delete
//! - project:rename
//! - project:create
//! - project:set_active
//! - project:reconcile
//! - project:delete_all
//! - project:get_cache_size
//! - project:purge_cache
//! - project:remove_file
//! - project:move_orphan_files

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::ledger::{
    ProjectWorkspaceFileDto, ProjectWorkspaceProjectDto, StartupReconciler,
};
use crate::logger::ErrorResponse;
use crate::state::AppState;

// -----------------------------------------------------------------------------
// DTOs for Workspace Commands
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceResponse {
    pub active_project_id: String,
    pub projects: Vec<ProjectWorkspaceProjectDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetFilesResponse {
    pub project_id: String,
    pub files: Vec<ProjectWorkspaceFileDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddFilesResponse {
    pub added_files: Vec<ProjectWorkspaceFileDto>,
    pub success: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddFolderResponse {
    pub added_files: Vec<ProjectWorkspaceFileDto>,
    pub count: usize,
    pub success: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProjectResponse {
    pub success: bool,
    pub deleted_files: usize,
    pub freed_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAllProjectsResponse {
    pub success: bool,
    pub freed_bytes: u64,
    pub deleted_projects: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameProjectResponse {
    pub success: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectResponse {
    pub project_id: String,
    pub name: String,
    pub success: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetActiveProjectResponse {
    pub success: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheSizeResponse {
    pub file_count: usize,
    pub total_bytes: u64,
    pub formatted_size: String,
    // Aliases for legacy stubs
    pub cache_size_bytes: u64,
    pub formatted: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurgeCacheResponse {
    pub purged_files: usize,
    pub freed_bytes: u64,
    // Aliases for legacy stubs
    pub purged_bytes: u64,
    pub files_removed: usize,
    pub success: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveFileResponse {
    pub freed_bytes: u64,
    pub success: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveOrphanFilesResponse {
    pub moved_count: usize,
    pub success: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileResponse {
    pub success: bool,
    pub reconciled_files: usize,
    pub scenario: String,
    pub warnings: Vec<String>,
}

// -----------------------------------------------------------------------------
// Input Extraction Helpers (CamelCase & snake_case support)
// -----------------------------------------------------------------------------

fn get_str_param<'a>(val: &'a Value, camel: &str, snake: &str) -> Option<&'a str> {
    val.get(camel).or_else(|| val.get(snake)).and_then(|v| v.as_str())
}

fn get_str_vec(val: &Value, camel: &str, snake: &str) -> Vec<String> {
    val.get(camel)
        .or_else(|| val.get(snake))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

// -----------------------------------------------------------------------------
// Command Handlers
// -----------------------------------------------------------------------------

/// GET WORKSPACE: Returns active project ID and project catalog
pub async fn handle_get_workspace(
    state: &AppState,
    _payload: Value,
) -> Result<WorkspaceResponse, ErrorResponse> {
    let ledger = state.parquet_ledger.read().await;
    let (active_id, projects) = ledger.get_workspace().await;

    Ok(WorkspaceResponse {
        active_project_id: active_id,
        projects,
    })
}

/// GET FILES: Returns files belonging to requested project
pub async fn handle_get_files(
    state: &AppState,
    payload: Value,
) -> Result<GetFilesResponse, ErrorResponse> {
    let ledger = state.parquet_ledger.read().await;
    let project_id = get_str_param(&payload, "projectId", "project_id")
        .map(|s| s.to_string())
        .or_else(|| ledger.active_project_id.clone())
        .unwrap_or_else(|| "default".to_string());

    let files = ledger.get_project_files(&project_id).await;

    Ok(GetFilesResponse {
        project_id,
        files,
    })
}

/// ADD FILES: Adds one or more source files to project catalog
pub async fn handle_add_files(
    state: &AppState,
    payload: Value,
) -> Result<AddFilesResponse, ErrorResponse> {
    let ledger = state.parquet_ledger.read().await;
    let project_id = get_str_param(&payload, "projectId", "project_id")
        .map(|s| s.to_string())
        .or_else(|| ledger.active_project_id.clone())
        .unwrap_or_else(|| "default".to_string());

    let file_paths = get_str_vec(&payload, "filePaths", "file_paths");
    if file_paths.is_empty() {
        return Err(ErrorResponse::invalid_argument("filePaths array cannot be empty"));
    }

    let added_files = ledger
        .add_files_to_project(&project_id, file_paths)
        .await
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to add files: {}", e)))?;

    Ok(AddFilesResponse {
        added_files,
        success: true,
    })
}

/// ADD FOLDER: Recursively scans and registers supported files in directory
pub async fn handle_add_folder(
    state: &AppState,
    payload: Value,
) -> Result<AddFolderResponse, ErrorResponse> {
    let ledger = state.parquet_ledger.read().await;
    let project_id = get_str_param(&payload, "projectId", "project_id")
        .map(|s| s.to_string())
        .or_else(|| ledger.active_project_id.clone())
        .unwrap_or_else(|| "default".to_string());

    let folder_path = get_str_param(&payload, "folderPath", "folder_path")
        .ok_or_else(|| ErrorResponse::invalid_argument("Missing folderPath parameter"))?;

    let added_files = ledger
        .add_folder_to_project(&project_id, folder_path)
        .await
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to add folder: {}", e)))?;

    let count = added_files.len();

    Ok(AddFolderResponse {
        added_files,
        count,
        success: true,
    })
}

/// DELETE PROJECT: Cascade deletes project metadata and cache
pub async fn handle_delete_project(
    state: &AppState,
    payload: Value,
) -> Result<DeleteProjectResponse, ErrorResponse> {
    let project_id = get_str_param(&payload, "projectId", "project_id")
        .ok_or_else(|| ErrorResponse::invalid_argument("Missing projectId parameter"))?;

    let ledger = state.parquet_ledger.read().await;
    let (deleted_files, freed_bytes) = ledger
        .delete_project(project_id)
        .await
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to delete project: {}", e)))?;

    Ok(DeleteProjectResponse {
        success: true,
        deleted_files,
        freed_bytes,
    })
}

/// DELETE ALL PROJECTS: Purges all workspace projects and resets ledger
pub async fn handle_delete_all_projects(
    state: &AppState,
    _payload: Value,
) -> Result<DeleteAllProjectsResponse, ErrorResponse> {
    let ledger = state.parquet_ledger.read().await;
    let (deleted_projects, freed_bytes) = ledger
        .delete_all_projects()
        .await
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to delete all projects: {}", e)))?;

    Ok(DeleteAllProjectsResponse {
        success: true,
        freed_bytes,
        deleted_projects,
    })
}

/// RENAME PROJECT: Zero-cost in-place metadata rename
pub async fn handle_rename_project(
    state: &AppState,
    payload: Value,
) -> Result<RenameProjectResponse, ErrorResponse> {
    let project_id = get_str_param(&payload, "projectId", "project_id")
        .ok_or_else(|| ErrorResponse::invalid_argument("Missing projectId parameter"))?;
    let new_name = get_str_param(&payload, "newName", "new_name")
        .ok_or_else(|| ErrorResponse::invalid_argument("Missing newName parameter"))?;

    let ledger = state.parquet_ledger.read().await;
    ledger
        .rename_project(project_id, new_name)
        .await
        .map_err(|e| ErrorResponse::invalid_argument(format!("Failed to rename project: {}", e)))?;

    Ok(RenameProjectResponse { success: true })
}

/// CREATE PROJECT: Creates a project with 5-char ID
pub async fn handle_create_project(
    state: &AppState,
    payload: Value,
) -> Result<CreateProjectResponse, ErrorResponse> {
    let project_name = get_str_param(&payload, "projectName", "project_name")
        .or_else(|| get_str_param(&payload, "name", "name"))
        .unwrap_or("Untitled-1");
    let custom_id = get_str_param(&payload, "projectId", "project_id").map(|s| s.to_string());

    let ledger = state.parquet_ledger.read().await;
    let project_id = ledger
        .create_project(project_name, custom_id)
        .await
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to create project: {}", e)))?;

    Ok(CreateProjectResponse {
        project_id,
        name: project_name.to_string(),
        success: true,
    })
}

/// SET ACTIVE PROJECT
pub async fn handle_set_active_project(
    state: &AppState,
    payload: Value,
) -> Result<SetActiveProjectResponse, ErrorResponse> {
    let project_id = get_str_param(&payload, "projectId", "project_id")
        .ok_or_else(|| ErrorResponse::invalid_argument("Missing projectId parameter"))?;

    let ledger = state.parquet_ledger.read().await;
    ledger
        .set_active_project(project_id)
        .await
        .map_err(|e| ErrorResponse::invalid_argument(format!("Failed to set active project: {}", e)))?;

    Ok(SetActiveProjectResponse { success: true })
}

/// GET CACHE SIZE
pub async fn handle_get_cache_size(
    state: &AppState,
    payload: Value,
) -> Result<CacheSizeResponse, ErrorResponse> {
    let ledger = state.parquet_ledger.read().await;
    let project_id = get_str_param(&payload, "projectId", "project_id")
        .map(|s| s.to_string())
        .or_else(|| ledger.active_project_id.clone())
        .unwrap_or_else(|| "default".to_string());

    let (file_count, total_bytes, formatted_size) = ledger.get_cache_size(&project_id).await;

    Ok(CacheSizeResponse {
        file_count,
        total_bytes,
        formatted_size: formatted_size.clone(),
        cache_size_bytes: total_bytes,
        formatted: formatted_size,
    })
}

/// PURGE CACHE
pub async fn handle_purge_cache(
    state: &AppState,
    payload: Value,
) -> Result<PurgeCacheResponse, ErrorResponse> {
    let ledger = state.parquet_ledger.read().await;
    let project_id = get_str_param(&payload, "projectId", "project_id")
        .map(|s| s.to_string())
        .or_else(|| ledger.active_project_id.clone())
        .unwrap_or_else(|| "default".to_string());

    let (purged_files, freed_bytes) = ledger
        .purge_cache(&project_id)
        .await
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to purge cache: {}", e)))?;

    Ok(PurgeCacheResponse {
        purged_files,
        freed_bytes,
        purged_bytes: freed_bytes,
        files_removed: purged_files,
        success: true,
    })
}

/// REMOVE FILE
pub async fn handle_remove_file(
    state: &AppState,
    payload: Value,
) -> Result<RemoveFileResponse, ErrorResponse> {
    let ledger = state.parquet_ledger.read().await;
    let project_id = get_str_param(&payload, "projectId", "project_id")
        .map(|s| s.to_string())
        .or_else(|| ledger.active_project_id.clone())
        .unwrap_or_else(|| "default".to_string());

    let file_path = get_str_param(&payload, "filePath", "file_path")
        .ok_or_else(|| ErrorResponse::invalid_argument("Missing filePath parameter"))?;

    let freed_bytes = ledger
        .remove_file_from_project(&project_id, file_path)
        .await
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to remove file: {}", e)))?;

    Ok(RemoveFileResponse {
        freed_bytes,
        success: true,
    })
}

/// MOVE ORPHAN FILES
pub async fn handle_move_orphan_files(
    state: &AppState,
    payload: Value,
) -> Result<MoveOrphanFilesResponse, ErrorResponse> {
    let target_id = get_str_param(&payload, "targetProjectId", "target_project_id")
        .map(|s| s.to_string());

    let ledger = state.parquet_ledger.read().await;
    let moved_count = ledger
        .move_orphan_files(target_id)
        .await
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to move orphan files: {}", e)))?;

    Ok(MoveOrphanFilesResponse {
        moved_count,
        success: true,
    })
}

/// RECONCILE WORKSPACE
pub async fn handle_reconcile(
    state: &AppState,
    _payload: Value,
) -> Result<ReconcileResponse, ErrorResponse> {
    let ledger = state.parquet_ledger.read().await;
    let mut st = ledger.state.write().await;

    let reconciler = StartupReconciler::new(
        &ledger.ledger_path,
        &ledger.backup_path,
        &ledger.temp_dir,
        &ledger.logs_dir,
        true,
    );

    let report = reconciler
        .reconcile(&mut st)
        .map_err(|e| ErrorResponse::internal_error(format!("Reconciliation error: {}", e)))?;

    Ok(ReconcileResponse {
        success: true,
        reconciled_files: report.active_files,
        scenario: format!("{:?}", report.scenario),
        warnings: report.warnings,
    })
}
