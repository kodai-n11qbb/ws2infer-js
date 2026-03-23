import * as ort from "onnxruntime-web/webgpu";
// @ts-ignore
import { cv as cvNative } from "opencv-wasm";
import { type ModelConfig } from "../../config/model-config";
import { type IDetector, type Detection } from "../interfaces";
import { normalizeImageNet, hwcToChw } from "../tensor-utils";

let cv: any = null;

export class DBDetector implements IDetector {
  private session: ort.InferenceSession | null = null;
  private inputH = 640;
  private inputW = 640;
  private thresh = 0.3;
  private boxThresh = 0.5;
  private unclipRatio = 1.5;

  async init(
    modelBuffer: ArrayBuffer,
    config: ModelConfig,
    providers: string[] = ["webgpu", "wasm"],
  ): Promise<void> {
    // Wait for OpenCV if not ready
    if (!cv) {
      console.log("[DBDetector] Initializing OpenCV WASM...");
      const cvAny = cvNative as any;
      if (typeof cvAny === "function") {
        cv = await cvAny();
      } else if (cvAny.onRuntimeInitialized) {
        await new Promise<void>((resolve) => {
          const oldHandler = cvAny.onRuntimeInitialized;
          cvAny.onRuntimeInitialized = () => {
             if (typeof oldHandler === "function") oldHandler();
             cv = cvAny;
             resolve();
          };
          // Check if already ready
          if (cvAny.onRuntimeInitialized === true) {
             cv = cvAny;
             resolve();
          }
        });
      } else {
        cv = cvAny;
      }
      console.log("[DBDetector] OpenCV WASM initialized");
    }

    this.session = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: providers,
      graphOptimizationLevel: "all",
    });
    this.inputH = (config.inputShape && config.inputShape[2]) || 640;
    this.inputW = (config.inputShape && config.inputShape[3]) || 640;
  }

  async detect(imageData: ImageData): Promise<Detection[]> {
    if (!this.session) throw new Error("DBDetector session not initialized");

    const { width: origW, height: origH } = imageData;
    
    // 1. Preprocess: Resize to multiple of 32
    const targetH = Math.ceil(this.inputH / 32) * 32;
    const targetW = Math.ceil(this.inputW / 32) * 32;
    
    const canvas = new OffscreenCanvas(targetW, targetH);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(await createImageBitmap(imageData), 0, 0, targetW, targetH);
    const resized = ctx.getImageData(0, 0, targetW, targetH);

    // Normalize: ImageNet mean/std
    const normData = normalizeImageNet(resized.data, targetH, targetW);

    // HWC to CHW
    const chw = hwcToChw(normData, targetH, targetW, 3);

    const inputTensor = new ort.Tensor("float32", chw, [1, 3, targetH, targetW]);
    const inputName = this.session.inputNames[0];
    const results = await this.session.run({ [inputName]: inputTensor });
    const outputName = this.session.outputNames[0];
    const output = results[outputName];

    // output shape: [1, 1, H, W]
    const heatmap = output.data as Float32Array;
    
    // 2. Postprocess with OpenCV
    return this.postProcess(heatmap, targetH, targetW, origW, origH);
  }

  private postProcess(
    heatmap: Float32Array,
    h: number,
    w: number,
    origW: number,
    origH: number,
  ): Detection[] {
    const mat = new cv.Mat(h, w, cv.CV_32F);
    mat.data32F.set(heatmap);

    const binary = new cv.Mat();
    cv.threshold(mat, binary, this.thresh, 255, cv.THRESH_BINARY);
    binary.convertTo(binary, cv.CV_8U);

    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(binary, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    const detections: Detection[] = [];
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      if (area < 16) {
          cnt.delete();
          continue;
      }

      const unclippedBox = this.unclipBox(cnt, this.unclipRatio);
      if (!unclippedBox) {
          cnt.delete();
          continue;
      }

      const scaleX = origW / w;
      const scaleY = origH / h;
      
      let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
      for (const pt of unclippedBox) {
          xmin = Math.min(xmin, pt.x * scaleX);
          ymin = Math.min(ymin, pt.y * scaleY);
          xmax = Math.max(xmax, pt.x * scaleX);
          ymax = Math.max(ymax, pt.y * scaleY);
      }

      detections.push({
        classIndex: 0,
        className: "text",
        confidence: 0.9,
        box: [
            Math.max(0, xmin), 
            Math.max(0, ymin), 
            Math.min(origW, xmax), 
            Math.min(origH, ymax)
        ],
        predCharCount: 0,
      });

      cnt.delete();
    }

    mat.delete();
    binary.delete();
    contours.delete();
    hierarchy.delete();

    return detections;
  }

  private unclipBox(cnt: any, ratio: number): {x: number, y: number}[] | null {
      const rect = cv.minAreaRect(cnt);
      // In JS version of OpenCV, vertices are obtained via minAreaRect result center/size/angle
      // We can use RotatedRect.points(rect) but let's be careful with the API
      const vertices = cv.RotatedRect.points(rect);
      
      const center = rect.center;
      const points = [];
      const area = cv.contourArea(cnt);
      const arcLen = cv.arcLength(cnt, true);
      const dist = (area * ratio) / arcLen;

      for (let i = 0; i < 4; i++) {
          const v = vertices[i];
          const dx = v.x - center.x;
          const dy = v.y - center.y;
          const len = Math.sqrt(dx*dx + dy*dy) || 1;
          points.push({
              x: center.x + (dx / len) * (len + dist),
              y: center.y + (dy / len) * (len + dist)
          });
      }
      return points;
  }

  dispose(): void {
    this.session?.release();
    this.session = null;
  }
}
