import { afterEach, describe, expect, it, vi } from "vitest";
import { installViewport, keyboardInset } from "../../web/viewport";

describe("keyboardInset", () => {
  it("is 0 when the keyboard is closed", () => {
    expect(keyboardInset({ frameBottom: 800, vvTop: 0, vvHeight: 800 })).toBe(0);
  });
  it("is the overlap when the keyboard covers the frame", () => {
    expect(keyboardInset({ frameBottom: 800, vvTop: 0, vvHeight: 500 })).toBe(300);
  });
  it("counts a panned visual viewport", () => {
    expect(keyboardInset({ frameBottom: 800, vvTop: 40, vvHeight: 500 })).toBe(260);
  });
  it("clamps negatives to 0", () => {
    expect(keyboardInset({ frameBottom: 600, vvTop: 0, vvHeight: 800 })).toBe(0);
  });
  it("rounds fractions", () => {
    expect(keyboardInset({ frameBottom: 800.4, vvTop: 0, vvHeight: 500.2 })).toBe(300);
  });
});

describe("installViewport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does nothing without a window (node)", () => {
    expect(() => installViewport()).not.toThrow();
  });

  it("does nothing when not framed", () => {
    const self: Record<string, unknown> = {};
    self.parent = self;
    self.matchMedia = vi.fn(() => ({ matches: true }));
    vi.stubGlobal("window", self);
    expect(() => installViewport()).not.toThrow();
    expect(self.matchMedia).not.toHaveBeenCalled();
  });

  it("does nothing when the parent is cross-origin", () => {
    const parent = {};
    Object.defineProperty(parent, "visualViewport", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    vi.stubGlobal("window", { parent, matchMedia: () => ({ matches: true }), addEventListener: vi.fn() });
    expect(() => installViewport()).not.toThrow();
  });

  it("does nothing on a fine pointer", () => {
    const vv = { addEventListener: vi.fn() };
    vi.stubGlobal("window", { parent: { visualViewport: vv }, matchMedia: () => ({ matches: false }) });
    installViewport();
    expect(vv.addEventListener).not.toHaveBeenCalled();
  });

  it("sets --kb-inset from the parent visualViewport", () => {
    const listeners: Record<string, () => void> = {};
    const vv = {
      offsetTop: 0,
      height: 500,
      addEventListener: (t: string, f: () => void) => (listeners[t] = f),
    };
    const set = vi.fn();
    const win = {
      parent: { visualViewport: vv },
      frameElement: { getBoundingClientRect: () => ({ bottom: 800 }) },
      matchMedia: () => ({ matches: true }),
      addEventListener: vi.fn(),
      requestAnimationFrame: (f: () => void) => f(),
    };
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", { documentElement: { style: { setProperty: set } } });
    installViewport();
    expect(set).toHaveBeenLastCalledWith("--kb-inset", "300px");
    vv.height = 800;
    listeners.resize();
    expect(set).toHaveBeenLastCalledWith("--kb-inset", "0px");
    expect(Object.keys(listeners).sort()).toEqual(["resize", "scroll"]);
  });
});
