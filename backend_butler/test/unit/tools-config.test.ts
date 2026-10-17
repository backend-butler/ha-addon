import { describe, expect, it, vi } from "vitest";
import { ApprovalGate, decide } from "../../server/approvals";
import { configTools, referencedEntities } from "../../server/ha/tools-config";

const CFG = {
  alias: "Monitor bars at sunset",
  triggers: [{ trigger: "sun", event: "sunset" }],
  conditions: [{ condition: "time", weekday: ["mon", "tue", "wed", "thu", "fri"] }],
  actions: [{ action: "light.turn_on", target: { entity_id: "light.monitor_light_bars" } }],
};

function setup(opts: { valid?: boolean; existing?: Record<string, unknown> | null; entities?: string[] } = {}) {
  const ha = {
    validateConfig: vi.fn(async () => ({
      triggers: { valid: opts.valid ?? true, error: opts.valid === false ? "bad trigger" : null },
      conditions: { valid: true, error: null },
      actions: { valid: true, error: null },
    })),
    getConfig: vi.fn(async () => opts.existing ?? null),
    saveConfig: vi.fn(async () => ({ result: "ok" })),
    deleteConfig: vi.fn(async () => ({ result: "ok" })),
    getStates: vi.fn(async () => [{ entity_id: "automation.monitor_bars", state: "on", attributes: { id: "a1" } }]),
  };
  const cache = {
    get: vi.fn(async () => (opts.entities ?? ["light.monitor_light_bars"]).map((entity_id) => ({ entity_id }))),
    invalidate: vi.fn(),
  };
  const events: [string, any][] = [];
  let gate!: ApprovalGate;
  const { tools, gated } = configTools("automation", ha as any, cache as any, () => gate);
  gate = new ApprovalGate(gated, (e, d) => events.push([e, d]), 1000);
  const upsert = tools.find((t) => t.name === "upsert_automation")!;
  const ask = (input: any) => gate.canUseTool("mcp__ha__upsert_automation", input, { signal: new AbortController().signal, toolUseID: "t" } as any);
  return { ha, events, upsert, ask, gate };
}

const approveNext = async (events: [string, any][], allow = true) => {
  await vi.waitFor(() => expect(events.some(([e]) => e === "approval")).toBe(true));
  decide(events.find(([e]) => e === "approval")![1].id, allow);
};

describe("upsert_automation", () => {
  it("refuses to write without an approval, even if called directly", async () => {
    const { ha, upsert } = setup();
    const r = await upsert.handler({ config: CFG } as any, {});
    expect(r.isError).toBe(true);
    expect(ha.saveConfig).not.toHaveBeenCalled();
  });

  it("does not show a card when HA's validator rejects the config", async () => {
    const { events, ask } = setup({ valid: false });
    const r = await ask({ config: CFG });
    expect(r).toMatchObject({ behavior: "deny", message: expect.stringContaining("bad trigger") });
    expect(events).toEqual([]);
  });

  it("does not show a card when an entity id does not exist", async () => {
    const { events, ask } = setup({ entities: [] });
    const r = await ask({ config: CFG });
    expect(r).toMatchObject({ behavior: "deny", message: expect.stringContaining("light.monitor_light_bars") });
    expect(events).toEqual([]);
  });

  it("create: YAML card → approve → saved with a generated id → read back", async () => {
    const { ha, events, ask, upsert } = setup();
    const p = ask({ config: CFG });
    await approveNext(events);
    expect((await p)!.behavior).toBe("allow");
    expect(events[0][1]).toMatchObject({ title: expect.stringContaining("Create automation"), preview: { kind: "yaml" } });
    ha.getConfig.mockResolvedValueOnce({ id: "x", ...CFG });
    const r = await upsert.handler({ config: CFG } as any, {});
    expect(ha.saveConfig).toHaveBeenCalledWith("automation", expect.stringMatching(/^\d+$/), CFG);
    expect(r.isError).toBeFalsy();
  });

  it("edit: diff card for an existing id", async () => {
    const existing = { id: "a1", ...CFG, conditions: [] };
    const { events, ask } = setup({ existing });
    const p = ask({ id: "a1", config: CFG });
    await approveNext(events, false);
    expect((await p)!.behavior).toBe("deny");
    const preview = events[0][1].preview;
    expect(preview.kind).toBe("diff");
    expect(preview.lines.some((l: any) => l.op === "+" && l.text.includes("condition: time"))).toBe(true);
    expect(preview.lines.some((l: any) => l.text.includes("id: a1"))).toBe(false);
  });

  it("an approval for one config cannot be spent on another", async () => {
    const { ha, events, ask, upsert } = setup();
    const p = ask({ config: CFG });
    await approveNext(events);
    await p;
    const r = await upsert.handler({ config: { ...CFG, alias: "something else" } } as any, {});
    expect(r.isError).toBe(true);
    expect(ha.saveConfig).not.toHaveBeenCalled();
  });
});

describe("SDK parse path", () => {
  it("an approved call still runs when the model adds a key the SDK's parser strips", async () => {
    const { z } = await import("zod");
    const { ha, events, ask, upsert } = setup();
    const raw = { config: { ...CFG }, reasoning: "user asked for weekdays" }; // stray top-level key
    const p = ask(raw);
    await approveNext(events);
    expect((await p)!.behavior).toBe("allow");
    // What the SDK does before calling the handler: parse raw input with the tool's own shape.
    const args = z.object(upsert.inputSchema as any).parse(raw);
    expect(args).not.toHaveProperty("reasoning");
    ha.getConfig.mockResolvedValueOnce({ id: "x", ...CFG });
    const r = await upsert.handler(args as any, {});
    expect(r.isError).toBeFalsy();
    expect(ha.saveConfig).toHaveBeenCalledTimes(1);
  });

  it("a script without an id is rejected before any card", async () => {
    const events: [string, any][] = [];
    let gate!: ApprovalGate;
    const ha = { validateConfig: vi.fn(), getConfig: vi.fn() };
    const { gated } = configTools("script", ha as any, { get: async () => [] } as any, () => gate);
    gate = new ApprovalGate(gated, (e, d) => events.push([e, d]));
    const r = await gate.canUseTool("mcp__ha__upsert_script", { config: { alias: "s", sequence: [{ stop: "x" }] } }, { signal: new AbortController().signal, toolUseID: "t" } as any);
    expect(r).toMatchObject({ behavior: "deny", message: expect.stringContaining("needs an id") });
    expect(events).toEqual([]);
  });
});

describe("delete_automation", () => {
  it("refuses to delete without an approval", async () => {
    const { ha, gate } = setup({ existing: { id: "a1", ...CFG } });
    void gate;
    const { tools } = configTools("automation", ha as any, { get: async () => [], invalidate() {} } as any, () => gate);
    const del = tools.find((t) => t.name === "delete_automation")!;
    const r = await del.handler({ id: "a1" } as any, {});
    expect(r.isError).toBe(true);
    expect(ha.deleteConfig).not.toHaveBeenCalled();
  });
});

describe("apply-time HA errors reach the agent", () => {
  const textOf = (r: any) => (r.content[0] as { text: string }).text;
  const approved = async (s: ReturnType<typeof setup>, input: any) => {
    const p = s.ask(input);
    await approveNext(s.events);
    await p;
  };

  it("upsert: HA's save rejection is returned verbatim", async () => {
    const s = setup();
    await approved(s, { config: CFG });
    s.ha.saveConfig.mockRejectedValueOnce(new Error("HA POST /config/automation/config/1 failed (400): Message malformed: extra keys not allowed"));
    const r = await s.upsert.handler({ config: CFG } as any, {});
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("Message malformed: extra keys not allowed");
  });

  it("upsert: a read-back failure after the save says it was saved", async () => {
    const s = setup();
    await approved(s, { config: CFG });
    s.ha.getConfig.mockRejectedValueOnce(new Error("HA GET failed (500): kaput"));
    const r = await s.upsert.handler({ config: CFG } as any, {});
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("kaput");
    expect(textOf(r)).toMatch(/was saved/);
  });

  it("delete: HA's rejection is returned verbatim", async () => {
    const s = setup({ existing: { id: "a1", ...CFG } });
    const del = configTools("automation", s.ha as any, { get: async () => [], invalidate() {} } as any, () => s.gate).tools.find((t) => t.name === "delete_automation")!;
    const p = s.gate.canUseTool("mcp__ha__delete_automation", { id: "a1" }, { signal: new AbortController().signal, toolUseID: "t" } as any);
    await approveNext(s.events);
    await p;
    s.ha.deleteConfig.mockRejectedValueOnce(new Error("HA DELETE failed (404): Resource not found"));
    const r = await del.handler({ id: "a1" } as any, {});
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("Resource not found");
  });

  it("delete: a failed verification read after the delete says it was sent", async () => {
    const s = setup({ existing: { id: "a1", ...CFG } });
    const del = configTools("automation", s.ha as any, { get: async () => [], invalidate() {} } as any, () => s.gate).tools.find((t) => t.name === "delete_automation")!;
    const p = s.gate.canUseTool("mcp__ha__delete_automation", { id: "a1" }, { signal: new AbortController().signal, toolUseID: "t" } as any);
    await approveNext(s.events);
    await p;
    s.ha.getConfig.mockRejectedValueOnce(new Error("HA GET failed (500): kaput"));
    const r = await del.handler({ id: "a1" } as any, {});
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("kaput");
    expect(textOf(r)).toMatch(/delete was sent/);
  });

  it("validation: an unreachable validator shows HA's error", async () => {
    const down = setup();
    down.ha.validateConfig.mockRejectedValueOnce(new Error("HA websocket error: Unauthorized"));
    expect(await down.ask({ config: CFG })).toMatchObject({ behavior: "deny", message: expect.stringContaining("HA websocket error: Unauthorized") });
  });

  it("validation: a null error from HA still yields a message", async () => {
    const s = setup();
    s.ha.validateConfig.mockResolvedValueOnce({ actions: { valid: false, error: null } } as any);
    const r = await s.ask({ config: CFG });
    expect(r).toMatchObject({ behavior: "deny", message: expect.not.stringContaining("null") });
  });
});

describe("referencedEntities", () => {
  it("collects entity ids from strings and lists, skipping templates", () => {
    const ids = referencedEntities({
      triggers: [{ trigger: "state", entity_id: ["binary_sensor.office_occupancy"] }],
      actions: [{ target: { entity_id: "light.a" } }, { target: { entity_id: "{{ x }}" } }],
    });
    expect([...ids].sort()).toEqual(["binary_sensor.office_occupancy", "light.a"]);
  });
});

describe("effect validation", () => {
  const withEffect = (effect: string) => ({
    ...CFG,
    actions: [{ action: "light.turn_on", target: { entity_id: "light.monitor_light_bars" }, data: { effect } }],
  });
  const lightWithEffects = { entity_id: "light.monitor_light_bars", state: "on", attributes: { effect_list: ["Candlelight", "Fire", "Reading"] } };

  it("accepts an effect the target light really has", async () => {
    const { ha, events, ask } = setup();
    (ha as any).getState = vi.fn(async () => lightWithEffects);
    const p = ask({ config: withEffect("Candlelight") });
    await approveNext(events, false);
    await p;
    expect(events[0][0]).toBe("approval");
  });

  it("rejects an unknown effect before any card, suggesting close matches", async () => {
    const { ha, events, ask } = setup();
    (ha as any).getState = vi.fn(async () => lightWithEffects);
    const r = await ask({ config: withEffect("candle light") });
    expect(r).toMatchObject({ behavior: "deny", message: expect.stringContaining('Close matches: Candlelight') });
    expect(events).toEqual([]);
  });

  it("rejects an effect on a light without effect support", async () => {
    const { ha, ask } = setup();
    (ha as any).getState = vi.fn(async () => ({ ...lightWithEffects, attributes: {} }));
    const r = await ask({ config: withEffect("Candlelight") });
    expect(r).toMatchObject({ behavior: "deny", message: expect.stringContaining("does not support effects") });
  });

  it("finds effects in nested choose/sequence steps", async () => {
    const { effectSteps } = await import("../../server/ha/tools-config");
    const steps = effectSteps({ actions: [{ choose: [{ sequence: [{ action: "light.turn_on", entity_id: "light.a", data: { effect: "Fire" } }] }] }] });
    expect(steps).toEqual([{ effect: "Fire", entityIds: ["light.a"] }]);
  });
});
