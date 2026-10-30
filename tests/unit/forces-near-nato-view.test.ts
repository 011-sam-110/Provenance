import { describe, expect, it } from "vitest";
import { NATO_SITES, type NatoSite } from "@/lib/signals/forces-near-nato.data";
import {
  citedLine,
  groupSites,
  longDate,
  newestDate,
  shortDate,
  statLine,
  unplacedNote,
} from "@/lib/console/widgets/war/forces-near-nato.view";

const site = (id: string, border: NatoSite["border"], at: NatoSite["at"] = { lat: 60, lon: 30, gazetteer: "Wikidata Q1" }): NatoSite => ({
  id,
  summary: "A line",
  name: id,
  unit: null,
  region: "R",
  border,
  distance: null,
  at,
  claims: [{ quote: "a quote long enough to carry a claim", outlet: "Outlet", attributedTo: "Someone", date: "2026-10-19", url: "https://x.example/" }],
});

describe("the Forces near NATO card's words", () => {
  it("groups by border north to south, then the deep reserve, and drops empty groups", () => {
    const g = groupSites([site("a", "deep"), site("b", "nordic"), site("c", "deep")]);
    expect(g.map((x) => x.label)).toEqual(["Finland and Norway", "Deep reserve"]);
    expect(g[1].sites.map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("puts every curated site in exactly one group", () => {
    const n = groupSites(NATO_SITES).reduce((k, g) => k + g.sites.length, 0);
    expect(n).toBe(NATO_SITES.length);
  });

  it("writes dates as calendar dates and refuses a bad one", () => {
    expect(shortDate("2026-10-19")).toBe("19 Oct");
    expect(longDate("2026-01-03")).toBe("3 Jan 2026");
    expect(shortDate("2026-13-01")).toBe("");
    expect(longDate("soon")).toBe("");
  });

  it("dates a site by its newest claim", () => {
    const s = site("a", "baltic");
    s.claims = [...s.claims, { ...s.claims[0], date: "2026-10-16" }];
    expect(newestDate(s)).toBe("2026-10-19");
  });

  it("lowers an article after 'citing' and leaves a name alone", () => {
    expect(citedLine({ outlet: "UNITED24 Media", attributedTo: "A June 2026 investigation" })).toBe("UNITED24 Media, citing a June 2026 investigation");
    expect(citedLine({ outlet: "UA.NEWS", attributedTo: "Iceye, a Finnish satellite company" })).toBe("UA.NEWS, citing Iceye, a Finnish satellite company");
    expect(citedLine({ outlet: "Kyiv Post", attributedTo: "OSINT analysts" })).toBe("Kyiv Post, citing OSINT analysts");
  });

  it("counts sites, claims and outlets", () => {
    const a = site("a", "baltic");
    const b = site("b", "nordic");
    b.claims = [...b.claims, { ...b.claims[0], outlet: "Other" }];
    expect(statLine([a, b])).toBe("2 sites, 3 claims from 2 outlets");
    expect(statLine([a])).toBe("1 site, 1 claim from 1 outlet");
  });

  it("says when a listed site is not drawn, and is silent when all are", () => {
    expect(unplacedNote([site("a", "baltic")])).toBeNull();
    expect(unplacedNote([site("a", "baltic", null)])).toMatch(/^1 site is listed but not on the map/);
    expect(unplacedNote([site("a", "baltic", null), site("b", "deep", null)])).toMatch(/^2 sites are listed/);
  });

  it("uses no em dash in any line it writes", () => {
    const lines = [
      statLine(NATO_SITES),
      unplacedNote(NATO_SITES) ?? "",
      ...NATO_SITES.flatMap((s) => [s.summary, s.name, s.distance ?? "", ...s.claims.map(citedLine)]),
    ];
    for (const l of lines) expect(l, l).not.toContain("—");
  });
});
