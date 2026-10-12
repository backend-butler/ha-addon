import { useEffect, useRef, useState, type ComponentProps, type PointerEvent } from "react";
import { ChatList } from "./ChatList";
import { PlusIcon } from "./icons";
import { SwitchConfirm } from "./SwitchConfirm";

type ListProps = Omit<ComponentProps<typeof ChatList>, "editing" | "swipe">;

interface Props extends ListProps {
  onClose: () => void;
  onNew: () => void;
  /** Run a switch, or ask first when it would decline a pending approval. */
  guard: (go: () => void) => void;
  confirming: { onStay: () => void; onSwitch: () => void } | null;
}

const FOCUSABLE = 'button:not([disabled]), [href], textarea, input, [tabindex]:not([tabindex="-1"])';
const CLOSE_DRAG = 80;

/** Phone chat list: a bottom sheet over the conversation. Mounted only while open. */
export function ChatSheet({ onClose, onNew, guard, confirming, onSelect, ...list }: Props) {
  const sheet = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [dy, setDy] = useState(0);
  const dragFrom = useRef<number | null>(null);

  // Focus moves in, stays in (Tab wraps), and Esc closes. App returns focus to the Chats button.
  useEffect(() => {
    const el = sheet.current;
    if (!el) return;
    el.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab") {
        const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Drag the header down to dismiss.
  const drag = {
    onPointerDown: (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      dragFrom.current = e.clientY;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: PointerEvent) => {
      if (dragFrom.current !== null) setDy(Math.max(0, e.clientY - dragFrom.current));
    },
    onPointerUp: () => {
      if (dragFrom.current === null) return;
      dragFrom.current = null;
      if (dy > CLOSE_DRAG) onClose();
      else setDy(0);
    },
    onPointerCancel: () => {
      dragFrom.current = null;
      setDy(0);
    },
  };

  return (
    <div className="sheet-layer">
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={sheet}
        className={`sheet${dy ? " dragging" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        style={dy ? { transform: `translateY(${dy}px)` } : undefined}
      >
        <div className="sheet-head" {...drag}>
          <span className="sheet-handle" aria-hidden="true" />
          <h2 id="sheet-title">Chats</h2>
          {list.chats.length > 0 && (
            <button className="link-button sheet-edit" aria-pressed={editing} onClick={() => setEditing(!editing)}>
              {editing ? "Done" : "Edit"}
            </button>
          )}
        </div>
        {confirming ? (
          <SwitchConfirm {...confirming} />
        ) : (
          <div className="sheet-body">
            <button className="chat-new" data-autofocus onClick={() => guard(onNew)}>
              <PlusIcon />
              New chat
            </button>
            <ChatList {...list} editing={editing} swipe onSelect={(id) => guard(() => onSelect(id))} />
          </div>
        )}
      </div>
    </div>
  );
}
