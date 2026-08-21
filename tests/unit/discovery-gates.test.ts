import { describe, it, expect } from "vitest";
import { DUPLICATE_RADIUS_M, isAdmissible, isRelayHost, runGates, sharesRegistrableRoot } from "@/lib/discovery/gates";
import { haversineMetres } from "@/lib/discovery/geo";
import type { FeedDescriptor, SampleCamera } from "@/lib/discovery/types";

const DESCRIPTOR: FeedDescriptor = {
  key: "example-dot",
  name: "Example DOT",
  country: "GB",
  endpoint: "https://cameras.example.gov.uk/api/cameras",
  format: "json",
  mapping: { id: "id", name: "name", lat: "lat", lon: "lon", imageUrl: "img" },
  license: "OGL v3.0",
  attribution: "(c) Example DOT",
  refreshSeconds: 120,
};

function samples(n = 6, patch: (i: number) => Partial<SampleCamera> = () => ({})): SampleCamera[] {
  return Array.from({ length: n }, (_, i) => ({
    nativeId: "C" + i,
    name: "Site " + i,
    lat: 51.5 + i * 0.01,
    lon: -0.12 - i * 0.01,
    imageUrl: "https://cameras.example.gov.uk/img/" + i + ".jpg",
    ...patch(i),
  }));
}

const gate = (results: ReturnType<typeof runGates>, name: string) => results.find((g) => g.gate === name);

describe("isRelayHost", () => {
  it("matches a relay and its subdomains but not a lookalike", () => {
    expect(isRelayHost("https://www.windy.com/webcams/1")).toBe(true);
    expect(isRelayHost("https://images.webcams.travel/x.jpg")).toBe(true);
    expect(isRelayHost("https://kameresrbije.rs/cameras-all.json")).toBe(true);
    expect(isRelayHost("https://notwindy.com/x")).toBe(false);
    expect(isRelayHost("https://cameras.example.gov.uk/x")).toBe(false);
    expect(isRelayHost("nonsense")).toBe(false);
  });
});

describe("sharesRegistrableRoot", () => {
  it("treats subdomains of one organisation as the same origin", () => {
    expect(sharesRegistrableRoot("images.example.gov.uk", "cameras.example.gov.uk")).toBe(true);
    expect(sharesRegistrableRoot("cdn.example.com", "www.example.com")).toBe(true);
  });

  it("treats a different organisation as different", () => {
    expect(sharesRegistrableRoot("images.relay.net", "cameras.example.gov.uk")).toBe(false);
    expect(sharesRegistrableRoot("", "cameras.example.gov.uk")).toBe(false);
  });
});

describe("runGates", () => {
  it("passes a clean, licensed, in-country feed on every gate", () => {
    const results = runGates({
      descriptor: DESCRIPTOR,
      samples: samples(),
      parsed: { rows: 100, valid: 98 },
      catalogueLicense: "Open Government Licence v3.0",
    });
    expect(results.every((g) => g.status === "pass")).toBe(true);
    expect(isAdmissible(results)).toBe(true);
  });

  it("fails a relay outright, however good the pictures are", () => {
    const results = runGates({
      descriptor: DESCRIPTOR,
      samples: samples(4, () => ({ imageUrl: "https://images.webcams.travel/a.jpg" })),
      parsed: { rows: 40, valid: 40 },
      catalogueLicense: "CC-BY-4.0",
    });
    expect(gate(results, "relay")?.status).toBe("fail");
    expect(isAdmissible(results)).toBe(false);
  });

  it("fails a bare-IP media host", () => {
    const results = runGates({
      descriptor: DESCRIPTOR,
      samples: samples(4, (i) => (i === 0 ? { imageUrl: "http://81.133.67.228:8080/cam.jpg" } : {})),
      parsed: { rows: 40, valid: 40 },
    });
    expect(gate(results, "media-host")?.status).toBe("fail");
    expect(isAdmissible(results)).toBe(false);
  });

  it("fails a feed nothing parsed out of, and warns on a partial one", () => {
    expect(gate(runGates({ descriptor: DESCRIPTOR, samples: [], parsed: { rows: 400, valid: 0 } }), "yield")?.status).toBe(
      "fail",
    );
    expect(
      gate(runGates({ descriptor: DESCRIPTOR, samples: samples(), parsed: { rows: 400, valid: 40 } }), "yield")?.status,
    ).toBe("warn");
  });

  it("warns rather than fails when no licence is stated", () => {
    // Plenty of legitimate operators publish cameras with no licence at all. The honest
    // response is to say so on the source, not to refuse the source or invent a name.
    const results = runGates({ descriptor: DESCRIPTOR, samples: samples(), parsed: { rows: 10, valid: 10 } });
    expect(gate(results, "licence")?.status).toBe("warn");
    expect(isAdmissible(results)).toBe(true);
  });

  it("warns about http media, which a browser blocks as mixed content", () => {
    const results = runGates({
      descriptor: DESCRIPTOR,
      samples: samples(3, (i) => (i === 1 ? { imageUrl: "http://cameras.example.gov.uk/1.jpg" } : {})),
      parsed: { rows: 10, valid: 10 },
    });
    expect(gate(results, "transport")?.status).toBe("warn");
  });

  it("fails a feed whose coordinates are mostly outside the declared country", () => {
    // The signature of a swapped lat/lon pair, and the reason the check exists.
    const results = runGates({
      descriptor: DESCRIPTOR,
      samples: samples(6, (i) => ({ lat: -0.12 - i * 0.01, lon: 51.5 + i * 0.01 })),
      parsed: { rows: 10, valid: 10 },
    });
    expect(gate(results, "country-fit")?.status).toBe("fail");
  });

  it("only warns when a minority sit outside, because border sites legitimately do", () => {
    const results = runGates({
      descriptor: DESCRIPTOR,
      samples: samples(6, (i) => (i === 0 ? { lat: 51.0, lon: 2.4 } : {})),
      parsed: { rows: 10, valid: 10 },
    });
    expect(gate(results, "country-fit")?.status).toBe("warn");
  });

  it("says it did not check when there is no box on file", () => {
    const results = runGates({
      descriptor: { ...DESCRIPTOR, country: "MN" },
      samples: samples(),
      parsed: { rows: 10, valid: 10 },
    });
    expect(gate(results, "country-fit")?.status).toBe("warn");
    expect(gate(results, "country-fit")?.detail).toMatch(/not checked/i);
  });

  it("fails a network already served under another key", () => {
    // Re-adding a feed double-counts every camera in the coverage figures, and those
    // figures get quoted.
    const existing = samples().map((s, i) => ({ id: "tfl:" + i, source: "tfl", lat: s.lat, lon: s.lon }));
    const results = runGates({
      descriptor: DESCRIPTOR,
      samples: samples(),
      parsed: { rows: 10, valid: 10 },
      existing,
    });
    expect(gate(results, "overlap")?.status).toBe("fail");
    expect(gate(results, "overlap")?.detail).toContain("tfl");
  });

  it("does not call a nearby but distinct camera a duplicate", () => {
    // 60 m is the radius; these sit about 220 m away.
    const existing = samples().map((s, i) => ({ id: "tfl:" + i, source: "tfl", lat: s.lat + 0.002, lon: s.lon }));
    expect(haversineMetres(51.5, -0.12, 51.502, -0.12)).toBeGreaterThan(DUPLICATE_RADIUS_M);
    const results = runGates({
      descriptor: DESCRIPTOR,
      samples: samples(),
      parsed: { rows: 10, valid: 10 },
      existing,
    });
    expect(gate(results, "overlap")?.status).toBe("pass");
  });

  it("asks about pictures served from a different organisation's domain", () => {
    const results = runGates({
      descriptor: DESCRIPTOR,
      samples: samples(3, () => ({ imageUrl: "https://cdn.someoneelse.net/a.jpg" })),
      parsed: { rows: 10, valid: 10 },
    });
    expect(gate(results, "media-origin")?.status).toBe("warn");
    expect(gate(results, "media-origin")?.detail).toContain("someoneelse.net");
  });

  it("does not ask about an operator's own CDN subdomain", () => {
    const results = runGates({
      descriptor: DESCRIPTOR,
      samples: samples(3, () => ({ imageUrl: "https://cdn.example.gov.uk/a.jpg" })),
      parsed: { rows: 10, valid: 10 },
    });
    expect(gate(results, "media-origin")?.status).toBe("pass");
  });
});

describe("isAdmissible", () => {
  it("is blocked by a fail and not by a warn", () => {
    expect(isAdmissible([{ gate: "a", status: "warn", detail: "" }])).toBe(true);
    expect(isAdmissible([{ gate: "a", status: "fail", detail: "" }])).toBe(false);
  });
});

describe("overlap cannot claim more than it checked", () => {
  /**
   * THE FAILURE THIS PINS, which happened. A live run passed an ArcGIS mirror of
   * Caltrans District 4 with "No sampled camera sits within 60 m of one already
   * served". Every one of its twelve samples was within 50 m of a camera this product
   * already serves, and eleven had byte-identical image URLs.
   *
   * The registry read that fed the gate was not empty — so the gate ran — it was
   * simply missing the `caltrans` feed, which had not answered that round. The gate
   * then reported a global absence it had no way to observe, and a duplicate of 746
   * cameras came within one keypress of the map.
   *
   * A pass may only speak for the feeds that were actually in the snapshot.
   */
  const FEEDS = ["tfl", "caltrans", "scdot"];

  it("warns instead of passing when a known feed was absent from the snapshot", () => {
    const results = runGates({
      descriptor: DESCRIPTOR,
      samples: samples(),
      parsed: { rows: 60, valid: 60 },
      existing: [{ id: "tfl:1", source: "tfl", lat: 10, lon: 10 }],
      expectedSources: FEEDS,
    });
    const overlap = gate(results, "overlap");
    expect(overlap?.status).toBe("warn");
    expect(overlap?.detail).toContain("caltrans");
    expect(overlap?.detail).toContain("scdot");
  });

  it("passes cleanly when every known feed was in the snapshot", () => {
    const results = runGates({
      descriptor: DESCRIPTOR,
      samples: samples(),
      parsed: { rows: 60, valid: 60 },
      existing: FEEDS.map((source, i) => ({ id: source + ":1", source, lat: 10 + i, lon: 10 })),
      expectedSources: FEEDS,
    });
    expect(gate(results, "overlap")?.status).toBe("pass");
  });

  it("still fails on a real duplicate even with feeds missing", () => {
    const dupes = samples().map((s) => ({ id: "caltrans:" + s.nativeId, source: "caltrans", lat: s.lat, lon: s.lon }));
    const results = runGates({
      descriptor: DESCRIPTOR,
      samples: samples(),
      parsed: { rows: 60, valid: 60 },
      existing: dupes,
      expectedSources: FEEDS,
    });
    expect(gate(results, "overlap")?.status).toBe("fail");
  });
});
