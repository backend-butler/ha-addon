import type { ComponentProps } from "react";
import { ChatList } from "./ChatList";
import { PlusIcon } from "./icons";
import { SwitchConfirm } from "./SwitchConfirm";

interface Props extends Omit<ComponentProps<typeof ChatList>, "editing" | "swipe"> {
  id: string;
  onNew: () => void;
  guard: (go: () => void) => void;
  confirming: { onStay: () => void; onSwitch: () => void } | null;
}

/** Desktop chat list, beside HA's own sidebar. */
export function Sidebar({ id, onNew, guard, confirming, onSelect, ...list }: Props) {
  return (
    <nav id={id} className="sidebar" aria-label="Chats">
      {confirming && <SwitchConfirm {...confirming} />}
      <button className="chat-new" onClick={() => guard(onNew)}>
        <PlusIcon />
        New chat
      </button>
      <ChatList {...list} onSelect={(chatId) => guard(() => onSelect(chatId))} />
    </nav>
  );
}
