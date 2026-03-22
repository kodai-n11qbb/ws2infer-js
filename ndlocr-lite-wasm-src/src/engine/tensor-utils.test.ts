import { describe, it, expect } from "vitest";
import { hwcToChw, argmaxAxis2 } from "./tensor-utils";

describe("tensor-utils", () => {
  it("should transpose HWC to CHW correctly", () => {
    // 2x2x3 (H=2, W=2, C=3)
    const data = new Float32Array([
      1, 2, 3,  4, 5, 6,
      7, 8, 9,  10, 11, 12
    ]);
    const chw = hwcToChw(data, 2, 2, 3);
    
    // Expected order: 
    // CH=0: (1, 4, 7, 10), CH=1: (2, 5, 8, 11), CH=2: (3, 6, 9, 12)
    expect(chw[0]).toBe(1);
    expect(chw[1]).toBe(4);
    expect(chw[4]).toBe(2);
    expect(chw[8]).toBe(3);
    expect(chw).toHaveLength(12);
  });

  it("should find argmax along axis 2", () => {
    // seqLen=2, vocabSize=3
    const data = new Float32Array([
      0.1, 0.9, 0.0, // idx 1 is max
      0.8, 0.1, 0.1  // idx 0 is max
    ]);
    const indices = argmaxAxis2(data, 2, 3);
    expect(indices[0]).toBe(1);
    expect(indices[1]).toBe(0);
  });
});
