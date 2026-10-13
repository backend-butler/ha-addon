import { useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { applyEvent, type Message, type Part } from "../shared/transcript";
import { ActivityRow } from "./Activity";
import { toBlocks } from "./transcriptActivity";
import { getChat, sendChat, type StreamEvent } from "./api";
import type { PendingImage } from "./attach";
import { ApprovalCard } from "./ApprovalCard";
import type { Intent } from "../shared/intent";
import { Composer } from "./Composer";
import { hasPendingApproval, STARTERS, workingStatus } from "./chatState";
import { friendlyError } from "./errors";
import { Logo } from "./Logo";
import { safeUrl } from "./safeUrl";
import { UserImage } from "./UserImages";

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

function ErrorNote({ text, onRetry, onEdit }: { text: string; onRetry?: () => void; onEdit?: () => void }) {
  const { text: message, detail } = friendlyError(text);
  return (
    <div className="msg-error" role="alert">
      <p>{message}</p>
      {detail && (
        <details className="msg-error-detail">
          <summary>Details</summary>
          <pre>{detail}</pre>
        </details>
      )}
      {(onRetry || onEdit) && (
        <div className="msg-error-actions">
          {onEdit && (
            <button type="button" className="ghost" onClick={onEdit}>
              Edit message
            </button>
          )}
          {onRetry && (
            <button type="button" className="primary" onClick={onRetry}>
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// A draft survives switching chats, a reload, or HA unmounting the panel; it lives for this browser tab only.
const draftKey = (id: string | null) => `butler:draft:${id ?? "new"}`;
function readDraft(id: string | null): string {
  try {
    return sessionStorage.getItem(draftKey(id)) ?? "";
  } catch {
    return "";
  }
}
function writeDraft(id: string | null, text: string) {
  try {
    if (text.trim()) sessionStorage.setItem(draftKey(id), text);
    else sessionStorage.removeItem(draftKey(id));
  } catch {
    /* storage blocked: drafts are a convenience */
  }
}

const userText = (m: Message | undefined) =>
  m?.parts
    .filter((p): p is Extract<Part, { kind: "text" }> => p.kind === "text")
    .map((p) => p.text)
    .join("\n") ?? "";

export function Chat({ chatId, phone, onCreated, onTurnSaved, onPendingChange, intent, onIntentDone }: Props) {
  // The view is keyed by the conversation, not the id: a fresh chat keeps this instance (and its live stream)
  // when the server assigns its id, so only the initial id decides what to load.
  const [initialId] = useState(chatId);
  const idRef = useRef(chatId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(initialId !== null);
  const [input, setInput] = useState(() => (typeof window === "undefined" ? "" : readDraft(initialId)));
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  /** Indexes of assistant messages the user stopped, so the transcript says so. */
  const [stopped, setStopped] = useState<Set<number>>(new Set());
  const [announce, setAnnounce] = useState("");
  const [alertText, setAlertText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamRef = useRef<AbortController | null>(null);
  /** What the last turn sent, so a failed one can be sent again as it was (photos included). */
  const lastSent = useRef<{ text: string; images: PendingImage[] } | null>(null);
  /** Previews of photos sent from this page, by attachment id, until the saved copies can be fetched. */
  const previews = useRef(new Map<string, string>());
  const inHa = typeof document !== "undefined" && document.documentElement.classList.contains("in-ha");

  // Leaving this chat ends its in-flight turn: the server declines any pending approval and saves the turn,
  // rather than leaving a card nobody can reach until it times out.
  useEffect(() => () => streamRef.current?.abort(), []);

  // Caret ready for a quick command on desktop. Never on a phone: inside HA's app, raising the keyboard
  // unasked pans the whole page, pushing HA's header off screen (seen on an iPhone, 2026-10-07).
  useEffect(() => {
    if (!phone && initialId === null) inputRef.current?.focus({ preventScroll: true });
  }, [phone, initialId]);

  useEffect(() => {
    writeDraft(idRef.current, input);
  }, [input]);

  const pending = hasPendingApproval(messages, busy);
  useEffect(() => {
    onPendingChange(pending);
  }, [pending, onPendingChange]);
  useEffect(() => () => onPendingChange(false), [onPendingChange]);

  // Screen readers: one announcement when a change needs a decision, one when the reply is complete. The transcript
  // itself is not a live region, so streamed text is not read out token by token.
  const last = messages[messages.length - 1];
  const waitingTitle =
    pending && last ? last.parts.find((p): p is Extract<Part, { kind: "approval" }> => p.kind === "approval" && p.approval.allowed === undefined)?.approval.title : undefined;
  useEffect(() => {
    if (waitingTitle) setAlertText(`Butler needs your approval: ${waitingTitle}`);
  }, [waitingTitle]);
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy && last?.role === "assistant") {
      const failed = last.parts.some((p) => p.kind === "error");
      const reply = last.parts.filter((p) => p.kind === "text").map((p) => (p as { text: string }).text).join(" ");
      setAnnounce(failed ? "Butler couldn't finish. See the message for what to do." : reply ? `Butler: ${reply.slice(0, 280)}` : "Butler is done.");
    }
    wasBusy.current = busy;
  }, [busy, last]);

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
    writeDraft(idRef.current, "");
    setInput("");
    setBusy(true);
    setAlertText("");
    lastSent.current = { text, images };
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

  /** Stop the turn in progress. The server ends the agent and saves what it had; a pending change is declined. */
  function stop() {
    const s = streamRef.current;
    if (!s) return;
    s.abort();
    setStopped((prev) => new Set(prev).add(messages.length - 1));
  }

  function retry() {
    const again = lastSent.current ?? { text: userText(messages[messages.length - 2]), images: [] };
    send(again.text, again.images);
  }

  function edit() {
    const text = lastSent.current?.text ?? userText(messages[messages.length - 2]);
    setInput(input.trim() ? `${input.trimEnd()} ${text}` : text);
    const el = inputRef.current;
    el?.focus();
    requestAnimationFrame(() => el?.setSelectionRange(el.value.length, el.value.length));
  }

  function starter(text: string) {
    if (!text.endsWith("…")) return void send(text);
    setInput(`${text.slice(0, -1)} `);
    const el = inputRef.current;
    el?.focus();
    requestAnimationFrame(() => el?.setSelectionRange(el.value.length, el.value.length));
  }

  const fresh = !messages.length && !loading && !loadError;
  // Retry needs something to resend: this page's last turn, or a reopened chat's last text-only message.
  const canResend = (i: number) =>
    !busy && i === messages.length - 1 && (lastSent.current !== null || (!!userText(messages[i - 1]) && !messages[i - 1]?.parts.some((p) => p.kind === "image")));

  return (
    <div className="chat">
      <div className="messages" aria-busy={busy}>
        {loadError && <ErrorNote text={`Couldn’t open this chat: ${loadError}`} />}
        {fresh && (
          <div className="empty">
            <Logo size={44} />
            <h2>Ask about your home, or tell Butler what to change.</h2>
            <p className="empty-trust">
              Lights, switches, fans, climate, media and vacuums act right away. Automations, scripts and everything else
              wait for your OK.
            </p>
            <div className="starters">
              {STARTERS.map((s) => (
                <button key={s} className="starter" onClick={() => starter(s)}>
                  {s}
                </button>
              ))}
            </div>
            <p className="empty-hint">
              Type <kbd>/</kbd> for skills, or add a photo or your voice.
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg msg-${m.role}`}>
            {toBlocks(m.parts, inHa).map((b, j) => {
              if (b.kind === "activity") return <ActivityRow key={j} activity={b.activity} />;
              const p = b.part;
              return p.kind === "text" ? (
                m.role === "assistant" ? (
                  <div key={j} className="text">
                    <Streamdown urlTransform={safeUrl}>{p.text}</Streamdown>
                  </div>
                ) : (
                  <p key={j}>{p.text}</p>
                )
              ) : p.kind === "approval" ? (
                <ApprovalCard key={j} approval={p.approval} />
              ) : p.kind === "image" ? (
                <UserImage key={j} chatId={idRef.current} part={p} localUrl={previews.current.get(p.attachmentId)} />
              ) : p.kind === "error" ? (
                <ErrorNote key={j} text={p.text} {...(canResend(i) ? { onRetry: retry, onEdit: edit } : {})} />
              ) : null;
            })}
            {m.role === "assistant" && stopped.has(i) && <p className="msg-note">Stopped.</p>}
            {m.role === "assistant" && busy && i === messages.length - 1 && <Working parts={m.parts} />}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <p className="visually-hidden" role="status" aria-live="polite">
        {announce}
      </p>
      <p className="visually-hidden" role="alert">
        {alertText}
      </p>
      <Composer
        value={input}
        onChange={setInput}
        inputRef={inputRef}
        busy={busy}
        onSend={send}
        onStop={stop}
        intent={intent}
        onIntentDone={onIntentDone}
      />
    </div>
  );
}
