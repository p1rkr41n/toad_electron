# DISPATCH: challenger_m7_1 — Portable Execution & Startup Latency Adversarial Challenger 1

## Identity
- Role: Portable Execution & Startup Latency Adversarial Challenger 1 (Squad 7)
- Working Directory: D:\Shared_UserData\Downloads\tad\.agents\teamwork\challenger_m7_1\
- Recipient: orchestrator_tauri (Conversation ID: 07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d)

## Mission
Adversarially challenge and stress-test the portable executable execution and startup latency:
1. Read `D:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md` and `D:\Shared_UserData\Downloads\tad\PROJECT.md`.
2. Test standalone portable execution in completely isolated environments:
   - Create an isolated temporary directory (e.g. `tmp_test_portable_chal1`).
   - Copy `Toad-2.5.2-x64-portable.exe`, `duckdb.dll`, and `WebView2Loader.dll` into it (or extract `Toad-2.5.2-x64-portable.zip` into it).
   - Launch `Toad.exe` / `Toad-2.5.2-x64-portable.exe`.
   - Verify that process starts up without any missing DLL popup dialogs (specifically confirming `WebView2Loader.dll` and `duckdb.dll` are loaded correctly).
   - Verify that it creates a self-contained `toadAppData_[5chars]` folder adjacent to the executable, containing `config.ini`, `toad_ledger.parquet`, `logs/`, `temp/`.
   - Measure startup latency: window creation / initialization should be rapid (< 300ms).
   - Cleanly terminate the process and verify no locked orphan processes remain.
3. Negative / Stress testing:
   - What happens if `WebView2Loader.dll` is missing? (Confirm failure mode and confirm our packaged zip / release folder strictly includes it so end-users never experience this).
   - Test directory with spaces or non-standard paths.
4. Issue a clear verdict: **APPROVE** or **REQUEST_CHANGES** with empirical benchmark data in `handoff.md`.
