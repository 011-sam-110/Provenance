import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  activeHours,
  normalizeUkraineAlerts,
  OBLAST_ANCHORS,
  STANDING_ALERT_HOURS,
  UKRAINE_ALERTS_SOURCE,
} from "@/lib/signals/ukraine-alerts";

/**
 * The fixture is the REAL alerts.com.ua payload captured 2026-09-08, with one edit
 * stated here so nobody mistakes it for the live shape: `alert` was forced true for
 * Zaporizhzhia (7) and Kharkiv (19) and false everywhere else. The live feed is usually
 * quiet, and a fixture that happens to be all-clear would let every assertion below pass
 * against a normaliser that returns nothing at all.
 */
const payload = JSON.parse(
  readFileSync(join(process.cwd(), "tests", "fixtures", "ukraine-alerts.states.json"), "utf8"),
) as unknown;

describe("normalizeUkraineAlerts", () => {
  it("emits a feature only for oblasts actually under alert", () => {
    const { features } = normalizeUkraineAlerts(payload);
    expect(features).toHaveLength(2);
    expect(features.map((f) => f.props?.oblast).sort()).toEqual(["Kharkiv oblast", "Zaporizhzhia oblast"]);
  });

  it("does not draw the 23 quiet oblasts", () => {
    // The whole point of the layer. Drawing every oblast would make a mostly-calm
    // country read as activity everywhere, which is the opposite of what an alert means.
    const { features } = normalizeUkraineAlerts(payload);
    expect(features.length).toBeLessThan(25);
  });

  it("treats a non-boolean `alert` as NOT an alert", () => {
    // Fail-quiet on this specific field, deliberately. An upstream that starts sending
    // "false" or 0 must not turn the whole country red; `=== true` is the guard and this
    // is what pins it.
    const shifty = { states: [{ id: 1, name_en: "Vinnytsia oblast", alert: "true" }, { id: 2, alert: 1 }] };
    expect(normalizeUkraineAlerts(shifty).features).toEqual([]);
  });

  it("places each alert on its own oblast anchor, never at 0,0", () => {
    const { features } = normalizeUkraineAlerts(payload);
    for (const f of features) {
      expect(f.lat).not.toBe(0);
      expect(f.lon).not.toBe(0);
      // Ukraine's bounding box, generously. A coordinate outside it is a table error.
      expect(f.lat).toBeGreaterThan(44);
      expect(f.lat).toBeLessThan(53);
      expect(f.lon).toBeGreaterThan(21);
      expect(f.lon).toBeLessThan(41);
    }
  });

  it("reports an oblast it cannot place instead of dropping or guessing it", () => {
    // The failure this prevents is silent shrinkage: an upstream adds oblast 26, we
    // place it at 0,0 or skip it, and the layer serves a shorter list that still looks
    // complete. The id comes back so `fetch()` can degrade rather than claim all-clear.
    const withUnknown = { states: [{ id: 99, name_en: "Somewhere new", alert: true }] };
    const out = normalizeUkraineAlerts(withUnknown);
    expect(out.features).toEqual([]);
    expect(out.unknownIds).toEqual([99]);
  });

  it("survives a payload that is not the shape we expect", () => {
    for (const junk of [null, undefined, {}, { states: null }, { states: "no" }, []]) {
      expect(() => normalizeUkraineAlerts(junk)).not.toThrow();
      expect(normalizeUkraineAlerts(junk).features).toEqual([]);
    }
  });

  it("says in the DATA that an alert is a warning, not a strike", () => {
    // This is a correctness claim, not copy polish. A red dot on a conflict map invites
    // "something was hit here", and the dossier is the only place that reading gets
    // corrected — so the disclaimer travels with the feature rather than living in a
    // component someone can restyle away.
    const { features } = normalizeUkraineAlerts(payload);
    for (const f of features) {
      expect(String(f.props?.meaning)).toMatch(/NOT a report that anything was struck/i);
      expect(String(f.props?.scope)).toMatch(/not a location/i);
    }
  });
});

describe("a standing alert is not a fresh warning", () => {
  // The live feed returns Luhansk with an alert that has been on since October 2023,
  // because the oblast is occupied and the siren state never clears. Found by calling the
  // real endpoint; no fixture would have produced it. It is kept and LABELLED rather than
  // dropped -- deleting a row because it is inconvenient is how a source stops being
  // trustworthy.
  const THREE_YEARS_AGO = "2023-10-29T18:22:37.357Z";
  const NOW = Date.parse("2026-09-08T00:00:00.000Z");

  it("labels, recolours and retitles an alert older than a day", () => {
    const { features } = normalizeUkraineAlerts(
      { states: [{ id: 11, name_en: "Luhansk oblast", alert: true, changed: THREE_YEARS_AGO }] },
      NOW,
    );
    expect(features).toHaveLength(1);
    const f = features[0];
    expect(f.title).toMatch(/^Standing alert/);
    expect(f.props?.standing).toBe(true);
    expect(f.color).not.toBe("#dc2626");
    expect(Number(f.props?.activeForHours)).toBeGreaterThan(24_000);
    expect(String(f.props?.meaning)).toMatch(/standing condition/i);
  });

  it("leaves a minutes-old alert as an ordinary warning", () => {
    const { features } = normalizeUkraineAlerts(
      { states: [{ id: 19, name_en: "Kharkiv oblast", alert: true, changed: new Date(NOW - 600_000).toISOString() }] },
      NOW,
    );
    expect(features[0].title).toMatch(/^Air-raid alert/);
    expect(features[0].props?.standing).toBeUndefined();
    expect(features[0].color).toBe("#dc2626");
  });

  it("measures duration without inventing one", () => {
    expect(activeHours(undefined, NOW)).toBeUndefined();
    expect(activeHours("not a date", NOW)).toBeUndefined();
    // Clock skew must not produce a negative-duration alert.
    expect(activeHours(new Date(NOW + 60_000).toISOString(), NOW)).toBe(0);
    expect(activeHours(new Date(NOW - 2 * 3_600_000).toISOString(), NOW)).toBeCloseTo(2, 5);
  });

  it("keeps the threshold at a day, where a real alert cannot reach", () => {
    expect(STANDING_ALERT_HOURS).toBe(24);
  });
});

describe("the oblast anchor table", () => {
  it("covers all 25 of the feed's regions", () => {
    expect(Object.keys(OBLAST_ANCHORS)).toHaveLength(25);
  });

  it("keeps Kyiv city and Kyiv oblast on separate points", () => {
    // The feed carries them as two regions (25 and 9). Identical coordinates would stack
    // the markers and hide one alert behind the other, which is why the oblast is
    // anchored on Bila Tserkva rather than on its legal administrative centre.
    const city = OBLAST_ANCHORS[25];
    const oblast = OBLAST_ANCHORS[9];
    expect(city.lat === oblast.lat && city.lon === oblast.lon).toBe(false);
  });

  it("puts every anchor inside Ukraine", () => {
    for (const [id, a] of Object.entries(OBLAST_ANCHORS)) {
      expect(a.lat, `oblast ${id}`).toBeGreaterThan(44);
      expect(a.lat, `oblast ${id}`).toBeLessThan(53);
      expect(a.lon, `oblast ${id}`).toBeGreaterThan(21);
      expect(a.lon, `oblast ${id}`).toBeLessThan(41);
    }
  });
});

describe("the registered source", () => {
  it("is a map layer in the Conflict group, not data-only", () => {
    expect(UKRAINE_ALERTS_SOURCE.id).toBe("ukraineAlerts");
    expect(UKRAINE_ALERTS_SOURCE.group).toBe("Conflict");
    expect(UKRAINE_ALERTS_SOURCE.dataOnly).toBeUndefined();
  });

  it("carries a mandatory attribution and a clickable source", () => {
    expect(UKRAINE_ALERTS_SOURCE.attribution).toMatch(/alerts\.com\.ua/);
    expect(UKRAINE_ALERTS_SOURCE.sourceUrl).toMatch(/^https:\/\//);
  });

  it("refreshes fast enough for a time-critical warning", () => {
    // A shelter warning cached for an hour is worse than no layer. Pinned so a future
    // "reduce upstream load" pass cannot quietly make this one stale.
    expect(UKRAINE_ALERTS_SOURCE.refreshMs).toBeLessThanOrEqual(120_000);
  });
});
