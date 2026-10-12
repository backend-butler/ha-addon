/**
 * Card → panel hand-off. The Lovelace card and the Butler panel share HA's origin (ingress), so the card leaves an
 * intent in localStorage and navigates; the panel takes it once, if fresh.
 */
export const INTENT_KEY = "backend-butler.intent";
/** Older than this, a tap is not what the user is doing now (e.g. a panel opened days later). */
export const INTENT_FRESH_MS = 30_000;

/**
 * field = focus the box · camera/photo/mic = one-tap prompt · voice = mic that sends itself · new = fresh chat ·
 * say = send `text` in a fresh chat · draft = put `text` in a fresh chat's box. say/draft come from the home screen
 * widget, which dictates on the phone and passes the words in the link.
 */
export const INTENT_KINDS = ["field", "camera", "photo", "mic", "voice", "new", "say", "draft"] as const;
export type IntentKind = (typeof INTENT_KINDS)[number];
/** Kinds that carry words and open a fresh chat. */
export const TEXT_KINDS: readonly IntentKind[] = ["say", "draft"];
/** Longer than any dictation; keeps a link from stuffing the box. */
export const MAX_INTENT_TEXT = 4000;

export interface Intent {
  kind: IntentKind;
  at: number;
  text?: string;
}

/** Query parameters a link uses: `?butler=<kind>` and, for say/draft, `&text=<words>`. */
export const LINK_PARAMS = ["butler", "text"] as const;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function isIntentKind(v: unknown): v is IntentKind {
  return typeof v === "string" && (INTENT_KINDS as readonly string[]).includes(v);
}

export function writeIntent(store: Store, kind: IntentKind, now = Date.now()): void {
  try {
    store.setItem(INTENT_KEY, JSON.stringify({ kind, at: now } satisfies Intent));
  } catch {
    // storage blocked: the panel still opens, just without the intent
  }
}

/** Remove first, then validate: an intent is used at most once, even if it is stale or malformed. */
export function takeIntent(store: Store, now = Date.now()): Intent | null {
  let raw: string | null;
  try {
    raw = store.getItem(INTENT_KEY);
    if (raw === null) return null;
    store.removeItem(INTENT_KEY);
  } catch {
    return null;
  }
  try {
    const v = JSON.parse(raw) as Partial<Intent>;
    // say/draft only come from links: the card never writes words.
    if (!isIntentKind(v.kind) || TEXT_KINDS.includes(v.kind) || typeof v.at !== "number") return null;
    const age = now - v.at;
    return age >= 0 && age <= INTENT_FRESH_MS ? { kind: v.kind, at: v.at } : null;
  } catch {
    return null;
  }
}

/**
 * The intent in a link such as `homeassistant://navigate/local_backend_butler?butler=say&text=…` (the home screen
 * widget). The HA app keeps the query on the page that hosts this panel. say/draft need words; others ignore text.
 */
export function parseLinkIntent(search: string, now = Date.now()): Intent | null {
  const q = new URLSearchParams(search);
  const kind = q.get("butler");
  if (!isIntentKind(kind)) return null;
  if (!TEXT_KINDS.includes(kind)) return { kind, at: now };
  const text = (q.get("text") ?? "").trim().slice(0, MAX_INTENT_TEXT);
  return text ? { kind, at: now, text } : null;
}

/** `search` without the link parameters, so a reload does not repeat the action. "" when nothing else is left. */
export function stripLinkParams(search: string): string {
  const q = new URLSearchParams(search);
  for (const p of LINK_PARAMS) q.delete(p);
  const rest = q.toString();
  return rest ? `?${rest}` : "";
}
