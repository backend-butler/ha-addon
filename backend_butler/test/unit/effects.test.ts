import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// An effect with an expression body returns that expression's value, and React calls it on cleanup.
// Browsers differ on what DOM methods return (Chrome's scrollIntoView returns a Promise; Safari's
// returns undefined), so a concise effect body can crash in one browser only. Require a block body,
// or a body that is itself the cleanup function (`() => () => ...`).
describe("React effects", () => {
  const files = readdirSync("web").filter((f) => /\.tsx?$/.test(f));
  it.each(files)("%s has no expression-bodied effects", (f) => {
    const src = readFileSync(`web/${f}`, "utf8");
    expect(src.match(/use(Layout)?Effect\(\s*\(\)\s*=>\s*(?![{(\s]|\(\)\s*=>)/g) ?? []).toEqual([]);
  });
});
