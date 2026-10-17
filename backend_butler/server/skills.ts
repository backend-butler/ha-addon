import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { join } from "node:path";
import type { SkillSummary } from "../shared/transcript.js";
import type { Config } from "./config.js";
import { sendJson } from "./http.js";

/** Commands the SDK always adds; never offered in the `/` menu. */
export const SDK_BUILTINS = new Set(["run-skill-generator", "reload-skills"]);

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function unquote(raw: string): string {
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\(["\\nt])/g, (_m, c: string) => (c === "n" ? "\n" : c === "t" ? "\t" : c));
  }
  return raw.replace(/\s+#.*$/, "");
}

/** Body of a `>` / `|` block: the indented lines under it, folded or kept per style. */
function blockScalar(lines: string[], style: string): string {
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length));
  const body = lines.map((l) => (l.trim() ? l.slice(indent) : ""));
  if (style.startsWith("|")) return body.join("\n").trim();
  const paragraphs = body.join("\n").split(/\n{2,}/);
  return paragraphs.map((p) => p.split("\n").join(" ")).join("\n").trim();
}

/**
 * Top-level `key: value` pairs from leading `---` frontmatter, or null when there is none.
 * Understands plain, quoted and block (`>`, `|`) scalars; nothing else in YAML.
 */
export function parseFrontmatter(text: string): Record<string, string> | null {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return null;
  const out: Record<string, string> = {};
  for (let i = 1; i < end; i++) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const [, key, rest] = m;
    const value = rest.trim();
    // Indented lines following the key belong to it.
    const cont: string[] = [];
    while (i + 1 < end && (lines[i + 1].trim() === "" || /^\s/.test(lines[i + 1]))) cont.push(lines[++i]);
    if (/^[>|][+-]?$/.test(value)) {
      out[key] = cont.some((l) => l.trim()) ? blockScalar(cont, value) : "";
    } else {
      const parts = [value, ...cont.map((l) => l.trim()).filter(Boolean)];
      out[key] = unquote(parts.join(" "));
    }
  }
  return out;
}

/** Skills in `<configDir>/skills/<name>/SKILL.md`, from their frontmatter; malformed ones are skipped. */
export function listSkills(skillsDir: string): SkillSummary[] {
  let entries: string[];
  try {
    entries = readdirSync(skillsDir);
  } catch {
    return [];
  }
  const skills: SkillSummary[] = [];
  for (const folder of entries) {
    let text: string;
    try {
      text = readFileSync(join(skillsDir, folder, "SKILL.md"), "utf8");
    } catch {
      continue; // not a folder, or no SKILL.md
    }
    const fm = parseFrontmatter(text);
    if (!fm) continue;
    const name = fm.name || folder;
    const description = fm.description?.trim();
    if (!description || !NAME_RE.test(name) || SDK_BUILTINS.has(name)) continue;
    skills.push({ name, description });
  }
  return skills.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

const README = `# Skills

Your own skills go here. Backend Butler also ships Home Assistant skills
(ha-automations, ha-devices, ...). A folder here with the same name replaces
the built-in one.

One folder per skill. Each folder holds a \`SKILL.md\`: a short header with a
\`name\` and a \`description\`, then the instructions.

    my-skill/
      SKILL.md

\`SKILL.md\`:

    ---
    name: my-skill
    description: One line on what this does and when to use it.
    ---
    Step-by-step instructions for the agent.

Run a skill in the chat by typing \`/name\` (here, \`/my-skill\`).

Skills are instructions only. The agent cannot run scripts or read other
files from the skill folder, so put everything it needs in \`SKILL.md\`.

No restart needed: new and edited skills show up the next time you type \`/\`.
`;

/** Create `<configDir>/skills` with a README on first start. Never touches an existing folder. */
export function ensureSkillsFolder(configDir: string): void {
  const dir = join(configDir, "skills");
  if (existsSync(dir)) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "README.md"), README, { flag: "wx" });
}

/** Bundled skills and the user's, by name; the user's version of a name wins. */
export function listAllSkills(config: Config): SkillSummary[] {
  const byName = new Map<string, SkillSummary>();
  for (const s of [...listSkills(config.bundledSkillsDir), ...listSkills(join(config.configDir, "skills"))]) byName.set(s.name, s);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** GET /api/skills → SkillSummary[] */
export function handleSkills(config: Config, res: ServerResponse): void {
  sendJson(res, 200, listAllSkills(config));
}
