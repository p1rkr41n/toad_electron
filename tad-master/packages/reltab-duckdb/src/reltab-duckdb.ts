import { Connection, Database } from "duckdb-async";
import * as log from "loglevel";
import {
  colIsNumeric,
  ColumnMetadata,
  ColumnMetaMap,
  ColumnStatsMap,
  ColumnType,
  DataSourceConnection,
  DataSourceId,
  DataSourceNode,
  DataSourcePath,
  DataSourceProvider,
  DbDataSource,
  DbDriver,
  DuckDBDialect,
  NumericSummaryStats,
  registerProvider,
  Row,
  Schema,
  SQLDialect,
  TextSummaryStats,
} from "reltab"; // eslint-disable-line
import { initS3 } from "./s3utils";
import { initToadLedger, emitEngineTrace } from "./csvimport";

export * from "./csvimport";
export * from "./ingestWorker";
export { CacheValidityStatus, getCacheValidityStatus, DeterministicParquetPaths } from "./csvimport";

const columnTypes = DuckDBDialect.columnTypes;

let viewCounter = 0;

const genViewName = (): string => `toad_tmpView_${viewCounter++}`;

const typeLookup = (tnm: string): ColumnType => {
  const ret = columnTypes[tnm] as ColumnType | undefined;
  if (ret == null) {
    throw new Error("typeLookup: unknown type name: '" + tnm + "'");
  }
  return ret;
};

/* A little ConnectionPool class because it turns out node-duckdb
 * doesn't allow concurrent queries on a connection.
 */
class ConnectionPool {
  db: Database;
  private pool: Connection[];

  constructor(db: Database) {
    this.db = db;
    this.pool = [];
  }

  async take(): Promise<Connection> {
    if (this.pool.length > 0) {
      return this.pool.pop()!;
    } else {
      const conn = await this.db.connect();
      await initS3(conn);
      return conn;
    }
  }

  giveBack(conn: Connection) {
    this.pool.push(conn);
  }
}

const parsePercentage = (s: any): number | null => {
  if (typeof s === "number") {
    return s / 100.0;
  }
  if (typeof s === "string") {
    const noPct = s.replace(/%$/, "");
    const ret = Number.parseFloat(noPct) / 100.0;
    return ret;
  }
  return null;
};

/**
 * checkCols: check that all of the specified column names are present in the row and non-null
 */
function checkCols(row: Row, colNames: string[]): boolean {
  for (const colName of colNames) {
    if (row[colName] == null) {
      return false;
    }
  }
  return true;
}

/**
 * Take the rows from a table_info() or DESCRIBE and turn it into
 * a reltab Schema
 * @param metaRows
 */
export function schemaFromTableInfo(
  metaRows: Row[],
  columNameKey: string,
  columnTypeKey: string
): Schema {
  const extendCMap = (
    columnMetaMap: ColumnMetaMap,
    row: any,
    idx: number
  ): ColumnMetaMap => {
    const displayName = row[columNameKey];
    const columnType: string = row[columnTypeKey].toLocaleUpperCase();
    const ct = DuckDBDialect.columnTypes[columnType];
    const columnMetadata: ColumnMetadata = {
      displayName,
      columnType,
    };
    columnMetaMap[displayName] = columnMetadata;
    return columnMetaMap;
  };

  const cmMap = metaRows.reduce(extendCMap, {});
  const columnIds = metaRows.map((r) => r[columNameKey]);
  const schema = new Schema(DuckDBDialect, columnIds as string[], cmMap);
  return schema;
}

/**
 * Take the rows from a table_info() or DESCRIBE and turn it into
 * a reltab Schema
 * @param metaRows
 */
export function columnStatsFromSummarize(
  metaRows: Row[],
  columNameKey: string,
  columnTypeKey: string
): ColumnStatsMap {
  const columnStatsMap: ColumnStatsMap = {};

  for (const row of metaRows) {
    const colId = row[columNameKey] as string;
    const columnType: string = (
      row[columnTypeKey] as string
    ).toLocaleUpperCase();
    const ct = DuckDBDialect.columnTypes[columnType];
    if (
      ct &&
      colIsNumeric(ct) &&
      checkCols(row, [
        "min",
        "max",
        "approx_unique",
        "count",
        "null_percentage",
      ])
    ) {
      // numeric type!
      // annoyingly, DuckDb summarize stats returned as a (nullable!) varchar:
      const minVal = Number.parseFloat(row.min as string);
      const maxVal = Number.parseFloat(row.max as string);
      const approxUnique = Number.parseInt(row.approx_unique as string);
      const count = Number.parseInt(row.count as string);
      const pctNull = parsePercentage(row.null_percentage as string);
      const columnStats: NumericSummaryStats = {
        statsType: "numeric",
        min: minVal,
        max: maxVal,
        approxUnique,
        count,
        pctNull,
      };
      columnStatsMap[colId] = columnStats;
    }
  }
  return columnStatsMap;
}

export class DuckDBDriver implements DbDriver {
  readonly displayName: string;
  readonly sourceId: DataSourceId;
  readonly dialect: SQLDialect = DuckDBDialect;
  dbfile: string;
  db: Database;
  connPool: ConnectionPool;
  private httpfsLoadPromise: Promise<void> | null = null;
  private arrowLoadPromise: Promise<void> | null = null;

  constructor(dbfile: string, db: Database, dbConn: Connection) {
    this.dbfile = dbfile;
    this.displayName = dbfile;
    this.sourceId = { providerName: "duckdb", resourceId: dbfile };
    this.db = db;
    this.connPool = new ConnectionPool(db);
  }

  private ensureHttpfsLoaded(): Promise<void> {
    if (!this.httpfsLoadPromise) {
      this.httpfsLoadPromise = loadHttpfsExtension(this.db);
    }
    return this.httpfsLoadPromise;
  }

  private ensureArrowLoaded(): Promise<void> {
    if (!this.arrowLoadPromise) {
      this.arrowLoadPromise = loadArrowExtension(this.db);
    }
    return this.arrowLoadPromise;
  }

  async runSqlQuery(query: string): Promise<Row[]> {
    if (/(?:s3|https?):\/\//i.test(query) || Boolean(process.env.AWS_ACCESS_KEY_ID)) {
      await this.ensureHttpfsLoaded();
    }
    let conn = await this.connPool.take();
    let connHealthy = false;
    let ret: any;
    const t0 = performance.now();
    const rss0 =
      typeof process !== "undefined" && process.memoryUsage
        ? process.memoryUsage().rss
        : 0;
    try {
      log.info("runSqlQuery:\n", query);
      try {
        ret = await conn.all(query);
        connHealthy = true;
      } catch (firstErr: any) {
        if (
          String(firstErr?.message || "").includes("cannot start a transaction within a transaction") &&
          !/\bBEGIN\b/i.test(query)
        ) {
          conn.close().catch(() => {});
          conn = await this.db.connect();
          await initS3(conn);
          ret = await conn.all(query);
          connHealthy = true;
        } else {
          throw firstErr;
        }
      }
      const elapsedMs = performance.now() - t0;
      const rssDeltaMB =
        typeof process !== "undefined" && process.memoryUsage
          ? ((process.memoryUsage().rss - rss0) / (1024 * 1024)).toFixed(2)
          : "0.00";
      const rowCount = Array.isArray(ret) ? ret.length : 0;
      const msg = `[ENGINE] [DuckDB] SQL Query executed (+${elapsedMs.toFixed(2)}ms, rows=${rowCount}, rssDelta=${rssDeltaMB}MB): ${query.trim().slice(0, 150)}`;
      emitEngineTrace("DuckDB", msg, { elapsedMs, rssDeltaMB });
    } finally {
      if (connHealthy) {
        this.connPool.giveBack(conn);
      } else {
        conn.close().catch(() => {});
      }
    }
    return ret;
  }

  async runSqlQueryArrow(query: string): Promise<Uint8Array | null> {
    if (/(?:s3|https?):\/\//i.test(query) || Boolean(process.env.AWS_ACCESS_KEY_ID)) {
      await this.ensureHttpfsLoaded();
    }
    await this.ensureArrowLoaded();
    const conn = await this.connPool.take();
    let connHealthy = false;
    const t0 = performance.now();
    const rss0 =
      typeof process !== "undefined" && process.memoryUsage
        ? process.memoryUsage().rss
        : 0;
    const cleanQuery = query.trim().replace(/;+$/, "");
    try {
      log.info("runSqlQueryArrow:\n", query);
      const rawConn = (conn as any).conn || (conn as any)._conn || conn;
      if (rawConn && typeof rawConn.arrowIPCAll === "function") {
        const out = await new Promise<Uint8Array>((resolve, reject) => {
          rawConn.arrowIPCAll(cleanQuery, (err: any, result: any[]) => {
            if (err) return reject(err);
            const elapsedMs = performance.now() - t0;
            const rssDeltaMB =
              typeof process !== "undefined" && process.memoryUsage
                ? ((process.memoryUsage().rss - rss0) / (1024 * 1024)).toFixed(2)
                : "0.00";
            if (!result || result.length === 0) {
              const msg = `[ENGINE] [DuckDB] Arrow IPC Stream (+${elapsedMs.toFixed(2)}ms, batches=0, bytes=0, rssDelta=${rssDeltaMB}MB): ${cleanQuery.slice(0, 150)}`;
              emitEngineTrace("DuckDB", msg, { elapsedMs, rssDeltaMB });
              return resolve(new Uint8Array(0));
            }
            const valid = result.filter(
              (b) => b != null && (b.length > 0 || b.byteLength > 0)
            );
            const batchCount = result.length;
            if (valid.length === 0) {
              const msg = `[ENGINE] [DuckDB] Arrow IPC Stream (+${elapsedMs.toFixed(2)}ms, batches=${batchCount}, bytes=0, rssDelta=${rssDeltaMB}MB): ${cleanQuery.slice(0, 150)}`;
              emitEngineTrace("DuckDB", msg, { elapsedMs, rssDeltaMB });
              return resolve(new Uint8Array(0));
            }
            const buf = Buffer.concat(valid);
            const byteCount = buf.byteLength;
            const msg = `[ENGINE] [DuckDB] Arrow IPC Stream (+${elapsedMs.toFixed(2)}ms, batches=${batchCount}, bytes=${byteCount}, rssDelta=${rssDeltaMB}MB): ${cleanQuery.slice(0, 150)}`;
            emitEngineTrace("DuckDB", msg, { elapsedMs, rssDeltaMB });

            const arrayBuffer =
              buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength
                ? buf.buffer
                : (buf.buffer.slice(
                    buf.byteOffset,
                    buf.byteOffset + buf.byteLength
                  ) as ArrayBuffer);
            resolve(new Uint8Array(arrayBuffer));
          });
        });
        connHealthy = true;
        return out;
      }
      connHealthy = true;
      return null;
    } catch (e) {
      log.warn("runSqlQueryArrow fallback to standard query:", e);
      return null;
    } finally {
      if (connHealthy) {
        this.connPool.giveBack(conn);
      } else {
        conn.close().catch(() => {});
      }
    }
  }

  async getDisplayName(): Promise<string> {
    return this.displayName;
  }

  async getTableSchema(tableName: string): Promise<Schema> {
    return this.getSqlQuerySchema(tableName);
  }

  async getSqlQuerySchema(sqlQuery: string): Promise<Schema> {
    let descRows: Row[];
    const describeQuery = `describe ${sqlQuery}`;
    descRows = await this.runSqlQuery(describeQuery);

    const schema = schemaFromTableInfo(descRows, "column_name", "column_type");
    return schema;
  }

  async getSqlQueryColumnStatsMap(sqlQuery: string): Promise<ColumnStatsMap> {
    try {
      const summarizeQuery = `summarize ${sqlQuery}`;
      const descRows = await this.runSqlQuery(summarizeQuery);
      const columnStatsMap = columnStatsFromSummarize(
        descRows,
        "column_name",
        "column_type"
      );
      return columnStatsMap;
    } catch (err) {
      console.warn("*** summarize query failed: ", err);
      return {};
    }
  }

  async getRootNode(): Promise<DataSourceNode> {
    const rootNode: DataSourceNode = {
      id: this.dbfile,
      kind: "Database",
      displayName: this.dbfile,
      isContainer: true,
    };
    return rootNode;
  }
  async getChildren(dsPath: DataSourcePath): Promise<DataSourceNode[]> {
    const { path } = dsPath;
    let node: DataSourceNode;
    const tiQuery = `PRAGMA show_tables;`;
    const dbRows = await this.runSqlQuery(tiQuery);
    const tableNames: string[] = dbRows.map((row: Row) => row.name as string);
    const childNodes: DataSourceNode[] = tableNames.map((tableName) => ({
      id: tableName,
      kind: "Table",
      displayName: tableName,
      isContainer: false,
    }));
    return childNodes;
  }

  async getTableName(dsPath: DataSourcePath): Promise<string> {
    const { path } = dsPath;
    if (path.length < 1) {
      throw new Error("getTableName: empty path");
    }
    return path[path.length - 1];
  }
}

let _httpfsUnavailable = false;
let _arrowExtUnavailable = false;

const shouldSkipRemoteInstall = (): boolean =>
  process.env.TOAD_ENGINE_WORKER === "1" ||
  process.env.TOAD_ENGINE_RECOVERY === "1" ||
  process.env.TOAD_OFFLINE_EXTENSIONS === "1";

const loadHttpfsExtension = async (db: Database): Promise<void> => {
  if (_httpfsUnavailable) return;
  try {
    await db.exec(`LOAD 'httpfs'`);
  } catch {
    if (shouldSkipRemoteInstall()) {
      _httpfsUnavailable = true;
    } else {
      try {
        await db.exec(`INSTALL 'httpfs'; LOAD 'httpfs'`);
      } catch (err) {
        _httpfsUnavailable = true;
        log.error("caught exception loading extensions: ", err);
        log.error("(ignoring unloadable extensions...)");
      }
    }
  }
};

const loadArrowExtension = async (db: Database): Promise<void> => {
  if (_arrowExtUnavailable) return;
  try {
    await db.exec(`LOAD 'arrow'`);
  } catch {
    if (shouldSkipRemoteInstall()) {
      _arrowExtUnavailable = true;
    } else {
      try {
        await db.exec(`INSTALL 'arrow'; LOAD 'arrow'`);
      } catch (err) {
        _arrowExtUnavailable = true;
        log.warn("caught notice loading arrow extension: ", err);
      }
    }
  }
};

const duckdbDataSourceProvider: DataSourceProvider = {
  providerName: "duckdb",
  connect: async (resourceId: any): Promise<DataSourceConnection> => {
    const rawFile = resourceId as string;
    const dbfile = rawFile && rawFile.startsWith(":memory:") ? ":memory:" : rawFile;
    const db = await Database.create(dbfile);
    if (Boolean(process.env.AWS_ACCESS_KEY_ID)) {
      await loadHttpfsExtension(db);
    }
    try {
      await initToadLedger(db);
    } catch (e) {
      log.warn("[ToadLedger] Ledger initialization notice:", e);
    }
    const dbConn = await db.connect();
    const driver = new DuckDBDriver(rawFile, db, dbConn);
    const dsConn = new DbDataSource(driver);
    return dsConn;
  },
};

registerProvider(duckdbDataSourceProvider);
