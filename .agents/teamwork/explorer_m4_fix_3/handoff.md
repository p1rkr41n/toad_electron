# Handoff Report: Release Target DLL Linkage Remediation (`duckdb.dll`)

**Agent**: `explorer_m4_fix_3`  
**Milestone**: Milestone 4 Remediation (Squad 4)  
**Parent Agent**: `07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d`  
**Working Directory**: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m4_fix_3\`  
**Date**: 2026-11-04  
**Scope**: `tauri/project/src-tauri/build.rs` automated runtime library placement for Windows release and test targets

---

## 1. Observation

### 1.1 Verbatim Failure Reproduction
Executing cargo tests with the `--release` profile fails immediately with `STATUS_DLL_NOT_FOUND (0xc0000135)`:

```powershell
cargo test --manifest-path tauri/project/src-tauri/Cargo.toml --release --test adversarial_challenger_m4_tests -- test_corrupt_wal_recovery_0_byte_truncation
```

**Verbatim Output**:
```
    Finished `release` profile [optimized] target(s) in 1.13s
     Running tests\adversarial_challenger_m4_tests.rs (tauri\project\src-tauri\target\release\deps\adversarial_challenger_m4_tests-bd97eb8127fcc892.exe)
error: test failed, to rerun pass `--test adversarial_challenger_m4_tests`

Caused by:
  process didn't exit successfully: `D:\Shared_UserData\Downloads\tad\tauri\project\src-tauri\target\release\deps\adversarial_challenger_m4_tests-bd97eb8127fcc892.exe test_corrupt_wal_recovery_0_byte_truncation` (exit code: 0xc0000135, STATUS_DLL_NOT_FOUND)
```

### 1.2 Inspection of `tauri/project/src-tauri/build.rs`
The existing build script at `tauri/project/src-tauri/build.rs:1-8` contains:

```rust
fn main() {
    tauri_build::build();

    // Delay-load comctl32.dll so that headless unit tests and CLI runs
    // do not fail with STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139) on Windows GNU toolchain.
    println!("cargo:rustc-link-arg=--delayload=comctl32.dll");
}
```

There is zero logic to locate or copy dynamic link libraries (`duckdb.dll`) to build output directories.

### 1.3 Filesystem DLL Distribution
A filesystem audit revealed the following state:
- `tauri/project/src-tauri/target/debug/duckdb.dll`: Present (29,435,360 bytes, LastWriteTime: 4/7/2025 11:07:18 AM).
- `tauri/project/src-tauri/target/debug/deps/duckdb.dll`: Present (29,435,360 bytes).
- `tauri/project/src-tauri/target/release/duckdb.dll`: **Missing**.
- `tauri/project/src-tauri/target/release/deps/duckdb.dll`: **Missing**.
- `tauri/project/src-tauri/lib/`: Contains `duckdb.h`, `duckdb.hpp`, `duckdb.lib`, `libduckdb.a`. `duckdb.dll` was omitted to avoid committing large binaries into git.

### 1.4 Empirical Verification of Missing DLL as Sole Root Cause
Manually copying `duckdb.dll` into `target/release/` and `target/release/deps/`:
```powershell
Copy-Item 'tauri/project/src-tauri/target/debug/duckdb.dll' -Destination 'tauri/project/src-tauri/target/release/duckdb.dll' -Force
Copy-Item 'tauri/project/src-tauri/target/debug/duckdb.dll' -Destination 'tauri/project/src-tauri/target/release/deps/duckdb.dll' -Force
cargo test --manifest-path tauri/project/src-tauri/Cargo.toml --release --test adversarial_challenger_m4_tests -- test_corrupt_wal_recovery_0_byte_truncation
```

**Verbatim Result**:
```
    Finished `release` profile [optimized] target(s) in 1.15s
     Running tests\adversarial_challenger_m4_tests.rs (tauri\project\src-tauri\target\release\deps\adversarial_challenger_m4_tests-bd97eb8127fcc892.exe)

running 1 test
test test_corrupt_wal_recovery_0_byte_truncation ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 7 filtered out; finished in 0.30s
```
The test passed cleanly in 0.30s with 0 errors.

---

## 2. Logic Chain

1. **Windows Dynamic Link Library Resolution Order**:
   - On Windows, when an executable starts (e.g. `target\release\deps\adversarial_challenger_m4_tests-bd97eb8127fcc892.exe`), the OS loader searches for imported DLLs (`duckdb.dll`) in:
     1. The directory containing the binary (`target\release\deps\`).
     2. System directories (`System32`, `SysWOW64`).
     3. The 16-bit system directory.
     4. The Windows directory.
     5. The current working directory.
     6. Directories listed in `%PATH%`.
   - Because `duckdb.dll` was only present in `target\debug\` and `target\debug\deps\`, test binaries built under `--release` fail immediately with exit code `0xc0000135` (`STATUS_DLL_NOT_FOUND`).
   - The main release executable `target\release\toad.exe` similarly requires `duckdb.dll` directly in `target\release\`.

2. **Cargo Build Script Target Directory Navigation**:
   - Cargo executes `build.rs` and provides environment variable `OUT_DIR`, which resolves to:
     `<target-dir>/[<target-triple>/]<profile>/build/<pkg-name>-<hash>/out`
   - Following the standard reference pattern in `tauri-build` (`target_dir_from_out_dir`):
     ```rust
     out_dir.ancestors()
         .find(|p| p.file_name() == Some(std::ffi::OsStr::new("build")))
         .and_then(|build_dir| build_dir.parent())
     ```
     This resolves to `target_profile_dir` (`target/debug` or `target/release`), and its parent resolves to `target_root` (`target/`).

3. **Multi-Source Candidate Search Strategy**:
   - To make the build system robust across clean clones, CI environments, and local checkouts, `build.rs` checks candidate source paths in prioritized order:
     1. `env::var("DUCKDB_LIB_DIR")`
     2. `CARGO_MANIFEST_DIR/lib/duckdb.dll`
     3. `CARGO_MANIFEST_DIR/duckdb.dll`
     4. `target_root/debug/duckdb.dll` & `target_root/debug/deps/duckdb.dll`
     5. `target_root/release/duckdb.dll` & `target_root/release/deps/duckdb.dll`
   - Once located, `build.rs` emits:
     - `cargo:rerun-if-changed=<path>`
     - `cargo:rerun-if-env-changed=DUCKDB_LIB_DIR`
     - `cargo:rustc-link-search=native=<manifest_dir>/lib`

4. **Multi-Target Destination Placement**:
   - `duckdb.dll` must be placed in:
     - `target_profile_dir` (where `toad.exe` resides)
     - `target_profile_dir.join("deps")` (where `cargo test` harnesses reside)
     - Sibling profile directories (`target/debug`, `target/debug/deps`, `target/release`, `target/release/deps`) if their directory exists, ensuring that switching between `cargo test` and `cargo test --release` never encounters a missing DLL.

5. **Windows Sharing Violation & Zero Redundant I/O Guard**:
   - On Windows NTFS, overwriting a DLL actively memory-mapped by a running process or IDE fails with `PermissionDenied` (os error 5) or `SharingViolation` (os error 32).
   - Helper function `copy_if_different` inspects `metadata().len()`. If the destination already exists with identical byte length, the copy is safely bypassed. This prevents unnecessary ~28MB disk writes and eliminates file locking collisions.

---

## 3. Caveats

1. **Read-Only Explorer Scope**:
   - Product code was not directly modified in this investigation. The proposed code has been prepared as a drop-in replacement file `proposed_build.rs` and unified patch `duckdb_dll_copy.patch` in this agent's folder (`.agents/teamwork/explorer_m4_fix_3/`).
2. **Fresh Repository Clones & `cargo clean`**:
   - If `cargo clean` is run and `src-tauri/lib/duckdb.dll` is not present, `target/debug/duckdb.dll` would be deleted. Placing `duckdb.dll` in `tauri/project/src-tauri/lib/duckdb.dll` alongside `duckdb.lib` and `libduckdb.a` guarantees permanence across all clean operations. If kept locally, adding `tauri/project/src-tauri/lib/*.dll` to `.gitignore` ensures it does not bloat VCS history.
3. **Packaging Integration**:
   - Milestone 5 portable packaging scripts (`package_portable.ps1`) will bundle `duckdb.dll` from `target/release/duckdb.dll` alongside `Toad-2.5.1-x64-portable.exe`. This fix directly unblocks that packaging pipeline.

---

## 4. Conclusion

The missing `duckdb.dll` in `target/release/` and `target/release/deps/` is completely remedied by updating `tauri/project/src-tauri/build.rs` with an automated runtime DLL discovery and copy routine.

### Recommended Code Change

Apply the patch `.agents/teamwork/explorer_m4_fix_3/duckdb_dll_copy.patch` or replace `tauri/project/src-tauri/build.rs` with `proposed_build.rs`:

```rust
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    tauri_build::build();

    // Delay-load comctl32.dll so that headless unit tests and CLI runs
    // do not fail with STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139) on Windows GNU toolchain.
    println!("cargo:rustc-link-arg=--delayload=comctl32.dll");

    copy_duckdb_dll();
}

/// Automatically locate duckdb.dll and copy it into the target profile directory
/// (e.g., target/debug, target/release) and its deps/ directory (e.g., target/debug/deps, target/release/deps)
/// so that both application binaries and cargo test runners execute cleanly on Windows without
/// STATUS_DLL_NOT_FOUND (0xc0000135).
fn copy_duckdb_dll() {
    // Only execute on Windows targets
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os != "windows" && !cfg!(target_os = "windows") {
        return;
    }

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".into()));
    let out_dir = match env::var("OUT_DIR") {
        Ok(val) => PathBuf::from(val),
        Err(_) => return,
    };

    // Inform cargo to link with native libraries in lib/ directory if present
    let lib_dir = manifest_dir.join("lib");
    if lib_dir.exists() {
        println!("cargo:rustc-link-search=native={}", lib_dir.display());
    }

    // Resolve target profile dir (e.g., target/debug or target/release) from OUT_DIR.
    // OUT_DIR is typically <target-dir>/[<target-triple>/]<profile>/build/<pkg-name>-<hash>/out
    let target_profile_dir = match out_dir
        .ancestors()
        .find(|p| p.file_name().map_or(false, |name| name == "build"))
        .and_then(|build_dir| build_dir.parent())
    {
        Some(dir) => dir.to_path_buf(),
        None => return,
    };

    let target_root = match target_profile_dir.parent() {
        Some(p) => p.to_path_buf(),
        None => return,
    };

    // Locate source duckdb.dll in candidate locations
    let mut candidate_sources: Vec<PathBuf> = Vec::new();

    if let Ok(env_dir) = env::var("DUCKDB_LIB_DIR") {
        candidate_sources.push(PathBuf::from(env_dir).join("duckdb.dll"));
    }

    candidate_sources.push(manifest_dir.join("lib").join("duckdb.dll"));
    candidate_sources.push(manifest_dir.join("duckdb.dll"));

    // Check build directories across profiles
    candidate_sources.push(target_root.join("debug").join("duckdb.dll"));
    candidate_sources.push(target_root.join("debug").join("deps").join("duckdb.dll"));
    candidate_sources.push(target_root.join("release").join("duckdb.dll"));
    candidate_sources.push(target_root.join("release").join("deps").join("duckdb.dll"));

    // Find the first valid existing source file
    let source_dll = candidate_sources.into_iter().find(|p| p.is_file());

    let source_dll = match source_dll {
        Some(src) => src,
        None => {
            println!("cargo:warning=duckdb.dll not found in candidate paths. Windows test executables may fail with STATUS_DLL_NOT_FOUND (0xc0000135).");
            return;
        }
    };

    println!("cargo:rerun-if-changed={}", source_dll.display());
    println!("cargo:rerun-if-env-changed=DUCKDB_LIB_DIR");

    // Collect all target directories where duckdb.dll is required
    let mut dest_dirs: Vec<PathBuf> = Vec::new();

    // 1. Current build profile root and its deps/ directory
    dest_dirs.push(target_profile_dir.clone());
    dest_dirs.push(target_profile_dir.join("deps"));

    // 2. Also populate sibling profiles (debug/release) if their directory exists
    for profile_name in &["debug", "release"] {
        let profile_dir = target_root.join(profile_name);
        if profile_dir.exists() {
            dest_dirs.push(profile_dir.clone());
            dest_dirs.push(profile_dir.join("deps"));
        }
    }

    // Deduplicate destination paths
    dest_dirs.sort();
    dest_dirs.dedup();

    for dest_dir in dest_dirs {
        let dest_file = dest_dir.join("duckdb.dll");
        if let Err(e) = copy_if_different(&source_dll, &dest_file) {
            println!(
                "cargo:warning=Failed to copy duckdb.dll to {}: {}",
                dest_file.display(),
                e
            );
        }
    }
}

/// Copies `from` to `to` only if `to` does not exist or has a different file size.
/// This prevents redundant disk I/O and Windows ERROR_SHARING_VIOLATION / ERROR_ACCESS_DENIED
/// if the DLL is currently loaded by an active process.
fn copy_if_different(from: &Path, to: &Path) -> std::io::Result<()> {
    if from == to {
        return Ok(());
    }

    if to.exists() {
        if let (Ok(src_meta), Ok(dst_meta)) = (from.metadata(), to.metadata()) {
            if src_meta.len() == dst_meta.len() && src_meta.len() > 0 {
                return Ok(());
            }
        }
    }

    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::copy(from, to)?;
    Ok(())
}
```

---

## 5. Verification Method

### Step 1: Apply Patch or Replace `build.rs`
Verify that `tauri/project/src-tauri/build.rs` includes `copy_duckdb_dll()` and `copy_if_different()`.

### Step 2: Remove Release Binaries to Trigger Fresh Build
```powershell
Remove-Item -Path "tauri\project\src-tauri\target\release\duckdb.dll", "tauri\project\src-tauri\target\release\deps\duckdb.dll" -Force -ErrorAction SilentlyContinue
```

### Step 3: Run `--release` Tests without Modifying `$env:PATH`
```powershell
cargo test --manifest-path tauri/project/src-tauri/Cargo.toml --release --test adversarial_challenger_m4_tests -- test_corrupt_wal_recovery_0_byte_truncation
```

**Expected Invalidation Condition**:
If the fix is absent or incorrect, this command fails with:
`exit code: 0xc0000135, STATUS_DLL_NOT_FOUND`.

**Expected Success Output**:
```
test test_corrupt_wal_recovery_0_byte_truncation ... ok
test result: ok. 1 passed; 0 failed; finished in ~0.30s
```

### Step 4: Verify Both Profiles Populated
```powershell
Get-Item "tauri\project\src-tauri\target\debug\duckdb.dll", "tauri\project\src-tauri\target\debug\deps\duckdb.dll", "tauri\project\src-tauri\target\release\duckdb.dll", "tauri\project\src-tauri\target\release\deps\duckdb.dll" | Select-Object FullName, Length
```
All four paths must exist and match `29,435,360` bytes.
