import { describe, expect, it } from "vitest";
import { safeUrl } from "../../web/safeUrl";

const a = { tagName: "a" };

describe("safeUrl (links in model output)", () => {
  it("keeps web, mail and in-page links", () => {
    expect(safeUrl("https://www.home-assistant.io/", "href", a)).toBe("https://www.home-assistant.io/");
    expect(safeUrl("/config/automation", "href", a)).toBe("/config/automation");
    expect(safeUrl("mailto:x@example.com", "href", a)).toBe("mailto:x@example.com");
  });
  it("drops script, data, app and protocol-relative links, and every image", () => {
    for (const u of ["javascript:alert(1)", "data:text/html,x", "homeassistant://navigate/x", "//evil.example/"])
      expect(safeUrl(u, "href", a)).toBeNull();
    expect(safeUrl("https://example.com/x.png", "src", { tagName: "img" })).toBeNull();
  });
  it("drops Butler action links, so injected text cannot start one with a click", () => {
    expect(safeUrl("/local_backend_butler?butler=say&text=hi", "href", a)).toBeNull();
    expect(safeUrl("https://ha.example/local_backend_butler?x=1&butler=camera", "href", a)).toBeNull();
  });
});
