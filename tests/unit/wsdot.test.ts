import { expect, test } from "vitest";
import fixture from "@/tests/fixtures/wsdot-cameras.json";
import { decodeWsdot, mercatorToLonLat, normalizeWsdot, roadFromTitle } from "@/lib/sources/wsdot";
import { isAllowed } from "@/lib/proxy/allowlist";
import { CameraArray } from "@/lib/types";

// Five rows captured 2026-10-16: one TripCheck duplicate, three WSDOT stills (one with
// the en dash that breaks strict UTF-8) and one Seattle DOT still.
test("keeps only WSDOT's own stills", () => {
  const cams = normalizeWsdot(fixture as never);
  expect(() => CameraArray.parse(cams)).not.toThrow();
  expect(cams.map((c) => c.id)).toEqual(["wsdot:1003", expect.any(String), expect.any(String)]);
  for (const c of cams) {
    expect(new URL(c.imageUrl!).hostname).toBe("images.wsdot.wa.gov");
    expect(isAllowed(new URL(c.imageUrl!))).toBe(true);
  }
});

test("converts the Mercator metres to the place the title names", () => {
  const [mainSt] = normalizeWsdot(fixture as never);
  // "I-5 at MP 3.2: Main St" is in Vancouver, WA, just north of the Columbia.
  expect(mainSt.lat).toBeGreaterThan(45.6);
  expect(mainSt.lat).toBeLessThan(45.7);
  expect(mainSt.lon).toBeGreaterThan(-122.7);
  expect(mainSt.lon).toBeLessThan(-122.6);
  expect(mainSt.road).toBe("I-5");
  expect(mainSt.region).toBe("Washington");
});

test("mercatorToLonLat round-trips the origin and a known point", () => {
  expect(mercatorToLonLat(0, 0)).toEqual({ lon: 0, lat: 0 });
  const p = mercatorToLonLat(-13655105.30305963, 5725939.2820585705);
  expect(p.lon).toBeCloseTo(-122.667, 2);
});

test("decodes the upstream's windows-1252 bytes instead of failing on 0x96", () => {
  const bytes = new Uint8Array([...new TextEncoder().encode('{"t":"A '), 0x96, ...new TextEncoder().encode(' B"}')]);
  expect(() => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))).toThrow();
  expect(decodeWsdot(bytes)).toEqual({ t: "A – B" });
});

test("reads a road number off the front of a title, and nothing off a place name", () => {
  expect(roadFromTitle("SR 167 at MP 21.3: 84th Ave S")).toBe("SR 167");
  expect(roadFromTitle("US 2 at MP 64: Stevens Pass")).toBe("US 2");
  expect(roadFromTitle("Olympia Regional Airport South")).toBeUndefined();
});
