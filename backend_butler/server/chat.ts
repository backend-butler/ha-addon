import type { IncomingMessage, ServerResponse } from "node:http";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { imagePrompt, runAgent } from "./agent.js";
import { checkImageBytes, MAX_BODY_BYTES, saveImages, validateImages } from "./attachments.js";
import { ApprovalGate } from "./approvals.js";
import type { Config } from "./config.js";
import type { HaClient } from "./ha/client.js";
import type { EntityCache } from "./ha/entities.js";
import { actTools, callServiceGate } from "./ha/tools-act.js";
import { configTools } from "./ha/tools-config.js";
import { readTools } from "./ha/tools-read.js";
import { readJson, sendJson } from "./http.js";
import { householdNotes, systemPrompt, withTime } from "./prompt.js";
import { startSse, type Emit } from "./sse.js";
import type { ChatStore } from "./chats.js";
import { applyEvent, settle, type AgentEvent, type ImageUpload, type Message, type Part } from "../shared/transcript.js";

import { MCP_NAME, toolId } from "./ha/tool-names.js";

export interface ChatDeps {
  config: Config;
  ha: HaClient;
  cache: EntityCache;
  store: ChatStore;
}

export function buildTools(deps: ChatDeps, emit: Emit = () => {}) {
  const auto = readTools(deps.ha, deps.cache);
  let gate!: ApprovalGate;
  const automations = configTools("automation", deps.ha, deps.cache, () => gate);
  const scripts = configTools("script", deps.ha, deps.cache, () => gate);
  gate = new ApprovalGate([...automations.gated, ...scripts.gated, callServiceGate(deps.cache)], emit);
  const gatedTools = [...actTools(deps.ha, deps.cache, () => gate), ...automations.tools, ...scripts.tools];
  return {
    server: createSdkMcpServer({ name: MCP_NAME, version: "0.1.0", tools: [...auto, ...gatedTools] as typeof auto }),
    // Reads run without asking. call_service and the config writes are deliberately NOT here, so every call goes
    // through gate.canUseTool: everyday device control passes at once, anything else needs the user's approval.
    autoAllowed: [...auto.map((t) => toolId(t.name)), "Skill"],
    gate,
  };
}

let timeZone: string | null = null;

const busy = new Set<string>();

/**
 * POST /api/chat {chatId, message, images?} → SSE stream of agent events; the turn is saved to the chat when it ends.
 * chatId null starts a new chat: the stream's first event is `chat` {chatId}, and the chat exists once the turn is saved.
 */
export async function handleChat(deps: ChatDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson<{ message?: unknown; chatId?: string | null; images?: unknown }>(req, MAX_BODY_BYTES); // BadRequest → 400 in index.ts
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const imageError = validateImages(body?.images);
  if (imageError) return sendJson(res, 400, { error: imageError });
  const images = (body.images as ImageUpload[] | undefined) ?? [];
  const bytesError = checkImageBytes(images);
  if (bytesError) return sendJson(res, 400, { error: bytesError });
  if ((!message && !images.length) || (typeof body.chatId !== "string" && body.chatId !== null)) {
    return sendJson(res, 400, { error: "message (or a photo) and chatId (or null for a new chat) are required" });
  }
  const chat = body.chatId === null ? deps.store.draft() : deps.store.get(body.chatId);
  if (!chat) return sendJson(res, 404, { error: "chat not found" });
  if (busy.has(chat.id)) return sendJson(res, 409, { error: "this chat is already answering" });
  busy.add(chat.id);
  try {
    saveImages(deps.config.dataDir, chat.id, images);
  } catch (err) {
    busy.delete(chat.id);
    return sendJson(res, 500, { error: `could not store photos: ${err instanceof Error ? err.message : String(err)}` });
  }

  const sse = startSse(res);
  if (body.chatId === null) sse("chat", { chatId: chat.id });
  let parts: Part[] = [];
  let sessionId = chat.sessionId;
  // Record every event with the same fold the UI uses, so the saved turn matches what was shown.
  const emit: Emit = (event, data) => {
    sse(event, data);
    parts = applyEvent(parts, { event, data } as AgentEvent);
    if (event === "done" && (data as { sessionId?: string }).sessionId) sessionId = (data as { sessionId: string }).sessionId;
  };
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  const userMsg: Message = {
    role: "user",
    parts: [
      ...images.map((i): Part => ({ kind: "image", attachmentId: i.id, mediaType: i.mediaType })),
      ...(message ? [{ kind: "text", text: message } as Part] : []),
    ],
  };
  try {
    timeZone ??= (await deps.ha.rest<{ time_zone: string }>("GET", "/config")).time_zone;
    const index = await deps.cache.get();
    const { server, autoAllowed, gate } = buildTools(deps, emit);
    const text = withTime(message, new Date(), timeZone);
    const result = await runAgent(
      deps.config,
      {
        prompt: images.length ? imagePrompt(images, text) : text,
        resume: chat.sessionId,
        systemPrompt: systemPrompt(index, householdNotes(deps.config.configDir)),
        mcpServers: { [MCP_NAME]: server },
        allowedTools: autoAllowed,
        canUseTool: gate.canUseTool,
        signal: abort.signal,
      },
      emit,
    );
    // A turn cut off before its result (e.g. phone backgrounded) still started a session; keep it.
    sessionId = result.sessionId ?? sessionId;
  } catch (err) {
    emit("error", { message: err instanceof Error ? err.message : String(err) });
  } finally {
    busy.delete(chat.id);
    deps.store.saveTurn(chat, userMsg, { role: "assistant", parts: settle(parts) }, sessionId);
    sse("saved", { chatId: chat.id });
    res.end();
  }
}

/** DELETE /api/chats/:id. Refused while the chat is answering: its turn would be saved straight back. */
export function handleDeleteChat(deps: Pick<ChatDeps, "store">, id: string, res: ServerResponse): void {
  if (busy.has(id)) return sendJson(res, 409, { error: "this chat is answering; try again when it finishes" });
  return deps.store.delete(id) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: "chat not found" });
}

/** POST /api/chats/:id/archive {archived}. Refused while answering, like delete: the turn would be saved over it. */
export async function handleArchiveChat(deps: Pick<ChatDeps, "store">, id: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { archived } = await readJson<{ archived?: unknown }>(req); // read the body first: ingress breaks early replies
  if (typeof archived !== "boolean") return sendJson(res, 400, { error: "archived (true or false) is required" });
  if (busy.has(id)) return sendJson(res, 409, { error: "this chat is answering; try again when it finishes" });
  return deps.store.setArchived(id, archived) ? sendJson(res, 200, { ok: true, archived }) : sendJson(res, 404, { error: "chat not found" });
}
