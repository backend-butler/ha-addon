import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";

/** The Supervisor's ingress proxy. HA docs: deny every other peer. */
export const INGRESS_PEER = "172.30.32.2";

export function isAllowedPeer(remoteAddress: string | undefined, allowed: string[] | null): boolean {
  if (allowed === null) return true; // dev mode: bound to loopback instead
  if (!remoteAddress) return false;
  const addr = remoteAddress.replace(/^::ffff:/, "");
  return allowed.includes(addr);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

/** Resolve a URL path inside root, or null if it escapes root. */
export function resolveStatic(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }
  const rel = normalize(decoded).replace(/^([/\\])+/, "");
  const full = join(root, rel);
  if (full !== root && !full.startsWith(root.endsWith(sep) ? root : root + sep)) return null;
  return full;
}

/** Sent on every response: no MIME sniffing, and chat links never leak the ingress path as a Referer. */
export const BASE_HEADERS = { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } as const;

/**
 * The page's Content-Security-Policy: scripts only from this app (plus the inline error-box script, by hash), no
 * plugins, no <base> tricks, framed only by HA. Styles stay open: React and the markdown renderer set inline styles.
 */
export function pageCsp(html: string): string {
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    (m) => `'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`,
  );
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(" ")}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ");
}

let cspFor: { file: string; csp: string } | null = null;
function cspOf(file: string): string {
  if (cspFor?.file !== file) cspFor = { file, csp: pageCsp(readFileSync(file, "utf8")) };
  return cspFor.csp;
}

export async function serveStatic(root: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let file = resolveStatic(root, req.url ?? "/");
  if (!file) return sendJson(res, 400, { error: "bad path" });
  const info = await stat(file).catch(() => null);
  if (!info || info.isDirectory()) file = join(root, "index.html"); // SPA fallback
  if (!(await stat(file).catch(() => null))) return sendJson(res, 404, { error: "UI not built (run npm run build)" });
  const page = file.endsWith("index.html");
  res.writeHead(200, {
    ...(page ? { "content-security-policy": cspOf(file) } : {}),
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
    "cache-control": page ? "no-cache" : "private, max-age=31536000, immutable" /* private: CDNs must not serve these past HA auth */,
  });
  // Headers are already sent, so a read error can only cut the response short; never crash the server.
  await pipeline(createReadStream(file), res).catch(() => res.destroy());
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export class BadRequest extends Error {}

/** Parse a JSON body. Throws BadRequest for oversize, non-JSON, or non-object bodies. */
export async function readJson<T>(req: IncomingMessage, maxBytes = 256 * 1024): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new BadRequest("request body too large");
    chunks.push(chunk as Buffer);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new BadRequest("body is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new BadRequest("body must be a JSON object");
  return parsed as T;
}
