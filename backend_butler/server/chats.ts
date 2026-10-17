import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChatSummary, Message } from "../shared/transcript.js";
import { attachmentsDir } from "./attachments.js";

interface ChatRecord extends ChatSummary {
  sessionId?: string;
  messages: Message[];
}

const ID = /^[0-9a-f-]{36}$/;

/** One JSON file per chat under <dataDir>/chats. Small, single-user: no database needed. */
export class ChatStore {
  private readonly dir: string;
  private readonly sdkProjects: string;
  private readonly attachments: string;

  constructor(dataDir: string) {
    this.dir = join(dataDir, "chats");
    this.sdkProjects = join(dataDir, "claude", "projects");
    this.attachments = attachmentsDir(dataDir);
    mkdirSync(this.dir, { recursive: true });
  }

  /** A new chat that exists only in memory until its first turn is saved, so empty chats are never listed. */
  draft(): ChatRecord {
    const now = new Date().toISOString();
    return { id: randomUUID(), title: "New chat", createdAt: now, updatedAt: now, messages: [] };
  }

  get(id: string): ChatRecord | null {
    if (!ID.test(id)) return null;
    try {
      return JSON.parse(readFileSync(this.file(id), "utf8")) as ChatRecord;
    } catch {
      return null;
    }
  }

  list(): ChatSummary[] {
    const index = this.readIndex();
    return Object.values(index).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Append a finished turn (creating the chat on its first), remember the SDK session, and title the chat from its first message. */
  saveTurn(base: ChatRecord, user: Message, assistant: Message, sessionId?: string): ChatRecord {
    const chat = this.get(base.id) ?? { ...base, messages: [] };
    if (!chat.messages.length) chat.title = titleFrom(user);
    delete chat.archivedAt; // talking to an archived chat brings it back
    chat.messages.push(user, assistant);
    chat.sessionId = sessionId ?? chat.sessionId;
    chat.updatedAt = new Date().toISOString();
    this.write(chat);
    return chat;
  }

  /** Archive or restore a chat. Not a use of the chat, so updatedAt is unchanged. False if there is no such chat. */
  setArchived(id: string, archived: boolean): boolean {
    const chat = this.get(id);
    if (!chat) return false;
    if (archived) chat.archivedAt = new Date().toISOString();
    else delete chat.archivedAt;
    this.write(chat);
    return true;
  }

  /** Remove the chat, its index entry, its photos, and the SDK's transcript of its session. False if there was no such chat. */
  delete(id: string): boolean {
    const chat = this.get(id);
    if (!chat) return false;
    rmSync(this.file(id), { force: true });
    rmSync(join(this.attachments, id), { recursive: true, force: true });
    const index = this.readIndex();
    delete index[id];
    atomicWrite(join(this.dir, "index.json"), JSON.stringify(index));
    if (chat.sessionId && ID.test(chat.sessionId)) {
      let projects: string[] = [];
      try {
        projects = readdirSync(this.sdkProjects);
      } catch {
        /* no SDK sessions yet */
      }
      for (const p of projects) rmSync(join(this.sdkProjects, p, `${chat.sessionId}.jsonl`), { force: true });
    }
    return true;
  }

  private file(id: string) {
    return join(this.dir, `${id}.json`);
  }

  /** The index is a cache of the chat files; if it is missing or corrupt, rebuild it from them. */
  private readIndex(): Record<string, ChatSummary> {
    try {
      return JSON.parse(readFileSync(join(this.dir, "index.json"), "utf8"));
    } catch {
      const index: Record<string, ChatSummary> = {};
      for (const f of readdirSync(this.dir)) {
        const chat = f.endsWith(".json") ? this.get(f.slice(0, -5)) : null;
        if (chat) index[chat.id] = summary(chat);
      }
      return index;
    }
  }

  private write(chat: ChatRecord) {
    atomicWrite(this.file(chat.id), JSON.stringify(chat));
    const index = this.readIndex();
    index[chat.id] = summary(chat);
    atomicWrite(join(this.dir, "index.json"), JSON.stringify(index));
  }
}

function summary({ id, title, createdAt, updatedAt, archivedAt }: ChatRecord): ChatSummary {
  return archivedAt ? { id, title, createdAt, updatedAt, archivedAt } : { id, title, createdAt, updatedAt };
}

function atomicWrite(path: string, data: string) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

function titleFrom(m: Message): string {
  const text = m.parts.map((p) => (p.kind === "text" ? p.text : "")).join(" ").replace(/\s+/g, " ").trim();
  if (!text) return m.parts.some((p) => p.kind === "image") ? "Photo" : "New chat";
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}
