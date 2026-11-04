import * as React from "react";
import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Dialog,
  Classes,
  Button,
  FormGroup,
  InputGroup,
  HTMLSelect,
  TextArea,
  Callout,
  Intent,
} from "@blueprintjs/core";
import { StateRef } from "oneref";
import { AppState } from "../AppState";
import * as actions from "../actions";
import { ExtractionFormatType, ExtractionFieldMapping } from "../actions";
import { ParseSplitIcon } from "./icons/ParseSplitIcon";

export interface RegexDialogProps {
  appState: AppState;
  stateRef: StateRef<AppState>;
}

interface ExtractionRow {
  id: string;
  sourceKeyOrIdx: string | number;
  outputColName: string;
  sampleVal: string;
  colType: "VARCHAR" | "BIGINT" | "DOUBLE" | "TIMESTAMP" | "BOOLEAN";
  fillRate: number;
  enabled: boolean;
  tokenIndex?: number;
}

export const RegexDialog: React.FC<RegexDialogProps> = ({
  appState,
  stateRef,
}) => {
  const isOpen = appState.regexDialogOpen;
  const viewState = appState.viewState;

  const columns = useMemo(() => {
    if (!viewState || !viewState.baseSchema) return [];
    return viewState.baseSchema.columns;
  }, [viewState]);

  // Mode: "simple" (default) or "advanced" (regex)
  const [mode, setMode] = useState<"simple" | "advanced">("simple");
  const [selectedCol, setSelectedCol] = useState<string>("");
  const [sampleText, setSampleText] = useState<string>("");
  const [sampleList, setSampleList] = useState<string[]>([]);
  const [sampleIdx, setSampleIdx] = useState<number>(0);
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  // Unified Card Tier 1: Format & Header Splitter
  const [formatType, setFormatType] = useState<ExtractionFormatType>("kv");
  const [hasHeader, setHasHeader] = useState<boolean>(false);
  const [headerSep, setHeaderSep] = useState<string>(": ");
  const [headerColName, setHeaderColName] = useState<string>("log_header");
  const [firstRowIsHeader, setFirstRowIsHeader] = useState<boolean>(true);

  // Unified Card Tier 2: Token Syntax Strip (Delimiter, Equal/Assign, Quotes)
  const [delimiter, setDelimiter] = useState<string>(" ");
  const [kvAssign, setKvAssign] = useState<string>("=");
  const [quoteOpen, setQuoteOpen] = useState<string>('"');
  const [quoteClose, setQuoteClose] = useState<string>('"');

  // Search & Sorting Toolbar
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortKey, setSortKey] = useState<"name" | "type" | "fill" | "val" | "col" | null>("fill");
  const [sortAsc, setSortAsc] = useState<boolean>(false);

  // Field Mapping Table Rows
  const [simpleRows, setSimpleRows] = useState<ExtractionRow[]>([]);
  const [isRulesOpen, setIsRulesOpen] = useState<boolean>(false);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [inlineEditVal, setInlineEditVal] = useState<string>("");

  // 1,000-Row Real-Data Validation State (Toad v2.5.0.3)
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [hasTested, setHasTested] = useState<boolean>(false);
  const [realTotalRows, setRealTotalRows] = useState<number>(0);
  const [realMatchedCount, setRealMatchedCount] = useState<number>(0);
  const [realUnmatchedCount, setRealUnmatchedCount] = useState<number>(0);
  const [realMatchPct, setRealMatchPct] = useState<number>(100);
  const [realElapsedMs, setRealElapsedMs] = useState<string>("0.0");
  const [realUnmatchedLines, setRealUnmatchedLines] = useState<{ rowIdx: number; line: string }[]>([]);
  const [unmatchedOpen, setUnmatchedOpen] = useState<boolean>(false);

  // Live SQL Preview State (Collapsed by default)
  const [sqlExpanded, setSqlExpanded] = useState<boolean>(false);
  const [copiedSql, setCopiedSql] = useState<boolean>(false);
  const [copiedSample, setCopiedSample] = useState<boolean>(false);
  const [copiedUnmatched, setCopiedUnmatched] = useState<boolean>(false);

  // Advanced Mode State
  const [regexPattern, setRegexPattern] = useState<string>(
    "(\\d{4}-\\d{2}-\\d{2})\\s+(\\d{2}:\\d{2}:\\d{2})\\s+\\[(\\w+)\\]\\s+(.*)"
  );
  const [advRows, setAdvRows] = useState<ExtractionRow[]>([]);

  // Auto-select first column when modal opens or columns change
  useEffect(() => {
    if (isOpen && columns.length > 0) {
      if (appState.parseTargetCol && columns.includes(appState.parseTargetCol)) {
        setSelectedCol(appState.parseTargetCol);
      } else if (!selectedCol || !columns.includes(selectedCol)) {
        setSelectedCol(columns[0]);
      }
    }
  }, [isOpen, columns, selectedCol, appState.parseTargetCol]);

  // Fetch up to limit non-null, non-empty events across column for multi-row discovery
  const fetchSampleEvents = useCallback(
    (colName: string, limit: number = 50): string[] => {
      if (!colName || !viewState) return [];
      const dataView = viewState.dataView;
      const res: string[] = [];
      if (dataView && dataView.rawData && dataView.rawData.length > 0) {
        for (const row of dataView.rawData) {
          const val = row[colName];
          if (val !== null && val !== undefined && String(val).trim() !== "") {
            const strVal = String(val).trim();
            if (!res.includes(strVal)) {
              res.push(strVal);
              if (res.length >= limit) break;
            }
          }
        }
      }
      return res;
    },
    [viewState]
  );

  // Format Auto-Detection Engine (Enhanced for custom delimiters like ¦, |, and colon assign)
  const detectAndSelectFormat = useCallback((text: string) => {
    if (!text) return;
    let body = text.trim();
    const firstBrace = body.indexOf("{");
    const firstBracket = body.indexOf("[");
    const sepIdx = headerSep ? body.indexOf(headerSep) : -1;
    if (hasHeader && sepIdx >= 0 && (firstBrace === -1 || sepIdx < firstBrace) && (firstBracket === -1 || sepIdx < firstBracket)) {
      const parts = body.split(headerSep);
      body = parts.slice(1).join(headerSep).trim();
    }

    // 1. JSON Object
    if (body.startsWith("{") && body.endsWith("}")) {
      try {
        JSON.parse(body);
        setFormatType("json");
        return;
      } catch { }
    }
    // 2. JSON Array
    if (body.startsWith("[") && body.endsWith("]")) {
      try {
        JSON.parse(body);
        setFormatType("arr");
        return;
      } catch { }
    }

    // Detect delimiter character
    let detectedDelim = " ";
    if (body.includes("¦")) detectedDelim = "¦";
    else if (body.includes("|")) detectedDelim = "|";
    else if (body.includes(";")) detectedDelim = ";";
    else if (body.includes("\t")) detectedDelim = "\t";

    // Analyze tokens under detected delimiter
    const tokens = detectedDelim === " "
      ? body.split(/\s+/).map((t) => t.trim()).filter(Boolean)
      : body.split(detectedDelim).map((t) => t.trim()).filter(Boolean);

    // 3. Key=Value check (must represent a significant portion of top-level tokens, not just isolated query params)
    const kvTokensEqual = tokens.filter((t) => /^[a-zA-Z0-9_\-\.]+=\S*/.test(t));
    const kvTokensColon = tokens.filter((t) => /^[a-zA-Z0-9_\-\.]+:\S*/.test(t));

    if (kvTokensEqual.length >= 2 && (kvTokensEqual.length >= Math.ceil(tokens.length / 3) || tokens.length <= 4)) {
      setFormatType("kv");
      setKvAssign("=");
      setDelimiter(detectedDelim);
      return;
    }
    if (kvTokensColon.length >= 2 && (kvTokensColon.length >= Math.ceil(tokens.length / 3) || tokens.length <= 4)) {
      setFormatType("kv");
      setKvAssign(":");
      setDelimiter(detectedDelim);
      return;
    }

    // 4. CSV (quoted commas or multiple commas)
    if (body.includes('","') || (body.includes(",") && (body.match(/,/g) || []).length >= 2)) {
      setFormatType("csv");
      setDelimiter(",");
      setKvAssign("");
      return;
    }

    // 5. Delimited Space (standard single/multiple spaces or tabs across tokens)
    if (detectedDelim === " " && tokens.length >= 2) {
      setFormatType("space");
      setDelimiter(" ");
      setKvAssign("");
      return;
    }

    // 6. Custom Delimited (e.g. ¦ or | or ; without KV)
    if (detectedDelim !== " " && tokens.length >= 2) {
      setFormatType("raw");
      setDelimiter(detectedDelim);
      setKvAssign("");
      return;
    }

    // 7. Fallback: Raw (Custom Delimiter)
    setFormatType("raw");
    setDelimiter(detectedDelim);
    setKvAssign("");
  }, [hasHeader, headerSep]);

  // Update sampleText and sampleList when selected column changes
  useEffect(() => {
    if (selectedCol) {
      const samples = fetchSampleEvents(selectedCol, 50);
      const listToUse = samples.length > 0 ? samples : ['src=10.0.0.5 dst=8.8.8.8 proto=TCP action="BLOCK AND ALERT" bytes=1420'];
      setSampleList(listToUse);
      setSampleIdx(0);
      setSampleText(listToUse[0]);
      setApplyError(null);
      setHasTested(false);
      setRealUnmatchedLines([]);
      setUnmatchedOpen(false);
      detectAndSelectFormat(listToUse[0]);
    }
  }, [selectedCol, fetchSampleEvents, detectAndSelectFormat]);

  const handlePrevSample = () => {
    if (sampleList.length > 0) {
      const nextIdx = (sampleIdx - 1 + sampleList.length) % sampleList.length;
      setSampleIdx(nextIdx);
      setSampleText(sampleList[nextIdx]);
    }
  };

  const handleNextSample = () => {
    if (sampleList.length > 0) {
      const nextIdx = (sampleIdx + 1) % sampleList.length;
      setSampleIdx(nextIdx);
      setSampleText(sampleList[nextIdx]);
    }
  };

  // Infer default DuckDB type from sample value
  const inferType = (val: string): "VARCHAR" | "BIGINT" | "DOUBLE" | "TIMESTAMP" | "BOOLEAN" => {
    if (!val) return "VARCHAR";
    const trimmed = val.trim();
    if (/^-?\d+$/.test(trimmed)) return "BIGINT";
    if (/^-?\d+\.\d+$/.test(trimmed)) return "DOUBLE";
    if (/^(true|false)$/i.test(trimmed)) return "BOOLEAN";
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return "TIMESTAMP";
    return "VARCHAR";
  };

  // Lexicographical Column Naming Helpers (v2.5.0.3)
  const formatStrColName = (idx: number): string => {
    if (idx <= 0) idx = 1;
    if (idx <= 999) {
      return `str${String(idx).padStart(3, "0")}`;
    }
    const excess = idx - 1000;
    const blockIdx = Math.floor(excess / 999);
    const offset = (excess % 999) + 1;
    const letter = String.fromCharCode(65 + (blockIdx % 26)); // 'A' .. 'Z'
    const cycle = Math.floor(blockIdx / 26);
    const prefix = cycle > 0 ? `${letter}${cycle}` : letter;
    return `str${prefix}${String(offset).padStart(3, "0")}`;
  };

  const parseStrColIndex = (name: string): number | null => {
    if (!name) return null;
    const trimmed = name.trim();

    // Pattern 1: Alpha-block (strA001 .. strZ999)
    const mAlpha = /^str([A-Z])(\d{3,})$/i.exec(trimmed);
    if (mAlpha) {
      const block = mAlpha[1].toUpperCase().charCodeAt(0) - 65;
      const offset = parseInt(mAlpha[2], 10);
      return 1000 + block * 999 + (offset - 1);
    }

    // Pattern 2: 3-digit new or legacy (str001, str1, str_1, str10)
    const mNum = /^str_?(\d+)$/i.exec(trimmed);
    if (mNum) {
      return parseInt(mNum[1], 10);
    }

    return null;
  };

  // Helper to determine maximum existing strX index in schema or dialog rows
  const getMaxStrIndex = (
    schemaCols: string[],
    rows?: ExtractionRow[]
  ): number => {
    let maxIdx = 0;
    const checkName = (name: string) => {
      if (!name) return;
      const num = parseStrColIndex(name);
      if (num !== null && num > maxIdx) {
        maxIdx = num;
      }
    };

    schemaCols.forEach(checkName);
    if (rows) {
      rows.forEach((r) => {
        checkName(String(r.sourceKeyOrIdx));
        checkName(r.outputColName);
      });
    }
    return maxIdx;
  };

  // Universal Multi-Row Candidate Discovery Engine with strX Fallback
  useEffect(() => {
    if (mode !== "simple") return;

    const samplesToScan = sampleList.length > 0 ? sampleList : [sampleText];
    const candidates: ExtractionRow[] = [];
    const baseStrOffset = getMaxStrIndex(columns);

    if (formatType === "json") {
      const keyCount = new Map<string, number>();
      const keySampleVal = new Map<string, string>();
      samplesToScan.forEach((line) => {
        let b = line.trim();
        const firstBrace = b.indexOf("{");
        const sepIdx = headerSep ? b.indexOf(headerSep) : -1;
        if (hasHeader && sepIdx >= 0 && (firstBrace === -1 || sepIdx < firstBrace)) {
          b = b.split(headerSep).slice(1).join(headerSep).trim();
        }
        try {
          const parsed = JSON.parse(b);
          if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            Object.keys(parsed).forEach((k) => {
              keyCount.set(k, (keyCount.get(k) || 0) + 1);
              if (!keySampleVal.has(k)) {
                const rawVal = parsed[k];
                keySampleVal.set(k, typeof rawVal === "object" ? JSON.stringify(rawVal) : String(rawVal));
              }
            });
          }
        } catch { }
      });

      for (const [k, count] of keyCount.entries()) {
        const val = keySampleVal.get(k) || "";
        candidates.push({
          id: `json_${k}`,
          sourceKeyOrIdx: k,
          outputColName: k,
          sampleVal: val,
          colType: inferType(val),
          fillRate: Math.round((count / samplesToScan.length) * 100),
          enabled: true,
        });
      }
    } else if (formatType === "arr" || formatType === "json_array") {
      let maxLen = 0;
      const idxSample = new Map<number, string>();
      samplesToScan.forEach((line) => {
        let b = line.trim();
        const firstBracket = b.indexOf("[");
        const sepIdx = headerSep ? b.indexOf(headerSep) : -1;
        if (hasHeader && sepIdx >= 0 && (firstBracket === -1 || sepIdx < firstBracket)) {
          b = b.split(headerSep).slice(1).join(headerSep).trim();
        }
        try {
          const parsed = JSON.parse(b);
          if (Array.isArray(parsed)) {
            if (parsed.length > maxLen) maxLen = parsed.length;
            parsed.forEach((item, idx) => {
              if (!idxSample.has(idx)) {
                idxSample.set(idx, typeof item === "object" ? JSON.stringify(item) : String(item));
              }
            });
          }
        } catch { }
      });

      for (let idx = 0; idx < Math.max(1, maxLen); idx++) {
        const val = idxSample.get(idx) || "";
        candidates.push({
          id: `arr_${idx}`,
          sourceKeyOrIdx: idx,
          outputColName: `item_${idx}`,
          sampleVal: val,
          colType: inferType(val),
          fillRate: 100,
          enabled: true,
        });
      }
    } else if (formatType === "kv" || (formatType === "raw" && kvAssign && kvAssign.trim().length > 0)) {
      const assignChar = kvAssign ? kvAssign.trim() : (formatType === "kv" ? "=" : "");
      const delimChar = delimiter !== undefined ? delimiter : " ";
      const escapedAssign = assignChar ? assignChar.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&") : "";
      const escapedDelim = delimChar === " " || !delimChar ? "\\s" : delimChar.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      const qO = (quoteOpen || '"').replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      const qC = (quoteClose || '"').replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

      const keyCount = new Map<string, number>();
      const keySampleVal = new Map<string, string>();
      const unkeyedCount = new Map<number, number>();
      const unkeyedSampleVal = new Map<number, string>();
      let maxUnkeyed = 0;

      samplesToScan.forEach((line) => {
        let b = line.trim();
        if (hasHeader && headerSep && b.includes(headerSep)) {
          b = b.split(headerSep).slice(1).join(headerSep).trim();
        }

        // 1. Key-Value Extraction across row
        if (escapedAssign) {
          const kvRegex = new RegExp(`(?:^|[\\s${escapedDelim},;|])([a-zA-Z0-9_\\-\\.]+)\\s*${escapedAssign}\\s*(?:${qO}([^${qC}]*)${qC}|([^\\s${escapedDelim},;\\r\\n|&]+))`, "g");
          let match: RegExpExecArray | null;
          const seenInRow = new Set<string>();
          while ((match = kvRegex.exec(b)) !== null) {
            const k = match[1];
            if (!seenInRow.has(k)) {
              seenInRow.add(k);
              keyCount.set(k, (keyCount.get(k) || 0) + 1);
              if (!keySampleVal.has(k)) {
                const val = (match[2] !== undefined ? match[2] : match[3] || "").trim();
                keySampleVal.set(k, val);
              }
            }
          }
        }

        // 2. Unkeyed / Unrecognized Token Extraction across row (Rule: strX fallback!)
        const splitTokens = delimChar && delimChar.trim()
          ? b.split(delimChar).map((t) => t.trim()).filter(Boolean)
          : b.split(/\s+/).map((t) => t.trim()).filter(Boolean);

        let rowUnkeyedIdx = 0;
        splitTokens.forEach((tok) => {
          if (!assignChar || !tok.includes(assignChar)) {
            rowUnkeyedIdx++;
            unkeyedCount.set(rowUnkeyedIdx, (unkeyedCount.get(rowUnkeyedIdx) || 0) + 1);
            if (!unkeyedSampleVal.has(rowUnkeyedIdx)) {
              unkeyedSampleVal.set(rowUnkeyedIdx, tok);
            }
          }
        });
        if (rowUnkeyedIdx > maxUnkeyed) maxUnkeyed = rowUnkeyedIdx;
      });

      // Add discovered Key=Value candidates
      const discoveredKeysList: ExtractionRow[] = [];
      for (const [k, count] of keyCount.entries()) {
        const val = keySampleVal.get(k) || "";
        discoveredKeysList.push({
          id: `kv_${k}`,
          sourceKeyOrIdx: k,
          outputColName: k,
          sampleVal: val,
          colType: inferType(val),
          fillRate: Math.round((count / samplesToScan.length) * 100),
          enabled: true,
        });
      }
      // Sort keyed candidates by fillRate descending
      discoveredKeysList.sort((a, b) => b.fillRate - a.fillRate);
      candidates.push(...discoveredKeysList);

      // Add unkeyed candidates (str001, str002, ...) - strictly complying with user requirement (auto-increment sequentially)
      for (let i = 1; i <= maxUnkeyed; i++) {
        const val = unkeyedSampleVal.get(i) || "";
        const count = unkeyedCount.get(i) || 0;
        const colIdx = baseStrOffset + i;
        const colName = formatStrColName(colIdx);
        candidates.push({
          id: `unkeyed_${colName}`,
          sourceKeyOrIdx: colName,
          outputColName: colName,
          sampleVal: val,
          colType: inferType(val),
          fillRate: Math.round((count / samplesToScan.length) * 100),
          enabled: true,
          tokenIndex: i,
        });
      }

      // Fallback preset if nothing found
      if (candidates.length === 0) {
        const colIdx = baseStrOffset + 1;
        const colName = formatStrColName(colIdx);
        candidates.push(
          { id: `str_${colName}`, sourceKeyOrIdx: colName, outputColName: colName, sampleVal: "sample_val", colType: "VARCHAR", fillRate: 100, enabled: true, tokenIndex: 1 }
        );
      }
    } else {
      // Delimited (CSV, Space, or Raw Delimited) -> str001, str002, str003... or Header names from Row 1
      let maxParts = 0;
      const partSample = new Map<number, string>();
      const partCount = new Map<number, number>();
      const delimChar = delimiter !== undefined ? delimiter : " ";
      const isCustomDelim = delimChar && delimChar !== " " && delimChar !== "\t";

      // Detect if row 1 is header for CSV
      let headerColNames: string[] = [];
      const useFirstRowHeader = formatType === "csv" && firstRowIsHeader && samplesToScan.length > 0;
      if (useFirstRowHeader) {
        let firstLine = samplesToScan[0].trim();
        if (hasHeader && headerSep && firstLine.includes(headerSep)) {
          firstLine = firstLine.split(headerSep).slice(1).join(headerSep).trim();
        }
        headerColNames = firstLine.split(",").map((p) => p.trim().replace(/^["']|["']$/g, ""));
      }

      const rowsToScanForData = useFirstRowHeader && samplesToScan.length > 1
        ? samplesToScan.slice(1)
        : samplesToScan;

      rowsToScanForData.forEach((line) => {
        let b = line.trim();
        if (hasHeader && headerSep && b.includes(headerSep)) {
          b = b.split(headerSep).slice(1).join(headerSep).trim();
        }

        const lineMatches = isCustomDelim ? b.includes(delimChar) : true;
        if (lineMatches) {
          let parts: string[];
          if (formatType === "csv") {
            parts = b.split(",").map((p) => p.trim());
          } else if (delimChar === " " || !delimChar) {
            parts = b.split(/\s+/).map((p) => p.trim()).filter(Boolean);
          } else {
            parts = b.split(delimChar).map((p) => p.trim());
          }
          if (parts.length > maxParts) maxParts = parts.length;
          parts.forEach((p, idx) => {
            const partIdx = idx + 1;
            partCount.set(partIdx, (partCount.get(partIdx) || 0) + 1);
            if (!partSample.has(partIdx) && p.length > 0) {
              partSample.set(partIdx, p);
            }
          });
        }
      });

      const totalCols = useFirstRowHeader ? Math.max(headerColNames.length, maxParts) : Math.max(1, maxParts);
      for (let i = 1; i <= Math.max(1, totalCols); i++) {
        const val = partSample.get(i) || "";
        const count = partCount.get(i) || 0;
        const colIdx = baseStrOffset + i;
        const fallbackColName = formatStrColName(colIdx);
        const finalColName = (useFirstRowHeader && headerColNames[i - 1]) ? headerColNames[i - 1] : fallbackColName;
        candidates.push({
          id: `delim_${finalColName}`,
          sourceKeyOrIdx: finalColName,
          outputColName: finalColName,
          sampleVal: val,
          colType: inferType(val),
          fillRate: samplesToScan.length > 0 ? Math.round((count / samplesToScan.length) * 100) : 0,
          enabled: true,
          tokenIndex: i,
        });
      }
    }

    // Preserve edited custom names & types, and user-added custom rows
    setSimpleRows((prevRows) => {
      const prevMap = new Map(prevRows.map((r) => [String(r.sourceKeyOrIdx), r]));
      const updatedCandidates = candidates.map((c) => {
        const existing = prevMap.get(String(c.sourceKeyOrIdx));
        if (existing) {
          const isStaleDefault = existing.outputColName.startsWith("str00") && !c.outputColName.startsWith("str00");
          return {
            ...c,
            outputColName: (isStaleDefault ? c.outputColName : existing.outputColName) || c.outputColName,
            colType: existing.colType || c.colType,
            enabled: existing.enabled,
          };
        }
        return c;
      });

      // Preserve any custom rows added by user (e.g. via handleAddColumn)
      const candidateKeys = new Set(candidates.map((c) => String(c.sourceKeyOrIdx)));
      const customRows = prevRows.filter(
        (r) => r.id.startsWith("custom_") && !candidateKeys.has(String(r.sourceKeyOrIdx))
      );

      return [...updatedCandidates, ...customRows];
    });
  }, [mode, sampleText, sampleList, formatType, hasHeader, headerSep, delimiter, kvAssign, quoteOpen, quoteClose, columns, firstRowIsHeader]);

  // Advanced Mode Regex Evaluation
  const advEval = useMemo(() => {
    if (!regexPattern.trim()) {
      return { isValid: false, error: null, numGroups: 0, matched: false };
    }
    try {
      const rx = new RegExp(regexPattern);
      const match = rx.exec(sampleText);
      const dummyMatch = new RegExp(regexPattern + "|").exec("");
      const captureGroupCount = dummyMatch ? dummyMatch.length - 1 : 0;

      return {
        isValid: true,
        error: null,
        numGroups: captureGroupCount > 0 ? captureGroupCount : 1,
        captureGroupCount,
        match,
        matched: !!match,
      };
    } catch (err: any) {
      return {
        isValid: false,
        error: err.message || "Invalid regular expression syntax",
        numGroups: 0,
        captureGroupCount: 0,
        match: null,
        matched: false,
      };
    }
  }, [regexPattern, sampleText]);

  // Update Advanced Mode rows
  useEffect(() => {
    if (mode !== "advanced") return;
    if (!advEval.isValid || advEval.numGroups <= 0) {
      setAdvRows([]);
      return;
    }

    const captureGroupCount = advEval.captureGroupCount || 0;
    const match = advEval.match;
    const newRows: ExtractionRow[] = [];

    if (captureGroupCount > 0) {
      for (let i = 1; i <= captureGroupCount; i++) {
        const val = match && match[i] !== undefined ? match[i] : "(no match)";
        newRows.push({
          id: `grp_${i}`,
          sourceKeyOrIdx: i,
          outputColName: `group_${i}`,
          sampleVal: val,
          colType: inferType(val),
          fillRate: 100,
          enabled: true,
        });
      }
    } else {
      const val = match && match[0] !== undefined ? match[0] : "(no match)";
      newRows.push({
        id: "grp_0",
        sourceKeyOrIdx: 0,
        outputColName: "full_match",
        sampleVal: val,
        colType: inferType(val),
        fillRate: 100,
        enabled: true,
      });
    }

    setAdvRows((prevRows) => {
      const prevMap = new Map(prevRows.map((r) => [String(r.sourceKeyOrIdx), r]));
      return newRows.map((nr) => {
        const existing = prevMap.get(String(nr.sourceKeyOrIdx));
        if (existing) {
          return {
            ...nr,
            outputColName: existing.outputColName || nr.outputColName,
            colType: existing.colType || nr.colType,
            enabled: existing.enabled,
          };
        }
        return nr;
      });
    });
  }, [mode, advEval]);

  // Live DuckDB SQL Preview Statement Generation
  const liveSqlPreview = useMemo(() => {
    const targetCol = hasHeader ? "_body" : `"${selectedCol || "Message"}"`;
    const headerWithClause = hasHeader
      ? `WITH split_log AS (\n  SELECT *,\n    split_part("${selectedCol || "Message"}", '${headerSep}', 1) AS "${headerColName}",\n    substr("${selectedCol || "Message"}", length(split_part("${selectedCol || "Message"}", '${headerSep}', 1)) + ${headerSep.length + 1}) AS _body\n  FROM "source_table"\n)\n`
      : "";
    const fromSource = hasHeader ? "FROM split_log;" : 'FROM "source_table";';
    const headerSelect = hasHeader ? `  "${headerColName}",\n` : "";

    const activeItems = simpleRows.filter((r) => r.enabled && r.outputColName.trim().length > 0);

    if (activeItems.length === 0) {
      const selectCols = hasHeader ? `  "${headerColName}",\n  _body AS "payload"` : "  *";
      return `-- DuckDB Passthrough (No column extraction)\nCREATE VIEW "table_extracted" AS\n${headerWithClause}SELECT\n${selectCols}\n${fromSource}`;
    }

    if (formatType === "kv" || (formatType === "raw" && kvAssign && kvAssign.trim().length > 0)) {
      const delimDesc = delimiter === " " ? "Space" : `'${delimiter}'`;
      const colGroups = new Map<string, { mappings: ExtractionRow[]; type: string }>();
      for (const m of activeItems) {
        const outName = m.outputColName.trim();
        if (!colGroups.has(outName)) {
          colGroups.set(outName, { mappings: [], type: m.colType || "VARCHAR" });
        }
        colGroups.get(outName)!.mappings.push(m);
      }

      const colClauses: string[] = [];
      for (const [outColName, group] of colGroups.entries()) {
        const exprList: string[] = [];
        for (const m of group.mappings) {
          const keyOrIdx = String(m.sourceKeyOrIdx);
          if (m.tokenIndex !== undefined || /^str_?\d+$/i.test(keyOrIdx)) {
            const idx = m.tokenIndex !== undefined ? m.tokenIndex : (Number(keyOrIdx.replace(/^str_?/i, "")) || 1);
            if (kvAssign && kvAssign.trim()) {
              exprList.push(`TRIM(list_extract(list_filter(str_split(${targetCol}, '${delimiter}'), x -> trim(x) NOT LIKE '%${kvAssign}%'), ${idx}))`);
            } else {
              exprList.push(`TRIM(split_part(${targetCol}, '${delimiter}', ${idx}))`);
            }
          } else {
            const escapedKey = keyOrIdx.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
            const escapedAssign = (kvAssign || "=").replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
            const escapedDelim = delimiter === " " ? "\\s" : delimiter.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
            const qO = (quoteOpen || '"').replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
            const qC = (quoteClose || '"').replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
            const pattern = `(?:^|[\\s${escapedDelim},;|])${escapedKey}\\s*${escapedAssign}\\s*(?:${qO}([^${qC}]*)${qC}|([^\\s${escapedDelim},;\\r\\n|]+))`;
            const sqlPattern = pattern.replace(/'/g, "''");
            exprList.push(`COALESCE(NULLIF(regexp_extract(${targetCol}, '${sqlPattern}', 1), ''), regexp_extract(${targetCol}, '${sqlPattern}', 2))`);
          }
        }

        let combinedExpr = exprList.length === 1 ? exprList[0] : `COALESCE(${exprList.map((e) => `NULLIF(${e}, '')`).join(", ")})`;
        if (group.type && group.type !== "VARCHAR") {
          combinedExpr = `TRY_CAST(${combinedExpr} AS ${group.type})`;
        }
        colClauses.push(`  ${combinedExpr} AS "${outColName}"`);
      }

      const allExtractedNullCond = Array.from(colGroups.keys())
        .map((c) => `"${c}" IS NULL`)
        .join(" AND ");
      const unmatchedCol = `unmatched_${selectedCol || "source"}`;
      colClauses.push(`  CASE WHEN (${allExtractedNullCond}) THEN ${targetCol} ELSE NULL END AS "${unmatchedCol}"  -- Auto-pruned if 100% clean`);

      const allColumns = (headerSelect + colClauses.join(",\n")).trim();
      return `-- Fast DuckDB Universal Parser (Delimiter: ${delimDesc}, Equal: '${kvAssign}')\nCREATE VIEW "table_extracted" AS\n${headerWithClause}SELECT *,\n  ${allColumns || "-- No fields selected"}\n${fromSource}`;
    }

    if (formatType === "json") {
      const colClauses = activeItems.map((item) => {
        const expr = `json_extract_string(${targetCol}, '$.${item.sourceKeyOrIdx}')`;
        if (item.colType !== "VARCHAR") {
          return `  TRY_CAST(${expr} AS ${item.colType}) AS "${item.outputColName}"`;
        }
        return `  ${expr} AS "${item.outputColName}"`;
      });
      const allColumns = (headerSelect + colClauses.join(",\n")).trim();
      return `-- Fast Native DuckDB JSON Parser\nCREATE VIEW "table_extracted" AS\n${headerWithClause}SELECT *,\n  ${allColumns || "-- No fields selected"}\n${fromSource}`;
    }

    if (formatType === "arr") {
      const colClauses = activeItems.map((item) => {
        const expr = `json_extract_string(${targetCol}, '$[${item.sourceKeyOrIdx}]')`;
        if (item.colType !== "VARCHAR") {
          return `  TRY_CAST(${expr} AS ${item.colType}) AS "${item.outputColName}"`;
        }
        return `  ${expr} AS "${item.outputColName}"`;
      });
      const allColumns = (headerSelect + colClauses.join(",\n")).trim();
      return `CREATE VIEW "table_extracted" AS\n${headerWithClause}SELECT *,\n  ${allColumns || "-- No fields selected"}\n${fromSource}`;
    }

    // Delimited or CSV
    const colClauses = activeItems.map((item) => {
      const idx = item.tokenIndex !== undefined ? item.tokenIndex : (Number(String(item.sourceKeyOrIdx).replace(/^str_?/i, "")) || 1);
      let expr: string;
      if (formatType === "csv") {
        const regexDelim = (delimiter || ",").replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
        const repCount = idx - 1;
        const pattern = `^(?:(?:"[^"]*"|[^${regexDelim}]*)${regexDelim}){${repCount}}(?:"([^"]*)"|([^${regexDelim}]*))`;
        const sqlPattern = pattern.replace(/'/g, "''");
        expr = `CASE WHEN contains(${targetCol}, ',') THEN TRIM(COALESCE(NULLIF(regexp_extract(${targetCol}, '${sqlPattern}', 1), ''), regexp_extract(${targetCol}, '${sqlPattern}', 2))) ELSE NULL END`;
      } else if (delimiter === " " || !delimiter) {
        expr = `CASE WHEN contains(${targetCol}, ' ') THEN TRIM(split_part(regexp_replace(${targetCol}, '\\s+', ' ', 'g'), ' ', ${idx})) ELSE NULL END`;
      } else {
        const sqlDelim = delimiter.replace(/'/g, "''");
        expr = `CASE WHEN contains(${targetCol}, '${sqlDelim}') THEN TRIM(split_part(${targetCol}, '${sqlDelim}', ${idx})) ELSE NULL END`;
      }
      if (item.colType !== "VARCHAR") {
        return `  TRY_CAST(${expr} AS ${item.colType}) AS "${item.outputColName}"`;
      }
      return `  ${expr} AS "${item.outputColName}"`;
    });

    const allExtractedNullCond = activeItems
      .map((item) => `"${item.outputColName.trim()}" IS NULL`)
      .join(" AND ");
    const unmatchedCol = `unmatched_${selectedCol || "source"}`;
    colClauses.push(`  CASE WHEN (${allExtractedNullCond}) THEN ${targetCol} ELSE NULL END AS "${unmatchedCol}"  -- Auto-pruned if 100% clean`);

    const allColumns = (headerSelect + colClauses.join(",\n")).trim();
    let whereFilter = "";
    if (formatType === "csv" && firstRowIsHeader && sampleList && sampleList.length > 0) {
      const headerPreview = sampleList[0].slice(0, 40).replace(/'/g, "''");
      whereFilter = `\nWHERE "${selectedCol}" NOT LIKE '${headerPreview}%'`;
    }
    return `CREATE VIEW "table_extracted" AS\n${headerWithClause}SELECT *,\n  ${allColumns || "-- No fields selected"}\n${fromSource}${whereFilter}`;
  }, [selectedCol, formatType, hasHeader, headerSep, headerColName, simpleRows, delimiter, kvAssign, quoteOpen, quoteClose, firstRowIsHeader, sampleList]);

  // Filtered & Sorted Rows
  const displayedRows = useMemo(() => {
    let rows = mode === "simple" ? simpleRows : advRows;
    if (searchQuery.trim()) {
      const term = searchQuery.toLowerCase().trim();
      rows = rows.filter(
        (r) =>
          String(r.sourceKeyOrIdx).toLowerCase().includes(term) ||
          r.outputColName.toLowerCase().includes(term) ||
          r.sampleVal.toLowerCase().includes(term) ||
          r.colType.toLowerCase().includes(term)
      );
    }
    if (sortKey) {
      rows = [...rows].sort((a, b) => {
        let valA: any = "";
        let valB: any = "";
        if (sortKey === "name") {
          valA = String(a.sourceKeyOrIdx).toLowerCase();
          valB = String(b.sourceKeyOrIdx).toLowerCase();
        } else if (sortKey === "type") {
          valA = a.colType;
          valB = b.colType;
        } else if (sortKey === "fill") {
          valA = a.fillRate;
          valB = b.fillRate;
          return sortAsc ? valA - valB : valB - valA;
        } else if (sortKey === "val") {
          valA = a.sampleVal.toLowerCase();
          valB = b.sampleVal.toLowerCase();
        } else if (sortKey === "col") {
          valA = a.outputColName.toLowerCase();
          valB = b.outputColName.toLowerCase();
        }
        if (valA < valB) return sortAsc ? -1 : 1;
        if (valA > valB) return sortAsc ? 1 : -1;
        return 0;
      });
    }
    return rows;
  }, [mode, simpleRows, advRows, searchQuery, sortKey, sortAsc]);

  const handleSort = (key: "name" | "type" | "fill" | "val" | "col") => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === "fill" ? false : true);
    }
  };

  const handleClose = () => {
    if (!isApplying) {
      actions.setRegexDialogOpen(false, stateRef);
      setApplyError(null);
    }
  };

  const handleApply = async () => {
    setIsApplying(true);
    setApplyError(null);
    try {
      if (mode === "simple") {
        const activeMappings: ExtractionFieldMapping[] = simpleRows
          .filter((r) => r.enabled && r.outputColName.trim().length > 0)
          .map((r) => ({
            sourceKeyOrIdx: r.sourceKeyOrIdx,
            outputColName: r.outputColName.trim(),
            colType: r.colType,
            enabled: true,
            tokenIndex: r.tokenIndex,
          }));

        if (formatType !== "raw" && activeMappings.length === 0) {
          throw new Error("Please select at least one column to extract!");
        }

        await actions.applyColumnExtraction(
          {
            mode: "simple",
            targetCol: selectedCol,
            formatType,
            hasHeader,
            headerSep,
            headerColName,
            delimiter,
            kvAssign,
            quoteOpen,
            quoteClose,
            fieldMappings: activeMappings,
          },
          stateRef
        );
      } else {
        // Advanced mode
        const activeMappings: ExtractionFieldMapping[] = advRows
          .filter((r) => r.enabled && r.outputColName.trim().length > 0)
          .map((r) => ({
            sourceKeyOrIdx: r.sourceKeyOrIdx,
            outputColName: r.outputColName.trim(),
            colType: r.colType,
            enabled: true,
          }));

        if (activeMappings.length === 0) {
          throw new Error("Please select at least one Capture Group!");
        }

        await actions.applyColumnExtraction(
          {
            mode: "advanced",
            targetCol: selectedCol,
            regexPattern,
            fieldMappings: activeMappings,
          },
          stateRef
        );
      }
    } catch (err: any) {
      console.error("Error applying column extraction:", err);
      setApplyError(err.message || "DuckDB execution error");
    } finally {
      setIsApplying(false);
    }
  };

  const handleStartRename = (row: ExtractionRow) => {
    setEditingRowId(row.id);
    setInlineEditVal(row.outputColName);
  };

  const handleFinishRename = (rowId: string) => {
    if (inlineEditVal.trim()) {
      setSimpleRows((rows) =>
        rows.map((r) => (r.id === rowId ? { ...r, outputColName: inlineEditVal.trim() } : r))
      );
    }
    setEditingRowId(null);
  };

  const handleAddColumn = () => {
    const nextColIdx = getMaxStrIndex(columns, simpleRows) + 1;
    let maxToken = 0;
    simpleRows.forEach((r) => {
      if (r.tokenIndex !== undefined && r.tokenIndex > maxToken) {
        maxToken = r.tokenIndex;
      }
    });
    const nextTokenIdx = maxToken > 0 ? maxToken + 1 : simpleRows.length + 1;
    const colName = formatStrColName(nextColIdx);
    setSimpleRows([
      ...simpleRows,
      {
        id: `custom_${colName}`,
        sourceKeyOrIdx: colName,
        outputColName: colName,
        sampleVal: "",
        colType: "VARCHAR",
        fillRate: 100,
        enabled: true,
        tokenIndex: nextTokenIdx,
      },
    ]);
  };

  const handleDeleteRow = (id: string) => {
    setSimpleRows((rows) => rows.filter((r) => r.id !== id));
  };

  const handleCopySql = () => {
    if (liveSqlPreview) {
      navigator.clipboard.writeText(liveSqlPreview).then(() => {
        setCopiedSql(true);
        setTimeout(() => setCopiedSql(false), 1200);
      });
    }
  };

  const handleCopySample = () => {
    if (sampleText) {
      navigator.clipboard.writeText(sampleText).then(() => {
        setCopiedSample(true);
        setTimeout(() => setCopiedSample(false), 1200);
      });
    }
  };

  const evaluateLineMatch = (
    text: string,
    targetMode: "simple" | "advanced",
    fmt: ExtractionFormatType,
    delim: string,
    assign: string,
    withHeader: boolean,
    sep: string,
    rxPattern: string
  ): boolean => {
    if (!text || text.trim() === "") return false;
    let body = text.trim();

    // 1. Header prefix evaluation
    if (withHeader && sep) {
      if (!body.includes(sep)) return false;
      const parts = body.split(sep);
      body = parts.slice(1).join(sep).trim();
      if (!body) return false;
    }

    // 2. Mode Evaluation
    if (targetMode === "advanced") {
      try {
        return new RegExp(rxPattern).test(body);
      } catch {
        return false;
      }
    }

    // Simple Mode Evaluation
    switch (fmt) {
      case "json":
        if (!body.startsWith("{") || !body.endsWith("}")) return false;
        try {
          JSON.parse(body);
          return true;
        } catch {
          return false;
        }
      case "arr":
        if (!body.startsWith("[") || !body.endsWith("]")) return false;
        try {
          JSON.parse(body);
          return true;
        } catch {
          return false;
        }
      case "csv":
        return body.includes(",") || body.includes('","');
      case "space":
        return body.split(/\s+/).length >= 2;
      case "kv":
        // Must contain assignment operator (: or =) AND delimiter
        if (!body.includes(assign)) return false;
        if (delim && delim !== " ") {
          return body.includes(delim);
        }
        return true;
      case "raw":
      default:
        return delim ? body.includes(delim) : true;
    }
  };

  const handleCopyUnmatched = () => {
    if (realUnmatchedLines.length === 0) return;
    const text = realUnmatchedLines.map((u) => `Row #${u.rowIdx}: ${u.line}`).join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopiedUnmatched(true);
      setTimeout(() => setCopiedUnmatched(false), 1200);
    });
  };

  const handleRunBatchTest = () => {
    if (!selectedCol) return;
    setIsValidating(true);

    setTimeout(() => {
      const t0 = performance.now();
      const rawData = viewState?.dataView?.rawData || [];
      const linesToTest: { rowIdx: number; val: string }[] = [];

      if (rawData && rawData.length > 0) {
        const limit = Math.min(1000, rawData.length);
        for (let i = 0; i < limit; i++) {
          const v = rawData[i]?.[selectedCol];
          linesToTest.push({
            rowIdx: i + 1,
            val: v !== null && v !== undefined ? String(v) : "",
          });
        }
      } else if (sampleList && sampleList.length > 0) {
        sampleList.forEach((s, idx) => {
          linesToTest.push({ rowIdx: idx + 1, val: s });
        });
      } else if (sampleText) {
        linesToTest.push({ rowIdx: 1, val: sampleText });
      }

      const total = linesToTest.length;
      let matched = 0;
      const unmatchedList: { rowIdx: number; line: string }[] = [];

      linesToTest.forEach((item) => {
        const isMatch = evaluateLineMatch(
          item.val,
          mode,
          formatType,
          delimiter,
          kvAssign,
          hasHeader,
          headerSep,
          regexPattern
        );
        if (isMatch) {
          matched++;
        } else {
          if (unmatchedList.length < 20) {
            unmatchedList.push({
              rowIdx: item.rowIdx,
              line: item.val ? item.val.slice(0, 200) : "(empty / null)",
            });
          }
        }
      });

      const elapsed = Math.max(0.8, performance.now() - t0).toFixed(1);
      const unmatched = total - matched;
      const pct = total > 0 ? (matched / total) * 100 : 100;

      setRealTotalRows(total);
      setRealMatchedCount(matched);
      setRealUnmatchedCount(unmatched);
      setRealMatchPct(pct);
      setRealElapsedMs(elapsed);
      setRealUnmatchedLines(unmatchedList);
      setHasTested(true);
      setIsValidating(false);
    }, 50);
  };

  const colOptions = columns.map((colName) => ({
    label: colName,
    value: colName,
  }));

  const enabledCount =
    mode === "simple"
      ? (formatType === "raw" ? (simpleRows.filter((r) => r.enabled).length || 1) : simpleRows.filter((r) => r.enabled).length)
      : advRows.filter((r) => r.enabled).length;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      style={{
        width: mode === "simple" ? "680px" : "820px",
        maxWidth: "95vw",
        backgroundColor: "var(--md-sys-color-surface-container-high, #ffffff)",
        color: "var(--md-sys-color-on-surface, #182026)",
        borderRadius: "12px",
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.24)",
        border: "1px solid var(--md-sys-color-outline-variant, #e2e8f0)",
      }}
      title={
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", paddingRight: "4px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
            <ParseSplitIcon size={16} color="var(--md-sys-color-primary, #0284c7)" />
            <h4 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "var(--md-sys-color-on-surface, #0f172a)", letterSpacing: "-0.2px" }}>
              Parse Columns
            </h4>
            <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--md-sys-color-primary, #0369a1)", background: "rgba(138, 180, 248, 0.12)", border: "1px solid rgba(138, 180, 248, 0.28)", padding: "1px 6px", borderRadius: "10px" }}>
              v2.5.0.3
            </span>
          </div>
          {/* Linear-style Capsule Segmented Switch */}
          <div style={{ display: "inline-flex", alignItems: "center", background: "var(--md-sys-color-surface-container, #f1f5f9)", border: "1px solid var(--md-sys-color-outline-variant, #e2e8f0)", borderRadius: "6px", padding: "2px", gap: "2px" }}>
            <button
              type="button"
              id="ntab-simple"
              onClick={() => setMode("simple")}
              title="Visual Mode (Default: Universal visual parsing without regex)"
              style={{
                background: mode === "simple" ? "var(--md-sys-color-surface, #ffffff)" : "transparent",
                border: "none",
                color: mode === "simple" ? "var(--md-sys-color-primary, #0f172a)" : "var(--md-sys-color-on-surface-variant, #64748b)",
                boxShadow: mode === "simple" ? "0 1px 2px rgba(0, 0, 0, 0.08)" : "none",
                padding: "3px 10px",
                borderRadius: "4px",
                fontSize: "11px",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                transition: "all 120ms ease",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill={mode === "simple" ? "var(--md-sys-color-primary, #0284c7)" : "currentColor"}>
                <path d="M8.5 1.5L2 9h5l-1.5 5.5L14 7H9l.5-5.5z" />
              </svg>
              <span>Visual</span>
            </button>
            <button
              type="button"
              id="ntab-adv"
              onClick={() => setMode("advanced")}
              title="Custom Regex Mode (Regular Expression capture groups)"
              style={{
                background: mode === "advanced" ? "var(--md-sys-color-surface, #ffffff)" : "transparent",
                border: "none",
                color: mode === "advanced" ? "var(--md-sys-color-primary, #0f172a)" : "var(--md-sys-color-on-surface-variant, #64748b)",
                boxShadow: mode === "advanced" ? "0 1px 2px rgba(0, 0, 0, 0.08)" : "none",
                padding: "3px 10px",
                borderRadius: "4px",
                fontSize: "11px",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                transition: "all 120ms ease",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill={mode === "advanced" ? "#0284c7" : "currentColor"}>
                <path fillRule="evenodd" clipRule="evenodd" d="M12.9 1.1a3.5 3.5 0 0 0-4.6 4.3L2.4 11.3a1.5 1.5 0 0 0 0 2.1l.2.2a1.5 1.5 0 0 0 2.1 0l5.9-5.9a3.5 3.5 0 0 0 4.3-4.6l-2.4 2.4-1.4-1.4 2.4-2.4a3.48 3.48 0 0 0-1.6-.6z" />
              </svg>
              <span>Regex</span>
            </button>
          </div>
        </div>
      }
    >
      <div className={Classes.DIALOG_BODY} style={{ padding: "16px 20px" }}>
        {applyError && (
          <Callout intent={Intent.DANGER} style={{ marginBottom: "10px" }}>
            {applyError}
          </Callout>
        )}

        {mode === "advanced" && (
          <div style={{ display: "flex", gap: "8px", alignItems: "flex-end", marginBottom: "8px" }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 600, color: "var(--md-sys-color-on-surface, #182026)", marginBottom: "4px" }}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="var(--md-sys-color-on-surface-variant, #5c7080)">
                  <path d="M8 0C3.6 0 0 .9 0 2v12c0 1.1 3.6 2 8 2s8-.9 8-2V2c0-1.1-3.6-2-8-2zm6 12c0 .4-2.2 1-6 1s-6-.6-6-1V9.7c1.6.8 3.7 1.3 6 1.3s4.4-.5 6-1.3V12zm0-4c0 .4-2.2 1-6 1s-6-.6-6-1V5.7c1.6.8 3.7 1.3 6 1.3s4.4-.5 6-1.3V8zm0-4.3c-1.6.8-3.7 1.3-6 1.3s-4.4-.5-6-1.3V2c0-.4 2.2-1 6-1s6 .6 6 1v1.7z" />
                </svg>
                <span>Source Column:</span>
              </label>
              <HTMLSelect
                fill={true}
                value={selectedCol}
                onChange={(e) => setSelectedCol(e.target.value)}
                options={colOptions}
              />
            </div>
            <button
              type="button"
              className="bp4-button bp4-minimal"
              title="Reload Sample Pool"
              onClick={() => {
                const samples = fetchSampleEvents(selectedCol, 50);
                const listToUse = samples.length > 0 ? samples : [sampleText];
                setSampleList(listToUse);
                setSampleIdx(0);
                setSampleText(listToUse[0]);
                detectAndSelectFormat(listToUse[0]);
              }}
              style={{
                padding: "6px 9px",
                height: "30px",
                width: "30px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid var(--md-sys-color-outline-variant, #c5d0d8)",
                borderRadius: "3px",
                background: "var(--md-sys-color-surface-container, #ffffff)",
                color: "var(--md-sys-color-on-surface-variant, #5c7080)",
                cursor: "pointer",
              }}
              aria-label="Reload Sample"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                <path fillRule="evenodd" clipRule="evenodd" d="M12.83 8a4.83 4.83 0 1 1-1.42-3.42l-1.41 1.42H14V2l-1.58 1.58A6.83 6.83 0 1 0 14.83 8h-2z" />
              </svg>
            </button>
          </div>

        )}

        {/* MINIMALIST NATURAL LANGUAGE BAR (Visual Mode) */}
        {mode === "simple" && (
          <div
            id="minimalTopBar"
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
              paddingBottom: "10px",
              marginBottom: "10px",
              borderBottom: "1px solid var(--md-sys-color-outline-variant, #f1f5f9)",
              fontSize: "12px",
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", color: "var(--md-sys-color-on-surface-variant, #64748b)" }}>
              <span>Extract from</span>
              <select
                id="minSourceSelect"
                value={selectedCol}
                onChange={(e) => setSelectedCol(e.target.value)}
                style={{
                  backgroundColor: "var(--md-sys-color-surface-container, #f1f5f9)",
                  border: "1px solid var(--md-sys-color-outline-variant, #cbd5e1)",
                  borderRadius: "4px",
                  padding: "2px 8px",
                  fontWeight: 600,
                  color: "var(--md-sys-color-on-surface, #0f172a)",
                  cursor: "pointer",
                  outline: "none",
                }}
              >
                {columns.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <span>using</span>
              <select
                id="minFormatSelect"
                value={formatType}
                onChange={(e) => {
                  const newFmt = e.target.value as ExtractionFormatType;
                  setFormatType(newFmt);
                  if (newFmt !== "kv") {
                    setKvAssign("");
                  } else if (!kvAssign) {
                    setKvAssign("=");
                  }
                }}
                style={{
                  backgroundColor: "var(--md-sys-color-surface-container, #f1f5f9)",
                  border: "1px solid var(--md-sys-color-outline-variant, #cbd5e1)",
                  borderRadius: "4px",
                  padding: "2px 8px",
                  fontWeight: 600,
                  color: "var(--md-sys-color-on-surface, #0f172a)",
                  cursor: "pointer",
                  outline: "none",
                }}
              >
                <option value="kv">Key=Value</option>
                <option value="json">JSON</option>
                <option value="space">Delimited</option>
                <option value="raw">Raw</option>
                <option value="csv">CSV</option>
                <option value="arr">Array</option>
              </select>
              {(formatType === "kv" || formatType === "space" || formatType === "raw" || formatType === "csv") && (
                <>
                  <span>split by</span>
                  <input
                    type="text"
                    id="minDelimInput"
                    value={delimiter === " " ? "␣" : delimiter}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDelimiter(val === "␣" || val === " " ? " " : val);
                    }}
                    title={delimiter === " " ? "Token Delimiter: Space (␣)" : `Token Delimiter: '${delimiter}'`}
                    style={{
                      width: "28px",
                      height: "24px",
                      textAlign: "center",
                      backgroundColor: "var(--md-sys-color-surface-container, #f1f5f9)",
                      border: "1px solid var(--md-sys-color-outline-variant, #cbd5e1)",
                      borderRadius: "4px",
                      fontFamily: "JetBrains Mono, Consolas, monospace",
                      fontWeight: "bold",
                      color: "var(--md-sys-color-on-surface, #0f172a)",
                      outline: "none",
                    }}
                  />
                </>
              )}
              {formatType === "csv" && (
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    cursor: "pointer",
                    fontSize: "12px",
                    marginLeft: "8px",
                    userSelect: "none",
                  }}
                  title="First row contains column headers (e.g. EntryNumber, InUse, FileName)"
                >
                  <input
                    type="checkbox"
                    checked={firstRowIsHeader}
                    onChange={(e) => setFirstRowIsHeader(e.target.checked)}
                    style={{ cursor: "pointer", accentColor: "#0284c7" }}
                  />
                  <span>First row is header</span>
                </label>
              )}
              {formatType === "kv" && (
                <>
                  <span>and</span>
                  <input
                    type="text"
                    id="minAssignInput"
                    value={kvAssign}
                    onChange={(e) => setKvAssign(e.target.value)}
                    title="Key-Value Assign Operator"
                    style={{
                      width: "28px",
                      height: "24px",
                      textAlign: "center",
                      backgroundColor: "var(--md-sys-color-surface-container, #f1f5f9)",
                      border: "1px solid var(--md-sys-color-outline-variant, #cbd5e1)",
                      borderRadius: "4px",
                      fontFamily: "JetBrains Mono, Consolas, monospace",
                      fontWeight: "bold",
                      color: "var(--md-sys-color-on-surface, #0f172a)",
                      outline: "none",
                    }}
                  />
                </>
              )}
            </div>

            {/* Rules Popover for advanced quote / header rules */}
            <div style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setIsRulesOpen(!isRulesOpen)}
                title="Advanced Extraction Rules (Header prefix, quote pair)"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                  padding: "3px 8px",
                  borderRadius: "4px",
                  border: "1px solid var(--md-sys-color-outline-variant, #e2e8f0)",
                  backgroundColor: isRulesOpen ? "var(--md-sys-color-surface-container-high, #e2e8f0)" : "var(--md-sys-color-surface-container, #f8fafc)",
                  color: "var(--md-sys-color-on-surface-variant, #475569)",
                  fontSize: "11px",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
                  <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
                </svg>
                <span>Rules</span>
                <span style={{ width: "5px", height: "5px", borderRadius: "50%", backgroundColor: hasHeader ? "var(--md-sys-color-primary, #0284c7)" : "var(--md-sys-color-outline, #94a3b8)" }} />
              </button>

              {isRulesOpen && (
                <div
                  id="minimalRulesPopover"
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "calc(100% + 6px)",
                    width: "280px",
                    backgroundColor: "var(--md-sys-color-surface-container-high, #ffffff)",
                    borderRadius: "8px",
                    boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 0 0 1px var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.1))",
                    border: "1px solid var(--md-sys-color-outline-variant, #cbd5e1)",
                    padding: "12px",
                    zIndex: 50,
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                    fontSize: "12px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 600, color: "var(--md-sys-color-on-surface, #0f172a)" }}>
                    <span>Advanced Extraction Rules</span>
                    <button
                      type="button"
                      onClick={() => setIsRulesOpen(false)}
                      style={{ border: "none", background: "none", cursor: "pointer", color: "var(--md-sys-color-on-surface-variant, #94a3b8)", padding: "2px" }}
                    >
                      ✕
                    </button>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", color: "var(--md-sys-color-on-surface-variant, #475569)", cursor: "pointer" }}>
                    <span>Header Prefix</span>
                    <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
                  </label>
                  {hasHeader && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
                      <span style={{ color: "var(--md-sys-color-on-surface-variant, #64748b)", fontSize: "11px" }}>Separator:</span>
                      <input
                        type="text"
                        value={headerSep}
                        onChange={(e) => setHeaderSep(e.target.value)}
                        style={{ width: "45px", textAlign: "center", padding: "2px 4px", border: "1px solid var(--md-sys-color-outline-variant, #cbd5e1)", backgroundColor: "var(--md-sys-color-surface-container, #f8fafc)", color: "var(--md-sys-color-on-surface, #0f172a)", borderRadius: "3px", fontFamily: "monospace", fontSize: "11px" }}
                      />
                      <span style={{ color: "var(--md-sys-color-on-surface-variant, #64748b)", fontSize: "11px" }}>Column:</span>
                      <input
                        type="text"
                        value={headerColName}
                        onChange={(e) => setHeaderColName(e.target.value)}
                        style={{ width: "85px", padding: "2px 4px", border: "1px solid var(--md-sys-color-outline-variant, #cbd5e1)", backgroundColor: "var(--md-sys-color-surface-container, #f8fafc)", color: "var(--md-sys-color-on-surface, #0f172a)", borderRadius: "3px", fontFamily: "monospace", fontSize: "11px" }}
                      />
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", color: "var(--md-sys-color-on-surface-variant, #475569)" }}>
                    <span>Quote Pair</span>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                      <input
                        type="text"
                        id="minQuoteOpen"
                        value={quoteOpen}
                        onChange={(e) => setQuoteOpen(e.target.value)}
                        style={{
                          width: "28px",
                          height: "22px",
                          textAlign: "center",
                          fontFamily: "JetBrains Mono, Consolas, monospace",
                          fontWeight: "bold",
                          fontSize: "11px",
                          border: "1px solid var(--md-sys-color-outline-variant, #cbd5e1)",
                          borderRadius: "3px",
                          backgroundColor: "var(--md-sys-color-surface-container, #f8fafc)",
                          color: "var(--md-sys-color-on-surface, #0f172a)",
                          outline: "none",
                        }}
                      />
                      <span style={{ color: "var(--md-sys-color-on-surface-variant, #64748b)", fontSize: "11px" }}>..</span>
                      <input
                        type="text"
                        id="minQuoteClose"
                        value={quoteClose}
                        onChange={(e) => setQuoteClose(e.target.value)}
                        style={{
                          width: "28px",
                          height: "22px",
                          textAlign: "center",
                          fontFamily: "JetBrains Mono, Consolas, monospace",
                          fontWeight: "bold",
                          fontSize: "11px",
                          border: "1px solid var(--md-sys-color-outline-variant, #cbd5e1)",
                          borderRadius: "3px",
                          backgroundColor: "var(--md-sys-color-surface-container, #f8fafc)",
                          color: "var(--md-sys-color-on-surface, #0f172a)",
                          outline: "none",
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Sample Event Header with Multi-Row Sample Navigator & Quick Copy */}
        <div style={{ marginBottom: "8px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 600, color: "var(--md-sys-color-on-surface, #0f172a)", margin: 0 }}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="var(--md-sys-color-on-surface-variant, #64748b)">
                <path d="M0 2h16v2H0V2zm0 4h16v2H0V6zm0 4h10v2H0v-2zm0 4h8v2H0v-2z" />
              </svg>
              <span>Sample Event:</span>
            </label>
            {/* Multi-Row Sample Navigator & Quick Copy */}
            <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "11px", color: "var(--md-sys-color-on-surface-variant, #64748b)" }}>
              <span>
                Row <strong style={{ color: "var(--md-sys-color-primary, #0284c7)" }}>{sampleIdx + 1}</strong> of <strong>{Math.max(1, sampleList.length)}</strong>
              </span>
              <div style={{ display: "inline-flex", border: "1px solid var(--md-sys-color-outline-variant, #cbd5e1)", borderRadius: "4px", overflow: "hidden" }}>
                <button
                  type="button"
                  className="bp4-button bp4-minimal bp4-small"
                  onClick={handlePrevSample}
                  disabled={sampleList.length <= 1}
                  style={{ padding: "1px 6px", height: "20px", fontSize: "10px", color: "var(--md-sys-color-primary, #0284c7)", cursor: "pointer", borderRight: "1px solid var(--md-sys-color-outline-variant, #cbd5e1)" }}
                  title="Previous sample row"
                >
                  ◀
                </button>
                <button
                  type="button"
                  className="bp4-button bp4-minimal bp4-small"
                  onClick={handleNextSample}
                  disabled={sampleList.length <= 1}
                  style={{ padding: "1px 6px", height: "20px", fontSize: "10px", color: "var(--md-sys-color-primary, #0284c7)", cursor: "pointer" }}
                  title="Next sample row"
                >
                  ▶
                </button>
              </div>
              <button
                type="button"
                className="bp4-button bp4-minimal bp4-small"
                onClick={handleCopySample}
                style={{ padding: "1px 6px", height: "20px", fontSize: "10px", color: copiedSample ? "#10b981" : "var(--md-sys-color-on-surface-variant, #64748b)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "3px" }}
                title="Copy sample event to clipboard"
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M11 1H3c-1.1 0-2 .9-2 2v10h2V3h8V1zm3 4H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 12H6V7h8v10z" />
                </svg>
                <span>{copiedSample ? "Copied!" : "Copy"}</span>
              </button>
            </div>
          </div>

          <div style={{ position: "relative", display: "flex", border: "1px solid var(--md-sys-color-outline-variant, #cbd5e1)", borderRadius: "4px", overflow: "hidden", background: "var(--md-sys-color-surface-dim, #f8fafc)" }}>
            <div style={{ padding: "6px 8px", background: "var(--md-sys-color-surface-container, #f1f5f9)", borderRight: "1px solid var(--md-sys-color-outline-variant, #e2e8f0)", color: "var(--md-sys-color-on-surface-variant, #94a3b8)", fontFamily: "Consolas, monospace", fontSize: "11px", userSelect: "none" }}>
              01
            </div>
            <textarea
              rows={2}
              value={sampleText}
              onChange={(e) => {
                setSampleText(e.target.value);
                detectAndSelectFormat(e.target.value);
              }}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                padding: "6px 8px",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                fontSize: "11px",
                resize: "none",
                backgroundColor: "var(--md-sys-color-surface-dim, #ffffff)",
                color: "var(--md-sys-color-on-surface, #0f172a)",
                lineHeight: 1.45,
              }}
              placeholder="Sample log line..."
            />
          </div>
        </div>

        {/* SIMPLE MODE CONTENT */}
        {mode === "simple" && (
          <div>
            {/* Column Search & Action Toolbar */}
            <div style={{ display: "flex", justifyContent: "space-between", alignContent: "center", alignItems: "center", marginBottom: "8px", gap: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1 }}>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--md-sys-color-on-surface, #475569)" }}>
                  Discovered Fields ({simpleRows.length})
                </span>
                <div style={{ position: "relative", flex: 1, maxWidth: "220px" }}>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 16 16"
                    fill="var(--md-sys-color-on-surface-variant, #8a9ba8)"
                    style={{ position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
                  >
                    <path d="M15.7 14.3l-4.2-4.2c.8-1.1 1.3-2.5 1.3-4.1C12.8 2.7 10.1 0 6.8 0S.8 2.7.8 6s2.7 6 6 6c1.6 0 3-.5 4.1-1.3l4.2 4.2c.2.2.5.3.7.3s.5-.1.7-.3c.4-.4.4-1 0-1.4zM2.8 6c0-2.2 1.8-4 4-4s4 1.8 4 4-1.8 4-4 4-4-1.8-4-4z" />
                  </svg>
                  <input
                    type="text"
                    id="native-field-search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search discovered fields..."
                    style={{
                      padding: "4px 8px 4px 26px",
                      fontSize: "11px",
                      fontWeight: 500,
                      backgroundColor: "var(--md-sys-color-surface-container, #ffffff)",
                      border: "1px solid var(--md-sys-color-outline-variant, #c5d0d8)",
                      borderRadius: "4px",
                      color: "var(--md-sys-color-on-surface, #182026)",
                      width: "100%",
                      outline: "none",
                    }}
                  />
                </div>
              </div>

              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <button
                  type="button"
                  id="btnAddColumn"
                  onClick={handleAddColumn}
                  title="Add custom column"
                  style={{
                    fontSize: "11px",
                    padding: "3px 8px",
                    height: "24px",
                    color: "var(--md-sys-color-on-surface, #334155)",
                    background: "var(--md-sys-color-surface-container, #f8fafc)",
                    border: "1px solid var(--md-sys-color-outline-variant, #cbd5e1)",
                    borderRadius: "4px",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M14 7H9V2c0-.55-.45-1-1-1s-1 .45-1 1v5H2c-.55 0-1 .45-1 1s.45 1 1 1h5v5c0 .55.45 1 1 1s1-.45 1-1V9h5c.55 0 1-.45 1-1s-.45-1-1-1z" />
                  </svg>
                  <span>Column</span>
                </button>
                <div style={{ display: "inline-flex", border: "1px solid var(--md-sys-color-outline-variant, #c5d0d8)", borderRadius: "4px", overflow: "hidden", background: "var(--md-sys-color-surface-container, #f8fafc)" }}>
                  <button
                    type="button"
                    className="bp4-button bp4-small bp4-minimal"
                    onClick={() => setSimpleRows((rows) => rows.map((r) => ({ ...r, enabled: true })))}
                    title="Select All Fields"
                    style={{ fontSize: "11px", padding: "3px 8px", height: "24px", display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--md-sys-color-on-surface, #182026)", borderRight: "1px solid var(--md-sys-color-outline-variant, #c5d0d8)" }}
                  >
                    <span>All</span>
                  </button>
                  <button
                    type="button"
                    className="bp4-button bp4-small bp4-minimal"
                    onClick={() => setSimpleRows((rows) => rows.map((r) => ({ ...r, enabled: false })))}
                    title="Deselect All Fields"
                    style={{ fontSize: "11px", padding: "3px 8px", height: "24px", display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--md-sys-color-on-surface-variant, #5c7080)" }}
                  >
                    <span>None</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Enhanced Mapping Grid with Click-to-Sort Columns */}
            <div style={{ maxHeight: "280px", overflowY: "auto", border: "1px solid var(--md-sys-color-outline-variant, #d8e1e8)", borderRadius: "6px", background: "var(--md-sys-color-surface-container-low, #ffffff)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                <thead style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--md-sys-color-surface-container, #ffffff)" }}>
                  <tr style={{ background: "var(--md-sys-color-surface-container, #ffffff)", borderBottom: "1px solid var(--md-sys-color-outline-variant, #e2e8f0)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    <th style={{ width: "30px", padding: "6px 8px", textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={simpleRows.length > 0 && simpleRows.every((r) => r.enabled)}
                        onChange={(e) => {
                          const val = e.target.checked;
                          setSimpleRows((rows) => rows.map((r) => ({ ...r, enabled: val })));
                        }}
                      />
                    </th>
                    <th
                      onClick={() => handleSort("name")}
                      style={{ width: "38%", padding: "6px 8px", cursor: "pointer", color: sortKey === "name" ? "var(--md-sys-color-primary, #0284c7)" : "var(--md-sys-color-on-surface-variant, #64748b)", fontSize: "11px", fontWeight: 600 }}
                      title="Discovered key or token identifier (Click to sort · Click column name below to rename)"
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                        <span>COLUMN</span>
                        <span style={{ fontSize: "10px" }}>{sortKey === "name" ? (sortAsc ? "▲" : "▼") : ""}</span>
                        <span style={{ display: "none" }}><span>Key</span><span>New name</span></span>
                      </span>
                    </th>
                    <th
                      onClick={() => handleSort("val")}
                      style={{ width: "34%", padding: "6px 8px", cursor: "pointer", color: sortKey === "val" ? "var(--md-sys-color-primary, #0284c7)" : "var(--md-sys-color-on-surface-variant, #64748b)", fontSize: "11px", fontWeight: 600 }}
                      title="Sample value extracted from current event row (Click to sort)"
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                        <span>SAMPLE VALUE</span>
                        <span style={{ fontSize: "10px" }}>{sortKey === "val" ? (sortAsc ? "▲" : "▼") : ""}</span>
                        <span style={{ display: "none" }}><span>Sample</span></span>
                      </span>
                    </th>
                    <th
                      onClick={() => handleSort("type")}
                      style={{ width: "16%", padding: "6px 8px", cursor: "pointer", color: sortKey === "type" ? "var(--md-sys-color-primary, #0284c7)" : "var(--md-sys-color-on-surface-variant, #64748b)", fontSize: "11px", fontWeight: 600 }}
                      title="Inferred DuckDB column type (Click to sort)"
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                        <span>TYPE</span>
                        <span style={{ fontSize: "10px" }}>{sortKey === "type" ? (sortAsc ? "▲" : "▼") : ""}</span>
                        <span style={{ display: "none" }}><span>Type</span></span>
                      </span>
                    </th>
                    <th
                      onClick={() => handleSort("fill")}
                      style={{ width: "12%", padding: "6px 8px", cursor: "pointer", color: sortKey === "fill" ? "var(--md-sys-color-primary, #0284c7)" : "var(--md-sys-color-on-surface-variant, #64748b)", fontSize: "11px", fontWeight: 600, textAlign: "right" }}
                      title="Fill rate percentage across sample log lines (Click to sort)"
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", justifyContent: "flex-end" }}>
                        <span>FILL</span>
                        <span style={{ fontSize: "10px" }}>{sortKey === "fill" ? (sortAsc ? "▲" : "▼") : ""}</span>
                        <span style={{ display: "none" }}><span>Rate</span></span>
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayedRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", color: "var(--md-sys-color-on-surface-variant, #64748b)", padding: "20px 10px", fontSize: "11px" }}>
                        <span>No columns discovered. Click "+ Column" to add custom columns.</span>
                      </td>
                    </tr>
                  ) : (
                    displayedRows.map((row) => {
                      const isRenamed = row.outputColName !== String(row.sourceKeyOrIdx);
                      const isEditing = editingRowId === row.id;

                      return (
                        <tr
                          key={row.id}
                          style={{
                            borderBottom: "1px solid var(--md-sys-color-outline-variant, #f1f5f9)",
                            opacity: row.enabled ? 1 : 0.45,
                          }}
                        >
                          <td style={{ padding: "6px 8px", textAlign: "center" }}>
                            <input
                              type="checkbox"
                              checked={row.enabled}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setSimpleRows((rows) =>
                                  rows.map((r) => (r.id === row.id ? { ...r, enabled: checked } : r))
                                );
                              }}
                            />
                          </td>
                          <td style={{ padding: "6px 8px" }}>
                            {isEditing ? (
                              <input
                                type="text"
                                autoFocus
                                value={inlineEditVal}
                                onChange={(e) => setInlineEditVal(e.target.value)}
                                onBlur={() => handleFinishRename(row.id)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleFinishRename(row.id);
                                  if (e.key === "Escape") setEditingRowId(null);
                                }}
                                style={{
                                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  padding: "2px 6px",
                                  border: "1px solid var(--md-sys-color-primary, #0284c7)",
                                  borderRadius: "3px",
                                  outline: "none",
                                  width: "160px",
                                  backgroundColor: "var(--md-sys-color-surface-container-high, #ffffff)",
                                  color: "var(--md-sys-color-on-surface, #0f172a)",
                                }}
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleStartRename(row)}
                                title="Click to rename column inline"
                                style={{
                                  background: "none",
                                  border: "none",
                                  padding: 0,
                                  cursor: "pointer",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "5px",
                                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  color: "var(--md-sys-color-on-surface, #0f172a)",
                                  textAlign: "left",
                                }}
                              >
                                <span style={{ color: String(row.sourceKeyOrIdx).startsWith("str") ? "var(--toad-col-auto-str, #b45309)" : "var(--md-sys-color-on-surface, #0f172a)" }}>
                                  {String(row.sourceKeyOrIdx)}
                                </span>
                                {isRenamed && (
                                  <>
                                    <span style={{ color: "var(--md-sys-color-on-surface-variant, #94a3b8)" }}>→</span>
                                    <span style={{ backgroundColor: "var(--md-sys-color-surface-container, #f1f5f9)", padding: "1px 5px", borderRadius: "3px", fontWeight: "bold", color: "var(--md-sys-color-primary, #0284c7)" }}>
                                      {row.outputColName}
                                    </span>
                                  </>
                                )}
                                {row.enabled &&
                                  simpleRows.filter(
                                    (r) => r.enabled && r.outputColName.trim().toLowerCase() === row.outputColName.trim().toLowerCase()
                                  ).length > 1 && (
                                    <span
                                      style={{
                                        fontSize: "9px",
                                        fontWeight: 700,
                                        color: "var(--md-sys-color-primary, #4338ca)",
                                        background: "rgba(138, 180, 248, 0.15)",
                                        border: "1px solid var(--md-sys-color-outline-variant, #c7d2fe)",
                                        borderRadius: "3px",
                                        padding: "1px 4px",
                                        marginLeft: "4px",
                                        whiteSpace: "nowrap",
                                      }}
                                      title="Multiple fields mapped to this column will COALESCE!"
                                    >
                                      🔗 COALESCE
                                    </span>
                                  )}
                              </button>
                            )}
                          </td>
                          <td style={{ padding: "6px 8px" }}>
                            <div
                              style={{
                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                fontSize: "11px",
                                color: "var(--md-sys-color-on-surface-variant, #475569)",
                                maxWidth: "210px",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                              title={row.sampleVal}
                            >
                              {row.sampleVal || <span style={{ color: "var(--md-sys-color-on-surface-variant, #94a3b8)", fontStyle: "italic" }}>(empty)</span>}
                            </div>
                          </td>
                          <td style={{ padding: "6px 8px" }}>
                            <select
                              value={row.colType}
                              onChange={(e) => {
                                const newType = e.target.value as any;
                                setSimpleRows((rows) =>
                                  rows.map((r) => (r.id === row.id ? { ...r, colType: newType } : r))
                                );
                              }}
                              style={{
                                background: "transparent",
                                border: "none",
                                color: "var(--md-sys-color-on-surface-variant, #64748b)",
                                fontSize: "11px",
                                fontWeight: 500,
                                cursor: "pointer",
                                outline: "none",
                                padding: "2px 0",
                              }}
                            >
                              <option value="VARCHAR">VARCHAR</option>
                              <option value="BIGINT">BIGINT</option>
                              <option value="DOUBLE">DOUBLE</option>
                              <option value="TIMESTAMP">TIMESTAMP</option>
                              <option value="BOOLEAN">BOOLEAN</option>
                            </select>
                          </td>
                          <td style={{ padding: "6px 8px", textAlign: "right" }}>
                            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", justifyContent: "flex-end", fontSize: "11px", fontFamily: "monospace" }}>
                              <div
                                style={{
                                  width: "36px",
                                  height: "4px",
                                  borderRadius: "2px",
                                  backgroundColor: "rgba(128, 128, 128, 0.2)",
                                  overflow: "hidden",
                                  display: "inline-block",
                                }}
                                title={`${row.fillRate}% fill rate`}
                              >
                                <div
                                  style={{
                                    width: `${row.fillRate}%`,
                                    height: "100%",
                                    borderRadius: "2px",
                                    backgroundColor:
                                      row.fillRate >= 80
                                        ? "#81c995"
                                        : row.fillRate >= 40
                                          ? "#fdd663"
                                          : "#9aa0a6",
                                  }}
                                />
                              </div>
                              <span style={{ color: "var(--md-sys-color-on-surface-variant, #64748b)", minWidth: "28px", textAlign: "right" }}>{row.fillRate}%</span>
                              <button
                                type="button"
                                onClick={() => handleDeleteRow(row.id)}
                                title="Remove column"
                                style={{
                                  color: "var(--md-sys-color-on-surface-variant, #94a3b8)",
                                  background: "none",
                                  border: "none",
                                  cursor: "pointer",
                                  padding: "0 2px",
                                  fontSize: "11px",
                                }}
                              >
                                ✕
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Live DuckDB SQL Preview Accordion */}
            <div style={{ marginTop: "10px", borderTop: "1px solid var(--md-sys-color-outline-variant, #d8e1e8)", paddingTop: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "var(--md-sys-color-on-surface-variant, #5c7080)", fontSize: "11px" }}>
                <div
                  onClick={() => setSqlExpanded(!sqlExpanded)}
                  style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", userSelect: "none" }}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="var(--md-sys-color-primary, #106ba3)">
                    <path d="M8 0C3.6 0 0 .9 0 2v12c0 1.1 3.6 2 8 2s8-.9 8-2V2c0-1.1-3.6-2-8-2zm6 12c0 .4-2.2 1-6 1s-6-.6-6-1V9.7c1.6.8 3.7 1.3 6 1.3s4.4-.5 6-1.3V12zm0-4c0 .4-2.2 1-6 1s-6-.6-6-1V5.7c1.6.8 3.7 1.3 6 1.3s4.4-.5 6-1.3V8zm0-4.3c-1.6.8-3.7 1.3-6 1.3s-4.4-.5-6-1.3V2c0-.4 2.2-1 6-1s6 .6 6 1v1.7z" />
                  </svg>
                  <strong style={{ color: "var(--md-sys-color-primary, #106ba3)" }}>SQL</strong>
                  <span title="DuckDB vectorized query statement preview">Preview</span>
                  <span style={{ fontSize: "10px", marginLeft: "4px" }}>{sqlExpanded ? "▼" : "▶"}</span>
                </div>
                <button
                  type="button"
                  id="btn-copy-sql"
                  className="bp4-button bp4-small bp4-minimal"
                  onClick={handleCopySql}
                  style={{ fontSize: "10px", padding: "2px 6px", height: "20px", display: "inline-flex", alignItems: "center", gap: "4px", color: copiedSql ? "#0f9960" : "var(--md-sys-color-on-surface-variant, #5c7080)" }}
                  title="Copy SQL statement to clipboard"
                >
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M11 1H3c-1.1 0-2 .9-2 2v10h2V3h8V1zm3 4H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 12H6V7h8v10z" />
                  </svg>
                  <span>{copiedSql ? "✓ Copied!" : "Copy"}</span>
                </button>
              </div>

              {sqlExpanded && (
                <pre
                  id="native-sql-box"
                  style={{
                    marginTop: "6px",
                    padding: "8px 10px",
                    background: "var(--md-sys-color-surface-dim, #f4f6f8)",
                    border: "1px solid var(--md-sys-color-outline-variant, #d8e1e8)",
                    borderRadius: "4px",
                    fontFamily: "Consolas, monospace",
                    fontSize: "11px",
                    color: "var(--md-sys-color-on-surface, #0c3247)",
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.5,
                    maxHeight: "130px",
                    overflowY: "auto",
                  }}
                >
                  {liveSqlPreview}
                </pre>
              )}
            </div>

            {/* Collapsible Real Unmatched Rows Inspector (Appears only on user inspection) */}
            {hasTested && unmatchedOpen && realUnmatchedCount > 0 && (
              <div style={{ marginTop: "8px", padding: "8px", background: "rgba(239, 68, 68, 0.12)", border: "1px solid rgba(239, 68, 68, 0.35)", borderRadius: "4px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <span style={{ fontWeight: 600, color: "var(--md-sys-color-error, #f28b82)", fontSize: "11px" }}>
                    Sample Unmatched Rows ({realUnmatchedLines.length} of {realUnmatchedCount}):
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <button
                      type="button"
                      className="bp4-button bp4-small bp4-minimal"
                      onClick={handleCopyUnmatched}
                      style={{ fontSize: "10px", padding: "1px 6px", height: "18px", color: copiedUnmatched ? "#0f9960" : "var(--md-sys-color-on-surface-variant, #5c7080)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "3px" }}
                      title="Copy unmatched sample lines to clipboard"
                    >
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M11 1H3c-1.1 0-2 .9-2 2v10h2V3h8V1zm3 4H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 12H6V7h8v10z" />
                      </svg>
                      <span>{copiedUnmatched ? "Copied!" : "Copy"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setUnmatchedOpen(false)}
                      style={{ border: "none", background: "none", cursor: "pointer", color: "var(--md-sys-color-on-surface-variant, #94a3b8)", fontSize: "12px", padding: "0 2px" }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <pre
                  style={{
                    background: "var(--md-sys-color-surface-container, #ffffff)",
                    border: "1px solid var(--md-sys-color-outline-variant, #fecaca)",
                    borderRadius: "3px",
                    padding: "6px 8px",
                    fontFamily: "Consolas, monospace",
                    fontSize: "10px",
                    color: "var(--md-sys-color-on-surface, #182026)",
                    lineHeight: 1.4,
                    margin: 0,
                    maxHeight: "100px",
                    overflowY: "auto",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {realUnmatchedLines.map((u) => `Row #${u.rowIdx}: ${u.line}`).join("\n")}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* ADVANCED REGEX MODE CONTENT */}
        {mode === "advanced" && (
          <div>
            <FormGroup
              label="Regular Expression (Regex):"
              intent={advEval.error ? Intent.DANGER : Intent.NONE}
              style={{ marginBottom: "12px" }}
            >
              <InputGroup
                fill={true}
                value={regexPattern}
                onChange={(e) => setRegexPattern(e.target.value)}
                placeholder="e.g. (\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+\[(\w+)\]\s+(.*)"
                style={{ fontFamily: "Consolas, monospace", fontSize: "12px", backgroundColor: "var(--md-sys-color-surface-container, #ffffff)", color: "var(--md-sys-color-on-surface, #182026)", border: "1px solid var(--md-sys-color-outline-variant, #c5d0d8)" }}
                intent={advEval.error ? Intent.DANGER : Intent.NONE}
              />
              {advEval.error && (
                <div style={{ color: "#db3737", fontSize: "11px", marginTop: "4px" }}>
                  {advEval.error}
                </div>
              )}
            </FormGroup>

            <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--md-sys-color-on-surface, #182026)", marginBottom: "6px", display: "block" }}>
              Capture Groups & Column Renaming:
            </label>

            <div style={{ maxHeight: "200px", overflowY: "auto", border: "1px solid var(--md-sys-color-outline-variant, #d8e1e8)", borderRadius: "6px", background: "var(--md-sys-color-surface-container-low, #ffffff)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                <thead>
                  <tr style={{ background: "var(--md-sys-color-surface-container, #ebf1f5)", borderBottom: "1px solid var(--md-sys-color-outline-variant, #d8e1e8)" }}>
                    <th style={{ width: "30px", padding: "6px 8px" }}>
                      <input
                        type="checkbox"
                        checked={advRows.length > 0 && advRows.every((r) => r.enabled)}
                        onChange={(e) => {
                          const val = e.target.checked;
                          setAdvRows((rows) => rows.map((r) => ({ ...r, enabled: val })));
                        }}
                      />
                    </th>
                    <th style={{ width: "100px", padding: "6px 8px", color: "var(--md-sys-color-on-surface-variant, #5c7080)" }} title="Regex Capture Group (1-based index)">Group</th>
                    <th style={{ padding: "6px 8px", color: "var(--md-sys-color-on-surface-variant, #5c7080)" }} title="Extracted sample value from current row">Sample</th>
                    <th style={{ width: "220px", padding: "6px 8px", color: "var(--md-sys-color-on-surface-variant, #5c7080)" }} title="Target column name in generated table">New name</th>
                  </tr>
                </thead>
                <tbody>
                  {advRows.map((row) => (
                    <tr key={row.id} style={{ borderBottom: "1px solid var(--md-sys-color-outline-variant, #ebf1f5)", opacity: row.enabled ? 1 : 0.45 }}>
                      <td style={{ padding: "5px 8px" }}>
                        <input
                          type="checkbox"
                          checked={row.enabled}
                          onChange={(e) => {
                            const val = e.target.checked;
                            setAdvRows((rows) =>
                              rows.map((r) => (r.id === row.id ? { ...r, enabled: val } : r))
                            );
                          }}
                        />
                      </td>
                      <td style={{ padding: "5px 8px" }}>
                        <span
                          style={{
                            fontFamily: "Consolas, monospace",
                            fontSize: "11px",
                            color: "var(--md-sys-color-primary, #106ba3)",
                            background: "rgba(138, 180, 248, 0.15)",
                            border: "1px solid var(--md-sys-color-outline-variant, #c5e0f5)",
                            padding: "2px 6px",
                            borderRadius: "2px",
                            fontWeight: 600,
                          }}
                        >
                          Group ({row.sourceKeyOrIdx})
                        </span>
                      </td>
                      <td style={{ padding: "5px 8px", fontFamily: "Consolas, monospace", fontSize: "11px", color: "var(--md-sys-color-on-surface-variant, #5c7080)" }}>
                        {row.sampleVal}
                      </td>
                      <td style={{ padding: "5px 8px" }}>
                        <input
                          type="text"
                          value={row.outputColName}
                          onChange={(e) => {
                            const val = e.target.value;
                            setAdvRows((rows) =>
                              rows.map((r) => (r.id === row.id ? { ...r, outputColName: val } : r))
                            );
                          }}
                          style={{
                            background: "var(--md-sys-color-surface-container-high, #ffffff)",
                            border: "1px solid var(--md-sys-color-outline-variant, #c5d0d8)",
                            borderRadius: "3px",
                            color: "var(--md-sys-color-on-surface, #182026)",
                            fontSize: "11px",
                            fontWeight: 600,
                            padding: "4px 8px",
                            width: "100%",
                            outline: "none",
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div
        className={Classes.DIALOG_FOOTER}
        style={{
          backgroundColor: "var(--md-sys-color-surface-container, #f5f8fa)",
          borderTop: "1px solid var(--md-sys-color-outline-variant, #d8e1e8)",
          padding: "12px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ fontSize: "11px", color: "var(--md-sys-color-on-surface-variant, #5c7080)", display: "inline-flex", alignItems: "center", gap: "5px" }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="#0f9960">
            <path d="M8.5 1.5L2 9h5l-1.5 5.5L14 7H9l.5-5.5z" />
          </svg>
          <span title="Zero-copy virtual table view ready in under 15ms">
            Ready (<strong style={{ color: "#0f9960" }}>&lt; 15ms</strong>)
          </span>
          {/* Inline 1k rows test button */}
          <button
            type="button"
            id="minimalInlineTestBtn"
            onClick={handleRunBatchTest}
            disabled={isValidating}
            title="Evaluate parser against up to 1,000 rows from active data"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: "2px 7px",
              borderRadius: "4px",
              backgroundColor: "var(--md-sys-color-surface-container, #f1f5f9)",
              border: "1px solid var(--md-sys-color-outline-variant, #cbd5e1)",
              color: "var(--md-sys-color-on-surface, #334155)",
              fontSize: "10px",
              fontWeight: 600,
              cursor: "pointer",
              marginLeft: "6px",
            }}
          >
            <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3 2l11 6-11 6V2z" />
            </svg>
            <span>{isValidating ? "Testing..." : hasTested ? `${realMatchPct.toFixed(0)}%` : "Test"}</span>
          </button>
          {hasTested && (
            realUnmatchedCount === 0 ? (
              <span
                style={{ fontSize: "10px", color: "#0f9960", fontWeight: 600, marginLeft: "4px" }}
                title="All evaluated rows matched"
              >
                ✓ 0 Unmatched
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setUnmatchedOpen(!unmatchedOpen)}
                style={{
                  fontSize: "10px",
                  padding: "1px 6px",
                  borderRadius: "3px",
                  backgroundColor: "#fee2e2",
                  border: "1px solid #fca5a5",
                  color: "#b91c1c",
                  fontWeight: 600,
                  cursor: "pointer",
                  marginLeft: "4px",
                }}
              >
                {unmatchedOpen ? "Close Inspector" : `${realUnmatchedCount} Unmatched`}
              </button>
            )
          )}
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <Button text="Cancel" onClick={handleClose} disabled={isApplying} />
          {/* Dynamic Action-Oriented Apply Button */}
          <Button
            intent={Intent.PRIMARY}
            text="Apply"
            loading={isApplying}
            disabled={enabledCount === 0}
            onClick={handleApply}
          />
        </div>
      </div>
    </Dialog>
  );
};

// Toad v2.5.0.3: Canonical ParseDialog export with backward-compatible RegexDialog alias
export const ParseDialog = RegexDialog;

