/**
 * NestedJsonContracts.ts
 * Authoritative Frozen Interface Definitions for TOAD v2.5.1 Nested JSON Parser & Auto-Flattening
 */

export type InferredDuckDbType =
  | "BIGINT"
  | "INTEGER"
  | "DOUBLE"
  | "BOOLEAN"
  | "TIMESTAMP"
  | "VARCHAR";

export interface DiscoveredLeafField {
  /** Original hierarchical segment array: ["Event", "System", "EventID", "#text"] */
  readonly pathSegments: string[];

  /** Default hierarchical dot-notation display name: "Event.System.EventID.#text" */
  readonly dotPath: string;

  /** User-customized column name (defaults to dotPath, editable in UI) */
  customColName: string;

  /**
   * DuckDB-safe JSON path extraction expression:
   * e.g. '$."Event"."System"."EventID"."#text"' or '$["Event"]["System"]...'
   */
  readonly jsonPathExpr: string;

  /** Sample representation value from preview scan */
  readonly sampleValue: string;

  /** Automatically inferred DuckDB data type */
  inferredType: InferredDuckDbType;

  /** Occurrence rate across scanned sample rows (0.0 to 1.0) */
  readonly fillRate: number;

  /** Column extraction toggle status (default: true) */
  enabled: boolean;
}

export interface JsonScanOptions {
  /** Maximum sample rows to scan (100 for fast preview, 1000 for deep scan) */
  sampleLimit: number;

  /**
   * Whether to preserve arrays as stringified JSON representations (default: false).
   * When false, arrays are kept as stringified VARCHARs without row explosion.
   */
  flattenArrays: boolean;

  /** Maximum recursion depth limit (default: 50) */
  maxDepth?: number;
}

export interface JsonSqlGenerationResult {
  /** Complete CREATE VIEW SQL DDL statement */
  readonly createViewSql: string;

  /** Total number of enabled output columns */
  readonly activeColumnCount: number;

  /** Mapping from source JSON path expressions to target column aliases */
  readonly columnMappings: Array<{
    sourcePath: string;
    outputColumn: string;
    targetType?: InferredDuckDbType;
  }>;
}

// Supporting contracts for Ingestion Introspection (Stream 5 & Stream 6)
export interface DuckDbStructField {
  readonly fieldName: string;
  readonly fieldType: string;
  readonly isStruct: boolean;
  readonly children?: DuckDbStructField[];
}

export interface IngestDynamicProjectionResult {
  readonly hasStructColumns: boolean;
  readonly projectionExpressions: string[];
  readonly finalColumnNames: string[];
}
