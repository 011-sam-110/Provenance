import { expect, test } from "vitest";
import feodo from "@/tests/fixtures/feodo-c2.json";
import ransomware from "@/tests/fixtures/ransomware-victims.json";
import { normalizeFeodoC2, c2Color, CYBER_C2_SOURCE, readFeodo, FEODO_ATTRIBUTION } from "@/lib/signals/cyber-c2";
import {
  normalizeRansomware,
  ransomwareColor,
  CYBER_RANSOMWARE_SOURCE,
  ransomwareRequest,
  rowsFromBody,
  unplacedCount,
} from "@/lib/signals/cyber-ransomware";
import { countMagnitude, groupByCountry, toNum } from "@/lib/signals/aggregate";
import { centroidByIso2 } from "@/lib/signals/country-centroids.data";
import { rowMetric } from "@/lib/console/signals/signalCard";

// Read the fixture as if on the day after its US sighting, while those rows are current.
const FEODO_NOW = Date.parse("2026-03-13T00:00:00Z");

test("Feodo C2 aggregates by country, skipping rows with no/garbled country", () => {
  const out = normalizeFeodoC2(feodo as never, FEODO_NOW);
  expect(out).toHaveLength(3); // US, GB, JP — the null-country row is skipped
  const us = out.find((f) => f.id === "cyber-c2:US")!;
  expect(us.props?.c2Servers).toBe(2);
  expect(us.props?.online).toBe(1); // 1 online (QakBot) + 1 offline (Emotet)
  expect(us.props?.offline).toBe(1);
  expect(us.props?.malware).toBe("Emotet, QakBot");
  // Marker sits at the country centroid.
  const ctr = centroidByIso2("US")!;
  expect(us.lat).toBe(ctr.lat);
  expect(us.lon).toBe(ctr.lon);
  expect(us.color).toBe(c2Color(2));
  expect(us.ts).toBeUndefined(); // snapshot, never time-filtered

  // Metric resolves the REAL C2 count (not the log-radius magnitude proxy).
  expect(CYBER_C2_SOURCE.metric).toEqual({ field: "c2Servers", domain: [1, 20] });
  const m = rowMetric(us, CYBER_C2_SOURCE.metric)!;
  expect(m.value).toBe(2);
  expect(m.domain).toEqual([1, 20]);
  expect(m.label).toBe("2");
});

test("Ransomware.live aggregates recent victims by country with gangs + sectors", () => {
  const out = normalizeRansomware(ransomware as never);
  expect(out).toHaveLength(6); // 6 distinct countries; the empty-country row is skipped
  const us = out.find((f) => f.id === "cyber-ransomware:US")!;
  expect(us.props?.victims).toBe(1);
  expect(us.props?.gangs).toBe("dragonforce");
  expect(us.props?.sectors).toBe("Technology");
  expect(us.color).toBe(ransomwareColor(1));

  // Metric resolves the REAL victim count (not the log-radius magnitude proxy).
  expect(CYBER_RANSOMWARE_SOURCE.metric).toEqual({ field: "victims", domain: [1, 15] });
  const m = rowMetric(us, CYBER_RANSOMWARE_SOURCE.metric)!;
  expect(m.value).toBe(1);
  expect(m.domain).toEqual([1, 15]);
  expect(m.label).toBe("1");
});

test("aggregate helpers: log-scaled magnitude, country grouping, numeric coercion", () => {
  expect(countMagnitude(0)).toBe(0);
  expect(countMagnitude(1)).toBe(2); // clamped up so a lone marker stays visible
  expect(countMagnitude(100)).toBeCloseTo(8, 1);
  expect(countMagnitude(10_000_000)).toBe(10); // clamped down

  const grouped = groupByCountry([{ c: "us" }, { c: "US" }, { c: "" }, { c: null }], (r) => r.c);
  expect(grouped.get("US")).toHaveLength(2); // case-folded, empties dropped
  expect(grouped.size).toBe(1);

  expect(toNum("0")).toBe(0);
  expect(toNum(1234)).toBe(1234);
  expect(toNum("-")).toBe(0);
});

test("Feodo: a C2 not seen for months is history, and a stale 'online' is not believed", () => {
  // The live file on 2026-10-16: five leftovers, newest sighting 2026-03-12, one still
  // flagged "online" from the last check before the dataset froze.
  const rows = [
    { ip_address: "50.16.16.211", status: "online", country: "US", malware: "QakBot", last_online: "2026-03-12" },
    { ip_address: "162.243.103.246", status: "offline", country: "US", malware: "Emotet", last_online: "2026-03-07" },
  ];
  const oct = Date.parse("2026-10-16T19:00:00Z");
  expect(normalizeFeodoC2(rows as never, oct)).toEqual([]);
  const read = readFeodo(rows as never, oct);
  expect(read.features).toEqual([]);
  expect(read.reason).toBe("no current C2s; newest sighting 2026-03-12");

  // Ten days after the last sighting it is still tracked, but no longer "online".
  const tenDays = Date.parse("2026-03-22T00:00:00Z");
  const us = normalizeFeodoC2(rows as never, tenDays)[0]!;
  expect(us.props?.c2Servers).toBe(2);
  expect(us.props?.online).toBe(0);
  expect(us.props?.lastSeen).toBe("2026-03-12");
});

test("Feodo: an empty list is a degraded read, never a quiet world", () => {
  expect(readFeodo([]).reason).toBe("Feodo Tracker dataset is empty");
  expect(FEODO_ATTRIBUTION).not.toMatch(/CC0/);
});

test("Ransomware.live: every request is pinned to IPv4, and the key picks the PRO endpoint", () => {
  // Prod 404'd for five weeks while every IPv4 vantage point got 200: the host has an
  // AAAA record and the free API has no IPv6 support. The family pin is the fix.
  const keyless = ransomwareRequest(undefined);
  expect(keyless.options.family).toBe(4);
  expect(keyless.keyed).toBe(false);
  expect(keyless.url).toBe("https://api.ransomware.live/v2/recentvictims");
  expect((keyless.options.headers as Record<string, string>)["X-API-KEY"]).toBeUndefined();

  const blank = ransomwareRequest("   ");
  expect(blank.keyed).toBe(false);

  const keyed = ransomwareRequest("k-123");
  expect(keyed.options.family).toBe(4);
  expect(keyed.url).toBe("https://api-pro.ransomware.live/victims/recent");
  expect((keyed.options.headers as Record<string, string>)["X-API-KEY"]).toBe("k-123");
});

test("Ransomware.live: bare array or a wrapped list, and claims with no country are counted", () => {
  const rows = [{ victim: "a", country: "US" }, { victim: "b", country: "" }, { victim: "c" }];
  expect(rowsFromBody(rows)).toHaveLength(3);
  expect(rowsFromBody({ victims: rows })).toHaveLength(3);
  expect(rowsFromBody({ nope: 1 })).toBeNull();
  expect(unplacedCount(rows as never)).toBe(2);
  const out = normalizeRansomware(rows as never);
  expect(out).toHaveLength(1);
  expect(out[0]!.props?.windowNote).toBe("Of the 3 newest claims, 2 name no country and are not on the map.");
});
