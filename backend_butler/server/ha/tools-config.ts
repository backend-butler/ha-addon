import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ApprovalGate, ApprovalRequest, GatedTool } from "../approvals.js";
import { lineDiff, toYaml } from "../yaml.js";
import type { ConfigKind, HaClient } from "./client.js";
import type { EntityCache } from "./entities.js";
import { toolId } from "./tool-names.js";
import { errorMessage, fail, guarded, text } from "./tools-read.js";

// Gated tools: schemas must not use defaults/transforms, and objects must be loose, so the parsed
// args the handler sees equal the raw input that was approved (ApprovalGate.consume compares them).
const step = z.record(z.string(), z.unknown());

const automationConfig = z.looseObject({
  alias: z.string().min(1),
  description: z.string().optional(),
  triggers: z.array(step).min(1),
  conditions: z.array(step).optional(),
  actions: z.array(step).min(1),
  mode: z.enum(["single", "restart", "queued", "parallel"]).optional(),
});

const scriptConfig = z.looseObject({
  alias: z.string().min(1),
  description: z.string().optional(),
  sequence: z.array(step).min(1),
  mode: z.enum(["single", "restart", "queued", "parallel"]).optional(),
});

const SCHEMAS = { automation: automationConfig, script: scriptConfig } as const;
const SCRIPT_ID = /^[a-z0-9_]+$/;

/** Every string under an entity_id key, anywhere in the config. */
export function referencedEntities(cfg: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(cfg)) cfg.forEach((v) => referencedEntities(v, out));
  else if (cfg && typeof cfg === "object") {
    for (const [k, v] of Object.entries(cfg)) {
      if (k === "entity_id") (Array.isArray(v) ? v : [v]).forEach((e) => typeof e === "string" && !e.includes("{{") && out.add(e));
      else referencedEntities(v, out);
    }
  }
  return out;
}

/** The model must not tell the user they declined something they never saw. */
const NOT_SHOWN =
  "Nothing was changed: this change was never shown to the user for approval (an internal approval error, " +
  "not a decision by the user). Tell the user the approval step failed and ask whether to try again.";

/** Every light.turn_on step that names an effect, with its target entity ids. Walks nested sequences. */
export function effectSteps(cfg: unknown, out: Array<{ effect: string; entityIds: string[] }> = []) {
  if (Array.isArray(cfg)) cfg.forEach((v) => effectSteps(v, out));
  else if (cfg && typeof cfg === "object") {
    const step = cfg as Record<string, unknown>;
    const data = (step.data ?? {}) as Record<string, unknown>;
    const effect = data.effect ?? step.effect;
    if ((step.action === "light.turn_on" || step.service === "light.turn_on") && typeof effect === "string" && !effect.includes("{{")) {
      const target = (step.target ?? {}) as Record<string, unknown>;
      const ids = [target.entity_id, data.entity_id, step.entity_id].flatMap((v) => (Array.isArray(v) ? v : v ? [v] : []));
      out.push({ effect, entityIds: ids.filter((v): v is string => typeof v === "string") });
    }
    Object.values(step).forEach((v) => effectSteps(v, out));
  }
  return out;
}

/** Effect names are exact in HA; suggest close ones when the model's guess is off. */
function closeEffects(name: string, list: string[]): string[] {
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return list.filter((e) => {
    const m = e.toLowerCase().replace(/[^a-z0-9]/g, "");
    return m.includes(n) || n.includes(m);
  }).slice(0, 5);
}

const withoutId = (c: Record<string, unknown>) => Object.fromEntries(Object.entries(c).filter(([k]) => k !== "id"));

export function configTools(kind: ConfigKind, ha: HaClient, cache: EntityCache, gate: () => ApprovalGate) {
  const label = kind;
  const upsertName = `upsert_${kind}`;
  const deleteName = `delete_${kind}`;
  const full = toolId;

  async function validate(id: string | undefined, config: Record<string, unknown>): Promise<string | null> {
    if (kind === "script" && id !== undefined && !SCRIPT_ID.test(id)) return `script id must match ${SCRIPT_ID}`;
    const parts =
      kind === "automation"
        ? { triggers: config.triggers, conditions: config.conditions ?? [], actions: config.actions }
        : { actions: config.sequence };
    const result = await ha.validateConfig(parts);
    const errors = Object.entries(result).filter(([, r]) => !r.valid).map(([k, r]) => `${k}: ${r.error ?? "invalid (no detail from Home Assistant)"}`);
    if (errors.length) return `Home Assistant rejected the config — ${errors.join("; ")}`;
    const known = new Set((await cache.get()).map((e) => e.entity_id));
    const missing = [...referencedEntities(config)].filter((e) => !known.has(e));
    if (missing.length) return `Unknown entity ids: ${missing.join(", ")}. Use find_entities to get the right ids.`;
    for (const { effect, entityIds } of effectSteps(config)) {
      for (const id of entityIds) {
        const list = (await ha.getState(id))?.attributes.effect_list;
        if (!Array.isArray(list)) return `${id} does not support effects, so "${effect}" cannot be used.`;
        if (!list.includes(effect)) {
          const near = closeEffects(effect, list as string[]);
          return `${id} has no effect named "${effect}" (names are exact).` + (near.length ? ` Close matches: ${near.join(", ")}.` : "");
        }
      }
    }
    return null;
  }

  // One shape for the SDK tool and the gate, so the grant key matches the handler's parsed args.
  const upsertShape = { id: z.string().min(1).optional(), config: SCHEMAS[kind] };
  const deleteShape = { id: z.string().min(1) };
  const upsertSchema = z.object(upsertShape);
  const deleteSchema = z.object(deleteShape);

  const upsertGate: GatedTool = {
    name: full(upsertName),
    normalize: (input) => upsertSchema.parse(input),
    async prepare(input): Promise<ApprovalRequest | { error: string }> {
      const parsed = upsertSchema.safeParse(input);
      if (!parsed.success) return { error: parsed.error.message };
      const { id, config } = parsed.data;
      if (kind === "script" && id === undefined) return { error: "A script needs an id (a lowercase slug)." };
      const problem = await validate(id, config);
      if (problem) return { error: problem };
      const existing = id ? await ha.getConfig(kind, id) : null;
      const after = toYaml(config);
      if (existing) {
        return {
          title: `Edit ${label} “${config.alias}”`,
          summary: `Updates ${label} ${id} and reloads ${label}s.`,
          preview: { kind: "diff", lines: lineDiff(toYaml(withoutId(existing)), after) },
        };
      }
      return {
        title: `Create ${label} “${config.alias}”`,
        summary: `Adds a new ${label} and reloads ${label}s.`,
        preview: { kind: "yaml", text: after },
      };
    },
  };

  const deleteGate: GatedTool = {
    name: full(deleteName),
    normalize: (input) => deleteSchema.parse(input),
    async prepare(input) {
      const parsed = deleteSchema.safeParse(input);
      if (!parsed.success) return { error: parsed.error.message };
      const { id } = parsed.data;
      const existing = await ha.getConfig(kind, id);
      if (!existing) return { error: `No ${label} with id ${id}.` };
      return {
        title: `Delete ${label} “${String(existing.alias ?? id)}”`,
        summary: `Permanently removes ${label} ${id}.`,
        preview: { kind: "diff", lines: lineDiff(toYaml(withoutId(existing)), "").filter((l) => l.text !== "") },
      };
    },
  };

  async function readBack(id: string): Promise<string> {
    cache.invalidate();
    const states = await ha.getStates();
    const entity =
      kind === "automation"
        ? states.find((s) => s.attributes.id === id)
        : states.find((s) => s.entity_id === `script.${id}`);
    return entity ? `${entity.entity_id} is ${entity.state}` : "entity not visible yet (HA may still be reloading)";
  }

  const tools = [
    tool(
      upsertName,
      kind === "automation"
        ? "Create or edit an automation (requires the user's approval; they see a preview/diff). " +
          "To edit, pass the existing config id from list_automations or from your earlier create, with the COMPLETE new config. " +
          "Omit id to create. Config uses current HA syntax: triggers[{trigger:...}], conditions[{condition:...}], actions[{action:'light.turn_on', target:{entity_id:...}}]."
        : "Create or edit a script (requires the user's approval). Pass id (lowercase slug) and the COMPLETE config " +
          "{alias, sequence:[{action:...}], mode?}. An existing id is edited, a new id is created.",
      upsertShape,
      async (args) =>
        guarded(async () => {
          if (!gate().consume(full(upsertName), args)) return fail(NOT_SHOWN);
          const id = args.id ?? String(Date.now()); // scripts always carry an id (checked in prepare)
          await ha.saveConfig(kind, id, args.config as Record<string, unknown>);
          await new Promise((r) => setTimeout(r, 1000)); // let HA reload
          try {
            const stored = await ha.getConfig(kind, id);
            if (!stored) return fail(`HA accepted the save but ${label} ${id} could not be read back.`);
            return text(`Saved ${label} id=${id}: ${await readBack(id)}. Use this id for follow-up edits.`);
          } catch (err) {
            // The write went through; a failed read-back must not read like a failed save.
            return fail(`${label} ${id} was saved, but reading it back failed: ${errorMessage(err)}`);
          }
        }),
    ),
    tool(
      deleteName,
      `Delete a ${label} by config id (requires the user's approval).`,
      deleteShape,
      async (args) =>
        guarded(async () => {
          if (!gate().consume(full(deleteName), args)) return fail(NOT_SHOWN);
          await ha.deleteConfig(kind, args.id);
          cache.invalidate();
          let still: Record<string, unknown> | null;
          try {
            still = await ha.getConfig(kind, args.id);
          } catch (err) {
            return fail(`The delete was sent for ${label} ${args.id}, but checking it failed: ${errorMessage(err)}`);
          }
          return still ? fail(`Delete did not take effect for ${args.id}.`) : text(`Deleted ${label} ${args.id}.`);
        }),
    ),
  ];
  return { tools, gated: [upsertGate, deleteGate] };
}
