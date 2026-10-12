import { afterEach, describe, expect, it, vi } from "vitest";
import { startSse } from "../../server/sse";

function fakeRes() {
  const writes: string[] = [];
  const handlers: Record<string, () => void> = {};
  const res: any = {
    writableEnded: false,
    writeHead: vi.fn(),
    flushHeaders: vi.fn(),
    write: (s: string) => writes.push(s),
    on: (ev: string, fn: () => void) => (handlers[ev] = fn),
  };
  return { res, writes, close: () => handlers.close?.() };
}

afterEach(() => vi.useRealTimers());

describe("startSse", () => {
  it("frames events as SSE", () => {
    const { res, writes } = fakeRes();
    startSse(res)("text", { delta: "hi" });
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ "content-type": "text/event-stream" }));
    expect(writes).toEqual(['event: text\ndata: {"delta":"hi"}\n\n']);
  });

  it("sends keepalives while open and stops after close", () => {
    vi.useFakeTimers();
    const { res, writes, close } = fakeRes();
    startSse(res);
    vi.advanceTimersByTime(15_000);
    expect(writes).toEqual([": ping\n\n"]);
    close();
    vi.advanceTimersByTime(60_000);
    expect(writes).toHaveLength(1);
  });

  it("drops events after the response ended", () => {
    const { res, writes } = fakeRes();
    const emit = startSse(res);
    res.writableEnded = true;
    emit("text", { delta: "late" });
    expect(writes).toEqual([]);
  });
});
