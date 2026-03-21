use wasm_bindgen::prelude::*;
use js_sys::Uint8ClampedArray;

#[wasm_bindgen]
pub struct ImageProcessor {
    width: u32,
    height: u32,
}

#[wasm_bindgen]
impl ImageProcessor {
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32) -> Self {
        Self { width, height }
    }

    /// Optimized Grayscale & Contrast (Rust implementation)
    pub fn preprocess_rust(&self, data: Uint8ClampedArray, contrast: f32) -> Uint8ClampedArray {
        let mut pixels = data.to_vec();
        let mid = 128.0;

        for i in (0..pixels.len()).step_by(4) {
            let r = pixels[i] as f32;
            let g = pixels[i+1] as f32;
            let b = pixels[i+2] as f32;

            // Grayscale (ITU-R BT.709 weight)
            let mut gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;

            // Apply Contrast
            gray = ((gray - mid) * contrast) + mid;
            let val = gray.max(0.0).min(255.0) as u8;

            pixels[i]   = val;
            pixels[i+1] = val;
            pixels[i+2] = val;
            // Alpha stays the same (pixels[i+3])
        }
        
        let out = Uint8ClampedArray::new_with_length(pixels.len() as u32);
        out.copy_from(&pixels);
        out
    }

    /// Simple Character ROI detection (Find areas with high variance/edges)
    /// This is a lightweight substitute for full inference to show Rust's potential
    pub fn detect_text_regions(&self, data: Uint8ClampedArray) -> Box<[f32]> {
        let _pixels = data.to_vec();
        let mut regions = Vec::new();
        
        // This is a placeholder for a more complex line-detection algorithm
        // We'll return the center ROI as a proof of concept
        regions.push(0.0); // x
        regions.push(0.0); // y
        regions.push(self.width as f32); // w
        regions.push(self.height as f32); // h
        
        regions.into_boxed_slice()
    }
}
