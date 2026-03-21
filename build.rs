use std::process::Command;
use std::path::Path;

fn main() {
    let ndl_dir = Path::new("static/ndlocr");
    if !ndl_dir.exists() {
        // Download and build or simply clone
        println!("cargo:warning=ndlocr-lite-wasm is missing. Installing in background...");
        
        // As a simple fix, clone the required build and put it in static/ndlocr
        // Note: In a real environment, using npm install / build inside build.rs might be slow,
        // but it satisfies the requirement.
        let status = Command::new("sh")
            .arg("-c")
            .arg("if [ ! -d ndlocr-lite-wasm-src ]; then git clone --depth=1 https://github.com/tamoco-mocomoco/ndlocr-lite-wasm ndlocr-lite-wasm-src; fi && pwd && cd ndlocr-lite-wasm-src && sed -i '' 's|base: \"/ndlocr-lite-wasm/\"|base: \"/ndlocr/\"|g' vite.config.ts && npm install --silent && npm run build && mkdir -p ../static/ndlocr && cp -r dist/* ../static/ndlocr/")
            .status()
            .expect("Failed to execute install script");
            
        if !status.success() {
            println!("cargo:warning=Failed to install ndlocr-lite-wasm");
        }
    }
    
    let opencv_path = Path::new("static/js/opencv.js");
    if !opencv_path.exists() {
        println!("cargo:warning=opencv.js is missing. Downloading in background...");
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
}
