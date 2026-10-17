import type { ServerResponse } from "node:http";

export type Emit = (event: string, data: unknown) => void;

/** Start an SSE response. Returns an emitter; call res.end() when done. */
export function startSse(res: ServerResponse): Emit {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.flushHeaders();
  // Keepalive so proxies don't time out a quiet stream (e.g. while waiting for approval).
  const timer = setInterval(() => res.write(": ping\n\n"), 15_000);
  res.on("close", () => clearInterval(timer));
  return (event, data) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
}
