"use client";
// Breaking-alert banner — a dismissible strip under the top bar that surfaces ONE
// genuinely significant live event, derived from data we already fetch (a major
// recent USGS earthquake, or a corroborated multi-outlet news cluster). The
// selection is the pure selectBreakingAlert(); if nothing qualifies, this renders
// nothing. Honest by design — never fabricated, and a dismissed alert is
// remembered (alertStore) so it doesn't nag.

import { useEffect, useState } from "react";
import { selectBreakingAlert, type BreakingAlert } from "@/lib/alert";
import { breakingAnnouncement } from "@/components/shell/a11y";
import { alertStore, useDismissedAlert } from "@/lib/shell/alert";
import { mapViewStore } from "@/lib/mapView";
import type { SignalFeature } from "@/lib/signals/types";
import type { NewsPayload } from "@/lib/news";

const POLL_MS = 5 * 60 * 1000;

export default function BreakingBanner() {
  const [alert, setAlert] = useState<BreakingAlert | null>(null);
  const dismissed = useDismissedAlert();

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [qRes, nRes] = await Promise.all([
          fetch("/api/signals/earthquakes").then((r) => r.json()).catch(() => ({ features: [] })),
          fetch("/api/news").then((r) => r.json()).catch(() => ({ items: [] })),
        ]);
        if (!alive) return;
        const quakes = (qRes?.features ?? []) as SignalFeature[];
        const news = ((nRes as NewsPayload)?.items ?? []);
        setAlert(selectBreakingAlert(quakes, news, Date.now()));
      } catch {
        /* dormant-safe */
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // The alert that is actually on screen — null while nothing qualifies, and null
  // again the moment the user dismisses this one.
  const live = alert && dismissed !== alert.key ? alert : null;
  // What the always-present polite region is saying right now ("" = silence).
  const announcement = breakingAnnouncement(live, dismissed);

  const onView = () => {
    if (!live) return;
    if (live.action.type === "fly") {
      mapViewStore.flyToPoint({ lat: live.action.lat, lon: live.action.lon, zoom: 5 });
    } else {
      window.open(live.action.url, "_blank", "noopener,noreferrer");
    }
  };

  // On a 360px-wide band the action button competes with the headline for room, so
  // it shows an abbreviated glyph there (CSS swaps the two spans at <=720px). The
  // accessible name is the full label in both cases — the spans are decorative.
  const viewFull = live?.action.type === "fly" ? "View on map" : "Read article";
  const viewAbbr = live?.action.type === "fly" ? "View" : "Read";

  return (
    <>
      {/* The announcement channel, mounted ALWAYS and empty when there is nothing
          to say. It has to outlive the banner: a live region only announces changes
          that happen while it is already in the accessibility tree, so a banner that
          appears carrying its own role="alert" is announced unreliably — and
          role="alert" is assertive, which interrupts whatever the user was reading
          for something that is, by design, not urgent enough to interrupt for.
          polite + a persistent host is the combination that actually speaks.

          It stays a SEPARATE element from the banner rather than wrapping it, which
          keeps `.tn-alert` a direct sibling of `.tn-cw-shell` — app/globals.css
          reserves the banner's 74px band with `.tn-alert ~ .tn-cw-shell`, and
          wrapping the banner would silently break that selector and drop the whole
          console back under the top bar. Cost: a screen reader reading the page
          linearly hears the headline twice (once here, once in the banner). */}
      <div className="tn-sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="a11y-alert-live">
        {announcement}
      </div>

      {live && (
        <div className={`tn-alert tn-alert-${live.kind}`}>
          <span className="tn-alert-tag">{live.kind === "quake" ? "ALERT" : "BREAKING"}</span>
          <div className="tn-alert-body">
            <span className="tn-alert-text">{live.text}</span>
            <span className="tn-alert-detail">{live.detail}</span>
          </div>
          <button type="button" className="tn-alert-view" onClick={onView} aria-label={viewFull}>
            <span className="tn-alert-view-full" aria-hidden>{viewFull}</span>
            <span className="tn-alert-view-abbr" aria-hidden>{viewAbbr}</span>
          </button>
          <button
            type="button"
            className="tn-alert-dismiss"
            onClick={() => alertStore.dismiss(live.key)}
            aria-label="Dismiss alert"
            title="Dismiss"
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
