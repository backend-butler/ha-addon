import { useCallback, useEffect, useState } from "react";
import type { ChatSummary } from "../shared/transcript";
import { archiveChat, deleteChat, listChats } from "./api";
import { pickResume } from "./chatState";

/**
 * The open chat. `key` identifies one mounted conversation view: it changes when the user switches or starts
 * fresh, but NOT when a fresh chat gets its id from the server mid-stream (remounting would cut the stream).
 * `id` is null for a fresh chat that has not been saved yet.
 */
export interface Current {
  key: number;
  id: string | null;
}

export function useChats() {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [listState, setListState] = useState<"loading" | "ready" | "failed">("loading");
  const [current, setCurrent] = useState<Current | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await listChats();
      setChats(list);
      setListState("ready");
      return list;
    } catch {
      setListState("failed");
      return null;
    }
  }, []);

  // On open: resume the last-used chat if it was used in the last 2 hours, otherwise start fresh.
  // If the list cannot load, still start fresh: chatting must not depend on the list.
  useEffect(() => {
    void refresh().then((list) => setCurrent({ key: 0, id: list ? pickResume(list, Date.now()) : null }));
  }, [refresh]);

  const select = useCallback((id: string) => setCurrent((c) => (c?.id === id ? c : { key: (c?.key ?? 0) + 1, id })), []);

  /** A fresh, unsaved chat. Already on one? Nothing to do. */
  const startNew = useCallback(() => setCurrent((c) => (c && c.id === null ? c : { key: (c?.key ?? 0) + 1, id: null })), []);

  /** The server created the fresh chat: adopt its id without remounting the view. */
  const created = useCallback((id: string, key: number) => setCurrent((c) => (c?.key === key ? { ...c, id } : c)), []);

  const remove = useCallback(
    async (id: string) => {
      await deleteChat(id); // throws with the server's reason (e.g. 409 while answering)
      setChats((list) => list.filter((c) => c.id !== id));
      setCurrent((c) => (c?.id === id ? { key: c.key + 1, id: null } : c));
    },
    [],
  );

  /** Archive hides a chat from the main list; archiving the open chat starts a fresh one. */
  const archive = useCallback(async (id: string, archived: boolean) => {
    await archiveChat(id, archived); // throws with the server's reason (e.g. 409 while answering)
    const archivedAt = archived ? new Date().toISOString() : undefined;
    setChats((list) => list.map((c) => (c.id === id ? { ...c, archivedAt } : c)));
    if (archived) setCurrent((c) => (c?.id === id ? { key: c.key + 1, id: null } : c));
  }, []);

  const title = current?.id ? (chats.find((c) => c.id === current.id)?.title ?? "") : "New chat";

  return { chats, listState, current, title, refresh, select, startNew, created, remove, archive };
}
