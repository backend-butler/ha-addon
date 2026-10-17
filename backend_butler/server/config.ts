import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { INGRESS_PEER } from "./http.js";

export type Mode = "app" | "dev";

export interface Config {
  mode: Mode;
  port: number;
  host: string;
  /** Peers allowed to connect; null = no filter (dev, loopback-bound). */
  allowedPeers: string[] | null;
  dataDir: string;
  /** The app's public config folder (HA: /addon_configs/<app>/, mounted at /config): skills and household notes. */
  configDir: string;
  /** Skills shipped with the app (read-only); a user skill with the same name overrides one. */
  bundledSkillsDir: string;
  model: string;
  /** Assist pipeline for voice: "auto" or a pipeline id (see stt.ts pickPipeline). */
  sttPipeline: string;
  /** Read lazily so the key is never held in a long-lived log-able object. */
  apiKey: () => string;
  ha: { baseUrl: string; token: () => string };
}

const DEFAULT_MODEL = "claude-sonnet-5-5";

function readTrimmed(path: string): string {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}

function readOptions(): { anthropic_api_key?: string; model?: string; stt_pipeline?: string } {
  try {
    return JSON.parse(readFileSync("/data/options.json", "utf8"));
  } catch {
    return {};
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (env.SUPERVISOR_TOKEN) {
    return {
      mode: "app",
      port: 8099,
      host: "0.0.0.0",
      allowedPeers: [INGRESS_PEER],
      dataDir: "/data",
      configDir: "/config",
      bundledSkillsDir: join(process.cwd(), "skills"),
      model: readOptions().model || DEFAULT_MODEL,
      sttPipeline: readOptions().stt_pipeline?.trim() || "auto",
      apiKey: () => (readOptions().anthropic_api_key ?? "").trim(),
      ha: { baseUrl: "http://supervisor/core", token: () => env.SUPERVISOR_TOKEN ?? "" },
    };
  }
  return {
    mode: "dev",
    port: Number(env.PORT ?? 8099),
    host: env.HOST ?? "127.0.0.1",
    allowedPeers: null,
    dataDir: env.DATA_DIR ?? join(process.cwd(), ".data"),
    configDir: env.CONFIG_DIR ?? join(process.cwd(), ".data", "config"),
    bundledSkillsDir: join(process.cwd(), "skills"),
    model: env.MODEL ?? DEFAULT_MODEL,
    sttPipeline: env.STT_PIPELINE ?? "auto",
    apiKey: () => readTrimmed(env.ANTHROPIC_KEY_FILE ?? join(homedir(), ".anthropic_key")),
    ha: {
      baseUrl: env.HA_URL ?? "http://homeassistant.local:8123",
      token: () => readTrimmed(env.HA_TOKEN_FILE ?? join(homedir(), ".ha_token")),
    },
  };
}
