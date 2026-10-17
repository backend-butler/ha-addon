import { useEffect, useRef } from "react";

/** Leaving a chat ends its turn, and the server declines a change still waiting for approval. Say so first. */
export function SwitchConfirm({ onStay, onSwitch }: { onStay: () => void; onSwitch: () => void }) {
  const stay = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    stay.current?.focus();
  }, []);
  return (
    <div className="switch-confirm" role="alertdialog" aria-label="Pending change" aria-describedby="switch-confirm-text">
      <p id="switch-confirm-text">A change is waiting for your approval. Switching chats declines it.</p>
      <div className="switch-confirm-actions">
        <button ref={stay} className="ghost" onClick={onStay}>
          Stay
        </button>
        <button className="danger" onClick={onSwitch}>
          Switch and decline
        </button>
      </div>
    </div>
  );
}
