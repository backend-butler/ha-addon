import { describe, expect, it, vi } from "vitest";
import { actTools, checkService } from "../../server/ha/tools-act";

describe("checkService", () => {
  it.each([
    ["homeassistant", "restart"], ["hassio", "addon_stop"], ["update", "install"], ["shell_command", "anything"],
    ["recorder", "purge"], ["light", "reload"], ["template", "reload"], ["automation", "reload"],
    ["automation", "create"], ["script", "delete"], ["backup", "create"],
  ])("blocks %s.%s", (d, s) => expect(checkService(d, s).ok).toBe(false));

  it.each([
    ["light", "turn_on"], ["switch", "turn_off"], ["media_player", "media_pause"], ["vacuum", "start"],
    ["automation", "turn_off"], ["automation", "trigger"], ["script", "turn_on"], ["scene", "turn_on"],
  ])("allows %s.%s", (d, s) => expect(checkService(d, s).ok).toBe(true));

  it.each([
    ["lock", "unlock"], ["lock", "open"], ["alarm_control_panel", "alarm_disarm"],
    ["cover", "open_cover"], ["cover", "toggle"], ["cover", "set_cover_position"],
  ])("blocks physical-security %s.%s whatever the service name", (d, s) => expect(checkService(d, s).ok).toBe(false));
});

describe("formatState", async () => {
  const { formatState } = await import("../../server/ha/tools-read");
  it("never passes a camera access_token to the model", () => {
    const out = formatState({ entity_id: "camera.door", state: "idle", attributes: { access_token: "SECRET", friendly_name: "Door" }, last_changed: "t", last_updated: "t" }, "camera.door");
    expect(out).not.toContain("SECRET");
    expect(out).toContain("Door");
  });
  it("shows a light's effect list so the agent can pick a real effect", () => {
    const out = formatState({ entity_id: "light.bar", state: "on", attributes: { effect_list: ["Candlelight", "Fire"] }, last_changed: "t", last_updated: "t" }, "light.bar");
    expect(out).toContain("Candlelight");
  });
});

describe("call_service tool", () => {
  const make = () => {
    const ha = {
      callService: vi.fn(async () => []),
      getState: vi.fn(async (id: string) => ({ entity_id: id, state: "on", attributes: { brightness: 128 }, last_changed: "t", last_updated: "t" })),
    };
    const cache = { invalidate: vi.fn() };
    const [t] = actTools(ha as any, cache as any, () => ({ consume: () => false }) as any, { settleMs: 0 });
    return { ha, cache, run: (args: any) => t.handler(args, {}) };
  };

  it("never calls HA for a blocked service", async () => {
    const { ha, run } = make();
    const r = await run({ domain: "homeassistant", service: "restart", entity_ids: ["light.x"] });
    expect(r.isError).toBe(true);
    expect(ha.callService).not.toHaveBeenCalled();
  });

  it("targets explicit entity ids only and reads state back", async () => {
    const { ha, cache, run } = make();
    const r = await run({
      domain: "light", service: "turn_on", entity_ids: ["light.nightstands"],
      data: {
        rgb_color: [255, 153, 51], brightness_pct: 50,
        entity_id: "light.other", area_id: "bedroom", device_id: "d1", floor_id: "basement", label_id: "l1",
        target: { floor_id: "basement" },
      },
    });
    expect(ha.callService).toHaveBeenCalledWith("light", "turn_on", {
      rgb_color: [255, 153, 51], brightness_pct: 50, entity_id: ["light.nightstands"],
    });
    expect(cache.invalidate).toHaveBeenCalled();
    expect((r.content[0] as { text: string }).text).toContain("light.nightstands: on");
  });

  it("returns HA's error text as a tool error", async () => {
    const { ha, run } = make();
    ha.callService.mockRejectedValueOnce(new Error("HA POST /services/light/turn_on failed (400): extra keys not allowed"));
    const r = await run({ domain: "light", service: "turn_on", entity_ids: ["light.x"], data: { bogus: 1 } });
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toContain("extra keys not allowed");
  });
});
