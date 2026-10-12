import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

const prompts: any[] = [];
const drained: any[][] = [];
vi.mock("@anthropic-ai/claude-agent-sdk", async (orig) => {
  const real = await orig<typeof import("@anthropic-ai/claude-agent-sdk")>();
  return {
    ...real,
    query: (args: any) => {
      prompts.push(args.prompt);
      return (async function* () {
        // Like the real SDK: drain a streaming prompt before answering.
        if (typeof args.prompt !== "string") { const got: any[] = []; for await (const m of args.prompt) got.push(m); drained.push(got); }
        yield { type: "result", subtype: "success", is_error: false, session_id: "s", total_cost_usd: 0 };
      })();
    },
  };
});

const { ChatStore } = await import("../../server/chats");
const { handleChat } = await import("../../server/chat");
const { handleAttachment, validateImages } = await import("../../server/attachments");

const tmp = () => mkdtempSync(join(tmpdir(), "bb-att-"));
// Real leading bytes: the server checks them against the declared type.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("fake-png")]).toString("base64");
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("fake-jpg")]).toString("base64");
const img = (id: string, extra: { mediaType?: string; data?: string } = {}) => ({
  id,
  mediaType: "image/png",
  data: extra.mediaType === "image/jpeg" ? JPG : PNG,
  ...extra,
});

function fakeReq(body: unknown) {
  const req = new PassThrough();
  req.end(JSON.stringify(body));
  return req as any;
}
function fakeRes() {
  const chunks: any[] = [];
  const res: any = new PassThrough();
  res.writeHead = vi.fn();
  res.flushHeaders = vi.fn();
  res.write = (c: any) => (chunks.push(String(c)), true);
  res.end = vi.fn((c?: any) => c && chunks.push(String(c)));
  res.on = vi.fn();
  res.headersSent = false;
  return { res, body: () => chunks.join("") };
}
const deps = (dataDir = tmp()) => ({
  config: { dataDir, configDir: tmp(), model: "m", apiKey: () => "k" } as any,
  ha: { rest: vi.fn(async () => ({ time_zone: "America/Denver" })) } as any,
  cache: { get: vi.fn(async () => []) } as any,
  store: new ChatStore(dataDir),
});

describe("handleChat with photos", () => {
  it("sends one user message of image blocks then text to the SDK, stores files, saves image parts first", async () => {
    const d = deps();
    const r = fakeRes();
    await handleChat(d, fakeReq({ chatId: null, message: "what is this?", images: [img("aaaaaaaa"), img("bbbbbbbb", { mediaType: "image/jpeg" })] }), r.res);
    const chatId = JSON.parse(/^event: chat\ndata: (.*)$/m.exec(r.body())![1]).chatId as string;

    const prompt = prompts.at(-1);
    expect(typeof prompt).not.toBe("string");
    const sent = drained.at(-1)!;
    expect(sent).toHaveLength(1); // the stream yielded exactly once, then ended
    expect(sent[0]).toMatchObject({ type: "user", parent_tool_use_id: null, message: { role: "user" } });
    const content = sent[0].message.content;
    expect(content.slice(0, 2)).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: JPG } },
    ]);
    expect(content[2].type).toBe("text");
    expect(content[2].text).toMatch(/what is this\?$/);
    expect(content[2].text).toMatch(/America\/Denver/);

    const dir = join(d.config.dataDir, "attachments", chatId);
    expect(readFileSync(join(dir, "aaaaaaaa.png")).toString("base64")).toBe(PNG);
    expect(existsSync(join(dir, "bbbbbbbb.jpg"))).toBe(true);
    expect(d.store.get(chatId)!.messages[0].parts).toEqual([
      { kind: "image", attachmentId: "aaaaaaaa", mediaType: "image/png" },
      { kind: "image", attachmentId: "bbbbbbbb", mediaType: "image/jpeg" },
      { kind: "text", text: "what is this?" },
    ]);
  });

  it("accepts a photo-only message and titles the chat Photo", async () => {
    const d = deps();
    await handleChat(d, fakeReq({ chatId: null, message: "", images: [img("cccccccc")] }), fakeRes().res);
    const chat = d.store.get(d.store.list()[0].id)!;
    expect(chat.title).toBe("Photo");
    expect(chat.messages[0].parts).toEqual([{ kind: "image", attachmentId: "cccccccc", mediaType: "image/png" }]);
  });

  it("keeps the plain string prompt for text-only turns", async () => {
    await handleChat(deps(), fakeReq({ chatId: null, message: "hi" }), fakeRes().res);
    expect(typeof prompts.at(-1)).toBe("string");
  });

  it("answers 400 before streaming for bad input", async () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64");
    const cases: [string, any][] = [
      ["too many", { message: "x", images: [1, 2, 3, 4, 5].map((n) => img(`image-${n}-xx`)) }],
      ["bad type", { message: "x", images: [img("aaaaaaaa", { mediaType: "image/gif" })] }],
      ["bad id", { message: "x", images: [img("../etc")] }],
      ["duplicate", { message: "x", images: [img("aaaaaaaa"), img("aaaaaaaa")] }],
      ["not really a PNG", { message: "x", images: [img("aaaaaaaa", { data: Buffer.from("<svg onload=alert(1)>").toString("base64") })] }],
      ["bad base64", { message: "x", images: [img("aaaaaaaa", { data: "not base64!!" })] }],
      ["too big", { message: "x", images: [img("aaaaaaaa", { data: big })] }],
      ["nothing", { message: "  " }],
      ["empty list, no text", { message: "", images: [] }],
    ];
    for (const [name, body] of cases) {
      const d = deps();
      const before = prompts.length;
      const r = fakeRes();
      await handleChat(d, fakeReq({ chatId: null, ...body }), r.res);
      expect(r.res.writeHead, name).toHaveBeenCalledWith(400, expect.anything());
      expect(prompts.length, name).toBe(before);
      expect(existsSync(join(d.config.dataDir, "attachments")), name).toBe(false);
    }
  });

  it("validateImages accepts nothing, or a good list", () => {
    expect(validateImages(undefined)).toBeNull();
    expect(validateImages([img("aaaaaaaa")])).toBeNull();
    expect(validateImages("x")).not.toBeNull();
  });
});

describe("attachments lifecycle and serving", () => {
  async function chatWithPhoto() {
    const d = deps();
    await handleChat(d, fakeReq({ chatId: null, message: "look", images: [img("aaaaaaaa")] }), fakeRes().res);
    return { d, chatId: d.store.list()[0].id };
  }

  it("deletes the photos with the chat", async () => {
    const { d, chatId } = await chatWithPhoto();
    const dir = join(d.config.dataDir, "attachments", chatId);
    expect(existsSync(dir)).toBe(true);
    expect(d.store.delete(chatId)).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });

  it("serves a photo with its type and long private caching", async () => {
    const { d, chatId } = await chatWithPhoto();
    const res: any = new PassThrough();
    res.writeHead = vi.fn();
    const out: Buffer[] = [];
    res.on("data", (c: Buffer) => out.push(c));
    const done = new Promise((r) => res.on("end", r));
    handleAttachment(d.config, chatId, "aaaaaaaa", res);
    await done;
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      "content-type": "image/png",
      "cache-control": "private, max-age=31536000, immutable",
    }));
    expect(Buffer.concat(out).toString("base64")).toBe(PNG);
  });

  it("404s unknown chats and photos, and refuses path tricks", async () => {
    const { d, chatId } = await chatWithPhoto();
    const status = (chat: string, att: string) => {
      const res: any = new PassThrough();
      res.writeHead = vi.fn();
      res.end = vi.fn();
      handleAttachment(d.config, chat, att, res);
      return res.writeHead.mock.calls[0]?.[0];
    };
    expect(status(chatId, "zzzzzzzz")).toBe(404);
    expect(status("11111111-1111-1111-1111-111111111111", "aaaaaaaa")).toBe(404);
    expect(status("..", "aaaaaaaa")).toBe(404);
    expect(status(chatId, "..%2f..%2fchats%2findex")).toBe(404);
    expect(status(chatId, "../../chats/index")).toBe(404);
    expect(status(chatId, "aaaaaaaa.png")).toBe(404);
  });
});
