import { NextRequest } from "next/server";
import { detectKind, normalizeTarget } from "@/lib/recon/target";
import {
  parseBgpIp,
  parseBgpAsn,
  type BgpResult,
  type RipeAnnouncedPrefixes,
  type RipeAsOverview,
  type RipeNetworkInfo,
  type RipePrefixOverview,
  type RipeReverseDns,
} from "@/lib/recon/bgp";

// GET /api/recon/bgp?target=<ip|asn> — BGP / ASN routing via RIPEstat (keyless).
//
// Was BGPView (api.bgpview.io), which has SHUT DOWN: the host no longer resolves,
// so every lookup had been quietly returning { ok:false } and the recon widget's
// BGP section was permanently dead. RIPEstat is the RIPE NCC's own public data
// API — no key, no signup, and not going anywhere.
//
// Each kind needs two or three small calls, issued together. They are allowed to
// fail INDIVIDUALLY: reverse DNS often has no record, and a partial answer beats
// no answer. Dormant-safe throughout — any failure resolves to { ok:false } with
// an empty result and HTTP 200, never a 5xx.
export const revalidate = 300; // 5-minute edge cache per target

const RIPESTAT = "https://stat.ripe.net/data";
const UA = "OpenData/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";
const TIMEOUT_MS = 8_000;

function empty(kind: "ip" | "asn", reason: string, target: string) {
  return Response.json({ ok: false, kind, prefixes: [], reason, target });
}

/** One RIPEstat call. Resolves to null on any failure — never throws. */
async function call<T>(dataCall: string, resource: string): Promise<T | null> {
  try {
    const url = `${RIPESTAT}/${dataCall}/data.json?resource=${encodeURIComponent(resource)}`;
    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const target = (req.nextUrl.searchParams.get("target") ?? "").trim();
  const kind = detectKind(target);
  if (kind !== "ip" && kind !== "asn") {
    return empty("ip", "BGP needs an IP or ASN target.", target);
  }
  const id = normalizeTarget(target, kind);

  try {
    let result: BgpResult;

    if (kind === "ip") {
      const [networkInfo, reverseDns] = await Promise.all([
        call<RipeNetworkInfo>("network-info", id),
        call<RipeReverseDns>("reverse-dns-ip", id),
      ]);
      // prefix-overview is far more useful keyed on the covering PREFIX than on
      // the bare address (on an address it warns and re-aligns anyway), so it
      // waits for network-info rather than firing alongside it.
      const prefix = networkInfo?.data?.prefix;
      const prefixOverview = await call<RipePrefixOverview>("prefix-overview", prefix || id);
      result = parseBgpIp({ ip: id, networkInfo, prefixOverview, reverseDns });
    } else {
      const asn = Number(id.replace(/^AS/i, ""));
      if (!Number.isFinite(asn)) return empty("asn", "Could not read that ASN.", target);
      const [overview, announced] = await Promise.all([
        call<RipeAsOverview>("as-overview", `AS${asn}`),
        call<RipeAnnouncedPrefixes>("announced-prefixes", `AS${asn}`),
      ]);
      result = parseBgpAsn({ asn, overview, announced });
    }

    if (!result.ok) return empty(kind, "No routing data for that target.", target);
    return Response.json({ ...result, target });
  } catch {
    return empty(kind, "BGP lookup failed.", target);
  }
}
