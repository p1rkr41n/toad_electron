import { ColumnStatsMap } from "../ColumnStats";
import {
  DataSourceConnection,
  DataSourceId,
  DataSourceNode,
  DataSourcePath,
  EvalQueryOptions,
  GetTableNameOptions,
} from "../DataSource";
import {
  deserializeTableRepJson,
  deserializeTableRepStr,
  QueryExp,
} from "../QueryExp";
import { Schema } from "../Schema";
import { Row, TableRep } from "../TableRep";
import { deserializeError } from "./errorUtils";
import { Result } from "./result";
import { TransportClient } from "./Transport";
import { safeJsonReplacer } from "../defs";
import {
  decodeTableRepBinary,
  isHybridBinary,
} from "./hybridProtocol";

export interface DbConnRunSqlQueryRequest {
  sqlQuery: string;
}

export const defaultEvalQueryOptions: EvalQueryOptions = {
  showQueries: false,
};

export interface DbConnEvalQueryRequest {
  queryStr: string; // JSON-encoded QueryExp
  offset: number | null;
  limit: number | null;
  options: EvalQueryOptions;
}

export interface DbConnRowCountRequest {
  queryStr: string; // JSON-encoded QueryExp
  options: EvalQueryOptions;
}

export interface DbConnGetTableSchemaRequest {
  tableName: string;
}

export interface DbConnGetColumnStatsMapRequest {
  queryStr: string; // JSON-encoded QueryExp
}

export interface DbConnGetChildrenRequest {
  path: DataSourcePath;
}

export interface DbConnGetTableNameRequest {
  path: DataSourcePath;
  forceReopen?: boolean;
  isBackground?: boolean;
}

export type EngineReq<T> = { engine: DataSourceId; req: T };

// remote invoke a DataSourceConnection member function, using DataSourceId to
// identify the engine:
async function invokeDbFunction<T>(
  tconn: TransportClient,
  engine: DataSourceId,
  methodName: string,
  req: T
): Promise<Result<any>> {
  const ereq: EngineReq<T> = { engine, req };
  const retStr: any = await tconn.invoke(
    "DataSourceConnection." + methodName,
    JSON.stringify(ereq)
  );
  if (isHybridBinary(retStr)) {
    const tableRep = decodeTableRepBinary(retStr);
    return { status: "Ok", value: tableRep };
  }
  if (retStr && typeof retStr === "object" && (retStr as any).binary && (retStr as any).buffer) {
    const tableRep = decodeTableRepBinary((retStr as any).buffer);
    return { status: "Ok", value: tableRep };
  }
  let ret: any = retStr;
  if (typeof retStr === "string") {
    const trimmed = retStr.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        ret = deserializeTableRepStr(retStr);
      } catch {
        ret = retStr;
      }
    } else {
      ret = retStr;
    }
  }
  return ret;
}

/**
 * MessagePort transport wrapper for asynchronous RPC over MessagePort / worker port.
 */
export class MessagePortTransport {
  private static nextGlobalReqId: number = 1_000_000;
  private port: any;
  private pendingReqs: Map<
    number,
    { resolve: (val: any) => void; reject: (err: any) => void }
  > = new Map();
  private boundHandler: any = null;

  constructor(port: any) {
    this.setPort(port);
  }

  public setPort(port: any): void {
    if (this.port && this.boundHandler) {
      if (typeof this.port.off === "function") {
        this.port.off("message", this.boundHandler);
      } else if (typeof this.port.removeEventListener === "function") {
        this.port.removeEventListener("message", this.boundHandler);
      }
    }
    if (!port || typeof port.postMessage !== "function") {
      this.port = null;
      return;
    }
    this.port = port;

    this.boundHandler = (eventOrData: any) => {
      let msg: any = eventOrData;
      if (
        eventOrData &&
        typeof eventOrData === "object" &&
        typeof eventOrData.id !== "number" &&
        eventOrData.data !== undefined &&
        typeof eventOrData.data === "object" &&
        typeof eventOrData.data?.id === "number"
      ) {
        msg = eventOrData.data;
      }
      if (!msg || typeof msg.id !== "number") return;
      const pending = this.pendingReqs.get(msg.id);
      if (!pending) return;
      this.pendingReqs.delete(msg.id);

      if (msg.ok) {
        if (msg.binary && (msg.buffer || msg.data)) {
          try {
            const rawBuf = msg.buffer || msg.data;
            const u8 =
              rawBuf instanceof Uint8Array
                ? rawBuf
                : rawBuf instanceof ArrayBuffer
                ? new Uint8Array(rawBuf)
                : new Uint8Array(rawBuf.buffer, rawBuf.byteOffset, rawBuf.byteLength);
            if (isHybridBinary(u8)) {
              const tableRep = decodeTableRepBinary(u8);
              pending.resolve(tableRep);
            } else {
              const text = new TextDecoder("utf-8").decode(u8);
              pending.resolve(deserializeTableRepStr(text));
            }
          } catch (decodeErr) {
            pending.reject(decodeErr);
          }
        } else {
          pending.resolve(msg.data);
        }
      } else {
        const err: any = msg.errorObj
          ? deserializeError(msg.errorObj)
          : new Error(msg.error || "Engine query error");
        err.isEngineApplicationError = true;
        pending.reject(err);
      }
    };

    if (typeof port.on === "function") {
      port.on("message", this.boundHandler);
    } else if (typeof port.addEventListener === "function") {
      port.addEventListener("message", this.boundHandler);
    } else if (port.onmessage !== undefined) {
      port.onmessage = this.boundHandler;
    }
    if (typeof port.start === "function") {
      port.start();
    }
  }

  public getPort(): any {
    return this.port;
  }

  public request(cmd: string, payload: any): Promise<any> {
    if (!this.port || typeof this.port.postMessage !== "function") {
      return Promise.reject(
        new Error("MessagePortTransport: no active MessagePort or postMessage is not a function")
      );
    }
    const id = MessagePortTransport.nextGlobalReqId++;
    return new Promise((resolve, reject) => {
      this.pendingReqs.set(id, { resolve, reject });
      try {
        this.port.postMessage({ id, cmd, payload });
      } catch (sendErr) {
        this.pendingReqs.delete(id);
        reject(sendErr);
      }
    });
  }

  public close(): void {
    for (const [_, pending] of this.pendingReqs) {
      pending.reject(new Error("MessagePortTransport closed"));
    }
    this.pendingReqs.clear();
    const activePort = this.port;
    if (activePort && this.boundHandler) {
      if (typeof activePort.off === "function") {
        activePort.off("message", this.boundHandler);
      } else if (typeof activePort.removeEventListener === "function") {
        activePort.removeEventListener("message", this.boundHandler);
      }
    }
    this.port = null;
    this.boundHandler = null;
    if (activePort && typeof activePort.close === "function") {
      try {
        activePort.close();
      } catch {}
    }
  }
}

export class RemoteDataSourceConnection implements DataSourceConnection {
  private tconn: TransportClient;
  readonly sourceId: DataSourceId;
  private portTransport: MessagePortTransport | null = null;

  constructor(tconn: TransportClient, sourceId: DataSourceId, dataPort?: any) {
    this.tconn = tconn;
    this.sourceId = sourceId;
    if (dataPort && (typeof dataPort.postMessage === "function" || dataPort instanceof MessagePortTransport || typeof dataPort.request === "function")) {
      this.setDataPort(dataPort);
    } else if (
      tconn &&
      typeof (tconn as any).setupDataPort === "function" &&
      (tconn as any).dataPort &&
      typeof (tconn as any).dataPort.postMessage === "function"
    ) {
      this.setDataPort((tconn as any).dataPort);
    } else if (
      tconn &&
      typeof (tconn as any).postMessage === "function" &&
      typeof (tconn as any).invoke !== "function"
    ) {
      this.setDataPort(tconn);
    }
  }

  public setDataPort(port: any): void {
    if (!port) {
      this.portTransport = null;
      return;
    }
    if (port instanceof MessagePortTransport || typeof (port as any).request === "function") {
      this.portTransport = port;
    } else if (typeof port.postMessage === "function") {
      this.portTransport = new MessagePortTransport(port);
    } else {
      this.portTransport = null;
    }
  }

  public getDataPort(): any {
    return this.portTransport ? this.portTransport.getPort() : null;
  }

  async getDisplayName(): Promise<string> {
    return "TODO: remote getDisplayName";
  }

  async evalQuery(
    query: QueryExp,
    offset?: number,
    limit?: number,
    options?: EvalQueryOptions
  ): Promise<TableRep> {
    const payload = {
      engine: this.sourceId,
      queryStr: JSON.stringify(query, safeJsonReplacer),
      offset: offset != null ? offset : null,
      limit: limit != null ? limit : null,
      options: options ? options : defaultEvalQueryOptions,
    };
    if (
      this.tconn &&
      typeof (this.tconn as any).invokeBinary === "function"
    ) {
      try {
        const u8 = await (this.tconn as any).invokeBinary("evalQuery", payload);
        if (u8 && u8.byteLength > 0) {
          if (isHybridBinary(u8)) {
            return decodeTableRepBinary(u8);
          }
          const text = new TextDecoder().decode(u8);
          const parsed = deserializeTableRepStr(text) as any;
          const unwrapped = await decodeResult(parsed);
          if (unwrapped instanceof TableRep) {
            return unwrapped;
          }
          return deserializeTableRepJson(unwrapped);
        }
      } catch (err: any) {
        if (
          err &&
          (err.isEngineApplicationError ||
            String(err.message || "").includes("MessagePort timeout"))
        ) {
          throw err;
        }
        console.warn("[RemoteConnection] invokeBinary evalQuery failed, falling back:", err);
      }
    }
    if (this.portTransport) {
      try {
        const res = await this.portTransport.request("evalQuery", payload);
        if (res instanceof TableRep) {
          return res;
        }
        return deserializeTableRepJson(res);
      } catch (portErr: any) {
        if (portErr && portErr.isEngineApplicationError) {
          throw portErr;
        }
        console.warn("[RemoteDataSourceConnection] portTransport.request evalQuery failed, falling back to invokeDbFunction:", portErr);
        this.portTransport = null;
      }
    }
    const req: DbConnEvalQueryRequest = {
      queryStr: JSON.stringify(query, safeJsonReplacer),
      offset: offset != null ? offset : null,
      limit: limit != null ? limit : null,
      options: options ? options : defaultEvalQueryOptions,
    };
    const ret = await invokeDbFunction(
      this.tconn,
      this.sourceId,
      "evalQuery",
      req
    ).then(decodeResult);
    return ret;
  }

  async rowCount(query: QueryExp, options?: EvalQueryOptions): Promise<number> {
    if (this.portTransport) {
      try {
        return await this.portTransport.request("rowCount", {
          engine: this.sourceId,
          queryStr: JSON.stringify(query, safeJsonReplacer),
          options: options ? options : defaultEvalQueryOptions,
        });
      } catch (portErr: any) {
        if (portErr && portErr.isEngineApplicationError) {
          throw portErr;
        }
        console.warn("[RemoteDataSourceConnection] portTransport.request rowCount failed, falling back to invokeDbFunction:", portErr);
        this.portTransport = null;
      }
    }
    const req: DbConnRowCountRequest = {
      queryStr: JSON.stringify(query, safeJsonReplacer),
      options: options ? options : defaultEvalQueryOptions,
    };
    const res: any = await invokeDbFunction(this.tconn, this.sourceId, "rowCount", req).then(
      decodeResult
    );
    return typeof res === "number" ? res : res?.rowCount ?? res;
  }

  async getTableSchema(tableName: string): Promise<Schema> {
    if (this.portTransport) {
      try {
        const res = await this.portTransport.request("getTableSchema", {
          engine: this.sourceId,
          tableName,
        });
        return Schema.fromJSON(res);
      } catch (portErr: any) {
        if (portErr && portErr.isEngineApplicationError) {
          throw portErr;
        }
        console.warn("[RemoteDataSourceConnection] portTransport.request getTableSchema failed, falling back to invokeDbFunction:", portErr);
        this.portTransport = null;
      }
    }
    const req: DbConnGetTableSchemaRequest = { tableName };
    const res: any = await invokeDbFunction(
      this.tconn,
      this.sourceId,
      "getTableSchema",
      req
    ).then(decodeResult);
    if (res instanceof Schema) {
      return res;
    }
    return Schema.fromJSON(res);
  }

  async getColumnStatsMap(query: QueryExp): Promise<ColumnStatsMap> {
    if (this.portTransport) {
      try {
        return await this.portTransport.request("getColumnStatsMap", {
          engine: this.sourceId,
          queryStr: JSON.stringify(query, safeJsonReplacer),
        });
      } catch (portErr: any) {
        if (portErr && portErr.isEngineApplicationError) {
          throw portErr;
        }
        console.warn("[RemoteDataSourceConnection] portTransport.request getColumnStatsMap failed, falling back to invokeDbFunction:", portErr);
        this.portTransport = null;
      }
    }
    const req: DbConnGetColumnStatsMapRequest = {
      queryStr: JSON.stringify(query, safeJsonReplacer),
    };
    return invokeDbFunction(
      this.tconn,
      this.sourceId,
      "getColumnStatsMap",
      req
    ).then(decodeResult);
  }

  async getRootNode(): Promise<DataSourceNode> {
    if (this.portTransport) {
      try {
        return await this.portTransport.request("getRootNode", {
          engine: this.sourceId,
        });
      } catch (portErr: any) {
        if (portErr && portErr.isEngineApplicationError) {
          throw portErr;
        }
        console.warn("[RemoteDataSourceConnection] portTransport.request getRootNode failed, falling back to invokeDbFunction:", portErr);
        this.portTransport = null;
      }
    }
    return invokeDbFunction(this.tconn, this.sourceId, "getRootNode", {}).then(
      decodeResult
    );
  }

  async getChildren(path: DataSourcePath): Promise<DataSourceNode[]> {
    if (this.portTransport) {
      try {
        return await this.portTransport.request("getChildren", {
          engine: this.sourceId,
          path,
        });
      } catch (portErr: any) {
        if (portErr && portErr.isEngineApplicationError) {
          throw portErr;
        }
        console.warn("[RemoteDataSourceConnection] portTransport.request getChildren failed, falling back to invokeDbFunction:", portErr);
        this.portTransport = null;
      }
    }
    const req: DbConnGetChildrenRequest = { path };
    return invokeDbFunction(this.tconn, this.sourceId, "getChildren", req).then(
      decodeResult
    );
  }

  async getTableName(
    path: DataSourcePath,
    options?: GetTableNameOptions
  ): Promise<string> {
    if (this.portTransport) {
      try {
        return await this.portTransport.request("getTableName", {
          engine: this.sourceId,
          path,
          forceReopen: options?.forceReopen,
          isBackground: (options as any)?.isBackground === true,
        });
      } catch (portErr: any) {
        if (portErr && portErr.isEngineApplicationError) {
          throw portErr;
        }
        console.warn("[RemoteDataSourceConnection] portTransport.request getTableName failed, falling back to invokeDbFunction:", portErr);
        this.portTransport = null;
      }
    }
    const req: DbConnGetTableNameRequest = {
      path,
      forceReopen: options?.forceReopen,
      isBackground: (options as any)?.isBackground === true,
    };
    return invokeDbFunction(
      this.tconn,
      this.sourceId,
      "getTableName",
      req
    ).then(decodeResult);
  }

  async runSqlQuery(sqlQuery: string): Promise<Row[]> {
    if (this.portTransport) {
      try {
        return await this.portTransport.request("runSqlQuery", {
          engine: this.sourceId,
          sqlQuery,
        });
      } catch (portErr: any) {
        if (portErr && portErr.isEngineApplicationError) {
          throw portErr;
        }
        console.warn("[RemoteDataSourceConnection] portTransport.request runSqlQuery failed, falling back to invokeDbFunction:", portErr);
        this.portTransport = null;
      }
    }
    const req: DbConnRunSqlQueryRequest = { sqlQuery };
    return invokeDbFunction(
      this.tconn,
      this.sourceId,
      "runSqlQuery",
      req
    ).then(decodeResult);
  }
}

/**
 * The ReltabConnection interface is the entry point for client-side access to
 * reltab via some client-specific transport mechanism.
 * The interface provides access to a set of data sources and the ability
 * to obtain a (proxy) DataSourceConnection to those data sources.
 */
export interface ReltabConnection {
  connect(sourceId: DataSourceId): Promise<DataSourceConnection>;

  getDataSources(): Promise<DataSourceId[]>;
}

async function jsonInvoke(
  tconn: TransportClient,
  functionName: string,
  req: any
): Promise<any> {
  const reqStr = JSON.stringify(req, safeJsonReplacer);
  const retStr = await tconn.invoke(functionName, reqStr);
  let ret: any = retStr;
  if (typeof retStr === "string") {
    const trimmed = retStr.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        ret = JSON.parse(retStr);
      } catch {
        ret = retStr;
      }
    }
  }
  return ret;
}

async function decodeResult(res: any): Promise<any> {
  if (!res) return res;
  if (typeof res === "object" && res.status) {
    switch (res.status) {
      case "Ok":
        return res.value;
      case "Err":
        console.error("decodeResult: got error result: ", res);
        const errVal = deserializeError(res.errVal);
        throw errVal;
    }
  }
  return res;
}

/**
 * Implementation of ReltabConnection interface using lower level
 * TransportClient remote invocation or direct MessagePort data channel.
 */
export class RemoteReltabConnection implements ReltabConnection {
  private tconn: TransportClient;
  private dataPort: any = null;
  private portTransport: MessagePortTransport | null = null;
  private activeConnections: Set<RemoteDataSourceConnection> = new Set();

  constructor(tconn: TransportClient, dataPort?: any) {
    this.tconn = tconn;
    if (dataPort && (typeof dataPort.postMessage === "function" || dataPort instanceof MessagePortTransport || typeof dataPort.request === "function")) {
      this.setDataPort(dataPort);
    } else if (
      tconn &&
      typeof (tconn as any).setupDataPort === "function" &&
      (tconn as any).dataPort &&
      typeof (tconn as any).dataPort.postMessage === "function"
    ) {
      this.setDataPort((tconn as any).dataPort);
    } else if (
      tconn &&
      typeof (tconn as any).postMessage === "function" &&
      typeof (tconn as any).invoke !== "function"
    ) {
      this.setDataPort(tconn);
    }
    if (tconn && typeof (tconn as any).onDataPortChange === "function") {
      (tconn as any).onDataPortChange((newPort: any) => {
        this.setDataPort(newPort);
      });
    }
  }

  public setDataPort(port: any): void {
    if (!port) {
      this.dataPort = null;
      this.portTransport = null;
      for (const conn of this.activeConnections) {
        conn.setDataPort(null);
      }
      return;
    }
    if (port instanceof MessagePortTransport || typeof (port as any).request === "function") {
      this.dataPort = port;
      this.portTransport = port as MessagePortTransport;
    } else if (typeof port.postMessage === "function") {
      this.dataPort = port;
      this.portTransport = new MessagePortTransport(port);
    } else {
      this.dataPort = null;
      this.portTransport = null;
    }
    for (const conn of this.activeConnections) {
      conn.setDataPort(this.portTransport || this.dataPort);
    }
  }

  public getDataPort(): any {
    return this.dataPort;
  }

  async connect(sourceId: DataSourceId): Promise<DataSourceConnection> {
    const conn = new RemoteDataSourceConnection(
      this.tconn,
      sourceId,
      this.portTransport ||
        (this.dataPort && (typeof this.dataPort.postMessage === "function" || typeof this.dataPort.request === "function")
          ? this.dataPort
          : undefined)
    );
    this.activeConnections.add(conn);
    return conn;
  }

  async getDataSources(): Promise<DataSourceId[]> {
    if (this.portTransport || (this.dataPort && (typeof this.dataPort.postMessage === "function" || this.dataPort instanceof MessagePortTransport || typeof (this.dataPort as any).request === "function"))) {
      try {
        const transport =
          this.portTransport ||
          (this.dataPort instanceof MessagePortTransport || typeof (this.dataPort as any).request === "function"
            ? this.dataPort
            : new MessagePortTransport(this.dataPort));
        const ret: any = await transport.request("getDataSources", {});
        return ret?.["dataSourceIds"] || ret;
      } catch (err) {
        console.warn("[RemoteReltabConnection] getDataSources over dataPort failed, falling back to jsonInvoke:", err);
      }
    }
    const ret = (await jsonInvoke(this.tconn, "getDataSources", {}).then(
      decodeResult
    )) as any;
    return ret?.["dataSourceIds"] || ret;
  }
}

