import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { HaClient } from "./client.js";
import { type EntityCache, findEntities, formatEntity } from "./entities.js";
import type { HaState } from "./types.js";

export type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

export const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });
export const fail = (t: string): ToolResult => ({ content: [{ type: "text", text: t }], isError: true });

/** Run a tool body; any thrown error becomes an isError result carrying HA's message. */
export async function guarded(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    return fail(errorMessage(err));
  }
}

/** An Error's message, or a thrown plain object's message/JSON; never "[object Object]". */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
    try {
      return JSON.stringify(err);
    } catch {
      /* fall through */
    }
  }
  return String(err);
}

// access_token: cameras/media players expose a credential here; it must not reach the model or chat history.
// effect_list / source_list stay visible: the agent needs them to pick valid effects and inputs.
const NOISY_ATTRS = new Set(["access_token", "entity_picture", "supported_features", "icon", "attribution"]);

/** Long attribute text (email bodies, calendar descriptions, lyrics) is where injected instructions hide. */
export const MAX_ATTR_TEXT = 300;
const clip = (v: unknown): unknown => (typeof v === "string" && v.length > MAX_ATTR_TEXT ? `${v.slice(0, MAX_ATTR_TEXT)}… [cut]` : v);

export function formatState(s: HaState | null, id: string): string {
  if (!s) return `${id}: not found`;
  const attrs = Object.fromEntries(Object.entries(s.attributes).filter(([k]) => !NOISY_ATTRS.has(k)).map(([k, v]) => [k, clip(v)]));
  return `${s.entity_id}: ${s.state} (changed ${s.last_changed}) ${JSON.stringify(attrs)}`;
}

export function readTools(ha: HaClient, cache: EntityCache) {
  return [
    tool(
      "find_entities",
      "Search Home Assistant entities by words in their id/name/area, and/or filter by domain, area, device_class or state. " +
        "Use this to resolve what the user means (e.g. 'nightstands', 'office lights') before acting. " +
        "Returns `entity_id | name | state | area/class`. Hidden entities (e.g. members of a light group) are excluded unless include_hidden.",
      {
        query: z.string().optional().describe("Space-separated words; all must match"),
        domain: z.string().optional().describe("e.g. light, switch, sensor, automation"),
        area: z.string().optional().describe("Area name, e.g. Office"),
        device_class: z.string().optional().describe("e.g. power, temperature, motion, occupancy"),
        state: z.string().optional().describe("e.g. on, off"),
        include_hidden: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      async (q) =>
        guarded(async () => {
          const { matches, total } = findEntities(await cache.get(), q);
          if (!matches.length) return text("No matching entities.");
          const more = total > matches.length ? `\n(${total - matches.length} more; narrow the search or raise limit)` : "";
          return text(matches.map(formatEntity).join("\n") + more);
        }),
      { annotations: { readOnlyHint: true } },
    ),
    tool(
      "get_states",
      "Read the current state and attributes (brightness, rgb_color, power, etc.) of specific entities.",
      { entity_ids: z.array(z.string()).min(1).max(50) },
      async ({ entity_ids }) =>
        guarded(async () => {
          const states = await Promise.all(entity_ids.map((id) => ha.getState(id)));
          const out = states.map((s, i) => formatState(s, entity_ids[i])).join("\n");
          return states.some((s) => !s) ? fail(out) : text(out); // an unknown id is an error, not a quiet line
        }),
      { annotations: { readOnlyHint: true } },
    ),
    tool(
      "list_automations",
      "List existing automations (or scripts) with their config id, name, on/off state and last trigger time.",
      { kind: z.enum(["automation", "script"]).default("automation") },
      async ({ kind }) =>
        guarded(async () => {
          const items = (await ha.getStates()).filter((s) => s.entity_id.startsWith(`${kind}.`));
          if (!items.length) return text(`There are no ${kind}s.`);
          return text(
            items
              .map((s) => {
                const id = kind === "automation" ? s.attributes.id : s.entity_id.slice("script.".length);
                const last = s.attributes.last_triggered ?? "never";
                return `${s.entity_id} | id=${id ?? "(yaml, not editable)"} | ${s.attributes.friendly_name} | ${s.state} | last=${last}`;
              })
              .join("\n"),
          );
        }),
      { annotations: { readOnlyHint: true } },
    ),
    tool(
      "get_automation",
      "Get the full stored config of one automation (or script) by its config id (from list_automations).",
      { kind: z.enum(["automation", "script"]).default("automation"), id: z.string().min(1) },
      async ({ kind, id }) =>
        guarded(async () => {
          const cfg = await ha.getConfig(kind, id);
          return cfg ? text(JSON.stringify(cfg, null, 2)) : fail(`No ${kind} with id ${id}.`);
        }),
      { annotations: { readOnlyHint: true } },
    ),
  ];
}
