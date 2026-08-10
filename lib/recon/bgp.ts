// BGP / ASN routing via RIPEstat (`stat.ripe.net`, JSON). Keyless, no signup.
//
// This used to call api.bgpview.io, which has SHUT DOWN — it no longer resolves
// at all, so the BGP recon tool had been silently returning `{ok:false}` for
// every lookup. RIPEstat is the RIPE NCC's own public data API, is not going
// anywhere, and covers both target kinds:
//   IP  → network-info (origin ASNs + covering prefix) + prefix-overview (holder)
//          + reverse-dns-ip (PTR)
//   ASN → as-overview (holder, announced, allocating registry block)
//          + announced-prefixes (the prefix list)
//
// These are PURE mappers over already-fetched JSON: no fetch, no React, so the
// upstream→domain shape is unit-tested against captured fixtures. Every mapper is
// robust to status!=="ok", a missing `data`, and empty arrays.
//
// NOTE ON A SHAPE CHANGE. BGPView returned announcing prefixes for an IP and
// nothing for an ASN. RIPEstat is the other way round: an ASN has thousands of
// announced prefixes (Cloudflare's AS13335 has ~5,300) and an IP has exactly one
// covering prefix. So `prefixes` is now populated for BOTH kinds, and the ASN
// list is capped — see MAX_PREFIXES.

/** Announced prefixes shown for an ASN. Cloudflare alone announces ~5,300; the
 *  widget lists them, so the cap is about the UI, not the upstream. The result
 *  carries `prefixCount` so the total is still reported honestly. */
export const MAX_PREFIXES = 50;

/** One announcing prefix, flattened to the fields the widget shows. */
export interface BgpPrefix {
  prefix: string;
  /** Origin ASN number, or null when the upstream omits it. */
  asn: number | null;
  /** Human holder — the origin ASN's registered name. */
  holder: string;
  /** Prefix registration country (ISO-2), "" when unknown. RIPEstat does not
   *  publish a per-prefix country on these calls, so this is usually "". */
  country: string;
}

/** Unified result for both target kinds — optional fields are absent when N/A. */
export interface BgpResult {
  ok: boolean;
  kind: "ip" | "asn";
  /** IP lookups: the queried IP + its PTR record. */
  ip?: string;
  ptr?: string;
  /** Summary ASN / holder name / country. */
  asn?: number;
  name?: string;
  country?: string;
  /** ASN lookups: the allocating registry block description, and whether the
   *  ASN is currently visible in the global routing table. */
  description?: string;
  website?: string;
  rir?: string;
  announced?: boolean;
  /** Announcing prefixes, capped at MAX_PREFIXES. */
  prefixes: BgpPrefix[];
  /** TOTAL announced prefixes upstream reported, before the cap. */
  prefixCount?: number;
}

// --- RIPEstat response envelopes --------------------------------------------

interface RipeEnvelope<T> {
  status?: string;
  data?: T;
}

export type RipeNetworkInfo = RipeEnvelope<{ asns?: string[]; prefix?: string }>;

export type RipePrefixOverview = RipeEnvelope<{
  resource?: string;
  announced?: boolean;
  is_less_specific?: boolean;
  asns?: { asn?: number; holder?: string }[];
  block?: { resource?: string; desc?: string; name?: string };
}>;

export type RipeReverseDns = RipeEnvelope<{ result?: string[] | null; error?: string }>;

export type RipeAsOverview = RipeEnvelope<{
  resource?: string;
  holder?: string;
  announced?: boolean;
  block?: { resource?: string; desc?: string; name?: string };
}>;

export type RipeAnnouncedPrefixes = RipeEnvelope<{ prefixes?: { prefix?: string }[] }>;

/** What the IP route gathers before mapping. Any part may be missing. */
export interface IpLookup {
  ip: string;
  networkInfo?: RipeNetworkInfo | null;
  prefixOverview?: RipePrefixOverview | null;
  reverseDns?: RipeReverseDns | null;
}

/** What the ASN route gathers before mapping. Any part may be missing. */
export interface AsnLookup {
  asn: number;
  overview?: RipeAsOverview | null;
  announced?: RipeAnnouncedPrefixes | null;
}

/** Trimmed string, or "" for anything non-string (null/number/undefined). */
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** RIPEstat only means it when status === "ok"; anything else has no usable data. */
function payload<T>(env: RipeEnvelope<T> | null | undefined): T | undefined {
  if (!env || env.status !== "ok") return undefined;
  const d = env.data;
  return d && typeof d === "object" ? d : undefined;
}

/** Honest empty result — what every failure/dormant path resolves to. */
function emptyResult(kind: "ip" | "asn"): BgpResult {
  return { ok: false, kind, prefixes: [] };
}

/**
 * Pure: the three RIPEstat IP calls → the covering prefix, its origin ASN and
 * the PTR record.
 *
 * Partial data is normal and is kept: reverse DNS frequently has no record, and
 * an unannounced address has network-info but no prefix-overview holder. The
 * result is `ok` as long as we learned anything at all beyond the input.
 */
export function parseBgpIp(lookup: IpLookup): BgpResult {
  const ip = str(lookup?.ip);
  if (!ip) return emptyResult("ip");

  const net = payload(lookup.networkInfo);
  const overview = payload(lookup.prefixOverview);
  const rdns = payload(lookup.reverseDns);

  const prefixStr = str(net?.prefix) || str(overview?.resource);
  const originFromOverview = Array.isArray(overview?.asns) ? overview.asns[0] : undefined;
  const originAsnRaw = Array.isArray(net?.asns) ? net.asns[0] : undefined;
  const originAsn =
    typeof originFromOverview?.asn === "number"
      ? originFromOverview.asn
      : Number.isFinite(Number(originAsnRaw))
        ? Number(originAsnRaw)
        : null;
  const holder = str(originFromOverview?.holder);

  const prefixes: BgpPrefix[] = prefixStr
    ? [{ prefix: prefixStr, asn: originAsn, holder, country: "" }]
    : [];

  const result: BgpResult = {
    ok: prefixes.length > 0 || Boolean(holder),
    kind: "ip",
    ip,
    prefixes,
    prefixCount: prefixes.length,
  };

  const ptr = Array.isArray(rdns?.result) ? str(rdns.result[0]) : "";
  if (ptr) result.ptr = ptr;
  if (originAsn != null) result.asn = originAsn;
  if (holder) result.name = holder;
  if (typeof overview?.announced === "boolean") result.announced = overview.announced;
  const block = str(overview?.block?.desc);
  if (block) result.rir = block;

  return result;
}

/**
 * Pure: the two RIPEstat ASN calls → holder identity, routing visibility and a
 * capped prefix list.
 *
 * `announced: false` is a real and interesting answer — an allocated ASN that
 * nobody is currently routing — so it is reported rather than treated as a
 * failure.
 */
export function parseBgpAsn(lookup: AsnLookup): BgpResult {
  const asn = Number(lookup?.asn);
  if (!Number.isFinite(asn)) return emptyResult("asn");

  const overview = payload(lookup.overview);
  const announcedData = payload(lookup.announced);
  const holder = str(overview?.holder);

  const all = Array.isArray(announcedData?.prefixes) ? announcedData.prefixes : [];
  const prefixes: BgpPrefix[] = [];
  for (const p of all) {
    const prefix = str(p?.prefix);
    if (!prefix) continue;
    if (prefixes.length >= MAX_PREFIXES) break;
    prefixes.push({ prefix, asn, holder, country: "" });
  }
  const total = all.filter((p) => str(p?.prefix)).length;

  const result: BgpResult = {
    ok: Boolean(holder) || total > 0,
    kind: "asn",
    asn,
    prefixes,
    prefixCount: total,
  };
  if (holder) result.name = holder;
  if (typeof overview?.announced === "boolean") result.announced = overview.announced;
  const block = str(overview?.block?.desc);
  if (block) result.rir = block; // e.g. "Assigned by ARIN"
  return result;
}
