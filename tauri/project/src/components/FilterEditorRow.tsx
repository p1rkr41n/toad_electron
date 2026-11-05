import * as React from "react";
import * as reltab from "reltab";
import { AppState } from "../AppState";
// import type {Scalar} from '../reltab' // eslint-disable-line
import { Button, NumericInput } from "@blueprintjs/core";
import Select, { createFilter } from "react-select";
import AsyncSelect from "react-select/async";
import { StateRef } from "oneref";
import { useState, useEffect, useRef, useMemo } from "react";
import { ViewState } from "../ViewState";
import { defaultEvalQueryOptions } from "reltab";
import { getOrLoadDistinctValues } from "../distinctCache";
type Option = { value: string; label: string };
type OptionsRet = Option[];
type OptionsLoader = (input: string) => Promise<OptionsRet>;
const { col, constVal } = reltab;

const validRow = (
  columnId: string | null,
  op: reltab.RelOp | null,
  value: reltab.Scalar | Array<Option>,
  schema?: reltab.Schema
): boolean => {
  if (columnId == null || op == null) {
    return false;
  }
  if (schema && schema.columns.includes(columnId)) {
    try {
      const colType = schema.columnType(columnId);
      const isNum =
        reltab.colIsNumeric(colType) ||
        (colType &&
          (colType.kind === "integer" ||
            colType.kind === "real" ||
            (typeof colType.sqlTypeName === "string" &&
              /int|float|double|decimal|numeric/i.test(colType.sqlTypeName))));
      if (isNum) {
        if (reltab.opIsTextOnly(op)) return false;
        if (typeof value === "string" && value.trim() !== "") {
          const num = Number(value.trim());
          if (isNaN(num)) return false;
        }
      }
    } catch {
      // ignore
    }
  }
  if (reltab.opIsUnary(op)) {
    return true;
  }
  if (value == null) {
    return false;
  }
  if (typeof value === "bigint") {
    return true;
  }
  if (typeof value === "number" && isNaN(value)) {
    return false;
  }
  if (typeof value === "string" && value.trim() === "") {
    return false;
  }
  if (Array.isArray(value) && value.length === 0) {
    return false;
  }
  if ((op === "IN" || op === "NOTIN") && (!Array.isArray(value) || value.length === 0)) {
    return false;
  }
  return true;
};

const mkColValsLoader = (
  viewState: ViewState,
  columnId: string
): OptionsLoader => {
  return async (input: string): Promise<OptionsRet> => {
    let vals: string[] = [];
    if (viewState.dbc && viewState.dsPath) {
      try {
        const tblName = await viewState.dbc.getTableName(viewState.dsPath);
        vals = await getOrLoadDistinctValues(viewState.dbc, tblName, columnId);
      } catch { }
    }
    if (input && input.length > 0) {
      const lower = input.toLowerCase();
      vals = vals.filter((v) => v.toLowerCase().includes(lower));
    }
    const options: Option[] = vals.slice(0, 100).map((cv) => ({
      value: cv,
      label: cv,
    }));
    return options;
  };
};

const mkRelExp = (
  columnId: string,
  op: reltab.RelOp,
  value: reltab.Scalar | Option[],
  schema?: reltab.Schema
): reltab.RelExp => {
  let ret;
  if (reltab.opIsUnary(op)) {
    ret = new reltab.UnaryRelExp(op as reltab.UnaryRelOp, reltab.col(columnId));
  } else {
    let expValue: any = value;
    if (typeof expValue === "bigint") {
      const num = Number(expValue);
      expValue = Number.isSafeInteger(num) ? num : expValue.toString();
    }
    if (op === "IN" || op === "NOTIN") {
      let opts: any[] = [];
      if (Array.isArray(value)) {
        opts = value;
      } else if (value != null && value !== "") {
        opts = [{ value: value, label: String(value) }];
      }
      expValue = opts.map((opt: any) => {
        const raw =
          opt && typeof opt === "object" && "value" in opt ? opt.value : opt;
        if (schema && schema.columns.includes(columnId)) {
          try {
            const colType = schema.columnType(columnId);
            const isNum =
              reltab.colIsNumeric(colType) ||
              (colType &&
                (colType.kind === "integer" ||
                  colType.kind === "real" ||
                  (typeof colType.sqlTypeName === "string" &&
                    /int|float|double|decimal|numeric/i.test(
                      colType.sqlTypeName
                    ))));
            if (isNum && typeof raw === "string" && raw.trim() !== "") {
              const num = Number(raw);
              return !isNaN(num) ? num : raw;
            }
          } catch {
            // ignore
          }
        }
        return raw;
      });
    } else if (schema && schema.columns.includes(columnId)) {
      try {
        const colType = schema.columnType(columnId);
        const isNum =
          reltab.colIsNumeric(colType) ||
          (colType &&
            (colType.kind === "integer" ||
              colType.kind === "real" ||
              (typeof colType.sqlTypeName === "string" &&
                /int|float|double|decimal|numeric/i.test(
                  colType.sqlTypeName
                ))));
        if (isNum) {
          if (typeof expValue === "bigint") {
            const num = Number(expValue);
            expValue = Number.isSafeInteger(num) ? num : expValue.toString();
          } else if (typeof expValue === "string" && expValue.trim() !== "") {
            const num = Number(expValue);
            if (!isNaN(num)) {
              expValue = num;
            }
          }
        }
      } catch {
        // ignore schema lookup error
      }
    }
    ret = new reltab.BinRelExp(
      op as reltab.BinRelOp,
      reltab.col(columnId),
      reltab.constVal(expValue)
    );
  }
  return ret;
};

export interface FilterEditorRowProps {
  appState: AppState;
  stateRef: StateRef<AppState>;
  schema: reltab.Schema;
  relExp: reltab.RelExp | null;
  onDeleteRow: () => void;
  onUpdate: (fe: reltab.RelExp | null) => void;
  rowId: string;
  isSelected?: boolean;
  onSelectRow?: () => void;
  isDragging?: boolean;
  dropPosition?: "above" | "below" | null;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}

const getBinOpVal = (
  relExp: reltab.BinRelExp | reltab.UnaryRelExp | null
): any => {
  if (
    relExp &&
    relExp.expType === "BinRelExp" &&
    relExp.rhs.expType === "ConstVal"
  ) {
    const v = relExp.rhs.val;
    if (typeof v === "bigint") {
      const num = Number(v);
      return Number.isSafeInteger(num) ? num : v.toString();
    }
    return v;
  }
  return null;
};

const getExpVal = (
  relExp: reltab.BinRelExp | reltab.UnaryRelExp | null
): any => {
  if (relExp === null) return null;
  const op = relExp.op;
  const expVal = getBinOpVal(relExp);
  let value = expVal;
  if ((op === "IN" || op === "NOTIN") && expVal != null) {
    const arr = Array.isArray(expVal) ? expVal : [expVal];
    value = arr.map((cv: any) => ({ value: cv, label: String(cv) }));
  }
  return value;
};

export interface MultiTagPillInputProps {
  value: Option[] | null;
  placeholder?: string;
  disabled?: boolean;
  distinctSuggestions?: string[];
  onChange: (nextValue: Option[]) => void;
}

export const MultiTagPillInput: React.FC<MultiTagPillInputProps> = ({
  value,
  placeholder = "+ Type or paste list...",
  disabled = false,
  distinctSuggestions = [],
  onChange,
}) => {
  const [inputText, setInputText] = useState("");
  const [showMenu, setShowMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pills: Option[] = useMemo(() => {
    if (!value || !Array.isArray(value)) return [];
    return value;
  }, [value]);

  const addPillTokens = (tokens: string[]) => {
    const existingSet = new Set(pills.map((p) => String(p.value).trim()));
    const newItems: Option[] = [];
    for (const t of tokens) {
      const trimmed = t.trim();
      if (trimmed.length > 0 && !existingSet.has(trimmed)) {
        existingSet.add(trimmed);
        newItems.push({ value: trimmed, label: trimmed });
      }
    }
    if (newItems.length > 0) {
      onChange([...pills, ...newItems]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      e.stopPropagation();
      if (inputText.trim().length > 0) {
        addPillTokens(inputText.split(","));
        setInputText("");
        setShowMenu(false);
      }
    } else if (e.key === "Backspace" && inputText === "" && pills.length > 0) {
      e.preventDefault();
      onChange(pills.slice(0, pills.length - 1));
    } else if (e.key === "Escape") {
      setShowMenu(false);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasteData = e.clipboardData.getData("text");
    if (pasteData) {
      e.preventDefault();
      const tokens = pasteData.split(/[\r\n,\t]+/);
      addPillTokens(tokens);
      setInputText("");
      setShowMenu(false);
    }
  };

  const handleBlur = () => {
    if (inputText.trim().length > 0) {
      addPillTokens(inputText.split(","));
      setInputText("");
    }
    setTimeout(() => setShowMenu(false), 200);
  };

  const removePill = (idx: number) => {
    const next = [...pills];
    next.splice(idx, 1);
    onChange(next);
  };

  const filtered = useMemo(() => {
    if (!distinctSuggestions || distinctSuggestions.length === 0) return [];
    const text = (inputText || "").trim().toLowerCase();
    const existingSet = new Set(
      pills.map((p) => String(p.value).toLowerCase())
    );
    const candidates = distinctSuggestions.filter(
      (s) => !existingSet.has(s.toLowerCase())
    );
    if (!text) return candidates.slice(0, 50);
    return candidates
      .filter((s) => s.toLowerCase().includes(text))
      .slice(0, 50);
  }, [distinctSuggestions, inputText, pills]);

  const handleSelectSuggestion = (s: string) => {
    addPillTokens([s]);
    setInputText("");
    setShowMenu(false);
    inputRef.current?.focus();
  };

  return (
    <div className="filter-val-wrapper">
      <div
        className="filter-pill-container"
        onClick={() => inputRef.current?.focus()}
      >
        {pills.map((p, idx) => (
          <span key={`${p.value}-${idx}`} className="filter-pill-tag">
            <span className="filter-pill-tag-text">{String(p.label)}</span>
            <span
              className="filter-pill-tag-remove"
              onClick={(e) => {
                e.stopPropagation();
                removePill(idx);
              }}
              title="Remove"
            >
              ×
            </span>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          className="filter-pill-inline-input"
          value={inputText}
          disabled={disabled}
          placeholder={pills.length === 0 ? placeholder : "+"}
          onChange={(e) => {
            const v = e.target.value;
            if (distinctSuggestions?.includes(v)) {
              addPillTokens([v]);
              setInputText("");
              setShowMenu(false);
            } else {
              setInputText(v);
              setShowMenu(true);
            }
          }}
          onFocus={() => setShowMenu(true)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onBlur={handleBlur}
        />
      </div>
      {showMenu && filtered.length > 0 && !disabled && (
        <div className="filter-suggest-menu">
          {filtered.map((s, idx) => (
            <div
              key={`${s}-${idx}`}
              className="filter-suggest-item"
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelectSuggestion(s);
              }}
              title={s}
            >
              + {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export interface SingleValueSuggestInputProps {
  value: string;
  placeholder?: string;
  disabled?: boolean;
  distinctSuggestions?: string[];
  onChange: (val: string) => void;
}

export const SingleValueSuggestInput: React.FC<SingleValueSuggestInputProps> = ({
  value,
  placeholder = "Value",
  disabled = false,
  distinctSuggestions = [],
  onChange,
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const [inputText, setInputText] = useState(value);

  useEffect(() => {
    setInputText(value);
  }, [value]);

  const filtered = useMemo(() => {
    if (!distinctSuggestions || distinctSuggestions.length === 0) return [];
    const text = (inputText || "").trim().toLowerCase();
    if (!text) return distinctSuggestions.slice(0, 50);
    return distinctSuggestions
      .filter((s) => s.toLowerCase().includes(text))
      .slice(0, 50);
  }, [distinctSuggestions, inputText]);

  const handleSelect = (s: string) => {
    setInputText(s);
    onChange(s);
    setShowMenu(false);
  };

  return (
    <div className="filter-val-wrapper">
      <input
        className="bp4-input filter-editor-value"
        type="text"
        placeholder={placeholder}
        disabled={disabled}
        value={inputText}
        onChange={(e) => {
          const v = e.target.value;
          setInputText(v);
          onChange(v);
          setShowMenu(true);
        }}
        onFocus={() => setShowMenu(true)}
        onBlur={() => setTimeout(() => setShowMenu(false), 200)}
        dir="auto"
      />
      {showMenu && filtered.length > 0 && !disabled && (
        <div className="filter-suggest-menu">
          {filtered.map((s, idx) => (
            <div
              key={`${s}-${idx}`}
              className="filter-suggest-item"
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(s);
              }}
              title={s}
            >
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};


export const FilterEditorRow: React.FunctionComponent<FilterEditorRowProps> = ({
  appState,
  stateRef,
  schema,
  relExp,
  onDeleteRow,
  onUpdate,
  rowId,
  isSelected,
  onSelectRow,
  isDragging,
  dropPosition,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: FilterEditorRowProps) => {
  const getOpFromRelExp = (re: reltab.RelExp | null): reltab.RelOp | null => {
    if (re && "op" in re) {
      return (re as any).op;
    }
    return null;
  };

  const getColFromRelExp = (re: reltab.RelExp | null): string | null => {
    if (!re) return null;
    if (typeof (re as any).lhsCol === "function") {
      try {
        return (re as any).lhsCol();
      } catch {
        // fallback
      }
    }
    if ((re as any).lhs?.colName) return (re as any).lhs.colName;
    if ((re as any).arg?.colName) return (re as any).arg.colName;
    return null;
  };

  const [columnId, setColumnId] = useState(getColFromRelExp(relExp));
  const [op, setOp] = useState(getOpFromRelExp(relExp));
  const [value, setValue] = useState(
    relExp && "op" in relExp ? getExpVal(relExp as any) : null
  );

  useEffect(() => {
    setColumnId(getColFromRelExp(relExp));
    setOp(getOpFromRelExp(relExp));
    setValue(relExp && "op" in relExp ? getExpVal(relExp as any) : null);
  }, [relExp]);

  const [distinctSuggestions, setDistinctSuggestions] = useState<string[]>([]);
  const dbc = appState.viewState?.dbc;
  const dsPath = appState.viewState?.dsPath;

  useEffect(() => {
    if (!columnId || !dbc || !dsPath) {
      setDistinctSuggestions([]);
      return;
    }

    let isMounted = true;
    (async () => {
      try {
        const tblName = await dbc.getTableName(dsPath);
        if (!isMounted) return;
        const vals = await getOrLoadDistinctValues(
          dbc,
          tblName,
          columnId,
          (updatedVals) => {
            if (isMounted) setDistinctSuggestions(updatedVals);
          }
        );
        if (isMounted && vals && vals.length > 0) {
          setDistinctSuggestions(vals);
        }
      } catch (err) {
        // ignore
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [columnId, dbc, dsPath]);

  /* validate row and notify if valid */
  const handleUpdate = (
    nextColumnId: string | null,
    nextOp: reltab.RelOp | null,
    nextValue: reltab.Scalar | Option[]
  ) => {
    if (onUpdate) {
      if (validRow(nextColumnId, nextOp, nextValue, schema)) {
        const relExp = mkRelExp(nextColumnId!, nextOp!, nextValue!, schema);
        onUpdate(relExp);
      } else {
        onUpdate(null);
      }
    }
  };

  const handleColumnSelect = (event: any) => {
    const sval = event.target.value;
    const nextColumnId = sval === "" ? null : sval;
    setColumnId(sval === "" ? null : sval);
    setOp(null);
    setValue(null);
    handleUpdate(nextColumnId, null, null);
  };

  const handleOpSelect = (event: any) => {
    const sval = event.target.value;
    const nextOp = sval === "" ? null : sval;
    setOp(nextOp);
    let nextVal = value;
    if ((nextOp === "IN" || nextOp === "NOTIN") && nextVal != null) {
      if (!Array.isArray(nextVal)) {
        nextVal = [{ value: nextVal, label: String(nextVal) }];
        setValue(nextVal);
      }
    } else if (nextOp !== "IN" && nextOp !== "NOTIN" && Array.isArray(nextVal)) {
      nextVal = nextVal.length > 0 ? (nextVal[0]?.value ?? null) : null;
      setValue(nextVal);
    }
    handleUpdate(columnId, nextOp, nextVal);
  };

  // TODO: nextValue can have a tighter type; look up API
  // to AsyncSelect
  const handleSelectChange = (nextValue: any) => {
    setValue(nextValue);
    handleUpdate(columnId, op, nextValue);
  };

  const handleNumericValueChange = (
    nextValue: number,
    nextValueAsString: string
  ) => {
    const parsedVal =
      nextValueAsString.trim() === "" || isNaN(nextValue) ? null : nextValue;
    setValue(parsedVal);
    handleUpdate(columnId, op, parsedVal);
  };

  const handleValueChange = (nextValue: any) => {
    let val = nextValue;
    if (typeof val === "bigint") {
      const num = Number(val);
      val = Number.isSafeInteger(num) ? num : val.toString();
    }
    setValue(val);
    handleUpdate(columnId, op, val);
  };

  const handleDeleteRow = () => {
    if (onDeleteRow) {
      onDeleteRow();
    }
  };

  interface ColumnSelectOption {
    value: string;
    label: string;
    colType: string;
  }

  const columnChoices = schema && schema.columns ? schema.columns : [];
  const colOptions: ColumnSelectOption[] = columnChoices.map((cid) => {
    let colTypeName = "";
    try {
      colTypeName = schema && schema.columnType ? schema.columnType(cid).sqlTypeName : "";
    } catch {
      colTypeName = "";
    }
    return {
      value: cid,
      label: schema && schema.displayName ? schema.displayName(cid) : cid,
      colType: colTypeName,
    };
  });

  const selectedColOpt =
    colOptions.find((opt) => opt.value === columnId) ||
    colOptions.find(
      (opt) =>
        columnId && opt.value.toLowerCase() === columnId.toLowerCase()
    ) ||
    null;

  const handleColSelectChange = (selected: ColumnSelectOption | null) => {
    const nextColId = selected ? selected.value : null;
    setColumnId(nextColId);
    setOp(null);
    setValue(null);
    handleUpdate(nextColId, null, null);
  };

  const colSelectStyles = {
    control: (provided: any, state: any) => ({
      ...provided,
      background: "var(--md-sys-color-surface-container-low, #fff)",
      borderColor: state.isFocused
        ? "var(--md-sys-color-primary, #137cbd)"
        : "var(--md-sys-color-outline-variant, #ced9e0)",
      minHeight: "28px",
      height: "28px",
      fontSize: "12px",
      boxShadow: state.isFocused
        ? "0 0 0 1px var(--md-sys-color-primary, #137cbd)"
        : "none",
      "&:hover": {
        borderColor: "var(--md-sys-color-primary, #137cbd)",
      },
    }),
    valueContainer: (provided: any) => ({
      ...provided,
      minHeight: "28px",
      height: "28px",
      padding: "0 6px",
    }),
    input: (provided: any) => ({
      ...provided,
      margin: "0px",
      padding: "0px",
      fontSize: "12px",
      color: "var(--md-sys-color-on-surface, inherit)",
    }),
    singleValue: (provided: any) => ({
      ...provided,
      fontSize: "12px",
      color: "var(--md-sys-color-on-surface, #182026)",
    }),
    placeholder: (provided: any) => ({
      ...provided,
      fontSize: "12px",
      color: "var(--md-sys-color-on-surface-variant, #8a9ba8)",
    }),
    indicatorSeparator: () => ({
      display: "none",
    }),
    indicatorsContainer: (provided: any) => ({
      ...provided,
      height: "28px",
    }),
    menu: (provided: any) => ({
      ...provided,
      zIndex: 9999,
      fontSize: "12px",
      minWidth: "220px",
      backgroundColor: "var(--md-sys-color-surface-container, #fff)",
      boxShadow:
        "0 0 0 1px var(--md-sys-color-outline-variant, rgba(16, 22, 26, 0.1)), 0 4px 8px rgba(0, 0, 0, 0.2)",
    }),
    option: (provided: any, state: any) => ({
      ...provided,
      padding: "5px 8px",
      backgroundColor: state.isSelected
        ? "var(--md-sys-color-primary, #137cbd)"
        : state.isFocused
          ? "var(--md-sys-color-surface-container-high, #ebf1f5)"
          : "transparent",
      color: state.isSelected
        ? "var(--md-sys-color-on-primary, #fff)"
        : "var(--md-sys-color-on-surface, #182026)",
      cursor: "pointer",
    }),
  };

  const colSelect = (
    <div
      className="filter-row-col-select"
      style={{ width: "220px", minWidth: "170px", flex: "0 0 auto" }}
    >
      <Select<ColumnSelectOption>
        className="filter-col-search-select"
        classNamePrefix="filter-col-search"
        value={selectedColOpt}
        onChange={handleColSelectChange}
        options={colOptions}
        placeholder="Search column..."
        isClearable={false}
        isSearchable={true}
        filterOption={createFilter({ ignoreCase: true, matchFrom: "any" })}
        formatOptionLabel={(opt) => (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              width: "100%",
            }}
          >
            <span
              style={{
                fontWeight: 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {opt.label}
            </span>
            {opt.colType && (
              <span
                style={{
                  fontSize: "10px",
                  color: "#8a9ba8",
                  marginLeft: "8px",
                  textTransform: "uppercase",
                  flexShrink: 0,
                }}
              >
                {opt.colType}
              </span>
            )}
          </div>
        )}
        styles={colSelectStyles}
      />
    </div>
  );

  let opChoices: JSX.Element[] = [];
  let opDisabled = false;
  if (columnId != null) {
    const colType = schema.columnType(columnId);
    let ops = reltab.columnTypeOps(colType);
    const isNumOrTime =
      reltab.colIsNumeric(colType) ||
      (colType &&
        (colType.kind === "integer" ||
          colType.kind === "real" ||
          colType.kind === "date" ||
          colType.kind === "timestamp" ||
          (typeof colType.sqlTypeName === "string" &&
            /int|float|double|decimal|numeric|time|date/i.test(
              colType.sqlTypeName
            ))));
    if (isNumOrTime) {
      ops = ops.filter(
        (opc) =>
          !reltab.opIsTextOnly(opc) &&
          opc !== "CONTAINS" &&
          opc !== "NOTCONTAINS" &&
          opc !== "BEGINS" &&
          opc !== "NOTBEGINS" &&
          opc !== "ENDS" &&
          opc !== "NOTENDS"
      );
    }
    opChoices = ops.map((opc, idx) => (
      <option key={"relop-" + idx} value={opc}>
        {reltab.opDisplayName(opc)}
      </option>
    ));
  } else {
    opDisabled = true;
  }
  const opVal = op === null ? "" : op;
  const opSelect = (
    <div className="bp4-select filter-row-op-select">
      <select
        value={opVal}
        disabled={opDisabled}
        onChange={(event) => handleOpSelect(event)}
      >
        <option value="">Operator...</option>
        {opChoices}
      </select>
    </div>
  );

  let valDisabled = columnId == null || op == null || !reltab.opIsBinary(op);

  let valInput: JSX.Element | null = null;
  if (columnId != null) {
    const columnType = schema.columnType(columnId);
    if (reltab.colIsNumeric(columnType)) {
      const numValue =
        value == null || (typeof value === "number" && isNaN(value))
          ? ""
          : value;
      valInput = (
        <NumericInput
          className="filter-editor-value"
          fill={true}
          onValueChange={handleNumericValueChange}
          placeholder="Value"
          disabled={valDisabled}
          value={numValue}
        />
      );
    }
    if (valInput == null) {
      const compVal = value == null ? "" : value;

      if (op === "IN" || op === "NOTIN") {
        const compVal = Array.isArray(value) ? (value as Option[]) : [];
        valInput = (
          <MultiTagPillInput
            value={compVal}
            disabled={valDisabled}
            distinctSuggestions={distinctSuggestions}
            onChange={(nextPills) => handleSelectChange(nextPills)}
          />
        );
      } else {
        valInput = (
          <SingleValueSuggestInput
            value={String(compVal)}
            disabled={valDisabled}
            distinctSuggestions={distinctSuggestions}
            onChange={(nextVal) => handleValueChange(nextVal)}
          />
        );
      }
    }
  }

  const clearStyle: React.CSSProperties = { clear: "both" };
  let rowClasses = "filter-editor-row";
  if (isSelected) rowClasses += " is-selected";
  if (isDragging) rowClasses += " is-dragging";
  if (dropPosition === "above") rowClasses += " drop-target-above";
  if (dropPosition === "below") rowClasses += " drop-target-below";

  return (
    <div
      className={rowClasses}
      onClick={onSelectRow}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      data-rule-id={rowId}
    >
      <div
        className="filter-drag-handle"
        draggable={true}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        title="Drag up/down to reorder, or drag into/out of groups"
      >
        <span className="bp4-icon bp4-icon-drag-handle-vertical" />
      </div>

      <div className="filter-editor-row-predicate">
        {colSelect}
        {opSelect}
        {valInput}
      </div>

      <div className="filter-row-actions">
        <Button
          className="bp4-minimal filter-btn-delete"
          icon="cross"
          small
          intent="danger"
          title="Delete condition"
          onClick={(e: any) => {
            e.stopPropagation();
            handleDeleteRow();
          }}
        />
      </div>
      <div id="clear" style={clearStyle} />
    </div>
  );
};
