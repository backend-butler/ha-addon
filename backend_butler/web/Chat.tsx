import { useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { applyEvent, type Message, type Part } from "../shared/transcript";
import { getChat, sendChat, type StreamEvent } from "./api";
import type { PendingImage } from "./attach";
import { ApprovalCard } from "./ApprovalCard";
import type { Intent } from "../shared/intent";
import { Composer } from "./Composer";
import { hasPendingApproval, STARTERS, workingStatus } from "./chatState";
import { Logo } from "./Logo";
import { safeUrl } from "./safeUrl";
import { UserImage } from "./UserImages";

const shortName = (name: string) => name.replace(/^mcp__ha__/, "").replace(/_/g, " ");

function ToolChip({ part }: { part: Extract<Part, { kind: "tool" }> }) {
  const status = part.result === undefined ? "running" : part.isError ? "failed" : "ok";
  return (
    <details className={`tool tool-${status}`}>
      <summary>
        <span className="tool-dot" aria-hidden="true" />
        <span>{shortName(part.name)}</span>
        <span className="tool-status">{status === "running" ? "running…" : status === "failed" ? "failed" : "done"}</span>
      </summary>
      <pre>{JSON.stringify(part.input, null, 2)}</pre>
      {part.result !== undefined && <pre className="tool-result">{part.result}</pre>}
    </details>
  );
}

interface Props {
  /** null = a fresh chat; the server creates it with the first message and reports its id via onCreated. */
  chatId: string | null;
  phone: boolean;
  onCreated: (id: string) => void;
  onTurnSaved: () => void;
  onPendingChange: (pending: boolean) => void;
  /** Quick-card hand-off, passed through to the composer. */
  intent?: Intent | null;
  onIntentDone?: () => void;
}

/** The three studs from the logo, pulsing in turn, beside what the agent is doing. */
function Working({ parts }: { parts: Part[] }) {
  return (
    <div className="working" role="status">
      <span className="studs" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>{workingStatus(parts)}</span>
    </div>
  );
}

export function Chat({ chatId, phone, onCreated, onTurnSaved, onPendingChange, intent, onIntentDone }: Props) {
  // The view is keyed by the conversation, not the id: a fresh chat keeps this instance (and its live stream)
  // when the server assigns its id, so only the initial id decides what to load.
  const [initialId] = useState(chatId);
  const idRef = useRef(chatId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(initialId !== null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamRef = useRef<AbortController | null>(null);
  /** Previews of photos sent from this page, by attachment id, until the saved copies can be fetched. */
  const previews = useRef(new Map<string, string>());

  // Leaving this chat ends its in-flight turn: the server declines any pending approval and saves the turn,
  // rather than leaving a card nobody can reach until it times out.
  useEffect(() => () => streamRef.current?.abort(), []);

  // Caret ready for a quick command on desktop. Never on a phone: inside HA's app, raising the keyboard
  // unasked pans the whole page, pushing HA's header off screen (seen on an iPhone, 2026-10-07).
  useEffect(() => {
    if (!phone && initialId === null) inputRef.current?.focus({ preventScroll: true });
  }, [phone, initialId]);

  const pending = hasPendingApproval(messages, busy);
  useEffect(() => {
    onPendingChange(pending);
  }, [pending, onPendingChange]);
  useEffect(() => () => onPendingChange(false), [onPendingChange]);

  useEffect(() => {
    if (initialId === null) return;
    let live = true;
    getChat(initialId)
      .then((c) => live && setMessages(c.messages))
      .catch((e) => live && setLoadError(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [initialId]);

  // Braces matter: newer Chrome returns a Promise from scrollIntoView, and an effect must return
  // nothing or a cleanup function, or React crashes calling the Promise on cleanup.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  /** Starts a turn; false when there was nothing to send. */
  function send(raw: string, images: PendingImage[] = []): boolean {
    const text = raw.trim();
    if ((!text && !images.length) || busy) return false;
    void run(text, images);
    return true;
  }

  async function run(text: string, images: PendingImage[]) {
    setInput("");
    setBusy(true);
    for (const i of images) previews.current.set(i.upload.id, i.previewUrl);
    const userParts: Part[] = [
      ...images.map((i): Part => ({ kind: "image", attachmentId: i.upload.id, mediaType: i.upload.mediaType })),
      ...(text ? [{ kind: "text", text } as Part] : []),
    ];
    setMessages((m) => [...m, { role: "user", parts: userParts }, { role: "assistant", parts: [] }]);
    const update = (e: StreamEvent) => {
      if (e.event === "chat") {
        idRef.current = e.data.chatId;
        return onCreated(e.data.chatId);
      }
      if (e.event === "saved") return onTurnSaved();
      setMessages((m) => {
        const last = m[m.length - 1];
        return [...m.slice(0, -1), { ...last, parts: applyEvent(last.parts, e) }];
      });
    };
    const stream = new AbortController();
    streamRef.current = stream;
    try {
      const body = { message: text, chatId: idRef.current, ...(images.length ? { images: images.map((i) => i.upload) } : {}) };
      await sendChat(body, update, stream.signal);
    } catch (err) {
      if (!stream.signal.aborted) update({ event: "error", data: { message: err instanceof Error ? err.message : String(err) } });
    } finally {
      if (streamRef.current === stream) streamRef.current = null;
      setBusy(false);
    }
  }

  function starter(text: string) {
    if (!text.endsWith("…")) return void send(text);
    setInput(`${text.slice(0, -1)} `);
    const el = inputRef.current;
    el?.focus();
    requestAnimationFrame(() => el?.setSelectionRange(el.value.length, el.value.length));
  }

  const fresh = !messages.length && !loading && !loadError;

  return (
    <div className="chat">
      <div className="messages" aria-live="polite" aria-busy={busy}>
        {loadError && (
          <div className="msg msg-error" role="alert">
            Couldn’t open this chat: {loadError}
          </div>
        )}
        {fresh && (
          <div className="empty">
            <Logo size={44} />
            <p>Ask about your home, control devices, or describe an automation.</p>
            <div className="starters">
              {STARTERS.map((s) => (
                <button key={s} className="starter" onClick={() => starter(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg msg-${m.role}`}>
            {m.parts.map((p, j) =>
              p.kind === "text" ? (
                m.role === "assistant" ? (
                  <div key={j} className="text">
                    <Streamdown urlTransform={safeUrl}>{p.text}</Streamdown>
                  </div>
                ) : (
                  <p key={j}>{p.text}</p>
                )
              ) : p.kind === "tool" ? (
                <ToolChip key={j} part={p} />
              ) : p.kind === "approval" ? (
                <ApprovalCard key={j} approval={p.approval} />
              ) : p.kind === "image" ? (
                <UserImage key={j} chatId={idRef.current} part={p} localUrl={previews.current.get(p.attachmentId)} />
              ) : (
                <div key={j} className="msg-error" role="alert">
                  {p.text}
                </div>
              ),
            )}
            {m.role === "assistant" && busy && i === messages.length - 1 && <Working parts={m.parts} />}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <Composer value={input} onChange={setInput} inputRef={inputRef} busy={busy} onSend={send} intent={intent} onIntentDone={onIntentDone} />
    </div>
  );
}
