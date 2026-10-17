import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Attachments } from "../../web/attach";
import { AttachButton, AttachTray } from "../../web/AttachTray";
import { UserImage } from "../../web/UserImages";

const base: Attachments = { images: [], add: vi.fn(async () => {}), remove: vi.fn(), clear: vi.fn(), error: "" };
const two: Attachments = {
  ...base,
  images: [
    { upload: { id: "aaaaaaaa", mediaType: "image/jpeg", data: "x" }, previewUrl: "blob:a" },
    { upload: { id: "bbbbbbbb", mediaType: "image/jpeg", data: "y" }, previewUrl: "blob:b" },
  ],
};

describe("attach UI markup", () => {
  it("the button is a labelled icon-button wrapping a hidden image file input", () => {
    const html = renderToStaticMarkup(<AttachButton attach={base} disabled={false} />);
    expect(html).toContain("icon-button");
    expect(html).toContain('aria-label="Add photo"');
    expect(html).toContain('type="file"');
    expect(html).toContain('accept="image/*"');
    expect(html).toContain("multiple");
    expect(html).not.toMatch(/\sdisabled/);
  });

  it("the button is disabled while busy", () => {
    expect(renderToStaticMarkup(<AttachButton attach={base} disabled />)).toMatch(/disabled/);
  });

  it("the tray renders nothing when empty and no error", () => {
    expect(renderToStaticMarkup(<AttachTray attach={base} />)).toBe("");
  });

  it("the tray shows numbered thumbnails with remove buttons", () => {
    const html = renderToStaticMarkup(<AttachTray attach={two} />);
    expect(html).toContain('src="blob:a"');
    expect(html).toContain('aria-label="Remove photo 1"');
    expect(html).toContain('aria-label="Remove photo 2"');
  });

  it("the tray shows an error as an alert, even with no photos", () => {
    const html = renderToStaticMarkup(<AttachTray attach={{ ...base, error: "Only photos can be attached." }} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Only photos can be attached.");
  });

  const part = { kind: "image" as const, attachmentId: "aaaaaaaa", mediaType: "image/jpeg" as const };
  it("a user image prefers the local URL and falls back to the saved copy", () => {
    const local = renderToStaticMarkup(<UserImage chatId="c1" part={part} localUrl="blob:z" />);
    expect(local).toContain('src="blob:z"');
    expect(local).toContain('alt="Photo you sent"');
    expect(local).toContain("<button");
    const saved = renderToStaticMarkup(<UserImage chatId="c1" part={part} />);
    expect(saved).toContain("/c1/");
    expect(saved).toContain("aaaaaaaa");
  });

  it("a user image renders nothing without any source", () => {
    expect(renderToStaticMarkup(<UserImage chatId={null} part={part} />)).toBe("");
  });
});
