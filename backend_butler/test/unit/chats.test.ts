import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

const queries: any[] = [];
let script: (opts: any) => any[] = () => [];
vi.mock("@anthropic-ai/claude-agent-sdk", async (orig) => {
  const real = await orig<typeof import("@anthropic-ai/claude-agent-sdk")>();
  return {
    ...real,
    query: (args: any) => {
      queries.push(args.options);
      const msgs = script(args.options);
      return (async function* () {
        for (const m of msgs) yield m;
      })();
    },
  };
});

const { ChatStore } = await import("../../server/chats");
const { handleChat, handleDeleteChat, handleArchiveChat } = await import("../../server/chat");

const tmp = () => mkdtempSync(join(tmpdir(), "bb-chats-"));
const turn = (text: string) => ({ role: "user" as const, parts: [{ kind: "text" as const, text }] });
const reply = { role: "assistant" as const, parts: [] };

describe("ChatStore", () => {
  it("creates on the first turn, lists newest first, titles from the first message, survives a new instance", async () => {
    const dir = tmp();
    const store = new ChatStore(dir);
    const a = store.draft();
    const b = store.draft();
    expect(store.list()).toEqual([]); // a draft is not a chat until something is said in it
    expect(store.get(a.id)).toBeNull();
    store.saveTurn(b, turn("first"), reply);
    await new Promise((r) => setTimeout(r, 5));
    store.saveTurn(a, { role: "user", parts: [{ kind: "text", text: "Turn the nightstands saffron" }] }, { role: "assistant", parts: [] }, "s1");
    const reopened = new ChatStore(dir);
    expect(reopened.list().map((c) => c.id)).toEqual([a.id, b.id]);
    expect(reopened.get(a.id)).toMatchObject({ title: "Turn the nightstands saffron", sessionId: "s1" });
    expect(reopened.get(a.id)!.messages).toHaveLength(2);
  });

  it("rejects ids that are not uuids (no path tricks)", async () => {
    const { writeFileSync } = await import("node:fs");
    const dir = tmp();
    const store = new ChatStore(dir);
    // A readable chat-shaped file outside chats/ must not be reachable by id.
    writeFileSync(join(dir, "outside.json"), JSON.stringify({ id: "x", messages: [] }));
    expect(store.get("../outside")).toBeNull();
    expect(store.get("index")).toBeNull();
  });

  it("deletes a chat's file, its index entry, and its SDK transcript", async () => {
    const { existsSync, mkdirSync, writeFileSync } = await import("node:fs");
    const dir = tmp();
    const store = new ChatStore(dir);
    const keep = store.draft();
    const gone = store.draft();
    store.saveTurn(keep, turn("keep"), reply, "11111111-1111-1111-1111-111111111111");
    store.saveTurn(gone, turn("gone"), reply, "22222222-2222-2222-2222-222222222222");
    const projects = join(dir, "claude", "projects", "-data-workspace");
    mkdirSync(projects, { recursive: true });
    writeFileSync(join(projects, "11111111-1111-1111-1111-111111111111.jsonl"), "{}");
    writeFileSync(join(projects, "22222222-2222-2222-2222-222222222222.jsonl"), "{}");

    expect(store.delete(gone.id)).toBe(true);
    expect(store.get(gone.id)).toBeNull();
    expect(new ChatStore(dir).list().map((c) => c.id)).toEqual([keep.id]);
    expect(existsSync(join(projects, "22222222-2222-2222-2222-222222222222.jsonl"))).toBe(false);
    expect(existsSync(join(projects, "11111111-1111-1111-1111-111111111111.jsonl"))).toBe(true);
    expect(store.delete(gone.id)).toBe(false);
    expect(store.delete("../index")).toBe(false);
  });
});

function fakeReq(body: unknown) {
  const req = new PassThrough();
  req.end(JSON.stringify(body));
  return req as any;
}
function fakeRes() {
  const chunks: string[] = [];
  const res: any = new PassThrough();
  res.writeHead = vi.fn();
  res.flushHeaders = vi.fn();
  res.write = (c: string) => (chunks.push(c), true);
  res.end = vi.fn((c?: string) => c && chunks.push(c));
  res.on = vi.fn();
  res.headersSent = true;
  return { res, body: () => chunks.join("") };
}

describe("handleChat persistence", () => {
  const deps = (store: any) => ({
    config: { dataDir: tmp(), configDir: tmp(), model: "m", apiKey: () => "k" } as any,
    ha: { rest: vi.fn(async () => ({ time_zone: "America/Denver" })) } as any,
    cache: { get: vi.fn(async () => []) } as any,
    store,
  });

  it("resumes the chat's SDK session and saves each turn", async () => {
    const store = new ChatStore(tmp());
    const chat = store.draft();
    const d = deps(store);
    script = (o) => [
      { type: "stream_event", parent_tool_use_id: null, session_id: "sess-1", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: o.resume ? "again" : "hello" } } },
      { type: "result", subtype: "success", is_error: false, session_id: "sess-1", total_cost_usd: 0 },
    ];

    const r1 = fakeRes();
    await handleChat(d, fakeReq({ chatId: null, message: "hi" }), r1.res);
    expect(queries.at(-1).resume).toBeUndefined();
    expect(r1.body()).toContain("event: saved");
    // A new chat announces its id before anything else, so the UI can keep talking to it.
    expect(r1.body().indexOf("event: chat\n")).toBe(0);
    const created = /^event: chat\ndata: (.*)$/m.exec(r1.body())![1];
    const chatId = JSON.parse(created).chatId as string;
    expect(store.list().map((c) => c.id)).toEqual([chatId]);
    chat.id = chatId;

    await handleChat(d, fakeReq({ chatId: chat.id, message: "and now?" }), fakeRes().res);
    expect(queries.at(-1).resume).toBe("sess-1");

    const saved = store.get(chat.id)!;
    expect(saved.messages.map((m) => m.parts)).toEqual([
      [{ kind: "text", text: "hi" }],
      [{ kind: "text", text: "hello" }],
      [{ kind: "text", text: "and now?" }],
      [{ kind: "text", text: "again" }],
    ]);
  });

  it("keeps the session even when the first turn is cut off before its result", async () => {
    const store = new ChatStore(tmp());
    script = () => [
      { type: "system", subtype: "init", session_id: "sess-cut" },
      { type: "stream_event", parent_tool_use_id: null, session_id: "sess-cut", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "part" } } },
    ];
    await handleChat(deps(store), fakeReq({ chatId: null, message: "hi" }), fakeRes().res);
    expect(store.get(store.list()[0].id)!.sessionId).toBe("sess-cut");
  });

  it("sends a stable system prompt and puts the time in the user message", async () => {
    const store = new ChatStore(tmp());
    const chat = store.saveTurn(store.draft(), turn("setup"), reply);
    script = () => [{ type: "result", subtype: "success", is_error: false, session_id: "s", total_cost_usd: 0 }];
    await handleChat(deps(store), fakeReq({ chatId: chat.id, message: "hi" }), fakeRes().res);
    const first = queries.at(-1).systemPrompt;
    await new Promise((r) => setTimeout(r, 5));
    await handleChat(deps(store), fakeReq({ chatId: chat.id, message: "again" }), fakeRes().res);
    expect(queries.at(-1).systemPrompt).toBe(first);
    expect(first).not.toMatch(/\d{1,2}:\d{2}/);
    expect(store.get(chat.id)!.messages[2].parts).toEqual([{ kind: "text", text: "hi" }]); // stored without the time prefix
  });

  it("saves an unanswered approval as declined", async () => {
    const { settle } = await import("../../shared/transcript");
    const card = { kind: "approval" as const, approval: { id: "a", title: "t", summary: "s", preview: { kind: "yaml" as const, text: "" } } };
    expect(settle([card])[0]).toMatchObject({ approval: { allowed: false } });
  });

  it("404s for an unknown chat", async () => {
    const d = deps(new ChatStore(tmp()));
    const { res } = fakeRes();
    res.headersSent = false;
    await handleChat(d, fakeReq({ chatId: "00000000-0000-0000-0000-000000000000", message: "x" }), res);
    expect(res.writeHead).toHaveBeenCalledWith(404, expect.anything());
  });

  it("never lists a new chat whose first turn was refused before it started", async () => {
    const store = new ChatStore(tmp());
    const { res } = fakeRes();
    res.headersSent = false;
    await handleChat(deps(store), fakeReq({ chatId: null, message: "   " }), res);
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.anything());
    expect(store.list()).toEqual([]);
  });
});

describe("handleDeleteChat", () => {
  const status = (res: any) => res.writeHead.mock.calls[0][0];
  const deps = (store: any) => ({ store }) as any;

  it("deletes a saved chat, 404s for an unknown one", () => {
    const store = new ChatStore(tmp());
    const chat = store.saveTurn(store.draft(), turn("x"), reply);
    const ok = fakeRes();
    ok.res.headersSent = false;
    handleDeleteChat(deps(store), chat.id, ok.res);
    expect(status(ok.res)).toBe(200);
    expect(store.list()).toEqual([]);
    const missing = fakeRes();
    missing.res.headersSent = false;
    handleDeleteChat(deps(store), chat.id, missing.res);
    expect(status(missing.res)).toBe(404);
  });

  it("refuses with 409 while that chat is answering, and leaves it intact", async () => {
    const store = new ChatStore(tmp());
    const chat = store.saveTurn(store.draft(), turn("x"), reply);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const d = {
      config: { dataDir: tmp(), configDir: tmp(), model: "m", apiKey: () => "k" } as any,
      ha: { rest: vi.fn(async () => ({ time_zone: "UTC" })) } as any,
      cache: { get: vi.fn(async () => (await held, [])) } as any, // runs every turn, so it can hold one open
      store,
    };
    script = () => [{ type: "result", subtype: "success", is_error: false, session_id: "s", total_cost_usd: 0 }];
    const answering = handleChat(d, fakeReq({ chatId: chat.id, message: "hi" }), fakeRes().res);
    await new Promise((r) => setTimeout(r, 5));

    const refused = fakeRes();
    refused.res.headersSent = false;
    handleDeleteChat(deps(store), chat.id, refused.res);
    expect(status(refused.res)).toBe(409);
    expect(store.get(chat.id)).not.toBeNull();

    release();
    await answering;
    const after = fakeRes();
    after.res.headersSent = false;
    handleDeleteChat(deps(store), chat.id, after.res);
    expect(status(after.res)).toBe(200);
  });
});

describe("ChatStore index recovery", () => {
  it("rebuilds the chat list from chat files when index.json is corrupt or missing", async () => {
    const { writeFileSync, rmSync } = await import("node:fs");
    const dir = tmp();
    const store = new ChatStore(dir);
    const a = store.saveTurn(store.draft(), turn("a"), reply);
    const b = store.saveTurn(store.draft(), turn("b"), reply);
    writeFileSync(join(dir, "chats", "index.json"), '{"trunc');
    store.saveTurn(a, { role: "user", parts: [{ kind: "text", text: "x" }] }, { role: "assistant", parts: [] });
    expect(store.list().map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
    rmSync(join(dir, "chats", "index.json"));
    expect(new ChatStore(dir).list()).toHaveLength(2);
  });
});

describe("archive", () => {
  const status = (res: any) => res.writeHead.mock.calls[0][0];
  const call = async (store: any, id: string, body: unknown) => {
    const r = fakeRes();
    r.res.headersSent = false;
    await handleArchiveChat({ store } as any, id, fakeReq(body), r.res);
    return r.res;
  };

  it("archives and restores a chat, persisted in the list across a new store", async () => {
    const dir = tmp();
    const store = new ChatStore(dir);
    const chat = store.saveTurn(store.draft(), turn("x"), reply);
    expect(status(await call(store, chat.id, { archived: true }))).toBe(200);
    const listed = new ChatStore(dir).list()[0];
    expect(listed.archivedAt).toEqual(expect.any(String));
    expect(listed.updatedAt).toBe(chat.updatedAt); // archiving is not "using" the chat
    expect(status(await call(store, chat.id, { archived: false }))).toBe(200);
    expect(new ChatStore(dir).list()[0].archivedAt).toBeUndefined();
  });

  it("400s without a boolean, 404s for an unknown chat", async () => {
    const store = new ChatStore(tmp());
    const chat = store.saveTurn(store.draft(), turn("x"), reply);
    expect(status(await call(store, chat.id, { archived: "yes" }))).toBe(400);
    expect(status(await call(store, "00000000-0000-0000-0000-000000000000", { archived: true }))).toBe(404);
  });

  it("sending a message to an archived chat brings it back", async () => {
    const store = new ChatStore(tmp());
    const chat = store.saveTurn(store.draft(), turn("x"), reply);
    store.setArchived(chat.id, true);
    store.saveTurn(chat, turn("again"), reply);
    expect(store.get(chat.id)!.archivedAt).toBeUndefined();
    expect(store.list()[0].archivedAt).toBeUndefined();
  });

  it("still loads and lists a chat file written before archive existed", async () => {
    const { writeFileSync } = await import("node:fs");
    const dir = tmp();
    const id = "dc9d31a8-f2b9-4b68-ad66-5a4f9fa9b585";
    const old = { id, title: "Evening setup", createdAt: "2026-10-05T23:28:37.462Z", updatedAt: "2026-10-06T12:00:47.863Z", sessionId: "s", messages: [turn("hi"), reply] };
    new ChatStore(dir); // creates chats/
    writeFileSync(join(dir, "chats", `${id}.json`), JSON.stringify(old));
    const store = new ChatStore(dir);
    expect(store.list()).toEqual([{ id, title: "Evening setup", createdAt: old.createdAt, updatedAt: old.updatedAt }]);
    expect(store.setArchived(id, true)).toBe(true);
    expect(store.get(id)!.messages).toHaveLength(2);
  });
});
