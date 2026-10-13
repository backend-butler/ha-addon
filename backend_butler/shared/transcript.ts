// Shared by server (recording) and web (rendering) so a reopened chat looks exactly like the live one.

export type DiffLine = { op: " " | "+" | "-"; text: string };

/** One row of an approval's plain-language reading: "When" the triggers, "If" the conditions, "Then" the steps. */
export interface OutlineSection {
  label: "When" | "If" | "Then";
  items: string[];
}

export interface Approval {
  id: string;
  title: string;
  summary: string;
  preview: { kind: "yaml"; text: string } | { kind: "diff"; lines: DiffLine[] };
  /** Automations and scripts: the config read as When / If / Then. Shown above the preview, never instead of it. */
  outline?: OutlineSection[];
  /** undefined = waiting for the user */
  allowed?: boolean;
}

export type AgentEvent =
  | { event: "text"; data: { delta: string } }
  | { event: "tool"; data: { id: string; name: string; input: unknown } }
  | { event: "tool_result"; data: { id: string; isError: boolean; text: string } }
  | { event: "approval"; data: Approval }
  | { event: "approval_result"; data: { id: string; allow: boolean } }
  | { event: "done"; data: { sessionId?: string; costUsd?: number } }
  | { event: "error"; data: { message: string } };

/** Photo formats the composer sends and the model accepts. */
export type ImageType = "image/jpeg" | "image/png" | "image/webp";
export const IMAGE_TYPES: readonly ImageType[] = ["image/jpeg", "image/png", "image/webp"];
export const MAX_IMAGES = 4;
/** Attachment ids are made by the browser (crypto.randomUUID is missing outside secure contexts, so not assumed). */
export const ATTACHMENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** One photo sent with a message. `data` is base64 without a `data:` prefix. */
export interface ImageUpload {
  id: string;
  mediaType: ImageType;
  data: string;
}

/** POST /api/chat body. `message` may be empty when `images` is not. chatId null starts a new chat. */
export interface ChatRequest {
  chatId: string | null;
  message: string;
  images?: ImageUpload[];
}

/** A skill the user can run as `/<name>`, from GET /api/skills. */
export interface SkillSummary {
  name: string;
  description: string;
}

export type Part =
  | { kind: "text"; text: string }
  /** A photo the user sent; served at api/chats/<chatId>/attachments/<attachmentId>. */
  | { kind: "image"; attachmentId: string; mediaType: ImageType }
  | { kind: "tool"; id: string; name: string; input: unknown; result?: string; isError?: boolean }
  | { kind: "approval"; approval: Approval }
  | { kind: "error"; text: string };

export interface Message {
  role: "user" | "assistant";
  parts: Part[];
}

export interface ChatSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Set while the chat is archived: hidden from the main list and never auto-resumed. */
  archivedAt?: string;
}

/** Fold one agent event into the assistant message being streamed. */
export function applyEvent(parts: Part[], e: AgentEvent): Part[] {
  switch (e.event) {
    case "text": {
      const last = parts[parts.length - 1];
      if (last?.kind === "text") return [...parts.slice(0, -1), { ...last, text: last.text + e.data.delta }];
      return [...parts, { kind: "text", text: e.data.delta }];
    }
    case "tool":
      return [...parts, { kind: "tool", id: e.data.id, name: e.data.name, input: e.data.input }];
    case "tool_result":
      return parts.map((p) => (p.kind === "tool" && p.id === e.data.id ? { ...p, result: e.data.text, isError: e.data.isError } : p));
    case "approval":
      return [...parts, { kind: "approval", approval: e.data }];
    case "approval_result":
      return parts.map((p) =>
        p.kind === "approval" && p.approval.id === e.data.id ? { ...p, approval: { ...p.approval, allowed: e.data.allow } } : p,
      );
    case "error":
      return [...parts, { kind: "error", text: e.data.message }];
    default:
      return parts;
  }
}

/** For storage: an approval nobody answered can never be answered later. */
export function settle(parts: Part[]): Part[] {
  return parts.map((p) => (p.kind === "approval" && p.approval.allowed === undefined ? { ...p, approval: { ...p.approval, allowed: false } } : p));
}
