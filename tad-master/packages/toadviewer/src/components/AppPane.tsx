import * as React from "react";
import { default as ReactDefault, useEffect, useRef, useCallback } from "react";
import _ from "lodash";
import { ActivityBar } from "./ActivityBar";
import { PivotSidebar } from "./PivotSidebar";
import { DataSourceSidebar } from "./DataSourceSidebar";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import {
  FocusStyleManager,
  Button,
  Dialog,
  Classes,
  ProgressBar,
  FormGroup,
  InputGroup,
  HTMLSelect,
  Text,
  Collapse,
  Spinner,
  Icon,
} from "@blueprintjs/core";
import { GridPane, OpenURLFn } from "./GridPane";
import { EventDetailSidebar } from "./EventDetailSidebar";
import { DataRow } from "../PagedDataView";
import { Footer, FooterControl } from "./Footer";
import { RegexDialog } from "./RegexDialog";
import * as actions from "../actions";
import {
  AppState,
  ExportFormat,
  ParquetExportOptions,
  defaultParquetExportOptions,
} from "../AppState";
import * as oneref from "oneref";
import { useState } from "react";
import { Activity } from "./defs";
import { mutableGet, StateRef } from "oneref";
import { DataSourcePath, FilterExp, ReltabConnection, resolvePath } from "reltab";
import { useDeepCompareEffect } from "use-deep-compare";
import { Timer } from "../Timer";
import { SimpleClipboard } from "./SimpleClipboard";
import { CellClickData } from "./CellClickData";
import { createDragDropManager } from "dnd-core";
import { SelectionChangeData } from "./SelectionChangeData";
/**
 * top level application pane
 */

export type NewWindowFn = (
  path: DataSourcePath,
  stateRef: StateRef<AppState>
) => void;

export interface AppPaneBaseProps {
  newWindow: NewWindowFn;
  openURL: OpenURLFn;
  showDataSources?: boolean;
  clipboard: SimpleClipboard;
  embedded: boolean;
  rightFooterSlot?: JSX.Element;
  onFilter?: (filterExp: FilterExp) => void;
  onBrowseExportPath?: (exportFormat: ExportFormat) => void;
  onExportFile?: (
    exportFormat: ExportFormat,
    exportPath: string,
    parquetExportOptions: ParquetExportOptions
  ) => void;
  onCellClick?: (cell: CellClickData) => void;
  onSelectionChange?: (data: SelectionChangeData) => void;
}

export type AppPaneProps = AppPaneBaseProps & oneref.StateRefProps<AppState>;

const handleExportBeginDialogClose = (stateRef: StateRef<AppState>) => {
  actions.setExportBeginDialogOpen(false, stateRef);
};

const handleExportProgressDialogClose = (stateRef: StateRef<AppState>) => {
  actions.setExportProgressDialogOpen(false, "", stateRef);
};

const handleViewConfirmDialogReplace = async (stateRef: StateRef<AppState>) => {
  const appState = mutableGet(stateRef);
  actions.setViewConfirmDialogOpen(false, null, stateRef);
  actions.replaceCurrentView(appState.viewConfirmSourcePath!, stateRef);
};

const handleViewConfirmDialogNewWindow = (
  newWindow: NewWindowFn,
  stateRef: StateRef<AppState>
) => {
  const appState = mutableGet(stateRef);
  actions.setViewConfirmDialogOpen(false, null, stateRef);
  newWindow(appState.viewConfirmSourcePath!, stateRef);
};

const handleViewConfirmDialogClose = (stateRef: StateRef<AppState>) => {
  actions.setViewConfirmDialogOpen(false, null, stateRef);
};

type ExportDialogProps = oneref.StateRefProps<AppState>;

const ExportProgressDialog: React.FunctionComponent<ExportDialogProps> = ({
  appState,
  stateRef,
}: ExportDialogProps) => {
  let filterCountStr = "";

  const { viewState, exportPercent } = appState;

  const isBusy = exportPercent < 1;
  const isComplete = !isBusy;
  const okButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (isComplete) {
      setTimeout(() => {
        okButtonRef.current?.focus();
      }, 0);
    }
  }, [isComplete, okButtonRef]);

  if (
    appState.initialized &&
    viewState !== null &&
    viewState.dataView !== null
  ) {
    const viewParams = viewState.viewParams;
    const queryView = appState.viewState.queryView;

    if (queryView) {
      const { filterRowCount } = queryView;
      filterCountStr = filterRowCount.toLocaleString(undefined, {
        useGrouping: true,
      });
    }
  }

  const exportWord = isBusy ? "Exporting" : "Exported";
  const exportEllipsis = isBusy ? "..." : "";
  const exportText = `${exportWord} ${filterCountStr} rows to ${appState.exportPathBaseName}${exportEllipsis}`;
  return (
    <Dialog
      title="Export File"
      onClose={() => handleExportProgressDialogClose(stateRef)}
      isOpen={appState.exportProgressDialogOpen}
    >
      <div className={Classes.DIALOG_BODY}>
        <Text className="bp4-text-large" ellipsize={true}>
          {exportText}
        </Text>
        <br />
        <ProgressBar stripes={isBusy} />
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button
            disabled={isBusy}
            autoFocus={true}
            elementRef={okButtonRef}
            onClick={() => handleExportProgressDialogClose(stateRef)}
          >
            OK
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

const IngestProgressDialog: React.FunctionComponent<ExportDialogProps> = () => {
  // In Toad v1.3.12.1: Modal dialog is eliminated completely.
  // Progress is displayed non-intrusively in-situ in the main center canvas
  // without any modal backdrop blocking interactions with other files!
  return null;
};

type ParquetOptionsSectionProps = {
  parquetExportOptions: ParquetExportOptions;
  onUpdateParquetOptions: (opts: ParquetExportOptions) => void;
};

export const ParquetOptionsSection: React.FunctionComponent<
  ParquetOptionsSectionProps
> = ({
  parquetExportOptions,
  onUpdateParquetOptions,
}: ParquetOptionsSectionProps) => {
    const { compression } = parquetExportOptions;
    const [isExpanded, setIsExpanded] = useState(false);

    return (
      <>
        <Button onClick={() => setIsExpanded(!isExpanded)}>
          Parquet Options...
        </Button>
        <Collapse isOpen={isExpanded}>
          <div className={Classes.DIALOG_BODY}>
            <FormGroup
              inline={true}
              label="Compression"
              labelFor="parquet-compression-select"
            >
              <HTMLSelect
                id="parquet-compression-select"
                value={compression}
                onChange={(e) =>
                  onUpdateParquetOptions({ compression: e.target.value as any })
                }
                options={[
                  { label: "uncompressed", value: "uncompressed" },
                  { label: "snappy", value: "snappy" },
                  { label: "gzip", value: "gzip" },
                  { label: "zstd", value: "zstd" },
                ]}
              />
            </FormGroup>
          </div>
        </Collapse>
      </>
    );
  };
type ExportBeginDialogProps = oneref.StateRefProps<AppState> & {
  onBrowseExportPath?: (exportFormat: ExportFormat) => void;
  onExportFile?: (
    exportFormat: ExportFormat,
    exportPath: string,
    parquetExportOptions: ParquetExportOptions
  ) => void;
};

const ExportBeginDialog: React.FunctionComponent<ExportBeginDialogProps> = ({
  appState,
  stateRef,
  onBrowseExportPath,
  onExportFile,
}: ExportBeginDialogProps) => {
  let filterCountStr = "";

  // I tried using the Blueprint Dialog autoFocus prop, but it didn't work
  // So let's try setting focus explicitly using an async handler:
  const pathButtonRef = useRef<HTMLButtonElement | null>(null);
  const exportButtonRef = useRef<HTMLButtonElement | null>(null);

  const { viewState, exportBeginDialogOpen, exportPath, exportFormat } =
    appState;
  const hasPath = exportPath != null && exportPath.length > 0;

  useEffect(() => {
    if (exportBeginDialogOpen) {
      // Delay the focus to allow the dialog to fully render
      setTimeout(() => {
        const focusButtonRef = hasPath ? exportButtonRef : pathButtonRef;
        focusButtonRef.current?.focus();
        console.log("focus effect: ", hasPath, focusButtonRef.current);
      }, 0);
    }
  }, [exportBeginDialogOpen, hasPath, exportButtonRef, pathButtonRef]);

  const [parquetExportOptions, setParquetExportOptions] = useState(
    defaultParquetExportOptions
  );

  if (
    appState.initialized &&
    viewState !== null &&
    viewState.dataView !== null
  ) {
    const viewParams = viewState.viewParams;
    const queryView = appState.viewState.queryView;

    if (queryView) {
      const { filterRowCount } = queryView;
      filterCountStr = filterRowCount.toLocaleString(undefined, {
        useGrouping: true,
      });
    }
  }
  const parquetOptionsSection =
    exportFormat === "parquet" ? (
      <ParquetOptionsSection
        parquetExportOptions={parquetExportOptions}
        onUpdateParquetOptions={setParquetExportOptions}
      />
    ) : null;

  return (
    <Dialog
      title="Export"
      onClose={() => handleExportBeginDialogClose(stateRef)}
      isOpen={appState.exportBeginDialogOpen}
    >
      <div className={Classes.DIALOG_BODY}>
        <p className="bp4-text-large">Export {filterCountStr} rows</p>
        <FormGroup label="File Format" labelFor="export-format-select">
          <HTMLSelect
            id="export-format-select"
            value={exportFormat}
            onChange={(e) =>
              actions.setExportFormat(e.target.value as ExportFormat, stateRef)
            }
            options={[
              { label: "Parquet", value: "parquet" },
              { label: "CSV", value: "csv" },
            ]}
          />
        </FormGroup>
        <FormGroup label="Export To File" labelFor="export-path">
          <InputGroup
            id="export-path"
            value={exportPath}
            onChange={(e) => actions.setExportPath(e.target.value, stateRef)}
            rightElement={
              <Button
                icon="folder-open"
                minimal
                elementRef={pathButtonRef}
                intent={hasPath ? undefined : "primary"}
                onClick={(e) => onBrowseExportPath?.(exportFormat)}
              />
            }
          />
        </FormGroup>
        {parquetOptionsSection}
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button
            disabled={!hasPath}
            intent={hasPath ? "primary" : undefined}
            elementRef={exportButtonRef}
            onClick={() => {
              actions.setExportBeginDialogOpen(false, stateRef);
              onExportFile?.(exportFormat, exportPath, parquetExportOptions);
            }}
          >
            Export
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

interface ViewConfirmDialogBaseProps {
  newWindow: NewWindowFn;
}

type ViewConfirmDialogProps = ViewConfirmDialogBaseProps &
  oneref.StateRefProps<AppState>;

const ViewConfirmDialog: React.FunctionComponent<ViewConfirmDialogProps> = ({
  newWindow,
  appState,
  stateRef,
}: ViewConfirmDialogProps) => {
  return (
    <Dialog
      title="Open Table"
      onClose={() => handleViewConfirmDialogClose(stateRef)}
      isOpen={appState.viewConfirmDialogOpen}
    >
      <div className={Classes.DIALOG_BODY}>
        <p className="bp4-text-large">
          You have unsaved changes to the current view. <br />
          Do you want to:
        </p>
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button onClick={() => handleViewConfirmDialogReplace(stateRef)}>
            Replace Current View
          </Button>
          <Button
            onClick={() =>
              handleViewConfirmDialogNewWindow(newWindow, stateRef)
            }
          >
            Open in New Window
          </Button>
          <Button
            intent="primary"
            onClick={() => handleViewConfirmDialogClose(stateRef)}
          >
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

async function setTitleFromDSPath(
  rtc: ReltabConnection,
  dsPath: DataSourcePath
) {
  const node = await resolvePath(rtc, dsPath);
  const title = `${node.displayName} - TOAD`;
  document.title = title;
}

function timerShowModal(timer: Timer): boolean {
  return timer.running && timer.elapsed > 500;
}

const dndManager = createDragDropManager(HTML5Backend);

export const AppPane: React.FunctionComponent<AppPaneProps> = ({
  newWindow,
  appState,
  stateRef,
  clipboard,
  showDataSources: rawShowDataSources,
  openURL,
  embedded,
  rightFooterSlot,
  onFilter,
  onBrowseExportPath,
  onExportFile,
  onCellClick,
  onSelectionChange
}: AppPaneProps) => {
  const { activity, exportBeginDialogOpen } = appState;
  const dataSourceExpanded = activity === "DataSource";
  const pivotPropsExpanded = activity === "Pivot";
  let mainContents: JSX.Element | null = null;
  const showDataSources =
    rawShowDataSources === undefined ? true : rawShowDataSources;

  const { rtc, viewState } = appState;

  let dsPath = viewState?.dsPath;

  const [expandedEvent, setExpandedEvent] = useState<{
    rowData: DataRow;
    rowIndex: number;
  } | null>(null);

  const handleExpandEvent = useCallback(
    (rowData: DataRow, rowIndex: number, forceOpen?: boolean) => {
      setExpandedEvent({ rowData, rowIndex });
    },
    []
  );

  const handleCloseDetail = useCallback(() => {
    setExpandedEvent(null);
  }, []);

  const footerControlRef = useRef<FooterControl | null>(null);

  const handleRegisterFooterControl = useCallback((ctrl: FooterControl) => {
    footerControlRef.current = ctrl;
  }, []);

  const handleAddFilterFromDetail = useCallback(
    (cid: string, value: any, displayName: string) => {
      if (footerControlRef.current?.isExpanded()) {
        footerControlRef.current.addRuleFromDetail(cid, value);
      } else {
        const nextFE = actions.addFilterRule(cid, value, stateRef);
        onFilter?.(nextFE);
      }
    },
    [stateRef, onFilter]
  );

  // Collapse event detail panel if data source path or page changes
  useEffect(() => {
    setExpandedEvent(null);
  }, [dsPath, viewState?.currentPage]);

  // Keyboard shortcuts (Ctrl+F to toggle Filter panel)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        footerControlRef.current?.toggleExpanded();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Trigger grid resize when detail panel toggles
  useEffect(() => {
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 60);
    return () => clearTimeout(timer);
  }, [expandedEvent]);

  useDeepCompareEffect(() => {
    if (rtc && dsPath) {
      setTitleFromDSPath(rtc, dsPath);
    }
  }, [dsPath]);

  let centerPane: JSX.Element | null = null;
  let pivotSidebar: JSX.Element | null = null;

  const activeLoading = appState.activeLoadingFile;

  if (activeLoading && activeLoading.isLoading) {
    pivotSidebar = null;
    centerPane = (
      <div className="center-app-pane center-loading-pane">
        <div className="main-loading-card">
          <div className="main-loading-spinner-wrap">
            <Spinner size={48} intent="primary" />
          </div>
          <h3 className="main-loading-title">
            Loading {activeLoading.fileName}...
          </h3>
          <p className="main-loading-subtitle">
            {activeLoading.statusText ||
              "Processing and indexing data for instant analysis..."}
          </p>
          <div className="main-loading-progress-wrap">
            <ProgressBar
              value={Math.max(0.03, Math.min(1, (activeLoading.percent || 0) / 100))}
              intent="primary"
              stripes={true}
            />
            <div className="main-loading-progress-stats">
              <span>{Math.round(activeLoading.percent || 0)}% completed</span>
              {activeLoading.speedMBs !== undefined && activeLoading.speedMBs > 0 && (
                <span>Speed: {activeLoading.speedMBs.toFixed(1)} MB/s</span>
              )}
              {activeLoading.etaSec !== undefined && activeLoading.etaSec > 0 && (
                <span>ETA: {activeLoading.etaSec}s</span>
              )}
            </div>
          </div>
          <div className="main-loading-hint">
            You can click any other file in the sidebar to analyze it while this dataset continues processing in the background.
          </div>
        </div>
      </div>
    );
  } else if (activeLoading && activeLoading.error) {
    pivotSidebar = null;
    centerPane = (
      <div className="center-app-pane center-error-pane">
        <div className="main-error-card">
          <Icon icon="error" iconSize={40} intent="danger" />
          <h3 className="main-error-title">
            Error loading {activeLoading.fileName}
          </h3>
          <p className="main-error-desc">{activeLoading.error}</p>
        </div>
      </div>
    );
  } else if (
    appState.initialized &&
    viewState !== null &&
    viewState.dataView !== null
  ) {
    pivotSidebar = (
      <PivotSidebar
        expanded={pivotPropsExpanded}
        schema={viewState.baseSchema}
        viewParams={viewState.viewParams}
        delayedCalcMode={viewState.delayedCalcMode}
        embedded={embedded}
        stateRef={stateRef}
      />
    );
    centerPane = (
      <div className="center-app-pane">
        <div className="grid-and-detail-container">
          <GridPane
            appState={appState}
            viewState={appState.viewState}
            stateRef={stateRef}
            clipboard={clipboard}
            openURL={openURL}
            embedded={embedded}
            onCellClick={onCellClick}
            onSelectionChange={onSelectionChange}
            onExpandEvent={handleExpandEvent}
            expandedRowIndex={expandedEvent ? expandedEvent.rowIndex : null}
          />
          {expandedEvent && (
            <EventDetailSidebar
              schema={viewState.baseSchema}
              rowData={expandedEvent.rowData}
              rowIndex={expandedEvent.rowIndex}
              globalRowIndex={
                ((viewState.currentPage || 1) - 1) * (viewState.pageSize || 1000) +
                expandedEvent.rowIndex +
                1
              }
              onClose={handleCloseDetail}
              clipboard={clipboard}
              onAddFilter={handleAddFilterFromDetail}
            />
          )}
        </div>
        <Footer
          appState={appState}
          stateRef={stateRef}
          rightFooterSlot={rightFooterSlot}
          onFilter={onFilter}
          registerFooterControl={handleRegisterFooterControl}
        />
      </div>
    );
  } else if (
    appState.initialized &&
    viewState !== null &&
    viewState.dataView === null
  ) {
    let fileName = "dataset";
    if (viewState.dsPath) {
      const seg = viewState.dsPath.path[viewState.dsPath.path.length - 1];
      if (seg && seg !== ".") {
        fileName = seg;
      } else if (typeof (viewState.dsPath.sourceId as any)?.resourceId === "string") {
        fileName =
          (viewState.dsPath.sourceId as any).resourceId.split(/[/\\]/).pop() ||
          "dataset";
      }
    }
    centerPane = (
      <div className="center-app-pane center-loading-pane">
        <div className="main-loading-card">
          <div className="main-loading-spinner-wrap">
            <Spinner size={48} intent="primary" />
          </div>
          <h3 className="main-loading-title">Opening {fileName}...</h3>
          <p className="main-loading-subtitle">
            Fetching dataset rows and calculating metrics...
          </p>
        </div>
      </div>
    );
  } else {
    pivotSidebar = null;
    centerPane = (
      <div className="center-app-pane center-empty-pane">
        <div className="main-empty-card">
          <Icon icon="th" iconSize={48} color="#94a3b8" />
          <h3 className="main-empty-title">Ready for Analysis</h3>
          <p className="main-empty-desc">
            Select a file from the Data Sources panel on the left to start analyzing.
          </p>
        </div>
      </div>
    );
  }
  const dataSourceSidebar = showDataSources ? (
    <DataSourceSidebar expanded={dataSourceExpanded} stateRef={stateRef} />
  ) : null;
  mainContents = (
    <div className="container-fluid full-height main-container toad-app-pane tad-app-pane">
      <DndProvider manager={dndManager}>
        <ActivityBar
          activity={activity}
          showDataSources={showDataSources}
          stateRef={stateRef}
        />
        {dataSourceSidebar}
        {pivotSidebar}
        {centerPane}
      </DndProvider>
      <ExportBeginDialog
        appState={appState}
        stateRef={stateRef}
        onBrowseExportPath={onBrowseExportPath}
        onExportFile={onExportFile}
      />
      <ExportProgressDialog appState={appState} stateRef={stateRef} />
      <ViewConfirmDialog
        newWindow={newWindow}
        appState={appState}
        stateRef={stateRef}
      />
      <RegexDialog appState={appState} stateRef={stateRef} />
    </div>
  );
  return mainContents;
};

// Useful for checking for duplicate React versions
export const toadReact = ReactDefault;
export const tadReact = toadReact;
