import { describe, expect, it } from "vitest";
import { BORDER_ORDER, LEFT_OUT, NATO_SITES, type NatoSite } from "@/lib/signals/forces-near-nato.data";
import {
  FORCES_NEAR_NATO_SOURCE,
  newestClaimDate,
  readForcesSummary,
  sitesToFeatures,
} from "@/lib/signals/forces-near-nato";
import { readOutcome } from "@/lib/signals/outcome";
import { readSummary } from "@/lib/signals/summary";

const words = (q: string) => q.replace(/\[[^\]]*\]/g, " ").split(/\s+/).filter(Boolean).length;

describe("the curated Forces near NATO list keeps its rules", () => {
  it("has unique ids and at least one claim per site", () => {
    const ids = NATO_SITES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of NATO_SITES) expect(s.claims.length, s.id).toBeGreaterThan(0);
  });

  it("gives every claim a quote of 30 words or fewer, an https link, a real date and who made it", () => {
    for (const s of NATO_SITES) {
      for (const c of s.claims) {
        expect(words(c.quote), `${s.id}: ${c.quote}`).toBeLessThanOrEqual(30);
        expect(c.quote.length, s.id).toBeGreaterThan(25);
        expect(c.url, s.id).toMatch(/^https:\/\//);
        expect(c.date, s.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Number.isNaN(Date.parse(c.date)), s.id).toBe(false);
        expect(c.attributedTo.trim(), s.id).not.toBe("");
        expect(c.outlet.trim(), s.id).not.toBe("");
      }
    }
  });

  it("translates every quote that is not English, and only those", () => {
    for (const s of NATO_SITES) {
      for (const c of s.claims) {
        expect(Boolean(c.translation), s.id).toBe(c.lang === "ru");
        // A Russian quote is in Cyrillic; an English one is not.
        expect(/[Ѐ-ӿ]/.test(c.quote), s.id).toBe(c.lang === "ru");
      }
    }
  });

  it("places every drawn site in Russia's west or Siberia, never at 0,0", () => {
    for (const s of NATO_SITES) {
      if (!s.at) continue;
      expect(s.at.lat, s.id).toBeGreaterThan(50);
      expect(s.at.lat, s.id).toBeLessThan(72);
      expect(s.at.lon, s.id).toBeGreaterThan(19);
      expect(s.at.lon, s.id).toBeLessThan(90);
      expect(s.at.gazetteer, s.id).toMatch(/^Wikidata Q\d+$/);
    }
  });

  it("keeps each card line inside its quotes: every figure in a summary is in one of them", () => {
    for (const s of NATO_SITES) {
      expect(s.summary.trim(), s.id).not.toBe("");
      const said = s.claims.map((c) => `${c.quote} ${c.translation ?? ""}`).join(" ");
      for (const n of s.summary.match(/\d[\d,]*/g) ?? []) expect(said, `${s.id}: ${n}`).toContain(n);
    }
  });

  it("files every site under a known border group", () => {
    for (const s of NATO_SITES) expect(BORDER_ORDER, s.id).toContain(s.border);
  });

  it("says why each left-out item is not on the layer", () => {
    for (const l of LEFT_OUT) {
      expect(l.why.trim(), l.name).not.toBe("");
      expect(l.url, l.name).toMatch(/^https:\/\//);
    }
  });
});

const SITE: NatoSite = {
  id: "x",
  summary: "A line",
  name: "Town",
  unit: "1st Base",
  region: "Some Oblast",
  border: "baltic",
  distance: "About 100 km from Estonia",
  at: { lat: 58, lon: 30, gazetteer: "Wikidata Q1" },
  claims: [
    { quote: "a claim long enough to carry a fact", outlet: "Outlet A", attributedTo: "Analyst", date: "2026-10-01", url: "https://a.example/1" },
    { quote: "a later claim long enough to carry one", outlet: "Outlet B", attributedTo: "Analyst", date: "2026-10-19", url: "https://b.example/2" },
  ],
};

describe("sitesToFeatures", () => {
  it("draws a site at its town with the first claim, attributed, and its newest date", () => {
    const [f] = sitesToFeatures([SITE]);
    expect(f).toMatchObject({ id: "nato:x", lat: 58, lon: 30, title: "Town: 1st Base", signalId: "forces-near-nato", link: "https://a.example/1" });
    expect(f.ts).toBe("2026-10-19T00:00:00Z");
    expect(f.props).toMatchObject({ faces: "Baltic states", "claimed by": "Analyst", reported: "Outlet A, 2026-10-01", "more claims": 1 });
  });

  it("never draws a site without a town, and never gives it a pin", () => {
    expect(sitesToFeatures([{ ...SITE, at: null }])).toEqual([]);
    for (const f of sitesToFeatures(NATO_SITES)) expect(f.precision).toBeUndefined();
    expect(FORCES_NEAR_NATO_SOURCE.precision).toBe("area");
  });

  it("marks a translated claim as ours", () => {
    const [f] = sitesToFeatures([{ ...SITE, claims: [{ ...SITE.claims[0], lang: "ru", translation: "Our words" }] }]);
    expect(f.props?.claim).toBe("Our words (our translation from Russian)");
  });

  it("dates a site by its newest claim", () => {
    expect(newestClaimDate(SITE)).toBe("2026-10-19T00:00:00Z");
    expect(newestClaimDate({ ...SITE, claims: [] })).toBeUndefined();
  });
});

describe("the layer's fetch", () => {
  it("is compiled, draws the placed sites, and sends the whole list as its summary", async () => {
    const rows = await FORCES_NEAR_NATO_SOURCE.fetch();
    expect(readOutcome(rows)).toMatchObject({ ok: true, basis: "compiled" });
    expect(rows.length).toBe(NATO_SITES.filter((s) => s.at).length);
    const summary = readForcesSummary(JSON.parse(JSON.stringify(readSummary(rows))));
    expect(summary?.sites.length).toBe(NATO_SITES.length);
    expect(summary?.leftOut.length).toBe(LEFT_OUT.length);
  });

  it("rejects a summary of the wrong shape", () => {
    expect(readForcesSummary(undefined)).toBeNull();
    expect(readForcesSummary({ sites: "x", leftOut: [] })).toBeNull();
    expect(readForcesSummary({ sites: [{ id: 1 }], leftOut: [] })).toBeNull();
  });
});
