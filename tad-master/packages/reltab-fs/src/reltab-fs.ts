import * as fs from "fs";
import * as log from "loglevel";
import * as path from "path";
import * as fsPromises from "fs/promises";

import {
  CacheValidityStatus,
  ColumnStatsMap,
  DataSourceConnection,
  DataSourceId,
  DataSourceNode,
  DataSourcePath,
  DataSourceProvider,
  DbDataSource,
  DbDriver,
  DuckDBDialect,
  getConnection,
  GetTableNameOptions,
  registerProvider,
  Row,
  Schema,
  SQLDialect,
} from "reltab";
import * as reltabDuckDB from "reltab-duckdb";
import { DuckDBDriver } from "reltab-duckdb";

export { scanDirectoryRecursive, generateUniqueProjectId } from "reltab-duckdb";

export const dataFileExtensions = [
  "csv",
  "tsv",
  "parquet",
  "json",
  "jsonl",
  "ndjson",
  "log",
  "txt",
  "evtx",
  "csv.gz",
  "tsv.gz",
];

interface ImportedFileInfo {
  baseName: string;
  tableName: string | null;
  path: string;
}

let _uiDuckDBDriver: DuckDBDriver | null = null;
let _ingestDuckDBDriver: DuckDBDriver | null = null;

export async function getUIDuckDBDriver(): Promise<DuckDBDriver> {
  if (!_uiDuckDBDriver) {
    const connKey: DataSourceId = {
      providerName: "duckdb",
      resourceId: ":memory:ui",
    };
    const dsConn = await getConnection(connKey, {
      hidden: true,
      forExport: true,
    });
    const dbds = dsConn as DbDataSource;
    _uiDuckDBDriver = dbds.db as reltabDuckDB.DuckDBDriver;
    // Cấu hình Interactive UI Engine (2 threads, 25% RAM)
    await reltabDuckDB.applyEngineConfig(_uiDuckDBDriver.db, false);
  }
  return _uiDuckDBDriver;
}

export async function getIngestDuckDBDriver(): Promise<DuckDBDriver> {
  if (!_ingestDuckDBDriver) {
    const connKey: DataSourceId = {
      providerName: "duckdb",
      resourceId: ":memory:ingest",
    };
    const dsConn = await getConnection(connKey, {
      hidden: true,
      forExport: false,
    });
    const dbds = dsConn as DbDataSource;
    _ingestDuckDBDriver = dbds.db as reltabDuckDB.DuckDBDriver;
    // Cấu hình Background Ingestion Engine (N-2 threads, 40% RAM)
    await reltabDuckDB.applyEngineConfig(_ingestDuckDBDriver.db, true);
  }
  return _ingestDuckDBDriver;
}

export async function getDuckDBDriver(): Promise<DuckDBDriver> {
  return getUIDuckDBDriver();
}

// Robust extName implementation that supports both compound extensions
// (e.g. '.csv.gz', '.tsv.gz') and multi-dot filenames (e.g. 'a.b.c.csv')
function extNameEx(filePath: string): string {
  const base = path.basename(filePath).toLowerCase();
  for (const ext of dataFileExtensions) {
    if (ext.includes(".") && base.endsWith("." + ext.toLowerCase())) {
      return "." + ext;
    }
  }
  return path.extname(filePath);
}

const ipfsPathPrefixes = ["s3://", "https://"];
export const isIPFSPath = (pathname: string): boolean => {
  for (const prefix of ipfsPathPrefixes) {
    if (pathname.startsWith(prefix)) {
      return true;
    }
  }
  return false;
};

interface ImportInfo {
  tableName: string; // table name used to import this table
  importModTime?: Date; // mod time of the file at time of import, as returned from fs.stat() (iff not an IPFS path)
}

// mapping from pathnames to imported table names:
type ImportMap = { [path: string]: ImportInfo };

export class FSDriver implements DbDriver {
  private dbc: DuckDBDriver; // Interactive UI Engine Driver
  private ingestDbc: DuckDBDriver | null; // Dedicated Background Ingestion Driver
  private rootPath: string;
  private isDir: boolean;
  private isIPFS: boolean;
  private importMap: ImportMap = {};
  private readonly displayName: string;
  readonly sourceId: DataSourceId;
  readonly dialect: SQLDialect = DuckDBDialect;

  constructor(
    dbc: DuckDBDriver,
    rootPath: string,
    isDir: boolean,
    isIPFS: boolean,
    ingestDbc?: DuckDBDriver | null
  ) {
    this.dbc = dbc;
    this.ingestDbc = ingestDbc || null;
    this.rootPath = rootPath;
    this.isDir = isDir;
    this.isIPFS = isIPFS;
    this.displayName = rootPath;
    this.sourceId = { providerName: "localfs", resourceId: rootPath };
  }

  async runSqlQuery(query: string): Promise<Row[]> {
    return this.dbc.runSqlQuery(query);
  }

  getTableSchema(tableName: string): Promise<Schema> {
    return this.dbc.getTableSchema(tableName);
  }
  getSqlQuerySchema(sqlQuery: string): Promise<Schema> {
    return this.dbc.getSqlQuerySchema(sqlQuery);
  }

  async getSqlQueryColumnStatsMap(sqlQuery: string): Promise<ColumnStatsMap> {
    return this.dbc.getSqlQueryColumnStatsMap(sqlQuery);
  }

  async getRootNode(): Promise<DataSourceNode> {
    const displayName = path.basename(this.rootPath);
    const rootNode: DataSourceNode = {
      id: ".",
      kind: this.isDir ? "Directory" : "File",
      displayName,
      isContainer: this.isDir,
    };
    return rootNode;
  }
  getTargetPath(dsPath: DataSourcePath): string {
    return this.isIPFS
      ? this.rootPath
      : path.join(this.rootPath, ...dsPath.path);
  }
  async getChildren(dsPath: DataSourcePath): Promise<DataSourceNode[]> {
    const targetPath = this.getTargetPath(dsPath);
    const dirEnts = await fs.promises.readdir(targetPath, {
      withFileTypes: true,
    });
    const dataEnts = dirEnts.filter((ent) => {
      const isDir = ent.isDirectory();
      if (isDir) {
        return true;
      }
      const extName = extNameEx(ent.name);
      if (extName !== "") {
        const ext = extName.slice(1).toLowerCase();
        const index = dataFileExtensions.findIndex((dext) => dext === ext);
        return index !== -1;
      }
      return false;
    });
    const childNodes = await Promise.all(
      dataEnts.map(async (ent) => {
        const isDir = ent.isDirectory();
        let fileSizeBytes: number | undefined = undefined;
        if (!isDir && !this.isIPFS) {
          try {
            const entPath = path.join(targetPath, ent.name);
            const st = await fsPromises.stat(entPath);
            fileSizeBytes = st.size;
          } catch {}
        }
        const node: DataSourceNode = {
          id: ent.name,
          kind: isDir ? "Directory" : "File",
          displayName: ent.name,
          isContainer: isDir,
          fileSizeBytes,
        };
        return node;
      })
    );
    return childNodes;
  }

  /**
   * Double-Valid Parquet Ledger check (kiểm tra nhanh đồng bộ trạng thái cache)
   */
  isCacheReady(dsPath: DataSourcePath): boolean {
    return this.getCacheStatus(dsPath) === "VALID";
  }

  getCacheStatus(dsPath: DataSourcePath): CacheValidityStatus {
    try {
      const targetPath = this.getTargetPath(dsPath);
      const cfg = reltabDuckDB.getIngestConfig();
      const cachedPaths = reltabDuckDB.getDeterministicParquetPath(
        targetPath,
        cfg.temp_dir
      );
      return reltabDuckDB.getCacheValidityStatus(targetPath, cachedPaths);
    } catch {
      return "UNPROCESSED";
    }
  }

  // Get a table name that can be used in queries:
  async getTableName(
    dsPath: DataSourcePath,
    options?: GetTableNameOptions
  ): Promise<string> {
    const targetPath = this.getTargetPath(dsPath);
    let importInfo = this.importMap[targetPath];
    const forceReopen = options?.forceReopen === true;
    const isBackground = (options as any)?.isBackground === true;

    // Dual DuckDB engines: UI Engine (phục vụ hiển thị DataGrid) & Ingest Engine (chuyên streaming ngầm)
    const uiDb = this.dbc.db;
    const ingestDb = this.ingestDbc ? this.ingestDbc.db : this.dbc.db;

    const cfg = reltabDuckDB.getIngestConfig();
    const cachedPaths = reltabDuckDB.getDeterministicParquetPath(
      targetPath,
      cfg.temp_dir
    );
    const isCacheHit = cachedPaths
      ? reltabDuckDB.checkParquetCache(targetPath, cachedPaths, forceReopen)
      : false;

    // NHÁNH 1: Parquet cache đã tồn tại sẵn trên đĩa (Instant Cache Hit)
    // Trường hợp file đã được nạp xong bởi Ingest Engine hoặc phiên làm việc trước:
    // Tuyệt đối không gọi Ingest Engine, chỉ mount VIEW trực tiếp vào UI Engine trong < 1ms!
    if (isCacheHit && cachedPaths) {
      const extName = path.extname(targetPath);
      const baseName = path.basename(targetPath, extName);
      const tableName = importInfo?.tableName || reltabDuckDB.genTableName(baseName);

      let uiConn: any = null;
      try {
        uiConn = await this.dbc.connPool.take();
        await reltabDuckDB.createViewFromParquet(
          uiConn,
          cachedPaths.parquetPath,
          tableName
        );
        log.info(
          `[DualEngine UI] Mount VIEW thanh cong tu Parquet cache vao UI Engine: ${tableName} (< 1ms)`
        );
      } catch (viewErr) {
        log.warn("[DualEngine UI] Loi khi tao VIEW tu Parquet cache:", viewErr);
      } finally {
        if (uiConn) {
          this.dbc.connPool.giveBack(uiConn);
        }
      }

      if (!isIPFSPath(targetPath)) {
        try {
          const fileStats = await fsPromises.stat(targetPath);
          importInfo = {
            tableName,
            importModTime: fileStats.mtime,
          };
          this.importMap[targetPath] = importInfo;
        } catch {}
      } else {
        importInfo = { tableName };
        this.importMap[targetPath] = importInfo;
      }
      return tableName;
    }

    // NHÁNH 2: Chưa có Parquet cache -> Cần convert (Streaming Ingest)
    if (!importInfo || forceReopen) {
      log.debug(
        "getTableName: no entry found or forceReopen for ",
        targetPath,
        ", importing..."
      );
      let tableName: string;
      const extName = path.extname(targetPath);
      if (extName === ".parquet") {
        tableName = await reltabDuckDB.nativeParquetImport(
          uiDb,
          targetPath
        );
      } else {
        // Tác vụ chạy nền (isBackground) dùng Ingest Engine; tác vụ foreground tương tác dùng trực tiếp UI Engine
        const targetDb = isBackground ? ingestDb : uiDb;
        tableName = await reltabDuckDB.nativeCSVImport(
          targetDb,
          targetPath,
          importInfo?.tableName,
          { forceReopen }
        );

        // Sau khi Ingest Engine ghi xong Parquet file, mount ngay VIEW vào UI Engine
        if (cachedPaths && fs.existsSync(cachedPaths.parquetPath)) {
          let uiConn: any = null;
          try {
            uiConn = await this.dbc.connPool.take();
            await reltabDuckDB.createViewFromParquet(
              uiConn,
              cachedPaths.parquetPath,
              tableName
            );
            log.info(
              `[DualEngine UI] Da mount VIEW san sang cho DataGrid: ${tableName}`
            );
          } catch (mountErr) {
            log.warn("[DualEngine UI] Loi khi mount view sau streaming:", mountErr);
          } finally {
            if (uiConn) {
              this.dbc.connPool.giveBack(uiConn);
            }
          }
        }
      }
      if (isIPFSPath(targetPath)) {
        importInfo = {
          tableName,
        };
      } else {
        const fileStats = await fsPromises.stat(targetPath);
        importInfo = {
          tableName,
          importModTime: fileStats.mtime,
        };
      }
      this.importMap[targetPath] = importInfo;
    } else {
      log.debug(" getTableName: ", targetPath, " ---> ", importInfo.tableName);
      if (importInfo.importModTime !== undefined) {
        const fileStats = await fsPromises.stat(targetPath);
        if (fileStats.mtime > importInfo.importModTime) {
          log.debug(
            "**** detected updated file, re-importing: ",
            targetPath,
            fileStats.mtime
          );
          const extName = path.extname(targetPath);
          const tableName = importInfo.tableName;
          if (extName === ".parquet") {
            await reltabDuckDB.nativeParquetImport(
              uiDb,
              targetPath,
              tableName
            );
          } else {
            const targetDb = isBackground ? ingestDb : uiDb;
            await reltabDuckDB.nativeCSVImport(
              targetDb,
              targetPath,
              tableName,
              { forceReopen: true }
            );
            if (cachedPaths && fs.existsSync(cachedPaths.parquetPath)) {
              let uiConn: any = null;
              try {
                uiConn = await this.dbc.connPool.take();
                await reltabDuckDB.createViewFromParquet(
                  uiConn,
                  cachedPaths.parquetPath,
                  tableName
                );
              } catch {} finally {
                if (uiConn) {
                  this.dbc.connPool.giveBack(uiConn);
                }
              }
            }
          }
          importInfo.importModTime = fileStats.mtime;
        }
      }
    }
    return importInfo.tableName;
  }

  // display name for this connection
  async getDisplayName(): Promise<string> {
    return this.displayName;
  }
}

async function connectFileSource(
  pathname: string
): Promise<DataSourceConnection> {
  const uiDbc = await getUIDuckDBDriver();
  const ingestDbc = await getIngestDuckDBDriver();

  if (isIPFSPath(pathname)) {
    const driver = new FSDriver(uiDbc, pathname, false, true, ingestDbc);
    const dsConn = new DbDataSource(driver);
    return dsConn;
  }
  // local file:
  // check if pathname exists
  if (!fs.existsSync(pathname)) {
    let msg = '"' + pathname + '": file not found.';
    throw new Error(msg);
  }
  const fstats = await fs.promises.stat(pathname);
  const isDir = fstats.isDirectory();

  const driver = new FSDriver(uiDbc, pathname, isDir, false, ingestDbc);
  const dsConn = new DbDataSource(driver);
  return dsConn;
}

const localfsDataSourceProvider: DataSourceProvider = {
  providerName: "localfs",
  connect: async (resourceId: any): Promise<DataSourceConnection> => {
    return connectFileSource(resourceId);
  },
};

registerProvider(localfsDataSourceProvider);
