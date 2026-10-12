// Display-only YAML and line diff for approval previews. Never parsed back; HA receives JSON.

const PLAIN = /^[A-Za-z_][\w .:/@-]*$/;
const RESERVED = /^(true|false|yes|no|on|off|null|~|y|n)$/i;

function scalar(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = String(v);
  if (PLAIN.test(s) && !RESERVED.test(s) && !s.endsWith(":") && !s.includes(": ") && !s.includes(" #")) return s;
  return JSON.stringify(s);
}

export function toYaml(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return `${pad}[]`;
    return value
      .map((item) => {
        if (item && typeof item === "object" && Object.keys(item).length) {
          const inner = toYaml(item, indent + 1).trimStart();
          return `${pad}- ${inner}`;
        }
        return `${pad}- ${item && typeof item === "object" ? (Array.isArray(item) ? "[]" : "{}") : scalar(item)}`;
      })
      .join("\n");
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return `${pad}{}`;
    return entries
      .map(([k, v]) => {
        const key = scalar(k);
        if (v && typeof v === "object" && (Array.isArray(v) ? v.length : Object.keys(v).length)) {
          return `${pad}${key}:\n${toYaml(v, indent + 1)}`;
        }
        return `${pad}${key}: ${v && typeof v === "object" ? (Array.isArray(v) ? "[]" : "{}") : scalar(v)}`;
      })
      .join("\n");
  }
  return pad + scalar(value);
}

export type DiffLine = { op: " " | "+" | "-"; text: string };

/** Line diff via LCS. Inputs are small (one automation), so O(n·m) is fine. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) out.push({ op: " ", text: a[i++] }), j++;
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ op: "-", text: a[i++] });
    else out.push({ op: "+", text: b[j++] });
  }
  while (i < a.length) out.push({ op: "-", text: a[i++] });
  while (j < b.length) out.push({ op: "+", text: b[j++] });
  return out;
}
