import { useCallback, useEffect, useState } from "react";
import { INTENT_KEY, parseLinkIntent, stripLinkParams, takeIntent, type Intent } from "../shared/intent";

/**
 * HA's page that hosts this ingress iframe. Same origin, so its URL is readable; null if that ever stops being true.
 * A link like `homeassistant://navigate/local_backend_butler?butler=say&text=…` lands its query there, not here.
 */
function hostWindow(): Window | null {
  try {
    void window.parent.location.search;
    return window.parent;
  } catch {
    return null;
  }
}

/** The link's intent, removed from the host URL straight away so a reload or back does not repeat it. */
function takeLinkIntent(host: Window): Intent | null {
  const { search, pathname, hash } = host.location;
  const got = parseLinkIntent(search);
  if (search.includes("butler=")) {
    try {
      host.history.replaceState(host.history.state, "", `${pathname}${stripLinkParams(search)}${hash}`);
    } catch {
      // cannot rewrite the URL: the intent still runs once in this page
    }
  }
  return got;
}

/**
 * The intent for this panel: from a home screen link (the host URL's query) or from the quick card (localStorage).
 * Taken once on mount, and again when either arrives while the panel is already open: HA fires `location-changed`
 * on its window when it navigates in place, and `storage` fires here when the card writes from HA's top document.
 */
export function useIntent(): { intent: Intent | null; clear: () => void } {
  const [intent, setIntent] = useState<Intent | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const host = hostWindow();
    // HA may keep this panel alive while the user moves on: only links to this panel's own page count.
    const panelPath = host?.location.pathname;
    // Never overwrite with null: StrictMode mounts twice and the second take finds the intent already consumed.
    const take = () => {
      const got = (host && takeLinkIntent(host)) || takeIntent(window.localStorage);
      if (got) setIntent(got);
    };
    take();
    const onStorage = (e: StorageEvent) => {
      if (e.key === INTENT_KEY) take();
    };
    const onNavigate = () => {
      const got = host && host.location.pathname === panelPath && takeLinkIntent(host);
      if (got) setIntent(got);
    };
    window.addEventListener("storage", onStorage);
    host?.addEventListener("location-changed", onNavigate);
    host?.addEventListener("popstate", onNavigate);
    return () => {
      window.removeEventListener("storage", onStorage);
      host?.removeEventListener("location-changed", onNavigate);
      host?.removeEventListener("popstate", onNavigate);
    };
  }, []);

  const clear = useCallback(() => setIntent(null), []);
  return { intent, clear };
}
