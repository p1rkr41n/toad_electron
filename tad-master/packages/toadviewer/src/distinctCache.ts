import * as reltab from "reltab";

export interface DistinctCacheEntry {
  values: string[];
  isComplete: boolean;
  inProgress: boolean;
  promise?: Promise<string[]>;
}

// In-memory cache keyed by `${tableName}::${columnId}`
const distinctCache = new Map<string, DistinctCacheEntry>();

/**
 * Loads distinct column values fast using DuckDB's parallel engine with LIMIT 500:
 * - Quotes column and table names safely
 * - Avoids expensive OFFSET loops that block DuckDB connections
 * - Caches results and notifies listeners via onUpdate callback
 */
export async function getOrLoadDistinctValues(
  dbc: reltab.DataSourceConnection,
  tableName: string,
  columnId: string,
  onUpdate?: (values: string[]) => void
): Promise<string[]> {
  const cacheKey = `${tableName}::${columnId}`;
  let entry = distinctCache.get(cacheKey);

  if (entry) {
    if (entry.isComplete) {
      if (onUpdate) onUpdate(entry.values);
      return entry.values;
    }
    if (entry.promise) {
      if (onUpdate) {
        entry.promise.then((vals) => {
          onUpdate(vals);
        });
      }
      return entry.values;
    }
  }

  const safeCol = columnId.replace(/"/g, '""');
  const safeTable = tableName.replace(/"/g, '""');

  const query = `
    SELECT DISTINCT "${safeCol}"::VARCHAR as val
    FROM (SELECT "${safeCol}" FROM "${safeTable}" LIMIT 30000) _sample
    WHERE "${safeCol}" IS NOT NULL
    ORDER BY val ASC
    LIMIT 300
  `;

  entry = {
    values: [],
    isComplete: false,
    inProgress: true,
  };
  distinctCache.set(cacheKey, entry);

  const fetchPromise = (async () => {
    try {
      const rows = await dbc.runSqlQuery(query);
      const vals: string[] = [];
      if (rows && rows.length > 0) {
        for (const r of rows) {
          if (r.val !== null && r.val !== undefined) {
            vals.push(String(r.val));
          }
        }
      }
      entry!.values = vals;
      entry!.isComplete = true;
      if (onUpdate) onUpdate(vals);
      return vals;
    } catch (err) {
      console.warn(`[DistinctCache] Error scanning column "${columnId}":`, err);
      entry!.isComplete = true;
      return [];
    } finally {
      entry!.inProgress = false;
    }
  })();

  entry.promise = fetchPromise;
  return entry.values;
}

export function getCachedDistinctValues(
  tableName: string,
  columnId: string
): string[] | null {
  const cacheKey = `${tableName}::${columnId}`;
  const entry = distinctCache.get(cacheKey);
  return entry ? entry.values : null;
}
