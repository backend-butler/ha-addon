import { describe, expect, it } from "vitest";
import { ATTACHMENT_ID } from "../../shared/transcript";
import { fitSize, makeId } from "../../web/attach";

describe("fitSize", () => {
  it("scales the long edge down to max, keeping the ratio", () => {
    expect(fitSize(3136, 1568, 1568)).toEqual({ width: 1568, height: 784 });
    expect(fitSize(1000, 4000, 1568)).toEqual({ width: 392, height: 1568 });
  });
  it("never upscales", () => {
    expect(fitSize(800, 600, 1568)).toEqual({ width: 800, height: 600 });
    expect(fitSize(1568, 1568, 1568)).toEqual({ width: 1568, height: 1568 });
  });
  it("never returns a zero edge", () => {
    expect(fitSize(10000, 1, 1568)).toEqual({ width: 1568, height: 1 });
  });
});

describe("makeId", () => {
  it("matches ATTACHMENT_ID and is unique", () => {
    const ids = new Set(Array.from({ length: 50 }, makeId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(ATTACHMENT_ID);
  });
  it("works without crypto.randomUUID (insecure contexts)", () => {
    const real = globalThis.crypto.randomUUID;
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      expect(makeId()).toMatch(ATTACHMENT_ID);
    } finally {
      Object.defineProperty(globalThis.crypto, "randomUUID", { value: real, configurable: true });
    }
  });
});
