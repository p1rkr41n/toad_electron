import * as React from "react";
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { Button, InputGroup, Tag } from "@blueprintjs/core";
import * as reltab from "reltab";
import { DataRow } from "../PagedDataView";
import { SimpleClipboard } from "./SimpleClipboard";
import {
  decodeBase64Utf16LE,
  decodeBase64Utf8,
  decodeUrl,
  defangIoC,
  detectForensicCapabilities,
  DecodeResult,
} from "../utils/ForensicDecoder";

export interface EventDetailSidebarProps {
  schema: reltab.Schema;
  rowData: DataRow | null;
  rowIndex: number | null;
  globalRowIndex?: number | null;
  onClose: () => void;
  clipboard?: SimpleClipboard;
  onAddFilter?: (cid: string, value: any, displayName: string) => void;
}

interface FieldEntry {
  cid: string;
  displayName: string;
  type: string;
  value: any;
}

const shortenType = (type: string | undefined): string => {
  if (!type) return "str";
  switch (type.toLowerCase()) {
    case "integer":
      return "int";
    case "boolean":
      return "bool";
    case "string":
    case "text":
    case "varchar":
      return "str";
    case "timestamp":
    case "datetime":
    case "date":
      return "time";
    case "double":
    case "float":
    case "real":
    case "numeric":
      return "num";
    default:
      return type.length > 6 ? type.slice(0, 5) : type;
  }
};

const EventDetailSidebarInner: React.FC<EventDetailSidebarProps> = ({
  schema,
  rowData,
  rowIndex,
  globalRowIndex,
  onClose,
  clipboard,
  onAddFilter,
}) => {
  const [sidebarWidth, setSidebarWidth] = useState<number>(440);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [copiedAll, setCopiedAll] = useState<boolean>(false);
  const [copiedCid, setCopiedCid] = useState<string | null>(null);
  const [addedFilterCid, setAddedFilterCid] = useState<string | null>(null);
  const [activeDecoded, setActiveDecoded] = useState<{ [cid: string]: DecodeResult }>({});
  const [copiedDecodedCid, setCopiedDecodedCid] = useState<string | null>(null);

  const handleDecode = useCallback(
    (
      cid: string,
      type: "b64_utf16le" | "b64_utf8" | "url" | "defang",
      rawText: string
    ) => {
      let res: DecodeResult;
      switch (type) {
        case "b64_utf16le":
          res = decodeBase64Utf16LE(rawText);
          break;
        case "b64_utf8":
          res = decodeBase64Utf8(rawText);
          break;
        case "url":
          res = decodeUrl(rawText);
          break;
        case "defang":
          res = defangIoC(rawText);
          break;
      }
      setActiveDecoded((prev) => ({
        ...prev,
        [cid]: res,
      }));
    },
    []
  );

  const handleCloseDecoded = useCallback((cid: string) => {
    setActiveDecoded((prev) => {
      const next = { ...prev };
      delete next[cid];
      return next;
    });
  }, []);

  const handleAddFilter = useCallback(
    (cid: string, value: any, displayName: string) => {
      onAddFilter?.(cid, value, displayName);
      setAddedFilterCid(cid);
      setTimeout(() => {
        setAddedFilterCid((prev) => (prev === cid ? null : prev));
      }, 1500);
    },
    [onAddFilter]
  );

  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(440);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Handle panel resizing from left border
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDraggingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = sidebarWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = startXRef.current - moveEvent.clientX;
      const newWidth = Math.max(
        320,
        Math.min(window.innerWidth * 0.75, startWidthRef.current + delta)
      );
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("blur", handleMouseUp);
      document.removeEventListener("mouseleave", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("blur", handleMouseUp);
    document.addEventListener("mouseleave", handleMouseUp);
  }, [sidebarWidth]);

  // Safety cleanup on unmount if user presses Esc while dragging
  useEffect(() => {
    return () => {
      if (isDraggingRef.current) {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
  }, []);

  // Extract all fields in event row
  const fieldEntries: FieldEntry[] = useMemo(() => {
    if (!rowData || !schema) return [];
    const entries: FieldEntry[] = [];
    const seen = new Set<string>();

    // 1. All schema columns (natural display order)
    if (schema.columns) {
      for (const cid of schema.columns) {
        if (cid.startsWith("_")) continue;
        seen.add(cid);
        const md = schema.columnMetadata ? schema.columnMetadata[cid] : null;
        let rawType: any = md?.columnType;
        if (!rawType && typeof schema.columnType === "function") {
          try {
            rawType = schema.columnType(cid);
          } catch {
            rawType = typeof rowData[cid];
          }
        }
        if (!rawType) {
          rawType = typeof rowData[cid];
        }
        const colType =
          typeof rawType === "string"
            ? rawType
            : rawType?.sqlTypeName || rawType?.kind || "str";
        entries.push({
          cid,
          displayName: md?.displayName || cid,
          type: colType,
          value: rowData[cid],
        });
      }
    }

    // 2. Any other data keys in rowData not in schema.columns (excluding '_' internal props)
    for (const key of Object.keys(rowData)) {
      if (key.startsWith("_") || seen.has(key)) continue;
      entries.push({
        cid: key,
        displayName: key,
        type: typeof rowData[key],
        value: rowData[key],
      });
    }

    // 3. Unpack nested JSON fields if present (e.g. Details, ExtraFieldInfo, EventData)
    const jsonUnpacked: FieldEntry[] = [];
    for (const entry of entries) {
      if (
        typeof entry.value === "string" &&
        entry.value.trim().startsWith("{")
      ) {
        try {
          const parsed = JSON.parse(entry.value.trim());
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            for (const [subKey, subVal] of Object.entries(parsed)) {
              const fullCid = `${entry.cid}.${subKey}`;
              if (!seen.has(fullCid)) {
                seen.add(fullCid);
                jsonUnpacked.push({
                  cid: fullCid,
                  displayName: subKey,
                  type: typeof subVal === "object" ? "json" : typeof subVal,
                  value: subVal,
                });
              }
            }
          }
        } catch {}
      }
    }
    entries.push(...jsonUnpacked);

    return entries;
  }, [schema, rowData]);

  // Filter fields based on search term (with slash and backslash normalization)
  const filteredEntries = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return fieldEntries;
    const qNorm = q.replace(/[\\\/]+/g, "/");

    return fieldEntries.filter((entry) => {
      const nameLower = entry.displayName.toLowerCase();
      const cidLower = entry.cid.toLowerCase();
      const matchName =
        nameLower.includes(q) ||
        nameLower.replace(/[\\\/]+/g, "/").includes(qNorm) ||
        cidLower.includes(q) ||
        cidLower.replace(/[\\\/]+/g, "/").includes(qNorm);

      let matchVal = false;
      if (entry.value !== null && entry.value !== undefined) {
        const valStr = String(entry.value).toLowerCase();
        matchVal =
          valStr.includes(q) ||
          valStr.replace(/[\\\/]+/g, "/").includes(qNorm);
      }
      return matchName || matchVal;
    });
  }, [fieldEntries, searchTerm]);


  // Copy text helper
  const copyText = useCallback(
    (text: string) => {
      if (clipboard && clipboard.writeText) {
        clipboard.writeText(text);
      } else if (navigator && navigator.clipboard) {
        navigator.clipboard.writeText(text);
      }
    },
    [clipboard]
  );

  // Copy all fields as JSON
  const handleCopyAll = useCallback(() => {
    const obj: Record<string, any> = {};
    for (const entry of fieldEntries) {
      obj[entry.cid] = entry.value;
    }
    const jsonStr = JSON.stringify(obj, null, 2);
    copyText(jsonStr);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1600);
  }, [fieldEntries, copyText]);

  // Copy individual field value
  const handleCopyFieldVal = useCallback(
    (val: any, cid: string) => {
      const text = val === null || val === undefined ? "" : String(val);
      copyText(text);
      setCopiedCid(cid);
      setTimeout(() => setCopiedCid(null), 1400);
    },
    [copyText]
  );

  // Copy decoded field value
  const handleCopyDecoded = useCallback(
    (text: string, cid: string) => {
      copyText(text);
      setCopiedDecodedCid(cid);
      setTimeout(() => setCopiedDecodedCid(null), 1400);
    },
    [copyText]
  );

  const renderValue = (val: any) => {
    if (val === null || val === undefined) {
      return <span className="event-val-null">&lt;null&gt;</span>;
    }
    if (typeof val === "boolean") {
      return (
        <span
          className={
            val ? "event-val-bool event-val-bool-true" : "event-val-bool event-val-bool-false"
          }
        >
          {String(val)}
        </span>
      );
    }
    if (typeof val === "number") {
      return (
        <span className="event-val-number">
          {Number.isInteger(val) ? val.toLocaleString() : val}
        </span>
      );
    }
    if (typeof val === "object") {
      try {
        return (
          <pre className="event-val-code">{JSON.stringify(val, null, 2)}</pre>
        );
      } catch {
        return <span className="event-val-string">{String(val)}</span>;
      }
    }
    return <span className="event-val-string">{String(val)}</span>;
  };

  const rowNumber =
    globalRowIndex !== undefined && globalRowIndex !== null
      ? globalRowIndex.toLocaleString()
      : rowIndex !== null
      ? (rowIndex + 1).toLocaleString()
      : null;

  return (
    <div
      className="event-detail-sidebar"
      style={{ width: `${sidebarWidth}px` }}
      data-testid="event-detail-sidebar"
    >
      <div
        className="event-detail-resizer"
        onMouseDown={handleMouseDown}
        onDoubleClick={() => setSidebarWidth(440)}
        title="Drag horizontally to resize (Double-click to reset 440px)"
      />

      {/* Header */}
      <div className="event-detail-header">
        <div className="event-detail-header-left">
          <span className="bp4-icon bp4-icon-properties event-detail-title-icon" />
          <span className="event-detail-title">Event Details</span>
          {rowNumber !== null && (
            <span className="event-detail-badge" title={`Row index in current view: ${rowNumber}`}>
              Row #{rowNumber}
            </span>
          )}
        </div>
        <div className="event-detail-header-right">
          <button
            type="button"
            className="event-detail-btn-action"
            onClick={handleCopyAll}
            title="Copy event data as formatted JSON"
          >
            <span
              className={
                copiedAll
                  ? "bp4-icon bp4-icon-tick event-icon-success"
                  : "bp4-icon bp4-icon-duplicate"
              }
            />
            <span className="event-btn-text">
              {copiedAll ? "Copied!" : "Copy JSON"}
            </span>
          </button>
          <button
            type="button"
            className="event-detail-btn-close"
            onClick={onClose}
            title="Close event details (Esc)"
            data-testid="btn-close-event-detail"
          >
            <span className="bp4-icon bp4-icon-cross" />
          </button>
        </div>
      </div>

      {/* Search Filter Bar */}
      <div className="event-detail-search-bar">
        <InputGroup
          className="event-detail-search-input"
          leftIcon="search"
          placeholder="Filter fields or values..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          rightElement={
            searchTerm ? (
              <Button
                icon="cross"
                minimal
                small
                onClick={() => setSearchTerm("")}
                title="Clear search"
              />
            ) : undefined
          }
          small
        />
        <span className="event-detail-count-badge">
          {filteredEntries.length} / {fieldEntries.length}
        </span>
      </div>

      {/* Table Body */}
      <div className="event-detail-body">
        {filteredEntries.length === 0 ? (
          <div className="event-detail-empty">
            <span className="bp4-icon bp4-icon-search event-detail-empty-icon" />
            <p>No fields match &quot;{searchTerm}&quot;</p>
          </div>
        ) : (
          <table className="event-detail-table">
            <thead>
              <tr>
                <th className="th-field-name">Field Name</th>
                <th className="th-field-val">Field Content</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map((entry) => {
                const isCopied = copiedCid === entry.cid;
                const isDecodedCopied = copiedDecodedCid === entry.cid;
                const currentDecoded = activeDecoded[entry.cid];
                const stringVal =
                  entry.value !== null && entry.value !== undefined
                    ? String(entry.value)
                    : "";
                const caps = detectForensicCapabilities(entry.value);
                return (
                  <tr key={entry.cid} className="event-detail-row">
                    <td className="event-col-name">
                      <div className="event-name-container">
                        <div className="event-name-line">
                          <span
                            className="event-name-text"
                            title={entry.displayName}
                          >
                            {entry.displayName}
                          </span>
                          <span
                            className="event-type-tag"
                            title={`Data type: ${entry.type}`}
                          >
                            {shortenType(entry.type)}
                          </span>
                        </div>
                        {entry.displayName !== entry.cid && (
                          <div
                            className="event-cid-subtext"
                            title={`Database column: ${entry.cid}`}
                          >
                            {entry.cid}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="event-col-val">
                      <div className="event-val-container">
                        <div className="event-val-content">
                          {renderValue(entry.value)}

                          {/* DFIR Forensic Actions Toolbar */}
                          {(caps.canDecodeUtf16LE ||
                            caps.canDecodeUtf8 ||
                            caps.canDecodeUrl ||
                            caps.canDefang) && (
                            <div className="event-forensic-bar">
                              <span className="event-forensic-label">
                                Forensic:
                              </span>
                              {caps.canDecodeUtf16LE && (
                                <button
                                  type="button"
                                  className={`event-btn-forensic btn-ps-b64${
                                    currentDecoded?.type === "b64_utf16le"
                                      ? " active"
                                      : ""
                                  }`}
                                  onClick={() =>
                                    handleDecode(
                                      entry.cid,
                                      "b64_utf16le",
                                      caps.detectedBase64Token || stringVal
                                    )
                                  }
                                  title="Decode PowerShell UTF-16LE Base64 payload (-enc)"
                                >
                                  PS B64
                                </button>
                              )}
                              {caps.canDecodeUtf8 && (
                                <button
                                  type="button"
                                  className={`event-btn-forensic${
                                    currentDecoded?.type === "b64_utf8"
                                      ? " active"
                                      : ""
                                  }`}
                                  onClick={() =>
                                    handleDecode(
                                      entry.cid,
                                      "b64_utf8",
                                      caps.detectedBase64Token || stringVal
                                    )
                                  }
                                  title="Decode standard Base64 string (UTF-8)"
                                >
                                  B64 UTF-8
                                </button>
                              )}
                              {caps.canDecodeUrl && (
                                <button
                                  type="button"
                                  className={`event-btn-forensic${
                                    currentDecoded?.type === "url"
                                      ? " active"
                                      : ""
                                  }`}
                                  onClick={() =>
                                    handleDecode(entry.cid, "url", stringVal)
                                  }
                                  title="Decode URL percent-encoded characters"
                                >
                                  URL Dec
                                </button>
                              )}
                              {caps.canDefang && (
                                <button
                                  type="button"
                                  className={`event-btn-forensic btn-defang${
                                    currentDecoded?.type === "defang"
                                      ? " active"
                                      : ""
                                  }`}
                                  onClick={() =>
                                    handleDecode(entry.cid, "defang", stringVal)
                                  }
                                  title="Defang IoCs (hxxp, 192[.]168[.]1[.]1) for safe sharing"
                                >
                                  Defang
                                </button>
                              )}
                            </div>
                          )}

                          {/* Decoded/Defanged Output Card */}
                          {currentDecoded && (
                            <div className="event-decoded-card">
                              <div className="event-decoded-card-header">
                                <span className="event-decoded-card-title">
                                  <span className="bp4-icon bp4-icon-code" />{" "}
                                  {currentDecoded.label}
                                </span>
                                <div className="event-decoded-card-actions">
                                  <button
                                    type="button"
                                    className="event-btn-decoded-copy"
                                    onClick={() =>
                                      handleCopyDecoded(
                                        currentDecoded.result,
                                        entry.cid
                                      )
                                    }
                                    title="Copy decoded text"
                                  >
                                    <span
                                      className={
                                        isDecodedCopied
                                          ? "bp4-icon bp4-icon-tick event-icon-success"
                                          : "bp4-icon bp4-icon-clipboard"
                                      }
                                    />
                                    {isDecodedCopied ? "Copied!" : "Copy"}
                                  </button>
                                  <button
                                    type="button"
                                    className="event-btn-decoded-close"
                                    onClick={() =>
                                      handleCloseDecoded(entry.cid)
                                    }
                                    title="Close decoded preview"
                                  >
                                    <span className="bp4-icon bp4-icon-cross" />
                                  </button>
                                </div>
                              </div>
                              <pre className="event-decoded-content">
                                {currentDecoded.result}
                              </pre>
                            </div>
                          )}
                        </div>
                        <div className="event-row-actions">
                          <button
                            type="button"
                            className={`event-btn-add-filter${
                              addedFilterCid === entry.cid ? " added" : ""
                            }`}
                            onClick={() =>
                              handleAddFilter(
                                entry.cid,
                                entry.value,
                                entry.displayName
                              )
                            }
                            title={
                              addedFilterCid === entry.cid
                                ? `Added to filter: ${entry.displayName} = ${
                                    entry.value === null
                                      ? "NULL"
                                      : String(entry.value)
                                  }`
                                : `Add to filter: ${entry.displayName} = ${
                                    entry.value === null
                                      ? "NULL"
                                      : String(entry.value)
                                  }`
                            }
                          >
                            <span
                              className={
                                addedFilterCid === entry.cid
                                  ? "bp4-icon bp4-icon-tick event-icon-success"
                                  : "bp4-icon bp4-icon-plus"
                              }
                            />
                          </button>
                          <button
                            type="button"
                            className="event-btn-copy-val"
                            onClick={() =>
                              handleCopyFieldVal(entry.value, entry.cid)
                            }
                            title="Copy field value"
                          >
                            <span
                              className={
                                isCopied
                                  ? "bp4-icon bp4-icon-tick event-icon-success"
                                  : "bp4-icon bp4-icon-clipboard"
                              }
                            />
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer info */}
      <div className="event-detail-footer">
        <span className="event-footer-hint">
          {fieldEntries.length} total fields &bull; Press <strong>Esc</strong> to collapse
        </span>
      </div>
    </div>
  );
};

class EventDetailErrorBoundary extends React.Component<
  { onClose: () => void; children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { onClose: () => void; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error("EventDetailSidebar render error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="event-detail-sidebar" style={{ width: 340, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 600, color: "#d9534f" }}>Detail View Error</span>
            <button
              className="bp4-button bp4-minimal bp4-icon-cross"
              onClick={this.props.onClose}
              title="Close sidebar"
            />
          </div>
          <p style={{ marginTop: 10, fontSize: "12px", color: "#5c7080" }}>
            {this.state.error?.message || "Failed to render event details."}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

export const EventDetailSidebar: React.FC<EventDetailSidebarProps> = (props) => {
  return (
    <EventDetailErrorBoundary onClose={props.onClose}>
      <EventDetailSidebarInner {...props} />
    </EventDetailErrorBoundary>
  );
};

