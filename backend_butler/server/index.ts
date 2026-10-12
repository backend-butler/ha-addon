import { createServer } from "node:http";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { decide } from "./approvals.js";
import { handleAttachment } from "./attachments.js";
import { handleArchiveChat, handleChat, handleDeleteChat } from "./chat.js";
import { ChatStore } from "./chats.js";
import { haFromConfig } from "./ha/index.js";
import { EntityCache } from "./ha/entities.js";
import { BadRequest, BASE_HEADERS, isAllowedPeer, readJson, sendJson, serveStatic } from "./http.js";
import { ensureSkillsFolder, handleSkills } from "./skills.js";
import { handleStt } from "./stt.js";

const config = loadConfig();
const ha = haFromConfig(config);
ensureSkillsFolder(config.configDir); // first start: the folder plus a README explaining the format
const deps = { config, ha, cache: new EntityCache(ha), store: new ChatStore(config.dataDir) };
// Both modes run from the package root (run.sh: cd /app).
const webRoot = join(process.cwd(), "dist", "web");

const server = createServer(async (req, res) => {
  for (const [k, v] of Object.entries(BASE_HEADERS)) res.setHeader(k, v);
  if (!isAllowedPeer(req.socket.remoteAddress, config.allowedPeers)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/api/health") return sendJson(res, 200, { ok: true, mode: config.mode });
    if (path === "/api/chat" && req.method === "POST") return await handleChat(deps, req, res);
    if (path === "/api/chats" && req.method === "GET") return sendJson(res, 200, deps.store.list());
    const chatMatch = /^\/api\/chats\/([^/]+)$/.exec(path);
    if (chatMatch && req.method === "GET") {
      const chat = deps.store.get(chatMatch[1]);
      if (!chat) return sendJson(res, 404, { error: "chat not found" });
      const { sessionId: _internal, ...visible } = chat;
      return sendJson(res, 200, visible);
    }
    if (chatMatch && req.method === "DELETE") return handleDeleteChat(deps, chatMatch[1], res);
    const archiveMatch = /^\/api\/chats\/([^/]+)\/archive$/.exec(path);
    if (archiveMatch && req.method === "POST") return await handleArchiveChat(deps, archiveMatch[1], req, res);
    const attachmentMatch = /^\/api\/chats\/([^/]+)\/attachments\/([^/]+)$/.exec(path);
    if (attachmentMatch && req.method === "GET") return handleAttachment(config, attachmentMatch[1], attachmentMatch[2], res);
    if (path === "/api/skills" && req.method === "GET") return handleSkills(config, res);
    if (path === "/api/stt" && req.method === "POST") return await handleStt(config, req, res);
    if (path === "/api/approval" && req.method === "POST") {
      const { id, allow } = await readJson<{ id?: string; allow?: boolean }>(req);
      if (typeof id !== "string" || typeof allow !== "boolean") return sendJson(res, 400, { error: "id and allow are required" });
      return decide(id, allow) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: "no pending approval" });
    }
    if (path.startsWith("/api/")) return sendJson(res, 404, { error: "not found" });
    await serveStatic(webRoot, req, res);
  } catch (err) {
    if (err instanceof BadRequest) {
      if (!res.headersSent) sendJson(res, 400, { error: err.message });
      else res.end();
      return;
    }
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
    else res.end();
  }
});

server.listen(config.port, config.host, () => {
  console.log(`Backend Butler (${config.mode}) listening on ${config.host}:${config.port}`);
});
