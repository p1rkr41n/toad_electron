# Dead Ends — TOAD v2.5.1 Nested JSON Parser & Auto-Flattening

| Iteration | Approach Tried | Why It Failed | Files Touched |
|-----------|---------------|---------------|---------------|
| 1 | Using `all_varchar = true` in DuckDB `read_json_auto(...)` for Tier 2 fallback | DuckDB v1.0.0 rejects `all_varchar` with Binder Error (`Invalid named parameter "all_varchar" for function read_json_auto`). Valid only for CSV. | `tad-master/packages/reltab-duckdb/src/json/JsonStreamingFlattener.ts` |
