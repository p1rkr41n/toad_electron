/**
 * Top-level, transport-agnostic async entry points for reltab as a
 * remote service.
 */

import * as log from "loglevel";
import * as prettyHRTime from "pretty-hrtime";
import {
  EngineReq,
  DbConnEvalQueryRequest,
  DbConnRowCountRequest,
  DbConnGetTableSchemaRequest,
  DbConnGetColumnStatsMapRequest,
  DbConnGetChildrenRequest,
  DbConnGetTableNameRequest,
  DbConnRunSqlQueryRequest,
  ReltabConnection,
} from "./Connection";
import {
  DataSourceConnection,
  DataSourceId,
  DataSourceNode,
  DataSourcePath,
  DataSourceProvider,
} from "../DataSource";
import { deserializeQueryReq, QueryExp } from "../QueryExp";
import {
  EncodedRequestHandler,
  TransportClient,
  TransportServer,
} from "./Transport";
import { TableRep } from "../TableRep";
import { Result } from "./result";
import { serializeError } from "./errorUtils";
import { Schema } from "../Schema";
import { ColumnStatsMap } from "../ColumnStats";
import {
  EngineQueryReq,
  EngineQueryResp,
  encodeTableRepBinary,
  postHybridResponse,
  postHybridError,
} from "./hybridProtocol";

export * from "./hybridProtocol";

const dbConnEvalQuery = async (
  conn: DataSourceConnection,
  req: DbConnEvalQueryRequest
): Promise<TableRep> => {
  const query = deserializeQueryReq(req.queryStr) as any;
  const hrstart = process.hrtime();
  const offset = req.offset ? req.offset : undefined;
  const limit = req.limit ? req.limit : undefined;
  const options = req.options ? req.options : undefined;
  const qres = await conn.evalQuery(query, offset, limit, options);
  const elapsed = process.hrtime(hrstart);
  log.info("runQuery: evaluated query in  ", prettyHRTime(elapsed));
  const qresStr = JSON.stringify(
    qres,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2
  );
  return qres;
};

const dbConnRowCount = async (
  conn: DataSourceConnection,
  req: DbConnRowCountRequest
): Promise<number> => {
  const query = deserializeQueryReq(req.queryStr) as any;
  const hrstart = process.hrtime();
  const count = await conn.rowCount(query, req.options);
  const elapsed = process.hrtime(hrstart);
  log.info("rowCount: evaluated query in", prettyHRTime(elapsed));
  return count;
};

const dbConnGetRootNode = async (
  conn: DataSourceConnection
): Promise<DataSourceNode> => {
  const hrstart = process.hrtime();
  const rootNode = await conn.getRootNode();
  const elapsed = process.hrtime(hrstart);
  log.info("dbGetRootNode: evaluated in", prettyHRTime(elapsed));
  return rootNode;
};

const dbConnGetChildren = async (
  conn: DataSourceConnection,
  req: DbConnGetChildrenRequest
): Promise<DataSourceNode[]> => {
  const hrstart = process.hrtime();
  const { path } = req;
  const children = await conn.getChildren(path);
  const elapsed = process.hrtime(hrstart);
  log.info("dbGetChildren: evaluated query in", prettyHRTime(elapsed));
  return children;
};

const dbConnGetTableName = async (
  conn: DataSourceConnection,
  req: DbConnGetTableNameRequest
): Promise<string> => {
  const hrstart = process.hrtime();
  const { path, forceReopen, isBackground } = req;
  const tableName = await conn.getTableName(path, { forceReopen, isBackground } as any);
  const elapsed = process.hrtime(hrstart);
  log.info("dbGetTableName: evaluated query in", prettyHRTime(elapsed));
  return tableName;
};

const dbConnGetTableSchema = async (
  conn: DataSourceConnection,
  req: DbConnGetTableSchemaRequest
): Promise<Schema> => {
  const hrstart = process.hrtime();
  const { tableName } = req;
  const schema = await conn.getTableSchema(tableName);
  const elapsed = process.hrtime(hrstart);
  log.info("dbGetTableSchema: evaluated query in", prettyHRTime(elapsed));
  return schema;
};

const dbConnGetColumnStatsMap = async (
  conn: DataSourceConnection,
  req: DbConnGetColumnStatsMapRequest
): Promise<ColumnStatsMap> => {
  const hrstart = process.hrtime();
  const { queryStr } = req;
  const query = deserializeQueryReq(queryStr) as any;
  const columnStatsMap = await conn.getColumnStatsMap(query);
  const elapsed = process.hrtime(hrstart);
  log.info("dbGetColumnStatsMap: evaluated query in", prettyHRTime(elapsed));
  return columnStatsMap;
};

const dbConnRunSqlQuery = async (
  conn: DataSourceConnection,
  req: DbConnRunSqlQueryRequest
): Promise<any> => {
  const hrstart = process.hrtime();
  const { sqlQuery } = req;
  const rows = await conn.runSqlQuery(sqlQuery);
  const elapsed = process.hrtime(hrstart);
  log.info("dbConnRunSqlQuery: evaluated query in", prettyHRTime(elapsed));
  return rows;
};

// an EngineReqHandler wraps a req in an EngineReq that carries an
// db engine identifier (DataSourceId) that is used to identify
// a particular Db instance for dispatching the Db request.

type EngineReqHandler<Req, Resp> = (req: EngineReq<Req>) => Promise<Resp>;

function mkEngineReqHandler<Req, Resp>(
  srvFn: (dbConn: DataSourceConnection, req: Req) => Promise<Resp>
): EngineReqHandler<Req, Resp> {
  const handler = async (ereq: EngineReq<Req>): Promise<Resp> => {
    const { engine, req } = ereq;
    const dbConn = await getConnection(engine);
    const res = srvFn(dbConn, req);
    return res;
  };
  return handler;
}

const handleDbConnEvalQuery = mkEngineReqHandler(dbConnEvalQuery);
const handleDbConnRowCount = mkEngineReqHandler(dbConnRowCount);
const handleDbConnGetRootNode = mkEngineReqHandler(dbConnGetRootNode);
const handleDbConnGetChildren = mkEngineReqHandler(dbConnGetChildren);
const handleDbConnGetTableName = mkEngineReqHandler(dbConnGetTableName);
const handleDbConnGetTableSchema = mkEngineReqHandler(dbConnGetTableSchema);
const handleDbConnGetColumnStatsMap = mkEngineReqHandler(
  dbConnGetColumnStatsMap
);
const handleDbConnRunSqlQuery = mkEngineReqHandler(dbConnRunSqlQuery);

let providerRegistry: { [providerName: string]: DataSourceProvider } = {};

// Called during static initialization from linked provider library
export function registerProvider(provider: DataSourceProvider): void {
  providerRegistry[provider.providerName] = provider;
}

let instanceCache: { [key: string]: Promise<DataSourceConnection> } = {};

let resolvedConnections: DataSourceConnection[] = [];

let exportConnection: DataSourceConnection | null = null;

export function getExportConnection(): DataSourceConnection | null {
  return exportConnection;
}

/*
 * internal utility to record a DataSourceConnection in our connection cache
 * when the initial connection promise resolves.
 */
const saveOnResolve = async (
  pconn: Promise<DataSourceConnection>,
  hidden: boolean,
  forExport: boolean
): Promise<DataSourceConnection> => {
  const c = await pconn;
  if (!hidden) {
    resolvedConnections.push(c);
  }
  if (forExport) {
    exportConnection = c;
  }
  return c;
};

interface GetConnectionOptions {
  hidden: boolean; // hidden connections won't appear in getDataSources list
  forExport: boolean; // if true, use this connection for queries when exporting
}

const defaultGetConnectionOptions: GetConnectionOptions = {
  hidden: false,
  forExport: false,
};

/**
 * Used to both populate and read from the instance cache
 *
 */
export async function getConnection(
  sourceId: DataSourceId,
  options?: GetConnectionOptions
): Promise<DataSourceConnection> {
  const opts = options ?? defaultGetConnectionOptions;
  const key = JSON.stringify(sourceId);
  let connPromise: Promise<DataSourceConnection> | undefined;
  connPromise = instanceCache[key];
  if (!connPromise) {
    const { providerName, resourceId } = sourceId;
    let provider: DataSourceProvider | undefined =
      providerRegistry[providerName];

    if (!provider) {
      throw new Error(
        `getConnection: no registered DataSourceProvider for provider name '${providerName}'`
      );
    }
    connPromise = saveOnResolve(
      provider.connect(resourceId),
      opts.hidden,
      opts.forExport
    );
    instanceCache[key] = connPromise;
  }
  return connPromise;
}

const connectionNodeId = async (
  conn: DataSourceConnection
): Promise<DataSourceId> => {
  return conn.sourceId;
};

interface GetDataSourcesResult {
  dataSourceIds: DataSourceId[];
}

async function getDataSources(): Promise<DataSourceId[]> {
  const nodeIds: Promise<DataSourceId>[] =
    resolvedConnections.map(connectionNodeId);
  return Promise.all(nodeIds);
}

const handleGetDataSources = async (): Promise<GetDataSourcesResult> => {
  const hrstart = process.hrtime();
  const dataSourceIds = await getDataSources();
  const elapsed = process.hrtime(hrstart);
  // log.info("getDataSources: evaluated in  ", prettyHRTime(elapsed));
  const resObj = {
    dataSourceIds,
  };
  return resObj;
};

/**
 * server side of getSourceInfo standalone function, which operates on absolute paths.
 */
interface GetSourceInfoRequest {
  path: DataSourcePath;
}

interface GetSourceInfoResult {
  sourceInfo: DataSourceNode;
}

type AnyReqHandler = (req: any) => Promise<any>;

type ResultReqHandler<T> = (req: any) => Promise<Result<T>>;

const exceptionHandler =
  (hf: AnyReqHandler): ResultReqHandler<any> =>
  async (req: any) => {
    try {
      const value = await hf(req);
      return { status: "Ok", value };
    } catch (errVal) {
      console.error(
        "reltab server: exceptionHandler caught error: ",
        errVal,
        (errVal as any).stack
      );
      return { status: "Err", errVal: serializeError(errVal as Error) };
    }
  };

const simpleJSONHandler =
  (hf: AnyReqHandler): EncodedRequestHandler =>
  async (encodedReq: string): Promise<string> => {
    const req = JSON.parse(encodedReq);
    const resp = await hf(req);
    return JSON.stringify(
      resp,
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
      2
    );
  };

export const serverInit = (ts: TransportServer) => {
  ts.registerInvokeHandler(
    "getDataSources",
    simpleJSONHandler(exceptionHandler(handleGetDataSources))
  );
  ts.registerInvokeHandler(
    "DataSourceConnection.evalQuery",
    simpleJSONHandler(exceptionHandler(handleDbConnEvalQuery))
  );
  ts.registerInvokeHandler(
    "DataSourceConnection.rowCount",
    simpleJSONHandler(exceptionHandler(handleDbConnRowCount))
  );
  ts.registerInvokeHandler(
    "DataSourceConnection.getRootNode",
    simpleJSONHandler(exceptionHandler(handleDbConnGetRootNode))
  );
  ts.registerInvokeHandler(
    "DataSourceConnection.getChildren",
    simpleJSONHandler(exceptionHandler(handleDbConnGetChildren))
  );
  ts.registerInvokeHandler(
    "DataSourceConnection.getTableName",
    simpleJSONHandler(exceptionHandler(handleDbConnGetTableName))
  );
  ts.registerInvokeHandler(
    "DataSourceConnection.getTableSchema",
    simpleJSONHandler(exceptionHandler(handleDbConnGetTableSchema))
  );
  ts.registerInvokeHandler(
    "DataSourceConnection.getColumnStatsMap",
    simpleJSONHandler(exceptionHandler(handleDbConnGetColumnStatsMap))
  );
  ts.registerInvokeHandler(
    "DataSourceConnection.runSqlQuery",
    simpleJSONHandler(exceptionHandler(handleDbConnRunSqlQuery))
  );
};

/**
 * Useful when we want to make utility routines that can work either
 * locally or remotely
 */
export class LocalReltabConnection implements ReltabConnection {
  private static instance: LocalReltabConnection | null;
  private constructor() {}
  static getInstance(): LocalReltabConnection {
    if (!LocalReltabConnection.instance) {
      LocalReltabConnection.instance = new LocalReltabConnection();
    }
    return LocalReltabConnection.instance;
  }

  async connect(sourceId: DataSourceId): Promise<DataSourceConnection> {
    return getConnection(sourceId);
  }

  async getDataSources(): Promise<DataSourceId[]> {
    return getDataSources();
  }
}

/**
 * Dispatches an engine query command directly to the registered DataSourceConnection.
 */
export async function dispatchEngineCommand(
  cmd: string,
  payload: any
): Promise<any> {
  const normalizedCmd = cmd.startsWith("DataSourceConnection.")
    ? cmd.substring("DataSourceConnection.".length)
    : cmd;

  if (normalizedCmd === "getDataSources") {
    const res = await handleGetDataSources();
    return res;
  }

  const engineId: DataSourceId =
    payload?.engine || { providerName: "duckdb", resourceId: "" };
  const conn = await getConnection(engineId);

  switch (normalizedCmd) {
    case "evalQuery":
    case "toad:query":
    case "toad:eval_query": {
      const queryStr =
        typeof payload?.queryStr === "string"
          ? payload.queryStr
          : typeof payload?.query === "object"
          ? JSON.stringify(payload.query)
          : "";
      const req: DbConnEvalQueryRequest = {
        queryStr,
        offset: payload?.offset ?? null,
        limit: payload?.limit ?? null,
        options: payload?.options ?? { showQueries: false },
      };
      if (typeof (conn as any).evalQueryArrow === "function") {
        try {
          const arrowBuf = await (conn as any).evalQueryArrow(
            deserializeQueryReq(req.queryStr),
            req.offset,
            req.limit,
            req.options
          );
          if (arrowBuf && arrowBuf.byteLength > 0) {
            return arrowBuf;
          }
        } catch (arrowErr) {
          log.warn("evalQueryArrow fallback to dbConnEvalQuery:", arrowErr);
        }
      }
      return await dbConnEvalQuery(conn, req);
    }
    case "rowCount":
    case "toad:row_count": {
      const queryStr =
        typeof payload?.queryStr === "string"
          ? payload.queryStr
          : typeof payload?.query === "object"
          ? JSON.stringify(payload.query)
          : "";
      const req: DbConnRowCountRequest = {
        queryStr,
        options: payload?.options ?? { showQueries: false },
      };
      return await dbConnRowCount(conn, req);
    }
    case "getTableSchema": {
      const req: DbConnGetTableSchemaRequest = {
        tableName: payload?.tableName,
      };
      const schema = await dbConnGetTableSchema(conn, req);
      return schema.toJSON();
    }
    case "getTableName": {
      const req: DbConnGetTableNameRequest = {
        path: payload?.path,
        forceReopen: payload?.forceReopen,
        isBackground: payload?.isBackground,
      };
      return await dbConnGetTableName(conn, req);
    }
    case "getColumnStatsMap": {
      const queryStr =
        typeof payload?.queryStr === "string"
          ? payload.queryStr
          : typeof payload?.query === "object"
          ? JSON.stringify(payload.query)
          : "";
      const req: DbConnGetColumnStatsMapRequest = { queryStr };
      return await dbConnGetColumnStatsMap(conn, req);
    }
    case "getRootNode": {
      return await dbConnGetRootNode(conn);
    }
    case "getChildren": {
      const req: DbConnGetChildrenRequest = { path: payload?.path };
      return await dbConnGetChildren(conn, req);
    }
    case "runSqlQuery": {
      const req: DbConnRunSqlQueryRequest = { sqlQuery: payload?.sqlQuery };
      return await dbConnRunSqlQuery(conn, req);
    }
    default:
      throw new Error(`Unknown engine command: '${cmd}'`);
  }
}

/**
 * Handles an EngineQueryReq message from MessagePort, executes genuine logic,
 * and replies with hybrid data protocol.
 */
export async function handleEngineQueryReq(
  req: EngineQueryReq,
  port?: any
): Promise<EngineQueryResp> {
  const { id, cmd, payload } = req;
  try {
    const result = await dispatchEngineCommand(cmd, payload);
    if (port) {
      postHybridResponse(port, id, result);
    }
    if (result instanceof TableRep) {
      const { buffer, metadata } = encodeTableRepBinary(result);
      return { id, ok: true, binary: true, metadata, buffer };
    }
    if (
      result instanceof Uint8Array ||
      result instanceof ArrayBuffer ||
      (typeof Buffer !== "undefined" && Buffer.isBuffer(result))
    ) {
      const raw: any = result;
      const arrayBuffer: ArrayBuffer =
        raw instanceof ArrayBuffer
          ? raw
          : raw.byteOffset === 0 && raw.byteLength === raw.buffer.byteLength
          ? raw.buffer
          : raw.buffer.slice(
              raw.byteOffset,
              raw.byteOffset + raw.byteLength
            );
      return { id, ok: true, binary: true, buffer: arrayBuffer };
    }
    return { id, ok: true, data: result };
  } catch (err: any) {
    if (port) {
      postHybridError(port, id, err);
    }
    return {
      id,
      ok: false,
      error: err?.message || String(err),
      errorObj: serializeError(
        err instanceof Error ? err : new Error(String(err))
      ),
    };
  }
}

