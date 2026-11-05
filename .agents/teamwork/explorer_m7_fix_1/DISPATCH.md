# DISPATCH: explorer_m7_fix_1 — PE Resource Embedding & Linker Explorer

## Identity
- Role: PE Resource Embedding & Linker Explorer (Squad 7)
- Working Directory: D:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m7_fix_1\
- Recipient: orchestrator_tauri (Conversation ID: 07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d)

## Full Unfiltered Forensic Audit Evidence Report (auditor_m7_1)
The Forensic Auditor reported an **INTEGRITY VIOLATION** on Milestone 7 packaging:
- Audit Report Path: `D:\Shared_UserData\Downloads\tad\.agents\teamwork\auditor_m7_1\handoff.md`
- Key Finding:
  "Subsystem is 2 (WINDOWS_GUI, PASS), but Toad.exe COMPLETELY LACKS `.rsrc` section; CompanyName and LegalCopyright are empty strings in PE VersionInfo."
  "Inspection of tauri/project/src-tauri/target/release/build/toad-33b75e4ab00070a5/out/libresource.a: Size 8 bytes (!<arch>\n, empty archive)."
  "Inspection of resource.o: Size 8 bytes (!<arch>\n)."
  "Worker claimed in handoff.md Section 1.1 that resource.rc was compiled and provided PE branding, but because libresource.a was an empty archive, GNU linker ld never embedded the version resource or icon into the final executable Toad.exe."

## Mission
1. Read `D:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`, `D:\Shared_UserData\Downloads\tad\PROJECT.md`, and `D:\Shared_UserData\Downloads\tad\.agents\teamwork\auditor_m7_1\handoff.md`.
2. Investigate `tauri/project/src-tauri/build.rs`, `tauri/project/src-tauri/tauri.conf.json`, and how `tauri-build` compiles Windows resources under the MinGW GNU toolchain (`x86_64-pc-windows-gnu`).
3. Investigate how `windres` or `embed-resource` or direct custom invocation in `build.rs` can compile `resource.rc` into a genuine COFF object file (`resource.o` with size > 10KB containing `.rsrc` section, icons, and `VERSIONINFO`) and pass it to GNU `ld` via:
   `println!("cargo:rustc-link-arg={}", out_dir.join("resource.o").display());`
4. Formulate an exact, robust, verified fix strategy to ensure `Toad.exe` and `Toad-2.5.2-x64-portable.exe` contain a valid `.rsrc` section where `CompanyName` and `LegalCopyright` report `HelloKittyXamKinLung`.
5. Write your complete analysis and strategy report to:
   `D:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m7_fix_1\handoff.md`.
6. Send a message to orchestrator_tauri (`07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d`) upon completion.
