import { describe, expect, it } from "vitest";
import type { Part } from "../../shared/transcript";
import { hasPendingApproval, pickResume, relativeTime, RESUME_WINDOW_MS, splitArchived, workingStatus } from "../../web/chatState";

const NOW = Date.parse("2026-10-07T18:00:00Z");
const chat = (id: string, msAgo: number) => {
  const t = new Date(NOW - msAgo).toISOString();
  return { id, title: id, createdAt: t, updatedAt: t };
};

describe("pickResume (2-hour window)", () => {
  it("resumes the newest chat when it was used within the window", () => {
    expect(pickResume([chat("a", RESUME_WINDOW_MS - 1000), chat("b", RESUME_WINDOW_MS * 3)], NOW)).toBe("a");
  });
  it("starts fresh when the newest chat is older than the window, or there are none", () => {
    expect(pickResume([chat("a", RESUME_WINDOW_MS + 1000)], NOW)).toBeNull();
    expect(pickResume([], NOW)).toBeNull();
  });
  it("never resumes an archived chat, even the most recent one", () => {
    const archived = { ...chat("a", 1000), archivedAt: new Date(NOW).toISOString() };
    expect(pickResume([archived, chat("b", 60_000)], NOW)).toBe("b");
    expect(pickResume([archived], NOW)).toBeNull();
  });
});

describe("splitArchived", () => {
  it("keeps the server's order within each group", () => {
    const a = chat("a", 1);
    const b = { ...chat("b", 2), archivedAt: "2026-10-07T17:00:00Z" };
    const c = chat("c", 3);
    expect(splitArchived([a, b, c])).toEqual({ active: [a, c], archived: [b] });
  });
});

describe("relativeTime", () => {
  const ago = (ms: number) => new Date(NOW - ms).toISOString();
  it.each([
    [10_000, "just now"],
    [5 * 60_000, "5m ago"],
    [3 * 3600_000, "3h ago"],
    [30 * 3600_000, "yesterday"],
  ])("%i ms → %s", (ms, label) => expect(relativeTime(ago(ms), NOW)).toBe(label));
  it("falls back to a date", () => expect(relativeTime(ago(5 * 86400_000), NOW)).toMatch(/Oct\s*2|2\s*Oct/));
});

const tool = (name: string, input: unknown, result?: string): Part => ({ kind: "tool", id: name, name: `mcp__ha__${name}`, input, result });
const approval = (allowed?: boolean): Part => ({ kind: "approval", approval: { id: "x", title: "t", summary: "s", preview: { kind: "yaml", text: "" }, allowed } });

describe("workingStatus", () => {
  it.each([
    [[], "thinking…"],
    [[tool("find_entities", { query: "nightstands" })], "looking up devices…"],
    [[tool("find_entities", { domain: "light" })], "looking up lights…"],
    [[tool("get_states", { entity_ids: ["light.a", "light.b"] })], "checking lights…"],
    [[tool("get_states", { entity_ids: ["light.a", "switch.b"] })], "checking devices…"],
    [[tool("call_service", { domain: "switch", service: "turn_off" })], "controlling switches…"],
    [[tool("call_service", { domain: "media_player" })], "controlling media players…"],
    [[tool("get_automation", { kind: "script" })], "reading scripts…"],
    [[tool("upsert_automation", {})], "preparing a change…"],
    [[tool("find_entities", {}, "ok"), { kind: "text", text: "The" }], "writing…"],
    [[tool("upsert_automation", {}), approval()], "waiting for your approval"],
  ] as [Part[], string][])("%j → %s", (parts, status) => expect(workingStatus(parts)).toBe(status));
});

describe("hasPendingApproval", () => {
  const msgs = (p: Part) => [{ role: "user" as const, parts: [] }, { role: "assistant" as const, parts: [p] }];
  it("is true only for an undecided card while the turn is live", () => {
    expect(hasPendingApproval(msgs(approval()), true)).toBe(true);
    expect(hasPendingApproval(msgs(approval()), false)).toBe(false);
    expect(hasPendingApproval(msgs(approval(true)), true)).toBe(false);
  });
});
