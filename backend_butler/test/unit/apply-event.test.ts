import { describe, expect, it } from "vitest";
import { applyEvent, type Part } from "../../shared/transcript";

describe("applyEvent", () => {
  it("merges consecutive text deltas and attaches tool results by id", () => {
    let parts: Part[] = [];
    parts = applyEvent(parts, { event: "text", data: { delta: "Hel" } });
    parts = applyEvent(parts, { event: "text", data: { delta: "lo" } });
    parts = applyEvent(parts, { event: "tool", data: { id: "t1", name: "mcp__ha__get_states", input: {} } });
    parts = applyEvent(parts, { event: "tool_result", data: { id: "t1", isError: false, text: "on" } });
    parts = applyEvent(parts, { event: "text", data: { delta: "Done" } });
    expect(parts).toEqual([
      { kind: "text", text: "Hello" },
      { kind: "tool", id: "t1", name: "mcp__ha__get_states", input: {}, result: "on", isError: false },
      { kind: "text", text: "Done" },
    ]);
  });
});

describe("applyEvent approvals", () => {
  it("adds a waiting card and resolves it by id", () => {
    const approval = { id: "a1", title: "t", summary: "s", preview: { kind: "yaml" as const, text: "x" } };
    let parts = applyEvent([], { event: "approval", data: approval });
    expect(parts).toEqual([{ kind: "approval", approval }]);
    parts = applyEvent(parts, { event: "approval_result", data: { id: "a1", allow: false } });
    expect(parts).toEqual([{ kind: "approval", approval: { ...approval, allowed: false } }]);
  });
});
