import os
import sys
import time
import json
import evtx
import pyarrow as pa
import pyarrow.parquet as pq
import duckdb

def extract_record_fields(record_id, timestamp_dt, data_json_str):
    try:
        data = json.loads(data_json_str)
        event = data.get("Event", {})
        system = event.get("System", {})
    except Exception:
        return (record_id, timestamp_dt, None, None, None, None, None, None, None)

    # EventID
    raw_eid = system.get("EventID")
    event_id = None
    if isinstance(raw_eid, int):
        event_id = raw_eid
    elif isinstance(raw_eid, dict):
        txt = raw_eid.get("#text")
        if txt is not None:
            try:
                event_id = int(txt)
            except (ValueError, TypeError):
                pass
    elif isinstance(raw_eid, str):
        try:
            event_id = int(raw_eid)
        except ValueError:
            pass

    # Provider Name
    provider = system.get("Provider")
    provider_name = None
    if isinstance(provider, dict):
        attrs = provider.get("#attributes", {})
        if isinstance(attrs, dict):
            provider_name = attrs.get("Name")
        if not provider_name:
            provider_name = provider.get("Name")

    # Level
    raw_level = system.get("Level")
    level = None
    if isinstance(raw_level, int):
        level = raw_level
    elif isinstance(raw_level, dict):
        txt = raw_level.get("#text")
        if txt is not None:
            try:
                level = int(txt)
            except (ValueError, TypeError):
                pass

    # Channel
    channel = system.get("Channel")
    if isinstance(channel, dict):
        channel = channel.get("#text")

    # Computer
    computer = system.get("Computer")
    if isinstance(computer, dict):
        computer = computer.get("#text")

    # User ID / SID
    user_id = None
    sec = system.get("Security")
    if isinstance(sec, dict):
        attrs = sec.get("#attributes", {})
        if isinstance(attrs, dict):
            user_id = attrs.get("UserID")
    if not user_id:
        edata = event.get("EventData")
        if isinstance(edata, dict):
            user_id = edata.get("TargetUserSid") or edata.get("SubjectUserSid") or edata.get("TargetUserName")

    # Payload JSON
    payload = event.get("EventData") or event.get("UserData") or event
    payload_json = json.dumps(payload) if payload else "{}"

    return (
        record_id,
        timestamp_dt,
        event_id,
        provider_name,
        level,
        channel,
        computer,
        user_id,
        payload_json
    )

def benchmark_direct_arrow(evtx_path, out_parquet):
    t0 = time.time()
    parser = evtx.PyEvtxParser(evtx_path)

    col_record_id = []
    col_time_created = []
    col_event_id = []
    col_provider_name = []
    col_level = []
    col_channel = []
    col_computer = []
    col_user_id = []
    col_payload_json = []

    count = 0
    for r in parser.records_json():
        count += 1
        rid = r["event_record_id"]
        ts = r["timestamp"]
        row = extract_record_fields(rid, ts, r["data"])
        col_record_id.append(row[0])
        col_time_created.append(row[1])
        col_event_id.append(row[2])
        col_provider_name.append(row[3])
        col_level.append(row[4])
        col_channel.append(row[5])
        col_computer.append(row[6])
        col_user_id.append(row[7])
        col_payload_json.append(row[8])

    schema = pa.schema([
        ("record_id", pa.int64()),
        ("time_created", pa.string()), # or timestamp
        ("event_id", pa.int32()),
        ("provider_name", pa.string()),
        ("level", pa.int32()),
        ("channel", pa.string()),
        ("computer", pa.string()),
        ("user_id", pa.string()),
        ("payload_json", pa.string()),
    ])

    batch = pa.RecordBatch.from_arrays([
        pa.array(col_record_id, type=pa.int64()),
        pa.array(col_time_created, type=pa.string()),
        pa.array(col_event_id, type=pa.int32()),
        pa.array(col_provider_name, type=pa.string()),
        pa.array(col_level, type=pa.int32()),
        pa.array(col_channel, type=pa.string()),
        pa.array(col_computer, type=pa.string()),
        pa.array(col_user_id, type=pa.string()),
        pa.array(col_payload_json, type=pa.string()),
    ], schema=schema)

    table = pa.Table.from_batches([batch])
    pq.write_table(table, out_parquet, compression="SNAPPY")
    dt = time.time() - t0
    size = os.path.getsize(out_parquet)
    print(f"[Direct Arrow] {count} rows in {dt:.3f}s ({count/dt:.0f} r/s), Parquet size: {size/1024/1024:.2f} MB")
    return dt, size, count

def benchmark_jsonl_duckdb(evtx_path, out_jsonl, out_parquet):
    t0 = time.time()
    parser = evtx.PyEvtxParser(evtx_path)

    count = 0
    with open(out_jsonl, "w", encoding="utf-8") as f:
        for r in parser.records_json():
            count += 1
            row = extract_record_fields(r["event_record_id"], str(r["timestamp"]), r["data"])
            rec = {
                "record_id": row[0],
                "time_created": str(row[1]),
                "event_id": row[2],
                "provider_name": row[3],
                "level": row[4],
                "channel": row[5],
                "computer": row[6],
                "user_id": row[7],
                "payload_json": row[8]
            }
            f.write(json.dumps(rec) + "\n")

    t_jsonl = time.time() - t0
    jsonl_size = os.path.getsize(out_jsonl)

    t1 = time.time()
    con = duckdb.connect()
    con.execute(f"COPY (SELECT * FROM read_json_auto('{out_jsonl.replace('\\', '/')}')) TO '{out_parquet.replace('\\', '/')}' (FORMAT PARQUET, COMPRESSION ZSTD);")
    t_duck = time.time() - t1
    dt_total = time.time() - t0
    size = os.path.getsize(out_parquet)
    print(f"[JSONL + DuckDB] {count} rows in {dt_total:.3f}s (JSONL: {t_jsonl:.3f}s [{jsonl_size/1024/1024:.2f} MB], DuckDB: {t_duck:.3f}s), Parquet size: {size/1024/1024:.2f} MB")
    return dt_total, size, count

if __name__ == "__main__":
    temp_dir = "d:/Shared_UserData/Downloads/tad/.agents/teamwork/explorer_m5_evtx/temp_bench"
    os.makedirs(temp_dir, exist_ok=True)

    print("=== BENCHMARK: System.evtx (23 MB) ===")
    p1 = os.path.join(temp_dir, "system_arrow.parquet")
    benchmark_direct_arrow("data_sample/System.evtx", p1)

    j1 = os.path.join(temp_dir, "system.jsonl")
    p2 = os.path.join(temp_dir, "system_duckdb.parquet")
    benchmark_jsonl_duckdb("data_sample/System.evtx", j1, p2)

    print("\n=== BENCHMARK: Security.evtx (73 MB) ===")
    p3 = os.path.join(temp_dir, "security_arrow.parquet")
    benchmark_direct_arrow("data_sample/Security.evtx", p3)

    j2 = os.path.join(temp_dir, "security.jsonl")
    p4 = os.path.join(temp_dir, "security_duckdb.parquet")
    benchmark_jsonl_duckdb("data_sample/Security.evtx", j2, p4)

    # Clean up temp files
    for f in [p1, j1, p2, p3, j2, p4]:
        if os.path.exists(f):
            os.remove(f)
    os.rmdir(temp_dir)
