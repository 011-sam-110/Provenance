"use client";
// Breaking-alert banner — a dismissible strip under the top bar that surfaces ONE
// genuinely significant live event, derived from data we already fetch (a major
// recent USGS earthquake, or a corroborated multi-outlet news cluster). The
// selection is the pure selectBreakingAlert(); if nothing qualifies, this renders
// nothing. Honest by design — never fabricated, and a dismissed alert is
// remembered (alertStore) so it doesn't nag.

import { useEffect, useState } from "react";
import { selectBreakingAlert, type BreakingAlert } from "@/lib/alert";
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

  if (!alert || dismissed === alert.key) return null;

  const onView = () => {
    if (alert.action.type === "fly") {
      mapViewStore.flyToPoint({ lat: alert.action.lat, lon: alert.action.lon, zoom: 5 });
    } else {
      window.open(alert.action.url, "_blank", "noopener,noreferrer");
    }
  };

  // On a 360px-wide band the action button competes with the headline for room, so
  // it shows an abbreviated glyph there (CSS swaps the two spans at <=720px). The
  // accessible name is the full label in both cases — the spans are decorative.
  const viewFull = alert.action.type === "fly" ? "View on map" : "Read article";
  const viewAbbr = alert.action.type === "fly" ? "View" : "Read";

  return (
    <div className={`tn-alert tn-alert-${alert.kind}`} role="alert">
      <span className="tn-alert-tag">{alert.kind === "quake" ? "ALERT" : "BREAKING"}</span>
      <div className="tn-alert-body">
        <span className="tn-alert-text">{alert.text}</span>
        <span className="tn-alert-detail">{alert.detail}</span>
      </div>
      <button type="button" className="tn-alert-view" onClick={onView} aria-label={viewFull}>
        <span className="tn-alert-view-full" aria-hidden>{viewFull}</span>
        <span className="tn-alert-view-abbr" aria-hidden>{viewAbbr}</span>
      </button>
      <button
        type="button"
        className="tn-alert-dismiss"
        onClick={() => alertStore.dismiss(alert.key)}
        aria-label="Dismiss alert"
        title="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
