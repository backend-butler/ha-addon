import { describe, expect, it } from "vitest";
import { toPcm16 } from "../../web/voice";

describe("toPcm16", () => {
  it("downsamples 48 kHz to 16 kHz across chunk boundaries", () => {
    const pcm = toPcm16([new Float32Array(2400).fill(0.5), new Float32Array(2400).fill(0.5)], 48_000);
    expect(pcm.length).toBe(1600); // 0.1 s
    expect(pcm[0]).toBe(Math.round(0.5 * 0x7fff - 0.5)); // 16383
  });
  it("averages each span and clamps to 16-bit", () => {
    expect(Array.from(toPcm16([Float32Array.from([1, 0, -1, 2, 2, 2])], 48_000))).toEqual([0, 0x7fff]);
    expect(Array.from(toPcm16([Float32Array.from([-5])], 16_000))).toEqual([-0x8000]);
  });
  it("handles a non-integer ratio (44.1 kHz)", () => {
    expect(toPcm16([new Float32Array(44_100)], 44_100).length).toBe(16_000);
  });
});
