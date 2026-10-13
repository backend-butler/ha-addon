import type { ChatSummary, Message, Part } from "../shared/transcript";

/** Opening the app resumes the last-used chat only if it was used this recently; otherwise a fresh chat. */
export const RESUME_WINDOW_MS = 2 * 60 * 60 * 1000;

/** The chat to resume on open, or null for a fresh one. `chats` is newest first, as the server lists them. */
export function pickResume(chats: ChatSummary[], now: number): string | null {
  const last = chats.find((c) => !c.archivedAt);
  if (!last) return null;
  return now - Date.parse(last.updatedAt) < RESUME_WINDOW_MS ? last.id : null;
}

/** The main list and the Archived section, each in the server's (newest first) order. */
export function splitArchived(chats: ChatSummary[]): { active: ChatSummary[]; archived: ChatSummary[] } {
  return { active: chats.filter((c) => !c.archivedAt), archived: chats.filter((c) => c.archivedAt) };
}

/** Fixed starter set. A starter ending in "…" fills the composer instead of sending. */
export const STARTERS = ["Which lights are on?", "Turn off all the lights", "Create an automation for…", "What can you do?"];

export function relativeTime(iso: string, now: number): string {
  const then = Date.parse(iso);
  const mins = Math.floor((now - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h ago`;
  if (mins < 48 * 60) return "yesterday";
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** An approval card in the turn being answered that nobody has decided yet. */
export function hasPendingApproval(messages: Message[], busy: boolean): boolean {
  const last = messages[messages.length - 1];
  return busy && last?.role === "assistant" && last.parts.some((p) => p.kind === "approval" && p.approval.allowed === undefined);
}

const NAMES: Record<string, string> = { climate: "the climate", vacuum: "the vacuum", media_player: "media players" };
function things(domain: string | undefined): string {
  if (!domain) return "devices";
  if (NAMES[domain]) return NAMES[domain];
  const word = domain.replace(/_/g, " ");
  return /(s|sh|ch|x)$/.test(word) ? `${word}es` : `${word}s`;
}

/** One domain shared by every entity id, if there is one. */
function domainOf(ids: unknown): string | undefined {
  if (!Array.isArray(ids) || !ids.length) return undefined;
  const domains = new Set(ids.map((id) => String(id).split(".")[0]));
  return domains.size === 1 ? [...domains][0] : undefined;
}

/** A short, plain status for what the agent is doing right now, derived from the running tool. */
export function workingStatus(parts: Part[]): string {
  if (parts.some((p) => p.kind === "approval" && p.approval.allowed === undefined)) return "waiting for your approval";
  const running = [...parts].reverse().find((p): p is Extract<Part, { kind: "tool" }> => p.kind === "tool" && p.result === undefined);
  if (!running) return parts.length ? "writing…" : "thinking…";
  const name = running.name.replace(/^mcp__ha__/, "");
  const input = (running.input ?? {}) as Record<string, unknown>;
  const kind = input.kind === "script" ? "scripts" : "automations";
  if (name === "find_entities") return input.domain ? `looking up ${things(String(input.domain))}…` : "looking up devices…";
  if (name === "get_states") return `checking ${things(domainOf(input.entity_ids))}…`;
  if (name === "call_service") return `controlling ${things(input.domain ? String(input.domain) : undefined)}…`;
  if (name === "list_automations" || name === "get_automation") return `reading ${kind}…`;
  if (/^(upsert|delete)_/.test(name)) return "preparing a change…";
  return "working…";
}
