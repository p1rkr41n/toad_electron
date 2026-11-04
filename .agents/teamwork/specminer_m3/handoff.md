# Milestone 3 Specification Mining Report: DuckDB Engine & Arrow IPC Protocol

**Author**: Spec Miner M3  
**Working Directory**: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\specminer_m3\`  
**Target Milestone**: Milestone 3 (DuckDB Engine & Arrow IPC Protocol - F07, F08, F09, F10, F11, F12)  
**Authoritative Specification Sources**:
- `tad-master/packages/reltab/` (`QueryExp.ts`, `QueryRep.ts`, `FilterExp.ts`, `defs.ts`, `AggFn.ts`, `ColumnType.ts`, `Schema.ts`, `ColumnStats.ts`, `BaseSQLDialect.ts`, `toSql.ts`, `pp.ts`, `remote/hybridProtocol.ts`, `remote/server.ts`, `remote/Connection.ts`)
- `tad-master/packages/reltab-duckdb/` (`reltab-duckdb.ts`, `dialects/DuckDBDialect.ts`)
- `tad-master/packages/host-bridge/` (`commandAliases.ts`, `TauriHostAdapter.ts`, `IHostBridge.ts`)
- `tad-master/packages/toadviewer/` (`toadviewer.ts`, `PivotRequester.ts`, `aggtree.ts`)
- Test suites: `tauri/project/tests/test_tauri_arrow_ipc.js`, `tests/test_arrow_ipc_stream.js`, `tauri/project/tests/test_e2e_features.js`

---

## 1. Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | QueryExp AST | `TableQueryRep` / `table` | Base tabular query node identifying a database table or view | `{ "operator": "table", "tableName": string }` or `{ "expType": "table", "tableName": string }` | `SELECT * FROM "<tableName>"` | Throws if `tableName` not in catalog | `QueryExp.ts:338`, `QueryRep.ts:31`, `test_e2e_features.js:106` |
| 2 | QueryExp AST | `SqlQueryRep` / `sql` | Base raw SQL query node wrapped as subquery | `{ "operator": "sql", "sqlQuery": string }` or `{ "expType": "sql", "sqlQuery": string }` | `SELECT * FROM ( <sqlQuery> ) AS _raw_sql` | Throws DuckDB syntax error if invalid SQL | `QueryExp.ts:343`, `QueryRep.ts:25`, `test_e2e_features.js:139` |
| 3 | QueryExp AST | `ProjectQueryRep` / `project` | Projects specified subset of column IDs from input query | `{ "operator": "project", "cols": string[], "from": QueryRep }` or `{ "expType": "project", "cols": string[], "from": ... }` | `SELECT "<c1>", "<c2>" FROM ( <subquery> ) AS _proj` | Throws if projected column does not exist in subquery schema | `QueryExp.ts:101`, `QueryRep.ts:34`, `toSql.ts:101` |
| 4 | QueryExp AST | `GroupByQueryRep` / `groupBy` | Groups by specified columns and computes aggregate functions | `{ "operator": "groupBy", "cols": string[], "aggs": AggColSpec[], "from": QueryRep }` | `SELECT "<cols>", <aggExprs> FROM (<subquery>) GROUP BY "<cols>"` | Throws if group or agg column does not exist | `QueryExp.ts:104`, `QueryRep.ts:39`, `toSql.ts:141` |
| 5 | QueryExp AST | `FilterQueryRep` / `filter` | Filters rows using boolean predicate tree (`FilterExp`) | `{ "operator": "filter", "fexp": FilterExp, "from": QueryRep }` or `{ "filterExp": ... }` | `SELECT * FROM (<subquery>) WHERE <predicate>` | Throws if column referenced in predicate does not exist | `QueryExp.ts:108`, `QueryRep.ts:45`, `toSql.ts:225` |
| 6 | QueryExp AST | `SortQueryRep` / `sort` | Sorts rows by ordered key pairs `[colName, isAscending]` | `{ "operator": "sort", "keys": [string, boolean][], "from": QueryRep }` or `sortCols` | `SELECT * FROM (<subquery>) ORDER BY "<col>" [ASC/DESC] NULLS LAST` | Throws if sort column does not exist in schema | `QueryExp.ts:132`, `QueryRep.ts:65`, `toSql.ts:327` |
| 7 | QueryExp AST | `MapColumnsQueryRep` / `mapColumns` | Renames columns by name using map `{ [oldName]: { id, displayName } }` | `{ "operator": "mapColumns", "cmap": { [col]: ColumnMapInfo }, "from": QueryRep }` | `SELECT "<col>" AS "<newId>" ...` | Unmapped columns pass through unchanged | `QueryExp.ts:112`, `QueryRep.ts:50`, `toSql.ts:271` |
| 8 | QueryExp AST | `MapColumnsByIndexQueryRep` | Renames columns by 0-based position index | `{ "operator": "mapColumnsByIndex", "cmap": { [index]: ColumnMapInfo }, "from": QueryRep }` | `SELECT "<col>" AS "<newId>" ...` | Unmapped indices pass through unchanged | `QueryExp.ts:116`, `QueryRep.ts:55`, `toSql.ts:271` |
| 9 | QueryExp AST | `ConcatQueryRep` / `concat` | Concatenates two query results via SQL UNION ALL | `{ "operator": "concat", "target": QueryRep, "from": QueryRep }` | `<select1> UNION ALL <select2>` | Throws if schemas are incompatible | `QueryExp.ts:124`, `QueryRep.ts:60`, `toSql.ts:312` |
| 10 | QueryExp AST | `ExtendQueryRep` / `extend` | Adds a new computed or constant column expression | `{ "operator": "extend", "colId": string, "colExp": ColumnExtendExp, "opts": ColumnExtendOptions, "from": QueryRep }` | `SELECT *, <colExp> AS "<colId>" FROM (<subquery>)` | Throws if expression fails type inference | `QueryExp.ts:139`, `QueryRep.ts:70`, `toSql.ts:388` |
| 11 | QueryExp AST | `JoinQueryRep` / `join` | Left outer joins LHS and RHS queries on specified column(s) | `{ "operator": "join", "lhs": QueryRep, "rhs": QueryRep, "on": string \| string[], "joinType": "LeftOuter" }` | `(<lhs>) tA LEFT OUTER JOIN (<rhs>) tB USING ("<onCols>")` | Throws if `on` columns missing from either side | `QueryExp.ts:154`, `QueryRep.ts:79`, `toSql.ts:444` |
| 12 | ValExp AST | `ConstVal` | Constant literal value (string, number, boolean, bigint, null) | `{ "expType": "ConstVal", "val": Scalar }` | SQL literal (`123`, `'text'`, `true`, `null`) | String escaping applied | `defs.ts:35`, `defs.ts:197` |
| 13 | ValExp AST | `ColRef` | Column identifier reference with optional table alias | `{ "expType": "ColRef", "colName": string, "tblAlias"?: string }` | `"<colName>"` or `tA."<colName>"` | Double quote escaping applied | `defs.ts:44`, `defs.ts:205` |
| 14 | ValExp AST | `BinValExp` | Binary arithmetic operation (`+`, `-`, `*`, `/`) | `{ "expType": "BinValExp", "op": "+"-*"/", "lhs": ValExp, "rhs": ValExp }` | `(<lhs> <op> <rhs>)` | DuckDB division by zero yields NULL/Inf | `defs.ts:77`, `defs.ts:212` |
| 15 | ValExp AST | `UnaryValExp` | Unary numeric functions (`round`, `floor`, `ceil`) | `{ "expType": "UnaryValExp", "op": "round"\|"floor"\|"ceil", "arg": ValExp }` | `round(<arg>)`, `floor(<arg>)`, `ceil(<arg>)` | Unknown op throws error | `defs.ts:108`, `defs.ts:215` |
| 16 | ValExp AST | `AsString` | Casts any value expression to DuckDB VARCHAR | `{ "expType": "AsString", "valExp": ValExp }` | `CAST(<valExp> AS VARCHAR)` | Null casts to NULL VARCHAR | `defs.ts:147`, `defs.ts:235` |
| 17 | ValExp AST | `CastExp` | Explicit SQL type cast | `{ "expType": "CastExp", "subExp": ValExp, "asType": ColumnType }` | `CAST(<subExp> AS <sqlTypeName>)` | Invalid cast throws DuckDB conversion error | `defs.ts:62`, `defs.ts:218` |
| 18 | ValExp AST | `WindowExp` | Window ranking function | `{ "expType": "WindowExp", "fn": "row_number" }` | `row_number() OVER ()` | Unknown window fn throws | `defs.ts:57`, `defs.ts:209` |
| 19 | RelExp AST | `BinRelExp` (Comparison) | Standard comparison operators: `EQ`, `NEQ`, `GT`, `GE`, `LT`, `LE` | `{ "expType": "BinRelExp", "op": "EQ"\|"NEQ"..., "lhs": ValExp, "rhs": ValExp }` | `<lhs> = <rhs>`, `<lhs> <> <rhs>`, `<lhs> > <rhs>`... | If rhs has slashes in EQ/NEQ, normalizes slashes | `FilterExp.ts:260`, `FilterExp.ts:279` |
| 20 | RelExp AST | `BinRelExp` (Text Pattern) | Substring and prefix/suffix text search: `BEGINS`, `NOTBEGINS`, `ENDS`, `NOTENDS`, `CONTAINS`, `NOTCONTAINS` | `{ "expType": "BinRelExp", "op": "CONTAINS"..., "lhs": ValExp, "rhs": ConstVal }` | `<lhs>::VARCHAR [NOT ]ILIKE '%<sanitized>%' ESCAPE '\\'` | Requires ConstVal for rhs; escapes `%`, `_`, `\` | `FilterExp.ts:105-210` |
| 21 | RelExp AST | `BinRelExp` (Set In) | Set membership: `IN`, `NOTIN` | `{ "expType": "BinRelExp", "op": "IN"\|"NOTIN", "lhs": ValExp, "rhs": ConstVal([str]) }` | `<lhs> [NOT ]IN ('v1', 'v2')` | Empty array yields false predicate | `FilterExp.ts:120-138` |
| 22 | RelExp AST | `UnaryRelExp` | Nullity predicates: `ISNULL`, `NOTNULL` | `{ "expType": "UnaryRelExp", "op": "ISNULL"\|"NOTNULL", "arg": ValExp }` | `"<col>" is null`, `"<col>" is not null` | Throws if arg not a ColRef/ValExp | `FilterExp.ts:310-332` |
| 23 | RelExp AST | `OmniSearchRelExp` | Global text search across all non-hidden columns | `{ "expType": "OmniSearchRelExp", "searchTerm": string, "columns": string[] }` | `CONCAT_WS(' ', "c1"::VARCHAR, ...) ILIKE '%<term>%' ESCAPE '\\'` | Ignores columns starting with `_`; empty term returns "" | `FilterExp.ts:212-258` |
| 24 | RelExp AST | `RawSqlRelExp` | Passthrough raw SQL WHERE condition | `{ "expType": "RawSqlRelExp", "sqlPredicate": string }` | `<sqlPredicate>` | Passthrough without validation | `FilterExp.ts:334-350` |
| 25 | RelExp AST | `FilterExp` (Compound) | Boolean conjunction (`AND`) or disjunction (`OR`) tree | `{ "expType": "FilterExp", "op": "AND"\|"OR", "opArgs": SubExp[] }` | `(<e1> AND <e2>)` or `(<e1> OR <e2>)` | Empty `opArgs` returns empty string | `FilterExp.ts:373-477` |
| 26 | Aggregation | `sum`, `count`, `avg`, `min`, `max` | Standard SQL aggregations | `["sum", "col"]`, `["count", "col"]`, `["avg", "col"]`, `["min", "col"]`, `["max", "col"]` | `SUM("<col>")`, `COUNT("<col>")`, `AVG("<col>")`, `MIN("<col>")`, `MAX("<col>")` | NULL values ignored in standard SQL semantics | `AggFn.ts:10-30`, `pp.ts:43-49` |
| 27 | Aggregation | `uniq` | Distinct single-value aggregation emulation | `["uniq", "col"]` | `CASE WHEN MIN("<col>")=MAX("<col>") THEN MIN("<col>") ELSE NULL END` | Returns NULL if >1 distinct non-null values exist | `pp.ts:23-29` |
| 28 | Aggregation | `null`, `nullstr` | Null constant aggregation | `["null", "col"]` (or `nullstr` for string columns) | `NULL` (for non-strings) or `CAST(NULL AS VARCHAR)` (for strings) | Always returns NULL | `pp.ts:30-42`, `toSql.ts:164` |
| 29 | Aggregation | Default Aggregation by Kind | Automatic aggregation function selection when column name string provided | `"colName"` (as string instead of tuple) | `uniq` for string/bool/date/timestamp; `sum` for integer/real; `null` for other | Type lookup failure defaults to `null` | `ColumnType.ts:16-30`, `toSql.ts:158` |
| 30 | Arrow IPC Protocol | `0xFFFFFFFF` Continuation Marker | 4-byte indicator denoting start of Arrow IPC Stream message | First 4 bytes of stream buffer: `0xFF, 0xFF, 0xFF, 0xFF` | Boolean true for `isArrowIPC(buffer)` | Rejects if first 4 bytes $\ne$ `0xFFFFFFFF` | `hybridProtocol.ts:63-81`, `test_tauri_arrow_ipc.js:121` |
| 31 | Arrow IPC Protocol | 32-bit LE Metadata Length | 4 bytes following continuation marker specifying FlatBuffers header length | Bytes 4..7 as 32-bit little-endian integer | Length $L \ge 0$ | Length exceeding buffer throws decoding error | `test_tauri_arrow_ipc.js:83-88`, `test_tauri_arrow_ipc.js:139` |
| 32 | Arrow IPC Protocol | 8-Byte Buffer Alignment | FlatBuffers header and payload body aligned to 8-byte boundaries | Message body padded with zero bytes to $(8 - (len \pmod 8)) \pmod 8$ | Aligned memory offset | Unaligned buffer throws decoding exception in Arrow | Arrow IPC Specification, `test_tauri_arrow_ipc.js:146` |
| 33 | Arrow IPC Protocol | Custom `toadSchema` Metadata | Embedded JSON serialization of `reltab.Schema` in Arrow schema metadata | Key: `"toadSchema"`, Value: `JSON.stringify(schema.toJSON())` | `arrowTable.schema.metadata.get("toadSchema")` | If absent, falls back to Arrow Type ID inference | `hybridProtocol.ts:241-253`, `test_tauri_arrow_ipc.js:267-332` |
| 34 | Arrow IPC Protocol | Multi-Batch Streaming | Concatenation of multiple RecordBatches in a single continuous IPC stream | Consecutive `[Marker + Header + Body]` packets | Single `ArrowTable` with `table.batches.length == N` | Corrupted batch breaks entire stream | `test_tauri_arrow_ipc.js:336-360` |
| 35 | Arrow IPC Protocol | Stream Termination (EOS Token) | 8-byte token terminating an Arrow IPC stream | `[0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00]` | Clean stream EOF without hanging reader | Missing EOS token causes stream read failure | `test_tauri_arrow_ipc.js:362-376` |
| 36 | Schema DTO | `reltab.Schema` JSON DTO | DTO representing relational schema across IPC boundary | `{ "dialect": "duckdb", "columns": string[], "columnMetadata": { [col]: { displayName, columnType } } }` | `reltab.Schema` class instance via `Schema.fromJSON()` | Validates all types against dialect registry | `Schema.ts:32-36`, `Schema.ts:202-218` |
| 37 | Schema DTO | DuckDB Logical Type Mapping | Maps DuckDB types to SQL type strings and CoreColumnTypes | `INTEGER`, `BIGINT`, `DOUBLE`, `VARCHAR`, `BOOLEAN`, `TIMESTAMP`, `DATE`, `DECIMAL`, `BLOB`... | Typed ColumnType object with kind and defaultAggFn | Unknown type falls back to `VARCHAR` ("string") | `DuckDBDialect.ts:141-170`, `hybridProtocol.ts:126-150` |
| 38 | Schema DTO | `ColumnStatsMap` | Summary statistics for numeric and text columns | Rows from DuckDB `SUMMARIZE <query>` | Map of `NumericSummaryStats` or `TextSummaryStats` (`min`, `max`, `approxUnique`, `count`, `pctNull`) | Returns `{}` on summarize error | `ColumnStats.ts:1-23`, `reltab-duckdb.ts:133-176` |
| 39 | Row Count | Fast O(1) Parquet Row Count | Reads Parquet footer metadata without scanning table rows | Parquet file path on disk | `SELECT COALESCE(SUM(row_group_num_rows), 0) AS total_rows FROM parquet_metadata('<path>')` | Falls back to `SELECT count(*) FROM <table>` | `PROJECT.md:27`, `test_e2e_features.js:195-201`, `DataSource.ts:213` |
| 40 | Row Count | General Query Row Count Wrapper | Wraps arbitrary `QueryExp` into a row counting query | `QueryRep` AST | `SELECT count(*) as "rowCount" FROM ( <unpagedQuery> )` | BigInt rowCount converted to number | `QueryExp.ts:307-335`, `toSql.ts:547`, `DataSource.ts:225` |
| 41 | IPC Commands | Query Command Aliases Router | Bidirectional command router mapping namespaced & legacy names | `toad:eval_query`, `evalQuery`, `toad:row_count`, `rowCount`, `toad:schema`, `getTableSchema`, `toad:run_sql_arrow` | Dispatches to corresponding engine handler | Unrecognized commands return error or pass to plugins | `commandAliases.ts:39-51`, `src-tauri/src/commands/mod.rs:80-106` |

---

## 2. Edge Cases

| # | Feature | Input | Observed Behavior |
|---|---------|-------|-------------------|
| 1 | Arrow IPC Stream | 0-Row Empty Table (`numRows: 0`) | Serializes 0-row schema message and EOS token cleanly. Client `tableFromIPC(buf)` reconstructs table with `numRows == 0`, `numCols == N`, and schema field names preserved without throwing exceptions (`test_tauri_arrow_ipc.js:209-224`, `test_arrow_ipc_stream.js:128-140`). |
| 2 | Arrow IPC Stream | NULL values across all types | Preserves null validity bitmaps perfectly. Integers, doubles, booleans, strings, and decimals with NULL values decode as exact JavaScript `null` without type coercion (e.g. not `0`, `""`, or `NaN`) (`test_tauri_arrow_ipc.js:185-207`, `test_arrow_ipc_stream.js:353-384`). |
| 3 | Arrow IPC Stream | BigInt / Int64 beyond `MAX_SAFE_INTEGER` | Int64 values $> 9,007,199,254,740,991$ or $< -9,007,199,254,740,991$ are preserved as BigInts or string representations without precision loss (`test_tauri_arrow_ipc.js:226-244`, `hybridProtocol.ts:271`). |
| 4 | Arrow IPC Stream | Complex UTF-8, emojis, newlines, quotes, Vietnamese | Strings with emojis (`🌍🚀`), Windows CRLF (`\r\n`), tabs (`\t`), JSON quotes (`\"`), and Vietnamese diacritics (`ă, â, đ, ê, ô, ơ, ư`) roundtrip with 100% byte fidelity (`test_tauri_arrow_ipc.js:245-262`). |
| 5 | Arrow IPC Stream | Missing `toadSchema` custom metadata | Client gracefully falls back to `arrowTypeToDuckDBColumnType`: `typeId 2 (bitWidth 64)` -> `BIGINT`, `typeId 2 (bitWidth 32)` -> `INTEGER`, `typeId 3` -> `DOUBLE`, `typeId 5` -> `VARCHAR`, `typeId 6` -> `BOOLEAN`, `typeId 10` -> `TIMESTAMP` (`test_tauri_arrow_ipc.js:308-332`, `hybridProtocol.ts:126-150`). |
| 6 | Arrow IPC Stream | ArrayBuffer subarray slice with non-zero offset | Sliced buffers (`u8.subarray(2)`) are correctly checked and decoded without offset corruption (`test_tauri_arrow_ipc.js:146-151`). |
| 7 | Arrow IPC Stream | Corrupted continuation marker (`0x00000000`) | `isArrowIPC()` returns `false`; Arrow reader throws a header decoding exception (`test_tauri_arrow_ipc.js:464-486`). |
| 8 | Arrow IPC Stream | Truncated binary stream (missing body) | Truncating the stream after the continuation marker throws an Arrow decoding error (`test_tauri_arrow_ipc.js:449-463`). |
| 9 | Arrow IPC Stream | Decimal scale precision | Arrow Decimal128 values with scale are correctly decoded: `12345` with scale 2 decodes to `123.45`, `-5` with scale 2 decodes to `-0.05` (`hybridProtocol.ts:171-189`, `test_arrow_ipc_stream.js:322-350`). |
| 10 | Arrow IPC Stream | Arrow Time microsecond format | Microseconds since midnight are formatted as `"HH:MM:SS"` or `"HH:MM:SS.sss"` (`hybridProtocol.ts:194-214`). |
| 11 | DuckDB SQL Translation | File paths with Windows backslashes (`\`) | File paths or terms containing `\` or `/` are normalized to `/` via `REGEXP_REPLACE(col::VARCHAR, '[\\/]+', '/', 'g')` in DuckDB to enable cross-platform path matching (`FilterExp.ts:123-134`, `FilterExp.ts:237-245`, `FilterExp.ts:284-291`). |
| 12 | DuckDB SQL Translation | SQL wildcards and single quotes in filter terms | Pattern control characters (`%`, `_`, `\`) are escaped (`\%`, `\_`, `\\`) and single quotes doubled (`''`) with `ESCAPE '\\'` to prevent SQL injection and pattern distortion (`FilterExp.ts:176-181`, `FilterExp.ts:247-252`, `test_e2e_features.js:186-192`). |
| 13 | DuckDB SQL Translation | Single SELECT subquery flattening | If a subquery is a single SELECT without WHERE, GROUP BY, or ORDER BY, the outer query merges with it directly rather than wrapping it in an unnecessary subquery (`toSql.ts:190-207`, `toSql.ts:234-245`). |
| 14 | DuckDB SQL Translation | `uniq` aggregation on non-identical values | When multiple distinct non-null values exist in a group, `CASE WHEN MIN(col)=MAX(col) THEN MIN(col) ELSE NULL END` evaluates to `NULL` (`pp.ts:23-29`). |
| 15 | DuckDB SQL Translation | `null` aggregation on string vs non-string | For string columns, translates to `CAST(NULL AS VARCHAR)` (`nullstr`) to prevent DuckDB type inference ambiguities; for non-strings translates to `NULL` (`pp.ts:30-42`, `toSql.ts:164-168`). |
| 16 | DuckDB SQL Translation | OmniSearch on table with internal metadata columns | Excludes hidden columns starting with `_` (`filter(c => !c.startsWith("_"))`) before joining columns with `CONCAT_WS(' ', ...)` (`FilterExp.ts:232-236`). |
| 17 | DuckDB SQL Translation | Compound FilterExp with empty or null sub-expressions | Empty sub-expressions are filtered out; if all sub-expressions are empty, `toSqlWhere()` returns `""`, which prevents generating invalid `WHERE` clauses (`FilterExp.ts:468-475`). |
| 18 | DuckDB Fast Count | Fast Parquet count vs Filtered query count | Base Parquet table queries use `parquet_metadata` to count rows in O(1) time (~25ms); filtered or aggregated queries fall back to `SELECT count(*) as "rowCount" FROM (<subquery>)` (`DataSource.ts:213-248`, `test_e2e_features.js:195-201`). |

---

## 3. Observation

Authoritative findings gathered from local files:

1. **QueryExp AST Representation & Serialization**:
   - `QueryExp` in TypeScript (`tad-master/packages/reltab/src/QueryExp.ts:91-98`) wraps a private `_rep: QueryRep`.
   - When serialized by `JSON.stringify()`, `QueryExp` emits `{ "expType": "QueryExp", "_rep": <QueryRep> }`.
   - When serialized over IPC directly in Tauri test suites (`tauri/project/tests/test_e2e_features.js:105-144`), nodes are emitted with `"expType": "table" | "project" | "filter" | "sort" | "groupBy" | "sql"`.
   - In `QueryRep.ts:25-98`, nodes are discriminated by `"operator": "sql" | "table" | "project" | "groupBy" | "filter" | "mapColumns" | "mapColumnsByIndex" | "concat" | "sort" | "extend" | "join"`.
   - **Conclusion for Rust Compiler**: The Rust `QueryExp` deserializer must handle both `{ "operator": "...", ... }` and `{ "expType": "...", ... }`, as well as unpacking an outer `{ "expType": "QueryExp", "_rep": ... }`.

2. **Filter & Relational Expression Representation**:
   - In `FilterExp.ts:373-383`:
     ```typescript
     export class FilterExp {
       expType: "FilterExp";
       op: "AND" | "OR";
       opArgs: Array<SubExp>;
     }
     ```
   - In `FilterExp.ts:260-271`:
     ```typescript
     export class BinRelExp {
       expType: "BinRelExp";
       op: "EQ" | "NEQ" | "GT" | "GE" | "LT" | "LE" | "BEGINS" | "NOTBEGINS" | "ENDS" | "NOTENDS" | "CONTAINS" | "NOTCONTAINS" | "IN" | "NOTIN";
       lhs: ValExp;
       rhs: ValExp;
     }
     ```
   - In `FilterExp.ts:310-320`:
     ```typescript
     export class UnaryRelExp {
       expType: "UnaryRelExp";
       op: "ISNULL" | "NOTNULL";
       arg: ValExp;
     }
     ```
   - In `FilterExp.ts:212-221`:
     ```typescript
     export class OmniSearchRelExp {
       expType: "OmniSearchRelExp";
       searchTerm: string;
       columns: Array<string>;
     }
     ```
   - In `FilterExp.ts:334-342`:
     ```typescript
     export class RawSqlRelExp {
       expType: "RawSqlRelExp";
       sqlPredicate: string;
     }
     ```
   - In `test_e2e_features.js:147-184`: `filterExp` can also be a simplified flat object: `{ "op": "EQ", "lhs": "col", "rhs": val }`.

3. **Arrow IPC Binary Stream Format**:
   - In `hybridProtocol.ts:63-81` and `test_tauri_arrow_ipc.js:68-78`:
     ```typescript
     export function isArrowIPC(input: any): boolean {
       ...
       return (
         u8[0] === 0xff &&
         u8[1] === 0xff &&
         u8[2] === 0xff &&
         u8[3] === 0xff
       );
     }
     ```
   - Byte layout:
     1. Bytes `0..3`: `0xFF, 0xFF, 0xFF, 0xFF` (`-1` / `0xFFFFFFFF` continuation indicator).
     2. Bytes `4..7`: 32-bit Little-Endian integer = byte length of FlatBuffers encapsulated metadata message.
     3. Bytes `8..(8 + metadata_length - 1)`: FlatBuffers schema or record batch metadata.
     4. Padding: zero bytes to ensure 8-byte alignment `((metadata_length + 8) % 8 == 0)`.
     5. Body: RecordBatch column data buffers, aligned to 8-byte boundary.
     6. End of Stream (EOS) marker: `[0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00]`.
   - Schema Metadata:
     - Key: `"toadSchema"`
     - Value: JSON string of `reltab.Schema` (`JSON.stringify(schema.toJSON())`).
     - Key: `"application"` -> `"Toad-Tauri-v2"` (optional branding).

4. **Schema & Logical Type Mapping**:
   - `reltab.Schema` DTO:
     ```json
     {
       "dialect": "duckdb",
       "columns": ["id", "event_code", "message"],
       "columnMetadata": {
         "id": { "displayName": "ID", "columnType": "INTEGER" },
         "event_code": { "displayName": "Event Code", "columnType": "INTEGER" },
         "message": { "displayName": "Message", "columnType": "VARCHAR" }
       }
     }
     ```
   - In `DuckDBDialect.ts:141-170`, DuckDB SQL types map to 4 CoreColumnTypes (`integer`, `real`, `string`, `boolean`) and timestamps/dates/blobs.
   - In `ColumnStats.ts:1-22`:
     - `NumericSummaryStats`: `{ statsType: "numeric", min, max, approxUnique, count, pctNull }`
     - `TextSummaryStats`: `{ statsType: "text", min, max, approxUnique, count, pctNull }`
     - Populated from DuckDB query: `SUMMARIZE <sqlQuery>`.

5. **Parquet Fast Row Count**:
   - In `test_e2e_features.js:197-200`:
     `SELECT COALESCE(SUM(row_group_num_rows), 0) AS total_rows FROM parquet_metadata('<parquet_path>')`
   - Executes in O(1) time (~25ms) by reading the Parquet file metadata footer instead of scanning millions of rows.

6. **IPC Commands & Aliases**:
   - In `commandAliases.ts:39-51` and `src-tauri/src/commands/mod.rs:80-106`:
     - `toad:eval_query` $\leftrightarrow$ `DataSourceConnection.evalQuery` $\leftrightarrow$ `evalQuery` $\leftrightarrow$ `toad:query`
     - `toad:row_count` $\leftrightarrow$ `DataSourceConnection.rowCount` $\leftrightarrow$ `rowCount`
     - `toad:schema` $\leftrightarrow$ `toad:get_table_schema` $\leftrightarrow$ `DataSourceConnection.getTableSchema` $\leftrightarrow$ `getTableSchema` $\leftrightarrow$ `schema`
     - `toad:run_sql_arrow` $\leftrightarrow$ `DataSourceConnection.runSqlQueryArrow`
     - `toad:get_table_name` $\leftrightarrow$ `DataSourceConnection.getTableName` $\leftrightarrow$ `getTableName`

---

## 4. Logic Chain

1. **From UI Query to IPC Command**:
   - When the user interacts with ToadViewer (navigates table, applies ArcSight filter, sorts column, opens pivot tree):
     - `PivotRequester.ts` or `aggtree.ts` builds a `QueryExp` immutable expression tree.
     - `TauriHostAdapter.invokeBinary("toad:eval_query", { queryExp, offset, limit })` or `invoke("toad:row_count", { queryExp })` is invoked.
     - The JSON payload contains the serialized `QueryExp` AST.

2. **From IPC Command to Rust Command Router**:
   - In `src-tauri/src/commands/mod.rs`, `route_command()` matches `toad:eval_query`, `DataSourceConnection.evalQuery`, `evalQuery`, or `toad:query` into `CommandAction::EvalQuery`.
   - The payload contains `queryExp: Value`, `offset: Option<usize>`, `limit: Option<usize>`.

3. **From Rust AST to DuckDB SQL Compiler (`engine/query_compiler.rs`)**:
   - The AST compiler recurses through the query nodes:
     - If base is `table`, produces `SELECT * FROM "<tableName>"`.
     - If `filter`, generates DuckDB WHERE clause, escaping special characters and normalizing path slashes.
     - If `project`, selects only projected columns.
     - If `sort`, appends `ORDER BY "<col>" [ASC/DESC] NULLS LAST`.
     - If `groupBy`, aggregates with `SUM`, `COUNT`, `AVG`, `MIN`, `MAX`, or emulated `uniq`/`null`.
     - If `offset`/`limit` are specified, appends `LIMIT <limit> OFFSET <offset>`.
     - For `toad:row_count`: if the query is a simple base table on a Parquet file, generates `SELECT COALESCE(SUM(row_group_num_rows), 0) AS total_rows FROM parquet_metadata('<path>')`. Otherwise generates `SELECT count(*) as "rowCount" FROM (<unpagedSql>)`.

4. **From DuckDB Execution to Arrow IPC Streaming (`engine/arrow_encoder.rs`)**:
   - The DuckDB connection executes the compiled query.
   - DuckDB 1.0 or Arrow RecordBatches are serialized into an Apache Arrow IPC stream:
     - 4-byte `0xFFFFFFFF` continuation indicator.
     - FlatBuffers EncapsulatedMessage metadata length (32-bit LE).
     - FlatBuffers Schema message containing custom metadata `"toadSchema"` -> `JSON.stringify(reltabSchema)`.
     - 8-byte aligned body buffers containing column data arrays.
     - One or more RecordBatch messages.
     - 8-byte EOS token `[0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00]`.
   - The byte vector is wrapped in `tauri::ipc::Response::new(bytes)`.

5. **From Tauri WebView to SlickGrid**:
   - `window.__TAURI__.core.invoke` delivers binary response as `ArrayBuffer` / `Uint8Array`.
   - `TauriHostAdapter.invokeBinary` returns `Uint8Array`.
   - `reltab.arrowIPCToTableRep` / `@apache-arrow/es2015-cjs` `tableFromIPC(buf)` parses the stream in < 2ms without JSON serialization overhead.
   - Schema is reconstituted from `"toadSchema"`.
   - Column vectors are bound directly to SlickGrid rows.

---

## 5. Caveats

1. **Dual Serialization Format Compatibility**:
   - In legacy Tad / reltab, query nodes use `"operator": "table" | "project" ...`.
   - In modern Toad Tauri v2 tests (`test_e2e_features.js`), query nodes use `"expType": "table" | "project" ...`.
   - **Recommendation**: In `engine/query_compiler.rs`, deserialize AST nodes using a Serde tagged union that accepts either `"operator"` or `"expType"`, or use an untagged fallback.

2. **DuckDB 1.0 Connection Thread Isolation**:
   - DuckDB connections in C++ cannot be shared concurrently across multiple threads without synchronization.
   - The architecture requires a dual-engine isolation:
     - A dedicated `ui_conn` for UI queries and interactive virtual scroll requests.
     - A worker pool (`ingest_pool`) for background ingestion pipelines (CSV, EVTX, JSONL).

3. **Arrow Decimal & BigInt Handling in JS**:
   - Arrow Decimal128 values require scale division (`Number(raw) / 10^scale`).
   - BigInt values $> 2^{53}-1$ cannot be represented as standard JS numbers; they must remain strings or BigInts to prevent truncation.

---

## 6. Conclusion

The authoritative specification mining for Milestone 3 (DuckDB Engine & Arrow IPC Protocol) is complete. All AST node schemas, operator mappings, DuckDB SQL translations, Arrow IPC binary formatting requirements (`0xFFFFFFFF` continuation marker, 8-byte alignment, `toadSchema` metadata, `0x00000000` EOS marker), `reltab.Schema` DTO definitions, and fast O(1) Parquet counting semantics have been fully documented and verified against existing runnable test suites.

Milestone 3 is ready for implementation by the Rust Core & Engine Squads across the designated files:
- `tauri/project/src-tauri/src/engine/duckdb_pool.rs` (F07)
- `tauri/project/src-tauri/src/engine/query_compiler.rs` (F08)
- `tauri/project/src-tauri/src/engine/arrow_encoder.rs` (F09)
- `tauri/project/src-tauri/src/engine/fast_count.rs` (F10)
- `tauri/project/src-tauri/src/engine/schema_mapper.rs` (F11)
- `tauri/project/src-tauri/src/commands/query.rs` (Routing integration)

---

## 7. Verification Method

To independently verify the discoveries documented in this report:

1. **Verify Rust Core baseline and command routing**:
   ```powershell
   cargo test --manifest-path tauri/project/src-tauri/Cargo.toml
   ```
   *Expected: All 35 tests pass (11 unit tests, 18 adversarial tests, 6 core tests).*

2. **Verify Apache Arrow IPC Stream format & binary continuation marker**:
   ```powershell
   & "d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tauri/project/tests/test_tauri_arrow_ipc.js
   ```
   *Expected: All 17 Arrow IPC tests pass (detecting `0xFFFFFFFF`, diverse types, empty tables, `toadSchema` metadata, multi-batch, EOF token).*

3. **Verify hybrid protocol and DuckDB Arrow integration**:
   ```powershell
   & "d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tests/test_arrow_ipc_stream.js
   ```
   *Expected: All 16 hybrid binary and Arrow IPC stream tests pass.*

4. **Verify QueryExp compilation and E2E feature coverage**:
   ```powershell
   & "d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tauri/project/tests/test_e2e_features.js
   ```
   *Expected: All 22 E2E feature tests pass.*

5. **Verify 100K rows virtual scroll stability and memory guard**:
   ```powershell
   & "d:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tauri/project/tests/test_grid_scroll_stress.js
   ```
   *Expected: All 16 grid scroll stress tests pass.*
