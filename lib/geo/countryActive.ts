// Pure helpers for the country dossier's "Active signals" slot.
//
// Several signal layers are already country-coded — their feature ids end in the
// country's ISO code (displacement:AFG, cyber-ransomware:US, ioda:US, food:AFG).
// When a country is clicked we can therefore surface the live signals genuinely
// INSIDE it by matching those features to the clicked ISO, with a real value and a
// clickable source per row. No DOM, no fetch — unit-testable.

import type { SignalFeature } from "@/lib/signals/types";

/** The code after the last ":" in a feature id, upper-cased ("food:AFG" → "AFG"). */
export function featureCode(feature: SignalFeature): string {
  const id = String(feature?.id ?? "");
  const code = id.slice(id.lastIndexOf(":") + 1);
  return code.trim().toUpperCase();
}

/**
 * Find the feature for a clicked country in one layer's features: by ISO-3 / ISO-2
 * suffix on the id first, then a case-insensitive props.country === name fallback.
 * Returns null when the country has no feature in that layer (the honest "quiet").
 */
export function matchCountryFeature(
  features: SignalFeature[] | undefined,
  country: { iso2?: string; iso3?: string; name?: string },
): SignalFeature | null {
  if (!Array.isArray(features) || features.length === 0) return null;
  const codes = new Set(
    [country.iso2, country.iso3].filter(Boolean).map((c) => String(c).toUpperCase()),
  );
  if (codes.size > 0) {
    const byCode = features.find((f) => codes.has(featureCode(f)));
    if (byCode) return byCode;
  }
  const name = country.name?.trim().toLowerCase();
  if (name) {
    const byName = features.find(
      (f) => String(f.props?.country ?? "").trim().toLowerCase() === name,
    );
    if (byName) return byName;
  }
  return null;
}

/** A compact human summary of one active country signal, per layer. Pure. */
export function activeEventLine(signalId: string, feature: SignalFeature): string {
  const p = feature.props ?? {};
  const s = (v: unknown) => (v == null || v === "" ? "" : String(v));
  switch (signalId) {
    case "cyber-ransomware": {
      const n = s(p.victims);
      return n ? `${n} ransomware victim${n === "1" ? "" : "s"} claimed` : "Ransomware activity";
    }
    case "internet-outages":
      return `Internet outage — ${s(p.severity) || "detected"}`;
    case "displacement":
      return `${s(p.totalDisplaced) || "—"} forcibly displaced`;
    default:
      return feature.title || "Active signal";
  }
}

/** ReliefWeb country page — the live humanitarian/situation feed for a country. */
export function reliefwebCountryUrl(iso3: string | undefined): string {
  const code = (iso3 ?? "").trim().toLowerCase();
  return code ? `https://reliefweb.int/country/${code}` : "https://reliefweb.int/countries";
}
