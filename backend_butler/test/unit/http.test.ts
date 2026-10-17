import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { BadRequest, INGRESS_PEER, isAllowedPeer, readJson, resolveStatic } from "../../server/http";

describe("isAllowedPeer", () => {
  const allowed = [INGRESS_PEER];
  it("allows the ingress proxy, incl. IPv4-mapped IPv6", () => {
    expect(isAllowedPeer("172.30.32.2", allowed)).toBe(true);
    expect(isAllowedPeer("::ffff:172.30.32.2", allowed)).toBe(true);
  });
  it("refuses everyone else", () => {
    expect(isAllowedPeer("172.30.32.1", allowed)).toBe(false);
    expect(isAllowedPeer("192.168.1.20", allowed)).toBe(false);
    expect(isAllowedPeer(undefined, allowed)).toBe(false);
  });
  it("does not filter in dev mode", () => {
    expect(isAllowedPeer("10.0.0.1", null)).toBe(true);
  });
});

describe("resolveStatic", () => {
  const root = "/app/dist/web";
  it("resolves files inside root", () => {
    expect(resolveStatic(root, "/assets/a.js?v=1")).toBe("/app/dist/web/assets/a.js");
    expect(resolveStatic(root, "/")).toBe("/app/dist/web");
  });
  it("blocks traversal", () => {
    // A leading slash is normalized back inside root; either way nothing outside root is returned.
    expect(resolveStatic(root, "/../../etc/passwd")).toBe("/app/dist/web/etc/passwd");
    expect(resolveStatic(root, "/%2e%2e/%2e%2e/etc/passwd")).toBe("/app/dist/web/etc/passwd");
    expect(resolveStatic(root, "/%E0%A4%A")).toBeNull();
  });
  it("blocks traversal in a request target without a leading slash", () => {
    expect(resolveStatic(root, "../../etc/passwd")).toBeNull();
    expect(resolveStatic(root, "..%2f..%2fetc%2fpasswd")).toBeNull();
  });
});

describe("readJson", () => {
  const req = (body: string) => {
    const r = new PassThrough();
    r.end(body);
    return r as any;
  };
  it("parses an object", async () => expect(await readJson(req('{"a":1}'))).toEqual({ a: 1 }));
  it.each([["not json"], ["null"], ["[1]"], ['"str"']])("rejects %s as a bad request", async (b) => {
    await expect(readJson(req(b))).rejects.toBeInstanceOf(BadRequest);
  });
  it("rejects oversize bodies as a bad request", async () => {
    await expect(readJson(req("x".repeat(100)), 10)).rejects.toBeInstanceOf(BadRequest);
  });
});

describe("page CSP", () => {
  it("allows only this app's scripts plus each inline script by hash, and locks down the rest", async () => {
    const { pageCsp } = await import("../../server/http");
    const { createHash } = await import("node:crypto");
    const body = "\n console.log(1);\n";
    const csp = pageCsp(`<html><script>${body}</script><script type="module" src="./a.js"></script></html>`);
    const hash = createHash("sha256").update(body).digest("base64");
    expect(csp).toContain(`script-src 'self' 'sha256-${hash}'`);
    for (const d of ["object-src 'none'", "base-uri 'none'", "frame-ancestors 'self'", "connect-src 'self'"]) expect(csp).toContain(d);
    expect(csp).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline/);
  });
});
