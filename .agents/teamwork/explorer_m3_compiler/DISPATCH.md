# Dispatch: Explorer M3 Compiler (QueryExp AST Compiler Architecture)

## Mission
Investigate and design the native Rust QueryExp AST compiler (`query_compiler.rs`):
1. Review `tad-master/packages/reltab-duckdb/src/reltab-duckdb.ts`:
   - Identify how `QueryExp` converts to SQL CTEs or nested SELECT statements.
   - Design Rust AST structs deserializable via `serde_json`.
   - Implement recursive SQL generation for filter expressions, aggregations, sort orders, column projections, and offset/limit pagination.
2. Design `schema_mapper.rs`:
   - Map DuckDB data types (`VARCHAR`, `BIGINT`, `DOUBLE`, `TIMESTAMP`, `BOOLEAN`, etc.) to `reltab.ColumnType` strings (`text`, `integer`, `real`, `timestamp`, `boolean`).
3. Design `stats_cache.rs`:
   - In-memory cache for column min/max/cardinality to accelerate UI filter and pivot rendering.
4. Deliver technical recommendation report in `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m3_compiler\handoff.md`.


## 2026-11-04T20:50:08Z
[Message] timestamp=2026-11-04T20:50:08Z sender=07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d priority=MESSAGE_PRIORITY_HIGH
Tasks:
1. Technical architecture investigation for QueryExp AST Compiler:
   - Design deserializable Rust AST structs for QueryExp in src/engine/query_compiler.rs.
   - Map recursive SQL generation for filters, aggregations, sort orders, column projections, and offset/limit pagination.
   - Design src/engine/schema_mapper.rs converting DuckDB types to reltab.Schema DTO (columns, columnTypes, stats).
   - Design src/engine/stats_cache.rs for column cardinality caching.
   - Design integration with AppState and command router in src/commands/mod.rs & commands/query.rs.
2. Deliver a comprehensive recommendation report at d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m3_compiler\handoff.md.
3. Notify parent when finished via send_message.
