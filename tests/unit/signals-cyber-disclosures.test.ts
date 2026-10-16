import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeSec, normalizeWa, companyName, CYBER_DISCLOSURES_SOURCE, DISCLOSURE_DAYS } from "@/lib/signals/cyber-disclosures";
import { parseDshieldBlocklist, normalizeDshield, CYBER_ATTACKERS_SOURCE } from "@/lib/signals/cyber-attackers";
import { US_STATE_ANCHORS, stateAnchor } from "@/lib/signals/us-state-anchors.data";

// Real captures of 2026-10-16: EDGAR full-text search for "Item 1.05" in 8-Ks since
// 2026-07-18 (13 hits), eight Washington AG breach notices, and the DShield block list.

const fx = (name: string) => readFileSync(join(process.cwd(), "tests", "fixtures", name), "utf8");
const NOW = Date.parse("2026-10-16T21:30:00Z");

describe("SEC 8-K Item 1.05 disclosures", () => {
  const hits = (JSON.parse(fx("sec-8k-item105.json")) as { hits: { hits: never[] } }).hits.hits;
  const out = normalizeSec(hits, NOW);

  it("keeps only filings that list Item 1.05, one feature per filing", () => {
    // 13 hits: some only mention "Item 1.05" in an 8.01 update or an exhibit, and Park
    // Dental filed twice. Each kept filing is a distinct accession number.
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(hits.length);
    expect(new Set(out.map((f) => f.id)).size).toBe(out.length);
    expect(out.every((f) => f.props?.source === "SEC Form 8-K, Item 1.05")).toBe(true);
    expect(out.some((f) => f.props?.organisation === "Upbound Group, Inc.")).toBe(false); // 8.01 only
  });

  it("places a filing on its head-office state, says so, and links the filing", () => {
    const amgen = out.find((f) => f.props?.organisation === "Amgen Inc")!;
    expect(amgen.title).toBe("Material cyber incident disclosed — Amgen Inc");
    expect(amgen.props?.headOffice).toBe("Thousand Oaks, CA");
    expect(amgen.lat).toBe(US_STATE_ANCHORS.CA!.lat);
    expect(String(amgen.props?.placed)).toMatch(/Not where the attack happened/);
    expect(amgen.link).toMatch(/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/318154\/000031815426000119\//);
    expect(amgen.ts).toBe("2026-07-31T00:00:00.000Z");
  });

  it("drops a filing older than the window, and a filer with no US state", () => {
    expect(normalizeSec(hits, NOW + DISCLOSURE_DAYS * 86_400_000)).toEqual([]);
    const foreign = [{ _id: "x:y.htm", _source: { adsh: "1", items: ["1.05"], file_date: "2026-10-01", biz_states: [] } }];
    expect(normalizeSec(foreign as never, NOW)).toEqual([]);
  });

  it("tidies an EDGAR display name", () => {
    expect(companyName("AMGEN INC  (AMGN)  (CIK 0000318154)")).toBe("Amgen Inc");
    expect(companyName("Park Dental Partners, Inc.  (PARK)  (CIK 0002069604)")).toBe("Park Dental Partners, Inc.");
  });
});

describe("Washington AG ransomware notices", () => {
  const rows = JSON.parse(fx("wa-ag-breaches.json")) as never[];
  const out = normalizeWa(rows, NOW);

  it("keeps the notices tagged Ransomware, on the organisation's own state", () => {
    expect(out.map((f) => f.props?.state).sort()).toEqual(["Georgia", "Washington"]);
    for (const f of out) {
      expect(f.title).toMatch(/^Ransomware breach notice — /);
      expect(f.props?.source).toBe("Washington State Attorney General breach notice");
      expect(typeof f.props?.washingtoniansAffected).toBe("number");
    }
  });
});

describe("US state anchors", () => {
  it("has all fifty states and DC, inside the United States", () => {
    expect(Object.keys(US_STATE_ANCHORS)).toHaveLength(51);
    for (const [code, a] of Object.entries(US_STATE_ANCHORS)) {
      expect(a.lat, code).toBeGreaterThan(18);
      expect(a.lat, code).toBeLessThan(72);
      expect(a.lon, code).toBeLessThan(-66);
    }
    expect(stateAnchor("wa")?.capital).toBe("Olympia");
    expect(stateAnchor("ZZ")).toBeUndefined();
  });
});

describe("DShield top attacking networks", () => {
  const { blocks, updated } = parseDshieldBlocklist(fx("dshield-block.txt"));
  const out = normalizeDshield(blocks);

  it("reads the 20 networks and the file's own update time", () => {
    expect(blocks).toHaveLength(20);
    expect(blocks[0]).toMatchObject({ network: expect.stringMatching(/\/24$/), targets: expect.any(Number) });
    expect(updated).toBeGreaterThan(Date.parse("2026-10-15T00:00:00Z"));
  });

  it("groups by registered country and never places a network with none", () => {
    const placed = blocks.filter((b) => b.country).length;
    expect(out.reduce((s, f) => s + Number(f.props?.networks), 0)).toBe(placed);
    expect(out.every((f) => f.countryIso3)).toBe(true);
    const unplaced = blocks.length - placed;
    if (unplaced > 0) expect(String(out[0]!.props?.unplaced)).toContain(`${unplaced} of the top 20`);
  });

  it("never carries the file's contact e-mail column", () => {
    expect(JSON.stringify(out)).not.toMatch(/@/);
  });
});

describe("the registered sources", () => {
  it("are cyber-threat layers that say what they are", () => {
    expect(CYBER_DISCLOSURES_SOURCE.group).toBe("Cyber threat");
    expect(CYBER_DISCLOSURES_SOURCE.precision).toBe("area");
    expect(CYBER_ATTACKERS_SOURCE.precision).toBe("country");
    expect(CYBER_ATTACKERS_SOURCE.attribution).toContain("CC BY-NC-SA 2.5");
  });
});
