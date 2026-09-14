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

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { beaconConfig, beaconOptions, type BeaconConfig } from "@/lib/analytics/beacon";
import { currentTimeZone, isOptedOut, privacySignal, shouldCount } from "@/lib/analytics/optOut";
import { beginVisit } from "@/lib/analytics/returnFlag";
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

export function Beacon(): null {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Init once. The empty dependency list is deliberate: posthog-js installs its own
  // listeners and re-initialising on navigation would double-count.
  useEffect(() => {
    const config = armedConfig();
    if (!config) return;

    let cancelled = false;
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
        // the post-deploy check looks for visit_kind on the FIRST $pageview.
        loaded: (ph) => {
          bindBeacon(ph);
          const props = beginVisit({ registered: ph.get_property("visit_kind"), now: new Date() });
          if (props) ph.register(props);
        },
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // App Router does not fire a page load between client-side navigations, so
  // capture_pageview alone would record the FIRST page of a visit and nothing after.
  // On a site whose whole point is moving between the console and camera pages, that
  // would make every session look one page long — which is the same failure as getting
  // bounce rate wrong, arriving by a different route.
  useEffect(() => {
    if (!pathname) return;
    const config = armedConfig();
    if (!config) return;

    void import("posthog-js").then(({ default: posthog }) => {
      // __loaded is posthog-js's own "init has finished" flag. On the very first render
      // this effect can run before the init effect's promise resolves; capturing then
      // would throw away the event, so skip it — init's own capture_pageview covers
      // that first view.
      if (!posthog.__loaded) return;
      posthog.capture("$pageview");
    });
    // searchParams is included because /app encodes console state in the query string,
    // so a query-only change is a real navigation here, not a no-op.
  }, [pathname, searchParams]);

  return null;
}
