import { describe, expect, test } from "vitest";
import fixture from "@/tests/fixtures/cars.json";
import {
  CARS_SYSTEMS,
  STALE_STILL_MS,
  normalizeCarsArray,
  normalizeCarsGeojson,
  pickView,
  type CarsCamera,
  type CarsFeature,
} from "@/lib/sources/cars";
import { isAllowed } from "@/lib/proxy/allowlist";
import { CameraArray } from "@/lib/types";

// Captured 2026-10-16 from the six live endpoints (two to four rows per state, chosen
// to cover each view shape). The fixture's clock: stills dated 1792183xxx000.
const NOW = 1_792_183_200_000;
const sys = (s: string) => CARS_SYSTEMS.find((x) => x.system === s)!;
const arr = (s: "mn" | "ks" | "ia" | "co") => (fixture as unknown as Record<string, CarsCamera[]>)[s];
const ny = (fixture as unknown as { ny: { features: CarsFeature[] } }).ny;

describe("CARS array shape (MN, IA, IN, KS, CO)", () => {
  test("serves a video camera as its preview still, and a still camera as its picture", () => {
    const cams = normalizeCarsArray(arr("mn"), sys("mn"), NOW);
    expect(() => CameraArray.parse(cams)).not.toThrow();
    expect(cams).toHaveLength(2);
    const [video, still] = cams;
    expect(video.id).toBe("cars-mn:512359");
    expect(video.source).toBe("cars-mn");
    expect(video.imageUrl).toBe("https://public.carsprogram.org/cameras/MN/C4707");
    expect(video.mediaType).toBe("jpeg"); // HLS is a separate decision, not taken here
    expect(video.streamUrl).toBeUndefined();
    expect(still.imageUrl).toMatch(/^https:\/\/public\.carsprogram\.org\/cameras\/MN\//);
    expect(video.region).toBe("Minnesota");
    expect(video.lat).toBeCloseTo(45.0697, 3); // location.latitude, not swapped
    expect(video.lon).toBeCloseTo(-93.2632, 3);
    expect(video.attribution).toContain("MnDOT");
  });

  test("KanDrive: keeps KC Scout and KDOT stills, drops a camera with no picture", () => {
    const cams = normalizeCarsArray(arr("ks"), sys("ks"), NOW);
    const hosts = cams.map((c) => new URL(c.imageUrl!).hostname);
    expect(hosts).toContain("www.kcscout.net");
    expect(hosts).toContain("kscam.carsprogram.org");
    expect(cams.find((c) => c.id === "cars-ks:2583")).toBeUndefined(); // empty view
    expect(cams).toHaveLength(3);
  });

  test("a still more than a day old is shown but not called online", () => {
    const cams = normalizeCarsArray(arr("ks"), sys("ks"), NOW);
    const rwis = cams.find((c) => c.id === "cars-ks:1")!; // KDOT RWIS still, two days old
    expect(rwis.available).toBe(false);
    const fresh = cams.find((c) => c.id === "cars-ks:2356")!;
    expect(fresh.available).toBe(true);
    expect(NOW - 1_792_010_534_000).toBeGreaterThan(STALE_STILL_MS);
  });

  test("Iowa stills on both path spellings pass", () => {
    const cams = normalizeCarsArray(arr("ia"), sys("ia"), NOW);
    expect(cams).toHaveLength(2);
    for (const c of cams) expect(new URL(c.imageUrl!).hostname).toBe("atmsqf.iowadot.gov");
  });

  test("Colorado: drops the one third-party still it does not serve", () => {
    const cams = normalizeCarsArray(arr("co"), sys("co"), NOW);
    expect(cams.map((c) => c.id)).toEqual(["cars-co:16384"]);
  });

  test("region comes from the camera's own state code, not the system", () => {
    const row = { ...arr("ks")[0], location: { ...arr("ks")[0].location, fips: 29 } };
    expect(normalizeCarsArray([row], sys("ks"), NOW)[0].region).toBe("Missouri");
  });

  test("skips a non-public camera and a null-island coordinate", () => {
    const base = arr("mn")[0];
    expect(normalizeCarsArray([{ ...base, public: false }], sys("mn"), NOW)).toEqual([]);
    const zero = { ...base, location: { ...base.location, latitude: 0, longitude: 0 } };
    expect(normalizeCarsArray([zero], sys("mn"), NOW)).toEqual([]);
  });
});

describe("CARS GeoJSON shape (NY)", () => {
  test("reads [lon, lat] and keeps NYSDOT's preview stills", () => {
    const cams = normalizeCarsGeojson(ny, sys("ny"), NOW);
    expect(() => CameraArray.parse(cams)).not.toThrow();
    expect(cams).toHaveLength(1);
    const [c] = cams;
    expect(c.id.startsWith("cars-ny:")).toBe(true);
    expect(c.region).toBe("New York");
    expect(c.lat).toBeGreaterThan(40);
    expect(c.lat).toBeLessThan(45.1);
    expect(c.lon).toBeLessThan(-71);
    expect(c.imageUrl).toMatch(/^https:\/\/public\.carsprogram\.org\/cameras\/NYSDOT\//);
  });

  test("drops NYC DOT's nyctmc.org stills, which nobody has seen load", () => {
    const cams = normalizeCarsGeojson(ny, sys("ny"), NOW);
    expect(cams.some((c) => c.imageUrl?.includes("nyctmc.org"))).toBe(false);
  });
});

describe("pickView", () => {
  test("skips a broken view and takes the next one the proxy serves", () => {
    const picked = pickView([
      { type: "STILL_IMAGE", url: "https://public.carsprogram.org/cameras/MN/A", broken: true },
      { type: "STILL_IMAGE", url: "https://public.carsprogram.org/cameras/MN/B" },
    ]);
    expect(picked?.imageUrl).toBe("https://public.carsprogram.org/cameras/MN/B");
  });

  test("never returns a picture the proxy would refuse", () => {
    expect(pickView([{ type: "STILL_IMAGE", url: "https://api.trafficland.com/v2.0/x.jpg" }])).toBeNull();
    expect(pickView([{ type: "WMP", url: "https://video.dot.state.mn.us/x/playlist.m3u8" }])).toBeNull();
  });
});

test("every state has its own feed key, so one outage keeps the others' last-good", () => {
  const keys = CARS_SYSTEMS.map((s) => s.key);
  expect(new Set(keys).size).toBe(keys.length);
  expect(keys).toEqual(["cars-ny", "cars-mn", "cars-ia", "cars-in", "cars-ks", "cars-co"]);
});

test("every camera the fixture yields opens through the proxy", () => {
  const all = [
    ...normalizeCarsGeojson(ny, sys("ny"), NOW),
    ...(["mn", "ks", "ia", "co"] as const).flatMap((s) => normalizeCarsArray(arr(s), sys(s), NOW)),
  ];
  expect(all.length).toBeGreaterThan(8);
  for (const c of all) expect(isAllowed(new URL(c.imageUrl!)), c.imageUrl).toBe(true);
});
