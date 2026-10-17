import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { HaClient } from "./client.js";
import type { EntityCache } from "./entities.js";
import type { ApprovalGate, ApprovalRequest, GatedTool } from "../approvals.js";
import { toYaml } from "../yaml.js";
import { toolId } from "./tool-names.js";
import { errorMessage, fail, formatState, guarded, text } from "./tools-read.js";

/** Domains whose services change HA itself rather than devices. Never callable. */
const BLOCKED_DOMAINS = new Set([
  "homeassistant", "hassio", "recorder", "backup", "update", "shell_command", "python_script", "pyscript",
  "system_log", "logger", "frontend", "lovelace", "persistent_notification", "cloud", "zha", "matter", "zwave_js",
]);

/**
 * Physical-security domains. Blocked whole, not per service: `cover.toggle` or a position of 100 opens a
 * garage as surely as `open_cover`. None exist in this HA today; route them through approval if one is added.
 */
const SECURITY_DOMAINS = new Set(["lock", "alarm_control_panel", "cover"]);

/** Service-data keys HA treats as targets. Stripped so only the explicit entity_ids are ever targeted. */
const TARGET_KEYS = new Set(["entity_id", "area_id", "device_id", "floor_id", "label_id", "target"]);

/**
 * Everyday device control: runs without asking. Anything else that is not blocked (scripts, scenes, automation
 * triggers, buttons, sirens, valves, helpers, notify, mqtt, play_media, …) shows an approval card first, because
 * text the model reads (a song title, a calendar invite, a device name) can carry instructions, and those services
 * reach further than one device: a script or an MQTT topic can do anything, notify can send data out.
 */
const EVERYDAY: Record<string, readonly string[]> = {
  light: ["turn_on", "turn_off", "toggle"],
  switch: ["turn_on", "turn_off", "toggle"],
  fan: ["turn_on", "turn_off", "toggle", "set_percentage", "increase_speed", "decrease_speed", "oscillate", "set_direction", "set_preset_mode"],
  climate: ["turn_on", "turn_off", "toggle", "set_temperature", "set_hvac_mode", "set_fan_mode", "set_preset_mode", "set_humidity", "set_swing_mode"],
  humidifier: ["turn_on", "turn_off", "toggle", "set_humidity", "set_mode"],
  water_heater: ["turn_on", "turn_off", "set_temperature", "set_operation_mode"],
  media_player: [
    "turn_on", "turn_off", "toggle", "volume_set", "volume_up", "volume_down", "volume_mute", "media_play", "media_pause",
    "media_play_pause", "media_stop", "media_next_track", "media_previous_track", "select_source", "shuffle_set", "repeat_set",
  ],
  vacuum: ["start", "pause", "stop", "return_to_base", "locate", "clean_spot"],
};

export function isEveryday(domain: string, service: string): boolean {
  return EVERYDAY[domain.toLowerCase()]?.includes(service.toLowerCase()) ?? false;
}

type ServiceVerdict = { ok: true } | { ok: false; reason: string };

export function checkService(domain: string, service: string): ServiceVerdict {
  const d = domain.toLowerCase();
  const s = service.toLowerCase();
  if (BLOCKED_DOMAINS.has(d)) return { ok: false, reason: `${d}.* services change Home Assistant itself and are not available.` };
  if (s === "reload" || s.startsWith("reload_")) return { ok: false, reason: `${d}.${s} reloads configuration and is not available.` };
  if ((d === "automation" || d === "script") && !["turn_on", "turn_off", "toggle", "trigger"].includes(s)) {
    return { ok: false, reason: `Use the automation/script tools to change ${d}s.` };
  }
  if (SECURITY_DOMAINS.has(d)) {
    return { ok: false, reason: `${d} devices (locks, alarms, garage doors) are not controllable from Backend Butler.` };
  }
  return { ok: true };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const NOT_SHOWN =
  "Nothing was sent: this call was never shown to the user for approval (an internal approval error, not a " +
  "decision by the user). Tell the user the approval step failed and ask whether to try again.";

// No defaults or transforms: the parsed args must equal the approved input (ApprovalGate.consume compares them).
const callShape = {
  domain: z.string().min(1).describe("e.g. light, switch, media_player, vacuum, scene"),
  service: z.string().min(1).describe("e.g. turn_on, turn_off, toggle, set_temperature"),
  entity_ids: z.array(z.string().regex(/^[a-z0-9_]+\.[a-z0-9_]+$/)).min(1).max(50),
  data: z.record(z.string(), z.unknown()).optional().describe("Service data, excluding entity_id"),
};
const callSchema = z.object(callShape);
type Call = z.infer<typeof callSchema>;

const CALL_SERVICE = toolId("call_service");

/** call_service through the gate: everyday control is allowed at once, anything else shows a card first. */
export function callServiceGate(cache: EntityCache): GatedTool {
  return {
    name: CALL_SERVICE,
    normalize: (input) => callSchema.parse(input),
    autoAllow: (input) => {
      const r = callSchema.safeParse(input);
      return r.success && checkService(r.data.domain, r.data.service).ok && isEveryday(r.data.domain, r.data.service);
    },
    async prepare(input): Promise<ApprovalRequest | { error: string }> {
      const r = callSchema.safeParse(input);
      if (!r.success) return { error: r.error.issues.map((i) => i.message).join("; ") };
      const { domain, service, entity_ids, data } = r.data;
      const verdict = checkService(domain, service);
      if (!verdict.ok) return { error: verdict.reason };
      const known = await cache.get();
      const names = entity_ids.map((id) => known.find((e) => e.entity_id === id)?.name ?? id);
      const shown = { action: `${domain}.${service}`, target: { entity_id: entity_ids }, ...(data && Object.keys(data).length ? { data: dropTargets(data) } : {}) };
      return {
        title: `Run ${domain}.${service}`,
        summary: `On ${names.join(", ")}`,
        preview: { kind: "yaml", text: toYaml(shown) },
      };
    },
  };
}

const dropTargets = (data: Record<string, unknown>) => Object.fromEntries(Object.entries(data).filter(([k]) => !TARGET_KEYS.has(k)));

export function actTools(ha: HaClient, cache: EntityCache, gate: () => ApprovalGate, opts: { settleMs?: number } = {}) {
  const settleMs = opts.settleMs ?? 1500;
  return [
    tool(
      "call_service",
      "Control devices by calling a Home Assistant service on explicit entity ids, e.g. light.turn_on with " +
        "{rgb_color:[255,153,51], brightness_pct:50}. Always pass entity_ids (never areas). Everyday control of " +
        "lights, switches, fans, climate, media players and vacuums runs at once; anything else (scripts, scenes, " +
        "automation triggers, buttons, notify, …) first shows the user an approval card. " +
        "Returns the entities' state read back after the call so you can confirm the result.",
      callShape,
      async (args: Call) =>
        guarded(async () => {
          const { domain, service, entity_ids, data } = args;
          const verdict = checkService(domain, service);
          if (!verdict.ok) return fail(verdict.reason);
          // Defence in depth: whatever let the call through, only an everyday service or a spent approval runs.
          if (!isEveryday(domain, service) && !gate().consume(CALL_SERVICE, args)) return fail(NOT_SHOWN);
          await ha.callService(domain, service, { ...dropTargets(data ?? {}), entity_id: entity_ids });
          cache.invalidate();
          await sleep(settleMs); // many integrations (e.g. Govee cloud) report state asynchronously
          let after: Awaited<ReturnType<HaClient["getState"]>>[];
          try {
            after = await Promise.all(entity_ids.map((id) => ha.getState(id)));
          } catch (err) {
            // The call itself succeeded; don't let a failed read-back look like a failed command.
            return fail(`${domain}.${service} was sent, but reading the state back failed: ${errorMessage(err)}`);
          }
          const body = `Called ${domain}.${service}. State now:\n` + after.map((s, i) => formatState(s, entity_ids[i])).join("\n");
          return after.some((s) => !s) ? fail(body) : text(body); // HA accepts calls on unknown ids without complaint
        }),
    ),
  ];
}
