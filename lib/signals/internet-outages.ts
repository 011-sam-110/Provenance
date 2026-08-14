import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { centroidByIso2 } from "@/lib/signals/country-centroids.data";
import { degraded, observed } from "@/lib/signals/outcome";

// Internet outages — IODA (Internet Outage Detection & Analysis, Georgia Tech /
// CAIDA). Detects national-scale connectivity drops from three independent
// vantage points (active probing, BGP, telescope). Country-level internet
// shutdowns are a top-tier instability signal — governments cut connectivity
// during coups, contested elections and crackdowns. Keyless; country-aggregated:
// IODA already returns one score per affected country, so we anchor a marker at
// the country centroid sized by outage severity. Dormant-safe (→ [] on failure).

const SUMMARY_URL = "https://api.ioda.inetintel.cc.gatech.edu/v2/outages/summary";
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

export const IODA_ATTRIBUTION = "Internet-outage detection © IODA (CAIDA / Georgia Tech)";

interface IodaEntity {
  code?: string; // ISO-3166 alpha-2 for country entities
  name?: string;
  type?: string;
}
interface IodaRow {
  scores?: { overall?: number };
  event_cnt?: number;
  entity?: IodaEntity;
}

/**
 * IODA's overall score → a 0–10 marker magnitude, log-scaled.
 *
 * The raw score is an internal IODA quantity with no unit and no ceiling — live
 * values on 2026-08-10 were around 5.7e10, six orders of magnitude past the
 * "~1e3–1e6" this function was originally written for. It means nothing to a
 * reader, so it must never be the number on the face of a widget.
 */
export function outageMagnitude(score: number): number {
  if (!(score > 0)) return 3;
  // Calibrated on the range IODA ACTUALLY emits — roughly 1e3 to 1e11 — not the
  // 1e3–1e6 the first version assumed. With the old constant everything above
  // about 1e7 clamped to 10, so the three worst-hit countries in the world were
  // indistinguishable from each other and from a moderate regional outage. A
  // saturated scale is a scale that has stopped measuring.
  const decades = Math.log10(score + 1);
  const m = 3 + ((decades - 3) * 7) / 8; // 1e3 → 3, 1e11 → 10
  return Math.min(10, Math.max(3, Math.round(m * 10) / 10));
}

/**
 * The human-facing label for an outage: the SEVERITY BAND and the event count,
 * never the raw score.
 *
 * The anomaly widget renders the declared metric's value, and the declared metric
 * was `outageScore` — so the first row of the flagship "What's abnormal" widget
 * read "Internet outages (IODA) · 56780505874". Three separate auditors flagged
 * that same number independently. A quantity a reader cannot interpret is not a
 * measurement to them; it is noise wearing a measurement's clothes.
 */
export function outageBand(score: number): "severe" | "elevated" | "localised" {
  // Log thresholds, because the raw score has no ceiling and its practical scale
  // MOVES. The captured fixture's worst outage was 3.8e5; the live feed on
  // 2026-08-10 had Côte d'Ivoire at 5.8e10 with the next-worst country at 2.9e4 —
  // a six-order-of-magnitude gap inside a single snapshot. Absolute thresholds
  // calibrated on any one day are wrong on another, which is exactly how the
  // previous 100_000 constant came to call almost everything severe.
  if (score >= 1e9) return "severe";
  if (score >= 1e6) return "elevated";
  return "localised";
}

/** Pure: IODA country-summary payload → one SignalFeature per located country. */
export function normalizeOutages(json: { data?: IodaRow[] }): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const r of json.data ?? []) {
    const ent = r.entity;
    if (!ent || ent.type !== "country") continue;
    const code = (ent.code ?? "").trim().toUpperCase();
    if (!code) continue;
    const c = centroidByIso2(code);
    if (!c) continue; // unknown / non-country code (e.g. "ZZ") — skip
    const score = typeof r.scores?.overall === "number" ? r.scores.overall : 0;
    const events = typeof r.event_cnt === "number" ? r.event_cnt : 0;
    const name = ent.name?.trim() || c.name;
    out.push({
      id: `ioda:${code}`,
      lat: c.lat,
      lon: c.lon,
      title: `Internet outage — ${name}`,
      signalId: "internet-outages",
      color: "#b91c1c", // censorship/outage red
      props: {
        country: name,
        // Kept, because the dossier should still be able to show the upstream's
        // own number and link to it — but it is no longer what the widget prints.
        outageScore: Math.round(score),
        events,
        severity: outageBand(score),
        magnitude: outageMagnitude(score),
      },
    });
  }
  return out;
}

export const INTERNET_OUTAGES_SOURCE: SignalSource = {
  id: "internet-outages",
  label: "Internet outages (IODA)",
  group: "Infrastructure",
  color: "#b91c1c",
  refreshMs: 15 * 60 * 1000,
  attribution: IODA_ATTRIBUTION,
  sourceUrl: "https://ioda.inetintel.cc.gatech.edu/", // IODA dashboard (dossier source)

  // The metric drives the monitor bar AND the value the anomaly widget prints, so
  // it must be a number a person can read. `outageScore` was neither: unitless,
  // unbounded, and live values ~5.7e10 against a declared ceiling of 100,000 — so
  // every bar was pinned at full and the widget printed 56,780,505,874. The
  // log-scaled 0–10 magnitude is the same ordering, legibly.
  metric: { field: "magnitude", domain: [0, 10] },
  async fetch() {
    // Look back 24h; IODA extends the window server-side to catch ongoing events.
    const until = Math.floor(Date.now() / 1000);
    const from = until - 24 * 3600;
    try {
      const res = await fetch(
        `${SUMMARY_URL}?from=${from}&until=${until}&entityType=country&limit=200`,
        { headers: { Accept: "application/json", "User-Agent": UA }, signal: AbortSignal.timeout(20_000) },
      );
      if (!res.ok) return degraded(`http ${res.status}`);
      const json = (await res.json()) as { data?: IodaRow[] };
      // An empty payload here is a real reading: IODA answered, no country is out.
      return observed(normalizeOutages(json));
    } catch {
      return degraded("fetch failed");
    }
  },
};
