"use client";
// The "Conditions at this camera" grid.
//
// WHY THIS IS A CLIENT COMPONENT ON AN OTHERWISE SERVER-RENDERED PAGE. `/camera/[id]`
// is cached for REGISTRY_TTL_MS and there are ~20k of them. Fetching weather on the
// server would either bake a five-minute-old temperature into a cached page or opt the
// route out of the full route cache entirely — the exact bug lib/seo/registrySnapshot.ts
// exists to fix. Fetching it here means the HTML a crawler gets stays static and the
// numbers a person sees are current.
//
// It asks for one coordinate, so the two requests it makes are the cheapest shape either
// route serves. Both are dormant-safe upstream, and both failures are rendered as an
// absence of a card rather than a zero.

import { useEffect, useState } from "react";
import type { PointWeather } from "@/lib/weather/pointWeather";
import type { AirQuality } from "@/lib/weather/airQuality";
import type { SurfaceReading } from "@/lib/cameras/surface";
import {
  airCard,
  airQualityCard,
  daylightCard,
  rainCard,
  windCard,
  type ConditionCard,
} from "@/lib/cameras/conditionsCards";
import { formatLocalClock, roadClaim, shortAge } from "@/lib/console/widgets/camslot.conditions";

type Load = "pending" | "ok" | "failed";

export function CameraConditions({
  lat,
  lon,
  country,
  surface,
}: {
  lat: number;
  lon: number;
  country: string;
  /** `Camera.surface` straight from the registry, or undefined where none is published. */
  surface?: SurfaceReading;
}) {
  const [weather, setWeather] = useState<PointWeather | undefined>();
  const [air, setAir] = useState<AirQuality | undefined>();
  const [state, setState] = useState<Load>("pending");
  const [readAt, setReadAt] = useState<number | undefined>();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    const points = `${lat.toFixed(2)},${lon.toFixed(2)}`;

    // Settled, not raced: air quality failing must not cost the weather cards, and the
    // page has to be able to tell "the weather service did not answer" (which the road
    // claim words differently) from "the air-quality host did not answer".
    Promise.allSettled([
      fetch(`/api/point-weather?points=${points}&detail=1`).then((r) => r.json()),
      fetch(`/api/air-quality?points=${points}`).then((r) => r.json()),
    ]).then(([w, a]) => {
      if (!live) return;
      const wPoint =
        w.status === "fulfilled" ? (w.value?.points?.[0] as PointWeather | undefined) : undefined;
      const aPoint =
        a.status === "fulfilled" ? (a.value?.points?.[0] as AirQuality | undefined) : undefined;
      setWeather(wPoint);
      setAir(aPoint);
      setReadAt(w.status === "fulfilled" ? (w.value?.observedAt as number | undefined) : undefined);
      setState(wPoint ? "ok" : "failed");
    });

    return () => {
      live = false;
    };
  }, [lat, lon]);

  // Only to keep "read N ago" and the daylight countdown honest while the page is open.
  // One minute, not one second: nothing here moves faster than the model behind it.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const localClock = weather ? formatLocalClock(weather.timeZone, now) : "";
  const cards = [
    airCard(weather),
    windCard(weather),
    rainCard(weather),
    daylightCard(weather, localClock),
    airQualityCard(air, country),
  ].filter(Boolean) as ConditionCard[];

  const claim = roadClaim({
    kind: "camera",
    surface,
    weather,
    pending: state === "pending",
    weatherFailed: state === "failed",
    now,
  });

  const meta =
    state === "pending"
      ? "reading…"
      : state === "failed"
        ? "the weather service did not answer"
        : [
            "Open-Meteo",
            readAt ? `read ${shortAge(now - readAt)} ago` : "",
            weather?.gridKm !== undefined ? `grid point ${weather.gridKm} km away` : "",
          ]
            .filter(Boolean)
            .join(" · ");

  return (
    <section className="tn-cd" aria-labelledby="conditions-heading">
      <div className="tn-cd-head">
        <h2 id="conditions-heading">Conditions at this camera</h2>
        <span className="tn-cd-meta">{meta}</span>
      </div>

      {cards.length > 0 && (
        <div className="tn-cd-grid">
          {cards.map((c) => (
            <div className="tn-cd-card" key={c.key} title={c.title}>
              <span className="tn-cd-label">{c.label}</span>
              <span className="tn-cd-value">{c.value}</span>
              {c.sub && <span className="tn-cd-sub">{c.sub}</span>}
            </div>
          ))}
        </div>
      )}

      {/* The surface card is always rendered, including when there is nothing to say.
          That is the point of it: "not measured" is the answer for ~97% of cameras, and
          leaving the row out would let a reader assume the conditions above describe the
          road. `roadClaim` owns every word in here. */}
      <div className="tn-cd-surface" data-tier={claim.tier} title={claim.title}>
        <span className="tn-cd-label">Road surface</span>
        <p>{surfaceSentence(claim.tier, claim.text, claim.title)}</p>
      </div>
    </section>
  );
}

/**
 * The surface line, as a sentence rather than a tile string.
 *
 * `roadClaim` is built for a narrow console tile, so its `text` is terse ("no data",
 * "Wet · 6 km · 8m") and its `title` carries the explanation. On a page there is room
 * for the explanation itself, so a refusal shows the reason instead of two words a
 * reader would have to hover to understand. A measured reading keeps the terse form,
 * which is the operator's own wording and must not be paraphrased.
 */
function surfaceSentence(tier: string, text: string, title: string): string {
  if (tier === "pending") return "Looking this camera up…";
  if (tier === "measured") return `${text}. ${title}`;
  if (tier === "derived") {
    // A derived line may never contain a surface word — that is enforced upstream in
    // BANNED_IN_DERIVED — so it is shown as what it is: air weather, not a surface state.
    return `Not measured. ${title}`;
  }
  return `Not measured. ${title}`;
}
