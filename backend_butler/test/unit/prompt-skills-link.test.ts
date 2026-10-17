import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { syncSkills } from "../../server/agent";
import { householdNotes, systemPrompt, withTime } from "../../server/prompt";

const tmp = () => mkdtempSync(join(tmpdir(), "bb-"));

describe("household notes", () => {
  it("are read from household.md and appended to the system prompt", () => {
    const dir = tmp();
    writeFileSync(join(dir, "household.md"), "  Saffron means deep saffron, #FF9933.\n");
    const notes = householdNotes(dir);
    expect(notes).toBe("Saffron means deep saffron, #FF9933.");
    expect(systemPrompt([], notes)).toMatch(/## Household notes[^\n]*\nSaffron means deep saffron, #FF9933\.$/);
  });
  it("are optional: no file, no section", () => {
    expect(householdNotes(tmp())).toBe("");
    expect(systemPrompt([], "")).not.toContain("Household notes");
  });
});

describe("syncSkills", () => {
  const skill = (root: string, name: string) => {
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(join(root, name, "SKILL.md"), `---\nname: ${name}\ndescription: d\n---\n`);
  };
  it("links bundled and user skills by name into CLAUDE_CONFIG_DIR/skills; a user skill overrides a bundled one", () => {
    const claude = tmp();
    const bundled = tmp();
    const user = tmp();
    skill(bundled, "ha-automations");
    skill(bundled, "ha-devices");
    skill(user, "ha-devices");
    skill(user, "mine");
    syncSkills(claude, [bundled, user, join(tmp(), "missing")]);
    const dir = join(claude, "skills");
    expect(readdirSync(dir).sort()).toEqual(["ha-automations", "ha-devices", "mine"]);
    expect(readlinkSync(join(dir, "ha-automations"))).toBe(join(bundled, "ha-automations"));
    expect(readlinkSync(join(dir, "ha-devices"))).toBe(join(user, "ha-devices"));
  });
  it("drops links to skills that were removed, and replaces the old single folder link", () => {
    const claude = tmp();
    const user = tmp();
    symlinkSync(user, join(claude, "skills"), "dir"); // layout before bundled skills
    skill(user, "gone");
    syncSkills(claude, [user]);
    expect(lstatSync(join(claude, "skills")).isSymbolicLink()).toBe(false);
    rmSync(join(user, "gone"), { recursive: true });
    syncSkills(claude, [user]);
    expect(readdirSync(join(claude, "skills"))).toEqual([]);
  });
});

describe("withTime", () => {
  const now = new Date("2026-10-09T18:00:00Z");
  it("puts the time first on ordinary messages", () => {
    expect(withTime("Which lights are on?", now, "UTC")).toMatch(/^\[.*2026.*, UTC\]\nWhich lights are on\?$/);
  });
  it("keeps a /skill command first, since the SDK only recognises a prompt that starts with /", () => {
    expect(withTime("/zz-test-skill do it", now, "UTC")).toMatch(/^\/zz-test-skill do it\n\n\[.*2026.*, UTC\]$/);
  });
});
