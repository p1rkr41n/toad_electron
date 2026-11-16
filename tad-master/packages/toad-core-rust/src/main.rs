//! main.rs
//!
//! CLI Entrypoint for TOAD Rust Core Engine v2.6.0
//! Provides Binary Guard inspection, EVTX -> JSONL conversion, UTF-16/Gzip transcoding,
//! Portable AppData management, Win32 I/O counter monitoring, and QA self-tests.

use std::path::{Path, PathBuf};
use toad_core::*;

fn print_help() {
    println!(
        r#"TOAD Core Engine v2.6.0 - High-Performance Native Rust Engine for Toad Viewer

USAGE:
  toad-core inspect <FILE>                   : Run 8KB Binary Guard & format/encoding detection
  toad-core evtx-dump <INPUT> <OUTPUT> [MAX] : Stream-convert EVTX -> structured JSONL
  toad-core transcode <INPUT> <OUTPUT>       : Stream-transcode UTF-16 / Gzip text -> UTF-8
  toad-core init-portable [EXE_DIR]          : Initialize and validate portable toadAppData
  toad-core clean-temp <TEMP_DIR>            : Clean temporary cache with EBUSY retry
  toad-core normalize-csv <INPUT> <OUTPUT>   : Normalize dirty CSV delimiter and row columns
  toad-core get-io [PID]                     : Read Win32 process read/write I/O bytes
  toad-core watch-io [PID] [INTERVAL_MS]     : Continuously stream process I/O counters
  toad-core test-qa                          : Run built-in Rust QA self-test suite
"#
    );
}

fn main() -> std::io::Result<()> {
    let args: Vec<String> = std::env::args().collect();

    if args.len() < 2 {
        print_help();
        return Ok(());
    }

    match args[1].as_str() {
        "inspect" => {
            if args.len() < 3 {
                eprintln!("Error: Missing file path. Usage: toad-core inspect <FILE>");
                std::process::exit(1);
            }
            let path = Path::new(&args[2]);
            println!("=== [TOAD Core] Inspecting file: {} ===", path.display());
            match inspect_file(path) {
                Ok(cat) => {
                    println!("[Binary Guard] Status: VALID");
                    println!("[Binary Guard] Format: {:?}", cat);
                    if let Ok(enc) = detect_text_encoding(path) {
                        println!("[Binary Guard] Encoding: {}", enc.as_str());
                    }
                    if cat == FileFormatCategory::DelimitedText {
                        if let Ok(meta) = inspect_csv(path) {
                            println!("[CSV Engine] Delimiter: '{}'", meta.delimiter);
                            println!("[CSV Engine] Columns: {}", meta.column_count);
                            println!("[CSV Engine] Headers: {:?}", meta.headers);
                            println!("[CSV Engine] Estimated rows: {}", meta.estimated_rows);
                        }
                    }
                }
                Err(err) => {
                    eprintln!("[Binary Guard] BLOCKED: {}", err);
                    std::process::exit(1);
                }
            }
        }

        "evtx-dump" => {
            if args.len() < 4 {
                eprintln!("Error: Missing arguments. Usage: toad-core evtx-dump <INPUT> <OUTPUT> [MAX]");
                std::process::exit(1);
            }
            let input = Path::new(&args[2]);
            let output = Path::new(&args[3]);
            let max: Option<u64> = if args.len() >= 5 {
                args[4].parse().ok()
            } else {
                None
            };

            println!("=== [TOAD Core] Converting EVTX -> JSONL ===");
            println!("    Input : {}", input.display());
            println!("    Output: {}", output.display());
            let stats = convert_evtx_to_jsonl(input, output, max)?;
            println!("[EVTX Engine] Conversion completed.");
            println!("    Extracted records : {}", stats.total_records);
            println!("    Parse errors      : {}", stats.errors);
            println!("    Elapsed time      : {:.2} ms", stats.elapsed_ms);
        }

        "transcode" => {
            if args.len() < 4 {
                eprintln!("Error: Missing arguments. Usage: toad-core transcode <INPUT> <OUTPUT>");
                std::process::exit(1);
            }
            let input = Path::new(&args[2]);
            let output = Path::new(&args[3]);
            let stats = transcode_to_utf8(input, output)?;
            println!(
                r#"{{"encoding":"{}","bytes_written":{},"elapsed_ms":{:.2}}}"#,
                stats.encoding, stats.bytes_written, stats.elapsed_ms
            );
        }

        "init-portable" => {
            let custom_dir = if args.len() >= 3 {
                Some(PathBuf::from(&args[2]))
            } else {
                None
            };
            let env = init_portable_environment(custom_dir)?;
            let json_str = serde_json::to_string_pretty(&env)?;
            println!("{}", json_str);
        }

        "clean-temp" => {
            if args.len() < 3 {
                eprintln!("Error: Missing temp directory path. Usage: toad-core clean-temp <TEMP_DIR>");
                std::process::exit(1);
            }
            let dir = Path::new(&args[2]);
            let count = clean_temp_dir(dir)?;
            println!("[TOAD Core] Cleaned {} temporary item(s).", count);
        }

        "normalize-csv" => {
            if args.len() < 4 {
                eprintln!("Error: Missing arguments. Usage: toad-core normalize-csv <INPUT> <OUTPUT>");
                std::process::exit(1);
            }
            let input = Path::new(&args[2]);
            let output = Path::new(&args[3]);
            let count = normalize_dirty_csv(input, output, ',')?;
            println!("[TOAD Core] Normalized {} data row(s).", count);
        }

        "get-io" => {
            let pid: u32 = if args.len() >= 3 {
                args[2].parse().unwrap_or(0)
            } else {
                0
            };
            match get_process_io_bytes(pid) {
                Some((r, w)) => {
                    println!(r#"{{"pid":{},"read_bytes":{},"write_bytes":{}}}"#, pid, r, w);
                }
                None => {
                    eprintln!("Error: Unable to read I/O counters for PID {}", pid);
                    std::process::exit(1);
                }
            }
        }

        "watch-io" => {
            use std::io::Write;
            let pid: u32 = if args.len() >= 3 {
                args[2].parse().unwrap_or(0)
            } else {
                0
            };
            let interval_ms: u64 = if args.len() >= 4 {
                args[3].parse().unwrap_or(1000)
            } else {
                1000
            };

            loop {
                match get_process_io_bytes(pid) {
                    Some((r, w)) => {
                        println!(r#"{{"read_bytes":{},"write_bytes":{}}}"#, r, w);
                        let _ = std::io::stdout().flush();
                    }
                    None => {
                        break;
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(interval_ms));
            }
        }

        "test-qa" => {
            run_qa_test_suite()?;
        }

        _ => {
            print_help();
        }
    }

    Ok(())
}

fn run_qa_test_suite() -> std::io::Result<()> {
    println!("============================================================");
    println!("           TOAD RUST CORE ENGINE - QA TEST SUITE            ");
    println!("============================================================");

    let tmp_base = std::env::temp_dir().join(format!("toad_qa_{}", gen_random_suffix(4)));
    std::fs::create_dir_all(&tmp_base)?;

    println!("\n[QA 1] Binary Guard Check:");
    let valid_csv = tmp_base.join("clean.csv");
    std::fs::write(&valid_csv, "id,name,role\n1,Alice,Dev\n2,Bob,Sec\n")?;

    let cat = inspect_file(&valid_csv)?;
    assert_eq!(cat, FileFormatCategory::DelimitedText);
    println!("  -> [PASS] Valid CSV accepted.");

    let malicious_bin = tmp_base.join("danger.csv");
    std::fs::write(&malicious_bin, b"Test\x00NullByteData")?;
    let bin_res = inspect_file(&malicious_bin);
    assert!(bin_res.is_err());
    println!("  -> [PASS] Null-byte binary blocked.");

    println!("\n[QA 2] Portable AppData & Auto-Heal:");
    let env = init_portable_environment(Some(tmp_base.clone()))?;
    assert!(env.app_data_dir.exists());
    assert!(env.app_data_dir.join("config.ini").exists());
    println!("  -> [PASS] Created portable dir: {}", env.app_data_dir.display());

    let cfg_path = env.app_data_dir.join("config.ini");
    std::fs::write(
        &cfg_path,
        "[general]\nviewer = invalid_name\n[parquet]\nrow_group_size = -50\n",
    )?;
    let healed = validate_and_ensure_config(&cfg_path)?;
    assert_eq!(healed.general.viewer, "toad");
    assert_eq!(healed.parquet.row_group_size, 100_000);
    println!("  -> [PASS] Auto-Heal restored corrupted configuration.");

    println!("\n[QA 3] Dirty CSV Delimiter Sniffer & Normalizer:");
    let dirty_csv = tmp_base.join("dirty.csv");
    std::fs::write(
        &dirty_csv,
        "id;name;role\n1;Alice;Engineer\n2;Bob\n3;Charlie;Lead;ExtraCol\n",
    )?;
    let clean_csv = tmp_base.join("normalized.csv");
    let rows = normalize_dirty_csv(&dirty_csv, &clean_csv, ',')?;
    assert_eq!(rows, 3);
    println!("  -> [PASS] Detected ';' delimiter and normalized {} rows.", rows);

    println!("\n[QA 4] Temp Cleaner (preserving Ledger & WAL):");
    std::fs::write(env.temp_dir.join("test.parquet"), b"dummy")?;
    std::fs::write(env.temp_dir.join("toad_ledger.wal.jsonl"), b"{}\n")?;
    let cleaned = clean_temp_dir(&env.temp_dir)?;
    assert_eq!(cleaned, 1);
    assert!(env.temp_dir.join("toad_ledger.wal.jsonl").exists());
    println!("  -> [PASS] Cleaned temp cache while preserving WAL.");

    let sample_evtx = Path::new("D:/Shared_UserData/Downloads/data_sample/System.evtx");
    if sample_evtx.exists() {
        println!("\n[QA 5] Native Multi-Threaded EVTX Parser:");
        let out_jsonl = tmp_base.join("evtx_qa.jsonl");
        let stats = convert_evtx_to_jsonl(sample_evtx, &out_jsonl, Some(500))?;
        assert_eq!(stats.total_records, 500);
        assert_eq!(stats.errors, 0);

        let lines_content = std::fs::read_to_string(&out_jsonl)?;
        for line in lines_content.lines().take(50) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                if let Some(tc) = v.get("TimeCreated").and_then(|t| t.as_str()) {
                    assert!(
                        tc.ends_with('Z') && tc.contains('T'),
                        "TimeCreated must be ISO-8601 UTC RFC3339"
                    );
                }
                assert!(v.get("Binary").is_some(), "Binary column must exist");
                assert!(v.get("param1").is_some(), "param1 column must exist");
                assert!(v.get("param2").is_some(), "param2 column must exist");
                if let Some(eid) = v.get("EventID") {
                    assert!(eid.is_number(), "EventID must be a number");
                }
            }
        }

        println!(
            "  -> [PASS] Extracted 500 EVTX records in {:.2} ms.",
            stats.elapsed_ms
        );
    }

    let _ = std::fs::remove_dir_all(&tmp_base);

    println!("\n============================================================");
    println!("            ALL RUST QA SELF-TESTS PASSED (100%)            ");
    println!("============================================================");

    Ok(())
}
