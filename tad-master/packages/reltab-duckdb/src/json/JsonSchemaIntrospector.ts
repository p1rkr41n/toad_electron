/**
 * JsonSchemaIntrospector.ts
 *
 * Phase 1 Schema Introspection for Direct Ingestion of Nested JSON / EVTX:
 * - Runs DuckDB DESCRIBE on read_json_auto(sample_size = 2048) LIMIT 0
 * - Parses STRUCT(...) column type trees recursively into leaf projections
 * - Fully immune to special characters in field names (#attributes, #text, @xmlns, dots, spaces, quotes, slashes)
 * - Identifies whether any STRUCT columns exist for Phase 2 dynamic flattening
 */

import * as log from "loglevel";

/**
 * Node in the DuckDB STRUCT hierarchy.
 */
export interface DuckDbStructField {
  readonly fieldName: string;
  readonly fieldType: string;
  readonly isStruct: boolean;
  readonly children?: DuckDbStructField[];
}

/**
 * Result of Dynamic Projection generation (matches PROJECT.md).
 */
export interface IngestDynamicProjectionResult {
  readonly hasStructColumns: boolean;
  readonly projectionExpressions: string[];
  readonly finalColumnNames: string[];
}

/**
 * Metadata for a leaf column projected out of nested structs or primitive columns.
 */
export interface LeafProjection {
  readonly pathSegments: string[];
  readonly sqlExpression: string; // e.g. '"Event"."System"."EventID"."#text"'
  readonly columnAlias: string;   // e.g. 'Event.System.EventID.#text'
  readonly targetType: string;    // DuckDB type string e.g. 'BIGINT', 'VARCHAR'
  readonly isNested: boolean;     // true if unpacked from a struct, false if top-level column
}

/**
 * Top-level column discovered during Phase 1 schema introspection.
 */
export interface IntrospectedColumn {
  readonly columnName: string;
  readonly columnType: string;
  readonly isStruct: boolean;
  readonly structFields?: DuckDbStructField[];
}

/**
 * Complete result of Phase 1 schema introspection.
 */
export interface SchemaIntrospectionResult {
  readonly hasStructColumns: boolean;
  readonly columns: IntrospectedColumn[];
  readonly leafProjections: LeafProjection[];
}

/**
 * Safely quote an SQL identifier (column name or struct field name).
 * Wraps in double quotes and escapes existing double quotes as `""`.
 */
export function quoteSqlIdentifier(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

/**
 * Escape single quotes for SQL string literals.
 */
export function escapeSqlStringLiteral(str: string): string {
  return str.replace(/'/g, "''");
}

/**
 * Check whether a DuckDB column type string represents a STRUCT.
 * Returns false for arrays/lists of structs like `STRUCT(...)[]` or non-structs.
 */
export function isStructType(typeStr: string): boolean {
  if (!typeStr) return false;
  const trimmed = typeStr.trim();
  if (!/^STRUCT\s*\(/i.test(trimmed)) return false;
  if (trimmed.endsWith("]")) return false; // Array of structs (e.g. STRUCT(...)[] or LIST)

  // Validate that the opening '(' balances and terminates at the very end of the string
  const startParen = trimmed.indexOf("(");
  if (startParen === -1) return false;

  let depth = 0;
  let inQuotes = false;
  for (let i = startParen; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '"') {
      if (inQuotes && trimmed[i + 1] === '"') {
        i++; // skip escaped quote
        continue;
      }
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) {
          // If depth hits 0, it must be the last character
          return i === trimmed.length - 1;
        }
      }
    }
  }
  return false;
}

/**
 * Split a comma-separated list of field definitions at top level only.
 * Ignores commas inside quoted identifiers ("...") and parentheses/brackets.
 */
export function splitTopLevelComma(str: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuotes = false;
  let current = "";

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '"') {
      if (inQuotes && str[i + 1] === '"') {
        current += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      current += ch;
    } else if (inQuotes) {
      current += ch;
    } else {
      if (ch === "(" || ch === "[" || ch === "{") {
        depth++;
        current += ch;
      } else if (ch === ")" || ch === "]" || ch === "}") {
        depth--;
        current += ch;
      } else if (ch === "," && depth === 0) {
        parts.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }

  if (current.trim().length > 0) {
    parts.push(current.trim());
  }
  return parts;
}

/**
 * Parse a single field definition e.g. `"@xmlns" VARCHAR` or `EventID STRUCT(...)`
 * or `"quote""key" BIGINT`.
 */
export function parseFieldDef(fieldDef: string): { fieldName: string; fieldType: string } {
  const trimmed = fieldDef.trim();
  let fieldName = "";
  let fieldType = "";

  if (trimmed.startsWith('"')) {
    // Quoted identifier: read until matching unescaped double quote
    let i = 1;
    let nameChars = "";
    while (i < trimmed.length) {
      if (trimmed[i] === '"') {
        if (trimmed[i + 1] === '"') {
          nameChars += '"';
          i += 2;
        } else {
          i++;
          break;
        }
      } else {
        nameChars += trimmed[i];
        i++;
      }
    }
    fieldName = nameChars;
    fieldType = trimmed.slice(i).trim();
  } else {
    // Unquoted identifier: read until first whitespace
    const firstSpaceIdx = trimmed.search(/\s/);
    if (firstSpaceIdx === -1) {
      fieldName = trimmed;
      fieldType = "";
    } else {
      fieldName = trimmed.slice(0, firstSpaceIdx).trim();
      fieldType = trimmed.slice(firstSpaceIdx).trim();
    }
  }

  return { fieldName, fieldType };
}

/**
 * Recursively parse a DuckDB `STRUCT(...)` type string into `DuckDbStructField[]`.
 */
export function parseStructFields(typeStr: string): DuckDbStructField[] {
  if (!isStructType(typeStr)) return [];
  const trimmed = typeStr.trim();
  const startParen = trimmed.indexOf("(");
  const endParen = trimmed.lastIndexOf(")");
  if (startParen === -1 || endParen <= startParen) return [];

  const inner = trimmed.slice(startParen + 1, endParen).trim();
  if (inner.length === 0) return [];

  const parts = splitTopLevelComma(inner);
  const fields: DuckDbStructField[] = [];

  for (const part of parts) {
    if (!part) continue;
    const { fieldName, fieldType } = parseFieldDef(part);
    if (!fieldName) continue;

    const struct = isStructType(fieldType);
    const children = struct ? parseStructFields(fieldType) : undefined;

    fields.push({
      fieldName,
      fieldType,
      isStruct: struct,
      ...(children ? { children } : {}),
    });
  }

  return fields;
}

/**
 * Extract leaf projections from a top-level column.
 * - If primitive or array, returns a single LeafProjection for the column.
 * - If STRUCT, recursively extracts all leaf fields with dot-notated aliases.
 */
export function extractLeafProjections(colName: string, colType: string): LeafProjection[] {
  if (!isStructType(colType)) {
    return [
      {
        pathSegments: [colName],
        sqlExpression: quoteSqlIdentifier(colName),
        columnAlias: colName,
        targetType: colType,
        isNested: false,
      },
    ];
  }

  const fields = parseStructFields(colType);
  if (fields.length === 0) {
    // Empty struct fallback
    return [
      {
        pathSegments: [colName],
        sqlExpression: quoteSqlIdentifier(colName),
        columnAlias: colName,
        targetType: colType,
        isNested: false,
      },
    ];
  }

  const leaves: LeafProjection[] = [];

  function traverse(children: DuckDbStructField[], parentSegments: string[]) {
    for (const child of children) {
      const currentSegments = [...parentSegments, child.fieldName];
      if (child.isStruct && child.children && child.children.length > 0) {
        traverse(child.children, currentSegments);
      } else {
        leaves.push({
          pathSegments: currentSegments,
          sqlExpression: currentSegments.map(quoteSqlIdentifier).join("."),
          columnAlias: currentSegments.join("."),
          targetType: child.fieldType,
          isNested: true,
        });
      }
    }
  }

  traverse(fields, [colName]);
  return leaves;
}

/**
 * Phase 1 Schema Introspection:
 * Executes DuckDB DESCRIBE on `read_json_auto(safePath, sample_size = sampleSize) LIMIT 0;`
 * and recursively extracts structural definitions.
 */

async function execQueryAll(dbConn: any, sql: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    try {
      let resolved = false;
      const res = dbConn.all(sql, (err: any, rows: any) => {
        if (!resolved) {
          resolved = true;
          if (err) reject(err);
          else resolve(rows || []);
        }
      });
      if (res && typeof res.then === "function") {
        res.then((rows: any) => {
          if (!resolved) {
            resolved = true;
            resolve(rows || []);
          }
        }).catch((err: any) => {
          if (!resolved) {
            resolved = true;
            reject(err);
          }
        });
      }
    } catch (e) {
      reject(e);
    }
  });
}

export async function introspectJsonSchema(
  dbConn: any,
  filePath: string,
  sampleSize: number = 2048
): Promise<SchemaIntrospectionResult> {
  const safePath = filePath.replace(/\\/g, "/");
  const describeSql = `DESCRIBE SELECT * FROM read_json_auto('${safePath}', sample_size = ${sampleSize}) LIMIT 0;`;

  log.info(`[JsonSchemaIntrospector] Introspecting JSON schema: ${describeSql}`);

  let descRows: Array<{ column_name: string; column_type: string }> = [];
  try {
    descRows = await execQueryAll(dbConn, describeSql);
  } catch (err: any) {
    log.warn(`[JsonSchemaIntrospector] DESCRIBE query failed for ${safePath}:`, err?.message || err);
    return {
      hasStructColumns: false,
      columns: [],
      leafProjections: [],
    };
  }

  if (!descRows || descRows.length === 0) {
    return {
      hasStructColumns: false,
      columns: [],
      leafProjections: [],
    };
  }

  const columns: IntrospectedColumn[] = [];
  const leafProjections: LeafProjection[] = [];
  let hasStructColumns = false;

  for (const row of descRows) {
    const colName = row.column_name;
    const colType = row.column_type;
    const struct = isStructType(colType);

    if (struct) {
      hasStructColumns = true;
      const structFields = parseStructFields(colType);
      columns.push({
        columnName: colName,
        columnType: colType,
        isStruct: true,
        structFields,
      });
      const colLeaves = extractLeafProjections(colName, colType);
      leafProjections.push(...colLeaves);
    } else {
      columns.push({
        columnName: colName,
        columnType: colType,
        isStruct: false,
      });
      leafProjections.push({
        pathSegments: [colName],
        sqlExpression: quoteSqlIdentifier(colName),
        columnAlias: colName,
        targetType: colType,
        isNested: false,
      });
    }
  }

  return {
    hasStructColumns,
    columns,
    leafProjections,
  };
}

/**
 * Builds an IngestDynamicProjectionResult from an introspection result.
 */
export function buildDynamicProjection(
  introspection: SchemaIntrospectionResult
): IngestDynamicProjectionResult {
  if (!introspection.hasStructColumns || introspection.leafProjections.length === 0) {
    return {
      hasStructColumns: false,
      projectionExpressions: introspection.columns.map((c) => quoteSqlIdentifier(c.columnName)),
      finalColumnNames: introspection.columns.map((c) => c.columnName),
    };
  }

  const projectionExpressions: string[] = [];
  const finalColumnNames: string[] = [];

  for (const leaf of introspection.leafProjections) {
    finalColumnNames.push(leaf.columnAlias);
    const safeAlias = quoteSqlIdentifier(leaf.columnAlias);
    projectionExpressions.push(`${leaf.sqlExpression} AS ${safeAlias}`);
  }

  return {
    hasStructColumns: true,
    projectionExpressions,
    finalColumnNames,
  };
}
