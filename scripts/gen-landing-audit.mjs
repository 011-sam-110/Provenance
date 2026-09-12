// Turn a country-event-breakdown measurement into the landing page's committed audit data.
//
// WHY THIS EXISTS. The landing page states ~60 figures: how many layers are live, how many
// features each one places, how many countries it reaches, and what each tier is made of in
// the five best-covered countries. `CLAUDE.md` says "Never type a count into the landing
// page", and the page's own argument is that its numbers are checkable — so none of those
// figures may be typed by hand, and none may be read from a file that is not in the repo.
//
// The measurement itself (`scripts/country-event-breakdown.mts`) writes to `scratchpad/`,
// which is gitignored. That is correct for a raw run and useless as a page's evidence: a
// figure whose source is not committed cannot be checked by the reader it is aimed at. This
// script is the bridge. It reads one measurement run and writes ONE generated module, dated
// and attributed, which the page imports.
//
// EVERY FIELD IS DERIVED, NONE IS CLASSIFIED BY HAND. In particular `state` — the live /
// partial / broken / locked column — comes from the measurement's own `upstreamOk`,
// `returned` and `degradedReason`, by the rule in `stateOf()` below. There is no list of
// "the broken ones" anywhere in this repo, because such a list is exactly the thing that
// goes stale without any test noticing.
//
// The one genuinely editorial choice is `tier`: the page groups the 34 layers into
// Incidents / Readings / Assets, which is a reader-facing idea and not a registry field.
// `tierOf()` derives it from `kind` and `group`, with two id overrides that are named and
// justified there. `tests/unit/landing-audit.test.ts` pins the result.
//
// usage:
//   node scripts/gen-landing-audit.mjs [measurement.json]
//     default input:  scratchpad/country-events-final.json
//     output:         lib/marketing/coverage-audit.data.ts

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const IN = process.argv[2] || "scratchpad/country-events-final.json";
const OUT = "lib/marketing/coverage-audit.data.ts";

/**
 * The measurement JSON was written by a Node run whose stdout encoding mangled non-ASCII:
 * em dashes arrive as "â€”". The bytes are recoverable — they are UTF-8 that was decoded as
 * cp1252 — so repair them here rather than letting mojibake reach the page. A string that
 * does not round-trip is left exactly as found, because guessing at it would be worse.
 */
function unmojibake(s) {
  if (typeof s !== "string" || !/[Â-Ã][-¿]/.test(s)) return s;
  try {
    const bytes = Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 0xff));
    const out = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return out;
  } catch {
    return s;
  }
}

/**
 * live / partial / down / locked, derived — never declared.
 *
 *   locked   the adapter is fine and we do not hold the credential   (returned 0, "no key")
 *   down     the upstream refused us                                 (returned 0, an http code)
 *   partial  the upstream answered, but not completely               (rows returned, upstream not ok)
 *   live     the upstream answered
 *
 * `degradedReason` carries the evidence in every non-live case, and it is shown on the page
 * beside the row, so a reader can see WHY a layer is dark rather than taking the word for it.
 */
function stateOf(l) {
  const returned = l.returned ?? 0;
  if (!l.upstreamOk && returned === 0) {
    return l.degradedReason === "no key" ? "locked" : "down";
  }
  if (!l.upstreamOk) return "partial";
  return "live";
}

/**
 * Incidents / Readings / Assets — the page's three tiers.
 *
 * Assets are permanent infrastructure, which `kind` already knows ("asset"), plus scheduled
 * launches, which are a directory of future events at a fixed place rather than something
 * happening now.
 *
 * Readings are measurements and indices rather than occurrences: a "forecast" kind, plus the
 * groups whose whole content is a per-place number (Environment, Human cost, Synthesis, Cyber
 * threat).
 *
 * Two ids are overridden because their group does not carry their nature:
 *   • internet-outages  sits in Infrastructure but publishes an IODA outage SCORE per country.
 *   • grid-load         sits in Infrastructure but publishes an ENTSO-E load MEASUREMENT.
 * Both are readings. Everything else that is an event is an incident.
 */
const READING_IDS = new Set(["internet-outages", "grid-load"]);
const READING_GROUPS = new Set(["Environment", "Human cost", "Synthesis", "Cyber threat"]);

function tierOf(l) {
  if (l.kind === "asset" || l.kind === "schedule") return "assets";
  if (l.kind === "forecast") return "readings";
  if (READING_IDS.has(l.id)) return "readings";
  if (READING_GROUPS.has(l.group)) return "readings";
  return "incidents";
}

/**
 * The note shown under a layer's name. Preference order, most informative first:
 * the cap rule (what was hidden and how the survivors were chosen), then the degradation
 * reason, then how many features could not be resolved to any country.
 */
function noteOf(l) {
  const parts = [];
  const cov = l.coverage;
  if (cov?.capped) {
    const available = cov.availableExact ? cov.available.toLocaleString("en-GB") : `${cov.available.toLocaleString("en-GB")}+`;
    parts.push(`Showing ${(cov.returned ?? l.returned).toLocaleString("en-GB")} of ${available}, ${unmojibake(cov.rule || "capped")}.`);
  }
  if (!l.upstreamOk && l.degradedReason && l.degradedReason !== "no key") {
    parts.push(l.degradedReason.startsWith("http") ? `Upstream answered ${l.degradedReason}.` : `${unmojibake(l.degradedReason)}.`);
  }
  if (l.degradedReason === "no key") parts.push("Needs a credential we do not hold.");
  if (l.unassigned > 0) parts.push(`${l.unassigned.toLocaleString("en-GB")} at sea or in orbit.`);
  return parts.join(" ").replace(/\.\./g, ".");
}

const raw = JSON.parse(readFileSync(resolve(IN), "utf8"));

const layers = raw.layers.map((l) => ({
  id: l.id,
  label: unmojibake(l.label),
  group: l.group,
  tier: tierOf(l),
  features: l.returned ?? 0,
  placed: l.located ?? 0,
  countries: Object.keys(l.countries || {}).length,
  /**
   * True where the layer carries line or area geometry, so one feature is counted in every
   * country its shape touches. Per-country figures for these layers therefore sum to MORE
   * than the layer served, and the page has to say so wherever it adds them up.
   */
  spansCountries: Boolean(l.spansCountries),
  state: stateOf(l),
  note: noteOf(l),
}));

const tierOfId = new Map(layers.map((l) => [l.id, l.tier]));

const countries = raw.countries
  .map((c) => {
    const per = { incidents: 0, readings: 0, assets: 0 };
    const layerCount = { incidents: 0, readings: 0, assets: 0 };
    for (const [id, n] of Object.entries(c.byLayer || {})) {
      const t = tierOfId.get(id);
      if (!t) continue;
      per[t] += n;
      layerCount[t] += 1;
    }
    return {
      iso2: c.iso2,
      name: unmojibake(c.name),
      subregion: c.subregion || c.continent || "",
      layers: c.layerCount,
      incidents: per.incidents,
      incLayers: layerCount.incidents,
      readings: per.readings,
      readLayers: layerCount.readings,
      assets: per.assets,
      assetLayers: layerCount.assets,
    };
  })
  .sort((a, b) => b.layers - a.layers || b.incidents + b.readings + b.assets - (a.incidents + a.readings + a.assets) || a.name.localeCompare(b.name));

// A tier's country count is "countries where this tier places at least one feature", which is
// the claim the page makes about it — not "countries the tier's layers could in principle reach".
//
// A tier's feature count is the PLACED count, not the served count and not the sum of the
// per-country numbers. The three differ, and only one of them is safe to add up:
//   served  — what the upstreams returned, including features at sea or in orbit.
//   placed  — what resolved to a country. This is the figure the page totals.
//   summed  — adding the per-country numbers, which counts a submarine cable once per country
//             it touches. Bigger than the other two, and not a feature count at all.
const tiers = ["incidents", "readings", "assets"].map((tier) => ({
  tier,
  countries: countries.filter((c) => c[tier] > 0).length,
  features: layers.filter((l) => l.tier === tier).reduce((n, l) => n + l.placed, 0),
}));

const totals = {
  layers: layers.length,
  live: layers.filter((l) => l.state === "live").length,
  partial: layers.filter((l) => l.state === "partial").length,
  down: layers.filter((l) => l.state === "down").length,
  locked: layers.filter((l) => l.state === "locked").length,
  /** What the upstreams served, including features that resolved to no country. */
  featuresServed: layers.reduce((n, l) => n + l.features, 0),
  /** What resolved to a country. The figure the page leads with. */
  featuresPlaced: layers.reduce((n, l) => n + l.placed, 0),
  /** The remainder: at sea, in orbit, or in a country too small for a 110m polygon. */
  featuresUnplaced: layers.reduce((n, l) => n + (l.features - l.placed), 0),
  countriesTouched: countries.length,
  countriesWithAny: countries.filter((c) => c.layers > 0).length,
  /** Layers whose per-country figures overlap, named so the page can cite them rather than hard-code them. */
  spanningLayers: layers.filter((l) => l.spansCountries).map((l) => l.label),
};

const banner = `// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Written by scripts/gen-landing-audit.mjs from one run of scripts/country-event-breakdown.mts.
// Every figure the landing page states about coverage comes from here, so that a reader who
// doubts a number on the page can read the run that produced it rather than trust it.
//
// To refresh: re-run the breakdown against production, then
//   node scripts/gen-landing-audit.mjs <measurement.json>
//
// tests/unit/landing-audit.test.ts fails if the layer ids here drift from the live SIGNALS
// registry — adding a signal layer makes this file stale, and the test says so out loud
// rather than letting the page quietly understate itself.
`;

const ts = `${banner}
/** When the measurement ran. Shown on the page beside every figure taken from it. */
export const AUDIT_MEASURED_AT = ${JSON.stringify(raw.measuredAt)};
/** What it was measured against. Production, not a laptop. */
export const AUDIT_MEASURED_FROM = ${JSON.stringify(raw.measuredFrom)};
/** How a feature was resolved to a country, and the limitation that carries. */
export const AUDIT_POLYGON_SOURCE = ${JSON.stringify(raw.polygonSource)};

export type AuditTier = "incidents" | "readings" | "assets";
export type AuditState = "live" | "partial" | "down" | "locked";

export interface AuditLayer {
  id: string;
  label: string;
  group: string;
  tier: AuditTier;
  /** Features the layer actually served, which for a capped layer is not its upstream total. */
  features: number;
  /** Of those, how many resolved to a country. The rest are at sea, in orbit, or micro-states. */
  placed: number;
  /** Distinct countries the layer places at least one feature in. */
  countries: number;
  /**
   * Line or area geometry, so one feature is counted in every country its shape touches.
   * Per-country figures for these layers overlap and must not be summed into a feature total.
   */
  spansCountries: boolean;
  state: AuditState;
  /** The cap rule, the upstream's refusal, and how many features landed at sea or in orbit. */
  note: string;
}

export interface AuditCountry {
  iso2: string;
  name: string;
  subregion: string;
  /** Distinct layers placing at least one feature here. */
  layers: number;
  incidents: number;
  incLayers: number;
  readings: number;
  readLayers: number;
  assets: number;
  assetLayers: number;
}

export interface AuditTierTotal {
  tier: AuditTier;
  /** Countries where this tier places at least one feature. */
  countries: number;
  features: number;
}

export const AUDIT_LAYERS: AuditLayer[] = ${JSON.stringify(layers, null, 2)};

export const AUDIT_COUNTRIES: AuditCountry[] = ${JSON.stringify(countries, null, 2)};

export const AUDIT_TIERS: AuditTierTotal[] = ${JSON.stringify(tiers, null, 2)};

export const AUDIT_TOTALS = ${JSON.stringify(totals, null, 2)} as const;
`;

writeFileSync(resolve(OUT), ts, "utf8");
console.log(`${OUT}: ${layers.length} layers, ${countries.length} countries, measured ${raw.measuredAt}`);
console.log(`  live ${totals.live} · partial ${totals.partial} · down ${totals.down} · locked ${totals.locked}`);
console.log(`  ${totals.featuresServed} served, ${totals.featuresPlaced} placed in a country, ${totals.featuresUnplaced} at sea or in orbit`);
for (const t of tiers) console.log(`  ${t.tier}: ${t.countries} countries, ${t.features} features`);
