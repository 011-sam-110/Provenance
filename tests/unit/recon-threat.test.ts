import { expect, test } from "vitest";
import fixture from "@/tests/fixtures/recon-internetdb.json";
import {
  parseThreatBaseline,
  providerSlots,
  THREAT_PROVIDERS,
  type InternetDbResponse,
} from "@/lib/recon/threat";

test("parseThreatBaseline maps tags/vulns; sorts CVEs and flags when present", () => {
  // Fixture 1.1.1.1 has empty tags/vulns → arrays present, not flagged.
  const clean = parseThreatBaseline(fixture as InternetDbResponse, "1.1.1.1");
  expect(clean).toEqual({ ip: "1.1.1.1", tags: [], vulns: [], flagged: false });

  // Synthetic response WITH vulns → flagged, CVEs sorted, tags kept.
  const dirty = parseThreatBaseline(
    { ip: "9.9.9.9", tags: ["malware", "c2"], vulns: ["CVE-2021-44228", "CVE-2014-0160", ""] },
    "9.9.9.9",
  );
  expect(dirty.flagged).toBe(true);
  expect(dirty.tags).toEqual(["malware", "c2"]);
  expect(dirty.vulns).toEqual(["CVE-2014-0160", "CVE-2021-44228"]); // sorted, empty dropped
});

test("providerSlots returns ip-supporting providers, locked unless key present", () => {
  const locked = providerSlots("ip", {});
  const ipProviders = THREAT_PROVIDERS.filter((p) => p.supports.includes("ip")).map((p) => p.id);
  expect(locked.map((s) => s.id)).toEqual(ipProviders);
  expect(locked.every((s) => s.locked)).toBe(true);

  const withKey = providerSlots("ip", { ABUSEIPDB_API_KEY: "x" });
  expect(withKey.find((s) => s.id === "abuseipdb")?.locked).toBe(false);
  expect(withKey.find((s) => s.id === "greynoise")?.locked).toBe(true);

  // Domain-only view excludes ip-only providers (e.g. AbuseIPDB, GreyNoise).
  const domainSlots = providerSlots("domain", {}).map((s) => s.id);
  expect(domainSlots).toContain("virustotal");
  expect(domainSlots).not.toContain("abuseipdb");
});

test("dormant-safe: null / malformed input yields an honest empty baseline", () => {
  expect(parseThreatBaseline(null, "1.1.1.1")).toEqual({ ip: "1.1.1.1", tags: [], vulns: [], flagged: false });
  expect(parseThreatBaseline({} as InternetDbResponse, "1.1.1.1")).toEqual({
    ip: "1.1.1.1",
    tags: [],
    vulns: [],
    flagged: false,
  });
  // Non-array fields must not throw.
  expect(parseThreatBaseline({ tags: "nope", vulns: 3 } as unknown as InternetDbResponse, "1.1.1.1").flagged).toBe(false);
  expect(providerSlots("empty", {})).toEqual([]);
});

test("a slot with a key set but no reader says so, and never shows as on", () => {
  // No provider is read by app/api/recon/threat yet, so a set key is "unwired", not a tick.
  expect(THREAT_PROVIDERS.every((p) => p.wired === false)).toBe(true);
  const slots = providerSlots("ip", { ABUSEIPDB_API_KEY: "x" });
  expect(slots.find((s) => s.id === "abuseipdb")?.state).toBe("unwired");
  expect(slots.find((s) => s.id === "greynoise")?.state).toBe("locked");
  expect(slots.some((s) => s.state === "on")).toBe(false);
});
