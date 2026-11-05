/**
 * Canonical Command Aliases between Tauri v2 Namespaces and Legacy Electron IPC
 */

export const COMMAND_ALIAS_MAP: Record<string, string> = {
  // Core Toad Commands
  "toad:init_main": "initMain",
  "toad:get_config": "getToadConfig",
  "toad:new_window": "newWindowFromDSPath",

  // Dialog, Clipboard & Shell Plugins
  "plugin:dialog|open": "dialog:showOpenDialog",
  "plugin:dialog|save": "dialog:showSaveDialog",
  "plugin:dialog|error": "errorDialog",
  "plugin:clipboard|write_text": "clipboard:writeText",
  "plugin:opener|open_url": "shell:openExternal",

  // Project Workspace Commands
  "project:get_workspace": "project:getWorkspace",
  "project:add_files": "project:addFiles",
  "project:add_folder": "project:addFolder",
  "project:delete": "project:delete",
  "project:rename": "project:rename",
  "project:create": "project:create",
  "project:set_active": "project:setActive",
  "project:reconcile": "project:reconcile",
  "project:get_files": "project:getFiles",
  "project:delete_all": "project:deleteAll",
  "project:get_cache_size": "project:getCacheSize",
  "project:purge_cache": "project:purgeCache",
  "project:remove_file": "project:removeFile",
  "project:move_orphan_files": "project:moveOrphanFiles",

  // Engine & Query Commands
  "engine:get_status": "engine:status",
  "engine:do_restart": "engine:restart",
  "toad:get_setup_info": "getSetupInfo",
  "toad:open_example": "openExample",
  "toad:eval_query": "DataSourceConnection.evalQuery",
  "toad:query": "DataSourceConnection.evalQuery",
  "evalQuery": "DataSourceConnection.evalQuery",
  "toad:row_count": "DataSourceConnection.rowCount",
  "rowCount": "DataSourceConnection.rowCount",
  "toad:schema": "DataSourceConnection.getTableSchema",
  "toad:get_table_schema": "DataSourceConnection.getTableSchema",
  "schema": "DataSourceConnection.getTableSchema",
  "getTableSchema": "DataSourceConnection.getTableSchema",
  "toad:run_sql_arrow": "DataSourceConnection.runSqlQueryArrow",
  "toad:get_table_name": "DataSourceConnection.getTableName",
  "getTableName": "DataSourceConnection.getTableName",

  // Forensics & Ingestion Commands
  "toad:ingest_file": "ingest_file",
  "toad:ingest_cancel": "ingest_cancel",
  "toad:ingest_vip": "ingest_vip",
  "toad:get_ingest_queue": "get_ingest_queue",
};

/**
 * Reverse mapping: Legacy IPC Channel -> Canonical Tauri Namespaced Name
 */
export const REVERSE_COMMAND_ALIAS_MAP: Record<string, string> = Object.entries(
  COMMAND_ALIAS_MAP
).reduce((acc, [tauriCmd, legacyCmd]) => {
  acc[legacyCmd] = tauriCmd;
  return acc;
}, {
  ingestFile: "toad:ingest_file",
  cancelIngest: "toad:ingest_cancel",
  prioritizeIngest: "toad:ingest_vip",
  getIngestQueue: "toad:get_ingest_queue",
} as Record<string, string>);
