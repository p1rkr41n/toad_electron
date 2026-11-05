/**
 * NestedJsonTraverser.ts
 * Recursive JSON leaf node extraction, path expression generator, and DuckDB type inferrer.
 * Toad v2.5.1 - Nested JSON Parser & Auto-Flattening Engine
 */

import {
  DiscoveredLeafField,
  InferredDuckDbType,
  JsonScanOptions
} from "../types/NestedJsonContracts";

const DEFAULT_OPTIONS: JsonScanOptions = {
  sampleLimit: 100,
  flattenArrays: false,
  maxDepth: 50
};

// ISO 8601 Timestamp Pattern: e.g. 2026-10-27T14:44:08.819818Z, 2026-10-27T14:44:08Z, 2026-10-27 14:44:08
const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Infer DuckDB column type from a JavaScript primitive value or string representation.
 */
export function inferType(value: any): InferredDuckDbType {
  if (value === null || value === undefined) {
    return "VARCHAR";
  }

  if (typeof value === "boolean") {
    return "BOOLEAN";
  }

  if (typeof value === "bigint") {
    return "BIGINT";
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return "DOUBLE";
    }
    return Number.isInteger(value) ? "BIGINT" : "DOUBLE";
  }

  if (Array.isArray(value)) {
    return "VARCHAR";
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (ISO_8601_REGEX.test(trimmed) && !isNaN(Date.parse(trimmed))) {
      return "TIMESTAMP";
    }
    return "VARCHAR";
  }

  return "VARCHAR";
}

/**
 * Escapes characters for a segment inside double-quoted JSONPath brackets or dots.
 * Escapes backslashes (\ -> \\) and double quotes (" -> \").
 */
function escapeJsonPathSegment(segment: string): string {
  return segment.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Escapes characters for a segment inside single-quoted SQL Arrow operator (-> 'segment').
 * Escapes backslashes (\ -> \\) and single quotes (' -> '').
 */
function escapeSqlStringSegment(segment: string): string {
  return segment.replace(/\\/g, "\\\\").replace(/'/g, "''");
}

/**
 * Constructs a safe bracket path: $["path"]["segment"]
 * 100% immune to special characters (#attributes, #text, @xmlns, dots, spaces, slashes, quotes).
 */
export function buildSafeBracketPath(segments: string[]): string {
  if (!segments || segments.length === 0) {
    return "$";
  }
  return "$" + segments.map((s) => `["${escapeJsonPathSegment(s)}"]`).join("");
}

/**
 * Constructs an authoritative DuckDB quoted dot path: $."path"."segment"
 * Supported natively by DuckDB JSONPath parser with full character immunity.
 */
export function buildSafeDuckDbJsonPath(segments: string[]): string {
  if (!segments || segments.length === 0) {
    return "$";
  }
  return "$" + segments.map((s) => `."${escapeJsonPathSegment(s)}"`).join("");
}

/**
 * Constructs a safe DuckDB Arrow operator extraction: sourceCol->'seg1'->>'leaf'
 * Inner segments use ->, leaf segment uses ->> for text extraction.
 */
export function buildArrowPath(sourceCol: string, segments: string[]): string {
  if (!segments || segments.length === 0) {
    return `"${sourceCol.replace(/"/g, '""')}"`;
  }
  const safeSource = `"${sourceCol.replace(/"/g, '""')}"`;
  if (segments.length === 1) {
    return `${safeSource}->>'${escapeSqlStringSegment(segments[0])}'`;
  }

  const inner = segments
    .slice(0, -1)
    .map((s) => `->'${escapeSqlStringSegment(s)}'`)
    .join("");
  const leaf = `->>'${escapeSqlStringSegment(segments[segments.length - 1])}'`;
  return `${safeSource}${inner}${leaf}`;
}

/**
 * Internal state tracker for an extracted leaf field during single or multi-event scanning.
 */
interface FieldAccumulator {
  pathSegments: string[];
  dotPath: string;
  sampleValue: string;
  inferredType: InferredDuckDbType;
  occurrences: number;
  hasNonNullValue: boolean;
}

/**
 * Recursive traversal core. Traverses down to primitives or stringified arrays.
 */
function traverseRecursive(
  current: any,
  currentSegments: string[],
  depth: number,
  maxDepth: number,
  flattenArrays: boolean,
  visited: Set<any>,
  results: Map<string, FieldAccumulator>
): void {
  if (depth > maxDepth) {
    // Exceeded maximum recursion depth, record as stringified fallback
    recordLeaf(current, currentSegments, results);
    return;
  }

  if (current === null || current === undefined) {
    recordLeaf(current, currentSegments, results);
    return;
  }

  if (Array.isArray(current)) {
    if (flattenArrays) {
      // If flattenArrays is enabled, recurse into elements with numeric index
      for (let i = 0; i < current.length; i++) {
        traverseRecursive(
          current[i],
          [...currentSegments, String(i)],
          depth + 1,
          maxDepth,
          flattenArrays,
          visited,
          results
        );
      }
    } else {
      // Preserved as stringified JSON representation by default
      recordLeaf(current, currentSegments, results);
    }
    return;
  }

  if (typeof current === "object") {
    if (visited.has(current)) {
      // Circular reference detected, treat as leaf representation
      recordLeaf("[Circular]", currentSegments, results);
      return;
    }
    visited.add(current);

    const keys = Object.keys(current);
    if (keys.length === 0) {
      // Empty object, record as empty JSON representation
      recordLeaf(current, currentSegments, results);
      visited.delete(current);
      return;
    }

    for (const key of keys) {
      traverseRecursive(
        current[key],
        [...currentSegments, key],
        depth + 1,
        maxDepth,
        flattenArrays,
        visited,
        results
      );
    }
    visited.delete(current);
    return;
  }

  // Primitive value (string, number, boolean, bigint, symbol)
  recordLeaf(current, currentSegments, results);
}

function formatSampleValue(val: any): string {
  if (val === null) return "null";
  if (val === undefined) return "null";
  if (typeof val === "object" || Array.isArray(val)) {
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }
  return String(val);
}

function recordLeaf(
  value: any,
  segments: string[],
  results: Map<string, FieldAccumulator>
): void {
  if (segments.length === 0) {
    return;
  }

  const dotPath = segments.join(".");
  const sampleStr = formatSampleValue(value);
  const type = inferType(value);
  const isNonNull = value !== null && value !== undefined;

  const existing = results.get(dotPath);
  if (!existing) {
    results.set(dotPath, {
      pathSegments: [...segments],
      dotPath,
      sampleValue: sampleStr,
      inferredType: type,
      occurrences: 1,
      hasNonNullValue: isNonNull
    });
  } else {
    existing.occurrences += 1;
    // If previous value was null/empty and current is not, update sampleValue and type
    if (!existing.hasNonNullValue && isNonNull) {
      existing.sampleValue = sampleStr;
      existing.inferredType = type;
      existing.hasNonNullValue = true;
    } else if (existing.hasNonNullValue && isNonNull) {
      // If current is DOUBLE and previous was BIGINT, promote to DOUBLE
      if (existing.inferredType === "BIGINT" && type === "DOUBLE") {
        existing.inferredType = "DOUBLE";
      }
    }
  }
}

/**
 * Traverses a single JSON object or string down to primitive leaf nodes.
 */
export function traverseJsonLeaves(
  data: any,
  options?: Partial<JsonScanOptions>
): DiscoveredLeafField[] {
  const opts: JsonScanOptions = { ...DEFAULT_OPTIONS, ...options };
  let parsed = data;

  if (typeof data === "string") {
    try {
      parsed = JSON.parse(data);
    } catch {
      return [];
    }
  }

  if (parsed === null || parsed === undefined || typeof parsed !== "object") {
    return [];
  }

  const accumulators = new Map<string, FieldAccumulator>();
  const visited = new Set<any>();

  traverseRecursive(
    parsed,
    [],
    0,
    opts.maxDepth ?? 50,
    opts.flattenArrays,
    visited,
    accumulators
  );

  const results: DiscoveredLeafField[] = [];
  for (const acc of accumulators.values()) {
    results.push({
      pathSegments: acc.pathSegments,
      dotPath: acc.dotPath,
      customColName: acc.dotPath,
      jsonPathExpr: buildSafeDuckDbJsonPath(acc.pathSegments),
      sampleValue: acc.sampleValue,
      inferredType: acc.inferredType,
      fillRate: 1.0,
      enabled: true
    });
  }

  return results;
}

/**
 * Scans a pool of sample events (objects or JSON strings) and computes fill rate.
 */
export function scanJsonSamplePool(
  samples: (string | object)[],
  options?: Partial<JsonScanOptions>
): DiscoveredLeafField[] {
  const opts: JsonScanOptions = { ...DEFAULT_OPTIONS, ...options };
  const effectiveLimit = Math.min(samples.length, opts.sampleLimit);
  const accumulators = new Map<string, FieldAccumulator>();

  let validSampleCount = 0;

  for (let i = 0; i < effectiveLimit; i++) {
    const raw = samples[i];
    let parsed = raw;

    if (typeof raw === "string") {
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
    }

    if (parsed === null || parsed === undefined || typeof parsed !== "object") {
      continue;
    }

    validSampleCount++;
    const visited = new Set<any>();
    const rowAccumulators = new Map<string, FieldAccumulator>();

    traverseRecursive(
      parsed,
      [],
      0,
      opts.maxDepth ?? 50,
      opts.flattenArrays,
      visited,
      rowAccumulators
    );

    // Merge row discoveries into master accumulator
    for (const [dotPath, rowAcc] of rowAccumulators.entries()) {
      const existing = accumulators.get(dotPath);
      if (!existing) {
        accumulators.set(dotPath, {
          pathSegments: rowAcc.pathSegments,
          dotPath: rowAcc.dotPath,
          sampleValue: rowAcc.sampleValue,
          inferredType: rowAcc.inferredType,
          occurrences: 1,
          hasNonNullValue: rowAcc.hasNonNullValue
        });
      } else {
        existing.occurrences += 1;
        if (!existing.hasNonNullValue && rowAcc.hasNonNullValue) {
          existing.sampleValue = rowAcc.sampleValue;
          existing.inferredType = rowAcc.inferredType;
          existing.hasNonNullValue = true;
        } else if (existing.hasNonNullValue && rowAcc.hasNonNullValue) {
          if (existing.inferredType === "BIGINT" && rowAcc.inferredType === "DOUBLE") {
            existing.inferredType = "DOUBLE";
          }
        }
      }
    }
  }

  const denominator = validSampleCount > 0 ? validSampleCount : 1;
  const results: DiscoveredLeafField[] = [];

  for (const acc of accumulators.values()) {
    const rate = Math.round((acc.occurrences / denominator) * 10000) / 10000;
    results.push({
      pathSegments: acc.pathSegments,
      dotPath: acc.dotPath,
      customColName: acc.dotPath,
      jsonPathExpr: buildSafeDuckDbJsonPath(acc.pathSegments),
      sampleValue: acc.sampleValue,
      inferredType: acc.inferredType,
      fillRate: rate,
      enabled: true
    });
  }

  return results;
}

/**
 * Object-oriented wrapper class conforming to toadviewer utility standards.
 */
export class NestedJsonTraverser {
  private options: JsonScanOptions;

  constructor(options?: Partial<JsonScanOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  public traverse(data: any): DiscoveredLeafField[] {
    return traverseJsonLeaves(data, this.options);
  }

  public scanSamplePool(samples: (string | object)[]): DiscoveredLeafField[] {
    return scanJsonSamplePool(samples, this.options);
  }

  public static inferType(value: any): InferredDuckDbType {
    return inferType(value);
  }

  public static buildSafeBracketPath(segments: string[]): string {
    return buildSafeBracketPath(segments);
  }

  public static buildSafeDuckDbJsonPath(segments: string[]): string {
    return buildSafeDuckDbJsonPath(segments);
  }

  public static buildArrowPath(sourceCol: string, segments: string[]): string {
    return buildArrowPath(sourceCol, segments);
  }
}
