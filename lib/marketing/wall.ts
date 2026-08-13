// The marketing site's source wall, derived from the SAME registry the app renders.
//
// The whole argument of the landing page is that every dot has a traceable source, so
// the wall of sources cannot be a hand-written marketing list — it would drift from the
// product within a week and be wrong in the one place claiming to be trustworthy.
// Everything here is computed from `SOURCE_CATALOG` (lib/sources/catalog.ts), which is
// itself computed from the core layers plus `SIGNALS`. Adding an adapter makes a new
// card appear on the landing page with no edit to any marketing file.
//
// Pure + node-testable: static descriptors only. Live counts and freshness dots are
// fetched client-side from the same endpoints the app uses.

import { SOURCE_CATALOG, type CatalogSource } from "@/lib/sources/catalog";

export interface WallEntry {
  id: string;
  kind: "core" | "signal";
  label: string;
  group: string;
  color: string;
  /** The upstream's mandatory credit string, straight from the adapter. */
  attribution: string;
  /** Human refresh cadence, e.g. "60s", "5m", "24h". */
  cadence: string;
}

export interface WallGroup {
  group: string;
  entries: WallEntry[];
}

/**
 * Refresh interval → the compact cadence string the citation line shows.
 * Sub-minute stays in seconds, sub-hour in minutes, the rest in hours: the point is
 * legibility on a card, not precision.
 */
export function formatCadence(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

function toEntry(s: CatalogSource): WallEntry {
  return {
    id: s.id,
    kind: s.kind,
    label: s.label,
    group: s.group,
    color: s.color,
    attribution: s.attribution,
    cadence: formatCadence(s.refreshMs),
  };
}

/** Every source, grouped by the registry's own `group`, in first-seen order. */
export function buildWall(catalog: CatalogSource[] = SOURCE_CATALOG): WallGroup[] {
  const out: WallGroup[] = [];
  for (const s of catalog) {
    let g = out.find((x) => x.group === s.group);
    if (!g) {
      g = { group: s.group, entries: [] };
      out.push(g);
    }
    g.entries.push(toEntry(s));
  }
  return out;
}

/** Flat count — the "N adapters" figure. Measured, never typed into copy. */
export function wallCount(catalog: CatalogSource[] = SOURCE_CATALOG): number {
  return catalog.length;
}

/**
 * The publisher names for the hero marquee. Deduped on the leading clause of each
 * attribution string (before the first "—" or "·"), which is the publisher; the rest
 * is the credit's descriptive tail and would make the band unreadable.
 */
export function marqueePublishers(catalog: CatalogSource[] = SOURCE_CATALOG): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of catalog) {
    const head = s.attribution.split(/[—·]/)[0].trim();
    if (!head || seen.has(head)) continue;
    seen.add(head);
    out.push(head);
  }
  return out;
}
