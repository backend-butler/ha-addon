import { describe, expect, it } from "vitest";
import { INTENT_KEY, MAX_INTENT_TEXT, parseLinkIntent, stripLinkParams, takeIntent, writeIntent } from "../../shared/intent";

function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

describe("intent hand-off", () => {
  it("round-trips once", () => {
    const s = mem();
    writeIntent(s, "camera", 1000);
    expect(takeIntent(s, 1500)).toEqual({ kind: "camera", at: 1000 });
    expect(takeIntent(s, 1500)).toBeNull();
  });
  it("drops stale, future, and malformed intents, and still clears them", () => {
    const s = mem();
    writeIntent(s, "mic", 0);
    expect(takeIntent(s, 30_001)).toBeNull();
    expect(s.m.has(INTENT_KEY)).toBe(false);
    writeIntent(s, "mic", 5000);
    expect(takeIntent(s, 4000)).toBeNull();
    s.setItem(INTENT_KEY, '{"kind":"rm -rf","at":1}');
    expect(takeIntent(s, 1)).toBeNull();
    s.setItem(INTENT_KEY, "not json");
    expect(takeIntent(s, 1)).toBeNull();
    expect(s.m.size).toBe(0);
  });
  it("survives storage that throws", () => {
    const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => {} };
    expect(() => writeIntent(bad, "field")).not.toThrow();
    expect(takeIntent(bad)).toBeNull();
  });
});

describe("link intents (home screen widget)", () => {
  it("reads a kind, and words for say/draft", () => {
    expect(parseLinkIntent("?butler=camera", 7)).toEqual({ kind: "camera", at: 7 });
    expect(parseLinkIntent("?butler=say&text=Turn%20on%20the%20mantle%20lights", 7)).toEqual({
      kind: "say",
      at: 7,
      text: "Turn on the mantle lights",
    });
    expect(parseLinkIntent("?text=hi&butler=draft", 7)).toEqual({ kind: "draft", at: 7, text: "hi" });
  });
  it("ignores unknown kinds, say/draft without words, and pages without the parameter", () => {
    expect(parseLinkIntent("?butler=rm", 1)).toBeNull();
    expect(parseLinkIntent("?butler=say", 1)).toBeNull();
    expect(parseLinkIntent("?butler=say&text=%20%20", 1)).toBeNull();
    expect(parseLinkIntent("", 1)).toBeNull();
    expect(parseLinkIntent("?edit=1", 1)).toBeNull();
  });
  it("caps the words", () => {
    const long = "a".repeat(MAX_INTENT_TEXT + 50);
    expect(parseLinkIntent(`?butler=draft&text=${long}`, 1)?.text).toHaveLength(MAX_INTENT_TEXT);
  });
  it("strips only its own parameters", () => {
    expect(stripLinkParams("?butler=say&text=hi")).toBe("");
    expect(stripLinkParams("?edit=1&butler=camera")).toBe("?edit=1");
    expect(stripLinkParams("")).toBe("");
  });
  it("never takes say/draft from storage: the card does not send words", () => {
    const s = mem();
    s.setItem(INTENT_KEY, JSON.stringify({ kind: "say", at: 1 }));
    expect(takeIntent(s, 2)).toBeNull();
  });
});
