import type { Config } from "../config.js";
import { HaClient } from "./client.js";

export function haFromConfig(config: Config): HaClient {
  return new HaClient({ baseUrl: config.ha.baseUrl, token: config.ha.token });
}
