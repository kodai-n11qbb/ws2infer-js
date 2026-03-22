import { describe, it, expect } from "vitest";
import { createElement, findAll } from "./ndl-parser";

describe("ndl-parser element tree logic", () => {
  it("should create elements correctly", () => {
    const el = createElement("PAGE", { WIDTH: "100" });
    expect(el.tag).toBe("PAGE");
    expect(el.attrs.WIDTH).toBe("100");
    expect(el.children).toHaveLength(0);
  });

  it("should find all nested elements", () => {
    const root = createElement("PAGE", {}, [
      createElement("TEXTBLOCK", {}, [
        createElement("LINE", { ID: "1" }),
        createElement("LINE", { ID: "2" }),
      ]),
      createElement("LINE", { ID: "3" }),
    ]);

    const lines = findAll(root, "LINE");
    expect(lines).toHaveLength(3);
    const ids = lines.map(l => l.attrs.ID);
    expect(ids).toContain("1");
    expect(ids).toContain("2");
    expect(ids).toContain("3");
  });
});
