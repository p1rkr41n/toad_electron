# Dispatch: Spec Miner M3 (QueryExp AST & Arrow IPC Spec Miner)

## Mission
Extract precise specifications for Milestone 3 (DuckDB Engine & Arrow IPC Protocol):
1. In `tad-master/packages/reltab` and `tad-master/packages/reltab-duckdb`:
   - Enumerate all `QueryExp` AST nodes (TableRep, FilterExp, AggExp, SortExp, ProjectExp, SubqueryExp).
   - Document how operators (`==`, `!=`, `<`, `>`, `in`, `contains`, `null`, etc.) and aggregations (`sum`, `count`, `avg`, `min`, `max`) map to DuckDB SQL.
2. In `tad-master/packages/toadviewer` and `tad-master/packages/host-bridge`:
   - Document the binary Arrow IPC stream format expected by the frontend (`@apache-arrow/es2015-cjs`), including the `0xFFFFFFFF` continuation marker and schema metadata header.
   - Document `reltab.Schema` DTO format (`columns`, `columnTypes`, `stats`).
3. Deliver comprehensive specification report in `d:\Shared_UserData\Downloads\tad\.agents\teamwork\specminer_m3\handoff.md`.

## 2026-11-04T20:49:55Z
You are Spec Miner M3 for Milestone 3 (DuckDB Engine & Arrow IPC Protocol).
Your working directory: d:\Shared_UserData\Downloads\tad\.agents\teamwork\specminer_m3\

Mandatory inputs to read:
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
- d:\Shared_UserData\Downloads\tad\PROJECT.md
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\specminer_m3\DISPATCH.md
- Reference codebases:
  `tad-master/packages/reltab/`
  `tad-master/packages/reltab-duckdb/`
  `tad-master/packages/host-bridge/`
  `tad-master/packages/toadviewer/`

Tasks:
1. Probing authoritative sources:
   - Extract exact `reltab.QueryExp` JSON AST schema and node types (TableRep, FilterExp, AggExp, SortExp, ProjectExp, SubqueryExp).
   - Document operator mapping and DuckDB SQL translation semantics.
   - Document binary Arrow IPC stream format expected by `@apache-arrow/es2015-cjs` (`0xFFFFFFFF` continuation marker, record batch alignment).
   - Document `reltab.Schema` DTO structure.
2. Deliver a comprehensive specification report at `d:\Shared_UserData\Downloads\tad\.agents\teamwork\specminer_m3\handoff.md`.
3. Notify parent when finished via send_message.
