/**
 * Ingest Worker Process (Out-of-Process Crash Firewall)
 *
 * Runs inside an isolated child/utility process so any native DuckDB assertion
 * or malformed input crash cannot terminate the interactive Engine or UI.
 */

import * as fs from "fs";
import { Database } from "duckdb-async";

function escapeSqlPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/'/g, "''");
}

function notifyParent(msg: any): void {
  if (typeof process.send === "function") {
    process.send(msg);
  } else if (
    (process as any).parentPort &&
    typeof (process as any).parentPort.postMessage === "function"
  ) {
    (process as any).parentPort.postMessage(msg);
  }
}

export interface NormalizedIngestWorkerConfig {
  compression: string;
  rowGroupSize: number;
  maxMemory: string | null;
  threads: number;
  isComplexLog: boolean;
  safeParallel: boolean;
}

export function normalizeWorkerConfig(
  cfg: any,
  argvComplexFlag?: string
): NormalizedIngestWorkerConfig {
  const safeCfg = cfg && typeof cfg === "object" ? cfg : {};
  const compression = String(safeCfg.compression || "snappy").toUpperCase();
  const rawRowGroup = Number(safeCfg.row_group_size ?? safeCfg.rowGroupSize);
  const rowGroupSize =
    Number.isFinite(rawRowGroup) && rawRowGroup >= 1000 ? Math.floor(rawRowGroup) : 122880;

  const rawMem = safeCfg.max_memory ?? safeCfg.maxMemory;
  const maxMemory =
    typeof rawMem === "string" && /^\d+(\.\d+)?\s*(KB|MB|GB|TB|KiB|MiB|GiB)$/i.test(rawMem.trim())
      ? rawMem.trim()
      : null;

  const rawThreads = Number(safeCfg.threads ?? safeCfg.workerThreads ?? 0);
  const threads =
    Number.isFinite(rawThreads) && rawThreads > 0 ? Math.floor(rawThreads) : 0;

  const isComplexLog = argvComplexFlag === "1" || safeCfg.isComplex === true;
  const safeParallel =
    safeCfg.safe_mode_parallel !== false && safeCfg.safeModeParallel !== false;

  return {
    compression,
    rowGroupSize,
    maxMemory,
    threads,
    isComplexLog,
    safeParallel,
  };
}

export async function executeIngestWorkerJob(
  filePath: string,
  targetParquetPath: string,
  rawCfg: any = {},
  argvComplexFlag?: string
): Promise<void> {
  const norm = normalizeWorkerConfig(rawCfg, argvComplexFlag);
  const safeSrc = escapeSqlPath(filePath);
  const safeDst = escapeSqlPath(targetParquetPath);

  const lowerPath = filePath.toLowerCase();
  const isGz = lowerPath.endsWith(".gz");
  const innerPath = isGz ? lowerPath.slice(0, -3) : lowerPath;
  const gzClause = isGz ? "compression = 'gzip'," : "";

  const isJsonLike =
    innerPath.endsWith(".jsonl") ||
    innerPath.endsWith(".ndjson") ||
    innerPath.endsWith(".json");

  const db = await Database.create(":memory:");
  const dbConn = await db.connect();

  try {
    await dbConn.exec("SET preserve_insertion_order = false");
    if (norm.maxMemory) {
      await dbConn.exec(`SET max_memory = '${norm.maxMemory}'`);
    }
    if (norm.threads > 0) {
      await dbConn.exec(`SET threads = ${norm.threads}`);
    }

    if (isJsonLike) {
      const jsonQuery = `
        COPY (
          SELECT * FROM read_json_auto(
            '${safeSrc}',
            ${gzClause}
            ignore_errors = true,
            maximum_object_size = 33554432
          )
        ) TO '${safeDst}' (FORMAT PARQUET, COMPRESSION ${norm.compression}, ROW_GROUP_SIZE ${norm.rowGroupSize});
      `;
      await dbConn.exec(jsonQuery);
    } else if (norm.isComplexLog) {
      const safeLogQuery = `
        COPY (
          SELECT * FROM read_csv(
            '${safeSrc}',
            ${gzClause}
            auto_detect = true,
            sample_size = 100000,
            ignore_errors = true,
            null_padding = true,
            parallel = ${norm.safeParallel ? "true" : "false"},
            all_varchar = true,
            delim = ','
          )
        ) TO '${safeDst}' (FORMAT PARQUET, COMPRESSION ${norm.compression}, ROW_GROUP_SIZE ${norm.rowGroupSize});
      `;
      try {
        await dbConn.exec(safeLogQuery);
      } catch {
        const forceHeaderQuery = `
          COPY (
            SELECT * FROM read_csv(
              '${safeSrc}',
              ${gzClause}
              auto_detect = true,
              sample_size = 2048,
              header = true,
              delim = ',',
              ignore_errors = true,
              null_padding = true,
              parallel = ${norm.safeParallel ? "true" : "false"},
              all_varchar = true
            )
          ) TO '${safeDst}' (FORMAT PARQUET, COMPRESSION ${norm.compression}, ROW_GROUP_SIZE ${norm.rowGroupSize});
        `;
        await dbConn.exec(forceHeaderQuery);
      }
    } else {
      const isCsv = innerPath.endsWith(".csv");
      const isTsv = innerPath.endsWith(".tsv");
      const defaultDelimClause = isCsv ? "delim = ','," : isTsv ? "delim = '\\t'," : "";
      let succeeded = false;

      try {
        const tier0 = `
          COPY (
            SELECT * FROM read_csv(
              '${safeSrc}',
              ${gzClause}
              ${defaultDelimClause}
              auto_detect = true,
              sample_size = 100000,
              ignore_errors = true,
              null_padding = true,
              all_varchar = true
            )
          ) TO '${safeDst}' (FORMAT PARQUET, COMPRESSION ${norm.compression}, ROW_GROUP_SIZE ${norm.rowGroupSize});
        `;
        await dbConn.exec(tier0);
        succeeded = true;
      } catch {}

      if (!succeeded) {
        try {
          const tier1 = `
            COPY (
              SELECT * FROM read_csv(
                '${safeSrc}',
                ${gzClause}
                ${defaultDelimClause}
                auto_detect = true,
                sample_size = 100000,
                ignore_errors = true,
                null_padding = true,
                parallel = false,
                all_varchar = true
              )
            ) TO '${safeDst}' (FORMAT PARQUET, COMPRESSION ${norm.compression}, ROW_GROUP_SIZE ${norm.rowGroupSize});
          `;
          await dbConn.exec(tier1);
          succeeded = true;
        } catch {}
      }

      if (!succeeded) {
        const tier2b = `
          COPY (
            SELECT * FROM read_csv(
              '${safeSrc}',
              ${gzClause}
              auto_detect = true,
              sample_size = 2048,
              header = true,
              ${defaultDelimClause || "delim = ',',"}
              ignore_errors = true,
              null_padding = true,
              parallel = false,
              all_varchar = true
            )
          ) TO '${safeDst}' (FORMAT PARQUET, COMPRESSION ${norm.compression}, ROW_GROUP_SIZE ${norm.rowGroupSize});
        `;
        await dbConn.exec(tier2b);
      }
    }
  } finally {
    try {
      await (dbConn as any).close();
    } catch {}
  }
}

async function runWorker() {
  const filePath = process.argv[2];
  const targetParquetPath = process.argv[3];
  const cfgJson = process.argv[4] || "{}";

  if (!filePath || !targetParquetPath) {
    console.error("[IngestWorker] Missing required arguments: filePath and targetParquetPath");
    process.exit(1);
  }

  let cfg: any = {};
  try {
    cfg = JSON.parse(cfgJson);
  } catch {}

  try {
    await executeIngestWorkerJob(filePath, targetParquetPath, cfg, process.argv[5]);
    if (fs.existsSync(targetParquetPath) && fs.statSync(targetParquetPath).size > 0) {
      notifyParent({ success: true });
      process.exit(0);
    } else {
      process.exit(1);
    }
  } catch (err: any) {
    console.error("[IngestWorker] Worker query execution failed:", err?.message || err);
    process.exit(1);
  }
}

if (require.main === module) {
  runWorker().catch((err) => {
    console.error("[IngestWorker] Fatal unhandled error in worker process:", err);
    process.exit(1);
  });
}
