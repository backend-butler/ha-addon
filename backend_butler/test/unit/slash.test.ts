import { describe, expect, it } from "vitest";
import { matchSkills, nextActive, parseSlash } from "../../web/slash";

const skills = [
  { name: "review", description: "Review a pull request" },
  { name: "lights", description: "Tidy light groups" },
  { name: "pre-review", description: "Check before review" },
  { name: "backup", description: "Back up the lights config" },
];

describe("parseSlash", () => {
  it("returns the query while the whole input is a slash word", () => {
    expect(parseSlash("/")).toBe("");
    expect(parseSlash("/rev")).toBe("rev");
    expect(parseSlash("/a-b1")).toBe("a-b1");
  });
  it("returns null otherwise", () => {
    expect(parseSlash("")).toBeNull();
    expect(parseSlash("hi /rev")).toBeNull();
    expect(parseSlash("/rev ")).toBeNull();
    expect(parseSlash("/Rev")).toBeNull();
    expect(parseSlash("/a\nb")).toBeNull();
  });
});

describe("matchSkills", () => {
  it("lists everything for an empty query", () => {
    expect(matchSkills(skills, "")).toHaveLength(4);
  });
  it("ranks name-prefix, then name-contains, then description-contains", () => {
    expect(matchSkills(skills, "rev").map((s) => s.name)).toEqual(["review", "pre-review"]);
    expect(matchSkills(skills, "light").map((s) => s.name)).toEqual(["lights", "backup"]);
  });
  it("returns nothing when nothing matches", () => {
    expect(matchSkills(skills, "zzz")).toEqual([]);
  });
});

describe("nextActive", () => {
  it("wraps both ways", () => {
    expect(nextActive(0, 1, 3)).toBe(1);
    expect(nextActive(2, 1, 3)).toBe(0);
    expect(nextActive(0, -1, 3)).toBe(2);
    expect(nextActive(0, 1, 0)).toBe(0);
  });
});
