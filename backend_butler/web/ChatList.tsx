import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { ChatSummary } from "../shared/transcript";
import { relativeTime, splitArchived } from "./chatState";
import { ArchiveIcon, TrashIcon } from "./icons";

interface ListProps {
  chats: ChatSummary[];
  current: string | null;
  listState: "loading" | "ready" | "failed";
  onRetry: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onArchive: (id: string, archived: boolean) => Promise<void>;
  /** Sheet "Edit" mode: show every row's actions. */
  editing?: boolean;
  /** Swipe a row left to reveal its actions (touch, in the sheet). */
  swipe?: boolean;
  /** Start with the Archived section open. */
  showArchived?: boolean;
}

/** Shared by the desktop sidebar and the phone sheet. */
export function ChatList({ chats, current, listState, onRetry, onSelect, onDelete, onArchive, editing = false, swipe = false, showArchived = false }: ListProps) {
  const [archivedOpen, setArchivedOpen] = useState(showArchived);
  if (listState === "loading" && !chats.length) return <p className="list-note">Loading chats…</p>;
  if (listState === "failed" && !chats.length)
    return (
      <p className="list-note" role="alert">
        Couldn’t load your chats.{" "}
        <button className="link-button" onClick={onRetry}>
          Try again
        </button>
      </p>
    );
  if (!chats.length) return <p className="list-note">No chats yet. Whatever you ask next starts one.</p>;
  const now = Date.now();
  const { active, archived } = splitArchived(chats);
  const rows = (list: ChatSummary[]) => (
    <ul className={`chat-list${editing ? " editing" : ""}`}>
      {list.map((c) => (
        <ChatRow key={c.id} chat={c} now={now} active={c.id === current} swipe={swipe} onSelect={onSelect} onDelete={onDelete} onArchive={onArchive} />
      ))}
    </ul>
  );
  return (
    <>
      {active.length ? rows(active) : <p className="list-note">No active chats.</p>}
      {archived.length > 0 && (
        <section className="archived" aria-label="Archived chats">
          <button className="archived-toggle" aria-expanded={archivedOpen} onClick={() => setArchivedOpen(!archivedOpen)}>
            Archived ({archived.length})
          </button>
          {archivedOpen && rows(archived)}
        </section>
      )}
    </>
  );
}

const SWIPE_REVEAL = 72;

interface RowProps {
  chat: ChatSummary;
  now: number;
  active: boolean;
  swipe: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onArchive: (id: string, archived: boolean) => Promise<void>;
}

function ChatRow({ chat, now, active, swipe, onSelect, onDelete, onArchive }: RowProps) {
  const isArchived = Boolean(chat.archivedAt);
  const [confirming, setConfirming] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [dx, setDx] = useState(0);
  const drag = useRef<{ x: number; y: number; horizontal: boolean } | null>(null);
  const swiped = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const firstAction = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  useEffect(() => {
    if (revealed) firstAction.current?.focus();
  }, [revealed]);

  /** Immediate, no confirm: an archived chat is one tap from coming back. */
  async function toggleArchive() {
    setArchiving(true);
    setError("");
    try {
      await onArchive(chat.id, !isArchived); // the row moves to the other list on success
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setArchiving(false);
    }
  }

  async function confirm() {
    setDeleting(true);
    setError("");
    try {
      await onDelete(chat.id); // the row disappears on success
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  }

  if (confirming)
    return (
      <li className="chat-row chat-row-confirm">
        <span className="chat-row-question">
          Delete “<span className="chat-row-title">{chat.title}</span>”?
        </span>
        {error && (
          <span className="chat-row-error" role="alert">
            {error}
          </span>
        )}
        <span className="chat-row-actions">
          <button ref={cancelRef} className="ghost" disabled={deleting} onClick={() => (setConfirming(false), setError(""))}>
            Cancel
          </button>
          <button className="danger" disabled={deleting} onClick={() => void confirm()}>
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </span>
      </li>
    );

  // Touch swipe-left past a threshold reveals the row's actions. Vertical movement is left to the browser (touch-action: pan-y).
  const touch = swipe
    ? {
        onPointerDown: (e: PointerEvent) => {
          swiped.current = false;
          if (e.pointerType === "touch") drag.current = { x: e.clientX, y: e.clientY, horizontal: false };
        },
        onPointerMove: (e: PointerEvent) => {
          const d = drag.current;
          if (!d) return;
          const mx = e.clientX - d.x;
          const my = e.clientY - d.y;
          if (!d.horizontal) {
            if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) return void (drag.current = null);
            if (Math.abs(mx) < 10) return;
            d.horizontal = true;
            swiped.current = true;
          }
          setDx(Math.max(-120, Math.min(0, mx)));
        },
        onPointerUp: () => {
          if (drag.current?.horizontal && dx <= -SWIPE_REVEAL) setRevealed(true);
          drag.current = null;
          setDx(0);
        },
        onPointerCancel: () => {
          drag.current = null;
          setDx(0);
        },
      }
    : {};

  return (
    <li className={`chat-row${swipe ? " swipeable" : ""}${revealed ? " revealed" : ""}`} {...touch}>
      {dx < 0 && (
        <span className="chat-row-under" aria-hidden="true">
          {isArchived ? "Delete" : "Archive · Delete"}
        </span>
      )}
      <div className={`chat-row-slide${active ? " current" : ""}`} style={dx ? { transform: `translateX(${dx}px)` } : undefined}>
        <button
          className="chat-row-main"
          aria-current={active ? "page" : undefined}
          title={chat.title}
          onClick={() => {
            if (swiped.current) return void (swiped.current = false); // the tap that ended a swipe is not a selection
            if (revealed) return setRevealed(false); // a tap on a revealed row puts its actions away
            onSelect(chat.id);
          }}
        >
          <span className="chat-row-title">{chat.title}</span>
          <span className="chat-row-time">{relativeTime(chat.updatedAt, now)}</span>
        </button>
        {isArchived ? (
          <button ref={firstAction} className="ghost chat-row-unarchive" aria-label={`Unarchive “${chat.title}”`} disabled={archiving} onClick={() => void toggleArchive()}>
            Unarchive
          </button>
        ) : (
          <button ref={firstAction} className="chat-row-action icon-button" aria-label={`Archive “${chat.title}”`} disabled={archiving} onClick={() => void toggleArchive()}>
            <ArchiveIcon />
          </button>
        )}
        <button className="chat-row-action chat-row-delete icon-button" aria-label={`Delete “${chat.title}”`} onClick={() => setConfirming(true)}>
          <TrashIcon />
        </button>
      </div>
      {error && (
        <span className="chat-row-error" role="alert">
          {error}
        </span>
      )}
    </li>
  );
}
