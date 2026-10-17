import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureSkillsFolder, handleSkills, listAllSkills, listSkills, parseFrontmatter } from "../../server/skills";
import type { Config } from "../../server/config";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "skills-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function skill(folder: string, text: string): void {
  mkdirSync(join(root, folder), { recursive: true });
  writeFileSync(join(root, folder, "SKILL.md"), text);
}

describe("parseFrontmatter", () => {
  it("reads plain scalars", () => {
    expect(parseFrontmatter("---\nname: a-b\ndescription: Does a thing\n---\nbody")).toEqual({
      name: "a-b",
      description: "Does a thing",
    });
  });
  it("reads quoted scalars", () => {
    const fm = parseFrontmatter(`---\nname: 'x'\ndescription: "Say \\"hi\\": ok"\n---\n`);
    expect(fm).toEqual({ name: "x", description: 'Say "hi": ok' });
    expect(parseFrontmatter("---\ndescription: 'it''s fine'\n---\n")?.description).toBe("it's fine");
  });
  it("reads folded and literal blocks", () => {
    expect(parseFrontmatter("---\ndescription: >\n  one\n  two\n\n  three\nname: n\n---\n")).toEqual({
      description: "one two\nthree",
      name: "n",
    });
    expect(parseFrontmatter("---\ndescription: |-\n  one\n  two\n---\n")?.description).toBe("one\ntwo");
  });
  it("handles CRLF and a BOM", () => {
    expect(parseFrontmatter("﻿---\r\nname: a\r\ndescription: d\r\n---\r\n")).toEqual({ name: "a", description: "d" });
  });
  it("returns null without frontmatter or a closing line", () => {
    expect(parseFrontmatter("no frontmatter")).toBeNull();
    expect(parseFrontmatter("---\nname: a\n")).toBeNull();
  });
});

describe("listSkills", () => {
  it("returns [] for a missing folder", () => {
    expect(listSkills(join(root, "nope"))).toEqual([]);
  });
  it("lists skills sorted by name, falling back to the folder name", () => {
    skill("zeta", "---\nname: zeta\ndescription: Last\n---\nDo it");
    skill("alpha", "---\ndescription: First\n---\nDo it");
    expect(listSkills(root)).toEqual([
      { name: "alpha", description: "First" },
      { name: "zeta", description: "Last" },
    ]);
  });
  it("skips malformed, invalid-name, builtin and description-less skills", () => {
    skill("ok", "---\nname: ok\ndescription: Fine\n---\n");
    skill("nofm", "just text");
    skill("badname", "---\nname: Bad Name\ndescription: x\n---\n");
    skill("nodesc", "---\nname: nodesc\n---\n");
    skill("emptydesc", '---\nname: emptydesc\ndescription: ""\n---\n');
    skill("reload-skills", "---\nname: reload-skills\ndescription: x\n---\n");
    mkdirSync(join(root, "empty-folder"));
    writeFileSync(join(root, "loose.md"), "---\nname: loose\ndescription: x\n---\n");
    expect(listSkills(root).map((s) => s.name)).toEqual(["ok"]);
  });
  it("reads fresh every call", () => {
    expect(listSkills(root)).toEqual([]);
    skill("new-one", "---\ndescription: Hi\n---\n");
    expect(listSkills(root)).toEqual([{ name: "new-one", description: "Hi" }]);
  });
});

describe("ensureSkillsFolder", () => {
  it("creates the folder with a README once and never overwrites", () => {
    ensureSkillsFolder(root);
    const readme = join(root, "skills", "README.md");
    const text = readFileSync(readme, "utf8");
    expect(text).toContain("SKILL.md");
    expect(text).toContain("/name");
    writeFileSync(readme, "edited");
    ensureSkillsFolder(root);
    expect(readFileSync(readme, "utf8")).toBe("edited");
  });
  it("leaves an existing folder alone", () => {
    mkdirSync(join(root, "skills"));
    ensureSkillsFolder(root);
    expect(() => readFileSync(join(root, "skills", "README.md"))).toThrow();
  });
});

describe("handleSkills", () => {
  it("answers 200 with the list, [] when the folder is missing", () => {
    let status = 0;
    let body = "";
    const res = {
      writeHead: (s: number) => {
        status = s;
      },
      end: (b: string) => {
        body = b;
      },
      setHeader: () => {},
    };
    handleSkills({ configDir: root, bundledSkillsDir: join(root, "none") } as Config, res as never);
    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual([]);
  });
});

describe("listAllSkills", () => {
  it("lists bundled and user skills together; a user skill with the same name wins", () => {
    skill("bundled/ha-devices", "---\nname: ha-devices\ndescription: bundled devices\n---\n");
    skill("bundled/ha-helpers", "---\nname: ha-helpers\ndescription: bundled helpers\n---\n");
    skill("config/skills/ha-devices", "---\nname: ha-devices\ndescription: my devices\n---\n");
    skill("config/skills/mine", "---\nname: mine\ndescription: mine\n---\n");
    const config = { configDir: join(root, "config"), bundledSkillsDir: join(root, "bundled") } as Config;
    expect(listAllSkills(config)).toEqual([
      { name: "ha-devices", description: "my devices" },
      { name: "ha-helpers", description: "bundled helpers" },
      { name: "mine", description: "mine" },
    ]);
  });
});
