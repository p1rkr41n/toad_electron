import duckdb

con = duckdb.connect()
con.execute("CREATE TABLE t (id INT, val VARCHAR)")
con.execute("INSERT INTO t VALUES (1, 'A'), (2, 'B'), (3, NULL)")

# 1. Direct empty IN / NOT IN literal syntax
try:
    con.execute("SELECT * FROM t WHERE val IN ()").fetchall()
except Exception as e:
    print("Direct IN ():", type(e).__name__, str(e).strip())

try:
    con.execute("SELECT * FROM t WHERE val NOT IN ()").fetchall()
except Exception as e:
    print("Direct NOT IN ():", type(e).__name__, str(e).strip())

# 2. Subquery empty set (valid SQL for empty set)
print("\n--- Testing subquery empty set semantics in DuckDB ---")
res_in_empty_sub = con.execute("SELECT id, val, val IN (SELECT val FROM t WHERE 1=0) as in_res FROM t").fetchall()
print("val IN (empty subquery):", res_in_empty_sub)

res_notin_empty_sub = con.execute("SELECT id, val, val NOT IN (SELECT val FROM t WHERE 1=0) as notin_res FROM t").fetchall()
print("val NOT IN (empty subquery):", res_notin_empty_sub)

where_in_empty = con.execute("SELECT * FROM t WHERE val IN (SELECT val FROM t WHERE 1=0)").fetchall()
print("WHERE val IN (empty subquery):", where_in_empty)

where_notin_empty = con.execute("SELECT * FROM t WHERE val NOT IN (SELECT val FROM t WHERE 1=0)").fetchall()
print("WHERE val NOT IN (empty subquery):", where_notin_empty)

# 3. Boolean constants: 1=0 and 1=1 vs col IS NULL
print("\n--- Testing 1=0 and 1=1 in WHERE clause ---")
print("WHERE 1=0:", con.execute("SELECT * FROM t WHERE 1=0").fetchall())
print("WHERE 1=1:", con.execute("SELECT * FROM t WHERE 1=1").fetchall())
print("WHERE FALSE:", con.execute("SELECT * FROM t WHERE FALSE").fetchall())
print("WHERE TRUE:", con.execute("SELECT * FROM t WHERE TRUE").fetchall())

# 4. Standard NOT IN non-empty list with NULL in table
print("\n--- Testing NOT IN ('A') on rows including NULL ---")
print("WHERE val NOT IN ('A'):", con.execute("SELECT * FROM t WHERE val NOT IN ('A')").fetchall())
print("SELECT id, val, val NOT IN ('A') FROM t:", con.execute("SELECT id, val, val NOT IN ('A') FROM t").fetchall())

# 5. What if we use (col IS NOT NULL) vs 1=1 for empty NOT IN?
print("WHERE 1=1 AND val IS NOT NULL:", con.execute("SELECT * FROM t WHERE 1=1 AND val IS NOT NULL").fetchall())


print("\n--- Testing boolean expressions in WHERE ---")
for expr in ['(1=0)', '(1=1)', 'FALSE', 'TRUE', '(1=0 AND id=1)', '(1=1 AND id=1)', '(1=0 OR id=1)', 'NOT (1=0)', 'NOT (1=1)', '(1=0) AND (1=1)']:
    r = con.execute(f"SELECT count(*) FROM t WHERE {expr}").fetchone()[0]
    print(f"{expr:20} -> count={r}")

print("\n--- Testing double quotes in DuckDB IN clause ---")
try:
    con.execute('SELECT * FROM t WHERE val IN ("apple")').fetchall()
except Exception as e:
    print('Double quote IN error:', e)
