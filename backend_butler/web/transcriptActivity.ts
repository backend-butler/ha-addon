import type { Part } from "../shared/transcript";

/**
 * What the agent did, read the way a homeowner would: device control and saved config as outcome rows, and every
 * run of lookups folded into one line. The raw calls stay one tap away for anyone who wants them.
 */

export type ToolPart = Extract<Part, { kind: "tool" }>;
export type Status = "running" | "ok" | "failed";

export interface EntityOutcome {
  id: string;
  name: string;
  /** "on", "off", "heat · 21°", "on · 60%"; empty while running or when the read-back is missing. */
  state: string;
}

export type Activity =
  | { kind: "control"; part: ToolPart; status: Status; domain: string; label: string; entities: EntityOutcome[] }
  | { kind: "config"; part: ToolPart; status: Status; label: string; editUrl?: string }
  | { kind: "lookups"; parts: ToolPart[]; status: Status; label: string; failed: number };

export type Block = { kind: "part"; part: Part } | { kind: "activity"; activity: Activity };

const NAME = /^mcp__ha__/;
export const toolName = (p: ToolPart) => p.name.replace(NAME, "");
export const statusOf = (p: ToolPart): Status => (p.result === undefined ? "running" : p.isError ? "failed" : "ok");

/** service → [while running, once done, after "Couldn't"] */
const VERBS: Record<string, [string, string, string]> = {
  turn_on: ["Turning on", "Turned on", "turn on"],
  turn_off: ["Turning off", "Turned off", "turn off"],
  toggle: ["Toggling", "Toggled", "toggle"],
  set_temperature: ["Setting the temperature of", "Set the temperature of", "set the temperature of"],
  set_hvac_mode: ["Changing the mode of", "Changed the mode of", "change the mode of"],
  set_fan_mode: ["Changing the fan of", "Changed the fan of", "change the fan of"],
  set_preset_mode: ["Changing the preset of", "Changed the preset of", "change the preset of"],
  set_percentage: ["Setting the speed of", "Set the speed of", "set the speed of"],
  set_humidity: ["Setting the humidity of", "Set the humidity of", "set the humidity of"],
  volume_set: ["Setting the volume of", "Set the volume of", "set the volume of"],
  volume_up: ["Turning up", "Turned up", "turn up"],
  volume_down: ["Turning down", "Turned down", "turn down"],
  volume_mute: ["Muting", "Muted", "mute"],
  media_play: ["Playing", "Played", "play"],
  media_pause: ["Pausing", "Paused", "pause"],
  media_play_pause: ["Playing or pausing", "Played or paused", "play or pause"],
  media_stop: ["Stopping", "Stopped", "stop"],
  media_next_track: ["Skipping a track on", "Skipped a track on", "skip a track on"],
  media_previous_track: ["Going back a track on", "Went back a track on", "go back a track on"],
  select_source: ["Changing the source of", "Changed the source of", "change the source of"],
  start: ["Starting", "Started", "start"],
  pause: ["Pausing", "Paused", "pause"],
  stop: ["Stopping", "Stopped", "stop"],
  return_to_base: ["Sending home", "Sent home", "send home"],
  locate: ["Locating", "Located", "locate"],
  clean_spot: ["Spot-cleaning with", "Spot-cleaned with", "spot-clean with"],
};

function controlLabel(domain: string, service: string, status: Status): string {
  const v = VERBS[service];
  if (!v) return status === "running" ? `Running ${domain}.${service}` : status === "failed" ? `Couldn't run ${domain}.${service}` : `Ran ${domain}.${service}`;
  return status === "running" ? v[0] : status === "failed" ? `Couldn't ${v[2]}` : v[1];
}

/** `light.kitchen: on (changed …) {"friendly_name":"Kitchen","brightness":153}` → id, name, state. */
const STATE_LINE = /^([a-z0-9_]+\.[a-z0-9_]+): (.*?) \(changed [^)]*\) (\{.*\})$/;

function describeState(state: string, attrs: Record<string, unknown>): string {
  const extra: string[] = [];
  if (typeof attrs.brightness === "number" && state === "on") extra.push(`${Math.round((attrs.brightness / 255) * 100)}%`);
  if (typeof attrs.temperature === "number") extra.push(`${attrs.temperature}°`);
  if (typeof attrs.percentage === "number" && state === "on") extra.push(`${attrs.percentage}%`);
  if (typeof attrs.volume_level === "number") extra.push(`vol ${Math.round(attrs.volume_level * 100)}%`);
  return [state.replace(/_/g, " "), ...extra].join(" · ");
}

export function parseStates(result: string | undefined): Map<string, { name?: string; state: string }> {
  const out = new Map<string, { name?: string; state: string }>();
  for (const line of (result ?? "").split("\n")) {
    const m = STATE_LINE.exec(line.trim());
    if (!m) continue;
    let attrs: Record<string, unknown> = {};
    try {
      attrs = JSON.parse(m[3]) as Record<string, unknown>;
    } catch {
      /* attributes are a bonus */
    }
    out.set(m[1], { name: typeof attrs.friendly_name === "string" ? attrs.friendly_name : undefined, state: describeState(m[2], attrs) });
  }
  return out;
}

const prettyId = (id: string) => {
  const s = id.split(".")[1] ?? id;
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
};

function control(part: ToolPart): Activity {
  const input = (part.input ?? {}) as { domain?: unknown; service?: unknown; entity_ids?: unknown };
  const domain = String(input.domain ?? "");
  const service = String(input.service ?? "");
  const status = statusOf(part);
  const states = parseStates(part.result);
  const ids = Array.isArray(input.entity_ids) ? input.entity_ids.map(String) : [];
  const entities = ids.map((id) => {
    const s = states.get(id);
    return { id, name: s?.name ?? prettyId(id), state: status === "ok" ? (s?.state ?? "") : "" };
  });
  return { kind: "control", part, status, domain, label: controlLabel(domain, service, status), entities };
}

/** `Saved automation id=1712…: automation.x is on.` → `1712…` */
const SAVED_ID = /^Saved (?:automation|script) id=([^:\s]+):/;

function config(part: ToolPart, inHa: boolean): Activity {
  const name = toolName(part);
  const kind = name.endsWith("_script") ? "script" : "automation";
  const input = (part.input ?? {}) as { id?: unknown; config?: { alias?: unknown } };
  const alias = typeof input.config?.alias === "string" ? `“${input.config.alias}”` : String(input.id ?? "");
  const status = statusOf(part);
  const deleting = name.startsWith("delete_");
  const label =
    status === "running"
      ? `${deleting ? "Deleting" : "Saving"} ${kind} ${alias}`
      : status === "failed"
        ? `${kind.charAt(0).toUpperCase() + kind.slice(1)} ${alias} was not ${deleting ? "deleted" : "saved"}`
        : `${deleting ? "Deleted" : "Saved"} ${kind} ${alias}`;
  const id = !deleting && status === "ok" ? SAVED_ID.exec(part.result ?? "")?.[1] : undefined;
  // HA's own editor, same origin as the ingress panel. Only inside HA: standalone there is no HA frontend here.
  const editUrl = id && inHa ? `/config/${kind}/edit/${encodeURIComponent(id)}` : undefined;
  return { kind: "config", part, status, label: label.trim(), editUrl };
}

const THINGS: Record<string, string> = { climate: "climate", media_player: "media players", vacuum: "vacuums", switch: "switches" };
const things = (domain: unknown) => (typeof domain === "string" && domain ? (THINGS[domain] ?? `${domain.replace(/_/g, " ")}s`) : "devices");

function lookupPhrase(p: ToolPart): string {
  const name = toolName(p);
  const input = (p.input ?? {}) as Record<string, unknown>;
  if (name === "find_entities") return `looked up ${things(input.domain)}`;
  if (name === "get_states") {
    const n = Array.isArray(input.entity_ids) ? input.entity_ids.length : 0;
    return n ? `checked ${n} ${n === 1 ? "device" : "devices"}` : "checked devices";
  }
  if (/_automations?$/.test(name)) return "read automations";
  if (/_scripts?$/.test(name)) return "read scripts";
  return name.replace(/_/g, " ");
}

function lookups(parts: ToolPart[]): Activity {
  const phrases = [...new Set(parts.map(lookupPhrase))];
  const text = phrases.length > 3 ? `${phrases.slice(0, 2).join(", ")} and more` : phrases.join(", ").replace(/, ([^,]*)$/, " and $1");
  const failed = parts.filter((p) => statusOf(p) === "failed").length;
  const status: Status = parts.some((p) => statusOf(p) === "running") ? "running" : failed ? "failed" : "ok";
  return { kind: "lookups", parts, status, label: text.charAt(0).toUpperCase() + text.slice(1), failed };
}

/** Fold a message's parts into display blocks: consecutive lookups become one line, writes become outcome rows. */
export function toBlocks(parts: Part[], inHa = false): Block[] {
  const out: Block[] = [];
  let run: ToolPart[] = [];
  const flush = () => {
    if (run.length) out.push({ kind: "activity", activity: lookups(run) });
    run = [];
  };
  for (const part of parts) {
    if (part.kind !== "tool") {
      flush();
      out.push({ kind: "part", part });
      continue;
    }
    const name = toolName(part);
    if (name === "call_service") {
      flush();
      out.push({ kind: "activity", activity: control(part) });
    } else if (/^(upsert|delete)_(automation|script)$/.test(name)) {
      flush();
      out.push({ kind: "activity", activity: config(part, inHa) });
    } else {
      run.push(part);
    }
  }
  flush();
  return out;
}
