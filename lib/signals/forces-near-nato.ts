// lib/signals/forces-near-nato.ts
// The Russian sites near NATO's borders that the reporting names: one feature per site
// whose town is known, each carrying its quoted claims, who made them, the date and the
// article link. Curated by hand in forces-near-nato.data.ts (its header has the rules);
// no relay feed and no network.
//
// The full list, the sites with no town included, rides on the feature array as the
// layer's summary (lib/signals/summary.ts), because the widget lists what the map cannot
// draw. `readForcesSummary` checks its shape on the client.
import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { compiled } from "@/lib/signals/outcome";
import { markSummary } from "@/lib/signals/summary";
import { BORDER_LABEL, LEFT_OUT, NATO_SITES, type NatoSite } from "./forces-near-nato.data";

/** When the curated list was last edited. Move it with every row added or changed. */
export const COMPILED_AT = Date.parse("2026-10-30T00:00:00Z");

// Deep orange: it reads on the satellite imagery and on the light basemap alike. The
// olive first planned (#464b37) vanished on both, measured on the local console 2026-10-30.
const COLOR = "#d9480f";

export interface ForcesNearNatoSummary {
  sites: NatoSite[];
  leftOut: { name: string; why: string; url: string }[];
}

/** The newest article date among a site's claims, as an ISO instant (UTC midnight). */
export function newestClaimDate(site: NatoSite): string | undefined {
  const dates = site.claims.map((c) => c.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const last = dates[dates.length - 1];
  return last ? `${last}T00:00:00Z` : undefined;
}

/** Pure: one feature per site with a known town. A site with `at: null` is not drawn. */
export function sitesToFeatures(sites: readonly NatoSite[]): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const s of sites) {
    if (!s.at || !Number.isFinite(s.at.lat) || !Number.isFinite(s.at.lon)) continue;
    const first = s.claims[0];
    if (!first) continue;
    out.push({
      id: `nato:${s.id}`,
      lat: s.at.lat,
      lon: s.at.lon,
      title: s.unit ? `${s.name}: ${s.unit}` : s.name,
      signalId: "forces-near-nato",
      color: COLOR,
      props: {
        faces: BORDER_LABEL[s.border],
        region: s.region,
        ...(s.distance ? { distance: s.distance } : {}),
        claim: first.translation ? `${first.translation} (our translation from Russian)` : first.quote,
        "claimed by": first.attributedTo,
        reported: `${first.outlet}, ${first.date}`,
        ...(s.claims.length > 1 ? { "more claims": s.claims.length - 1 } : {}),
        "placed at": `The town, from ${s.at.gazetteer}. No article gives the base's own position.`,
      },
      link: first.url,
      ts: newestClaimDate(s),
    });
  }
  return out;
}

/** Client side: the summary as the route sent it, or null when its shape is wrong. */
export function readForcesSummary(v: unknown): ForcesNearNatoSummary | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.sites) || !Array.isArray(o.leftOut)) return null;
  const sitesOk = o.sites.every(
    (s) =>
      s && typeof s === "object" &&
      typeof (s as NatoSite).id === "string" &&
      typeof (s as NatoSite).name === "string" &&
      typeof (s as NatoSite).border === "string" &&
      Array.isArray((s as NatoSite).claims) &&
      (s as NatoSite).claims.every((c) => c && typeof c.quote === "string" && typeof c.url === "string"),
  );
  const leftOk = o.leftOut.every((l) => l && typeof l === "object" && typeof (l as { name: unknown }).name === "string");
  return sitesOk && leftOk ? (v as ForcesNearNatoSummary) : null;
}

export const FORCES_NEAR_NATO_SOURCE: SignalSource = {
  id: "forces-near-nato",
  kind: "asset",
  label: "Forces near NATO",
  group: "Conflict",
  color: COLOR,
  // A site is placed at its town, never at the base: no article gives a base's position.
  precision: "area",
  refreshMs: 24 * 60 * 60_000,
  attribution: "Sites and claims from the reporting each one cites",
  async fetch() {
    // No network: a curated list. compiled(), not observed(): nothing is read live, and
    // the stamp is when the list was last edited.
    const summary: ForcesNearNatoSummary = { sites: NATO_SITES, leftOut: LEFT_OUT };
    return compiled(markSummary(sitesToFeatures(NATO_SITES), summary), COMPILED_AT);
  },
};
