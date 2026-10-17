import type { AgentEvent, ChatRequest, ChatSummary, Message, SkillSummary } from "../shared/transcript";

export type { AgentEvent };

/** Everything a chat stream can carry: agent events, plus `chat` (a new chat's id, first) and `saved` (last). */
export type StreamEvent = AgentEvent | { event: "chat"; data: { chatId: string } } | { event: "saved"; data: unknown };

/** POST to an SSE endpoint and dispatch each event. Relative URL: works under the ingress prefix. */
export async function postStream(url: string, body: unknown, onEvent: (e: StreamEvent) => void, signal?: AbortSignal) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Request failed (${res.status}) ${detail}`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      let event = "message";
      let data = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (data) onEvent({ event, data: JSON.parse(data) } as StreamEvent);
    }
  }
}

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const detail = await r.json().then((b: { error?: string }) => b.error, () => undefined);
    throw new Error(detail ?? `Request failed (${r.status})`);
  }
  return r.json() as Promise<T>;
}

export const listChats = () => fetch("api/chats").then((r) => json<ChatSummary[]>(r));
export const getChat = (id: string) => fetch(`api/chats/${encodeURIComponent(id)}`).then((r) => json<ChatSummary & { messages: Message[] }>(r));
export const deleteChat = (id: string) => fetch(`api/chats/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => json<{ ok: true }>(r));
export const archiveChat = (id: string, archived: boolean) =>
  fetch(`api/chats/${encodeURIComponent(id)}/archive`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ archived }),
  }).then((r) => json<{ ok: true; archived: boolean }>(r));

/** One chat turn as an SSE stream (see postStream). */
export const sendChat = (body: ChatRequest, onEvent: (e: StreamEvent) => void, signal?: AbortSignal) =>
  postStream("api/chat", body, onEvent, signal);
export const listSkills = () => fetch("api/skills").then((r) => json<SkillSummary[]>(r));
export const attachmentUrl = (chatId: string, attachmentId: string) =>
  `api/chats/${encodeURIComponent(chatId)}/attachments/${encodeURIComponent(attachmentId)}`;
/** 16 kHz mono 16-bit PCM in, HA's transcript out. */
export const transcribe = (pcm: Int16Array<ArrayBuffer>) =>
  fetch("api/stt", { method: "POST", headers: { "content-type": "application/octet-stream" }, body: pcm }).then((r) =>
    json<{ text: string }>(r),
  );
