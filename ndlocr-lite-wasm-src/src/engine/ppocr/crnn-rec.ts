import * as ort from "onnxruntime-web/webgpu";
import { resizeForParseq } from "../image-utils";
import { hwcToChw, argmaxAxis2, normalizePpocr, decodeCtc } from "../tensor-utils";
import { PPOCR_JAPAN_CHARSET } from "../../config/ppocr-charset";
import { type ModelConfig } from "../../config/model-config";
import { type IRecognizer } from "../interfaces";

export class PPOCRRecognizer implements IRecognizer {
  private session: ort.InferenceSession | null = null;
  private inputH = 48; // PP-OCRv3/v4 standard height
  private inputW = 320; // Default width, will be resized

  async init(
    modelBuffer: ArrayBuffer,
    config: ModelConfig,
    providers: string[] = ["webgpu", "wasm"],
  ): Promise<void> {
    this.session = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: providers,
      graphOptimizationLevel: "all",
    });
    this.inputH = (config.inputShape && config.inputShape[2]) || 48;
    this.inputW = (config.inputShape && config.inputShape[3]) || 320;
  }

  async read(lineImage: ImageData): Promise<string> {
    if (!this.session) throw new Error("PP-OCR Recognizer not initialized");

    // PP-OCRv3/v4 expects height fixed at 48 (or 32 for v2)
    const ratio = lineImage.width / lineImage.height;
    const targetW = Math.min(Math.max(Math.round(this.inputH * ratio), 32), 1024);

    const resized = resizeForParseq(lineImage, targetW, this.inputH, false);

    // Normalization: (img / 255.0 - 0.5) / 0.5
    const floatData = normalizePpocr(resized.data, this.inputH, targetW);

    // HWC to CHW
    const chw = hwcToChw(floatData, this.inputH, targetW, 3);

    const inputTensor = new ort.Tensor("float32", chw, [1, 3, this.inputH, targetW]);
    const inputName = this.session.inputNames[0];
    const results = await this.session.run({ [inputName]: inputTensor });
    const outputName = this.session.outputNames[0];
    const output = results[outputName];

    // Decode: CTC Greedy Decode
    const dims = output.dims;
    const seqLen = dims[1];
    const vocabSize = dims[2];
    const outData = output.data as Float32Array;

    const indices = argmaxAxis2(outData, seqLen, vocabSize);
    
    return decodeCtc(indices, PPOCR_JAPAN_CHARSET);
  }

  dispose(): void {
    this.session?.release();
    this.session = null;
  }
}
