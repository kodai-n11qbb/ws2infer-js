use std::process::Command;
use std::env;
use std::path::Path;

fn main() {
    // Tell Cargo that if any files in wasm_inference/src change, we need to rerun this build script.
    println!("cargo:rerun-if-changed=wasm_inference/src");
    println!("cargo:rerun-if-changed=wasm_inference/Cargo.toml");

    // Only run wasm-pack during real builds/runs (not purely on IDE checks if possible, though Cargo usually handles this)
    if env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default() != "wasm32" {
        build_wasm();
    }
}

fn build_wasm() {
    let root_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let _wasm_inference_dir = Path::new(&root_dir).join("wasm_inference");
    
    // Build command: wasm-pack build --target web --out-dir ../static/pkg wasm_inference
    // We assume wasm-pack is installed as per user's environment check.
    let status = Command::new("wasm-pack")
        .args(&[
            "build", 
            "--target", "web", 
            "--out-dir", "../static/pkg",
            "wasm_inference"
        ])
        .current_dir(&root_dir)
        .status();

    match status {
        Ok(s) if s.success() => {
            println!("cargo:warning=WASM build successful: wasm_inference -> static/pkg");
        }
        Ok(s) => {
            panic!("wasm-pack build failed with status: {}", s);
        }
        Err(e) => {
            // If wasm-pack is missing, we shouldn't necessarily panic in all environments, 
            // but for this project's objective, it's a critical dependency.
            println!("cargo:warning=Failed to execute wasm-pack: {}. Please ensure wasm-pack is installed.", e);
        }
    }
}
