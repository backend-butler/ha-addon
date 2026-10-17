import { useCallback, useEffect, useRef, useState } from "react";
import { TEXT_KINDS } from "../shared/intent";
import { Chat } from "./Chat";
import { ChatSheet } from "./ChatSheet";
import { ComposeIcon, HistoryIcon, PanelIcon } from "./icons";
import { Sidebar } from "./Sidebar";
import { useChats } from "./useChats";
import { useIntent } from "./useIntent";
import { useLayout } from "./useLayout";

export function App() {
  const chats = useChats();
  const layout = useLayout();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirmGo, setConfirmGo] = useState<(() => void) | null>(null);
  const historyButton = useRef<HTMLButtonElement>(null);
  const { current } = chats;
  const { intent, clear: clearIntent } = useIntent();

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    setConfirmGo(null);
    requestAnimationFrame(() => historyButton.current?.focus());
  }, []);

  // Switching away from a chat whose change awaits approval declines it, so ask first.
  const guard = (go: () => void) => {
    const run = () => {
      setConfirmGo(null);
      go();
      if (sheetOpen) closeSheet();
    };
    if (pending) setConfirmGo(() => run);
    else run();
  };
  // new/say/draft want a fresh chat, so they wait until the open chat is known (else resuming the last chat would
  // land after them). "new" ends here; say/draft carry on to the fresh chat's composer. While a change awaits
  // approval they stay put (switching would decline it) and the words go into this chat's box instead.
  const isText = intent != null && TEXT_KINDS.includes(intent.kind);
  useEffect(() => {
    if (!current || !(isText || intent?.kind === "new")) return;
    if (intent?.kind === "new") clearIntent();
    if (current.id !== null && !pending) chats.startNew();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per intent, or once the open chat is known
  }, [intent, current?.key]);
  const chatIntent =
    !intent || intent.kind === "new"
      ? null
      : !isText || current?.id === null
        ? intent
        : pending
          ? { ...intent, kind: "draft" as const }
          : null; // the fresh chat is on its way

  const confirming = confirmGo ? { onStay: () => setConfirmGo(null), onSwitch: confirmGo } : null;

  const listProps = {
    chats: chats.chats,
    current: current?.id ?? null,
    listState: chats.listState,
    onRetry: () => void chats.refresh(),
    onSelect: chats.select,
    onDelete: chats.remove,
    onArchive: chats.archive,
    guard,
    confirming,
    onNew: chats.startNew,
  };

  const chat = current && (
    <Chat
      key={current.key}
      chatId={current.id}
      phone={layout.phone}
      onCreated={(id) => chats.created(id, current.key)}
      onTurnSaved={() => void chats.refresh()}
      onPendingChange={setPending}
      intent={chatIntent}
      onIntentDone={clearIntent}
    />
  );

  if (layout.phone)
    return (
      <div className="app app-phone">
        <main className="main" inert={sheetOpen}>
          {/* Sits under HA's header, which the app cannot extend: no border, no ☰, same background. */}
          <div className="phonebar">
            <p className="phonebar-title">{current?.id ? chats.title : ""}</p>
            <button
              ref={historyButton}
              className="icon-button phonebar-button"
              aria-label={pending ? "Chats (1 change waiting)" : "Chats"}
              aria-haspopup="dialog"
              aria-expanded={sheetOpen}
              onClick={() => setSheetOpen(true)}
            >
              <HistoryIcon />
              {pending && <span className="dot-badge" aria-hidden="true" />}
            </button>
            <button className="icon-button phonebar-button" aria-label="New chat" onClick={() => guard(chats.startNew)}>
              <ComposeIcon />
            </button>
          </div>
          {chat}
        </main>
        {sheetOpen && <ChatSheet {...listProps} onClose={closeSheet} />}
      </div>
    );

  return (
    <div className="app">
      {layout.open && <Sidebar id="chat-list" {...listProps} />}
      <main className="main">
        <header className="topbar">
          <button
            className="icon-button"
            aria-label={layout.open ? "Hide chats" : "Show chats"}
            aria-expanded={layout.open}
            aria-controls="chat-list"
            onClick={layout.toggle}
          >
            <PanelIcon />
          </button>
          <h1 title={chats.title}>{chats.title}</h1>
        </header>
        {chat}
      </main>
    </div>
  );
}
