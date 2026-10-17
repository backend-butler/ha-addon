import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseLinkIntent, stripLinkParams } from "../../shared/intent";

// Copy of spec/link-cases.json from github.com/backend-butler/backend-butler: the link protocol every client must pass.
const spec = JSON.parse(readFileSync(new URL("../fixtures/link-cases.json", import.meta.url), "utf8"));

type Case = {
  note: string;
  search: string | null;
  searchTemplate?: { prefix: string; repeat: string; count: number };
  expect: { kind: string; text?: string; textLength?: number } | null;
  strippedSearch: string;
};
const searchOf = (c: Case) =>
  c.searchTemplate ? c.searchTemplate.prefix + c.searchTemplate.repeat.repeat(c.searchTemplate.count) : c.search!;

describe(`link protocol v${spec.version}`, () => {
  for (const c of spec.cases as Case[]) {
    it(c.note, () => {
      const got = parseLinkIntent(searchOf(c), 0);
      if (c.expect === null) expect(got).toBeNull();
      else {
        expect(got?.kind).toBe(c.expect.kind);
        if (c.expect.text !== undefined) expect(got?.text).toBe(c.expect.text);
        if (c.expect.textLength !== undefined) expect(got?.text?.length).toBe(c.expect.textLength);
      }
      expect(stripLinkParams(searchOf(c))).toBe(c.strippedSearch);
    });
  }
});
