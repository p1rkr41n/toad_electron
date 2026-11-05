import * as Immutable from "immutable";
import { ViewState } from "./ViewState";
import * as reltab from "reltab";
import { DataSourcePath, DataSourceId } from "reltab";
import { Timer } from "./Timer";
import { Activity } from "./components/defs";
/**
 * Immutable representation of application state
 *
 * Just a single view in a single untabbed window for now.
 */

export type ExportFormat = "csv" | "parquet";

export interface ParquetExportOptions {
  compression: "uncompressed" | "snappy" | "gzip" | "zstd";
}

export const defaultParquetExportOptions: ParquetExportOptions = {
  compression: "snappy",
};

export interface IngestProgressInfo {
  isOpen: boolean;
  fileName: string;
  percent: number;
  speedMBs: number;
  etaSec: number;
  statusText: string;
}

export const defaultIngestProgressInfo: IngestProgressInfo = {
  isOpen: false,
  fileName: "",
  percent: 0,
  speedMBs: 0,
  etaSec: 0,
  statusText: "",
};

export interface ActiveLoadingFileInfo {
  isLoading: boolean;
  fileName: string;
  dsPath: DataSourcePath | null;
  percent: number;
  speedMBs?: number;
  etaSec?: number;
  statusText?: string;
  error?: string;
}

export const defaultActiveLoadingFileInfo: ActiveLoadingFileInfo = {
  isLoading: false,
  fileName: "",
  dsPath: null,
  percent: 0,
  speedMBs: 0,
  etaSec: 0,
  statusText: "",
  error: "",
};

export interface AppStateProps {
  initialized: boolean; // Has main process initialization completed?

  windowTitle: string; // Usually just the table name or file name

  rtc: reltab.ReltabConnection | null;

  viewState: ViewState | null;
  regexDialogOpen: boolean;
  parseTargetCol: string | null;
  exportBeginDialogOpen: boolean;
  exportProgressDialogOpen: boolean;
  exportFormat: ExportFormat;
  exportPath: string;
  exportPathBaseName: string;
  exportPercent: number;

  viewConfirmDialogOpen: boolean;
  viewConfirmSourcePath: DataSourcePath | null;

  appLoadingTimer: Timer;
  activity: Activity;
  showRecordCount: boolean;
  ingestProgress: IngestProgressInfo;
  activeLoadingFile: ActiveLoadingFileInfo | null;
}

const defaultAppStateProps: AppStateProps = {
  initialized: false,
  windowTitle: "",
  rtc: null,
  viewState: null,
  regexDialogOpen: false,
  parseTargetCol: null,
  exportBeginDialogOpen: false,
  exportProgressDialogOpen: false,
  exportFormat: "parquet",
  exportPath: "",
  exportPathBaseName: "",
  exportPercent: 0,
  viewConfirmDialogOpen: false,
  viewConfirmSourcePath: null,
  appLoadingTimer: new Timer(),
  activity: "DataSource",
  showRecordCount: true,
  ingestProgress: defaultIngestProgressInfo,
  activeLoadingFile: null,
};

export class AppState extends Immutable.Record(defaultAppStateProps) {
  public readonly declare initialized: boolean; // Has main process initialization completed?

  public readonly declare windowTitle: string; // Usually just the table name or file name

  public readonly declare rtc: reltab.ReltabConnection;

  public readonly declare viewState: ViewState;
  public readonly declare regexDialogOpen: boolean;
  public readonly declare parseTargetCol: string | null;
  public readonly declare exportBeginDialogOpen: boolean;
  public readonly declare exportProgressDialogOpen: boolean;
  public readonly declare exportFormat: ExportFormat;
  public readonly declare exportPath: string;
  public readonly declare exportPathBaseName: string;
  public readonly declare exportPercent: number;
  public readonly declare viewConfirmDialogOpen: boolean;
  public readonly declare viewConfirmSourcePath: DataSourcePath | null;
  public readonly declare appLoadingTimer: Timer;
  public readonly declare activity: Activity;
  public readonly declare showRecordCount: boolean;
  public readonly declare ingestProgress: IngestProgressInfo;
  public readonly declare activeLoadingFile: ActiveLoadingFileInfo | null;
}

