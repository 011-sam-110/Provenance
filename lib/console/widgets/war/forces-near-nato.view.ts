// lib/console/widgets/war/forces-near-nato.view.ts
// PURE: what the Forces near NATO card and expanded view say about the curated sites.
// Node-testable (tests/unit/forces-near-nato-view.test.ts); the .tsx files only render.
import {
  BORDER_LABEL,
  BORDER_ORDER,
  type NatoBorder,
  type NatoClaim,
  type NatoSite,
} from "@/lib/signals/forces-near-nato.data";

export interface SiteGroup {
  border: NatoBorder;
  label: string;
  sites: NatoSite[];
}

/** The sites by the border they face, in BORDER_ORDER, with empty groups left out. */
export function groupSites(sites: readonly NatoSite[]): SiteGroup[] {
  return BORDER_ORDER.map((border) => ({
    border,
    label: BORDER_LABEL[border],
    sites: sites.filter((s) => s.border === border),
  })).filter((g) => g.sites.length > 0);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(date: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12 ? [Number(m[1]), mo, Number(m[3])] : null;
}

/** "2026-10-19" -> "19 Oct". Read as a calendar date, so no time zone can move it. */
export function shortDate(date: string): string {
  const p = parts(date);
  return p ? `${p[2]} ${MONTHS[p[1] - 1]}` : "";
}

/** "2026-10-19" -> "19 Oct 2026". */
export function longDate(date: string): string {
  const p = parts(date);
  return p ? `${p[2]} ${MONTHS[p[1] - 1]} ${p[0]}` : "";
}

/** The newest article date among a site's claims, YYYY-MM-DD, or "" when none. */
export function newestDate(site: NatoSite): string {
  return site.claims.map((c) => c.date).filter((d) => parts(d)).sort().at(-1) ?? "";
}

/** Who made a claim, to follow a word mid-sentence: an article loses its capital, a
 *  name ("Iceye", "OSINT analysts") keeps it. */
export function whoMidSentence(attributedTo: string): string {
  return attributedTo.replace(/^(A|An|The) /, (w) => w.toLowerCase());
}

/** "UNITED24 Media, citing a June 2026 investigation by DR, NRK, SVT and Delfi". */
export function citedLine(claim: Pick<NatoClaim, "outlet" | "attributedTo">): string {
  return `${claim.outlet}, citing ${whoMidSentence(claim.attributedTo)}`;
}

/** How many different outlets the list quotes. */
export function outletCount(sites: readonly NatoSite[]): number {
  return new Set(sites.flatMap((s) => s.claims.map((c) => c.outlet))).size;
}

/** "9 sites, 13 claims from 4 outlets" — the expanded view's stat line. */
export function statLine(sites: readonly NatoSite[]): string {
  const claims = sites.reduce((n, s) => n + s.claims.length, 0);
  const outlets = outletCount(sites);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return `${plural(sites.length, "site", "sites")}, ${plural(claims, "claim", "claims")} from ${plural(outlets, "outlet", "outlets")}`;
}

/** The note under the card when a site is listed but not drawn. Null when all are drawn. */
export function unplacedNote(sites: readonly NatoSite[]): string | null {
  const n = sites.filter((s) => !s.at).length;
  if (n === 0) return null;
  return n === 1
    ? "1 site is listed but not on the map: the reporting names no town for it."
    : `${n} sites are listed but not on the map: the reporting names no town for them.`;
}
