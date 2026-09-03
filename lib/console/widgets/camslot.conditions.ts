// What a camera tile is allowed to say about the road, the weather and the time.
//
// EVERY STRING THE OVERLAY RENDERS IS BUILT HERE, and nothing here touches React, the
// DOM or the network, so every claim the product makes on a live video frame is decided
// in one pure, node-testable file.
//
// THE RULE THIS FILE EXISTS TO ENFORCE. Two of seventeen camera networks publish a
// measured road-surface state (Estonia, Finland: ~992 of ~18,300 cameras on 2026-09-03).
// For the other ~95% we have air weather and nothing else. Air weather is not a road
// measurement, so for those tiles this file may describe the WEATHER and must never
// describe the SURFACE. That is why `derivedRoad` says "rain 1h" and never "wet", and
// why BANNED_IN_DERIVED is asserted over every derived string by the unit test.
//
// The tier is carried three ways at once — in the data, in the words, and in the colour
// — because colour alone fails for a colour-blind reader and on a washed-out frame.

import type { SurfaceReading } from "@/lib/cameras/surface";
import { surfaceValidity, type SurfaceValidity } from "@/lib/cameras/surface";
import { weatherCodeLabel } from "@/lib/signals/weather";
import { sampledAgeMs, frameBucket } from "@/lib/cameras/freshness";
import type { PointWeather } from "@/lib/weather/pointWeather";

/** Reuses the vocabulary in lib/signals/explain.ts rather than inventing a parallel one:
 *  `measured` = an instrument measured it; `derived` = we computed it from another
 *  layer; `modelled` = a model produced it; plus two absence states. */
export type Tier = "measured" | "derived" | "modelled" | "none" | "pending";

/** What the camera is pointed at, which decides the noun. A Windy webcam on a
 *  pedestrian square has no road in frame, so calling its reading "Road" would
 *  overclaim; "Ground" is true for a plaza and a motorway alike. */
export type PlaceKind = "camera" | "webcam";

export interface Claim {
  tier: Tier;
  /** The noun: "Road" or "Ground". Empty when there is nothing to label. */
  label: string;
  /** The one-line claim, e.g. "Wet · 6 km · 8m" or "rain 1h · from air". */
  text: string;
  /** The full sentence shown on hover. Always explains the basis, and on a refusal
   *  always explains what was refused and why. */
  title: string;
}

/**
 * Words a DERIVED claim may never contain.
 *
 * These describe a surface. They belong only to a measured reading, where they are the
 * operator's own words, not ours. `dry` is banned as well as `wet` and `icy`, because
 * "dry 1h" reads as a verdict on the road rather than a statement about rainfall — which
 * is why the no-precipitation case is worded "no rain 1h".
 */
export const BANNED_IN_DERIVED =
  /\b(dry|wet|damp|moist|icy|ice|snowy|slippery|black ice|safe|unsafe|grip|traction|clear road)\b/i;

/** The marker that makes a derived claim self-describing in eight characters. It names
 *  the BASIS, which a reader can act on, rather than a confidence grade they cannot. */
export const DERIVED_MARK = "from air";

export function placeNoun(kind: PlaceKind): string {
  return kind === "camera" ? "Road" : "Ground";
}

/** "8m", "3h", "45s" — a compact age. */
export function shortAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/** "6 km" when the gap matters, "" when the station is effectively on the spot.
 *  Below 1 km the number is noise; above it, it is the reader's means of disagreeing
 *  with our NEARBY_KM threshold using the same figure we used. */
function stationGap(km: number | undefined): string {
  if (!Number.isFinite(km as number)) return "";
  const v = km as number;
  return v < 1 ? "" : `${v % 1 === 0 ? v : v.toFixed(1)} km`;
}

/**
 * The derived road claim: what the air weather says, worded so it cannot be read as a
 * surface measurement.
 *
 * Open-Meteo's `current` precipitation fields are SUMS OVER THE PRECEDING HOUR, not
 * instantaneous rates, so every phrase says "1h". That is also the more useful datum for
 * a road — rain an hour ago still leaves a wet surface — but the wording has to match
 * the number, whichever way it cuts.
 *
 * Snow outranks rain because Open-Meteo reports them as disjoint components of
 * `precipitation`; both non-zero means sleet, and naming the rarer and more
 * consequential component is the more informative true statement.
 */
export function derivedRoad(pw: PointWeather): { text: string; title: string } | null {
  const { precipMm, rainMm, snowMm, tempC, code } = pw;
  // Absent is not zero. If the upstream told us nothing about precipitation we have no
  // basis at all, and an honest "no data" beats a confident "no rain".
  if (!Number.isFinite(precipMm) && !Number.isFinite(rainMm) && !Number.isFinite(snowMm)) {
    return null;
  }

  let phrase: string;
  if (Number.isFinite(snowMm) && snowMm > 0) phrase = "snow 1h";
  else if (Number.isFinite(rainMm) && rainMm > 0) phrase = "rain 1h";
  else if (Number.isFinite(precipMm) && precipMm > 0) phrase = "precip 1h";
  else if (code === 45 || code === 48) phrase = "fog · no rain 1h";
  else phrase = "no rain 1h";

  const freezing = Number.isFinite(tempC) && tempC <= 0;
  const text = `${phrase}${freezing ? " · ≤0°C" : ""} · ${DERIVED_MARK}`;

  const fell = Number.isFinite(precipMm) ? `${precipMm} mm of precipitation` : "an unreported amount";
  const title =
    `No road-surface measurement is published for this camera. This is derived from the air ` +
    `weather at this point (Open-Meteo model output, not a station reading): ${fell} fell in the ` +
    `preceding hour, air temperature ${Number.isFinite(tempC) ? `${tempC} °C` : "unknown"}. ` +
    `It says nothing about the road surface, and it cannot tell you whether the surface is frozen.`;

  return { text, title };
}

/** Why a measured reading was refused, worded for a human and naming the station.
 *  EXPORTED so camslot.provenance.ts's panel reuses the exact sentence the tile's
 *  tooltip shows. Two surfaces explaining the same refusal in two different sets of
 *  words is how one of them quietly becomes wrong. */
export function refusalTitle(reading: SurfaceReading, why: SurfaceValidity, now: number): string {
  const who = reading.station ? `The nearest road-weather station (${reading.station})` : "The nearest road-weather station";
  const says = `reports ${reading.state}`;
  switch (why) {
    case "far":
      return Number.isFinite(reading.km as number)
        ? `${who} ${says}, but it is ${(reading.km as number).toFixed(1)} km from this camera, so it is not a reading of the road in this picture.`
        : `${who} ${says}, but the operator does not publish how far it is from this camera, so we cannot show it as this road.`;
    case "stale":
      return `${who} ${says}, but the operator has flagged that reading as too old to use (${reading.operatorFlag}).`;
    case "fault":
      return `${who} reports a sensor fault (${reading.operatorFlag}), so it has no usable reading.`;
    case "old": {
      const age = Number.isFinite(reading.observedAt as number)
        ? shortAge(now - (reading.observedAt as number))
        : "over two hours";
      return `${who} ${says}, but that reading is ${age} old — past the two-hour window the operator itself treats as expired.`;
    }
    default:
      return "";
  }
}

export interface ClaimInput {
  kind: PlaceKind | null;
  /** The measured reading for this camera, if its network published one. */
  surface?: SurfaceReading;
  /** Air weather at this camera's coordinate, if we have it. */
  weather?: PointWeather;
  /** True while a directory is still loading and we genuinely do not know yet. */
  pending?: boolean;
  /** True when the weather lookup itself failed. */
  weatherFailed?: boolean;
  /** True when the DIRECTORY that would describe this camera did not load — an
   *  /api/cameras that answered with an error rather than with rows.
   *
   *  Distinct from `pending`, which means we are still asking, and distinct from a
   *  successful lookup that simply found no measurement. Without it a failed request
   *  of ours becomes a statement about what the operator publishes. */
  lookupFailed?: boolean;
  now: number;
}

/**
 * The road/ground claim for one tile — the single decision this whole feature turns on.
 *
 * Order: a usable measured reading wins; otherwise the air weather is described as air
 * weather; otherwise we say "no data". A REFUSED measured reading does not fall through
 * to derived — it reports "no data" and puts the operator's reading and the reason for
 * refusing it in the tooltip. That is a deliberate product decision (Sam, 2026-09-03):
 * refuse rather than substitute. It has one consequence worth knowing, and it is
 * recorded here rather than discovered later — a camera whose station is 12 km away
 * shows LESS than a camera that never had a station at all, because the latter still
 * gets a derived line. Flip the `return none(...)` in the refusal branch to fall through
 * to `derived` if that trade is ever judged the wrong way round.
 */
export function roadClaim(input: ClaimInput): Claim {
  const { kind, surface, weather, pending, weatherFailed, lookupFailed, now } = input;

  if (pending) return { tier: "pending", label: "", text: "…", title: "Still looking this camera up." };

  if (!kind) {
    return {
      tier: "none",
      label: "",
      text: "no data",
      title:
        "We do not know where this stream is, so we cannot say anything about conditions " +
        "there. A YouTube embed is a video, not a place; a webcam added from a live search " +
        "may not be in the cached directory yet.",
    };
  }

  const label = placeNoun(kind);

  if (surface) {
    const why = surfaceValidity(surface, now);
    if (why === "current") {
      const bits = [surface.state, stationGap(surface.km)];
      if (Number.isFinite(surface.observedAt as number)) {
        bits.push(shortAge(now - (surface.observedAt as number)));
      }
      const text = bits.filter(Boolean).join(" · ");
      const temp = Number.isFinite(surface.roadTempC as number)
        ? ` Road surface ${surface.roadTempC} °C.`
        : "";
      return {
        tier: "measured",
        label,
        text,
        title:
          `Measured by a road-weather station${surface.station ? ` (${surface.station})` : ""}` +
          `${stationGap(surface.km) ? `, ${stationGap(surface.km)} away` : ", on this site"}. ` +
          `"${surface.state}" is the operator's own wording, not ours.${temp}`,
      };
    }
    // Refused. Say so, and say what was refused.
    return { tier: "none", label, text: "no data", title: refusalTitle(surface, why, now) };
  }

  // OUR REQUEST FAILED, WHICH IS NOT A FACT ABOUT THE OPERATOR. Checked after the
  // surface block on purpose: a reading we already hold is still a reading, and a
  // stale directory does not erase it. Only when we have nothing does the reason for
  // having nothing matter — and "we could not look it up" and "there is nothing to
  // look up" are different sentences that were being printed as one.
  if (lookupFailed) {
    return {
      tier: "none",
      label,
      text: "no data",
      title:
        "We could not load the camera registry, so we do not know whether a road-surface " +
        "measurement is published for this camera. This is our own lookup failing, not the " +
        "operator reporting nothing.",
    };
  }

  if (weatherFailed || !weather) {
    return {
      tier: "none",
      label,
      text: "no data",
      title: weatherFailed
        ? "The weather service did not answer, so there is nothing to show. Nothing here is a guess."
        : "No road-surface measurement is published for this camera, and we have no weather reading for this point yet.",
    };
  }

  const d = derivedRoad(weather);
  if (!d) {
    return {
      tier: "none",
      label,
      text: "no data",
      title: "The weather service returned no precipitation reading for this point, so there is nothing to derive from.",
    };
  }
  return { tier: "derived", label, ...d };
}

/** The weather chip: "3°C ☁". The condition WORD lives in the tooltip, not the tile —
 *  that is what keeps the first row inside a narrow tile. */
export function weatherChip(pw: PointWeather | undefined): { text: string; title: string } | null {
  if (!pw) return null;
  const { label, glyph } = weatherCodeLabel(pw.code);
  return {
    text: `${Math.round(pw.tempC)}°C ${glyph}`,
    title: `${label}, ${pw.tempC} °C air temperature. Open-Meteo model output for this point — a forecast model, not a station reading.`,
  };
}

/** "14:32" in the camera's own zone. Same Intl call WorldClock.tsx already makes. */
export function formatLocalClock(timeZone: string, now: number): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(now));
  } catch {
    return "";
  }
}

/**
 * "UTC+3", "UTC+5:45".
 *
 * The zone's OFFSET, never its city name. Deriving "Helsinki" from `Europe/Helsinki`
 * would tell a reader that a camera in Oulu is in Helsinki, which is false; an offset
 * implies nothing about where the camera is.
 *
 * Computed from the zone through Intl rather than from the cached `utc_offset_seconds`,
 * because that number is a snapshot and is wrong for up to ten minutes either side of a
 * DST transition. The cached value is the fallback for a runtime whose Intl lacks the
 * zone, which is the only case where a stale offset beats no offset.
 */
export function zoneOffsetLabel(timeZone: string, now: number, fallbackSeconds?: number): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      timeZoneName: "longOffset",
    }).formatToParts(new Date(now));
    const raw = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    // "GMT+03:00" / "GMT+05:45" / "GMT"
    const m = raw.match(/GMT([+-])(\d{2}):(\d{2})/);
    if (!m) return raw === "GMT" ? "UTC" : "";
    const [, sign, hh, mm] = m;
    const h = Number(hh);
    // A zero offset is "UTC", not "UTC+0". Intl reports London in winter as GMT+00:00
    // rather than plain GMT, so this branch is reached in the real world, not just in
    // theory — it was a live string bug until a DST test caught it.
    if (h === 0 && mm === "00") return "UTC";
    return mm === "00" ? `UTC${sign}${h}` : `UTC${sign}${h}:${mm}`;
  } catch {
    if (!Number.isFinite(fallbackSeconds as number)) return "";
    const s = fallbackSeconds as number;
    const sign = s < 0 ? "-" : "+";
    const abs = Math.abs(s);
    const h = Math.floor(abs / 3600);
    const m = Math.round((abs % 3600) / 60);
    return m === 0 ? `UTC${sign}${h}` : `UTC${sign}${h}:${String(m).padStart(2, "0")}`;
  }
}

/**
 * How old the picture is — and, more importantly, WHICH question we are answering.
 *
 * "shot" is the operator's own stamp on the frame. "pulled" is when this browser last
 * requested it, which is all we know for most networks. The two are different claims and
 * they get different verbs, the same way camslot.health.ts says "not answering" rather
 * than "offline". Never let one wear the other's word.
 */
export function frameAge(
  lastSampledAt: string | undefined,
  refreshSeconds: number,
  now: number,
): { text: string; title: string } {
  const sampled = sampledAgeMs(lastSampledAt, now);
  if (sampled !== null && sampled >= 0) {
    return {
      text: `shot ${shortAge(sampled)}`,
      title: `The operator stamped this frame ${shortAge(sampled)} ago.`,
    };
  }
  // frameBucket is what CameraImage already uses to bust the image URL, so the instant
  // it names IS the instant the browser last requested a picture. No extra
  // instrumentation, and it stays a pure derivation.
  const bucketMs = frameBucket(now, refreshSeconds) * refreshSeconds * 1000;
  const age = Math.max(0, now - bucketMs);
  const mins = Math.round(refreshSeconds / 60);
  return {
    text: `pulled ${shortAge(age)}`,
    title:
      `We do not know when this frame was taken — the operator publishes no capture time. ` +
      `${shortAge(age)} ago is when this browser last pulled the picture, and the operator ` +
      `refreshes about every ${mins >= 1 ? `${mins} min` : `${refreshSeconds}s`}, so the frame ` +
      `could be up to that much older again.`,
  };
}

/**
 * How much overlay fits.
 *
 * A pure function of the stage width so the breakpoint is tested rather than eyeballed,
 * and so it can be reasoned about without a browser. `hidden` exists because covering a
 * third of a tiny frame with text serves nobody — below that height the picture is worth
 * more than the caption.
 */
export type Density = "full" | "compact" | "hidden";

export const FULL_MIN_W = 300;
export const FULL_MIN_H = 170;
export const COMPACT_MIN_W = 240;
export const HIDE_BELOW_H = 90;

export function overlayDensity(widthPx: number, heightPx: number): Density {
  if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx)) return "compact";
  if (heightPx < HIDE_BELOW_H) return "hidden";
  if (widthPx >= FULL_MIN_W && heightPx >= FULL_MIN_H) return "full";
  if (widthPx >= COMPACT_MIN_W) return "compact";
  return "compact";
}
