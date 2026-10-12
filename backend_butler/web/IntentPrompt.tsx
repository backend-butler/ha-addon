import type { IntentKind } from "../shared/intent";

/**
 * The kinds that need a tap inside this document: the browser's rule for the camera, picker and mic, and ours for
 * say. Words that arrive in a link are never sent without the user seeing them and tapping Send, or any link
 * (a text message, a web page) could make the agent act.
 */
export type PromptKind = "camera" | "photo" | "mic" | "voice" | "say";

const LABELS: Record<PromptKind, string> = {
  camera: "Take photo",
  photo: "Choose photo",
  mic: "Start recording",
  voice: "Start talking",
  say: "Send",
};

export function isPromptKind(kind: IntentKind | null | undefined): kind is PromptKind {
  return kind != null && kind in LABELS;
}

export function promptLabel(kind: PromptKind): string {
  return LABELS[kind];
}

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

/** One big button above the composer. Its click must itself start the camera/picker/mic (user-gesture rule). */
export function IntentPrompt({ kind, onGo, onDismiss }: { kind: PromptKind; onGo: () => void; onDismiss: () => void }) {
  return (
    <div className="intent-prompt">
      <button type="button" className="intent-prompt-go" onClick={onGo}>
        {promptLabel(kind)}
      </button>
      <button type="button" className="intent-prompt-dismiss" aria-label="Dismiss" onClick={onDismiss}>
        <CloseIcon />
      </button>
    </div>
  );
}
