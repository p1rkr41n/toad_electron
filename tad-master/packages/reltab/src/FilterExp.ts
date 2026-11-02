/**
 * AST for filter expressions, consisting of a tree of
 * nested conjuncts or disjuncts, with relational expressions
 * at the leaves.
 * In Haskell ADT syntax:
 *
 * data BoolOp = AND | OR
 * data FilterExp = FilterExp {op: BoolOp, opArgs: [SubExp] }
 * data SubExp = RelSub RelExp
 *           | FilterSub FilterExp
 * data BinaryRelOp = EQ | GT | GE | LT | LE
 * data UnaryRelOp = ISNULL | ISNOTNULL
 * data RelExp = BinaryRelExp {lhs: ValRef, op: RelOp, rhs: ValRef }
 *              | UnaryRelExp {op: UnaryRelOp, arg: ValRef }
 * data ValRef = ColRef Ident   -- for now; may extend to dot-delimited path
 *             | Const Literal
 * data Literal = LitNum Number | LitStr String
 */

import { SQLDialect } from "./dialect";
import { ValExp, sqlEscapeString } from "./defs";
import { deserializeValExp, valExpToSqlStr } from "./defs";
import { ColumnType } from "./ColumnType";

export type BinRelOp =
  | "EQ"
  | "NEQ"
  | "GT"
  | "GE"
  | "LT"
  | "LE"
  | "BEGINS"
  | "NOTBEGINS"
  | "ENDS"
  | "NOTENDS"
  | "CONTAINS"
  | "NOTCONTAINS"
  | "IN"
  | "NOTIN";
export type UnaryRelOp = "ISNULL" | "NOTNULL";
export type RelOp = UnaryRelOp | BinRelOp;
const textOnlyBinaryOps: RelOp[] = [
  "IN",
  "NOTIN",
  "BEGINS",
  "NOTBEGINS",
  "ENDS",
  "NOTENDS",
  "CONTAINS",
  "NOTCONTAINS",
];
const textOnlyOpsSet = new Set(textOnlyBinaryOps);
const textNegBinaryOps: RelOp[] = [
  "NOTIN",
  "NOTBEGINS",
  "NOTENDS",
  "NOTCONTAINS",
];
const textNegOpsSet = new Set(textNegBinaryOps);
const commonBinaryOps: RelOp[] = ["EQ", "NEQ", "GT", "GE", "LT", "LE"];
const binaryOps = commonBinaryOps.concat(textOnlyBinaryOps);
const binaryOpsSet = new Set(binaryOps);
const unaryOps: RelOp[] = ["ISNULL", "NOTNULL"];
const unaryOpsSet = new Set(unaryOps);
const ppOpMap = {
  EQ: "=",
  NEQ: "<>",
  GT: ">",
  GE: ">=",
  LT: "<",
  LE: "<=",
  ISNULL: "is null",
  NOTNULL: "is not null",
  BEGINS: "starts with",
  NOTBEGINS: "does not start with",
  ENDS: "ends with",
  NOTENDS: "does not end with",
  CONTAINS: "contains",
  NOTCONTAINS: "does not contain",
  IN: "in...",
  NOTIN: "not in...",
};
export const opIsTextOnly = (op: RelOp): boolean => {
  return textOnlyOpsSet.has(op);
};
export const opIsUnary = (op: RelOp): boolean => {
  return unaryOpsSet.has(op);
};
export const opIsBinary = (op: RelOp): boolean => {
  return binaryOpsSet.has(op);
};
const textOps = textOnlyBinaryOps.concat(commonBinaryOps).concat(unaryOps);
const numOps = commonBinaryOps.concat(unaryOps);
export const columnTypeOps = (ct: ColumnType): Array<RelOp> => {
  if (ct.kind === "string") {
    return textOps;
  }

  return numOps;
};
export const opDisplayName = (op: RelOp): string => {
  return ppOpMap[op];
};

const textOpToSqlWhere = (
  dialect: SQLDialect,
  lhs: ValExp,
  op: BinRelOp,
  rhs: ValExp
): string => {
  if (rhs.expType !== "ConstVal") {
    throw new Error(
      "textOpToSqlWhere: only constants supported for rhs of text ops"
    );
  }

  const negStr = textNegOpsSet.has(op) ? "NOT " : "";
  let ret;

  if (op === "IN" || op === "NOTIN") {
    const inVals: Array<string> = rhs.val as any;
    const hasSlashes = inVals && inVals.some((v) => /[\\\/]/.test(String(v)));
    if (hasSlashes && dialect.dialectName === "duckdb") {
      const inNorm = inVals
        .map((v) => sqlEscapeString(String(v).replace(/[\\\/]+/g, "/")))
        .join(", ");
      ret =
        "REGEXP_REPLACE(" +
        valExpToSqlStr(dialect, lhs) +
        "::VARCHAR, '[\\\\/]+', '/', 'g') " +
        negStr +
        "IN (" +
        inNorm +
        ")";
    } else {
      const inStr = inVals.map(sqlEscapeString).join(", ");
      ret = valExpToSqlStr(dialect, lhs) + " " + negStr + "IN (" + inStr + ")";
    }
  } else {
    const rhsStr = String(rhs.val ?? "");
    let matchStr = "";
    const hasSlashes = /[\\\/]/.test(rhsStr);

    if (hasSlashes && dialect.dialectName === "duckdb") {
      const normTerm = rhsStr
        .replace(/[\\\/]+/g, "/")
        .replace(/%/g, "\\%")
        .replace(/_/g, "\\_");

      switch (op) {
        case "BEGINS":
        case "NOTBEGINS":
          matchStr = normTerm + "%";
          break;
        case "ENDS":
        case "NOTENDS":
          matchStr = "%" + normTerm;
          break;
        case "CONTAINS":
        case "NOTCONTAINS":
          matchStr = "%" + normTerm + "%";
          break;
        default:
          throw new Error("Unknown operator: " + op);
      }

      ret =
        "REGEXP_REPLACE(" +
        valExpToSqlStr(dialect, lhs) +
        "::VARCHAR, '[\\\\/]+', '/', 'g') " +
        negStr +
        "ILIKE " +
        sqlEscapeString(matchStr) +
        " ESCAPE '\\'";
    } else {
      // Escape LIKE/ILIKE control characters: \, %, _ to prevent pattern corruption
      const sanitizedRhsStr = rhsStr
        .replace(/\\/g, "\\\\")
        .replace(/%/g, "\\%")
        .replace(/_/g, "\\_");

      switch (op) {
        case "BEGINS":
        case "NOTBEGINS":
          matchStr = sanitizedRhsStr + "%";
          break;
        case "ENDS":
        case "NOTENDS":
          matchStr = "%" + sanitizedRhsStr;
          break;
        case "CONTAINS":
        case "NOTCONTAINS":
          matchStr = "%" + sanitizedRhsStr + "%";
          break;
        default:
          throw new Error("Unknown operator: " + op);
      }

      ret =
        valExpToSqlStr(dialect, lhs) +
        "::VARCHAR " +
        negStr +
        "ILIKE " +
        sqlEscapeString(matchStr) +
        " ESCAPE '\\'";
    }
  }

  return ret;
};

export class OmniSearchRelExp {
  expType: "OmniSearchRelExp";
  searchTerm: string;
  columns: Array<string>;

  constructor(searchTerm: string, columns: Array<string> = []) {
    this.expType = "OmniSearchRelExp";
    this.searchTerm = searchTerm;
    this.columns = columns;
  }

  toSqlWhere(dialect: SQLDialect): string {
    if (
      !this.searchTerm ||
      this.searchTerm.trim() === "" ||
      !this.columns ||
      this.columns.length === 0
    ) {
      return "";
    }
    const colCasts = this.columns
      .filter((c) => !c.startsWith("_"))
      .map((c) => dialect.quoteCol(c) + "::VARCHAR")
      .join(", ");

    const hasSlashes = /[\\\/]/.test(this.searchTerm);
    if (hasSlashes && dialect.dialectName === "duckdb") {
      const normSearch = this.searchTerm
        .replace(/[\\\/]+/g, "/")
        .replace(/%/g, "\\%")
        .replace(/_/g, "\\_")
        .replace(/'/g, "''");
      return `REGEXP_REPLACE(CONCAT_WS(' ', ${colCasts}), '[\\\\/]+', '/', 'g') ILIKE '%${normSearch}%' ESCAPE '\\'`;
    }

    const sanitizedSearch = this.searchTerm
      .replace(/\\/g, "\\\\")
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_")
      .replace(/'/g, "''");
    return `CONCAT_WS(' ', ${colCasts}) ILIKE '%${sanitizedSearch}%' ESCAPE '\\'`;
  }

  lhsCol(): string {
    return "*";
  }
}

export class BinRelExp {
  expType: "BinRelExp";
  op: BinRelOp;
  lhs: ValExp;
  rhs: ValExp;

  constructor(op: BinRelOp, lhs: ValExp, rhs: ValExp) {
    this.expType = "BinRelExp";
    this.op = op;
    this.lhs = lhs;
    this.rhs = rhs;
  }

  toSqlWhere(dialect: SQLDialect): string {
    if (opIsTextOnly(this.op)) {
      return textOpToSqlWhere(dialect, this.lhs, this.op, this.rhs);
    }

    if (
      (this.op === "EQ" || this.op === "NEQ") &&
      dialect.dialectName === "duckdb"
    ) {
      const rhsValStr =
        this.rhs.expType === "ConstVal" ? String(this.rhs.val ?? "") : "";
      if (rhsValStr && /[\\\/]/.test(rhsValStr)) {
        const normVal = rhsValStr.replace(/[\\\/]+/g, "/");
        const eqOp = this.op === "EQ" ? "=" : "<>";
        return `REGEXP_REPLACE(${valExpToSqlStr(
          dialect,
          this.lhs
        )}::VARCHAR, '[\\\\/]+', '/', 'g') ${eqOp} ${sqlEscapeString(normVal)}`;
      }
    }

    return (
      valExpToSqlStr(dialect, this.lhs) +
      ppOpMap[this.op] +
      valExpToSqlStr(dialect, this.rhs)
    );
  }


  lhsCol(): string {
    if (this.lhs.expType !== "ColRef") {
      throw new Error("Unexpected non-colref arg expType: " + this.lhs);
    }

    return this.lhs.colName;
  }
}
export class UnaryRelExp {
  expType: "UnaryRelExp";
  op: UnaryRelOp;
  arg: ValExp;

  constructor(op: UnaryRelOp, arg: ValExp) {
    this.expType = "UnaryRelExp";
    this.op = op;
    this.arg = arg;
  }

  toSqlWhere(dialect: SQLDialect): string {
    return valExpToSqlStr(dialect, this.arg) + " " + ppOpMap[this.op];
  }

  lhsCol(): string {
    if (this.arg.expType !== "ColRef") {
      throw new Error("Unexpected non-colref arg expType: " + this.arg);
    }

    return this.arg.colName;
  }
}

export class RawSqlRelExp {
  expType: "RawSqlRelExp";
  sqlPredicate: string;

  constructor(sqlPredicate: string) {
    this.expType = "RawSqlRelExp";
    this.sqlPredicate = sqlPredicate;
  }

  toSqlWhere(dialect: SQLDialect): string {
    return this.sqlPredicate || "";
  }

  lhsCol(): string {
    return "*";
  }
}

export type RelExp = BinRelExp | UnaryRelExp | OmniSearchRelExp | RawSqlRelExp;
export type SubExp = RelExp | FilterExp;
export type BoolOp = "AND" | "OR";

const deserializeSubExp = (jsExp: any): SubExp => {
  if (jsExp.expType === "FilterExp") {
    return FilterExp.deserialize(jsExp);
  } else if (jsExp.expType === "UnaryRelExp") {
    const arg = deserializeValExp(jsExp.arg);
    return new UnaryRelExp(jsExp.op, arg);
  } else if (jsExp.expType === "OmniSearchRelExp") {
    return new OmniSearchRelExp(jsExp.searchTerm, jsExp.columns);
  } else if (jsExp.expType === "RawSqlRelExp") {
    return new RawSqlRelExp(jsExp.sqlPredicate);
  } else {
    const lhs = deserializeValExp(jsExp.lhs);
    const rhs = deserializeValExp(jsExp.rhs);
    return new BinRelExp(jsExp.op, lhs, rhs);
  }
};

export class FilterExp {
  expType: "FilterExp";
  op: BoolOp;
  opArgs: Array<SubExp>;

  constructor(op: BoolOp = "AND", opArgs: Array<SubExp> = []) {
    this.expType = "FilterExp";
    this.op = op;
    this.opArgs = opArgs;
  }

  static deserialize(jsObj: any): FilterExp {
    const opArgs = (jsObj.opArgs || []).map(deserializeSubExp);
    return new FilterExp(jsObj.op, opArgs);
  } // chained operator constructors for relational expressions:

  chainBinRelExp(op: BinRelOp, lhs: ValExp, rhs: ValExp): FilterExp {
    const relExp = new BinRelExp(op, lhs, rhs);
    const extOpArgs = this.opArgs.concat(relExp);
    return new FilterExp(this.op, extOpArgs);
  }

  chainUnaryRelExp(op: UnaryRelOp, arg: ValExp): FilterExp {
    const relExp = new UnaryRelExp(op, arg);
    const extOpArgs = this.opArgs.concat(relExp);
    return new FilterExp(this.op, extOpArgs);
  }

  eq(lhs: ValExp, rhs: ValExp): FilterExp {
    return this.chainBinRelExp("EQ", lhs, rhs);
  }

  gt(lhs: ValExp, rhs: ValExp): FilterExp {
    return this.chainBinRelExp("GT", lhs, rhs);
  }

  ge(lhs: ValExp, rhs: ValExp): FilterExp {
    return this.chainBinRelExp("GE", lhs, rhs);
  }

  lt(lhs: ValExp, rhs: ValExp): FilterExp {
    return this.chainBinRelExp("LT", lhs, rhs);
  }

  le(lhs: ValExp, rhs: ValExp): FilterExp {
    return this.chainBinRelExp("LE", lhs, rhs);
  }

  isNull(arg: ValExp): FilterExp {
    return this.chainUnaryRelExp("ISNULL", arg);
  }

  isNotNull(arg: ValExp): FilterExp {
    return this.chainUnaryRelExp("NOTNULL", arg);
  }

  contains(lhs: ValExp, rhs: ValExp): FilterExp {
    return this.chainBinRelExp("CONTAINS", lhs, rhs);
  }

  subExp(sub: FilterExp): FilterExp {
    const extOpArgs = this.opArgs.concat(sub);
    return new FilterExp(this.op, extOpArgs);
  }

  toSqlWhere(dialect: SQLDialect): string {
    const strs = this.opArgs
      .map((subExp: any) => {
        if (!subExp) {
          return "";
        }
        let effectiveSubExp = subExp;
        if (typeof effectiveSubExp.toSqlWhere !== "function") {
          try {
            effectiveSubExp = deserializeSubExp(subExp);
          } catch (err) {
            console.warn(
              "FilterExp.toSqlWhere: failed to deserialize subExp:",
              subExp,
              err
            );
            return "";
          }
        }
        if (typeof effectiveSubExp.toSqlWhere !== "function") {
          return "";
        }
        const subStr = effectiveSubExp.toSqlWhere(dialect);
        if (!subStr || subStr.trim().length === 0) {
          return "";
        }
        if (effectiveSubExp.expType === "FilterExp") {
          return "(" + subStr + ")";
        }
        return subStr;
      })
      .filter((s) => s.length > 0);

    if (strs.length === 0) {
      return "";
    }
    const opStr = " " + this.op + " ";
    return strs.join(opStr);
  }
}
export const and = (): FilterExp => new FilterExp("AND");
export const or = (): FilterExp => new FilterExp("OR");
