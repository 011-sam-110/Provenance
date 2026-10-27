import { NextRequest } from "next/server";
import { detectKind, normalizeTarget } from "@/lib/recon/target";
import { parseDoh, type DohResponse } from "@/lib/recon/dns";
import { parseRipeGeo, type GeoResult, type RipeGeoResponse } from "@/lib/recon/geo";

// GET /api/recon/geo?target=<ip|domain> — where MaxMind's free GeoLite2 data places the
// network behind an IP, through RIPEstat's keyless `maxmind-geo-lite` data call. A
// domain resolves to its first A record first, as in the Threat tool.
//
// It reads nothing about the VISITOR: no forwarded address, no cookie, no header. The
// only input is the typed target, and the only places it goes are Cloudflare DNS (for a
// domain) and RIPEstat, the same two the recon tools already reach.
//
// Dormant-safe throughout: any failure answers { ok:false } with HTTP 200, never a 5xx.
// The answer has no accuracy radius: RIPEstat publishes none, so `radiusKm` is null and
// the map draws the country (lib/recon/geo.ts says why).
export const revalidate = 300; // 5-minute edge cache per target, like the other recon tools

const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";
const DOH = "https://cloudflare-dns.com/dns-query";
const RIPESTAT = "https://stat.ripe.net/data/maxmind-geo-lite/data.json";
/** RIPEstat asks regular callers to name themselves (docs: "sourceapp"). */
const SOURCE_APP = "provenance-online";
const TIMEOUT_MS = 8_000;

/**
 * RIPEstat allows 8 requests at a time from one IP. This instance never holds more than
 * that open, so a burst of look-ups waits here instead of being refused there.
 */
const MAX_IN_FLIGHT = 8;
let inFlight = 0;
const waiting: (() => void)[] = [];
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((resolve) => waiting.push(resolve));
  inFlight++;
  try {
    return await fn();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

async function resolveA(domain: string): Promise<string | null> {
  try {
    const res = await fetch(`${DOH}?name=${encodeURIComponent(domain)}&type=A`, {
      headers: { accept: "application/dns-json", "user-agent": UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const a = parseDoh((await res.json()) as DohResponse).find((r) => r.type === "A");
    return a ? a.value : null;
  } catch {
    return null;
  }
}

async function fetchRipe(ip: string): Promise<RipeGeoResponse | null> {
  return withSlot(async () => {
    try {
      const url = `${RIPESTAT}?resource=${encodeURIComponent(ip)}&sourceapp=${SOURCE_APP}`;
      const res = await fetch(url, {
        headers: { accept: "application/json", "user-agent": UA },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as RipeGeoResponse;
      return json?.status === "ok" ? json : null;
    } catch {
      return null;
    }
  });
}

function fail(target: string, reason: string): Response {
  const body: GeoResult = { ok: false, target, locations: [], source: "geolite2-ripestat", reason };
  return Response.json(body);
}

export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get("target") ?? "").trim();
  const kind = detectKind(raw);
  if (kind !== "ip" && kind !== "domain") return fail(raw, "IP location needs an IP or a domain.");
  const target = normalizeTarget(raw, kind);
  try {
    const ip = kind === "ip" ? target : await resolveA(target);
    if (!ip) return fail(target, "The domain has no A record to locate.");
    const json = await fetchRipe(ip);
    if (!json) return fail(target, "RIPEstat did not answer. Nothing is drawn.");
    const { locations, dataDate } = parseRipeGeo(json);
    const body: GeoResult = {
      ok: true,
      target,
      ip,
      ...(kind === "domain" ? { resolvedFrom: target } : {}),
      locations,
      source: "geolite2-ripestat",
      ...(dataDate ? { dataDate } : {}),
    };
    return Response.json(body);
  } catch {
    return fail(target, "IP location failed.");
  }
}
