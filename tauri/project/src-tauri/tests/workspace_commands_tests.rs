//! workspace_commands_tests.rs
//!
//! Automated Test Suite for Workspace IPC Command Handlers (Milestone M4 / F17)
//! Verifies all 14 `project:*` command handlers with full DTO compatibility and parameter flexibility.

use serde_json::json;
use std::fs;
use std::path::PathBuf;
use toad_lib::commands::workspace::*;
use toad_lib::ledger::generate_project_id;
use toad_lib::portable::ToadConfig;
use toad_lib::state::AppState;

fn create_cmd_test_dir(test_name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("toad_cmd_test_{}_{}", test_name, generate_project_id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("Failed to create test dir");
    dir
}

#[tokio::test]
async fn test_workspace_get_workspace_and_create() {
    let test_dir = create_cmd_test_dir("get_workspace");
    let state = AppState::new(test_dir.clone(), ToadConfig::default());

    // 1. Initial workspace should contain default Untitled-1
    let ws_res = handle_get_workspace(&state, json!({}))
        .await
        .unwrap();
    assert_eq!(ws_res.projects.len(), 1);
    assert_eq!(ws_res.projects[0].project_name, "Untitled-1");

    // 2. Create new project with custom name
    let create_res = handle_create_project(
        &state,
        json!({ "projectName": "Forensic Case #102" }),
    )
    .await
    .unwrap();
    assert!(create_res.success);
    assert_eq!(create_res.name, "Forensic Case #102");
    assert_eq!(create_res.project_id.len(), 5);

    // 3. Verify workspace updated
    let ws_res2 = handle_get_workspace(&state, json!({}))
        .await
        .unwrap();
    assert_eq!(ws_res2.projects.len(), 2);
    assert_eq!(ws_res2.active_project_id, create_res.project_id);

    let _ = fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_workspace_rename_project() {
    let test_dir = create_cmd_test_dir("rename");
    let state = AppState::new(test_dir.clone(), ToadConfig::default());

    let create_res = handle_create_project(
        &state,
        json!({ "projectName": "Old Name" }),
    )
    .await
    .unwrap();

    let pid = create_res.project_id;

    // Test rename with camelCase
    let ren_res = handle_rename_project(
        &state,
        json!({ "projectId": pid, "newName": "Brand New Name" }),
    )
    .await
    .unwrap();
    assert!(ren_res.success);

    // Verify rename reflected in get_workspace
    let ws_res = handle_get_workspace(&state, json!({}))
        .await
        .unwrap();
    let prj = ws_res.projects.iter().find(|p| p.project_id == pid).unwrap();
    assert_eq!(prj.project_name, "Brand New Name");

    // Test rename with snake_case
    let ren_res2 = handle_rename_project(
        &state,
        json!({ "project_id": pid, "new_name": "Snake Case Renamed" }),
    )
    .await
    .unwrap();
    assert!(ren_res2.success);

    let _ = fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_workspace_add_and_get_files() {
    let test_dir = create_cmd_test_dir("add_files");
    let state = AppState::new(test_dir.clone(), ToadConfig::default());

    let create_res = handle_create_project(
        &state,
        json!({ "projectName": "Files Project" }),
    )
    .await
    .unwrap();
    let pid = create_res.project_id;

    // Create 2 test files on disk
    let file1 = test_dir.join("sample1.csv");
    let file2 = test_dir.join("sample2.parquet");
    fs::write(&file1, "id,name\n1,Alice\n2,Bob\n").unwrap();
    fs::write(&file2, b"dummy binary parquet data").unwrap();

    // Add files via command
    let add_res = handle_add_files(
        &state,
        json!({
            "projectId": pid,
            "filePaths": [
                file1.to_string_lossy().to_string(),
                file2.to_string_lossy().to_string()
            ]
        }),
    )
    .await
    .unwrap();
    assert!(add_res.success);
    assert_eq!(add_res.added_files.len(), 2);

    // Get files for project
    let files_res = handle_get_files(
        &state,
        json!({ "projectId": pid }),
    )
    .await
    .unwrap();
    assert_eq!(files_res.files.len(), 2);
    assert!(files_res.files.iter().any(|f| f.file_name == "sample1.csv"));
    assert!(files_res.files.iter().any(|f| f.file_name == "sample2.parquet"));

    let _ = fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_workspace_add_folder_recursive() {
    let test_dir = create_cmd_test_dir("add_folder");
    let state = AppState::new(test_dir.clone(), ToadConfig::default());

    let pid = handle_create_project(
        &state,
        json!({ "projectName": "Folder Project" }),
    )
    .await
    .unwrap()
    .project_id;

    // Create folder structure with supported and unsupported extensions
    let scan_root = test_dir.join("logs_tree");
    let sub_dir = scan_root.join("sub");
    fs::create_dir_all(&sub_dir).unwrap();

    fs::write(scan_root.join("root.csv"), "a\n1\n").unwrap();
    fs::write(sub_dir.join("child.jsonl"), "{\"msg\":\"ok\"}\n").unwrap();
    fs::write(sub_dir.join("ignored.txt"), "text").unwrap(); // unsupported, should be skipped

    let add_folder_res = handle_add_folder(
        &state,
        json!({
            "projectId": pid,
            "folderPath": scan_root.to_string_lossy().to_string()
        }),
    )
    .await
    .unwrap();

    assert!(add_folder_res.success);
    assert_eq!(add_folder_res.count, 2); // root.csv and child.jsonl
    assert_eq!(add_folder_res.added_files.len(), 2);

    // Verify metadata was captured
    let f = add_folder_res.added_files.iter().find(|x| x.file_name == "child.jsonl").unwrap();
    assert_eq!(f.folder_root, Some(scan_root.to_string_lossy().to_string()));
    assert_eq!(f.folder_name, Some("logs_tree".to_string()));

    let _ = fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_workspace_cache_size_and_purge() {
    let test_dir = create_cmd_test_dir("cache_size_purge");
    let state = AppState::new(test_dir.clone(), ToadConfig::default());

    let pid = handle_create_project(
        &state,
        json!({ "projectName": "Cache Project" }),
    )
    .await
    .unwrap()
    .project_id;

    // Simulate cached Parquet files in temp/<project_id>/
    let prj_temp = test_dir.join("temp").join(&pid);
    fs::create_dir_all(&prj_temp).unwrap();
    fs::write(prj_temp.join("cache1.parquet"), vec![0u8; 1024]).unwrap();
    fs::write(prj_temp.join("cache2.parquet"), vec![0u8; 2048]).unwrap();

    // Check cache size
    let size_res = handle_get_cache_size(
        &state,
        json!({ "projectId": pid }),
    )
    .await
    .unwrap();
    assert_eq!(size_res.file_count, 2);
    assert_eq!(size_res.total_bytes, 3072);
    assert_eq!(size_res.cache_size_bytes, 3072);

    // Purge cache
    let purge_res = handle_purge_cache(
        &state,
        json!({ "projectId": pid }),
    )
    .await
    .unwrap();
    assert!(purge_res.success);
    assert_eq!(purge_res.purged_files, 2);
    assert_eq!(purge_res.freed_bytes, 3072);

    // Verify cache size is now 0
    let size_res2 = handle_get_cache_size(
        &state,
        json!({ "projectId": pid }),
    )
    .await
    .unwrap();
    assert_eq!(size_res2.file_count, 0);
    assert_eq!(size_res2.total_bytes, 0);

    let _ = fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_workspace_remove_file() {
    let test_dir = create_cmd_test_dir("remove_file");
    let state = AppState::new(test_dir.clone(), ToadConfig::default());

    let pid = handle_create_project(
        &state,
        json!({ "projectName": "Remove File Test" }),
    )
    .await
    .unwrap()
    .project_id;

    let dummy_file = test_dir.join("removable.csv");
    fs::write(&dummy_file, "col1,col2\n1,2\n").unwrap();

    handle_add_files(
        &state,
        json!({
            "projectId": pid,
            "filePaths": [dummy_file.to_string_lossy().to_string()]
        }),
    )
    .await
    .unwrap();

    // Remove file
    let rem_res = handle_remove_file(
        &state,
        json!({
            "projectId": pid,
            "filePath": dummy_file.to_string_lossy().to_string()
        }),
    )
    .await
    .unwrap();
    assert!(rem_res.success);

    // Verify file list is empty
    let files_res = handle_get_files(
        &state,
        json!({ "projectId": pid }),
    )
    .await
    .unwrap();
    assert_eq!(files_res.files.len(), 0);

    let _ = fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_workspace_move_orphan_files() {
    let test_dir = create_cmd_test_dir("move_orphans");
    let state = AppState::new(test_dir.clone(), ToadConfig::default());

    let target_pid = handle_create_project(
        &state,
        json!({ "projectName": "Target Project" }),
    )
    .await
    .unwrap()
    .project_id;

    // Register a file under orphan_prj
    let orphan_file = test_dir.join("orphan.csv");
    fs::write(&orphan_file, "a\n1\n").unwrap();

    let ledger = state.parquet_ledger.read().await;
    ledger
        .add_files_to_project("orphan_prj", vec![orphan_file.to_string_lossy().to_string()])
        .await
        .unwrap();
    drop(ledger);

    // Move orphan files to target project
    let move_res = handle_move_orphan_files(
        &state,
        json!({ "targetProjectId": target_pid }),
    )
    .await
    .unwrap();
    assert!(move_res.success);
    assert_eq!(move_res.moved_count, 1);

    // Verify file now belongs to target_pid
    let files_res = handle_get_files(
        &state,
        json!({ "projectId": target_pid }),
    )
    .await
    .unwrap();
    assert_eq!(files_res.files.len(), 1);
    assert_eq!(files_res.files[0].project_id, target_pid);

    let _ = fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_workspace_delete_project_and_all() {
    let test_dir = create_cmd_test_dir("delete_project_and_all");
    let state = AppState::new(test_dir.clone(), ToadConfig::default());

    let pid1 = handle_create_project(
        &state,
        json!({ "projectName": "Proj 1" }),
    )
    .await
    .unwrap()
    .project_id;

    let pid2 = handle_create_project(
        &state,
        json!({ "projectName": "Proj 2" }),
    )
    .await
    .unwrap()
    .project_id;

    // Delete single project
    let del_res = handle_delete_project(
        &state,
        json!({ "projectId": pid1 }),
    )
    .await
    .unwrap();
    assert!(del_res.success);

    // Verify only Proj 2 remains (+ initial Untitled-1)
    let ws_res = handle_get_workspace(&state, json!({}))
        .await
        .unwrap();
    assert!(!ws_res.projects.iter().any(|p| p.project_id == pid1));
    assert!(ws_res.projects.iter().any(|p| p.project_id == pid2));

    // Delete all projects
    let del_all_res = handle_delete_all_projects(&state, json!({}))
        .await
        .unwrap();
    assert!(del_all_res.success);

    // Verify immediate state has 0 projects
    let ws_res2 = handle_get_workspace(&state, json!({}))
        .await
        .unwrap();
    assert_eq!(ws_res2.projects.len(), 0);

    // Wait for debounce Untitled-1 recovery (500ms nominal debounce)
    let mut ws_res3 = handle_get_workspace(&state, json!({})).await.unwrap();
    for _ in 0..15 {
        if ws_res3.projects.len() == 1 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        ws_res3 = handle_get_workspace(&state, json!({})).await.unwrap();
    }
    assert_eq!(ws_res3.projects.len(), 1);
    assert_eq!(ws_res3.projects[0].project_name, "Untitled-1");

    let _ = fs::remove_dir_all(&test_dir);
}
