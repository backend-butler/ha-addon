import { describe, expect, it, vi } from "vitest";
import { HaClient, HaError } from "../../server/ha/client";
import type { HaWs } from "../../server/ha/ws";
import { guarded, readTools } from "../../server/ha/tools-read";
import { actTools } from "../../server/ha/tools-act";

const mk = (fetch: any) => new HaClient({ baseUrl: "http://ha:8123", token: () => "tok", fetch, ws: {} as HaWs });
const reply = (status: number, body: string) => vi.fn(async () => new Response(body, { status }));
const textOf = (r: any) => (r.content[0] as { text: string }).text;

describe("REST error text", () => {
  it("keeps plain-text bodies (HA's 400 'Message malformed')", async () => {
    const ha = mk(reply(400, "Message malformed: extra keys not allowed @ data['bogus']"));
    await expect(ha.saveConfig("automation", "a", {})).rejects.toThrow(/400\): Message malformed: extra keys not allowed @ data\['bogus'\]/);
  });

  it("never renders an object-valued message as [object Object]", async () => {
    const ha = mk(reply(400, JSON.stringify({ message: { detail: "bad entity", code: 7 } })));
    const err = await ha.callService("light", "turn_on", {}).catch((e) => e);
    expect(err.message).not.toContain("[object Object]");
    expect(err.message).toContain("bad entity");
  });

  it("shows a JSON body that has no message field", async () => {
    const ha = mk(reply(500, JSON.stringify({ error: "boom" })));
    await expect(ha.getStates()).rejects.toThrow(/500\).*boom/);
  });

  it("includes the network cause when fetch itself fails", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 192.168.1.10:8123") });
    });
    const err = await mk(fetch).getStates().catch((e) => e);
    expect(err).toBeInstanceOf(HaError);
    expect(err.message).toContain("ECONNREFUSED");
  });

  it("reports a timeout as HaError and passes an abort signal", async () => {
    const fetch = vi.fn(async (_u: string, init: RequestInit) => {
      expect(init.signal).toBeDefined();
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    const err = await mk(fetch).getStates().catch((e) => e);
    expect(err).toBeInstanceOf(HaError);
    expect(err.message).toMatch(/timed out/i);
  });

  it("explains a 2xx body that is not JSON", async () => {
    const err = await mk(reply(200, "<html>proxy page</html>")).getStates().catch((e) => e);
    expect(err).toBeInstanceOf(HaError);
    expect(err.message).toContain("proxy page");
  });
});

describe("guarded", () => {
  it("turns a thrown non-Error into readable text", async () => {
    const r = await guarded(async () => {
      throw { message: "from HA", code: 3 };
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).not.toContain("[object Object]");
    expect(textOf(r)).toContain("from HA");
  });
});

describe("read tools", () => {
  const run = (name: string, ha: any, args: any) =>
    readTools(ha, { get: async () => [] } as any).find((t) => t.name === name)!.handler(args, {});

  it("get_states: unknown entity is an error that names it", async () => {
    const ha = { getState: vi.fn(async (id: string) => (id === "light.nope" ? null : { entity_id: id, state: "on", attributes: {}, last_changed: "t", last_updated: "t" })) };
    const r = await run("get_states", ha, { entity_ids: ["light.ok", "light.nope"] });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("light.nope: not found");
    expect(textOf(r)).toContain("light.ok: on");
  });

  it("get_states: HA failure text reaches the result", async () => {
    const ha = { getState: vi.fn(async () => { throw new HaError("HA GET /states/x failed (401): 401: Unauthorized", 401); }) };
    const r = await run("get_states", ha, { entity_ids: ["light.x"] });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("401: Unauthorized");
  });

  it("find_entities: a websocket registry failure reaches the result", async () => {
    const tools = readTools({} as any, { get: async () => { throw new HaError("HA websocket error: Unauthorized"); } } as any);
    const r = await tools.find((t) => t.name === "find_entities")!.handler({} as any, {});
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("HA websocket error: Unauthorized");
  });

  it("list_automations and get_automation surface HA errors", async () => {
    const boom = new HaError("HA GET /config/automation/config/a failed (500): kaput", 500);
    const ha = { getStates: vi.fn(async () => { throw boom; }), getConfig: vi.fn(async () => { throw boom; }) };
    for (const [name, args] of [["list_automations", { kind: "automation" }], ["get_automation", { kind: "automation", id: "a" }]] as const) {
      const r = await run(name, ha, args);
      expect(r.isError).toBe(true);
      expect(textOf(r)).toContain("kaput");
    }
  });
});

describe("call_service", () => {
  it("the deny-list refusal text reaches the agent", async () => {
    const ha = { callService: vi.fn() };
    const [t] = actTools(ha as any, { invalidate() {} } as any, () => ({ consume: () => false }) as any, { settleMs: 0 });
    const r = await t.handler({ domain: "lock", service: "unlock", entity_ids: ["lock.front"] } as any, {});
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/locks, alarms, garage doors/);
    expect(ha.callService).not.toHaveBeenCalled();
  });

  it("an entity missing on read-back is flagged as an error", async () => {
    const ha = { callService: vi.fn(async () => []), getState: vi.fn(async () => null) };
    const [t] = actTools(ha as any, { invalidate() {} } as any, () => ({ consume: () => false }) as any, { settleMs: 0 });
    const r = await t.handler({ domain: "light", service: "turn_on", entity_ids: ["light.ghost"] } as any, {});
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("light.ghost: not found");
  });

  it("a read-back failure after the call says the call went through", async () => {
    const ha = { callService: vi.fn(async () => []), getState: vi.fn(async () => { throw new HaError("HA GET /states/light.x failed (502): bad gateway", 502); }) };
    const [t] = actTools(ha as any, { invalidate() {} } as any, () => ({ consume: () => false }) as any, { settleMs: 0 });
    const r = await t.handler({ domain: "light", service: "turn_on", entity_ids: ["light.x"] } as any, {});
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("bad gateway");
    expect(textOf(r)).toMatch(/light\.turn_on was sent/);
  });
});
