"use client";
// The "N online" pill in the console header.
//
// IT IS ABSENT, NOT EMPTY, BELOW THE THRESHOLD. `/api/presence` answers
// `online: null` when fewer than PRESENCE_MIN_ONLINE visitors are inside the
// three-minute window, and this renders nothing at all for that — no placeholder,
// no zero, no reserved gap. A pill that said "3 online" would be advertising a
// quiet room, and one that held an empty space would be telling you a number was
// being withheld. The server never sends the small number, so this component
// could not render it even if it wanted to (lib/presence/store.ts).
//
// WHICH MEANS YOU WILL ALMOST NEVER SEE THIS. Above 25 concurrent is a
// Reddit-spike number for this site, not a Tuesday. To confirm it renders, set
// PRESENCE_MIN_ONLINE=1 on a preview deployment — that is what the override is
// for, and it is why the threshold is a env var rather than a constant.

import { useEffect, useState } from "react";

/** How often an open tab says "still here". Comfortably inside the server's
 *  three-minute window, so one dropped request does not drop the visitor out of
 *  the count — two consecutive failures would. */
const BEAT_MS = 45_000;

const KEY = "tn.presence.id.v1";

/**
 * A token for THIS TAB SESSION, and nothing more.
 *
 * `sessionStorage`, not `localStorage` and not a cookie: it dies when the tab
 * does, it is never sent as a header, and it identifies nobody. Its only job is
 * to stop one visitor with the page open being counted as a new person every 45
 * seconds. Two tabs are two "visitors", which is a known and acceptable
 * imprecision — the alternative is a durable identifier, which is the thing
 * worth avoiding here.
 *
 * `crypto.randomUUID` needs a secure context; the fallback keeps the pill
 * working on plain http (a LAN preview) rather than throwing on a page that is
 * otherwise fine.
 */
function tabId(): string | null {
  try {
    const existing = sessionStorage.getItem(KEY);
    if (existing) return existing;
    const fresh =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().replace(/-/g, "")
        : Math.random().toString(36).slice(2).padEnd(16, "0") + Date.now().toString(36);
    sessionStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // Private mode, or site data blocked. No id means no heartbeat, which means
    // this visitor is not counted — a smaller number is the right failure
    // direction for a number shown to the public.
    return null;
  }
}

export default function LivePresence() {
  const [online, setOnline] = useState<number | null>(null);

  useEffect(() => {
    const id = tabId();
    if (!id) return;

    let alive = true;
    const beat = async () => {
      // A HIDDEN TAB DOES NOT COUNT AS SOMEONE USING THE SITE. Skipping the beat
      // while hidden lets a backgrounded tab age out of the window on its own,
      // so the number means "people looking at it" rather than "tabs left open" —
      // and browsers throttle timers in background tabs anyway, so the beat would
      // be unreliable there regardless of what we asked for.
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/presence", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id }),
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { online?: number | null };
        if (alive) setOnline(typeof data.online === "number" ? data.online : null);
      } catch {
        // Dormant-safe, like every other fetch in this app: a failed heartbeat
        // leaves the last known value alone rather than blanking the pill on one
        // flaky request. Two consecutive failures age this tab out server-side,
        // which is the honest outcome.
      }
    };

    void beat();
    const timer = setInterval(() => void beat(), BEAT_MS);
    // Beat immediately on becoming visible again, so a returning tab does not
    // wait up to 45 s to reappear in the count it just dropped out of.
    document.addEventListener("visibilitychange", beat);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
    };
  }, []);

  if (online === null) return null;

  return (
    <span className="tn-presence" title={`${online} people have used the site in the last 3 minutes`}>
      <i className="tn-presence-dot" aria-hidden="true" />
      {online} online
    </span>
  );
}
