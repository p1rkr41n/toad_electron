/**
 * Ingest Worker Process (Out-of-Process Crash Firewall)
 *
 * Chạy độc lập trong tiến trình con Node/Electron nhằm cô lập hoàn toàn các lỗi sập
 * C++ Assertion/Crash (như vector.cpp:1859) của DuckDB native addon, bảo vệ tiến trình
 * giao diện chính (Electron / Tad) không bao giờ bị terminate bất ngờ.
 */

import * as path from "path";
import * as fs from "fs";
import { Database } from "duckdb-async";

function escapeSqlPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/'/g, "''");
}

async function runWorker() {
  const filePath = process.argv[2];
  const targetParquetPath = process.argv[3];
  const cfgJson = process.argv[4] || "{}";
  const isComplexLog = process.argv[5] === "1";

  if (!filePath || !targetParquetPath) {
    console.error("[IngestWorker] Missing required arguments: filePath and targetParquetPath");
    process.exit(1);
  }

  let cfg: any = {};
  try {
    cfg = JSON.parse(cfgJson);
  } catch {}

  const compression = (cfg.compression || "snappy").toUpperCase();
  const rowGroupSize = cfg.row_group_size || 122880;
  const safeSrc = escapeSqlPath(filePath);
  const safeDst = escapeSqlPath(targetParquetPath);

  const db = await Database.create(":memory:");
  const dbConn = await db.connect();

  try {
    // Dynamic thread & memory budgeting for worker
    await dbConn.exec("SET preserve_insertion_order = false");
    if (
      cfg.max_memory &&
      typeof cfg.max_memory === "string" &&
      /\d+\s*(MB|GB)/i.test(cfg.max_memory)
    ) {
      await dbConn.exec(`SET max_memory = '${cfg.max_memory.trim()}'`);
    }

    if (isComplexLog) {
      // Safe Ingest Profile (100% VARCHAR, 0% Crash assertion)
      // Stage 1: Auto-detect with all_varchar = true, delim = ','
      const safeLogQuery = `
        COPY (
          SELECT * FROM read_csv(
            '${safeSrc}',
            auto_detect = true,
            sample_size = 100000,
            ignore_errors = true,
            null_padding = true,
            parallel = false,
            all_varchar = true,
            delim = ','
          )
        ) TO '${safeDst}' (FORMAT PARQUET, COMPRESSION ${compression}, ROW_GROUP_SIZE ${rowGroupSize});
      `;
      try {
        await dbConn.exec(safeLogQuery);
      } catch (errStage1) {
        // Stage 2: Force Header Fallback (đọc trực tiếp dòng 1 làm danh sách cột)
        const forceHeaderQuery = `
          COPY (
            SELECT * FROM read_csv(
              '${safeSrc}',
              header = true,
              delim = ',',
              ignore_errors = true,
              null_padding = true,
              parallel = false,
              all_varchar = true
            )
          ) TO '${safeDst}' (FORMAT PARQUET, COMPRESSION ${compression}, ROW_GROUP_SIZE ${rowGroupSize});
        `;
        await dbConn.exec(forceHeaderQuery);
      }
    } else {
      // Standard CSV with 3-tier fallback (TUYỆT ĐỐI không dùng escape='"' gây crash)
      let succeeded = false;

      // Tier 0: RFC-4180 chuẩn (quote='"', escape='')
      try {
        const tier0 = `
          COPY (
            SELECT * FROM read_csv(
              '${safeSrc}',
              auto_detect = true,
              sample_size = 100000,
              ignore_errors = true,
              null_padding = true,
              quote = '"',
              escape = ''
            )
          ) TO '${safeDst}' (FORMAT PARQUET, COMPRESSION ${compression}, ROW_GROUP_SIZE ${rowGroupSize});
        `;
        await dbConn.exec(tier0);
        succeeded = true;
      } catch (err0) {
        // Fallback Tier 1
      }

      if (!succeeded) {
        // Tier 1: parallel=false
        try {
          const tier1 = `
            COPY (
              SELECT * FROM read_csv(
                '${safeSrc}',
                auto_detect = true,
                sample_size = 100000,
                ignore_errors = true,
                null_padding = true,
                parallel = false,
                quote = '"',
                escape = ''
              )
            ) TO '${safeDst}' (FORMAT PARQUET, COMPRESSION ${compression}, ROW_GROUP_SIZE ${rowGroupSize});
          `;
          await dbConn.exec(tier1);
          succeeded = true;
        } catch (err1) {
          // Fallback Tier 2
        }
      }

      if (!succeeded) {
        // Tier 2: all_varchar=true (100% columns VARCHAR)
        try {
          const tier2 = `
            COPY (
              SELECT * FROM read_csv(
                '${safeSrc}',
                auto_detect = true,
                sample_size = 100000,
                ignore_errors = true,
                null_padding = true,
                parallel = false,
                all_varchar = true,
                quote = '"',
                escape = ''
              )
            ) TO '${safeDst}' (FORMAT PARQUET, COMPRESSION ${compression}, ROW_GROUP_SIZE ${rowGroupSize});
          `;
          await dbConn.exec(tier2);
          succeeded = true;
        } catch (err2) {
          // Fallback Tier 2b
        }
      }

      if (!succeeded) {
        // Tier 2b: Force Header fallback
        const tier2b = `
          COPY (
            SELECT * FROM read_csv(
              '${safeSrc}',
              header = true,
              delim = ',',
              ignore_errors = true,
              null_padding = true,
              parallel = false,
              all_varchar = true
            )
          ) TO '${safeDst}' (FORMAT PARQUET, COMPRESSION ${compression}, ROW_GROUP_SIZE ${rowGroupSize});
        `;
        await dbConn.exec(tier2b);
      }
    }

    if (fs.existsSync(targetParquetPath) && fs.statSync(targetParquetPath).size > 0) {
      if (process.send) {
        process.send({ success: true });
      }
      process.exit(0);
    } else {
      process.exit(1);
    }
  } catch (err: any) {
    console.error("[IngestWorker] Worker query execution failed:", err?.message || err);
    process.exit(1);
  } finally {
    try {
      await (dbConn as any).close();
    } catch {}
  }
}

if (require.main === module) {
  runWorker().catch((err) => {
    console.error("[IngestWorker] Fatal unhandled error in worker process:", err);
    process.exit(1);
  });
}
