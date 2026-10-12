import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Chat } from "../../web/Chat";
import { ChatList } from "../../web/ChatList";
import { ChatSheet } from "../../web/ChatSheet";

// Render-only smoke tests (no DOM in this environment): effects do not run, markup must be right.
const chats = [{ id: "a", title: "Evening setup", createdAt: "2026-10-07T10:00:00Z", updatedAt: "2026-10-07T10:00:00Z" }];
const list = { chats, current: "a", listState: "ready" as const, onRetry: vi.fn(), onSelect: vi.fn(), onDelete: vi.fn(), onArchive: vi.fn() };
const stored = { id: "z", title: "Old plan", createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-01T10:00:00Z", archivedAt: "2026-10-07T10:00:00Z" };

describe("UI markup", () => {
  it("a fresh chat shows the logo and the four starters, and the composer is photo, mic, the box and Send", () => {
    const html = renderToStaticMarkup(<Chat chatId={null} phone onCreated={vi.fn()} onTurnSaved={vi.fn()} onPendingChange={vi.fn()} />);
    expect(html).toContain('class="logo"');
    expect(html.match(/class="starter"/g)).toHaveLength(4);
    expect(html).toContain("Create an automation for…");
    expect(html).toMatch(/<div class="composer-inner"><label class="icon-button attach-button".*?<\/label><button type="button" class="icon-button mic-button"[^>]*>.*?<\/button><textarea[^>]*><\/textarea><button type="submit" class="primary">Send<\/button><\/div>/);
  });

  it("the chat list offers a retry when it failed to load", () => {
    const html = renderToStaticMarkup(<ChatList {...list} chats={[]} listState="failed" />);
    expect(html).toContain("Try again");
    expect(html).toContain('role="alert"');
  });

  it("the sheet is a labelled modal dialog with New chat first and a delete per row", () => {
    const html = renderToStaticMarkup(<ChatSheet {...list} onClose={vi.fn()} onNew={vi.fn()} guard={(go) => go()} confirming={null} />);
    expect(html).toMatch(/role="dialog" aria-modal="true" aria-labelledby="sheet-title"/);
    expect(html.indexOf("New chat")).toBeLessThan(html.indexOf("Evening setup"));
    expect(html).toContain('aria-label="Delete “Evening setup”"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain(">Edit<");
    expect(html).toContain('aria-label="Archive “Evening setup”"');
  });

  it("archived chats sit in a collapsed Archived section after the main list", () => {
    const html = renderToStaticMarkup(<ChatList {...list} chats={[...chats, stored]} />);
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>Archived \(1\)<\/button>/);
    expect(html).not.toContain("Old plan");
    expect(html.indexOf("Evening setup")).toBeLessThan(html.indexOf("Archived (1)"));
  });

  it("an open Archived section offers Unarchive on each chat", () => {
    const html = renderToStaticMarkup(<ChatList {...list} chats={[stored]} showArchived />);
    expect(html).toContain("Old plan");
    expect(html).toContain('aria-label="Unarchive “Old plan”"');
    expect(html).toContain("No active chats.");
  });

  it("the sheet shows the switch warning instead of the list while a change is pending", () => {
    const html = renderToStaticMarkup(
      <ChatSheet {...list} onClose={vi.fn()} onNew={vi.fn()} guard={vi.fn()} confirming={{ onStay: vi.fn(), onSwitch: vi.fn() }} />,
    );
    expect(html).toContain("Switching chats declines it");
    expect(html).not.toContain("Evening setup");
  });
});
