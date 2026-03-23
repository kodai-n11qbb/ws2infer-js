use std::process::Command;
use std::path::Path;

fn main() {
    let src_dir = Path::new("ndlocr-lite-wasm-src");

    // Rule: Always check for changes in the worker source and rebuild if needed
    if src_dir.exists() {
        println!("cargo:rerun-if-changed=ndlocr-lite-wasm-src/src");
        println!("cargo:rerun-if-changed=ndlocr-lite-wasm-src/vite.config.ts");
        println!("cargo:rerun-if-changed=ndlocr-lite-wasm-src/package.json");

        // Force build if source changed (Cargo handles rerun-if-changed trigger)
        // Note: For production, we'd use a more sophisticated check, 
        // but for Refactor-ready Dev, this ensures 'cargo test' is reliable.
        build_worker();
    }


    let opencv_path = Path::new("static/js/opencv.js");
    if !opencv_path.exists() {
        println!("cargo:warning=opencv.js is missing. Downloading...");
        let status = Command::new("curl")
            .arg("-s")
            .arg("https://docs.opencv.org/4.8.0/opencv.js")
            .arg("-o")
            .arg("static/js/opencv.js")
            .status()
            .expect("Failed to download opencv.js");
            
        if !status.success() {
            println!("cargo:warning=Failed to download opencv.js");
        }
    }
    
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=static/test-ndlocr.html");
}

fn build_worker() {
    println!("cargo:warning=Building ndlocr-lite-wasm worker...");
    let status = Command::new("sh")
        .arg("-c")
        .arg("cd ndlocr-lite-wasm-src && \
              rm -rf dist && \
              npm run build && \
              mkdir -p ../static/ndlocr/assets && \
              rm -f ../static/ndlocr/assets/ocr.worker* && \
              cp -r dist/* ../static/ndlocr/ && \
              cp dist/assets/ocr.worker-*.js ../static/ndlocr/assets/ocr.worker.js && \
              cp node_modules/onnxruntime-web/dist/*.wasm ../static/ndlocr/assets/ && \
              cp node_modules/onnxruntime-web/dist/*.mjs ../static/ndlocr/assets/ && \
              cp node_modules/opencv-wasm/opencv.wasm ../static/ndlocr/assets/")
        .status()
        .expect("Failed to execute build script");
        
    if !status.success() {
        panic!("Failed to build ndlocr-lite-wasm worker. Ensure npm/node is in PATH.");
    }
}

