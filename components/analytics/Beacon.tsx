"use client";

// The client-side analytics beacon. Renders nothing.
//
// Mounted once in app/layout.tsx. With NEXT_PUBLIC_POSTHOG_KEY unset this component
// short-circuits before the dynamic import, so posthog-js is never fetched, never
// parsed and never runs — a self-hoster with no key pays nothing for it, and the
// network tab shows no third-party request at all.
//
// WHO IS NOT COUNTED. armedConfig() is the only way to reach posthog-js. It applies
// shouldCount() from lib/analytics/optOut.ts: the /privacy opt-out, Do Not Track,
// Global Privacy Control and a German time zone. Each one stops the IMPORT, so that
// browser loads nothing, sends nothing and gets no visit dates written.
// tests/unit/beacon-config.test.ts fails if an import skips the gate.
//
// See lib/analytics/beacon.ts for WHY this exists alongside the access log and why
// persistence is session-scoped rather than absent, and lib/analytics/returnFlag.ts for
// the one thing that does outlive the tab.

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { PostHog } from "posthog-js";
import { beaconConfig, beaconOptions, navigationPageview, type BeaconConfig } from "@/lib/analytics/beacon";
import { currentTimeZone, isOptedOut, privacySignal, shouldCount } from "@/lib/analytics/optOut";
import { beginVisit, VISIT_EVENT } from "@/lib/analytics/returnFlag";
import { bindBeacon } from "@/lib/analytics/track";

/** The beacon config when THIS browser may be counted, otherwise null. */
function armedConfig(): BeaconConfig | null {
  const config = beaconConfig();
  if (!config) return null;
  const counted = shouldCount({
    configured: true,
    optedOut: isOptedOut(),
    signal: privacySignal(navigator, window as Window & { doNotTrack?: string | null }),
    timeZone: currentTimeZone(),
  });
  return counted ? config : null;
}

/** The slice of posthog-js that counting a visit needs. `loaded` hands over an interface
 *  type and the import hands over the class, and both have these three. */
type VisitClient = Pick<PostHog, "get_property" | "register" | "capture">;

/**
 * Count this browser's visit, at most once per local day. Safe to call often: for a tab
 * that was classified today, the classifier reads one storage key and returns null.
 *
 * It runs at three moments, and each one is the reader doing something: the library has
 * loaded, the page is shown again, the route changes. A tab that sits open and untouched
 * across midnight sends nothing until one of them happens.
 */
function startVisit(ph: VisitClient): void {
  const start = beginVisit({
    registered: ph.get_property("visit_kind"),
    now: new Date(),
    visible: document.visibilityState === "visible",
  });
  if (!start) return;
  // Register first, so the visit event itself carries visit_kind and return_gap.
  ph.register(start.properties);
  if (start.event) ph.capture(VISIT_EVENT, start.event);
}

export function Beacon(): null {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const client = useRef<VisitClient | null>(null);
  const firstRoute = useRef(true);

  // Init once. The empty dependency list is deliberate: posthog-js installs its own
  // listeners and re-initialising on navigation would double-count.
  useEffect(() => {
    const config = armedConfig();
    if (!config) return;

    let cancelled = false;
    // A tab restored in the background is classified when it is first shown, and a tab left
    // open overnight is classified again the first time it is looked at on a new day.
    // pageshow covers a page that comes back from the back/forward cache.
    const onShown = () => {
      if (client.current && document.visibilityState === "visible") startVisit(client.current);
    };
    document.addEventListener("visibilitychange", onShown);
    window.addEventListener("pageshow", onShown);

    // Dynamic import so the library lands in its own chunk, fetched only when a key is
    // present. A static import would put it in the main bundle for every visitor of
    // every deployment, configured or not.
    void import("posthog-js").then(({ default: posthog }) => {
      if (cancelled) return;
      posthog.init(config.key, {
        ...beaconOptions(config),
        // posthog-js 1.428.1 calls `loaded` synchronously inside init and schedules the
        // first $pageview with setTimeout(..., 1) after it (dist/module.js). So what is
        // registered here rides on that first view. An upgrade could change the order:
        // scripts/check-beacon.mjs looks for visit_kind on the FIRST $pageview.
        loaded: (ph) => {
          bindBeacon(ph);
          client.current = ph;
          startVisit(ph);
        },
      });
    });

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onShown);
      window.removeEventListener("pageshow", onShown);
    };
  }, []);

  // App Router does not fire a page load between client-side navigations, so
  // capture_pageview alone would record the FIRST page of a visit and nothing after.
  // On a site whose whole point is moving between the console and camera pages, that
  // would make every session look one page long — which is the same failure as getting
  // bounce rate wrong, arriving by a different route.
  useEffect(() => {
    if (!pathname) return;
    // Read before the import resolves: by then a second route change may have run.
    const first = firstRoute.current;
    firstRoute.current = false;
    const config = armedConfig();
    if (!config) return;

    void import("posthog-js").then(({ default: posthog }) => {
      // The first route is init's own page view, and a route change before init has
      // finished is covered by it too. See navigationPageview() for what went wrong when
      // this effect decided that from __loaded alone.
      if (!navigationPageview({ first, loaded: posthog.__loaded })) return;
      startVisit(posthog);
      posthog.capture("$pageview");
    });
    // searchParams is included because /app encodes console state in the query string,
    // so a query-only change is a real navigation here, not a no-op.
  }, [pathname, searchParams]);

  return null;
}
