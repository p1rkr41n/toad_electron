import * as reltab from "reltab";
import * as log from "loglevel";
import { StateRef, mutableGet } from "oneref";
import { AppState } from "./AppState";
import { getDefaultPageSize } from "./ViewState";
import * as actions from "./actions";
import { getHostBridge } from "host-bridge";

function getActions(): typeof actions {
  return actions;
}

export type FileIngestStatus = "idle" | "pending" | "processing" | "ready" | "error" | "modified";

export interface FileIngestItem {
  key: string;
  canonicalPath: string;
  dsPath: reltab.DataSourcePath;
  dsc: reltab.DataSourceConnection;
  fileName: string;
  fileSizeBytes?: number;
  status: FileIngestStatus;
  percent: number;
  speedMBs?: number;
  etaSec?: number;
  statusText?: string;
  error?: string;
  priority: number;
  addedTime: number;
  version: number;
}

export interface FirstPageCacheEntry {
  tableName: string;
  schema: reltab.Schema;
  tableRep: reltab.TableRep;
  totalRowCount: number;
  pageSize: number;
  bufferPages: number;
  cachedAt: number;
}

export type QueueChangeListener = () => void;

/**
 * Trích xuất đường dẫn đĩa vật lý chuẩn hóa (Canonical Path) từ DataSourcePath
 * Giúp nhận diện cùng 1 tệp dù được mở ở Root hay nằm trong thư mục con
 */
export function getCanonicalPathFromDSPath(dsPath: reltab.DataSourcePath): string {
  try {
    let base = "";
    if (typeof dsPath.sourceId === "string") {
      base = dsPath.sourceId;
    } else if (
      dsPath.sourceId &&
      typeof (dsPath.sourceId as any).resourceId === "string"
    ) {
      base = (dsPath.sourceId as any).resourceId;
    }
    const cleanSub = (dsPath.path || []).filter((p) => p && p !== ".");
    let full = base;
    if (cleanSub.length > 0) {
      for (const seg of cleanSub) {
        if (!full.endsWith("\\") && !full.endsWith("/")) {
          full += "\\";
        }
        full += seg;
      }
    }
    return full.replace(/[\/\\]+/g, "\\").toLowerCase();
  } catch {
    return JSON.stringify(dsPath).toLowerCase();
  }
}

/**
 * MultipleLoadingManager:
 * Động cơ nạp ngầm đa tệp tự động theo thuật toán Shortest Job First (SJF) & Dynamic Data Size Budget:
 * - Định kỳ 1s kiểm tra hàng đợi các file trong danh sách nguồn dữ liệu.
 * - Sắp xếp hàng đợi: Ưu tiên người dùng click (User Priority) > Dung lượng nhỏ nhất trước (SJF) > FIFO.
 * - Xử lý song song tối đa N tệp (mặc định 4 tệp) và tổng dung lượng in-flight tối đa M GB (mặc định 1 GB).
 * - Chế độ Exclusive Big File Mode: nếu queue rảnh, file > 1GB vẫn được nạp an toàn 1 mình.
 * - Hỗ trợ cướp quyền ưu tiên (VIP Jump Queue) khi người dùng click xem file.
 * - File nạp xong chuyển màu đen/sáng, % và thanh xanh ẩn đi.
 * - File lỗi chuyển màu đỏ cảnh báo.
 * - Immutable State updates & Canonical Path synchronization.
 */
export class MultipleLoadingManager {
  private static instance: MultipleLoadingManager | null = null;

  public static getInstance(): MultipleLoadingManager {
    if (!MultipleLoadingManager.instance) {
      MultipleLoadingManager.instance = new MultipleLoadingManager();
    }
    return MultipleLoadingManager.instance;
  }

  private files: Map<string, FileIngestItem> = new Map();
  private canonicalMap: Map<string, Set<string>> = new Map();
  private activeItems: Map<string, FileIngestItem> = new Map();
  private listeners: Set<QueueChangeListener> = new Set();
  private timerId: any = null;
  private stateRef: StateRef<AppState> | null = null;
  private pendingActiveOpenKey: string | null = null;
  private isPaused: boolean = false;
  private firstPageCache: Map<string, FirstPageCacheEntry> = new Map();
  private currentRewarmSize: number = 0;

  private maxConcurrentFiles: number = 4;
  private maxConcurrentGB: number = 1;

  private constructor() {
    (globalThis as any).multipleLoadingManagerInstance = this;
    this.loadConfig();
    this.startPollingLoop();
  }

  private async loadConfig() {
    try {
      const bridge = getHostBridge();
      const cfg = await bridge.getConfig();
      if (cfg && cfg.general) {
        this.setConfig({
          maxConcurrentFiles: cfg.general.max_concurrent_files,
          maxConcurrentGB: cfg.general.max_concurrent_gb,
        });
      }
    } catch (err) {
      // Fallback defaults
    }
  }

  public setConfig(cfg: { maxConcurrentFiles?: number | string; maxConcurrentGB?: number | string }) {
    if (cfg.maxConcurrentFiles !== undefined) {
      const n = Number(cfg.maxConcurrentFiles);
      if (!isNaN(n) && n >= 1) {
        this.maxConcurrentFiles = Math.min(32, Math.floor(n));
      }
    }
    if (cfg.maxConcurrentGB !== undefined) {
      const gb = Number(cfg.maxConcurrentGB);
      if (!isNaN(gb) && gb > 0) {
        this.maxConcurrentGB = gb;
      }
    }
    log.info(
      `[MultipleLoadingManager] Config updated: max_concurrent_files=${this.maxConcurrentFiles}, max_concurrent_gb=${this.maxConcurrentGB}GB`
    );
    this.checkAndProcessQueue();
  }

  public getQueueConfig(): { maxFiles: number; maxBytes: number } {
    const maxFiles = Math.max(1, this.maxConcurrentFiles);
    const maxBytes = Math.max(1024 * 1024, this.maxConcurrentGB * 1024 * 1024 * 1024);
    return { maxFiles, maxBytes };
  }

  public get currentInFlightBytes(): number {
    let total = 0;
    for (const item of this.activeItems.values()) {
      if (item.fileSizeBytes && item.fileSizeBytes > 0) {
        total += item.fileSizeBytes;
      }
    }
    return total;
  }

  public get activeItem(): FileIngestItem | null {
    return this.activeItems.values().next().value || null;
  }

  public getActiveItems(): FileIngestItem[] {
    return Array.from(this.activeItems.values());
  }

  public pause() {
    this.isPaused = true;
  }

  public resume() {
    this.isPaused = false;
    this.checkAndProcessQueue();
  }

  public setStateRef(stateRef: StateRef<AppState>) {
    this.stateRef = stateRef;
  }

  public subscribe(listener: QueueChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        log.error("MultipleLoadingManager: listener error", err);
      }
    }
  }

  public getItem(key: string): FileIngestItem | undefined {
    return this.files.get(key);
  }

  public getItemByCanonical(canonicalPath: string): FileIngestItem | undefined {
    const keys = this.canonicalMap.get(canonicalPath);
    if (keys) {
      for (const k of keys) {
        const it = this.files.get(k);
        if (it) return it;
      }
    }
    return undefined;
  }

  public getAllItems(): FileIngestItem[] {
    return Array.from(this.files.values());
  }

  // =========================================================================
  // RAM First-Page Micro-Cache (< 2ms Instant Loading)
  // =========================================================================
  private resolveCacheKey(keyOrCanon: string): string {
    if (!keyOrCanon) return "";
    const item = this.files.get(keyOrCanon);
    if (item && item.canonicalPath) {
      return item.canonicalPath.replace(/[\/\\]+/g, "\\").toLowerCase();
    }
    if (keyOrCanon.startsWith("{") && keyOrCanon.endsWith("}")) {
      try {
        const parsed = JSON.parse(keyOrCanon);
        if (parsed && (parsed.sourceId || parsed.path)) {
          return getCanonicalPathFromDSPath(parsed);
        }
      } catch {}
    }
    return keyOrCanon.replace(/[\/\\]+/g, "\\").toLowerCase();
  }

  public getFirstPageCache(keyOrCanon: string): FirstPageCacheEntry | undefined {
    const key = this.resolveCacheKey(keyOrCanon);
    const entry = this.firstPageCache.get(key) || this.firstPageCache.get(keyOrCanon);
    if (entry) {
      entry.cachedAt = Date.now();
    }
    return entry;
  }

  public hasFirstPageCache(keyOrCanon: string): boolean {
    const key = this.resolveCacheKey(keyOrCanon);
    return this.firstPageCache.has(key) || this.firstPageCache.has(keyOrCanon);
  }

  public setFirstPageCache(keyOrCanon: string, entry: FirstPageCacheEntry): void {
    const key = this.resolveCacheKey(keyOrCanon);
    if (!this.firstPageCache.has(key)) {
      while (this.firstPageCache.size >= 30) {
        let oldestKey: string | null = null;
        let oldestTime = Infinity;
        for (const [k, v] of this.firstPageCache.entries()) {
          if (v.cachedAt < oldestTime) {
            oldestTime = v.cachedAt;
            oldestKey = k;
          }
        }
        if (oldestKey) {
          this.firstPageCache.delete(oldestKey);
        } else {
          break;
        }
      }
    }
    this.firstPageCache.set(key, entry);
  }

  public clearFirstPageCache(targetKeyOrPath?: string): void {
    if (targetKeyOrPath) {
      const key = this.resolveCacheKey(targetKeyOrPath);
      this.firstPageCache.delete(key);
      this.firstPageCache.delete(targetKeyOrPath);
    } else {
      this.firstPageCache.clear();
    }
  }

  public unregisterFile(filePathOrKey: string): void {
    const canon = filePathOrKey.replace(/[\/\\]+/g, "\\").toLowerCase();
    const keySet = this.canonicalMap.get(canon);
    if (keySet) {
      for (const k of keySet) {
        this.files.delete(k);
        this.activeItems.delete(k);
      }
      this.canonicalMap.delete(canon);
    }
    this.files.delete(filePathOrKey);
    this.activeItems.delete(filePathOrKey);
    this.clearFirstPageCache(filePathOrKey);
    this.notify();
  }

  /**
   * Đăng ký danh sách file vào hàng đợi kiểm tra định kỳ
   */
  public registerFiles(
    items: {
      dsPath: reltab.DataSourcePath;
      dsc: reltab.DataSourceConnection;
      fileName: string;
      fileSizeBytes?: number;
    }[],
    stateRef?: StateRef<AppState>
  ) {
    if (stateRef) {
      this.stateRef = stateRef;
    }
    let hasNew = false;
    const now = Date.now();
    const MAX_IMMEDIATE_PRELOAD = 8;
    let pendingCount = 0;
    for (const f of this.files.values()) {
      if (f.status === "pending" || f.status === "processing") {
        pendingCount++;
      }
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const key = JSON.stringify(item.dsPath);
      const canonicalPath = getCanonicalPathFromDSPath(item.dsPath);

      let keySet = this.canonicalMap.get(canonicalPath);
      if (!keySet) {
        keySet = new Set();
        this.canonicalMap.set(canonicalPath, keySet);
      }
      keySet.add(key);

      const existing = this.files.get(key);
      if (existing) {
        if (existing.fileSizeBytes === undefined && item.fileSizeBytes !== undefined) {
          existing.fileSizeBytes = item.fileSizeBytes;
        }
        if (item.dsc && typeof (item.dsc as any).getCacheStatus === "function") {
          try {
            const cs = (item.dsc as any).getCacheStatus(item.dsPath);
            if (cs === "MODIFIED" && existing.status !== "modified" && existing.status !== "processing") {
              existing.status = "modified";
              existing.percent = 0;
              existing.version = (existing.version || 0) + 1;
              hasNew = true;
            }
          } catch {}
        }
      } else {
        // Kiểm tra xem tệp này đã được nạp sẵn sàng ở 1 nguồn khác chưa (cache hit)
        let isAlreadyReady = false;
        for (const existingKey of keySet) {
          const ex = this.files.get(existingKey);
          if (ex && ex.status === "ready") {
            isAlreadyReady = true;
            break;
          }
        }

        // DOUBLE-VALID PARQUET LEDGER CHECK:
        let cacheStatus: reltab.CacheValidityStatus = "UNPROCESSED";
        if (item.dsc && typeof (item.dsc as any).getCacheStatus === "function") {
          try {
            cacheStatus = (item.dsc as any).getCacheStatus(item.dsPath);
          } catch { }
        } else if (item.dsc && typeof (item.dsc as any).isCacheReady === "function") {
          try {
            if ((item.dsc as any).isCacheReady(item.dsPath)) {
              cacheStatus = "VALID";
            }
          } catch { }
        }

        let initialStatus: FileIngestStatus = "idle";
        let initialPercent = 0;

        if (cacheStatus === "VALID") {
          initialStatus = "ready";
          initialPercent = 100;
        } else if (cacheStatus === "MODIFIED") {
          initialStatus = "modified";
          initialPercent = 0;
        } else if (isAlreadyReady) {
          initialStatus = "ready";
          initialPercent = 100;
        } else if (pendingCount < MAX_IMMEDIATE_PRELOAD) {
          initialStatus = "pending";
          initialPercent = 0;
          pendingCount++;
        }

        this.files.set(key, {
          key,
          canonicalPath,
          dsPath: item.dsPath,
          dsc: item.dsc,
          fileName: item.fileName,
          fileSizeBytes: item.fileSizeBytes,
          status: initialStatus,
          percent: initialPercent,
          priority: 0,
          addedTime: now + i,
          version: 1,
        });
        hasNew = true;
      }
    }

    if (hasNew) {
      this.notify();
      this.checkAndProcessQueue();
    }
  }

  /**
   * Người dùng click vào file: Đẩy độ ưu tiên cao nhất để nạp ngay!
   */
  public prioritize(keyOrCanon: string, stateRef?: StateRef<AppState>) {
    if (stateRef) {
      this.stateRef = stateRef;
    }
    const item = this.files.get(keyOrCanon) || this.getItemByCanonical(keyOrCanon);
    if (!item) return;
    const key = item.key;

    this.pendingActiveOpenKey = key;

    // Nếu là "modified", kích hoạt nạp lại từ nguồn (forceReopen)
    if (item.status === "modified") {
      log.info(`[MultipleLoading] File ${item.fileName} bi MODIFIED, uu tien nap lai tu nguon voi forceReopen=true`);
      const processingItem: FileIngestItem = {
        ...item,
        status: "processing",
        percent: 0,
        priority: Date.now() + 1000000,
        version: (item.version || 0) + 1,
      };
      this.activeItems.set(item.key, processingItem);
      this.files.set(item.key, processingItem);
      const siblingKeys = this.canonicalMap.get(processingItem.canonicalPath);
      this.notify();
      this.dispatchWorker(processingItem, siblingKeys, { forceReopen: true });
      return;
    }

    // Nếu đã ready rồi thì không cần xếp hàng
    if (item.status === "ready") {
      return;
    }

    // Double-Valid Parquet Ledger check: nếu cache đã hợp lệ thì mark ready tức thì
    if (item.dsc && typeof (item.dsc as any).getCacheStatus === "function") {
      try {
        const cStatus = (item.dsc as any).getCacheStatus(item.dsPath);
        if (cStatus === "VALID") {
          this.markReady(item.dsPath);
          return;
        } else if (cStatus === "MODIFIED") {
          const modItem = { ...item, status: "modified" as FileIngestStatus };
          this.files.set(key, modItem);
          this.prioritize(key, stateRef);
          return;
        }
      } catch { }
    } else if (item.dsc && typeof (item.dsc as any).isCacheReady === "function") {
      try {
        if ((item.dsc as any).isCacheReady(item.dsPath)) {
          this.markReady(item.dsPath);
          return;
        }
      } catch { }
    }

    // Đẩy priority lên cao nhất với bản sao bất biến, đảm bảo status là "pending"
    const updated: FileIngestItem = {
      ...item,
      status: "pending",
      priority: Date.now(),
      version: (item.version || 0) + 1,
    };
    this.files.set(key, updated);
    this.notify();

    // Kích hoạt ngay lập tức nếu queue còn chỗ
    this.checkAndProcessQueue();
  }

  /**
   * Đánh dấu một DataSourcePath đã sẵn sàng (Ready 100%)
   * Dùng khi tệp đã được nạp thành công vào DataGrid chính hoặc DuckDB
   * Đồng bộ tức thì tới tất cả các node trỏ cùng tệp vật lý trên đĩa (Canonical Path)
   */
  public markReady(dsPath: reltab.DataSourcePath) {
    const key = JSON.stringify(dsPath);
    const canonicalPath = getCanonicalPathFromDSPath(dsPath);
    const matchingKeys = new Set<string>();
    matchingKeys.add(key);

    const keysForCanon = this.canonicalMap.get(canonicalPath);
    if (keysForCanon) {
      for (const k of keysForCanon) {
        matchingKeys.add(k);
      }
    }

    for (const k of matchingKeys) {
      const item = this.files.get(k);
      if (!item) {
        const seg = dsPath.path[dsPath.path.length - 1];
        const fileName =
          seg && seg !== "."
            ? seg
            : typeof (dsPath.sourceId as any)?.resourceId === "string"
            ? (dsPath.sourceId as any).resourceId.split(/[/\\]/).pop() || "dataset"
            : "dataset";
        this.files.set(k, {
          key: k,
          canonicalPath,
          dsPath,
          dsc: null as any,
          fileName,
          status: "ready",
          percent: 100,
          priority: 0,
          addedTime: Date.now(),
          version: 1,
        });
      } else {
        const updated: FileIngestItem = {
          ...item,
          status: "ready",
          percent: 100,
          error: undefined,
          version: (item.version || 0) + 1,
        };
        this.files.set(k, updated);
      }

      if (this.activeItems.has(k)) {
        this.activeItems.delete(k);
      }
      if (this.pendingActiveOpenKey === k) {
        this.pendingActiveOpenKey = null;
      }
    }

    this.notify();

    // Kích hoạt tệp kế tiếp nếu còn trong hàng đợi và không bị tạm hoãn
    if (!this.isPaused) {
      setTimeout(() => this.checkAndProcessQueue(), 200);
    }
  }

  /**
   * Lắng nghe IPC progress từ DuckDB ingestion
   */
  public handleIngestProgress(
    info: {
      fileName: string;
      percent: number;
      speedMBs?: number;
      etaSec?: number;
      isOpen?: boolean;
      statusText?: string;
    },
    stateRef?: StateRef<AppState>
  ) {
    if (stateRef) {
      this.stateRef = stateRef;
    }

    if (this.activeItems.size === 0) {
      return;
    }

    const infoBase = (info.fileName || "")
      .split(/[\\/]/)
      .pop()
      ?.toLowerCase() || "";

    // Tìm activeItem tương ứng với fileName của progress
    let matchedItem: FileIngestItem | undefined;

    for (const item of this.activeItems.values()) {
      const activeBase = (item.fileName || "")
        .split(/[\\/]/)
        .pop()
        ?.toLowerCase() || "";
      if (
        infoBase === activeBase ||
        (infoBase && activeBase && (infoBase.includes(activeBase) || activeBase.includes(infoBase)))
      ) {
        matchedItem = item;
        break;
      }
    }

    if (!matchedItem && this.activeItems.size === 1) {
      matchedItem = this.activeItems.values().next().value;
    }

    if (matchedItem) {
      const nextPercent = Math.min(100, Math.max(0, info.percent || 0));
      const nextStatus = nextPercent >= 100 ? "ready" : "processing";

      // Cập nhật bất biến (Immutable State)
      const updated: FileIngestItem = {
        ...matchedItem,
        percent: nextPercent,
        status: nextStatus,
        speedMBs: info.speedMBs !== undefined ? info.speedMBs : matchedItem.speedMBs,
        etaSec: info.etaSec !== undefined ? info.etaSec : matchedItem.etaSec,
        statusText: info.statusText || matchedItem.statusText,
        version: (matchedItem.version || 0) + 1,
      };
      this.activeItems.set(updated.key, updated);
      this.files.set(updated.key, updated);

      // Đồng bộ tới tất cả node cùng tệp đĩa
      const siblingKeys = this.canonicalMap.get(updated.canonicalPath);
      if (siblingKeys) {
        for (const sKey of siblingKeys) {
          if (sKey !== updated.key) {
            const sib = this.files.get(sKey);
            if (sib) {
              this.files.set(sKey, {
                ...sib,
                percent: nextPercent,
                status: nextStatus,
                speedMBs: updated.speedMBs,
                etaSec: updated.etaSec,
                statusText: updated.statusText,
                version: (sib.version || 0) + 1,
              });
            }
          }
        }
      }

      // Đồng bộ lên AppState nếu file này đang được chờ hoặc hiển thị trên màn hình chính
      if (this.stateRef) {
        const appState = mutableGet(this.stateRef);
        if (
          appState.activeLoadingFile &&
          appState.activeLoadingFile.isLoading
        ) {
          const activeCanon = appState.activeLoadingFile.dsPath
            ? getCanonicalPathFromDSPath(appState.activeLoadingFile.dsPath)
            : "";
          const activeBase = (matchedItem.fileName || "")
            .split(/[\\/]/)
            .pop()
            ?.toLowerCase() || "";

          if (
            activeCanon === updated.canonicalPath ||
            appState.activeLoadingFile.fileName.toLowerCase() === activeBase ||
            this.pendingActiveOpenKey === matchedItem.key
          ) {
            getActions().setActiveLoadingFile(
              {
                ...appState.activeLoadingFile,
                percent: updated.percent,
                speedMBs: updated.speedMBs,
                etaSec: updated.etaSec,
                statusText: info.statusText || updated.statusText,
              },
              this.stateRef
            );
          }
        }
      }

      this.notify();
    }
  }

  /**
   * Vòng lặp định kỳ 1s (1s Polling Loop)
   */
  private startPollingLoop() {
    if (this.timerId) {
      clearInterval(this.timerId);
    }
    this.timerId = setInterval(() => {
      this.checkAndProcessQueue();
    }, 1000);
  }

  public stopPollingLoop() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * Kiểm tra và nạp song song các file trong hàng đợi theo ngân sách dung lượng và số luồng
   */
  private async checkAndProcessQueue() {
    if (this.isPaused) {
      return;
    }

    const { maxFiles, maxBytes } = this.getQueueConfig();

    while (this.activeItems.size < maxFiles) {
      // Lọc các file đang ở trạng thái pending
      const pendingList: FileIngestItem[] = [];
      for (const item of this.files.values()) {
        if (item.status === "pending") {
          pendingList.push(item);
        }
      }

      if (pendingList.length === 0) {
        // Nếu không còn file pending và queue rảnh hoàn toàn,
        // thong thả kích hoạt dần tối đa 2 file idle kế tiếp
        if (this.activeItems.size === 0) {
          let promoted = 0;
          for (const item of this.files.values()) {
            if (item.status === "idle") {
              const updatedItem: FileIngestItem = {
                ...item,
                status: "pending",
                version: (item.version || 0) + 1,
              };
              this.files.set(item.key, updatedItem);
              pendingList.push(updatedItem);
              promoted++;
              if (promoted >= 2) break;
            }
          }
        }
        if (pendingList.length === 0) {
          break;
        }
      }

      // Sắp xếp hàng đợi theo thuật toán:
      // 1. Độ ưu tiên người dùng (User Priority Jump Queue)
      // 2. Dung lượng nhỏ nhất trước (Shortest Job First - SJF)
      // 3. Thời điểm thêm vào hàng đợi (FIFO)
      pendingList.sort((a, b) => {
        if (b.priority !== a.priority) {
          return b.priority - a.priority;
        }
        const sizeA = a.fileSizeBytes !== undefined ? a.fileSizeBytes : 0;
        const sizeB = b.fileSizeBytes !== undefined ? b.fileSizeBytes : 0;
        if (sizeA !== sizeB) {
          return sizeA - sizeB;
        }
        return a.addedTime - b.addedTime;
      });

      const currentBytes = this.currentInFlightBytes;

      // Kiểm tra ngân sách dung lượng (Data Size Budget):
      // - Nếu queue đang hoàn toàn rảnh (activeItems.size === 0): cho phép nạp tệp đầu tiên kể cả khi dung lượng > maxBytes (Exclusive Big File Mode)
      // - Nếu đang có tệp chạy (activeItems.size > 0): tìm tệp đầu tiên thỏa mãn currentBytes + candidateSize <= maxBytes
      let candidateIndex = -1;
      if (this.activeItems.size === 0) {
        candidateIndex = 0;
      } else {
        for (let i = 0; i < pendingList.length; i++) {
          const candidate = pendingList[i];
          const candidateSize = candidate.fileSizeBytes !== undefined ? candidate.fileSizeBytes : 0;
          if (currentBytes + candidateSize <= maxBytes) {
            candidateIndex = i;
            break;
          }
        }
      }

      if (candidateIndex === -1) {
        // Không có file pending nào thỏa mãn ngân sách dung lượng còn lại khi các file khác đang chạy.
        // Chờ ít nhất một file active hoàn tất giải phóng ngân sách.
        break;
      }

      const targetItem = pendingList[candidateIndex];

      const processingItem: FileIngestItem = {
        ...targetItem,
        status: "processing",
        percent: 0,
        version: (targetItem.version || 0) + 1,
      };
      this.activeItems.set(processingItem.key, processingItem);
      this.files.set(processingItem.key, processingItem);

      // Đồng bộ trạng thái processing tới các sibling
      const siblingKeys = this.canonicalMap.get(processingItem.canonicalPath);
      if (siblingKeys) {
        for (const sKey of siblingKeys) {
          if (sKey !== processingItem.key) {
            const sib = this.files.get(sKey);
            if (sib) {
              this.files.set(sKey, {
                ...sib,
                status: "processing",
                percent: 0,
                version: (sib.version || 0) + 1,
              });
            }
          }
        }
      }

      this.notify();

      // Kích hoạt worker bất đồng bộ song song
      this.dispatchWorker(processingItem, siblingKeys);
    }
  }

  /**
   * Worker xử lý độc lập từng tệp dữ liệu ngầm
   */
  private async dispatchWorker(
    processingItem: FileIngestItem,
    siblingKeys?: Set<string>,
    options?: { forceReopen?: boolean }
  ) {
    const targetItem = processingItem;
    const sizeMb = ((processingItem.fileSizeBytes || 0) / (1024 * 1024)).toFixed(2);
    log.info(
      `[MultipleLoading] Bat dau xu ly worker song song: ${processingItem.fileName} (${sizeMb} MB) [Active: ${this.activeItems.size}, In-Flight: ${(this.currentInFlightBytes / (1024 * 1024)).toFixed(2)} MB]`
    );

    try {
      // Gọi getTableName để DuckDB import file và tạo parquet cache
      const tableName = await processingItem.dsc.getTableName(processingItem.dsPath, {
        isBackground: true,
        forceReopen: options?.forceReopen === true,
      } as any);
      log.info(
        `[MultipleLoading] Hoan tat nạp file ${processingItem.fileName} thanh cong -> Bang: ${tableName}`
      );

      // RAM 3-Page Micro-Cache: Pre-warm first 3 pages into RAM buffer cache (< 5ms instant open)
      try {
        const pSize = getDefaultPageSize();
        const baseQuery = reltab.tableQuery(tableName);
        const totalRowCount = await processingItem.dsc.rowCount(baseQuery);
        const preloadLimit = Math.min(totalRowCount, pSize * 3);

        const tableRep = await processingItem.dsc.evalQuery(baseQuery, 0, preloadLimit);
        const cacheEntry: FirstPageCacheEntry = {
          tableName,
          schema: tableRep.schema,
          tableRep,
          totalRowCount,
          pageSize: pSize,
          bufferPages: 3,
          cachedAt: Date.now(),
        };
        this.setFirstPageCache(processingItem.canonicalPath, cacheEntry);
        this.setFirstPageCache(processingItem.key, cacheEntry);
        log.info(
          `[MultipleLoading] Pre-warmed RAM 3-Page Cache cho ${processingItem.fileName} (${totalRowCount} rows, ${tableRep.rowData.length} cached rows, pageSize: ${pSize})`
        );
      } catch (cacheErr: any) {
        log.warn(
          `[MultipleLoading] Khong the pre-warm RAM cache cho ${processingItem.fileName}:`,
          cacheErr
        );
      }

      const readyItem: FileIngestItem = {
        ...processingItem,
        status: "ready",
        percent: 100,
        error: undefined,
        version: (processingItem.version || 0) + 1,
      };
      this.files.set(readyItem.key, readyItem);

      if (siblingKeys) {
        for (const sKey of siblingKeys) {
          if (sKey !== readyItem.key) {
            const sib = this.files.get(sKey);
            if (sib) {
              this.files.set(sKey, {
                ...sib,
                status: "ready",
                percent: 100,
                error: undefined,
                version: (sib.version || 0) + 1,
              });
            }
          }
        }
      }

      this.activeItems.delete(processingItem.key);
      this.notify();

      // Kiểm tra xem người dùng có đang đứng ở màn hình chờ của tệp này không:
      let shouldOpenOnMain = false;
      if (this.stateRef) {
        const appState = mutableGet(this.stateRef);
        if (
          appState.activeLoadingFile &&
          appState.activeLoadingFile.isLoading
        ) {
          const activeCanon = appState.activeLoadingFile.dsPath
            ? getCanonicalPathFromDSPath(appState.activeLoadingFile.dsPath)
            : "";
          if (
            activeCanon === readyItem.canonicalPath ||
            this.pendingActiveOpenKey === targetItem.key
          ) {
            shouldOpenOnMain = true;
          }
        } else if (this.pendingActiveOpenKey === targetItem.key) {
          shouldOpenOnMain = true;
        }
      }

      if (shouldOpenOnMain && this.stateRef) {
        this.pendingActiveOpenKey = null;
        getActions().setActiveLoadingFile(null, this.stateRef);
        await getActions().openDataSourcePath(targetItem.dsPath, this.stateRef);
        // Delay 300ms sau khi file chính đã mở xong để giao diện DataGrid render hoàn tất
        setTimeout(() => this.checkAndProcessQueue(), 300);
      } else {
        // Kích hoạt ngay file kế tiếp nếu còn trong hàng đợi
        setTimeout(() => this.checkAndProcessQueue(), 50);
      }
    } catch (err: any) {
      log.error(
        `[MultipleLoading] Loi khi nap file ${processingItem.fileName}:`,
        err
      );
      const errorItem: FileIngestItem = {
        ...processingItem,
        status: "error",
        error: err?.message || String(err),
        version: (processingItem.version || 0) + 1,
      };
      this.files.set(errorItem.key, errorItem);
      this.activeItems.delete(processingItem.key);
      this.notify();

      if (
        this.pendingActiveOpenKey === targetItem.key &&
        this.stateRef
      ) {
        this.pendingActiveOpenKey = null;
        getActions().setActiveLoadingFile(
          {
            isLoading: false,
            fileName: targetItem.fileName,
            dsPath: targetItem.dsPath,
            percent: 0,
            error: errorItem.error,
          },
          this.stateRef
        );
      }

      // Kích hoạt ngay file kế tiếp
      setTimeout(() => this.checkAndProcessQueue(), 50);
    }
  }

  /**
   * Re-warm RAM 3-Page Buffer Cache for all ready files when pageSize is changed
   */
  public async rewarmAllReadyCaches(newSize: number): Promise<void> {
    this.currentRewarmSize = newSize;
    const readyItems = Array.from(this.files.values()).filter(
      (it) => it.status === "ready" && it.dsc
    );
    const seenCanons = new Set<string>();
    for (const it of readyItems) {
      if (this.currentRewarmSize !== newSize) {
        log.info(
          `[MultipleLoading] Aborting rewarmAllReadyCaches(${newSize}) because a newer rewarm target (${this.currentRewarmSize}) is active`
        );
        return;
      }
      if (seenCanons.has(it.canonicalPath)) continue;
      seenCanons.add(it.canonicalPath);
      try {
        const existing =
          this.getFirstPageCache(it.canonicalPath) || this.getFirstPageCache(it.key);
        if (
          existing &&
          existing.pageSize === newSize &&
          existing.tableRep.rowData.length === Math.min(existing.totalRowCount, newSize * 3)
        ) {
          continue;
        }
        const tableName =
          existing?.tableName ||
          (await it.dsc.getTableName(it.dsPath, { isBackground: true } as any));
        const baseQuery = reltab.tableQuery(tableName);
        const totalRowCount =
          existing?.totalRowCount ?? (await it.dsc.rowCount(baseQuery));
        const limit = Math.min(totalRowCount, newSize * 3);
        const tableRep = await it.dsc.evalQuery(baseQuery, 0, limit);

        if (this.currentRewarmSize !== newSize) {
          return;
        }

        const updated: FirstPageCacheEntry = {
          tableName,
          schema: tableRep.schema,
          tableRep,
          totalRowCount,
          pageSize: newSize,
          bufferPages: 3,
          cachedAt: Date.now(),
        };
        this.setFirstPageCache(it.canonicalPath, updated);
        this.setFirstPageCache(it.key, updated);
        log.info(
          `[MultipleLoading] Re-warmed RAM 3-Page Cache cho ${it.fileName} (${totalRowCount} rows, ${tableRep.rowData.length} cached rows, pageSize: ${newSize})`
        );
      } catch (err) {
        log.warn(`[MultipleLoading] Loi khi rewarm cache cho ${it.fileName}:`, err);
      }
    }
  }

  public clearPendingActiveOpen() {
    this.pendingActiveOpenKey = null;
  }

  public clear() {
    this.files.clear();
    this.canonicalMap.clear();
    this.activeItems.clear();
    this.pendingActiveOpenKey = null;
    this.notify();
  }
}
