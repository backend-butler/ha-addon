import { HaWs } from "./ws.js";
import type { AreaRegistryEntry, DeviceRegistryEntry, EntityRegistryEntry, HaState } from "./types.js";

import { HaError } from "./errors.js";

export { HaError };

export type ConfigKind = "automation" | "script";

export interface HaClientOptions {
  /** e.g. http://supervisor/core or http://homeassistant.local:8123 */
  baseUrl: string;
  token: () => string;
  fetch?: typeof fetch;
  ws?: HaWs;
}

/** Thin, typed wrapper over HA's REST + WebSocket APIs. HA's own error text is preserved. */
export class HaClient {
  private readonly fetch: typeof fetch;
  readonly ws: HaWs;

  constructor(private readonly opts: HaClientOptions) {
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.ws = opts.ws ?? new HaWs(wsUrl(opts.baseUrl), opts.token);
  }

  async rest<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    let text: string;
    try {
      res = await this.fetch(`${this.opts.baseUrl}/api${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.opts.token()}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REST_TIMEOUT_MS),
      });
      text = await res.text();
    } catch (err) {
      throw new HaError(`HA ${method} ${path} ${networkFailure(err)}`);
    }
    if (!res.ok) throw new HaError(`HA ${method} ${path} failed (${res.status}): ${errorText(text)}`, res.status);
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new HaError(`HA ${method} ${path} returned a non-JSON reply (${res.status}): ${text.slice(0, 200)}`, res.status);
    }
  }

  getStates(): Promise<HaState[]> {
    return this.rest("GET", "/states");
  }

  async getState(entityId: string): Promise<HaState | null> {
    try {
      return await this.rest<HaState>("GET", `/states/${encodeURIComponent(entityId)}`);
    } catch (err) {
      if (err instanceof HaError && err.status === 404) return null;
      throw err;
    }
  }

  /** Returns the states HA reports as changed by the call. */
  callService(domain: string, service: string, data: Record<string, unknown>): Promise<HaState[]> {
    return this.rest("POST", `/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`, data);
  }

  async getConfig(kind: ConfigKind, id: string): Promise<Record<string, unknown> | null> {
    try {
      return await this.rest("GET", `/config/${kind}/config/${encodeURIComponent(id)}`);
    } catch (err) {
      if (err instanceof HaError && err.status === 404) return null;
      throw err;
    }
  }

  saveConfig(kind: ConfigKind, id: string, config: Record<string, unknown>): Promise<unknown> {
    return this.rest("POST", `/config/${kind}/config/${encodeURIComponent(id)}`, config);
  }

  deleteConfig(kind: ConfigKind, id: string): Promise<unknown> {
    return this.rest("DELETE", `/config/${kind}/config/${encodeURIComponent(id)}`);
  }

  listEntities(): Promise<EntityRegistryEntry[]> {
    return this.ws.command({ type: "config/entity_registry/list" });
  }

  listDevices(): Promise<DeviceRegistryEntry[]> {
    return this.ws.command({ type: "config/device_registry/list" });
  }

  listAreas(): Promise<AreaRegistryEntry[]> {
    return this.ws.command({ type: "config/area_registry/list" });
  }

  /** HA's own validator. Each key present is checked; result has {valid, error} per key. */
  validateConfig(parts: { triggers?: unknown; conditions?: unknown; actions?: unknown }): Promise<
    Record<string, { valid: boolean; error: string | null }>
  > {
    return this.ws.command({ type: "validate_config", ...parts });
  }
}

export function wsUrl(baseUrl: string): string {
  const u = baseUrl.replace(/^http/, "ws").replace(/\/$/, "");
  // The Supervisor proxy exposes Core's websocket at /core/websocket, not /core/api/websocket.
  return u.endsWith("/core") ? `${u}/websocket` : `${u}/api/websocket`;
}

const REST_TIMEOUT_MS = 30_000;

/** fetch() failures: "fetch failed" hides the real reason in `cause`; timeouts are DOMExceptions. */
function networkFailure(err: unknown): string {
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return `timed out after ${REST_TIMEOUT_MS / 1000}s`;
  }
  const cause = err instanceof Error && err.cause instanceof Error ? `: ${err.cause.message}` : "";
  return `request failed: ${err instanceof Error ? err.message : String(err)}${cause}`;
}

/** HA's reply is usually {"message": "..."}, or plain text for 400s. Never print an object as [object Object]. */
function errorText(body: string): string {
  const raw = body.slice(0, 500) || "(empty response)";
  try {
    const m = (JSON.parse(body) as { message?: unknown } | null)?.message;
    if (typeof m === "string") return m;
    return m === undefined ? raw : JSON.stringify(m).slice(0, 500);
  } catch {
    return raw;
  }
}
