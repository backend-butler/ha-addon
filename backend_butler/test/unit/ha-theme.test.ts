import { describe, expect, it } from "vitest";
import { themeVars } from "../../web/haTheme";

// A user's "visionOS No Wallpaper" dark mode, as getComputedStyle returns it (leading spaces included).
const VISIONOS: Record<string, string> = {
  "--primary-background-color": " rgb(25, 24, 22)",
  "--secondary-background-color": " rgb(25, 24, 22)",
  "--card-background-color": " rgb(25, 24, 22)",
  "--ha-card-background": " rgba(0, 0, 0, 0.3)",
  "--primary-text-color": " rgba(255, 255, 255, 0.96)",
  "--secondary-text-color": " #d3d3d3",
  "--divider-color": " rgba(152, 152, 157, 0.3)",
  "--primary-color": " #FF9F0A",
  "--ha-card-border-radius": " 20px",
  "--ha-card-backdrop-filter": " blur(20px)",
};

describe("themeVars", () => {
  it("maps a real user theme onto our tokens, with dark text on the orange accent", () => {
    expect(themeVars((n) => VISIONOS[n] ?? "")).toEqual({
      "--bg": "rgb(25, 24, 22)",
      "--surface": "rgba(0, 0, 0, 0.3)",
      "--text": "rgba(255, 255, 255, 0.96)",
      "--muted": "#d3d3d3",
      "--border": "rgba(152, 152, 157, 0.3)",
      "--accent": "#FF9F0A",
      "--accent-fg": "#1a1006",
      "--r-card": "20px",
      "--glass": "blur(20px)",
      "color-scheme": "dark",
    });
  });

  it("takes HA's error and success colours, so status reads in light themes too", () => {
    const v = themeVars((n) => ({ "--primary-background-color": "#fafafa", "--error-color": "#db4437", "--success-color": "#43a047" })[n] ?? "")!;
    expect(v["--error"]).toBe("#db4437");
    expect(v["--ok"]).toBe("#43a047");
  });

  it("uses white text on a dark accent and a light scheme on a light background", () => {
    const v = themeVars((n) => ({ "--primary-background-color": "#fafafa", "--primary-color": "#03a9f4" })[n] ?? "")!;
    expect(v["color-scheme"]).toBe("light");
    expect(themeVars((n) => ({ "--primary-background-color": "#111", "--primary-color": "#1a237e" })[n] ?? "")!["--accent-fg"]).toBe("#ffffff");
  });

  it("returns null (keep Night Ops) when HA's background cannot be read", () => {
    expect(themeVars(() => "")).toBeNull();
    expect(themeVars((n) => (n === "--primary-background-color" ? "var(--x)" : ""))).toBeNull();
  });
});
