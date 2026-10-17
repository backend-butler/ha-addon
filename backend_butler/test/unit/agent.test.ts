import { describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { translate } from "../../server/agent";

function collect(msgs: unknown[]) {
  const events: [string, any][] = [];
  const results = msgs.map((m) => translate(m as SDKMessage, (e, d) => events.push([e, d])));
  return { events, results };
}

describe("translate", () => {
  it("emits top-level text deltas only", () => {
    const delta = (parent: string | null) => ({
      type: "stream_event", parent_tool_use_id: parent, session_id: "s",
      event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } },
    });
    const { events } = collect([delta(null), delta("toolu_1")]);
    expect(events).toEqual([["text", { delta: "hi" }]]);
  });

  it("emits tool calls and tool results", () => {
    const { events } = collect([
      { type: "assistant", session_id: "s", parent_tool_use_id: null,
        message: { content: [{ type: "tool_use", id: "t1", name: "mcp__ha__get_states", input: { entity_ids: ["light.x"] } }] } },
      { type: "user", session_id: "s", parent_tool_use_id: null,
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: [{ type: "text", text: "boom" }] }] } },
    ]);
    expect(events).toEqual([
      ["tool", { id: "t1", name: "mcp__ha__get_states", input: { entity_ids: ["light.x"] } }],
      ["tool_result", { id: "t1", isError: true, text: "boom" }],
    ]);
  });

  it("reports success and error results", () => {
    const ok = collect([{ type: "result", subtype: "success", is_error: false, session_id: "s1", total_cost_usd: 0.01 }]);
    expect(ok.results).toEqual([true]);
    expect(ok.events).toEqual([["done", { sessionId: "s1", costUsd: 0.01 }]]);
    const bad = collect([{ type: "result", subtype: "error_max_turns", is_error: true, session_id: "s2", total_cost_usd: 0, errors: ["too many turns"] }]);
    expect(bad.results).toEqual([false]);
    expect(bad.events[0]).toEqual(["error", { message: "too many turns" }]);
  });
});
