import { expect, test } from "vitest";
import ransomware from "@/tests/fixtures/ransomware-victims.json";
import {
  normalizeRansomware,
  ransomwareColor,
  CYBER_RANSOMWARE_SOURCE,
  ransomwareRequest,
  retryOverIpv4,
  rowsFromBody,
  unplacedCount,
} from "@/lib/signals/cyber-ransomware";
import { countMagnitude, groupByCountry, toNum } from "@/lib/signals/aggregate";
import { httpGetOptions } from "@/lib/signals/httpGet";
import { rowMetric } from "@/lib/console/signals/signalCard";

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

test("Ransomware.live: the key picks the PRO endpoint, and a 404 or a failed connect retries over IPv4", () => {
  // Prod 404'd for five weeks while every IPv4 vantage point got 200: the host has an
  // AAAA record and the free API has no IPv6 support. The IPv4 retry is the fix.
  const keyless = ransomwareRequest(undefined);
  expect(keyless.keyed).toBe(false);
  expect(keyless.url).toBe("https://api.ransomware.live/v2/recentvictims");
  expect(keyless.headers["X-API-KEY"]).toBeUndefined();
  expect(keyless.retryFamily).toBe(4);
  expect(ransomwareRequest("   ").keyed).toBe(false);

  const keyed = ransomwareRequest("k-123");
  expect(keyed.url).toBe("https://api-pro.ransomware.live/victims/recent");
  expect(keyed.headers["X-API-KEY"]).toBe("k-123");

  expect(retryOverIpv4(404)).toBe(true);
  expect(retryOverIpv4("connect-failed")).toBe(true);
  expect(retryOverIpv4(200)).toBe(false);
  expect(retryOverIpv4(401)).toBe(false);
  expect(httpGetOptions({ family: 4 }).family).toBe(4);
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
