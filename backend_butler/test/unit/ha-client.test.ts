import { describe, expect, it, vi } from "vitest";
import { HaClient, HaError, wsUrl } from "../../server/ha/client";
import type { HaWs } from "../../server/ha/ws";

function client(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift()!;
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof globalThis.fetch;
  const ha = new HaClient({ baseUrl: "http://supervisor/core", token: () => "tok", fetch, ws: {} as HaWs });
  return { ha, calls };
}

describe("HaClient REST", () => {
  it("sends bearer auth and JSON body to /api", async () => {
    const { ha, calls } = client([{ status: 200, body: [] }]);
    await ha.callService("light", "turn_on", { entity_id: "light.x", brightness_pct: 50 });
    expect(calls[0].url).toBe("http://supervisor/core/api/services/light/turn_on");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ entity_id: "light.x", brightness_pct: 50 });
  });

  it("surfaces HA's error message verbatim", async () => {
    const { ha } = client([{ status: 400, body: { message: "Service light.blink not found." } }]);
    await expect(ha.callService("light", "blink", {})).rejects.toThrow(/400\): Service light.blink not found\./);
  });

  it("maps 404 to null for state and config lookups", async () => {
    const { ha } = client([{ status: 404, body: { message: "Entity not found." } }, { status: 404, body: { message: "Resource not found" } }]);
    expect(await ha.getState("light.nope")).toBeNull();
    expect(await ha.getConfig("automation", "nope")).toBeNull();
  });

  it("still throws non-404 errors as HaError", async () => {
    const { ha } = client([{ status: 401, body: "401: Unauthorized" }]);
    await expect(ha.getState("light.x")).rejects.toBeInstanceOf(HaError);
  });

  it("encodes ids in config paths", async () => {
    const { ha, calls } = client([{ status: 200, body: { result: "ok" } }]);
    await ha.saveConfig("automation", "a b/c", { alias: "x" });
    expect(calls[0].url).toBe("http://supervisor/core/api/config/automation/config/a%20b%2Fc");
  });
});

describe("wsUrl", () => {
  it("uses the supervisor proxy path in app mode", () => {
    expect(wsUrl("http://supervisor/core")).toBe("ws://supervisor/core/websocket");
  });
  it("uses /api/websocket against HA directly", () => {
    expect(wsUrl("http://192.168.1.10:8123")).toBe("ws://192.168.1.10:8123/api/websocket");
  });
});
