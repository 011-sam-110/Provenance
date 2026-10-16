import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  activeHours,
  normalizeUkraineAlerts,
  OBLAST_ANCHORS,
  STANDING_ALERT_HOURS,
  UKRAINE_ALERTS_SOURCE,
} from "@/lib/signals/ukraine-alerts";
import { readOutcome } from "@/lib/signals/outcome";

/**
 * The fixture is NOT a live capture, and it says so in its own `disclaimer` field. The
 * alerts.in.ua API answers 401 without a token and the token had not arrived when this
 * adapter was written, so the fixture is built on the response shape the API documents
 * at devs.alerts.in.ua: the oblast rows (Luhansk since 2022, Crimea) copy the documented
 * example, and the raion, hromada and city rows mirror the alert of 2026-10-16 that the
 * old feed missed (Kharkiv and Dnipropetrovsk districts, Kyiv city). It also carries an
 * artillery-shelling row and a finished alert, which must both stay off the map.
 * Replace it with a real capture once the token is set.
 */
const payload = JSON.parse(
  readFileSync(join(process.cwd(), "tests", "fixtures", "ukraine-alerts.alerts-in-ua.json"), "utf8"),
) as unknown;
const NOW = Date.parse("2026-10-16T18:50:00Z");

describe("normalizeUkraineAlerts", () => {
  it("emits one feature per oblast with an active air-raid alert", () => {
    const { features } = normalizeUkraineAlerts(payload, NOW);
    expect(features.map((f) => f.props?.oblast)).toEqual(["Dnipropetrovsk", "Luhansk", "Kharkiv", "Crimea", "Kyiv city"]);
  });

  it("shows a raion-level alert as a partial oblast — the case the old feed called all-clear", () => {
    const { features } = normalizeUkraineAlerts(payload, NOW);
    const kharkiv = features.find((f) => f.id === "ukraine-alerts:22")!;
    expect(kharkiv.title).toBe("Air-raid alert in part of Kharkiv — 2 areas");
    expect(kharkiv.props?.extent).toBe("Partial");
    expect(kharkiv.props?.areasUnderAlert).toBe("Kharkivskyi Raion, Chuhuivskyi Raion");
    expect(kharkiv.props?.level).toBe("red");
    expect(kharkiv.ts).toBe("2026-10-16T18:20:03.000Z"); // the earliest start in the oblast
    expect(kharkiv.color).toBe("#ea580c");

    // A hromada with no English title falls back to its Ukrainian one rather than vanishing.
    const dnipro = features.find((f) => f.id === "ukraine-alerts:9")!;
    expect(dnipro.props?.areasUnderAlert).toBe("Нікопольська територіальна громада");
    expect(dnipro.props?.level).toBe("yellow");
  });

  it("treats a row whose uid is the oblast's own as the whole oblast", () => {
    const { features } = normalizeUkraineAlerts(payload, NOW);
    const kyiv = features.find((f) => f.id === "ukraine-alerts:31")!;
    expect(kyiv.title).toBe("Air-raid alert — Kyiv City (whole oblast)");
    expect(kyiv.props?.extent).toBe("Whole oblast");
    expect(kyiv.color).toBe("#dc2626");
  });

  it("keeps finished alerts and other alert types off the map", () => {
    const { features } = normalizeUkraineAlerts(payload, NOW);
    expect(features.some((f) => f.id === "ukraine-alerts:18")).toBe(false); // Odesa, finished
    expect(features.some((f) => f.id === "ukraine-alerts:23")).toBe(false); // Kherson, shelling
  });

  it("places each alert on its own oblast anchor, never at 0,0", () => {
    const { features } = normalizeUkraineAlerts(payload, NOW);
    for (const f of features) {
      expect(f.lat).toBeGreaterThan(44);
      expect(f.lat).toBeLessThan(53);
      expect(f.lon).toBeGreaterThan(21);
      expect(f.lon).toBeLessThan(41);
    }
  });

  it("reports an oblast uid it cannot place instead of guessing it", () => {
    const out = normalizeUkraineAlerts(
      { alerts: [{ alert_type: "air_raid", location_uid: "999", location_oblast_uid: "999", finished_at: null }] },
      NOW,
    );
    expect(out.features).toEqual([]);
    expect(out.unknownIds).toEqual([999]);
  });

  it("survives a payload that is not the shape we expect", () => {
    for (const junk of [null, undefined, {}, { alerts: null }, { alerts: "no" }, [], { states: [] }]) {
      expect(() => normalizeUkraineAlerts(junk)).not.toThrow();
      expect(normalizeUkraineAlerts(junk).features).toEqual([]);
    }
  });

  it("says in the DATA that an alert is a warning, not a strike", () => {
    const { features } = normalizeUkraineAlerts(payload, NOW);
    for (const f of features) {
      expect(String(f.props?.meaning)).toMatch(/NOT a report that anything was struck/i);
      expect(String(f.props?.scope)).toMatch(/not a location/i);
    }
  });
});

describe("a standing alert is not a fresh warning", () => {
  it("labels, recolours and retitles a whole-oblast alert older than a day", () => {
    const { features } = normalizeUkraineAlerts(payload, NOW);
    const f = features.find((x) => x.id === "ukraine-alerts:16")!;
    expect(f.title).toBe("Standing alert — Luhansk Oblast");
    expect(f.props?.standing).toBe(true);
    expect(f.color).toBe("#a16207");
    expect(Number(f.props?.activeForHours)).toBeGreaterThan(24_000);
    expect(String(f.props?.meaning)).toMatch(/standing condition/i);
  });

  it("leaves a minutes-old alert as an ordinary warning", () => {
    const { features } = normalizeUkraineAlerts(payload, NOW);
    const f = features.find((x) => x.id === "ukraine-alerts:31")!;
    expect(f.props?.standing).toBeUndefined();
  });

  it("measures duration without inventing one", () => {
    expect(activeHours(undefined, NOW)).toBeUndefined();
    expect(activeHours("not a date", NOW)).toBeUndefined();
    expect(activeHours(new Date(NOW + 60_000).toISOString(), NOW)).toBe(0);
    expect(activeHours(new Date(NOW - 2 * 3_600_000).toISOString(), NOW)).toBeCloseTo(2, 5);
  });

  it("keeps the threshold at a day, where a real alert cannot reach", () => {
    expect(STANDING_ALERT_HOURS).toBe(24);
  });
});

describe("the oblast anchor table", () => {
  it("covers all 27 regions of the alerts.in.ua Location UID table", () => {
    expect(Object.keys(OBLAST_ANCHORS).map(Number).sort((a, b) => a - b)).toEqual([
      3, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
    ]);
  });

  it("keeps Kyiv city and Kyiv oblast on separate points", () => {
    const city = OBLAST_ANCHORS[31]!;
    const oblast = OBLAST_ANCHORS[14]!;
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
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is a map layer in the Conflict group, not data-only", () => {
    expect(UKRAINE_ALERTS_SOURCE.id).toBe("ukraineAlerts");
    expect(UKRAINE_ALERTS_SOURCE.group).toBe("Conflict");
    expect(UKRAINE_ALERTS_SOURCE.dataOnly).toBeUndefined();
  });

  it("credits and links alerts.in.ua, as its terms require", () => {
    expect(UKRAINE_ALERTS_SOURCE.attribution).toMatch(/alerts\.in\.ua/);
    expect(UKRAINE_ALERTS_SOURCE.sourceUrl).toBe("https://alerts.in.ua/");
  });

  it("refreshes fast enough for a time-critical warning", () => {
    expect(UKRAINE_ALERTS_SOURCE.refreshMs).toBeLessThanOrEqual(120_000);
  });

  it("is unavailable without a token, and never falls back to the old oblast-only feed", async () => {
    vi.stubEnv("ALERTS_IN_UA_TOKEN", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const out = await UKRAINE_ALERTS_SOURCE.fetch();
    expect(out).toEqual([]);
    expect(readOutcome(out)).toMatchObject({ ok: false, reason: "no key" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
