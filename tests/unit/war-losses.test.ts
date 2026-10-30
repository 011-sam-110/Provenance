// The two Vehicle losses layers (lib/signals/losses-ru.ts, losses-ua.ts) against the
// relay envelopes captured on 2026-10-30 with `python -m sources push <feed> --dry-run
// --out` (NewsScraper sources/losses.py), trimmed in length, never edited in content.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RELAY_FEEDS, type RelayData, type RelayFeedId } from "@/lib/relay/feeds";
import { putRelay, resetRelayStore, type RelaySnapshot } from "@/lib/relay/store";
import { readOutcome } from "@/lib/signals/outcome";
import { readSummary } from "@/lib/signals/summary";
import {
  CLAIM_MATCH,
  LOSSES_RU_SOURCE,
  MAP_DAYS,
  claimRows,
  lossesRuFrom,
  readLossesRuSummary,
} from "@/lib/signals/losses-ru";
import { LOSSES_UA_SOURCE, UA_DOCUMENTED_BY, lossesUaFrom, readLossesUaSummary } from "@/lib/signals/losses-ua";

const DIR = join(__dirname, "..", "fixtures", "relay");
const envelope = (feed: string) => JSON.parse(readFileSync(join(DIR, `${feed}.json`), "utf8"));

function snapshot<F extends RelayFeedId>(feed: F): RelaySnapshot<RelayData<F>> {
  const env = envelope(feed);
  const data = RELAY_FEEDS[feed].schema.parse(env.data) as RelayData<F>;
  const fetchedAt = Date.parse(env.fetchedAt);
  return { data, fetchedAt, receivedAt: fetchedAt + 1000 };
}

const RU = snapshot("losses-ru");
const UA = snapshot("losses-ua");
const TOTALS = snapshot("loss-totals");
const NOW = RU.fetchedAt + 60_000;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const windowFrom = dayOf(NOW - (MAP_DAYS - 1) * 86_400_000);

afterEach(() => resetRelayStore());

describe("Vehicle losses, Russian", () => {
  const { features, summary } = lossesRuFrom(RU, TOTALS, NOW);
  const inWindow = RU.data.losses.filter((r) => r.date >= windowFrom);

  it("draws only located losses of the last 30 days, each linking its WarSpotting record", () => {
    const located = inWindow.filter((r) => r.lat != null && r.lon != null);
    expect(located.length).toBeGreaterThan(0);
    expect(located.length).toBeLessThan(inWindow.length);
    expect(features.map((f) => f.id).sort()).toEqual(located.map((r) => `warspotting:${r.id}`).sort());
    for (const f of features) {
      const id = Number(f.id.split(":")[1]);
      expect(f.link).toBe(`https://ukr.warspotting.net/view/${id}/`);
      expect(f.props?.documentedBy).toMatch(/WarSpotting/);
      expect(f.shape).toBeUndefined();
      expect(f.ts! >= `${windowFrom}T00:00:00Z`).toBe(true);
    }
  });

  it("never gives an unlocated loss a place", () => {
    const unlocated = new Set(RU.data.losses.filter((r) => r.lat == null).map((r) => `warspotting:${r.id}`));
    expect(features.some((f) => unlocated.has(f.id))).toBe(false);
  });

  it("counts the 30 days from every row, located or not, and lists unlocated rows", () => {
    expect(summary.window.total).toBe(inWindow.length);
    expect(summary.window.located).toBe(features.length);
    expect(summary.window.byType.reduce((n, t) => n + t.count, 0)).toBe(inWindow.length);
    expect(summary.recent.some((r) => !r.located)).toBe(true);
    expect(summary.recent[0].date >= summary.recent.at(-1)!.date).toBe(true);
  });

  it("states WarSpotting's all-time totals as relayed", () => {
    expect(summary.allTime.total).toBe(Object.values(RU.data.stats.byStatus).reduce((n, v) => n + v, 0));
    expect(summary.allTime.byType.find((t) => t.type === "Tanks")?.losses).toBe(3762);
  });

  it("sets each claim beside the hand-matched WarSpotting types", () => {
    const rows = summary.claims!.rows;
    const tanks = rows.find((r) => r.key === "tanks")!;
    expect(tanks).toMatchObject({ claimed: TOTALS.data.claimed.stats.tanks, documented: 3762 });
    expect(tanks.ratio).toBe(Math.round((tanks.claimed / 3762) * 10) / 10);
    const afv = rows.find((r) => r.key === "armoured_fighting_vehicles")!;
    const type = (name: string) => RU.data.stats.byType.find((t) => t.type === name)!.losses;
    expect(afv.documented).toBe(type("Infantry fighting vehicles") + type("Infantry mobility vehicles"));
    expect(rows.find((r) => r.key === "vehicles_fuel_tanks")?.documented).toBe(type("Transport"));
    // No fair match, so no row: drones, special equipment, personnel, missiles.
    for (const key of ["uav_systems", "special_military_equip", "personnel_units", "cruise_missiles"]) {
      expect(rows.some((r) => r.key === key)).toBe(false);
    }
    expect(summary.claims!.crossCheck?.checked.length).toBeGreaterThanOrEqual(3);
  });

  it("drops a claim row when WarSpotting no longer lists a matched type, rather than count it as zero", () => {
    const byType = RU.data.stats.byType.filter((t) => t.type !== "Infantry mobility vehicles");
    const rows = claimRows(TOTALS.data.claimed, byType);
    expect(rows.some((r) => r.key === "armoured_fighting_vehicles")).toBe(false);
    expect(rows.length).toBe(CLAIM_MATCH.length - 1);
  });

  it("has no claims section until the totals feed arrives", () => {
    expect(lossesRuFrom(RU, null, NOW).summary.claims).toBeNull();
  });

  it("survives the JSON trip to the browser, and refuses another shape", () => {
    expect(readLossesRuSummary(JSON.parse(JSON.stringify(summary)))).toEqual(summary);
    expect(readLossesRuSummary({ layer: "losses-ru" })).toBeNull();
    expect(readLossesRuSummary(lossesUaFrom(UA, NOW).summary)).toBeNull();
  });
});

describe("Vehicle losses, Ukrainian", () => {
  const now = UA.fetchedAt + 60_000;
  const from = dayOf(now - (MAP_DAYS - 1) * 86_400_000);
  const { features, summary } = lossesUaFrom(UA, now);
  const inWindow = UA.data.losses.filter((r) => r.date >= from);

  it("draws every loss of the last 30 days as a diamond that names the Russian side", () => {
    expect(features.length).toBe(inWindow.length);
    for (const f of features) {
      expect(f.shape).toBe("diamond");
      expect(f.title).toMatch(/Russian-side record/);
      expect(f.props?.documentedBy).toBe(UA_DOCUMENTED_BY);
      expect(f.link).toMatch(/^https:\/\/lostarmour\.info\/[a-z]+\/\d+$/);
    }
  });

  it("counts by English category and keeps the Russian name beside the English one", () => {
    expect(summary.window.byCategory.reduce((n, c) => n + c.count, 0)).toBe(inWindow.length);
    expect(summary.window.byCategory[0].count).toBeGreaterThanOrEqual(summary.window.byCategory.at(-1)!.count);
    const p18 = summary.recent.find((r) => r.id === "pvo/71805")!;
    expect(p18).toMatchObject({ name: "P-18", nameRu: "П-18", translated: true, category: "Air defence", status: "Destroyed" });
    expect(summary.yearTotal).toBe(UA.data.losses.length);
  });

  it("survives the JSON trip and refuses another shape", () => {
    expect(readLossesUaSummary(JSON.parse(JSON.stringify(summary)))).toEqual(summary);
    expect(readLossesUaSummary(lossesRuFrom(RU, TOTALS, NOW).summary)).toBeNull();
  });
});

describe("the adapters read the relay store", () => {
  it("say they have nothing, and why, before the first push", async () => {
    const ru = await LOSSES_RU_SOURCE.fetch();
    const ua = await LOSSES_UA_SOURCE.fetch();
    expect(ru).toEqual([]);
    expect(readOutcome(ru)).toMatchObject({ ok: false });
    expect(readOutcome(ua)).toMatchObject({ ok: false });
  });

  it("serve features with the summary riding on them once a snapshot is held", async () => {
    // The fixtures are dated 2026-10-30, so put them in as just read: the layer measures
    // its 30 days from the clock, and an old fixture would be past the feed's max age.
    putRelay("losses-ru", RU.data, Date.now(), Date.now());
    putRelay("loss-totals", TOTALS.data, Date.now(), Date.now());
    putRelay("losses-ua", UA.data, Date.now(), Date.now());
    const ru = await LOSSES_RU_SOURCE.fetch();
    const ua = await LOSSES_UA_SOURCE.fetch();
    expect(readOutcome(ru)).toMatchObject({ ok: true });
    expect(readLossesRuSummary(readSummary(ru))?.claims?.rows.length).toBeGreaterThan(0);
    expect(readLossesUaSummary(readSummary(ua))?.yearTotal).toBe(UA.data.losses.length);
  });

  it("both declare exact precision: each place is a geolocation of the vehicle's own footage", () => {
    expect(LOSSES_RU_SOURCE.precision).toBe("exact");
    expect(LOSSES_UA_SOURCE.precision).toBe("exact");
  });
});
