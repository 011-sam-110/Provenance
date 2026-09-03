// The evidence behind one tile's claim — everything the corner overlay could not fit,
// assembled for the focus view.
//
// WHY THIS IS A SEPARATE MODULE FROM camslot.conditions.ts. That file decides what may
// be SAID. This one decides what may be SHOWN as the basis for saying it. They are
// different jobs with different rules, and the difference matters most in the one case
// this panel exists for:
//
//   THE TILE REFUSES A DISQUALIFIED READING. THE PANEL DISCLOSES IT.
//
// A station 12 km away is not a reading of the road in the picture, so `roadClaim`
// returns "no data" and nothing on the wall asserts it. That is a decision about what
// we are willing to claim. It is NOT a decision to pretend the reading does not exist —
// hiding the evidence would leave a user unable to tell "nobody measures this road"
// apart from "somebody measures it and we did not like the number". So `refused` carries
// the operator's own words, the reason, and — the part that makes it actionable — WHOSE
// rule refused it. A reader who thinks 10 km is too strict can disagree with us using
// the same figure we used, and a reader looking at a stale flag can see that the
// operator, not us, called it stale.
//
// Everything here is pure and node-tested. It renders nothing and reads no store.

import {
  roadClaim,
  refusalTitle,
  shortAge,
  frameAge,
  type Claim,
  type PlaceKind,
} from "@/lib/console/widgets/camslot.conditions";
import {
  surfaceValidity,
  humaniseOperatorCode,
  MEASURED_MAX_AGE_MS,
  NEARBY_KM,
  type SurfaceReading,
  type SurfaceValidity,
} from "@/lib/cameras/surface";
import { weatherCodeLabel, OPEN_METEO_ATTRIBUTION } from "@/lib/signals/weather";
import type { PointWeather } from "@/lib/weather/pointWeather";

/** The canonical Open-Meteo credit. Re-exported rather than retyped, so the panel and
 *  the world-cities weather layer can never end up crediting it differently. */
export const OPEN_METEO_CREDIT = OPEN_METEO_ATTRIBUTION;

export interface ProvenanceInput {
  kind: PlaceKind | null;
  surface?: SurfaceReading;
  weather?: PointWeather;
  pending?: boolean;
  weatherFailed?: boolean;
  /** True when the camera registry itself did not load. See ClaimInput.lookupFailed. */
  lookupFailed?: boolean;
  /** The operator's own capture stamp for the frame on screen, where it publishes one. */
  lastSampledAt?: string;
  /** How often this stream's operator republishes, used to bound an unstamped frame. */
  refreshSeconds: number;
  now: number;
}

/** One line of evidence. `note` is the sentence under it, and exists to say what a
 *  number means rather than to repeat it. */
export interface ProvenanceRow {
  term: string;
  value: string;
  note?: string;
}

export interface RefusedReading {
  /** The operator's own state word, verbatim. Never mapped, never graded. */
  state: string;
  why: SurfaceValidity;
  /**
   * Whose rule kept this off the tile.
   *
   * `operator` — the network itself declared the reading unusable, or published the
   * threshold we are applying. `ours` — our own judgement call, which is the case a
   * reader is entitled to argue with.
   */
  ruleOwner: "operator" | "ours";
  /** The same sentence the tile's tooltip shows, so the two cannot drift apart. */
  reason: string;
  /** The rule in figures, e.g. "our 10 km limit". */
  rule: string;
}

export interface ProvenanceReport {
  /** The claim exactly as the tile makes it — the same function, not a second opinion. */
  claim: Claim;
  rows: ProvenanceRow[];
  /** Non-null only when a measured reading exists and was refused. */
  refused: RefusedReading | null;
  credits: string[];
}

/** Whose threshold each refusal belongs to, and how to state it in figures. */
function ruleFor(why: SurfaceValidity): { owner: "operator" | "ours"; rule: string } {
  switch (why) {
    case "far":
      // Ours, and the one most worth arguing with — see NEARBY_KM's own comment for
      // the measured distribution behind the number.
      return { owner: "ours", rule: `our ${NEARBY_KM} km limit` };
    case "old":
      // The NUMBER is the operator's (Estonia raises OVER_2_HOURS at exactly this age)
      // but the clock is ours, so this is stated as borrowed rather than as theirs.
      return {
        owner: "operator",
        rule: `the operator's ${MEASURED_MAX_AGE_MS / 3_600_000}-hour window, applied by our clock`,
      };
    case "stale":
      return { owner: "operator", rule: "the operator's own staleness flag" };
    case "fault":
      return { owner: "operator", rule: "the operator's own fault report" };
    default:
      return { owner: "ours", rule: "" };
  }
}

/** "3.4 km", or "" when the station is effectively on the spot. Mirrors the tile. */
function gap(km: number | undefined): string {
  if (!Number.isFinite(km as number)) return "";
  const v = km as number;
  return `${v % 1 === 0 ? v : v.toFixed(1)} km`;
}

/** The two rows that describe the picture itself, and are true whatever tier it is. */
function frameRows(input: ProvenanceInput): ProvenanceRow[] {
  const fa = frameAge(input.lastSampledAt, input.refreshSeconds, input.now);
  return [{ term: "Frame", value: fa.text, note: fa.title }];
}

function surfaceRows(reading: SurfaceReading, now: number): ProvenanceRow[] {
  const rows: ProvenanceRow[] = [
    {
      term: "Surface state",
      value: humaniseOperatorCode(reading.state),
      note: "The operator's own wording, passed through unchanged. Nothing here maps a sensor value onto a word of ours.",
    },
  ];

  const where = gap(reading.km);
  if (reading.station || where) {
    rows.push({
      term: "Station",
      value: [reading.station, where && `${where} from the camera`].filter(Boolean).join(" · "),
      note: where
        ? undefined
        : "The operator does not publish how far this station is from the camera.",
    });
  }

  if (Number.isFinite(reading.roadTempC as number)) {
    rows.push({
      term: "Road surface temperature",
      value: `${reading.roadTempC} °C`,
      note: "Measured at the road surface, which is not the same as the air temperature above it.",
    });
  }
  if (Number.isFinite(reading.airTempC as number)) {
    rows.push({ term: "Air temperature at the station", value: `${reading.airTempC} °C` });
  }

  if (Number.isFinite(reading.observedAt as number)) {
    rows.push({
      term: "Station reading taken",
      value: `${shortAge(now - (reading.observedAt as number))} ago`,
      note: "When the sensor measured — a different moment from when the picture was taken.",
    });
  }

  return rows;
}

function weatherRows(pw: PointWeather): ProvenanceRow[] {
  const rows: ProvenanceRow[] = [
    {
      term: "Basis",
      value: "Air weather at this point",
      note: "Open-Meteo model output for this coordinate. It is not a station reading, and it describes the air rather than the ground.",
    },
  ];

  if (Number.isFinite(pw.precipMm)) {
    rows.push({
      term: "Precipitation",
      value: `${pw.precipMm} mm`,
      note: "A sum over the preceding hour, not a reading at this instant. That is why every phrase built from it says \"1h\".",
    });
  }
  if (Number.isFinite(pw.tempC)) {
    rows.push({ term: "Air temperature", value: `${pw.tempC} °C` });
  }
  // The glyph is the tile's shorthand; the panel has room for the word itself.
  const { label } = weatherCodeLabel(pw.code);
  if (label) rows.push({ term: "Conditions", value: label });

  return rows;
}

/**
 * Everything the focus view may show about one stream's conditions.
 *
 * The claim is delegated to `roadClaim` rather than re-derived, so the panel and the
 * tile are incapable of disagreeing about what is being asserted. This function only
 * ever ADDS the basis underneath it.
 */
export function provenanceReport(input: ProvenanceInput): ProvenanceReport {
  const { kind, surface, weather, pending, weatherFailed, lookupFailed, now } = input;
  const claim = roadClaim({ kind, surface, weather, pending, weatherFailed, lookupFailed, now });

  // Two states with nothing to evidence. Pending is not an absence — we have not
  // finished asking — and a stream with no place has no conditions to have a basis for.
  if (pending || !kind) return { claim, rows: [], refused: null, credits: [] };

  const rows: ProvenanceRow[] = [];
  const credits: string[] = [];
  let refused: RefusedReading | null = null;

  if (surface) {
    const why = surfaceValidity(surface, now);
    if (why === "current") {
      rows.push(...surfaceRows(surface, now));
    } else {
      const { owner, rule } = ruleFor(why);
      refused = {
        state: humaniseOperatorCode(surface.state),
        why,
        ruleOwner: owner,
        reason: refusalTitle(surface, why, now),
        rule,
      };
      // The refused reading's own detail still belongs on screen, under the
      // disclosure — a reader deciding whether they agree with the refusal needs the
      // station, the distance and the age, not just our verdict on them.
      rows.push(...surfaceRows(surface, now));
    }
  }

  if (weather) {
    // Only describe the air as the BASIS when nothing measured this road. Where a
    // station was used, the air reading is context beside it, not what the claim rests
    // on, so the "Basis" row would be false.
    const asBasis = claim.tier === "derived";
    rows.push(...(asBasis ? weatherRows(weather) : weatherRows(weather).slice(1)));
    credits.push(OPEN_METEO_CREDIT);
  }

  rows.push(...frameRows(input));

  return { claim, rows, refused, credits };
}
