// Blend into Home Assistant: read HA's live theme from the parent document (ingress is same-origin) and map it
// onto our tokens. Any failure leaves the Night Ops tokens in styles.css as they are: the fallback is silent.

/** Our token ← HA theme variable(s), first non-empty wins. */
const MAP: [string, string[]][] = [
  ["--bg", ["--primary-background-color"]],
  ["--surface", ["--ha-card-background", "--card-background-color", "--secondary-background-color"]],
  ["--text", ["--primary-text-color"]],
  ["--muted", ["--secondary-text-color"]],
  ["--border", ["--divider-color"]],
  ["--accent", ["--primary-color"]],
  ["--r-card", ["--ha-card-border-radius"]],
  ["--glass", ["--ha-card-backdrop-filter"]],
];

/** sRGB channels of a hex or rgb()/rgba() color, or null if it is some other syntax. */
export function parseColor(c: string): [number, number, number] | null {
  const s = c.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((x) => x + x).join("") : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

export function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Map HA theme values (by HA variable name) to our tokens. Null when HA's background is unreadable. */
export function themeVars(get: (name: string) => string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const [ours, theirs] of MAP) {
    const v = theirs.map((n) => get(n).trim()).find(Boolean);
    if (v) out[ours] = v;
  }
  const bg = out["--bg"] && parseColor(out["--bg"]);
  if (!bg) return null;
  out["color-scheme"] = luminance(bg) < 0.2 ? "dark" : "light";
  const accent = out["--accent"] && parseColor(out["--accent"]);
  // Text on the accent (Send, user bubbles): whichever of near-black / white contrasts more.
  if (accent) out["--accent-fg"] = luminance(accent) > 0.18 ? "#1a1006" : "#ffffff";
  return out;
}

function apply(root: HTMLElement) {
  try {
    const parentRoot = window.parent.document.documentElement; // throws if cross-origin
    const style = window.parent.getComputedStyle(parentRoot);
    const vars = themeVars((n) => style.getPropertyValue(n));
    if (!vars) return;
    for (const [k, v] of Object.entries(vars)) {
      if (k === "color-scheme") root.style.colorScheme = v;
      else root.style.setProperty(k, v);
    }
    root.dataset.theme = "ha";
  } catch {
    /* not inside HA, or HA unreadable: keep Night Ops */
  }
}

/** Mark whether we are inside HA's frame, apply its theme, and re-read it when the user comes back (it can change while open). */
export function installHaTheme(): void {
  const root = document.documentElement;
  const framed = window.self !== window.top;
  root.classList.toggle("in-ha", framed);
  if (!framed) return;
  apply(root);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") apply(root);
  });
}
