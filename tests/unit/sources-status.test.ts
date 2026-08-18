import { describe, it, expect, beforeEach } from "vitest";
import {
  KEY_REQUIREMENTS,
  NON_SIGNAL_IDS,
  capabilityState,
  hasEnv,
  isKeyless,
  isUsable,
  lockedReason,
  missingEnvFor,
  stateWithEvidence,
} from "@/lib/sources/keyRequirements";
import { buildStatusReport } from "@/lib/sources/statusReport";
import {
  CREDENTIALED_HOSTS,
  REFUSAL_TTL_MS,
  attributeUpstream,
  credentialVerdict,
  emptyEvidence,
  instrumentSignalRegistry,
  observeUpstreamResponse,
  readEvidence,
  recordCredentialRefusal,
  recordFetchOutcome,
  resetEvidence,
  snapshotEvidence,
  type UpstreamEvidence,
} from "@/lib/sources/upstreamEvidence";
import { SIGNALS } from "@/lib/signals/registry";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const NOW = 1_700_000_000_000;

/** Evidence shorthand: only the fields a case cares about, rest empty. */
function ev(patch: Partial<UpstreamEvidence>): UpstreamEvidence {
  return { ...emptyEvidence(), ...patch };
}

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
      layersRefused: 0,
      layersLocked: 1,
      layersNotKeyBlocked: 2,
      layersObserved: 0,
      layersDelivering: 0,
      layersEmpty: 0,
      layersFailing: 0,
    });
    expect(rep.generatedAt).toBe(NOW);
  });

  // The config half must keep working with no evidence at all — that is the
  // cold-start case on every deploy, and it must not read as "everything is down".
  it("says 'not observed' rather than anything about health when it has no evidence", () => {
    const rep = buildStatusReport(reg, { AISSTREAM_API_KEY: "k" }, NOW);
    for (const l of rep.layers) {
      expect(l.flow).toEqual({
        lastFetchAt: null,
        lastFetchAgeMs: null,
        ok: null,
        rows: null,
        fetches: 0,
        lastUpstreamOkAt: null,
        observed: false,
      });
      expect(l.refusal).toBeUndefined();
    }
    expect(rep.evidence.scope).toBe("process");
    expect(rep.evidence.since).toBeNull();
    expect(rep.evidence.note).toContain("never 'did not happen'");
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
      ["ai-brief", "feedback-prompt", "geolocate-vision", "markets-equities", "markets-macro", "webcams", "youtube-live"],
    );
    expect(rep.summary.layersRegistered).toBe(3);
  });

  // The report is public. A leak here would be a live credential on the open web.
  it("never carries an env VALUE anywhere in the payload", () => {
    const secrets = { ACLED_EMAIL: "sekrit-email", ACLED_PASSWORD: "sekrit-pw", AISSTREAM_API_KEY: "sekrit-ais" };
    const json = JSON.stringify(buildStatusReport(reg, secrets, NOW));
    for (const v of Object.values(secrets)) expect(json).not.toContain(v);
  });

  // Same rule, now that a refusal record carries an upstream identity too. A host
  // is publishable; a query string that carried the key would not be, so the
  // refusal record stores a HOSTNAME and this proves the whole payload stays clean.
  it("never carries an env VALUE once refusal evidence is attached either", () => {
    const secrets = { ACLED_EMAIL: "sekrit-email", ACLED_PASSWORD: "sekrit-pw", AISSTREAM_API_KEY: "sekrit-ais" };
    const rep = buildStatusReport(reg, secrets, NOW, {
      evidence: {
        acled: ev({ lastRefusalAt: NOW - 1_000, lastRefusalStatus: 403, lastRefusalHost: "acleddata.com", refusals: 3 }),
        ais: ev({ lastFetchAt: NOW - 500, lastFetchOk: true, lastRows: 0, fetches: 9 }),
      },
      observingSince: NOW - 60_000,
    });
    const json = JSON.stringify(rep);
    for (const v of Object.values(secrets)) expect(json).not.toContain(v);
    expect(json).toContain("acleddata.com"); // the host IS published, deliberately
  });

  it("runs over the real registry without inventing or dropping a layer", () => {
    const rep = buildStatusReport(SIGNALS, {}, NOW);
    expect(rep.summary.layersRegistered).toBe(SIGNALS.length);
    const states = new Set(rep.layers.map((l) => l.state));
    for (const st of states) {
      expect(["keyless", "configured", "refused", "locked", "upgradable", "enhanced"]).toContain(st);
    }
    // With no keys at all, every REQUIRED gate must show as locked — never as fine.
    expect(rep.summary.layersConfigured).toBe(0);
    expect(rep.summary.layersRefused).toBe(0);
    expect(rep.summary.layersLocked).toBeGreaterThan(0);
    expect(rep.summary.layersNotKeyBlocked).toBe(SIGNALS.length - rep.summary.layersLocked);
  });
});

// ===========================================================================
// (a) "credential present but refused" — the state that did not exist
// ===========================================================================

describe("stateWithEvidence", () => {
  it("only lets a credential we actually SEND be refused", () => {
    // We hold it and it was rejected: the whole point.
    expect(stateWithEvidence("configured", "refused")).toBe("refused");
    expect(stateWithEvidence("enhanced", "refused")).toBe("refused");
    // We send nothing for these, so a 403 seen near them is somebody else's problem
    // — a WAF, a geo-block, an unrelated caller — and must not be pinned on us.
    expect(stateWithEvidence("keyless", "refused")).toBe("keyless");
    expect(stateWithEvidence("locked", "refused")).toBe("locked");
    expect(stateWithEvidence("upgradable", "refused")).toBe("upgradable");
  });

  it("leaves the configured state alone on anything short of a refusal", () => {
    for (const v of ["accepted", "unknown"] as const) {
      expect(stateWithEvidence("configured", v)).toBe("configured");
      expect(stateWithEvidence("enhanced", v)).toBe("enhanced");
    }
  });

  it("counts a refused capability as blocked, like a locked one", () => {
    expect(isUsable("refused")).toBe(false);
    expect(isUsable("locked")).toBe(false);
    expect(isUsable("configured")).toBe(true);
  });
});

describe("credentialVerdict", () => {
  it("says nothing at all when it has seen nothing — silence is not a refusal", () => {
    expect(credentialVerdict(undefined, NOW)).toBe("unknown");
    expect(credentialVerdict(emptyEvidence(), NOW)).toBe("unknown");
  });

  it("calls a fresh, unsuperseded 403 a refusal", () => {
    expect(credentialVerdict(ev({ lastRefusalAt: NOW - 5_000, lastRefusalStatus: 403 }), NOW)).toBe("refused");
  });

  it("clears the refusal when the same upstream later answers 2xx", () => {
    const cleared = ev({ lastRefusalAt: NOW - 5_000, lastRefusalStatus: 403, lastUpstreamOkAt: NOW - 1_000 });
    expect(credentialVerdict(cleared, NOW)).toBe("accepted");
  });

  // ACLED's adapter resolves to [] on a 403, so "the adapter fetch completed" must
  // NOT count as the credential being accepted — only an actual 2xx from the host
  // does. Getting this backwards would cancel every refusal the moment it happened.
  it("is not cleared by the adapter merely completing", () => {
    const stillRefused = ev({
      lastRefusalAt: NOW - 5_000,
      lastRefusalStatus: 403,
      lastFetchAt: NOW - 100,
      lastFetchOk: true,
      lastRows: 0,
      fetches: 4,
    });
    expect(credentialVerdict(stillRefused, NOW)).toBe("refused");
  });

  it("lets a refusal go stale rather than asserting it forever off old evidence", () => {
    const old = ev({ lastRefusalAt: NOW - REFUSAL_TTL_MS - 1, lastRefusalStatus: 403 });
    expect(credentialVerdict(old, NOW)).toBe("unknown");
    expect(credentialVerdict(old, NOW, REFUSAL_TTL_MS * 4)).toBe("refused");
  });

  it("treats a 2xx with no refusal on record as acceptance", () => {
    expect(credentialVerdict(ev({ lastUpstreamOkAt: NOW - 10 }), NOW)).toBe("accepted");
  });
});

describe("attributeUpstream", () => {
  it("maps a credentialed host to the capability whose key goes there", () => {
    expect(attributeUpstream("https://acleddata.com/api/acled/read?limit=2000")).toBe("acled");
    expect(attributeUpstream("https://api.openaq.org/v3/parameters/2/latest")).toBe("air-quality-stations");
    expect(attributeUpstream("https://api.windy.com/webcams/api/v3/webcams")).toBe("webcams");
  });

  it("attributes nothing to a host we send no credential to", () => {
    expect(attributeUpstream("https://earthquake.usgs.gov/fdsnws/event/1/query")).toBeNull();
    expect(attributeUpstream("https://api.gdeltproject.org/api/v2/geo/geo")).toBeNull();
  });

  // Exact hostname, not a suffix match: a lookalike host must never be able to
  // stamp "refused" on a layer whose credential it never saw.
  it("does not match a lookalike or a subdomain of a credentialed host", () => {
    expect(attributeUpstream("https://evil-acleddata.com/api")).toBeNull();
    expect(attributeUpstream("https://acleddata.com.example.net/api")).toBeNull();
  });

  it("shrugs off a string that is not a URL", () => {
    expect(attributeUpstream("not a url")).toBeNull();
    expect(attributeUpstream("")).toBeNull();
  });
});

describe("observeUpstreamResponse", () => {
  beforeEach(resetEvidence);

  it("turns a 401/402/403 from a credentialed host into evidence, and nothing else does", () => {
    for (const status of [401, 402, 403]) {
      resetEvidence();
      observeUpstreamResponse("https://acleddata.com/api/acled/read", status, NOW);
      const rec = readEvidence("acled")!;
      expect(rec.lastRefusalStatus).toBe(status);
      expect(rec.lastRefusalHost).toBe("acleddata.com");
      expect(rec.refusals).toBe(1);
    }
  });

  // A 429 or a 503 is the upstream having a bad day. Reading either as "your key is
  // rejected" would put a red state on a perfectly good credential.
  it("does not read a rate-limit or a server error as a credential refusal", () => {
    for (const status of [404, 429, 500, 502, 503]) {
      observeUpstreamResponse("https://acleddata.com/api/acled/read", status, NOW);
    }
    // Nothing is filed at all — not a refusal, not a zero-count placeholder.
    expect(readEvidence("acled")?.lastRefusalAt ?? null).toBeNull();
    expect(readEvidence("acled")?.refusals ?? 0).toBe(0);
    expect(credentialVerdict(readEvidence("acled"), NOW)).toBe("unknown");
  });

  it("records a 2xx so a later success can clear an earlier refusal", () => {
    observeUpstreamResponse("https://acleddata.com/api/acled/read", 403, NOW);
    expect(credentialVerdict(readEvidence("acled"), NOW)).toBe("refused");
    observeUpstreamResponse("https://acleddata.com/api/acled/read", 200, NOW + 1_000);
    expect(credentialVerdict(readEvidence("acled"), NOW + 1_000)).toBe("accepted");
  });

  it("files nothing at all for an unmapped host", () => {
    expect(observeUpstreamResponse("https://earthquake.usgs.gov/x", 403, NOW)).toBeNull();
    expect(snapshotEvidence()).toEqual({});
  });
});

// The host table is the attribution spine: if a host here is not one the code
// really fetches, a refusal is filed against the wrong layer or never filed at all.
// Same guard idea as the process.env scan above — prove it against the source.
describe("credentialed host table", () => {
  it("names only capabilities that are actually key-gated", () => {
    const known = new Set(KEY_REQUIREMENTS.map((r) => r.id));
    const bogus = Object.keys(CREDENTIALED_HOSTS).filter((id) => !known.has(id));
    expect(bogus, "hosts declared for a capability that needs no credential").toEqual([]);
  });

  it("names only hosts the code really fetches", () => {
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
    const corpus = files
      .filter((f) => !f.includes("upstreamEvidence"))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");

    const missing: string[] = [];
    for (const [id, hosts] of Object.entries(CREDENTIALED_HOSTS)) {
      for (const h of hosts) if (!corpus.includes(h)) missing.push(`${id} → ${h}`);
    }
    expect(missing, "declared upstream hosts that appear nowhere in the code").toEqual([]);
  });
});

describe("buildStatusReport — refused", () => {
  const reg = [
    { id: "earthquakes", label: "Earthquakes", group: "Natural hazards", refreshMs: 300_000 },
    { id: "acled", label: "ACLED", group: "Conflict", refreshMs: 900_000 },
    { id: "ais", label: "Ships", group: "Maritime", refreshMs: 60_000 },
  ];
  const held = { ACLED_EMAIL: "a", ACLED_PASSWORD: "b", AISSTREAM_API_KEY: "k" };

  // THE BUG. "We hold the key" was published as if it meant "the key works".
  it("stops calling a rejected credential 'configured'", () => {
    const before = buildStatusReport(reg, held, NOW);
    expect(before.layers.find((l) => l.id === "acled")!.state).toBe("configured");

    const after = buildStatusReport(reg, held, NOW, {
      evidence: {
        acled: ev({ lastRefusalAt: NOW - 2_000, lastRefusalStatus: 403, lastRefusalHost: "acleddata.com", refusals: 2 }),
      },
    });
    const acled = after.layers.find((l) => l.id === "acled")!;
    expect(acled.state).toBe("refused");
    // Still empty, and that is now the informative part: we HAVE the vars.
    expect(acled.missingEnv).toEqual([]);
    expect(acled.refusal).toEqual({
      since: NOW - 2_000,
      status: 403,
      host: "acleddata.com",
      count: 2,
      observed: expect.stringContaining("acleddata.com answered HTTP 403"),
    });
    // A refused layer must tell the reader what they are losing and how to fix it,
    // exactly like a locked one.
    expect(acled.degrades).toContain("Instability Index");
    expect(acled.obtain).toContain("acleddata.com");
    expect(after.summary.layersRefused).toBe(1);
    expect(after.summary.layersConfigured).toBe(1); // ais, still only "we hold it"
    expect(after.summary.layersNotKeyBlocked).toBe(2); // earthquakes + ais, not acled
  });

  // The rule that stops this becoming a hardcoded blame list.
  it("leaves a layer with no evidence either way as configured", () => {
    const rep = buildStatusReport(reg, held, NOW, {
      evidence: {
        acled: ev({ lastRefusalAt: NOW - 2_000, lastRefusalStatus: 403, lastRefusalHost: "acleddata.com", refusals: 1 }),
      },
    });
    // AIS is a WebSocket, so no fetch-level refusal can ever be observed for it. It
    // must NOT be guessed into `refused` just because we know it delivers nothing.
    const ais = rep.layers.find((l) => l.id === "ais")!;
    expect(ais.state).toBe("configured");
    expect(ais.refusal).toBeUndefined();
  });

  it("never marks a keyless or locked layer refused, however many 403s it saw", () => {
    const rep = buildStatusReport(reg, {}, NOW, {
      evidence: {
        earthquakes: ev({ lastRefusalAt: NOW - 10, lastRefusalStatus: 403, lastRefusalHost: "x.example", refusals: 9 }),
        acled: ev({ lastRefusalAt: NOW - 10, lastRefusalStatus: 403, lastRefusalHost: "acleddata.com", refusals: 9 }),
      },
    });
    expect(rep.layers.find((l) => l.id === "earthquakes")!.state).toBe("keyless");
    expect(rep.layers.find((l) => l.id === "acled")!.state).toBe("locked");
    expect(rep.summary.layersRefused).toBe(0);
  });

  it("goes back to configured once the refusal is superseded by a 2xx", () => {
    const rep = buildStatusReport(reg, held, NOW, {
      evidence: {
        acled: ev({
          lastRefusalAt: NOW - 5_000,
          lastRefusalStatus: 403,
          lastRefusalHost: "acleddata.com",
          refusals: 1,
          lastUpstreamOkAt: NOW - 100,
        }),
      },
    });
    const acled = rep.layers.find((l) => l.id === "acled")!;
    expect(acled.state).toBe("configured");
    expect(acled.refusal).toBeUndefined();
  });

  it("applies the same rule to the non-layer capabilities", () => {
    const rep = buildStatusReport(reg, { WINDY_WEBCAMS_API_KEY: "k" }, NOW, {
      evidence: {
        webcams: ev({ lastRefusalAt: NOW - 1, lastRefusalStatus: 401, lastRefusalHost: "api.windy.com", refusals: 1 }),
      },
    });
    const webcams = rep.capabilities.find((c) => c.id === "webcams")!;
    expect(webcams.state).toBe("refused");
    expect(webcams.refusal?.status).toBe(401);
    // Capabilities are deliberately outside the layer totals.
    expect(rep.summary.layersRefused).toBe(0);
  });
});

// ===========================================================================
// (b) what is actually flowing, not just what is configured
// ===========================================================================

describe("buildStatusReport — flow", () => {
  const reg = [
    { id: "earthquakes", label: "Earthquakes", group: "Natural hazards", refreshMs: 300_000 },
    { id: "acled", label: "ACLED", group: "Conflict", refreshMs: 900_000 },
    { id: "ais", label: "Ships", group: "Maritime", refreshMs: 60_000 },
  ];

  it("publishes the last successful fetch time and the row count from it", () => {
    const rep = buildStatusReport(reg, {}, NOW, {
      evidence: {
        earthquakes: ev({ lastFetchAt: NOW - 42_000, lastFetchOk: true, lastRows: 317, fetches: 5 }),
      },
      observingSince: NOW - 600_000,
    });
    const quakes = rep.layers.find((l) => l.id === "earthquakes")!;
    expect(quakes.flow).toEqual({
      lastFetchAt: NOW - 42_000,
      lastFetchAgeMs: 42_000,
      ok: true,
      rows: 317,
      fetches: 5,
      lastUpstreamOkAt: null,
      observed: true,
    });
    expect(rep.evidence.since).toBe(NOW - 600_000);
  });

  // Zero is a MEASUREMENT and must not read as "never fetched". This is the whole
  // AIS story: the socket opens, delivers nothing, and the honest report is
  // "fetched 12 seconds ago, 0 rows" — not silence, and not a fabricated refusal.
  it("keeps zero rows distinct from never having fetched", () => {
    const rep = buildStatusReport(reg, { AISSTREAM_API_KEY: "k" }, NOW, {
      evidence: { ais: ev({ lastFetchAt: NOW - 12_000, lastFetchOk: true, lastRows: 0, fetches: 11 }) },
    });
    const ais = rep.layers.find((l) => l.id === "ais")!;
    expect(ais.flow.rows).toBe(0);
    expect(ais.flow.observed).toBe(true);
    const acled = rep.layers.find((l) => l.id === "acled")!;
    expect(acled.flow.rows).toBeNull();
    expect(acled.flow.observed).toBe(false);
  });

  it("totals the flow taxonomy over observed layers only", () => {
    const rep = buildStatusReport(reg, {}, NOW, {
      evidence: {
        earthquakes: ev({ lastFetchAt: NOW - 1_000, lastFetchOk: true, lastRows: 317, fetches: 2 }),
        ais: ev({ lastFetchAt: NOW - 2_000, lastFetchOk: true, lastRows: 0, fetches: 2 }),
        acled: ev({ lastFetchAt: NOW - 3_000, lastFetchOk: false, lastRows: null, fetches: 1 }),
      },
    });
    expect(rep.summary.layersObserved).toBe(3);
    expect(rep.summary.layersDelivering).toBe(1);
    expect(rep.summary.layersEmpty).toBe(1);
    expect(rep.summary.layersFailing).toBe(1);
  });

  it("never lets an age go negative on a clock that stepped backwards", () => {
    const rep = buildStatusReport(reg, {}, NOW, {
      evidence: { earthquakes: ev({ lastFetchAt: NOW + 5_000, lastFetchOk: true, lastRows: 1, fetches: 1 }) },
    });
    expect(rep.layers.find((l) => l.id === "earthquakes")!.flow.lastFetchAgeMs).toBe(0);
  });
});

describe("instrumentSignalRegistry", () => {
  beforeEach(resetEvidence);

  it("records the row count and completion of a real adapter fetch", async () => {
    const rows = [{ id: "a" }, { id: "b" }];
    const source = { id: "demo", fetch: async () => rows };
    expect(instrumentSignalRegistry([source])).toBe(1);

    const got = await source.fetch();
    // BY REFERENCE: lib/signals/coverage.ts keys its truncation records off array
    // identity, so a copy here would silently delete every coverage note in the app.
    expect(got).toBe(rows);
    const rec = readEvidence("demo")!;
    expect(rec.lastRows).toBe(2);
    expect(rec.lastFetchOk).toBe(true);
    expect(rec.fetches).toBe(1);
    expect(rec.lastFetchAt).not.toBeNull();
  });

  it("is idempotent, so a second /api/status hit does not double-wrap", async () => {
    const source = { id: "demo", fetch: async () => [{ id: "a" }] };
    expect(instrumentSignalRegistry([source])).toBe(1);
    expect(instrumentSignalRegistry([source])).toBe(0);
    await source.fetch();
    expect(readEvidence("demo")!.fetches).toBe(1);
  });

  it("records a throwing adapter and rethrows it unchanged", async () => {
    const boom = new Error("upstream exploded");
    const source = { id: "demo", fetch: async (): Promise<unknown[]> => { throw boom; } };
    instrumentSignalRegistry([source]);
    await expect(source.fetch()).rejects.toBe(boom);
    const rec = readEvidence("demo")!;
    expect(rec.lastFetchOk).toBe(false);
    expect(rec.lastRows).toBeNull();
    expect(rec.fetches).toBe(1);
  });

  it("keeps a failed fetch from erasing the last known row count", async () => {
    recordFetchOutcome("demo", { ok: true, rows: 40 }, NOW);
    recordFetchOutcome("demo", { ok: false, rows: null }, NOW + 1);
    const rec = readEvidence("demo")!;
    expect(rec.lastRows).toBe(40);
    expect(rec.lastFetchOk).toBe(false);
  });
});

describe("evidence ledger hygiene", () => {
  beforeEach(resetEvidence);

  it("hands out copies, so a caller cannot mutate the ledger through the report", () => {
    recordCredentialRefusal("acled", 403, "acleddata.com", NOW);
    const snap = snapshotEvidence();
    snap.acled.refusals = 999;
    expect(readEvidence("acled")!.refusals).toBe(1);
  });

  it("stores a hostname and a status — never a URL that could carry a key", () => {
    observeUpstreamResponse("https://api.windy.com/webcams/api/v3/webcams?key=SEKRIT", 403, NOW);
    const json = JSON.stringify(snapshotEvidence());
    expect(json).not.toContain("SEKRIT");
    expect(json).not.toContain("key=");
    expect(readEvidence("webcams")!.lastRefusalHost).toBe("api.windy.com");
  });
});
