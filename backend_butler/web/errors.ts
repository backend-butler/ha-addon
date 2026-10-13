/**
 * Turn an error the chat received (a failed request, or an `error` event from the agent) into what the user should
 * read: the problem in plain words and what to do. The original text is kept as `detail` for a disclosure.
 */
export interface FriendlyError {
  text: string;
  detail?: string;
}

const RULES: [RegExp, string][] = [
  [/No Anthropic API key/i, "No Anthropic API key is set. Add one under Settings → Apps → Backend Butler → Configuration, then try again."],
  [/invalid x-api-key|authentication_error|invalid api key/i, "Anthropic rejected the API key. Check it under Settings → Apps → Backend Butler → Configuration."],
  [/credit balance|billing/i, "Your Anthropic account is out of credit. Add credit at console.anthropic.com, then try again."],
  [/rate.?limit|overloaded|\b429\b|\b529\b/i, "Anthropic's API is busy right now. Wait a moment, then try again."],
  [/already answering/i, "This chat is still answering. Wait for it to finish, then try again."],
  [/chat not found/i, "This chat no longer exists. Start a new one."],
  [/Unauthorized|\b401\b|HA websocket error/i, "Home Assistant didn't accept Butler's access. Restart the app; if it keeps happening, check its log."],
  [/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|fetch failed/i, "Butler couldn't reach Home Assistant. Check that Home Assistant is running, then try again."],
  [/Failed to fetch|NetworkError|Load failed|network connection/i, "Couldn't reach Backend Butler. Check your connection, then try again."],
  [/too large/i, "That message is too large to send. Try fewer or smaller photos."],
  [/^Request failed \(5\d\d\)/, "Backend Butler hit a problem. Try again; if it keeps happening, check the app's log in Home Assistant."],
];

/** `Request failed (409) {"error":"…"}` → `…`; anything else unchanged. */
function unwrap(raw: string): string {
  const m = /^Request failed \(\d+\)\s*(\{.*\})\s*$/s.exec(raw);
  if (!m) return raw;
  try {
    const body = JSON.parse(m[1]) as { error?: unknown };
    return typeof body.error === "string" ? body.error : raw;
  } catch {
    return raw;
  }
}

export function friendlyError(raw: string): FriendlyError {
  const message = unwrap(raw.trim());
  for (const [re, text] of RULES) if (re.test(message) || re.test(raw)) return text === message ? { text } : { text, detail: raw };
  return { text: message || "Something went wrong.", ...(message !== raw ? { detail: raw } : {}) };
}
