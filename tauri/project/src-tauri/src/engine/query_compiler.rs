//! query_compiler.rs
//!
//! Native Rust QueryExp AST to DuckDB SQL Compiler for Toad Desktop
//! Translates JSON-serialized QueryExp AST into optimized DuckDB SQL.

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ============================================================================
// AST DATA STRUCTURES
// ============================================================================

/// Top-level Query payload received from Tauri IPC
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum QueryExpInput {
    Wrapped {
        #[serde(rename = "expType")]
        _exp_type: Option<String>,
        #[serde(rename = "_rep")]
        rep: Box<QueryRep>,
    },
    Direct(Box<QueryRep>),
    RawSql(String),
}

/// Relational Operators (tagged by "operator" or "expType")
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "operator")]
pub enum QueryRep {
    #[serde(rename = "table", alias = "Table")]
    Table {
        #[serde(alias = "tableName", alias = "table_name")]
        table_name: String,
    },
    #[serde(rename = "sql", alias = "Sql")]
    Sql {
        #[serde(alias = "sqlQuery", alias = "sql_query")]
        sql_query: String,
    },
    #[serde(rename = "project", alias = "Project")]
    Project {
        cols: Vec<String>,
        from: Box<QueryRep>,
    },
    #[serde(rename = "filter", alias = "Filter")]
    Filter {
        #[serde(alias = "fexp", alias = "filterExp")]
        fexp: FilterExp,
        from: Box<QueryRep>,
    },
    #[serde(rename = "groupBy", alias = "GroupBy", alias = "groupby")]
    GroupBy {
        cols: Vec<String>,
        #[serde(default)]
        aggs: Vec<AggColSpec>,
        from: Box<QueryRep>,
    },
    #[serde(rename = "sort", alias = "Sort")]
    Sort {
        #[serde(alias = "keys", alias = "sortCols")]
        keys: Vec<SortKey>,
        from: Box<QueryRep>,
    },
    #[serde(rename = "extend", alias = "Extend")]
    Extend {
        #[serde(alias = "colId", alias = "col_id")]
        col_id: String,
        #[serde(alias = "colExp", alias = "col_exp")]
        col_exp: ColumnExtendExp,
        opts: Option<Value>,
        from: Box<QueryRep>,
    },
    #[serde(rename = "join", alias = "Join")]
    Join {
        lhs: Box<QueryRep>,
        rhs: Box<QueryRep>,
        #[serde(default, deserialize_with = "deserialize_join_on")]
        on: Vec<String>,
        #[serde(rename = "joinType", alias = "join_type")]
        join_type: Option<String>,
    },
    #[serde(rename = "concat", alias = "Concat")]
    Concat {
        from: Box<QueryRep>,
        target: Box<QueryRep>,
    },
    #[serde(rename = "mapColumns", alias = "MapColumns")]
    MapColumns {
        cmap: Value,
        from: Box<QueryRep>,
    },
    #[serde(rename = "mapColumnsByIndex", alias = "MapColumnsByIndex")]
    MapColumnsByIndex {
        cmap: Value,
        from: Box<QueryRep>,
    },
}

fn deserialize_join_on<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let val: Value = Deserialize::deserialize(deserializer)?;
    match val {
        Value::String(s) => Ok(vec![s]),
        Value::Array(arr) => Ok(arr
            .into_iter()
            .filter_map(|v| match v {
                Value::String(s) => Some(s),
                _ => None,
            })
            .collect()),
        _ => Ok(Vec::new()),
    }
}

/// Aggregation Specification: String ("col") or Tuple (["sum", "col"]) or Object
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum AggColSpec {
    ColOnly(String),
    Tuple(String, String), // (agg_fn, col_name)
    Object {
        #[serde(alias = "aggFn", alias = "fn")]
        fn_name: String,
        col: String,
        #[serde(rename = "as")]
        as_name: Option<String>,
    },
}

/// Sort Specification: [col_name, is_asc] or Object
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum SortKey {
    Tuple(String, bool), // (col_name, is_asc)
    Object {
        col: String,
        #[serde(default = "default_asc")]
        asc: bool,
    },
}

fn default_asc() -> bool {
    true
}

/// Filter Expression Tree
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum FilterExp {
    Compound(CompoundFilterExp),
    Single(SubExp),
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CompoundFilterExp {
    #[serde(default = "default_bool_op")]
    pub op: String, // "AND" | "OR" | "NOT"
    #[serde(rename = "opArgs", alias = "op_args")]
    pub op_args: Vec<SubExp>,
}

fn default_bool_op() -> String {
    "AND".to_string()
}

/// Sub-expression in a filter tree
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum SubExp {
    NestedFilter(CompoundFilterExp),
    BinaryFilter {
        op: String,
        lhs: Box<SubExp>,
        rhs: Box<SubExp>,
    },
    UnaryNot {
        op: String,
        lhs: Box<SubExp>,
    },
    BinRel(BinRelExp),
    UnaryRel(UnaryRelExp),
    OmniSearch(OmniSearchRelExp),
    RawSql(RawSqlRelExp),
    Shorthand(ShorthandRelExp),
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BinRelExp {
    #[serde(rename = "expType")]
    pub exp_type: String,
    pub op: String, // EQ, NEQ, GT, GE, LT, LE, BEGINS, ENDS, CONTAINS, IN, etc.
    pub lhs: ValExp,
    pub rhs: ValExp,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct UnaryRelExp {
    #[serde(rename = "expType")]
    pub exp_type: String,
    pub op: String, // ISNULL, NOTNULL
    pub arg: ValExp,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OmniSearchRelExp {
    #[serde(rename = "expType")]
    pub exp_type: String,
    #[serde(rename = "searchTerm", alias = "search_term")]
    pub search_term: String,
    #[serde(default)]
    pub columns: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RawSqlRelExp {
    #[serde(rename = "expType")]
    pub exp_type: String,
    #[serde(rename = "sqlPredicate", alias = "sql_predicate")]
    pub sql_predicate: String,
}

/// Shorthand relational expression used in test_e2e_features.js
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ShorthandRelExp {
    pub op: String,
    pub lhs: Value,
    pub rhs: Option<Value>,
}

/// Value Expression
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum ValExp {
    Typed(TypedValExp),
    Literal(Value),
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "expType")]
pub enum TypedValExp {
    #[serde(rename = "ColRef")]
    ColRef {
        #[serde(rename = "colName", alias = "col_name")]
        col_name: String,
        #[serde(rename = "tblAlias", alias = "tbl_alias")]
        tbl_alias: Option<String>,
    },
    #[serde(rename = "ConstVal")]
    ConstVal { val: Value },
    #[serde(rename = "BinValExp")]
    BinValExp {
        op: String,
        lhs: Box<ValExp>,
        rhs: Box<ValExp>,
    },
    #[serde(rename = "UnaryValExp")]
    UnaryValExp {
        op: String,
        arg: Box<ValExp>,
    },
    #[serde(rename = "AsString")]
    AsString {
        #[serde(rename = "valExp")]
        val_exp: Box<ValExp>,
    },
    #[serde(rename = "CastExp")]
    CastExp {
        #[serde(rename = "subExp")]
        sub_exp: Box<ValExp>,
        #[serde(rename = "asType")]
        as_type: Value,
    },
}

pub type ColumnExtendExp = ValExp;

// ============================================================================
// SQL COMPILATION ENGINE
// ============================================================================

pub struct QueryExpCompiler;

impl QueryExpCompiler {
    /// Compiles a QueryRep AST into an executable DuckDB SQL statement
    pub fn compile(rep: &QueryRep, offset: Option<i64>, limit: Option<i64>) -> Result<String, String> {
        let mut depth = 0;
        let base_sql = Self::compile_rec(rep, &mut depth)?;
        let mut sql = base_sql;

        if let Some(lim) = limit {
            sql = format!("{} LIMIT {}", sql, lim);
        }
        if let Some(off) = offset {
            sql = format!("{} OFFSET {}", sql, off);
        }

        Ok(sql)
    }

    /// Compiles a QueryRep AST into a row count SQL statement
    pub fn compile_count(rep: &QueryRep) -> Result<String, String> {
        let mut depth = 0;
        let sub_sql = Self::compile_rec(rep, &mut depth)?;
        Ok(format!("SELECT COUNT(*) AS \"rowCount\" FROM ({}) AS _count_sub", sub_sql))
    }

    /// O(1) Fast Parquet Metadata Count
    pub fn fast_parquet_count(file_path: &str) -> String {
        let escaped = file_path.replace('\'', "''");
        format!(
            "SELECT COALESCE(SUM(row_group_num_rows), 0) AS total_rows FROM parquet_metadata('{}')",
            escaped
        )
    }

    /// Parse an untyped JSON value into a QueryRep
    pub fn parse_query_exp(val: &Value) -> Result<QueryRep, String> {
        // Case 1: Value is JSON string
        if let Value::String(s) = val {
            if let Ok(parsed) = serde_json::from_str::<Value>(s) {
                return Self::parse_query_exp(&parsed);
            }
            return Ok(QueryRep::Sql { sql_query: s.clone() });
        }

        // Case 2: Object with operator or expType
        if let Value::Object(obj) = val {
            // Check if wrapped in QueryExp
            if let Some(rep_val) = obj.get("_rep") {
                return Self::parse_query_exp(rep_val);
            }

            // If operator is specified
            if obj.contains_key("operator") {
                return serde_json::from_value::<QueryRep>(val.clone())
                    .map_err(|e| format!("Failed to deserialize QueryRep: {}", e));
            }

            // Fallback for expType tag
            if let Some(Value::String(exp_type)) = obj.get("expType") {
                match exp_type.as_str() {
                    "table" => {
                        let name = obj
                            .get("tableName")
                            .or_else(|| obj.get("table_name"))
                            .and_then(|v| v.as_str())
                            .ok_or_else(|| "Missing tableName in table query".to_string())?;
                        return Ok(QueryRep::Table { table_name: name.to_string() });
                    }
                    "sql" => {
                        let query = obj
                            .get("sqlQuery")
                            .or_else(|| obj.get("sql_query"))
                            .or_else(|| obj.get("sql"))
                            .and_then(|v| v.as_str())
                            .ok_or_else(|| "Missing sqlQuery in sql query".to_string())?;
                        return Ok(QueryRep::Sql { sql_query: query.to_string() });
                    }
                    "project" => {
                        let cols_val = obj.get("cols").ok_or_else(|| "Missing cols in project query".to_string())?;
                        let cols: Vec<String> = serde_json::from_value(cols_val.clone())
                            .map_err(|e| format!("Invalid cols: {}", e))?;
                        let from_val = obj.get("from").ok_or_else(|| "Missing from in project query".to_string())?;
                        let from = Self::parse_query_exp(from_val)?;
                        return Ok(QueryRep::Project { cols, from: Box::new(from) });
                    }
                    "filter" => {
                        let from_val = obj.get("from").ok_or_else(|| "Missing from in filter query".to_string())?;
                        let from = Self::parse_query_exp(from_val)?;
                        let fexp_val = obj.get("filterExp").or_else(|| obj.get("fexp"))
                            .ok_or_else(|| "Missing filterExp in filter query".to_string())?;
                        let fexp: FilterExp = serde_json::from_value(fexp_val.clone())
                            .map_err(|e| format!("Invalid filterExp: {}", e))?;
                        return Ok(QueryRep::Filter { fexp, from: Box::new(from) });
                    }
                    "sort" => {
                        let from_val = obj.get("from").ok_or_else(|| "Missing from in sort query".to_string())?;
                        let from = Self::parse_query_exp(from_val)?;
                        let keys_val = obj.get("sortCols").or_else(|| obj.get("keys"))
                            .ok_or_else(|| "Missing sortCols in sort query".to_string())?;
                        let keys: Vec<SortKey> = serde_json::from_value(keys_val.clone())
                            .map_err(|e| format!("Invalid sort keys: {}", e))?;
                        return Ok(QueryRep::Sort { keys, from: Box::new(from) });
                    }
                    "groupBy" => {
                        let from_val = obj.get("from").ok_or_else(|| "Missing from in groupBy query".to_string())?;
                        let from = Self::parse_query_exp(from_val)?;
                        let cols_val = obj.get("cols").ok_or_else(|| "Missing cols in groupBy query".to_string())?;
                        let cols: Vec<String> = serde_json::from_value(cols_val.clone())
                            .map_err(|e| format!("Invalid groupBy cols: {}", e))?;
                        let aggs = if let Some(aggs_val) = obj.get("aggs") {
                            serde_json::from_value::<Vec<AggColSpec>>(aggs_val.clone())
                                .map_err(|e| format!("Invalid groupBy aggs: {}", e))?
                        } else {
                            Vec::new()
                        };
                        return Ok(QueryRep::GroupBy { cols, aggs, from: Box::new(from) });
                    }
                    other => {
                        return Err(format!("Unsupported expType: {}", other));
                    }
                }
            }
        }

        // Try direct deserialization into QueryExpInput
        match serde_json::from_value::<QueryExpInput>(val.clone()) {
            Ok(QueryExpInput::Wrapped { rep, .. }) => Ok(*rep),
            Ok(QueryExpInput::Direct(rep)) => Ok(*rep),
            Ok(QueryExpInput::RawSql(sql)) => Ok(QueryRep::Sql { sql_query: sql }),
            Err(e) => Err(format!("Unable to parse QueryExp: {}. Payload: {:?}", e, val)),
        }
    }

    fn compile_rec(rep: &QueryRep, depth: &mut usize) -> Result<String, String> {
        *depth += 1;
        let alias = format!("_t{}", *depth);

        match rep {
            QueryRep::Table { table_name } => {
                Ok(format!("SELECT * FROM {}", Self::quote_ident(table_name)))
            }
            QueryRep::Sql { sql_query } => {
                Ok(format!("SELECT * FROM ({}) AS {}", sql_query.trim().trim_end_matches(';'), alias))
            }
            QueryRep::Project { cols, from } => {
                let sub = Self::compile_rec(from, depth)?;
                let col_list = cols
                    .iter()
                    .map(|c| Self::quote_ident(c))
                    .collect::<Vec<_>>()
                    .join(", ");
                Ok(format!("SELECT {} FROM ({}) AS {}", col_list, sub, alias))
            }
            QueryRep::Filter { fexp, from } => {
                let sub = Self::compile_rec(from, depth)?;
                let where_clause = Self::compile_filter(fexp)?;
                if where_clause.is_empty() {
                    Ok(format!("SELECT * FROM ({}) AS {}", sub, alias))
                } else {
                    Ok(format!("SELECT * FROM ({}) AS {} WHERE {}", sub, alias, where_clause))
                }
            }
            QueryRep::GroupBy { cols, aggs, from } => {
                let sub = Self::compile_rec(from, depth)?;
                let group_cols = cols
                    .iter()
                    .map(|c| Self::quote_ident(c))
                    .collect::<Vec<_>>()
                    .join(", ");

                let mut select_items = cols
                    .iter()
                    .map(|c| Self::quote_ident(c))
                    .collect::<Vec<_>>();

                for agg in aggs {
                    match agg {
                        AggColSpec::ColOnly(c) => {
                            select_items.push(format!("SUM({}) AS {}", Self::quote_ident(c), Self::quote_ident(c)));
                        }
                        AggColSpec::Tuple(fn_name, c) => {
                            let agg_expr = Self::compile_agg_fn(fn_name, c);
                            select_items.push(format!("{} AS {}", agg_expr, Self::quote_ident(c)));
                        }
                        AggColSpec::Object { fn_name, col, as_name } => {
                            let out_name = as_name.as_deref().unwrap_or(col);
                            let agg_expr = Self::compile_agg_fn(fn_name, col);
                            select_items.push(format!("{} AS {}", agg_expr, Self::quote_ident(out_name)));
                        }
                    }
                }

                let select_clause = select_items.join(", ");
                if group_cols.is_empty() {
                    Ok(format!("SELECT {} FROM ({}) AS {}", select_clause, sub, alias))
                } else {
                    Ok(format!("SELECT {} FROM ({}) AS {} GROUP BY {}", select_clause, sub, alias, group_cols))
                }
            }
            QueryRep::Sort { keys, from } => {
                let sub = Self::compile_rec(from, depth)?;
                let order_clauses = keys
                    .iter()
                    .map(|k| match k {
                        SortKey::Tuple(col, asc) => {
                            let dir = if *asc { "ASC NULLS LAST" } else { "DESC NULLS LAST" };
                            format!("{} {}", Self::quote_ident(col), dir)
                        }
                        SortKey::Object { col, asc } => {
                            let dir = if *asc { "ASC NULLS LAST" } else { "DESC NULLS LAST" };
                            format!("{} {}", Self::quote_ident(col), dir)
                        }
                    })
                    .collect::<Vec<_>>()
                    .join(", ");

                if order_clauses.is_empty() {
                    Ok(format!("SELECT * FROM ({}) AS {}", sub, alias))
                } else {
                    Ok(format!("SELECT * FROM ({}) AS {} ORDER BY {}", sub, alias, order_clauses))
                }
            }
            QueryRep::Extend { col_id, col_exp, opts: _, from } => {
                let sub = Self::compile_rec(from, depth)?;
                let exp_sql = Self::compile_val_exp(col_exp)?;
                Ok(format!(
                    "SELECT *, ({}) AS {} FROM ({}) AS {}",
                    exp_sql,
                    Self::quote_ident(col_id),
                    sub,
                    alias
                ))
            }
            QueryRep::Join { lhs, rhs, on, join_type } => {
                let lhs_sql = Self::compile_rec(lhs, depth)?;
                let rhs_sql = Self::compile_rec(rhs, depth)?;
                let jt = join_type.as_deref().unwrap_or("LEFT OUTER JOIN");
                let on_clause = on
                    .iter()
                    .map(|c| format!("_lhs.{} = _rhs.{}", Self::quote_ident(c), Self::quote_ident(c)))
                    .collect::<Vec<_>>()
                    .join(" AND ");

                Ok(format!(
                    "SELECT * FROM ({}) AS _lhs {} ({}) AS _rhs ON {}",
                    lhs_sql, jt, rhs_sql, on_clause
                ))
            }
            QueryRep::Concat { from, target } => {
                let s1 = Self::compile_rec(from, depth)?;
                let s2 = Self::compile_rec(target, depth)?;
                Ok(format!("({}) UNION ALL ({})", s1, s2))
            }
            QueryRep::MapColumns { cmap: _, from } => {
                Self::compile_rec(from, depth)
            }
            QueryRep::MapColumnsByIndex { cmap: _, from } => {
                Self::compile_rec(from, depth)
            }
        }
    }

    fn compile_agg_fn(fn_name: &str, col: &str) -> String {
        let q_col = Self::quote_ident(col);
        match fn_name.to_lowercase().as_str() {
            "uniq" => format!(
                "CASE WHEN MIN({col}) = MAX({col}) THEN MIN({col}) ELSE NULL END",
                col = q_col
            ),
            "null" | "nullstr" => "NULL".to_string(),
            "count" => {
                if col == "*" {
                    "COUNT(*)".to_string()
                } else {
                    format!("COUNT({})", q_col)
                }
            }
            "sum" => format!("SUM({})", q_col),
            "avg" => format!("AVG({})", q_col),
            "min" => format!("MIN({})", q_col),
            "max" => format!("MAX({})", q_col),
            "approx_unique" | "distinct" => format!("APPROX_COUNT_DISTINCT({})", q_col),
            other => format!("{}({})", other.to_uppercase(), q_col),
        }
    }

    pub fn compile_filter(fexp: &FilterExp) -> Result<String, String> {
        match fexp {
            FilterExp::Compound(comp) => {
                let mut clauses = Vec::new();
                for sub in &comp.op_args {
                    let cl = Self::compile_sub_exp(sub)?;
                    if !cl.is_empty() {
                        clauses.push(cl);
                    }
                }
                if clauses.is_empty() {
                    return Ok(String::new());
                }
                let sep = format!(" {} ", comp.op.to_uppercase());
                Ok(clauses.join(&sep))
            }
            FilterExp::Single(sub) => Self::compile_sub_exp(sub),
        }
    }

    fn compile_sub_exp(sub: &SubExp) -> Result<String, String> {
        match sub {
            SubExp::NestedFilter(fe) => {
                let inner = Self::compile_filter(&FilterExp::Compound(fe.clone()))?;
                if inner.is_empty() {
                    Ok(String::new())
                } else {
                    Ok(format!("({})", inner))
                }
            }
            SubExp::BinaryFilter { op, lhs, rhs } => {
                let l = Self::compile_sub_exp(lhs)?;
                let r = Self::compile_sub_exp(rhs)?;
                if l.is_empty() {
                    Ok(r)
                } else if r.is_empty() {
                    Ok(l)
                } else {
                    Ok(format!("({} {} {})", l, op.to_uppercase(), r))
                }
            }
            SubExp::UnaryNot { lhs, .. } => {
                let l = Self::compile_sub_exp(lhs)?;
                if l.is_empty() {
                    Ok(String::new())
                } else {
                    Ok(format!("NOT ({})", l))
                }
            }
            SubExp::BinRel(br) => Self::compile_bin_rel(&br.op, &br.lhs, &br.rhs),
            SubExp::UnaryRel(ur) => {
                let arg = Self::compile_val_exp(&ur.arg)?;
                match ur.op.to_uppercase().as_str() {
                    "ISNULL" => Ok(format!("{} IS NULL", arg)),
                    "NOTNULL" | "NOTISNULL" => Ok(format!("{} IS NOT NULL", arg)),
                    _ => Err(format!("Unsupported unary rel op: {}", ur.op)),
                }
            }
            SubExp::OmniSearch(os) => {
                if os.search_term.trim().is_empty() || os.columns.is_empty() {
                    return Ok(String::new());
                }
                let col_casts = os
                    .columns
                    .iter()
                    .filter(|c| !c.starts_with('_'))
                    .map(|c| format!("{}::VARCHAR", Self::quote_ident(c)))
                    .collect::<Vec<_>>()
                    .join(", ");

                let has_slashes = os.search_term.contains('/') || os.search_term.contains('\\');
                let sanitized = Self::escape_ilike_term(&os.search_term, has_slashes);

                if has_slashes {
                    Ok(format!(
                        "REGEXP_REPLACE(CONCAT_WS(' ', {}), '[\\\\/]+', '/', 'g') ILIKE '%{}%' ESCAPE '\\'",
                        col_casts, sanitized
                    ))
                } else {
                    Ok(format!(
                        "CONCAT_WS(' ', {}) ILIKE '%{}%' ESCAPE '\\'",
                        col_casts, sanitized
                    ))
                }
            }
            SubExp::RawSql(rs) => Ok(rs.sql_predicate.clone()),
            SubExp::Shorthand(sh) => {
                let op_up = sh.op.to_uppercase();
                if op_up == "AND" || op_up == "OR" {
                    let lhs_sub: SubExp = serde_json::from_value(sh.lhs.clone())
                        .map_err(|e| format!("Failed to parse shorthand {} lhs: {}", op_up, e))?;
                    let rhs_sub: SubExp = match &sh.rhs {
                        Some(v) => serde_json::from_value(v.clone())
                            .map_err(|e| format!("Failed to parse shorthand {} rhs: {}", op_up, e))?,
                        None => return Err(format!("Missing rhs in binary {} filter", op_up)),
                    };
                    return Self::compile_sub_exp(&SubExp::BinaryFilter {
                        op: op_up,
                        lhs: Box::new(lhs_sub),
                        rhs: Box::new(rhs_sub),
                    });
                }
                if op_up == "NOT" {
                    let lhs_sub: SubExp = serde_json::from_value(sh.lhs.clone())
                        .map_err(|e| format!("Failed to parse shorthand NOT lhs: {}", e))?;
                    return Self::compile_sub_exp(&SubExp::UnaryNot {
                        op: "NOT".to_string(),
                        lhs: Box::new(lhs_sub),
                    });
                }
                let lhs_exp = match &sh.lhs {
                    Value::String(s) => ValExp::Typed(TypedValExp::ColRef {
                        col_name: s.clone(),
                        tbl_alias: None,
                    }),
                    other => ValExp::Literal(other.clone()),
                };
                let rhs_exp = match &sh.rhs {
                    Some(v) => ValExp::Literal(v.clone()),
                    None => ValExp::Literal(Value::Null),
                };
                Self::compile_bin_rel(&sh.op, &lhs_exp, &rhs_exp)
            }
        }
    }

    fn compile_bin_rel(op: &str, lhs: &ValExp, rhs: &ValExp) -> Result<String, String> {
        let op_up = op.to_uppercase();
        let lhs_sql = Self::compile_val_exp(lhs)?;

        // Extract rhs text for forensic pattern normalization
        let rhs_str = match rhs {
            ValExp::Literal(Value::String(s)) => Some(s.as_str()),
            ValExp::Typed(TypedValExp::ConstVal { val: Value::String(s) }) => Some(s.as_str()),
            _ => None,
        };

        let has_slashes = rhs_str.map(|s| s.contains('/') || s.contains('\\')).unwrap_or(false);

        // Path-normalized lhs if slashes are present
        let eff_lhs = if has_slashes {
            format!("REGEXP_REPLACE({}::VARCHAR, '[\\\\/]+', '/', 'g')", lhs_sql)
        } else {
            format!("{}::VARCHAR", lhs_sql)
        };

        match op_up.as_str() {
            "EQ" => {
                let rhs_sql = Self::compile_val_exp(rhs)?;
                if has_slashes {
                    let norm_rhs = rhs_str.unwrap().replace('\\', "/");
                    Ok(format!("{} = '{}'", eff_lhs, norm_rhs.replace('\'', "''")))
                } else {
                    Ok(format!("{} = {}", lhs_sql, rhs_sql))
                }
            }
            "NEQ" => {
                let rhs_sql = Self::compile_val_exp(rhs)?;
                if has_slashes {
                    let norm_rhs = rhs_str.unwrap().replace('\\', "/");
                    Ok(format!("{} != '{}'", eff_lhs, norm_rhs.replace('\'', "''")))
                } else {
                    Ok(format!("{} != {}", lhs_sql, rhs_sql))
                }
            }
            "GT" => Ok(format!("{} > {}", lhs_sql, Self::compile_val_exp(rhs)?)),
            "GE" => Ok(format!("{} >= {}", lhs_sql, Self::compile_val_exp(rhs)?)),
            "LT" => Ok(format!("{} < {}", lhs_sql, Self::compile_val_exp(rhs)?)),
            "LE" => Ok(format!("{} <= {}", lhs_sql, Self::compile_val_exp(rhs)?)),
            "BEGINS" | "STARTSWITH" => {
                let term = rhs_str.unwrap_or("");
                let sanitized = Self::escape_ilike_term(term, has_slashes);
                Ok(format!("{} ILIKE '{}%' ESCAPE '\\'", eff_lhs, sanitized))
            }
            "NOTBEGINS" => {
                let term = rhs_str.unwrap_or("");
                let sanitized = Self::escape_ilike_term(term, has_slashes);
                Ok(format!("{} NOT ILIKE '{}%' ESCAPE '\\'", eff_lhs, sanitized))
            }
            "ENDS" | "ENDSWITH" => {
                let term = rhs_str.unwrap_or("");
                let sanitized = Self::escape_ilike_term(term, has_slashes);
                Ok(format!("{} ILIKE '%{}' ESCAPE '\\'", eff_lhs, sanitized))
            }
            "NOTENDS" => {
                let term = rhs_str.unwrap_or("");
                let sanitized = Self::escape_ilike_term(term, has_slashes);
                Ok(format!("{} NOT ILIKE '%{}' ESCAPE '\\'", eff_lhs, sanitized))
            }
            "CONTAINS" => {
                let term = rhs_str.unwrap_or("");
                let sanitized = Self::escape_ilike_term(term, has_slashes);
                Ok(format!("{} ILIKE '%{}%' ESCAPE '\\'", eff_lhs, sanitized))
            }
            "NOTCONTAINS" => {
                let term = rhs_str.unwrap_or("");
                let sanitized = Self::escape_ilike_term(term, has_slashes);
                Ok(format!("{} NOT ILIKE '%{}%' ESCAPE '\\'", eff_lhs, sanitized))
            }
            "IN" | "NOTIN" => {
                let neg = if op_up == "NOTIN" { "NOT " } else { "" };
                let in_list = match rhs {
                    ValExp::Literal(Value::Array(arr)) => arr
                        .iter()
                        .map(|v| match v {
                            Value::String(s) => format!("'{}'", s.replace('\'', "''")),
                            other => other.to_string(),
                        })
                        .collect::<Vec<_>>()
                        .join(", "),
                    _ => Self::compile_val_exp(rhs)?,
                };
                Ok(format!("{} {}IN ({})", lhs_sql, neg, in_list))
            }
            "REGEX" => {
                let term = rhs_str.unwrap_or("");
                Ok(format!("regexp_matches({}, '{}')", lhs_sql, term.replace('\'', "''")))
            }
            "ISNULL" => Ok(format!("{} IS NULL", lhs_sql)),
            "NOTNULL" | "NOTISNULL" => Ok(format!("{} IS NOT NULL", lhs_sql)),
            _ => Err(format!("Unsupported binary relation operator: {}", op)),
        }
    }

    fn escape_ilike_term(term: &str, has_slashes: bool) -> String {
        let base = if has_slashes {
            term.replace('\\', "/").replace("//", "/")
        } else {
            term.replace('\\', "\\\\")
        };
        base.replace('%', "\\%")
            .replace('_', "\\_")
            .replace('\'', "''")
    }

    fn compile_val_exp(vexp: &ValExp) -> Result<String, String> {
        match vexp {
            ValExp::Literal(val) => match val {
                Value::Null => Ok("NULL".to_string()),
                Value::Bool(b) => Ok(if *b { "TRUE".to_string() } else { "FALSE".to_string() }),
                Value::Number(n) => Ok(n.to_string()),
                Value::String(s) => Ok(format!("'{}'", s.replace('\'', "''"))),
                Value::Array(arr) => Ok(arr.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(", ")),
                Value::Object(_) => Ok(format!("'{}'", val.to_string().replace('\'', "''"))),
            },
            ValExp::Typed(typed) => match typed {
                TypedValExp::ColRef { col_name, tbl_alias } => {
                    let q_col = Self::quote_ident(col_name);
                    match tbl_alias {
                        Some(alias) => Ok(format!("{}.{}", Self::quote_ident(alias), q_col)),
                        None => Ok(q_col),
                    }
                }
                TypedValExp::ConstVal { val } => Self::compile_val_exp(&ValExp::Literal(val.clone())),
                TypedValExp::BinValExp { op, lhs, rhs } => {
                    let l = Self::compile_val_exp(lhs)?;
                    let r = Self::compile_val_exp(rhs)?;
                    Ok(format!("({} {} {})", l, op, r))
                }
                TypedValExp::UnaryValExp { op, arg } => {
                    let a = Self::compile_val_exp(arg)?;
                    Ok(format!("{}({})", op, a))
                }
                TypedValExp::AsString { val_exp } => {
                    let a = Self::compile_val_exp(val_exp)?;
                    Ok(format!("CAST({} AS VARCHAR)", a))
                }
                TypedValExp::CastExp { sub_exp, as_type } => {
                    let a = Self::compile_val_exp(sub_exp)?;
                    let t_str = as_type.as_str().unwrap_or("VARCHAR");
                    Ok(format!("CAST({} AS {})", a, t_str))
                }
            },
        }
    }

    pub fn quote_ident(ident: &str) -> String {
        format!("\"{}\"", ident.replace('"', "\"\""))
    }
}
