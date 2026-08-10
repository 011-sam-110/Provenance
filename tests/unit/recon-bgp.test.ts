import { describe, expect, it } from "vitest";
// Fixture shapes are verbatim captures from stat.ripe.net on 2026-08-10 (AS13335 /
// 1.1.1.1), trimmed to the fields we read. The previous version of this file
// tested BGPView, whose host has since shut down entirely.
import {
  MAX_PREFIXES,
  parseBgpAsn,
  parseBgpIp,
  type RipeAnnouncedPrefixes,
  type RipeAsOverview,
  type RipeNetworkInfo,
  type RipePrefixOverview,
  type RipeReverseDns,
} from "@/lib/recon/bgp";

const networkInfo: RipeNetworkInfo = { status: "ok", data: { asns: ["13335"], prefix: "1.1.1.0/24" } };
const prefixOverview: RipePrefixOverview = {
  status: "ok",
  data: {
    resource: "1.1.1.0/24",
    announced: true,
    is_less_specific: false,
    asns: [{ asn: 13335, holder: "CLOUDFLARENET - Cloudflare, Inc." }],
    block: { resource: "1.0.0.0/8", desc: "APNIC (Status: ALLOCATED)", name: "IANA IPv4 Address Space Registry" },
  },
};
const reverseDns: RipeReverseDns = { status: "ok", data: { result: ["one.one.one.one"], error: "" } };

const asOverview: RipeAsOverview = {
  status: "ok",
  data: {
    resource: "13335",
    holder: "CLOUDFLARENET - Cloudflare, Inc.",
    announced: true,
    block: { resource: "13312-15359", desc: "Assigned by ARIN", name: "IANA 16-bit AS Numbers Registry" },
  },
};

describe("parseBgpIp", () => {
  it("maps the covering prefix, origin ASN, holder and PTR", () => {
    const r = parseBgpIp({ ip: "1.1.1.1", networkInfo, prefixOverview, reverseDns });
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("ip");
    expect(r.ip).toBe("1.1.1.1");
    expect(r.ptr).toBe("one.one.one.one");
    expect(r.asn).toBe(13335);
    expect(r.name).toBe("CLOUDFLARENET - Cloudflare, Inc.");
    expect(r.announced).toBe(true);
    expect(r.rir).toBe("APNIC (Status: ALLOCATED)");
    expect(r.prefixes).toEqual([
      { prefix: "1.1.1.0/24", asn: 13335, holder: "CLOUDFLARENET - Cloudflare, Inc.", country: "" },
    ]);
  });

  // Reverse DNS very often has no record. Losing the whole lookup over that
  // would be worse than showing what we do know.
  it("keeps a partial answer when reverse DNS has nothing", () => {
    const r = parseBgpIp({
      ip: "1.1.1.1",
      networkInfo,
      prefixOverview,
      reverseDns: { status: "ok", data: { result: [], error: "no record" } },
    });
    expect(r.ok).toBe(true);
    expect(r.ptr).toBeUndefined();
    expect(r.asn).toBe(13335);
  });

  it("falls back to network-info's ASN string when prefix-overview is missing", () => {
    const r = parseBgpIp({ ip: "1.1.1.1", networkInfo, prefixOverview: null, reverseDns: null });
    expect(r.prefixes[0].prefix).toBe("1.1.1.0/24");
    expect(r.asn).toBe(13335);
    expect(r.announced).toBeUndefined(); // we did not learn it — so we do not claim it
  });

  it("returns an honest empty result when RIPEstat did not say ok", () => {
    const r = parseBgpIp({
      ip: "1.1.1.1",
      networkInfo: { status: "error" },
      prefixOverview: { status: "error" },
      reverseDns: null,
    });
    expect(r.ok).toBe(false);
    expect(r.prefixes).toEqual([]);
  });

  it("rejects an empty target rather than inventing a result", () => {
    expect(parseBgpIp({ ip: "" }).ok).toBe(false);
  });
});

describe("parseBgpAsn", () => {
  const announced = (n: number): RipeAnnouncedPrefixes => ({
    status: "ok",
    data: { prefixes: Array.from({ length: n }, (_, i) => ({ prefix: `104.29.${i}.0/24` })) },
  });

  it("maps holder, routing visibility and the allocating registry", () => {
    const r = parseBgpAsn({ asn: 13335, overview: asOverview, announced: announced(3) });
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("asn");
    expect(r.asn).toBe(13335);
    expect(r.name).toBe("CLOUDFLARENET - Cloudflare, Inc.");
    expect(r.announced).toBe(true);
    expect(r.rir).toBe("Assigned by ARIN");
    expect(r.prefixes).toHaveLength(3);
    expect(r.prefixCount).toBe(3);
  });

  // Cloudflare announces ~5,300 prefixes. The list is capped for the widget, but
  // the honest total still has to reach the UI.
  it("caps the list but reports the true total", () => {
    const r = parseBgpAsn({ asn: 13335, overview: asOverview, announced: announced(5326) });
    expect(r.prefixes).toHaveLength(MAX_PREFIXES);
    expect(r.prefixCount).toBe(5326);
  });

  // An allocated ASN that nobody routes is a real, interesting answer.
  it("reports an unrouted ASN as announced:false, not as a failure", () => {
    const r = parseBgpAsn({
      asn: 64500,
      overview: { status: "ok", data: { resource: "64500", holder: "EXAMPLE-AS", announced: false } },
      announced: { status: "ok", data: { prefixes: [] } },
    });
    expect(r.ok).toBe(true);
    expect(r.announced).toBe(false);
    expect(r.prefixes).toEqual([]);
    expect(r.prefixCount).toBe(0);
  });

  it("returns an honest empty result when both calls failed", () => {
    const r = parseBgpAsn({ asn: 13335, overview: null, announced: null });
    expect(r.ok).toBe(false);
    expect(r.prefixes).toEqual([]);
  });

  it("rejects a non-numeric ASN", () => {
    expect(parseBgpAsn({ asn: Number.NaN }).ok).toBe(false);
  });
});
