import { describe, it, expect } from "vitest";
import {
  KEY_REQUIREMENTS,
  NON_SIGNAL_IDS,
  capabilityState,
  hasEnv,
  isKeyless,
  lockedReason,
  missingEnvFor,
} from "@/lib/sources/keyRequirements";
import { buildStatusReport } from "@/lib/sources/statusReport";
import { SIGNALS } from "@/lib/signals/registry";

const NOW = 1_700_000_000_000;

describe("key requirements table", () => {
  // The table lives apart from the adapters, so this is the test that stops it
  // drifting into fiction when a layer is renamed or removed.
  it("names only real signal layers, apart from the declared non-layer capabilities", () => {
    const ids = new Set(SIGNALS.map((s) => s.id));
    const bogus = KEY_REQUIREMENTS.filter((r) => !NON_SIGNAL_IDS.has(r.id) && !ids.has(r.id)).map((r) => r.id);
    expect(bogus).toEqual([]);
  });

  it("gives every requirement at least one env var, a consequence and a way to get it", () => {
    for (const r of KEY_REQUIREMENTS) {
      expect(r.env.length, `${r.id} declares no env var`).toBeGreaterThan(0);
      expect(r.degrades.length, `${r.id} does not say what breaks`).toBeGreaterThan(20);
      expect(r.obtain.length, `${r.id} does not say where to get it`).toBeGreaterThan(5);
    }
  });

  it("treats anything not in the table as keyless — that is the default", () => {
    expect(isKeyless("earthquakes")).toBe(true);
    expect(isKeyless("acled")).toBe(false);
  });
});

describe("hasEnv", () => {
  it("rejects blank as well as absent — an empty string in .env is the classic near-miss", () => {
    expect(hasEnv({ K: "x" }, "K")).toBe(true);
    expect(hasEnv({ K: "" }, "K")).toBe(false);
    expect(hasEnv({ K: "   " }, "K")).toBe(false);
    expect(hasEnv({}, "K")).toBe(false);
  });
});

describe("capabilityState", () => {
  it("needs every declared var, not just one of them", () => {
    expect(capabilityState("acled", { ACLED_EMAIL: "a" })).toBe("locked");
    expect(missingEnvFor("acled", { ACLED_EMAIL: "a" })).toEqual(["ACLED_PASSWORD"]);
    expect(capabilityState("acled", { ACLED_EMAIL: "a", ACLED_PASSWORD: "b" })).toBe("configured");
  });

  it("calls an ungated layer keyless rather than configured", () => {
    expect(capabilityState("earthquakes", {})).toBe("keyless");
  });
});

describe("lockedReason", () => {
  it("names the missing variables and the consequence, and nothing else", () => {
    const r = lockedReason("acled", {});
    expect(r).toContain("ACLED_EMAIL + ACLED_PASSWORD");
    expect(r).toContain("Instability Index");
    expect(lockedReason("acled", { ACLED_EMAIL: "a", ACLED_PASSWORD: "b" })).toBeNull();
    expect(lockedReason("earthquakes", {})).toBeNull();
  });
});

describe("buildStatusReport", () => {
  const reg = [
    { id: "earthquakes", label: "Earthquakes", group: "Natural hazards", refreshMs: 300_000, attribution: "USGS" },
    { id: "acled", label: "ACLED", group: "Conflict", refreshMs: 900_000 },
    { id: "ais", label: "Ships", group: "Maritime", refreshMs: 60_000 },
  ];

  it("classifies every layer and totals them consistently", () => {
    const rep = buildStatusReport(reg, { AISSTREAM_API_KEY: "k" }, NOW);
    expect(rep.summary).toEqual({
      layersRegistered: 3,
      layersKeyless: 1,
      layersConfigured: 1,
      layersLocked: 1,
      layersAvailable: 2,
    });
    expect(rep.generatedAt).toBe(NOW);
  });

  it("explains a locked layer and stays quiet about a working one", () => {
    const rep = buildStatusReport(reg, {}, NOW);
    const acled = rep.layers.find((l) => l.id === "acled")!;
    expect(acled.state).toBe("locked");
    expect(acled.missingEnv).toEqual(["ACLED_EMAIL", "ACLED_PASSWORD"]);
    expect(acled.degrades).toContain("Instability Index");

    const quakes = rep.layers.find((l) => l.id === "earthquakes")!;
    expect(quakes.state).toBe("keyless");
    expect(quakes.missingEnv).toEqual([]);
    expect(quakes.degrades).toBeUndefined();
  });

  it("reports the non-layer capabilities too, and keeps them out of the layer totals", () => {
    const rep = buildStatusReport(reg, {}, NOW);
    expect(rep.capabilities.map((c) => c.id).sort()).toEqual(
      ["ai-brief", "markets-equities", "markets-macro", "webcams"],
    );
    expect(rep.summary.layersRegistered).toBe(3);
  });

  // The report is public. A leak here would be a live credential on the open web.
  it("never carries an env VALUE anywhere in the payload", () => {
    const secrets = { ACLED_EMAIL: "sekrit-email", ACLED_PASSWORD: "sekrit-pw", AISSTREAM_API_KEY: "sekrit-ais" };
    const json = JSON.stringify(buildStatusReport(reg, secrets, NOW));
    for (const v of Object.values(secrets)) expect(json).not.toContain(v);
  });

  it("runs over the real registry without inventing or dropping a layer", () => {
    const rep = buildStatusReport(SIGNALS, {}, NOW);
    expect(rep.summary.layersRegistered).toBe(SIGNALS.length);
    expect(rep.summary.layersKeyless + rep.summary.layersConfigured + rep.summary.layersLocked)
      .toBe(SIGNALS.length);
    // With no keys at all, every gated layer must show as locked — never as fine.
    expect(rep.summary.layersConfigured).toBe(0);
    expect(rep.summary.layersLocked).toBeGreaterThan(0);
  });
});
