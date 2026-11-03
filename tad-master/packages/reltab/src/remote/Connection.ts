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
  const ret = typeof retStr === "string" ? deserializeTableRepStr(retStr) : retStr;
  return ret;
}

/**
 * MessagePort transport wrapper for asynchronous RPC over MessagePort / worker port.
 */
export class MessagePortTransport {
  private port: any;
  private reqId: number = 1;
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
    this.port = port;
    if (!port) return;

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
            const tableRep = decodeTableRepBinary(msg.buffer || msg.data);
            pending.resolve(tableRep);
          } catch (decodeErr) {
            pending.reject(decodeErr);
          }
        } else {
          pending.resolve(msg.data);
        }
      } else {
        const err = msg.errorObj
          ? deserializeError(msg.errorObj)
          : new Error(msg.error || "Engine query error");
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
    if (!this.port) {
      return Promise.reject(
        new Error("MessagePortTransport: no active MessagePort")
      );
    }
    const id = this.reqId++;
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
    if (this.port && typeof this.port.close === "function") {
      try {
        this.port.close();
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
    if (dataPort) {
      this.setDataPort(dataPort);
    } else if (
      tconn &&
      typeof (tconn as any).setupDataPort === "function" &&
      (tconn as any).dataPort
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
    if (port instanceof MessagePortTransport) {
      this.portTransport = port;
    } else {
      this.portTransport = new MessagePortTransport(port);
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
    if (this.portTransport) {
      const res = await this.portTransport.request("evalQuery", {
        engine: this.sourceId,
        queryStr: JSON.stringify(query, safeJsonReplacer),
        offset: offset ? offset : null,
        limit: limit ? limit : null,
        options: options ? options : defaultEvalQueryOptions,
      });
      if (res instanceof TableRep) {
        return res;
      }
      return deserializeTableRepJson(res);
    }
    const req: DbConnEvalQueryRequest = {
      queryStr: JSON.stringify(query, safeJsonReplacer),
      offset: offset ? offset : null,
      limit: limit ? limit : null,
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
      return await this.portTransport.request("rowCount", {
        engine: this.sourceId,
        queryStr: JSON.stringify(query, safeJsonReplacer),
        options: options ? options : defaultEvalQueryOptions,
      });
    }
    const req: DbConnRowCountRequest = {
      queryStr: JSON.stringify(query, safeJsonReplacer),
      options: options ? options : defaultEvalQueryOptions,
    };
    return invokeDbFunction(this.tconn, this.sourceId, "rowCount", req).then(
      decodeResult
    );
  }

  async getTableSchema(tableName: string): Promise<Schema> {
    if (this.portTransport) {
      const res = await this.portTransport.request("getTableSchema", {
        engine: this.sourceId,
        tableName,
      });
      return Schema.fromJSON(res);
    }
    const req: DbConnGetTableSchemaRequest = { tableName };
    return invokeDbFunction(
      this.tconn,
      this.sourceId,
      "getTableSchema",
      req
    ).then(decodeResult);
  }

  async getColumnStatsMap(query: QueryExp): Promise<ColumnStatsMap> {
    if (this.portTransport) {
      return await this.portTransport.request("getColumnStatsMap", {
        engine: this.sourceId,
        queryStr: JSON.stringify(query, safeJsonReplacer),
      });
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
      return await this.portTransport.request("getRootNode", {
        engine: this.sourceId,
      });
    }
    return invokeDbFunction(this.tconn, this.sourceId, "getRootNode", {}).then(
      decodeResult
    );
  }

  async getChildren(path: DataSourcePath): Promise<DataSourceNode[]> {
    if (this.portTransport) {
      return await this.portTransport.request("getChildren", {
        engine: this.sourceId,
        path,
      });
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
      return await this.portTransport.request("getTableName", {
        engine: this.sourceId,
        path,
        forceReopen: options?.forceReopen,
        isBackground: (options as any)?.isBackground === true,
      });
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
      return await this.portTransport.request("runSqlQuery", {
        engine: this.sourceId,
        sqlQuery,
      });
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
  const ret = JSON.parse(retStr);
  return ret;
}

async function decodeResult<T>(res: Result<T>): Promise<T> {
  switch (res.status) {
    case "Ok":
      return res.value;
    case "Err":
      console.log("decodeResult: got error result: ", res);
      const errVal = deserializeError(res.errVal);
      throw errVal;
  }
}

/**
 * Implementation of ReltabConnection interface using lower level
 * TransportClient remote invocation or direct MessagePort data channel.
 */
export class RemoteReltabConnection implements ReltabConnection {
  private tconn: TransportClient;
  private dataPort: any = null;

  constructor(tconn: TransportClient, dataPort?: any) {
    this.tconn = tconn;
    if (dataPort) {
      this.setDataPort(dataPort);
    } else if (
      tconn &&
      typeof (tconn as any).setupDataPort === "function" &&
      (tconn as any).dataPort
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
    this.dataPort = port;
  }

  public getDataPort(): any {
    return this.dataPort;
  }

  async connect(sourceId: DataSourceId): Promise<DataSourceConnection> {
    const conn = new RemoteDataSourceConnection(
      this.tconn,
      sourceId,
      this.dataPort
    );
    return conn;
  }

  async getDataSources(): Promise<DataSourceId[]> {
    if (this.dataPort) {
      const transport =
        this.dataPort instanceof MessagePortTransport
          ? this.dataPort
          : new MessagePortTransport(this.dataPort);
      const ret: any = await transport.request("getDataSources", {});
      return ret?.["dataSourceIds"] || ret;
    }
    const ret = (await jsonInvoke(this.tconn, "getDataSources", {}).then(
      decodeResult
    )) as any;
    return ret["dataSourceIds"];
  }
}

