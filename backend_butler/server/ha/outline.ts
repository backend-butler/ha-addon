import type { OutlineSection } from "../../shared/transcript.js";

/**
 * A plain-language When / If / Then reading of an automation or script config, for the approval card. It is a
 * reading aid shown above the YAML, never a replacement for it: anything it does not understand is named
 * generically ("a template trigger") rather than guessed at.
 */

type Rec = Record<string, unknown>;
type Names = (entityId: string) => string;

const MAX = 140;
const clip = (s: string) => (s.length > MAX ? `${s.slice(0, MAX - 1)}…` : s);
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");

/** "Kitchen, Hall and 2 more" */
function join(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length <= 3) return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  return `${items.slice(0, 2).join(", ")} and ${items.length - 2} more`;
}

function entities(v: unknown, names: Names): string {
  const ids = list(v).filter((e): e is string => typeof e === "string");
  return join(ids.map((id) => (id.includes("{{") ? "a templated entity" : names(id))));
}

/** Who an action targets: entities first, then areas/devices, as HA resolves them. */
function target(step: Rec, names: Names): string {
  const t = isRec(step.target) ? step.target : {};
  const data = isRec(step.data) ? step.data : {};
  const ids = [...list(t.entity_id), ...list(data.entity_id), ...list(step.entity_id)];
  if (ids.length) return entities(ids, names);
  const areas = list(t.area_id).map(str).filter(Boolean);
  if (areas.length) return `${areas.length === 1 ? "area" : "areas"} ${join(areas)}`;
  if (list(t.device_id).length) return "a device";
  return "";
}

function duration(v: unknown): string {
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (isRec(v)) {
    const parts = (["hours", "minutes", "seconds"] as const).filter((k) => v[k]).map((k) => `${v[k]} ${k}`);
    if (parts.length) return parts.join(" ");
  }
  return "a while";
}

export function describeTrigger(t: unknown, names: Names): string {
  if (!isRec(t)) return "A trigger";
  const kind = str(t.trigger ?? t.platform);
  const who = entities(t.entity_id, names);
  const held = t.for ? ` for ${duration(t.for)}` : "";
  switch (kind) {
    case "state": {
      const to = t.to !== undefined && t.to !== null ? ` to ${str(t.to)}` : "";
      const from = t.from !== undefined && t.from !== null ? ` from ${str(t.from)}` : "";
      return to || from ? `${who} changes${from}${to}${held}` : `${who} changes${held}`;
    }
    case "numeric_state": {
      const bounds = [t.above !== undefined && `above ${str(t.above)}`, t.below !== undefined && `below ${str(t.below)}`].filter(Boolean);
      return `${who}${t.attribute ? ` ${str(t.attribute)}` : ""} goes ${bounds.join(" and ") || "past a limit"}${held}`;
    }
    case "time":
      return `At ${list(t.at).map(str).filter(Boolean).join(", ") || "a set time"}`;
    case "time_pattern":
      return "On a repeating time pattern";
    case "sun": {
      const offset = t.offset ? ` (offset ${str(t.offset)})` : "";
      return `At ${str(t.event) || "a sun event"}${offset}`;
    }
    case "homeassistant":
      return t.event === "shutdown" ? "When Home Assistant shuts down" : "When Home Assistant starts";
    case "zone":
      return `${who} ${t.event === "leave" ? "leaves" : "enters"} ${names(str(t.zone))}`;
    case "event":
      return `When the ${str(t.event_type) || "an"} event fires`;
    case "template":
      return "When a template becomes true";
    case "device":
      return `A device trigger${t.type ? ` (${str(t.type).replace(/_/g, " ")})` : ""}`;
    case "":
      return "A trigger";
    default:
      return `A ${kind.replace(/_/g, " ")} trigger`;
  }
}

export function describeCondition(c: unknown, names: Names): string {
  if (typeof c === "string") return "A template is true";
  if (!isRec(c)) return "A condition";
  const kind = str(c.condition);
  const who = entities(c.entity_id, names);
  switch (kind) {
    case "state":
      return `${who} is ${list(c.state).map(str).join(" or ")}${c.for ? ` for ${duration(c.for)}` : ""}`;
    case "numeric_state": {
      const bounds = [c.above !== undefined && `above ${str(c.above)}`, c.below !== undefined && `below ${str(c.below)}`].filter(Boolean);
      return `${who} is ${bounds.join(" and ") || "within a range"}`;
    }
    case "time": {
      const span = [c.after && `after ${str(c.after)}`, c.before && `before ${str(c.before)}`].filter(Boolean).join(" and ");
      const days = list(c.weekday).map(str).filter(Boolean);
      return [span && `It's ${span}`, days.length && `on ${join(days)}`].filter(Boolean).join(", ") || "It's within a time window";
    }
    case "sun":
      return `It's ${[c.after && `after ${str(c.after)}`, c.before && `before ${str(c.before)}`].filter(Boolean).join(" and ") || "a sun window"}`;
    case "zone":
      return `${who} is in ${names(str(c.zone))}`;
    case "template":
      return "A template is true";
    case "and":
    case "or":
      return `${list(c.conditions).length} conditions (${kind === "and" ? "all" : "any"} must hold)`;
    case "not":
      return `None of ${list(c.conditions).length} conditions hold`;
    case "":
      return "A condition";
    default:
      return `A ${kind.replace(/_/g, " ")} condition`;
  }
}

/** "light.turn_on" → "Turn on"; anything else keeps its service name. */
function verb(service: string): string {
  const [, name = ""] = service.split(".");
  const plain: Record<string, string> = { turn_on: "Turn on", turn_off: "Turn off", toggle: "Toggle" };
  return plain[name] ?? `Run ${service}`;
}

export function describeAction(a: unknown, names: Names): string {
  if (!isRec(a)) return "A step";
  const service = str(a.action ?? a.service);
  if (service) {
    if (service === "scene.turn_on") return `Activate ${target(a, names) || "a scene"}`;
    if (service === "script.turn_on") return `Run ${target(a, names) || "a script"}`;
    if (service.startsWith("notify.")) return `Send a notification (${service})`;
    const who = target(a, names);
    return who ? `${verb(service)} ${who}` : verb(service);
  }
  if (a.delay !== undefined) return `Wait ${duration(a.delay)}`;
  if (a.wait_template !== undefined) return "Wait until a template is true";
  if (a.wait_for_trigger !== undefined) return "Wait for a trigger";
  if (a.scene !== undefined) return `Activate ${names(str(a.scene))}`;
  if (a.choose !== undefined) return `Choose between ${list(a.choose).length} options`;
  if (a.if !== undefined) return "Run steps only if a condition holds";
  if (a.repeat !== undefined) return "Repeat some steps";
  if (a.parallel !== undefined) return `Run ${list(a.parallel).length} steps at once`;
  if (a.sequence !== undefined) return `Run ${list(a.sequence).length} steps`;
  if (a.variables !== undefined) return "Set variables";
  if (a.event !== undefined) return `Fire the ${str(a.event)} event`;
  if (a.stop !== undefined) return "Stop";
  if (a.condition !== undefined) return `Continue only if: ${describeCondition(a, names).toLowerCase()}`;
  return "A step";
}

export function outline(kind: "automation" | "script", config: Rec, names: Names): OutlineSection[] {
  const section = (label: OutlineSection["label"], items: unknown[], fn: (v: unknown, n: Names) => string) =>
    items.length ? [{ label, items: items.map((v) => clip(fn(v, names))) }] : [];
  if (kind === "script") return section("Then", list(config.sequence), describeAction);
  return [
    ...section("When", list(config.triggers ?? config.trigger), describeTrigger),
    ...section("If", list(config.conditions ?? config.condition), describeCondition),
    ...section("Then", list(config.actions ?? config.action), describeAction),
  ];
}
