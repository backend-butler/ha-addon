import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SlashMenu as Menu } from "../../web/slash";
import { SlashMenu } from "../../web/SlashMenu";

const base: Menu = { open: true, matches: [{ name: "review", description: "Review a PR" }, { name: "lights", description: "Tidy" }], active: 1, pick: vi.fn(), onKeyDown: () => false, inputProps: {} };

describe("SlashMenu markup", () => {
  it("renders a labelled listbox with one option per skill and the active one selected", () => {
    const html = renderToStaticMarkup(<SlashMenu menu={base} />);
    expect(html).toMatch(/<ul[^>]*role="listbox"/);
    expect(html).toContain('id="slash-menu"');
    expect(html).toContain('aria-label="Skills"');
    expect(html).toContain('id="slash-opt-review"');
    expect(html).toMatch(/id="slash-opt-lights"[^>]*aria-selected="true"|aria-selected="true"[^>]*id="slash-opt-lights"/);
    expect(html).toContain("/review");
    expect(html).toContain("Review a PR");
  });
  it("renders nothing when closed", () => {
    expect(renderToStaticMarkup(<SlashMenu menu={{ ...base, open: false }} />)).toBe("");
  });
});
