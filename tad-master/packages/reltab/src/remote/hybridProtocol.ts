/**
 * Hybrid Data Protocol for TOAD / Tad
 *
 * Implements high-speed tabular data transfer across MessagePort / IPC boundaries.
 * Format:
 *  - Small metadata & control: Structured JSON DTO
 *  - Tabular cell & column blocks: Zero-copy Transferable ArrayBuffer
 *
 * Binary Wire Format for TableRep blocks:
 *  [Offset 0..3]     : Magic Bytes 0x54, 0x4F, 0x41, 0x44 ("TOAD")
 *  [Offset 4..7]     : Protocol Version (uint32, little-endian, e.g. 1)
 *  [Offset 8..11]    : JSON Header Length N (uint32, little-endian)
 *  [Offset 12..12+N-1]: JSON Schema & Metadata String (UTF-8 encoded)
 *  [Offset 12+N..]   : Table Row Data Block (UTF-8 encoded JSON row stream)
 */

import { Schema } from "../Schema";
import { Row, TableRep } from "../TableRep";
import { decodeTableData } from "../QueryExp";
import { serializeError, deserializeError } from "./errorUtils";

export const HYBRID_MAGIC_BYTES = [0x54, 0x4f, 0x41, 0x44]; // "TOAD"
export const HYBRID_PROTOCOL_VERSION = 1;

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

/**
 * Checks if a given buffer or Uint8Array contains the TOAD hybrid binary magic bytes.
 */
export function isHybridBinary(input: any): boolean {
  if (!input) return false;
  let u8: Uint8Array;
  if (input instanceof ArrayBuffer) {
    if (input.byteLength < 12) return false;
    u8 = new Uint8Array(input);
  } else if (input instanceof Uint8Array || (typeof Buffer !== "undefined" && Buffer.isBuffer(input))) {
    if (input.byteLength < 12) return false;
    u8 = input;
  } else {
    return false;
  }
  return (
    u8[0] === HYBRID_MAGIC_BYTES[0] &&
    u8[1] === HYBRID_MAGIC_BYTES[1] &&
    u8[2] === HYBRID_MAGIC_BYTES[2] &&
    u8[3] === HYBRID_MAGIC_BYTES[3]
  );
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Encodes a TableRep into a zero-copy transferable ArrayBuffer.
 */
export function encodeTableRepBinary(tableRep: TableRep): {
  buffer: ArrayBuffer;
  byteLength: number;
  metadata: TableRepMetadata;
} {
  const schemaJson = tableRep.schema.toJSON();
  const rowCount = tableRep.rowData.length;
  const columnCount = tableRep.schema.columns.length;

  const metadata: TableRepMetadata = {
    version: HYBRID_PROTOCOL_VERSION,
    rowCount,
    columnCount,
    columns: tableRep.schema.columns,
    schema: schemaJson,
  };

  const metaStr = JSON.stringify(metadata);
  const metaBytes = textEncoder.encode(metaStr);

  let dataBytes: Uint8Array;
  if (rowCount === 0) {
    dataBytes = new Uint8Array(0);
  } else {
    const rowDataStr = JSON.stringify(
      tableRep.rowData,
      (_, v) => (typeof v === "bigint" ? v.toString() : v)
    );
    dataBytes = textEncoder.encode(rowDataStr);
  }

  const totalLength = 12 + metaBytes.length + dataBytes.length;
  const arrayBuffer = new ArrayBuffer(totalLength);
  const u8 = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);

  // Magic bytes: "TOAD"
  u8[0] = HYBRID_MAGIC_BYTES[0];
  u8[1] = HYBRID_MAGIC_BYTES[1];
  u8[2] = HYBRID_MAGIC_BYTES[2];
  u8[3] = HYBRID_MAGIC_BYTES[3];

  // Protocol version (uint32, little-endian)
  view.setUint32(4, HYBRID_PROTOCOL_VERSION, true);

  // Metadata length N (uint32, little-endian)
  view.setUint32(8, metaBytes.length, true);

  // Metadata bytes at offset 12
  u8.set(metaBytes, 12);

  // Row data bytes at offset 12 + N
  if (dataBytes.length > 0) {
    u8.set(dataBytes, 12 + metaBytes.length);
  }

  return {
    buffer: arrayBuffer,
    byteLength: totalLength,
    metadata,
  };
}

/**
 * Decodes a binary buffer into a TableRep instance.
 */
export function decodeTableRepBinary(buffer: ArrayBuffer | Uint8Array): TableRep {
  let u8: Uint8Array;
  let view: DataView;

  if (buffer instanceof ArrayBuffer) {
    u8 = new Uint8Array(buffer);
    view = new DataView(buffer);
  } else if (buffer instanceof Uint8Array || (typeof Buffer !== "undefined" && Buffer.isBuffer(buffer))) {
    u8 = buffer;
    view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  } else {
    throw new Error("decodeTableRepBinary: invalid input, expected ArrayBuffer or Uint8Array");
  }

  if (u8.byteLength < 12) {
    throw new Error("decodeTableRepBinary: buffer too short (< 12 bytes)");
  }

  if (
    u8[0] !== HYBRID_MAGIC_BYTES[0] ||
    u8[1] !== HYBRID_MAGIC_BYTES[1] ||
    u8[2] !== HYBRID_MAGIC_BYTES[2] ||
    u8[3] !== HYBRID_MAGIC_BYTES[3]
  ) {
    throw new Error("decodeTableRepBinary: invalid magic bytes, expected 'TOAD'");
  }

  const version = view.getUint32(4, true);
  if (version !== HYBRID_PROTOCOL_VERSION) {
    throw new Error(`decodeTableRepBinary: unsupported protocol version ${version}`);
  }

  const metaLength = view.getUint32(8, true);
  if (12 + metaLength > u8.byteLength) {
    throw new Error("decodeTableRepBinary: corrupted packet, metadata length exceeds buffer");
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
 * Helper to post a successful hybrid response over a MessagePort or parentPort.
 * If the result is a TableRep, it will be encoded into a binary ArrayBuffer and
 * transferred via zero-copy transfer list.
 */
export function postHybridResponse(port: any, id: number, result: any): void {
  if (result instanceof TableRep) {
    const { buffer, metadata } = encodeTableRepBinary(result);
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
        // Fallback if port transfer list is not supported
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
