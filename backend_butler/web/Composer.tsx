import { useEffect, useRef, type RefObject } from "react";
import type { Intent } from "../shared/intent";
import { useAttachments, type PendingImage } from "./attach";
import { AttachButton, AttachTray, CameraInput } from "./AttachTray";
import { IntentPrompt, isPromptKind } from "./IntentPrompt";
import { MicButton, type MicHandle } from "./MicButton";
import { useSlashMenu } from "./slash";
import { SlashMenu } from "./SlashMenu";
import { StopIcon } from "./icons";

interface Props {
  value: string;
  onChange: (value: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  busy: boolean;
  /** Returns false when nothing was sent (empty, or busy), so the photos stay in the tray. */
  onSend: (text: string, images: PendingImage[]) => boolean;
  /** Stop the turn in progress (the Send button becomes Stop while busy; Esc in the box does the same). */
  onStop?: () => void;
  /** From the quick card or widget. field focuses the box; camera/photo/mic/voice show a one-tap prompt; say/draft bring words. */
  intent?: Intent | null;
  onIntentDone?: () => void;
}

/** The message box with its photo tray (above) and `/` skill menu (popup). */
export function Composer({ value, onChange, inputRef, busy, onSend, onStop, intent, onIntentDone }: Props) {
  const attach = useAttachments();
  const pickerRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const micRef = useRef<MicHandle>(null);
  const kind = intent?.kind;
  const prompt = isPromptKind(kind) ? kind : null;
  const done = () => onIntentDone?.();
  const slash = useSlashMenu(value, onChange, inputRef);

  // Grow with the content (capped in CSS).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value, inputRef]);

  // field: no prompt, just put the cursor in the box.
  useEffect(() => {
    if (kind !== "field") return;
    inputRef.current?.focus();
    onIntentDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per intent
  }, [intent]);

  // say/draft (home screen widget): the phone already turned speech into words, which go in the box. draft is done
  // there; say keeps its Send prompt up. Nothing from a link sends itself (see IntentPrompt). No focus: on a phone
  // that raises the keyboard unasked. The ref keeps a StrictMode re-run from adding the words twice.
  const handled = useRef<Intent | null>(null);
  useEffect(() => {
    if (!intent?.text || handled.current === intent) return;
    handled.current = intent;
    onChange(value.trim() ? `${value.trimEnd()} ${intent.text}` : intent.text);
    if (intent.kind === "draft") onIntentDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per intent
  }, [intent]);

  function submit() {
    done();
    if (onSend(value, attach.images)) attach.clear();
  }

  // Voice intent: the transcript is the message. If nothing was sent (busy), keep it in the box instead.
  function sendSpoken(text: string) {
    if (onSend(text, attach.images)) attach.clear();
    else onChange(value.trim() ? `${value.trimEnd()} ${text}` : text);
  }

  // The tap on the prompt button itself must start the camera/picker/mic (browsers require a gesture here).
  function go() {
    if (!prompt) return;
    if (prompt === "say") return submit();
    if (prompt === "camera") return cameraRef.current?.click(); // the prompt stays until a photo arrives: the input must stay mounted
    if (prompt === "photo") pickerRef.current?.click();
    else micRef.current?.start(prompt === "voice" ? "auto" : "review");
    done();
  }

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      // Any other interaction with the composer retires the prompt.
      onPointerDownCapture={(e) => {
        if (prompt && !(e.target as Element).closest?.(".intent-prompt")) done();
      }}
    >
      {prompt && <IntentPrompt kind={prompt} onGo={go} onDismiss={done} />}
      {prompt === "camera" && <CameraInput attach={attach} inputRef={cameraRef} onPicked={done} />}
      <SlashMenu menu={slash} />
      <AttachTray attach={attach} />
      <div className="composer-inner">
        <AttachButton attach={attach} disabled={busy} inputRef={pickerRef} />
        <MicButton
          disabled={busy}
          handle={micRef}
          onText={(text) => onChange(value.trim() ? `${value.trimEnd()} ${text}` : text)}
          onAutoText={sendSpoken}
        />
        <textarea
          ref={inputRef}
          value={value}
          rows={1}
          aria-label="Message"
          placeholder="Ask Butler, or / for skills"
          {...slash.inputProps}
          onFocus={done}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (slash.onKeyDown(e)) return;
            if (e.key === "Escape" && busy && onStop) {
              e.preventDefault();
              onStop();
              return;
            }
            // Enter sends on desktop; on touch keyboards Return inserts a newline and the button sends.
            if (e.key === "Enter" && !e.shiftKey && !window.matchMedia("(pointer: coarse)").matches) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {busy && onStop ? (
          <button type="button" className="ghost stop-button" onClick={onStop} aria-keyshortcuts="Escape">
            <StopIcon />
            Stop
          </button>
        ) : (
          <button type="submit" className="primary" disabled={busy}>
            Send
          </button>
        )}
      </div>
    </form>
  );
}
