import { HaError } from "./errors.js";

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

/** One socket, its auth handshake, and the commands sent on it. */
interface Connection {
  ws: WebSocket;
  ready: Promise<void>;
  pending: Map<number, Pending>;
}

/**
 * Minimal HA WebSocket command client. Concurrent callers share one in-flight connection; a closed
 * connection only fails its own pending commands, and the next command reconnects.
 */
export class HaWs {
  private conn: Connection | null = null;
  private nextId = 1;

  constructor(
    private readonly url: string,
    private readonly token: () => string,
    private readonly connectTimeoutMs = 10_000,
  ) {}

  async command<T>(msg: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
    const conn = this.connect();
    await conn.ready;
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        conn.pending.delete(id);
        reject(new HaError(`HA websocket ${String(msg.type)} timed out`));
      }, timeoutMs);
      conn.pending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v as T)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      try {
        conn.ws.send(JSON.stringify({ ...msg, id }));
      } catch (err) {
        const p = conn.pending.get(id);
        conn.pending.delete(id);
        p?.reject(new HaError(`HA websocket send failed: ${err instanceof Error ? err.message : String(err)}`));
      }
    });
  }

  close(): void {
    this.conn?.ws.close();
  }

  private connect(): Connection {
    if (this.conn) return this.conn;
    const ws = new WebSocket(this.url);
    const pending = new Map<number, Pending>();
    const conn: Connection = { ws, pending, ready: Promise.resolve() };
    const drop = () => {
      if (this.conn === conn) this.conn = null;
    };
    conn.ready = new Promise<void>((resolve, reject) => {
      const fail = (e: HaError) => {
        clearTimeout(timer);
        drop();
        reject(e);
      };
      const timer = setTimeout(() => {
        fail(new HaError(`HA websocket connection to ${this.url} timed out`));
        ws.close();
      }, this.connectTimeoutMs);
      ws.onmessage = (ev) => {
        const m = JSON.parse(String(ev.data));
        if (m.type === "auth_required") ws.send(JSON.stringify({ type: "auth", access_token: this.token() }));
        else if (m.type === "auth_ok") (clearTimeout(timer), resolve());
        else if (m.type === "auth_invalid") (fail(new HaError(`HA websocket auth failed: ${m.message ?? "invalid access token"}`)), ws.close());
        else if (m.type === "result") {
          const p = pending.get(m.id);
          if (!p) return;
          pending.delete(m.id);
          if (m.success) p.resolve(m.result);
          else p.reject(new HaError(`HA websocket error: ${wsErrorText(m.error)}`));
        }
      };
      ws.onerror = () => fail(new HaError(`HA websocket connection to ${this.url} failed`));
      ws.onclose = () => {
        fail(new HaError("HA websocket closed")); // no-op if already authenticated
        for (const p of pending.values()) p.reject(new HaError("HA websocket closed"));
        pending.clear();
      };
    });
    this.conn = conn;
    return conn;
  }
}

/** HA's result frame carries {code, message}; keep both, and never lose an error that has no message. */
function wsErrorText(error: { code?: unknown; message?: unknown } | undefined): string {
  if (!error) return "(no error detail)";
  const msg = typeof error.message === "string" ? error.message : JSON.stringify(error);
  return typeof error.code === "string" && error.code !== "unknown_error" ? `${error.code}: ${msg}` : msg;
}
