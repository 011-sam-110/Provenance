import { describe, expect, it } from "vitest";
// Fixtures mirror real gov.uk /api/content/foreign-travel-advice/<slug> responses
// captured on 2026-08-10 (Ukraine carried both "…to parts" statuses; Italy carried
// none), trimmed to the fields we read.
import {
  ADVISORY_LEVELS,
  advisoryBand,
  parseFcdoAdvisory,
  worstLevel,
  type FcdoPayload,
} from "@/lib/geo/travelAdvisory";
import { FCDO_SLUG_BY_ISO2, fcdoSlug } from "@/lib/geo/fcdoSlugs.data";

const ukraine: FcdoPayload = {
  title: "Ukraine travel advice",
  public_updated_at: "2026-08-07T19:00:17+01:00",
  details: {
    alert_status: ["avoid_all_travel_to_parts", "avoid_all_but_essential_travel_to_parts"],
    change_description: "Updated information about Russian invasion of Ukraine ('Warnings and insurance' page).",
    country: { name: "Ukraine", slug: "ukraine" },
  },
};

const italy: FcdoPayload = {
  title: "Italy travel advice",
  public_updated_at: "2026-08-01T09:12:00+01:00",
  details: {
    alert_status: [],
    change_description: "Addition of information about pedestrian safety ('Safety and security' page).",
    country: { name: "Italy", slug: "italy" },
  },
};

describe("worstLevel", () => {
  it("takes the most severe status when several are present", () => {
    expect(worstLevel(["avoid_all_but_essential_travel_to_parts", "avoid_all_travel_to_parts"]).key)
      .toBe("avoid_all_travel_to_parts");
  });

  it("ranks a whole-country warning above the same warning for parts", () => {
    expect(worstLevel(["avoid_all_travel_to_whole_country"]).score)
      .toBeGreaterThan(worstLevel(["avoid_all_travel_to_parts"]).score);
    expect(worstLevel(["avoid_all_travel_to_parts"]).score)
      .toBeGreaterThan(worstLevel(["avoid_all_but_essential_travel_to_whole_country"]).score);
    expect(worstLevel(["avoid_all_but_essential_travel_to_whole_country"]).score)
      .toBeGreaterThan(worstLevel(["avoid_all_but_essential_travel_to_parts"]).score);
  });

  it("treats an EMPTY status list as no warning", () => {
    expect(worstLevel([]).score).toBe(0);
  });

  // Regression. The first version of the level table guessed at token names that
  // do not exist, so Syria — which carries avoid_all_travel_to_whole_country —
  // rendered as a green "No FCDO travel warning". Under-reporting a travel
  // warning is the one error here with real-world consequences, so an
  // unrecognised status must score high, never zero.
  it("never scores an unrecognised warning as zero", () => {
    const l = worstLevel(["some_status_the_fcdo_adds_in_2027"]);
    expect(l.score).toBeGreaterThanOrEqual(4);
    expect(l.band).toBe("high");
    expect(l.label).toMatch(/see gov\.uk/i);
  });

  it("handles the real Syria case", () => {
    expect(worstLevel(["avoid_all_travel_to_whole_country"]).score).toBe(5);
    expect(worstLevel(["avoid_all_travel_to_whole_country"]).label).toBe("Advise against all travel");
  });

  // The complete vocabulary, harvested from all 226 published FCDO country pages
  // on 2026-08-10. If the FCDO adds a fifth token this stays green (UNRECOGNISED
  // covers it safely) but the table should be updated.
  it("covers all four tokens the FCDO actually publishes", () => {
    const real = [
      "avoid_all_travel_to_parts",
      "avoid_all_but_essential_travel_to_parts",
      "avoid_all_travel_to_whole_country",
      "avoid_all_but_essential_travel_to_whole_country",
    ];
    for (const token of real) {
      expect(ADVISORY_LEVELS.some((l) => l.key === token), `${token} is not in the table`).toBe(true);
    }
    expect(ADVISORY_LEVELS).toHaveLength(4);
  });
});

describe("parseFcdoAdvisory", () => {
  it("maps a country with warnings", () => {
    const v = parseFcdoAdvisory(ukraine, "ua")!;
    expect(v.iso2).toBe("UA");
    expect(v.name).toBe("Ukraine");
    expect(v.score).toBe(4);
    expect(v.band).toBe("high");
    expect(v.label).toBe("Advise against all travel to parts");
    expect(v.updated).toBe("2026-08-07");
    expect(v.source).toBe("https://www.gov.uk/foreign-travel-advice/ukraine");
    expect(v.issuer).toContain("Foreign, Commonwealth");
    expect(v.statuses).toHaveLength(2);
    expect(v.message).toContain("Russian invasion");
  });

  // The bug this rewrite exists to kill: "no warning" must not look like
  // "we could not reach the source".
  it("returns a real low-risk view for a country with no warning, not null", () => {
    const v = parseFcdoAdvisory(italy, "IT")!;
    expect(v).not.toBeNull();
    expect(v.score).toBe(0);
    expect(v.band).toBe("low");
    expect(v.label).toBe("No FCDO travel warning");
    expect(v.statuses).toEqual([]);
  });

  it("tolerates a null alert_status", () => {
    const v = parseFcdoAdvisory({ title: "X travel advice", details: { alert_status: null } }, "XX")!;
    expect(v.score).toBe(0);
  });

  it("returns null for junk input rather than a fake view", () => {
    expect(parseFcdoAdvisory(null, "UA")).toBeNull();
    expect(parseFcdoAdvisory(ukraine, "")).toBeNull();
    expect(parseFcdoAdvisory(ukraine, "UKR")).toBeNull();
    expect(parseFcdoAdvisory({}, "UA")).toBeNull();
  });

  it("falls back to the index page when the payload has no slug", () => {
    const v = parseFcdoAdvisory({ title: "Ukraine travel advice", details: { alert_status: [] } }, "UA")!;
    expect(v.source).toBe("https://www.gov.uk/foreign-travel-advice");
  });
});

describe("advisoryBand", () => {
  it("agrees with the level table at every score", () => {
    for (const level of ADVISORY_LEVELS) {
      expect(advisoryBand(level.score).label).toBe(level.label);
    }
    expect(advisoryBand(0).band).toBe("low");
  });
});

describe("the ISO2 → FCDO slug table", () => {
  it("covers the countries a user is most likely to click", () => {
    for (const iso2 of ["UA", "US", "FR", "CN", "RU", "IN", "BR", "NG", "ZA", "JP", "TW", "PS", "SS"]) {
      expect(fcdoSlug(iso2), `${iso2} has no FCDO slug`).toBeTruthy();
    }
  });

  // Not an omission: the FCDO advises UK nationals about FOREIGN travel, so there
  // is no UK page. Clicking the UK correctly gets "the FCDO does not publish
  // advice for this territory" rather than a blank or a fabricated all-clear.
  it("has no entry for the UK itself, which is correct", () => {
    expect(fcdoSlug("GB")).toBeUndefined();
  });

  it("is case-insensitive and honest about territories the FCDO does not cover", () => {
    expect(fcdoSlug("ua")).toBe("ukraine");
    // Not a country the FCDO publishes advice for — undefined, never a guess.
    expect(fcdoSlug("ZZ")).toBeUndefined();
    expect(fcdoSlug("")).toBeUndefined();
  });

  it("uses lower-case hyphenated slugs throughout", () => {
    for (const [iso2, slug] of Object.entries(FCDO_SLUG_BY_ISO2)) {
      expect(iso2).toMatch(/^[A-Z]{2}$/);
      expect(slug, `${iso2} → ${slug}`).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("has enough coverage to be worth shipping", () => {
    expect(Object.keys(FCDO_SLUG_BY_ISO2).length).toBeGreaterThan(200);
  });
});
