/**
 * DuckDbJsonSqlBuilder.ts
 * Generates DuckDB CREATE VIEW statements for nested JSON extraction.
 * 100% immune to special characters (#attributes, #text, @xmlns, dots, spaces, slashes, quotes).
 * Toad v2.5.1 - Nested JSON Parser & Auto-Flattening Engine
 */

import {
  DiscoveredLeafField,
  InferredDuckDbType,
  JsonSqlGenerationResult
} from "../types/NestedJsonContracts";
import {
  buildArrowPath,
  buildSafeDuckDbJsonPath
} from "./NestedJsonTraverser";

export interface BuildJsonViewSqlOptions {
  targetViewName: string;
  sourceTableName: string;
  sourceColumnName: string;
  fields: DiscoveredLeafField[];
  excludeExistingColumns?: string[];
  useArrowSyntax?: boolean;
}

/**
 * Escapes an identifier for DuckDB SQL by enclosing it in double quotes
 * and doubling any internal double quotes.
 * e.g. Event.System.EventID.#text -> "Event.System.EventID.#text"
 * e.g. key"with"quotes -> "key""with""quotes"
 */
export function escapeIdentifier(id: string): string {
  if (id === undefined || id === null) {
    return '""';
  }
  return `"${String(id).replace(/"/g, '""')}"`;
}

/**
 * Escapes a string literal for DuckDB SQL by enclosing it in single quotes
 * and doubling any internal single quotes.
 * e.g. $."Event"."#text" -> '$."Event"."#text"'
 * e.g. $."Single'Key" -> '$."Single''Key"'
 */
export function escapeSqlStringLiteral(str: string): string {
  if (str === undefined || str === null) {
    return "''";
  }
  return `'${String(str).replace(/'/g, "''")}'`;
}

/**
 * Generates an extraction projection SQL expression for a single leaf field.
 */
export function buildFieldExtractionExpression(
  field: DiscoveredLeafField,
  sourceColumnName: string,
  useArrowSyntax = false
): string {
  const safeSourceCol = escapeIdentifier(sourceColumnName);
  const alias = field.customColName || field.dotPath;
  const safeAlias = escapeIdentifier(alias);

  let rawExtractExpr: string;

  if (useArrowSyntax) {
    rawExtractExpr = buildArrowPath(sourceColumnName, field.pathSegments);
  } else {
    const pathExpr = field.jsonPathExpr || buildSafeDuckDbJsonPath(field.pathSegments);
    const safePathLiteral = escapeSqlStringLiteral(pathExpr);
    rawExtractExpr = `json_extract_string(${safeSourceCol}, ${safePathLiteral})`;
  }

  // Optimize VARCHAR extractions by omitting TRY_CAST wrapper
  if (field.inferredType === "VARCHAR") {
    return `${rawExtractExpr} AS ${safeAlias}`;
  }

  // Wrap in TRY_CAST to prevent queries failing on malformed or dirty log data
  return `TRY_CAST(${rawExtractExpr} AS ${field.inferredType}) AS ${safeAlias}`;
}

/**
 * Builds a complete CREATE VIEW statement for extracting nested JSON fields.
 * Performance budget: execution completes in < 15ms in DuckDB.
 */
export function buildCreateViewSql(
  options: BuildJsonViewSqlOptions
): JsonSqlGenerationResult {
  const {
    targetViewName,
    sourceTableName,
    sourceColumnName,
    fields,
    excludeExistingColumns,
    useArrowSyntax = false
  } = options;

  if (!targetViewName || !targetViewName.trim()) {
    throw new Error("Target view name is required");
  }
  if (!sourceTableName || !sourceTableName.trim()) {
    throw new Error("Source table name is required");
  }
  if (!sourceColumnName || !sourceColumnName.trim()) {
    throw new Error("Source column name is required");
  }

  const activeFields = (fields || []).filter((f) => f.enabled);
  if (activeFields.length === 0) {
    throw new Error("Cannot generate JSON extraction SQL: no fields enabled");
  }

  const safeViewName = escapeIdentifier(targetViewName);
  const safeTableName = escapeIdentifier(sourceTableName);

  // Build SELECT star / EXCLUDE clause
  let selectClause = "*";
  if (excludeExistingColumns && excludeExistingColumns.length > 0) {
    const excludedList = excludeExistingColumns
      .map((col) => escapeIdentifier(col))
      .join(", ");
    selectClause = `* EXCLUDE (${excludedList})`;
  }

  // Build field projections
  const projections = activeFields.map((field) =>
    buildFieldExtractionExpression(field, sourceColumnName, useArrowSyntax)
  );

  const columnMappings = activeFields.map((field) => ({
    sourcePath: field.jsonPathExpr || buildSafeDuckDbJsonPath(field.pathSegments),
    outputColumn: field.customColName || field.dotPath,
    targetType: field.inferredType as InferredDuckDbType
  }));

  const sqlLines = [
    `CREATE VIEW ${safeViewName} AS`,
    `SELECT`,
    `  ${selectClause},`,
    projections.map((p) => `  ${p}`).join(",\n"),
    `FROM ${safeTableName};`
  ];

  const createViewSql = sqlLines.join("\n");

  return {
    createViewSql,
    activeColumnCount: activeFields.length,
    columnMappings
  };
}

/**
 * Object-oriented wrapper conforming to toadviewer utility standards.
 */
export class DuckDbJsonSqlBuilder {
  public static buildCreateViewSql(
    options: BuildJsonViewSqlOptions
  ): JsonSqlGenerationResult {
    return buildCreateViewSql(options);
  }

  public static escapeIdentifier(id: string): string {
    return escapeIdentifier(id);
  }

  public static escapeSqlStringLiteral(str: string): string {
    return escapeSqlStringLiteral(str);
  }

  public static buildFieldExtractionExpression(
    field: DiscoveredLeafField,
    sourceColumnName: string,
    useArrowSyntax = false
  ): string {
    return buildFieldExtractionExpression(field, sourceColumnName, useArrowSyntax);
  }
}
