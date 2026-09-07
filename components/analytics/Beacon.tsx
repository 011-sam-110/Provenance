"use client";

// The client-side analytics beacon. Renders nothing.
//
// Mounted once in app/layout.tsx. With NEXT_PUBLIC_POSTHOG_KEY unset this component
// short-circuits before the dynamic import, so posthog-js is never fetched, never
// parsed and never runs — a self-hoster with no key pays nothing for it, and the
// network tab shows no third-party request at all.
//
// See lib/analytics/beacon.ts for WHY this exists alongside the access log and why
// persistence is session-scoped rather than absent.

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { beaconConfig, beaconOptions } from "@/lib/analytics/beacon";

export function Beacon(): null {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Init once. The empty dependency list is deliberate: posthog-js installs its own
  // listeners and re-initialising on navigation would double-count.
  useEffect(() => {
    const config = beaconConfig();
    if (!config) return;

    let cancelled = false;
    // Dynamic import so the library lands in its own chunk, fetched only when a key is
    // present. A static import would put it in the main bundle for every visitor of
    // every deployment, configured or not.
    void import("posthog-js").then(({ default: posthog }) => {
      if (cancelled) return;
      posthog.init(config.key, beaconOptions(config));
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
    const config = beaconConfig();
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
