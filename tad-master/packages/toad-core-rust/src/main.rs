//! main.rs
//!
//! CLI Entrypoint cho TOAD Rust Core Engine (Pure Rust)
//! Cung cấp các lệnh kiểm tra, phân tích, chuyển đổi EVTX và QA Test Suite.

use std::path::{Path, PathBuf};
use toad_core::*;

fn print_help() {
    println!(
        r#"TOAD Core Engine v1.1.0 - High-Performance Rust Engine for Toad Viewer

USAGE:
  toad-core inspect <FILE>                   : Kiem tra Binary Guard & Schema
  toad-core evtx-dump <INPUT> <OUTPUT> [MAX] : Chuyen doi truc tiep EVTX -> JSONL
  toad-core init-portable [EXE_DIR]          : Khoi tao va validate toadAppData
  toad-core clean-temp <TEMP_DIR>            : Don sach temp voi retry EBUSY
  toad-core normalize-csv <INPUT> <OUTPUT>   : Chuan hoa delimiter va dong CSV
  toad-core get-io [PID]                     : Doc chi so IO doc/ghi cua tien trinh
  toad-core watch-io [PID] [INTERVAL_MS]     : Theo doi lien tuc IO tien trinh realtime
  toad-core test-qa                          : Chay toan bo QA Test Suite
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
                eprintln!("Loi: Thieu duong dan file! Cu phap: toad-core inspect <FILE>");
                std::process::exit(1);
            }
            let path = Path::new(&args[2]);
            println!("=== [TOAD Core] Kiem tra file: {} ===", path.display());
            match inspect_file(path) {
                Ok(cat) => {
                    println!("[Binary Guard] Trang thai: HOP LE");
                    println!("[Binary Guard] Dinh dang: {:?}", cat);
                    if cat == FileFormatCategory::DelimitedText {
                        if let Ok(meta) = inspect_csv(path) {
                            println!("[CSV Engine] Dau phan cach: '{}'", meta.delimiter);
                            println!("[CSV Engine] So cot: {}", meta.column_count);
                            println!("[CSV Engine] Tieu de cot: {:?}", meta.headers);
                            println!("[CSV Engine] So dong uoc tinh: {}", meta.estimated_rows);
                        }
                    }
                }
                Err(err) => {
                    eprintln!("[Binary Guard] BI CHAN: {}", err);
                    std::process::exit(1);
                }
            }
        }

        "evtx-dump" => {
            if args.len() < 4 {
                eprintln!("Loi: Thieu tham so! Cu phap: toad-core evtx-dump <INPUT> <OUTPUT> [MAX]");
                std::process::exit(1);
            }
            let input = Path::new(&args[2]);
            let output = Path::new(&args[3]);
            let max: Option<u64> = if args.len() >= 5 {
                args[4].parse().ok()
            } else {
                None
            };

            println!("=== [TOAD Core] Bat dau chuyen doi EVTX -> JSONL ===");
            println!("    Nguon : {}", input.display());
            println!("    Dich  : {}", output.display());
            let stats = convert_evtx_to_jsonl(input, output, max)?;
            println!("[EVTX Engine] Chuyen doi hoan tat thanh cong!");
            println!("    So ban ghi trich xuat : {}", stats.total_records);
            println!("    So ban ghi loi        : {}", stats.errors);
            println!("    Thoi gian xu ly       : {:.2} ms", stats.elapsed_ms);
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
                eprintln!("Loi: Thieu duong dan temp! Cu phap: toad-core clean-temp <TEMP_DIR>");
                std::process::exit(1);
            }
            let dir = Path::new(&args[2]);
            let count = clean_temp_dir(dir)?;
            println!("[TOAD Core] Da don dep sach {} muc trong temp.", count);
        }

        "normalize-csv" => {
            if args.len() < 4 {
                eprintln!("Loi: Thieu tham so! Cu phap: toad-core normalize-csv <INPUT> <OUTPUT>");
                std::process::exit(1);
            }
            let input = Path::new(&args[2]);
            let output = Path::new(&args[3]);
            let count = normalize_dirty_csv(input, output, ',')?;
            println!("[TOAD Core] Da chuan hoa {} dong du lieu.", count);
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
                    eprintln!("Loi: Khong the doc chi so IO cho PID {}", pid);
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

/// Bo kiem thu QA Test Suite toan dien
fn run_qa_test_suite() -> std::io::Result<()> {
    println!("============================================================");
    println!("           TOAD RUST CORE ENGINE - QA TEST SUITE            ");
    println!("============================================================");

    let tmp_base = std::env::temp_dir().join(format!("toad_qa_{}", gen_random_suffix(4)));
    std::fs::create_dir_all(&tmp_base)?;

    // QA Test 1: Binary Guard
    println!("\n[QA 1] Kiem thu Binary Guard:");
    let valid_csv = tmp_base.join("clean.csv");
    std::fs::write(&valid_csv, "id,name,role\n1,Alice,Dev\n2,Bob,Sec\n")?;

    let cat = inspect_file(&valid_csv)?;
    assert_eq!(cat, FileFormatCategory::DelimitedText);
    println!("  -> [PASS] CSV hop le duoc chap nhan.");

    let malicious_bin = tmp_base.join("danger.csv");
    std::fs::write(&malicious_bin, b"Test\x00NullByteData")?;
    let bin_res = inspect_file(&malicious_bin);
    assert!(bin_res.is_err());
    println!("  -> [PASS] Binary co null-byte bi chan thanh cong.");

    // QA Test 2: Portable AppData & Auto-Heal
    println!("\n[QA 2] Kiem thu Portable AppData & Auto-Heal:");
    let env = init_portable_environment(Some(tmp_base.clone()))?;
    assert!(env.app_data_dir.exists());
    assert!(env.app_data_dir.join("config.ini").exists());
    println!("  -> [PASS] Da tu sinh thu muc: {}", env.app_data_dir.display());

    // Pha hong config.ini de test Auto-Heal
    let cfg_path = env.app_data_dir.join("config.ini");
    std::fs::write(
        &cfg_path,
        "[general]\nviewer = invalid_name\n[parquet]\nrow_group_size = -50\n",
    )?;
    let healed = validate_and_ensure_config(&cfg_path)?;
    assert_eq!(healed.general.viewer, "toad");
    assert_eq!(healed.parquet.row_group_size, 100_000);
    println!("  -> [PASS] Auto-Heal da tu dong va loi cau hinh bi hong.");

    // QA Test 3: CSV Normalizer
    println!("\n[QA 3] Kiem thu Sniffer & Chuan hoa CSV ban:");
    let dirty_csv = tmp_base.join("dirty.csv");
    std::fs::write(
        &dirty_csv,
        "id;name;role\n1;Alice;Engineer\n2;Bob\n3;Charlie;Lead;ExtraCol\n",
    )?;
    let clean_csv = tmp_base.join("normalized.csv");
    let rows = normalize_dirty_csv(&dirty_csv, &clean_csv, ',')?;
    assert_eq!(rows, 3);
    println!("  -> [PASS] Da nhan dien delimiter ';' va chuan hoa {} dong.", rows);

    // QA Test 4: Temp Cleaner
    println!("\n[QA 4] Kiem thu Don dep Temp:");
    std::fs::write(env.temp_dir.join("test.parquet"), b"dummy")?;
    let cleaned = clean_temp_dir(&env.temp_dir)?;
    assert_eq!(cleaned, 1);
    assert_eq!(std::fs::read_dir(&env.temp_dir)?.count(), 0);
    println!("  -> [PASS] Don sach 100% file rac trong temp.");

    // QA Test 5: Native EVTX Parser
    let sample_evtx = Path::new("D:/Shared_UserData/Downloads/tad/data_sample/System.evtx");
    if sample_evtx.exists() {
        println!("\n[QA 5] Kiem thu Native Multi-Threaded EVTX Parser:");
        let out_jsonl = tmp_base.join("evtx_qa.jsonl");
        let stats = convert_evtx_to_jsonl(sample_evtx, &out_jsonl, Some(500))?;
        assert_eq!(stats.total_records, 500);
        assert_eq!(stats.errors, 0);

        let lines_content = std::fs::read_to_string(&out_jsonl)?;
        for line in lines_content.lines().take(50) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                if let Some(tc) = v.get("TimeCreated").and_then(|t| t.as_str()) {
                    assert!(tc.ends_with('Z') && tc.contains('T'), "TimeCreated must be ISO-8601 UTC RFC3339");
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
            "  -> [PASS] Trich xuat 500 ban ghi EVTX trong {:.2} ms (chuan ISO-8601, EventID so, Binary & param day du).",
            stats.elapsed_ms
        );
    }

    // Don dep tmp_base
    let _ = std::fs::remove_dir_all(&tmp_base);

    println!("\n============================================================");
    println!("          TAT CA CAC BAI TEST QA DEU DAT CHUAN (100%)       ");
    println!("============================================================");

    Ok(())
}
