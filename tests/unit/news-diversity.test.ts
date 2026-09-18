import { expect, test } from "vitest";
import { universeFrom, coverageProfile, blindspotReport, BLINDSPOT_CAVEAT } from "@/lib/news/diversity";
import { clusterNews } from "@/lib/news/cluster";
import type { NewsItem } from "@/lib/news";

const T0 = 1_758_000_000_000;
const item = (title: string, source: string, i = 0): NewsItem => ({ title, source, url: `https://x/${source}/${i}`, ts: T0 - i * 60_000 });

/** A story carried by four outlets across three regions. */
function story(): NewsItem[] {
  return [
    item("UN experts say grounds to believe US committed war crimes in Iran strikes", "BBC", 1),
    item("UN mission says grounds to believe US committed war crimes in Iran", "France 24", 2),
    item("UN experts say US may have committed war crimes with Iran strikes", "CBS News", 3),
    item("UN experts say grounds to believe US committed war crimes in Iran", "SCMP", 4),
  ];
}

test("coverageProfile counts the kinds of newsroom that carried a story", () => {
  const c = clusterNews(story())[0];
  const p = coverageProfile(c);
  expect(p.sourceCount).toBe(4);
  expect(p.summary).toMatch(/^4 sources: /);
  // BBC + France 24 are state-funded public broadcasters; CBS + SCMP are not.
  expect(p.stateFunded).toBe(2);
  expect(p.byRegion.map((s) => s.label).sort()).toEqual(["Asia", "Europe", "UK", "US"]);
  expect(p.byType.reduce((a, s) => a + s.count, 0)).toBe(4);
});

test("the diversity summary reads as a sentence, singular and plural", () => {
  const one = clusterNews([item("A lone report nobody else carried anywhere", "BBC")])[0];
  expect(coverageProfile(one).summary).toBe("1 source: 1 public broadcaster");
  const two = clusterNews([
    item("Bank of Japan raises rates to 31-year high as inflation rises", "Reuters", 1),
    item("Bank of Japan raises rates to 31-year high amid inflation", "Associated Press", 2),
  ])[0];
  expect(coverageProfile(two).summary).toBe("2 sources: 2 newswires");
});

test("a blindspot names the regions in the pull that the story is missing from", () => {
  const pull = [...story(), item("Unrelated domestic politics story from Israel today", "The Jerusalem Post", 9)];
  const universe = universeFrom(pull);
  expect(universe.regions).toContain("Middle East");
  const c = clusterNews(pull).find((x) => x.sourceCount === 4)!;
  const r = blindspotReport(c, universe);
  expect(r.inconclusive).toBe(false);
  expect(r.missingRegions).toEqual(["Middle East"]);
  expect(r.absentSources).toEqual(["The Jerusalem Post"]);
  expect(r.claim).toContain("Not in the latest headlines from Middle East");
  expect(r.caveat).toBe(BLINDSPOT_CAVEAT);
});

test("a single-source story is inconclusive, never a blindspot finding", () => {
  const pull = [...story(), item("A story only one outlet carried at all", "Reuters", 9)];
  const universe = universeFrom(pull);
  const lone = clusterNews(pull).find((x) => x.sourceCount === 1)!;
  const r = blindspotReport(lone, universe);
  expect(r.inconclusive).toBe(true);
  expect(r.claim).toBeNull();
});

test("a pull too narrow to compare produces no claim, however many sources agree", () => {
  // Three UK/US outlets only: every story on earth would look like an Asia blindspot.
  const narrow = [
    item("Shared story reported by three outlets in two regions", "BBC", 1),
    item("Shared story reported by three outlets in two regions today", "Sky News", 2),
    item("Shared story reported by three outlets across two regions", "NPR", 3),
  ];
  const universe = universeFrom(narrow);
  expect(universe.regions.length).toBeLessThan(3);
  const c = clusterNews(narrow)[0];
  expect(c.sourceCount).toBe(3);
  const r = blindspotReport(c, universe);
  expect(r.inconclusive).toBe(true);
  expect(r.claim).toBeNull();
});

test("a story carried everywhere says so rather than inventing a gap", () => {
  const universe = universeFrom(story());
  const c = clusterNews(story())[0];
  const r = blindspotReport(c, universe);
  expect(r.missingRegions).toEqual([]);
  expect(r.claim).toContain("every region in this pull");
});
