import { describe, expect, it } from "vitest";
import { buildIndex, findEntities } from "../../server/ha/entities";
import { areaSummary } from "../../server/prompt";

const st = (entity_id: string, state: string, attributes: Record<string, unknown> = {}) =>
  ({ entity_id, state, attributes, last_changed: "", last_updated: "" });
const reg = (entity_id: string, o: Partial<{ area_id: string; device_id: string; hidden_by: string }> = {}) =>
  ({ entity_id, name: null, original_name: null, area_id: o.area_id ?? null, device_id: o.device_id ?? null,
     platform: "x", hidden_by: o.hidden_by ?? null, disabled_by: null, entity_category: null });

const index = buildIndex(
  [
    st("light.nightstands", "on", { friendly_name: "Nightstands" }),
    st("light.nightstand_1", "on", { friendly_name: "Nightstand 1" }),
    st("light.light_bar", "off", { friendly_name: "Light Bar" }),
    st("sensor.desk_power", "42.5", { friendly_name: "Desk Power", unit_of_measurement: "W", device_class: "power" }),
    st("switch.light_bar_dreamview", "off", { friendly_name: "Dreamview" }),
  ],
  [
    reg("light.nightstands", { area_id: "bedroom" }),
    reg("light.nightstand_1", { area_id: "bedroom", hidden_by: "integration" }),
    reg("light.light_bar", { device_id: "dev1" }),
    reg("sensor.desk_power", { device_id: "dev1" }),
  ],
  [{ id: "dev1", name: "Bar", name_by_user: null, area_id: "office" }],
  [{ area_id: "bedroom", name: "Bedroom" }, { area_id: "office", name: "Office" }],
);

describe("entity index", () => {
  it("takes area from the device when the entity has none", () => {
    expect(index.find((e) => e.entity_id === "light.light_bar")?.area).toBe("Office");
  });
  it("hides hidden members unless asked", () => {
    expect(findEntities(index, { query: "nightstand" }).matches.map((e) => e.entity_id)).toEqual(["light.nightstands"]);
    expect(findEntities(index, { query: "nightstand", include_hidden: true }).total).toBe(2);
  });
  it("filters by device_class and area, case-insensitively", () => {
    expect(findEntities(index, { device_class: "POWER" }).matches[0].entity_id).toBe("sensor.desk_power");
    expect(findEntities(index, { area: "office", domain: "light" }).matches.map((e) => e.entity_id)).toEqual(["light.light_bar"]);
  });
  it("requires every query word to match", () => {
    expect(findEntities(index, { query: "light bar office" }).matches.map((e) => e.entity_id)).toEqual(["light.light_bar"]);
  });
  it("area summary lists only visible controllable entities", () => {
    const s = areaSummary(index);
    expect(s).toContain("Nightstands (light.nightstands)");
    expect(s).not.toContain("light.nightstand_1");
    expect(s).not.toContain("sensor.desk_power");
  });
});

describe("EntityCache", async () => {
  const { EntityCache } = await import("../../server/ha/entities");
  const deferred = () => {
    let resolve!: (v: any) => void;
    const promise = new Promise<any>((r) => (resolve = r));
    return { promise, resolve };
  };
  const fakeHa = () => {
    const loads: ReturnType<typeof deferred>[] = [];
    return {
      loads,
      ha: {
        getStates: () => {
          const d = deferred();
          loads.push(d);
          return d.promise;
        },
        listEntities: async () => [],
        listDevices: async () => [],
        listAreas: async () => [],
      } as any,
    };
  };
  const state = (s: string) => [{ entity_id: "light.x", state: s, attributes: {}, last_changed: "", last_updated: "" }];

  it("concurrent gets share one load", async () => {
    const { ha, loads } = fakeHa();
    const cache = new EntityCache(ha);
    const a = cache.get();
    const b = cache.get();
    expect(loads).toHaveLength(1);
    loads[0].resolve(state("on"));
    expect((await a)[0].state).toBe("on");
    expect(await b).toBe(await a);
  });

  it("a load started before invalidate() is not served afterwards", async () => {
    const { ha, loads } = fakeHa();
    const cache = new EntityCache(ha);
    const stale = cache.get();
    cache.invalidate(); // e.g. call_service just changed something
    const fresh = cache.get();
    expect(loads).toHaveLength(2);
    loads[1].resolve(state("on")); // fresh finishes first…
    await fresh;
    loads[0].resolve(state("off")); // …then the stale load lands and must not overwrite it
    await stale;
    expect((await fresh)[0].state).toBe("on");
    expect((await cache.get())[0].state).toBe("on");
  });
});
