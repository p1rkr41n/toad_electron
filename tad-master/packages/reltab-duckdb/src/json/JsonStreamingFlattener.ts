/**
 * JsonStreamingFlattener.ts
 *
 * Phase 2 Dynamic Projection Flattener for Direct Ingestion of Nested JSON / EVTX:
 * - Generates DuckDB COPY (SELECT <leaf_projections> FROM read_json_auto(...)) TO 'dst.parquet'
 * - Safely double-quotes every column alias and field identifier
 * - Unpacks nested STRUCT columns into dot-notated columnar Parquet
 * - Gracefully falls back to standard read_json_auto if no STRUCT columns are detected
 * - Includes robust fallback tiers (standard stream, all_varchar mode)
 */

import * as log from "loglevel";
import {
  introspectJsonSchema,
  quoteSqlIdentifier,
  SchemaIntrospectionResult,
} from "./JsonSchemaIntrospector";

export interface JsonFlattenerOptions {
  sampleSize?: number;
  compression?: string;
  rowGroupSize?: number;
  ignoreErrors?: boolean;
  timestampFormat?: string;
}

export interface JsonStreamResult {
  readonly flattened: boolean;
  readonly hasStructColumns: boolean;
  readonly columnCount: number;
  readonly finalColumnNames: string[];
  readonly executionTimeMs: number;
}

/**
 * Generates Phase 2 dynamic projection SQL for DuckDB.
 * If STRUCT columns exist, builds unpacked leaf projections.
 * If no STRUCT columns exist, generates standard SELECT *.
 */
export function generateDynamicProjectionSql(
  sourcePath: string,
  targetParquetPath: string,
  introspection: SchemaIntrospectionResult,
  options?: JsonFlattenerOptions
): string {
  const safeSrc = sourcePath.replace(/\\/g, "/");
  const safeDst = targetParquetPath.replace(/\\/g, "/");
  const compression = (options?.compression || "snappy").toUpperCase();
  const rowGroupSize = options?.rowGroupSize || 100000;
  const sampleSize = options?.sampleSize || 2048;
  const ignoreErrors = options?.ignoreErrors !== false;
  const timestampFormat = options?.timestampFormat || "%Y-%m-%dT%H:%M:%S.%fZ";

  if (!introspection.hasStructColumns || introspection.leafProjections.length === 0) {
    return `
COPY (
  SELECT * FROM read_json_auto(
    '${safeSrc}',
    sample_size = ${sampleSize},
    ignore_errors = ${ignoreErrors},
    timestampformat = '${timestampFormat}'
  )
) TO '${safeDst}' (FORMAT PARQUET, COMPRESSION ${compression}, ROW_GROUP_SIZE ${rowGroupSize});
`.trim();
  }

  const projectionLines = introspection.leafProjections.map((leaf) => {
    const safeAlias = quoteSqlIdentifier(leaf.columnAlias);
    return `    ${leaf.sqlExpression} AS ${safeAlias}`;
  });

  return `
COPY (
  SELECT
${projectionLines.join(",\n")}
  FROM read_json_auto(
    '${safeSrc}',
    sample_size = ${sampleSize},
    ignore_errors = ${ignoreErrors},
    timestampformat = '${timestampFormat}'
  )
) TO '${safeDst}' (FORMAT PARQUET, COMPRESSION ${compression}, ROW_GROUP_SIZE ${rowGroupSize});
`.trim();
}

/**
 * Streams a JSON / JSONL / NDJSON / EVTX file directly into a columnar Parquet file
 * using Phase 1 schema introspection and Phase 2 dynamic unpack projection.
 */
export async function streamFlattenedJsonToParquet(
  dbConn: any,
  filePath: string,
  parquetPath: string,
  options?: JsonFlattenerOptions
): Promise<JsonStreamResult> {
  const startTime = Date.now();
  const safeSrc = filePath.replace(/\\/g, "/");
  const safeDst = parquetPath.replace(/\\/g, "/");
  const compression = (options?.compression || "snappy").toUpperCase();
  const rowGroupSize = options?.rowGroupSize || 100000;
  const sampleSize = options?.sampleSize || 2048;
  const ignoreErrors = options?.ignoreErrors !== false;
  const timestampFormat = options?.timestampFormat || "%Y-%m-%dT%H:%M:%S.%fZ";

  // Phase 1: Introspect schema
  log.info(`[JsonStreamingFlattener] Phase 1: Introspecting schema for ${filePath}...`);
  const introspection = await introspectJsonSchema(dbConn, filePath, sampleSize);

  if (introspection.hasStructColumns && introspection.leafProjections.length > 0) {
    log.info(
      `[JsonStreamingFlattener] Phase 2: Found STRUCT columns! Flattening ${introspection.leafProjections.length} leaf columns to Parquet...`
    );
    const flattenQuery = generateDynamicProjectionSql(filePath, parquetPath, introspection, options);

    try {
      await dbConn.exec(flattenQuery);
      const executionTimeMs = Date.now() - startTime;
      log.info(
        `[JsonStreamingFlattener] Auto-Flatten successfully wrote ${introspection.leafProjections.length} columns in ${executionTimeMs}ms.`
      );
      return {
        flattened: true,
        hasStructColumns: true,
        columnCount: introspection.leafProjections.length,
        finalColumnNames: introspection.leafProjections.map((l) => l.columnAlias),
        executionTimeMs,
      };
    } catch (flattenErr: any) {
      log.warn(
        `[JsonStreamingFlattener] Phase 2 dynamic flatten failed, falling back to standard stream:`,
        flattenErr?.message || flattenErr
      );
    }
  } else {
    log.info(`[JsonStreamingFlattener] No STRUCT columns detected; using standard JSON stream.`);
  }

  // Tier 1 Fallback / Flat stream: Standard read_json_auto without projection
  const standardQuery = `
COPY (
  SELECT * FROM read_json_auto(
    '${safeSrc}',
    sample_size = ${sampleSize},
    ignore_errors = ${ignoreErrors},
    timestampformat = '${timestampFormat}'
  )
) TO '${safeDst}' (FORMAT PARQUET, COMPRESSION ${compression}, ROW_GROUP_SIZE ${rowGroupSize});
`.trim();

  try {
    await dbConn.exec(standardQuery);
    const executionTimeMs = Date.now() - startTime;
    log.info(`[JsonStreamingFlattener] Standard JSON streaming completed in ${executionTimeMs}ms.`);
    return {
      flattened: false,
      hasStructColumns: false,
      columnCount: introspection.columns.length,
      finalColumnNames: introspection.columns.map((c) => c.columnName),
      executionTimeMs,
    };
  } catch (stdErr: any) {
    log.warn(
      `[JsonStreamingFlattener] Standard stream failed, falling back to all_varchar tier:`,
      stdErr?.message || stdErr
    );
  }

  // Tier 2 Fallback: all_varchar = true
  const allVarcharQuery = `
COPY (
  SELECT * FROM read_json_auto(
    '${safeSrc}',
    sample_size = ${sampleSize},
    ignore_errors = true,
    all_varchar = true
  )
) TO '${safeDst}' (FORMAT PARQUET, COMPRESSION ${compression}, ROW_GROUP_SIZE ${rowGroupSize});
`.trim();

  await dbConn.exec(allVarcharQuery);
  const executionTimeMs = Date.now() - startTime;
  log.info(`[JsonStreamingFlattener] all_varchar JSON streaming completed in ${executionTimeMs}ms.`);

  return {
    flattened: false,
    hasStructColumns: false,
    columnCount: introspection.columns.length,
    finalColumnNames: introspection.columns.map((c) => c.columnName),
    executionTimeMs,
  };
}
