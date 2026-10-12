import type { HaClient } from "./client.js";
import type { HaState } from "./types.js";

export interface EntityInfo {
  entity_id: string;
  domain: string;
  name: string;
  area: string | null;
  state: string;
  unit: string | null;
  device_class: string | null;
  hidden: boolean;
}

/** Join states + entity/device/area registries. Area comes from the entity, else its device. */
export function buildIndex(
  states: HaState[],
  entities: Awaited<ReturnType<HaClient["listEntities"]>>,
  devices: Awaited<ReturnType<HaClient["listDevices"]>>,
  areas: Awaited<ReturnType<HaClient["listAreas"]>>,
): EntityInfo[] {
  const areaName = new Map(areas.map((a) => [a.area_id, a.name]));
  const deviceArea = new Map(devices.map((d) => [d.id, d.area_id]));
  const reg = new Map(entities.map((e) => [e.entity_id, e]));
  return states.map((s) => {
    const r = reg.get(s.entity_id);
    const areaId = r?.area_id ?? (r?.device_id ? deviceArea.get(r.device_id) ?? null : null);
    const attrs = s.attributes;
    return {
      entity_id: s.entity_id,
      domain: s.entity_id.split(".")[0],
      name: String(attrs.friendly_name ?? r?.name ?? r?.original_name ?? s.entity_id),
      area: areaId ? areaName.get(areaId) ?? null : null,
      state: s.state,
      unit: (attrs.unit_of_measurement as string | undefined) ?? null,
      device_class: (attrs.device_class as string | undefined) ?? null,
      hidden: Boolean(r?.hidden_by || r?.disabled_by),
    };
  });
}

export interface FindQuery {
  query?: string;
  domain?: string;
  area?: string;
  device_class?: string;
  state?: string;
  include_hidden?: boolean;
  limit?: number;
}

/** Case-insensitive filter; every word in `query` must appear in the id, name or area. */
export function findEntities(index: EntityInfo[], q: FindQuery): { matches: EntityInfo[]; total: number } {
  const words = (q.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const eq = (a: string | null, b?: string) => !b || (a ?? "").toLowerCase() === b.toLowerCase();
  const all = index.filter((e) => {
    if (!q.include_hidden && e.hidden) return false;
    if (!eq(e.domain, q.domain) || !eq(e.area, q.area) || !eq(e.device_class, q.device_class) || !eq(e.state, q.state)) {
      return false;
    }
    const hay = `${e.entity_id} ${e.name} ${e.area ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  return { matches: all.slice(0, q.limit ?? 50), total: all.length };
}

export function formatEntity(e: EntityInfo): string {
  const value = e.unit ? `${e.state} ${e.unit}` : e.state;
  const extras = [e.area ? `area=${e.area}` : "no area", e.device_class ? `class=${e.device_class}` : "", e.hidden ? "hidden" : ""]
    .filter(Boolean)
    .join(", ");
  return `${e.entity_id} | ${e.name} | ${value} | ${extras}`;
}

/** Short cache so a multi-tool turn doesn't refetch registries on every call. */
export class EntityCache {
  private value: EntityInfo[] | null = null;
  private at = 0;
  private inflight: Promise<EntityInfo[]> | null = null;
  /** Bumped by invalidate(); a load started before an invalidate must not be served or cached. */
  private generation = 0;
  constructor(private readonly ha: HaClient, private readonly ttlMs = 10_000) {}

  async get(): Promise<EntityInfo[]> {
    if (this.value && Date.now() - this.at < this.ttlMs) return this.value;
    // Concurrent callers (parallel tool calls, prepare()) share one load.
    if (!this.inflight) {
      const p: Promise<EntityInfo[]> = this.load().finally(() => {
        if (this.inflight === p) this.inflight = null;
      });
      this.inflight = p;
    }
    return this.inflight;
  }

  invalidate(): void {
    this.value = null;
    this.inflight = null;
    this.generation++;
  }

  private async load(): Promise<EntityInfo[]> {
    const gen = this.generation;
    const [states, entities, devices, areas] = await Promise.all([
      this.ha.getStates(),
      this.ha.listEntities(),
      this.ha.listDevices(),
      this.ha.listAreas(),
    ]);
    const index = buildIndex(states, entities, devices, areas);
    if (gen === this.generation) {
      this.value = index;
      this.at = Date.now();
    }
    return index;
  }
}
