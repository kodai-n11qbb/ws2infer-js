export interface ModelConfig {
  url: string;
  inputShape: number[];
  name: string;
  executionProviders?: string[];
}

export type DetectorType = "deim" | "ppocr";
export type RecognizerType = "parseq" | "ppocr";

export interface ModelPreset {
  id: string;
  label: string;
  description: string;
  detectorType: DetectorType;
  recognizerType: RecognizerType;
  deim: ModelConfig; // Generic slot for detection
  parseq: ModelConfig; // Generic slot for recognition
}

export const MODEL_PRESETS: ModelPreset[] = [
  {
    id: "standard",
    label: "標準 (77MB)",
    description: "FP32 — 最高精度",
    detectorType: "deim",
    recognizerType: "parseq",
    deim: {
      url: `${import.meta.env.BASE_URL}models/deim-s-1024x1024.onnx`,
      inputShape: [1, 3, 800, 800],
      name: "deim-s-1024x1024.onnx",
      executionProviders: ["webgpu", "webgl", "wasm"],
    },
    parseq: {
      url: `${import.meta.env.BASE_URL}models/parseq-ndl-16x768-100-tiny-165epoch-tegaki2.onnx`,
      inputShape: [1, 3, 16, 768],
      name: "parseq-ndl-16x768-100-tiny-165epoch-tegaki2.onnx",
      executionProviders: ["webgpu", "webgl", "wasm"],
    },
  },
  {
    id: "lite",
    label: "軽量 (50MB)",
    description: "検出INT8 + 認識FP32 — 高速ダウンロード",
    detectorType: "deim",
    recognizerType: "parseq",
    deim: {
      url: `${import.meta.env.BASE_URL}models/deim-s-1024x1024_int8.onnx`,
      inputShape: [1, 3, 800, 800],
      name: "deim-s-1024x1024_int8.onnx",
      executionProviders: ["webgpu", "webgl", "wasm"],
    },
    parseq: {
      url: `${import.meta.env.BASE_URL}models/parseq-ndl-16x768-100-tiny-165epoch-tegaki2.onnx`,
      inputShape: [1, 3, 16, 768],
      name: "parseq-ndl-16x768-100-tiny-165epoch-tegaki2.onnx",
      executionProviders: ["webgpu", "webgl", "wasm"],
    },
  },
  {
    id: "ppocr",
    label: "PP-OCRv4 (最高速・軽量)",
    description: "WebGPUに最適化された軽量モデル (23MB)",
    detectorType: "ppocr",
    recognizerType: "ppocr",
    deim: {
      url: `${import.meta.env.BASE_URL}models/ch_PP-OCRv4_det_infer.onnx`,
      inputShape: [1, 3, 1024, 1024],
      name: "ch_PP-OCRv4_det_infer.onnx",
      executionProviders: ["webgpu", "wasm"],
    },
    parseq: {
      url: `${import.meta.env.BASE_URL}models/japan_PP-OCRv3_rec_infer.onnx`,
      inputShape: [1, 3, 48, 320],
      name: "japan_PP-OCRv3_rec_infer.onnx",
      executionProviders: ["webgpu", "wasm"],
    },
  },
];

export const DEFAULT_PRESET_ID = "standard";

export const DET_CONF_THRESHOLD = 0.25;
export const DET_SCORE_THRESHOLD = 0.2;
