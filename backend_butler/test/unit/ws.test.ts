import { afterEach, describe, expect, it, vi } from "vitest";
import { HaWs } from "../../server/ha/ws";

/** Scriptable stand-in for the global WebSocket. */
class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket;
  readyState = 0;
  sent: any[] = [];
  onmessage?: (ev: { data: string }) => void;
  onerror?: () => void;
  onclose?: () => void;
  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  send(s: string) {
    this.sent.push(JSON.parse(s));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  recv(m: unknown) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}

const real = globalThis.WebSocket;
afterEach(() => {
  globalThis.WebSocket = real;
  vi.useRealTimers();
});

function connect() {
  globalThis.WebSocket = FakeSocket as any;
  const ws = new HaWs("ws://ha/api/websocket", () => "tok");
  return ws;
}

describe("HaWs", () => {
  it("authenticates, then resolves results by id", async () => {
    const ws = connect();
    const p = ws.command({ type: "config/area_registry/list" });
    const sock = FakeSocket.last;
    sock.readyState = 1;
    sock.recv({ type: "auth_required" });
    expect(sock.sent[0]).toEqual({ type: "auth", access_token: "tok" });
    sock.recv({ type: "auth_ok" });
    await vi.waitFor(() => expect(sock.sent.length).toBe(2));
    sock.recv({ type: "result", id: sock.sent[1].id, success: true, result: [{ area_id: "office" }] });
    expect(await p).toEqual([{ area_id: "office" }]);
  });

  it("rejects when auth is invalid", async () => {
    const ws = connect();
    const p = ws.command({ type: "x" });
    FakeSocket.last.recv({ type: "auth_invalid", message: "Invalid access token" });
    await expect(p).rejects.toThrow(/auth failed: Invalid access token/);
  });

  it("surfaces HA's error message", async () => {
    const ws = connect();
    const p = ws.command({ type: "validate_config" });
    const sock = FakeSocket.last;
    sock.readyState = 1;
    sock.recv({ type: "auth_ok" });
    await vi.waitFor(() => expect(sock.sent.length).toBe(1));
    sock.recv({ type: "result", id: sock.sent[0].id, success: false, error: { message: "Unknown command." } });
    await expect(p).rejects.toThrow(/Unknown command/);
  });

  it("rejects pending commands when the socket closes, and reconnects next time", async () => {
    const ws = connect();
    const p = ws.command({ type: "x" });
    const first = FakeSocket.last;
    first.readyState = 1;
    first.recv({ type: "auth_ok" });
    await vi.waitFor(() => expect(first.sent.length).toBe(1));
    first.close();
    await expect(p).rejects.toThrow(/closed/);
    void ws.command({ type: "y" }).catch(() => {});
    expect(FakeSocket.last).not.toBe(first);
  });

  it("times out a command HA never answers", async () => {
    vi.useFakeTimers();
    const ws = connect();
    const p = ws.command({ type: "slow" }, 1000);
    const sock = FakeSocket.last;
    sock.readyState = 1;
    sock.recv({ type: "auth_ok" });
    const assertion = expect(p).rejects.toThrow(/timed out/); // attach before the timer fires
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
  });
});

describe("HaWs connection sharing", () => {
  it("concurrent commands on a cold start share one socket", async () => {
    globalThis.WebSocket = FakeSocket as any;
    let opened = 0;
    const Counting = class extends FakeSocket {
      constructor(url: string) {
        super(url);
        opened++;
      }
    };
    globalThis.WebSocket = Counting as any;
    const ws = new HaWs("ws://ha/api/websocket", () => "tok");
    const ps = [ws.command({ type: "a" }), ws.command({ type: "b" }), ws.command({ type: "c" })];
    const sock = FakeSocket.last;
    sock.recv({ type: "auth_ok" });
    await vi.waitFor(() => expect(sock.sent.length).toBe(3));
    for (const m of sock.sent) sock.recv({ type: "result", id: m.id, success: true, result: m.type });
    expect(await Promise.all(ps)).toEqual(["a", "b", "c"]);
    expect(opened).toBe(1);
  });

  it("a dead old socket cannot fail commands on its replacement", async () => {
    const ws = connect();
    const p1 = ws.command({ type: "x" });
    const old = FakeSocket.last;
    old.recv({ type: "auth_ok" });
    await vi.waitFor(() => expect(old.sent.length).toBe(1));
    old.close();
    await expect(p1).rejects.toThrow(/closed/);

    const p2 = ws.command({ type: "y" });
    const fresh = FakeSocket.last;
    expect(fresh).not.toBe(old);
    fresh.recv({ type: "auth_ok" });
    await vi.waitFor(() => expect(fresh.sent.length).toBe(1));
    old.onclose?.(); // late duplicate close from the old socket
    fresh.recv({ type: "result", id: fresh.sent[0].id, success: true, result: "ok" });
    expect(await p2).toBe("ok");
    void ws.command({ type: "z" }).catch(() => {});
    expect(FakeSocket.last).toBe(fresh); // the stale close must not discard the live connection
  });

  it("times out a connection that never authenticates, then retries fresh", async () => {
    vi.useFakeTimers();
    globalThis.WebSocket = FakeSocket as any;
    const ws = new HaWs("ws://ha/api/websocket", () => "tok", 500);
    const p = ws.command({ type: "x" });
    const first = FakeSocket.last;
    const assertion = expect(p).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(501);
    await assertion;
    void ws.command({ type: "y" }).catch(() => {});
    expect(FakeSocket.last).not.toBe(first);
  });
});

describe("HaWs error text", () => {
  it("includes HA's error code with its message", async () => {
    const ws = connect();
    const p = ws.command({ type: "validate_config" });
    const sock = FakeSocket.last;
    sock.readyState = 1;
    sock.recv({ type: "auth_ok" });
    await vi.waitFor(() => expect(sock.sent.length).toBe(1));
    sock.recv({ type: "result", id: sock.sent[0].id, success: false, error: { code: "invalid_format", message: "extra keys not allowed" } });
    await expect(p).rejects.toThrow(/invalid_format.*extra keys not allowed/);
  });

  it("never prints undefined for an auth_invalid without a message", async () => {
    const ws = connect();
    const p = ws.command({ type: "x" });
    FakeSocket.last.recv({ type: "auth_invalid" });
    const err: any = await p.catch((e) => e);
    expect(err.message).toMatch(/auth failed/);
    expect(err.message).not.toContain("undefined");
  });

  it("a failed connection reports the url", async () => {
    const ws = connect();
    const p = ws.command({ type: "x" });
    FakeSocket.last.onerror?.();
    await expect(p).rejects.toThrow(/connection to ws:\/\/ha\/api\/websocket failed/);
  });

  it("a send on a dead socket rejects with HA-style text", async () => {
    const ws = connect();
    const p = ws.command({ type: "x" });
    const sock = FakeSocket.last;
    sock.send = (s: string) => {
      if (JSON.parse(s).type === "x") throw new Error("socket is closed");
    };
    sock.recv({ type: "auth_ok" });
    const err: any = await p.catch((e) => e);
    expect(err.message).toContain("socket is closed");
  });
});
