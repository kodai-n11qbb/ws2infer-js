import { type ModelConfig } from "../config/model-config";

export interface Detection {
  classIndex: number;
  className: string;
  confidence: number;
  box: [number, number, number, number]; // x1, y1, x2, y2
  predCharCount: number;
}

export interface IDetector {
  init(
    modelBuffer: ArrayBuffer,
    config: ModelConfig,
    providers?: string[],
  ): Promise<void>;
  detect(imageData: ImageData): Promise<Detection[]>;
  dispose(): void;
}

export interface IRecognizer {
  init(
    modelBuffer: ArrayBuffer,
    config: ModelConfig,
    providers?: string[],
  ): Promise<void>;
  read(lineImage: ImageData): Promise<string>;
  dispose(): void;
}
