import { describe, expect, it, vi } from "vitest";
import { ApprovalGate, decide } from "../../server/approvals";
import { actTools, callServiceGate, isEveryday } from "../../server/ha/tools-act";

const ID = "mcp__ha__call_service";
const cache = { get: async () => [{ entity_id: "script.movie_time", name: "Movie time" }], invalidate() {} } as any;
const opts = { signal: new AbortController().signal, toolUseID: "t1" } as any;

function setup() {
  const events: Array<{ event: string; data: any }> = [];
  const gate = new ApprovalGate([callServiceGate(cache)], (event, data) => events.push({ event, data }));
  const ha = { callService: vi.fn(async () => []), getState: vi.fn(async (id: string) => ({ entity_id: id, state: "on", attributes: {} })) };
  const [t] = actTools(ha as any, cache, () => gate, { settleMs: 0 });
  return { gate, ha, events, run: (args: any) => t.handler(args, {}) };
}

describe("call_service gate", () => {
  it("everyday device control runs without a card", async () => {
    const { gate, ha, events, run } = setup();
    const args = { domain: "light", service: "turn_on", entity_ids: ["light.mantle"] };
    expect(await gate.canUseTool(ID, args, opts)).toMatchObject({ behavior: "allow" });
    expect(events).toHaveLength(0);
    expect((await run(args)).isError).toBeFalsy();
    expect(ha.callService).toHaveBeenCalledOnce();
  });

  it.each([
    ["script", "turn_on"], ["scene", "turn_on"], ["automation", "trigger"], ["mqtt", "publish"], ["notify", "mobile_app_x"],
    ["button", "press"], ["media_player", "play_media"], ["rest_command", "x"], ["input_boolean", "turn_on"],
  ])("%s.%s is not everyday", (d, s) => expect(isEveryday(d, s)).toBe(false));

  it("anything else shows a card, and runs once only after approval", async () => {
    const { gate, ha, events, run } = setup();
    const args = { domain: "script", service: "turn_on", entity_ids: ["script.movie_time"] };
    // Without approval the handler refuses, even if something let the call through.
    expect((await run(args)).isError).toBe(true);
    expect(ha.callService).not.toHaveBeenCalled();

    const verdict = gate.canUseTool(ID, args, opts);
    await vi.waitFor(() => expect(events[0]?.event).toBe("approval"));
    expect(events[0].data.title).toBe("Run script.turn_on");
    expect(events[0].data.summary).toContain("Movie time");
    decide(events[0].data.id, true);
    expect(await verdict).toMatchObject({ behavior: "allow" });
    expect((await run(args)).isError).toBeFalsy();
    expect(ha.callService).toHaveBeenCalledOnce();
    expect((await run(args)).isError).toBe(true); // the approval is spent
  });

  it("blocked services are refused before any card", async () => {
    const { gate, events } = setup();
    const r = await gate.canUseTool(ID, { domain: "lock", service: "unlock", entity_ids: ["lock.front"] }, opts);
    expect(r).toMatchObject({ behavior: "deny" });
    expect(events).toHaveLength(0);
  });
});
