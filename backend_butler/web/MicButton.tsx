import { useImperativeHandle, useState, type Ref } from "react";
import { micAvailable, useVoice, type VoiceMode } from "./voice";

export { micAvailable };

const MicIcon = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v3" />
  </svg>
);

export const MIC_NEEDS_HTTPS =
  "Voice needs a secure (https) connection. In the Home Assistant app, set this server's Internal URL to its https address.";

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** What the intent prompt calls from its own tap. */
export interface MicHandle {
  start: (mode: VoiceMode) => void;
}

interface Props {
  disabled: boolean;
  /** Review mode: the transcript goes into the message box. */
  onText: (text: string) => void;
  /** Auto mode (intent "voice"): the transcript is sent as it arrives. */
  onAutoText?: (text: string) => void;
  handle?: Ref<MicHandle>;
}

/** Mic toggle. Over plain http the browser has no mic, so a tap explains how to get one. */
export function MicButton({ disabled, onText, onAutoText, handle }: Props) {
  const voice = useVoice((text, mode) => (mode === "auto" && onAutoText ? onAutoText(text) : onText(text)));
  const [httpNote, setHttpNote] = useState(false);
  const available = typeof window !== "undefined" && micAvailable(window);
  useImperativeHandle(
    handle,
    () => ({
      start: (mode) => {
        if (!available) return setHttpNote(true);
        voice.dismiss();
        voice.begin(mode);
      },
    }),
    [available, voice],
  );
  const note = httpNote ? MIC_NEEDS_HTTPS : voice.error;
  if (voice.denied && !voice.error) return null; // denied: explained once, then out of the way

  const recording = voice.state === "recording";
  const busy = voice.state === "starting" || voice.state === "transcribing";
  const label = recording ? "Stop recording" : voice.state === "transcribing" ? "Transcribing" : "Voice input";

  return (
    <>
      <button
        type="button"
        className={`icon-button mic-button${recording ? " recording" : ""}${busy ? " busy" : ""}`}
        aria-label={label}
        aria-pressed={recording}
        title={label}
        disabled={(disabled && !recording) || busy}
        onClick={() => {
          if (!available) return setHttpNote((v) => !v);
          voice.dismiss();
          voice.toggle();
        }}
      >
        {recording ? <span className="mic-time">{clock(voice.seconds)}</span> : <MicIcon />}
      </button>
      {note && (
        <div className="composer-note" role="status">
          <p>{note}</p>
          <button type="button" className="link-button" onClick={() => (setHttpNote(false), voice.dismiss())}>
            Dismiss
          </button>
        </div>
      )}
      {recording && (
        <span className="visually-hidden" role="status">
          Recording. Tap stop when you're done.
        </span>
      )}
    </>
  );
}
