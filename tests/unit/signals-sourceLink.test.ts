import { expect, test, describe } from "vitest";
import { SIGNALS } from "@/lib/signals/registry";
import {
  resolveSignalSources,
  isHttpUrl,
  hostLabel,
  isCompositeSignal,
  SIGNAL_PROVIDER_URLS,
  SIGNAL_COMPOSITE_SOURCES,
  CC_BY_4_0,
} from "@/lib/signals/sourceLink";

describe("resolveSignalSources — the clickable-source guarantee", () => {
  // The product's hard requirement: no signal dossier may ship sourceless.
  test("EVERY registered signal id resolves to at least one https source link", () => {
    for (const s of SIGNALS) {
      const sources = resolveSignalSources({ signalId: s.id });
      expect(sources.length, `${s.id} has no source link`).toBeGreaterThanOrEqual(1);
      for (const link of sources) {
        expect(isHttpUrl(link.href), `${s.id} → ${link.href} is not https`).toBe(true);
        expect(link.label.length, `${s.id} link has no label`).toBeGreaterThan(0);
      }
    }
  });

  test("prefers the deep record permalink when the feature carries one", () => {
    const link = "https://earthquake.usgs.gov/earthquakes/eventpage/nc75385096";
    const out = resolveSignalSources({ signalId: "earthquakes", link });
    expect(out[0]).toEqual({ href: link, label: "USGS", scope: "record" });
    // Provider home is the same host as the record → not duplicated.
    expect(out).toHaveLength(1);
  });

  test("keeps the provider link when the record lives on a different host", () => {
    // A GDELT news feature deep-links to the article's own outlet, not gdeltproject.org.
    const link = "https://www.reuters.com/world/some-article";
    const out = resolveSignalSources({ signalId: "conflict", link });
    expect(out[0]).toEqual({ href: link, label: "GDELT", scope: "record" });
    expect(out[1]).toEqual({ href: "https://www.gdeltproject.org/", label: "GDELT", scope: "provider" });
  });

  test("falls back to the provider dataset page for country-aggregated layers (no record link)", () => {
    expect(resolveSignalSources({ signalId: "cyber-ransomware" })).toEqual([
      { href: "https://www.ransomware.live/", label: "Ransomware.live", scope: "provider" },
    ]);
    expect(resolveSignalSources({ signalId: "displacement" })).toEqual([
      { href: "https://www.unhcr.org/refugee-statistics/", label: "UNHCR", scope: "provider" },
    ]);
  });

  test("a composite (instability) shows every contributing provider, flagged derived", () => {
    const out = resolveSignalSources({ signalId: "instability" });
    expect(isCompositeSignal("instability")).toBe(true);
    expect(out.length).toBeGreaterThanOrEqual(4);
    expect(out.map((s) => s.label)).toEqual(["ACLED", "WFP HungerMap", "UNHCR", "IODA"]);
    expect(out.every((s) => s.scope === "provider" && isHttpUrl(s.href))).toBe(true);
  });

  test("an adapter-provided sourceUrl overrides the id table when present", () => {
    const out = resolveSignalSources({ signalId: "displacement", sourceUrl: "https://example.org/data" });
    expect(out).toEqual([{ href: "https://example.org/data", label: "example.org", scope: "provider" }]);
  });

  test("unknown id with no link yields no fabricated source", () => {
    expect(resolveSignalSources({ signalId: "made-up" })).toEqual([]);
  });

  test("helpers: isHttpUrl + hostLabel", () => {
    expect(isHttpUrl("https://x.com")).toBe(true);
    expect(isHttpUrl("ftp://x")).toBe(false);
    expect(isHttpUrl(undefined)).toBe(false);
    expect(hostLabel("https://www.gdacs.org/report")).toBe("gdacs.org");
  });

  // Guard: every non-composite registered id has an explicit provider entry (so the
  // table stays in lock-step with the registry as new layers are added).
  test("provider table covers every non-composite registered signal id", () => {
    for (const s of SIGNALS) {
      if (SIGNAL_COMPOSITE_SOURCES[s.id]) continue;
      expect(SIGNAL_PROVIDER_URLS[s.id], `missing provider url for ${s.id}`).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Licence linking — CC BY 4.0 asks for a link to the LICENCE, not just credit.
// Naming the provider satisfies "appropriate credit" only, which left the two
// Open-Meteo layers nearly-conformant rather than conformant.
// ---------------------------------------------------------------------------
describe("resolveSignalSources — licence obligations", () => {
  test("Open-Meteo layers carry the CC BY 4.0 deed link", () => {
    for (const id of ["weather", "airquality"]) {
      const sources = resolveSignalSources({ signalId: id });
      const licensed = sources.filter((s) => s.licence);
      expect(licensed.length, `${id} lost its licence link`).toBeGreaterThanOrEqual(1);
      expect(licensed[0].licence).toEqual(CC_BY_4_0);
    }
  });

  test("the licence survives when a deep record link is the only chip", () => {
    // A record link on the provider's own host suppresses the provider chip, so a
    // licence hung only off the provider entry would vanish exactly when the deep
    // link works. It must ride on the record entry too.
    const sources = resolveSignalSources({
      signalId: "weather",
      link: "https://open-meteo.com/en/docs#some-record",
    });
    expect(sources.some((s) => s.licence?.url === CC_BY_4_0.url)).toBe(true);
  });

  test("the deed URL is the canonical creativecommons.org link", () => {
    // The obligation is specifically to link the licence. A link to Open-Meteo's own
    // terms page would name it without discharging it.
    expect(CC_BY_4_0.url).toBe("https://creativecommons.org/licenses/by/4.0/");
  });

  test("licences are declared, never inferred — most sources carry none", () => {
    // Public-domain (USGS, NOAA) and OGL sources must NOT sprout a licence chip:
    // an unnecessary legal notice on every layer is how a real one gets ignored.
    expect(resolveSignalSources({ signalId: "earthquakes" }).every((s) => !s.licence)).toBe(true);
    expect(resolveSignalSources({ signalId: "crime" }).every((s) => !s.licence)).toBe(true);
  });
});
