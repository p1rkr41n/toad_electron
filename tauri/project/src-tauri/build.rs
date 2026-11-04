fn main() {
    tauri_build::build();

    // Delay-load comctl32.dll so that headless unit tests and CLI runs
    // do not fail with STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139) on Windows GNU toolchain.
    println!("cargo:rustc-link-arg=--delayload=comctl32.dll");
}
