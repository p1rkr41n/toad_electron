import * as reltab from "reltab";
import * as csv from "fast-csv";
import * as fs from "fs";
import { once } from "events";
import { finished } from "stream/promises";
import { BrowserWindow, dialog } from "electron";
import { DbDataSource } from "reltab";
import { ExportFormat, ParquetExportOptions } from "toadviewer";
import path from "path";
import { EngineSupervisor } from "./engineSupervisor";

function safeSend(win: BrowserWindow | null | undefined, channel: string, payload?: any): void {
  try {
    if (win && typeof win.isDestroyed === "function" && !win.isDestroyed() && win.webContents) {
      if (payload === undefined) {
        win.webContents.send(channel);
      } else {
        win.webContents.send(channel, payload);
      }
    }
  } catch {}
}

export const openExportBeginDialog = async (
  win: BrowserWindow,
  filterRowCount: number,
  query: reltab.QueryExp
) => {
  safeSend(win, "open-export-begin-dialog", {
    openState: true,
    filterRowCount,
  });
};

export const exportFile = async (
  win: BrowserWindow,
  exportFormat: ExportFormat,
  exportPath: string,
  filterRowCount: number,
  query: reltab.QueryExp,
  parquetExportOptions: ParquetExportOptions
) => {
  if (exportFormat === "csv") {
    return exportCSV(win, exportPath, filterRowCount, query);
  } else if (exportFormat === "parquet") {
    return exportParquet(win, exportPath, query, parquetExportOptions);
  } else {
    console.error("Unsupported export format: ", exportFormat);
  }
};

const exportParquet = async (
  win: BrowserWindow,
  saveFilename: string,
  query: reltab.QueryExp,
  parquetExportOptions: ParquetExportOptions
) => {
  const exportPercent = 0;
  const exportPathBaseName = path.basename(saveFilename);
  safeSend(win, "open-export-progress-dialog", {
    openState: true,
    exportPathBaseName,
    exportPercent,
  });

  try {
    const sup = EngineSupervisor.getInstance();
    const compression = parquetExportOptions?.compression || "snappy";
    if (!sup.isLegacyMode()) {
      await sup.invokeEngine(
        "export:parquet",
        {
          saveFilename,
          queryStr: JSON.stringify(query, reltab.safeJsonReplacer),
          compression,
        },
        600000
      );
    } else {
      const appRtc = (reltab.getExportConnection() ||
        (await reltab.getConnection(
          { providerName: "duckdb", resourceId: "" },
          { hidden: false, forExport: true }
        ))) as DbDataSource;

      const baseQuery = await appRtc.getSqlForQuery(query);
      const safeFile = saveFilename.replace(/\\/g, "/").replace(/'/g, "''");
      const safeComp = String(compression).replace(/[^a-zA-Z0-9_]/g, "") || "snappy";
      const copyQuery = `COPY (${baseQuery}) TO '${safeFile}' (FORMAT 'parquet', COMPRESSION '${safeComp}')`;
      await appRtc.db.runSqlQuery(copyQuery);
    }
    safeSend(win, "export-progress", {
      percentComplete: 1,
    });
  } catch (rawErr) {
    const err = rawErr as Error;
    safeSend(win, "close-export-progress-dialog");
    if (dialog && typeof dialog.showErrorBox === "function") {
      dialog.showErrorBox("Error saving file: ", err.toString());
    } else {
      throw err;
    }
  }
};

const BATCHSIZE = 10000;
const exportCSV = async (
  win: BrowserWindow,
  saveFilename: string,
  filterRowCount: number,
  query: reltab.QueryExp
) => {
  const exportPercent = 0;
  const exportPathBaseName = path.basename(saveFilename);

  safeSend(win, "open-export-progress-dialog", {
    openState: true,
    exportPathBaseName,
    exportPercent,
  });

  try {
    const sup = EngineSupervisor.getInstance();
    const queryStr = JSON.stringify(query, reltab.safeJsonReplacer);
    let schema: reltab.Schema;
    let legacyRtc: DbDataSource | null = null;

    if (!sup.isLegacyMode()) {
      const schemaJson = await sup.invokeEngine(
        "export:getQuerySchema",
        { queryStr },
        120000
      );
      schema =
        schemaJson instanceof reltab.Schema
          ? schemaJson
          : reltab.Schema.fromJSON(schemaJson);
    } else {
      legacyRtc = (reltab.getExportConnection() ||
        (await reltab.getConnection(
          { providerName: "duckdb", resourceId: "" },
          { hidden: false, forExport: true }
        ))) as DbDataSource;
      schema = await legacyRtc.getSchema(query);
    }

    const headerNames = schema.columns.map((cid) => schema.displayName(cid));
    const csvStream = csv.format({
      headers: headerNames,
      writeHeaders: true,
    });
    const writableStream = fs.createWriteStream(saveFilename);
    csvStream.pipe(writableStream);

    const mapRow = (row: reltab.Row) =>
      schema.columns.map((cid) => {
        const val = row[cid];
        return typeof val === "bigint" ? val.toString() : val;
      });

    let offset = 0;
    while (offset < filterRowCount) {
      const limit = Math.min(BATCHSIZE, filterRowCount - offset);
      let res: reltab.TableRep;
      if (!sup.isLegacyMode()) {
        const rawRes = await sup.invokeEngine(
          "evalQuery",
          { queryStr, offset, limit },
          600000
        );
        res =
          rawRes instanceof reltab.TableRep
            ? rawRes
            : reltab.deserializeTableRepJson(rawRes);
      } else {
        res = await legacyRtc!.evalQuery(query, offset, limit);
      }

      if (!res.rowData || res.rowData.length === 0) {
        break;
      }

      for (const row of res.rowData) {
        if (!csvStream.write(mapRow(row))) {
          await once(csvStream, "drain");
        }
      }
      offset += res.rowData.length;
      const percentComplete = filterRowCount > 0 ? offset / filterRowCount : 1;
      safeSend(win, "export-progress", {
        percentComplete,
      });
    }

    csvStream.end();
    await finished(writableStream);
    safeSend(win, "export-progress", {
      percentComplete: 1,
    });
  } catch (rawErr) {
    const err = rawErr as Error;
    safeSend(win, "close-export-progress-dialog");
    if (dialog && typeof dialog.showErrorBox === "function") {
      dialog.showErrorBox("Error saving file: ", err.toString());
    } else {
      throw err;
    }
  }
};
