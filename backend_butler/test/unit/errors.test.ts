import { describe, expect, it } from "vitest";
import { friendlyError } from "../../web/errors";

describe("friendlyError", () => {
  it("unwraps a server error body and says what to do", () => {
    expect(friendlyError('Request failed (409) {"error":"this chat is already answering"}').text).toMatch(/still answering/);
    expect(friendlyError("TypeError: Failed to fetch").text).toMatch(/Couldn't reach Backend Butler/);
    expect(friendlyError("No Anthropic API key is configured. Set it in …").text).toMatch(/Configuration/);
  });

  it("keeps the original text as detail when it rewrote it", () => {
    expect(friendlyError("Request failed (502) Bad Gateway")).toEqual({
      text: expect.stringMatching(/hit a problem/),
      detail: "Request failed (502) Bad Gateway",
    });
  });

  it("passes plain messages through unchanged", () => {
    expect(friendlyError("Light group is unavailable.")).toEqual({ text: "Light group is unavailable." });
  });
});
