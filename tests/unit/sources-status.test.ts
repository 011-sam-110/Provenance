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
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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

  // THE GUARD THAT WAS MISSING. /api/status reported food-security as "keyless"
  // for a whole release because the adapter had been changed to require
  // HUNGERMAP_API_KEY and nobody added it to the table. The old test only checked
  // that listed ids were real — it could not see a gate that was never listed.
  //
  // So: walk the code for process.env reads and require every credential-looking
  // name to appear in the table. Anything genuinely not a capability credential
  // goes in NOT_A_CREDENTIAL, deliberately and visibly.
  it("has an entry for every credential the code actually reads", () => {
    const NOT_A_CREDENTIAL = new Set([
      "NODE_ENV",
      "TN_DIST_DIR",
      "NEXT_RUNTIME",
      "VERCEL_URL",
      "VERCEL_ENV",
      // Deployment identity, not a capability credential: these only decide which
      // absolute origin the OG cards and metadataBase resolve against.
      "NEXT_PUBLIC_SITE_URL",
      "VERCEL_PROJECT_PRODUCTION_URL",
      // Photo geolocation is a local sidecar, not a hosted capability with a key.
      "GEOLOCATE_BACKEND",
      "GEOLOCATE_GEOCLIP_URL",
      // Alert delivery is configured by the USER in the browser, not by the deployment.
      "DISCORD_WEBHOOK_URL",
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_CHAT_ID",
    ]);
    const declared = new Set(KEY_REQUIREMENTS.flatMap((r) => r.env));

    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name)) files.push(p);
      }
    };
    walk("lib");
    walk("app");

    const undeclared = new Map<string, string>();
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]{2,})/g)) {
        const name = m[1];
        if (declared.has(name) || NOT_A_CREDENTIAL.has(name)) continue;
        if (!undeclared.has(name)) undeclared.set(name, file);
      }
    }
    const lines = [...undeclared].map(([n, f]) => `${n} (read in ${f})`);
    const message =
      "these env vars gate behaviour but are not in KEY_REQUIREMENTS, so /api/status " +
      "will report the capability as keyless: " +
      lines.join("; ");
    expect(lines, message).toEqual([]);
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

  // A key that merely IMPROVES a working keyless feature must never be reported
  // as locked. /api/status told users the Markets equities section "stays
  // dormant" without FINNHUB_API_KEY while it was rendering six rows from a
  // keyless Yahoo fallback.
  it("separates an optional upgrade from a hard gate", () => {
    expect(capabilityState("markets-equities", {})).toBe("upgradable");
    expect(capabilityState("markets-equities", { FINNHUB_API_KEY: "k" })).toBe("enhanced");
    expect(capabilityState("acled", {})).toBe("locked");
  });

  // `configured` says we hold the credential. It does NOT say the upstream
  // accepts it: ACLED answers 403 to a token that passes its own OAuth flow, and
  // AISStream opens a socket then sends nothing. Liveness is the freshness chip's
  // job and this field must not be read as a health check.
  it("reports holding a credential, not that it works", () => {
    expect(capabilityState("acled", { ACLED_EMAIL: "a", ACLED_PASSWORD: "b" })).toBe("configured");
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
      layersNotKeyBlocked: 2,
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
      ["ai-brief", "geolocate-vision", "markets-equities", "markets-macro", "webcams"],
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
    const states = new Set(rep.layers.map((l) => l.state));
    for (const st of states) {
      expect(["keyless", "configured", "locked", "upgradable", "enhanced"]).toContain(st);
    }
    // With no keys at all, every REQUIRED gate must show as locked — never as fine.
    expect(rep.summary.layersConfigured).toBe(0);
    expect(rep.summary.layersLocked).toBeGreaterThan(0);
    expect(rep.summary.layersNotKeyBlocked).toBe(SIGNALS.length - rep.summary.layersLocked);
  });
});
