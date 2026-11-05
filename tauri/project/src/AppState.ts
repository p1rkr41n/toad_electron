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
  activity: "None",
  showRecordCount: true,
  ingestProgress: defaultIngestProgressInfo,
  activeLoadingFile: null,
};

export class AppState extends Immutable.Record(defaultAppStateProps) {
  public readonly initialized!: boolean; // Has main process initialization completed?

  public readonly windowTitle!: string; // Usually just the table name or file name

  public readonly rtc!: reltab.ReltabConnection;

  public readonly viewState!: ViewState;
  public readonly regexDialogOpen!: boolean;
  public readonly parseTargetCol!: string | null;
  public readonly exportBeginDialogOpen!: boolean;
  public readonly exportProgressDialogOpen!: boolean;
  public readonly exportFormat!: ExportFormat;
  public readonly exportPath!: string;
  public readonly exportPathBaseName!: string;
  public readonly exportPercent!: number;
  public readonly viewConfirmDialogOpen!: boolean;
  public readonly viewConfirmSourcePath!: DataSourcePath | null;
  public readonly appLoadingTimer!: Timer;
  public readonly activity!: Activity;
  public readonly showRecordCount!: boolean;
  public readonly ingestProgress!: IngestProgressInfo;
  public readonly activeLoadingFile!: ActiveLoadingFileInfo | null;
}

