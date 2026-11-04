/**
 * SampleScanWorker.ts
 * Asynchronous chunked timeslicer for responsive JSON sample scanning without freezing the UI.
 * Toad v2.5.1 - Nested JSON Parser & Auto-Flattening Engine
 */

import {
  DiscoveredLeafField,
  InferredDuckDbType,
  JsonScanOptions
} from "../types/NestedJsonContracts";
import {
  traverseJsonLeaves,
  buildSafeDuckDbJsonPath
} from "../utils/NestedJsonTraverser";

export interface ScanProgress {
  scanned: number;
  total: number;
  discoveredCount: number;
  percent: number;
}

export interface ScanResult {
  fields: DiscoveredLeafField[];
  totalScanned: number;
  validRowCount: number;
  newFieldsCount: number;
  aborted: boolean;
}

export interface WorkerScanOptions extends Partial<JsonScanOptions> {
  chunkSize?: number;
  existingFields?: DiscoveredLeafField[];
  onProgress?: (progress: ScanProgress) => void;
}

interface FieldAccumulator {
  pathSegments: string[];
  dotPath: string;
  jsonPathExpr: string;
  sampleValue: string;
  inferredType: InferredDuckDbType;
  occurrences: number;
  hasNonNullValue: boolean;
}

export class SampleScanWorker {
  private _aborted = false;
  private defaultChunkSize: number;

  constructor(defaultChunkSize = 50) {
    this.defaultChunkSize = defaultChunkSize;
  }

  /**
   * Abort current running scan.
   */
  public abort(): void {
    this._aborted = true;
  }

  /**
   * Whether the worker is currently aborted.
   */
  public isAborted(): boolean {
    return this._aborted;
  }

  /**
   * Executes chunked asynchronous scan across rows, yielding to event loop every chunk.
   */
  public async scan(
    rows: (string | object)[],
    options?: WorkerScanOptions
  ): Promise<ScanResult> {
    this._aborted = false;

    const chunkSize = options?.chunkSize ?? this.defaultChunkSize;
    const sampleLimit = options?.sampleLimit ?? 100;
    const existingFields = options?.existingFields ?? [];
    const onProgress = options?.onProgress;
    const maxDepth = options?.maxDepth ?? 50;
    const flattenArrays = options?.flattenArrays ?? false;

    // Existing fields map to preserve user customizations (customColName, enabled)
    const existingMap = new Map<string, DiscoveredLeafField>();
    for (const f of existingFields) {
      existingMap.set(f.dotPath, f);
    }

    const totalToScan = Math.min(rows.length, sampleLimit);
    const accumulators = new Map<string, FieldAccumulator>();
    let validRowCount = 0;
    let scanned = 0;

    for (let i = 0; i < totalToScan; i += chunkSize) {
      if (this._aborted) {
        break;
      }

      const chunkLimit = Math.min(i + chunkSize, totalToScan);
      const chunk = rows.slice(i, chunkLimit);

      for (const row of chunk) {
        let parsed = row;
        if (typeof row === "string") {
          try {
            parsed = JSON.parse(row);
          } catch {
            // Skip unparseable rows
            continue;
          }
        }

        if (parsed === null || parsed === undefined || typeof parsed !== "object") {
          continue;
        }

        validRowCount++;

        // Extract leaves from this row using traverser
        const rowLeaves = traverseJsonLeaves(parsed, {
          maxDepth,
          flattenArrays
        });

        for (const leaf of rowLeaves) {
          const existing = accumulators.get(leaf.dotPath);
          const isNonNull = leaf.sampleValue !== "null" && leaf.sampleValue !== "";

          if (!existing) {
            accumulators.set(leaf.dotPath, {
              pathSegments: leaf.pathSegments,
              dotPath: leaf.dotPath,
              jsonPathExpr: leaf.jsonPathExpr || buildSafeDuckDbJsonPath(leaf.pathSegments),
              sampleValue: leaf.sampleValue,
              inferredType: leaf.inferredType,
              occurrences: 1,
              hasNonNullValue: isNonNull
            });
          } else {
            existing.occurrences += 1;
            if (!existing.hasNonNullValue && isNonNull) {
              existing.sampleValue = leaf.sampleValue;
              existing.inferredType = leaf.inferredType;
              existing.hasNonNullValue = true;
            } else if (existing.hasNonNullValue && isNonNull) {
              // Promote BIGINT to DOUBLE if numeric with decimals encountered
              if (existing.inferredType === "BIGINT" && leaf.inferredType === "DOUBLE") {
                existing.inferredType = "DOUBLE";
              }
            }
          }
        }
      }

      scanned = chunkLimit;

      if (onProgress) {
        const percent = totalToScan > 0 ? Math.round((scanned / totalToScan) * 100) : 100;
        onProgress({
          scanned,
          total: totalToScan,
          discoveredCount: accumulators.size,
          percent
        });
      }

      // Yield execution to the host environment / browser event loop
      // 0ms timer ensures 60 FPS UI responsiveness and allows user to abort
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    const denominator = validRowCount > 0 ? validRowCount : 1;
    const finalFields: DiscoveredLeafField[] = [];
    let newFieldsCount = 0;

    for (const acc of accumulators.values()) {
      const fillRate = Math.round((acc.occurrences / denominator) * 10000) / 10000;
      const prior = existingMap.get(acc.dotPath);

      if (!prior) {
        newFieldsCount++;
        finalFields.push({
          pathSegments: acc.pathSegments,
          dotPath: acc.dotPath,
          customColName: acc.dotPath,
          jsonPathExpr: acc.jsonPathExpr,
          sampleValue: acc.sampleValue,
          inferredType: acc.inferredType,
          fillRate,
          enabled: true
        });
      } else {
        // Preserve user customizations (customColName, enabled)
        finalFields.push({
          pathSegments: acc.pathSegments,
          dotPath: acc.dotPath,
          customColName: prior.customColName || acc.dotPath,
          jsonPathExpr: acc.jsonPathExpr,
          sampleValue: acc.hasNonNullValue ? acc.sampleValue : prior.sampleValue,
          inferredType: prior.inferredType || acc.inferredType,
          fillRate,
          enabled: prior.enabled
        });
      }
    }

    // Stable sort: by dotPath alphabetical order
    finalFields.sort((a, b) => a.dotPath.localeCompare(b.dotPath));

    return {
      fields: finalFields,
      totalScanned: scanned,
      validRowCount,
      newFieldsCount,
      aborted: this._aborted
    };
  }

  /**
   * Fast initial preview scan (default 100 rows).
   */
  public async scanPreview(
    rows: (string | object)[],
    existingFields?: DiscoveredLeafField[],
    onProgress?: (progress: ScanProgress) => void
  ): Promise<ScanResult> {
    return this.scan(rows, {
      sampleLimit: 100,
      chunkSize: this.defaultChunkSize,
      existingFields,
      onProgress
    });
  }

  /**
   * Deep schema scan (default 1,000 rows).
   */
  public async scanDeep(
    rows: (string | object)[],
    existingFields?: DiscoveredLeafField[],
    onProgress?: (progress: ScanProgress) => void
  ): Promise<ScanResult> {
    return this.scan(rows, {
      sampleLimit: 1000,
      chunkSize: this.defaultChunkSize,
      existingFields,
      onProgress
    });
  }
}
