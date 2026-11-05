## 2026-11-05T03:42:16Z
You are worker_m7_remediation (Milestone 7 Remediation Worker, Squad 7).
Working directory: D:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m7_remediation\
Original Parent Conversation ID: 07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

MANDATORY FILES TO READ BEFORE STARTING WORK:
1. D:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
2. D:\Shared_UserData\Downloads\tad\PROJECT.md
3. D:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_m7_remediation\DISPATCH.md
4. D:\Shared_UserData\Downloads\tad\.agents\teamwork\auditor_m7_1\handoff.md (Full audit report with 3 integrity violations)
5. D:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m7_fix_1\handoff.md (PE Resource Embedding blueprint and build.rs code)
6. D:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m7_fix_2\handoff.md (100-row warmup pass for Test 5.2 in test_tauri_arrow_ipc.js)
7. D:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m7_fix_3\handoff.md (VCS commit & package_portable.ps1 pipeline blueprint)

TASK INSTRUCTIONS:
1. Setup Toolchain & terminate process locks:
   Get-Process -Name Toad -ErrorAction SilentlyContinue | Stop-Process -Force
   $env:PATH = "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64;C:\Users\huydq\.cargo\bin;$env:PATH"
2. Implement PE Version Resource Generator in tauri/project/src-tauri/build.rs:
   Incorporate the pure Rust AMD64 COFF .rsrc generator from explorer_m7_fix_1/handoff.md Section 4 into build.rs.
   Ensure:
   - embed_pe_resources() is called in main().
   - Generates resource.o in OUT_DIR with RT_VERSION metadata (CompanyName: "HelloKittyXamKinLung", LegalCopyright: "Copyright © 2026 HelloKittyXamKinLung", ProductVersion: "2.5.2", FileVersion: "2.5.2", ProductName: "Toad", FileDescription: "Toad").
   - Copies resource.o to libresource.a in OUT_DIR.
   - Emits println!("cargo:rustc-link-arg={}", resource_o.display());.
3. Implement 100-Row Warmup Pass in test_tauri_arrow_ipc.js:
   In tauri/project/tests/test_tauri_arrow_ipc.js, update Test 5.2 per explorer_m7_fix_2/handoff.md Section 4:
   Add the 100-row warmup table roundtrip before the timed block to warm up V8 JIT and FlatBuffers class cache.
4. Run Automated Verification Suites:
   - Run cargo test in src-tauri (all 139 tests must pass).
   - Run node tauri/project/tests/run_all_tests.js (all 55 tests across 3 suites must pass on cold run).
   - Test 10 cold runs of test_tauri_arrow_ipc.js Test 5.2 to guarantee 100% pass under 15ms.
5. Commit to Jujutsu VCS under HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>:
   jj describe -m "fix(m7): embed PE version branding, stabilize IPC microbenchmark, and harden scheduler assertions"
   jj bookmark set main -r @
   jj new
6. Execute Production Packaging Pipeline:
   powershell -ExecutionPolicy Bypass -File "tauri/project/tools/package_portable.ps1"
   Verify:
   - Toad-2.5.2-x64-portable.exe (< 50MB) and Toad-2.5.2-x64-portable.zip created in releases/.
   - SHA256SUMS.txt generated.
   - Canonical Toad.exe updated in root directory.
   - Verify PE metadata on Toad.exe: [System.Diagnostics.FileVersionInfo]::GetVersionInfo('Toad.exe')
     Confirm CompanyName is "HelloKittyXamKinLung" and LegalCopyright contains "HelloKittyXamKinLung".
   - Run section check script:
     powershell -ExecutionPolicy Bypass -File "D:\Shared_UserData\Downloads\tad\.agents\teamwork\auditor_m7_1\check_sections.ps1"
     Confirm .rsrc section is present with RawSize > 0.
7. Write comprehensive handoff.md in your working directory and notify the orchestrator via send_message.
