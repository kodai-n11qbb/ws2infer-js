import * as ort from "onnxruntime-web";
import { fetchModel } from "../storage/model-cache";
import { decodeImage, cropImageData } from "../engine/image-utils";
import { detectionsToPage, createElement, findAll } from "../parser/ndl-parser";
import { evalPage } from "../reading-order/eval";
import { type IDetector, type IRecognizer } from "../engine/interfaces";
import { DEIMDetector } from "../engine/deim";
import { PARSeqRecognizer } from "../engine/parseq";
import { DIContainer } from "../engine/container";

// Worker entry point for OCR

// Silence noisy internal warnings
ort.env.logLevel = "error";

// Performance optimization: GPU-first acceleration (DEV_POLICY)
// Use multi-threading only if SharedArrayBuffer is available
const canUseThreads = typeof SharedArrayBuffer !== "undefined";
ort.env.wasm.numThreads = canUseThreads ? navigator.hardwareConcurrency || 4 : 1;

(ort.env as any).webgpu = {
  powerPreference: "high-performance",
};

ort.env.wasm.wasmPaths = "/ndlocr/assets/";

// Define message types
export type WorkerResponse =
  | { type: "init-progress"; model: string; loaded: number; total: number }
  | { type: "init-done" }
  | { type: "detect-done"; numDetections: number }
  | { type: "recognize-progress"; current: number; total: number }
  | { type: "result"; lines: any[]; detections: any[]; page: any }
  | { type: "error"; message: string };

type WorkerMessage =
  | { type: "init"; presetId: string }
  | { type: "run"; imageBlob: Blob; presetId: string };

const post = (msg: WorkerResponse) => self.postMessage(msg);

class OcrPipeline {
  private currentPresetId: string | null = null;

  constructor(
    private detector: IDetector,
    private recognizer: IRecognizer,
  ) {
    console.log("[Worker] OcrPipeline instance created with DI");
  }

  async initModels(presetId: string): Promise<void> {
    const { MODEL_PRESETS } = await import("../config/model-config");
    const preset = MODEL_PRESETS.find(p => p.id === presetId) || MODEL_PRESETS[0];

    if (this.currentPresetId === preset.id) {
      console.log(`[Worker] Models already initialized for preset: ${preset.id}`);
      post({ type: "init-done" });
      return;
    }

    // Global ORT JSEP configuration for better stability
    (ort.env as any).webgpu = {
      validateInputTensors: true,
      powerPreference: "high-performance"
    };

    // Default providers: GPU-first logic (DEV_POLICY: Acceleration)
    const isSecureContext = self.isSecureContext;
    const hasGpu = typeof (self as any).navigator?.gpu !== "undefined";
    
    console.log(`[Worker] Context: ${isSecureContext ? "Secure" : "Insecure"}, WebGPU: ${hasGpu ? "Found" : "Missing"}`);

    if (!hasGpu && !isSecureContext && location.hostname !== "localhost") {
      console.warn("[Worker] WebGPU requires Secure Context (HTTPS or localhost). Accessing via IP or HTTP disables GPU acceleration.");
    }

    const getProviders = (config: any) => {
      // Model-specific override
      if (config.executionProviders && config.executionProviders.length > 0) {
        // If config specifies providers, we use them but filter by GPU availability
        return config.executionProviders.filter((p: string) => p !== "webgpu" || hasGpu);
      }
      return hasGpu ? ["webgpu", "webgl", "wasm"] : ["wasm"];
    };

    const deimProviders = getProviders(preset.deim);
    const parseqProviders = getProviders(preset.parseq);

    console.log(`[Worker] Starting model initialization for preset: ${preset.id}`);
    console.log(`[Worker] DEIM providers: ${JSON.stringify(deimProviders)}`);
    console.log(`[Worker] PARSeq providers: ${JSON.stringify(parseqProviders)}`);

    // DEIM
    console.log("[Worker] Loading DEIM model...");
    const deimBuffer = await fetchModel(
      preset.deim.url,
      preset.deim.name,
      (loaded: number, total: number) =>
        post({ type: "init-progress", model: "DEIM (検出)", loaded, total }),
    );
    console.log(`[Worker] DEIM model fetched (${deimBuffer.byteLength} bytes). Initializing detector...`);
    try {
      await this.detector.init(deimBuffer, preset.deim, deimProviders);
    } catch (e) {
      console.warn("[Worker] DEIM initialization with primary providers failed. Falling back to WebGL/WASM...", e);
      await this.detector.init(deimBuffer, preset.deim, ["webgl", "wasm"]);
    }
    console.log("[Worker] DEIM detector initialized");

    // PARSeq
    console.log("[Worker] Loading PARSeq model...");
    const parseqBuffer = await fetchModel(
      preset.parseq.url,
      preset.parseq.name,
      (loaded: number, total: number) =>
        post({ type: "init-progress", model: "PARSeq (認識)", loaded, total }),
    );
    console.log(`[Worker] PARSeq model fetched: ${parseqBuffer.byteLength} bytes`);
    try {
      await this.recognizer.init(parseqBuffer, preset.parseq, parseqProviders);
    } catch (e) {
      console.warn("[Worker] PARSeq initialization with primary providers failed. Falling back to WebGL/WASM...", e);
      await this.recognizer.init(parseqBuffer, preset.parseq, ["webgl", "wasm"]);
    }
    console.log(`[Worker] PARSeq model initialized successfully`);

    this.currentPresetId = preset.id;
    post({ type: "init-done" });
  }

  async runOcr(imageBlob: Blob, presetId: string, isRetry = false): Promise<void> {
    try {
      await this.initModels(presetId);

      // Decode image
      console.log(`[Worker] Decoding image blob (${imageBlob.size} bytes)...`);
      const imageData = await decodeImage(imageBlob);
      const imgW = imageData.width;
      const imgH = imageData.height;
      console.log(`[Worker] Image decoded: ${imgW}x${imgH}`);

      // Detection
      console.log("[Worker] Running DEIM detection...");
      const detections = await this.detector.detect(imageData);
      console.log(`[Worker] DEIM detection finished: found ${detections.length} regions`);
      post({ type: "detect-done", numDetections: detections.length });

      // Parse detections into element tree
      console.log("[Worker] Parsing detections into element tree...");
      const page = detectionsToPage(imgW, imgH, "input.jpg", detections);

      // Wrap in OCRDATASET for reading order
      const root = createElement("OCRDATASET", {}, [page]);

      // Reading order
      console.log("[Worker] Evaluating reading order...");
      evalPage(root, true);

      // Collect LINE elements in reading order
      const lines = findAll(page, "LINE");
      const total = lines.length;
      console.log(`[Worker] Found ${total} lines to recognize`);

      // Recognize all lines in parallel (DEV_POLICY: GPU-first acceleration)
      console.log(`[Worker] Recognizing ${total} lines in parallel...`);
      const recognitionPromises = lines.map(async (line, i) => {
        const x = parseInt(line.attrs.X ?? "0");
        const y = parseInt(line.attrs.Y ?? "0");
        const w = parseInt(line.attrs.WIDTH ?? "0");
        const h = parseInt(line.attrs.HEIGHT ?? "0");
        const conf = parseFloat(line.attrs.CONF ?? "0");

        if (w <= 0 || h <= 0) {
          return { text: "", x, y, w, h, conf };
        }

        // Crop line from original image
        const lineImg = cropImageData(imageData, x, y, w, h);

        // Recognize
        const text = await this.recognizer.read(lineImg);
        
        line.attrs.STRING = text;

        // Partial progress: every 10 lines or at end (Reduced traffic)
        if ((i + 1) % 10 === 0 || i === total - 1) {
          post({ type: "recognize-progress", current: i + 1, total });
        }
        
        return { text, x, y, w, h, conf };
      });

      const resultLines = await Promise.all(recognitionPromises);
      console.log(`[Worker] Parallel recognition finished.`);

      post({ type: "result", lines: resultLines, detections, page });
    } catch (e) {
      console.error("[Worker] Error during runOcr:", e);
      
      // Automatic fallback logic (DEV_POLICY: Service Continuity)
      if (isRetry) {
        post({ type: "error", message: `Fallback failed: ${e instanceof Error ? e.message : String(e)}` });
        return;
      }

      const errorStr = String(e).toLowerCase();
      const needsFallback = errorStr.includes("webgpu") || 
                            errorStr.includes("jsep") || 
                            errorStr.includes("ortrun") || 
                            errorStr.includes("dimension") ||
                            errorStr.includes("not found");

      if (needsFallback && this.currentPresetId) {
        console.warn("[Worker] Inference error. Forcing WASM fallback...");
        try {
          // Reset to force initialization with strictly WASM providers
          const pid = this.currentPresetId;
          this.currentPresetId = null; // Mark as invalidated

          // Instead of modifying the preset, we'll force the next init to use WASM
          // This.initModels will be called with WASM force inside OcrPipeline? 
          // No, let's just re-initialize specifically here.
          
          const { MODEL_PRESETS } = await import("../config/model-config");
          const preset = MODEL_PRESETS.find(p => p.id === pid) || MODEL_PRESETS[0];

          // Fetch buffers again from cache and re-init with ["wasm"]
          const deimBuffer = await fetchModel(preset.deim.url, preset.deim.name);
          await this.detector.init(deimBuffer, preset.deim, ["wasm"]);
          
          const parseqBuffer = await fetchModel(preset.parseq.url, preset.parseq.name);
          await this.recognizer.init(parseqBuffer, preset.parseq, ["wasm"]);

          this.currentPresetId = pid; // Recover state
          
          console.log("[Worker] WASM recovery successful. Retrying job...");
          return this.runOcr(imageBlob, pid, true); 
        } catch (retryErr) {
          console.error("[Worker] WASM fallback fatal error:", retryErr);
        }
      }
      
      post({ type: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  dispose(): void {
    this.detector.dispose();
    this.recognizer.dispose();
  }
}

// Composition Root using DIContainer (py_ts_POLICY: Elimination of new)
DIContainer.register<IDetector>("detector", DEIMDetector);
DIContainer.register<IRecognizer>("recognizer", PARSeqRecognizer);
DIContainer.registerFactory<OcrPipeline>("pipeline", () => {
  const detector = DIContainer.resolve<IDetector>("detector");
  const recognizer = DIContainer.resolve<IRecognizer>("recognizer");
  return new OcrPipeline(detector, recognizer);
});

let pipelinePromise: Promise<OcrPipeline> | null = null;

function getPipeline(): Promise<OcrPipeline> {
  if (pipelinePromise) return pipelinePromise;
  
  pipelinePromise = Promise.resolve(DIContainer.resolve<OcrPipeline>("pipeline"));
  return pipelinePromise;
}

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;
  if (!msg || typeof msg !== "object" || (msg.type !== "init" && msg.type !== "run")) {
    return; // Ignore ORT internal messages
  }
  
  const p = await getPipeline();
  
  if (msg.type === "init") {
    try {
      await p.initModels(msg.presetId);
    } catch (err) {
      console.error("[Worker] Error during init:", err);
      post({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  } else if (msg.type === "run") {
    try {
      await p.runOcr(msg.imageBlob, msg.presetId);
    } catch (err) {
      console.error("[Worker] Error during run:", err);
      post({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }
};

self.onerror = (e) => {
  console.error("[Worker] Global error:", e);
};
