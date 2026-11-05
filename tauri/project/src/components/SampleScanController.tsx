import * as React from "react";
import { ScanProgress } from "../workers/SampleScanWorker";

export interface SampleScanControllerProps {
  selectedCol: string;
  totalRowsAvailable: number;
  scannedRows: number;
  isScanning: boolean;
  scanProgress?: ScanProgress | null;
  newFieldsDiscovered?: number;
  onScanDeep: () => void;
  onCancelScan?: () => void;
  totalFieldsCount: number;
}

export const SampleScanController: React.FC<SampleScanControllerProps> = ({
  selectedCol,
  totalRowsAvailable,
  scannedRows,
  isScanning,
  scanProgress,
  newFieldsDiscovered,
  onScanDeep,
  onCancelScan,
  totalFieldsCount
}) => {
  const isDeepScanned = scannedRows >= 1000 || (scannedRows >= totalRowsAvailable && totalRowsAvailable > 100);

  return (
    <div className="sample-scan-controller">
      <div className="scan-header-row">
        <div className="scan-status-group">
          <span
            className={`scan-depth-pill ${isDeepScanned ? "scan-depth-deep" : "scan-depth-preview"}`}
            title={isDeepScanned ? "Deep scan completed across sample pool" : "Fast preview scan on initial sample rows"}
          >
            {isDeepScanned ? "Deep Scan (1,000 Rows)" : `Preview (${scannedRows} Rows)`}
          </span>

          <span className="scan-discovered-badge" title="Total unique leaf fields extracted">
            <strong>{totalFieldsCount}</strong> fields found
          </span>

          {newFieldsDiscovered !== undefined && newFieldsDiscovered > 0 && (
            <span className="scan-badge-new" title="Newly discovered fields in this scan">
              +{newFieldsDiscovered} new fields discovered
            </span>
          )}
        </div>

        <div className="scan-actions-group">
          <button
            type="button"
            className="scan-deep-btn"
            id="btn-scan-deep"
            onClick={onScanDeep}
            disabled={isScanning}
            title="Scan up to 1,000 sample rows without freezing the UI to discover rare fields"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z" />
            </svg>
            <span>
              {isScanning
                ? "Scanning..."
                : isDeepScanned
                ? "Re-scan 1,000 Rows"
                : "Scan 1,000 Rows"}
            </span>
          </button>

          {isScanning && onCancelScan && (
            <button
              type="button"
              className="scan-cancel-btn"
              onClick={onCancelScan}
              title="Cancel ongoing scan"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {isScanning && scanProgress && (
        <div className="scan-progress-container">
          <div className="scan-progress-bar">
            <div
              className="scan-progress-fill"
              style={{ width: `${Math.min(100, Math.max(0, scanProgress.percent))}%` }}
            />
          </div>
          <div className="scan-progress-text">
            <span>
              Scanning chunk: {scanProgress.scanned} of {scanProgress.total} rows ({scanProgress.percent}%)
            </span>
            <span>{scanProgress.discoveredCount} fields found</span>
          </div>
        </div>
      )}
    </div>
  );
};
