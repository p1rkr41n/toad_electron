import * as reltab from "reltab";
import * as log from "loglevel";
import * as path from "path";
import { StateRef, mutableGet } from "oneref";
import { AppState } from "./AppState";

let _bridge: any = null;
function getBridge(): any {
  if (!_bridge) {
    try {
      const { getHostBridge } = require("host-bridge");
      _bridge = getHostBridge();
    } catch {}
  }
  return _bridge;
}

let _reltabDuckDB: any = null;
function getReltabDuckDB(): any {
  if (!_reltabDuckDB) {
    try {
      const dynamicRequire =
        typeof (globalThis as any).require === "function"
          ? (globalThis as any).require
          : eval("require");
      _reltabDuckDB = dynamicRequire("reltab-duckdb");
    } catch {}
  }
  return _reltabDuckDB;
}

export interface ProjectWorkspaceProject {
  projectId: string;
  projectName: string;
  status: "READY" | "DELETED";
  createdAt: number;
  isOrphan?: boolean;
  fileCount: number;
  totalBytes: number;
  isExpanded?: boolean;
}

export interface ProjectWorkspaceFile {
  filePath: string;
  fileName: string;
  projectId: string;
  projectName: string;
  fileSizeBytes: number;
  rowCount: number;
  status: "READY" | "MODIFIED" | "STARTED" | "ERROR" | "DELETED";
  parquetPath: string;
  folderRoot?: string;
  folderName?: string;
  relPath?: string;
}

export type WorkspaceChangeListener = () => void;

/**
 * ProjectWorkspaceManager:
 * Ring 3 (UI State / Core Logic): Quản lý toàn bộ vòng đời Multi-Project Workspace
 * - Quản lý danh sách Project (Active, Custom, orphan_prj).
 * - Tự động đồng bộ với Parquet State Ledger qua IPC / host-bridge hoặc direct fallback.
 * - Hỗ trợ thao tác: Tạo Project mới, Thêm File(s), Thêm Folder, Xóa Project (Cascade Cleanup).
 * - Debounce 500ms tự động phục hồi Untitled-1 khi danh sách rỗng.
 */
export class ProjectWorkspaceManager {
  private static instance: ProjectWorkspaceManager | null = null;
  private listeners: Set<WorkspaceChangeListener> = new Set();
  private expandedMap: Map<string, boolean> = new Map();
  private cachedProjects: ProjectWorkspaceProject[] = [];
  private activeProjectId: string = "prj_untitled_1";

  public static getInstance(): ProjectWorkspaceManager {
    if (!ProjectWorkspaceManager.instance) {
      ProjectWorkspaceManager.instance = new ProjectWorkspaceManager();
    }
    return ProjectWorkspaceManager.instance;
  }

  public static resetInstance(): void {
    ProjectWorkspaceManager.instance = null;
  }

  private constructor() {
    this.expandedMap.set("prj_untitled_1", true);
    this.expandedMap.set("orphan_prj", true);

    const bridge = getBridge();
    if (bridge && typeof bridge.onEvent === "function") {
      bridge.onEvent("project:workspaceChanged", () => {
        this.notify();
      });
    }
  }

  public subscribe(listener: WorkspaceChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public notify(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch {}
    }
  }

  public isProjectExpanded(projectId: string): boolean {
    if (this.expandedMap.has(projectId)) {
      return this.expandedMap.get(projectId)!;
    }
    return true;
  }

  public toggleProjectExpanded(projectId: string): void {
    const cur = this.isProjectExpanded(projectId);
    this.expandedMap.set(projectId, !cur);
    this.notify();
  }

  public setProjectExpanded(projectId: string, expanded: boolean): void {
    this.expandedMap.set(projectId, expanded);
    this.notify();
  }

  public async getWorkspace(): Promise<{
    projects: ProjectWorkspaceProject[];
    activeProjectId: string;
  }> {
    const bridge = getBridge();
    if (bridge && typeof bridge.invoke === "function") {
      try {
        const res = await bridge.invoke("project:getWorkspace", {});
        if (res && res.projects) {
          this.cachedProjects = res.projects;
          this.activeProjectId = res.activeProjectId || "prj_untitled_1";
          return { projects: res.projects, activeProjectId: this.activeProjectId };
        }
      } catch (err) {
        log.warn("[ProjectWorkspace] Bridge invoke failed, falling back to direct ledger:", err);
      }
    }

    const duckdb = getReltabDuckDB();
    if (duckdb && duckdb.ToadParquetLedger) {
      const ledger = duckdb.ToadParquetLedger.getInstance();
      await ledger.initLedger();
      const projects = ledger.getProjects();
      this.activeProjectId = ledger.getActiveProjectId();
      this.cachedProjects = projects;
      return { projects, activeProjectId: this.activeProjectId };
    }

    return {
      projects: [
        {
          projectId: "prj_untitled_1",
          projectName: "Untitled-1",
          status: "READY",
          createdAt: Date.now(),
          fileCount: 0,
          totalBytes: 0,
        },
      ],
      activeProjectId: "prj_untitled_1",
    };
  }

  public async getProjectFiles(projectId: string): Promise<ProjectWorkspaceFile[]> {
    const bridge = getBridge();
    if (bridge && typeof bridge.invoke === "function") {
      try {
        const res = await bridge.invoke("project:getFiles", { projectId });
        if (res && Array.isArray(res)) return res;
      } catch {}
    }

    const duckdb = getReltabDuckDB();
    if (duckdb && duckdb.ToadParquetLedger) {
      const ledger = duckdb.ToadParquetLedger.getInstance();
      const files = ledger.getProjectFiles(projectId);
      return files.map((f: any) => {
        let folderRoot: string | undefined;
        let folderName: string | undefined;
        let relPath: string | undefined;
        if (f.extra_json) {
          try {
            const ex = JSON.parse(f.extra_json);
            folderRoot = ex.folderRoot;
            folderName = ex.folderName;
            relPath = ex.relPath;
          } catch {}
        }
        return {
          filePath: f.source_path,
          fileName: path.basename(f.source_path || "") || "Unnamed File",
          projectId: f.project_id || projectId,
          projectName: f.project_name || "Untitled-1",
          fileSizeBytes: f.source_size,
          rowCount: f.row_count,
          status: f.status,
          parquetPath: f.parquet_path,
          folderRoot,
          folderName,
          relPath,
        };
      });
    }

    return [];
  }

  public async createProject(projectName: string, projectId?: string): Promise<string> {
    const bridge = getBridge();
    if (bridge && typeof bridge.invoke === "function") {
      try {
        const id = await bridge.invoke("project:create", { projectName, projectId });
        this.expandedMap.set(id, true);
        this.activeProjectId = id;
        this.notify();
        return id;
      } catch {}
    }

    const duckdb = getReltabDuckDB();
    if (duckdb && duckdb.ToadParquetLedger) {
      const ledger = duckdb.ToadParquetLedger.getInstance();
      const id = await ledger.createProject(projectName, projectId);
      this.expandedMap.set(id, true);
      this.activeProjectId = id;
      this.notify();
      return id;
    }

    return "prj_untitled_1";
  }

  public async renameProject(projectId: string, newName: string): Promise<boolean> {
    if (!projectId || projectId === "orphan_prj" || !newName.trim()) return false;
    const bridge = getBridge();
    if (bridge && typeof bridge.invoke === "function") {
      try {
        const res = await bridge.invoke("project:rename", { projectId, newName: newName.trim() });
        this.notify();
        return !!res;
      } catch {}
    }

    const duckdb = getReltabDuckDB();
    if (duckdb && duckdb.ToadParquetLedger) {
      const ledger = duckdb.ToadParquetLedger.getInstance();
      const res = await ledger.renameProject(projectId, newName.trim());
      this.notify();
      return !!res;
    }
    return false;
  }

  public async deleteProject(projectId: string): Promise<{ deletedFiles: number; freedBytes: number }> {
    try {
      const { MultipleLoadingManager } = require("./MultipleLoadingManager");
      const files = await this.getProjectFiles(projectId);
      for (const f of files) {
        if (f.filePath) {
          MultipleLoadingManager.getInstance().unregisterFile(f.filePath);
        }
      }
    } catch {}

    const bridge = getBridge();
    let result = { deletedFiles: 0, freedBytes: 0 };
    if (bridge && typeof bridge.invoke === "function") {
      try {
        result = await bridge.invoke("project:delete", { projectId });
        this.expandedMap.delete(projectId);
        this.notify();
        setTimeout(async () => {
          const ws = await this.getWorkspace();
          const nonOrphan = (ws.projects || []).filter(
            (p: any) => !p.isOrphan && p.status !== "DELETED"
          );
          if (nonOrphan.length === 0) {
            await this.createProject("Untitled-1");
          }
          this.notify();
        }, 550);
        return result;
      } catch {}
    }

    const duckdb = getReltabDuckDB();
    if (duckdb && duckdb.ToadParquetLedger) {
      const ledger = duckdb.ToadParquetLedger.getInstance();
      result = await ledger.deleteProjectCascade(projectId);
      this.expandedMap.delete(projectId);
      this.notify();
      setTimeout(async () => {
        const ws = await this.getWorkspace();
        const nonOrphan = (ws.projects || []).filter(
          (p: any) => !p.isOrphan && p.status !== "DELETED"
        );
        if (nonOrphan.length === 0) {
          await this.createProject("Untitled-1");
        }
        this.notify();
      }, 550);
      return result;
    }

    return result;
  }

  public async performStartupReconciliation(): Promise<any> {
    const bridge = getBridge();
    if (bridge && typeof bridge.invoke === "function") {
      try {
        const res = await bridge.invoke("project:reconcile", {});
        this.notify();
        return res;
      } catch {}
    }

    const duckdb = getReltabDuckDB();
    if (duckdb && duckdb.ToadParquetLedger) {
      const ledger = duckdb.ToadParquetLedger.getInstance();
      const res = await ledger.performStartupReconciliation();
      this.notify();
      return res;
    }
    return null;
  }

  public async getCacheSize(
    projectId: string
  ): Promise<{ fileCount: number; totalBytes: number; formattedSize: string }> {
    const bridge = getBridge();
    if (bridge && typeof bridge.invoke === "function") {
      try {
        return await bridge.invoke("project:getCacheSize", { projectId });
      } catch {}
    }

    const duckdb = getReltabDuckDB();
    if (duckdb && duckdb.ToadParquetLedger) {
      const ledger = duckdb.ToadParquetLedger.getInstance();
      return ledger.getProjectCacheSize(projectId);
    }

    return { fileCount: 0, totalBytes: 0, formattedSize: "0 MB" };
  }

  public async addFilesToProject(projectId: string, filePaths: string[]): Promise<void> {
    const bridge = getBridge();
    if (bridge && typeof bridge.invoke === "function") {
      try {
        await bridge.invoke("project:addFiles", { projectId, filePaths });
        this.notify();
        return;
      } catch {}
    }

    const duckdb = getReltabDuckDB();
    if (duckdb && duckdb.ToadParquetLedger) {
      const ledger = duckdb.ToadParquetLedger.getInstance();
      for (const f of filePaths) {
        await ledger.addFileToProject(projectId, f);
      }
      this.notify();
    }
  }

  public async addFolderToProject(projectId: string, folderPath: string): Promise<string[]> {
    const bridge = getBridge();
    if (bridge && typeof bridge.invoke === "function") {
      try {
        const added = await bridge.invoke("project:addFolder", { projectId, folderPath });
        this.notify();
        return added || [];
      } catch {}
    }

    const duckdb = getReltabDuckDB();
    if (duckdb && duckdb.ToadParquetLedger) {
      const ledger = duckdb.ToadParquetLedger.getInstance();
      const entries = await ledger.addFolderToProject(projectId, folderPath);
      this.notify();
      return entries.map((e: any) => e.source_path);
    }

    return [];
  }

  public async moveOrphanFilesToProject(targetProjectId: string): Promise<void> {
    const bridge = getBridge();
    if (bridge && typeof bridge.invoke === "function") {
      try {
        await bridge.invoke("project:moveOrphanFiles", { targetProjectId });
        this.notify();
        return;
      } catch {}
    }

    const duckdb = getReltabDuckDB();
    if (duckdb && duckdb.ToadParquetLedger) {
      const ledger = duckdb.ToadParquetLedger.getInstance();
      await ledger.moveOrphanFilesToProject(targetProjectId);
      this.notify();
    }
  }

  public async setActiveProject(projectId: string): Promise<void> {
    if (!projectId || projectId === "orphan_prj") return;
    this.activeProjectId = projectId;
    const bridge = getBridge();
    if (bridge && typeof bridge.invoke === "function") {
      try {
        await bridge.invoke("project:setActive", { projectId });
      } catch {}
    }
    const duckdb = getReltabDuckDB();
    if (duckdb && duckdb.ToadParquetLedger) {
      duckdb.ToadParquetLedger.getInstance().setActiveProjectId(projectId);
    }
    this.notify();
  }

  public async purgeProjectCache(
    projectId: string
  ): Promise<{ purgedFiles: number; freedBytes: number }> {
    const bridge = getBridge();
    if (bridge && typeof bridge.invoke === "function") {
      try {
        const res = await bridge.invoke("project:purgeCache", { projectId });
        this.notify();
        return res;
      } catch {}
    }

    const duckdb = getReltabDuckDB();
    if (duckdb && duckdb.ToadParquetLedger) {
      const ledger = duckdb.ToadParquetLedger.getInstance();
      const res = await ledger.purgeProjectCache(projectId);
      this.notify();
      return res;
    }
    return { purgedFiles: 0, freedBytes: 0 };
  }

  public async removeFileFromProject(
    projectId: string,
    filePath: string
  ): Promise<{ freedBytes: number }> {
    try {
      const { MultipleLoadingManager } = require("./MultipleLoadingManager");
      MultipleLoadingManager.getInstance().unregisterFile(filePath);
    } catch {}

    const bridge = getBridge();
    if (bridge && typeof bridge.invoke === "function") {
      try {
        const res = await bridge.invoke("project:removeFile", { projectId, filePath });
        this.notify();
        return res;
      } catch {}
    }

    const duckdb = getReltabDuckDB();
    if (duckdb && duckdb.ToadParquetLedger) {
      const ledger = duckdb.ToadParquetLedger.getInstance();
      const res = await ledger.removeFileFromProject(projectId, filePath);
      this.notify();
      return res;
    }
    return { freedBytes: 0 };
  }
}
