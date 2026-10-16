import { afterEach, describe, expect, it } from "vitest";
import type { Camera } from "@/lib/types";
import { dueForProbe, frameFresh, probeVerdict, type FrameProbe } from "@/lib/sources/feedKit";
import { dropNearDuplicates, DUPLICATE_RADIUS_M } from "@/lib/sources/overlap";
import { CAMERA_FEEDS, isDormant } from "@/lib/sources/registry";
import { KEY_REQUIREMENTS, NON_SIGNAL_IDS } from "@/lib/sources/keyRequirements";
import { COMPATIBLE_UA, upstreamRequest } from "@/lib/proxy/allowlist";

// The shared pieces the audit's new camera feeds stand on: dating a still, dropping a
// junction two feeds both carry, a feed that waits for its key, and the server-only
// headers and parameters the media proxy adds.

const cam = (id: string, source: string, lat: number, lon: number): Camera => ({
  id,
  source,
  country: "CA",
  name: id,
  lat,
  lon,
  mediaType: "jpeg",
  refreshSeconds: 60,
  license: "L",
  attribution: "A",
  available: true,
});

describe("dating a still", () => {
  const HOUR = 3_600_000;
  it("is measured at the probe, and a future stamp counts as fresh", () => {
    expect(frameFresh(1_000, 1_000 + HOUR)).toBe(true);
    expect(frameFresh(1_000, 1_000 + HOUR + 1)).toBe(false);
    expect(frameFresh(5_000, 1_000)).toBe(true);
    expect(frameFresh(null, 1_000)).toBe(false);
  });
  it("tells dead, live and unknown apart", () => {
    const p = (o: Partial<FrameProbe>): FrameProbe => ({ at: 10 * HOUR, status: 200, lastModified: null, bytes: null, ...o });
    expect(probeVerdict(undefined)).toBeUndefined();
    expect(probeVerdict(p({ status: 0 }))).toBeUndefined(); // network failure: no evidence
    expect(probeVerdict(p({ status: 404 }))).toBe(false); // the host said no
    expect(probeVerdict(p({}))).toBeUndefined(); // answered, but undated
    expect(probeVerdict(p({ lastModified: 9.5 * HOUR }))).toBe(true);
    expect(probeVerdict(p({ lastModified: 8 * HOUR }))).toBe(false);
  });
  it("asks again only after the revisit interval", () => {
    const memo = new Map<string, FrameProbe>([["a", { at: 1_000, status: 200, lastModified: 1_000, bytes: 1 }]]);
    const items = [{ id: "a" }, { id: "b" }];
    expect(dueForProbe(items, memo, 1_500, 1_000).map((i) => i.id)).toEqual(["b"]);
    expect(dueForProbe(items, memo, 2_000, 1_000).map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("one junction, two feeds", () => {
  it("drops a yielding feed's camera within the radius, and only that", () => {
    const relay = cam("castlerock:1", "castlerock", 43.6431, -79.3814);
    const sameJunction = cam("toronto:8001", "toronto", 43.6432, -79.3815); // ~13 m away
    const nextBlock = cam("toronto:8002", "toronto", 43.6431 + 300 / 111_320, -79.3814); // ~300 m
    const other = cam("drivebc:1", "drivebc", 43.6431, -79.3814); // same spot, but no rule
    const out = dropNearDuplicates([relay, sameJunction, nextBlock, other], { toronto: ["castlerock"] });
    expect(out.map((c) => c.id)).toEqual(["castlerock:1", "toronto:8002", "drivebc:1"]);
    expect(DUPLICATE_RADIUS_M).toBe(150);
  });
  it("is a no-op without rules", () => {
    const cams = [cam("a:1", "a", 1, 1), cam("b:1", "b", 1, 1)];
    expect(dropNearDuplicates(cams, {})).toEqual(cams);
  });
});

describe("a feed that waits for its key", () => {
  it("is dormant exactly while its credential is missing", () => {
    expect(isDormant({ keyId: "cams-ottawa" }, {})).toBe(true);
    expect(isDormant({ keyId: "cams-ottawa" }, { OTTAWA_CAMERA_CERT: "x" })).toBe(false);
    expect(isDormant({ keyId: "cams-ne-utmc" }, { NE_UTMC_USER: "u" })).toBe(true); // needs both
    expect(isDormant({}, {})).toBe(false);
  });
  it("names a key the table actually documents, as a non-signal capability", () => {
    const ids = new Set(KEY_REQUIREMENTS.map((r) => r.id));
    const keyed = CAMERA_FEEDS.filter((f) => f.keyId);
    expect(keyed.length).toBeGreaterThan(0);
    for (const f of keyed) {
      expect(ids.has(f.keyId!), f.key).toBe(true);
      expect(NON_SIGNAL_IDS.has(f.keyId!), f.key).toBe(true);
    }
  });
  it("yields only to feeds that exist", () => {
    const keys = new Set(CAMERA_FEEDS.map((f) => f.key));
    for (const f of CAMERA_FEEDS) for (const t of f.yieldsTo ?? []) expect(keys.has(t), `${f.key} -> ${t}`).toBe(true);
  });
});

describe("what the media proxy adds on the server", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("sends the crawler-form agent to the NSW image host", () => {
    const r = upstreamRequest(new URL("https://webcams.transport.nsw.gov.au/livetraffic-webcams/cameras/5_ways_miranda.jpeg"));
    expect(r?.headers["User-Agent"]).toBe(COMPATIBLE_UA);
    expect(COMPATIBLE_UA).toMatch(/^Mozilla\/5\.0 \(compatible; Provenance\/1\.0; \+https:\/\/provenance-online\.com\)$/);
  });

  it("adds Ottawa's certificate only on the server, and refuses while it is missing", () => {
    delete process.env.OTTAWA_CAMERA_CERT;
    expect(upstreamRequest(new URL("https://traffic.ottawa.ca/opendata/camera?c=49"))).toBeNull();
    process.env.OTTAWA_CAMERA_CERT = "test-cert";
    const r = upstreamRequest(new URL("https://traffic.ottawa.ca/opendata/camera?c=49"))!;
    const u = new URL(r.url);
    expect(u.searchParams.get("c")).toBe("49");
    expect(u.searchParams.get("certificate")).toBe("test-cert");
    expect(u.searchParams.get("id")).toBe("provenance");
  });

  it("adds Basic auth for the Tyne and Wear UTMC image host when the account is set", () => {
    delete process.env.NE_UTMC_USER;
    delete process.env.NE_UTMC_PASS;
    const url = new URL("https://www.netraveldata.co.uk/api/v2/cctv/images/SL_A1018E1.jpg");
    expect(upstreamRequest(url)?.headers.Authorization).toBeUndefined();
    process.env.NE_UTMC_USER = "u";
    process.env.NE_UTMC_PASS = "p";
    expect(upstreamRequest(url)?.headers.Authorization).toBe("Basic " + Buffer.from("u:p").toString("base64"));
  });

  it("adds nothing for an ordinary host, and refuses one no rule allows", () => {
    expect(upstreamRequest(new URL("https://etraffic.dgt.es/camarasEtraffic/176130.jpg"))).toEqual({
      url: "https://etraffic.dgt.es/camarasEtraffic/176130.jpg",
      headers: {},
    });
    expect(upstreamRequest(new URL("https://evil.example/x.jpg"))).toBeNull();
  });
});
