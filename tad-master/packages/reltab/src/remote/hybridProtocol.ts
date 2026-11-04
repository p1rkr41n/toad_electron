/**
 * Hybrid Data Protocol for TOAD / Tad
 *
 * Implements high-speed tabular data transfer across MessagePort / IPC boundaries.
 * Format:
 *  - Small metadata & control: Structured JSON DTO
 *  - Tabular cell & column blocks: Apache Arrow IPC Stream (Uint8Array / ArrayBuffer)
 *
 * Supports both:
 *  1. Modern: Apache Arrow IPC Stream (Zero-copy, standardized, vectorized)
 *  2. Legacy: TOAD Hybrid binary format v1 (Magic bytes 'TOAD' + JSON header + row stream)
 */

import { Schema, ColumnMetaMap } from "../Schema";
import { Row, TableRep } from "../TableRep";
import { decodeTableData } from "../QueryExp";
import { DuckDBDialect } from "../dialects/DuckDBDialect";
import { serializeError, deserializeError } from "./errorUtils";
import {
  tableFromIPC,
  tableToIPC,
  Table as ArrowTable,
  Schema as ArrowSchema,
  tableFromArrays,
} from "@apache-arrow/es2015-cjs";

export const HYBRID_MAGIC_BYTES = [0x54, 0x4f, 0x41, 0x44]; // "TOAD"
export const HYBRID_PROTOCOL_VERSION = 1;
export const ARROW_PROTOCOL_VERSION = 2;

export interface TableRepMetadata {
  version: number;
  rowCount: number;
  columnCount: number;
  columns: string[];
  schema: any;
}

export interface EngineQueryReq {
  id: number;
  cmd: string;
  payload?: any;
  binary?: boolean;
}

export interface EngineQueryResp {
  id: number;
  ok: boolean;
  data?: any;
  error?: string;
  errorObj?: any;
  binary?: boolean;
  metadata?: TableRepMetadata;
  buffer?: ArrayBuffer;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Checks if a given buffer or Uint8Array is an Apache Arrow IPC Stream.
 */
export function isArrowIPC(input: any): boolean {
  if (!input) return false;
  let u8: Uint8Array;
  if (input instanceof ArrayBuffer) {
    u8 = new Uint8Array(input);
  } else if (input instanceof Uint8Array || (typeof Buffer !== "undefined" && Buffer.isBuffer(input))) {
    u8 = input;
  } else {
    return false;
  }
  if (u8.byteLength < 4) return false;
  // Arrow IPC stream continuation token (0xFFFFFFFF)
  return (
    u8[0] === 0xff &&
    u8[1] === 0xff &&
    u8[2] === 0xff &&
    u8[3] === 0xff
  );
}

/**
 * Checks if a given buffer or Uint8Array contains either the TOAD hybrid binary
 * magic bytes or standard Apache Arrow IPC Stream bytes.
 */
export function isHybridBinary(input: any): boolean {
  if (!input) return false;
  let u8: Uint8Array;
  if (input instanceof ArrayBuffer) {
    u8 = new Uint8Array(input);
  } else if (input instanceof Uint8Array || (typeof Buffer !== "undefined" && Buffer.isBuffer(input))) {
    u8 = input;
  } else {
    return false;
  }
  if (u8.byteLength < 4) return false;

  // 1. Check Arrow IPC continuation indicator
  if (
    u8[0] === 0xff &&
    u8[1] === 0xff &&
    u8[2] === 0xff &&
    u8[3] === 0xff
  ) {
    return true;
  }

  // 2. Check TOAD magic bytes
  if (
    u8.byteLength >= 12 &&
    u8[0] === HYBRID_MAGIC_BYTES[0] &&
    u8[1] === HYBRID_MAGIC_BYTES[1] &&
    u8[2] === HYBRID_MAGIC_BYTES[2] &&
    u8[3] === HYBRID_MAGIC_BYTES[3]
  ) {
    return true;
  }

  return false;
}

/**
 * Maps Arrow Type ID to standard DuckDB SQL type string.
 */
export function arrowTypeToDuckDBColumnType(field: any): string {
  const typeId = field.typeId;
  switch (typeId) {
    case 2: // Int (Int8, Int16, Int32, Int64, etc.)
      return field.type?.bitWidth === 64 ? "BIGINT" : "INTEGER";
    case 3: // Float (Float16, Float32, Float64)
      return "DOUBLE";
    case 4: // Binary
      return "BLOB";
    case 5: // Utf8
      return "VARCHAR";
    case 6: // Bool
      return "BOOLEAN";
    case 7: // Decimal
      return "DECIMAL";
    case 8: // Date
      return "DATE";
    case 9: // Time
      return "TIME";
    case 10: // Timestamp
      return "TIMESTAMP";
    default:
      return "VARCHAR";
  }
}

/**
 * Creates a reltab Schema from Arrow fields using DuckDB dialect.
 */
function createSchemaFromArrowFields(fields: any[]): Schema {
  const columnNames = fields.map((f: any) => f.name);
  const columnMetaMap: ColumnMetaMap = {};
  for (const f of fields) {
    const colType = arrowTypeToDuckDBColumnType(f);
    columnMetaMap[f.name] = {
      displayName: f.name,
      columnType: colType,
    };
  }
  return new Schema(DuckDBDialect, columnNames, columnMetaMap);
}

/**
 * Decodes an Apache Arrow IPC Stream buffer directly into TableRep.
 */
export function arrowIPCToTableRep(buffer: ArrayBuffer | Uint8Array): TableRep {
  let u8: Uint8Array;
  if (buffer instanceof ArrayBuffer) {
    u8 = new Uint8Array(buffer);
  } else if (buffer instanceof Uint8Array || (typeof Buffer !== "undefined" && Buffer.isBuffer(buffer))) {
    u8 = buffer;
  } else {
    throw new Error("arrowIPCToTableRep: invalid input, expected ArrayBuffer or Uint8Array");
  }

  if (u8.byteLength < 4) {
    return new TableRep(new Schema(DuckDBDialect, [], {}), []);
  }

  const arrowTable = tableFromIPC(u8);
  const numRows = arrowTable.numRows;
  const fields = arrowTable.schema.fields;
  const columnNames = fields.map((f: any) => f.name);

  // Reconstitute original reltab Schema from metadata if present
  let schema: Schema;
  const rawMeta = arrowTable.schema.metadata;
  const toadSchemaStr =
    rawMeta instanceof Map ? rawMeta.get("toadSchema") : (rawMeta as any)?.toadSchema;

  if (toadSchemaStr) {
    try {
      const parsedJson = JSON.parse(toadSchemaStr);
      schema = Schema.fromJSON(parsedJson);
    } catch {
      schema = createSchemaFromArrowFields(fields);
    }
  } else {
    schema = createSchemaFromArrowFields(fields);
  }

  // Fast columnar extraction into Row objects
  const cols = columnNames.map((name: string) => arrowTable.getChild(name));
  const rows: Row[] = new Array(numRows);
  for (let i = 0; i < numRows; i++) {
    const row: Row = {};
    for (let j = 0; j < columnNames.length; j++) {
      const col = cols[j];
      let val = col ? col.get(i) : null;
      if (typeof val === "bigint") {
        val = Number.isSafeInteger(Number(val)) ? Number(val) : val.toString();
      } else if (val && typeof val.toJSON === "function" && !(val instanceof Date)) {
        val = val.toJSON();
      }
      row[columnNames[j]] = val;
    }
    rows[i] = row;
  }

  const tableRep = new TableRep(schema, rows);
  (tableRep as any).arrowTable = arrowTable;
  return tableRep;
}

/**
 * Encodes TableRep into an Apache Arrow IPC Stream buffer.
 */
export function encodeTableRepArrow(tableRep: TableRep): {
  buffer: ArrayBuffer;
  byteLength: number;
  metadata: TableRepMetadata;
} {
  const schemaJson = tableRep.schema.toJSON();
  const rowCount = tableRep.rowData.length;
  const columnCount = tableRep.schema.columns.length;

  const metadata: TableRepMetadata = {
    version: ARROW_PROTOCOL_VERSION,
    rowCount,
    columnCount,
    columns: tableRep.schema.columns,
    schema: schemaJson,
  };

  const columnData: Record<string, any[]> = {};
  for (const col of tableRep.schema.columns) {
    columnData[col] = [];
  }

  for (let i = 0; i < rowCount; i++) {
    const row = tableRep.rowData[i];
    for (const col of tableRep.schema.columns) {
      let val = row ? row[col] : null;
      if (typeof val === "bigint") {
        val = Number.isSafeInteger(Number(val)) ? Number(val) : val.toString();
      }
      columnData[col].push(val);
    }
  }

  const arrowTable = tableFromArrays(columnData);
  const metaMap = new Map<string, string>([
    ["toadSchema", JSON.stringify(schemaJson)],
  ]);
  const newSchema = new ArrowSchema(arrowTable.schema.fields, metaMap);
  const tableWithMeta = new ArrowTable(newSchema, arrowTable.batches);
  const ipcBytes = tableToIPC(tableWithMeta, "stream");

  // Ensure ArrayBuffer is transferable (use underlying buffer or copy slice)
  const arrayBuffer =
    ipcBytes.byteOffset === 0 && ipcBytes.byteLength === ipcBytes.buffer.byteLength
      ? (ipcBytes.buffer as ArrayBuffer)
      : (ipcBytes.buffer.slice(
          ipcBytes.byteOffset,
          ipcBytes.byteOffset + ipcBytes.byteLength
        ) as ArrayBuffer);

  return {
    buffer: arrayBuffer,
    byteLength: ipcBytes.byteLength,
    metadata,
  };
}

/**
 * Legacy TOAD hybrid binary decoder (v1 format with JSON metadata & row stream).
 */
export function decodeLegacyTableRepBinary(u8: Uint8Array): TableRep {
  if (u8.byteLength < 12) {
    throw new Error("decodeLegacyTableRepBinary: buffer too short (< 12 bytes)");
  }

  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const version = view.getUint32(4, true);
  if (version !== HYBRID_PROTOCOL_VERSION) {
    throw new Error(`decodeLegacyTableRepBinary: unsupported protocol version ${version}`);
  }

  const metaLength = view.getUint32(8, true);
  if (12 + metaLength > u8.byteLength) {
    throw new Error("decodeLegacyTableRepBinary: corrupted packet, metadata length exceeds buffer");
  }

  const metaSubarray = u8.subarray(12, 12 + metaLength);
  const metaStr = textDecoder.decode(metaSubarray);
  const metadata: TableRepMetadata = JSON.parse(metaStr);

  const schema = Schema.fromJSON(metadata.schema);
  const dataOffset = 12 + metaLength;

  if (u8.byteLength <= dataOffset || metadata.rowCount === 0) {
    return new TableRep(schema, []);
  }

  const dataSubarray = u8.subarray(dataOffset);
  const dataStr = textDecoder.decode(dataSubarray);
  const rawRows: Row[] = JSON.parse(dataStr);

  const tableRep = decodeTableData(schema, rawRows);
  return tableRep;
}

/**
 * Decodes a binary buffer into a TableRep instance.
 * Automatically chooses between Apache Arrow IPC Stream and Legacy TOAD v1 binary.
 */
export function decodeTableRepBinary(buffer: ArrayBuffer | Uint8Array): TableRep {
  let u8: Uint8Array;
  if (buffer instanceof ArrayBuffer) {
    u8 = new Uint8Array(buffer);
  } else if (buffer instanceof Uint8Array || (typeof Buffer !== "undefined" && Buffer.isBuffer(buffer))) {
    u8 = buffer;
  } else {
    throw new Error("decodeTableRepBinary: invalid input, expected ArrayBuffer or Uint8Array");
  }

  if (u8.byteLength < 4) {
    throw new Error("decodeTableRepBinary: buffer too short (< 4 bytes)");
  }

  // 1. If buffer has "TOAD" magic bytes -> decode as legacy v1 format
  if (
    u8.byteLength >= 12 &&
    u8[0] === HYBRID_MAGIC_BYTES[0] &&
    u8[1] === HYBRID_MAGIC_BYTES[1] &&
    u8[2] === HYBRID_MAGIC_BYTES[2] &&
    u8[3] === HYBRID_MAGIC_BYTES[3]
  ) {
    return decodeLegacyTableRepBinary(u8);
  }

  // 2. Default & modern path: Apache Arrow IPC Stream
  return arrowIPCToTableRep(u8);
}

/**
 * Encodes TableRep into a zero-copy transferable binary ArrayBuffer.
 * Uses Apache Arrow IPC Stream format (Arrow Table).
 */
export function encodeTableRepBinary(tableRep: TableRep): {
  buffer: ArrayBuffer;
  byteLength: number;
  metadata: TableRepMetadata;
} {
  return encodeTableRepArrow(tableRep);
}

/**
 * Helper to post a successful hybrid response over a MessagePort or parentPort.
 * If the result is a TableRep or raw binary (Arrow IPC Stream buffer), it is
 * transferred via zero-copy transfer list.
 */
export function postHybridResponse(port: any, id: number, result: any): void {
  if (result instanceof TableRep) {
    const { buffer, metadata } = encodeTableRepArrow(result);
    const msg: EngineQueryResp = {
      id,
      ok: true,
      binary: true,
      metadata,
      buffer,
    };
    if (typeof port.postMessage === "function") {
      try {
        port.postMessage(msg, [buffer]);
      } catch {
        port.postMessage(msg);
      }
    }
  } else if (
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
    const msg: EngineQueryResp = {
      id,
      ok: true,
      binary: true,
      buffer: arrayBuffer,
    };
    if (typeof port.postMessage === "function") {
      try {
        port.postMessage(msg, [arrayBuffer]);
      } catch {
        port.postMessage(msg);
      }
    }
  } else {
    let data = result;
    if (result && typeof result.toJSON === "function") {
      data = result.toJSON();
    }
    const msg: EngineQueryResp = {
      id,
      ok: true,
      data,
    };
    if (typeof port.postMessage === "function") {
      try {
        port.postMessage(msg);
      } catch {
        const jsonSafe = JSON.parse(
          JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v))
        );
        port.postMessage({ id, ok: true, data: jsonSafe });
      }
    }
  }
}

/**
 * Helper to post an error hybrid response over a MessagePort or parentPort.
 */
export function postHybridError(port: any, id: number, err: any): void {
  const errMessage = err?.message || String(err);
  const errorObj = err instanceof Error ? serializeError(err) : { message: errMessage };
  const msg: EngineQueryResp = {
    id,
    ok: false,
    error: errMessage,
    errorObj,
  };
  if (typeof port.postMessage === "function") {
    port.postMessage(msg);
  }
}
