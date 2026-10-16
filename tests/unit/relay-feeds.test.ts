import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CameraSchema } from "@/lib/types";
import { RELAY_FEEDS, RELAY_FEED_IDS, RELAY_TLE_GROUPS, type RelayData, type RelayFeedId } from "@/lib/relay/feeds";
import {
  EAQI_BANDS,
  eaqiBand,
  eeaStationsFrom,
  gnssNavWarningsFrom,
  hhsBreachesFrom,
  jmaVolcamCamerasFrom,
  nrcanActivityFrom,
  nrcanRank,
  shadowserverCountsFrom,
  texasBreachesFrom,
  usable,
} from "@/lib/relay/read";
import type { RelaySnapshot } from "@/lib/relay/store";
import { SATELLITE_GROUPS } from "@/lib/sources/celestrak";

// The fixtures are real envelopes captured on 2026-10-16 with
// `python -m sources push <feed> --dry-run --out` in the NewsScraper repo, trimmed in
// length (never edited in content) where the feed is large.
const DIR = join(__dirname, "..", "fixtures", "relay");
const envelope = (feed: string) => JSON.parse(readFileSync(join(DIR, `${feed}.json`), "utf8"));

function snapshot<F extends RelayFeedId>(feed: F): RelaySnapshot<RelayData<F>> {
  const env = envelope(feed);
  const parsed = RELAY_FEEDS[feed].schema.parse(env.data) as RelayData<F>;
  const fetchedAt = Date.parse(env.fetchedAt);
  return { data: parsed, fetchedAt, receivedAt: fetchedAt + 1000 };
}

describe("relay feed table", () => {
  it("has a captured fixture for every feed, and no fixture for a feed it does not list", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
    expect(files).toEqual([...RELAY_FEED_IDS].sort());
  });

  it.each(RELAY_FEED_IDS)("%s: the captured payload passes its schema and fits its cap", (feed) => {
    const env = envelope(feed);
    expect(env.feed).toBe(feed);
    expect(RELAY_FEEDS[feed].schema.safeParse(env.data).success).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(env))).toBeLessThan(RELAY_FEEDS[feed].maxBytes);
  });

  it("lists exactly the TLE groups the satellites route allows", () => {
    expect([...RELAY_TLE_GROUPS]).toEqual([...SATELLITE_GROUPS]);
  });

  it("refuses a JMA frame on any host but JMA's own", () => {
    const env = envelope("jma-volcam");
    env.data.cameras[0].imageUrl = "https://example.com/frame.jpg";
    expect(RELAY_FEEDS["jma-volcam"].schema.safeParse(env.data).success).toBe(false);
  });

  it("never stores a Texas street address, even when a sender includes one", () => {
    // zod drops unknown keys by default; this pins that the stored row has no address.
    const env = envelope("texas-ag-breach");
    env.data.rows[0].address = "1 Main St";
    const parsed = RELAY_FEEDS["texas-ag-breach"].schema.parse(env.data) as RelayData<"texas-ag-breach">;
    expect(parsed.rows[0]).not.toHaveProperty("address");
  });
});

describe("readers", () => {
  it("drops a snapshot older than its feed's max age", () => {
    const snap = snapshot("nrcan-magnetic");
    expect(usable("nrcan-magnetic", snap, snap.fetchedAt + RELAY_FEEDS["nrcan-magnetic"].maxAgeMs)).toBe(snap);
    expect(usable("nrcan-magnetic", snap, snap.fetchedAt + RELAY_FEEDS["nrcan-magnetic"].maxAgeMs + 1)).toBeNull();
    expect(usable("nrcan-magnetic", null, 0)).toBeNull();
  });

  it("nrcan: ranks NRCan's own words and refuses to guess at a new one", () => {
    expect(nrcanRank("Quiet")).toBe(0);
    expect(nrcanRank("major storm")).toBe(4);
    expect(nrcanRank("severe")).toBeNull();
    const snap = snapshot("nrcan-magnetic");
    const a = nrcanActivityFrom(snap, snap.fetchedAt + 60_000);
    expect(a.ageMs).toBe(60_000);
    expect(Object.keys(a.windows).sort()).toEqual(["current", "last24h", "last6h", "next24h", "next6h"]);
    expect(a.windows.last24h?.auroral).toEqual({ level: "unsettled", rank: 1, intervals: "active" });
  });

  it("jma-volcam: every relayed camera becomes a valid registry Camera pinned to its named site", () => {
    const snap = snapshot("jma-volcam");
    const cams = jmaVolcamCamerasFrom(snap, snap.fetchedAt);
    expect(cams.length).toBe(snap.data.cameras.length);
    for (const cam of cams) expect(CameraSchema.safeParse(cam).success).toBe(true);
    expect(cams[0]).toMatchObject({
      id: "jma-volcam:10401",
      country: "JP",
      name: "アトサヌプリ 北東山麓",
      lat: 43.638,
      lon: 144.465,
      available: true,
    });
    // A frame two hours old is not "live".
    expect(jmaVolcamCamerasFrom(snap, Date.parse(snap.data.cameras[0].frameAt) + 2 * 3600_000)[0].available).toBe(false);
  });

  it("navwarn: keeps only the satellite-navigation warnings, and keeps their areas", () => {
    const snap = snapshot("sjofartsverket-navwarn");
    const w = gnssNavWarningsFrom(snap, snap.fetchedAt);
    expect(w.warnings.map((x) => x.id)).toEqual(["BALTIC SEA NAV WARN 030/26"]);
    expect(w.warnings[0].areas).toContain("Southern Baltic");
    expect(w.warnings[0].issuedAt).toBe("2026-10-12T09:12:00Z");
    expect(snap.data.warnings.length).toBeGreaterThan(1);
  });

  it("shadowserver: sorts countries by count and keeps the two sources apart", () => {
    const beacon = shadowserverCountsFrom(snapshot("shadowserver-beacon"), Date.now());
    expect(beacon.source).toBe("beacon");
    expect(beacon.countries[0]).toEqual({ iso2: "US", count: 460 });
    expect(beacon.total).toBe(beacon.countries.reduce((n, c) => n + c.count, 0));
    const sinkhole = shadowserverCountsFrom(snapshot("shadowserver-sinkhole"), Date.now());
    expect(sinkhole.source).toBe("sinkhole");
    expect(sinkhole.total).toBeGreaterThan(beacon.total);
  });

  it("eea-aqi: the band is the integer part of the EEA float, clamped to the six named bands", () => {
    expect(eaqiBand(1.99)).toBe(1);
    expect(eaqiBand(2.43)).toBe(2);
    expect(eaqiBand(6.8)).toBe(6);
    expect(eaqiBand(0.4)).toBe(1);
    const s = eeaStationsFrom(snapshot("eea-aqi"), Date.now());
    expect(s.stations.length).toBeGreaterThan(100);
    for (const st of s.stations) expect(EAQI_BANDS[st.band - 1]).toBe(st.bandLabel);
  });

  it("hhs: hackingOnly keeps the Hacking/IT Incident rows and nothing else", () => {
    const snap = snapshot("hhs-ocr-breach");
    const all = hhsBreachesFrom(snap, snap.fetchedAt);
    const hacking = hhsBreachesFrom(snap, snap.fetchedAt, { hackingOnly: true });
    expect(hacking.rows.length).toBeGreaterThan(0);
    expect(hacking.rows.length).toBeLessThan(all.rows.length);
    for (const r of hacking.rows) expect(r.breachType).toMatch(/Hacking/);
  });

  it("texas: a day window keeps only recent rows, newest first", () => {
    const snap = snapshot("texas-ag-breach");
    const now = Date.parse(`${snap.data.rows[0].publishedOn}T12:00:00Z`);
    const recent = texasBreachesFrom(snap, now, { days: 7 });
    expect(recent.rows.length).toBeGreaterThan(0);
    expect(recent.rows.length).toBeLessThanOrEqual(snap.data.rows.length);
    const days = recent.rows.map((r) => r.publishedOn);
    expect([...days].sort().reverse()).toEqual(days);
  });
});
