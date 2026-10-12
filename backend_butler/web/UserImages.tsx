// Task 19 implements this; Task 24 wired it into Chat.
import { useEffect, useRef, useState } from "react";
import type { Part } from "../shared/transcript";
import { attachmentUrl } from "./api";

interface Props {
  /** null while a fresh chat has no id yet: use `localUrl`. */
  chatId: string | null;
  part: Extract<Part, { kind: "image" }>;
  /** Object URL of a photo sent from this page, shown until the saved copy can be fetched. */
  localUrl?: string;
}

/** A sent photo as a thumbnail in the user's bubble; tap to view full size. */
export function UserImage({ chatId, part, localUrl }: Props) {
  const src = localUrl ?? (chatId ? attachmentUrl(chatId, part.attachmentId) : undefined);
  const [open, setOpen] = useState(false);
  if (!src) return null;
  return (
    <>
      <button type="button" className="user-image" aria-label="View photo" onClick={() => setOpen(true)}>
        <img src={src} alt="Photo you sent" loading="lazy" />
      </button>
      {open && <Viewer src={src} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Full-size view: a modal dialog closed by Esc, a tap on the backdrop, or the close button. */
function Viewer({ src, onClose }: { src: string; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab") {
        // The close button is the only control: keep focus on it.
        e.preventDefault();
        close.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [onClose]);

  return (
    <div className="photo-viewer" role="dialog" aria-modal="true" aria-label="Photo" onClick={onClose}>
      <img src={src} alt="Photo you sent" onClick={(e) => e.stopPropagation()} />
      <button ref={close} type="button" className="photo-close" aria-label="Close photo" onClick={onClose}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
}
