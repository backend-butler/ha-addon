import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { INTENT_KINDS } from "../../shared/intent";
import { Chat } from "../../web/Chat";
import { Composer } from "../../web/Composer";
import { IntentPrompt, isPromptKind, promptLabel } from "../../web/IntentPrompt";

// Render-only (no DOM here): effects do not run, so this checks markup and the pure helpers.
const composer = (intent?: { kind: (typeof INTENT_KINDS)[number]; at: number } | null) =>
  renderToStaticMarkup(<Composer value="" onChange={vi.fn()} inputRef={{ current: null }} busy={false} onSend={vi.fn()} intent={intent} />);

describe("intent prompt", () => {
  it("labels each prompting kind", () => {
    expect(promptLabel("camera")).toBe("Take photo");
    expect(promptLabel("photo")).toBe("Choose photo");
    expect(promptLabel("mic")).toBe("Start recording");
    expect(promptLabel("voice")).toBe("Start talking");
    expect(promptLabel("say")).toBe("Send");
  });

  it("camera, photo, mic, voice and say prompt; words from a link never send without a tap", () => {
    expect(INTENT_KINDS.filter((k) => isPromptKind(k))).toEqual(["camera", "photo", "mic", "voice", "say"]);
    expect(isPromptKind(null)).toBe(false);
  });

  it("renders one big button and a labelled dismiss", () => {
    const html = renderToStaticMarkup(<IntentPrompt kind="voice" onGo={vi.fn()} onDismiss={vi.fn()} />);
    expect(html).toContain("Start talking");
    expect(html).toContain('aria-label="Dismiss"');
    expect(html.match(/<button/g)).toHaveLength(2);
  });

  it.each([
    ["camera", "Take photo"],
    ["photo", "Choose photo"],
    ["mic", "Start recording"],
    ["voice", "Start talking"],
    ["say", "Send"],
  ] as const)("the composer shows the %s prompt", (kind, label) => {
    const html = composer({ kind, at: 1 });
    expect(html).toContain(label);
    expect(html).toContain('aria-label="Dismiss"');
  });

  it("the camera prompt adds a rear-camera input", () => {
    expect(composer({ kind: "camera", at: 1 })).toContain('capture="environment"');
    expect(composer({ kind: "photo", at: 1 })).not.toContain('capture="environment"');
  });

  it("field, new and no intent leave the composer markup alone", () => {
    const plain = composer(null);
    expect(plain).not.toContain("intent-prompt");
    expect(composer(undefined)).toBe(plain);
    expect(composer({ kind: "field", at: 1 })).toBe(plain);
    expect(composer({ kind: "new", at: 1 })).toBe(plain);
  });

  it("Chat passes the intent through to its composer", () => {
    const html = renderToStaticMarkup(
      <Chat chatId={null} phone onCreated={vi.fn()} onTurnSaved={vi.fn()} onPendingChange={vi.fn()} intent={{ kind: "photo", at: 1 }} />,
    );
    expect(html).toContain("Choose photo");
  });
});
