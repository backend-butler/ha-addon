import { describe, expect, it, vi } from "vitest";
import { ApprovalGate, callKey, decide, type GatedTool } from "../../server/approvals";

const preview = { title: "Create automation", summary: "s", preview: { kind: "yaml" as const, text: "alias: x" } };

function setup(prepare: GatedTool["prepare"] = async () => preview, timeoutMs = 1000) {
  const events: [string, any][] = [];
  const gate = new ApprovalGate([{ name: "mcp__ha__upsert_automation", normalize: (i) => i, prepare }], (e, d) => events.push([e, d]), timeoutMs);
  const ask = (input: Record<string, unknown>, signal = new AbortController().signal) =>
    gate.canUseTool("mcp__ha__upsert_automation", input, { signal, toolUseID: "tu1" } as any);
  return { gate, events, ask };
}

const nextApprovalId = async (events: [string, any][]) => {
  await vi.waitFor(() => expect(events.some(([e]) => e === "approval")).toBe(true));
  return events.find(([e]) => e === "approval")![1].id as string;
};

describe("ApprovalGate", () => {
  it("denies tools it does not gate", async () => {
    const { gate } = setup();
    const r = await gate.canUseTool("mcp__ha__other", {}, { signal: new AbortController().signal, toolUseID: "x" } as any);
    expect(r!.behavior).toBe("deny");
  });

  it("allow → grants exactly one execution of exactly that input", async () => {
    const { gate, events, ask } = setup();
    const input = { id: "a1", config: { alias: "x", triggers: [] } };
    const p = ask(input);
    expect(decide(await nextApprovalId(events), true)).toBe(true);
    expect((await p)!.behavior).toBe("allow");
    expect(events.map(([e]) => e)).toEqual(["approval", "approval_result"]);
    expect(gate.consume("mcp__ha__upsert_automation", { id: "a1", config: { alias: "y", triggers: [] } })).toBe(false);
    expect(gate.consume("mcp__ha__upsert_automation", { config: { triggers: [], alias: "x" }, id: "a1" })).toBe(true); // key order irrelevant
    expect(gate.consume("mcp__ha__upsert_automation", input)).toBe(false); // spent
  });

  it("deny → no grant", async () => {
    const { gate, events, ask } = setup();
    const p = ask({ id: "a1" });
    decide(await nextApprovalId(events), false);
    expect((await p)!.behavior).toBe("deny");
    expect(gate.consume("mcp__ha__upsert_automation", { id: "a1" })).toBe(false);
  });

  it("timeout → deny, and a late decision is ignored", async () => {
    const { gate, events, ask } = setup(undefined, 20);
    const r = await ask({ id: "a1" });
    expect(r!.behavior).toBe("deny");
    expect(decide(events[0][1].id, true)).toBe(false);
    expect(gate.consume("mcp__ha__upsert_automation", { id: "a1" })).toBe(false);
  });

  it("abort (client gone) → deny", async () => {
    const { gate, events, ask } = setup();
    const ac = new AbortController();
    const p = ask({ id: "a1" }, ac.signal);
    await nextApprovalId(events);
    ac.abort();
    expect((await p)!.behavior).toBe("deny");
    expect(gate.consume("mcp__ha__upsert_automation", { id: "a1" })).toBe(false);
  });

  it("prepare error → deny with the reason and no card", async () => {
    const { events, ask } = setup(async () => ({ error: "triggers: invalid trigger 'nonsense'" }));
    const r = await ask({ id: "a1" });
    expect(r).toMatchObject({ behavior: "deny", message: expect.stringContaining("invalid trigger") });
    expect(events).toEqual([]);
  });

  it("two identical approved calls each get their own grant", async () => {
    const { gate, events, ask } = setup();
    const input = { id: "a1" };
    const p1 = ask(input);
    const p2 = ask(input);
    await vi.waitFor(() => expect(events.filter(([e]) => e === "approval")).toHaveLength(2));
    for (const [, d] of events.filter(([e]) => e === "approval")) decide(d.id, true);
    await Promise.all([p1, p2]);
    expect(gate.consume("mcp__ha__upsert_automation", input)).toBe(true);
    expect(gate.consume("mcp__ha__upsert_automation", input)).toBe(true);
    expect(gate.consume("mcp__ha__upsert_automation", input)).toBe(false);
  });

  it("callKey is order-insensitive for objects but not arrays", () => {
    expect(callKey("t", { a: 1, b: [1, 2] })).toBe(callKey("t", { b: [1, 2], a: 1 }));
    expect(callKey("t", { b: [1, 2] })).not.toBe(callKey("t", { b: [2, 1] }));
  });
});
