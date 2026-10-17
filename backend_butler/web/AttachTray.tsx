// Task 19 implements these; Task 24 wired them into Composer.
import type { Ref } from "react";
import type { Attachments } from "./attach";

// Same family as icons.tsx: 24px grid, 2px round strokes, currentColor.
const PhotoIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <circle cx="9" cy="10" r="1.5" />
    <path d="m21 16-5-5-9 9" />
  </svg>
);

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

/** The photo button beside the message box (camera or library). */
export function AttachButton({ attach, disabled, inputRef }: { attach: Attachments; disabled: boolean; inputRef?: Ref<HTMLInputElement> }) {
  return (
    <label className={`icon-button attach-button${disabled ? " disabled" : ""}`} title="Add photo">
      <PhotoIcon />
      <input
        ref={inputRef}
        className="attach-input"
        aria-label="Add photo"
        type="file"
        accept="image/*"
        multiple
        disabled={disabled}
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length) void attach.add(files);
          // Picking the same photo twice in a row must still fire onChange.
          e.target.value = "";
        }}
      />
    </label>
  );
}

/** Hidden rear-camera input for the "Take photo" intent; clicked from the prompt's own tap. */
export function CameraInput({ attach, inputRef, onPicked }: { attach: Attachments; inputRef: Ref<HTMLInputElement>; onPicked?: () => void }) {
  return (
    <input
      ref={inputRef}
      className="attach-input"
      type="file"
      accept="image/*"
      capture="environment"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(e) => {
        const files = e.target.files;
        if (files && files.length) {
          void attach.add(files);
          onPicked?.();
        }
        e.target.value = "";
      }}
    />
  );
}

/** Removable previews above the message box, plus any `attach.error`. */
export function AttachTray({ attach }: { attach: Attachments }) {
  if (!attach.images.length && !attach.error) return null;
  return (
    <div className="attach-tray">
      {attach.images.length > 0 && (
        <ul className="attach-thumbs">
          {attach.images.map((img, i) => (
            <li key={img.upload.id} className="attach-thumb">
              <img src={img.previewUrl} alt={`Photo ${i + 1}`} />
              <button type="button" className="attach-remove" aria-label={`Remove photo ${i + 1}`} onClick={() => attach.remove(img.upload.id)}>
                <span aria-hidden="true">
                  <CloseIcon />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {attach.error && (
        <p className="attach-error" role="alert">
          {attach.error}
        </p>
      )}
    </div>
  );
}
